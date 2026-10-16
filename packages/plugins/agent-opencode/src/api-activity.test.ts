import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCallOpenCodeApi, mockGetOpenCodeSession } = vi.hoisted(() => ({
  mockCallOpenCodeApi: vi.fn(),
  mockGetOpenCodeSession: vi.fn(),
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    callOpenCodeApi: (...args: unknown[]) =>
      (mockCallOpenCodeApi as (...a: unknown[]) => unknown)(...args),
    getOpenCodeSession: (...args: unknown[]) =>
      (mockGetOpenCodeSession as (...a: unknown[]) => unknown)(...args),
  };
});

import {
  OPENCODE_ACTIVITY_API_TIMEOUT_MS,
  classifyOpenCodePaneActivity,
  getApiActivityState,
  getApiSessionInfo,
} from "./api-activity.js";
import {
  REAL_BUSY_LAST3_2031,
  REAL_DIALOG_FORM1_200_S20,
  REAL_DIALOG_FORM1_80_S20,
  REAL_DIALOG_FORM2_200_S20,
  REAL_DIALOG_FORM2_80_S20,
  REAL_DIALOG_PERMISSION_200_S20,
  REAL_DIALOG_PERMISSION_80_S20,
  REAL_IDLE_MUSE_2031,
  REAL_IDLE_V4FLASH_2031,
} from "./__fixtures__/panes-2.0.31.js";

const SID = "ses_abc123";
const OTHER_SID = "ses_other999";
const ACTIVE_WINDOW = 30_000;
const THRESHOLD = 60_000;

function mockEmptyLists(active: Record<string, unknown> = {}) {
  mockCallOpenCodeApi.mockImplementation((operation: string) => {
    if (operation === "session.permission.list") return Promise.resolve({ data: [] });
    if (operation === "session.form.list") return Promise.resolve({ data: [] });
    if (operation === "session.active") return Promise.resolve({ data: active });
    if (operation === "session.message.list")
      return Promise.resolve({ data: [], cursor: { previous: null, next: null } });
    return Promise.reject(new Error(`unexpected operation: ${operation}`));
  });
}

function mockSession(record: Record<string, unknown>) {
  mockGetOpenCodeSession.mockResolvedValue({ id: SID, ...record });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEmptyLists();
  mockGetOpenCodeSession.mockResolvedValue(null);
});

describe("getApiActivityState — waiting_input", () => {
  it("returns waiting_input for constructed permission-list fixture with one request", async () => {
    mockSession({ time: { updated: Date.now(), idle: Date.now() } });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list")
        return Promise.resolve({
          data: [{ id: "per_1", sessionID: SID, action: "write", resources: ["/tmp/x"] }],
        });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active") return Promise.resolve({ data: {} });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("waiting_input");
    expect(mockGetOpenCodeSession).toHaveBeenCalledTimes(1);
    expect(mockCallOpenCodeApi).toHaveBeenCalledTimes(3);
  });

  it("returns waiting_input for constructed form-list fixture with one question", async () => {
    const updated = Date.now();
    mockSession({ time: { updated, idle: updated } });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list") return Promise.resolve({ data: [] });
      if (operation === "session.form.list")
        return Promise.resolve({
          data: [{ id: "frm_1", sessionID: SID, title: "Questions", fields: [] }],
        });
      if (operation === "session.active") return Promise.resolve({ data: {} });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("waiting_input");
    expect(state?.timestamp.getTime()).toBe(updated);
  });

  it("returns waiting_input when a permission waits and session.active also holds this ID (M1)", async () => {
    mockSession({ time: { updated: Date.now(), idle: Date.now() } });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list")
        return Promise.resolve({
          data: [{ id: "per_1", sessionID: SID, action: "write", resources: ["/tmp/x"] }],
        });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active")
        return Promise.resolve({ data: { [SID]: { type: "running" } } });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("waiting_input");
  });

  it("returns waiting_input when a form waits and session.active also holds this ID (M1)", async () => {
    mockSession({ time: { updated: Date.now(), idle: Date.now() } });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list") return Promise.resolve({ data: [] });
      if (operation === "session.form.list")
        return Promise.resolve({
          data: [{ id: "frm_1", sessionID: SID, title: "Questions", fields: [] }],
        });
      if (operation === "session.active")
        return Promise.resolve({ data: { [SID]: { type: "running" } } });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("waiting_input");
  });

  it("is not active when session.active holds only another session ID (M29)", async () => {
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated: idle, idle }, outcome: "succeeded" });
    mockEmptyLists({ [OTHER_SID]: { type: "running" } });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("idle");
  });
});

