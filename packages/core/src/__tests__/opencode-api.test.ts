import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type * as ChildProcess from "node:child_process";

const { mockExecFileAsync, realExecFile, mockSpawn, realSpawn } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  realExecFile: { current: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) },
  mockSpawn: vi.fn(),
  realSpawn: { current: undefined as undefined | ((...a: unknown[]) => unknown) },
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
  // `model.list` runs with `spawn` (stdout to a file, m-2). Only the tests
  // that put the fake opencode on PATH route it to the real `spawn`, so no
  // test can start an `opencode` from the host PATH.
  realSpawn.current = actual.spawn as unknown as (...a: unknown[]) => unknown;
  return {
    ...actual,
    execFile: execFileMock,
    spawn: (...args: unknown[]) => (mockSpawn as (...a: unknown[]) => unknown)(...args),
  };
});

import {
  callOpenCodeApi,
  getOpenCodeSession,
  listOpenCodeSessionsByTitle,
  findOpenCodeSessionsByTitle,
  removeOpenCodeSession,
  interruptOpenCodeSession,
  listOpenCodeModels,
  findOpenCodeModelProblem,
  createOpenCodeSession,
  switchOpenCodeSessionModel,
  switchOpenCodeSessionAgent,
  hasOpenCodeUserMessage,
  getNewestOpenCodeUserMessage,
  OPENCODE_SESSION_LIST_MAX_PAGES,
  OPENCODE_PROMPT_MAX_BODY_BYTES,
  OpenCodeApiTimeoutError,
  OpenCodeApiIncompleteAnswerError,
  OpenCodeApiRequestError,
  OpenCodeApiUnexpectedAnswerError,
  OpenCodeApiSpawnError,
  OpenCodePromptTooLargeError,
  buildOpenCodePromptBody,
  mintOpenCodeMessageId,
  promptOpenCodeSession,
  findOpenCodePromptInput,
  type OpenCodeApiModel,
} from "../opencode-api.js";
import {
  installMockOpencodeApi,
  readMockApiEnvLog,
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
  mockSpawn.mockReset();
  mockSpawn.mockImplementation(() => {
    throw new Error("unexpected spawn: put the fake opencode on PATH first");
  });
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
});

/**
 * The two fleet pins as the global 2.0.31 service lists them in `model.list`
 * (measured read-only on 2026-10-16; `settings`, `headers`, `capabilities`,
 * `cost`, `time` and `limit` left out). The check must accept both.
 */
const FLEET_PIN_MODELS: OpenCodeApiModel[] = [
  {
    id: "muse-spark-1.3-contributor",
    modelID: "muse-spark-1.3-contributor",
    providerID: "opencode-go",
    family: "muse",
    name: "Muse Spark 1.3 Contributor",
    variants: [{ id: "minimal" }, { id: "low" }, { id: "medium" }, { id: "high" }, { id: "xhigh" }],
    status: "active",
    enabled: true,
  },
  {
    id: "deepseek-v4.1-flash",
    modelID: "deepseek-v4.1-flash",
    providerID: "opencode-go",
    family: "deepseek-flash",
    name: "DeepSeek V4.1 Flash",
    variants: [{ id: "low" }, { id: "high" }, { id: "max" }],
    status: "active",
    enabled: true,
  },
];

/** A measured 2.0.31 entry whose `id` differs from its `modelID`. */
const FAST_VARIANT_MODEL: OpenCodeApiModel = {
  id: "gpt-6.1-sol-fast",
  modelID: "gpt-6.1-sol",
  providerID: "openai",
  variants: [],
  status: "active",
  enabled: true,
};

describe("the session environment of a spawn call (env)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["AO_SESSION", "AO_CALLER_TYPE", "AO_ISSUE_ID", "AO_TEST_ONLY_OUTER"]) {
      saved[key] = process.env[key];
    }
    // The `ao` process of an orchestrator carries the orchestrator's values.
    process.env["AO_SESSION"] = "orch-1";
    process.env["AO_CALLER_TYPE"] = "orchestrator";
    process.env["AO_ISSUE_ID"] = "orchestrator-issue";
    process.env["AO_TEST_ONLY_OUTER"] = "leak";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  it("runs the child with the session map and none of the ao process AO_* values", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '{"data":{"id":"ses_1"}}', stderr: "" });
    await getOpenCodeSession("ses_1", undefined, {
      AO_SESSION: "app-7",
      AO_CALLER_TYPE: "agent",
      PATH: "/home/u/.ao/bin:/usr/bin",
    });
    const env = (mockExecFileAsync.mock.calls[0]![2] as { env?: NodeJS.ProcessEnv }).env;
    expect(env).toBeDefined();
    expect(env!["AO_SESSION"]).toBe("app-7");
    expect(env!["AO_CALLER_TYPE"]).toBe("agent");
    expect(env!["PATH"]).toBe("/home/u/.ao/bin:/usr/bin");
    expect(env!["AO_ISSUE_ID"]).toBeUndefined();
    expect(env!["AO_TEST_ONLY_OUTER"]).toBeUndefined();
    // Variables other than AO_* stay, so the CLI still finds its store.
    expect(env!["HOME"]).toBe(process.env["HOME"]);
  });

  it("passes no env option without a map, so other callers keep process.env", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '{"data":{"id":"ses_1"}}', stderr: "" });
    await getOpenCodeSession("ses_1");
    expect((mockExecFileAsync.mock.calls[0]![2] as { env?: unknown }).env).toBeUndefined();
  });

  it("gives the map to every spawn call", async () => {
    const env = { AO_SESSION: "app-7" };
    mockExecFileAsync.mockImplementation(async (_file: string, args: string[]) => {
      if (args[1] === "session.create") return { stdout: '{"data":{"id":"ses_new"}}', stderr: "" };
      if (args[1] === "session.message.list") return { stdout: '{"data":[]}', stderr: "" };
      return { stdout: "{}", stderr: "" };
    });
    // `model.list` runs through a file; its env is checked with the fake
    // binary in the listOpenCodeModels tests.
    await createOpenCodeSession({ title: "AO:app-7", location: { directory: "/w" } }, { env });
    await switchOpenCodeSessionModel("ses_new", { providerID: "p", id: "m" }, { env });
    await switchOpenCodeSessionAgent("ses_new", "build", { env });
    await hasOpenCodeUserMessage("ses_new", { env });
    await getNewestOpenCodeUserMessage("ses_new", { env });
    await hasOpenCodeUserMessage("ses_new", { env, after: { id: "msg_1", created: 1 } });
    await interruptOpenCodeSession("ses_new", undefined, env);
    await removeOpenCodeSession("ses_new", undefined, env);
    expect(mockExecFileAsync).toHaveBeenCalledTimes(8);
    for (const call of mockExecFileAsync.mock.calls) {
      const childEnv = (call[2] as { env?: NodeJS.ProcessEnv }).env;
      expect(childEnv?.["AO_SESSION"]).toBe("app-7");
      expect(childEnv?.["AO_CALLER_TYPE"]).toBeUndefined();
    }
  });
});

