/**
 * Round 3 of the killed-status fix (development/reviews/killed_status_review_r1_sol61.md):
 * a dead session must reach `killed`, a live one must not.
 *
 * - 1.1: an authoritative "not found" (runtime-tmux, claude-code on tmux) is a
 *   death: two polls, never held back by the outage rule (B-1). An answer that
 *   cannot tell an error from an exit (codex and others) is held back in a
 *   poll with no live session, for at most AMBIGUOUS_NEGATIVE_BOUND_MS. "No
 *   server" is unknown for NO_SERVER_BOUND_MS, then dead (M-1). A new worker
 *   checks a record that died before it started (M-3). Timestamps cannot
 *   extend the launch grace; a failed evaluation ends a negative run.
 * - 1.2 item 3: the status write compares the record generation and `pr` (M-2).
 * - 1.3 item 3: a killed record goes back to working only when the live tmux
 *   session is the one that the record launched.
 * - Round 4 (development/reviews/killed_status_review_r2_sol61.md): the
 *   negative run, the bounds and the tracked status belong to one launch
 *   (M-1); the identity tolerance is exact at its limits (m-1).
 *
 * Each test drives the real session manager over a scratch record directory;
 * only the plugins are mocks. The plugin names select the authority of their
 * answers ("tmux" and "claude-code" follow the reject-on-error contract).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLifecycleManager } from "../lifecycle-manager.js";
import { createSessionManager } from "../session-manager.js";
import { readObservabilitySummary } from "../observability.js";
import {
  writeMetadata,
  readMetadataRaw,
  updateMetadata,
  deleteMetadata,
  reserveSessionId,
} from "../metadata.js";
import { generateConfigHash } from "../paths.js";
import {
  AMBIGUOUS_NEGATIVE_BOUND_MS,
  LAUNCH_GRACE_MS,
  NO_SERVER_BOUND_MS,
  RUNTIME_NO_SERVER_ERROR_CODE,
  type ActivityDetection,
  type Agent,
  type LifecycleManager,
  type OrchestratorConfig,
  type PRInfo,
  type PluginRegistry,
  type Runtime,
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
} from "./test-utils.js";

let env: TestEnvironment;
let runtime: Runtime;
let agent: Agent;
let registry: PluginRegistry;
let config: OrchestratorConfig;
let sessionManager: SessionManager;
let lifecycle: LifecycleManager | null;

/** Plugins with the given names: the names decide the authority of their negatives. */
function usePlugins(names: { runtime: string; agent: string }, scm?: SCM): void {
  const plugins = createMockPlugins();
  runtime = { ...plugins.runtime, name: names.runtime, getMetrics: vi.fn() };
  agent = { ...plugins.agent, name: names.agent };
  registry = createMockRegistry({ runtime, agent, ...(scm && { scm }) });
  sessionManager = createSessionManager({ config, registry });
}

beforeEach(() => {
  env = createTestEnvironment();
  config = env.config;
  usePlugins({ runtime: "tmux", agent: "claude-code" });
  lifecycle = null;
});

afterEach(() => {
  lifecycle?.stop();
  vi.useRealTimers();
  env.cleanup();
});

const EXITED: ActivityDetection = { state: "exited", timestamp: new Date() };
const LONG_AGO = () => new Date(Date.now() - LAUNCH_GRACE_MS - 60_000).toISOString();
const MINUTE = 60_000;

function handleOf(sessionId: string, data: Record<string, unknown> = {}): RuntimeHandle {
  return {
    id: `${generateConfigHash(config.configPath)}-${sessionId}`,
    runtimeName: "tmux",
    data,
  };
}

/** The record that a spawn writes after `runtime.create`, plus `fields` ("" removes a key). */
function writeRecord(
  sessionId: string,
  fields: Record<string, string> = {},
  handleData: Record<string, unknown> = {},
): void {
  const handle = handleOf(sessionId, handleData);
  writeMetadata(env.sessionsDir, sessionId, {
    worktree: "/tmp",
    branch: "main",
    status: "working",
    tmuxName: handle.id,
    project: "my-app",
    createdAt: LONG_AGO(),
    runtimeHandle: JSON.stringify(handle),
  });
  updateMetadata(env.sessionsDir, sessionId, fields);
}

