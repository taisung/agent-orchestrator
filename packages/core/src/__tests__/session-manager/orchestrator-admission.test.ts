/**
 * Herdr fit-2 F-7 (design development/reviews/herdr_fit2_design_r11_opus.md
 * sections 4.7, 4.9 and 5.3.1; fit-2b commit 5): the classifier table, and
 * the admission refusals that need core's own modules: lock A busy (T-7.24),
 * a platform without the lock (T-7.25, `isDeliveryLockSupported` mocked),
 * and an admission path that cannot be fixed (T-7.25b). The other cases of
 * G run through the built core in runtime-herdr `fit2-admission.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type * as DeliveryLock from "../../delivery-lock.js";

const lockSupport = vi.hoisted(() => ({ supported: true }));

vi.mock("../../delivery-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DeliveryLock>();
  return {
    ...actual,
    isDeliveryLockSupported: (platform?: string) =>
      lockSupport.supported && actual.isDeliveryLockSupported(platform),
  };
});

import { classifyOrchestratorLiveness, createSessionManager } from "../../session-manager.js";
import { admissionLock, tryHoldDeliveryLock } from "../../delivery-lock.js";
import { writeMetadata } from "../../metadata.js";
import { isOrchestratorStartBlockedError } from "../../runtime-errors.js";
import {
  RUNTIME_NO_SERVER_ERROR_CODE,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type RuntimeHandle,
} from "../../types.js";
import {
  setupTestContext,
  teardownTestContext,
  makeHandle,
  type TestContext,
} from "../test-utils.js";

let ctx: TestContext;
let sessionsDir: string;
let mockRuntime: Runtime;
let mockRegistry: PluginRegistry;
let config: OrchestratorConfig;

beforeEach(() => {
  lockSupport.supported = true;
  ctx = setupTestContext();
  ({ sessionsDir, mockRuntime, mockRegistry, config } = ctx);
});

afterEach(() => {
  lockSupport.supported = true;
  teardownTestContext(ctx);
});

const HERDR_HANDLE: RuntimeHandle = {
  id: "w3:p2",
  runtimeName: "herdr",
  data: { workspaceId: "w3", paneId: "w3:p2", terminalId: "term_a" },
};

function noServer(): Error {
  return Object.assign(new Error("no server answers"), { code: RUNTIME_NO_SERVER_ERROR_CODE });
}

/** A runtime of `name` whose isAlive does what `answer` does. */
function runtimeNamed(name: string, answer: () => Promise<unknown>): Runtime {
  return { ...mockRuntime, name, isAlive: vi.fn(answer) as Runtime["isAlive"] };
}

/** A registry whose runtime of the project is a stand-in named herdr. */
function herdrRegistry(): { registry: PluginRegistry; runtime: Runtime } {
  const runtime: Runtime = { ...mockRuntime, name: "herdr" };
  const registry = {
    ...mockRegistry,
    get: vi.fn((slot: string, name: string) =>
      slot === "runtime" && name === "herdr" ? runtime : mockRegistry.get(slot as never, name),
    ),
  } as unknown as PluginRegistry;
  return { registry, runtime };
}

describe("classifyOrchestratorLiveness (design r11 4.7)", () => {
  const rows: Array<[string, () => Promise<unknown>, string, string]> = [
    ["isAlive true", async () => true, "alive", "alive"],
    ["isAlive false", async () => false, "ended", "unknown"],
    ["the no-server code", async () => Promise.reject(noServer()), "ended", "unknown"],
    ["another rejection", async () => Promise.reject(new Error("timed out")), "unknown", "unknown"],
    ["an answer that is not a boolean", async () => undefined, "unknown", "unknown"],
  ];
  for (const [label, answer, outside, inSet] of rows) {
    it(`${label}: ${outside} outside the set, ${inSet} for herdr`, async () => {
      const tmux = await classifyOrchestratorLiveness(
        runtimeNamed("tmux", answer),
        makeHandle("t-1"),
      );
      expect(tmux.state).toBe(outside);
      const herdr = await classifyOrchestratorLiveness(runtimeNamed("herdr", answer), HERDR_HANDLE);
      expect(herdr.state).toBe(inSet);
    });
  }

  it("no plugin is unknown for both", async () => {
    expect(await classifyOrchestratorLiveness(null, makeHandle("t-1"))).toMatchObject({
      state: "unknown",
      reason: "no mock runtime plugin is loaded",
    });
    expect(await classifyOrchestratorLiveness(null, HERDR_HANDLE)).toMatchObject({
      state: "unknown",
      reason: "no herdr runtime plugin is loaded",
    });
  });

  it("no answer within the bound is unknown, with the bound in the reason", async () => {
    const hangs = runtimeNamed("herdr", () => new Promise(() => undefined));
    expect(await classifyOrchestratorLiveness(hangs, HERDR_HANDLE, 30)).toEqual({
      state: "unknown",
      reason: "the herdr check did not answer within 0.03 s",
    });
  });

  it("the reasons of message M for herdr", async () => {
    const reasonOf = async (answer: () => Promise<unknown>) =>
      (
        (await classifyOrchestratorLiveness(runtimeNamed("herdr", answer), HERDR_HANDLE)) as {
          reason?: string;
        }
      ).reason;
    expect(await reasonOf(async () => false)).toBe(
      "herdr answered that the pane does not exist or that it has another terminal",
    );
    expect(await reasonOf(async () => Promise.reject(noServer()))).toBe(
      "no herdr server answers at the socket",
    );
    expect(await reasonOf(async () => Promise.reject(new Error("line one\nline two")))).toBe(
      "the herdr check failed: line one",
    );
  });
});