describe("listOpenCodeModels (stdout through a file, m-2)", () => {
  let tmpDir: string;
  let answerRoot: string;
  let apiLogPath: string;
  const originalPath = process.env["PATH"];
  const originalTmpdir = process.env["TMPDIR"];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ao-opencode-models-"));
    // `os.tmpdir()` reads TMPDIR on each call, so the answer files of the
    // calls under test land here and the tests can see them removed.
    answerRoot = join(tmpDir, "answers");
    mkdirSync(answerRoot);
    apiLogPath = join(tmpDir, "api.log");
    process.env["TMPDIR"] = answerRoot;
    mockSpawn.mockImplementation((...args: unknown[]) => realSpawn.current!(...args));
  });

  afterEach(() => {
    process.env["PATH"] = originalPath;
    if (originalTmpdir === undefined) Reflect.deleteProperty(process.env, "TMPDIR");
    else process.env["TMPDIR"] = originalTmpdir;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function useMock(options?: Parameters<typeof installMockOpencodeApi>[2]): string {
    const binDir = installMockOpencodeApi(tmpDir, [], {
      models: FLEET_PIN_MODELS,
      apiLogPath,
      ...options,
    });
    process.env["PATH"] = `${binDir}:${originalPath ?? ""}`;
    return binDir;
  }

  /** A fake `opencode` that prints `stdout` and exits 0, for answers the API mock cannot give. */
  function useScript(stdout: string): void {
    const binDir = join(tmpDir, "script-bin");
    mkdirSync(binDir, { recursive: true });
    const script = join(binDir, "opencode");
    writeFileSync(script, `#!/bin/sh\nprintf '%s' '${stdout}'\n`, "utf-8");
    chmodSync(script, 0o755);
    process.env["PATH"] = `${binDir}:${originalPath ?? ""}`;
  }

  function calls(): number {
    return readFileSync(apiLogPath, "utf-8").trim().split("\n").length;
  }

  it("reads the answer from a file, not a pipe, and removes the file", async () => {
    useMock();
    const models = await listOpenCodeModels();
    expect(models.map((m) => m.id)).toEqual(["muse-spark-1.3-contributor", "deepseek-v4.1-flash"]);
    expect(mockExecFileAsync).not.toHaveBeenCalled();
    const [file, args, options] = mockSpawn.mock.calls[0]! as [
      string,
      string[],
      { stdio: unknown[] },
    ];
    expect([file, args]).toEqual(["opencode", ["api", "model.list"]]);
    // stdout is a file descriptor (a number), not "pipe".
    expect(typeof options.stdio[1]).toBe("number");
    expect(options.stdio[2]).toBe("pipe");
    expect(readdirSync(answerRoot)).toEqual([]);
  });

  it("reads an answer far above the 262144-byte pipe size in full", async () => {
    const many = Array.from({ length: 3_000 }, (_, i) => ({
      ...FLEET_PIN_MODELS[0]!,
      id: `model-${i}`,
      description: "x".repeat(200),
    }));
    useMock({ models: many });
    const models = await listOpenCodeModels();
    expect(models).toHaveLength(3_000);
    expect(models[2_999]!.id).toBe("model-2999");
    expect(readdirSync(answerRoot)).toEqual([]);
  });

  it("asks once more after a cut file answer with exit 0, so one cut does not fail a spawn", async () => {
    useMock({ cutModelListTimes: 1 });
    await expect(listOpenCodeModels()).resolves.toHaveLength(2);
    expect(calls()).toBe(2);
    expect(readdirSync(answerRoot)).toEqual([]);
  });

  it("throws the incomplete-answer error after a second cut file answer", async () => {
    useMock({ cutModelListTimes: 2 });
    await expect(listOpenCodeModels()).rejects.toBeInstanceOf(OpenCodeApiIncompleteAnswerError);
    expect(calls()).toBe(2);
    expect(readdirSync(answerRoot)).toEqual([]);
  });

  it("also asks again after an empty exit-0 answer", async () => {
    useScript("");
    await expect(listOpenCodeModels()).rejects.toBeInstanceOf(OpenCodeApiIncompleteAnswerError);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(readdirSync(answerRoot)).toEqual([]);
  });

  it("does not ask again after another failure, and keeps the child's stderr in the error", async () => {
    useMock({ failOperations: ["model.list"] });
    await expect(listOpenCodeModels()).rejects.toThrow(
      "opencode api model.list failed: HTTP 500 Internal Server Error",
    );
    expect(calls()).toBe(1);
    expect(readdirSync(answerRoot)).toEqual([]);
  });

  it("ends a hanging call at its bound and removes the file", async () => {
    useMock({ apiDelaySeconds: 5 });
    const started = Date.now();
    const thrown = (await listOpenCodeModels({ timeoutMs: 400 }).catch((e: unknown) => e)) as Error;
    expect(thrown).toBeInstanceOf(OpenCodeApiTimeoutError);
    expect(thrown.message).toContain("did not answer within 400 ms");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(readdirSync(answerRoot)).toEqual([]);
  });

  it("fails when no opencode is on PATH, and removes the file", async () => {
    process.env["PATH"] = join(tmpDir, "empty-bin");
    await expect(listOpenCodeModels()).rejects.toThrow(
      /opencode api model\.list failed: spawn opencode ENOENT/,
    );
    expect(readdirSync(answerRoot)).toEqual([]);
  });

  it("refuses an answer without a data array", async () => {
    useScript('{"models":[]}');
    await expect(listOpenCodeModels()).rejects.toThrow(/without data array/);
  });

  it("still refuses a model that the file answer does not list", async () => {
    useMock();
    const models = await listOpenCodeModels();
    expect(findOpenCodeModelProblem(models, { providerID: "openai", id: "no-such-model" })).toBe(
      "model.list has no model openai/no-such-model",
    );
  });

  it("runs the child with the session map and none of the ao process AO_* values", async () => {
    const envLogPath = join(tmpDir, "env.log");
    const binDir = useMock({ envLogPath });
    const saved = process.env["AO_SESSION"];
    process.env["AO_SESSION"] = "orch-1";
    try {
      await listOpenCodeModels({
        env: { AO_SESSION: "app-7", PATH: `${binDir}:${originalPath ?? ""}` },
      });
    } finally {
      if (saved === undefined) Reflect.deleteProperty(process.env, "AO_SESSION");
      else process.env["AO_SESSION"] = saved;
    }
    const [entry] = readMockApiEnvLog(envLogPath);
    expect(entry?.op).toBe("model.list");
    expect(entry?.env["AO_SESSION"]).toBe("app-7");
  });
});