function recordOf(sessionId: string): Record<string, string> {
  return readMetadataRaw(env.sessionsDir, sessionId) ?? {};
}

function statuses(...ids: string[]): string[] {
  return ids.map((id) => recordOf(id)["status"] ?? "(none)");
}

/** isAlive answers false (tmux: "can't find session") for the sessions in `dead`. */
function aliveExcept(...dead: string[]): void {
  const deadIds = new Set(dead.map((id) => handleOf(id).id));
  vi.mocked(runtime.isAlive).mockImplementation(
    async (handle: RuntimeHandle) => !deadIds.has(handle.id),
  );
}

function noServer(): Error {
  return Object.assign(new Error("tmux has-session could not answer: no server running"), {
    code: RUNTIME_NO_SERVER_ERROR_CODE,
  });
}

function newLifecycle(sm: SessionManager = sessionManager): LifecycleManager {
  lifecycle = createLifecycleManager({
    config,
    registry,
    sessionManager: sm,
    projectId: "my-app",
  });
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

/** Fake only the clock, so polls run on real timers. */
function useClock(): (ms: number) => void {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.now();
  vi.setSystemTime(start);
  return (ms: number) => vi.setSystemTime(start + ms);
}

describe("1.1 item 1: an authoritative 'not found' is a death (B-1)", () => {
  it("kills every recorded session that died in one poll, with no live session left, at the second poll", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    aliveExcept("app-1", "app-2");
    const lm = newLifecycle();

    await pollOnce(lm);
    expect(statuses("app-1", "app-2")).toEqual(["working", "working"]);

    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
    expect(recordOf("app-2")).toMatchObject({ status: "killed", killedReason: "runtime" });
    // A real mass exit is no probe outage.
    expect(workerHealth()?.status).toBe("ok");
  });

  it("kills the dead workers at the second poll while a live orchestrator stays working", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    writeRecord("app-orchestrator", { role: "orchestrator" });
    aliveExcept("app-1", "app-2");
    const lm = newLifecycle();

    await pollOnce(lm);
    expect(statuses("app-1", "app-2", "app-orchestrator")).toEqual([
      "working",
      "working",
      "working",
    ]);

    await pollOnce(lm);
    expect(statuses("app-1", "app-2", "app-orchestrator")).toEqual(["killed", "killed", "working"]);
  });

  it("kills every claude-code session whose agent exited, with no live agent left, at the second poll", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    vi.mocked(agent.getActivityState).mockResolvedValue(EXITED);
    const lm = newLifecycle();

    await pollOnce(lm);
    expect(statuses("app-1", "app-2")).toEqual(["working", "working"]);

    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "agent-exited" });
    expect(recordOf("app-2")).toMatchObject({ status: "killed", killedReason: "agent-exited" });
  });
});