describe("T-7.24: lock A is busy", () => {
  it("admission-busy with waitMs 50; nothing written", async () => {
    config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
    const { registry, runtime } = herdrRegistry();
    config.projects["my-app"]!.runtime = "herdr";
    const { name } = admissionLock(sessionsDir, "my-app");
    const held = await tryHoldDeliveryLock(name);
    expect(held).not.toBeNull();
    try {
      const sm = createSessionManager({ config, registry, admission: { waitMs: 50 } });
      const err = await sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);
      expect(isOrchestratorStartBlockedError(err)).toBe(true);
      expect(err).toMatchObject({ reason: "admission-busy", projectId: "my-app" });
      expect((err as Error).message).toBe(
        "Another ao process is admitting an orchestrator for project my-app now. Run ao start again after it ends.",
      );
      expect(readdirSync(sessionsDir)).toEqual([]);
      expect(runtime.create).not.toHaveBeenCalled();
      expect(runtime.isAlive).not.toHaveBeenCalled();
    } finally {
      held?.release();
    }
  });
});

describe("T-7.25: a platform without the admission lock", () => {
  beforeEach(() => {
    lockSupport.supported = false;
  });

  it("a start whose create runtime is herdr: admission-unsupported; nothing written", async () => {
    const { registry, runtime } = herdrRegistry();
    config.projects["my-app"]!.runtime = "herdr";
    const sm = createSessionManager({ config, registry });
    const err = await sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: "admission-unsupported" });
    expect((err as Error).message).toBe(
      "This platform has no admission lock; AO starts no herdr orchestrator here.",
    );
    expect(readdirSync(sessionsDir)).toEqual([]);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(ctx.mockWorkspace.create).not.toHaveBeenCalled();
  });

  it("a mock start whose G1 selects a Herdr record: admission-unsupported", async () => {
    writeMetadata(sessionsDir, "app-orchestrator", {
      worktree: config.projects["my-app"]!.path,
      branch: "main",
      status: "working",
      role: "orchestrator",
      project: "my-app",
      runtimeHandle: JSON.stringify(HERDR_HANDLE),
    });
    const sm = createSessionManager({ config, registry: mockRegistry });
    const err = await sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: "admission-unsupported" });
    expect(readdirSync(sessionsDir)).toEqual(["app-orchestrator"]);
    expect(mockRuntime.create).not.toHaveBeenCalled();
    expect(mockRuntime.isAlive).not.toHaveBeenCalled();
  });

  it("control: a mock start with no Herdr record runs as today", async () => {
    vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-new"));
    const sm = createSessionManager({ config, registry: mockRegistry });
    const session = await sm.spawnOrchestrator({ projectId: "my-app" });
    expect(session.id).toBe("app-orchestrator-1");
    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
  });

  it("control: the reuse-only decision runs without A and finds none", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });
    await expect(sm.findReusableOrchestrators?.("my-app")).resolves.toEqual([]);
  });
});

describe("T-7.25b: an admission path that AO cannot fix", () => {
  for (const [label, make] of [
    [
      "a file where a component of the sessions directory must be",
      (path: string) => writeFileSync(path, ""),
    ],
    [
      "a dangling symlink as a component",
      (path: string) => symlinkSync(join(dirname(path), "gone"), path),
    ],
  ] as const) {
    it(`${label}: admission-path; nothing written; zero workspace create`, async () => {
      const { registry, runtime } = herdrRegistry();
      config.projects["my-app"]!.runtime = "herdr";
      const component = dirname(sessionsDir);
      rmSync(component, { recursive: true, force: true });
      mkdirSync(dirname(component), { recursive: true });
      make(component);
      const sm = createSessionManager({ config, registry });
      const err = await sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);
      expect(isOrchestratorStartBlockedError(err)).toBe(true);
      expect(err).toMatchObject({ reason: "admission-path" });
      expect((err as Error).message).toMatch(
        /^AO cannot fix the admission path of project my-app \(E[A-Z]+ at .+\); no orchestrator was started\.$/,
      );
      expect(existsSync(sessionsDir)).toBe(false);
      expect(runtime.create).not.toHaveBeenCalled();
      expect(ctx.mockWorkspace.create).not.toHaveBeenCalled();
      rmSync(component, { force: true });
    });
  }
});
