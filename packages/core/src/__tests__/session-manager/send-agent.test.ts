import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { createLifecycleManager } from "../../lifecycle-manager.js";
import { readMetadataRaw, updateMetadata, writeMetadata } from "../../metadata.js";
import { mintOpenCodeMessageId, OpenCodePromptTooLargeError } from "../../opencode-api.js";
import {
  AgentDeliveryError,
  AgentNotAttachedError,
  type Agent,
  type AgentDeliveryAttempt,
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
      expect.objectContaining({ begin: expect.any(Function) }),
    );
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
  });

  it("fails an oversized message on a dead session before any restore (checkMessage)", async () => {
    writeSession();
    deadRuntime();
    const hook = withSendHook();
    mockAgent.checkMessage = vi.fn(() => {
      throw new OpenCodePromptTooLargeError(204_868);
    });
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "x".repeat(200 * 1024))).rejects.toBeInstanceOf(
      OpenCodePromptTooLargeError,
    );

    expect(mockAgent.checkMessage).toHaveBeenCalledTimes(1);
    expect(mockRuntime.create).not.toHaveBeenCalled();
    expect(mockRuntime.destroy).not.toHaveBeenCalled();
    expect(mockRuntime.isAlive).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(readMetadataRaw(sessionsDir, "app-1")?.["restoredAt"]).toBeUndefined();
  });

  it("does not run checkMessage for a session on the runtime path", async () => {
    writeSession({ opencodeSessionId: "" });
    withSendHook();
    vi.mocked(mockAgent.canDeliverMessage!).mockReturnValue(false);
    mockAgent.checkMessage = vi.fn(() => {
      throw new OpenCodePromptTooLargeError(204_868);
    });
    vi.mocked(mockRuntime.getOutput).mockResolvedValueOnce("before").mockResolvedValueOnce("after");
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.deliver!("app-1", "hello")).resolves.toEqual({ route: "runtime" });
    expect(mockAgent.checkMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// I-5 round 2 (B-1, M-1): one client input ID per logical send
// ---------------------------------------------------------------------------

interface FakeInput {
  id: string;
  text: string;
  created: number;
}

/**
 * An in-memory stand-in for the one 2.0.32 service rule that B-1 needs
 * (`SessionInbox.reconcile`, read in the binary and measured on an isolated
 * store): a prompt with an input ID that the session already holds answers
 * that input and admits nothing.
 */
function fakeService() {
  const admitted: FakeInput[] = [];
  const late: { id: string; text: string }[] = [];
  const prompted: string[] = [];
  const admit = (id: string, text: string): { item: FakeInput; replay: boolean } => {
    const known = admitted.find((input) => input.id === id);
    if (known) return { item: known, replay: true };
    const item = { id, text, created: Date.now() };
    admitted.push(item);
    return { item, replay: false };
  };
  return {
    admitted,
    prompted,
    admit,
    late,
    /** The service admits now the requests that it took but did not admit yet. */
    completeLate(): void {
      for (const request of late.splice(0)) admit(request.id, request.text);
    },
  };
}

/**
 * `none`: admitted, answered. `lose-answer`: admitted, the answer is lost,
 * the read-back finds it. `lose-answer-and-read-back`: admitted, the answer
 * is lost and the read-back fails (the 503 of the review). `not-yet-admitted`:
 * the service admits the request later (`completeLate`), the answer is lost
 * and the read-back finds nothing. `refuse`: a definite refusal.
 */
type Fault = "none" | "lose-answer" | "lose-answer-and-read-back" | "not-yet-admitted" | "refuse";

/**
 * The mock agent follows the OpenCode plugin protocol: `attempt.begin` with
 * the real ID generator, one prompt with that ID, and on a lost answer one
 * read-back by that ID. `faults` gives the fault of each call in order.
 * `gate` holds each prompt until it resolves.
 */
function withFakeOpenCode(faults: Fault[] = [], gate?: () => Promise<void>) {
  const service = fakeService();
  const entriesAtPrompt: PendingEntry[][] = [];
  const hook = vi.fn(
    async (
      _session: Session,
      message: string,
      attempt?: AgentDeliveryAttempt,
    ): Promise<AgentMessageDelivery> => {
      const inputId = attempt!.begin(() => mintOpenCodeMessageId());
      entriesAtPrompt.push(pending());
      const fault = faults.shift() ?? "none";
      if (gate) await gate();
      service.prompted.push(inputId);
      if (fault === "refuse") {
        throw new AgentDeliveryError(
          inputId,
          "none",
          "session.prompt answered 409 ConflictError; nothing was sent",
        );
      }
      if (fault === "not-yet-admitted") {
        service.late.push({ id: inputId, text: message });
      } else {
        const { replay } = service.admit(inputId, message);
        if (fault === "none")
          return { inputId, mode: "queue", ...(replay ? { replayed: true } : {}) };
      }
      if (fault === "lose-answer-and-read-back") {
        throw new AgentDeliveryError(inputId, "unknown", "the read-back failed (HTTP 503)");
      }
      if (service.admitted.some((input) => input.id === inputId)) {
        return { inputId, mode: "queue", recovered: true };
      }
      throw new AgentDeliveryError(inputId, "unknown", `the read-back found no input ${inputId}`);
    },
  );
  mockAgent.canDeliverMessage = vi.fn().mockReturnValue(true);
  mockAgent.deliverMessage = hook;
  return { hook, service, entriesAtPrompt };
}

interface PendingEntry {
  inputId: string;
  textSha256: string;
  at: string;
  state: "sending" | "unknown";
}

function pending(): PendingEntry[] {
  const value = readMetadataRaw(sessionsDir, "app-1")?.["pendingDeliveries"];
  return value ? (JSON.parse(value) as PendingEntry[]) : [];
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function writePending(entries: PendingEntry[]): void {
  updateMetadata(sessionsDir, "app-1", { pendingDeliveries: JSON.stringify(entries) });
}

const MINUTE = 60_000;

describe("one input ID per logical send (I-5 round 2, B-1 and M-1)", () => {
  it("persists the ID as `sending` before the prompt, keeps the other keys, and clears it on success", async () => {
    writeSession();
    const { service, entriesAtPrompt } = withFakeOpenCode();
    const sm = createSessionManager({ config, registry: mockRegistry });

    const result = await sm.deliver!("app-1", "Fix the CI failures");

    const [id] = service.prompted;
    expect(entriesAtPrompt[0]).toEqual([
      {
        inputId: id,
        textSha256: sha256("Fix the CI failures"),
        at: expect.any(String),
        state: "sending",
      },
    ]);
    expect(result).toEqual({ route: "agent", delivery: { inputId: id, mode: "queue" } });
    const raw = readMetadataRaw(sessionsDir, "app-1")!;
    expect(raw["pendingDeliveries"]).toBeUndefined();
    expect([raw["status"], raw["opencodeSessionId"], raw["branch"]]).toEqual([
      "working",
      "ses_stored",
      "feat/TEST-1",
    ]);
  });

  it("a failed read-back, then a retry of the same text: one admission, the retry replays the same ID", async () => {
    writeSession();
    const { service } = withFakeOpenCode(["lose-answer-and-read-back"]);
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "CI failed: build")).rejects.toBeInstanceOf(AgentDeliveryError);
    const [first] = service.prompted;
    expect(pending()).toEqual([expect.objectContaining({ inputId: first, state: "unknown" })]);

    const retry = await sm.deliver!("app-1", "CI failed: build");

    expect(retry).toEqual({
      route: "agent",
      delivery: { inputId: first, mode: "queue", replayed: true },
    });
    expect(service.prompted).toEqual([first, first]);
    expect(service.admitted.map((input) => input.id)).toEqual([first]);
    expect(pending()).toEqual([]);
  });

  it("a late admission after the read-back, then a retry: one admission, also when the retry comes first", async () => {
    for (const lateBeforeRetry of [true, false]) {
      writeSession();
      const { service } = withFakeOpenCode(["not-yet-admitted"]);
      const sm = createSessionManager({ config, registry: mockRegistry });

      await expect(sm.send("app-1", "CI failed: lint")).rejects.toThrow(/found no input/);
      if (lateBeforeRetry) service.completeLate();
      await expect(sm.send("app-1", "CI failed: lint")).resolves.toBeUndefined();
      if (!lateBeforeRetry) service.completeLate();

      const [first] = service.prompted;
      expect(service.prompted).toEqual([first, first]);
      expect(service.admitted).toHaveLength(1);
      expect(pending()).toEqual([]);
    }
  });

  it("two real lifecycle checks with a read-back fault on the first: one admission, and the dispatch hash after the second", async () => {
    writeSession({ status: "ci_failed", pr: "https://github.com/org/my-app/pull/42" });
    const { service } = withFakeOpenCode(["lose-answer-and-read-back"]);
    const scm = createMockSCM({
      getCISummary: vi.fn().mockResolvedValue("failing"),
      getCIChecks: vi
        .fn()
        .mockResolvedValue([
          { name: "REVIEW-RETRY-CI", status: "failed", conclusion: "FAILURE", url: "https://ci/1" },
        ]),
    });
    const registry = createMockRegistry({
      runtime: mockRuntime,
      agent: mockAgent,
      workspace: ctx.mockWorkspace,
      scm,
    });
    config.reactions = {
      "ci-failed": { auto: true, action: "send-to-agent", message: "CI is failing.", retries: 3 },
    };
    const sm = createSessionManager({ config, registry });
    const lm = createLifecycleManager({ config, registry, sessionManager: sm });

    await lm.check("app-1");
    expect(readMetadataRaw(sessionsDir, "app-1")?.["lastCIFailureDispatchHash"]).toBeUndefined();
    expect(pending()).toEqual([expect.objectContaining({ state: "unknown" })]);

    await lm.check("app-1");

    expect(readMetadataRaw(sessionsDir, "app-1")?.["lastCIFailureDispatchHash"]).toBeTruthy();
    expect(service.admitted).toHaveLength(1);
    expect(service.admitted[0]!.text).toContain("REVIEW-RETRY-CI");
    expect(new Set(service.prompted).size).toBe(1);
    expect(service.prompted).toHaveLength(2);
    expect(pending()).toEqual([]);
  });

  it("keeps an unknown entry across a restore of the active record, so the retry after the restore replays", async () => {
    writeSession();
    const { service } = withFakeOpenCode(["lose-answer-and-read-back"]);
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "after a restore")).rejects.toBeInstanceOf(AgentDeliveryError);
    const [first] = service.prompted;
    // The TUI and its pane die before the next poll: the retry restores first.
    deadRuntime();

    const retry = await sm.deliver!("app-1", "after a restore");

    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["restoredAt"]).toBeTruthy();
    expect(retry).toEqual({
      route: "agent",
      delivery: { inputId: first, mode: "queue", replayed: true },
    });
    expect(service.prompted).toEqual([first, first]);
    expect(service.admitted).toHaveLength(1);
    expect(pending()).toEqual([]);
  });

  it("two concurrent sends of the same text: two IDs and two admissions", async () => {
    writeSession();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { hook, service } = withFakeOpenCode([], () => released);
    const sm = createSessionManager({ config, registry: mockRegistry });

    const both = Promise.all([sm.send("app-1", "rebase now"), sm.send("app-1", "rebase now")]);
    await vi.waitFor(() => expect(pending()).toHaveLength(2));
    expect(pending().map((entry) => entry.state)).toEqual(["sending", "sending"]);
    release();
    await both;

    expect(hook).toHaveBeenCalledTimes(2);
    expect(new Set(service.prompted).size).toBe(2);
    expect(service.admitted).toHaveLength(2);
    expect(pending()).toEqual([]);
  });

  it("a concurrent send does not take an unknown entry that another send claimed", async () => {
    writeSession();
    const earlier = mintOpenCodeMessageId();
    writePending([
      {
        inputId: earlier,
        textSha256: sha256("rebase now"),
        at: new Date().toISOString(),
        state: "unknown",
      },
    ]);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = withFakeOpenCode([], () => released);
    const sm = createSessionManager({ config, registry: mockRegistry });

    const both = Promise.all([sm.send("app-1", "rebase now"), sm.send("app-1", "rebase now")]);
    await vi.waitFor(() =>
      expect(service.prompted.length + pending().length).toBeGreaterThanOrEqual(2),
    );
    await vi.waitFor(() => expect(pending().filter((e) => e.state === "sending")).toHaveLength(2));
    release();
    await both;

    expect(service.prompted).toContain(earlier);
    expect(new Set(service.prompted).size).toBe(2);
    expect(service.admitted).toHaveLength(2);
  });

  it("a success, then the same text again: two IDs and two admissions", async () => {
    writeSession();
    const { service } = withFakeOpenCode();
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.send("app-1", "continue");
    await sm.send("app-1", "continue");

    expect(new Set(service.prompted).size).toBe(2);
    expect(service.admitted).toHaveLength(2);
  });

  it("reuses an unknown entry 9 min old, and gives a new ID for one 11 min old (and removes it)", async () => {
    for (const [ageMinutes, reused] of [
      [9, true],
      [11, false],
    ] as const) {
      writeSession();
      const earlier = mintOpenCodeMessageId(Date.now() - ageMinutes * MINUTE);
      writePending([
        {
          inputId: earlier,
          textSha256: sha256("same text"),
          at: new Date(Date.now() - ageMinutes * MINUTE).toISOString(),
          state: "unknown",
        },
      ]);
      const { service } = withFakeOpenCode();
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.send("app-1", "same text");

      expect(service.prompted[0] === earlier).toBe(reused);
      expect(pending()).toEqual([]);
    }
  });

  it("a different text after an unknown entry gets a new ID, and the unknown entry stays", async () => {
    writeSession();
    const earlier = mintOpenCodeMessageId();
    const entry: PendingEntry = {
      inputId: earlier,
      textSha256: sha256("text A"),
      at: new Date().toISOString(),
      state: "unknown",
    };
    writePending([entry]);
    const { service } = withFakeOpenCode();
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.send("app-1", "text B");

    expect(service.prompted).toHaveLength(1);
    expect(service.prompted[0]).not.toBe(earlier);
    expect(pending()).toEqual([entry]);
  });

  it("never reuses a `sending` entry (one that a stopped process left)", async () => {
    writeSession();
    const stale: PendingEntry = {
      inputId: mintOpenCodeMessageId(),
      textSha256: sha256("same text"),
      at: new Date(Date.now() - MINUTE).toISOString(),
      state: "sending",
    };
    writePending([stale]);
    const { service } = withFakeOpenCode();
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.send("app-1", "same text");

    expect(service.prompted[0]).not.toBe(stale.inputId);
    expect(pending()).toEqual([stale]);
  });

  it("a definite refusal clears the entry, so the same text then gets a new ID", async () => {
    writeSession();
    const { service } = withFakeOpenCode(["refuse"]);
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "hello")).rejects.toThrow(/nothing was sent/);
    expect(pending()).toEqual([]);
    await sm.send("app-1", "hello");

    expect(new Set(service.prompted).size).toBe(2);
    expect(service.admitted).toHaveLength(1);
  });

  it("keeps the entry `unknown` for an error after begin that says nothing about the admission", async () => {
    writeSession();
    const hook = vi.fn(async (_s: Session, _m: string, attempt?: AgentDeliveryAttempt) => {
      attempt!.begin(() => mintOpenCodeMessageId());
      throw new Error("unexpected failure after the prompt started");
    });
    mockAgent.canDeliverMessage = vi.fn().mockReturnValue(true);
    mockAgent.deliverMessage = hook;
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "hello")).rejects.toThrow(/unexpected failure/);
    expect(pending()).toEqual([expect.objectContaining({ state: "unknown" })]);
  });

  it("does not send when the record is gone at begin, and writes no new record", async () => {
    writeSession();
    const prompt = vi.fn();
    mockAgent.canDeliverMessage = vi.fn().mockReturnValue(true);
    mockAgent.deliverMessage = vi.fn(
      async (_s: Session, _m: string, attempt?: AgentDeliveryAttempt) => {
        unlinkSync(join(sessionsDir, "app-1"));
        attempt!.begin(() => mintOpenCodeMessageId());
        prompt();
        return RECORD;
      },
    );
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "hello")).rejects.toThrow(/record is gone.*nothing was sent/);
    expect(prompt).not.toHaveBeenCalled();
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
  });
});