describe("1.1 item 2: an ambiguous negative of all sessions waits for the bound", () => {
  beforeEach(() => {
    usePlugins({ runtime: "tmux", agent: "codex" });
  });

  it("persists a codex-style 'exited' of every session only after 5 minutes of such answers", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    vi.mocked(agent.getActivityState).mockResolvedValue(EXITED);
    const at = useClock();
    const lm = newLifecycle();

    for (const minute of [0, 1, 2, 3, 4]) {
      at(minute * MINUTE);
      await pollOnce(lm);
      expect(statuses("app-1", "app-2")).toEqual(["working", "working"]);
      expect(workerHealth()?.status).toBe("warn");
    }
    at(AMBIGUOUS_NEGATIVE_BOUND_MS - 1_000);
    await pollOnce(lm);
    expect(statuses("app-1", "app-2")).toEqual(["working", "working"]);

    at(AMBIGUOUS_NEGATIVE_BOUND_MS);
    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "agent-exited" });
    expect(recordOf("app-2")).toMatchObject({ status: "killed", killedReason: "agent-exited" });
  });

  it("starts the bound again after a positive answer", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    let positive = false;
    vi.mocked(agent.getActivityState).mockImplementation(async () =>
      positive ? { state: "active" } : EXITED,
    );
    const at = useClock();
    const lm = newLifecycle();

    at(0);
    await pollOnce(lm);
    at(4 * MINUTE);
    positive = true;
    await pollOnce(lm);
    positive = false;
    at(6 * MINUTE);
    await pollOnce(lm);
    at(8 * MINUTE);
    await pollOnce(lm);
    expect(statuses("app-1", "app-2")).toEqual(["working", "working"]);

    at(11 * MINUTE);
    await pollOnce(lm);
    expect(statuses("app-1", "app-2")).toEqual(["killed", "killed"]);
  });

  it.each([
    {
      answer: "codex isProcessRunning false (no JSONL activity)",
      plugins: { runtime: "tmux", agent: "codex" },
      setup: () => {
        vi.mocked(agent.getActivityState).mockResolvedValue(null);
        vi.mocked(agent.isProcessRunning).mockResolvedValue(false);
      },
      reason: "agent-exited",
    },
    {
      answer: "runtime-herdr isAlive false",
      plugins: { runtime: "herdr", agent: "claude-code" },
      setup: () => {
        vi.mocked(runtime.isAlive).mockResolvedValue(false);
      },
      reason: "runtime",
    },
  ])(
    "persists a $answer of every session only after 5 minutes",
    async ({ plugins, setup, reason }) => {
      usePlugins(plugins);
      writeRecord("app-1");
      writeRecord("app-2");
      setup();
      const at = useClock();
      const lm = newLifecycle();

      for (const minute of [0, 2, 4]) {
        at(minute * MINUTE);
        await pollOnce(lm);
        expect(statuses("app-1", "app-2")).toEqual(["working", "working"]);
      }
      at(AMBIGUOUS_NEGATIVE_BOUND_MS);
      await pollOnce(lm);
      expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: reason });
      expect(recordOf("app-2")).toMatchObject({ status: "killed", killedReason: reason });
    },
  );

  it("does not hold back an ambiguous negative when another session answers alive (C1 only)", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    vi.mocked(agent.getActivityState).mockImplementation(async (session) =>
      session.id === "app-1" ? EXITED : { state: "active" },
    );
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);

    expect(statuses("app-1", "app-2")).toEqual(["killed", "working"]);
  });

  it("kills a session whose tmux session is gone at the second poll while another session's ambiguous answer is held (1.1 item 1)", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    aliveExcept("app-1");
    vi.mocked(agent.getActivityState).mockResolvedValue(EXITED);
    const lm = newLifecycle();

    await pollOnce(lm);
    expect(statuses("app-1", "app-2")).toEqual(["working", "working"]);

    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
    expect(statuses("app-2")).toEqual(["working"]);
    expect(workerHealth()?.status).toBe("warn");
  });
});

describe("1.1 item 3: no tmux server is unknown for 5 minutes, then dead (M-1)", () => {
  it("does not kill after 4 minutes of 'no server', and kills at 5 minutes with killedReason=runtime", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    vi.mocked(runtime.isAlive).mockRejectedValue(noServer());
    const at = useClock();
    const lm = newLifecycle();

    for (const minute of [0, 2, 4]) {
      at(minute * MINUTE);
      await pollOnce(lm);
      expect(statuses("app-1", "app-2")).toEqual(["working", "working"]);
      expect(workerHealth()?.status).toBe("warn");
    }

    at(NO_SERVER_BOUND_MS);
    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
    expect(recordOf("app-2")).toMatchObject({ status: "killed", killedReason: "runtime" });
  });

  it("applies the same bound to a single-session check", async () => {
    writeRecord("app-1");
    vi.mocked(runtime.isAlive).mockRejectedValue(noServer());
    const at = useClock();
    const lm = newLifecycle();

    at(0);
    await lm.check("app-1");
    at(4 * MINUTE);
    await lm.check("app-1");
    expect(recordOf("app-1")["status"]).toBe("working");

    at(5 * MINUTE);
    await lm.check("app-1");
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
  });

  it("starts the 5 minutes again after a positive answer (a short outage)", async () => {
    writeRecord("app-1");
    const at = useClock();
    const lm = newLifecycle();

    vi.mocked(runtime.isAlive).mockRejectedValue(noServer());
    at(0);
    await lm.check("app-1");
    vi.mocked(runtime.isAlive).mockResolvedValue(true);
    at(3 * MINUTE);
    await lm.check("app-1");
    vi.mocked(runtime.isAlive).mockRejectedValue(noServer());
    at(4 * MINUTE);
    await lm.check("app-1");
    at(8 * MINUTE);
    await lm.check("app-1");
    expect(recordOf("app-1")["status"]).toBe("working");

    at(9 * MINUTE);
    await lm.check("app-1");
    expect(recordOf("app-1")["status"]).toBe("killed");
  });
});

