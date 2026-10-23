/**
 * Herdr fit-2 F-3 (design r11 5.1, T-3.6): a send that the runtime refuses
 * because the agent is blocked (RuntimeSendRefusedError) reaches the caller
 * unchanged. Core does not restore the session for it: a restore would not
 * answer the agent's question, and the operator answers it in the pane. Every
 * other send error keeps the one restore retry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { writeMetadata } from "../../metadata.js";
import { RuntimeSendRefusedError, isRuntimeSendRefusedError } from "../../runtime-errors.js";
import type { Agent, OrchestratorConfig, PluginRegistry, Runtime } from "../../types.js";
import {
  setupTestContext,
  teardownTestContext,
  makeHandle,
  type TestContext,
} from "../test-utils.js";

let ctx: TestContext;
let mockRuntime: Runtime;
let mockAgent: Agent;
let mockRegistry: PluginRegistry;
let config: OrchestratorConfig;
let dead: boolean;

beforeEach(() => {
  ctx = setupTestContext();
  ({ mockRuntime, mockAgent, mockRegistry, config } = ctx);
  const worktree = join(ctx.tmpDir, "ws-app-1");
  mkdirSync(worktree, { recursive: true });
  writeMetadata(ctx.sessionsDir, "app-1", {
    worktree,
    branch: "feat/TEST-1",
    status: "working",
    project: "my-app",
    runtimeHandle: JSON.stringify(makeHandle("rt-1")),
  });
  // The first send makes the old runtime look dead, so a restore retry, when
  // it runs, finds the session restorable and sends again on a new runtime.
  dead = false;
  vi.mocked(mockRuntime.isAlive).mockImplementation(
    async (handle) => !(dead && handle.id === "rt-1"),
  );
  vi.mocked(mockAgent.isProcessRunning).mockImplementation(
    async (handle) => !(dead && handle.id === "rt-1"),
  );
  vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-restored"));
  vi.mocked(mockRuntime.getOutput).mockResolvedValue("output");
});

afterEach(() => {
  teardownTestContext(ctx);
});

describe("send with a blocked agent (fit-2 F-3, T-3.6)", () => {
  for (const admitted of ["none", "earlier-attempt-unconfirmed"] as const) {
    it(`rethrows the refusal (admitted ${admitted}) with no restore`, async () => {
      const refusal = new RuntimeSendRefusedError("herdr agent in pane w7:p1 is blocked", {
        admitted,
        target: "w7:p1",
        stage: "first settle wait",
      });
      vi.mocked(mockRuntime.sendMessage).mockImplementationOnce(async () => {
        dead = true;
        throw refusal;
      });
      const sm = createSessionManager({ config, registry: mockRegistry });

      const err = await sm.send("app-1", "go on").catch((e: unknown) => e);

      expect(err).toBe(refusal);
      expect(isRuntimeSendRefusedError(err)).toBe(true);
      expect(err).toMatchObject({ code: "ERR_RUNTIME_SEND_REFUSED", admitted });
      expect(mockRuntime.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockRuntime.create).not.toHaveBeenCalled();
    });
  }

  it("control: another send error keeps the one restore retry", async () => {
    vi.mocked(mockRuntime.sendMessage)
      .mockImplementationOnce(async () => {
        dead = true;
        throw new Error("the pane did not answer");
      })
      .mockResolvedValue(undefined);
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "go on")).resolves.toBeUndefined();

    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
    expect(mockRuntime.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockRuntime.sendMessage).toHaveBeenLastCalledWith(makeHandle("rt-restored"), "go on");
  });
});
