/**
 * Defect reproducers: live sessions persisted as `status=killed`.
 *
 * These tests describe the wanted behavior and fail on 654b3d28. Each one is
 * the unit form of a mechanism measured live in a scratch config with a
 * private tmux server (development/reviews/killed_status_r1_opus.md):
 *
 * - M1: the first poll of a just-launched session whose runtime is alive but
 *   whose agent process is not yet visible maps the agent's `exited` to
 *   `killed` (lifecycle-manager.ts:415-417) and persists it (F1, F1b, F4).
 * - M3: a poll that reads a record before the spawn has written its runtime
 *   handle probes a made-up handle (session-manager.ts:1190-1196), finds it
 *   dead (lifecycle-manager.ts:385-391) and merges `killed` into the record
 *   (F4, F5).
 * - M2: no poll moves a `killed` record back while its runtime and agent run
 *   (lifecycle-manager.ts:1301-1308 and :562-569).
 * - M4: one poll in which every probe fails (tmux server unreachable, or `ps`
 *   failing) persists `killed` for every tracked session (F3).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLifecycleManager } from "../lifecycle-manager.js";
import { createSessionManager } from "../session-manager.js";
import { writeMetadata, readMetadataRaw, reserveSessionId, updateMetadata } from "../metadata.js";
import { generateConfigHash } from "../paths.js";
import type {
  ActivityDetection,
  LifecycleManager,
  OrchestratorConfig,
  PluginRegistry,
  RuntimeHandle,
  SessionManager,
} from "../types.js";
import {
  createTestEnvironment,
  createMockPlugins,
  createMockRegistry,
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

function tmuxNameOf(sessionId: string): string {
  return `${generateConfigHash(config.configPath)}-${sessionId}`;
}

/** The record that a spawn writes after `runtime.create` (spawnOrchestrator / spawn). */
function writeLaunchedRecord(
  sessionId: string,
  status: "working" | "spawning",
  extra: Record<string, string> = {},
): void {
  const tmuxName = tmuxNameOf(sessionId);
  const handle: RuntimeHandle = { id: tmuxName, runtimeName: "mock", data: {} };
  writeMetadata(env.sessionsDir, sessionId, {
    worktree: "/tmp",
    branch: "main",
    status,
    tmuxName,
    project: "my-app",
    agent: "mock-agent",
    createdAt: new Date(Date.now() - 171).toISOString(),
    runtimeHandle: JSON.stringify(handle),
    ...extra,
  });
}

function statusOf(sessionId: string): string | undefined {
  return readMetadataRaw(env.sessionsDir, sessionId)?.["status"];
}

function startLifecycle(intervalMs: number): LifecycleManager {
  lifecycle = createLifecycleManager({ config, registry, sessionManager, projectId: "my-app" });
  lifecycle.start(intervalMs);
  return lifecycle;
}

/** Wait until `isAlive` has been called `count` more times than now. */
async function waitForIsAliveCalls(count: number): Promise<void> {
  const target = vi.mocked(plugins.runtime.isAlive).mock.calls.length + count;
  await vi.waitFor(
    () =>
      expect(vi.mocked(plugins.runtime.isAlive).mock.calls.length).toBeGreaterThanOrEqual(target),
    { timeout: 2_000, interval: 5 },
  );
}

/** What the claude-code plugin returns when no `claude` process is on the pane TTY. */
const EXITED: ActivityDetection = { state: "exited", timestamp: new Date() };
const ACTIVE: ActivityDetection = { state: "active", timestamp: new Date() };

describe("M1: first poll before the agent process is visible (F1, F1b, F4)", () => {
  it.each<{ sessionId: string; status: "working" | "spawning"; extra: Record<string, string> }>([
    { sessionId: "app-orchestrator", status: "working", extra: { role: "orchestrator" } },
    { sessionId: "app-1", status: "spawning", extra: {} },
  ])(
    "does not persist killed for $sessionId 171 ms after launch while its runtime is alive",
    async ({ sessionId, status, extra }) => {
      writeLaunchedRecord(sessionId, status, extra);
      vi.mocked(plugins.runtime.isAlive).mockResolvedValue(true);
      // The pane shell runs; the agent binary has not started yet.
      vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED);

      lifecycle = createLifecycleManager({ config, registry, sessionManager, projectId: "my-app" });
      await lifecycle.check(sessionId);

      expect(statusOf(sessionId)).not.toBe("killed");
    },
  );
});

