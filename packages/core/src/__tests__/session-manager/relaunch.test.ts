/**
 * Session relaunch (2026-10-22): `SessionManager.relaunch` restarts the agent
 * of a session in its existing tmux pane. Each test drives the real session
 * manager over a scratch record directory; only the plugins are mocks.
 *
 * - R-1: the launch command and environment are built as a restore builds
 *   them (the record's model, an orchestrator's prompt and mode).
 * - R-2: --continue uses only the ID that the agent found for this session.
 * - R-3: every refusal throws SessionRelaunchRefusedError and changes nothing.
 * - R-4: one compare-and-set takes the launch claim and starts the launch
 *   grace; the claim blocks a restore and another relaunch.
 * - Note 1, item 2: every path after the claim ends with the claim cleared
 *   and the record sound.
 * - Review r1 (round 2): the pane by its ID and the launch token (M-1, M-4),
 *   the agent as the caller's own child through `exec` (M-2), one deadline
 *   for every awaited call after the claim (M-7), the script mode.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { createLifecycleManager } from "../../lifecycle-manager.js";
import { readObservabilitySummary } from "../../observability.js";
import { deleteMetadata, readMetadataRaw, updateMetadata, writeMetadata } from "../../metadata.js";
import { getProjectBaseDir } from "../../paths.js";
import { generateOrchestratorPrompt } from "../../orchestrator-prompt.js";
import {
  LAUNCH_GRACE_MS,
  SessionLaunchInProgressError,
  SessionRelaunchRefusedError,
  type ActivityDetection,
  type AgentLaunchConfig,
  type LifecycleManager,
  type OrchestratorConfig,
  type PluginRegistry,
  type RuntimeHandle,
  type RuntimePaneState,
  type SessionManager,
  type SessionRelaunchChild,
} from "../../types.js";
import {
  createMockPlugins,
  createMockRegistry,
  createTestEnvironment,
  type MockPlugins,
  type TestEnvironment,
} from "../test-utils.js";

const PANE_TTY = "/dev/pts/77";
const PANE = "%3";
const THIS_LAUNCH = "5e0c2b7a-1d3f-4a6b-9c8d-7e6f5a4b3c2d";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONVERSATION = "0b5c3a52-6c55-4a0e-9d1f-6f0f3d2a9e11";
const EXITED: ActivityDetection = { state: "exited", timestamp: new Date() };

let env: TestEnvironment;
let plugins: MockPlugins;
let registry: PluginRegistry;
let config: OrchestratorConfig;
let sm: SessionManager;
let lifecycle: LifecycleManager | null;
let agentRunning: boolean;
let paneCommand: string;
let paneIdle: boolean | null;
let extraPanes: RuntimePaneState[];
let scripts: string[];
let ownPids: number[];

/** A launch time older than the launch grace. */
const LONG_AGO = () => new Date(Date.now() - LAUNCH_GRACE_MS - 60_000).toISOString();

function tmuxHandle(sessionId: string, runtimeName = "tmux"): RuntimeHandle {
  return { id: `h-${sessionId}`, runtimeName, data: { createdAt: Date.now() - 3_600_000 } };
}

function workspaceOf(): string {
  return join(env.tmpDir, "ws");
}

/** The record of a session whose agent ended, plus `fields` ("" removes a key). */
function writeRecord(sessionId: string, fields: Record<string, string> = {}): void {
  writeMetadata(env.sessionsDir, sessionId, {
    worktree: workspaceOf(),
    branch: "feat/x",
    status: "working",
    tmuxName: `h-${sessionId}`,
    project: "my-app",
    agent: "mock-agent",
    createdAt: LONG_AGO(),
    runtimeHandle: JSON.stringify(tmuxHandle(sessionId)),
  });
  updateMetadata(env.sessionsDir, sessionId, fields);
}

function recordOf(sessionId: string): Record<string, string> | null {
  return readMetadataRaw(env.sessionsDir, sessionId);
}

/** The record fields of a spawn that stored its launch token (its `createdAt` is the launch). */
function tokenOfSpawn(sessionId: string): Record<string, string> {
  return { launchToken: THIS_LAUNCH, launchTokenAt: recordOf(sessionId)!["createdAt"] };
}

/** The launch script path of a `runInPane` call (`bash '<path>'`). */
function scriptOf(command: string): string {
  const match = /^bash '([^']+)'$/.exec(command);
  if (!match) throw new Error(`not a launch line: ${command}`);
  scripts.push(match[1]);
  return match[1];
}

function launchConfigOf(call = 0): AgentLaunchConfig {
  return vi.mocked(plugins.agent.getLaunchCommand).mock.calls[call][0];
}

/** The start token of this process, as the launch claim records it. */
function ownStartToken(): string {
  const stat = readFileSync("/proc/self/stat", "utf-8");
  return `stat:${stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]}`;
}

function workerHealth() {
  return readObservabilitySummary(config).projects["my-app"]?.health["lifecycle.worker"];
}

/** Run exactly one poll of the worker and wait until it has finished. */
async function pollOnce(lm: LifecycleManager): Promise<void> {
  const before = workerHealth()?.correlationId;
  lm.start(3_600_000);
  lm.stop();
  await vi.waitFor(() => expect(workerHealth()?.correlationId).not.toBe(before), {
    timeout: 2_000,
    interval: 5,
  });
}

beforeEach(() => {
  env = createTestEnvironment();
  plugins = createMockPlugins();
  agentRunning = false;
  paneCommand = "bash";
  paneIdle = true;
  extraPanes = [];
  scripts = [];
  ownPids = [];
  Object.assign(plugins.runtime, {
    name: "tmux",
    isAlive: vi.fn().mockResolvedValue(true),
    listPanes: vi.fn(
      async (): Promise<RuntimePaneState[]> => [
        { paneId: PANE, tty: PANE_TTY, foregroundCommand: paneCommand, shellIdle: paneIdle },
        ...extraPanes,
      ],
    ),
    runInPane: vi.fn(async (_handle: RuntimeHandle, _paneId: string, command: string) => {
      scriptOf(command);
      agentRunning = true;
    }),
  });
  vi.mocked(plugins.agent.isProcessRunning).mockImplementation(async () => agentRunning);
  registry = createMockRegistry({ runtime: plugins.runtime, agent: plugins.agent });
  config = env.config;
  sm = createSessionManager({ config, registry });
  lifecycle = null;
});

