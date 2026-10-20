import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { createLifecycleManager } from "../../lifecycle-manager.js";
import {
  readArchivedMetadataRaw,
  readMetadataRaw,
  updateMetadata,
  writeMetadata,
} from "../../metadata.js";
import { mintOpenCodeMessageId, OpenCodePromptTooLargeError } from "../../opencode-api.js";
import { getDeliveryLedgerDir } from "../../paths.js";
import {
  deliveryLedgerPath,
  readDeliveryLedger,
  readProcessStartTime,
  type DeliveryEntry,
} from "../../delivery-ledger.js";
import { installMockOpencodeApi } from "./opencode-helpers.js";
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
// I-5 rounds 2 and 3 (B-1, M-1, B-2, M-2, M-3): one client input ID per
// logical send, kept in the delivery ledger of the OpenCode session
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
 * the real ID generator and the stored session ID as key, one prompt with
 * that ID, and on a lost answer one read-back by that ID. `faults` gives the
 * fault of each call in order. `gate` holds each prompt until it resolves;
 * `afterPrompt` runs after the service step, before the hook returns.
 */
function withFakeOpenCode(
  faults: Fault[] = [],
  options: { gate?: () => Promise<void>; afterPrompt?: () => void } = {},
) {
  const service = fakeService();
  const entriesAtPrompt: DeliveryEntry[][] = [];
  const hook = vi.fn(
    async (
      session: Session,
      message: string,
      attempt?: AgentDeliveryAttempt,
    ): Promise<AgentMessageDelivery> => {
      const inputId = await attempt!.begin(
        () => mintOpenCodeMessageId(),
        session.metadata["opencodeSessionId"]!,
      );
      entriesAtPrompt.push(pending());
      const fault = faults.shift() ?? "none";
      if (options.gate) await options.gate();
      service.prompted.push(inputId);
      try {
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
      } finally {
        options.afterPrompt?.();
      }
    },
  );
  mockAgent.canDeliverMessage = vi.fn().mockReturnValue(true);
  mockAgent.deliverMessage = hook;
  return { hook, service, entriesAtPrompt };
}

const STORED = "ses_stored";

function ledgerDir(): string {
  return getDeliveryLedgerDir(config.configPath, config.projects["my-app"]!.path);
}

function pending(): DeliveryEntry[] {
  return readDeliveryLedger(ledgerDir(), STORED);
}

