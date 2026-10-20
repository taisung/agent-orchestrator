/**
 * I-5 round 3 (B-2, M-2, M-3): the delivery ledger.
 *
 * One JSON file per agent session key (OpenCode: the stored `ses_...` ID)
 * in the project state directory (`getDeliveryLedgerDir`). Each entry is one
 * logical send that called `beginDelivery` and did not end yet, or whose
 * admission stayed unknown: its input ID, the SHA-256 of its text, its owner
 * (PID, process start time and attempt token) and its state. The file is
 * apart from the session record, so a record write (`updateMetadata`), a
 * kill, the archive and a restore do not touch it.
 *
 * - Every read-change-write runs under a lock file (`<ledger>.lock`) that is
 *   created exclusively (a temp file and `link`, as `reserveSessionId` does)
 *   and holds the owner PID, start time and a token. The lock covers only
 *   the ledger change, never the agent's API call.
 * - A lock of a dead owner is broken through a claim file named after the
 *   stale token, created exclusively: only the claim holder removes the lock,
 *   and only after it reads the same token again, so two waiters cannot both
 *   take it. A lock of a live owner makes the caller wait for at most
 *   `DELIVERY_LOCK_WAIT_MS`.
 * - The ledger is written with `atomicWriteFileSync` (a temp file and a
 *   rename). A file that does not parse, or that holds an invalid entry,
 *   fails closed: it is never overwritten and never read as empty.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { atomicWriteFileSync } from "./atomic-write.js";

/**
 * A later send of the same text reuses the ID of an entry that changed less
 * than this long ago. The lifecycle polls every 30 s and one slow send takes
 * about 1 to 2 min, so a retry of the same dispatch comes well inside it; so
 * does a human who reads the error and sends again. Each claim and each
 * settle moves `updatedAt`, so a chain of retries keeps its ID.
 */
export const DELIVERY_REUSE_MS = 10 * 60_000;

/**
 * How long a caller waits for a lock of a live owner. A holder keeps the
 * lock only for one read, one JSON change and one temp-file write and
 * rename of a small file (milliseconds), so 2 s is far above a normal hold
 * and still short for a CLI user and a 30 s lifecycle poll. After it the
 * caller fails before the prompt, so nothing is sent.
 */
export const DELIVERY_LOCK_WAIT_MS = 2_000;

const DELIVERY_LOCK_POLL_MS = 15;

/**
 * At most this many entries younger than `DELIVERY_REUSE_MS` per ledger. A
 * new send beyond it fails (nothing is sent), so no unresolved ID is ever
 * dropped to make room.
 */
export const DELIVERY_LEDGER_MAX_ENTRIES = 200;

/** After a success, the clear is tried again after these waits (item 4). */
const CLEAR_RETRY_DELAYS_MS = [200, 1_000];

const LEDGER_VERSION = 1;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const INPUT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const START_TIME_PATTERN = /^\d+$/;

export type DeliveryState = "sending" | "unknown";

/** The process that owns an entry or a lock. */
export interface DeliveryOwner {
  pid: number;
  /** Field 22 of `/proc/<pid>/stat` (clock ticks after boot), or null when unreadable. */
  startTime: string | null;
  /** The attempt token (entry) or the lock token (lock). */
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
  /** `sending` while an attempt runs; `unknown` after an admission that stayed unknown. */
  state: DeliveryState;
  owner: DeliveryOwner;
}

interface LockContent extends DeliveryOwner {
  at: string;
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

/** A live owner held the lock for longer than `DELIVERY_LOCK_WAIT_MS`. */
export class DeliveryLedgerBusyError extends DeliveryLedgerError {
  constructor(lockPath: string, detail: string) {
    super(
      `the delivery ledger lock ${lockPath} is held (${detail}) for more than ${DELIVERY_LOCK_WAIT_MS} ms`,
      lockPath,
    );
    this.name = "DeliveryLedgerBusyError";
  }
}

// ---------------------------------------------------------------------------
// Process identity and owner liveness
// ---------------------------------------------------------------------------

/** Attempt tokens of this process between `beginDelivery` and its settle. */
const inFlight = new Set<string>();
/** Attempt tokens of this process whose send succeeded but whose clear failed. */
const admittedNotCleared = new Set<string>();
/** Lock tokens that this process holds now. */
const heldLocks = new Set<string>();

let selfStart: string | null | undefined;

/**
 * Field 22 (starttime) of `/proc/<pid>/stat`, or null when it cannot be
 * read (no such process, no `/proc`, EACCES). Only `kill(pid, 0)` decides
 * whether a process is gone: a host without `/proc` also gives ENOENT here.
 */
export function readProcessStartTime(pid: number): string | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
  } catch {
    return null;
  }
  // The `(comm)` field can hold spaces and parentheses.
  const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  return start !== undefined && START_TIME_PATTERN.test(start) ? start : null;
}

