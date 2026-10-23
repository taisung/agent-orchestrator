/**
 * Session relaunch (2026-10-22), review r3 M-3: a tmux pane keeps its ID
 * when `join-pane` moves it to another session. A handle that names the
 * agent's pane must then read as a pane that is gone: `getOutput` answers no
 * output (also on the lifecycle's recording path), and `sendMessage` rejects
 * and types nothing, as the agents' process checks answer "not running".
 *
 * Every tmux call goes to a private server of this test file: a `tmux`
 * wrapper first on PATH adds `-S <test directory>/tmux.sock` and removes
 * TMUX. The lifecycle writes its records under `AO_STATE_ROOT` in the test
 * directory.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
import {
  createLifecycleManager,
  createSessionManager,
  getSessionsDir,
  updateMetadata,
  writeMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type RuntimeHandle,
} from "@aoagents/ao-core";
import { create } from "../index.js";

function findOnPath(name: string): string | null {
  for (const entry of (process.env["PATH"] ?? "").split(delimiter)) {
    if (entry && existsSync(join(entry, name))) return join(entry, name);
  }
  return null;
}

const tmuxBin = findOnPath("tmux");
const bashBin = findOnPath("bash");
const supported = process.platform === "linux" && tmuxBin !== null && bashBin !== null;

let dir = "";
let savedPath: string | undefined;
let savedStateRoot: string | undefined;
let sessions = 0;

/** The launch of the relaunch that bound the agent's pane. */
const BOUND_LAUNCH = "6f0c2b7a-1d3f-4a6b-9c8d-7e6f5a4b3c2d";

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

/** Run a line in a pane's shell and wait until the pane shows `mark`. */
async function runLine(paneId: string, line: string, mark: string): Promise<void> {
  tmux("send-keys", "-t", paneId, "-l", line);
  tmux("send-keys", "-t", paneId, "Enter");
  const shown = await waitFor(() => tmux("capture-pane", "-p", "-t", paneId).includes(mark), 5_000);
  if (!shown) throw new Error(`pane ${paneId} did not show ${mark}`);
}

/**
 * The review's fixture: a source session with the agent's pane and a second
 * pane (so the session stays after the move), and a target session.
 */
async function movedPaneFixture(): Promise<{
  source: string;
  agentPane: string;
  otherPane: string;
  targetPane: string;
}> {
  sessions += 1;
  const source = `move-source-${sessions}`;
  const target = `move-target-${sessions}`;
  tmux("new-session", "-d", "-s", source, "-x", "120", "-y", "30", "bash --noprofile --norc");
  const agentPane = tmux("display-message", "-p", "-t", `=${source}:`, "#{pane_id}");
  const otherPane = tmux(
    "split-window",
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-t",
    agentPane,
    "bash --noprofile --norc",
  );
  tmux("new-session", "-d", "-s", target, "-x", "120", "-y", "30", "bash --noprofile --norc");
  const targetPane = tmux("display-message", "-p", "-t", `=${target}:`, "#{pane_id}");
  for (const pane of [agentPane, otherPane, targetPane]) {
    const prompt = await waitFor(
      () => /bash-[\d.]+\$/.test(tmux("capture-pane", "-p", "-t", pane)),
      5_000,
    );
    if (!prompt) throw new Error(`no bash prompt in ${pane}`);
  }
  return { source, agentPane, otherPane, targetPane };
}

function moveToTarget(agentPane: string, targetPane: string): void {
  tmux("join-pane", "-d", "-s", agentPane, "-t", targetPane);
}