describe("M3: poll of a record that has no runtime handle yet (F4, F5)", () => {
  /** Alive only under the real tmux name, as a tmux server answers. */
  function aliveOnlyUnderTmuxName(sessionId: string): void {
    vi.mocked(plugins.runtime.isAlive).mockImplementation(
      async (handle: RuntimeHandle) => handle.id === tmuxNameOf(sessionId),
    );
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED);
  }

  it("does not write killed into a reserved record that a spawn still owns", async () => {
    // reserveSessionId without initial: the empty record of a worker spawn and
    // of a project-mode orchestrator spawn, until the launched record is written.
    expect(reserveSessionId(env.sessionsDir, "app-2")).toBe(true);
    aliveOnlyUnderTmuxName("app-2");

    lifecycle = createLifecycleManager({ config, registry, sessionManager, projectId: "my-app" });
    await lifecycle.check("app-2");

    // The poll probed a handle made from the session ID, not the tmux name.
    expect(plugins.runtime.isAlive).toHaveBeenCalledWith(expect.objectContaining({ id: "app-2" }));
    expect(statusOf("app-2")).not.toBe("killed");
  });

  it("does not merge killed into the launched record that the spawn writes during the probe", async () => {
    expect(reserveSessionId(env.sessionsDir, "app-2")).toBe(true);
    aliveOnlyUnderTmuxName("app-2");
    const isAlive = vi.mocked(plugins.runtime.isAlive).getMockImplementation()!;
    let spawnWrote = false;
    vi.mocked(plugins.runtime.isAlive).mockImplementation(async (handle: RuntimeHandle) => {
      // The spawn finishes `runtime.create` and writes its record while the
      // poll still probes the handle it built from the empty record.
      if (!spawnWrote && handle.id === "app-2") {
        spawnWrote = true;
        writeLaunchedRecord("app-2", "spawning");
      }
      return isAlive(handle);
    });

    lifecycle = createLifecycleManager({ config, registry, sessionManager, projectId: "my-app" });
    await lifecycle.check("app-2");

    expect(spawnWrote).toBe(true);
    expect(readMetadataRaw(env.sessionsDir, "app-2")?.["tmuxName"]).toBe(tmuxNameOf("app-2"));
    expect(statusOf("app-2")).not.toBe("killed");
  });
});

describe("M2: a killed record of a live session is never re-evaluated", () => {
  it("moves a killed record back to working once the agent process is visible (same worker)", async () => {
    writeLaunchedRecord("app-orchestrator", "working", { role: "orchestrator" });
    vi.mocked(plugins.runtime.isAlive).mockResolvedValue(true);
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED);

    startLifecycle(20);
    await vi.waitFor(() => expect(statusOf("app-orchestrator")).toBe("killed"), { timeout: 2_000 });
    // The agent starts about one second after the pane shell (F1: 11:19:57.09).
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(ACTIVE);
    await waitForIsAliveCalls(4);

    expect(statusOf("app-orchestrator")).toBe("working");
  });

  it("moves a killed record back to working after a worker restart (F1 orchestrator today)", async () => {
    writeLaunchedRecord("app-orchestrator", "working", { role: "orchestrator" });
    // The record as worker 271579 left it at 15:19:56.246Z.
    updateMetadata(env.sessionsDir, "app-orchestrator", { status: "killed", prAutoDetect: "off" });
    vi.mocked(plugins.runtime.isAlive).mockResolvedValue(true);
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(ACTIVE);

    startLifecycle(20);
    await waitForIsAliveCalls(4);

    expect(statusOf("app-orchestrator")).toBe("working");
  });
});

describe("M4: one poll in which every probe fails (F3)", () => {
  it.each([
    {
      outage: "tmux server unreachable (isAlive false for all)",
      fail: () => vi.mocked(plugins.runtime.isAlive).mockResolvedValue(false),
    },
    {
      outage: "ps fails (runtime alive, agent reported exited for all)",
      fail: () => vi.mocked(plugins.agent.getActivityState).mockResolvedValue(EXITED),
    },
  ])("keeps every live session working after a transient outage: $outage", async ({ fail }) => {
    writeLaunchedRecord("app-1", "working");
    writeLaunchedRecord("app-2", "working");
    writeLaunchedRecord("app-orchestrator", "working", { role: "orchestrator" });
    vi.mocked(plugins.runtime.isAlive).mockResolvedValue(true);
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(ACTIVE);

    const lm = startLifecycle(20);
    await vi.waitFor(() => expect(lm.getStates().size).toBe(3), { timeout: 2_000 });

    // The outage lasts about one poll (F3: 18:56:51Z here, 18:57:03Z in agent-skills).
    fail();
    await waitForIsAliveCalls(12);
    vi.mocked(plugins.runtime.isAlive).mockResolvedValue(true);
    vi.mocked(plugins.agent.getActivityState).mockResolvedValue(ACTIVE);
    await waitForIsAliveCalls(9);

    expect({
      "app-1": statusOf("app-1"),
      "app-2": statusOf("app-2"),
      "app-orchestrator": statusOf("app-orchestrator"),
    }).toEqual({ "app-1": "working", "app-2": "working", "app-orchestrator": "working" });
  });
});
