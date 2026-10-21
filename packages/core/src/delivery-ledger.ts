/**
 * I-5 rounds 3 and 4 (B-2, B-3, M-2, M-3, M-4, M-5): the delivery ledger.
 *
 * One JSON file per agent session key (OpenCode: the stored `ses_...` ID)
 * in the project state directory (`getDeliveryLedgerDir`). Each entry is one
 * logical send: its input ID, the SHA-256 of its text, its owner (the PID,
 * for an operator, and the attempt token) and its state. The file is apart
 * from the session record, so a record write (`updateMetadata`), a kill, the
 * archive and a restore do not touch it.
 *
 * - Every read-change-write runs under the ledger lock, a lock that the
 *   kernel releases when its process ends (`delivery-lock.ts`), so no lock
 *   state stays behind after a process that ends abruptly. A live holder
 *   makes the caller wait for at most `DELIVERY_LOCK_WAIT_MS`. The lock
 *   covers only the ledger change, never the agent's API call.
 * - Each attempt holds an attempt lock of its own (named after its token)
 *   from before its claim is written until its settle. A `sending` entry
 *   whose attempt lock no process holds belongs to an attempt that ended
 *   (its process ended, or its settle could not write): a later send of the
 *   same text takes its ID. A `sending` entry whose attempt lock is held is
 *   in flight: a later send of the same text gets a new ID.
 * - After a success the entry becomes `admitted` before it is removed, so a
 *   failed removal leaves an entry that no send takes.
 * - The ledger is written with `atomicWriteFileSync` (a temp file and a
 *   rename). A file that does not parse, or that holds an invalid entry,
 *   fails closed: it is never overwritten and never read as empty.
 */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomic-write.js";
import {
  deliveryLockName,
  holdDeliveryLock,
  isDeliveryLockHeld,
  isDeliveryLockSupported,
  printableLockName,
  tryHoldDeliveryLock,
  type DeliveryLock,
} from "./delivery-lock.js";

/**
 * A later send of the same text reuses the ID of an entry that changed less
 * than this long ago. The lifecycle polls every 30 s and one slow send takes
 * about 1 to 2 min, so a retry of the same dispatch comes well inside it; so
 * does a human who reads the error and sends again. Each claim and each
 * settle moves `updatedAt`, so a chain of retries keeps its ID.
 */
export const DELIVERY_REUSE_MS = 10 * 60_000;

/**
 * How long a caller waits for the ledger lock of a live holder. A holder
 * keeps it only for one read, the probes of the attempt locks, one JSON
 * change and one temp-file write and rename of a small file (milliseconds),
 * so 2 s is far above a normal hold and still short for a CLI user and a
 * 30 s lifecycle poll. After it the caller fails before the prompt, so
 * nothing is sent.
 */
export const DELIVERY_LOCK_WAIT_MS = 2_000;

/**
 * At most this many entries younger than `DELIVERY_REUSE_MS` per ledger. A
 * new send beyond it fails (nothing is sent), so no unresolved ID is ever
 * dropped to make room.
 */
export const DELIVERY_LEDGER_MAX_ENTRIES = 200;

/** After a success, the `admitted` mark is tried again after these waits. */
const MARK_RETRY_DELAYS_MS = [200, 1_000];

/**
 * When the `admitted` mark cannot be written, this process keeps the
 * attempt lock this long (the reuse bound plus a margin for clock steps), so
 * that no send takes the ID of the admitted input while this process runs.
 */
export const DELIVERY_UNRECORDED_HOLD_MS = DELIVERY_REUSE_MS + 60_000;

const LEDGER_VERSION = 2;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const INPUT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The temp file of `atomicWriteFileSync`: `<file>.tmp.<pid>.<ms>`. */
const TEMP_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json\.tmp\.\d+\.\d+$/;

/**
 * `sending`: an attempt claimed the entry (in flight while its attempt lock
 * is held). `unknown`: its admission stayed unknown. `admitted`: the service
 * admitted it; no send takes it, and the next change removes it.
 */
export type DeliveryState = "sending" | "unknown" | "admitted";

/** The attempt that owns an entry. */
export interface DeliveryOwner {
  /** The `ao` process of the attempt; only for an operator, no rule reads it. */
  pid: number;
  /** The attempt token; it names the attempt lock. */
  token: string;
}

export interface DeliveryEntry {
  /** The input ID that the agent sends (OpenCode: the client `msg_...` ID). */
  inputId: string;
  /** SHA-256 (hex) of the UTF-8 message text. */
  textSha256: string;
  /** When the first attempt of this ID began (ISO 8601). */
  createdAt: string;
  /** The last claim or settle (ISO 8601); the reuse bound counts from it. */
  updatedAt: string;
  state: DeliveryState;
  owner: DeliveryOwner;
}

