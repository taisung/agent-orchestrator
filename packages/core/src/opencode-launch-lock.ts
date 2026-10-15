import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { promisify } from "node:util";
import { findOpenCodeSessionsByTitle, OPENCODE_API_TIMEOUT_MS } from "./opencode-api.js";
import { shellEscape } from "./utils.js";
import type { RuntimeHandle } from "./types.js";

// Every launcher of this uid must agree, regardless of HOME, TMPDIR, XDG_* or AO_STATE_ROOT.
const LOCK_ROOT = `/tmp/ao-opencode-launch-${process.getuid?.() ?? "user"}`;
const WAIT_MS = 30_000;
const EMPTY_GRACE_MS = 3_000;
export const OPENCODE_SPAWN_DISCOVERY_WINDOW_MS = 15_000;
const execFileAsync = promisify(execFile);

interface PendingLaunch {
  title: string;
  directory: string;
  pid: number;
  startedAt: number;
  runtimeHandle?: RuntimeHandle;
  tmuxSocket?: string;
}

export interface OpenCodeLaunchLock {
  /** Persist uncertainty BEFORE runtime.create can launch a delayed pane. */
  start(): Promise<number>;
  /** Persist the handle before doing any post-launch work; socket lookup is best effort. */
  recordRuntime(handle: RuntimeHandle): Promise<void>;
  /** Only a failure known to precede command delivery may cancel the marker. */
  cancel(): void;
  /** Call only after discovery found this launch's ID and it was persisted. */
  complete(): void;
  readonly pending: boolean;
  readonly recoveryHint: string;
  release(): void;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function definitelyDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return hasCode(error, "ESRCH");
  }
}

function ownersIn(path: string): string[] {
  return readdirSync(path).filter((entry) => /^\d+-[\da-f-]+\.owner$/.test(entry));
}

/** Remove only the observed dead owner's token; never retry rmdir after ENOENT. */
function reapOwner(path: string, owner: string): void {
  try {
    unlinkSync(join(path, owner));
    rmdirSync(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT") && !hasCode(error, "ENOTEMPTY")) throw error;
  }
}

function reclaimEmpty(path: string): boolean {
  try {
    if (Date.now() - lstatSync(path).mtimeMs < EMPTY_GRACE_MS) return false;
    rmdirSync(path); // Atomic: never removes a directory containing a participant's token.
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return true;
    if (hasCode(error, "ENOTEMPTY")) return false;
    throw error;
  }
}

/** A short filesystem lease serializes recovery as well as launches. */
async function takeLease(path: string, wait: () => Promise<void>): Promise<() => void> {
  const token = `${process.pid}-${randomUUID()}.owner`;
  for (;;) {
    // Publish a populated directory atomically. A suspended live contender must
    // never look like an abandoned empty lease to another reaper.
    const candidate = `${path}.${token}`;
    mkdirSync(candidate, { mode: 0o700 });
    try {
      writeFileSync(join(candidate, token), "", { flag: "wx", mode: 0o600 });
      renameSync(candidate, path);
      return () => reapOwner(path, token);
    } catch (error) {
      reapOwner(candidate, token);
      if (!hasCode(error, "EEXIST") && !hasCode(error, "ENOTEMPTY")) throw error;
    }
    try {
      const owners = ownersIn(path);
      if (owners.length === 1 && definitelyDead(Number(owners[0].split("-", 1)[0]))) {
        reapOwner(path, owners[0]);
        continue;
      }
      if (owners.length === 0 && reclaimEmpty(path)) continue;
    } catch (error) {
      if (hasCode(error, "ENOENT")) continue;
      throw error;
    }
    await wait();
  }
}

function readPending(path: string, title: string, directory: string): PendingLaunch | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object") return undefined;
    const pending = value as PendingLaunch;
    if (
      pending.title !== title ||
      pending.directory !== directory ||
      typeof pending.startedAt !== "number" ||
      !Number.isFinite(pending.startedAt) ||
      pending.startedAt <= 0
    )
      return undefined;
    return pending;
  } catch {
    return undefined;
  }
}