function selfStartTime(): string | null {
  if (selfStart === undefined) selfStart = readProcessStartTime(process.pid);
  return selfStart;
}

/** `kill(pid, 0)`: false when the PID is gone (ESRCH) or belongs to another user (EPERM). */
function pidRunsAsThisUser(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== "ESRCH" && code !== "EPERM";
  }
}

/**
 * Whether the process that wrote `owner` still runs. Dead: the PID is gone
 * (ESRCH), it belongs to another user now (EPERM: the owner was a process of
 * this user), or it runs with another start time (the PID was reused). When
 * the start time cannot be read, the owner counts as alive: an entry of a
 * live owner must never be reused (that would turn a concurrent send into a
 * replay that admits nothing), so the unreadable case takes the direction
 * that can only give a new ID.
 */
export function isDeliveryOwnerAlive(owner: { pid: number; startTime: string | null }): boolean {
  if (owner.pid === process.pid) {
    const own = selfStartTime();
    return owner.startTime === null || own === null || owner.startTime === own;
  }
  if (!pidRunsAsThisUser(owner.pid)) return false;
  if (owner.startTime === null) return true;
  const now = readProcessStartTime(owner.pid);
  // Unreadable: the process may have ended just now; ask again, else alive.
  if (now === null) return pidRunsAsThisUser(owner.pid);
  return now === owner.startTime;
}

/** True when the owner is this process (the same PID and start time). */
function isSelf(owner: DeliveryOwner): boolean {
  if (owner.pid !== process.pid) return false;
  const own = selfStartTime();
  return owner.startTime === null || own === null || owner.startTime === own;
}

/**
 * Whether a later send of the same text may take this entry's ID: the
 * admission is `unknown`; or the attempt is `sending` and its owner is dead;
 * or its owner is this process and the attempt is not in flight (its write
 * of `unknown` failed). A clear that failed after a success is never taken
 * by this process again.
 */
function isReusable(entry: DeliveryEntry): boolean {
  if (entry.state === "unknown") return true;
  if (isSelf(entry.owner)) {
    return !inFlight.has(entry.owner.token) && !admittedNotCleared.has(entry.owner.token);
  }
  return !isDeliveryOwnerAlive(entry.owner);
}

// ---------------------------------------------------------------------------
// The lock
// ---------------------------------------------------------------------------

