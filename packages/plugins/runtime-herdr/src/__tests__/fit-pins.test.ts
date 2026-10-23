/**
 * Herdr fit F-6 (design development/reviews/herdr_fit_design_r7_opus.md
 * section 5.6, r5 M-3): `create` pins the absolute herdr binary and the server
 * socket (`herdr status server --json`) and stores them in the handle; every
 * later call for the handle runs that binary with HERDR_SOCKET_PATH set to that
 * socket, whatever the caller's PATH or herdr environment. A handle without
 * pins (every record made before the fit) calls as before; malformed pins make
 * no call.
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

// The binary checks use the real fs; only the launch script is not written.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return { ...actual, writeFileSync: vi.fn() };
});

vi.mock("node:timers/promises", () => ({
  setTimeout: () => Promise.resolve(),
}));

const { create } = await import("../index.js");
const { chmodSync, mkdirSync } = await import("node:fs");
const { join } = await import("node:path");
const { herdrFixture, herdrRejection, standInHerdrOnPath, statusRunning, STATUS_SOCKET } =
  await import("./herdr-fixtures.js");

const CREATE_CONFIG = {
  sessionId: "app-1",
  workspacePath: "/tmp/wt/app-1",
  launchCommand: "claude",
  environment: {},
};

const WORKSPACE_CREATED = {
  stdout: JSON.stringify({
    id: "cli:workspace:create",
    result: {
      workspace: { workspace_id: "w7" },
      root_pane: { pane_id: "w7:p1", terminal_id: "term_abc", workspace_id: "w7" },
    },
  }),
  stderr: "",
};
const PANE = {
  stdout: JSON.stringify({
    id: "cli:pane:get",
    result: { pane: { pane_id: "w7:p1", terminal_id: "term_abc" } },
  }),
  stderr: "",
};

const LEGACY = {
  id: "w7:p1",
  runtimeName: "herdr",
  data: { workspaceId: "w7", paneId: "w7:p1", terminalId: "term_abc" },
};

let standIn: ReturnType<typeof standInHerdrOnPath>;
const savedEnv = { ...process.env };

beforeEach(() => {
  mockExecFile.mockReset();
  standIn = standInHerdrOnPath();
});

afterEach(() => {
  standIn.restore();
  for (const key of ["HERDR_SOCKET_PATH", "HERDR_SESSION"]) {
    if (savedEnv[key] === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = savedEnv[key];
  }
});

/** A create that succeeds: status, workspace create, pane run. */
async function pinnedHandle() {
  mockExecFile
    .mockResolvedValueOnce(statusRunning())
    .mockResolvedValueOnce(WORKSPACE_CREATED)
    .mockResolvedValueOnce({ stdout: "{}", stderr: "" });
  const handle = await create().create(CREATE_CONFIG);
  mockExecFile.mockReset();
  return handle;
}

