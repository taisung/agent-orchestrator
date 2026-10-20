/**
 * Flat-file metadata read/write.
 *
 * Architecture:
 * - Session metadata stored in project-specific directories
 * - Path: ~/.agent-orchestrator/{hash}-{projectId}/sessions/{sessionName}
 * - Session files use user-facing names (int-1) not tmux names (a3b4c5d6e7f8-int-1)
 * - Metadata includes tmuxName field to map user-facing → tmux name
 *
 * Format: key=value pairs (one per line), compatible with bash scripts
 *
 * Example file contents:
 *   project=integrator
 *   worktree=/Users/foo/.agent-orchestrator/a3b4c5d6e7f8-integrator/worktrees/int-1
 *   branch=feat/INT-1234
 *   status=working
 *   tmuxName=a3b4c5d6e7f8-int-1
 *   pr=https://github.com/org/repo/pull/42
 *   issue=INT-1234
 *   generation=7
 *
 * Writes (killed-status round 3, B-2): every writer in this file holds the
 * record lock (below) for its read, compare, write and rename, and
 * every write increments `generation`, so a reader can tell that any Node
 * writer changed the record after its read (`updateMetadataIf`). Reads take
 * no lock: the atomic rename always gives a whole file. The bash metadata
 * helpers (`~/.ao/bin/ao-metadata-helper.sh`, the claude-code PostToolUse
 * hook) write `pr`, `status` and `branch` with `sed` and `mv`, outside the
 * lock and without a new generation; a Node write and a helper write can
 * still overwrite each other between the read and the rename of either. On
 * a platform without the lock (not Linux) the writers run unlocked.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
  openSync,
  closeSync,
  linkSync,
  rmSync,
  realpathSync,
  constants,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import type { SessionId, SessionMetadata } from "./types.js";
import { atomicWriteFileSync } from "./atomic-write.js";
import { parseKeyValueContent } from "./key-value.js";
import { deliveryLockName, isDeliveryLockSupported, printableLockName } from "./delivery-lock.js";

// ---------------------------------------------------------------------------
// The record lock (killed-status round 3, B-2)
// ---------------------------------------------------------------------------
//
// The lock of one session record. Every writer in this file holds it for its
// read, compare, write and rename, so no other writer can change the record
// between its read and its rename.
//
// It uses the method of the I-5 delivery lock (delivery-lock.ts): a Linux
// abstract Unix socket, name kind "record", subject the real path of the
// record. The kernel frees the name when the process ends in any way (also
// `kill -9`), so no lock state can stay on disk after a crash.
//
// The record writers are synchronous, but Node binds a socket only
// asynchronously. So a helper worker thread binds and closes the sockets,
// and the writer waits for its answer with `Atomics.wait`. The socket belongs
// to this process. The writer holds the lock only inside its synchronous
// section, so nothing else of its thread runs while it holds it: no probe, no
// tmux call and no network call.
//
// On a platform without abstract sockets (`isDeliveryLockSupported` false,
// for example macOS) a writer writes without the lock, as before.

/** How long a writer waits for a record lock that another process holds. */
export const RECORD_LOCK_WAIT_MS = 5_000;

/** Extra wait for the first answer of a helper that is still starting. */
const LOCK_HELPER_START_MS = 5_000;

// Index 0 of the shared state is the answer slot: the request sequence
// number times 8 plus a status, so a late answer of an older request can
// never match a newer one. Index 1 holds the sequence number whose error
// text is in the text buffer, index 2 the length of that text.
const LOCK_PENDING = 0;
const LOCK_HELD = 1;
const LOCK_BUSY = 2;
const LOCK_FAILED = 3;
const LOCK_ABANDONED = 4;

const LOCK_ERROR_TEXT_BYTES = 512;

/**
 * The helper thread. It binds a name on a "hold" request (and tries again
 * every 2 to 5 ms while another socket holds it, until the wait ends), and
 * closes the socket on a "release" request. An answer counts only while the
 * slot still waits for this request; a late success of an abandoned request
 * closes its socket at once.
 */