describe("1.1 item 4: a new worker checks records that are already dead (M-3)", () => {
  it("kills a persisted working record whose runtime is gone before the worker starts, at its second poll", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    aliveExcept("app-1");
    // list() already reports app-1 killed in memory; the record says working.
    expect((await sessionManager.get("app-1"))?.status).toBe("killed");
    const lm = newLifecycle();

    await pollOnce(lm);
    expect(recordOf("app-1")["status"]).toBe("working");

    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
    expect(recordOf("app-2")["status"]).toBe("working");
  });

  it("does the same when every recorded session is dead at the start", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    aliveExcept("app-1", "app-2");
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);

    expect(statuses("app-1", "app-2")).toEqual(["killed", "killed"]);
  });
});

describe("1.1 item 5: the other non-converging paths", () => {
  it("gives no grace to a launch time in the future", async () => {
    writeRecord("app-1", { createdAt: new Date(Date.now() + 10 * MINUTE).toISOString() });
    vi.mocked(agent.getActivityState).mockResolvedValue(EXITED);
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "agent-exited" });
  });

  it("uses createdAt when restoredAt is not a valid time", async () => {
    // A launch 10 s ago with a broken restoredAt is still within the grace.
    writeRecord("app-1", {
      createdAt: new Date(Date.now() - 10_000).toISOString(),
      restoredAt: "not-a-time",
    });
    vi.mocked(agent.getActivityState).mockResolvedValue(EXITED);
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")["status"]).toBe("working");
  });

  it("ends a negative run when the evaluation of the session fails", async () => {
    writeRecord("app-1");
    aliveExcept("app-1");
    let poll = 0;
    // The second poll gets a session that the evaluation cannot read.
    const scripted: SessionManager = {
      ...sessionManager,
      list: vi.fn(async (projectId?: string) => {
        const listed = await sessionManager.list(projectId);
        return poll === 2
          ? listed.map((s) => ({
              ...s,
              status: "working" as const,
              metadata: undefined as unknown as Record<string, string>,
            }))
          : listed;
      }),
    };
    const lm = newLifecycle(scripted);

    for (poll = 1; poll <= 3; poll++) await pollOnce(lm);
    // Polls 1 and 3 are negative, but not adjacent: no confirmation yet.
    expect(recordOf("app-1")["status"]).toBe("working");

    await pollOnce(lm);
    expect(recordOf("app-1")["status"]).toBe("killed");
  });

  it("never persists killed for a session whose answers alternate between dead and alive", async () => {
    writeRecord("app-1");
    // Round 4 (review r2): the answer alternates per poll, not per call. A
    // check calls isAlive in get() and again in the evaluation, so a per-call
    // toggle gave the evaluation the same answer in every poll.
    let poll = 0;
    const lm = newLifecycle();
    const evaluated: boolean[] = [];
    vi.mocked(runtime.isAlive).mockImplementation(async () => {
      const alive = poll % 2 === 0;
      evaluated.push(alive);
      return alive;
    });

    for (poll = 1; poll <= 6; poll++) await lm.check("app-1");

    // Every check saw one answer only: dead in polls 1, 3, 5, alive in 2, 4, 6.
    expect(evaluated).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
    ]);
    expect(recordOf("app-1")["status"]).toBe("working");

    // Control: the same fixture with two dead polls in a row persists killed.
    poll = 7;
    await lm.check("app-1");
    await lm.check("app-1");
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
  });
});

