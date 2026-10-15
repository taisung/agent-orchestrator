import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const execFileMock = vi.fn() as unknown as Record<symbol, unknown>;
  // `promisify(execFile)` uses this custom implementation, so the helper
  // under test receives `{stdout, stderr}` or a rejection carrying them.
  execFileMock[Symbol.for("nodejs.util.promisify.custom")] = (...args: unknown[]) =>
    (mockExecFileAsync as (...a: unknown[]) => Promise<unknown>)(...args);
  return {
    execFile: execFileMock,
  };
});

import {
  callOpenCodeApi,
  getOpenCodeSession,
  listOpenCodeSessionsByTitle,
  removeOpenCodeSession,
  interruptOpenCodeSession,
} from "../opencode-api.js";

function execError(message: string, stdout = "", stderr = "", extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { stdout, stderr, ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("callOpenCodeApi", () => {
  it("returns parsed JSON on success", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '{"data":{"id":"ses_1"}}', stderr: "" });
    const result = await callOpenCodeApi("session.get", { params: { sessionID: "ses_1" } });
    expect(result).toEqual({ data: { id: "ses_1" } });
    const [file, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];
    expect(file).toBe("opencode");
    expect(args.slice(0, 2)).toEqual(["api", "session.get"]);
    expect(args).toContain("--param");
    expect(args).toContain("sessionID=ses_1");
    expect(args.join(" ")).not.toContain(";");
  });

  it("returns null for a 404 (session does not exist)", async () => {
    const stdout = JSON.stringify({
      _tag: "SessionNotFoundError",
      sessionID: "ses_gone",
      message: "Session not found: ses_gone",
    });
    mockExecFileAsync.mockRejectedValue(execError("HTTP 404", stdout, "HTTP 404 Not Found", { status: 1 }));
    await expect(getOpenCodeSession("ses_gone")).resolves.toBeNull();
    await expect(removeOpenCodeSession("ses_gone")).resolves.toBeUndefined();
    await expect(interruptOpenCodeSession("ses_gone")).resolves.toBeNull();
  });

  it("throws every other error with cause", async () => {
    const cause = execError("boom", "", "HTTP 500 Internal Server Error", { status: 1 });
    mockExecFileAsync.mockRejectedValue(cause);
    let thrown: Error | undefined;
    try {
      await callOpenCodeApi("session.get", {
        params: { sessionID: "ses_1" },
      });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.cause).toBe(cause);
    expect(thrown?.message).toContain("session.get");
  });

  it("throws on timeout with cause", async () => {
    const cause = execError("timed out", "", "", { code: "ETIMEDOUT" });
    mockExecFileAsync.mockRejectedValue(cause);
    let thrown: Error | undefined;
    try {
      await callOpenCodeApi("session.get", {
        params: { sessionID: "ses_1" },
        timeoutMs: 50,
      });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain("within 50 ms");
    expect(thrown?.cause).toBe(cause);
  });

  it("throws on an answer cut short with exit 0 (never trusts exit code)", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '{"data":{"id":"ses_1",', stderr: "" });
    let thrown: Error | undefined;
    try {
      await callOpenCodeApi("session.get", {
        params: { sessionID: "ses_1" },
      });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain("incomplete JSON");
    expect(thrown?.cause).toBeInstanceOf(Error);
  });

  it("treats empty exit-0 output as success only for session.remove", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
    await expect(removeOpenCodeSession("ses_1")).resolves.toBeUndefined();
    await expect(
      callOpenCodeApi("session.get", { params: { sessionID: "ses_1" } }),
    ).rejects.toThrow(/empty output/);
  });

  it("keeps the child stderr off the terminal (captured, never inherited)", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '{"data":{}}', stderr: "some warning" });
    await callOpenCodeApi("session.list", { params: { search: "x" } });
    const [, , options] = mockExecFileAsync.mock.calls[0] as [
      string,
      string[],
      { timeout?: number; maxBuffer?: number },
    ];
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.maxBuffer).toBeGreaterThan(262144);
  });

  it("has a bounded timeout on every call", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '{"data":[]}', stderr: "" });
    await callOpenCodeApi("session.list", { params: { search: "AO:x" } });
    const [, , options] = mockExecFileAsync.mock.calls[0] as [
      string,
      string[],
      { timeout?: number },
    ];
    expect(options.timeout).toBe(10_000);
  });
});

describe("listOpenCodeSessionsByTitle", () => {
  it("returns only the exact title match (search is a substring)", async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: JSON.stringify({
        data: [
          { id: "ses_prefix", title: "AO:app-1-extra", time: { updated: 2 } },
          { id: "ses_exact_old", title: "AO:app-1", time: { updated: 1 } },
          { id: "ses_exact_new", title: "AO:app-1", time: { updated: 3 } },
        ],
      }),
      stderr: "",
    });
    const sessions = await listOpenCodeSessionsByTitle("AO:app-1");
    expect(sessions.map((s) => s.id)).toEqual(["ses_exact_new", "ses_exact_old"]);
  });
});
