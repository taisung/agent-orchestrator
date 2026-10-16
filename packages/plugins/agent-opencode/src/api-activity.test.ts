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

const SID = "ses_abc123";
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

  it("bounds each call below the helper default", () => {
    expect(OPENCODE_ACTIVITY_API_TIMEOUT_MS).toBeLessThan(10_000);
  });
});

describe("getApiSessionInfo — cost and tokens", () => {
  it("maps constructed cost fixture with reasoning in outputTokens", async () => {
    mockGetOpenCodeSession.mockResolvedValue({
      id: SID,
      title: "AO:test-1",
      cost: 0.0014781,
      tokens: { input: 14499, output: 11, reasoning: 130, cache: { read: 0, write: 0 } },
      time: { updated: Date.now() },
    });

    const info = await getApiSessionInfo(SID);
    expect(info?.agentSessionId).toBe(SID);
    expect(info?.summary).toBe("AO:test-1");
    expect(info?.summaryIsFallback).toBe(true);
    expect(info?.cost).toEqual({
      inputTokens: 14499,
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

describe("classifyOpenCodePaneActivity", () => {
  it("gives idle for constructed 0009-section-5.1 idle capture fixture", () => {
    const idle = [
      "  ┃  Build · Muse Spark 1.3 Contributor OpenCode Go · xhigh",
      "  ╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
      "  /tmp/ao1s-work:main                    shift+tab agents  ctrl+p commands    /tmp/ao1s-work:main",
    ].join("\n");
    expect(classifyOpenCodePaneActivity(idle)).toBe("idle");
  });

  it("gives active for constructed census running fixture", () => {
    expect(classifyOpenCodePaneActivity("work\nesc interrupt")).toBe("active");
  });

  it("gives waiting_input for constructed census permission fixture", () => {
    expect(classifyOpenCodePaneActivity("△ Permission required\nAllow once   Reject")).toBe(
      "waiting_input",
    );
  });

  it("gives waiting_input for constructed census question fixture", () => {
    expect(classifyOpenCodePaneActivity("↑↓ select  enter submit")).toBe("waiting_input");
  });
});
