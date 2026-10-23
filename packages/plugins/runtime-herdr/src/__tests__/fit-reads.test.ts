/**
 * Herdr fit F-1 and F-2 (design development/reviews/herdr_fit_design_r7_opus.md
 * sections 5.1 and 5.2) for runtime-herdr. herdr 0.9.5 answers an error with
 * exit 1, empty stdout and one stderr line `{"id":...,"error":{...}}`; 0.8.0
 * answered it on stdout with exit 0. The recorded answers of the live check
 * (development/artifacts/herdr_095_live_check) are the test data. F-2: no
 * herdr call for an ID outside herdr's pane ID grammar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as Fs from "node:fs";

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
  execFileSync: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify:
    (_fn: unknown) =>
    (...args: any[]) =>
      mockExecFile(...args),
}));

// The fixtures are read with the real fs; only the launch script is not written.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return { ...actual, writeFileSync: vi.fn() };
});

vi.mock("node:timers/promises", () => ({
  setTimeout: () => Promise.resolve(),
}));

const { create } = await import("../index.js");
const { RUNTIME_NO_SERVER_ERROR_CODE, isRuntimeCreatePartialError } =
  await import("@aoagents/ao-core");
const { herdrFixture, herdrRejection, standInHerdrOnPath, statusRunning, STATUS_SOCKET } =
  await import("./herdr-fixtures.js");

const HANDLE = {
  id: "w3:p2",
  runtimeName: "herdr",
  data: { workspaceId: "w3", paneId: "w3:p2", terminalId: "term_a", sessionId: "app-1" },
};

/** A rejection in the 0.9.5 form with the given stderr line (and overrides). */
function f1(line: string, overrides: Record<string, unknown> = {}): Error {
  return Object.assign(
    herdrRejection({ command: "herdr pane get w3:p2", exit: 1, stdout: "", stderr: `${line}\n` }),
    overrides,
  );
}

const NOT_FOUND =
  '{"error":{"code":"pane_not_found","message":"pane w3:p2 not found"},"id":"cli:pane:get"}';

// Herdr fit F-6: create() resolves `herdr` on PATH first (a stand-in file).
let standIn: ReturnType<typeof standInHerdrOnPath>;
beforeEach(() => {
  vi.clearAllMocks();
  mockExecFile.mockReset();
  standIn = standInHerdrOnPath();
});
afterEach(() => {
  standIn.restore();
});

