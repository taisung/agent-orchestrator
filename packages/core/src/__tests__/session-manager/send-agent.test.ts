import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  deliveryAttemptLockName,
  deliveryLedgerLockName,
  deliveryLedgerPath,
  readDeliveryLedger,
  type DeliveryEntry,
} from "../../delivery-ledger.js";
import { tryHoldDeliveryLock, type DeliveryLock } from "../../delivery-lock.js";
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
    JSON.stringify({ version: 2, key: STORED, entries }),
  );
}

/** An entry whose attempt lock nobody holds (a random token), unless a test holds it. */
function craftedEntry(text: string, state: DeliveryEntry["state"], ageMs = 0): DeliveryEntry {
  const at = new Date(Date.now() - ageMs).toISOString();
  return {
    inputId: mintOpenCodeMessageId(Date.now() - ageMs),
    textSha256: sha256(text),
    createdAt: at,
    updatedAt: at,
    state,
    owner: { pid: process.pid, token: randomUUID() },
  };
}

/** Locks that a test holds; released after each test. */
const testHolds: DeliveryLock[] = [];

async function holdLock(name: string): Promise<void> {
  const lock = await tryHoldDeliveryLock(name);
  expect(lock).not.toBeNull();
  testHolds.push(lock!);
}

afterEach(() => {
  for (const lock of testHolds.splice(0)) lock.release();
});

const MINUTE = 60_000;

