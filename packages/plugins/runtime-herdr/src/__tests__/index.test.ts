import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as Fs from "node:fs";

const mockExecFile = vi.fn();
const mockExecFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockRmSync = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

vi.mock("node:util", () => ({
  promisify:
    (_fn: unknown) =>
    (...args: any[]) =>
      mockExecFile(...args),
}));

// Herdr fit F-6: create() checks the herdr binary with the real fs (statSync,
// accessSync); only the launch script is not written (or removed: fit-2 F-4).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return {
    ...actual,
    writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
    // Recorded, then done: the stand-in herdr directory is removed with it.
    rmSync: (...args: any[]) => {
      mockRmSync(...args);
      return (actual.rmSync as (...a: any[]) => void)(...args);
    },
  };
});

vi.mock("node:timers/promises", () => ({
  setTimeout: () => Promise.resolve(),
}));

const { manifest, create, detect } = await import("../index.js");
const {
  herdrCliFailure,
  herdrFixture,
  herdrFormsLogEntry,
  herdrRejection,
  herdrTimeout,
  standInHerdrOnPath,
  statusRunningAt,
  STATUS_SOCKET,
} = await import("./herdr-fixtures.js");
const { isRuntimeSendRefusedError, isRuntimeCreatePartialError } =
  await import("@aoagents/ao-core");

/** herdr answers `{id, result}` on success and `{error}` on failure, both exit 0. */
function ok(result: unknown) {
  return { stdout: JSON.stringify({ id: "cli:test", result }), stderr: "" };
}
function herdrError(code: string, message = "boom") {
  return { stdout: JSON.stringify({ id: "cli:test", error: { code, message } }), stderr: "" };
}
function text(body: string) {
  return { stdout: body, stderr: "" };
}

/**
 * Herdr fit F-6: create() first resolves the binary on PATH and asks
 * `herdr status server --json` for the socket. A stand-in `herdr` file (never
 * run: execFile is mocked) is the one on PATH.
 */
const STATUS_RUNNING = {
  stdout: JSON.stringify({
    status: "running",
    running: true,
    compatible: true,
    version: "0.9.5",
    socket: "/tmp/aofit-herdr/herdr.sock",
  }),
  stderr: "",
};

const WORKSPACE_CREATED = {
  workspace: { workspace_id: "w7", label: "app-1" },
  root_pane: { pane_id: "w7:p1", terminal_id: "term_abc", workspace_id: "w7" },
};

/** Herdr fit-2 F-4: the post-run `pane get` answers the pane with its terminal. */
const PANE_AFTER_RUN = ok({
  pane: { pane_id: "w7:p1", terminal_id: "term_abc", workspace_id: "w7" },
});

const CREATE_CONFIG = {
  sessionId: "app-1",
  workspacePath: "/tmp/wt/app-1",
  launchCommand: "claude --model sonnet",
  environment: { AO_SESSION_ID: "app-1", AO_ISSUE_ID: "iss-9" },
};

/** The handle create() would have produced. */
const HANDLE = {
  id: "w7:p1",
  runtimeName: "herdr",
  data: {
    workspaceId: "w7",
    paneId: "w7:p1",
    terminalId: "term_abc",
    sessionId: "app-1",
    workspacePath: "/tmp/wt/app-1",
    createdAt: Date.now(),
  },
};

