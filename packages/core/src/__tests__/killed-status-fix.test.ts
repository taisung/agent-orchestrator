/**
 * The lifecycle rules that keep a live session from being persisted as
 * `status=killed` (development/reviews/killed_status_r1_opus.md, fix A+B+C):
 *
 * - A: an agent that is not yet visible within LAUNCH_GRACE_MS of its launch
 *   or restore keeps its status while the runtime is not known dead.
 * - B: the poll probes only a handle that the record stores, and writes a
 *   status only when the record still holds the status and handle it read.
 * - C1: a negative probe persists killed only when the next poll confirms it.
 * - C2: a poll in which every probed session (two or more) answers dead is a
 *   probe outage: nothing is persisted and the worker health is `warn`.
 * - C3: each killed carries `killedReason`; a probe-driven kill goes back to
 *   working when the runtime is alive and the agent process runs.
 *
 * Each test drives the real session manager over a scratch record directory;
 * only the plugins are mocks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLifecycleManager } from "../lifecycle-manager.js";
import { createSessionManager } from "../session-manager.js";
import { readObservabilitySummary } from "../observability.js";
import { writeMetadata, readMetadataRaw, updateMetadata, deleteMetadata } from "../metadata.js";
import { generateConfigHash } from "../paths.js";
import {
  LAUNCH_GRACE_MS,
  type ActivityDetection,
  type LifecycleManager,
  type OrchestratorConfig,
  type PluginRegistry,
  type RuntimeHandle,
  type SCM,
  type SessionManager,
} from "../types.js";
import {
  createTestEnvironment,
  createMockPlugins,
  createMockRegistry,
  createMockSCM,
  type TestEnvironment,
  type MockPlugins,
} from "./test-utils.js";

let env: TestEnvironment;
let plugins: MockPlugins;
let registry: PluginRegistry;
let config: OrchestratorConfig;
let sessionManager: SessionManager;
let lifecycle: LifecycleManager | null;

beforeEach(() => {
  env = createTestEnvironment();
  plugins = createMockPlugins();
  registry = createMockRegistry({ runtime: plugins.runtime, agent: plugins.agent });
  config = env.config;
  sessionManager = createSessionManager({ config, registry });
  lifecycle = null;
});

afterEach(() => {
  lifecycle?.stop();
  env.cleanup();
});

const EXITED: ActivityDetection = { state: "exited", timestamp: new Date() };
const ACTIVE: ActivityDetection = { state: "active", timestamp: new Date() };

/** A launch time older than the launch grace. */
const LONG_AGO = () => new Date(Date.now() - LAUNCH_GRACE_MS - 60_000).toISOString();

function handleOf(sessionId: string): RuntimeHandle {
  return {
    id: `${generateConfigHash(config.configPath)}-${sessionId}`,
    runtimeName: "mock",
    data: {},
  };
}

/** The record that a spawn writes after `runtime.create`, plus `fields` ("" removes a key). */
function writeRecord(sessionId: string, fields: Record<string, string> = {}): void {
  const handle = handleOf(sessionId);
  writeMetadata(env.sessionsDir, sessionId, {
    worktree: "/tmp",
    branch: "main",
    status: "working",
    tmuxName: handle.id,
    project: "my-app",
    agent: "mock-agent",
    createdAt: LONG_AGO(),
    runtimeHandle: JSON.stringify(handle),
  });
  // writeMetadata keeps only its known keys; a merge keeps any key (killedReason).
  updateMetadata(env.sessionsDir, sessionId, fields);
}

/** Alive for every session except those in `dead`. */
function aliveExcept(...dead: string[]): void {
  const deadIds = new Set(dead.map((id) => handleOf(id).id));
  vi.mocked(plugins.runtime.isAlive).mockImplementation(
    async (handle: RuntimeHandle) => !deadIds.has(handle.id),
  );
}

function recordOf(sessionId: string): Record<string, string> {
  return readMetadataRaw(env.sessionsDir, sessionId) ?? {};
}