describe("getApiActivityState — call shape and parallelism (M3 M33 M4)", () => {
  it("passes timeoutMs and sessionID params to each call including message.list (M3 M33)", async () => {
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated: idle, idle }, outcome: "failed" });
    await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);

    expect(mockCallOpenCodeApi).toHaveBeenCalledWith("session.permission.list", {
      params: { sessionID: SID },
      timeoutMs: OPENCODE_ACTIVITY_API_TIMEOUT_MS,
    });
    expect(mockCallOpenCodeApi).toHaveBeenCalledWith("session.form.list", {
      params: { sessionID: SID },
      timeoutMs: OPENCODE_ACTIVITY_API_TIMEOUT_MS,
    });
    expect(mockCallOpenCodeApi).toHaveBeenCalledWith("session.active", {
      timeoutMs: OPENCODE_ACTIVITY_API_TIMEOUT_MS,
    });
    expect(mockCallOpenCodeApi).toHaveBeenCalledWith("session.message.list", {
      params: { sessionID: SID, type: "user", order: "desc", limit: "1" },
      timeoutMs: OPENCODE_ACTIVITY_API_TIMEOUT_MS,
    });
    expect(mockGetOpenCodeSession).toHaveBeenCalledWith(
      SID,
      OPENCODE_ACTIVITY_API_TIMEOUT_MS,
    );
  });

  it("pins the per-call bound below the helper default of 10 s", () => {
    expect(OPENCODE_ACTIVITY_API_TIMEOUT_MS).toBeLessThan(10_000);
  });

  it("starts all four calls before the first resolves (M4 deferred promises)", async () => {
    const now = Date.now();
    let resolvePermission!: (value: unknown) => void;
    let resolveForm!: (value: unknown) => void;
    let resolveActive!: (value: unknown) => void;
    let resolveGet!: (value: unknown) => void;
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list")
        return new Promise((resolve) => {
          resolvePermission = resolve;
        });
      if (operation === "session.form.list")
        return new Promise((resolve) => {
          resolveForm = resolve;
        });
      if (operation === "session.active")
        return new Promise((resolve) => {
          resolveActive = resolve;
        });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });
    mockGetOpenCodeSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
    );

    const pending = getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockCallOpenCodeApi).toHaveBeenCalledTimes(3);
    expect(mockGetOpenCodeSession).toHaveBeenCalledTimes(1);

    resolvePermission({ data: [] });
    resolveForm({ data: [] });
    resolveActive({ data: {} });
    resolveGet({ id: SID, time: { updated: now, idle: now } });
    const state = await pending;
    expect(state?.state).toBe("active");
  });
});