/** A ledger problem. Before the prompt the caller treats it as a definite refusal. */
export class DeliveryLedgerError extends Error {
  constructor(
    message: string,
    readonly path: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DeliveryLedgerError";
  }
}

/** The ledger does not parse or holds an invalid entry; it is not changed. */
export class DeliveryLedgerCorruptError extends DeliveryLedgerError {
  constructor(path: string, detail: string) {
    super(
      `the delivery ledger ${path} is not valid (${detail}); ao does not change it. Check that no ao process sends to this session, then remove the file to clear it`,
      path,
    );
    this.name = "DeliveryLedgerCorruptError";
  }
}

/** A live process held the ledger lock for longer than `DELIVERY_LOCK_WAIT_MS`. */
export class DeliveryLedgerBusyError extends DeliveryLedgerError {
  constructor(path: string, lockName: string) {
    super(
      `the delivery ledger ${path} is locked by another process for more than ${DELIVERY_LOCK_WAIT_MS} ms (the lock is the abstract socket ${printableLockName(lockName)}; \`ss -xlp\` shows the process that holds it)`,
      path,
    );
    this.name = "DeliveryLedgerBusyError";
  }
}

// ---------------------------------------------------------------------------
// The locks
// ---------------------------------------------------------------------------

/** The real path of the ledger file: it names the locks of this ledger. */
function ledgerSubject(dir: string, key: string): string {
  return join(realpathSync.native(dir), `${key}.json`);
}

/** The name of the ledger lock of `key` in `dir` (the directory must exist). */
export function deliveryLedgerLockName(dir: string, key: string): string {
  return deliveryLockName("ledger", ledgerSubject(dir, key));
}

/** The name of the attempt lock of `token` in the ledger of `key` in `dir`. */
export function deliveryAttemptLockName(dir: string, key: string, token: string): string {
  return deliveryLockName("attempt", `${ledgerSubject(dir, key)}#${token}`);
}

function requireLockSupport(path: string): void {
  if (!isDeliveryLockSupported()) {
    throw new DeliveryLedgerError(
      `the delivery ledger ${path} needs a lock that the OS releases (a Linux abstract Unix socket), and ${process.platform} has none`,
      path,
    );
  }
}

// ---------------------------------------------------------------------------
// The ledger file
// ---------------------------------------------------------------------------

/** The ledger file of `key` in `dir`. Throws for a key that is not a safe file name. */
export function deliveryLedgerPath(dir: string, key: string): string {
  if (!KEY_PATTERN.test(key)) {
    throw new DeliveryLedgerError(
      `the delivery ledger key ${JSON.stringify(key)} is not valid`,
      dir,
    );
  }
  return join(dir, `${key}.json`);
}

function isOwner(value: unknown): value is DeliveryOwner {
  if (typeof value !== "object" || value === null) return false;
  const owner = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(owner["pid"]) &&
    (owner["pid"] as number) > 0 &&
    typeof owner["token"] === "string" &&
    TOKEN_PATTERN.test(owner["token"])
  );
}

function invalidEntryDetail(value: unknown, index: number): string | null {
  if (typeof value !== "object" || value === null) return `entry ${index} is not an object`;
  const entry = value as Record<string, unknown>;
  if (typeof entry["inputId"] !== "string" || !INPUT_ID_PATTERN.test(entry["inputId"])) {
    return `entry ${index} has no valid inputId`;
  }
  if (typeof entry["textSha256"] !== "string" || !SHA256_PATTERN.test(entry["textSha256"])) {
    return `entry ${index} has no valid textSha256`;
  }
  for (const field of ["createdAt", "updatedAt"]) {
    const time = entry[field];
    if (typeof time !== "string" || !Number.isFinite(Date.parse(time))) {
      return `entry ${index} has no valid ${field}`;
    }
  }
  if (!["sending", "unknown", "admitted"].includes(entry["state"] as string)) {
    return `entry ${index} has no valid state`;
  }
  if (!isOwner(entry["owner"])) return `entry ${index} has no valid owner`;
  return null;
}

/**
 * Read and check the ledger of `key`. A missing file is an empty ledger. A
 * file that does not parse, that names another key, or that holds an
 * invalid entry throws `DeliveryLedgerCorruptError`.
 */