function newLifecycle(): LifecycleManager {
  lifecycle = createLifecycleManager({ config, registry, sessionManager, projectId: "my-app" });
  return lifecycle;
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

describe("C1: a negative probe is persisted only when the next poll confirms it", () => {
  it("kills an agent that exited after the launch grace at the second poll, not the first", async () => {
    writeRecord("app-1");
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED);
    const lm = newLifecycle();

    await pollOnce(lm);
    expect(recordOf("app-1")["status"]).toBe("working");

    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "agent-exited" });
    // The agent-exited kill does not relaunch the pane.
    expect(plugins.runtime.create).not.toHaveBeenCalled();
  });

  it("kills a session whose runtime is gone at the second poll, not the first", async () => {
    writeRecord("app-1");
    const lm = newLifecycle();
    // The worker tracks the session while it is alive (a worker does not
    // check a session that list() already reports dead at its first poll).
    await pollOnce(lm);

    vi.mocked(plugins.runtime.isAlive).mockResolvedValue(false);
    await pollOnce(lm);
    expect(recordOf("app-1")["status"]).toBe("working");

    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
  });

  it("does not persist a one-poll negative of one session when the next poll is positive", async () => {
    writeRecord("app-1");
    const lm = newLifecycle();
    await pollOnce(lm);

    vi.mocked(plugins.runtime.isAlive).mockResolvedValue(false);
    await pollOnce(lm);
    vi.mocked(plugins.runtime.isAlive).mockResolvedValue(true);
    await pollOnce(lm);
    // A new negative starts over: the positive poll cleared the pending kill.
    vi.mocked(plugins.runtime.isAlive).mockResolvedValue(false);
    await pollOnce(lm);

    expect(recordOf("app-1")["status"]).toBe("working");
    expect(recordOf("app-1")["killedReason"]).toBeUndefined();
  });

  it("needs two polls again after a worker restart", async () => {
    writeRecord("app-1");
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED);

    await pollOnce(newLifecycle());
    lifecycle?.stop();
    await pollOnce(newLifecycle());
    expect(recordOf("app-1")["status"]).toBe("working");
  });
});

describe("C2: a poll in which every probed session answers dead is a probe outage", () => {
  it.each([
    {
      outage: "runtime probe answers dead",
      fail: () => vi.mocked(plugins.runtime.isAlive).mockResolvedValue(false),
    },
    {
      outage: "agent reported exited",
      fail: () => vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED),
    },
  ])(
    "persists nothing for two sessions across two polls ($outage) and sets warn",
    async ({ fail }) => {
      writeRecord("app-1");
      writeRecord("app-2");
      const lm = newLifecycle();
      await pollOnce(lm);

      fail();
      await pollOnce(lm);
      await pollOnce(lm);

      expect([recordOf("app-1")["status"], recordOf("app-2")["status"]]).toEqual([
        "working",
        "working",
      ]);
      expect(workerHealth()).toMatchObject({
        status: "warn",
        reason: expect.stringContaining("probe outage"),
        details: expect.objectContaining({ probeOutageSessions: ["app-1", "app-2"] }),
      });

      vi.mocked(plugins.runtime.isAlive).mockResolvedValue(true);
      vi.mocked(plugins.agent.getActivityState).mockResolvedValue(ACTIVE);
      await pollOnce(lm);
      expect(workerHealth()?.status).toBe("ok");
    },
  );

  it("still kills one dead session among live ones after two polls", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    const lm = newLifecycle();
    await pollOnce(lm);

    aliveExcept("app-1");
    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
    expect(recordOf("app-2")["status"]).toBe("working");
    expect(workerHealth()?.status).toBe("ok");
  });

  it("does not count killed records toward an outage", async () => {
    // One live session that really died, next to an old probe-driven kill.
    writeRecord("app-1");
    writeRecord("app-2", { status: "killed", killedReason: "runtime" });
    aliveExcept("app-2");
    const lm = newLifecycle();
    await pollOnce(lm);

    aliveExcept("app-1", "app-2");
    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
  });
});