async function paneDefinitelyGone(pending: PendingLaunch): Promise<boolean> {
  const handle = pending.runtimeHandle;
  // Neither Herdr nor an old marker identifies a server that can prove absence.
  if (
    handle?.runtimeName !== "tmux" ||
    typeof handle.id !== "string" ||
    typeof pending.tmuxSocket !== "string" ||
    !pending.tmuxSocket.startsWith("/")
  )
    return false;
  try {
    await execFileAsync("tmux", ["-S", pending.tmuxSocket, "has-session", "-t", `=${handle.id}`], {
      timeout: 1_500,
    });
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: unknown };
    // An unreachable server is unknown, even if its socket used to exist.
    return (
      failure.code === 1 &&
      typeof failure.stderr === "string" &&
      /can't find session:/.test(failure.stderr)
    );
  }
  return false;
}

/**
 * Serialize fresh launches across fleets, from before the timestamp through ID persistence.
 * The compatibility directory still excludes round-3 launchers. A separate lease lets a
 * successor inspect/recover its pending marker without two reapers accepting it concurrently.
 * Only completed-create evidence or a sufficiently old, explicitly dead pane settles uncertainty.
 * `root` and `waitMs` are test seams; production always uses the fixed per-uid namespace.
 */
export async function acquireOpenCodeLaunchLock(
  workspacePath: string,
  title: string,
  options: { root?: string; waitMs?: number } = {},
): Promise<OpenCodeLaunchLock> {
  let directory = resolve(workspacePath);
  try {
    directory = realpathSync(directory);
  } catch (error) {
    if (options.root === undefined) {
      throw new Error(`Cannot resolve the OpenCode workspace ${workspacePath}`, { cause: error });
    }
  }
  const root = options.root ?? LOCK_ROOT;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootStat = lstatSync(root);
  if (
    !rootStat.isDirectory() ||
    rootStat.uid !== process.getuid?.() ||
    (rootStat.mode & 0o077) !== 0
  ) {
    throw new Error(
      `Unsafe OpenCode launch lock root ${root}: expected a real directory owned by uid ${process.getuid?.()} with mode 0700.`,
    );
  }
  const key = createHash("sha256")
    .update(JSON.stringify([directory, title]))
    .digest("hex");
  const lockPath = join(root, key);
  const pendingPath = join(lockPath, "pending.json");
  const owner = `${process.pid}-${randomUUID()}.owner`;
  const ownerPath = join(lockPath, owner);
  const recoveryHint = `After stopping and settling the earlier pane and any in-flight create request, run \`rm -r -- ${shellEscape(lockPath)}\` to remove the marker directory ${lockPath}.`;
  const deadline = performance.now() + (options.waitMs ?? WAIT_MS);
  let waiting = false;
  const wait = async () => {
    if (!waiting) {
      process.stderr.write(
        `ao: waiting for the OpenCode launch lock for ${title} in ${directory} (${lockPath}).\n`,
      );
      waiting = true;
    }
    if (performance.now() >= deadline) {
      throw new Error(
        `Timed out waiting for the OpenCode launch lock for ${title} in ${directory} (${lockPath}); no pane was launched. ${recoveryHint}`,
      );
    }
    await pause(Math.min(50, Math.max(1, deadline - performance.now())));
  };
  const releaseLease = await takeLease(`${lockPath}.lease`, wait);
  try {
    for (;;) {
      try {
        mkdirSync(lockPath, { mode: 0o700 });
        writeFileSync(ownerPath, "", { flag: "wx", mode: 0o600 });
        break;
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      let owners: string[];
      try {
        owners = ownersIn(lockPath);
      } catch (error) {
        if (hasCode(error, "ENOENT")) continue;
        throw error;
      }
      const previous = owners.length === 1 ? owners[0] : undefined;
      if (owners.length > 1 || (previous && !definitelyDead(Number(previous.split("-", 1)[0])))) {
        await wait();
        continue;
      }
      if (existsSync(pendingPath)) {
        const pending = readPending(pendingPath, title, directory);
        let evidence: string | undefined;
        if (pending) {
          // Exactly one create and no retry in the pane script. A hit settles that
          // attempt even if discovery/remap failed; the next timestamp excludes it.
          try {
            const sessions = await findOpenCodeSessionsByTitle(
              {
                title,
                directories: [directory],
                createdAtOrAfter: pending.startedAt,
              },
              Math.max(
                1,
                Math.ceil(Math.min(OPENCODE_API_TIMEOUT_MS, deadline - performance.now())),
              ),
            );
            if (sessions.length > 0)
              evidence = `earlier create finished (${sessions.map((s) => s.id).join(", ")})`;
          } catch {
            // An unavailable search is not evidence. The independent dead-pane proof may still work.
          }
          if (
            !evidence &&
            Date.now() - pending.startedAt >=
              OPENCODE_SPAWN_DISCOVERY_WINDOW_MS + OPENCODE_API_TIMEOUT_MS &&
            (await paneDefinitelyGone(pending))
          )
            evidence = "earlier pane is gone and its create window has elapsed";
        }
        if (!evidence) {
          throw new Error(
            `Cannot safely launch ${title} in ${directory}: an earlier OpenCode launch is unresolved (${lockPath}). ${recoveryHint} A delayed create could otherwise be mistaken for this launch.`,
          );
        }
        unlinkSync(pendingPath);
        if (existsSync(join(lockPath, "pending.next"))) unlinkSync(join(lockPath, "pending.next"));
        process.stderr.write(
          `ao: recovered the OpenCode launch marker for ${title} in ${directory}: ${evidence}.\n`,
        );
        // No ownerless grace needed: we just settled this specific marker under the lease.
        if (previous) reapOwner(lockPath, previous);
        else rmdirSync(lockPath);
        continue;
      }
      if (previous) {
        reapOwner(lockPath, previous);
        continue;
      }
      if (reclaimEmpty(lockPath)) {
        process.stderr.write(
          `ao: reclaimed an empty OpenCode launch lock for ${title} in ${directory} (${lockPath}).\n`,
        );
        continue;
      }
      await wait();
    }
  } catch (error) {
    releaseLease();
    throw error;
  }

  let released = false;
  let pending: PendingLaunch | undefined;
  const persist = () => {
    // Atomic replacement: a crash preserves either the old or the new evidence.
    const temp = join(lockPath, "pending.next");
    writeFileSync(temp, JSON.stringify(pending), { flag: "wx", mode: 0o600 });
    renameSync(temp, pendingPath);
  };
  const complete = () => {
    if (pending) unlinkSync(pendingPath);
    pending = undefined;
  };
  return {
    async start() {
      const acquiredAt = Date.now();
      while (Date.now() <= acquiredAt) await pause(1);
      const startedAt = Date.now();
      pending = { title, directory, pid: process.pid, startedAt };
      writeFileSync(pendingPath, JSON.stringify(pending), { flag: "wx", mode: 0o600 });
      return startedAt;
    },
    async recordRuntime(handle) {
      if (!pending) return;
      pending.runtimeHandle = handle;
      persist();
      if (handle.runtimeName === "tmux") {
        try {
          const { stdout } = await execFileAsync(
            "tmux",
            ["display-message", "-p", "-t", `=${handle.id}`, "#{socket_path}"],
            { timeout: 1_500 },
          );
          const socket = stdout.trim();
          if (socket.startsWith("/")) {
            pending.tmuxSocket = socket;
            persist();
          }
        } catch {
          // Keep the handle; absence of server identity means recovery by API evidence only.
        }
      }
    },
    cancel: complete,
    complete,
    get pending() {
      return pending !== undefined;
    },
    recoveryHint,
    release() {
      if (released) return;
      released = true;
      try {
        unlinkSync(ownerPath);
        if (!existsSync(pendingPath)) rmdirSync(lockPath);
      } finally {
        releaseLease();
      }
    },
  };
}