export function readDeliveryLedger(dir: string, key: string): DeliveryEntry[] {
  const path = deliveryLedgerPath(dir, key);
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new DeliveryLedgerError(`could not read the delivery ledger ${path}`, path, {
      cause: err,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DeliveryLedgerCorruptError(path, "it is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DeliveryLedgerCorruptError(path, "it is not an object");
  }
  const file = parsed as Record<string, unknown>;
  if (file["version"] !== LEDGER_VERSION) {
    throw new DeliveryLedgerCorruptError(path, `its version is not ${LEDGER_VERSION}`);
  }
  if (file["key"] !== key)
    throw new DeliveryLedgerCorruptError(path, `it is not the ledger of ${key}`);
  if (!Array.isArray(file["entries"]))
    throw new DeliveryLedgerCorruptError(path, "it has no entries array");
  const entries = file["entries"] as unknown[];
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const detail = invalidEntryDetail(entry, index);
    if (detail) throw new DeliveryLedgerCorruptError(path, detail);
    const inputId = (entry as DeliveryEntry).inputId;
    if (seen.has(inputId))
      throw new DeliveryLedgerCorruptError(path, `the input ID ${inputId} is twice in it`);
    seen.add(inputId);
  });
  return entries as DeliveryEntry[];
}

/** An entry that a change keeps: not `admitted`, and changed less than `DELIVERY_REUSE_MS` ago. */
function isLive(entry: DeliveryEntry, now: number): boolean {
  return entry.state !== "admitted" && now - Date.parse(entry.updatedAt) < DELIVERY_REUSE_MS;
}

function writeDeliveryLedger(path: string, key: string, entries: DeliveryEntry[]): void {
  if (entries.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  atomicWriteFileSync(
    path,
    `${JSON.stringify({ version: LEDGER_VERSION, key, entries }, null, 2)}\n`,
  );
}

/**
 * Run `change` on the ledger of `key` under its lock: read and check the
 * file, remove the `admitted` entries and the entries older than
 * `DELIVERY_REUSE_MS`, change, and write (or remove the file when it is
 * empty). A corrupt file throws before any change, and the file stays as it
 * is. `beforeUnlock` runs while the lock is still held, after the write or
 * after an error (`written` tells which).
 */
export async function changeDeliveryLedger<T>(
  dir: string,
  key: string,
  change: (
    entries: DeliveryEntry[],
    now: number,
  ) => { entries: DeliveryEntry[]; result: T } | Promise<{ entries: DeliveryEntry[]; result: T }>,
  options: { beforeUnlock?: (written: boolean) => void } = {},
): Promise<T> {
  const path = deliveryLedgerPath(dir, key);
  requireLockSupport(path);
  mkdirSync(dir, { recursive: true });
  const lockName = deliveryLedgerLockName(dir, key);
  const lock = await holdDeliveryLock(lockName, DELIVERY_LOCK_WAIT_MS);
  if (!lock) throw new DeliveryLedgerBusyError(path, lockName);
  let written = false;
  try {
    const now = Date.now();
    const current = readDeliveryLedger(dir, key).filter((entry) => isLive(entry, now));
    const { entries, result } = await change(current, now);
    writeDeliveryLedger(path, key, entries);
    written = true;
    return result;
  } finally {
    try {
      options.beforeUnlock?.(written);
    } finally {
      lock.release();
    }
  }
}

// ---------------------------------------------------------------------------
// The send protocol
// ---------------------------------------------------------------------------

export interface DeliveryAttempt {
  /** The input ID to send. */
  inputId: string;
  /** The attempt token; it names the attempt lock. */
  token: string;
  /** True when the ID is the one of an earlier attempt of the same text. */
  reused: boolean;
  /** The attempt lock, held until `settleDelivery`. */
  hold: DeliveryLock;
}

/**
 * The newest entry of `textSha256` whose ID a new attempt may take: an
 * `unknown` entry, or a `sending` entry whose attempt lock no process holds
 * (its attempt ended without a settle that wrote). Called under the ledger
 * lock. Every settle writes and releases its attempt lock under the same
 * lock, so a settle cannot run between a probe and the claim; an attempt
 * lock, once free, is never held again (its token is used once).
 */
async function newestReusable(
  dir: string,
  key: string,
  entries: DeliveryEntry[],
  textSha256: string,
): Promise<DeliveryEntry | undefined> {
  const candidates = entries
    .filter((entry) => entry.textSha256 === textSha256)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const entry of candidates) {
    if (entry.state === "admitted") continue;
    if (entry.state === "unknown") return entry;
    if (!(await isDeliveryLockHeld(deliveryAttemptLockName(dir, key, entry.owner.token))))
      return entry;
  }
  return undefined;
}