const LOCK_HELPER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { createServer } = require("node:net");
const state = new Int32Array(workerData.state);
const errorText = new Uint8Array(workerData.errorText);
const held = new Map();
function answer(seq, result, text) {
  const pending = seq * 8 + ${LOCK_PENDING};
  if (Atomics.load(state, 0) !== pending) return false;
  if (text) {
    const bytes = Buffer.from(text, "utf-8").subarray(0, errorText.length);
    errorText.set(bytes);
    Atomics.store(state, 2, bytes.length);
    Atomics.store(state, 1, seq);
  }
  if (Atomics.compareExchange(state, 0, pending, seq * 8 + result) !== pending) return false;
  Atomics.notify(state, 0);
  return true;
}
function hold(msg) {
  const deadline = Date.now() + msg.waitMs;
  const attempt = () => {
    const server = createServer((socket) => socket.destroy());
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE" && Date.now() < deadline) {
        setTimeout(attempt, 2 + Math.floor(Math.random() * 4));
      } else if (err.code === "EADDRINUSE") {
        answer(msg.seq, ${LOCK_BUSY});
      } else {
        answer(msg.seq, ${LOCK_FAILED}, String(err.code || "") + " " + err.message);
      }
    });
    server.listen({ path: msg.name, exclusive: true }, () => {
      server.on("error", () => {});
      if (answer(msg.seq, ${LOCK_HELD})) held.set(msg.name, server);
      else server.close();
    });
  };
  attempt();
}
parentPort.on("message", (msg) => {
  if (msg.op === "hold") return hold(msg);
  const server = held.get(msg.name);
  held.delete(msg.name);
  if (server) server.close();
});
`;

interface LockHelper {
  worker: Worker;
  state: Int32Array;
  errorText: Uint8Array;
  seq: number;
}

let lockHelper: LockHelper | null = null;
/** Names that this thread holds, with the depth of nested holds. */
const heldRecordLocks = new Map<string, number>();

function getLockHelper(): LockHelper {
  if (lockHelper) return lockHelper;
  const state = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT);
  const errorText = new SharedArrayBuffer(LOCK_ERROR_TEXT_BYTES);
  const worker = new Worker(LOCK_HELPER_SOURCE, { eval: true, workerData: { state, errorText } });
  // The helper never keeps the process alive.
  worker.unref();
  const created: LockHelper = {
    worker,
    state: new Int32Array(state),
    errorText: new Uint8Array(errorText),
    seq: 0,
  };
  const forget = () => {
    if (lockHelper === created) lockHelper = null;
  };
  worker.on("error", forget);
  worker.on("exit", forget);
  lockHelper = created;
  return created;
}

/** The lock name of a record: the real path of its directory plus its ID. */
export function recordLockName(dataDir: string, sessionId: string): string {
  let dir: string;
  try {
    dir = realpathSync(dataDir);
  } catch {
    dir = resolve(dataDir);
  }
  return deliveryLockName("record", join(dir, sessionId));
}

function acquireRecordLock(name: string): void {
  const h = getLockHelper();
  h.seq = (h.seq % 0x0fffffff) + 1;
  const seq = h.seq;
  const pending = seq * 8 + LOCK_PENDING;
  Atomics.store(h.state, 0, pending);
  h.worker.postMessage({ op: "hold", name, seq, waitMs: RECORD_LOCK_WAIT_MS });

  const deadline = Date.now() + RECORD_LOCK_WAIT_MS + LOCK_HELPER_START_MS;
  let slot = Atomics.load(h.state, 0);
  while (slot === pending) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    Atomics.wait(h.state, 0, pending, left);
    slot = Atomics.load(h.state, 0);
  }
  if (slot === pending) {
    // Give up; a later success of this request closes its socket at once.
    slot = Atomics.compareExchange(h.state, 0, pending, seq * 8 + LOCK_ABANDONED);
  }
  const result = slot - seq * 8;
  if (result === LOCK_HELD) return;
  const printable = printableLockName(name);
  if (result === LOCK_BUSY) {
    throw new Error(
      `Record lock ${printable} is held by another process for more than ${RECORD_LOCK_WAIT_MS} ms`,
    );
  }
  if (result === LOCK_FAILED) {
    const text =
      Atomics.load(h.state, 1) === seq
        ? Buffer.from(h.errorText.subarray(0, Atomics.load(h.state, 2))).toString("utf-8")
        : "unknown error";
    throw new Error(`Could not take record lock ${printable}: ${text}`);
  }
  throw new Error(`Record lock ${printable}: no answer from the lock helper thread`);
}

function releaseRecordLock(name: string): void {
  lockHelper?.worker.postMessage({ op: "release", name });
}

/**
 * Run `fn` (synchronous) while this process holds the lock of the record
 * `sessionId` in `dataDir`. A nested call for the same record in the same
 * thread runs inside the outer hold. Throws when another process holds the
 * lock for more than RECORD_LOCK_WAIT_MS; `fn` does not run then.
 */
export function withRecordLock<T>(dataDir: string, sessionId: string, fn: () => T): T {
  if (!isDeliveryLockSupported()) return fn();
  const name = recordLockName(dataDir, sessionId);
  const depth = heldRecordLocks.get(name) ?? 0;
  if (depth === 0) acquireRecordLock(name);
  heldRecordLocks.set(name, depth + 1);
  try {
    return fn();
  } finally {
    const left = (heldRecordLocks.get(name) ?? 1) - 1;
    if (left > 0) {
      heldRecordLocks.set(name, left);
    } else {
      heldRecordLocks.delete(name);
      releaseRecordLock(name);
    }
  }
}

/** The record key that every locked write increments. */
export const GENERATION_KEY = "generation";

/**
 * Serialize a record back to key=value format.
 *
 * Newlines in values are collapsed to spaces. The format is line-delimited and
 * `parseKeyValueContent` treats every line as a fresh `key=value` pair, so an
 * unescaped newline in agent-supplied text (`summary`, `pinnedSummary`) would
 * inject arbitrary metadata keys — e.g. a summary containing "\nstatus=merged"
 * would rewrite the session's status on the next read.
 */
function serializeMetadata(data: Record<string, string>): string {
  return (
    Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, " ")}`)
      .join("\n") + "\n"
  );
}