describe("C3: killedReason and the recovery of a probe-driven kill", () => {
  it("moves a killed record with killedReason=agent-exited and a running agent back to working", async () => {
    writeRecord("app-1", { status: "killed", killedReason: "agent-exited" });
    const lm = newLifecycle();

    await pollOnce(lm);

    expect(recordOf("app-1")["status"]).toBe("working");
    expect(recordOf("app-1")["killedReason"]).toBeUndefined();
  });

  it("moves a killed record with no killedReason and no pr back to working (the real orchestrator records)", async () => {
    writeRecord("app-orchestrator", {
      status: "killed",
      role: "orchestrator",
      prAutoDetect: "off",
    });
    const lm = newLifecycle();

    await pollOnce(lm);

    expect(recordOf("app-orchestrator")).toMatchObject({ status: "working", prAutoDetect: "off" });
  });

  it.each([
    {
      reason: "runtime alive, agent process not running",
      alive: true,
      running: false,
      exited: false,
    },
    { reason: "runtime gone", alive: false, running: true, exited: false },
    { reason: "agent reported exited", alive: true, running: true, exited: true },
  ])(
    "keeps a recoverable killed record killed when $reason",
    async ({ alive, running, exited }) => {
      writeRecord("app-1", { status: "killed", killedReason: "agent-exited" });
      vi.mocked(plugins.runtime.isAlive).mockResolvedValue(alive);
      vi.mocked(plugins.agent.isProcessRunning).mockResolvedValue(running);
      if (exited) vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED);
      const lm = newLifecycle();

      await pollOnce(lm);
      await pollOnce(lm);

      expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "agent-exited" });
    },
  );

  it("writes killedReason=pr-closed at once when the PR is closed, and never recovers it", async () => {
    const scm: SCM = createMockSCM({ getPRState: vi.fn().mockResolvedValue("closed") });
    registry = createMockRegistry({ runtime: plugins.runtime, agent: plugins.agent, scm });
    sessionManager = createSessionManager({ config, registry });
    writeRecord("app-1", { status: "pr_open", pr: "https://github.com/org/my-app/pull/7" });
    const lm = newLifecycle();

    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "pr-closed" });

    // Runtime alive and agent running: a pr-closed kill stays killed.
    await pollOnce(lm);
    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "pr-closed" });
  });

  it.each<{ status: string; fields: Record<string, string> }>([
    { status: "killed", fields: { killedReason: "pr-closed" } },
    { status: "killed", fields: { pr: "https://github.com/org/my-app/pull/7" } },
    { status: "merged", fields: {} },
    { status: "done", fields: {} },
    { status: "terminated", fields: {} },
    { status: "cleanup", fields: {} },
    { status: "errored", fields: {} },
  ])("never moves a $status record with $fields", async ({ status, fields }) => {
    writeRecord("app-1", { status, ...fields });
    const before = recordOf("app-1");
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")).toEqual(before);
  });
});

describe("B: compare-and-set of the status write", () => {
  it("writes nothing when a restore changes the record during the confirming probe", async () => {
    writeRecord("app-1");
    const lm = newLifecycle();
    await pollOnce(lm);
    vi.mocked(plugins.runtime.isAlive).mockResolvedValue(false);
    await pollOnce(lm);

    // The next poll confirms the kill, but a restore writes a new handle and
    // status=spawning after the poll read the record, while it probes the old handle.
    const restoredHandle: RuntimeHandle = { id: "rt-restored", runtimeName: "mock", data: {} };
    let restored = false;
    vi.mocked(plugins.runtime.isAlive).mockImplementation(async (handle: RuntimeHandle) => {
      if (handle.id === restoredHandle.id) return true;
      if (!restored) {
        restored = true;
        updateMetadata(env.sessionsDir, "app-1", {
          status: "spawning",
          runtimeHandle: JSON.stringify(restoredHandle),
          restoredAt: new Date().toISOString(),
        });
      }
      return false;
    });
    await pollOnce(lm);

    expect(restored).toBe(true);
    expect(recordOf("app-1")).toMatchObject({
      status: "spawning",
      runtimeHandle: JSON.stringify(restoredHandle),
    });
    expect(recordOf("app-1")["killedReason"]).toBeUndefined();

    // The next poll decides from the new record: the restored pane is alive.
    await pollOnce(lm);
    expect(recordOf("app-1")["status"]).toBe("working");
  });

  it("never recreates a record that a kill archived during the poll", async () => {
    // spawning -> working is a write that the poll wants to make.
    writeRecord("app-1", { status: "spawning" });
    vi.mocked(plugins.agent.getActivityState).mockImplementation(async () => {
      // `ao session kill` archives the record after the poll read it.
      deleteMetadata(env.sessionsDir, "app-1", true);
      return ACTIVE;
    });
    const lm = newLifecycle();

    await pollOnce(lm);

    expect(readMetadataRaw(env.sessionsDir, "app-1")).toBeNull();
  });
});

