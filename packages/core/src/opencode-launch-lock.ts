import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

// Deliberately independent of HOME, TMPDIR, XDG_* and AO_STATE_ROOT: fleets
// using the same host service must agree on this namespace. Per-user because
// the OpenCode service and its conversations belong to that OS user.
const LOCK_ROOT = `/tmp/ao-opencode-launch-${process.getuid?.() ?? "user"}`;
const WAIT_MS = 30_000;

export interface OpenCodeLaunchLock {
  /** Persist uncertainty BEFORE runtime.create can launch a delayed pane. */
  start(): Promise<number>;
  /** Call only after discovery found this launch's ID and it was persisted. */
  complete(): void;
  /** An unresolved launch leaves its pending marker behind. */
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
    // Permission errors and PID reuse must never evict a possible live owner.
    return hasCode(error, "ESRCH");
  }
}

/**
 * Serialize fresh OpenCode launches with the same real workspace and title,
 * including launches in other config/state roots. Take before the launch
 * timestamp, hold through discovery AND metadata persistence. The timestamp
 * then excludes every successfully discovered predecessor.
 *
 * A timeout or crashed launcher can leave a pane/service request that creates
 * later. Time cannot prove that it is finished. Its durable pending marker
 * therefore refuses subsequent colliding launches, even after the owner dies;
 * it never expires automatically. The original pane remains usable and can
 * be manually remapped. Removing a pending marker requires first stopping and
 * settling that launch; I-3's create-by-ID will remove this interim limitation.
 *
 * `root`/`waitMs` are injection seams for isolated filesystem/process tests;
 * production callers always use the host-wide defaults.
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
    // Only filesystem test doubles may lack a workspace. A real launch must
    // resolve the directory so a symlink can never bypass serialization.
    if (options.root === undefined) {
      throw new Error(`Cannot resolve the OpenCode workspace ${workspacePath}`, { cause: error });
    }
  }
  const root = options.root ?? LOCK_ROOT;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const key = createHash("sha256")
    .update(JSON.stringify([directory, title]))
    .digest("hex");
  const lockPath = join(root, key);
  const pendingPath = join(lockPath, "pending.json");
  const owner = `${process.pid}-${randomUUID()}.owner`;
  const ownerPath = join(lockPath, owner);
  const deadline = performance.now() + (options.waitMs ?? WAIT_MS);
  const unsettled = () =>
    new Error(
      `Cannot safely launch ${title} in ${directory}: an earlier OpenCode launch is unresolved (${pendingPath}). Stop and settle its pane/create request before clearing this marker; a delayed create could otherwise be mistaken for this launch.`,
    );

  for (;;) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      // The unique filename is also the reclamation token. A competing stale
      // reaper cannot unlink a successor's owner and then remove its directory.
      writeFileSync(ownerPath, "", { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }

    let entries: string[];
    try {
      entries = readdirSync(lockPath);
    } catch (error) {
      if (hasCode(error, "ENOENT")) continue;
      throw error;
    }
    const owners = entries.filter((entry) => /^\d+-[\da-f-]+\.owner$/.test(entry));
    if (owners.length === 0 && entries.includes("pending.json")) throw unsettled();
    if (owners.length === 1) {
      const previous = owners[0];
      const pid = Number(previous.split("-", 1)[0]);
      if (pid > 0 && definitelyDead(pid)) {
        if (entries.includes("pending.json")) throw unsettled();
        try {
          unlinkSync(join(lockPath, previous));
          rmdirSync(lockPath);
        } catch (error) {
          // Only the reaper that unlinked THIS owner may remove the directory.
          // Never retry rmdir after ENOENT: it may now be a successor's lock.
          if (!hasCode(error, "ENOENT") && !hasCode(error, "ENOTEMPTY")) throw error;
        }
        continue;
      }
    }
    // Empty/invalid owner state is uncertain (e.g. a crash between mkdir and
    // publication), not permission to steal. Fail within the same wait bound.
    if (performance.now() >= deadline) {
      throw new Error(
        `Timed out waiting for the OpenCode launch lock for ${title} in ${directory} (${lockPath}); no pane was launched.`,
      );
    }
    await pause(Math.min(50, Math.max(1, deadline - performance.now())));
  }

  let released = false;
  return {
    async start() {
      // Avoid equality at millisecond precision with a just-completed create.
      const acquiredAt = Date.now();
      while (Date.now() <= acquiredAt) await pause(1);
      const startedAt = Date.now();
      writeFileSync(
        pendingPath,
        JSON.stringify({ title, directory, pid: process.pid, startedAt }),
        {
          flag: "wx",
          mode: 0o600,
        },
      );
      return startedAt;
    },
    complete() {
      unlinkSync(pendingPath);
    },
    release() {
      if (released) return;
      released = true;
      unlinkSync(ownerPath);
      if (!existsSync(pendingPath)) rmdirSync(lockPath);
    },
  };
}