describe("getApiActivityState — blocked and interrupted", () => {
  it("returns blocked for constructed failed-outcome fixture with no newer user message", async () => {
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated: idle, idle }, outcome: "failed" });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list") return Promise.resolve({ data: [] });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active") return Promise.resolve({ data: {} });
      if (operation === "session.message.list")
        return Promise.resolve({ data: [], cursor: { previous: null, next: null } });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("blocked");
    expect(state?.timestamp.getTime()).toBe(idle);
    expect(mockCallOpenCodeApi).toHaveBeenCalledTimes(4);
    expect(mockGetOpenCodeSession).toHaveBeenCalledTimes(1);
  });

  it("is not blocked for constructed failed-outcome fixture with a newer user message", async () => {
    const idle = Date.now() - 120_000;
    const userNewer = idle + 10_000;
    mockSession({ time: { updated: idle, idle }, outcome: "failed" });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list") return Promise.resolve({ data: [] });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active") return Promise.resolve({ data: {} });
      if (operation === "session.message.list")
        return Promise.resolve({
          data: [{ id: "msg_1", type: "user", time: { created: userNewer }, text: "hi" }],
          cursor: { previous: null, next: null },
        });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("idle");
  });

  it("follows the age rule when the message.list read fails in the failed case (M12)", async () => {
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated: idle, idle }, outcome: "failed" });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list") return Promise.resolve({ data: [] });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active") return Promise.resolve({ data: {} });
      if (operation === "session.message.list")
        return Promise.reject(new Error("pipe cut with exit 0"));
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("idle");
    expect(state?.timestamp.getTime()).toBe(idle);
  });

  it("follows the age rule when message.list answers null in the failed case (M12)", async () => {
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated: idle, idle }, outcome: "failed" });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list") return Promise.resolve({ data: [] });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active") return Promise.resolve({ data: {} });
      if (operation === "session.message.list") return Promise.resolve(null);
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("idle");
    expect(state?.timestamp.getTime()).toBe(idle);
  });

  it("follows the age rule when message.list answers a wrong shape in the failed case (M12)", async () => {
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated: idle, idle }, outcome: "failed" });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list") return Promise.resolve({ data: [] });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active") return Promise.resolve({ data: {} });
      if (operation === "session.message.list") return Promise.resolve({ data: "bad" });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("idle");
    expect(state?.timestamp.getTime()).toBe(idle);
  });

  it("stays blocked when only a non-user message is newer than time.idle (M23)", async () => {
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated: idle, idle }, outcome: "failed" });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list") return Promise.resolve({ data: [] });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active") return Promise.resolve({ data: {} });
      if (operation === "session.message.list")
        return Promise.resolve({
          data: [
            {
              id: "msg_9",
              type: "assistant",
              time: { created: idle + 60_000 },
              text: "working",
            },
          ],
          cursor: { previous: null, next: null },
        });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("blocked");
  });

  it("decays constructed interrupted-outcome fixture by age instead of blocked", async () => {
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated: idle, idle }, outcome: "interrupted" });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("idle");
    expect(mockCallOpenCodeApi).toHaveBeenCalledTimes(3);
  });
});

describe("getApiActivityState — age rule", () => {
  it("returns ready for constructed time.idle-age fixture between window and threshold", async () => {
    const idle = Date.now() - 45_000;
    mockSession({ time: { updated: idle, idle }, outcome: "succeeded" });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("ready");
    expect(state?.timestamp.getTime()).toBe(idle);
  });

  it("returns idle for constructed time.idle-age fixture past the threshold", async () => {
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated: idle, idle }, outcome: "succeeded" });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("idle");
  });

  it("ages by time.idle when time.updated is newer (M14)", async () => {
    const updated = Date.now() - 5_000;
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated, idle }, outcome: "succeeded" });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("idle");
    expect(state?.timestamp.getTime()).toBe(idle);
  });

  it("uses time.updated for constructed no-time.idle fixture with no finished turn", async () => {
    const updated = Date.now() - 10_000;
    mockSession({ time: { created: updated - 1_000, updated } });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("active");
    expect(state?.timestamp.getTime()).toBe(updated);
  });

  it("returns active for constructed session.active fixture holding the session ID", async () => {
    const old = Date.now() - 600_000;
    mockSession({ time: { updated: old, idle: old }, outcome: "succeeded" });
    mockEmptyLists({ [SID]: { type: "running" } });

    const before = Date.now();
    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state?.state).toBe("active");
    expect(state?.timestamp.getTime()).toBeGreaterThanOrEqual(before - 5_000);
  });
});