describe("1.3 item 3: C3 recovers only the launch that the record started", () => {
  const HOUR_AGO = () => Date.now() - 60 * MINUTE;

  function killedRecord(handleData: Record<string, unknown>): void {
    writeRecord("app-1", { status: "killed", killedReason: "runtime" }, handleData);
  }

  it("moves a killed record back to working when the tmux session was created with its handle", async () => {
    const createdAt = HOUR_AGO();
    killedRecord({ createdAt });
    // tmux created the session 2 s before the handle was stored.
    vi.mocked(runtime.getMetrics!).mockImplementation(async () => ({
      uptimeMs: Date.now() - (createdAt - 2_000),
    }));
    const lm = newLifecycle();

    await pollOnce(lm);

    expect(recordOf("app-1")["status"]).toBe("working");
    expect(recordOf("app-1")["killedReason"]).toBeUndefined();
  });

  it("keeps the record killed when a new session runs under its old tmux name", async () => {
    killedRecord({ createdAt: HOUR_AGO() });
    // The live session is 30 s old: another launch, not this record's.
    vi.mocked(runtime.getMetrics!).mockResolvedValue({ uptimeMs: 30_000 });
    const lm = newLifecycle();

    await pollOnce(lm);
    await pollOnce(lm);

    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
  });

  it.each([
    { case: "the handle stores no createdAt", data: {}, metrics: "ok" },
    { case: "the runtime cannot report the age", data: { createdAt: 1 }, metrics: "rejects" },
  ])("keeps the record killed when $case", async ({ data, metrics }) => {
    killedRecord(data.createdAt === undefined ? data : { createdAt: HOUR_AGO() });
    if (metrics === "rejects") {
      vi.mocked(runtime.getMetrics!).mockRejectedValue(new Error("tmux list-sessions failed"));
    } else {
      vi.mocked(runtime.getMetrics!).mockResolvedValue({ uptimeMs: 60 * MINUTE });
    }
    const lm = newLifecycle();

    await pollOnce(lm);

    expect(recordOf("app-1")["status"]).toBe("killed");
  });
});

describe("1.2 item 3: the status write compares generation and pr (M-2)", () => {
  const PR1 = "https://github.com/org/my-app/pull/1";
  const PR2 = "https://github.com/org/my-app/pull/2";
  const prInfo = (number: number, branch: string): PRInfo => ({
    number,
    url: `https://github.com/org/my-app/pull/${number}`,
    title: `PR ${number}`,
    owner: "org",
    repo: "my-app",
    branch,
    baseBranch: "main",
    isDraft: false,
  });

  it("does not kill a session that claimPR moved to an open PR while the old PR was read as closed", async () => {
    const worktree = join(env.tmpDir, "ws-app-1");
    mkdirSync(worktree, { recursive: true });
    let claim: Promise<unknown> | undefined;
    const scm = createMockSCM({
      resolvePR: vi.fn().mockResolvedValue(prInfo(2, "feat/two")),
      checkoutPR: vi.fn().mockResolvedValue(true),
      getPRState: vi.fn(async (pr: PRInfo) => {
        if (pr.number === 2) return "open";
        // The real claim of PR #2 runs while the poll reads PR #1.
        claim = sessionManager.claimPR("app-1", "2");
        await claim;
        return "closed";
      }),
    });
    usePlugins({ runtime: "tmux", agent: "claude-code" }, scm);
    writeRecord("app-1", { status: "pr_open", pr: PR1, branch: "feat/one", worktree });
    const lm = newLifecycle();

    await lm.check("app-1");

    await expect(claim).resolves.toMatchObject({ pr: { number: 2 } });
    expect(recordOf("app-1")).toMatchObject({ status: "pr_open", pr: PR2, branch: "feat/two" });
    expect(recordOf("app-1")["killedReason"]).toBeUndefined();
  });

  it("does not write over a pr that a bash helper wrote during the probe (no new generation)", async () => {
    writeRecord("app-1");
    vi.mocked(agent.getActivityState).mockResolvedValue(EXITED);
    const lm = newLifecycle();
    await pollOnce(lm);

    // The helper replaces the file with `sed` and `mv`: pr changes, the generation does not.
    vi.mocked(agent.getActivityState).mockImplementationOnce(async () => {
      const path = join(env.sessionsDir, "app-1");
      const current = readMetadataRaw(env.sessionsDir, "app-1") ?? {};
      const helperWrite = { ...current, pr: "https://github.com/org/my-app/pull/9" };
      writeFileSync(
        path,
        Object.entries(helperWrite)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n") + "\n",
      );
      return EXITED;
    });
    await pollOnce(lm);

    expect(recordOf("app-1")).toMatchObject({
      status: "working",
      pr: "https://github.com/org/my-app/pull/9",
    });
  });

  it("does not write when another Node writer changed any key during the probe (a remap)", async () => {
    writeRecord("app-1");
    vi.mocked(agent.getActivityState).mockResolvedValue(EXITED);
    const lm = newLifecycle();
    await pollOnce(lm);

    vi.mocked(agent.getActivityState).mockImplementationOnce(async () => {
      updateMetadata(env.sessionsDir, "app-1", { opencodeSessionId: "ses_new" });
      return EXITED;
    });
    await pollOnce(lm);

    expect(recordOf("app-1")).toMatchObject({ status: "working", opencodeSessionId: "ses_new" });
  });
});

