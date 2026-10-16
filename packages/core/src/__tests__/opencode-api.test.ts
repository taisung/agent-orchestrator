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
  removeOpenCodeSession,
  interruptOpenCodeSession,
  listOpenCodeModels,
  findOpenCodeModelProblem,
  createOpenCodeSession,
  switchOpenCodeSessionModel,
  switchOpenCodeSessionAgent,
  hasOpenCodeUserMessage,
  OPENCODE_SESSION_LIST_MAX_PAGES,
  OpenCodeApiTimeoutError,
  OpenCodeApiIncompleteAnswerError,
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
      if (args[1] === "model.list") return { stdout: '{"data":[]}', stderr: "" };
      if (args[1] === "session.create") return { stdout: '{"data":{"id":"ses_new"}}', stderr: "" };
      if (args[1] === "session.message.list") return { stdout: '{"data":[]}', stderr: "" };
      return { stdout: "{}", stderr: "" };
    });
    await listOpenCodeModels({ env });
    await createOpenCodeSession({ title: "AO:app-7", location: { directory: "/w" } }, { env });
    await switchOpenCodeSessionModel("ses_new", { providerID: "p", id: "m" }, { env });
    await switchOpenCodeSessionAgent("ses_new", "build", { env });
    await hasOpenCodeUserMessage("ses_new", { env });
    await interruptOpenCodeSession("ses_new", undefined, env);
    await removeOpenCodeSession("ses_new", undefined, env);
    expect(mockExecFileAsync).toHaveBeenCalledTimes(7);
    for (const call of mockExecFileAsync.mock.calls) {
      const childEnv = (call[2] as { env?: NodeJS.ProcessEnv }).env;
      expect(childEnv?.["AO_SESSION"]).toBe("app-7");
      expect(childEnv?.["AO_CALLER_TYPE"]).toBeUndefined();
    }
  });
});

describe("listOpenCodeModels", () => {
  const full = JSON.stringify({ location: { directory: "/w" }, data: FLEET_PIN_MODELS });

  it("asks once more after an answer cut with exit 0, so one cut does not fail a spawn", async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: full.slice(0, 100), stderr: "" })
      .mockResolvedValueOnce({ stdout: full, stderr: "" });
    const models = await listOpenCodeModels();
    expect(models.map((m) => m.id)).toEqual(["muse-spark-1.3-contributor", "deepseek-v4.1-flash"]);
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
  });

  it("also asks again after an empty exit-0 answer", async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: full, stderr: "" });
    await expect(listOpenCodeModels()).resolves.toHaveLength(2);
  });

  it("throws the incomplete-answer error after a second cut", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: full.slice(0, 50), stderr: "" });
    await expect(listOpenCodeModels()).rejects.toBeInstanceOf(OpenCodeApiIncompleteAnswerError);
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
  });

  it("does not ask again after another failure", async () => {
    mockExecFileAsync.mockRejectedValue(execError("boom", "", "HTTP 500", { code: 1 }));
    await expect(listOpenCodeModels()).rejects.toThrow(/model.list failed/);
    expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer without a data array", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '{"models":[]}', stderr: "" });
    await expect(listOpenCodeModels()).rejects.toThrow(/without data array/);
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