/**
 * Persist the input ID of one send before its API call. The attempt lock of
 * a new token is held first, then, in one locked change: the ID of the
 * newest reusable entry of the same text (see `newestReusable`), claimed
 * for this attempt (state `sending`, owner: this attempt), or a new entry
 * with the ID that `mint` gives. Throws `DeliveryLedgerError` when the ID
 * cannot be persisted (no lock on this platform, a busy lock, a corrupt
 * file, a full ledger, a failed write): then the caller sends nothing.
 */
export async function beginDelivery(options: {
  dir: string;
  key: string;
  textSha256: string;
  mint: () => string;
}): Promise<DeliveryAttempt> {
  const { dir, key, textSha256, mint } = options;
  const path = deliveryLedgerPath(dir, key);
  if (!SHA256_PATTERN.test(textSha256)) {
    throw new DeliveryLedgerError("the text hash is not a SHA-256 hex digest", path);
  }
  requireLockSupport(path);
  const token = randomUUID();
  let hold: DeliveryLock | null = null;
  try {
    mkdirSync(dir, { recursive: true });
    // Held before the claim is written: no process can see the claim of a
    // live attempt whose attempt lock is free.
    hold = await tryHoldDeliveryLock(deliveryAttemptLockName(dir, key, token));
    if (!hold) {
      throw new DeliveryLedgerError(
        `the attempt lock of a new token of the delivery ledger ${path} is held by another process`,
        path,
      );
    }
    const owner: DeliveryOwner = { pid: process.pid, token };
    const { inputId, reused } = await changeDeliveryLedger(dir, key, async (entries, now) => {
      const at = new Date(now).toISOString();
      const reusable = await newestReusable(dir, key, entries, textSha256);
      if (reusable) {
        return {
          entries: entries.map((entry) =>
            entry === reusable
              ? { ...entry, state: "sending" as const, owner, updatedAt: at }
              : entry,
          ),
          result: { inputId: reusable.inputId, reused: true },
        };
      }
      if (entries.length >= DELIVERY_LEDGER_MAX_ENTRIES) {
        throw new DeliveryLedgerError(
          `the delivery ledger ${path} holds ${entries.length} sends younger than ${DELIVERY_REUSE_MS / 60_000} min`,
          path,
        );
      }
      const minted = mint();
      if (typeof minted !== "string" || !INPUT_ID_PATTERN.test(minted)) {
        throw new DeliveryLedgerError(
          `the agent minted no valid input ID (${String(minted)})`,
          path,
        );
      }
      if (entries.some((entry) => entry.inputId === minted)) {
        throw new DeliveryLedgerError(`the minted input ID ${minted} is already in ${path}`, path);
      }
      const entry: DeliveryEntry = {
        inputId: minted,
        textSha256,
        createdAt: at,
        updatedAt: at,
        state: "sending",
        owner,
      };
      return { entries: [...entries, entry], result: { inputId: minted, reused: false } };
    });
    return { inputId, token, reused, hold };
  } catch (err) {
    hold?.release();
    if (err instanceof DeliveryLedgerError) throw err;
    throw new DeliveryLedgerError(`could not write the delivery ledger ${path}`, path, {
      cause: err,
    });
  }
}

/**
 * End one attempt. Never throws; returns true when the ledger records the
 * outcome. Only the entry of this attempt (its input ID and token) changes.
 *
 * - `admitted` (the send succeeded): mark the entry `admitted` (tried again
 *   after 200 ms and 1 s), release the attempt lock, then clear: any change
 *   removes `admitted` entries, so a failed clear leaves an entry that no
 *   send takes. When every mark fails, the entry stays `sending` and this
 *   process keeps the attempt lock for `DELIVERY_UNRECORDED_HOLD_MS`, so no
 *   send takes the ID while this process runs; the caller reports it.
 * - `unknown` (the admission is unknown): set the state, so a later send of
 *   the same text takes the ID. `none` (a definite refusal): remove the
 *   entry. The attempt lock is released in both cases, also when the write
 *   fails: the entry then stays `sending` with a free attempt lock, and a
 *   later send of the same text from any process takes the ID (B-3).
 */