afterEach(() => {
  vi.useRealTimers();
  lifecycle?.stop();
  for (const script of scripts) rmSync(script, { force: true });
  // Stand-in agents of the process tests that still run (only when a test failed).
  for (const pid of ownPids) {
    // Only a real PID of a stand-in: 0 or a negative number would signal a process group.
    if (!Number.isInteger(pid) || pid <= 1) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already ended.
    }
  }
  env.cleanup();
});

describe("R-1: the launch command and the environment", () => {
  it("uses the record's model over the config and exports the spawn environment", async () => {
    config.projects["my-app"].agentConfig = { model: "config-model" };
    writeRecord("app-1", { model: "record-model" });

    const result = await sm.relaunch!("app-1");

    expect(result.running).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.plan).toEqual({
      sessionId: "app-1",
      mode: "pane",
      agentName: "mock-agent",
      model: "record-model",
      launchCommand: "mock-agent --start",
    });
    const launchConfig = launchConfigOf();
    expect(launchConfig).toMatchObject({ sessionId: "app-1", model: "record-model" });
    expect(launchConfig.launchToken).toMatch(UUID);
    expect(launchConfig.systemPromptFile).toBeUndefined();
    expect(launchConfig.continueConversationId).toBeUndefined();

    const command = vi.mocked(plugins.runtime.runInPane!).mock.calls[0][2];
    const script = scriptOf(command);
    // Only the owner can read or run it (review r1: the mode was not pinned).
    expect(statSync(script).mode & 0o777).toBe(0o700);
    const lines = readFileSync(script, "utf-8").split("\n");
    expect(lines[0]).toBe("#!/usr/bin/env bash");
    expect(lines[1]).toBe('rm -- "$0" 2>/dev/null || true');
    expect(lines[2]).toBe(`cd -- '${workspaceOf()}' || exit 1`);
    expect(lines).toContain("export AGENT_VAR='1'");
    expect(lines).toContain("export AO_SESSION='app-1'");
    expect(lines).toContain(`export AO_DATA_DIR='${env.sessionsDir}'`);
    expect(lines).toContain("export AO_SESSION_NAME='app-1'");
    expect(lines).toContain("export AO_TMUX_NAME='h-app-1'");
    expect(lines).toContain("export AO_CALLER_TYPE='agent'");
    expect(lines).toContain("export AO_PROJECT_ID='my-app'");
    expect(lines).toContain(`export AO_CONFIG_PATH='${config.configPath}'`);
    // Review r1 M-2: one simple command, so bash replaces itself with the agent.
    expect(lines.filter(Boolean).at(-1)).toBe("exec mock-agent --start");
    expect(lines.join("\n")).not.toContain("AO_LAUNCH_TOKEN");
  });

  it("does not exec a launch command that is not one simple command", async () => {
    vi.mocked(plugins.agent.getLaunchCommand).mockReturnValue("cp a GEMINI.md && mock-agent");
    writeRecord("app-1");

    await sm.relaunch!("app-1");

    const command = vi.mocked(plugins.runtime.runInPane!).mock.calls[0][2];
    const lines = readFileSync(scriptOf(command), "utf-8").split("\n");
    expect(lines.filter(Boolean).at(-1)).toBe("cp a GEMINI.md && mock-agent");
  });

  it("execs a launch command whose command substitution is in quotes (the Claude Code form)", async () => {
    const claude = `env AO_LAUNCH_TOKEN='${THIS_LAUNCH}' claude --model 'opus' --append-system-prompt "$(cat '/p/x.md')" --resume 'id'`;
    vi.mocked(plugins.agent.getLaunchCommand).mockReturnValue(claude);
    writeRecord("app-1");

    await sm.relaunch!("app-1");

    const command = vi.mocked(plugins.runtime.runInPane!).mock.calls[0][2];
    expect(readFileSync(scriptOf(command), "utf-8")).toContain(`\nexec ${claude}\n`);
  });

  it("gives an orchestrator its permissionless mode and the orchestrator prompt of this build", async () => {
    writeRecord("app-orchestrator", { model: "stray-model", permissions: "default" });

    const result = await sm.relaunch!("app-orchestrator");

    expect(result.running).toBe(true);
    const project = config.projects["my-app"];
    const promptFile = join(
      getProjectBaseDir(config.configPath, project.path),
      "orchestrator-prompt-app-orchestrator.md",
    );
    const launchConfig = launchConfigOf();
    expect(launchConfig.permissions).toBe("permissionless");
    expect(launchConfig.projectConfig.agentConfig?.permissions).toBe("permissionless");
    expect(launchConfig.systemPromptFile).toBe(promptFile);
    expect(launchConfig.model).not.toBe("stray-model");
    expect(readFileSync(promptFile, "utf-8")).toBe(
      generateOrchestratorPrompt({ config, projectId: "my-app", project }),
    );
    const command = vi.mocked(plugins.runtime.runInPane!).mock.calls[0][2];
    expect(readFileSync(scriptOf(command), "utf-8")).toContain(
      "export AO_CALLER_TYPE='orchestrator'",
    );
  });
});

