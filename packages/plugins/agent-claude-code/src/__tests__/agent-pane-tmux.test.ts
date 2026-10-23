/**
 * Session relaunch (2026-10-22), review r2 M-1: in a real tmux session whose
 * selected window is not the agent's, the process check and the activity
 * read of claude-code find the agent in its own pane (the pane that core
 * names in the handle), and a handle that names no pane reads the selected
 * window, as before. A stand-in `claude` (a bash script of that name) runs
 * in the agent's pane; `ps` is real.
 *
 * Every tmux call goes to a private server of this test file: a `tmux`
 * wrapper first on PATH adds `-S <test directory>/tmux.sock` and removes
 * TMUX.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { RuntimeHandle, Session } from "@aoagents/ao-core";
import { create, resetPsCache } from "../index.js";

function findOnPath(name: string): string | null {
  for (const entry of (process.env["PATH"] ?? "").split(delimiter)) {
    if (entry && existsSync(join(entry, name))) return join(entry, name);
  }
  return null;
}

const tmuxBin = findOnPath("tmux");
const SESSION = "agent-pane-m1";

let dir = "";
let savedPath: string | undefined;

function tmux(...args: string[]): string {
  const result = spawnSync(join(dir, "bin", "tmux"), args, {
    encoding: "utf-8",
    env: { PATH: `${join(dir, "bin")}:/usr/bin:/bin`, HOME: dir, TERM: "xterm-256color" },
  });
  if (result.status !== 0) throw new Error(`tmux ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trimEnd();
}

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

/** False when `pid` has exited, also as a zombie (its exit work is done). */
function running(pid: number): boolean {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ESRCH") return false;
    throw err;
  }
  // The state follows the command name, which is in parentheses.
  return !/^[ZX]/.test(stat.slice(stat.lastIndexOf(")") + 2));
}

/**
 * Stop the private server, then remove the test directory. `kill-server`
 * returns before the server and its pane processes exit, and a process can
 * still write to the test directory then (a bash that exits on SIGHUP writes
 * its history to $HOME): CI run 39964135618 failed with ENOTEMPTY when
 * `rmSync` ran at once (relaunch-pane-shell.test.ts). So this waits (at most
 * 5 s) until the server and every pane process have exited, then removes the
 * directory with retries. A process that still runs after the wait fails the
 * hook. Every call goes through the wrapper (never to the default server);
 * `list-panes` finds nothing when no server runs.
 */
async function stopServerAndRemoveDir(): Promise<void> {
  const wrapper = join(dir, "bin", "tmux");
  const panes = spawnSync(wrapper, ["list-panes", "-a", "-F", "#{pid} #{pane_pid}"], {
    encoding: "utf-8",
  });
  const pids =
    panes.status === 0 ? [...new Set(panes.stdout.split(/\s+/).filter(Boolean).map(Number))] : [];
  spawnSync(wrapper, ["kill-server"], { stdio: "ignore" });
  const exited = await waitFor(() => !pids.some(running), 5_000);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (!exited) {
    throw new Error(
      `tmux processes ${pids.filter(running).join(", ")} still run 5 s after kill-server`,
    );
  }
}

function handleOf(data: Record<string, unknown>): RuntimeHandle {
  return { id: SESSION, runtimeName: "tmux", data };
}

function sessionOf(runtimeHandle: RuntimeHandle): Session {
  return {
    id: "app-1",
    projectId: "my-app",
    status: "working",
    activity: null,
    branch: null,
    issueId: null,
    pr: null,
    workspacePath: join(dir, "ws"),
    runtimeHandle,
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: {},
  };
}

describe.skipIf(process.platform !== "linux" || tmuxBin === null)(
  "claude-code reads the agent's pane while another window is selected (review r2 M-1)",
  () => {
    let agentPane = "";

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), "ao-agent-pane-"));
      mkdirSync(join(dir, "bin"));
      mkdirSync(join(dir, "ws"));
      writeFileSync(
        join(dir, "bin", "tmux"),
        `#!/bin/sh\nexec env -u TMUX '${tmuxBin}' -S '${join(dir, "tmux.sock")}' -f /dev/null "$@"\n`,
      );
      chmodSync(join(dir, "bin", "tmux"), 0o755);
      // The stand-in agent stays as a process whose arguments name claude.
      writeFileSync(join(dir, "bin", "claude"), "#!/bin/bash\nwhile :; do sleep 1; done\n");
      chmodSync(join(dir, "bin", "claude"), 0o755);
      savedPath = process.env["PATH"];
      process.env["PATH"] = `${join(dir, "bin")}${delimiter}${savedPath ?? ""}`;

      tmux("new-session", "-d", "-s", SESSION, "-x", "120", "-y", "30", join(dir, "bin", "claude"));
      agentPane = tmux("display-message", "-p", "-t", `=${SESSION}:`, "#{pane_id}");
      // A second window, selected (new-window without -d selects it).
      tmux("new-window", "-t", `=${SESSION}:`, "bash --noprofile --norc");
      const selected = tmux("display-message", "-p", "-t", `=${SESSION}:`, "#{pane_id}");
      if (selected === agentPane) throw new Error("the second window is not selected");
      const tty = tmux("display-message", "-p", "-t", agentPane, "#{pane_tty}").replace(
        "/dev/",
        "",
      );
      const running = await waitFor(() => {
        const ps = spawnSync("ps", ["-eo", "tty,args"], { encoding: "utf-8" }).stdout;
        return ps.split("\n").some((row) => row.includes(tty) && row.includes("/claude"));
      }, 5_000);
      if (!running) throw new Error("the stand-in claude did not start");
    }, 20_000);

    afterAll(async () => {
      try {
        if (dir) await stopServerAndRemoveDir();
      } finally {
        process.env["PATH"] = savedPath;
      }
    }, 15_000);

    it("finds the agent in its pane, and the selected window (the old read) does not", async () => {
      const agent = create();
      resetPsCache();
      expect(await agent.isProcessRunning(handleOf({ agentPane }))).toBe(true);
      resetPsCache();
      expect(await agent.isProcessRunning(handleOf({}))).toBe(false);
      resetPsCache();
      const activity = await agent.getActivityState(sessionOf(handleOf({ agentPane })));
      expect(activity?.state).not.toBe("exited");
    });

    it("answers false once the agent's pane is closed, while the session still exists", async () => {
      tmux("kill-pane", "-t", agentPane);
      resetPsCache();

      expect(await create().isProcessRunning(handleOf({ agentPane }))).toBe(false);
      expect(tmux("list-panes", "-s", "-t", `=${SESSION}`, "-F", "#{pane_id}")).not.toContain(
        agentPane,
      );
    });
  },
);
