import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type * as ChildProcess from "node:child_process";

const { mockExecFileAsync, realExecFile } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  realExecFile: { current: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) },
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof ChildProcess>("node:child_process");
  realExecFile.current = promisify(actual.execFile) as unknown as (
    ...a: unknown[]
  ) => Promise<unknown>;
  const execFileMock = vi.fn() as unknown as Record<symbol, unknown>;
  // `promisify(execFile)` uses this custom implementation, so the helper
  // under test receives `{stdout, stderr}` or a rejection carrying them.
  // The "real child process" tests below route it to the real `execFile`.
  execFileMock[Symbol.for("nodejs.util.promisify.custom")] = (...args: unknown[]) =>
    (mockExecFileAsync as (...a: unknown[]) => Promise<unknown>)(...args);
  return {
    ...actual,
    execFile: execFileMock,
  };
});

import {
  callOpenCodeApi,
  getOpenCodeSession,
  listOpenCodeSessionsByTitle,
  findOpenCodeSessionsByTitle,
  waitForOpenCodeSession,
  removeOpenCodeSession,
  interruptOpenCodeSession,
  OPENCODE_SESSION_LIST_MAX_PAGES,
  OpenCodeApiTimeoutError,
} from "../opencode-api.js";
import {
  installMockOpencodeApi,
  addMockApiSession,
  type MockApiSession,
} from "./session-manager/opencode-helpers.js";

function execError(message: string, stdout = "", stderr = "", extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { stdout, stderr, ...extra });
}

function listAnswer(data: unknown[], next?: string) {
  return { stdout: JSON.stringify({ data, cursor: next ? { next } : {} }), stderr: "" };
}

/** `--param key=value` pairs of one recorded call. */
function paramsOf(call: unknown[]): Record<string, string> {
  const args = call[1] as string[];
  const params: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--param") {
      const raw = args[i + 1] ?? "";
      const eq = raw.indexOf("=");
      params[raw.slice(0, eq)] = raw.slice(eq + 1);
      i++;
    }
  }
  return params;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFileAsync.mockReset();
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
    mockExecFileAsync.mockRejectedValue(
      execError("HTTP 404", stdout, "HTTP 404 Not Found", { code: 1 }),
    );
    await expect(getOpenCodeSession("ses_gone")).resolves.toBeNull();
    await expect(removeOpenCodeSession("ses_gone")).resolves.toBeUndefined();
    await expect(interruptOpenCodeSession("ses_gone")).resolves.toBeNull();
  });

  it("throws every other error with cause", async () => {
    const cause = execError("boom", "", "HTTP 500 Internal Server Error", { code: 1 });
    mockExecFileAsync.mockRejectedValue(cause);
    const thrown = await callOpenCodeApi("session.get", { params: { sessionID: "ses_1" } }).catch(
      (e: unknown) => e as Error,
    );
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).cause).toBe(cause);
    expect((thrown as Error).message).toContain("session.get");
    expect((thrown as Error).message).not.toContain("within");
  });

  it("reports a timeout from the real execFile shape (killed, SIGTERM, no code)", async () => {
    // Measured on Node 25: a timeout kill gives `killed: true`,
    // `signal: "SIGTERM"` and `code: null`; there is no "ETIMEDOUT".
    const cause = execError("Command failed", "", "", {
      killed: true,
      signal: "SIGTERM",
      code: null,
    });
    mockExecFileAsync.mockRejectedValue(cause);
    const thrown = (await callOpenCodeApi("session.get", {
      params: { sessionID: "ses_1" },
      timeoutMs: 50,
    }).catch((e: unknown) => e)) as Error;
    expect(thrown).toBeInstanceOf(OpenCodeApiTimeoutError);
    expect(thrown.message).toContain("within 50 ms");
    expect(thrown.cause).toBe(cause);
  });

  it("does not report a child that another process stopped as a timeout", async () => {
    const cause = execError("Command failed", "", "", {
      killed: false,
      signal: "SIGTERM",
      code: null,
    });
    mockExecFileAsync.mockRejectedValue(cause);
    const thrown = (await callOpenCodeApi("session.get", {
      params: { sessionID: "ses_1" },
      timeoutMs: 50,
    }).catch((e: unknown) => e)) as Error;
    expect(thrown).not.toBeInstanceOf(OpenCodeApiTimeoutError);
    expect(thrown.message).not.toContain("within 50 ms");
  });

  it("throws on an answer cut short with exit 0 (never trusts exit code)", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '{"data":{"id":"ses_1",', stderr: "" });
    const thrown = (await callOpenCodeApi("session.get", {
      params: { sessionID: "ses_1" },
    }).catch((e: unknown) => e)) as Error;
    expect(thrown.message).toContain("incomplete JSON");
    expect(thrown.cause).toBeInstanceOf(Error);
  });

  it("treats empty exit-0 output as success only for session.remove", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
    await expect(removeOpenCodeSession("ses_1")).resolves.toBeUndefined();
    await expect(
      callOpenCodeApi("session.get", { params: { sessionID: "ses_1" } }),
    ).rejects.toThrow(/empty output/);
  });

  it("passes the caller's bound to execFile and has a finite default bound", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '{"data":[]}', stderr: "" });
    await callOpenCodeApi("session.list", { params: { search: "AO:x" }, timeoutMs: 1234 });
    await callOpenCodeApi("session.list", { params: { search: "AO:x" } });
    const bounds = mockExecFileAsync.mock.calls.map(
      (call) => (call[2] as { timeout?: number }).timeout,
    );
    expect(bounds[0]).toBe(1234);
    expect(Number.isFinite(bounds[1])).toBe(true);
    expect(bounds[1]).toBeGreaterThan(0);
  });
});