describe("R-2: --continue by the session's own conversation ID", () => {
  it("passes the ID that the agent of the last launch recorded, by its launch token and pane", async () => {
    writeRecord("app-1");
    updateMetadata(env.sessionsDir, "app-1", tokenOfSpawn("app-1"));
    plugins.agent.getOwnConversationId = vi
      .fn()
      .mockResolvedValue({ id: CONVERSATION, source: "the hook record" });

    const result = await sm.relaunch!("app-1", { continueConversation: true });

    expect(result.plan.conversation).toEqual({ id: CONVERSATION, source: "the hook record" });
    expect(launchConfigOf().continueConversationId).toBe(CONVERSATION);
    expect(plugins.agent.getOwnConversationId).toHaveBeenCalledWith(
      expect.objectContaining({ id: "app-1", workspacePath: workspaceOf() }),
      { dataDir: env.sessionsDir, launchToken: THIS_LAUNCH, pane: { id: PANE, tty: PANE_TTY } },
    );
    // The new launch has a new token, which the record keeps with its launch time.
    const after = recordOf("app-1")!;
    expect(launchConfigOf().launchToken).not.toBe(THIS_LAUNCH);
    expect(after["launchToken"]).toBe(launchConfigOf().launchToken);
    expect(after["launchTokenAt"]).toBe(after["restoredAt"]);
    expect(after["launchPane"]).toBe(PANE);
  });

  it("refuses --continue when a restore came after the launch that stored the token (review r1 M-4)", async () => {
    writeRecord("app-1");
    const spawnedAt = Date.parse(recordOf("app-1")!["createdAt"]);
    updateMetadata(env.sessionsDir, "app-1", {
      ...tokenOfSpawn("app-1"),
      restoredAt: new Date(spawnedAt + 1_000).toISOString(),
    });
    const before = recordOf("app-1");
    plugins.agent.getOwnConversationId = vi.fn();

    await expect(sm.relaunch!("app-1", { continueConversation: true })).rejects.toThrow(
      /its last launch has no launch token \(a restore, or a launch by an older AO build\)/,
    );
    expect(plugins.agent.getOwnConversationId).not.toHaveBeenCalled();
    expect(recordOf("app-1")).toEqual(before);
  });

  it("refuses --continue when the ID is not known, and changes nothing", async () => {
    writeRecord("app-1");
    updateMetadata(env.sessionsDir, "app-1", tokenOfSpawn("app-1"));
    const before = recordOf("app-1");
    plugins.agent.getOwnConversationId = vi
      .fn()
      .mockResolvedValue({ id: null, reason: "no conversation is recorded" });

    await expect(sm.relaunch!("app-1", { continueConversation: true })).rejects.toThrow(
      /the ID of its own conversation is not known: no conversation is recorded/,
    );
    expect(recordOf("app-1")).toEqual(before);
    expect(plugins.runtime.runInPane).not.toHaveBeenCalled();
    expect(plugins.agent.getLaunchCommand).not.toHaveBeenCalled();
  });

  it("refuses --continue for an agent that cannot continue a conversation by its ID", async () => {
    writeRecord("app-1");
    const before = recordOf("app-1");

    const refusal = sm.relaunch!("app-1", { continueConversation: true });

    await expect(refusal).rejects.toBeInstanceOf(SessionRelaunchRefusedError);
    await expect(refusal).rejects.toThrow(/cannot continue a conversation by its ID/);
    expect(recordOf("app-1")).toEqual(before);
    expect(plugins.runtime.runInPane).not.toHaveBeenCalled();
  });

  it("starts a new conversation without --continue and does not look up an ID", async () => {
    writeRecord("app-1");
    plugins.agent.getOwnConversationId = vi.fn();

    const result = await sm.relaunch!("app-1");

    expect(result.plan.conversation).toBeUndefined();
    expect(launchConfigOf().continueConversationId).toBeUndefined();
    expect(plugins.agent.getOwnConversationId).not.toHaveBeenCalled();
  });
});