describe("findOpenCodeModelProblem", () => {
  const models = [...FLEET_PIN_MODELS, FAST_VARIANT_MODEL];

  it.each([
    ["opencode-go", "muse-spark-1.3-contributor", undefined],
    ["opencode-go", "muse-spark-1.3-contributor", "xhigh"],
    ["opencode-go", "deepseek-v4.1-flash", undefined],
    ["opencode-go", "deepseek-v4.1-flash", "max"],
    ["opencode-go", "deepseek-v4.1-flash", "default"],
  ])("accepts the fleet pin %s/%s variant %s", (providerID, id, variant) => {
    expect(
      findOpenCodeModelProblem(models, { providerID, id, ...(variant ? { variant } : {}) }),
    ).toBeNull();
  });

  it("refuses a model that the list does not have (the 0010 no-route sample)", () => {
    expect(findOpenCodeModelProblem(models, { providerID: "ao1m-none", id: "none" })).toBe(
      "model.list has no model ao1m-none/none",
    );
  });

  it("refuses a model whose provider differs", () => {
    expect(
      findOpenCodeModelProblem(models, { providerID: "opencode", id: "deepseek-v4.1-flash" }),
    ).toContain("has no model");
  });

  it("matches the create id against Model.Info id, not modelID", () => {
    expect(
      findOpenCodeModelProblem(models, { providerID: "openai", id: "gpt-6.1-sol-fast" }),
    ).toBeNull();
    expect(findOpenCodeModelProblem(models, { providerID: "openai", id: "gpt-6.1-sol" })).toContain(
      "has no model",
    );
  });

  it("refuses a model that is not enabled", () => {
    const disabled = [{ ...FLEET_PIN_MODELS[0]!, enabled: false }];
    expect(
      findOpenCodeModelProblem(disabled, {
        providerID: "opencode-go",
        id: "muse-spark-1.3-contributor",
      }),
    ).toContain("is not enabled");
  });

  it("refuses a variant that the model does not list", () => {
    expect(
      findOpenCodeModelProblem(models, {
        providerID: "opencode-go",
        id: "deepseek-v4.1-flash",
        variant: "xhigh",
      }),
    ).toBe("model opencode-go/deepseek-v4.1-flash has no variant xhigh");
  });
});

describe("createOpenCodeSession", () => {
  it("sends the body with -d and returns the new session", async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: '{"data":{"id":"ses_new","title":"AO:app-1"}}',
      stderr: "",
    });
    const body = {
      title: "AO:app-1",
      model: { providerID: "opencode-go", id: "deepseek-v4.1-flash" },
      agent: "build",
      location: { directory: "/real/ws" },
    };
    const session = await createOpenCodeSession(body);
    expect(session.id).toBe("ses_new");
    const args = mockExecFileAsync.mock.calls[0]![1] as string[];
    expect(args.slice(0, 2)).toEqual(["api", "session.create"]);
    expect(JSON.parse(args[args.indexOf("-d") + 1]!)).toEqual(body);
  });

  it.each([['{"data":{}}'], ['{"data":{"id":"not-a-session"}}'], ['{"error":"x"}']])(
    "throws when the answer holds no usable session ID: %s",
    async (stdout) => {
      mockExecFileAsync.mockResolvedValue({ stdout, stderr: "" });
      await expect(
        createOpenCodeSession({ title: "AO:app-1", location: { directory: "/w" } }),
      ).rejects.toThrow(/no usable session ID/);
    },
  );

  it("throws a failed create with cause", async () => {
    const cause = execError("boom", "", "HTTP 500", { code: 1 });
    mockExecFileAsync.mockRejectedValue(cause);
    const thrown = (await createOpenCodeSession({
      title: "AO:app-1",
      location: { directory: "/w" },
    }).catch((e: unknown) => e)) as Error;
    expect(thrown.message).toContain("session.create failed");
    expect(thrown.cause).toBe(cause);
  });
});