/** Args of the nth herdr invocation. */
function argsOf(call: number): string[] {
  return mockExecFile.mock.calls[call]?.[1] ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("manifest", () => {
  it("declares the herdr runtime slot", () => {
    expect(manifest.name).toBe("herdr");
    expect(manifest.slot).toBe("runtime");
  });
});

describe("create()", () => {
  let standIn: ReturnType<typeof standInHerdrOnPath>;
  beforeEach(() => {
    standIn = standInHerdrOnPath();
  });
  afterEach(() => {
    standIn.restore();
  });

  it("returns a Runtime named herdr", () => {
    expect(create().name).toBe("herdr");
  });

  it("rejects session ids that are not shell/label safe", async () => {
    const rt = create();
    await expect(rt.create({ ...CREATE_CONFIG, sessionId: "app 1; rm -rf /" })).rejects.toThrow(
      /Invalid session ID/,
    );
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("creates the workspace with cwd, label and one --env per variable", async () => {
    mockExecFile
      .mockResolvedValueOnce(STATUS_RUNNING)
      .mockResolvedValueOnce(ok(WORKSPACE_CREATED))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(PANE_AFTER_RUN);

    await create().create(CREATE_CONFIG);

    expect(argsOf(0)).toEqual(["status", "server", "--json"]);
    expect(argsOf(3)).toEqual(["pane", "get", "w7:p1"]);
    expect(mockExecFile).toHaveBeenCalledTimes(4);
    const args = argsOf(1);
    expect(args.slice(0, 2)).toEqual(["workspace", "create"]);
    expect(args).toContain("--cwd");
    expect(args[args.indexOf("--cwd") + 1]).toBe("/tmp/wt/app-1");
    expect(args[args.indexOf("--label") + 1]).toBe("app-1");
    expect(args).toContain("--no-focus");
    expect(args).toContain("AO_SESSION_ID=app-1");
    expect(args).toContain("AO_ISSUE_ID=iss-9");
  });

  it("launches via `pane run` on a script so the launch command is preserved verbatim", async () => {
    // agent start would run the bare executable and drop AO's --model flag.
    mockExecFile
      .mockResolvedValueOnce(STATUS_RUNNING)
      .mockResolvedValueOnce(ok(WORKSPACE_CREATED))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(PANE_AFTER_RUN);

    await create().create(CREATE_CONFIG);

    expect(argsOf(2).slice(0, 4)).toEqual(["pane", "run", "w7:p1", "bash"]);
    expect(
      mockExecFile.mock.calls.some((c) => c[1]?.includes("agent") && c[1]?.includes("start")),
    ).toBe(false);

    const written = mockWriteFileSync.mock.calls[0];
    expect(written[1]).toContain("claude --model sonnet");
  });

  it("returns a handle keyed by pane id, carrying workspace and terminal ids", async () => {
    mockExecFile
      .mockResolvedValueOnce(STATUS_RUNNING)
      .mockResolvedValueOnce(ok(WORKSPACE_CREATED))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(PANE_AFTER_RUN);

    const handle = await create().create(CREATE_CONFIG);

    expect(handle.id).toBe("w7:p1");
    expect(handle.runtimeName).toBe("herdr");
    expect(handle.data.workspaceId).toBe("w7");
    expect(handle.data.terminalId).toBe("term_abc");
  });

  // Herdr fit-2 F-4 (design r11 5.2.7). Was: "closes the workspace when the
  // launch fails, leaving nothing in the shared server" (`workspace close w7`
  // as call 3).
  it("keeps the workspace when the launch fails: a typed partial, no close, the script kept", async () => {
    mockExecFile
      .mockResolvedValueOnce(STATUS_RUNNING)
      .mockResolvedValueOnce(ok(WORKSPACE_CREATED))
      .mockRejectedValueOnce(new Error("spawn failed"))
      .mockResolvedValueOnce(ok({}));

    const err = await create()
      .create(CREATE_CONFIG)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Failed to launch agent/);
    expect(isRuntimeCreatePartialError(err)).toBe(true);
    expect(err).toMatchObject({
      stage: "launch-unconfirmed",
      closed: "nothing",
      handle: {
        id: "w7:p1",
        runtimeName: "herdr",
        data: {
          workspaceId: "w7",
          paneId: "w7:p1",
          terminalId: "term_abc",
          herdrBin: standIn.bin,
          herdrSocket: "/tmp/aofit-herdr/herdr.sock",
          createIncomplete: "launch-unconfirmed",
        },
      },
    });
    expect(mockExecFile).toHaveBeenCalledTimes(3);
    const calls = mockExecFile.mock.calls.map((c) => (c[1] as string[]).slice(0, 2).join(" "));
    expect(calls).not.toContain("workspace close");
    expect(calls).not.toContain("pane close");
    const scriptRemovals = mockRmSync.mock.calls.filter((c) =>
      String(c[0]).includes("ao-herdr-launch-"),
    );
    expect(scriptRemovals).toEqual([]);
  });

  // Was: rejects /workspace_create_failed.*no such dir/ (a plain error).
  it("surfaces a herdr error body even though the CLI exits 0", async () => {
    mockExecFile
      .mockResolvedValueOnce(STATUS_RUNNING)
      .mockResolvedValueOnce(herdrError("workspace_create_failed", "no such dir"));

    const err = await create()
      .create(CREATE_CONFIG)
      .catch((e: unknown) => e);

    expect((err as Error).message).toMatch(/workspace_create_failed.*no such dir/);
    expect(isRuntimeCreatePartialError(err)).toBe(true);
    expect(err).toMatchObject({ stage: "workspace-unconfirmed", handle: { id: "" } });
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  // Was: rejects /no usable pane/ (a plain error).
  it("throws when the response carries no usable pane", async () => {
    mockExecFile
      .mockResolvedValueOnce(STATUS_RUNNING)
      .mockResolvedValueOnce(ok({ workspace: { workspace_id: "w7" } }));

    const err = await create()
      .create(CREATE_CONFIG)
      .catch((e: unknown) => e);

    expect((err as Error).message).toMatch(/no usable pane/);
    expect(isRuntimeCreatePartialError(err)).toBe(true);
    expect(err).toMatchObject({
      stage: "workspace-unconfirmed",
      handle: { id: "", data: { workspaceId: "w7" } },
    });
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });
});

// Herdr fit-2 F-4 (design r11 5.2.1, T-4.1 and T-4.1b): every row of the
// create steps. A plain error only when no request of the create reached the
// server (rule Q); otherwise a typed partial with the handle of what may
// exist. No row closes anything.
describe("Herdr fit-2 F-4: a failed create keeps what it made (T-4.1, T-4.1b)", () => {
  let standIn: ReturnType<typeof standInHerdrOnPath>;
  beforeEach(() => {
    standIn = standInHerdrOnPath();
  });
  afterEach(() => {
    standIn.restore();
  });

  const SOCKET = "/tmp/aofit-herdr/herdr.sock";
  const STALE_WS_SOCKET = "/tmp/aohd5/fake/r8_ws_create_stale_socket_file.sock";
  const STALE_RUN_SOCKET = "/tmp/aohd5/fake/r8_pane_run_stale_socket_file.sock";
  const r8 = (section: string) => herdrFormsLogEntry("r8_cli_forms_log.txt", section);
  const r9 = (section: string) => herdrFormsLogEntry("r9_cli_forms_log.txt", section);

  async function createError(): Promise<unknown> {
    return create()
      .create(CREATE_CONFIG)
      .catch((e: unknown) => e);
  }
  function commands(): string[] {
    return mockExecFile.mock.calls.map((c) => (c[1] as string[]).slice(0, 2).join(" "));
  }
  function expectNoClose(): void {
    expect(commands()).not.toContain("workspace close");
    expect(commands()).not.toContain("pane close");
  }
  function scriptPath(): string {
    return mockWriteFileSync.mock.calls[0]?.[0] as string;
  }
  function scriptRemoved(): boolean {
    return mockRmSync.mock.calls.some((c) => c[0] === scriptPath());
  }
  /** The pins and the session of every handle of CREATE_CONFIG. */
  function launchData(stage: string) {
    return {
      sessionId: "app-1",
      workspacePath: "/tmp/wt/app-1",
      herdrBin: standIn.bin,
      createIncomplete: stage,
    };
  }

  describe("step 1: the endpoint", () => {
    it("a status answer that cannot be read: a plain error, no workspace create", async () => {
      mockExecFile.mockResolvedValueOnce(text("not json"));
      const err = await createError();
      expect(err).toBeInstanceOf(Error);
      expect(isRuntimeCreatePartialError(err)).toBe(false);
      expect(commands()).toEqual(["status server"]);
    });

    it("running false: the plain error of fit-1", async () => {
      mockExecFile.mockResolvedValueOnce(
        text(herdrFixture("noserver_never_status_server_json").stdout),
      );
      const err = await createError();
      expect(isRuntimeCreatePartialError(err)).toBe(false);
      expect((err as Error).message).toBe(
        `no herdr server runs at ${STATUS_SOCKET}; start one: herdr server`,
      );
      expect(commands()).toEqual(["status server"]);
    });

    it("compatible false (T-4.8b's answer): a plain error with the version and protocol", async () => {
      mockExecFile.mockResolvedValueOnce(text(r8("r8_status_json_ping_protocol_19").stdout));
      const err = await createError();
      expect(isRuntimeCreatePartialError(err)).toBe(false);
      expect((err as Error).message).toBe(
        "the herdr server at /tmp/aohd5/fake/r8_status_json_ping_protocol_19.sock is not compatible " +
          "with this herdr client (version 0.8.0, protocol 19); restart it with this herdr",
      );
      expect(commands()).toEqual(["status server"]);
    });

    it("compatible missing or null: a plain error, no workspace create", async () => {
      for (const compatible of [undefined, null]) {
        mockExecFile.mockReset();
        mockExecFile.mockResolvedValueOnce(
          text(
            JSON.stringify({
              running: true,
              socket: SOCKET,
              version: "0.9.5",
              protocol: 22,
              compatible,
            }),
          ),
        );
        const err = await createError();
        expect(isRuntimeCreatePartialError(err)).toBe(false);
        expect((err as Error).message).toMatch(/is not compatible with this herdr client/);
        expect(commands()).toEqual(["status server"]);
      }
    });
  });

  describe("step 2: workspace create", () => {
    it("Q1, the CLI's no-server text for the pinned socket: the plain error with both codes", async () => {
      mockExecFile
        .mockResolvedValueOnce(statusRunningAt(STALE_WS_SOCKET))
        .mockRejectedValueOnce(herdrRejection(r8("r8_ws_create_stale_socket_file")));
      const err = await createError();
      expect(isRuntimeCreatePartialError(err)).toBe(false);
      expect(err).toMatchObject({
        herdrCode: "server_not_running",
        code: "ERR_RUNTIME_NO_SERVER",
      });
      expect(commands()).toEqual(["status server", "workspace create"]);
    });

    it("Q2, the CLI's protocol refusal (newer and older): the plain error", async () => {
      for (const section of ["r8_ws_create_ping_protocol_19", "r8_ws_create_ping_protocol_23"]) {
        mockExecFile.mockReset();
        mockExecFile
          .mockResolvedValueOnce(STATUS_RUNNING)
          .mockRejectedValueOnce(herdrRejection(r8(section)));
        const err = await createError();
        expect(isRuntimeCreatePartialError(err), section).toBe(false);
        expect(err, section).toMatchObject({ herdrCode: "protocol_mismatch" });
        expect((err as { code?: unknown }).code, section).not.toBe("ERR_RUNTIME_NO_SERVER");
        expect(commands(), section).toEqual(["status server", "workspace create"]);
      }
    });

    it("another F1 code: a partial workspace-unconfirmed with an empty ID", async () => {
      const failure = herdrCliFailure(
        "herdr workspace create",
        "cli:workspace:create",
        "zz_unknown_code",
        "x",
      );
      mockExecFile.mockResolvedValueOnce(STATUS_RUNNING).mockRejectedValueOnce(failure);
      const err = await createError();
      expect(isRuntimeCreatePartialError(err)).toBe(true);
      expect((err as Error).message).toBe(
        "herdr workspace create did not confirm a workspace for session app-1 (zz_unknown_code: x); AO closed nothing",
      );
      expect(err).toMatchObject({
        stage: "workspace-unconfirmed",
        closed: "nothing",
        handle: {
          id: "",
          runtimeName: "herdr",
          data: { ...launchData("workspace-unconfirmed"), herdrSocket: SOCKET },
        },
      });
      expect((err as { handle: { data: object } }).handle.data).not.toHaveProperty("workspaceId");
      expect((err as Error).cause).toMatchObject({ herdrCode: "zz_unknown_code" });
      expect(commands()).toEqual(["status server", "workspace create"]);
    });

    it("a timeout: a partial workspace-unconfirmed that names the transport failure", async () => {
      mockExecFile
        .mockResolvedValueOnce(STATUS_RUNNING)
        .mockRejectedValueOnce(herdrTimeout("herdr workspace create --cwd /tmp/wt/app-1"));
      const err = await createError();
      expect(isRuntimeCreatePartialError(err)).toBe(true);
      expect(err).toMatchObject({ stage: "workspace-unconfirmed", handle: { id: "" } });
      expect((err as Error).message).toContain(
        "(transport failure: Command failed: herdr workspace create --cwd /tmp/wt/app-1)",
      );
      expectNoClose();
    });
  });

  describe("step 3: the answer of workspace create", () => {
    const cases: Array<[string, unknown, Record<string, unknown>]> = [
      [
        "no workspace_id",
        { root_pane: { pane_id: "w7:p1", terminal_id: "term_abc" } },
        { paneId: "w7:p1", terminalId: "term_abc" },
      ],
      [
        "a root pane ID outside the grammar",
        {
          workspace: { workspace_id: "w7" },
          root_pane: { pane_id: "aohd-1", terminal_id: "term_abc" },
        },
        { workspaceId: "w7", terminalId: "term_abc" },
      ],
      [
        "an empty terminal_id",
        { workspace: { workspace_id: "w7" }, root_pane: { pane_id: "w7:p1", terminal_id: "" } },
        { workspaceId: "w7", paneId: "w7:p1" },
      ],
    ];
    for (const [label, result, parsed] of cases) {
      it(`${label}: a partial workspace-unconfirmed with what parsed, no further call`, async () => {
        mockExecFile.mockResolvedValueOnce(STATUS_RUNNING).mockResolvedValueOnce(ok(result));
        const err = await createError();
        expect(isRuntimeCreatePartialError(err)).toBe(true);
        expect((err as Error).message).toBe(
          'herdr workspace create returned no usable pane for session "app-1"; AO closed nothing',
        );
        const handle = (err as { handle: { id: string; data: Record<string, unknown> } }).handle;
        expect(handle.id).toBe("");
        expect(handle.data).toMatchObject({ ...parsed, ...launchData("workspace-unconfirmed") });
        for (const key of ["workspaceId", "paneId", "terminalId"]) {
          if (!(key in parsed)) expect(handle.data, key).not.toHaveProperty(key);
        }
        expect(commands()).toEqual(["status server", "workspace create"]);
      });
    }
  });

  describe("step 4: the launch script", () => {
    it("a script that cannot be written: launch-not-submitted, the partial file removed, no run", async () => {
      mockExecFile
        .mockResolvedValueOnce(STATUS_RUNNING)
        .mockResolvedValueOnce(ok(WORKSPACE_CREATED));
      mockWriteFileSync.mockImplementationOnce(() => {
        throw Object.assign(new Error("ENOSPC: no space left on device, write"), {
          code: "ENOSPC",
        });
      });
      const err = await createError();
      expect(isRuntimeCreatePartialError(err)).toBe(true);
      expect((err as Error).message).toBe(
        "Failed to launch agent in herdr pane w7:p1 (launch-not-submitted): the launch script could not be written: " +
          "ENOSPC: no space left on device, write. Workspace w7, terminal term_abc, socket /tmp/aofit-herdr/herdr.sock. AO closed nothing.",
      );
      expect(err).toMatchObject({
        stage: "launch-not-submitted",
        handle: {
          id: "w7:p1",
          data: {
            workspaceId: "w7",
            paneId: "w7:p1",
            terminalId: "term_abc",
            ...launchData("launch-not-submitted"),
          },
        },
      });
      expect(scriptRemoved()).toBe(true);
      expect(commands()).toEqual(["status server", "workspace create"]);
    });
  });

  describe("step 5: pane run", () => {
    it("Q1 (cli:request) for the pinned socket: launch-not-submitted, the script removed", async () => {
      mockExecFile
        .mockResolvedValueOnce(statusRunningAt(STALE_RUN_SOCKET))
        .mockResolvedValueOnce(ok(WORKSPACE_CREATED))
        .mockRejectedValueOnce(herdrRejection(r8("r8_pane_run_stale_socket_file")));
      const err = await createError();
      expect(isRuntimeCreatePartialError(err)).toBe(true);
      expect(err).toMatchObject({ stage: "launch-not-submitted", handle: { id: "w7:p1" } });
      expect((err as Error).message).toContain("(launch-not-submitted): server_not_running: ");
      expect(scriptRemoved()).toBe(true);
      expect(commands()).toEqual(["status server", "workspace create", "pane run"]);
    });

    it("Q2 (newer and older): launch-not-submitted, the script removed", async () => {
      for (const fixture of [
        r8("r8_pane_run_ping_protocol_19"),
        r9("r9_pane_run_ping_protocol_23"),
      ]) {
        mockExecFile.mockReset();
        mockRmSync.mockClear();
        mockWriteFileSync.mockClear();
        mockExecFile
          .mockResolvedValueOnce(STATUS_RUNNING)
          .mockResolvedValueOnce(ok(WORKSPACE_CREATED))
          .mockRejectedValueOnce(herdrRejection(fixture));
        const err = await createError();
        expect(err, fixture.command).toMatchObject({ stage: "launch-not-submitted" });
        expect(scriptRemoved(), fixture.command).toBe(true);
        expect(commands(), fixture.command).toEqual([
          "status server",
          "workspace create",
          "pane run",
        ]);
      }
    });

    it("any other failure (a timeout): launch-unconfirmed, the script kept", async () => {
      mockExecFile
        .mockResolvedValueOnce(STATUS_RUNNING)
        .mockResolvedValueOnce(ok(WORKSPACE_CREATED))
        .mockRejectedValueOnce(herdrTimeout("herdr pane run w7:p1 bash /tmp/x.sh"));
      const err = await createError();
      expect(isRuntimeCreatePartialError(err)).toBe(true);
      expect((err as Error).message).toBe(
        "Failed to launch agent in herdr pane w7:p1 (launch-unconfirmed): transport failure: Command failed: " +
          "herdr pane run w7:p1 bash /tmp/x.sh. Workspace w7, terminal term_abc, socket /tmp/aofit-herdr/herdr.sock. AO closed nothing.",
      );
      expect(err).toMatchObject({
        stage: "launch-unconfirmed",
        handle: { id: "w7:p1", data: launchData("launch-unconfirmed") },
      });
      expect(scriptRemoved()).toBe(false);
      expect(commands()).toEqual(["status server", "workspace create", "pane run"]);
    });
  });

  describe("step 6: the pane after the run", () => {
    function runThenGet(get: { resolve?: unknown; reject?: unknown }): void {
      mockExecFile
        .mockResolvedValueOnce(STATUS_RUNNING)
        .mockResolvedValueOnce(ok(WORKSPACE_CREATED))
        .mockResolvedValueOnce(ok({}));
      if (get.reject) mockExecFile.mockRejectedValueOnce(get.reject);
      else mockExecFile.mockResolvedValueOnce(get.resolve);
    }

    it("pane_not_found: launch-unconfirmed, the script kept", async () => {
      runThenGet({
        reject: herdrCliFailure(
          "herdr pane get w7:p1",
          "cli:pane:get",
          "pane_not_found",
          "pane w7:p1 not found",
        ),
      });
      const err = await createError();
      expect(err).toMatchObject({ stage: "launch-unconfirmed", handle: { id: "w7:p1" } });
      expect((err as Error).message).toContain(
        "(launch-unconfirmed): after the run, herdr pane get w7:p1 answered pane_not_found.",
      );
      expect(scriptRemoved()).toBe(false);
      expect(commands()).toEqual(["status server", "workspace create", "pane run", "pane get"]);
    });

    it("another terminal: launch-unconfirmed with terminalAfterRun", async () => {
      runThenGet({ resolve: ok({ pane: { pane_id: "w7:p1", terminal_id: "term_other" } }) });
      const err = await createError();
      expect(err).toMatchObject({
        stage: "launch-unconfirmed",
        handle: {
          id: "w7:p1",
          data: {
            terminalId: "term_abc",
            terminalAfterRun: "term_other",
            createIncomplete: "launch-unconfirmed",
          },
        },
      });
      expect((err as Error).message).toContain(
        "after the run, herdr pane get w7:p1 answered terminal term_other, not term_abc",
      );
    });

    it("a get that cannot answer: launch-unconfirmed", async () => {
      runThenGet({ reject: herdrTimeout("herdr pane get w7:p1") });
      const err = await createError();
      expect(err).toMatchObject({ stage: "launch-unconfirmed", handle: { id: "w7:p1" } });
      expect((err as { handle: { data: object } }).handle.data).not.toHaveProperty(
        "terminalAfterRun",
      );
      expect((err as Error).message).toContain(
        "after the run, herdr pane get w7:p1 could not answer",
      );
    });

    it("the pane with its terminal: the handle, with no createIncomplete", async () => {
      runThenGet({ resolve: PANE_AFTER_RUN });
      const handle = await create().create(CREATE_CONFIG);
      expect(handle.id).toBe("w7:p1");
      expect(handle.data).not.toHaveProperty("createIncomplete");
      expect(handle.data).toMatchObject({
        terminalId: "term_abc",
        herdrBin: standIn.bin,
        herdrSocket: SOCKET,
      });
      expect(commands()).toEqual(["status server", "workspace create", "pane run", "pane get"]);
    });
  });

  describe("T-4.1b: the near misses of rule Q are partials", () => {
    it("server_not_running with the CLI's text for another socket", async () => {
      mockExecFile
        .mockResolvedValueOnce(STATUS_RUNNING)
        .mockRejectedValueOnce(herdrRejection(r8("r8_ws_create_stale_socket_file")));
      expect(await createError()).toMatchObject({
        stage: "workspace-unconfirmed",
        handle: { id: "" },
      });
    });

    it("server_not_running with the session-form suffix", async () => {
      mockExecFile
        .mockResolvedValueOnce(
          statusRunningAt("/tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock"),
        )
        .mockRejectedValueOnce(herdrRejection(herdrFixture("noserver_never_workspace_create")));
      expect(await createError()).toMatchObject({ stage: "workspace-unconfirmed" });
    });

    it("server_not_running with no suffix, also for its own socket", async () => {
      mockExecFile
        .mockResolvedValueOnce(statusRunningAt("/tmp/aohd5/fake/elsewhere.sock"))
        .mockRejectedValueOnce(herdrRejection(r8("r8_ws_create_server_sends_cli_no_server_text")));
      expect(await createError()).toMatchObject({ stage: "workspace-unconfirmed" });
    });

    it("protocol_mismatch with another text", async () => {
      mockExecFile
        .mockResolvedValueOnce(STATUS_RUNNING)
        .mockRejectedValueOnce(
          herdrCliFailure(
            "herdr workspace create",
            "cli:workspace:create",
            "protocol_mismatch",
            "the server protocol differs",
          ),
        );
      expect(await createError()).toMatchObject({ stage: "workspace-unconfirmed" });
    });

    it("the 0.8.0 envelope at exit 0, even with the exact Q1 text", async () => {
      mockExecFile
        .mockResolvedValueOnce(STATUS_RUNNING)
        .mockResolvedValueOnce(
          herdrError(
            "server_not_running",
            `no herdr server is running at ${SOCKET}; run \`herdr\` to start or attach it`,
          ),
        );
      const err = await createError();
      expect(err).toMatchObject({ stage: "workspace-unconfirmed" });
      expect((err as Error).message).toContain("server_not_running");
    });

    it("the Q1 text on pane run for a socket other than the endpoint's", async () => {
      mockExecFile
        .mockResolvedValueOnce(STATUS_RUNNING)
        .mockResolvedValueOnce(ok(WORKSPACE_CREATED))
        .mockRejectedValueOnce(herdrRejection(r8("r8_pane_run_stale_socket_file")));
      expect(await createError()).toMatchObject({ stage: "launch-unconfirmed" });
      expect(scriptRemoved()).toBe(false);
    });

    afterEach(() => {
      expectNoClose();
    });
  });

  afterEach(() => {
    expectNoClose();
  });
});

// Herdr fit F-5 (W-5b): destroy refuses and makes no herdr call. Before the
// fit it closed the recorded workspace (or pane) by its ID with no check and
// swallowed every error (the three old oracles: `workspace close w7`, `pane
// close w7:p1`, resolves).
describe("destroy()", () => {
  const REFUSAL =
    "runtime-herdr destroy closes nothing: herdr reuses pane and workspace IDs, so a close by ID " +
    "could reach another terminal (same-ID R2a). Use the stop; close the workspace by hand after you check it.";

  it("refuses for the owned workspace and makes no call (was: closes the owned workspace)", async () => {
    await expect(create().destroy(HANDLE)).rejects.toThrow(REFUSAL);
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("refuses when no workspace id was recorded and makes no call (was: closes the pane)", async () => {
    await expect(
      create().destroy({ ...HANDLE, data: { ...HANDLE.data, workspaceId: "" } }),
    ).rejects.toThrow(REFUSAL);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("refuses when the workspace is already gone and makes no call (was: swallows the error)", async () => {
    mockExecFile.mockRejectedValueOnce(new Error("not found"));
    await expect(create().destroy(HANDLE)).rejects.toThrow(REFUSAL);
    expect(mockExecFile).not.toHaveBeenCalled();
    mockExecFile.mockReset();
  });

  it("T-5.1: refuses for a pane ID only and for an empty handle, with no call", async () => {
    await expect(create().destroy({ id: "w7:p1", runtimeName: "herdr", data: {} })).rejects.toThrow(
      REFUSAL,
    );
    await expect(create().destroy({ id: "", runtimeName: "herdr", data: {} })).rejects.toThrow(
      REFUSAL,
    );
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

// Same-ID R2a (owner decision): the Herdr close cannot yet check the terminal
// at close time (review r2, B-2), so stop answers unknown and closes nothing.
describe("stop()", () => {
  it("answers unknown with the B-2 reason and makes no herdr call", async () => {
    const stopped = await create().stop!(HANDLE);

    expect(stopped.outcome).toBe("unknown");
    expect(stopped).toMatchObject({
      detail: expect.stringContaining(
        "the Herdr close cannot yet check the terminal at close time (same-ID review r2, B-2)",
      ),
    });
    expect(stopped).toMatchObject({ detail: expect.stringContaining("workspace w7") });
    expect(stopped).toMatchObject({ detail: expect.stringContaining("nothing was closed") });
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("names the pane when no workspace id was recorded, and still closes nothing", async () => {
    const stopped = await create().stop!({ ...HANDLE, data: { ...HANDLE.data, workspaceId: "" } });

    expect(stopped).toMatchObject({
      outcome: "unknown",
      detail: expect.stringContaining("pane w7:p1"),
    });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("names the next action: close by hand, and a retry gives the same refusal (review r1)", async () => {
    const stopped = await create().stop!(HANDLE);

    expect(stopped).toMatchObject({
      next:
        "Close herdr workspace w7 by hand after you check that it belongs to this session. " +
        "AO cannot stop a Herdr session yet: a retry of this command gives the same refusal, " +
        "and AO keeps the record and the worktree of this session until it can check the terminal at close time.",
    });
  });

  it("the core refusal shows that next action as its hint, with no retry", async () => {
    const { RuntimeStopUnconfirmedError, stopRuntime } = await import("@aoagents/ao-core");
    const stopped = await stopRuntime(create(), HANDLE);
    if (stopped.outcome !== "unknown") throw new Error(`expected unknown, got ${stopped.outcome}`);

    const refusal = new RuntimeStopUnconfirmedError({
      sessionId: "app-1",
      handle: HANDLE,
      stop: stopped,
      kept: "record and worktree kept",
      retry: "ao session kill app-1",
    });

    expect(refusal.hint).toContain("Close herdr workspace w7 by hand");
    expect(refusal.hint).toContain("a retry of this command gives the same refusal");
    expect(refusal.hint).not.toContain("ao session kill");
    expect(refusal.hintFor("ao stop my-app")).toBe(refusal.hint);
  });

  it("core stopRuntime uses it instead of destroy: unknown, and no close", async () => {
    const { stopRuntime } = await import("@aoagents/ao-core");
    const runtime = create();
    const destroy = vi.spyOn(runtime, "destroy");

    const stopped = await stopRuntime(runtime, HANDLE);

    expect(stopped.outcome).toBe("unknown");
    expect(destroy).not.toHaveBeenCalled();
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

describe("sendMessage()", () => {
  /** A `pane get` answer with the agent in a given state. */
  const at = (agent_status: string, agent: string | null = "claude") =>
    ok({ pane: { pane_id: "w7:p1", agent, agent_status } });

  /** Every `agent prompt` invocation, in order. */
  function promptCalls(): string[][] {
    return mockExecFile.mock.calls
      .map((c) => c[1] as string[])
      .filter((a) => a?.[0] === "agent" && a?.[1] === "prompt");
  }

  /** Every raw input invocation (`pane send-text`, `pane send-keys`), in order. */
  function rawInputCalls(): string[][] {
    return mockExecFile.mock.calls
      .map((c) => c[1] as string[])
      .filter((a) => a?.[0] === "pane" && (a?.[1] === "send-text" || a?.[1] === "send-keys"));
  }

  // Regression guard for 0003 §8.2: prompting before the agent settles is
  // silently dropped — the text never arrives and no error is raised.
  it("waits for a settled agent before prompting", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("unknown", null))
      .mockResolvedValueOnce(at("working"))
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // agent prompt
      .mockResolvedValue(at("working")); // consumed

    await create().sendMessage(HANDLE, "do the thing");

    expect(argsOf(0)).toEqual(["pane", "get", "w7:p1"]);
    expect(promptCalls()).toEqual([["agent", "prompt", "w7:p1", "do the thing"]]);
  });

  it("does not prompt while the agent is still working", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("working"))
      .mockResolvedValueOnce(at("done")) // settled
      .mockResolvedValueOnce(at("done")) // pre-send state
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValue(at("working"));

    await create({ settleTimeoutMs: 5_000 }).sendMessage(HANDLE, "hi");

    // Nothing was sent until the agent left `working`.
    expect(argsOf(3)).toEqual(["agent", "prompt", "w7:p1", "hi"]);
    expect(promptCalls()).toHaveLength(1);
  });

  // Herdr fit-2 F-3: a prompt or raw text could answer the blocked agent's
  // own question, so the send refuses (was: treats blocked as settled, and
  // a prompt is how you answer a blocked agent).
  it("refuses a blocked agent: no prompt and no raw input (was: treats blocked as settled)", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("blocked")) // first settle poll
      .mockResolvedValue(at("working"));

    const err = await create()
      .sendMessage(HANDLE, "yes")
      .catch((e: unknown) => e);

    expect(isRuntimeSendRefusedError(err)).toBe(true);
    expect(err).toMatchObject({ admitted: "none", reason: "agent_blocked", target: "w7:p1" });
    expect(promptCalls()).toEqual([]);
    expect(rawInputCalls()).toEqual([]);
  });

  // The multi-worker campaign finding (0004 §5): herdr reports `idle` the moment
  // it recognises the agent's prompt box, seconds before the agent can actually
  // consume input. The first prompt is swallowed with no error anywhere, so the
  // settle gate alone is not enough — delivery has to be verified and re-sent.
  it("re-sends when the first prompt is silently swallowed", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // prompt #1
      .mockResolvedValueOnce(at("idle")) // still idle — swallowed
      .mockResolvedValueOnce(at("idle")) // re-settle
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // prompt #2
      .mockResolvedValue(at("working")); // consumed

    await create({ deliveryTimeoutMs: 0 }).sendMessage(HANDLE, "retry me");

    expect(promptCalls()).toEqual([
      ["agent", "prompt", "w7:p1", "retry me"],
      ["agent", "prompt", "w7:p1", "retry me"],
    ]);
  });

  it("throws rather than reporting success when nothing ever consumes the message", async () => {
    mockExecFile.mockResolvedValue(at("idle"));

    await expect(
      create({ deliveryTimeoutMs: 0, sendAttempts: 2 }).sendMessage(HANDLE, "into the void"),
    ).rejects.toThrow(/did not consume the message/);

    expect(promptCalls()).toHaveLength(2);
    expect(mockExecFile.mock.calls.map((c) => c[1])).toContainEqual([
      "pane",
      "send-text",
      "w7:p1",
      "into the void",
    ]);
  });

  it("accepts the raw terminal fallback when it visibly lands", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // prompt
      .mockResolvedValueOnce(at("idle")) // swallowed
      .mockResolvedValueOnce(at("idle")) // re-settle
      .mockResolvedValueOnce(ok({})) // send-text
      .mockResolvedValueOnce(ok({})) // send-keys Enter
      .mockResolvedValue(at("working")); // the fallback landed

    await expect(
      create({ deliveryTimeoutMs: 0, sendAttempts: 1 }).sendMessage(HANDLE, "plain"),
    ).resolves.toBeUndefined();
  });

  it("falls back to raw terminal input when no agent is ever detected", async () => {
    mockExecFile.mockResolvedValue(at("unknown", null));

    await create({ settleTimeoutMs: 0 }).sendMessage(HANDLE, "plain text");

    const sent = mockExecFile.mock.calls.map((c) => c[1]);
    expect(sent).toContainEqual(["pane", "send-text", "w7:p1", "plain text"]);
    expect(sent).toContainEqual(["pane", "send-keys", "w7:p1", "Enter"]);
  });

  it("never passes --wait, which does not track turns", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle"))
      .mockResolvedValueOnce(at("idle"))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValue(at("working"));

    await create().sendMessage(HANDLE, "hi");

    expect(mockExecFile.mock.calls.every((c) => !c[1]?.includes("--wait"))).toBe(true);
  });
});

// Herdr fit-2 F-3 (design r11 5.1): T-3.1 to T-3.5.
describe("sendMessage(): a blocked agent is a refusal (fit-2 F-3)", () => {
  const at = (agent_status: string, agent: string | null = "claude") =>
    ok({ pane: { pane_id: "w7:p1", agent, agent_status } });
  const calls = (first: string, second: string) =>
    mockExecFile.mock.calls
      .map((c) => c[1] as string[])
      .filter((a) => a?.[0] === first && a?.[1] === second);
  const rawInput = () => [...calls("pane", "send-text"), ...calls("pane", "send-keys")];
  /** herdr 0.9.5's answer to `agent prompt` for a blocked agent (exit 1, stderr). */
  const blockedPrompt = () => herdrRejection(herdrFixture("blocked_herdr_agent_prompt"));

  async function refusalOf(promise: Promise<void>) {
    const err = await promise.catch((e: unknown) => e);
    expect(isRuntimeSendRefusedError(err)).toBe(true);
    return err as { admitted: string; stage: string; target: string; message: string };
  }

  it("T-3.1: the first settle poll answers blocked: refusal none, no prompt, no raw input", async () => {
    mockExecFile.mockResolvedValueOnce(at("blocked")).mockResolvedValue(at("idle"));

    const err = await refusalOf(create().sendMessage(HANDLE, "go"));

    expect(err).toMatchObject({ admitted: "none", stage: "first settle wait", target: "w7:p1" });
    expect(err.message).toContain("is blocked and waits for input (agent_blocked)");
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(calls("agent", "prompt")).toEqual([]);
    expect(rawInput()).toEqual([]);
  });

  it("T-3.2: attempt 1 answers agent_blocked (the recorded 0.9.5 line): refusal none, one prompt", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockRejectedValueOnce(blockedPrompt()) // agent prompt
      .mockResolvedValue(at("working"));

    const err = await refusalOf(create().sendMessage(HANDLE, "go"));

    expect(err).toMatchObject({ admitted: "none", stage: "agent prompt, attempt 1" });
    expect(calls("agent", "prompt")).toHaveLength(1);
    expect(rawInput()).toEqual([]);
  });

  it("T-3.3: no consumption seen, then the settle wait answers blocked: earlier-attempt-unconfirmed", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // agent prompt
      .mockResolvedValueOnce(at("idle")) // consumption poll: not consumed
      .mockResolvedValueOnce(at("blocked")) // settle wait after attempt 1
      .mockResolvedValue(at("idle"));

    const err = await refusalOf(create({ deliveryTimeoutMs: 0 }).sendMessage(HANDLE, "go"));

    expect(err).toMatchObject({
      admitted: "earlier-attempt-unconfirmed",
      stage: "settle wait after attempt 1",
    });
    expect(err.message).toContain("an earlier prompt of this send may have been delivered");
    expect(calls("agent", "prompt")).toHaveLength(1);
    expect(rawInput()).toEqual([]);
  });

  it("T-3.4: attempt 2 answers agent_blocked: earlier-attempt-unconfirmed, two prompts", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // prompt #1
      .mockResolvedValueOnce(at("idle")) // not consumed
      .mockResolvedValueOnce(at("idle")) // re-settle
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockRejectedValueOnce(blockedPrompt()) // prompt #2
      .mockResolvedValue(at("idle"));

    const err = await refusalOf(create({ deliveryTimeoutMs: 0 }).sendMessage(HANDLE, "go"));

    expect(err).toMatchObject({
      admitted: "earlier-attempt-unconfirmed",
      stage: "agent prompt, attempt 2",
    });
    expect(calls("agent", "prompt")).toHaveLength(2);
    expect(rawInput()).toEqual([]);
  });

  // Review r2 (ao-83 m-1): herdr's PaneInfo allows `agent: null`; a blocked
  // pane with no agent name is a refusal too, never a raw send.
  const noAgentName = [
    ["agent null", { pane_id: "w7:p1", agent: null, agent_status: "blocked" }],
    ["no agent field", { pane_id: "w7:p1", agent_status: "blocked" }],
  ] as const;
  for (const [label, pane] of noAgentName) {
    it(`r2 m-1 (${label}): the first settle poll answers blocked with no agent name: refusal none`, async () => {
      mockExecFile.mockResolvedValue(ok({ pane }));

      const err = await create({ settleTimeoutMs: 0, deliveryTimeoutMs: 0 })
        .sendMessage(HANDLE, "go")
        .catch((e: unknown) => e);

      expect(rawInput()).toEqual([]);
      expect(calls("agent", "prompt")).toEqual([]);
      expect(isRuntimeSendRefusedError(err)).toBe(true);
      expect(err).toMatchObject({ admitted: "none", stage: "first settle wait", target: "w7:p1" });
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });
  }

  it("r2 m-1: the settle wait after attempt 1 answers blocked with no agent name: earlier-attempt-unconfirmed", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // agent prompt
      .mockResolvedValueOnce(at("idle")) // consumption poll: not consumed
      .mockResolvedValue(at("blocked", null)); // settle wait after attempt 1

    const err = await create({ settleTimeoutMs: 0, deliveryTimeoutMs: 0 })
      .sendMessage(HANDLE, "go")
      .catch((e: unknown) => e);

    expect(rawInput()).toEqual([]);
    expect(calls("agent", "prompt")).toHaveLength(1);
    expect(isRuntimeSendRefusedError(err)).toBe(true);
    expect(err).toMatchObject({
      admitted: "earlier-attempt-unconfirmed",
      stage: "settle wait after attempt 1",
    });
  });

  it("T-3.5: control: from idle, the consumption poll shows blocked: delivered, one prompt", async () => {
    mockExecFile
      .mockResolvedValueOnce(at("idle")) // settled
      .mockResolvedValueOnce(at("idle")) // pre-send state
      .mockResolvedValueOnce(ok({})) // agent prompt
      .mockResolvedValue(at("blocked")); // the prompt started a turn that asks a question

    await expect(create().sendMessage(HANDLE, "go")).resolves.toBeUndefined();

    expect(calls("agent", "prompt")).toHaveLength(1);
    expect(rawInput()).toEqual([]);
  });

  it("control: another prompt failure is not a refusal and is thrown as it is", async () => {
    const failure = herdrRejection(herdrFixture("closedpane_agent_prompt"));
    mockExecFile
      .mockResolvedValueOnce(at("idle"))
      .mockResolvedValueOnce(at("idle"))
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(at("idle"));

    const err = await create()
      .sendMessage(HANDLE, "go")
      .catch((e: unknown) => e);

    expect(isRuntimeSendRefusedError(err)).toBe(false);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("getOutput()", () => {
  it("reads recent-unwrapped so alt-screen TUI scrollback is reachable", async () => {
    mockExecFile.mockResolvedValueOnce(text("SPIKE-1\nSPIKE-2\n"));

    const out = await create().getOutput(HANDLE, 120);

    expect(argsOf(0)).toEqual([
      "pane",
      "read",
      "w7:p1",
      "--source",
      "recent-unwrapped",
      "--lines",
      "120",
    ]);
    expect(out).toBe("SPIKE-1\nSPIKE-2");
  });

  it("falls back to visible when recent-unwrapped is empty (pane with no agent)", async () => {
    mockExecFile
      .mockResolvedValueOnce(text("   \n  "))
      .mockResolvedValueOnce(text("$ echo hi\nhi"));

    const out = await create().getOutput(HANDLE);

    expect(argsOf(1)).toContain("visible");
    expect(out).toBe("$ echo hi\nhi");
  });

  it("falls back to visible when recent-unwrapped errors", async () => {
    mockExecFile
      .mockRejectedValueOnce(new Error("bad source"))
      .mockResolvedValueOnce(text("shell"));

    expect(await create().getOutput(HANDLE)).toBe("shell");
  });

  it("returns empty string when the pane cannot be read at all", async () => {
    mockExecFile.mockRejectedValue(new Error("gone"));
    expect(await create().getOutput(HANDLE)).toBe("");
  });

  it("defaults to 50 lines", async () => {
    mockExecFile.mockResolvedValueOnce(text("x"));
    await create().getOutput(HANDLE);
    expect(argsOf(0)).toContain("50");
  });
});

describe("isAlive()", () => {
  it("is true when the pane exists with the expected terminal", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1", terminal_id: "term_abc" } }));
    expect(await create().isAlive(HANDLE)).toBe(true);
  });

  it("rejects when the herdr command fails with text that names pane_not_found", async () => {
    mockExecFile.mockRejectedValueOnce(new Error("pane_not_found"));
    await expect(create().isAlive(HANDLE)).rejects.toThrow();
  });

  it("is false when the pane id was recycled onto a different terminal", async () => {
    // Pane ids are positional and reused after a workspace closes; without this
    // guard a new session's pane would report the old session as alive.
    mockExecFile.mockResolvedValueOnce(
      ok({ pane: { pane_id: "w7:p1", terminal_id: "term_someone_else" } }),
    );
    expect(await create().isAlive(HANDLE)).toBe(false);
  });

  it("is true when no terminal id was recorded and cannot be compared", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1" } }));
    expect(await create().isAlive({ ...HANDLE, data: { ...HANDLE.data, terminalId: "" } })).toBe(
      true,
    );
  });
});

// Same-ID R4 round 2 (review r1, M-3): false only for the `pane_not_found`
// code of the error envelope of a command that exits 0, and for the same pane
// with another terminal. A command that fails, an envelope without that code
// and a reply for another pane reject, whatever their text holds.
describe("isAlive(): only well-formed evidence is a negative", () => {
  it("rejects when herdr fails with a server_unavailable envelope that mentions pane not found", async () => {
    mockExecFile.mockRejectedValueOnce(
      Object.assign(new Error("Command failed: herdr pane get w7:p1"), {
        code: 1,
        stderr:
          '{"error":{"code":"server_unavailable","message":"cannot determine whether pane not found"}}\n',
      }),
    );
    await expect(create().isAlive(HANDLE)).rejects.toThrow(/could not answer/);
  });

  it("rejects when the herdr binary cannot start at a path that holds pane_not_found", async () => {
    const binPath = "/opt/herdr-probe/pane_not_found/missing-binary";
    mockExecFile.mockRejectedValueOnce(
      Object.assign(new Error(`spawn ${binPath} ENOENT`), { code: "ENOENT", path: binPath }),
    );
    await expect(create({ binPath }).isAlive(HANDLE)).rejects.toThrow(/could not answer/);
  });

  it("rejects an error envelope without a code whose message says pane not found", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ id: "cli:test", error: { message: "pane not found" } }),
      stderr: "",
    });
    await expect(create().isAlive(HANDLE)).rejects.toThrow(/could not answer/);
  });

  it("rejects a reply for another pane, also with another terminal", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w99:p8", terminal_id: "other" } }));
    await expect(create().isAlive(HANDLE)).rejects.toThrow(/answered for another pane \(w99:p8\)/);
  });

  it("control: the pane_not_found envelope at exit 0 answers false", async () => {
    mockExecFile.mockResolvedValueOnce(herdrError("pane_not_found", "Pane not found"));
    expect(await create().isAlive(HANDLE)).toBe(false);
  });

  it("control: the same pane with a replaced terminal answers false", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1", terminal_id: "term_b" } }));
    expect(await create().isAlive(HANDLE)).toBe(false);
  });
});

// Same-ID R4 round 3 (review r2, M-3): an answer with both an error and a
// result is no evidence, and neither is a terminal_id that is not text. A
// lone pane_not_found and a same-pane replaced terminal stay false.
describe("isAlive(): a contradictory or malformed pane answer is unknown", () => {
  function both(errorCode: unknown, pane: unknown) {
    return {
      stdout: JSON.stringify({
        id: "cli:test",
        error: { code: errorCode, message: "gone" },
        result: { pane },
      }),
      stderr: "",
    };
  }

  for (const [label, pane] of [
    ["the requested pane with its terminal", { pane_id: "w7:p1", terminal_id: "term_abc" }],
    ["the requested pane with a replaced terminal", { pane_id: "w7:p1", terminal_id: "term_b" }],
  ] as const) {
    it(`rejects the pane_not_found error with a result for ${label}`, async () => {
      mockExecFile.mockResolvedValueOnce(both("pane_not_found", pane));
      await expect(create().isAlive(HANDLE)).rejects.toThrow(
        /could not answer: herdr answered both an error \(pane_not_found\) and a result/,
      );
    });
  }

  it("rejects an error that is not an object, with a result for a replaced terminal", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        id: "cli:test",
        error: "pane_not_found",
        result: { pane: { pane_id: "w7:p1", terminal_id: "term_b" } },
      }),
      stderr: "",
    });
    await expect(create().isAlive(HANDLE)).rejects.toThrow(/error that is not an object/);
  });

  it("rejects the requested pane with a terminal_id that is not text", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1", terminal_id: 12 } }));
    await expect(create().isAlive(HANDLE)).rejects.toThrow(/terminal_id that is not text \(12\)/);
  });

  it("control: a lone pane_not_found error with a null result answers false", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        id: "cli:test",
        error: { code: "pane_not_found", message: "gone" },
        result: null,
      }),
      stderr: "",
    });
    expect(await create().isAlive(HANDLE)).toBe(false);
  });

  it("control: the requested pane without a terminal_id answers true", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1" } }));
    expect(await create().isAlive(HANDLE)).toBe(true);
  });
});