describe("1.2 item 5: no lifecycle write recreates an archived record", () => {
  it("does not recreate a record that a kill archived while the poll detected its PR", async () => {
    const scm = createMockSCM({
      detectPR: vi.fn(async () => {
        deleteMetadata(env.sessionsDir, "app-1", true);
        return {
          number: 5,
          url: "https://github.com/org/my-app/pull/5",
          title: "PR 5",
          owner: "org",
          repo: "my-app",
          branch: "feat/five",
          baseBranch: "main",
          isDraft: false,
        };
      }),
    });
    usePlugins({ runtime: "tmux", agent: "claude-code" }, scm);
    writeRecord("app-1", { branch: "feat/five" });
    const lm = newLifecycle();

    await lm.check("app-1");

    expect(readMetadataRaw(env.sessionsDir, "app-1")).toBeNull();
  });

  it("does not recreate a record that a kill archived before a reaction bookkeeping write", async () => {
    config.reactions = {
      "ci-failed": { auto: true, action: "send-to-agent", message: "CI is failing." },
    };
    const scm = createMockSCM({
      getCISummary: vi.fn().mockResolvedValue("failing"),
      getCIChecks: vi
        .fn()
        .mockResolvedValue([
          { name: "test", status: "failed", url: "https://ci.example/1", conclusion: "failure" },
        ]),
    });
    usePlugins({ runtime: "tmux", agent: "claude-code" }, scm);
    writeRecord("app-1", { status: "ci_failed", pr: "https://github.com/org/my-app/pull/3" });
    const send = vi.spyOn(sessionManager, "send").mockImplementation(async () => {
      deleteMetadata(env.sessionsDir, "app-1", true);
    });
    const lm = newLifecycle();

    await lm.check("app-1");

    expect(send).toHaveBeenCalled();
    expect(readMetadataRaw(env.sessionsDir, "app-1")).toBeNull();
  });
});

/** M-1 (round 4): an archive, a new reservation and a replacement launch of the session ID. */
function replaceLaunch(
  sessionId: string,
  handleData: Record<string, unknown>,
  fields: Record<string, string> = {},
): void {
  deleteMetadata(env.sessionsDir, sessionId, true);
  expect(reserveSessionId(env.sessionsDir, sessionId)).toBe(true);
  const handle = handleOf(sessionId, handleData);
  expect(
    updateMetadata(env.sessionsDir, sessionId, {
      worktree: "/tmp",
      branch: "main",
      status: "spawning",
      tmuxName: handle.id,
      project: "my-app",
      createdAt: new Date().toISOString(),
      runtimeHandle: JSON.stringify(handle),
      reservationId: "",
      ...fields,
    }),
  ).toBe(true);
}

