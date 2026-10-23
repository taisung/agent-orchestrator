import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

vi.mock("node:util", () => ({
  promisify:
    (_fn: unknown) =>
    (...args: any[]) =>
      mockExecFile(...args),
}));

const {
  getHerdrPaneProcesses,
  isHerdrProcessRunning,
  HERDR_RUNTIME_NAME,
  HERDR_CLI_IDS,
  readHerdrCliFailure,
  isHerdrNoServer,
  isHerdrPaneId,
  resolveHerdrEndpoint,
  herdrInvocationFor,
  HerdrPinError,
  HERDR_PIN_ERROR_CODE,
  herdrPreRequestRefusal,
  isHerdrPinError,
} = await import("../herdr.js");
const { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync } =
  await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { RUNTIME_NO_SERVER_ERROR_CODE } = await import("../types.js");
const { herdrFixture, herdrFormsLogEntry, herdrRejection } = await import("./herdr-fixtures.js");

function paneProcesses(processes: unknown[]) {
  return {
    stdout: JSON.stringify({
      id: "cli:pane:process_info",
      result: {
        process_info: {
          foreground_process_group_id: 1,
          foreground_processes: processes,
          pane_id: "w8:p1",
          shell_pid: 2,
        },
        type: "pane_process_info",
      },
    }),
    stderr: "",
  };
}

const CLAUDE = {
  argv: ["claude", "--model", "sonnet"],
  cmdline: "claude --model sonnet",
  name: "claude",
  pid: 4242,
};
const BASH = { argv: ["bash"], cmdline: "bash", name: "bash", pid: 7 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HERDR_RUNTIME_NAME", () => {
  it("matches the runtime plugin's manifest name", () => {
    expect(HERDR_RUNTIME_NAME).toBe("herdr");
  });
});

describe("getHerdrPaneProcesses", () => {
  it("queries the given pane", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([CLAUDE]));

    await getHerdrPaneProcesses("w8:p1");

    expect(mockExecFile.mock.calls[0][0]).toBe("herdr");
    expect(mockExecFile.mock.calls[0][1]).toEqual(["pane", "process-info", "--pane", "w8:p1"]);
  });

  it("returns pid, name and cmdline for each foreground process", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([CLAUDE, BASH]));

    expect(await getHerdrPaneProcesses("w8:p1")).toEqual([
      { pid: 4242, name: "claude", cmdline: "claude --model sonnet" },
      { pid: 7, name: "bash", cmdline: "bash" },
    ]);
  });

  it("falls back to joining argv when cmdline is absent", async () => {
    mockExecFile.mockResolvedValueOnce(
      paneProcesses([{ argv: ["codex", "-m", "gpt"], name: "codex", pid: 9 }]),
    );

    const [proc] = await getHerdrPaneProcesses("w8:p1");
    expect(proc.cmdline).toBe("codex -m gpt");
  });

  it("rejects when herdr is not installed", async () => {
    mockExecFile.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(getHerdrPaneProcesses("w8:p1")).rejects.toThrow();
  });

  // herdr reports failures in the body with exit code 0, so an error body must
  // not be mistaken for "succeeded with no processes".
  it("returns empty on a herdr error body", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ error: { code: "pane_not_found", message: "gone" } }),
      stderr: "",
    });
    expect(await getHerdrPaneProcesses("w8:p1")).toEqual([]);
  });

  it("rejects on unparseable output", async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: "not json", stderr: "" });
    await expect(getHerdrPaneProcesses("w8:p1")).rejects.toThrow();
  });

  it("returns empty for an empty pane id without shelling out", async () => {
    expect(await getHerdrPaneProcesses("")).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("rejects a reply with malformed entries", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([null, {}, CLAUDE]));
    await expect(getHerdrPaneProcesses("w8:p1")).rejects.toThrow();
  });
});

describe("isHerdrProcessRunning", () => {
  it("is true when a process matches the agent regex", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([BASH, CLAUDE]));
    expect(await isHerdrProcessRunning("w8:p1", /(?:^|\/)claude(?:\s|$)/)).toBe(true);
  });

  it("is false when only an unrelated process is running", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([BASH]));
    expect(await isHerdrProcessRunning("w8:p1", /(?:^|\/)claude(?:\s|$)/)).toBe(false);
  });

  it("matches on the bare process name for dot-prefixed binaries", async () => {
    // Some agents install as `.agent`; the name field carries it even when the
    // cmdline is a long absolute path.
    mockExecFile.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "/opt/x/bin/.agent --flag", name: ".agent", pid: 3 }]),
    );
    expect(await isHerdrProcessRunning("w8:p1", /(?:^|\/)\.?agent\b(?:\s|$)/)).toBe(true);
  });

  it("does not match a substring of a longer name", async () => {
    mockExecFile.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "claude-code --x", name: "claude-code", pid: 3 }]),
    );
    expect(await isHerdrProcessRunning("w8:p1", /(?:^|\/)claude(?:\s|$)/)).toBe(false);
  });

  it("matches an absolute path invocation", async () => {
    mockExecFile.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "/usr/local/bin/codex --model x", name: "codex", pid: 3 }]),
    );
    expect(await isHerdrProcessRunning("w8:p1", /(?:^|\/)codex(?:\s|$)/)).toBe(true);
  });

  it("is false when the pane has no processes", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([]));
    expect(await isHerdrProcessRunning("w8:p1", /codex/)).toBe(false);
  });
});

