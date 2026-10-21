/**
 * Same-ID R2a: the lifecycle gate (design r2 section 2.7). While the runtime
 * probe of a session fails, an agent negative ("exited", or
 * isProcessRunning() false) keeps the status and the probe outcome stays
 * "failed"; agent positives still classify. An agent negative counts only
 * after a runtime positive, and the two-negative confirmation stays.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSessionManager } from "../session-manager.js";
import { createLifecycleManager } from "../lifecycle-manager.js";
import { readObservabilitySummary } from "../observability.js";
import { readMetadataRaw, writeMetadata } from "../metadata.js";
import { generateConfigHash } from "../paths.js";
import { isRuntimeStopUnconfirmedError } from "../runtime-stop.js";
import {
  LAUNCH_GRACE_MS,
  type ActivityDetection,
  type LifecycleManager,
  type PluginRegistry,
  type Runtime,
  type RuntimeHandle,
} from "../types.js";
import {
  createMockPlugins,
  createMockRegistry,
  createTestEnvironment,
  type TestEnvironment,
} from "./test-utils.js";

const AGENTS = ["claude-code", "codex", "gemini", "opencode"] as const;

/** The rejection of a tmux probe that could not answer (not "no server"). */
function probeError(): Error {
  return Object.assign(new Error("tmux could not answer: server exited unexpectedly"), {
    code: "ERR_RUNTIME_PROBE",
  });
}

let env: TestEnvironment;
let lifecycle: LifecycleManager | null = null;

beforeEach(() => {
  env = createTestEnvironment();
});

afterEach(() => {
  lifecycle?.stop();
  lifecycle = null;
  vi.restoreAllMocks();
  env.cleanup();
});

function handleOf(sessionId: string): RuntimeHandle {
  return {
    id: `${generateConfigHash(env.config.configPath)}-${sessionId}`,
    runtimeName: "tmux",
    data: {},
  };
}

function writeRecord(sessionId: string): void {
  const handle = handleOf(sessionId);
  writeMetadata(env.sessionsDir, sessionId, {
    worktree: "/tmp",
    branch: "main",
    status: "working",
    tmuxName: handle.id,
    project: "my-app",
    createdAt: new Date(Date.now() - LAUNCH_GRACE_MS - 60_000).toISOString(),
    runtimeHandle: JSON.stringify(handle),
  });
}

function status(sessionId: string): string {
  return readMetadataRaw(env.sessionsDir, sessionId)?.["status"] ?? "(none)";
}

/** What the probes of app-1 answer; app-2 is a second session of the fleet. */
interface Probes {
  runtime: "fails" | "alive";
  /** How app-1's agent says it is gone ("exited", or isProcessRunning false), or active. */
  agent: "exited" | "process gone" | "active" | "waiting_input";
  /** app-2's runtime probe; failing too makes the poll record every outcome. */
  app2Runtime: "fails" | "alive";
}

interface Fleet {
  lm: LifecycleManager;
  probes: Probes;
  runtime: Runtime;
  registry: PluginRegistry;
}

function startFleet(agentName: string, probes: Probes): Fleet {
  writeRecord("app-1");
  writeRecord("app-2");
  const plugins = createMockPlugins();
  const runtime: Runtime = { ...plugins.runtime, name: "tmux", getMetrics: vi.fn() };
  const agent = { ...plugins.agent, name: agentName };
  vi.mocked(runtime.isAlive).mockImplementation(async (handle: RuntimeHandle) => {
    const own = handle.id === handleOf("app-1").id ? probes.runtime : probes.app2Runtime;
    if (own === "fails") throw probeError();
    return true;
  });
  vi.mocked(agent.getActivityState).mockImplementation(async (session) => {
    if (session.id !== "app-1") return { state: "active" };
    if (probes.agent === "exited") return { state: "exited", timestamp: new Date() };
    if (probes.agent === "process gone") return null;
    return { state: probes.agent } as ActivityDetection;
  });
  vi.mocked(agent.isProcessRunning).mockImplementation(
    async (handle: RuntimeHandle) =>
      handle.id !== handleOf("app-1").id ||
      (probes.agent !== "exited" && probes.agent !== "process gone"),
  );
  const registry = createMockRegistry({ runtime, agent });
  const sessionManager = createSessionManager({ config: env.config, registry });
  lifecycle = createLifecycleManager({
    config: env.config,
    registry,
    sessionManager,
    projectId: "my-app",
  });
  return { lm: lifecycle, probes, runtime, registry };
}

function workerHealth() {
  return readObservabilitySummary(env.config).projects["my-app"]?.health["lifecycle.worker"];
}

async function pollOnce(lm: LifecycleManager): Promise<void> {
  const before = workerHealth()?.correlationId;
  lm.start(3_600_000);
  lm.stop();
  await vi.waitFor(() => expect(workerHealth()?.correlationId).not.toBe(before), {
    timeout: 2_000,
    interval: 5,
  });
}