describe("R-3: each refusal changes nothing", () => {
  const cases: Array<{
    name: string;
    setup: () => void;
    reason: RegExp;
    options?: () => Parameters<NonNullable<SessionManager["relaunch"]>>[1];
  }> = [
    {
      name: "the agent process still runs",
      setup: () => {
        writeRecord("app-1");
        agentRunning = true;
      },
      reason: /its agent process \(mock\) still runs/,
    },
    {
      name: "the agent process check rejects",
      setup: () => {
        writeRecord("app-1");
        vi.mocked(plugins.agent.isProcessRunning).mockRejectedValue(new Error("ps failed"));
      },
      reason: /the agent process check could not tell \(ps failed\)/,
    },
    {
      name: "the agent process check answers a value that is not a boolean",
      setup: () => {
        writeRecord("app-1");
        vi.mocked(plugins.agent.isProcessRunning).mockResolvedValue(
          undefined as unknown as boolean,
        );
      },
      reason: /the agent process check could not tell/,
    },
    {
      name: "the tmux session does not exist",
      setup: () => {
        writeRecord("app-1");
        vi.mocked(plugins.runtime.isAlive).mockResolvedValue(false);
      },
      reason: /its tmux session h-app-1 does not exist/,
    },
    {
      name: "the tmux liveness check rejects",
      setup: () => {
        writeRecord("app-1");
        vi.mocked(plugins.runtime.isAlive).mockRejectedValue(new Error("no server"));
      },
      reason: /the tmux liveness check could not tell \(no server\)/,
    },
    {
      name: "the tmux session ends before the pane check",
      setup: () => {
        writeRecord("app-1");
        vi.mocked(plugins.runtime.listPanes!).mockResolvedValue(null);
      },
      reason: /its tmux session h-app-1 does not exist/,
    },
    {
      name: "the pane check rejects",
      setup: () => {
        writeRecord("app-1");
        vi.mocked(plugins.runtime.listPanes!).mockRejectedValue(new Error("tmux timed out"));
      },
      reason: /the pane check could not tell \(tmux timed out\)/,
    },
    {
      name: "the pane runs another program, not a shell prompt",
      setup: () => {
        writeRecord("app-1");
        paneCommand = "vim";
        paneIdle = false;
      },
      reason: /its pane %3 runs vim, not a shell that waits for input/,
    },
    {
      name: "a job runs in the foreground of the pane's shell",
      setup: () => {
        writeRecord("app-1");
        paneIdle = false;
      },
      reason: /its pane %3 runs bash, not a shell that waits for input/,
    },
    {
      name: "the runtime cannot tell whether the pane's shell waits for input",
      setup: () => {
        writeRecord("app-1");
        paneIdle = null;
      },
      reason: /cannot tell whether the shell of its pane %3 waits for input/,
    },
    {
      name: "the session has several panes and the record names none (review r1 M-1)",
      setup: () => {
        writeRecord("app-1");
        extraPanes = [
          { paneId: "%8", tty: "/dev/pts/78", foregroundCommand: "bash", shellIdle: true },
        ];
      },
      reason:
        /its tmux session h-app-1 has 2 panes, and its record does not name the pane of its agent/,
    },
    {
      name: "the caller's own pane cannot exec a launch command that is not one simple command (review r1 M-2)",
      setup: () => {
        writeRecord("app-1");
        vi.mocked(plugins.agent.getLaunchCommand).mockReturnValue("cp a b && mock-agent");
      },
      options: () => ({ callerTty: PANE_TTY, runInCallerTerminal: vi.fn() }),
      reason: /its launch command is not one simple command/,
    },
    {
      name: "the caller is in the session's own pane and cannot run the agent there",
      setup: () => writeRecord("app-1"),
      options: () => ({ callerTty: PANE_TTY }),
      reason: /runs in the session's own pane/,
    },
    ...["merged", "done", "terminated", "cleanup", "errored"].map((status) => ({
      name: `the status is ${status}`,
      setup: () => writeRecord("app-1", { status }),
      reason: new RegExp(`its status is "${status}"`),
    })),
    {
      name: "a kill that a closed PR gave",
      setup: () => writeRecord("app-1", { status: "killed", killedReason: "pr-closed" }),
      reason: /its status is "killed" \(pr-closed\)/,
    },
    {
      name: "a kill from before killedReason with a PR",
      setup: () =>
        writeRecord("app-1", { status: "killed", pr: "https://github.com/org/my-app/pull/1" }),
      reason: /its status is "killed"/,
    },
    {
      name: "no session has this ID",
      setup: () => {},
      reason: /no session has this ID/,
    },
    {
      name: "the record was archived",
      setup: () => {
        writeRecord("app-1");
        deleteMetadata(env.sessionsDir, "app-1", true);
      },
      reason: /it has no active record \(it was killed and archived\)/,
    },
    {
      name: "the runtime is Herdr",
      setup: () =>
        writeRecord("app-1", { runtimeHandle: JSON.stringify(tmuxHandle("app-1", "herdr")) }),
      reason: /a Herdr relaunch waits for the Herdr live check/,
    },
    {
      name: "the runtime is neither tmux nor Herdr",
      setup: () =>
        writeRecord("app-1", { runtimeHandle: JSON.stringify(tmuxHandle("app-1", "process")) }),
      reason: /its runtime is "process", and only a tmux pane can be relaunched/,
    },
    {
      name: "the record names no runtime pane",
      setup: () => writeRecord("app-1", { runtimeHandle: "", tmuxName: "" }),
      reason: /its record names no runtime pane/,
    },
    {
      name: "a live ao process holds the launch claim",
      setup: () =>
        writeRecord("app-1", {
          launchPid: String(process.pid),
          launchPidStart: ownStartToken(),
        }),
      reason: new RegExp(`ao process ${process.pid} is still launching it`),
    },
    {
      name: "the record is the reservation of a launch",
      setup: () => {
        writeRecord("app-1");
        // updateMetadata never writes a new reservation ID; reserveSessionRecord does.
        appendFileSync(join(env.sessionsDir, "app-1"), "reservationId=r-1\n");
      },
      reason: /its record is the reservation of a launch in progress/,
    },
    {
      name: "the spawn is younger than the launch grace",
      setup: () => writeRecord("app-1", { createdAt: new Date(Date.now() - 5_000).toISOString() }),
      reason: /its last launch was [45] s ago/,
    },
    {
      name: "the last restore or relaunch is younger than the launch grace",
      setup: () => writeRecord("app-1", { restoredAt: new Date().toISOString() }),
      reason: /its last launch was 0 s ago/,
    },
  ];

  for (const testCase of cases) {
    it(`refuses when ${testCase.name}`, async () => {
      testCase.setup();
      const before = recordOf("app-1");

      const refusal = sm.relaunch!("app-1", testCase.options?.());

      await expect(refusal).rejects.toBeInstanceOf(SessionRelaunchRefusedError);
      await expect(refusal).rejects.toThrow(testCase.reason);
      const err = (await refusal.catch((e: unknown) => e)) as SessionRelaunchRefusedError;
      expect(err.next.length).toBeGreaterThan(0);
      expect(recordOf("app-1")).toEqual(before);
      expect(plugins.runtime.runInPane).not.toHaveBeenCalled();
    });
  }

  it("refuses when the agent process check does not answer within 10 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    writeRecord("app-1");
    const before = recordOf("app-1");
    vi.mocked(plugins.agent.isProcessRunning).mockReturnValue(new Promise<boolean>(() => {}));

    const refusal = sm.relaunch!("app-1");
    const settled = refusal.catch((e: unknown) => e);
    await vi.waitFor(() => expect(plugins.agent.isProcessRunning).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(10_000);

    const err = await settled;
    expect(err).toBeInstanceOf(SessionRelaunchRefusedError);
    expect((err as Error).message).toMatch(/did not answer within 10 s/);
    expect(recordOf("app-1")).toEqual(before);
    expect(plugins.runtime.runInPane).not.toHaveBeenCalled();
  });
});