// Same-ID R4 round 2 (review r1, M-3): `pane_not_found` counts only as the
// code of the error envelope of a command that exits 0. A command that fails
// rejects whatever its text holds, and an entry with a field of the wrong
// type rejects the whole reply.
describe("getHerdrPaneProcesses: only well-formed evidence is a negative", () => {
  const SERVER_UNAVAILABLE = JSON.stringify({
    error: { code: "server_unavailable", message: "cannot determine whether pane not found" },
  });

  it("rejects a command that fails with a server_unavailable envelope that mentions pane not found", async () => {
    mockExecFile.mockRejectedValueOnce(
      Object.assign(new Error("Command failed: herdr pane process-info --pane w8:p1"), {
        code: 1,
        stderr: `${SERVER_UNAVAILABLE}\n`,
      }),
    );
    await expect(getHerdrPaneProcesses("w8:p1")).rejects.toThrow(/could not answer/);
  });

  it("rejects a command that fails with the pane_not_found envelope (a non-zero exit)", async () => {
    mockExecFile.mockRejectedValueOnce(
      Object.assign(new Error("Command failed: herdr pane process-info --pane w8:p1"), {
        code: 1,
        stdout: JSON.stringify({ error: { code: "pane_not_found", message: "gone" } }),
        stderr: "",
      }),
    );
    await expect(getHerdrPaneProcesses("w8:p1")).rejects.toThrow(/could not answer/);
  });

  it("rejects a herdr that cannot start at a path that holds pane_not_found", async () => {
    mockExecFile.mockRejectedValueOnce(
      Object.assign(new Error("spawn /opt/pane_not_found/herdr ENOENT"), {
        code: "ENOENT",
        path: "/opt/pane_not_found/herdr",
      }),
    );
    await expect(getHerdrPaneProcesses("w8:p1")).rejects.toThrow(/could not answer/);
  });

  it("rejects the server_unavailable envelope at exit 0 (control of round 1)", async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: SERVER_UNAVAILABLE, stderr: "" });
    await expect(getHerdrPaneProcesses("w8:p1")).rejects.toThrow(/server_unavailable/);
  });

  for (const [label, entry] of [
    ["an argv that is not a list of text", { pid: 123, name: "node", argv: [12] }],
    ["no pid", { name: "codex", cmdline: "codex" }],
    ["a pid that is not a positive integer", { pid: "123", name: "codex", cmdline: "codex" }],
    ["a name that is not text", { pid: 123, name: 5, cmdline: "bash" }],
    ["a cmdline that is not text", { pid: 123, name: "node", cmdline: null }],
  ] as const) {
    it(`rejects the whole reply for an entry with ${label}`, async () => {
      mockExecFile.mockResolvedValueOnce(paneProcesses([BASH, entry]));
      await expect(getHerdrPaneProcesses("w8:p1")).rejects.toThrow(/could not answer/);
    });
  }

  it("isHerdrProcessRunning rejects a malformed argv instead of answering 'no agent'", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([{ pid: 123, name: "node", argv: [12] }]));
    await expect(isHerdrProcessRunning("w8:p1", /(?:^|\/)codex(?:\s|$)/)).rejects.toThrow();
  });

  it("control: the pane_not_found envelope at exit 0 answers an empty list", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ error: { code: "pane_not_found", message: "Pane not found" } }),
      stderr: "",
    });
    expect(await getHerdrPaneProcesses("w8:p1")).toEqual([]);
  });

  it("control: a valid empty process list answers an empty list", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([]));
    expect(await getHerdrPaneProcesses("w8:p1")).toEqual([]);
  });
});