/** The probe outcome of app-1 in the last poll (recorded when no session answered alive). */
function app1Outcome(): unknown {
  const details = workerHealth()?.details as
    | { probeOutcomes?: Record<string, unknown> }
    | undefined;
  return details?.probeOutcomes?.["app-1"];
}

describe("the lifecycle gate: a failing runtime probe plus an agent negative", () => {
  for (const agentName of AGENTS) {
    for (const negative of ["exited", "process gone"] as const) {
      it(`${agentName}, ${negative}: 10 polls stay working and the outcome stays failed`, async () => {
        const { lm } = startFleet(agentName, {
          runtime: "fails",
          agent: negative,
          app2Runtime: "fails",
        });

        for (let poll = 1; poll <= 10; poll++) {
          await pollOnce(lm);
          expect(status("app-1"), `poll ${poll}`).toBe("working");
          expect(app1Outcome(), `poll ${poll}`).toBe("failed");
        }
        expect(status("app-2")).toBe("working");
      });
    }

    it(`${agentName}: the runtime answers again, and the normal classification comes back`, async () => {
      const fleet = startFleet(agentName, {
        runtime: "fails",
        agent: "exited",
        app2Runtime: "alive",
      });
      for (let poll = 0; poll < 10; poll++) await pollOnce(fleet.lm);
      expect(status("app-1")).toBe("working");

      // The runtime answers alive: the agent's "exited" counts again, and the
      // two-negative rule applies from this poll on.
      fleet.probes.runtime = "alive";
      await pollOnce(fleet.lm);
      expect(status("app-1"), "the first negative after the runtime answered").toBe("working");
      await pollOnce(fleet.lm);
      expect(status("app-1"), "the second negative in a row").toBe("killed");
      expect(status("app-2")).toBe("working");
    });

    it(`${agentName}: a runtime positive plus two agent negatives reaches killed at the second poll`, async () => {
      const { lm } = startFleet(agentName, {
        runtime: "alive",
        agent: "process gone",
        app2Runtime: "alive",
      });

      await pollOnce(lm);
      expect(status("app-1")).toBe("working");
      await pollOnce(lm);
      expect(status("app-1")).toBe("killed");
    });

    it(`${agentName}: an agent positive still classifies while the runtime probe fails`, async () => {
      const { lm } = startFleet(agentName, {
        runtime: "fails",
        agent: "waiting_input",
        app2Runtime: "alive",
      });

      await pollOnce(lm);
      expect(status("app-1")).toBe("needs_input");
    });
  }

  it("a negative between failing probes starts no run: alternating answers never reach killed", async () => {
    const fleet = startFleet("codex", { runtime: "alive", agent: "exited", app2Runtime: "alive" });
    for (let poll = 0; poll < 6; poll++) {
      fleet.probes.runtime = poll % 2 === 0 ? "alive" : "fails";
      await pollOnce(fleet.lm);
      expect(status("app-1"), `poll ${poll + 1}`).toBe("working");
    }
  });

  it("a stored handle that no runtime plugin can probe: an agent negative keeps the status", async () => {
    writeRecord("app-1");
    const plugins = createMockPlugins();
    const agent = { ...plugins.agent, name: "codex" };
    vi.mocked(agent.getActivityState).mockResolvedValue({ state: "exited" });
    const base = createMockRegistry({ runtime: plugins.runtime, agent });
    const registry: PluginRegistry = {
      ...base,
      get: vi.fn((slot: string, name?: string) =>
        slot === "runtime" ? null : base.get(slot as never, name as never),
      ) as PluginRegistry["get"],
    };
    const sessionManager = createSessionManager({ config: env.config, registry });
    lifecycle = createLifecycleManager({
      config: env.config,
      registry,
      sessionManager,
      projectId: "my-app",
    });

    for (let poll = 0; poll < 3; poll++) await pollOnce(lifecycle);
    expect(status("app-1")).toBe("working");
  });
});

describe("a kill that refuses does not stop the poll loop", () => {
  it("the session stays, and the next polls decide again", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fleet = startFleet("codex", { runtime: "alive", agent: "active", app2Runtime: "alive" });
    fleet.runtime.stop = vi.fn(async () => ({
      outcome: "unknown" as const,
      detail: "the runtime server did not answer",
    }));
    await pollOnce(fleet.lm);
    const sessionManager = createSessionManager({ config: env.config, registry: fleet.registry });

    const refusal = await sessionManager.kill("app-1").then(
      () => null,
      (err: unknown) => err,
    );

    expect(isRuntimeStopUnconfirmedError(refusal)).toBe(true);
    expect(status("app-1")).toBe("working");
    // The loop goes on: the next polls run and decide again from the probes.
    fleet.probes.agent = "exited";
    await pollOnce(fleet.lm);
    expect(status("app-1")).toBe("working");
    await pollOnce(fleet.lm);
    expect(status("app-1")).toBe("killed");
    expect(status("app-2")).toBe("working");
  });
});