describe("getApiActivityState — no signal", () => {
  it("returns null on a timeout with the JSONL fallback left to the caller", async () => {
    mockGetOpenCodeSession.mockRejectedValue(
      Object.assign(new Error("timeout"), { name: "OpenCodeApiTimeoutError" }),
    );

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state).toBeNull();
  });

  it("returns null on another error", async () => {
    mockCallOpenCodeApi.mockRejectedValue(new Error("boom"));

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state).toBeNull();
  });

  it("returns null on a 404 with null answers", async () => {
    mockGetOpenCodeSession.mockResolvedValue(null);
    mockCallOpenCodeApi.mockResolvedValue(null);

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state).toBeNull();
  });

  it("returns null on an unexpected shape with data as a string", async () => {
    mockSession({ time: { updated: Date.now() } });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list") return Promise.resolve({ data: "bad" });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active") return Promise.resolve({ data: {} });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state).toBeNull();
  });

  it("returns null when the record has neither time.updated nor time.idle (M27)", async () => {
    mockSession({ time: {} });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state).toBeNull();
  });

  it("returns null with no times even when a permission list is non-empty (M27)", async () => {
    mockSession({ time: {} });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list")
        return Promise.resolve({
          data: [{ id: "per_1", sessionID: SID, action: "write", resources: ["/tmp/x"] }],
        });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active") return Promise.resolve({ data: {} });
      if (operation === "session.message.list")
        return Promise.resolve({ data: [], cursor: { previous: null, next: null } });
      return Promise.reject(new Error(`unexpected: ${operation}`));
    });

    const state = await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(state).toBeNull();
  });

  it("makes four calls in the common case and five in the constructed failed case", async () => {
    const now = Date.now();
    mockSession({ time: { updated: now, idle: now }, outcome: "succeeded" });
    await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(mockCallOpenCodeApi).toHaveBeenCalledTimes(3);
    expect(mockGetOpenCodeSession).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockEmptyLists();
    const idle = Date.now() - 120_000;
    mockSession({ time: { updated: idle, idle }, outcome: "failed" });
    await getApiActivityState(SID, ACTIVE_WINDOW, THRESHOLD);
    expect(mockCallOpenCodeApi).toHaveBeenCalledTimes(4);
    expect(mockGetOpenCodeSession).toHaveBeenCalledTimes(1);
  });
});