describe("Herdr fit F-1: the 0.9.5 failure form of row 9 (isAlive)", () => {
  for (const name of ["closedpane_pane_get", "closedws_pane_get"]) {
    it(`T-1.1: ${name} answers false`, async () => {
      const fixture = herdrFixture(name);
      expect(fixture).toMatchObject({ exit: 1, stdout: "" });
      const pane = fixture.command.split(" ").at(-1) ?? "";
      mockExecFile.mockRejectedValueOnce(herdrRejection(fixture));
      await expect(create().isAlive({ ...HANDLE, id: pane })).resolves.toBe(false);
      expect(mockExecFile.mock.calls[0][1]).toEqual(["pane", "get", pane]);
    });
  }

  it("T-1.3: noserver_never_pane_get rejects with the no-server code at the top level", async () => {
    mockExecFile.mockRejectedValueOnce(herdrRejection(herdrFixture("noserver_never_pane_get")));
    const err = await create()
      .isAlive({ ...HANDLE, id: "w1:p1" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({
      code: RUNTIME_NO_SERVER_ERROR_CODE,
      message: expect.stringContaining(
        "herdr pane get w1:p1 could not answer: herdr error server_not_running: no herdr server is running at ",
      ),
      cause: { herdrCode: "server_not_running", code: RUNTIME_NO_SERVER_ERROR_CODE },
    });
  });

  for (const [label, rejection] of [
    ["stdout not empty", () => f1(NOT_FOUND, { stdout: "x" })],
    ["stdout absent", () => f1(NOT_FOUND, { stdout: undefined })],
    ["two stderr lines", () => f1(`${NOT_FOUND}\n${NOT_FOUND}`)],
    // Note 2 (review r1 sol m-1): at most one trailing line feed is the form.
    ["pane_not_found with two trailing line feeds", () => f1(`${NOT_FOUND}\n`)],
    [
      "the CLI no-server answer with two trailing line feeds",
      () =>
        f1(
          '{"id":"cli:pane:get","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd/herdr.sock"}}\n',
        ),
    ],
    ["a carriage return", () => f1(`${NOT_FOUND}\r`)],
    ["exit 2", () => f1(NOT_FOUND, { code: 2 })],
    ["a signal", () => f1(NOT_FOUND, { signal: "SIGKILL" })],
    ["killed (a timeout)", () => f1(NOT_FOUND, { killed: true })],
    [
      "a result key",
      () => f1('{"error":{"code":"pane_not_found","message":"x"},"id":"cli:pane:get","result":{}}'),
    ],
    ["an empty id", () => f1('{"error":{"code":"pane_not_found","message":"x"},"id":""}')],
    [
      "the id of pane process-info",
      () => f1('{"error":{"code":"pane_not_found","message":"x"},"id":"cli:pane:process_info"}'),
    ],
    ["a null error", () => f1('{"error":null,"id":"cli:pane:get"}')],
    ["an error list", () => f1('{"error":[],"id":"cli:pane:get"}')],
    [
      "an error without code",
      () => f1('{"error":{"message":"pane not found"},"id":"cli:pane:get"}'),
    ],
    [
      "an error with an extra key",
      () => f1('{"error":{"code":"pane_not_found","message":"x","extra":1},"id":"cli:pane:get"}'),
    ],
    [
      "r5_c_socket_mode_000_cli (Rust EACCES text)",
      () => herdrRejection(herdrFixture("r5_c_socket_mode_000_cli")),
    ],
  ] as const) {
    it(`T-1.4: a near miss of the form (${label}) rejects with no herdrCode and no no-server code`, async () => {
      mockExecFile.mockRejectedValueOnce(rejection());
      const err = await create()
        .isAlive(HANDLE)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/^herdr pane get w3:p2 could not answer: /);
      expect(err).not.toHaveProperty("code");
      expect((err as Error).cause).not.toHaveProperty("herdrCode");
      expect((err as Error).cause).not.toMatchObject({ code: RUNTIME_NO_SERVER_ERROR_CODE });
    });
  }

  for (const [label, rejection, code] of [
    [
      "r5_b_ping_protocol_19 (protocol_mismatch)",
      () => herdrRejection(herdrFixture("r5_b_ping_protocol_19")),
      "protocol_mismatch",
    ],
    [
      "server_unavailable",
      () => f1('{"id":"cli:pane:get","error":{"code":"server_unavailable","message":"x"}}'),
      "server_unavailable",
    ],
    [
      "r5_b_pane_get_server_not_running_from_server (no CLI prefix)",
      () => herdrRejection(herdrFixture("r5_b_pane_get_server_not_running_from_server")),
      "server_not_running",
    ],
    [
      // Note 2 (review r1 Muse m-1): the no-server prefix counts only at the start.
      "server_not_running with the CLI prefix not at the start of the message",
      () =>
        f1(
          '{"id":"cli:pane:get","error":{"code":"server_not_running","message":"herdr relay: no herdr server is running at /tmp/x (proxied)"}}',
        ),
      "server_not_running",
    ],
  ] as const) {
    it(`T-1.4b: the form with another code (${label}) rejects with that herdrCode and no no-server code`, async () => {
      mockExecFile.mockRejectedValueOnce(rejection());
      const err = await create()
        .isAlive({ ...HANDLE, id: "w1:p1" })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toHaveProperty("code");
      expect((err as Error).cause).toMatchObject({ herdrCode: code });
      expect((err as Error).cause).not.toHaveProperty("code");
    });
  }

  it("T-1.5: the 0.8.0 envelopes at exit 0 keep their answers", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        id: "cli:pane:get",
        error: { code: "pane_not_found", message: "x" },
      }),
      stderr: "",
    });
    await expect(create().isAlive(HANDLE)).resolves.toBe(false);
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        id: "cli:pane:get",
        result: { pane: { pane_id: "w3:p2", terminal_id: "term_a" } },
      }),
      stderr: "",
    });
    await expect(create().isAlive(HANDLE)).resolves.toBe(true);
  });

  // Herdr fit-2 F-4 (design r11 5.2.7). Was: the plain error with
  // `herdrCode` server_not_running and the no-server `code`. The session-form
  // text ("run `herdr session attach aohd-1`") is not rule Q1, so the server
  // may have taken the request: a partial `workspace-unconfirmed`.
  it("reads the failure form of every call with its own command ID (workspace create)", async () => {
    mockExecFile
      .mockResolvedValueOnce(statusRunning())
      .mockRejectedValueOnce(herdrRejection(herdrFixture("noserver_never_workspace_create")));
    const err = await create()
      .create({
        sessionId: "nsx",
        workspacePath: "/tmp/aohd/repo",
        launchCommand: "true",
        environment: { AOHD_X: "1" },
      })
      .catch((e: unknown) => e);
    expect(isRuntimeCreatePartialError(err)).toBe(true);
    expect(err).toMatchObject({ stage: "workspace-unconfirmed", handle: { id: "" } });
    expect((err as Error).cause).toMatchObject({
      herdrCode: "server_not_running",
      code: RUNTIME_NO_SERVER_ERROR_CODE,
    });
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it("the exact rule-Q1 text of the pinned socket gives the plain error with both codes", async () => {
    const q1 =
      `{"id":"cli:workspace:create","error":{"code":"server_not_running","message":"no herdr server is running at ` +
      `${STATUS_SOCKET}; run \`herdr\` to start or attach it"}}`;
    mockExecFile.mockResolvedValueOnce(statusRunning()).mockRejectedValueOnce(
      herdrRejection({
        command: "herdr workspace create --cwd /tmp/aohd/repo --label nsx --no-focus",
        exit: 1,
        stdout: "",
        stderr: `${q1}\n`,
      }),
    );
    const err = await create()
      .create({
        sessionId: "nsx",
        workspacePath: "/tmp/aohd/repo",
        launchCommand: "true",
        environment: {},
      })
      .catch((e: unknown) => e);
    expect(isRuntimeCreatePartialError(err)).toBe(false);
    expect(err).toMatchObject({
      herdrCode: "server_not_running",
      code: RUNTIME_NO_SERVER_ERROR_CODE,
    });
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  // Herdr fit-2 F-4 (design r11 5.2.7). Was: the `workspace close` (W-5a) and
  // a plain error whose cause has `herdrCode` pane_not_found.
  it("reads the pane run failure with the command ID cli:request", async () => {
    mockExecFile
      .mockResolvedValueOnce(statusRunning())
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          id: "cli:workspace:create",
          result: {
            workspace: { workspace_id: "w3" },
            root_pane: { pane_id: "w3:p1", terminal_id: "term_a" },
          },
        }),
        stderr: "",
      })
      .mockRejectedValueOnce(herdrRejection(herdrFixture("closedpane_pane_run")))
      .mockRejectedValueOnce(herdrRejection(herdrFixture("noserver_never_workspace_close")));
    const err = await create()
      .create({
        sessionId: "app-1",
        workspacePath: "/tmp/wt",
        launchCommand: "true",
        environment: {},
      })
      .catch((e: unknown) => e);
    expect((err as Error).message).toMatch(
      /^Failed to launch agent in herdr pane w3:p1 \(launch-unconfirmed\): pane_not_found: /,
    );
    expect(isRuntimeCreatePartialError(err)).toBe(true);
    expect(err).toMatchObject({ stage: "launch-unconfirmed", handle: { id: "w3:p1" } });
    expect((err as Error).cause).toMatchObject({ herdrCode: "pane_not_found" });
    expect(mockExecFile).toHaveBeenCalledTimes(3);
    const calls = mockExecFile.mock.calls.map((c) => (c[1] as string[]).slice(0, 2).join(" "));
    expect(calls).not.toContain("workspace close");
  });
});