// Same-ID R4 round 4 (review r3, M-1): herdr answers a pane only inside a
// `result` object. On c02c0c02 the parser fell back to the top level of a
// body without one, so a top-level pane with a replaced terminal read as dead.
describe("isAlive(): a pane outside a result object is unknown", () => {
  const PANE = { pane_id: "w7:p1", terminal_id: "term_b" };

  for (const [label, body] of [
    ["a top-level pane without a result (review r3)", { id: "cli:test", pane: PANE }],
    [
      "a top-level pane with a null result (review r3)",
      { id: "cli:test", result: null, pane: PANE },
    ],
    [
      "a top-level pane with a scalar result (review r3)",
      { id: "cli:test", result: 12, pane: PANE },
    ],
    ["a top-level pane with a list result", { id: "cli:test", result: [], pane: PANE }],
  ] as const) {
    it(`rejects ${label}`, async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: JSON.stringify(body), stderr: "" });
      await expect(create().isAlive(HANDLE)).rejects.toThrow(
        /could not answer: herdr answered without a result object/,
      );
    });
  }

  it("control: the same replaced terminal inside a result object answers false", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: PANE }));
    expect(await create().isAlive(HANDLE)).toBe(false);
  });

  it("control: a lone pane_not_found error without a result answers false", async () => {
    mockExecFile.mockResolvedValueOnce(herdrError("pane_not_found", "Pane not found"));
    expect(await create().isAlive(HANDLE)).toBe(false);
  });
});