describe("one input ID per logical send (I-5 rounds 2 to 4, B-1, M-1, B-2, B-3, M-2, M-3, M-5, m-2)", () => {
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
      writeLedger([craftedEntry("left over", "unknown")]);
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.kill("app-1", { purgeOpenCode: true });

      expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"]).toBeTruthy();
      expect(existsSync(deliveryLedgerPath(ledgerDir(), STORED))).toBe(false);
    } finally {
      process.env["PATH"] = originalPath;
    }
  });

  it("m-2: a failed ledger removal at `kill --purge-session` is tried again by `ao session cleanup`", async () => {
    const mockBin = installMockOpencodeApi(tmpDir, [
      { id: STORED, title: "AO:app-1", directory: join(tmpDir, "ws-app-1") },
    ]);
    const originalPath = process.env["PATH"];
    process.env["PATH"] = `${mockBin}:${originalPath ?? ""}`;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      writeSession({ agent: "opencode" });
      writeLedger([craftedEntry("left over", "unknown")]);
      const file = deliveryLedgerPath(ledgerDir(), STORED);
      const sm = createSessionManager({ config, registry: mockRegistry });

      chmodSync(ledgerDir(), 0o555);
      try {
        await sm.kill("app-1", { purgeOpenCode: true });
      } finally {
        chmodSync(ledgerDir(), 0o755);
      }
      const lines = stderr.mock.calls.map((call) => String(call[0]));

      expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"]).toBeTruthy();
      expect(existsSync(file)).toBe(true);
      expect(lines).toContainEqual(
        expect.stringMatching(
          new RegExp(
            `^ao: could not remove the delivery ledger ${file} of OpenCode session ${STORED} of app-1 \\(.*EACCES.*\\); the next \`ao session cleanup\` tries again\\.\\n$`,
          ),
        ),
      );

      expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeLedgerPending"]).toBe(STORED);

      // The first cleanup fails too: the pending key stays for the next one.
      chmodSync(ledgerDir(), 0o555);
      try {
        await sm.cleanup();
      } finally {
        chmodSync(ledgerDir(), 0o755);
      }
      expect(existsSync(file)).toBe(true);
      expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeLedgerPending"]).toBe(STORED);

      await sm.cleanup();

      expect(
        readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeLedgerPending"],
      ).toBeUndefined();
      expect(existsSync(file)).toBe(false);
    } finally {
      stderr.mockRestore();
      process.env["PATH"] = originalPath;
    }
  });

  it("m-2: `ao session cleanup` removes an expired ledger whose lock is free, and keeps one whose lock is held", async () => {
    writeLedger([craftedEntry("old", "unknown", 11 * MINUTE)]);
    const free = deliveryLedgerPath(ledgerDir(), STORED);
    const held = deliveryLedgerPath(ledgerDir(), "ses_heldLock");
    writeFileSync(
      held,
      JSON.stringify({
        version: 2,
        key: "ses_heldLock",
        entries: [craftedEntry("old", "unknown", 11 * MINUTE)],
      }),
    );
    await holdLock(deliveryLedgerLockName(ledgerDir(), "ses_heldLock"));
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.cleanup(undefined, { dryRun: true });
    expect([existsSync(free), existsSync(held)]).toEqual([true, true]);

    await sm.cleanup();

    expect([existsSync(free), existsSync(held)]).toEqual([false, true]);
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
    const earlier = craftedEntry("rebase now", "unknown");
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
      const earlier = craftedEntry("same text", "unknown", ageMinutes * MINUTE);
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
    const entry = craftedEntry("text A", "unknown");
    writeLedger([entry]);
    const { service } = withFakeOpenCode();
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.send("app-1", "text B");

    expect(service.prompted).toHaveLength(1);
    expect(service.prompted[0]).not.toBe(entry.inputId);
    expect(pending()).toEqual([entry]);
  });

  it("B-2, B-3: reuses a `sending` entry whose attempt lock is free, and never one whose attempt lock is held", async () => {
    writeSession();
    const ended = craftedEntry("ENDED SAME TEXT", "sending");
    const inFlight = craftedEntry("IN FLIGHT SAME TEXT", "sending");
    writeLedger([ended, inFlight]);
    // Another process (here: this test) holds the attempt lock of `inFlight`.
    await holdLock(deliveryAttemptLockName(ledgerDir(), STORED, inFlight.owner.token));
    const { service } = withFakeOpenCode();
    const sm = createSessionManager({ config, registry: mockRegistry });

    await sm.send("app-1", "ENDED SAME TEXT");
    await sm.send("app-1", "IN FLIGHT SAME TEXT");

    expect(service.prompted[0]).toBe(ended.inputId);
    expect(service.prompted[1]).not.toBe(inFlight.inputId);
    expect(pending()).toEqual([inFlight]);
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

  it("M-5: an `admitted` entry (a success whose clear failed in a process that ended) is never reused: a new ID and a new admission", async () => {
    writeSession();
    const admitted = craftedEntry("INTENDED AGAIN", "admitted");
    writeLedger([admitted]);
    const { service } = withFakeOpenCode();
    service.admit(admitted.inputId, "INTENDED AGAIN");
    const sm = createSessionManager({ config, registry: mockRegistry });

    const again = await sm.deliver!("app-1", "INTENDED AGAIN");

    expect(service.prompted).toHaveLength(1);
    expect(service.prompted[0]).not.toBe(admitted.inputId);
    expect(service.admitted).toHaveLength(2);
    expect(again).toEqual({
      route: "agent",
      delivery: { inputId: service.prompted[0], mode: "queue" },
    });
    expect(pending()).toEqual([]);
  });

  it("M-5: a real lifecycle check after an `admitted` entry of the CI text: a new admission, and the dispatch hash only after it", async () => {
    writeSession({ status: "ci_failed", pr: "https://github.com/org/my-app/pull/42" });
    const hashAtPrompt: Array<string | undefined> = [];
    const { service } = withFakeOpenCode([], {
      afterPrompt: () =>
        hashAtPrompt.push(readMetadataRaw(sessionsDir, "app-1")?.["lastCIFailureDispatchHash"]),
    });
    const scm = createMockSCM({
      getCISummary: vi.fn().mockResolvedValue("failing"),
      getCIChecks: vi
        .fn()
        .mockResolvedValue([
          { name: "REVIEW-R4-CI", status: "failed", conclusion: "FAILURE", url: "https://ci/1" },
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
    // Learn the exact text of the CI reaction from a first check, then reset
    // the record and the service to the state after an earlier success of
    // that text whose clear failed in a process that ended.
    await lm.check("app-1");
    const ciText = service.admitted[0]!.text;
    writeSession({ status: "ci_failed", pr: "https://github.com/org/my-app/pull/42" });
    const earlier = craftedEntry(ciText, "admitted");
    writeLedger([earlier]);
    service.admitted.splice(0, service.admitted.length, {
      id: earlier.inputId,
      text: ciText,
      created: Date.now() - 1_000,
    });
    service.prompted.splice(0);
    hashAtPrompt.splice(0);
    const lm2 = createLifecycleManager({ config, registry, sessionManager: sm });

    await lm2.check("app-1");

    expect(service.prompted).toHaveLength(1);
    expect(service.prompted[0]).not.toBe(earlier.inputId);
    expect(service.admitted.map((input) => input.id)).toEqual([
      earlier.inputId,
      service.prompted[0],
    ]);
    expect(hashAtPrompt).toEqual([undefined]);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["lastCIFailureDispatchHash"]).toBeTruthy();
  });

  it("M-5: when the `admitted` mark fails, deliver reports it, and an equal send of this process gets a new ID", async () => {
    writeSession();
    const dir = ledgerDir();
    let blockWrites = true;
    const { service } = withFakeOpenCode([], {
      afterPrompt: () => {
        if (blockWrites) chmodSync(dir, 0o555);
      },
    });
    const sm = createSessionManager({ config, registry: mockRegistry });

    let first;
    try {
      first = await sm.deliver!("app-1", "MARK FAILS");
    } finally {
      chmodSync(dir, 0o755);
      blockWrites = false;
    }

    expect(first).toEqual({
      route: "agent",
      delivery: { inputId: service.prompted[0], mode: "queue" },
      admissionUnrecorded: true,
    });
    expect(pending()).toEqual([
      expect.objectContaining({ inputId: service.prompted[0], state: "sending" }),
    ]);
    const second = await sm.deliver!("app-1", "MARK FAILS");
    expect(second).toEqual({
      route: "agent",
      delivery: { inputId: service.prompted[1], mode: "queue" },
    });
    expect(new Set(service.prompted).size).toBe(2);
    expect(service.admitted).toHaveLength(2);
  });

  it("M-5: core send resolves when the `admitted` mark fails (the message was admitted) and prints one line", async () => {
    writeSession();
    const dir = ledgerDir();
    let blockWrites = true;
    const { service } = withFakeOpenCode([], {
      afterPrompt: () => {
        if (blockWrites) chmodSync(dir, 0o555);
      },
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const sm = createSessionManager({ config, registry: mockRegistry });

    try {
      await expect(sm.send("app-1", "MARK FAILS IN SEND")).resolves.toBeUndefined();
    } finally {
      chmodSync(dir, 0o755);
      blockWrites = false;
    }
    const lines = stderr.mock.calls.map((call) => String(call[0]));
    stderr.mockRestore();

    expect(lines).toEqual([
      `ao: input ${service.prompted[0]} was admitted to app-1, but the delivery ledger could not record it. While this process runs (at most 11 min), a send of the same text gets a new ID; after this process ends, a send of the same text in the 10 min after this one can reuse the ID and admit nothing new.\n`,
    ]);
    expect(service.admitted).toHaveLength(1);
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

  it("an AgentNotAttachedError after begin is final: no restore, no second begin, and the entry stays unknown", async () => {
    writeSession();
    const ids: string[] = [];
    mockAgent.canDeliverMessage = vi.fn().mockReturnValue(true);
    mockAgent.deliverMessage = vi.fn(
      async (session: Session, _m: string, attempt?: AgentDeliveryAttempt) => {
        ids.push(await attempt!.begin(() => mintOpenCodeMessageId(), STORED));
        throw new AgentNotAttachedError(session.id, "the TUI exited during the send");
      },
    );
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.send("app-1", "hello")).rejects.toBeInstanceOf(AgentNotAttachedError);

    expect(mockAgent.deliverMessage).toHaveBeenCalledTimes(1);
    expect(mockRuntime.create).not.toHaveBeenCalled();
    expect(pending()).toEqual([expect.objectContaining({ inputId: ids[0], state: "unknown" })]);
  });

  it("on a platform without the lock (darwin): a definite refusal before any restore, no hook and no ledger", async () => {
    writeSession();
    deadRuntime();
    const { hook } = withFakeOpenCode();
    const sm = createSessionManager({ config, registry: mockRegistry });
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "darwin" });
    let err: Error;
    try {
      err = (await sm.send("app-1", "hello").catch((e: unknown) => e)) as Error;
    } finally {
      Object.defineProperty(process, "platform", platform);
    }

    expect(err.message).toBe(
      "Cannot send to session app-1: delivery through the mock-agent API needs a lock that the OS releases (a Linux abstract Unix socket), and darwin has none; nothing was sent",
    );
    expect(hook).not.toHaveBeenCalled();
    expect(mockRuntime.create).not.toHaveBeenCalled();
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
    expect(existsSync(ledgerDir())).toBe(false);
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