describe("Herdr fit F-2: no herdr call for an ID outside the pane ID grammar", () => {
  const BAD = [
    "aohd-1",
    "w1m:p1",
    "wI:p1",
    "w1:pL",
    "W1:p1",
    " w1:p1",
    "w1:p1 ",
    "w1:p1\n",
    "w1:p",
  ];

  for (const id of BAD) {
    it(`T-2.1: ${JSON.stringify(id)}: isAlive and sendMessage reject, getOutput is empty, all with no call`, async () => {
      const runtime = create();
      const handle = { ...HANDLE, id };
      await expect(runtime.isAlive(handle)).rejects.toThrow(
        /is not a herdr pane ID; no herdr call was made/,
      );
      await expect(runtime.sendMessage(handle, "hi")).rejects.toThrow(/is not a herdr pane ID/);
      await expect(runtime.getOutput(handle)).resolves.toBe("");
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it(`T-2.1: create with the root pane ${JSON.stringify(id)} throws and makes no further call`, async () => {
      mockExecFile.mockResolvedValueOnce(statusRunning()).mockResolvedValueOnce({
        stdout: JSON.stringify({
          id: "cli:workspace:create",
          result: {
            workspace: { workspace_id: "w3" },
            root_pane: { pane_id: id, terminal_id: "t" },
          },
        }),
        stderr: "",
      });
      await expect(
        create().create({
          sessionId: "app-1",
          workspacePath: "/tmp/wt",
          launchCommand: "true",
          environment: {},
        }),
      ).rejects.toThrow(/no usable pane/);
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile.mock.calls[1][1].slice(0, 2)).toEqual(["workspace", "create"]);
    });
  }

  it("T-2.1: an empty ID: isAlive rejects, getOutput is empty, with no call", async () => {
    await expect(create().isAlive({ ...HANDLE, id: "" })).rejects.toThrow(/is not a herdr pane ID/);
    await expect(create().sendMessage({ ...HANDLE, id: "" }, "hi")).rejects.toThrow(
      /is not a herdr pane ID/,
    );
    await expect(create().getOutput({ ...HANDLE, id: "" })).resolves.toBe("");
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  for (const id of ["w1R:p1", "w0:p1", "w11:p13", "w4:p0", "w1P:pZ"]) {
    it(`T-2.2: ${id} is called`, async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: JSON.stringify({ id: "cli:pane:get", result: { pane: { pane_id: id } } }),
        stderr: "",
      });
      await expect(create().isAlive({ ...HANDLE, id })).resolves.toBe(true);
      expect(mockExecFile.mock.calls[0][1]).toEqual(["pane", "get", id]);
      mockExecFile.mockResolvedValueOnce({ stdout: "text", stderr: "" });
      await expect(create().getOutput({ ...HANDLE, id })).resolves.toBe("text");
    });
  }
});
