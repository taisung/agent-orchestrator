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
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
let scripts: string[];

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
  scripts = [];
  Object.assign(plugins.runtime, {
    name: "tmux",
    isAlive: vi.fn().mockResolvedValue(true),
    getPaneState: vi.fn(async () => ({ tty: PANE_TTY, foregroundCommand: paneCommand })),
    runInPane: vi.fn(async (_handle: RuntimeHandle, command: string) => {
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
    expect(launchConfig.systemPromptFile).toBeUndefined();
    expect(launchConfig.continueConversationId).toBeUndefined();

    const command = vi.mocked(plugins.runtime.runInPane!).mock.calls[0][1];
    const lines = readFileSync(scriptOf(command), "utf-8").split("\n");
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
    expect(lines.filter(Boolean).at(-1)).toBe("mock-agent --start");
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
    const command = vi.mocked(plugins.runtime.runInPane!).mock.calls[0][1];
    expect(readFileSync(scriptOf(command), "utf-8")).toContain(
      "export AO_CALLER_TYPE='orchestrator'",
    );
  });
});

describe("R-2: --continue by the session's own conversation ID", () => {
  it("passes the ID that the agent found for this session, with its source", async () => {
    writeRecord("app-1");
    const createdAt = Date.parse(recordOf("app-1")!["createdAt"]);
    plugins.agent.getOwnConversationId = vi
      .fn()
      .mockResolvedValue({ id: CONVERSATION, source: "the hook record" });

    const result = await sm.relaunch!("app-1", { continueConversation: true });

    expect(result.plan.conversation).toEqual({ id: CONVERSATION, source: "the hook record" });
    expect(launchConfigOf().continueConversationId).toBe(CONVERSATION);
    expect(plugins.agent.getOwnConversationId).toHaveBeenCalledWith(
      expect.objectContaining({ id: "app-1", workspacePath: workspaceOf() }),
      { dataDir: env.sessionsDir, launchedAt: new Date(createdAt) },
    );
  });

  it("refuses --continue when the ID is not known, and changes nothing", async () => {
    writeRecord("app-1");
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
      name: "the pane does not exist",
      setup: () => {
        writeRecord("app-1");
        vi.mocked(plugins.runtime.getPaneState!).mockResolvedValue(null);
      },
      reason: /the pane of tmux session h-app-1 does not exist/,
    },
    {
      name: "the pane check rejects",
      setup: () => {
        writeRecord("app-1");
        vi.mocked(plugins.runtime.getPaneState!).mockRejectedValue(new Error("tmux timed out"));
      },
      reason: /the pane check could not tell \(tmux timed out\)/,
    },
    {
      name: "the pane runs another program, not a shell prompt",
      setup: () => {
        writeRecord("app-1");
        paneCommand = "vim";
      },
      reason: /its pane runs vim, not a shell prompt/,
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
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, command) => {
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
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, command) => {
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
    vi.mocked(plugins.runtime.getPaneState!).mockImplementation(async () => {
      arrived += 1;
      if (arrived === 2) release();
      await bothChecked;
      return { tty: PANE_TTY, foregroundCommand: "bash" };
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
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, command) => {
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
    const before = recordOf("app-1")!;
    let script = "";
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, command) => {
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
    expect(existsSync(script)).toBe(false);
  });

  it("clears the claim and restores the launch time when the agent does not appear within the bound", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    writeRecord("app-1", { restoredAt: LONG_AGO() });
    const before = recordOf("app-1")!;
    let started = false;
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, command) => {
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