describe("switchOpenCodeSessionModel and switchOpenCodeSessionAgent", () => {
  it("send the sessionID param and the body", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: "{}", stderr: "" });
    await switchOpenCodeSessionModel("ses_1", { providerID: "p", id: "m", variant: "high" });
    await switchOpenCodeSessionAgent("ses_1", "build");
    const [modelCall, agentCall] = mockExecFileAsync.mock.calls as [unknown[], unknown[]];
    expect((modelCall[1] as string[])[1]).toBe("session.switchModel");
    expect(paramsOf(modelCall)["sessionID"]).toBe("ses_1");
    const modelArgs = modelCall[1] as string[];
    expect(JSON.parse(modelArgs[modelArgs.indexOf("-d") + 1]!)).toEqual({
      model: { providerID: "p", id: "m", variant: "high" },
    });
    const agentArgs = agentCall[1] as string[];
    expect(agentArgs[1]).toBe("session.switchAgent");
    expect(JSON.parse(agentArgs[agentArgs.indexOf("-d") + 1]!)).toEqual({ agent: "build" });
  });

  it("throw on a 404: a reused session that is gone gets no TUI", async () => {
    mockExecFileAsync.mockRejectedValue(
      execError("HTTP 404", '{"_tag":"SessionNotFoundError"}', "HTTP 404 Not Found", { code: 1 }),
    );
    await expect(
      switchOpenCodeSessionModel("ses_gone", { providerID: "p", id: "m" }),
    ).rejects.toThrow(/does not exist/);
    await expect(switchOpenCodeSessionAgent("ses_gone", "build")).rejects.toThrow(/does not exist/);
  });
});

describe("hasOpenCodeUserMessage", () => {
  it("asks for one user message and answers true when one exists", async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: JSON.stringify({
        data: [{ id: "msg_1", type: "user", text: "Go", time: { created: 1 } }],
        cursor: {},
      }),
      stderr: "",
    });
    await expect(hasOpenCodeUserMessage("ses_1")).resolves.toBe(true);
    const call = mockExecFileAsync.mock.calls[0]!;
    expect((call[1] as string[])[1]).toBe("session.message.list");
    expect(paramsOf(call)).toEqual({ sessionID: "ses_1", type: "user", limit: "1" });
  });

  it("answers false for no message, another type and a 404", async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '{"data":[],"cursor":{}}', stderr: "" });
    await expect(hasOpenCodeUserMessage("ses_1")).resolves.toBe(false);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: '{"data":[{"id":"m","type":"assistant"}],"cursor":{}}',
      stderr: "",
    });
    await expect(hasOpenCodeUserMessage("ses_1")).resolves.toBe(false);
    mockExecFileAsync.mockRejectedValueOnce(
      execError("HTTP 404", '{"_tag":"SessionNotFoundError"}', "HTTP 404 Not Found", { code: 1 }),
    );
    await expect(hasOpenCodeUserMessage("ses_gone")).resolves.toBe(false);
  });

  function newestAnswer(messages: unknown[]) {
    return { stdout: JSON.stringify({ data: messages, cursor: {} }), stderr: "" };
  }

  it("with a baseline, asks for the newest user message and needs a newer one (M-2)", async () => {
    const after = { id: "msg_old", created: 1_000 };
    mockExecFileAsync.mockResolvedValueOnce(
      newestAnswer([{ id: "msg_old", type: "user", text: "old", time: { created: 1_000 } }]),
    );
    await expect(hasOpenCodeUserMessage("ses_1", { after })).resolves.toBe(false);
    expect(paramsOf(mockExecFileAsync.mock.calls[0]!)).toEqual({
      sessionID: "ses_1",
      type: "user",
      limit: "1",
      order: "desc",
    });

    mockExecFileAsync.mockResolvedValueOnce(
      newestAnswer([{ id: "msg_new", type: "user", text: "new", time: { created: 2_000 } }]),
    );
    await expect(hasOpenCodeUserMessage("ses_1", { after })).resolves.toBe(true);

    // Another ID that is older than the baseline is not newer.
    mockExecFileAsync.mockResolvedValueOnce(
      newestAnswer([{ id: "msg_odd", type: "user", text: "odd", time: { created: 500 } }]),
    );
    await expect(hasOpenCodeUserMessage("ses_1", { after })).resolves.toBe(false);

    mockExecFileAsync.mockResolvedValueOnce(newestAnswer([]));
    await expect(hasOpenCodeUserMessage("ses_1", { after })).resolves.toBe(false);

    mockExecFileAsync.mockRejectedValueOnce(
      execError("HTTP 404", '{"_tag":"SessionNotFoundError"}', "HTTP 404 Not Found", { code: 1 }),
    );
    await expect(hasOpenCodeUserMessage("ses_gone", { after })).resolves.toBe(false);
  });
});

describe("getNewestOpenCodeUserMessage", () => {
  it("returns the ID and time.created of the newest user message", async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: JSON.stringify({
        data: [{ id: "msg_9", type: "user", text: "Go", time: { created: 9_000 } }],
        cursor: {},
      }),
      stderr: "",
    });
    await expect(getNewestOpenCodeUserMessage("ses_1")).resolves.toEqual({
      id: "msg_9",
      created: 9_000,
    });
    expect(paramsOf(mockExecFileAsync.mock.calls[0]!)).toEqual({
      sessionID: "ses_1",
      type: "user",
      limit: "1",
      order: "desc",
    });
  });

  it("returns null for a session without a user message", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '{"data":[],"cursor":{}}', stderr: "" });
    await expect(getNewestOpenCodeUserMessage("ses_1")).resolves.toBeNull();
  });

  it("throws on a 404 and on an entry without id or time", async () => {
    mockExecFileAsync.mockRejectedValueOnce(
      execError("HTTP 404", '{"_tag":"SessionNotFoundError"}', "HTTP 404 Not Found", { code: 1 }),
    );
    await expect(getNewestOpenCodeUserMessage("ses_gone")).rejects.toThrow(
      "OpenCode session ses_gone does not exist",
    );
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: '{"data":[{"type":"user","text":"x"}],"cursor":{}}',
      stderr: "",
    });
    await expect(getNewestOpenCodeUserMessage("ses_1")).rejects.toThrow(
      "user message without id or time.created",
    );
  });
});