describe("A: launch grace", () => {
  it("keeps a just-launched session whose agent is not visible yet over several polls", async () => {
    writeRecord("app-1", { status: "spawning", createdAt: new Date().toISOString() });
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED);
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")["status"]).toBe("spawning");
  });

  it("measures the grace from restoredAt when the record has one", async () => {
    writeRecord("app-1", { restoredAt: new Date().toISOString() });
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED);
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")["status"]).toBe("working");
  });

  it("applies the grace to the terminal fallback too", async () => {
    writeRecord("app-1", { createdAt: new Date().toISOString() });
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(null);
    vi.mocked(plugins.agent.isProcessRunning).mockResolvedValue(false);
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")["status"]).toBe("working");
  });

  it("gives no grace to a record that has neither createdAt nor restoredAt", async () => {
    writeRecord("app-1", { createdAt: "" });
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED);
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "agent-exited" });
  });

  it("does not hold back a runtime that is gone during the grace", async () => {
    writeRecord("app-1", { createdAt: new Date().toISOString() });
    const lm = newLifecycle();
    await pollOnce(lm);

    vi.mocked(plugins.runtime.isAlive).mockResolvedValue(false);
    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
  });
});

describe("D: a rejected probe is unknown at each lifecycle caller", () => {
  const unreachable = () =>
    Object.assign(new Error("no server running"), { code: "ERR_RUNTIME_NO_SERVER" });

  it("never kills on a rejected isAlive", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    vi.mocked(plugins.runtime.isAlive).mockRejectedValue(unreachable());
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);
    await pollOnce(lm);

    expect([recordOf("app-1")["status"], recordOf("app-2")["status"]]).toEqual([
      "working",
      "working",
    ]);
    expect(plugins.runtime.create).not.toHaveBeenCalled();
    // The worker cannot see its sessions: the health says so.
    expect(workerHealth()).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("no probed session could be confirmed alive"),
      details: expect.objectContaining({ probeOutageSessions: ["app-1", "app-2"] }),
    });
  });

  it("never kills on a rejected isProcessRunning in the terminal fallback (ps fails)", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(null);
    vi.mocked(plugins.agent.isProcessRunning).mockRejectedValue(new Error("ps failed"));
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);

    expect([recordOf("app-1")["status"], recordOf("app-2")["status"]]).toEqual([
      "working",
      "working",
    ]);
    expect(workerHealth()?.status).toBe("warn");
  });

  it("keeps the health ok when the probe of only one session is rejected", async () => {
    writeRecord("app-1");
    vi.mocked(plugins.runtime.isAlive).mockRejectedValue(unreachable());
    const lm = newLifecycle();

    await pollOnce(lm);

    expect(recordOf("app-1")["status"]).toBe("working");
    expect(workerHealth()?.status).toBe("ok");
  });

  it("never moves a killed record on a rejected probe", async () => {
    writeRecord("app-1", { status: "killed", killedReason: "runtime" });
    vi.mocked(plugins.runtime.isAlive).mockRejectedValue(unreachable());
    const lm = newLifecycle();

    await pollOnce(lm);

    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
  });
});
