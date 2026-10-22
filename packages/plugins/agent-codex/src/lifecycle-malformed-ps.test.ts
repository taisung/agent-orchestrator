/**
 * Same-ID R4 round 2 (review r1, M-2), through the lifecycle manager (the
 * built core) with the real Codex plugin. Over two polls of one worker, a
 * `ps` that succeeds with a reply that is not a process list keeps app-1
 * `working`, as a `ps` that cannot run does. On fa2f7ac8 the plugin read
 * that reply as "no codex", and the second poll wrote `killed` while the
 * runtime answered alive. A valid list without codex is the control: two
 * polls persist `killed`.
 *
 * Only `tmux` and `ps` are stand-ins (the pane TTY and the process list), and
 * the runtime answers alive. app-2 is a live session (its activity is
 * "active"), so the poll is not a probe outage.
 *
 * Round 3 (review r2, M-2, M-3 and M-4): the same holds for a `ps` row with
 * a PID that is not a positive safe integer, for tmux's missing-target line
 * for another session, and for a Herdr process-info answer for another pane
 * (the `herdr` stand-in). On 8e9efe95 each one wrote `killed`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";

const child = vi.hoisted(() => ({
  ps: "valid-dead" as "exec-error" | "malformed" | "valid-dead" | "unsafe-pid",
  tmux: "pane" as "pane" | "wrong-target",
  herdrPane: "w7:p1",
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  // No real tmux, ps or herdr runs: the callback form refuses them.
  const execFile = ((cmd: string, ...rest: unknown[]) => {
    if (cmd === "tmux" || cmd === "ps" || cmd === "herdr") {
      throw new Error(`unexpected command: ${cmd}`);
    }
    return (actual.execFile as (...args: unknown[]) => unknown)(cmd, ...rest);
  }) as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string) => {
      if (cmd === "herdr") {
        const processInfo = { pane_id: child.herdrPane, foreground_processes: [] };
        return { stdout: JSON.stringify({ result: { process_info: processInfo } }), stderr: "" };
      }
      if (cmd === "tmux") {
        if (child.tmux === "wrong-target") {
          throw Object.assign(new Error("Command failed: tmux list-panes"), {
            code: 1,
            stderr: "can't find session: unrelated\n",
          });
        }
        return { stdout: "/dev/pts/73\n", stderr: "" };
      }
      if (cmd === "ps") {
        if (child.ps === "exec-error") {
          throw Object.assign(new Error("Command failed: ps -eo pid,tty,args"), {
            code: 1,
            stderr: "ps: unavailable\n",
          });
        }
        if (child.ps === "malformed") {
          return { stdout: "procfs temporarily unavailable\n", stderr: "" };
        }
        if (child.ps === "unsafe-pid") {
          return {
            stdout: "    PID TT       COMMAND\n999999999999999999999 pts/73   /bin/bash\n",
            stderr: "",
          };
        }
        return { stdout: "    PID TT       COMMAND\n  123 pts/73   /bin/bash\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${cmd}`);
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

import {
  createLifecycleManager,
  createSessionManager,
  getSessionsDir,
  readMetadataRaw,
  readObservabilitySummary,
  writeMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
} from "@aoagents/ao-core";
import { create } from "./index.js";

let root: string;
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  child.tmux = "pane";
  child.herdrPane = "w7:p1";
  root = mkdtempSync(join(tmpdir(), "ao-codex-lifecycle-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

function setup(runtimeName: "tmux" | "herdr" = "tmux") {
  const projectPath = join(root, "my-app");
  mkdirSync(projectPath, { recursive: true });
  const configPath = join(root, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const config = {
    configPath,
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: { runtime: "tmux", agent: "codex", workspace: "worktree", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
        agent: "codex",
        runtime: "tmux",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
  } as unknown as OrchestratorConfig;
  const sessionsDir = getSessionsDir(configPath, projectPath);
  mkdirSync(sessionsDir, { recursive: true });

  const runtime = {
    name: "tmux",
    create: vi.fn(),
    destroy: vi.fn(),
    sendMessage: vi.fn(),
    getOutput: vi.fn(async () => ""),
    isAlive: vi.fn(async () => true),
  } as unknown as Runtime;
  // The real plugin. app-2 is live; app-1 gets the plugin's own answer.
  const agent: Agent = create();
  const readActivity = agent.getActivityState.bind(agent);
  agent.getActivityState = async (session, threshold) =>
    session.id === "app-2" ? { state: "active" } : readActivity(session, threshold);
  agent.recordActivity = undefined;
  const registry = {
    register: vi.fn(),
    get: vi.fn((slot: string) => (slot === "runtime" ? runtime : slot === "agent" ? agent : null)),
    list: vi.fn(() => []),
    loadBuiltins: vi.fn(async () => undefined),
    loadFromConfig: vi.fn(async () => undefined),
  } as unknown as PluginRegistry;

  for (const [index, id] of ["app-1", "app-2"].entries()) {
    const worktree = join(root, id);
    const paneId = runtimeName === "herdr" ? `w7:p${index + 1}` : id;
    mkdirSync(worktree);
    writeMetadata(sessionsDir, id, {
      project: "my-app",
      agent: "codex",
      status: "working",
      branch: "main",
      prAutoDetect: "off",
      worktree,
      createdAt: "2026-01-01T00:00:00.000Z",
      runtimeHandle: JSON.stringify({ id: paneId, runtimeName, data: {} }),
    });
  }
  const sessionManager = createSessionManager({ config, registry });
  const lifecycle = createLifecycleManager({
    config,
    registry,
    sessionManager,
    projectId: "my-app",
  });
  return { config, sessionsDir, lifecycle };
}

/** Run `count` polls of one worker; each ends when the health record changes. */
async function poll(
  config: OrchestratorConfig,
  lifecycle: ReturnType<typeof createLifecycleManager>,
  count: number,
): Promise<void> {
  const health = () =>
    readObservabilitySummary(config).projects["my-app"]?.health["lifecycle.worker"];
  try {
    for (let i = 0; i < count; i++) {
      const before = health()?.correlationId;
      lifecycle.start(3_600_000);
      lifecycle.stop();
      await vi.waitFor(() => expect(health()?.correlationId).not.toBe(before), {
        timeout: 5_000,
        interval: 5,
      });
    }
  } finally {
    lifecycle.stop();
  }
}