describe("spawn calls with a real child process (fake opencode on PATH)", () => {
  let tmpDir: string;
  const originalPath = process.env["PATH"];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ao-opencode-api-spawn-"));
    mockExecFileAsync.mockImplementation((...args: unknown[]) => realExecFile.current!(...args));
  });

  afterEach(() => {
    process.env["PATH"] = originalPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the session and the child sees the session map, not the ao process AO_* values", async () => {
    const envLogPath = join(tmpDir, "env.log");
    const binDir = installMockOpencodeApi(tmpDir, [], { envLogPath });
    const savedSession = process.env["AO_SESSION"];
    process.env["AO_SESSION"] = "orch-1";
    try {
      const session = await createOpenCodeSession(
        { title: "AO:app-3", location: { directory: "/w" } },
        { env: { AO_SESSION: "app-3", PATH: `${binDir}:${originalPath ?? ""}` } },
      );
      expect(session.id).toMatch(/^ses_created_/);
    } finally {
      if (savedSession === undefined) delete process.env["AO_SESSION"];
      else process.env["AO_SESSION"] = savedSession;
    }
    const [entry] = readMockApiEnvLog(envLogPath);
    expect(entry?.op).toBe("session.create");
    expect(entry?.env["AO_SESSION"]).toBe("app-3");
  });
});

describe("callOpenCodeApi HTTP errors (I-5)", () => {
  it("throws OpenCodeApiRequestError with the status, tag and API message, and keeps the message", async () => {
    const stdout = JSON.stringify({
      _tag: "ConflictError",
      message: "Prompt message ID conflicts with an existing durable record: msg_1",
      resource: "msg_1",
    });
    mockExecFileAsync.mockRejectedValue(
      execError("Command failed", stdout, "HTTP 409 Conflict\n", { code: 1 }),
    );
    const err = (await callOpenCodeApi("session.prompt").catch(
      (e: unknown) => e,
    )) as OpenCodeApiRequestError;

    expect(err).toBeInstanceOf(OpenCodeApiRequestError);
    expect(err.message).toBe("opencode api session.prompt failed: HTTP 409 Conflict");
    expect(err.status).toBe(409);
    expect(err.tag).toBe("ConflictError");
    expect(err.apiMessage).toBe(
      "Prompt message ID conflicts with an existing durable record: msg_1",
    );
    expect(err.cause).toBeInstanceOf(Error);
  });

  it("keeps null for a 404 by default, and throws it with the tag on notFound: throw", async () => {
    const location = JSON.stringify({
      _tag: "LocationNotFoundError",
      location: { directory: "/tmp/gone" },
      message: "Location not found: /tmp/gone",
    });
    mockExecFileAsync.mockRejectedValue(
      execError("Command failed", location, "HTTP 404 Not Found\n"),
    );
    await expect(callOpenCodeApi("session.prompt")).resolves.toBeNull();

    const err = (await callOpenCodeApi("session.prompt", { notFound: "throw" }).catch(
      (e: unknown) => e,
    )) as OpenCodeApiRequestError;
    expect(err).toBeInstanceOf(OpenCodeApiRequestError);
    expect([err.status, err.tag, err.apiMessage]).toEqual([
      404,
      "LocationNotFoundError",
      "Location not found: /tmp/gone",
    ]);
  });

  it("gives a plain error when the service gave no HTTP status", async () => {
    mockExecFileAsync.mockRejectedValue(execError("Command failed", "", "Unable to connect\n"));
    const err = (await callOpenCodeApi("session.get").catch((e: unknown) => e)) as Error;
    expect(err).not.toBeInstanceOf(OpenCodeApiRequestError);
    expect(err.message).toBe("opencode api session.get failed: Unable to connect");
  });
});