// Same-ID R4 round 3 (review r2, M-3): the process list counts only for the
// requested pane, and an answer with both an error and a result is no
// evidence. A lone pane_not_found and a same-pane empty list stay negatives.
describe("getHerdrPaneProcesses: only an answer for the requested pane is evidence", () => {
  function processInfoFor(paneId: unknown, processes: unknown[]) {
    return {
      stdout: JSON.stringify({
        id: "cli:pane:process_info",
        result: {
          process_info: { foreground_processes: processes, pane_id: paneId, shell_pid: 2 },
          type: "pane_process_info",
        },
      }),
      stderr: "",
    };
  }

  for (const [label, processes] of [
    ["an empty list", []],
    ["a list with a shell", [BASH]],
  ] as const) {
    it(`rejects the process-info of another pane with ${label}`, async () => {
      mockExecFile.mockResolvedValueOnce(processInfoFor("w99:p8", [...processes]));
      await expect(getHerdrPaneProcesses("w7:p1")).rejects.toThrow(
        'herdr pane process-info --pane w7:p1 could not answer: the answer is for pane "w99:p8"',
      );
    });
  }

  it("isHerdrProcessRunning rejects the process-info of another pane instead of answering 'no agent'", async () => {
    mockExecFile.mockResolvedValueOnce(processInfoFor("w99:p8", []));
    await expect(isHerdrProcessRunning("w7:p1", /codex/)).rejects.toThrow(/could not answer/);
  });

  it("rejects a process-info pane_id that is not text", async () => {
    mockExecFile.mockResolvedValueOnce(processInfoFor(7, []));
    await expect(getHerdrPaneProcesses("w7:p1")).rejects.toThrow(/the answer is for pane 7/);
  });

  for (const [label, processes] of [
    ["the requested pane with the agent", [CLAUDE]],
    ["the requested pane with an empty list", []],
  ] as const) {
    it(`rejects an answer with the pane_not_found error and a result for ${label}`, async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: JSON.stringify({
          error: { code: "pane_not_found", message: "gone" },
          result: { process_info: { pane_id: "w7:p1", foreground_processes: processes } },
        }),
        stderr: "",
      });
      await expect(getHerdrPaneProcesses("w7:p1")).rejects.toThrow(
        /could not answer: the answer has both an error and a result/,
      );
    });
  }

  it("rejects an error that is not an object", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ error: "pane_not_found" }),
      stderr: "",
    });
    await expect(getHerdrPaneProcesses("w7:p1")).rejects.toThrow(/could not answer/);
  });

  it("control: a lone pane_not_found error with a null result answers an empty list", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ error: { code: "pane_not_found", message: "gone" }, result: null }),
      stderr: "",
    });
    expect(await getHerdrPaneProcesses("w7:p1")).toEqual([]);
  });

  it("control: an empty list for the requested pane answers an empty list", async () => {
    mockExecFile.mockResolvedValueOnce(processInfoFor("w7:p1", []));
    expect(await getHerdrPaneProcesses("w7:p1")).toEqual([]);
    mockExecFile.mockResolvedValueOnce(processInfoFor("w7:p1", [BASH]));
    expect(await isHerdrProcessRunning("w7:p1", /codex/)).toBe(false);
  });

  it("control: an answer without a pane_id (the agent test fixtures) is read as the requested pane", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ result: { process_info: { foreground_processes: [BASH] } } }),
      stderr: "",
    });
    expect(await getHerdrPaneProcesses("w7:p1")).toEqual([
      { pid: 7, name: "bash", cmdline: "bash" },
    ]);
  });
});