describe("same-id R4 round 2 (review r1, M-2): the lifecycle with the real Codex plugin", () => {
  it("keeps app-1 working over two polls when ps succeeds with a reply that is not a process list", async () => {
    child.ps = "malformed";
    const { config, sessionsDir, lifecycle } = setup();
    await poll(config, lifecycle, 2);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["status"]).toBe("working");
  });

  it("control: keeps app-1 working over two polls when ps cannot run", async () => {
    child.ps = "exec-error";
    const { config, sessionsDir, lifecycle } = setup();
    await poll(config, lifecycle, 2);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["status"]).toBe("working");
  });

  it("control: a valid process list without codex gives app-1 killed after two polls", async () => {
    child.ps = "valid-dead";
    const { config, sessionsDir, lifecycle } = setup();
    await poll(config, lifecycle, 2);
    const record = readMetadataRaw(sessionsDir, "app-1");
    expect(record?.["status"]).toBe("killed");
    expect(record?.["killedReason"]).toBe("agent-exited");
  });
});

describe("same-id R4 round 3 (review r2, M-2, M-3, M-4): the lifecycle with the real Codex plugin", () => {
  it("keeps app-1 working over two polls when a ps row has a PID that is too large to be exact", async () => {
    child.ps = "unsafe-pid";
    const { config, sessionsDir, lifecycle } = setup();
    await poll(config, lifecycle, 2);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["status"]).toBe("working");
  });

  it("keeps app-1 working over two polls when tmux answers the missing-target line for another session", async () => {
    child.tmux = "wrong-target";
    const { config, sessionsDir, lifecycle } = setup();
    await poll(config, lifecycle, 2);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["status"]).toBe("working");
  });

  it("keeps app-1 working over two polls when herdr answers the process-info of another pane", async () => {
    child.herdrPane = "w99:p8";
    const { config, sessionsDir, lifecycle } = setup("herdr");
    await poll(config, lifecycle, 2);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["status"]).toBe("working");
  });

  it("control: an empty Herdr process list for the requested pane gives app-1 killed after two polls", async () => {
    // Every query gets the answer for w7:p1, so only app-1 (pane w7:p1) reads it.
    const { config, sessionsDir, lifecycle } = setup("herdr");
    await poll(config, lifecycle, 2);
    const record = readMetadataRaw(sessionsDir, "app-1");
    expect(record?.["status"]).toBe("killed");
    expect(record?.["killedReason"]).toBe("agent-exited");
  });
});