export async function settleDelivery(options: {
  dir: string;
  key: string;
  attempt: DeliveryAttempt;
  outcome: "admitted" | "unknown" | "none";
}): Promise<boolean> {
  const { dir, key, attempt, outcome } = options;
  const mine = (entry: DeliveryEntry) =>
    entry.inputId === attempt.inputId && entry.owner.token === attempt.token;

  if (outcome !== "admitted") {
    try {
      await changeDeliveryLedger(
        dir,
        key,
        (entries, now) => ({
          entries:
            outcome === "none"
              ? entries.filter((entry) => !mine(entry))
              : entries.map((entry) =>
                  mine(entry)
                    ? {
                        ...entry,
                        state: "unknown" as const,
                        updatedAt: new Date(now).toISOString(),
                      }
                    : entry,
                ),
          result: undefined,
        }),
        { beforeUnlock: () => attempt.hold.release() },
      );
      return true;
    } catch {
      return false;
    } finally {
      attempt.hold.release();
    }
  }

  for (const delayMs of [0, ...MARK_RETRY_DELAYS_MS]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      await changeDeliveryLedger(
        dir,
        key,
        (entries, now) => ({
          entries: entries.map((entry) =>
            mine(entry)
              ? { ...entry, state: "admitted" as const, updatedAt: new Date(now).toISOString() }
              : entry,
          ),
          result: undefined,
        }),
        {
          beforeUnlock: (written) => {
            if (written) attempt.hold.release();
          },
        },
      );
    } catch {
      continue;
    }
    // The clear: the read of this change drops the `admitted` entry. A
    // failure leaves the mark, which no send takes; a later change or
    // `ao session cleanup` removes it.
    await changeDeliveryLedger(dir, key, (entries) => ({ entries, result: undefined })).catch(
      () => undefined,
    );
    return true;
  }
  setTimeout(() => attempt.hold.release(), DELIVERY_UNRECORDED_HOLD_MS).unref();
  return false;
}

/**
 * Remove the ledger of `key` (its agent session was removed). Runs under the
 * ledger lock, and removes also a corrupt file, which no send can use any
 * more. No file is no error.
 *
 * The wait for the lock can make a check of the caller stale. When the
 * caller gives `stillRemovable`, it runs after the lock is held, directly
 * before the removal; when it answers false, the file stays and the result
 * is `"kept"`. Without it, the removal is as before.
 */
export async function removeDeliveryLedger(
  dir: string,
  key: string,
  stillRemovable?: () => boolean,
): Promise<"kept" | undefined> {
  const path = deliveryLedgerPath(dir, key);
  if (!existsSync(path)) return undefined;
  requireLockSupport(path);
  const lockName = deliveryLedgerLockName(dir, key);
  const lock = await holdDeliveryLock(lockName, DELIVERY_LOCK_WAIT_MS);
  if (!lock) throw new DeliveryLedgerBusyError(path, lockName);
  try {
    if (stillRemovable && !stillRemovable()) return "kept";
    rmSync(path, { force: true });
    return undefined;
  } finally {
    lock.release();
  }
}

/** What `removeExpiredDeliveryLedgers` did. */
export interface ExpiredLedgerSweep {
  removed: string[];
  failed: Array<{ path: string; error: string }>;
}

/**
 * Remove each ledger in `dir` that has no live entry (every entry is
 * `admitted` or older than `DELIVERY_REUSE_MS`) and whose lock no process
 * holds now (no wait: a held lock is a change in progress), and the temp
 * files of a failed write that are older than `DELIVERY_REUSE_MS`. A corrupt
 * ledger stays: an operator decides about it. Never throws.
 */
export async function removeExpiredDeliveryLedgers(
  dir: string,
  now: number = Date.now(),
): Promise<ExpiredLedgerSweep> {
  const sweep: ExpiredLedgerSweep = { removed: [], failed: [] };
  if (!isDeliveryLockSupported()) return sweep;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return sweep;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (TEMP_FILE_PATTERN.test(name)) {
        if (now - statSync(path).mtimeMs >= DELIVERY_REUSE_MS) {
          rmSync(path, { force: true });
          sweep.removed.push(path);
        }
        continue;
      }
      const key = name.endsWith(".json") ? name.slice(0, -".json".length) : "";
      if (!KEY_PATTERN.test(key)) continue;
      const lock = await tryHoldDeliveryLock(deliveryLedgerLockName(dir, key));
      if (!lock) continue;
      try {
        let entries: DeliveryEntry[];
        try {
          entries = readDeliveryLedger(dir, key);
        } catch (err) {
          if (err instanceof DeliveryLedgerCorruptError) continue;
          throw err;
        }
        if (entries.some((entry) => isLive(entry, now))) continue;
        rmSync(path, { force: true });
        sweep.removed.push(path);
      } finally {
        lock.release();
      }
    } catch (err) {
      sweep.failed.push({ path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return sweep;
}
