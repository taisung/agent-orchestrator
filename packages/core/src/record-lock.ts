/**
 * The lock of one session record (killed-status round 3, B-2). Every Node
 * writer of a record (metadata.ts) holds it for its read, compare, write and
 * rename, so no other writer can change the record between its read and its
 * rename.
 *
 * It uses the method of the I-5 delivery lock (delivery-lock.ts): a Linux
 * abstract Unix socket, name kind "record", subject the real path of the
 * record. The kernel frees the name when the process ends in any way (also
 * `kill -9`), so no lock state can stay on disk after a crash.
 *
 * The record writers are synchronous, but Node binds a socket only
 * asynchronously. So a helper worker thread binds and closes the sockets,
 * and the writer waits for its answer with `Atomics.wait`. The socket belongs
 * to this process. The writer holds the lock only inside its synchronous
 * section, so nothing else of its thread runs while it holds it: no probe, no
 * tmux call and no network call.
 *
 * On a platform without abstract sockets (`isDeliveryLockSupported` false,
 * for example macOS) a writer writes without the lock, as before.
 */
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { deliveryLockName, isDeliveryLockSupported, printableLockName } from "./delivery-lock.js";

/** How long a writer waits for a record lock that another process holds. */
export const RECORD_LOCK_WAIT_MS = 5_000;

/** Extra wait for the first answer of a helper that is still starting. */
const HELPER_START_MS = 5_000;

// Index 0 of the shared state is the answer slot: the request sequence
// number times 8 plus a status, so a late answer of an older request can
// never match a newer one. Index 1 holds the sequence number whose error
// text is in the text buffer, index 2 the length of that text.
const PENDING = 0;
const HELD = 1;
const BUSY = 2;
const FAILED = 3;
const ABANDONED = 4;

const ERROR_TEXT_BYTES = 512;

/**
 * The helper thread. It binds a name on a "hold" request (and tries again
 * every 2 to 5 ms while another socket holds it, until the wait ends), and
 * closes the socket on a "release" request. An answer counts only while the
 * slot still waits for this request; a late success of an abandoned request
 * closes its socket at once.
 */
const HELPER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { createServer } = require("node:net");
const state = new Int32Array(workerData.state);
const errorText = new Uint8Array(workerData.errorText);
const held = new Map();
function answer(seq, result, text) {
  const pending = seq * 8 + ${PENDING};
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
        answer(msg.seq, ${BUSY});
      } else {
        answer(msg.seq, ${FAILED}, String(err.code || "") + " " + err.message);
      }
    });
    server.listen({ path: msg.name, exclusive: true }, () => {
      server.on("error", () => {});
      if (answer(msg.seq, ${HELD})) held.set(msg.name, server);
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

let helper: LockHelper | null = null;
/** Names that this thread holds, with the depth of nested holds. */
const heldDepth = new Map<string, number>();

function getHelper(): LockHelper {
  if (helper) return helper;
  const state = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT);
  const errorText = new SharedArrayBuffer(ERROR_TEXT_BYTES);
  const worker = new Worker(HELPER_SOURCE, { eval: true, workerData: { state, errorText } });
  // The helper never keeps the process alive.
  worker.unref();
  const created: LockHelper = {
    worker,
    state: new Int32Array(state),
    errorText: new Uint8Array(errorText),
    seq: 0,
  };
  const forget = () => {
    if (helper === created) helper = null;
  };
  worker.on("error", forget);
  worker.on("exit", forget);
  helper = created;
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

function acquire(name: string): void {
  const h = getHelper();
  h.seq = (h.seq % 0x0fffffff) + 1;
  const seq = h.seq;
  const pending = seq * 8 + PENDING;
  Atomics.store(h.state, 0, pending);
  h.worker.postMessage({ op: "hold", name, seq, waitMs: RECORD_LOCK_WAIT_MS });

  const deadline = Date.now() + RECORD_LOCK_WAIT_MS + HELPER_START_MS;
  let slot = Atomics.load(h.state, 0);
  while (slot === pending) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    Atomics.wait(h.state, 0, pending, left);
    slot = Atomics.load(h.state, 0);
  }
  if (slot === pending) {
    // Give up; a later success of this request closes its socket at once.
    slot = Atomics.compareExchange(h.state, 0, pending, seq * 8 + ABANDONED);
  }
  const result = slot - seq * 8;
  if (result === HELD) return;
  const printable = printableLockName(name);
  if (result === BUSY) {
    throw new Error(
      `Record lock ${printable} is held by another process for more than ${RECORD_LOCK_WAIT_MS} ms`,
    );
  }
  if (result === FAILED) {
    const text =
      Atomics.load(h.state, 1) === seq
        ? Buffer.from(h.errorText.subarray(0, Atomics.load(h.state, 2))).toString("utf-8")
        : "unknown error";
    throw new Error(`Could not take record lock ${printable}: ${text}`);
  }
  throw new Error(`Record lock ${printable}: no answer from the lock helper thread`);
}

function release(name: string): void {
  helper?.worker.postMessage({ op: "release", name });
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
  const depth = heldDepth.get(name) ?? 0;
  if (depth === 0) acquire(name);
  heldDepth.set(name, depth + 1);
  try {
    return fn();
  } finally {
    const left = (heldDepth.get(name) ?? 1) - 1;
    if (left > 0) {
      heldDepth.set(name, left);
    } else {
      heldDepth.delete(name);
      release(name);
    }
  }
}