describe("M-1 (round 4): the negative run and the bounds belong to one launch", () => {
  it("does not kill a replacement launch at its first 'no server' answer; it gets its own 5 minutes and two polls", async () => {
    writeRecord("app-1", {}, { createdAt: 1 });
    vi.mocked(runtime.isAlive).mockRejectedValue(noServer());
    const at = useClock();
    const lm = newLifecycle();

    at(0);
    await pollOnce(lm);
    at(240_000);
    await pollOnce(lm);
    expect(recordOf("app-1")["status"]).toBe("working");

    // T+270 s: the old launch is archived, the ID reserved again, and a
    // replacement launch published (the review's fake-clock case).
    at(270_000);
    replaceLaunch("app-1", { createdAt: Date.now() });
    const replacementHandle = recordOf("app-1")["runtimeHandle"];

    at(300_000);
    await pollOnce(lm);
    expect(recordOf("app-1")["status"]).not.toBe("killed");
    at(540_000);
    await pollOnce(lm);
    at(599_999);
    await pollOnce(lm);
    expect(recordOf("app-1")["status"]).not.toBe("killed");

    // 5 minutes after the replacement's own first answer.
    at(600_000);
    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({
      status: "killed",
      killedReason: "runtime",
      runtimeHandle: replacementHandle,
    });
  });

  it("does not kill a replacement launch whose first 'no server' answer comes after 5 minutes of the old launch's run", async () => {
    writeRecord("app-1", {}, { createdAt: 1 });
    vi.mocked(runtime.isAlive).mockRejectedValue(noServer());
    const at = useClock();
    const lm = newLifecycle();

    at(0);
    await lm.check("app-1");
    at(200_000);
    replaceLaunch("app-1", { createdAt: Date.now() });
    // One poll of the replacement, 10 minutes after the old run started.
    at(600_000);
    await lm.check("app-1");
    expect(recordOf("app-1")["status"]).not.toBe("killed");
    // Its second poll, at least 5 minutes after its first: killed.
    at(900_000);
    await lm.check("app-1");
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
  });

  it("needs two 'gone' polls of the replacement launch itself (C1 across a reused ID)", async () => {
    writeRecord("app-1", {}, { createdAt: 1 });
    aliveExcept("app-1");
    const lm = newLifecycle();

    await pollOnce(lm);
    expect(recordOf("app-1")["status"]).toBe("working");

    replaceLaunch("app-1", { createdAt: Date.now() }, { status: "working" });
    const replacementHandle = recordOf("app-1")["runtimeHandle"];
    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({
      status: "working",
      runtimeHandle: replacementHandle,
    });

    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({
      status: "killed",
      killedReason: "runtime",
      runtimeHandle: replacementHandle,
    });
  });

  it("keeps the run across a write that changes only bookkeeping keys and the generation", async () => {
    writeRecord("app-1", {}, { createdAt: 1 });
    aliveExcept("app-1");
    const lm = newLifecycle();

    await pollOnce(lm);
    const before = recordOf("app-1")["generation"];
    updateMetadata(env.sessionsDir, "app-1", {
      lastCIFailureDispatchHash: "abc",
      summary: "a summary",
    });
    expect(recordOf("app-1")["generation"]).not.toBe(before);

    await pollOnce(lm);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
  });

  it("does not use the tracked status of the old launch for the replacement", async () => {
    writeRecord("app-1");
    const lm = newLifecycle();

    // The worker tracks "working" for the old launch.
    await pollOnce(lm);
    expect(lm.getStates().get("app-1")).toBe("working");

    // The replacement is persisted as spawning; its agent is active.
    replaceLaunch("app-1", { createdAt: Date.now() }, { createdAt: LONG_AGO() });
    expect(recordOf("app-1")["status"]).toBe("spawning");
    await pollOnce(lm);

    // spawning -> working is a transition of the replacement, and it is persisted.
    expect(recordOf("app-1")["status"]).toBe("working");
  });
});

describe("m-1 (round 4): the identity tolerance of C3 at its limits", () => {
  const STORED = () => Date.now() - 60 * MINUTE;

  /**
   * A killed record whose handle stores `createdAt`, and a live tmux session
   * created `lagMs` before it (negative: after it). isSameLaunch reads
   * lag = stored createdAt - (now - uptime).
   */
  async function recoversWithLag(lagMs: number): Promise<boolean> {
    useClock();
    const stored = STORED();
    writeRecord("app-1", { status: "killed", killedReason: "runtime" }, { createdAt: stored });
    vi.mocked(runtime.getMetrics!).mockImplementation(async () => ({
      uptimeMs: Date.now() - stored + lagMs,
    }));
    const lm = newLifecycle();
    await pollOnce(lm);
    return recordOf("app-1")["status"] === "working";
  }

  it.each([
    { lagMs: -1001, recovers: false },
    { lagMs: -1000, recovers: true },
    { lagMs: -999, recovers: true },
    { lagMs: 14_999, recovers: true },
    { lagMs: 15_000, recovers: true },
    { lagMs: 15_001, recovers: false },
  ])("a lag of $lagMs ms: recovers=$recovers", async ({ lagMs, recovers }) => {
    expect(await recoversWithLag(lagMs)).toBe(recovers);
  });
});

/**
 * Round 5 (B-2): a compare that means "any Node write cancels" never accepts
 * a stale version. Generations never repeat for an ID, and the compare also
 * names the launch (a record of an earlier build has no generation).
 */