/** Validate sessionId to prevent path traversal. */
const VALID_SESSION_ID = /^[a-zA-Z0-9_-]+$/;

function validateSessionId(sessionId: SessionId): void {
  if (!VALID_SESSION_ID.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
}

/** Get the metadata file path for a session. */
function metadataPath(dataDir: string, sessionId: SessionId): string {
  validateSessionId(sessionId);
  return join(dataDir, sessionId);
}

/**
 * Read metadata for a session. Returns null if the file doesn't exist.
 */
export function readMetadata(dataDir: string, sessionId: SessionId): SessionMetadata | null {
  const path = metadataPath(dataDir, sessionId);
  if (!existsSync(path)) return null;

  const content = readFileSync(path, "utf-8");
  const raw = parseKeyValueContent(content);

  return {
    worktree: raw["worktree"] ?? "",
    branch: raw["branch"] ?? "",
    status: raw["status"] ?? "unknown",
    tmuxName: raw["tmuxName"],
    issue: raw["issue"],
    pr: raw["pr"],
    prAutoDetect:
      raw["prAutoDetect"] === "off" ? "off" : raw["prAutoDetect"] === "on" ? "on" : undefined,
    summary: raw["summary"],
    project: raw["project"],
    agent: raw["agent"],
    model: raw["model"],
    permissions: raw["permissions"],
    createdAt: raw["createdAt"],
    runtimeHandle: raw["runtimeHandle"],
    restoredAt: raw["restoredAt"],
    role: raw["role"],
    dashboardPort: raw["dashboardPort"] ? Number(raw["dashboardPort"]) : undefined,
    terminalWsPort: raw["terminalWsPort"] ? Number(raw["terminalWsPort"]) : undefined,
    directTerminalWsPort: raw["directTerminalWsPort"]
      ? Number(raw["directTerminalWsPort"])
      : undefined,
    opencodeSessionId: raw["opencodeSessionId"],
    pinnedSummary: raw["pinnedSummary"],
  };
}

/**
 * Read raw metadata as a string record (for arbitrary keys).
 */
export function readMetadataRaw(
  dataDir: string,
  sessionId: SessionId,
): Record<string, string> | null {
  const path = metadataPath(dataDir, sessionId);
  if (!existsSync(path)) return null;
  return parseKeyValueContent(readFileSync(path, "utf-8"));
}

/**
 * Write full metadata for a session (overwrites existing file).
 */
export function writeMetadata(
  dataDir: string,
  sessionId: SessionId,
  metadata: SessionMetadata,
): void {
  const path = metadataPath(dataDir, sessionId);
  mkdirSync(dirname(path), { recursive: true });

  const data: Record<string, string> = {
    worktree: metadata.worktree,
    branch: metadata.branch,
    status: metadata.status,
  };

  if (metadata.tmuxName) data["tmuxName"] = metadata.tmuxName;
  if (metadata.issue) data["issue"] = metadata.issue;
  if (metadata.pr) data["pr"] = metadata.pr;
  if (metadata.prAutoDetect) data["prAutoDetect"] = metadata.prAutoDetect;
  if (metadata.summary) data["summary"] = metadata.summary;
  if (metadata.project) data["project"] = metadata.project;
  if (metadata.agent) data["agent"] = metadata.agent;
  if (metadata.model) data["model"] = metadata.model;
  if (metadata.permissions) data["permissions"] = metadata.permissions;
  if (metadata.createdAt) data["createdAt"] = metadata.createdAt;
  if (metadata.runtimeHandle) data["runtimeHandle"] = metadata.runtimeHandle;
  if (metadata.restoredAt) data["restoredAt"] = metadata.restoredAt;
  if (metadata.role) data["role"] = metadata.role;
  if (metadata.dashboardPort !== undefined) data["dashboardPort"] = String(metadata.dashboardPort);
  if (metadata.terminalWsPort !== undefined)
    data["terminalWsPort"] = String(metadata.terminalWsPort);
  if (metadata.directTerminalWsPort !== undefined)
    data["directTerminalWsPort"] = String(metadata.directTerminalWsPort);
  if (metadata.opencodeSessionId) data["opencodeSessionId"] = metadata.opencodeSessionId;
  if (metadata.pinnedSummary) data["pinnedSummary"] = metadata.pinnedSummary;

  withRecordLock(dataDir, sessionId, () => {
    commitRecord(dataDir, sessionId, path, readRecordFile(path), data);
  });
}

/** The record's generation; 0 when it has none (a record written before the key). */
function generationOf(record: Readonly<Record<string, string>> | null): number {
  const value = Number.parseInt(record?.[GENERATION_KEY] ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Read a record file; null when it does not exist. */
function readRecordFile(path: string): Record<string, string> | null {
  try {
    return parseKeyValueContent(readFileSync(path, "utf-8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Merge `updates` into a record: an empty value removes the key. A
 * `killedReason` describes a killed status only, so a record whose status is
 * not killed after the merge loses it, whoever writes.
 */
function mergeUpdates(
  existing: Readonly<Record<string, string>>,
  updates: Partial<Record<string, string>>,
): Record<string, string> {
  let next: Record<string, string> = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === "") {
      const { [key]: _, ...rest } = next;
      next = rest;
    } else {
      next[key] = value;
    }
  }
  if (next["status"] !== "killed" && "killedReason" in next) {
    const { killedReason: _, ...rest } = next;
    next = rest;
  }
  return next;
}

/**
 * Write `next` as the record with the next generation (call it under the
 * record lock). A record without a generation (a new record, an empty
 * reservation, a record from before the key) continues from its latest
 * archived copy, so an archive followed by a copy-back or a new record with
 * the same ID never repeats a generation that a reader saw before.
 */
function commitRecord(
  dataDir: string,
  sessionId: SessionId,
  path: string,
  existing: Readonly<Record<string, string>> | null,
  next: Record<string, string>,
): Record<string, string> {
  const base = generationOf(existing) || generationOf(readArchivedMetadataRaw(dataDir, sessionId));
  const written = { ...next, [GENERATION_KEY]: String(base + 1) };
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, serializeMetadata(written));
  return written;
}

/**
 * Update specific fields in a session's metadata.
 * Reads existing file, merges updates, writes back (under the record lock,
 * with the next generation). Creates the record when it does not exist.
 */
export function updateMetadata(
  dataDir: string,
  sessionId: SessionId,
  updates: Partial<Record<string, string>>,
): void {
  const path = metadataPath(dataDir, sessionId);
  // The lock name uses the real path of the directory, so it must exist first.
  mkdirSync(dataDir, { recursive: true });
  withRecordLock(dataDir, sessionId, () => {
    const existing = readRecordFile(path);
    commitRecord(dataDir, sessionId, path, existing, mergeUpdates(existing ?? {}, updates));
  });
}

/**
 * Compare-and-set update: merge `updates` only when the record still holds
 * every value in `expected`. A missing key and an empty value are equal (the
 * file never holds an empty value). The read, the compare and the rename run
 * under the record lock, so no other Node writer can change the record
 * between them; expect `generation` to detect any Node write after your own
 * read. Returns the written record, or null and writes nothing when the
 * record is gone (never recreated) or a value differs.
 */
export function updateMetadataIf(
  dataDir: string,
  sessionId: SessionId,
  expected: Readonly<Record<string, string | undefined>>,
  updates: Partial<Record<string, string>>,
): Record<string, string> | null {
  const path = metadataPath(dataDir, sessionId);
  return withRecordLock(dataDir, sessionId, () => {
    const existing = readRecordFile(path);
    if (!existing) return null;
    for (const [key, value] of Object.entries(expected)) {
      if ((existing[key] ?? "") !== (value ?? "")) return null;
    }
    return commitRecord(dataDir, sessionId, path, existing, mergeUpdates(existing, updates));
  });
}

/**
 * Delete a session's metadata file.
 * Optionally archive it to an `archive/` subdirectory. The copy and the
 * unlink run under the record lock.
 */
export function deleteMetadata(dataDir: string, sessionId: SessionId, archive = true): void {
  const path = metadataPath(dataDir, sessionId);
  if (!existsSync(dataDir)) return;
  withRecordLock(dataDir, sessionId, () => {
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }

    if (archive) {
      const archiveDir = join(dataDir, "archive");
      mkdirSync(archiveDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archivePath = join(archiveDir, `${sessionId}_${timestamp}`);
      writeFileSync(archivePath, content);
    }

    unlinkSync(path);
  });
}

/**
 * Read the latest archived metadata for a session.
 * Archive files are named `<sessionId>_<ISO-timestamp>` inside `<dataDir>/archive/`.
 * Returns null if no archived metadata exists.
 */
export function readArchivedMetadataRaw(
  dataDir: string,
  sessionId: SessionId,
): Record<string, string> | null {
  validateSessionId(sessionId);
  const archiveDir = join(dataDir, "archive");
  if (!existsSync(archiveDir)) return null;

  const prefix = `${sessionId}_`;
  let latest: string | null = null;

  for (const file of readdirSync(archiveDir)) {
    if (!file.startsWith(prefix)) continue;
    // Verify the separator is followed by a digit (start of ISO timestamp)
    // to avoid prefix collisions (e.g., "app" matching "app_v2_...")
    const charAfterPrefix = file[prefix.length];
    if (!charAfterPrefix || charAfterPrefix < "0" || charAfterPrefix > "9") continue;
    // Pick lexicographically last (ISO timestamps sort correctly)
    if (!latest || file > latest) {
      latest = file;
    }
  }

  if (!latest) return null;
  try {
    return parseKeyValueContent(readFileSync(join(archiveDir, latest), "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Merge `updates` into the latest archived copy of a session record. It runs
 * under the lock of the session record, so it never interleaves with an
 * archive or a copy-back of the same session.
 */
export function updateArchivedMetadata(
  dataDir: string,
  sessionId: SessionId,
  updates: Partial<Record<string, string>>,
): boolean {
  validateSessionId(sessionId);
  const archiveDir = join(dataDir, "archive");
  if (!existsSync(archiveDir)) return false;
  return withRecordLock(dataDir, sessionId, () =>
    updateLatestArchive(archiveDir, sessionId, updates),
  );
}

function updateLatestArchive(
  archiveDir: string,
  sessionId: SessionId,
  updates: Partial<Record<string, string>>,
): boolean {
  const prefix = `${sessionId}_`;
  let latest: string | null = null;

  for (const file of readdirSync(archiveDir)) {
    if (!file.startsWith(prefix)) continue;
    const charAfterPrefix = file[prefix.length];
    if (!charAfterPrefix || charAfterPrefix < "0" || charAfterPrefix > "9") continue;
    if (!latest || file > latest) latest = file;
  }

  if (!latest) return false;

  const archivePath = join(archiveDir, latest);
  let existing: Record<string, string>;
  try {
    existing = parseKeyValueContent(readFileSync(archivePath, "utf-8"));
  } catch {
    return false;
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === "") {
      const { [key]: _, ...rest } = existing;
      existing = rest;
    } else {
      existing[key] = value;
    }
  }

  atomicWriteFileSync(archivePath, serializeMetadata(existing));
  return true;
}

/**
 * List all session IDs that have metadata files.
 */
export function listMetadata(dataDir: string): SessionId[] {
  const dir = dataDir;
  if (!existsSync(dir)) return [];

  return readdirSync(dir).filter((name) => {
    if (name === "archive" || name.startsWith(".")) return false;
    if (!VALID_SESSION_ID.test(name)) return false;
    try {
      return statSync(join(dir, name)).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Atomically reserve a session ID by creating its metadata file.
 * Returns true if the ID was successfully reserved, false if it already exists.
 *
 * Without `initial`, the file is created empty with O_EXCL. With `initial`
 * (M-5: the launch claim of a spawn that prepares its agent session), the
 * record exists only with that content: the content goes into a dot-named
 * temp file in the same directory, which `listMetadata` skips and no session
 * ID can name, and `link` then publishes that complete file under the record
 * name. Like O_EXCL, `link` fails with EEXIST when the name exists. So no
 * other process can read the record, not even for one system call, without
 * the claim, and a kill or an orchestrator start always sees the launcher.
 * The temp file is removed in every case. With `initial`, an error other
 * than EEXIST throws. The reservation runs under the record lock. A
 * reservation has no `generation`; the first write gives it one.
 */
export function reserveSessionId(
  dataDir: string,
  sessionId: SessionId,
  initial?: Record<string, string>,
): boolean {
  const path = metadataPath(dataDir, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  return withRecordLock(dataDir, sessionId, () => reserveRecord(dataDir, sessionId, path, initial));
}

function reserveRecord(
  dataDir: string,
  sessionId: SessionId,
  path: string,
  initial?: Record<string, string>,
): boolean {
  if (!initial || Object.keys(initial).length === 0) {
    try {
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
      closeSync(fd);
      return true;
    } catch {
      return false;
    }
  }

  const tempPath = join(dirname(path), `.${sessionId}.reserve-${process.pid}-${randomUUID()}`);
  let tempCreated = false;
  try {
    const fd = openSync(tempPath, "wx");
    tempCreated = true;
    try {
      writeFileSync(fd, serializeMetadata(initial), "utf-8");
    } finally {
      closeSync(fd);
    }
    linkSync(tempPath, path);
    return true;
  } catch (err) {
    if (tempCreated && (err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw new Error(`Could not reserve session ${sessionId} in ${dataDir}`, { cause: err });
  } finally {
    if (tempCreated) rmSync(tempPath, { force: true });
  }
}