describe("R-4: the launch claim, the record fields and the launch grace", () => {
  it("holds the launch claim while the agent starts and writes the fields of a restore", async () => {
    writeRecord("app-1");
    const before = recordOf("app-1")!;
    let during: Record<string, string> | null = null;
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, _paneId, command) => {
      scriptOf(command);
      during = recordOf("app-1");
      agentRunning = true;
    });

    const startedAt = Date.now();
    await sm.relaunch!("app-1");

    expect(during).toMatchObject({
      launchPid: String(process.pid),
      launchPidStart: ownStartToken(),
      status: "working",
      runtimeHandle: before["runtimeHandle"],
    });
    const restoredAt = Date.parse(during!["restoredAt"]);
    expect(restoredAt).toBeGreaterThanOrEqual(startedAt - 1);
    expect(restoredAt).toBeLessThanOrEqual(Date.now());

    const after = recordOf("app-1")!;
    expect(after["launchPid"]).toBeUndefined();
    expect(after["launchPidStart"]).toBeUndefined();
    expect(after["restoredAt"]).toBe(during!["restoredAt"]);
    expect(after["status"]).toBe("working");
    expect(after["runtimeHandle"]).toBe(before["runtimeHandle"]);
    expect(Number(after["generation"])).toBeGreaterThan(Number(before["generation"] ?? 0));
  });

  it("makes a restore and a second relaunch of the ID refuse while the claim lives", async () => {
    writeRecord("app-1");
    let restoreRefusal: unknown = null;
    let relaunchRefusal: unknown = null;
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, _paneId, command) => {
      scriptOf(command);
      restoreRefusal = await sm.restore("app-1").catch((e: unknown) => e);
      relaunchRefusal = await sm.relaunch!("app-1").catch((e: unknown) => e);
      agentRunning = true;
    });

    const result = await sm.relaunch!("app-1");

    expect(result.running).toBe(true);
    expect(restoreRefusal).toBeInstanceOf(SessionLaunchInProgressError);
    expect(relaunchRefusal).toBeInstanceOf(SessionRelaunchRefusedError);
    expect((relaunchRefusal as Error).message).toMatch(/is still launching it/);
    expect(plugins.runtime.create).not.toHaveBeenCalled();
    expect(plugins.runtime.destroy).not.toHaveBeenCalled();
  });

  it("starts one agent when two relaunches of the same ID run in parallel", async () => {
    writeRecord("app-1");
    let arrived = 0;
    let release: () => void = () => {};
    const bothChecked = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(plugins.runtime.listPanes!).mockImplementation(async () => {
      arrived += 1;
      if (arrived === 2) release();
      await bothChecked;
      return [{ paneId: PANE, tty: PANE_TTY, foregroundCommand: "bash", shellIdle: true }];
    });

    const results = await Promise.allSettled([sm.relaunch!("app-1"), sm.relaunch!("app-1")]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
    expect(reason).toBeInstanceOf(SessionRelaunchRefusedError);
    expect(reason.message).toMatch(/its record changed while the relaunch checked it/);
    expect(plugins.runtime.runInPane).toHaveBeenCalledTimes(1);
    expect(recordOf("app-1")!["launchPid"]).toBeUndefined();
  });

  it("moves a kill that the agent's exit gave back to working when the agent runs", async () => {
    writeRecord("app-1", { status: "killed", killedReason: "agent-exited" });

    const result = await sm.relaunch!("app-1");

    expect(result.running).toBe(true);
    const after = recordOf("app-1")!;
    expect(after["status"]).toBe("working");
    expect(after["killedReason"]).toBeUndefined();
  });

  it("puts the record in the lifecycle launch grace: an exited agent keeps its status during the start", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED);
    lifecycle = createLifecycleManager({
      config,
      registry,
      sessionManager: sm,
      projectId: "my-app",
    });
    const lm = lifecycle;
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, _paneId, command) => {
      scriptOf(command);
      // Two polls while the claim lives and the agent is not visible yet.
      await pollOnce(lm);
      await pollOnce(lm);
      agentRunning = true;
    });

    await sm.relaunch!("app-1");

    // The relaunched session kept its status; the control (no relaunch) was killed.
    expect(recordOf("app-1")!["status"]).toBe("working");
    expect(recordOf("app-2")).toMatchObject({ status: "killed", killedReason: "agent-exited" });
  });
});

describe("Note 1, item 2: the end state of each path after the claim", () => {
  it("clears the claim and restores the launch time when the runtime cannot type the command", async () => {
    writeRecord("app-1");
    updateMetadata(env.sessionsDir, "app-1", tokenOfSpawn("app-1"));
    const before = recordOf("app-1")!;
    let script = "";
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, _paneId, command) => {
      script = scriptOf(command);
      throw new Error("send-keys failed");
    });

    await expect(sm.relaunch!("app-1")).rejects.toThrow(
      /could not start its agent \(send-keys failed\)/,
    );

    const after = recordOf("app-1")!;
    expect(after["launchPid"]).toBeUndefined();
    expect(after["launchPidStart"]).toBeUndefined();
    expect(after["restoredAt"]).toBeUndefined();
    expect(after["status"]).toBe(before["status"]);
    // The token and the pane of the launch before it are back too.
    expect(after["launchToken"]).toBe(THIS_LAUNCH);
    expect(after["launchTokenAt"]).toBe(before["launchTokenAt"]);
    expect(after["launchPane"]).toBeUndefined();
    expect(existsSync(script)).toBe(false);
  });

  it("clears the claim and restores the launch time when the agent does not appear within the bound", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    writeRecord("app-1", { restoredAt: LONG_AGO() });
    const before = recordOf("app-1")!;
    let started = false;
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, _paneId, command) => {
      scriptOf(command);
      started = true;
    });
    // The agent never starts; at its first check after the start the clock passes the 15 s bound.
    vi.mocked(plugins.agent.isProcessRunning).mockImplementation(async () => {
      if (started) vi.setSystemTime(Date.now() + 16_000);
      return false;
    });

    const result = await sm.relaunch!("app-1");

    expect(result.running).toBe(false);
    const after = recordOf("app-1")!;
    expect(after["launchPid"]).toBeUndefined();
    expect(after["restoredAt"]).toBe(before["restoredAt"]);
    expect(after["status"]).toBe("working");
  });

  it("clears the claim and restores the launch time when the launch cannot be prepared", async () => {
    writeRecord("app-1");
    plugins.agent.setupWorkspaceHooks = vi.fn().mockRejectedValue(new Error("read-only"));

    await expect(sm.relaunch!("app-1")).rejects.toThrow(
      /could not prepare its launch \(read-only\)/,
    );

    const after = recordOf("app-1")!;
    expect(after["launchPid"]).toBeUndefined();
    expect(after["restoredAt"]).toBeUndefined();
    expect(plugins.runtime.runInPane).not.toHaveBeenCalled();
  });

  it("clears the claim and restores the launch time when the caller's child ends before the agent is seen", async () => {
    writeRecord("app-1");
    const runInCallerTerminal = vi.fn((launch: { script: string }): SessionRelaunchChild => {
      scripts.push(launch.script);
      return { exited: Promise.resolve(1) };
    });

    const result = await sm.relaunch!("app-1", { callerTty: PANE_TTY, runInCallerTerminal });

    expect(result.plan.mode).toBe("caller-terminal");
    expect(result.running).toBe(false);
    const after = recordOf("app-1")!;
    expect(after["launchPid"]).toBeUndefined();
    expect(after["restoredAt"]).toBeUndefined();
    expect(plugins.runtime.runInPane).not.toHaveBeenCalled();
  });

  it("runs the agent as the caller's child in its own pane and clears the claim once the agent runs", async () => {
    writeRecord("app-1");
    const exited = new Promise<number>(() => {});
    const runInCallerTerminal = vi.fn(
      (launch: { script: string; cwd: string }): SessionRelaunchChild => {
        scripts.push(launch.script);
        agentRunning = true;
        return { exited };
      },
    );
    const onStart = vi.fn();

    const result = await sm.relaunch!("app-1", {
      callerTty: PANE_TTY,
      runInCallerTerminal,
      onStart,
    });

    expect(result.running).toBe(true);
    expect(result.child?.exited).toBe(exited);
    expect(runInCallerTerminal).toHaveBeenCalledWith({
      script: expect.stringMatching(/ao-launch-.*\.sh$/),
      cwd: workspaceOf(),
    });
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ mode: "caller-terminal" }));
    expect(onStart.mock.invocationCallOrder[0]).toBeLessThan(
      runInCallerTerminal.mock.invocationCallOrder[0],
    );
    const after = recordOf("app-1")!;
    expect(after["launchPid"]).toBeUndefined();
    expect(after["restoredAt"]).toBeDefined();
    expect(plugins.runtime.runInPane).not.toHaveBeenCalled();
  });

  it("does not count the launch keys of a dead ao process (an ao that was killed during a relaunch)", async () => {
    const dead = spawnSync("true");
    writeRecord("app-1", { launchPid: String(dead.pid), launchPidStart: "stat:1" });

    const result = await sm.relaunch!("app-1");

    expect(result.running).toBe(true);
    expect(recordOf("app-1")!["launchPid"]).toBeUndefined();
  });
});