describe.skipIf(!supported)("a bound agent pane moved to another session (review r3 M-3)", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ao-moved-pane-"));
    mkdirSync(join(dir, "bin"));
    const wrapper = join(dir, "bin", "tmux");
    writeFileSync(
      wrapper,
      `#!/bin/sh\nexec env -u TMUX '${tmuxBin}' -S '${join(dir, "tmux.sock")}' -f /dev/null "$@"\n`,
    );
    chmodSync(wrapper, 0o755);
    savedPath = process.env["PATH"];
    process.env["PATH"] = `${join(dir, "bin")}${delimiter}${savedPath ?? ""}`;
    savedStateRoot = process.env["AO_STATE_ROOT"];
    process.env["AO_STATE_ROOT"] = join(dir, "state");
  });

  afterAll(async () => {
    try {
      if (dir) await stopServerAndRemoveDir();
    } finally {
      process.env["PATH"] = savedPath;
      if (savedStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
      else process.env["AO_STATE_ROOT"] = savedStateRoot;
    }
  }, 15_000);

  it("answers no output and refuses the send after join-pane, and types nothing in the moved pane", async () => {
    const { source, agentPane, otherPane, targetPane } = await movedPaneFixture();
    const handle: RuntimeHandle = { id: source, runtimeName: "tmux", data: { agentPane } };
    const runtime = create();
    await runLine(agentPane, "echo before-move-mark", "before-move-mark\n");
    expect(await runtime.getOutput(handle, 20)).toContain("before-move-mark");

    moveToTarget(agentPane, targetPane);
    expect(tmux("display-message", "-p", "-t", agentPane, "#{session_name}")).toBe(
      `move-target-${sessions}`,
    );
    await runLine(agentPane, "echo after-move-mark", "after-move-mark\n");

    expect(await runtime.getOutput(handle, 20)).toBe("");
    const message = join(dir, `moved-message-${sessions}`);
    await expect(runtime.sendMessage(handle, `touch ${message}`)).rejects.toThrow(
      `tmux pane ${agentPane}, the agent's pane of session ${source}, now belongs to another tmux session: nothing was sent`,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(existsSync(message)).toBe(false);
    expect(tmux("capture-pane", "-p", "-t", agentPane)).not.toContain("moved-message");
    expect(tmux("capture-pane", "-p", "-t", otherPane)).not.toContain("moved-message");
  });

  it("records no activity from the moved pane on the lifecycle's recording path", async () => {
    const { source, agentPane, targetPane } = await movedPaneFixture();
    const projectPath = join(dir, `project-${sessions}`);
    const workspacePath = join(dir, `ws-${sessions}`);
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(workspacePath, { recursive: true });
    const configPath = join(dir, "agent-orchestrator.yaml");
    writeFileSync(configPath, "projects: {}\n");
    const config: OrchestratorConfig = {
      configPath,
      port: 3000,
      defaults: { runtime: "tmux", agent: "stub", workspace: "stub", notifiers: [] },
      projects: {
        demo: {
          name: "Demo",
          repo: "org/demo",
          path: projectPath,
          defaultBranch: "main",
          sessionPrefix: "dm",
        },
      },
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
      readyThresholdMs: 300_000,
    };
    const recorded: string[] = [];
    const agent = {
      name: "stub",
      processName: "stub",
      detectActivity: () => "idle",
      recordActivity: vi.fn(async (_session: unknown, output: string) => {
        recorded.push(output);
      }),
      getActivityState: async () => ({ state: "active", timestamp: new Date() }),
      isProcessRunning: async () => true,
      getSessionInfo: async () => null,
      getLaunchCommand: () => "true",
      getEnvironment: () => ({}),
    } as unknown as Agent;
    const runtime = create();
    const registry = {
      register: () => undefined,
      get: (slot: string, name: string) =>
        slot === "runtime" && name === "tmux" ? runtime : slot === "agent" ? agent : null,
      list: () => [],
      loadBuiltins: async () => undefined,
      loadFromConfig: async () => undefined,
    } as unknown as PluginRegistry;

    const sessionsDir = getSessionsDir(configPath, projectPath);
    mkdirSync(sessionsDir, { recursive: true });
    writeMetadata(sessionsDir, "dm-1", {
      worktree: workspacePath,
      branch: "main",
      status: "working",
      project: "demo",
      agent: "stub",
      runtimeHandle: JSON.stringify({ id: source, runtimeName: "tmux", data: {} }),
    });
    // The binding of a relaunch into the agent's pane, out of the launch grace.
    const at = new Date(Date.now() - 3_600_000).toISOString();
    updateMetadata(sessionsDir, "dm-1", {
      createdAt: at,
      restoredAt: at,
      launchToken: BOUND_LAUNCH,
      launchTokenAt: at,
      launchPane: agentPane,
    });
    const sm = createSessionManager({ config, registry });
    const lifecycle = createLifecycleManager({
      config,
      registry,
      sessionManager: sm,
      projectId: "demo",
    });
    expect((await sm.get("dm-1"))?.runtimeHandle?.data["agentPane"]).toBe(agentPane);

    await runLine(agentPane, "echo before-move-mark", "before-move-mark\n");
    await lifecycle.check("dm-1");
    expect(recorded.some((output) => output.includes("before-move-mark"))).toBe(true);

    moveToTarget(agentPane, targetPane);
    await runLine(agentPane, "echo after-move-mark", "after-move-mark\n");
    recorded.length = 0;
    await lifecycle.check("dm-1");

    expect(recorded).toEqual([]);
  });
});