describe("B-2 (round 5): the version compares of the lifecycle reject a repeated version", () => {
  const PR1 = "https://github.com/org/my-app/pull/1";

  function oldLaunchPR(): PRInfo {
    return {
      number: 1,
      url: PR1,
      title: "PR 1",
      owner: "org",
      repo: "my-app",
      branch: "feat/old",
      baseBranch: "main",
      isDraft: false,
    };
  }

  function summaryOfOldLaunch(): void {
    vi.mocked(agent.getSessionInfo).mockResolvedValue({
      summary: "Summary of the old launch",
      summaryIsFallback: false,
      agentSessionId: null,
    } as never);
  }

  it("the review's reproducer: a delete without archive and a new launch during the PR detection", async () => {
    const scm = createMockSCM({
      detectPR: vi.fn(async () => {
        // A launch rollback (delete without archive), a new reservation and
        // a new launch of the ID, while the old launch's PR is detected.
        deleteMetadata(env.sessionsDir, "app-1", false);
        expect(reserveSessionId(env.sessionsDir, "app-1")).toBe(true);
        const handle = handleOf("app-1", { createdAt: 2 });
        expect(
          updateMetadata(env.sessionsDir, "app-1", {
            worktree: "/tmp",
            branch: "feat/new",
            status: "spawning",
            tmuxName: handle.id,
            project: "my-app",
            createdAt: LONG_AGO(),
            runtimeHandle: JSON.stringify(handle),
            reservationId: "",
          }),
        ).toBe(true);
        return oldLaunchPR();
      }),
    });
    usePlugins({ runtime: "tmux", agent: "claude-code" }, scm);
    summaryOfOldLaunch();
    writeRecord("app-1", { branch: "feat/old" }, { createdAt: 1 });
    const lm = newLifecycle();

    await lm.check("app-1");

    expect(scm.detectPR).toHaveBeenCalled();
    const record = recordOf("app-1");
    expect(record).toMatchObject({ branch: "feat/new", status: "spawning" });
    expect(record["pr"]).toBeUndefined();
    expect(record["pinnedSummary"]).toBeUndefined();
  });

  it("a new launch of an earlier build (records without a generation) during the PR detection", async () => {
    const recordFile = join(env.sessionsDir, "app-1");
    const oldBuildRecord = (handleData: Record<string, unknown>, branch: string): string => {
      const handle = handleOf("app-1", handleData);
      return [
        "worktree=/tmp",
        `branch=${branch}`,
        "status=working",
        `tmuxName=${handle.id}`,
        "project=my-app",
        `createdAt=${LONG_AGO()}`,
        `runtimeHandle=${JSON.stringify(handle)}`,
        "",
      ].join("\n");
    };
    const scm = createMockSCM({
      detectPR: vi.fn(async () => {
        // An earlier build writes a full new launch: no generation, no lock.
        writeFileSync(recordFile, oldBuildRecord({ createdAt: 2 }, "feat/new"));
        return oldLaunchPR();
      }),
    });
    usePlugins({ runtime: "tmux", agent: "claude-code" }, scm);
    summaryOfOldLaunch();
    mkdirSync(env.sessionsDir, { recursive: true });
    writeFileSync(recordFile, oldBuildRecord({ createdAt: 1 }, "feat/old"));
    const lm = newLifecycle();

    await lm.check("app-1");

    expect(scm.detectPR).toHaveBeenCalled();
    const record = recordOf("app-1");
    expect(record["branch"]).toBe("feat/new");
    expect(record["pr"]).toBeUndefined();
    expect(record["pinnedSummary"]).toBeUndefined();
  });

  it("control: with no change during the detection, the PR and the summary are written", async () => {
    const scm = createMockSCM({ detectPR: vi.fn(async () => oldLaunchPR()) });
    usePlugins({ runtime: "tmux", agent: "claude-code" }, scm);
    summaryOfOldLaunch();
    writeRecord("app-1", { branch: "feat/old" }, { createdAt: 1 });
    const lm = newLifecycle();

    await lm.check("app-1");

    expect(recordOf("app-1")).toMatchObject({
      pr: PR1,
      pinnedSummary: "Summary of the old launch",
    });
  });
});