describe("getMetrics() / getAttachInfo()", () => {
  it("reports uptime from creation time", async () => {
    const handle = { ...HANDLE, data: { ...HANDLE.data, createdAt: Date.now() - 5_000 } };
    const metrics = await create().getMetrics!(handle);
    expect(metrics.uptimeMs).toBeGreaterThanOrEqual(5_000);
  });

  it("gives the herdr attach invocation", async () => {
    const info = await create().getAttachInfo!(HANDLE);
    expect(info.target).toBe("w7:p1");
    expect(info.command).toBe("herdr agent attach w7:p1");
  });
});

describe("config", () => {
  it("honours a custom binPath", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1" } }));
    await create({ binPath: "/opt/herdr/bin/herdr" }).isAlive(HANDLE);
    expect(mockExecFile.mock.calls[0][0]).toBe("/opt/herdr/bin/herdr");
  });

  it("defaults to herdr on PATH", async () => {
    mockExecFile.mockResolvedValueOnce(ok({ pane: { pane_id: "w7:p1" } }));
    await create().isAlive(HANDLE);
    expect(mockExecFile.mock.calls[0][0]).toBe("herdr");
  });
});

describe("detect()", () => {
  it("is true only when a server is running", () => {
    mockExecFileSync.mockReturnValueOnce("status: running\nversion: 0.8.0\n");
    expect(detect()).toBe(true);
  });

  it("is false when the binary exists but no server is up", () => {
    mockExecFileSync.mockReturnValueOnce("status: not running\n");
    expect(detect()).toBe(false);
  });

  it("is false when herdr is not installed", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(detect()).toBe(false);
  });
});
