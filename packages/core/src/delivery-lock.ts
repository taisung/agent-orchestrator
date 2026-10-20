/**
 * I-5 round 4 (M-4, B-3): a mutual-exclusion lock that the kernel releases
 * when the process that holds it ends, also on `kill -9`, so that no lock
 * state can stay behind.
 *
 * The lock is a Linux abstract Unix socket: a name that starts with a NUL
 * byte, bound with `listen` and never written to disk. Only one socket can
 * bind a name (every other bind gets `EADDRINUSE`, also in the same
 * process), and the kernel frees the name when that socket closes, which
 * happens when its process ends in any way. Node opens the socket with
 * close-on-exec, so a child process (for example `opencode api`) does not
 * keep it.
 *
 * A probe (`connect`) tells whether a name is held, without holding it: a
 * held name accepts the connection, a free name refuses it (`ECONNREFUSED`).
 *
 * Other platforms (macOS) have no abstract namespace, and a socket file
 * stays on disk after its process ends, so `isDeliveryLockSupported` is
 * false there. The delivery ledger then refuses (nothing is sent).
 *
 * The abstract namespace has no file permissions: another local user (in
 * the same network namespace) can bind or connect to a name. The name holds
 * the user ID, so the names of two users never collide, but another user
 * who reads a ledger can hold its names. See the spec (section 4, item 6).
 */
import { createHash } from "node:crypto";
import { connect, createServer } from "node:net";

/** How long a probe waits for the kernel's answer before it counts the name as held. */
const PROBE_TIMEOUT_MS = 1_000;

/** True when this platform has the lock (Linux abstract Unix sockets). */
export function isDeliveryLockSupported(platform: string = process.platform): boolean {
  return platform === "linux";
}

/**
 * The name of a lock: the kind, the user ID and a SHA-256 prefix (128 bits)
 * of `subject`. The ledger gives as subject the real path of the ledger file
 * (so the state root, the project and the agent session key), plus the
 * attempt token for an attempt lock. Two state roots, two sessions, two
 * attempts and two users never share a name. The session record lock
 * (record-lock.ts) uses the kind "record" with the real path of the record.
 */
export function deliveryLockName(kind: "ledger" | "attempt" | "record", subject: string): string {
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "nouid";
  const hash = createHash("sha256").update(subject, "utf-8").digest("hex").slice(0, 32);
  return `\0ao-delivery-${uid}-${kind}-${hash}`;
}

/** The name as `ss -xlp` and `/proc/net/unix` show it (`@` for the NUL byte). */
export function printableLockName(name: string): string {
  return name.startsWith("\0") ? `@${name.slice(1)}` : name;
}

/** One hold of a lock name. */
export interface DeliveryLock {
  readonly name: string;
  /**
   * Close the socket of this hold, so the kernel frees the name. It acts
   * only on the socket that this hold bound: it cannot free a name that
   * another hold (of this or another process) bound later. A second call
   * does nothing.
   */
  release(): void;
}

/**
 * Bind `name` once. Resolves null when another socket holds it
 * (`EADDRINUSE`); rejects for every other error. The socket accepts no
 * work: it closes each connection (a probe) at once, and it does not keep
 * the process alive.
 */
export function tryHoldDeliveryLock(name: string): Promise<DeliveryLock | null> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.unref();
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolve(null);
      else reject(err);
    };
    server.once("error", onError);
    server.listen({ path: name, exclusive: true }, () => {
      server.off("error", onError);
      // A later error of the bound socket (a failed accept of a probe) does
      // not free the name, so the hold stays valid; without a listener the
      // error would end the process.
      server.on("error", () => {});
      // A second close of a closed server does nothing (Node keeps no handle).
      resolve({ name, release: () => void server.close() });
    });
  });
}

/**
 * Bind `name`, and while another socket holds it, try again every 15 to 30
 * ms for at most `waitMs`. Resolves null when the name stays held.
 */
export async function holdDeliveryLock(name: string, waitMs: number): Promise<DeliveryLock | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const lock = await tryHoldDeliveryLock(name);
    if (lock) return lock;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 15 + Math.floor(Math.random() * 15)));
  }
}

/**
 * True when a socket holds `name`. The probe connects and closes at once; it
 * never binds, so it cannot take the name or keep the holder from it. Only a
 * refusal (`ECONNREFUSED`, or `ENOENT`) means free: every other result (an
 * accepted connection, a full backlog, no answer in 1 s) counts as held.
 */
export function isDeliveryLockHeld(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ path: name });
    let settled = false;
    const done = (held: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(held);
    };
    const timer = setTimeout(() => done(true), PROBE_TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("error", (err: NodeJS.ErrnoException) =>
      done(err.code !== "ECONNREFUSED" && err.code !== "ENOENT"),
    );
  });
}