describe("Herdr fit F-6: create pins the binary and the socket", () => {
  it("T-6.1: runs status server --json with the absolute path on PATH and stores both pins", async () => {
    mockExecFile
      .mockResolvedValueOnce(statusRunning())
      .mockResolvedValueOnce(WORKSPACE_CREATED)
      .mockResolvedValueOnce({ stdout: "{}", stderr: "" });

    const handle = await create().create(CREATE_CONFIG);

    expect(mockExecFile.mock.calls[0][0]).toBe(standIn.bin);
    expect(mockExecFile.mock.calls[0][1]).toEqual(["status", "server", "--json"]);
    expect(handle.data).toMatchObject({ herdrBin: standIn.bin, herdrSocket: STATUS_SOCKET });
    // The create's own calls use the pins too.
    for (const call of mockExecFile.mock.calls.slice(1)) {
      expect(call[0]).toBe(standIn.bin);
      expect(call[2].env.HERDR_SOCKET_PATH).toBe(STATUS_SOCKET);
    }
    expect(mockExecFile.mock.calls.map((c) => c[1].slice(0, 2))).toEqual([
      ["status", "server"],
      ["workspace", "create"],
      ["pane", "run"],
    ]);
  });

  it("closes a workspace of a failed launch with the pins (the cleanup of today, until fit-2 F-4)", async () => {
    mockExecFile
      .mockResolvedValueOnce(statusRunning())
      .mockResolvedValueOnce(WORKSPACE_CREATED)
      .mockRejectedValueOnce(new Error("spawn failed"))
      .mockResolvedValueOnce({ stdout: "{}", stderr: "" });

    await expect(create().create(CREATE_CONFIG)).rejects.toThrow(/Failed to launch agent/);

    expect(mockExecFile.mock.calls[3][1]).toEqual(["workspace", "close", "w7"]);
    expect(mockExecFile.mock.calls[3][0]).toBe(standIn.bin);
    expect(mockExecFile.mock.calls[3][2].env.HERDR_SOCKET_PATH).toBe(STATUS_SOCKET);
  });

  it("T-6.2: a PATH changed after the create does not change the binary of later calls", async () => {
    const handle = await pinnedHandle();
    process.env["PATH"] = "/somewhere/else";
    mockExecFile.mockResolvedValue(PANE);

    await expect(create().isAlive(handle)).resolves.toBe(true);
    await create().getOutput(handle);

    expect(mockExecFile.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of mockExecFile.mock.calls) expect(call[0]).toBe(standIn.bin);
  });

  it("T-6.3: every later call has HERDR_SOCKET_PATH of the pin, whatever the caller's herdr environment", async () => {
    const handle = await pinnedHandle();
    process.env["HERDR_SOCKET_PATH"] = "/tmp/caller/other.sock";
    process.env["HERDR_SESSION"] = "caller-session";
    mockExecFile.mockImplementation(async (_bin: string, args: string[]) =>
      args[0] === "pane" && args[1] === "get"
        ? {
            stdout: JSON.stringify({
              id: "cli:pane:get",
              result: {
                pane: {
                  pane_id: "w7:p1",
                  terminal_id: "term_abc",
                  agent: "claude",
                  agent_status: "idle",
                },
              },
            }),
            stderr: "",
          }
        : { stdout: "{}", stderr: "" },
    );

    await create().isAlive(handle);
    await create().getOutput(handle);
    await create({ deliveryTimeoutMs: 0, sendAttempts: 1 })
      .sendMessage(handle, "hi")
      .catch(() => undefined);

    const kinds = new Set(mockExecFile.mock.calls.map((c) => `${c[1][0]} ${c[1][1]}`));
    expect(kinds).toEqual(
      new Set(["pane get", "pane read", "agent prompt", "pane send-text", "pane send-keys"]),
    );
    for (const call of mockExecFile.mock.calls) {
      expect(call[0]).toBe(standIn.bin);
      expect(call[2].env.HERDR_SOCKET_PATH).toBe(STATUS_SOCKET);
      expect(call[2].env.HERDR_SESSION).toBe("caller-session");
    }
  });

  it("T-6.4: a relative binPath, a bare name not on PATH, a directory or a file without an execute bit: create rejects with no call", async () => {
    await expect(create({ binPath: "./bin/herdr" }).create(CREATE_CONFIG)).rejects.toThrow(
      /the herdr binPath "\.\/bin\/herdr" is a relative path/,
    );
    await expect(create({ binPath: "herdr-other" }).create(CREATE_CONFIG)).rejects.toThrow(
      /herdr is not installed/,
    );
    const subdir = join(standIn.dir, "sub");
    mkdirSync(subdir);
    await expect(create({ binPath: subdir }).create(CREATE_CONFIG)).rejects.toThrow(
      /is not an executable file/,
    );
    chmodSync(standIn.bin, 0o644);
    await expect(create({ binPath: standIn.bin }).create(CREATE_CONFIG)).rejects.toThrow(
      /is not an executable file/,
    );
    await expect(create().create(CREATE_CONFIG)).rejects.toThrow(/herdr is not installed/);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  for (const [label, answer, message] of [
    [
      "running false (noserver_never_status_server_json)",
      () => ({ stdout: herdrFixture("noserver_never_status_server_json").stdout, stderr: "" }),
      /no herdr server runs at \/tmp\/aohd\/xdg\/config\/herdr\/sessions\/aohd-1\/herdr\.sock; start one: herdr server/,
    ],
    [
      "a relative socket",
      () => ({ stdout: JSON.stringify({ running: true, socket: "herdr.sock" }), stderr: "" }),
      /socket that is not an absolute path/,
    ],
    [
      "a socket with a newline",
      () => ({ stdout: JSON.stringify({ running: true, socket: "/tmp/a\nb.sock" }), stderr: "" }),
      /socket that is not an absolute path/,
    ],
    [
      "no socket",
      () => ({ stdout: JSON.stringify({ running: true }), stderr: "" }),
      /socket that is not an absolute path/,
    ],
    ["text that is not JSON", () => ({ stdout: "status: running", stderr: "" }), /not JSON/],
  ] as const) {
    it(`T-6.5: a status answer with ${label}: create rejects before workspace create`, async () => {
      mockExecFile.mockResolvedValueOnce(answer());
      await expect(create().create(CREATE_CONFIG)).rejects.toThrow(message);
      expect(mockExecFile).toHaveBeenCalledTimes(1);
      expect(mockExecFile.mock.calls[0][1]).toEqual(["status", "server", "--json"]);
    });
  }

  it("T-6.5: the exit-1 Rust text of r5_b0_status_server_json: create rejects before workspace create", async () => {
    mockExecFile.mockRejectedValueOnce(herdrRejection(herdrFixture("r5_b0_status_server_json")));
    await expect(create().create(CREATE_CONFIG)).rejects.toThrow(
      /herdr status server answered with a failure/,
    );
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});

describe("Herdr fit F-6: the calls of an existing handle", () => {
  it("T-6.6: a handle without pins calls binPath or herdr with the caller's environment", async () => {
    mockExecFile.mockResolvedValue(PANE);
    await create().isAlive(LEGACY);
    await create({ binPath: "/opt/herdr/bin/herdr" }).isAlive(LEGACY);
    expect(mockExecFile.mock.calls.map((c) => c[0])).toEqual(["herdr", "/opt/herdr/bin/herdr"]);
    for (const call of mockExecFile.mock.calls) expect(call[2]).toEqual({ timeout: 10_000 });
  });

  for (const [label, data] of [
    ["only herdrBin", { herdrBin: "/opt/herdr/bin/herdr" }],
    ["a relative socket", { herdrBin: "/opt/herdr/bin/herdr", herdrSocket: "herdr.sock" }],
    [
      "a control character",
      { herdrBin: "/opt/herdr/bin/herdr", herdrSocket: "/tmp/a\u001bb.sock" },
    ],
    ["a number", { herdrBin: 7, herdrSocket: "/tmp/s.sock" }],
  ] as const) {
    it(`T-6.7: malformed pins (${label}): isAlive and sendMessage reject, getOutput is empty, with no call`, async () => {
      const handle = { ...LEGACY, data: { ...LEGACY.data, ...data } };
      await expect(create().isAlive(handle)).rejects.toThrow(
        /the herdr pins of this record are malformed/,
      );
      await expect(create().sendMessage(handle, "hi")).rejects.toThrow(
        /the herdr pins of this record are malformed/,
      );
      await expect(create().getOutput(handle)).resolves.toBe("");
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  }
});