describe("Review r1 M-1: the pane of the agent, by its ID", () => {
  it("types into the pane of the last relaunch by its ID, not into the active pane", async () => {
    const at = LONG_AGO();
    writeRecord("app-1", {
      restoredAt: at,
      launchToken: THIS_LAUNCH,
      launchTokenAt: at,
      launchPane: "%8",
    });
    // %3 (listed first, as the active pane) runs vim; %8 is the agent's pane.
    paneCommand = "vim";
    paneIdle = false;
    extraPanes = [{ paneId: "%8", tty: "/dev/pts/78", foregroundCommand: "bash", shellIdle: true }];

    const result = await sm.relaunch!("app-1");

    expect(result.running).toBe(true);
    expect(vi.mocked(plugins.runtime.runInPane!).mock.calls[0][1]).toBe("%8");
    expect(recordOf("app-1")!["launchPane"]).toBe("%8");
  });

  it("does not use the pane of a launch that a restore replaced", async () => {
    const at = LONG_AGO();
    writeRecord("app-1", {
      restoredAt: new Date(Date.parse(at) + 1_000).toISOString(),
      launchToken: THIS_LAUNCH,
      launchTokenAt: at,
      launchPane: "%8",
    });
    extraPanes = [{ paneId: "%8", tty: "/dev/pts/78", foregroundCommand: "bash", shellIdle: true }];

    await expect(sm.relaunch!("app-1")).rejects.toThrow(
      /has 2 panes, and its record does not name/,
    );
    expect(plugins.runtime.runInPane).not.toHaveBeenCalled();
  });
});

describe("Review r1 M-7: one deadline for every awaited call after the claim", () => {
  it("settles as unknown when a process check after the start never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    writeRecord("app-1");
    let started = false;
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, _paneId, command) => {
      scriptOf(command);
      started = true;
    });
    let held = 0;
    vi.mocked(plugins.agent.isProcessRunning).mockImplementation(async () => {
      if (!started) return false;
      held += 1;
      return new Promise<boolean>(() => {});
    });

    const relaunched = sm.relaunch!("app-1");
    await vi.waitFor(() => expect(held).toBe(1));
    const during = recordOf("app-1")!;
    expect(during["launchPid"]).toBe(String(process.pid));
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await relaunched;

    expect(result).toMatchObject({ running: false, agentState: "unknown" });
    const after = recordOf("app-1")!;
    expect(after["launchPid"]).toBeUndefined();
    // The agent may run: the launch time and the token of this launch stay.
    expect(after["restoredAt"]).toBe(during["restoredAt"]);
    expect(after["launchToken"]).toBe(during["launchToken"]);
  });

  it("does not wait for a late answer, and the late answer changes nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    writeRecord("app-1");
    let started = false;
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, _paneId, command) => {
      scriptOf(command);
      started = true;
    });
    let answerLate: (value: boolean) => void = () => {};
    vi.mocked(plugins.agent.isProcessRunning).mockImplementation(async () => {
      if (!started) return false;
      return new Promise<boolean>((resolve) => {
        answerLate = resolve;
      });
    });

    const relaunched = sm.relaunch!("app-1");
    await vi.waitFor(() => expect(started).toBe(true));
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await relaunched;
    const settled = recordOf("app-1");
    answerLate(true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(result.agentState).toBe("unknown");
    expect(recordOf("app-1")).toEqual(settled);
  });

  it("goes on to the process check when the runtime does not answer within the bound (the line may run)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    writeRecord("app-1");
    let typed = false;
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, _paneId, command) => {
      scriptOf(command);
      typed = true;
      return new Promise<void>(() => {});
    });

    const relaunched = sm.relaunch!("app-1");
    await vi.waitFor(() => expect(typed).toBe(true));
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await relaunched;

    expect(result.agentState).toBe("unknown");
    expect(recordOf("app-1")!["launchPid"]).toBeUndefined();
  });
});