describe("getApiSessionInfo — cost and tokens", () => {
  it("maps constructed cost fixture with reasoning and cache in the token sums (M15)", async () => {
    mockGetOpenCodeSession.mockResolvedValue({
      id: SID,
      title: "AO:test-1",
      cost: 0.0014781,
      tokens: { input: 14499, output: 11, reasoning: 130, cache: { read: 384, write: 16 } },
      time: { updated: Date.now() },
    });

    const info = await getApiSessionInfo(SID);
    expect(info?.agentSessionId).toBe(SID);
    expect(info?.summary).toBe("AO:test-1");
    expect(info?.summaryIsFallback).toBe(true);
    expect(info?.cost).toEqual({
      inputTokens: 14899,
      outputTokens: 141,
      estimatedCostUsd: 0.0014781,
    });
  });

  it("leaves cost out for constructed bad-number fixture with negative tokens", async () => {
    mockGetOpenCodeSession.mockResolvedValue({
      id: SID,
      title: "AO:test-1",
      cost: 0.001,
      tokens: { input: -1, output: 11, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { updated: Date.now() },
    });

    const info = await getApiSessionInfo(SID);
    expect(info).not.toBeNull();
    expect(info?.cost).toBeUndefined();
  });

  it("returns null for a 404 with null session", async () => {
    mockGetOpenCodeSession.mockResolvedValue(null);

    expect(await getApiSessionInfo(SID)).toBeNull();
  });
});

describe("classifyOpenCodePaneActivity — real 2.0.31 captures", () => {
  const TRANSCRIPT_LINE =
    "  ┃   100 `packages/plugins/agent-opencode/src/index.test.ts` core mock plus `detectActivity`,";

  function withTranscriptText(capture: string, text: string): string {
    const marked = capture.replace(TRANSCRIPT_LINE, `  ┃   100 ${text}`);
    expect(marked).not.toBe(capture);
    return marked;
  }

  function withInputBoxText(capture: string, text: string): string {
    const lines = capture.split("\n");
    const boxIndex = lines.findIndex((line) => line === "  ┃");
    expect(boxIndex).toBeGreaterThan(-1);
    const typed = [...lines];
    typed[boxIndex] = `  ┃  ${text}`;
    return typed.join("\n");
  }

  it("gives idle for the real idle Muse capture", () => {
    expect(classifyOpenCodePaneActivity(REAL_IDLE_MUSE_2031)).toBe("idle");
  });

  it("gives idle for the real idle V4.1 Flash capture", () => {
    expect(classifyOpenCodePaneActivity(REAL_IDLE_V4FLASH_2031)).toBe("idle");
  });

  it("gives active for the real busy last-3-lines sample with esc interrupt and ctrl+p commands (M20)", () => {
    expect(classifyOpenCodePaneActivity(REAL_BUSY_LAST3_2031)).toBe("active");
  });

  it("gives idle for the real idle capture cut to its last 24 lines (80x24)", () => {
    const cut = REAL_IDLE_MUSE_2031.split("\n").slice(-24).join("\n");
    expect(classifyOpenCodePaneActivity(cut)).toBe("idle");
  });

  it.each([
    "icon: △ Permission required",
    "the dialog says Allow once or Reject",
    "hint: ↑↓ select  enter submit to pick",
    "see skills ao-communicate: the esc interrupt rule",
  ])("gives idle when %s sits in a transcript line of the real idle capture", (text) => {
    expect(classifyOpenCodePaneActivity(withTranscriptText(REAL_IDLE_MUSE_2031, text))).toBe(
      "idle",
    );
  });

  it.each([
    "icon: △ Permission required",
    "the dialog says Allow once or Reject",
    "hint: ↑↓ select  enter submit to pick",
    "see skills ao-communicate: the esc interrupt rule",
  ])("gives idle when %s is typed into the input box line of the real idle capture", (text) => {
    expect(classifyOpenCodePaneActivity(withInputBoxText(REAL_IDLE_MUSE_2031, text))).toBe(
      "idle",
    );
  });

  it("gives waiting_input for the constructed census permission dialog shape in place", () => {
    const dialog = [
      "  ┃",
      "  ┃  △ Permission required",
      "  ┃    ← Access external directory /tmp/outside",
      "  ┃",
      "  ┃   Allow once   Always allow   Reject",
      "  ┃",
    ].join("\n");
    expect(classifyOpenCodePaneActivity(dialog)).toBe("waiting_input");
  });

  it("gives waiting_input for the constructed census question dialog shape in place", () => {
    const dialog = [
      "  ┃",
      "  ┃  Questions",
      "  ┃",
      "  ┃  ↑↓ select  enter submit  esc dismiss",
      "  ┃",
    ].join("\n");
    expect(classifyOpenCodePaneActivity(dialog)).toBe("waiting_input");
  });

  it("gives idle for the constructed 0009-section-5.1 idle capture fixture", () => {
    const idle = [
      "  ┃  Build · Muse Spark 1.3 Contributor OpenCode Go · xhigh",
      "  ╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
      "  /tmp/ao1s-work:main                    shift+tab agents  ctrl+p commands    /tmp/ao1s-work:main",
    ].join("\n");
    expect(classifyOpenCodePaneActivity(idle)).toBe("idle");
  });
});

describe("classifyOpenCodePaneActivity — real dialogs and rules", () => {
  it.each([
    REAL_DIALOG_PERMISSION_80_S20,
    REAL_DIALOG_PERMISSION_200_S20,
  ])("gives waiting_input for the real permission dialog (%#)", (capture) => {
    expect(classifyOpenCodePaneActivity(capture)).toBe("waiting_input");
  });

  it.each([
    REAL_DIALOG_FORM1_80_S20,
    REAL_DIALOG_FORM1_200_S20,
  ])("gives waiting_input for the real one-field form (%#)", (capture) => {
    expect(classifyOpenCodePaneActivity(capture)).toBe("waiting_input");
  });

  it.each([
    REAL_DIALOG_FORM2_80_S20,
    REAL_DIALOG_FORM2_200_S20,
  ])("gives waiting_input for the real two-field form with enter confirm (%#)", (capture) => {
    expect(classifyOpenCodePaneActivity(capture)).toBe("waiting_input");
  });

  it("gives idle for constructed prose-marker pane: triangle in a real answer line", () => {
    const prose = "     Report complete — final verification.";
    expect(REAL_IDLE_MUSE_2031).toContain(prose);
    expect(
      classifyOpenCodePaneActivity(
        REAL_IDLE_MUSE_2031.replace(prose, "     icon: △ Permission required"),
      ),
    ).toBe("idle");
  });

  it("gives idle for constructed prose-marker pane: Allow once and Reject in a real answer line", () => {
    const prose = "     The review is complete. Summary:";
    expect(REAL_IDLE_V4FLASH_2031).toContain(prose);
    expect(
      classifyOpenCodePaneActivity(
        REAL_IDLE_V4FLASH_2031.replace(
          prose,
          "     Check the line: Allow once   Always allow   Reject",
        ),
      ),
    ).toBe("idle");
  });

  it("gives idle for constructed prose-marker pane: select and submit in a real answer line", () => {
    const prose = "     parallel calls plus conditional message list at 5000 ms, JSONL only as fallback, cost with";
    expect(REAL_IDLE_MUSE_2031).toContain(prose);
    expect(
      classifyOpenCodePaneActivity(
        REAL_IDLE_MUSE_2031.replace(prose, "     Hint row: ↑↓ select  enter submit  esc dismiss"),
      ),
    ).toBe("idle");
  });

  it("gives waiting_input for only the triangle marker in place", () => {
    expect(classifyOpenCodePaneActivity("  ┃  △ Permission required\n  ┃")).toBe(
      "waiting_input",
    );
  });

  it("gives waiting_input for only Allow once with Reject in place", () => {
    expect(classifyOpenCodePaneActivity("  ┃   Allow once   Reject\n  ┃")).toBe(
      "waiting_input",
    );
  });

  it("gives waiting_input for only select with submit in place", () => {
    expect(classifyOpenCodePaneActivity("  ┃  ↑↓ select  enter submit\n  ┃")).toBe(
      "waiting_input",
    );
  });

  it("gives waiting_input for only select with confirm in place", () => {
    expect(classifyOpenCodePaneActivity("  ┃  ⇆ tab  ↑↓ select  enter confirm\n  ┃")).toBe(
      "waiting_input",
    );
  });

  it("gives waiting_input for only select with choose in place", () => {
    expect(classifyOpenCodePaneActivity("  ┃  ↑↓ select  enter choose\n  ┃")).toBe(
      "waiting_input",
    );
  });

  it("is not a dialog with only Allow once in place", () => {
    expect(classifyOpenCodePaneActivity("  ┃  Allow once\n  ┃")).toBe("active");
  });

  it("is not a dialog with only Reject in place", () => {
    expect(classifyOpenCodePaneActivity("  ┃  Reject\n  ┃")).toBe("active");
  });

  it("is not a dialog with only select in place", () => {
    expect(classifyOpenCodePaneActivity("  ┃  ↑↓ select\n  ┃")).toBe("active");
  });

  it("gives idle for empty capture", () => {
    expect(classifyOpenCodePaneActivity("")).toBe("idle");
  });

  it("gives idle for whitespace-only capture", () => {
    expect(classifyOpenCodePaneActivity("   \n  \n")).toBe("idle");
  });

  it("gives active for unknown output", () => {
    expect(classifyOpenCodePaneActivity("hello world\nsome other line")).toBe("active");
  });

  it("gives active for ctrl+p commands in the transcript with a toast as the last line", () => {
    const pane = [
      "  ┃  press ctrl+p commands to open the palette",
      "  ┃",
      "Session failed",
    ].join("\n");
    expect(classifyOpenCodePaneActivity(pane)).toBe("active");
  });

  it("gives idle for a dialog marker above the bottom block with a status row last", () => {
    const pane = [
      "  ┃  △ Permission required",
      "  ┃",
      "  /tmp/proj  shift+tab agents  ctrl+p commands",
    ].join("\n");
    expect(classifyOpenCodePaneActivity(pane)).toBe("idle");
  });
});