// Herdr fit F-1 (W-2, W-6): herdr 0.9.5 answers an error with exit 1, empty
// stdout and one stderr line. The recorded answers of the live check are the
// test data (development/artifacts/herdr_095_live_check).
describe("Herdr fit F-1: the 0.9.5 failure form of row 8 (getHerdrPaneProcesses)", () => {
  /** A rejection in the F1 form with the given stderr line (and overrides). */
  function f1(line: string, overrides: Record<string, unknown> = {}): Error {
    return Object.assign(
      herdrRejection({
        command: "herdr pane process-info --pane w3:p2",
        exit: 1,
        stdout: "",
        stderr: `${line}\n`,
      }),
      overrides,
    );
  }
  const NOT_FOUND =
    '{"error":{"code":"pane_not_found","message":"pane not found"},"id":"cli:pane:process_info"}';
  const NO_SERVER =
    '{"id":"cli:pane:process_info","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd/herdr.sock"}}';

  for (const name of ["closedpane_pane_process_info", "closedws_pane_process_info"]) {
    it(`T-1.2: ${name} answers an empty list, and isHerdrProcessRunning false`, async () => {
      const fixture = herdrFixture(name);
      expect(fixture.exit).toBe(1);
      const pane = fixture.command.split(" ").at(-1) ?? "";
      mockExecFile.mockRejectedValueOnce(herdrRejection(fixture));
      expect(await getHerdrPaneProcesses(pane)).toEqual([]);
      mockExecFile.mockRejectedValueOnce(herdrRejection(fixture));
      expect(await isHerdrProcessRunning(pane, /(?:^|\/)claude(?:\s|$)/)).toBe(false);
    });
  }

  it("T-1.3: noserver_stopped_pane_process_info rejects with the no-server code", async () => {
    const fixture = herdrFixture("noserver_stopped_pane_process_info");
    mockExecFile.mockRejectedValueOnce(herdrRejection(fixture));
    const rejection = await getHerdrPaneProcesses("w3:p1").catch((err: unknown) => err);
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toMatchObject({
      code: RUNTIME_NO_SERVER_ERROR_CODE,
      herdrCode: "server_not_running",
      message: expect.stringContaining(
        "herdr pane process-info --pane w3:p1 could not answer: herdr error server_not_running: no herdr server is running at ",
      ),
    });
    mockExecFile.mockRejectedValueOnce(herdrRejection(fixture));
    await expect(isHerdrProcessRunning("w3:p1", /codex/)).rejects.toMatchObject({
      code: RUNTIME_NO_SERVER_ERROR_CODE,
    });
  });

  for (const [label, rejection] of [
    ["stdout not empty", () => f1(NOT_FOUND, { stdout: "x" })],
    ["stdout absent", () => f1(NOT_FOUND, { stdout: undefined })],
    ["two stderr lines", () => f1(`${NOT_FOUND}\n${NOT_FOUND}`)],
    // Note 2 (review r1 sol m-1): at most one trailing line feed is the form.
    ["pane_not_found with two trailing line feeds", () => f1(`${NOT_FOUND}\n`)],
    ["the CLI no-server answer with two trailing line feeds", () => f1(`${NO_SERVER}\n`)],
    ["a carriage return", () => f1(`${NOT_FOUND}\r`)],
    ["exit 2", () => f1(NOT_FOUND, { code: 2 })],
    ["an errno code", () => f1(NOT_FOUND, { code: "ENOENT" })],
    ["a signal", () => f1(NOT_FOUND, { signal: "SIGTERM" })],
    ["killed (a timeout)", () => f1(NOT_FOUND, { killed: true })],
    [
      "a result key",
      () =>
        f1(
          '{"error":{"code":"pane_not_found","message":"x"},"id":"cli:pane:process_info","result":null}',
        ),
    ],
    ["an empty id", () => f1('{"error":{"code":"pane_not_found","message":"x"},"id":""}')],
    [
      "the id of pane get",
      () => f1('{"error":{"code":"pane_not_found","message":"x"},"id":"cli:pane:get"}'),
    ],
    ["no id", () => f1('{"error":{"code":"pane_not_found","message":"x"}}')],
    ["a null error", () => f1('{"error":null,"id":"cli:pane:process_info"}')],
    ["an error list", () => f1('{"error":["pane_not_found"],"id":"cli:pane:process_info"}')],
    ["an error without code", () => f1('{"error":{"message":"x"},"id":"cli:pane:process_info"}')],
    [
      "an error with an extra key",
      () =>
        f1(
          '{"error":{"code":"pane_not_found","message":"x","pane":"w3:p2"},"id":"cli:pane:process_info"}',
        ),
    ],
    ["an empty code", () => f1('{"error":{"code":"","message":"x"},"id":"cli:pane:process_info"}')],
    [
      "a message that is not text",
      () => f1('{"error":{"code":"pane_not_found","message":3},"id":"cli:pane:process_info"}'),
    ],
    ["a JSON list", () => f1("[]")],
    ["text that is not JSON", () => f1("pane_not_found")],
    [
      "r5_c_socket_mode_000_cli (Rust EACCES text)",
      () => herdrRejection(herdrFixture("r5_c_socket_mode_000_cli")),
    ],
  ] as const) {
    it(`T-1.4: a near miss of the form (${label}) rejects with no herdrCode and no no-server code`, async () => {
      mockExecFile.mockRejectedValueOnce(rejection());
      const err = await getHerdrPaneProcesses("w3:p2").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(
        "herdr pane process-info --pane w3:p2 could not answer: the command failed",
      );
      expect(err).not.toHaveProperty("herdrCode");
      expect(err).not.toHaveProperty("code");
    });
  }

  for (const [label, rejection, code] of [
    [
      "r5_b_ping_protocol_19 (protocol_mismatch)",
      () =>
        f1(
          JSON.stringify({
            id: "cli:pane:process_info",
            error: JSON.parse(herdrFixture("r5_b_ping_protocol_19").stderr).error,
          }),
        ),
      "protocol_mismatch",
    ],
    [
      "server_unavailable",
      () =>
        f1('{"id":"cli:pane:process_info","error":{"code":"server_unavailable","message":"x"}}'),
      "server_unavailable",
    ],
    [
      "server_not_running from a server (no CLI prefix)",
      () =>
        f1(
          '{"error":{"code":"server_not_running","message":"fake server says so"},"id":"cli:pane:process_info"}',
        ),
      "server_not_running",
    ],
    [
      // Note 2 (review r1 Muse m-1): the no-server prefix counts only at the start.
      "server_not_running with the CLI prefix not at the start of the message",
      () =>
        f1(
          '{"id":"cli:pane:process_info","error":{"code":"server_not_running","message":"herdr relay: no herdr server is running at /tmp/x (proxied)"}}',
        ),
      "server_not_running",
    ],
  ] as const) {
    it(`T-1.4b: the form with another code (${label}) rejects with that herdrCode and no no-server code`, async () => {
      mockExecFile.mockRejectedValueOnce(rejection());
      const err = await getHerdrPaneProcesses("w3:p2").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).toMatchObject({ herdrCode: code });
      expect(err).not.toHaveProperty("code");
      mockExecFile.mockRejectedValueOnce(rejection());
      await expect(isHerdrProcessRunning("w3:p2", /codex/)).rejects.toThrow(/could not answer/);
    });
  }

  it("T-1.5: the 0.8.0 envelopes at exit 0 keep their answers", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ error: { code: "pane_not_found", message: "gone" } }),
      stderr: "",
    });
    expect(await getHerdrPaneProcesses("w3:p2")).toEqual([]);
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ error: { code: "server_not_running", message: "x" } }),
      stderr: "",
    });
    const err = await getHerdrPaneProcesses("w3:p2").catch((e: unknown) => e);
    expect((err as Error).message).toContain("herdr error server_not_running");
    expect(err).not.toHaveProperty("code");
  });
});