describe("Review r1 M-2: a signal to the caller's child reaches the agent itself", () => {
  it("execs the agent, so SIGTERM to the child ends the agent and its own child", async () => {
    const work = mkdtempSync(join(tmpdir(), "ao-relaunch-m2-"));
    const standIn = join(work, "agent.sh");
    writeFileSync(
      standIn,
      [
        "#!/bin/bash",
        'echo $$ > "$1/agent.pid"',
        "sleep 300 &",
        'echo $! > "$1/grandchild.pid"',
        'trap \'kill "$(cat "$1/grandchild.pid")" 2>/dev/null; exit 143\' TERM',
        "wait",
        "",
      ].join("\n"),
    );
    vi.mocked(plugins.agent.getLaunchCommand).mockReturnValue(`bash '${standIn}' '${work}'`);
    // A PID file counts once it holds a PID (the shell creates it before it writes).
    const pidOf = (name: string): number | null => {
      const text = existsSync(join(work, name))
        ? readFileSync(join(work, name), "utf-8").trim()
        : "";
      return /^[1-9]\d*$/.test(text) ? Number(text) : null;
    };
    const alive = (pid: number | null): boolean => {
      if (pid === null || pid <= 1) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    vi.mocked(plugins.agent.isProcessRunning).mockImplementation(async () =>
      alive(pidOf("grandchild.pid")) ? alive(pidOf("agent.pid")) : false,
    );
    writeRecord("app-1");
    mkdirSync(workspaceOf(), { recursive: true });
    let childPid = 0;
    let killChild: (signal: NodeJS.Signals) => void = () => {};
    const runInCallerTerminal = (launch: { script: string; cwd: string }): SessionRelaunchChild => {
      // As the CLI runs it: `bash <script>` as the caller's child. The
      // script removes itself when it runs; afterEach removes it otherwise.
      scripts.push(launch.script);
      const child = spawn("bash", [launch.script], { cwd: launch.cwd, stdio: "ignore" });
      childPid = child.pid ?? -1;
      ownPids.push(childPid);
      killChild = (signal) => child.kill(signal);
      return {
        exited: new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 128))),
      };
    };

    try {
      const result = await sm.relaunch!("app-1", { callerTty: PANE_TTY, runInCallerTerminal });
      const agentPid = pidOf("agent.pid");
      const grandchildPid = pidOf("grandchild.pid");
      if (agentPid) ownPids.push(agentPid);
      if (grandchildPid) ownPids.push(grandchildPid);

      expect(result.running).toBe(true);
      expect(agentPid).toBe(childPid);
      // What the CLI does on SIGTERM or SIGHUP: pass it on to its child.
      killChild("SIGTERM");
      await result.child!.exited;
      await vi.waitFor(() => expect(alive(agentPid)).toBe(false), { timeout: 3_000 });
      await vi.waitFor(() => expect(alive(grandchildPid)).toBe(false), { timeout: 3_000 });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 15_000);
});

describe("Review r1 M-1, M-4: a spawn and an orchestrator start store their launch token", () => {
  /** A session manager whose registry also has the workspace plugin, as spawn needs it. */
  const spawningManager = (): SessionManager =>
    createSessionManager({
      config,
      registry: createMockRegistry({
        runtime: plugins.runtime,
        agent: plugins.agent,
        workspace: plugins.workspace,
      }),
    });

  it("gives the agent of a spawn a new token and stores it with the spawn's launch time", async () => {
    const spawned = await spawningManager().spawn({ projectId: "my-app" });

    const record = recordOf(spawned.id)!;
    expect(launchConfigOf().launchToken).toMatch(UUID);
    expect(record["launchToken"]).toBe(launchConfigOf().launchToken);
    expect(record["launchTokenAt"]).toBe(record["createdAt"]);
  });

  it("gives the agent of an orchestrator start a new token and stores it with its launch time", async () => {
    const started = await spawningManager().spawnOrchestrator({ projectId: "my-app" });

    const record = recordOf(started.id)!;
    expect(launchConfigOf().launchToken).toMatch(UUID);
    expect(record["launchToken"]).toBe(launchConfigOf().launchToken);
    expect(record["launchTokenAt"]).toBe(record["createdAt"]);
  });
});