/** Create `path` with `content` only when it does not exist (a temp file, then `link`). */
function createExclusive(path: string, content: string): boolean {
  const temp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`);
  const fd = openSync(temp, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, content, "utf-8");
    } finally {
      closeSync(fd);
    }
    linkSync(temp, path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    rmSync(temp, { force: true });
  }
}

function isOwner(value: unknown): value is DeliveryOwner {
  if (typeof value !== "object" || value === null) return false;
  const owner = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(owner["pid"]) &&
    (owner["pid"] as number) > 0 &&
    (owner["startTime"] === null ||
      (typeof owner["startTime"] === "string" && START_TIME_PATTERN.test(owner["startTime"]))) &&
    typeof owner["token"] === "string" &&
    TOKEN_PATTERN.test(owner["token"])
  );
}

function readLock(path: string): LockContent | "absent" | "invalid" {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    return "invalid";
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isOwner(parsed) ? (parsed as LockContent) : "invalid";
  } catch {
    return "invalid";
  }
}

function isStaleLock(lock: LockContent): boolean {
  if (isSelf(lock)) return !heldLocks.has(lock.token);
  return !isDeliveryOwnerAlive(lock);
}

/**
 * Break the stale lock `stale` through the claim file `<lock>.break-<token>`.
 * Only one process can create the claim; it removes the lock only when the
 * lock still holds the stale token. No process other than the claim holder
 * removes a lock of a dead owner, and a removed token never comes back, so
 * a waiter that read the stale token long ago cannot remove a newer lock.
 */
function breakStaleLock(lockPath: string, stale: LockContent, claimContent: string): boolean {
  const claim = `${lockPath}.break-${stale.token}`;
  if (!createExclusive(claim, claimContent)) return false;
  try {
    const again = readLock(lockPath);
    if (again !== "absent" && again !== "invalid" && again.token === stale.token) {
      unlinkSync(lockPath);
    }
    return true;
  } finally {
    rmSync(claim, { force: true });
  }
}

function describeHolder(lockPath: string, holder: LockContent | "invalid" | undefined): string {
  if (holder === undefined) return "by an unknown process";
  if (holder === "invalid")
    return `by a lock file that ao cannot read; remove ${lockPath} if no ao process runs`;
  const alive = isDeliveryOwnerAlive(holder);
  return alive
    ? `by the live process ${holder.pid} since ${holder.at}`
    : `by the dead process ${holder.pid}, and another process is breaking it; remove ${lockPath} and ${lockPath}.break-${holder.token} if no ao process runs`;
}

async function acquireLock(lockPath: string): Promise<string> {
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const content = JSON.stringify({
    pid: process.pid,
    startTime: selfStartTime(),
    token,
    at: new Date().toISOString(),
  } satisfies LockContent);
  const deadline = Date.now() + DELIVERY_LOCK_WAIT_MS;
  let holder: LockContent | "invalid" | undefined;
  for (;;) {
    if (createExclusive(lockPath, content)) {
      heldLocks.add(token);
      return token;
    }
    const current = readLock(lockPath);
    if (current === "absent") {
      // The holder released it between the create and the read: try again
      // at once, but never past the bound.
      if (Date.now() >= deadline) {
        throw new DeliveryLedgerBusyError(lockPath, describeHolder(lockPath, holder));
      }
      continue;
    }
    holder = current;
    if (
      current !== "invalid" &&
      isStaleLock(current) &&
      breakStaleLock(lockPath, current, content)
    ) {
      continue;
    }
    if (Date.now() >= deadline)
      throw new DeliveryLedgerBusyError(lockPath, describeHolder(lockPath, holder));
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        DELIVERY_LOCK_POLL_MS + Math.floor(Math.random() * DELIVERY_LOCK_POLL_MS),
      ),
    );
  }
}

function releaseLock(lockPath: string, token: string): void {
  heldLocks.delete(token);
  const current = readLock(lockPath);
  if (current !== "absent" && current !== "invalid" && current.token === token) {
    unlinkSync(lockPath);
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
  if (entry["state"] !== "sending" && entry["state"] !== "unknown") {
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
 * file, remove entries older than `DELIVERY_REUSE_MS`, change, and write
 * (or remove the file when it is empty). A corrupt file throws before any
 * change, and the file stays as it is. `change` runs synchronously while
 * the lock is held.
 */
export async function changeDeliveryLedger<T>(
  dir: string,
  key: string,
  change: (entries: DeliveryEntry[], now: number) => { entries: DeliveryEntry[]; result: T },
): Promise<T> {
  const path = deliveryLedgerPath(dir, key);
  const lockPath = `${path}.lock`;
  const lockToken = await acquireLock(lockPath);
  try {
    const now = Date.now();
    const current = readDeliveryLedger(dir, key).filter(
      (entry) => now - Date.parse(entry.updatedAt) < DELIVERY_REUSE_MS,
    );
    const { entries, result } = change(current, now);
    writeDeliveryLedger(path, key, entries);
    return result;
  } finally {
    releaseLock(lockPath, lockToken);
  }
}

// ---------------------------------------------------------------------------
// The send protocol
// ---------------------------------------------------------------------------

export interface DeliveryAttempt {
  /** The input ID to send. */
  inputId: string;
  /** The attempt token of this process, for `settleDelivery`. */
  token: string;
  /** True when the ID is the one of an earlier attempt of the same text. */
  reused: boolean;
}

/**
 * Persist the input ID of one send before its API call: take the ID of the
 * newest reusable entry of the same text hash (see `isReusable`), and claim
 * it in the same locked change (owner: this attempt, state `sending`), or
 * add a new entry with the ID that `mint` gives. Throws `DeliveryLedgerError`
 * when the ID cannot be persisted (busy lock, corrupt file, a full ledger, a
 * failed write): then the caller sends nothing.
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
  const token = randomUUID();
  const owner: DeliveryOwner = { pid: process.pid, startTime: selfStartTime(), token };
  try {
    return await changeDeliveryLedger<DeliveryAttempt>(dir, key, (entries, now) => {
      const at = new Date(now).toISOString();
      const reusable = entries
        .filter((entry) => entry.textSha256 === textSha256 && isReusable(entry))
        .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
        .at(-1);
      // The token is in flight before the write, so no other send of this
      // process can take the entry between the write and the return.
      inFlight.add(token);
      if (reusable) {
        return {
          entries: entries.map((entry) =>
            entry === reusable
              ? { ...entry, state: "sending" as const, owner, updatedAt: at }
              : entry,
          ),
          result: { inputId: reusable.inputId, token, reused: true },
        };
      }
      if (entries.length >= DELIVERY_LEDGER_MAX_ENTRIES) {
        throw new DeliveryLedgerError(
          `the delivery ledger ${path} holds ${entries.length} sends younger than ${DELIVERY_REUSE_MS / 60_000} min`,
          path,
        );
      }
      const inputId = mint();
      if (typeof inputId !== "string" || !INPUT_ID_PATTERN.test(inputId)) {
        throw new DeliveryLedgerError(
          `the agent minted no valid input ID (${String(inputId)})`,
          path,
        );
      }
      if (entries.some((entry) => entry.inputId === inputId)) {
        throw new DeliveryLedgerError(`the minted input ID ${inputId} is already in ${path}`, path);
      }
      const entry: DeliveryEntry = {
        inputId,
        textSha256,
        createdAt: at,
        updatedAt: at,
        state: "sending",
        owner,
      };
      return { entries: [...entries, entry], result: { inputId, token, reused: false } };
    });
  } catch (err) {
    inFlight.delete(token);
    if (err instanceof DeliveryLedgerError) throw err;
    throw new DeliveryLedgerError(`could not write the delivery ledger ${path}`, path, {
      cause: err,
    });
  }
}

/**
 * End one attempt. `clear` (the send succeeded, or the service refused it):
 * remove the entry; the clear is tried again after a short wait, and when it
 * still fails this process never takes the entry again, while another
 * process can take it only after this one ends (a later equal send then
 * becomes a replay that admits nothing). `unknown`: set the state, so a
 * later send of the same text takes the ID. Only an entry that this attempt
 * owns changes. Never throws; returns false when the write failed.
 */
export async function settleDelivery(options: {
  dir: string;
  key: string;
  attempt: DeliveryAttempt;
  outcome: "clear" | "unknown";
}): Promise<boolean> {
  const { dir, key, attempt, outcome } = options;
  const mine = (entry: DeliveryEntry) =>
    entry.inputId === attempt.inputId && entry.owner.token === attempt.token;
  const delays = outcome === "clear" ? [0, ...CLEAR_RETRY_DELAYS_MS] : [0];
  try {
    for (const delayMs of delays) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        await changeDeliveryLedger(dir, key, (entries, now) => ({
          entries:
            outcome === "clear"
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
        }));
        return true;
      } catch {
        // Try again (clear only); see the doc comment for what stays.
      }
    }
    if (outcome === "clear") admittedNotCleared.add(attempt.token);
    return false;
  } finally {
    inFlight.delete(attempt.token);
  }
}

/**
 * Remove the ledger of `key` (its agent session was removed). Runs under the
 * lock, and removes also a corrupt file, which no send can use any more.
 */
export async function removeDeliveryLedger(dir: string, key: string): Promise<void> {
  const path = deliveryLedgerPath(dir, key);
  const lockPath = `${path}.lock`;
  const lockToken = await acquireLock(lockPath);
  try {
    rmSync(path, { force: true });
  } finally {
    releaseLock(lockPath, lockToken);
  }
}