/** The ledger file of the stored session as text, or null when it is not there. */
function ledgerTextOrNull(): string | null {
  try {
    return readFileSync(deliveryLedgerPath(ledgerDir(), STORED), "utf-8");
  } catch {
    return null;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function writeLedger(entries: DeliveryEntry[]): void {
  mkdirSync(ledgerDir(), { recursive: true });
  writeFileSync(
    deliveryLedgerPath(ledgerDir(), STORED),
    JSON.stringify({ version: 1, key: STORED, entries }),
  );
}

function craftedEntry(
  text: string,
  state: DeliveryEntry["state"],
  owner: { pid: number; startTime: string | null },
  ageMs = 0,
): DeliveryEntry {
  const at = new Date(Date.now() - ageMs).toISOString();
  return {
    inputId: mintOpenCodeMessageId(Date.now() - ageMs),
    textSha256: sha256(text),
    createdAt: at,
    updatedAt: at,
    state,
    owner: { ...owner, token: randomUUID() },
  };
}

/** The PID of a process that ran and ended. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid!;
}

const MINUTE = 60_000;

describe("one input ID per logical send (I-5 rounds 2 and 3, B-1, M-1, B-2, M-2, M-3)", () => {
  it("persists the ID as `sending` in the ledger before the prompt, writes no record key, and clears it on success", async () => {
    writeSession();
    const { service, entriesAtPrompt } = withFakeOpenCode();
    const sm = createSessionManager({ config, registry: mockRegistry });

    const result = await sm.deliver!("app-1", "Fix the CI failures");

    const [id] = service.prompted;
    expect(entriesAtPrompt[0]).toEqual([
      expect.objectContaining({
        inputId: id,
        textSha256: sha256("Fix the CI failures"),
        state: "sending",
        owner: expect.objectContaining({ pid: process.pid }),
      }),
    ]);
    expect(result).toEqual({ route: "agent", delivery: { inputId: id, mode: "queue" } });
    expect(existsSync(deliveryLedgerPath(ledgerDir(), STORED))).toBe(false);
    const raw = readMetadataRaw(sessionsDir, "app-1")!;
    expect(raw["pendingDeliveries"]).toBeUndefined();
    expect([raw["status"], raw["opencodeSessionId"], raw["branch"]]).toEqual([
      "working",
      STORED,
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

  it("M-3: a real kill (no purge) and a restore from the archive keep the ledger: the retry replays, one admission", async () => {
    writeSession({ status: "working" });
    const { service } = withFakeOpenCode(["lose-answer-and-read-back"]);
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "ARCHIVE RETRY")).rejects.toBeInstanceOf(AgentDeliveryError);
    const [first] = service.prompted;

    await sm.kill("app-1");
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeSessionId"]).toBe(STORED);
    const ledgerAfterKill = ledgerTextOrNull();

    deadRuntime();
    await sm.restore("app-1");
    expect(readMetadataRaw(sessionsDir, "app-1")?.["opencodeSessionId"]).toBe(STORED);

    const retry = await sm.deliver!("app-1", "ARCHIVE RETRY");

    // The behavior first: one admission, and the retry is a replay.
    expect(service.admitted).toHaveLength(1);
    expect(retry).toEqual({
      route: "agent",
      delivery: { inputId: first, mode: "queue", replayed: true },
    });
    // Then where the ID was: in the ledger across the kill, never in the record.
    expect(ledgerAfterKill).toContain(first);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["pendingDeliveries"]).toBeUndefined();
    expect(pending()).toEqual([]);
  });

  it("M-3: `kill --purge-session` removes the ledger of the removed OpenCode session", async () => {
    const mockBin = installMockOpencodeApi(tmpDir, [
      { id: STORED, title: "AO:app-1", directory: join(tmpDir, "ws-app-1") },
    ]);
    const originalPath = process.env["PATH"];
    process.env["PATH"] = `${mockBin}:${originalPath ?? ""}`;
    try {
      writeSession({ agent: "opencode" });
      writeLedger([craftedEntry("left over", "unknown", { pid: process.pid, startTime: null })]);
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.kill("app-1", { purgeOpenCode: true });

      expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"]).toBeTruthy();
      expect(existsSync(deliveryLedgerPath(ledgerDir(), STORED))).toBe(false);
    } finally {
      process.env["PATH"] = originalPath;
    }
  });

  it("M-2: a record writer with an old snapshot does not touch the ledger: the retry replays, one admission", async () => {
    writeSession();
    const { service } = withFakeOpenCode(["lose-answer-and-read-back"]);
    const sm = createSessionManager({ config, registry: mockRegistry });
    // Writer A reads the record before the send and writes its old snapshot after it.
    const snapshot = readMetadataRaw(sessionsDir, "app-1")!;

    await expect(sm.send("app-1", "RACE SAME TEXT")).rejects.toBeInstanceOf(AgentDeliveryError);
    const ledgerBefore = ledgerTextOrNull();
    // The old snapshot plus its own key, written whole (as `updateMetadata` of
    // another process writes the record that it read before the send).
    writeFileSync(
      join(sessionsDir, "app-1"),
      Object.entries({ ...snapshot, lastCIFailureDispatchHash: "EXTERNAL-HASH" })
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") + "\n",
    );
    updateMetadata(sessionsDir, "app-1", { summary: "a later write" });
    const ledgerAfterWrites = ledgerTextOrNull();
    await sm.send("app-1", "RACE SAME TEXT");

    // The behavior first: one admission; then the ledger was not touched.
    expect(service.admitted).toHaveLength(1);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["lastCIFailureDispatchHash"]).toBe(
      "EXTERNAL-HASH",
    );
    expect(ledgerBefore).toContain(service.prompted[0]!);
    expect(ledgerAfterWrites).toBe(ledgerBefore);
  });

  it("two concurrent sends of the same text: two IDs and two admissions", async () => {
    writeSession();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { hook, service } = withFakeOpenCode([], { gate: () => released });
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
    const earlier = craftedEntry("rebase now", "unknown", { pid: process.pid, startTime: null });
    writeLedger([earlier]);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = withFakeOpenCode([], { gate: () => released });
    const sm = createSessionManager({ config, registry: mockRegistry });

    const both = Promise.all([sm.send("app-1", "rebase now"), sm.send("app-1", "rebase now")]);
    await vi.waitFor(() => expect(pending().filter((e) => e.state === "sending")).toHaveLength(2));
    release();
    await both;

    expect(service.prompted).toContain(earlier.inputId);
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

  it("reuses an unknown entry changed 9 min ago, and gives a new ID for one changed 11 min ago (and removes it)", async () => {
    for (const [ageMinutes, reused] of [
      [9, true],
      [11, false],
    ] as const) {
      writeSession();
      const earlier = craftedEntry(
        "same text",
        "unknown",
        { pid: process.pid, startTime: null },
        ageMinutes * MINUTE,
      );
      writeLedger([earlier]);
      const { service } = withFakeOpenCode();
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.send("app-1", "same text");

      expect(service.prompted[0] === earlier.inputId).toBe(reused);
      expect(pending()).toEqual([]);
    }
  });

  it("a different text after an unknown entry gets a new ID, and the unknown entry stays", async () => {
    writeSession();
    const entry = craftedEntry("text A", "unknown", { pid: process.pid, startTime: null });
    writeLedger([entry]);
    const { service } = withFakeOpenCode();
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.send("app-1", "text B");

    expect(service.prompted).toHaveLength(1);
    expect(service.prompted[0]).not.toBe(entry.inputId);
    expect(pending()).toEqual([entry]);
  });

  it("B-2: reuses the `sending` entry of a process that ended, and never one of a live process", async () => {
    writeSession();
    const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], {
      stdio: "ignore",
    });
    try {
      await vi.waitFor(() => expect(readProcessStartTime(sleeper.pid!)).toMatch(/^\d+$/));
      const dead = craftedEntry("CRASH SAME TEXT", "sending", { pid: deadPid(), startTime: null });
      const live = craftedEntry("LIVE SAME TEXT", "sending", {
        pid: sleeper.pid!,
        startTime: readProcessStartTime(sleeper.pid!),
      });
      writeLedger([dead, live]);
      const { service } = withFakeOpenCode();
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.send("app-1", "CRASH SAME TEXT");
      await sm.send("app-1", "LIVE SAME TEXT");

      expect(service.prompted[0]).toBe(dead.inputId);
      expect(service.prompted[1]).not.toBe(live.inputId);
      expect(pending()).toEqual([live]);
    } finally {
      sleeper.kill("SIGKILL");
    }
  });

  it("B-2: a failed write of `unknown` in a long-lived process: its next send takes the same ID, one admission", async () => {
    writeSession();
    const dir = ledgerDir();
    let blockWrites = true;
    const { service } = withFakeOpenCode(["lose-answer-and-read-back"], {
      afterPrompt: () => {
        if (blockWrites) chmodSync(dir, 0o555);
      },
    });
    const sm = createSessionManager({ config, registry: mockRegistry });

    try {
      await expect(sm.send("app-1", "UNKNOWN WRITE SAME TEXT")).rejects.toBeInstanceOf(
        AgentDeliveryError,
      );
    } finally {
      chmodSync(dir, 0o755);
      blockWrites = false;
    }
    const [first] = service.prompted;
    expect(pending()).toEqual([expect.objectContaining({ inputId: first, state: "sending" })]);

    await sm.send("app-1", "UNKNOWN WRITE SAME TEXT");

    expect(service.prompted).toEqual([first, first]);
    expect(service.admitted).toHaveLength(1);
  });

  it("item 4: a failed clear after a success: the same process gives the next equal text a new ID", async () => {
    writeSession();
    const dir = ledgerDir();
    let blockWrites = true;
    const { service } = withFakeOpenCode([], {
      afterPrompt: () => {
        if (blockWrites) chmodSync(dir, 0o555);
      },
    });
    const sm = createSessionManager({ config, registry: mockRegistry });

    try {
      await expect(sm.deliver!("app-1", "SAY IT TWICE")).resolves.toEqual(
        expect.objectContaining({ route: "agent" }),
      );
    } finally {
      chmodSync(dir, 0o755);
      blockWrites = false;
    }
    expect(pending()).toEqual([expect.objectContaining({ state: "sending" })]);

    const second = await sm.deliver!("app-1", "SAY IT TWICE");

    expect(new Set(service.prompted).size).toBe(2);
    expect(service.admitted).toHaveLength(2);
    expect(second).toEqual(
      expect.objectContaining({ delivery: expect.not.objectContaining({ replayed: true }) }),
    );
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
    const hook = vi.fn(async (session: Session, _m: string, attempt?: AgentDeliveryAttempt) => {
      await attempt!.begin(() => mintOpenCodeMessageId(), session.metadata["opencodeSessionId"]!);
      throw new Error("unexpected failure after the prompt started");
    });
    mockAgent.canDeliverMessage = vi.fn().mockReturnValue(true);
    mockAgent.deliverMessage = hook;
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "hello")).rejects.toThrow(/unexpected failure/);
    expect(pending()).toEqual([expect.objectContaining({ state: "unknown" })]);
  });

  it("a second begin in one send (after a restore) takes the ID of the first", async () => {
    writeSession();
    const ids: string[] = [];
    let calls = 0;
    tuiExitsAtFirstCall(vi.fn(), async () => RECORD);
    mockAgent.canDeliverMessage = vi.fn().mockReturnValue(true);
    mockAgent.deliverMessage = vi.fn(
      async (session: Session, _m: string, attempt?: AgentDeliveryAttempt) => {
        ids.push(await attempt!.begin(() => mintOpenCodeMessageId(), STORED));
        if (++calls === 1) {
          vi.mocked(mockAgent.isProcessRunning).mockImplementation(
            async (handle) => handle.id !== "rt-1",
          );
          vi.mocked(mockAgent.getActivityState).mockImplementation(async (s) => ({
            state: s.runtimeHandle?.id === "rt-1" ? "exited" : "active",
          }));
          throw new AgentNotAttachedError(session.id, "the TUI exited during the send");
        }
        return { inputId: ids.at(-1)!, mode: "queue" };
      },
    );
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.send("app-1", "hello");

    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(pending()).toEqual([]);
  });

  it("a corrupt ledger: a definite refusal that names the file, no prompt, and the file does not change", async () => {
    writeSession();
    mkdirSync(ledgerDir(), { recursive: true });
    const file = deliveryLedgerPath(ledgerDir(), STORED);
    writeFileSync(file, "[broken-json");
    const { service } = withFakeOpenCode();
    const sm = createSessionManager({ config, registry: mockRegistry });

    const err = (await sm.send("app-1", "CORRUPT RETRY").catch((e: unknown) => e)) as Error;

    expect(err.message).toContain(`Cannot send to session app-1: the input ID cannot be persisted`);
    expect(err.message).toContain(file);
    expect(err.message).toMatch(/nothing was sent$/);
    expect(service.prompted).toEqual([]);
    expect(readFileSync(file, "utf-8")).toBe("[broken-json");
  });
});