describe("Review r2 M-1: every reader of the agent uses the pane that the record binds", () => {
  /** The agent runs in %2; the selected window of the session shows %3. */
  const AGENT_PANE = "%2";
  const sees = (handle: RuntimeHandle | null | undefined): boolean =>
    agentRunning && handle?.data["agentPane"] === AGENT_PANE;

  function bindTo(sessionId: string, pane: string, at = LONG_AGO()): void {
    updateMetadata(env.sessionsDir, sessionId, {
      restoredAt: at,
      launchToken: THIS_LAUNCH,
      launchTokenAt: at,
      launchPane: pane,
    });
  }

  beforeEach(() => {
    // A process check reads the pane that the handle names; without one it
    // reads the selected window (%3), where the agent never runs.
    vi.mocked(plugins.agent.isProcessRunning).mockImplementation(async (handle) => sees(handle));
    vi.mocked(plugins.agent.getActivityState).mockImplementation(async (session) =>
      sees(session.runtimeHandle) ? { state: "active", timestamp: new Date() } : EXITED,
    );
    extraPanes = [
      { paneId: AGENT_PANE, tty: "/dev/pts/72", foregroundCommand: "bash", shellIdle: true },
    ];
  });

  it("confirms the agent in its bound pane while another window is selected, and two lifecycle polls keep it working", async () => {
    writeRecord("app-1", { status: "killed", killedReason: "agent-exited" });
    bindTo("app-1", AGENT_PANE);

    const result = await sm.relaunch!("app-1");

    expect(result).toMatchObject({ running: true, agentState: "running" });
    expect(vi.mocked(plugins.runtime.runInPane!).mock.calls[0][1]).toBe(AGENT_PANE);
    const after = recordOf("app-1")!;
    expect(after).toMatchObject({ status: "working", launchPane: AGENT_PANE });
    // Out of the launch grace, with the binding kept (the same launch time).
    bindTo("app-1", AGENT_PANE, LONG_AGO());
    lifecycle = createLifecycleManager({
      config,
      registry,
      sessionManager: sm,
      projectId: "my-app",
    });
    await pollOnce(lifecycle);
    await pollOnce(lifecycle);

    expect(recordOf("app-1")).toMatchObject({ status: "working" });
    expect(recordOf("app-1")!["killedReason"]).toBeUndefined();
    // The stored handle never names the pane; only the read session does.
    expect(JSON.parse(recordOf("app-1")!["runtimeHandle"]).data).not.toHaveProperty("agentPane");
    expect((await sm.get("app-1"))?.runtimeHandle?.data["agentPane"]).toBe(AGENT_PANE);
  });

  it("confirms the first relaunch of a one-pane session in that pane, though the owner selects a new window meanwhile", async () => {
    // No binding yet: the session's only pane (%3) is the agent's pane. The
    // owner opens a new window during the relaunch, so a read of the selected
    // window (a handle without the pane) no longer sees the agent.
    writeRecord("app-1", { status: "killed", killedReason: "agent-exited" });
    extraPanes = [];
    vi.mocked(plugins.agent.isProcessRunning).mockImplementation(
      async (handle) => agentRunning && handle?.data["agentPane"] === PANE,
    );

    const result = await sm.relaunch!("app-1");

    expect(result).toMatchObject({ running: true, agentState: "running" });
    expect(recordOf("app-1")).toMatchObject({ status: "working", launchPane: PANE });
  });

  it("names the pane in the session only while the binding counts", async () => {
    writeRecord("app-1");
    expect((await sm.get("app-1"))?.runtimeHandle?.data).not.toHaveProperty("agentPane");
    const at = LONG_AGO();
    bindTo("app-1", AGENT_PANE, at);
    expect((await sm.get("app-1"))?.runtimeHandle?.data["agentPane"]).toBe(AGENT_PANE);
    // A restore moves restoredAt and writes no token: the pane no longer counts.
    updateMetadata(env.sessionsDir, "app-1", {
      restoredAt: new Date(Date.parse(at) + 1_000).toISOString(),
    });
    expect((await sm.get("app-1"))?.runtimeHandle?.data).not.toHaveProperty("agentPane");
  });

  it("refuses before the claim when the agent of the bound pane still runs, though the selected window shows none", async () => {
    writeRecord("app-1");
    bindTo("app-1", AGENT_PANE);
    agentRunning = true;
    const before = recordOf("app-1");

    await expect(sm.relaunch!("app-1")).rejects.toThrow(/its agent process \(mock\) still runs/);
    expect(plugins.runtime.runInPane).not.toHaveBeenCalled();
    expect(recordOf("app-1")).toEqual(before);
  });
});

describe("Review r2 M-4: a bound pane that is gone is not replaced by another pane", () => {
  it.each([
    ["without --continue", {}],
    ["with --continue", { continueConversation: true }],
  ])(
    "refuses %s before the claim and types nothing when only an unrelated idle pane is left",
    async (_name, options) => {
      writeRecord("app-1");
      const at = LONG_AGO();
      updateMetadata(env.sessionsDir, "app-1", {
        restoredAt: at,
        launchToken: THIS_LAUNCH,
        launchTokenAt: at,
        launchPane: "%2",
      });
      // %2 was closed; %3 is an idle shell of another window.
      const lookup = vi.fn(async () => ({ id: CONVERSATION, source: "the hook record" }));
      Object.assign(plugins.agent, { getOwnConversationId: lookup });
      const before = recordOf("app-1");

      const err = await sm.relaunch!("app-1", options).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SessionRelaunchRefusedError);
      expect((err as Error).message).toMatch(
        /the pane %2 of its last launch no longer exists in tmux session h-app-1/,
      );
      expect((err as SessionRelaunchRefusedError).next).toMatch(
        /^start its agent by hand in a pane of the session, or restore it/,
      );
      expect(plugins.runtime.runInPane).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(recordOf("app-1")).toEqual(before);
    },
  );
});

describe("Review r2: the operators that make a launch command not execable", () => {
  it.each([
    ["false || mock-agent"],
    ["mock-agent | tee log"],
    ["mock-agent; echo done"],
    ["mock-agent & wait"],
    ["mock-agent < in"],
    ["mock-agent > out"],
    ["(mock-agent)"],
    ["{ mock-agent; }"],
    ["mock-agent `id`"],
    ["mock-agent\necho done"],
    ["mock-agent $(cat a; cat b)"],
  ])("runs %j as it is, without exec", async (command) => {
    vi.mocked(plugins.agent.getLaunchCommand).mockReturnValue(command);
    writeRecord("app-1");

    await sm.relaunch!("app-1");

    const script = readFileSync(
      scriptOf(vi.mocked(plugins.runtime.runInPane!).mock.calls[0][2]),
      "utf-8",
    );
    expect(script).toContain(`\n${command}\n`);
    expect(script).not.toMatch(/^exec /m);
  });

  it("execs a command whose operators are all in quotes", async () => {
    vi.mocked(plugins.agent.getLaunchCommand).mockReturnValue(
      "mock-agent --prompt 'a | b; c && d'",
    );
    writeRecord("app-1");

    await sm.relaunch!("app-1");

    const script = readFileSync(
      scriptOf(vi.mocked(plugins.runtime.runInPane!).mock.calls[0][2]),
      "utf-8",
    );
    expect(script).toContain("\nexec mock-agent --prompt 'a | b; c && d'\n");
  });
});

describe("Review r2: a background ao in the session's own pane", () => {
  it.each([
    [false, /runs in the background of the session's own pane/],
    [null, /cannot tell whether this ao process is the foreground job/],
  ])(
    "refuses before the claim when the caller's foreground state is %s",
    async (callerForeground, reason) => {
      writeRecord("app-1");
      paneCommand = "ao";
      paneIdle = false;
      const before = recordOf("app-1");
      const run = vi.fn();

      await expect(
        sm.relaunch!("app-1", { callerTty: PANE_TTY, callerForeground, runInCallerTerminal: run }),
      ).rejects.toThrow(reason);
      expect(run).not.toHaveBeenCalled();
      expect(recordOf("app-1")).toEqual(before);
    },
  );
});