describe("Herdr fit F-1: readHerdrCliFailure and isHerdrNoServer", () => {
  it("reads every recorded 0.9.5 error answer with its own command ID", () => {
    for (const [name, words] of [
      ["closedpane_pane_get", "pane get"],
      ["closedpane_pane_process_info", "pane process-info"],
      ["closedpane_pane_read_visible", "pane read"],
      ["closedpane_pane_run", "pane run"],
      ["closedpane_pane_send_text", "pane send-text"],
      ["closedpane_pane_send_keys", "pane send-keys"],
      ["closedpane_agent_prompt", "agent prompt"],
      ["blocked_herdr_agent_prompt", "agent prompt"],
      ["noserver_never_workspace_create", "workspace create"],
    ] as const) {
      const failure = readHerdrCliFailure(herdrRejection(herdrFixture(name)), HERDR_CLI_IDS[words]);
      expect(failure, name).not.toBeNull();
    }
  });

  it("knows the no-server answer of the CLI only with its message prefix", () => {
    const never = readHerdrCliFailure(
      herdrRejection(herdrFixture("noserver_never_pane_get")),
      "cli:pane:get",
    );
    expect(isHerdrNoServer(never)).toBe(true);
    const fake = readHerdrCliFailure(
      herdrRejection(herdrFixture("r5_b_pane_get_server_not_running_from_server")),
      "cli:pane:get",
    );
    expect(fake).toEqual({ code: "server_not_running", message: "fake server says so" });
    expect(isHerdrNoServer(fake)).toBe(false);
    expect(isHerdrNoServer(null)).toBe(false);
  });

  // Note 2 (review r1 Muse m-1): a message that holds the prefix later is a
  // failure of the form, but not the CLI's no-server answer.
  it("is not the no-server answer when the prefix is not at the start of the message", () => {
    const relayed = readHerdrCliFailure(
      herdrRejection({
        command: "herdr pane get w3:p2",
        exit: 1,
        stdout: "",
        stderr:
          '{"id":"cli:pane:get","error":{"code":"server_not_running","message":"herdr relay: no herdr server is running at /tmp/x (proxied)"}}\n',
      }),
      "cli:pane:get",
    );
    expect(relayed).toEqual({
      code: "server_not_running",
      message: "herdr relay: no herdr server is running at /tmp/x (proxied)",
    });
    expect(isHerdrNoServer(relayed)).toBe(false);
  });

  // Note 2 (review r1 sol m-1): one envelope with two trailing line feeds is
  // not the form (at most one trailing line feed), so it is neither absence
  // nor the no-server answer.
  it("reads nothing for one envelope with two trailing line feeds", () => {
    for (const error of [
      { code: "pane_not_found", message: "gone" },
      { code: "server_not_running", message: "no herdr server is running at /tmp/aohd/herdr.sock" },
    ]) {
      const line = JSON.stringify({ id: "cli:pane:get", error });
      const rejection = (stderr: string) =>
        herdrRejection({ command: "herdr pane get w3:p2", exit: 1, stdout: "", stderr });
      expect(readHerdrCliFailure(rejection(`${line}\n`), "cli:pane:get"), error.code).toEqual(
        error,
      );
      expect(readHerdrCliFailure(rejection(`${line}\n\n`), "cli:pane:get"), error.code).toBeNull();
    }
  });

  it("reads nothing with an empty expected ID or a value that is not a rejection", () => {
    const rejection = herdrRejection(herdrFixture("closedpane_pane_get"));
    expect(readHerdrCliFailure(rejection, "")).toBeNull();
    expect(readHerdrCliFailure(null, "cli:pane:get")).toBeNull();
    expect(readHerdrCliFailure("pane_not_found", "cli:pane:get")).toBeNull();
  });
});