describe("mintOpenCodeMessageId (I-5, B-1)", () => {
  // Real IDs that the isolated 2.0.32 service minted (ao-41, 2026-10-19): P1
  // in ms 1792461018263 and P3 in ms 1792461018872, both with counter 1.
  const SERVER_P1 = "msg_157009497001oRN0pU1l5sMD2J";
  const SERVER_P3 = "msg_1570096f8001o4Kwva2CRzBKs6";

  it("has the form of a service ID: msg_, 12 hex digits, 14 base62 characters", () => {
    for (let i = 0; i < 50; i++) {
      expect(mintOpenCodeMessageId()).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    }
    expect(mintOpenCodeMessageId()).toHaveLength(SERVER_P1.length);
  });

  it("sorts by time with the IDs that the service minted", () => {
    const before = mintOpenCodeMessageId(1_792_461_018_262);
    const between = mintOpenCodeMessageId(1_792_461_018_500);
    const after = mintOpenCodeMessageId(1_792_461_018_873);
    expect([after, SERVER_P3, between, SERVER_P1, before].sort()).toEqual([
      before,
      SERVER_P1,
      between,
      SERVER_P3,
      after,
    ]);
    // The same ms as P1: the time digits match the service, the counter of ao's own
    // process decides, and the random part differs.
    expect(mintOpenCodeMessageId(1_792_461_018_263).slice(0, 13)).toBe(SERVER_P1.slice(0, 13));
  });

  it("sorts IDs of one ms by their counter, and never repeats one", () => {
    const now = 1_792_461_020_000;
    const ids = Array.from({ length: 200 }, () => mintOpenCodeMessageId(now));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildOpenCodePromptBody (I-5 size rule)", () => {
  const ID = "msg_157009572001NJPQm5mQNVn3gG";
  // `{"id":"msg_<26>","text":"","delivery":"queue"}`: the ID has a fixed length.
  const overhead = Buffer.byteLength(
    JSON.stringify({ id: ID, text: "", delivery: "queue" }),
    "utf-8",
  );

  it("builds the queue body with the input ID and the exact text", () => {
    expect(buildOpenCodePromptBody("a\nb 'c' \"d\"", ID)).toEqual({
      id: ID,
      text: "a\nb 'c' \"d\"",
      delivery: "queue",
    });
  });

  it("checks the size with a stand-in ID of the same length before the ID exists", () => {
    const fits = "a".repeat(OPENCODE_PROMPT_MAX_BODY_BYTES - overhead);
    expect(() => buildOpenCodePromptBody(fits)).not.toThrow();
    expect(() => buildOpenCodePromptBody(`${fits}a`)).toThrow(OpenCodePromptTooLargeError);
    expect(() => buildOpenCodePromptBody(fits, mintOpenCodeMessageId())).not.toThrow();
  });

  it.skipIf(process.platform !== "linux")(
    "the limit is the largest single argument that this host accepts",
    () => {
      const actual = vi.importActual<typeof ChildProcess>("node:child_process");
      return actual.then(({ execFileSync }) => {
        const run = (bytes: number) => () =>
          execFileSync("/bin/true", ["x".repeat(bytes)], { env: {} });
        expect(run(OPENCODE_PROMPT_MAX_BODY_BYTES)).not.toThrow();
        expect(run(OPENCODE_PROMPT_MAX_BODY_BYTES + 1)).toThrow(/E2BIG/);
      });
    },
  );

  it("accepts a body of exactly the limit and refuses one byte more", () => {
    const fits = "a".repeat(OPENCODE_PROMPT_MAX_BODY_BYTES - overhead);
    expect(Buffer.byteLength(JSON.stringify(buildOpenCodePromptBody(fits, ID)))).toBe(
      OPENCODE_PROMPT_MAX_BODY_BYTES,
    );
    const err = (() => {
      try {
        buildOpenCodePromptBody(`${fits}a`, ID);
      } catch (e) {
        return e;
      }
      return undefined;
    })() as OpenCodePromptTooLargeError;
    expect(err).toBeInstanceOf(OpenCodePromptTooLargeError);
    expect(err.bodyBytes).toBe(OPENCODE_PROMPT_MAX_BODY_BYTES + 1);
  });

  it("counts UTF-8 bytes of the JSON, with its escapes", () => {
    // "é" is 2 bytes, a newline is 2 bytes as "\n" in JSON.
    const half = Math.floor((OPENCODE_PROMPT_MAX_BODY_BYTES - overhead) / 2);
    expect(() => buildOpenCodePromptBody("é".repeat(half), ID)).not.toThrow();
    expect(() => buildOpenCodePromptBody("é".repeat(half + 1), ID)).toThrow(
      OpenCodePromptTooLargeError,
    );
    expect(() => buildOpenCodePromptBody("\n".repeat(half + 1), ID)).toThrow(
      OpenCodePromptTooLargeError,
    );
  });

  it("refuses a 200 KB message and never cuts it", () => {
    const bytes = 200 * 1024 + overhead;
    expect(() => buildOpenCodePromptBody("x".repeat(200 * 1024), ID)).toThrow(
      new RegExp(`has ${bytes} bytes, more than the 131071 bytes .*nothing was sent`),
    );
  });
});

describe("send calls with a real child process (fake opencode on PATH, I-5)", () => {
  let tmpDir: string;
  let statePath: string;
  let logPath: string;
  const originalPath = process.env["PATH"];
  const ID = "ses_send";
  const INPUT = "msg_157009572001NJPQm5mQNVn3gG";

  /**
   * A fake `opencode api` with the 2.0.32 answer shapes and its client-ID rule
   * (`SessionInbox.reconcile`, read in the binary and measured on an isolated
   * store): `session.prompt` with an `id` that a `user` input of this session
   * holds (inbox or message) answers that input and admits nothing; it does
   * not compare the text. An error answer is a body on stdout with `HTTP
   * <status>` on stderr and exit 1. `promptMode`: `ok`, `ok-idle` (the input
   * becomes a user message), `hang`, `cut` (admitted, then a cut answer),
   * `cut-lost` (a cut answer, nothing admitted), `other-session`, `other-id`,
   * or `<status>:<tag>`. `listMode`: `<op>:<status>:<tag>` fails that read.
   */
  function useFake(state: {
    promptMode?: string;
    inbox?: unknown[];
    messages?: unknown[];
    listMode?: string;
  }) {
    writeFileSync(statePath, JSON.stringify({ inbox: [], messages: [], ...state }));
    const binDir = join(tmpDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const script = join(binDir, "opencode");
    writeFileSync(
      script,
      `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(argv) + "\\n");
const state = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, "utf-8"));
const save = () => fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(state));
const params = {};
for (let i = 0; i < argv.length; i++) if (argv[i] === "--param") { const [k, ...v] = argv[i + 1].split("="); params[k] = v.join("="); i++; }
const op = argv[1];
const fail = (status, tag, message) => { process.stdout.write(JSON.stringify({ _tag: tag, message })); process.stderr.write("HTTP " + status + " Error\\n"); process.exit(1); };
if (state.listMode && state.listMode.startsWith(op + ":")) { const [, status, tag] = state.listMode.split(":"); fail(Number(status), tag, tag); }
if (op === "session.prompt") {
  const body = JSON.parse(argv[argv.indexOf("-d") + 1]);
  const mode = state.promptMode || "ok";
  if (mode.includes(":")) { const [status, tag] = mode.split(":"); fail(Number(status), tag, tag + " for " + params.sessionID); }
  if (mode === "hang") { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000); process.exit(0); }
  const known = state.inbox.find((i) => i.id === body.id) || state.messages.find((m) => m.id === body.id && m.type === "user");
  if (body.id && known) {
    const created = known.time.created;
    process.stdout.write(JSON.stringify({ data: { id: body.id, sessionID: params.sessionID, time: { created }, type: "user", payload: { text: known.payload ? known.payload.text : known.text }, delivery: body.delivery } }) + "\\n");
    process.exit(0);
  }
  const id = mode === "other-id" ? "msg_000000000001otherInputIdXX" : (body.id || "msg_new");
  const item = { id, sessionID: mode === "other-session" ? "ses_other" : params.sessionID, time: { created: Date.now() }, type: "user", payload: { text: body.text }, delivery: body.delivery };
  if (mode !== "cut-lost") {
    if (mode === "ok-idle" || mode === "cut") state.messages.unshift({ id: item.id, type: "user", text: body.text, time: { created: Date.now() } });
    else state.inbox.push(item);
    save();
  }
  const answer = JSON.stringify({ data: item });
  process.stdout.write(mode === "cut" || mode === "cut-lost" ? answer.slice(0, 40) : answer + "\\n");
  process.exit(0);
}
if (op === "session.inbox.list") { process.stdout.write(JSON.stringify({ data: state.inbox }) + "\\n"); process.exit(0); }
if (op === "session.message.get") {
  const message = state.messages.find((m) => m.id === params.messageID);
  if (!message) fail(404, "MessageNotFoundError", "Message not found: " + params.messageID);
  process.stdout.write(JSON.stringify({ data: message }) + "\\n");
  process.exit(0);
}
process.stderr.write("unexpected " + argv.join(" ") + "\\n");
process.exit(2);
`,
      "utf-8",
    );
    chmodSync(script, 0o755);
    process.env["PATH"] = `${binDir}:${originalPath ?? ""}`;
  }

  function calls(): string[][] {
    try {
      return readFileSync(logPath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
    } catch {
      return [];
    }
  }

  const prompts = () => calls().filter((argv) => argv[1] === "session.prompt");
  const state = () =>
    JSON.parse(readFileSync(statePath, "utf-8")) as { inbox: unknown[]; messages: unknown[] };
  const queued = (id: string, text: string, created: number) => ({
    id,
    sessionID: ID,
    type: "user",
    time: { created },
    payload: { text },
    delivery: "queue",
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ao-opencode-send-"));
    statePath = join(tmpDir, "state.json");
    logPath = join(tmpDir, "calls.log");
    mockSpawn.mockImplementation((...args: unknown[]) => realSpawn.current!(...args));
  });

  afterEach(() => {
    process.env["PATH"] = originalPath;
    delete process.env["AO_TEST_LARGE_ENV"];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sends one session.prompt with the client input ID and the queue body, and returns that input", async () => {
    useFake({});
    const text = "line one\nline 'two' \"three\"";
    const item = await promptOpenCodeSession(ID, text, INPUT);

    expect(item).toEqual(expect.objectContaining({ id: INPUT, sessionID: ID, delivery: "queue" }));
    expect(prompts()).toEqual([
      [
        "api",
        "session.prompt",
        "--param",
        `sessionID=${ID}`,
        "-d",
        JSON.stringify({ id: INPUT, text, delivery: "queue" }),
      ],
    ]);
    // The answer goes through a file descriptor, not a pipe.
    const options = mockSpawn.mock.calls[0]![2] as { stdio: unknown[] };
    expect(typeof options.stdio[1]).toBe("number");
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it("a second prompt with the same ID admits nothing and answers the first input with its time", async () => {
    useFake({});
    const first = await promptOpenCodeSession(ID, "hi", INPUT);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const replay = await promptOpenCodeSession(ID, "hi", INPUT);

    expect(replay.id).toBe(INPUT);
    expect(replay.created).toBe(first.created);
    expect(state().inbox).toHaveLength(1);
    expect(prompts()).toHaveLength(2);
  });

  it("throws the unexpected-answer error for another input ID or another session", async () => {
    useFake({ promptMode: "other-id" });
    await expect(promptOpenCodeSession(ID, "hi", INPUT)).rejects.toBeInstanceOf(
      OpenCodeApiUnexpectedAnswerError,
    );
    useFake({ promptMode: "other-session" });
    await expect(promptOpenCodeSession(ID, "hi", INPUT)).rejects.toBeInstanceOf(
      OpenCodeApiUnexpectedAnswerError,
    );
  });

  it("refuses a 200 KB message before any process", async () => {
    useFake({});
    await expect(promptOpenCodeSession(ID, "x".repeat(200 * 1024), INPUT)).rejects.toBeInstanceOf(
      OpenCodePromptTooLargeError,
    );
    expect(calls()).toEqual([]);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "linux")(
    "gives OpenCodeApiSpawnError when the arguments and the environment together are too large (E2BIG)",
    async () => {
      useFake({});
      // One argument under the per-argument limit, but the total with this
      // environment is over ARG_MAX (2 MiB on Linux): the child never starts.
      process.env["AO_TEST_LARGE_ENV"] = "x".repeat(2_000_000);
      const err = (await promptOpenCodeSession(ID, "y".repeat(120_000), INPUT).catch(
        (e: unknown) => e,
      )) as OpenCodeApiSpawnError;
      expect(err).toBeInstanceOf(OpenCodeApiSpawnError);
      expect((err.cause as NodeJS.ErrnoException).code).toBe("E2BIG");
      expect(calls()).toEqual([]);
    },
  );

  it("gives OpenCodeApiSpawnError when no opencode is on PATH (ENOENT)", async () => {
    process.env["PATH"] = join(tmpDir, "empty");
    const err = (await promptOpenCodeSession(ID, "hi", INPUT).catch(
      (e: unknown) => e,
    )) as OpenCodeApiSpawnError;
    expect(err).toBeInstanceOf(OpenCodeApiSpawnError);
    expect((err.cause as NodeJS.ErrnoException).code).toBe("ENOENT");
  });

  it("keeps an I/O error of a child that started (EPIPE) out of OpenCodeApiSpawnError: the admission stays unknown", async () => {
    useFake({ promptMode: "hang" });
    const started: ChildProcess.ChildProcess[] = [];
    mockSpawn.mockImplementation((...args: unknown[]) => {
      const child = realSpawn.current!(...args) as ChildProcess.ChildProcess;
      started.push(child);
      // The child runs (it has a PID) when the I/O error comes.
      child.once("spawn", () =>
        child.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })),
      );
      return child;
    });
    try {
      const err = (await promptOpenCodeSession(ID, "hi", INPUT).catch((e: unknown) => e)) as Error;

      expect(started[0]!.pid).toEqual(expect.any(Number));
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(OpenCodeApiSpawnError);
      expect(err.message).toBe("opencode api session.prompt failed: write EPIPE");
      expect((err.cause as NodeJS.ErrnoException).code).toBe("EPIPE");
    } finally {
      for (const child of started) child.kill("SIGKILL");
    }
  });

  it("throws each declared error of session.prompt with its status and tag, once", async () => {
    for (const [status, tag] of [
      [404, "SessionNotFoundError"],
      [404, "LocationNotFoundError"],
      [409, "ConflictError"],
      [400, "InvalidRequestError"],
      [401, "UnauthorizedError"],
    ] as const) {
      rmSync(logPath, { force: true });
      useFake({ promptMode: `${status}:${tag}` });
      const err = (await promptOpenCodeSession(ID, "hi", INPUT).catch(
        (e: unknown) => e,
      )) as OpenCodeApiRequestError;
      expect(err).toBeInstanceOf(OpenCodeApiRequestError);
      expect(err).not.toBeInstanceOf(OpenCodeApiSpawnError);
      expect([err.status, err.tag, err.apiMessage]).toEqual([status, tag, `${tag} for ${ID}`]);
      expect(prompts()).toHaveLength(1);
    }
  });

  it("throws the timeout error at its bound, once", async () => {
    useFake({ promptMode: "hang" });
    await expect(promptOpenCodeSession(ID, "hi", INPUT, { timeoutMs: 300 })).rejects.toBeInstanceOf(
      OpenCodeApiTimeoutError,
    );
    expect(prompts()).toHaveLength(1);
  });

  it("throws the incomplete-answer error on a cut answer, once", async () => {
    useFake({ promptMode: "cut" });
    await expect(promptOpenCodeSession(ID, "hi", INPUT)).rejects.toBeInstanceOf(
      OpenCodeApiIncompleteAnswerError,
    );
    expect(prompts()).toHaveLength(1);
  });

  describe("findOpenCodePromptInput (by input ID only, M-1)", () => {
    it("finds a queued input by its ID in the inbox, and reads the inbox first", async () => {
      useFake({ inbox: [queued("msg_other", "hi", 9_000), queued(INPUT, "hi", 5_000)] });
      await expect(findOpenCodePromptInput(ID, INPUT)).resolves.toEqual({
        id: INPUT,
        found: "inbox",
        delivery: "queue",
      });
      expect(calls().map((argv) => argv[1])).toEqual(["session.inbox.list"]);
    });

    it("finds an input that became a user message with session.message.get of its ID", async () => {
      useFake({ messages: [{ id: INPUT, type: "user", text: "hi", time: { created: 5_000 } }] });
      await expect(findOpenCodePromptInput(ID, INPUT)).resolves.toEqual({
        id: INPUT,
        found: "message",
      });
      const last = calls().at(-1)!;
      expect(last.slice(0, 2)).toEqual(["api", "session.message.get"]);
      expect(last).toEqual(expect.arrayContaining([`sessionID=${ID}`, `messageID=${INPUT}`]));
    });

    it("never counts an earlier input with the same text: it has another ID", async () => {
      // 13 ms before the send, as in the review reproducer, in the inbox and as a message.
      const now = Date.now();
      useFake({
        inbox: [queued("msg_earlier_queued", "REPEAT CI DETAILS EXACTLY", now - 13)],
        messages: [
          {
            id: "msg_earlier_user",
            type: "user",
            text: "REPEAT CI DETAILS EXACTLY",
            time: { created: now },
          },
        ],
      });
      await expect(findOpenCodePromptInput(ID, INPUT)).resolves.toBeNull();
    });

    it("gives null for a record of another type with the ID", async () => {
      useFake({ messages: [{ id: INPUT, type: "idle", time: { created: 5_000 } }] });
      await expect(findOpenCodePromptInput(ID, INPUT)).resolves.toBeNull();
    });

    it("throws when a read fails, also on a 404 of the session", async () => {
      useFake({ listMode: "session.inbox.list:404:SessionNotFoundError" });
      await expect(findOpenCodePromptInput(ID, INPUT)).rejects.toBeInstanceOf(
        OpenCodeApiRequestError,
      );
      useFake({ listMode: "session.message.get:404:SessionNotFoundError" });
      await expect(findOpenCodePromptInput(ID, INPUT)).rejects.toBeInstanceOf(
        OpenCodeApiRequestError,
      );
      useFake({ listMode: "session.inbox.list:503:ServiceUnavailable" });
      await expect(findOpenCodePromptInput(ID, INPUT)).rejects.toBeInstanceOf(
        OpenCodeApiRequestError,
      );
    });

    it("after a cut prompt answer, finds the admitted input once", async () => {
      useFake({ promptMode: "cut" });
      await expect(promptOpenCodeSession(ID, "hi", INPUT)).rejects.toBeInstanceOf(
        OpenCodeApiIncompleteAnswerError,
      );
      await expect(findOpenCodePromptInput(ID, INPUT)).resolves.toEqual({
        id: INPUT,
        found: "message",
      });
      expect(prompts()).toHaveLength(1);
    });

    it("after a cut answer that admitted nothing, finds nothing", async () => {
      useFake({ promptMode: "cut-lost" });
      await expect(promptOpenCodeSession(ID, "hi", INPUT)).rejects.toBeInstanceOf(
        OpenCodeApiIncompleteAnswerError,
      );
      await expect(findOpenCodePromptInput(ID, INPUT)).resolves.toBeNull();
    });
  });
});
