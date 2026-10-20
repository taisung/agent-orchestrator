import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { createLifecycleManager } from "../../lifecycle-manager.js";
import { writeMetadata } from "../../metadata.js";
import {
  AgentNotAttachedError,
  type Agent,
  type AgentMessageDelivery,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Session,
} from "../../types.js";
import {
  createMockRegistry,
  createMockSCM,
  makeHandle,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from "../test-utils.js";

let ctx: TestContext;
let tmpDir: string;
let sessionsDir: string;
let mockRuntime: Runtime;
let mockAgent: Agent;
let mockRegistry: PluginRegistry;
let config: OrchestratorConfig;

const RECORD: AgentMessageDelivery = {
  inputId: "msg_admitted",
  mode: "queue",
  waitsFor: [],
  busy: false,
};

/** The mock agent with the I-5 hooks: it can deliver to every session. */
function withSendHook(): ReturnType<typeof vi.fn> {
  const hook = vi.fn().mockResolvedValue(RECORD);
  mockAgent.canDeliverMessage = vi.fn().mockReturnValue(true);
  mockAgent.deliverMessage = hook;
  return hook;
}

function writeSession(overrides: Record<string, string> = {}): void {
  const worktree = join(tmpDir, "ws-app-1");
  mkdirSync(worktree, { recursive: true });
  writeMetadata(sessionsDir, "app-1", {
    worktree,
    branch: "feat/TEST-1",
    status: "working",
    project: "my-app",
    opencodeSessionId: "ses_stored",
    runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    ...overrides,
  });
}

/** The runtime of `rt-1` is dead; a restore creates `rt-restored`. */
function deadRuntime(): void {
  vi.mocked(mockRuntime.isAlive).mockImplementation(async (handle) => handle.id !== "rt-1");
  vi.mocked(mockAgent.isProcessRunning).mockImplementation(async (handle) => handle.id !== "rt-1");
  vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-restored"));
}

/**
 * The hook finds no TUI on its first call because the TUI of `rt-1` exited:
 * from then on the agent process of `rt-1` is not running and its activity
 * is `exited` (as the OpenCode `getActivityState` reports it), so `restore`
 * accepts the session. Later calls give `later`.
 */
function tuiExitsAtFirstCall(hook: ReturnType<typeof vi.fn>, later: () => Promise<unknown>): void {
  let tuiExited = false;
  vi.mocked(mockAgent.isProcessRunning).mockImplementation(
    async (handle) => handle.id !== "rt-1" || !tuiExited,
  );
  vi.mocked(mockAgent.getActivityState).mockImplementation(async (session) => ({
    state: session.runtimeHandle?.id === "rt-1" && tuiExited ? "exited" : "active",
  }));
  hook.mockImplementation(async () => {
    if (!tuiExited) {
      tuiExited = true;
      throw new AgentNotAttachedError("app-1", "no OpenCode TUI runs on session ses_stored");
    }
    return later();
  });
}

function handleOf(call: unknown[]): string | undefined {
  return (call[0] as Session).runtimeHandle?.id;
}

beforeEach(() => {
  ctx = setupTestContext();
  ({ tmpDir, sessionsDir, mockRuntime, mockAgent, mockRegistry, config } = ctx);
  vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-restored"));
});

afterEach(() => {
  teardownTestContext(ctx);
});

describe("send through the agent hook (I-5)", () => {
  it("calls the hook once with the prepared session and the message, and never the runtime path", async () => {
    writeSession();
    const hook = withSendHook();
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "Fix the CI failures")).resolves.toBeUndefined();

    expect(hook).toHaveBeenCalledTimes(1);
    const [session, message] = hook.mock.calls[0] as [Session, string];
    expect(message).toBe("Fix the CI failures");
    expect(session.id).toBe("app-1");
    expect(session.runtimeHandle).toEqual(makeHandle("rt-1"));
    expect(mockAgent.canDeliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "app-1" }),
    );
    // No paste and no screen-diff confirmation.
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
    expect(mockRuntime.getOutput).not.toHaveBeenCalled();
    expect(mockRuntime.create).not.toHaveBeenCalled();
  });

  it("returns the record of the hook through deliver", async () => {
    writeSession();
    withSendHook();
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.deliver!("app-1", "hello")).resolves.toEqual({
      route: "agent",
      delivery: RECORD,
    });
  });

  it("keeps the runtime path when canDeliverMessage is false (a session with no stored ID)", async () => {
    writeSession({ opencodeSessionId: "" });
    const hook = withSendHook();
    vi.mocked(mockAgent.canDeliverMessage!).mockReturnValue(false);
    vi.mocked(mockRuntime.getOutput).mockResolvedValueOnce("before").mockResolvedValueOnce("after");
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.deliver!("app-1", "hello")).resolves.toEqual({ route: "runtime" });

    expect(hook).not.toHaveBeenCalled();
    expect(mockRuntime.sendMessage).toHaveBeenCalledWith(makeHandle("rt-1"), "hello");
  });

  it("keeps the runtime path for an agent without canDeliverMessage", async () => {
    writeSession();
    const hook = vi.fn().mockResolvedValue(RECORD);
    mockAgent.deliverMessage = hook;
    vi.mocked(mockRuntime.getOutput).mockResolvedValueOnce("before").mockResolvedValueOnce("after");
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.send("app-1", "hello");

    expect(hook).not.toHaveBeenCalled();
    expect(mockRuntime.sendMessage).toHaveBeenCalledWith(makeHandle("rt-1"), "hello");
  });

  it("restores a dead runtime first, then delivers to the restored session", async () => {
    writeSession();
    deadRuntime();
    const hook = withSendHook();
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.send("app-1", "after restore");

    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(handleOf(hook.mock.calls[0]!)).toBe("rt-restored");
    expect(vi.mocked(mockRuntime.create).mock.invocationCallOrder[0]).toBeLessThan(
      hook.mock.invocationCallOrder[0]!,
    );
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
  });

  it("restores once after AgentNotAttachedError and calls the hook again (hook, restore, hook)", async () => {
    writeSession();
    const hook = withSendHook();
    tuiExitsAtFirstCall(hook, async () => RECORD);
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.deliver!("app-1", "hello")).resolves.toEqual({
      route: "agent",
      delivery: RECORD,
    });

    expect(hook).toHaveBeenCalledTimes(2);
    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
    expect(handleOf(hook.mock.calls[0]!)).toBe("rt-1");
    expect(handleOf(hook.mock.calls[1]!)).toBe("rt-restored");
    const createOrder = vi.mocked(mockRuntime.create).mock.invocationCallOrder[0]!;
    expect(hook.mock.invocationCallOrder[0]!).toBeLessThan(createOrder);
    expect(createOrder).toBeLessThan(hook.mock.invocationCallOrder[1]!);
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
  });

  it("fails on a second AgentNotAttachedError after the restore, with one restore only", async () => {
    writeSession();
    const hook = withSendHook();
    tuiExitsAtFirstCall(hook, async () => {
      throw new AgentNotAttachedError("app-1", "no OpenCode TUI runs on session ses_stored");
    });
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "hello")).rejects.toBeInstanceOf(AgentNotAttachedError);

    expect(hook).toHaveBeenCalledTimes(2);
    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
  });

  it("does not restore a second time when this send already restored the session", async () => {
    writeSession();
    deadRuntime();
    const hook = withSendHook();
    hook.mockRejectedValue(new AgentNotAttachedError("app-1", "no OpenCode TUI runs on session"));
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "hello")).rejects.toBeInstanceOf(AgentNotAttachedError);

    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("restores after AgentNotAttachedError also for a session that an older restore left a restoredAt", async () => {
    writeSession({ restoredAt: "2026-01-01T00:00:00.000Z" });
    const hook = withSendHook();
    tuiExitsAtFirstCall(hook, async () => RECORD);
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.send("app-1", "hello");

    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it("does not replace a pane whose agent process still runs: the send fails with both reasons", async () => {
    writeSession();
    const hook = withSendHook();
    hook.mockRejectedValue(
      new AgentNotAttachedError("app-1", "no OpenCode TUI runs on session ses_stored"),
    );
    const sm = createSessionManager({ config, registry: mockRegistry });

    const err = (await sm.send("app-1", "hello").catch((e: unknown) => e)) as AgentNotAttachedError;

    expect(err).toBeInstanceOf(AgentNotAttachedError);
    expect(err.message).toContain("no OpenCode TUI runs on session ses_stored");
    expect(err.message).toContain("the restore for a second try failed");
    expect(err.message).toContain("session is not in a terminal state");
    expect(mockRuntime.create).not.toHaveBeenCalled();
    expect(mockRuntime.destroy).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("does not restore a merged session after AgentNotAttachedError", async () => {
    writeSession({ status: "merged" });
    const hook = withSendHook();
    hook.mockRejectedValue(new AgentNotAttachedError("app-1", "no TUI"));
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "hello")).rejects.toBeInstanceOf(AgentNotAttachedError);

    expect(mockRuntime.create).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("treats every other hook error as final: no restore, no second call, no runtime path", async () => {
    writeSession();
    const hook = withSendHook();
    const refusal = new Error("the OpenCode session ses_stored of app-1 does not exist");
    hook.mockRejectedValue(refusal);
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "hello")).rejects.toBe(refusal);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(mockRuntime.create).not.toHaveBeenCalled();
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
  });

  it("delivers a lifecycle send-to-agent reaction through the hook", async () => {
    writeSession({ status: "pr_open", pr: "https://github.com/org/my-app/pull/42" });
    const hook = withSendHook();
    const scm = createMockSCM({ getCISummary: vi.fn().mockResolvedValue("failing") });
    const registry = createMockRegistry({
      runtime: mockRuntime,
      agent: mockAgent,
      workspace: ctx.mockWorkspace,
      scm,
    });
    config.reactions = {
      "ci-failed": {
        auto: true,
        action: "send-to-agent",
        message: "CI is failing. Fix it.",
        retries: 2,
        escalateAfter: 2,
      },
    };
    const sm = createSessionManager({ config, registry });
    const lm = createLifecycleManager({ config, registry, sessionManager: sm });

    await lm.check("app-1");

    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ id: "app-1" }),
      "CI is failing. Fix it.",
    );
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
  });
});