describe("interruptOpenCodeSession", () => {
  it("reads the top-level shape that 2.0.29 answers", async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '{"interrupted":true}', stderr: "" });
    await expect(interruptOpenCodeSession("ses_busy")).resolves.toEqual({ interrupted: true });
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '{"interrupted":false}', stderr: "" });
    await expect(interruptOpenCodeSession("ses_idle")).resolves.toEqual({ interrupted: false });
  });

  it("also reads the shape inside data", async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: '{"data":{"interrupted":true}}',
      stderr: "",
    });
    await expect(interruptOpenCodeSession("ses_busy")).resolves.toEqual({ interrupted: true });
  });
});

describe("listOpenCodeSessionsByTitle", () => {
  it("returns only the exact title, newest first by time.created", async () => {
    mockExecFileAsync.mockResolvedValue(
      listAnswer([
        { id: "ses_prefix", title: "AO:app-1-extra", time: { created: 2 } },
        { id: "ses_exact_old", title: "AO:app-1", time: { created: 1 } },
        { id: "ses_exact_new", title: "AO:app-1", time: { created: 3 } },
      ]),
    );
    const sessions = await listOpenCodeSessionsByTitle("AO:app-1");
    expect(sessions.map((s) => s.id)).toEqual(["ses_exact_new", "ses_exact_old"]);
  });

  it("asks for a page size that keeps one answer far below the 262144-byte pipe size", async () => {
    mockExecFileAsync.mockResolvedValue(listAnswer([]));
    await listOpenCodeSessionsByTitle("AO:app-1");
    const limit = Number(paramsOf(mockExecFileAsync.mock.calls[0]!)["limit"]);
    // A 2.0.29 record is about 410 bytes; 1 KiB per record leaves a margin.
    expect(Number.isInteger(limit)).toBe(true);
    expect(limit).toBeGreaterThan(0);
    expect(limit * 1024).toBeLessThan(262144);
  });

  it("follows cursor.next until a short page and finds an exact title on a later page", async () => {
    mockExecFileAsync.mockImplementation(async (_file: string, args: string[]) => {
      const params = paramsOf(["opencode", args]);
      const limit = Number(params["limit"]);
      if (params["cursor"] === undefined) {
        const full = Array.from({ length: limit }, (_, i) => ({
          id: `ses_newer_${i}`,
          title: `AO:z-1${i}`,
          time: { created: 1000 - i },
        }));
        return listAnswer(full, "page-2");
      }
      expect(params["cursor"]).toBe("page-2");
      return listAnswer([{ id: "ses_exact", title: "AO:z-1", time: { created: 1 } }], "page-3");
    });
    const sessions = await listOpenCodeSessionsByTitle("AO:z-1");
    expect(sessions.map((s) => s.id)).toEqual(["ses_exact"]);
    // The second page is short, so no third call follows its `next` cursor.
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
  });

  it("filters on the directory in the call and again on location.directory", async () => {
    mockExecFileAsync.mockResolvedValue(
      listAnswer([
        { id: "ses_here", title: "AO:app-1", location: { directory: "/w/app-1" } },
        { id: "ses_elsewhere", title: "AO:app-1", location: { directory: "/other/app-1" } },
        { id: "ses_no_location", title: "AO:app-1" },
      ]),
    );
    const sessions = await listOpenCodeSessionsByTitle("AO:app-1", { directory: "/w/app-1" });
    expect(sessions.map((s) => s.id)).toEqual(["ses_here"]);
    expect(paramsOf(mockExecFileAsync.mock.calls[0]!)["directory"]).toBe("/w/app-1");
  });

  it("refuses a partial result when the search has more pages than the cap", async () => {
    mockExecFileAsync.mockImplementation(async (_file: string, args: string[]) => {
      const limit = Number(paramsOf(["opencode", args])["limit"]);
      const full = Array.from({ length: limit }, (_, i) => ({ id: `ses_${i}`, title: "AO:q-10" }));
      return listAnswer(full, "more");
    });
    await expect(listOpenCodeSessionsByTitle("AO:q-1")).rejects.toThrow(/more than/);
    expect(mockExecFileAsync).toHaveBeenCalledTimes(OPENCODE_SESSION_LIST_MAX_PAGES);
  });
});