// Herdr fit F-2 (W-8): AO makes no herdr call with an ID outside herdr's
// pane ID grammar (`badid_pane_process_info_session_name`: the session-name
// handle reached herdr).
describe("Herdr fit F-2: the pane ID grammar of row 8", () => {
  for (const id of [
    "aohd-1",
    "w1m:p1",
    "wI:p1",
    "w1:pL",
    "W1:p1",
    " w1:p1",
    "w1:p1 ",
    "w1:p1\n",
    "w1:p",
  ]) {
    it(`T-2.1: ${JSON.stringify(id)} rejects with no call`, async () => {
      expect(isHerdrPaneId(id)).toBe(false);
      await expect(getHerdrPaneProcesses(id)).rejects.toThrow(/is not a herdr pane ID/);
      await expect(isHerdrProcessRunning(id, /codex/)).rejects.toThrow(/is not a herdr pane ID/);
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  }

  for (const id of ["w1R:p1", "w0:p1", "w11:p13", "w4:p0", "w1P:pZ"]) {
    it(`T-2.2: ${id} is called`, async () => {
      expect(isHerdrPaneId(id)).toBe(true);
      mockExecFile.mockResolvedValueOnce({
        stdout: JSON.stringify({
          result: { process_info: { pane_id: id, foreground_processes: [] } },
        }),
        stderr: "",
      });
      expect(await getHerdrPaneProcesses(id)).toEqual([]);
      expect(mockExecFile.mock.calls[0][1]).toEqual(["pane", "process-info", "--pane", id]);
    });
  }

  it("keeps the empty ID: an empty list with no call (R4)", async () => {
    expect(await getHerdrPaneProcesses("")).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

// Herdr fit F-6 (r5 M-3): a new launch pins the absolute herdr binary and the
// server socket; every later call for its handle uses them.
describe("Herdr fit F-6: resolveHerdrEndpoint", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ao-herdr-pins-"));
  });
  afterEach(() => {
    mockExecFile.mockReset();
    rmSync(dir, { recursive: true, force: true });
  });

  /** An empty file with the given mode (never run: execFile is mocked). */
  function file(path: string, mode = 0o755): string {
    closeSync(openSync(path, "w", mode));
    chmodSync(path, mode);
    return path;
  }
  const RUNNING = { stdout: herdrFixture("closedpane_status_server_json").stdout, stderr: "" };
  const SOCKET = "/tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock";

  it("T-6.1: finds a bare name in the absolute PATH entries and asks status server --json with env", async () => {
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    const bin = file(join(dir, "b", "herdr"));
    const env = { PATH: ["", "relative/bin", join(dir, "a"), join(dir, "b")].join(":"), X: "1" };
    mockExecFile.mockResolvedValueOnce(RUNNING);

    // Herdr fit-2 (design r11 5.2.7): was { bin, socket, running: true }.
    await expect(resolveHerdrEndpoint({ binPath: "herdr", env })).resolves.toEqual({
      bin,
      socket: SOCKET,
      running: true,
      compatible: true,
      version: "0.9.5",
      protocol: 22,
    });
    expect(mockExecFile.mock.calls[0][0]).toBe(bin);
    expect(mockExecFile.mock.calls[0][1]).toEqual(["status", "server", "--json"]);
    expect(mockExecFile.mock.calls[0][2]).toMatchObject({ env, timeout: 10_000 });
  });

  it("keeps a symlink on PATH as the path, and normalizes an absolute binPath", async () => {
    const target = file(join(dir, "herdr-0.9.5"));
    symlinkSync(target, join(dir, "herdr"));
    mockExecFile.mockResolvedValue(RUNNING);

    expect((await resolveHerdrEndpoint({ binPath: "herdr", env: { PATH: dir } })).bin).toBe(
      join(dir, "herdr"),
    );
    expect(
      (await resolveHerdrEndpoint({ binPath: `${dir}/./x/../herdr-0.9.5`, env: {} })).bin,
    ).toBe(target);
  });

  it("answers running false with the socket (no server at the endpoint)", async () => {
    const bin = file(join(dir, "herdr"));
    mockExecFile.mockResolvedValueOnce({
      stdout: herdrFixture("noserver_never_status_server_json").stdout,
      stderr: "",
    });
    // Herdr fit-2 (design r11 5.2.7): was { bin, socket, running: false }.
    await expect(resolveHerdrEndpoint({ binPath: bin, env: {} })).resolves.toEqual({
      bin,
      socket: SOCKET,
      running: false,
      compatible: false,
      version: null,
      protocol: null,
    });
  });

  for (const [label, binPath, env, message] of [
    ["a relative path with a slash", "./bin/herdr", {}, /is a relative path/],
    [
      "a bare name that is not on PATH",
      "herdr",
      { PATH: "/nonexistent-ao-dir" },
      /herdr is not installed/,
    ],
    [
      "a bare name with only relative PATH entries",
      "herdr",
      { PATH: "bin:." },
      /herdr is not installed/,
    ],
  ] as const) {
    it(`T-6.4: rejects ${label} with no call`, async () => {
      await expect(resolveHerdrEndpoint({ binPath, env: { ...env } })).rejects.toThrow(message);
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  }

  it("T-6.4: rejects an absolute path that is a directory, or a file without an execute bit, with no call", async () => {
    await expect(resolveHerdrEndpoint({ binPath: dir, env: {} })).rejects.toThrow(
      /is not an executable file/,
    );
    const plain = file(join(dir, "herdr"), 0o644);
    await expect(resolveHerdrEndpoint({ binPath: plain, env: {} })).rejects.toThrow(
      /is not an executable file/,
    );
    await expect(resolveHerdrEndpoint({ binPath: "herdr", env: { PATH: dir } })).rejects.toThrow(
      /herdr is not installed/,
    );
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  for (const [label, answer, message] of [
    [
      "a relative socket",
      { running: true, socket: "herdr.sock" },
      /socket that is not an absolute path/,
    ],
    [
      "a socket with a newline",
      { running: true, socket: "/tmp/a\nb.sock" },
      /socket that is not an absolute path/,
    ],
    ["no socket", { running: true }, /socket that is not an absolute path/],
    [
      "running that is not a boolean",
      { running: "yes", socket: "/tmp/s.sock" },
      /without a boolean running/,
    ],
  ] as const) {
    it(`T-6.5: rejects a status answer with ${label}`, async () => {
      const bin = file(join(dir, "herdr"));
      mockExecFile.mockResolvedValueOnce({ stdout: JSON.stringify(answer), stderr: "" });
      await expect(resolveHerdrEndpoint({ binPath: bin, env: {} })).rejects.toThrow(message);
    });
  }

  it("T-6.5: rejects text that is not JSON, and the Rust text of r5_b0_status_server_json (exit 1)", async () => {
    const bin = file(join(dir, "herdr"));
    mockExecFile.mockResolvedValueOnce({ stdout: "status: running", stderr: "" });
    await expect(resolveHerdrEndpoint({ binPath: bin, env: {} })).rejects.toThrow(/not JSON/);
    mockExecFile.mockRejectedValueOnce(herdrRejection(herdrFixture("r5_b0_status_server_json")));
    await expect(resolveHerdrEndpoint({ binPath: bin, env: {} })).rejects.toThrow(
      /herdr status server answered with a failure: Error: Custom/,
    );
  });
});

describe("Herdr fit F-6: herdrInvocationFor and row 8 with a handle", () => {
  afterEach(() => {
    mockExecFile.mockReset();
  });
  const PINS = { herdrBin: "/opt/herdr/bin/herdr", herdrSocket: "/tmp/aohd/herdr.sock" };
  const handle = (data: Record<string, unknown>) => ({ id: "w8:p1", runtimeName: "herdr", data });

  it("T-6.2, T-6.3: a pinned handle runs herdrBin with HERDR_SOCKET_PATH, whatever the caller's environment", async () => {
    const saved = { ...process.env };
    process.env["PATH"] = "/somewhere/else";
    process.env["HERDR_SOCKET_PATH"] = "/tmp/caller/other.sock";
    process.env["HERDR_SESSION"] = "caller-session";
    try {
      expect(herdrInvocationFor(handle(PINS), "herdr")).toEqual({
        bin: "/opt/herdr/bin/herdr",
        env: expect.objectContaining({
          HERDR_SOCKET_PATH: "/tmp/aohd/herdr.sock",
          PATH: "/somewhere/else",
        }),
      });
      mockExecFile.mockResolvedValueOnce(paneProcesses([CLAUDE]));
      expect(await isHerdrProcessRunning(handle(PINS), /(?:^|\/)claude(?:\s|$)/)).toBe(true);
      expect(mockExecFile.mock.calls[0][0]).toBe("/opt/herdr/bin/herdr");
      expect(mockExecFile.mock.calls[0][2].env.HERDR_SOCKET_PATH).toBe("/tmp/aohd/herdr.sock");
    } finally {
      for (const key of ["PATH", "HERDR_SOCKET_PATH", "HERDR_SESSION"]) {
        if (saved[key] === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = saved[key];
      }
    }
  });

  it("T-6.6: a handle without pins, and a pane ID string, run herdr with the caller's environment", async () => {
    expect(herdrInvocationFor(handle({ workspaceId: "w8" }), "/custom/herdr")).toEqual({
      bin: "/custom/herdr",
      env: undefined,
    });
    mockExecFile.mockResolvedValue(paneProcesses([]));
    await getHerdrPaneProcesses(handle({ terminalId: "t" }));
    await getHerdrPaneProcesses("w8:p1");
    for (const call of mockExecFile.mock.calls) {
      expect(call[0]).toBe("herdr");
      expect(call[2]).toEqual({ timeout: 10_000 });
    }
  });

  for (const [label, data] of [
    ["only herdrBin", { herdrBin: PINS.herdrBin }],
    ["only herdrSocket", { herdrSocket: PINS.herdrSocket }],
    ["a relative binary", { ...PINS, herdrBin: "bin/herdr" }],
    ["a relative socket", { ...PINS, herdrSocket: "herdr.sock" }],
    ["a control character", { ...PINS, herdrSocket: "/tmp/a\u0007b.sock" }],
    ["a number", { ...PINS, herdrBin: 7 }],
  ] as const) {
    it(`T-6.7: malformed pins (${label}) throw HerdrPinError, and row 8 rejects with no call`, async () => {
      expect(() => herdrInvocationFor(handle({ ...data }), "herdr")).toThrow(HerdrPinError);
      const err = await getHerdrPaneProcesses(handle({ ...data })).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HerdrPinError);
      expect(err).toMatchObject({
        code: HERDR_PIN_ERROR_CODE,
        message: expect.stringContaining("the herdr pins of this record are malformed:"),
      });
      await expect(isHerdrProcessRunning(handle({ ...data }), /claude/)).rejects.toThrow(
        HerdrPinError,
      );
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  }

  it("keeps the empty ID of a handle: an empty list with no call", async () => {
    expect(await getHerdrPaneProcesses({ id: "", runtimeName: "herdr", data: PINS })).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

// Herdr fit-2 rule Q (design r11 4.3): a create call's failure is a refusal
// of the CLI that sent no request only in the exact measured forms.
describe("Herdr fit-2 rule Q: herdrPreRequestRefusal", () => {
  /** The failure of a recorded call, read with the command ID of its words. */
  function failureOf(
    fixture: { command: string; exit: number; stdout: string; stderr: string },
    words: "workspace create" | "pane run",
  ) {
    return readHerdrCliFailure(herdrRejection(fixture), HERDR_CLI_IDS[words]);
  }
  const r8 = (section: string) => herdrFormsLogEntry("r8_cli_forms_log.txt", section);
  const r9 = (section: string) => herdrFormsLogEntry("r9_cli_forms_log.txt", section);
  const FAKE = "/tmp/aohd5/fake";

  it("Q1: the CLI's no-server text for exactly the pinned socket (r8)", () => {
    expect(
      herdrPreRequestRefusal(
        failureOf(r8("r8_ws_create_stale_socket_file"), "workspace create"),
        `${FAKE}/r8_ws_create_stale_socket_file.sock`,
      ),
    ).toBe("no-server");
    expect(
      herdrPreRequestRefusal(
        failureOf(r8("r8_pane_run_stale_socket_file"), "pane run"),
        `${FAKE}/r8_pane_run_stale_socket_file.sock`,
      ),
    ).toBe("no-server");
  });

  it("Q2: the CLI's protocol refusal after its ping, newer and older (r8, r9)", () => {
    for (const [fixture, words, socket] of [
      [r8("r8_ws_create_ping_protocol_19"), "workspace create", "/any"],
      [r8("r8_ws_create_ping_protocol_23"), "workspace create", "/any"],
      [r8("r8_pane_run_ping_protocol_19"), "pane run", "/any"],
      [r9("r9_pane_run_ping_protocol_23"), "pane run", "/any"],
      [r9("r9_pane_run_ping_protocol_19_control"), "pane run", "/any"],
    ] as const) {
      const failure = failureOf(fixture, words);
      expect(failure?.code, fixture.command).toBe("protocol_mismatch");
      expect(herdrPreRequestRefusal(failure, socket), fixture.command).toBe("protocol");
    }
  });

  // T-4.1b's near misses at the rule: each may have reached the server.
  it("T-4.1b: the near misses are not qualified", () => {
    const stale = failureOf(r8("r8_ws_create_stale_socket_file"), "workspace create");
    const staleRun = failureOf(r8("r8_pane_run_stale_socket_file"), "pane run");
    const sessionForm = failureOf(
      herdrFixture("noserver_never_workspace_create"),
      "workspace create",
    );
    const noSuffix = failureOf(
      r8("r8_ws_create_server_sends_cli_no_server_text"),
      "workspace create",
    );
    // The CLI's text with another socket than the endpoint of step 1.
    expect(herdrPreRequestRefusal(stale, `${FAKE}/elsewhere.sock`)).toBeNull();
    // The Q1 text on pane run, with a socket other than endpoint.socket.
    expect(
      herdrPreRequestRefusal(staleRun, `${FAKE}/r8_ws_create_stale_socket_file.sock`),
    ).toBeNull();
    // The session-form suffix ("run `herdr session attach <s>` ...").
    expect(sessionForm?.code).toBe("server_not_running");
    expect(
      herdrPreRequestRefusal(sessionForm, "/tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock"),
    ).toBeNull();
    // No suffix (a server that sends the CLI's prefix itself), also with its own socket.
    expect(noSuffix?.code).toBe("server_not_running");
    expect(herdrPreRequestRefusal(noSuffix, `${FAKE}/elsewhere.sock`)).toBeNull();
    // protocol_mismatch with another text, and with the prefix later in the text.
    for (const message of [
      "the server protocol differs",
      "relay: client protocol 22 is newer than server protocol 19; restart",
      "client protocol 22 is newer than server protocol 19",
      "client protocol x is newer than server protocol 19; restart",
    ]) {
      expect(
        herdrPreRequestRefusal({ code: "protocol_mismatch", message }, "/any"),
        message,
      ).toBeNull();
    }
    // Another F1 code after the request, and pane_not_found after the request.
    expect(
      herdrPreRequestRefusal(
        failureOf(r8("r8_ws_create_error_after_request"), "workspace create"),
        "/any",
      ),
    ).toBeNull();
    expect(
      herdrPreRequestRefusal(
        failureOf(r8("r8_pane_run_pane_not_found_after_request"), "pane run"),
        "/any",
      ),
    ).toBeNull();
    // The 0.8.0 envelope on stdout at exit 0, a timeout, and no failure form.
    const envelope = {
      command: "herdr workspace create",
      exit: 0,
      stdout: '{"id":"cli:workspace:create","error":{"code":"server_not_running","message":"x"}}\n',
      stderr: "",
    };
    expect(failureOf(envelope, "workspace create")).toBeNull();
    const timeout = Object.assign(herdrRejection(r8("r8_ws_create_stale_socket_file")), {
      killed: true,
      signal: "SIGTERM",
      code: null,
    });
    expect(readHerdrCliFailure(timeout, "cli:workspace:create")).toBeNull();
    expect(herdrPreRequestRefusal(null, `${FAKE}/r8_ws_create_stale_socket_file.sock`)).toBeNull();
  });
});

describe("Herdr fit-2: isHerdrPinError", () => {
  it("accepts HerdrPinError and an error of its shape from another copy", () => {
    expect(isHerdrPinError(new HerdrPinError("one pin"))).toBe(true);
    expect(isHerdrPinError(Object.assign(new Error("pins"), { code: HERDR_PIN_ERROR_CODE }))).toBe(
      true,
    );
  });

  it("refuses another code, a message that is not text and values that are not objects", () => {
    expect(isHerdrPinError(Object.assign(new Error("x"), { code: "ERR_RUNTIME_NO_SERVER" }))).toBe(
      false,
    );
    expect(isHerdrPinError({ code: HERDR_PIN_ERROR_CODE, message: 7 })).toBe(false);
    expect(isHerdrPinError({ code: HERDR_PIN_ERROR_CODE })).toBe(false);
    expect(isHerdrPinError(null)).toBe(false);
    expect(isHerdrPinError(HERDR_PIN_ERROR_CODE)).toBe(false);
  });
});