describe("findOpenCodeSessionsByTitle", () => {
  it("keeps sessions created at or after the given time only", async () => {
    mockExecFileAsync.mockResolvedValue(
      listAnswer([
        { id: "ses_new", title: "AO:a-1", time: { created: 500 }, location: { directory: "/w" } },
        { id: "ses_at", title: "AO:a-1", time: { created: 400 }, location: { directory: "/w" } },
        { id: "ses_old", title: "AO:a-1", time: { created: 399 }, location: { directory: "/w" } },
      ]),
    );
    const sessions = await findOpenCodeSessionsByTitle({
      title: "AO:a-1",
      directories: ["/w"],
      createdAtOrAfter: 400,
    });
    expect(sessions.map((s) => s.id)).toEqual(["ses_new", "ses_at"]);
  });
});

describe("with a real child process (fake opencode on PATH)", () => {
  let tmpDir: string;
  const originalPath = process.env["PATH"];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ao-opencode-api-"));
    mockExecFileAsync.mockImplementation((...args: unknown[]) => realExecFile.current!(...args));
  });

  afterEach(() => {
    process.env["PATH"] = originalPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function useMock(
    sessions: MockApiSession[],
    options?: Parameters<typeof installMockOpencodeApi>[2],
  ) {
    const binDir = installMockOpencodeApi(tmpDir, sessions, options);
    process.env["PATH"] = `${binDir}:${originalPath ?? ""}`;
    return binDir;
  }

  it("captures the child's stderr into the error instead of passing it to the terminal", async () => {
    useMock([], { failOperations: ["session.get"] });
    const thrown = (await getOpenCodeSession("ses_1").catch((e: unknown) => e)) as Error;
    // The text exists only on the child's stderr; it can reach the message
    // only through a captured pipe, so it did not go to the terminal.
    expect(thrown.message).toContain("HTTP 500 Internal Server Error");
  });

  it("ends a call to a hanging binary at its bound", async () => {
    useMock([{ id: "ses_1", title: "AO:h-1" }], { apiDelaySeconds: 5 });
    const started = Date.now();
    const thrown = (await getOpenCodeSession("ses_1", 400).catch((e: unknown) => e)) as Error;
    const elapsedMs = Date.now() - started;
    expect(thrown.message).toContain("within 400 ms");
    const cause = thrown.cause as { killed?: boolean; signal?: string };
    expect(cause.killed).toBe(true);
    expect(cause.signal).toBe("SIGTERM");
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it("finds an exact title behind more than one page of newer substring matches", async () => {
    // The m-2 shape: AO:z-1 is the oldest of 72 sessions that contain it.
    const titles = [
      "AO:z-1",
      ...Array.from({ length: 60 }, (_, i) => `AO:z-${10 + i}`),
      ...Array.from({ length: 11 }, (_, i) => `AO:z-${100 + i}`),
    ];
    useMock(
      titles.map((title, i) => ({ id: `ses_z${i}`, title, createdAt: 1000 + i, directory: "/w" })),
    );
    const sessions = await findOpenCodeSessionsByTitle({ title: "AO:z-1", directories: ["/w"] });
    expect(sessions.map((s) => s.id)).toEqual(["ses_z0"]);
  });

  describe("waitForOpenCodeSession", () => {
    it("finds the session that the pane creates while the wait runs", async () => {
      const binDir = useMock([]);
      const startedAt = Date.now();
      setTimeout(() => {
        addMockApiSession(binDir, {
          id: "ses_pane",
          title: "AO:w-1",
          directory: "/w/w-1",
          createdAt: Date.now(),
        });
      }, 300);
      const result = await waitForOpenCodeSession(
        { title: "AO:w-1", directories: ["/w/w-1"], createdAtOrAfter: startedAt },
        5_000,
        100,
      );
      expect(result).toMatchObject({ status: "found", session: { id: "ses_pane" } });
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    });

    it("ignores the same title in another directory and an older session, until the window ends", async () => {
      const startedAt = Date.now();
      useMock([
        {
          id: "ses_other_fleet",
          title: "AO:w-2",
          directory: "/other/w-2",
          createdAt: startedAt + 1,
        },
        { id: "ses_older", title: "AO:w-2", directory: "/w/w-2", createdAt: startedAt - 1 },
      ]);
      const result = await waitForOpenCodeSession(
        { title: "AO:w-2", directories: ["/w/w-2"], createdAtOrAfter: startedAt },
        1_000,
        200,
      );
      expect(result.status).toBe("not-found");
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(1_000);
      expect(elapsedMs).toBeLessThan(3_000);
    });

    it("reports two matches as ambiguous and picks none", async () => {
      const startedAt = Date.now();
      useMock([
        { id: "ses_a", title: "AO:w-3", directory: "/w", createdAt: startedAt + 1 },
        { id: "ses_b", title: "AO:w-3", directory: "/w", createdAt: startedAt + 2 },
      ]);
      const result = await waitForOpenCodeSession(
        { title: "AO:w-3", directories: ["/w"], createdAtOrAfter: startedAt },
        1_000,
        200,
      );
      expect(result.status).toBe("ambiguous");
      if (result.status === "ambiguous") {
        expect(result.sessions.map((s) => s.id).sort()).toEqual(["ses_a", "ses_b"]);
      }
    });

    it("makes a final bounded search after suspension across the poll deadline", async () => {
      vi.useFakeTimers();
      try {
        const startedAt = Date.now();
        mockExecFileAsync.mockResolvedValueOnce(listAnswer([])).mockResolvedValueOnce(
          listAnswer([
            {
              id: "ses_during_stall",
              title: "AO:stall",
              location: { directory: "/w" },
              time: { created: startedAt + 50 },
            },
          ]),
        );
        const waiting = waitForOpenCodeSession(
          { title: "AO:stall", directories: ["/w"], createdAtOrAfter: startedAt },
          100,
          20,
        );
        await vi.advanceTimersByTimeAsync(0);
        vi.setSystemTime(startedAt + 1_000);
        await vi.advanceTimersByTimeAsync(20);
        expect(await waiting).toMatchObject({
          status: "found",
          session: { id: "ses_during_stall" },
        });
        expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
        expect(mockExecFileAsync.mock.calls[1][2].timeout).toBeGreaterThan(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("rechecks a successful empty result buffered before suspension", async () => {
      vi.useFakeTimers();
      try {
        const startedAt = Date.now();
        mockExecFileAsync
          .mockImplementationOnce(async () => {
            vi.setSystemTime(startedAt + 1_000);
            return listAnswer([]);
          })
          .mockResolvedValueOnce(
            listAnswer([
              {
                id: "ses_buffered",
                title: "AO:stall",
                location: { directory: "/w" },
                time: { created: startedAt + 50 },
              },
            ]),
          );
        expect(
          await waitForOpenCodeSession({ title: "AO:stall", directories: ["/w"] }, 100, 20),
        ).toMatchObject({ status: "found", session: { id: "ses_buffered" } });
        expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("ends within its window when the binary hangs", async () => {
      useMock([], { apiDelaySeconds: 5 });
      const startedAt = Date.now();
      const result = await waitForOpenCodeSession(
        { title: "AO:w-4", directories: ["/w"], createdAtOrAfter: startedAt },
        1_000,
        200,
      );
      const elapsedMs = Date.now() - startedAt;
      expect(result.status).toBe("not-found");
      if (result.status === "not-found") {
        expect(String(result.lastError)).toContain("within");
      }
      expect(elapsedMs).toBeLessThan(2_500);
    });
  });
});
