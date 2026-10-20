import { describe, it, expect, vi, beforeEach } from "vitest";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import type { RuntimeHandle } from "@aoagents/ao-core";

// Mock node:child_process with custom promisify support
vi.mock("node:child_process", () => {
  const mockExecFile = vi.fn();
  // promisify(execFile) checks for a custom promisify symbol. Set it so
  // await execFileAsync(...) returns { stdout, stderr } properly.
  (mockExecFile as any)[Symbol.for("nodejs.util.promisify.custom")] = vi.fn();
  return { execFile: mockExecFile };
});

// Mock node:crypto for deterministic UUIDs
vi.mock("node:crypto", () => ({
  randomUUID: () => "test-uuid-1234",
}));

// Mock node:fs for writeFileSync / unlinkSync
vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Get reference to the promisify-custom mock — this is what the plugin actually calls
const mockExecFileCustom = (childProcess.execFile as any)[
  Symbol.for("nodejs.util.promisify.custom")
] as ReturnType<typeof vi.fn>;
const expectedTmuxOptions = { timeout: 5_000 };

/** Queue a successful tmux command with the given stdout. */
function mockTmuxSuccess(stdout = "") {
  mockExecFileCustom.mockResolvedValueOnce({ stdout: stdout + "\n", stderr: "" });
}

/** Queue a failed tmux command. */
function mockTmuxError(message: string) {
  mockExecFileCustom.mockRejectedValueOnce(new Error(message));
}

/** The error that execFile gives for a tmux command that exits with code 1. */
function tmuxFailure(command: string, stderr: string): Error {
  return Object.assign(new Error(`Command failed: tmux ${command}\n${stderr}`), {
    code: 1,
    killed: false,
    signal: null,
    stdout: "",
    stderr,
  });
}

/** Queue a tmux command that exits with code 1 and the given stderr. */
function mockTmuxFailure(command: string, stderr: string) {
  mockExecFileCustom.mockRejectedValueOnce(tmuxFailure(command, stderr));
}

/** Create a RuntimeHandle for testing. */
function makeHandle(id: string, createdAt?: number): RuntimeHandle {
  return {
    id,
    runtimeName: "tmux",
    data: {
      createdAt: createdAt ?? 1000,
      workspacePath: "/tmp/workspace",
    },
  };
}

// Import after mocks are set up
import tmuxPlugin, { manifest, create, TmuxProbeError } from "../index.js";

beforeEach(() => {
  // Reset, not only clear: a test that queues more once-values than create()
  // uses must not feed them to the next test.
  vi.resetAllMocks();
});

describe("manifest", () => {
  it("has name 'tmux' and slot 'runtime'", () => {
    expect(manifest.name).toBe("tmux");
    expect(manifest.slot).toBe("runtime");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.description).toBe("Runtime plugin: tmux sessions");
  });

  it("default export includes manifest and create", () => {
    expect(tmuxPlugin.manifest).toBe(manifest);
    expect(tmuxPlugin.create).toBe(create);
  });
});

describe("create()", () => {
  it("returns a Runtime with name 'tmux'", () => {
    const runtime = create();
    expect(runtime.name).toBe("tmux");
  });
});

describe("runtime.create()", () => {
  it("calls new-session with correct args", async () => {
    const runtime = create();

    // 1: new-session, 2: send-keys (launch command)
    mockTmuxSuccess();
    mockTmuxSuccess();

    const handle = await runtime.create({
      sessionId: "test-session",
      workspacePath: "/tmp/workspace",
      launchCommand: "echo hello",
      environment: {},
    });

    expect(handle.id).toBe("test-session");
    expect(handle.runtimeName).toBe("tmux");
    expect(handle.data.workspacePath).toBe("/tmp/workspace");

    // First call: new-session
    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["new-session", "-d", "-s", "test-session", "-c", "/tmp/workspace"],
      expectedTmuxOptions,
    );
  });

  it("includes -e KEY=VALUE flags for environment variables", async () => {
    const runtime = create();

    mockTmuxSuccess();
    mockTmuxSuccess();

    await runtime.create({
      sessionId: "env-session",
      workspacePath: "/tmp/ws",
      launchCommand: "bash",
      environment: { AO_SESSION: "env-session", FOO: "bar" },
    });

    // First call: new-session with env args
    const firstCallArgs = mockExecFileCustom.mock.calls[0];
    const args = firstCallArgs[1] as string[];
    expect(args).toContain("-e");
    expect(args).toContain("AO_SESSION=env-session");
    expect(args).toContain("FOO=bar");
  });

  it("runs the new-session client with the environment's PATH", async () => {
    const runtime = create();
    const panePath = "/home/u/.ao/bin:/home/u/bin:/usr/bin:/bin";

    mockTmuxSuccess(); // new-session
    mockTmuxSuccess(); // launch command

    await runtime.create({
      sessionId: "path-session",
      workspacePath: "/tmp/ws",
      launchCommand: "bash",
      environment: { PATH: panePath, AO_SESSION: "path-session" },
    });

    // tmux 3.4 gives the pane the PATH of the unattached client, so the client
    // process gets the built PATH; the rest of its environment is ao's own.
    const [cmd, args, options] = mockExecFileCustom.mock.calls[0] as [
      string,
      string[],
      { env?: NodeJS.ProcessEnv; timeout: number },
    ];
    expect(cmd).toBe("tmux");
    expect(args[0]).toBe("new-session");
    expect(args).toContain(`PATH=${panePath}`);
    expect(options.timeout).toBe(5_000);
    expect(options.env?.["PATH"]).toBe(panePath);
    expect(options.env?.["HOME"]).toBe(process.env["HOME"]);

    // Nothing is typed into the pane except the launch command.
    expect(mockExecFileCustom).toHaveBeenCalledTimes(2);
    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      2,
      "tmux",
      ["send-keys", "-t", "path-session", "bash", "Enter"],
      expectedTmuxOptions,
    );
    for (const call of mockExecFileCustom.mock.calls) {
      expect((call[1] as string[]).join(" ")).not.toContain("export");
    }
  });

  it("replaces a parent PATH that holds ~/.ao/bin and passes an empty GH_PATH", async () => {
    // Claude Code launched from a Codex pane: ao's own PATH and GH_PATH hold
    // the wrappers, and the agent environment removes them.
    vi.stubEnv("PATH", "/home/u/.ao/bin:/usr/bin:/bin");
    vi.stubEnv("GH_PATH", "/usr/local/bin/gh");
    try {
      const runtime = create();
      mockTmuxSuccess();
      mockTmuxSuccess();

      await runtime.create({
        sessionId: "claude-session",
        workspacePath: "/tmp/ws",
        launchCommand: "claude",
        environment: { PATH: "/usr/bin:/bin", GH_PATH: "" },
      });

      const [, args, options] = mockExecFileCustom.mock.calls[0] as [
        string,
        string[],
        { env?: NodeJS.ProcessEnv },
      ];
      expect(options.env?.["PATH"]).toBe("/usr/bin:/bin");
      // The session value wins over a GH_PATH in the server environment.
      expect(args).toContain("GH_PATH=");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("passes a PATH longer than one tty line (4095 bytes) unchanged", async () => {
    const runtime = create();
    const longPath = Array.from({ length: 200 }, (_, i) => `/tmp/long/dir-number-${i}`).join(":");
    expect(longPath.length).toBeGreaterThan(4095);

    mockTmuxSuccess();
    mockTmuxSuccess();

    await runtime.create({
      sessionId: "long-path",
      workspacePath: "/tmp/ws",
      launchCommand: "bash",
      environment: { PATH: longPath },
    });

    const options = mockExecFileCustom.mock.calls[0][2] as { env?: NodeJS.ProcessEnv };
    expect(options.env?.["PATH"]).toBe(longPath);
    expect(mockExecFileCustom).toHaveBeenCalledTimes(2);
  });

  it("keeps the default client environment when the environment has no PATH", async () => {
    const runtime = create();

    mockTmuxSuccess();
    mockTmuxSuccess();

    await runtime.create({
      sessionId: "nopath-session",
      workspacePath: "/tmp/ws",
      launchCommand: "bash",
      environment: { AO_SESSION: "x" },
    });

    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      1,
      "tmux",
      ["new-session", "-d", "-s", "nopath-session", "-c", "/tmp/ws", "-e", "AO_SESSION=x"],
      expectedTmuxOptions,
    );
    expect(mockExecFileCustom).toHaveBeenCalledTimes(2);
  });

  it("sends launch command via send-keys", async () => {
    const runtime = create();

    mockTmuxSuccess();
    mockTmuxSuccess();

    await runtime.create({
      sessionId: "launch-test",
      workspacePath: "/tmp/ws",
      launchCommand: "claude --session abc",
      environment: {},
    });

    // Second call: send-keys with the launch command
    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["send-keys", "-t", "launch-test", "claude --session abc", "Enter"],
      expectedTmuxOptions,
    );
  });

  it("uses a temp launch script for long launch commands", async () => {
    const runtime = create();
    const longCommand = "x".repeat(250);

    mockTmuxSuccess();
    mockTmuxSuccess();
    mockTmuxSuccess();

    await runtime.create({
      sessionId: "launch-long",
      workspacePath: "/tmp/ws",
      launchCommand: longCommand,
      environment: {},
    });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("ao-launch-test-uuid-1234.sh"),
      expect.stringContaining(longCommand),
      { encoding: "utf-8", mode: 0o700 },
    );

    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      2,
      "tmux",
      [
        "send-keys",
        "-t",
        "launch-long",
        "-l",
        expect.stringContaining("bash "),
      ],
      expectedTmuxOptions,
    );

    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      3,
      "tmux",
      ["send-keys", "-t", "launch-long", "Enter"],
      expectedTmuxOptions,
    );
  });

  it("cleans up session if send-keys fails", async () => {
    const runtime = create();

    // 1: new-session succeeds
    mockTmuxSuccess();
    // 2: send-keys fails
    mockTmuxError("send-keys failed");
    // 3: kill-session (cleanup attempt)
    mockTmuxSuccess();

    await expect(
      runtime.create({
        sessionId: "fail-session",
        workspacePath: "/tmp/ws",
        launchCommand: "bad-command",
        environment: {},
      }),
    ).rejects.toThrow('Failed to send launch command to session "fail-session"');

    // Verify kill-session was called for cleanup
    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["kill-session", "-t", "fail-session"],
      expectedTmuxOptions,
    );
  });

  it("rejects invalid session IDs with special characters", async () => {
    const runtime = create();

    await expect(
      runtime.create({
        sessionId: "bad session!",
        workspacePath: "/tmp/ws",
        launchCommand: "echo",
        environment: {},
      }),
    ).rejects.toThrow('Invalid session ID "bad session!"');
  });

  it("rejects session IDs with dots", async () => {
    const runtime = create();

    await expect(
      runtime.create({
        sessionId: "bad.session",
        workspacePath: "/tmp/ws",
        launchCommand: "echo",
        environment: {},
      }),
    ).rejects.toThrow("Invalid session ID");
  });

  it("accepts valid session IDs with hyphens and underscores", async () => {
    const runtime = create();

    mockTmuxSuccess();
    mockTmuxSuccess();

    const handle = await runtime.create({
      sessionId: "valid-session_123",
      workspacePath: "/tmp/ws",
      launchCommand: "echo",
      environment: {},
    });

    expect(handle.id).toBe("valid-session_123");
  });

  it("handles no environment (undefined)", async () => {
    const runtime = create();

    mockTmuxSuccess();
    mockTmuxSuccess();

    await runtime.create({
      sessionId: "no-env",
      workspacePath: "/tmp/ws",
      launchCommand: "echo hi",
    } as any);

    // First call should not contain -e flags
    const firstCallArgs = mockExecFileCustom.mock.calls[0][1] as string[];
    expect(firstCallArgs).toEqual(["new-session", "-d", "-s", "no-env", "-c", "/tmp/ws"]);
  });
});

describe("runtime.destroy()", () => {
  it("calls kill-session with the handle id", async () => {
    const runtime = create();
    const handle = makeHandle("destroy-test");

    mockTmuxSuccess();

    await runtime.destroy(handle);

    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["kill-session", "-t", "destroy-test"],
      expectedTmuxOptions,
    );
  });

  it("does not throw if session is already gone", async () => {
    const runtime = create();
    const handle = makeHandle("already-dead");

    mockTmuxError("session not found: already-dead");

    // Should not throw
    await expect(runtime.destroy(handle)).resolves.toBeUndefined();
  });
});

describe("runtime.sendMessage()", () => {
  it("sends short text with send-keys -l (literal) + Enter", async () => {
    const runtime = create();
    const handle = makeHandle("msg-short");

    // 1: send-keys C-u (clear), 2: send-keys -l text, 3: send-keys Enter
    mockTmuxSuccess();
    mockTmuxSuccess();
    mockTmuxSuccess();

    await runtime.sendMessage(handle, "hello world");

    expect(mockExecFileCustom).toHaveBeenCalledTimes(3);

    // Call 0: Clear partial input
    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      1,
      "tmux",
      ["send-keys", "-t", "msg-short", "C-u"],
      expectedTmuxOptions,
    );

    // Call 1: Literal text
    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      2,
      "tmux",
      ["send-keys", "-t", "msg-short", "-l", "hello world"],
      expectedTmuxOptions,
    );

    // Call 2: Enter
    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      3,
      "tmux",
      ["send-keys", "-t", "msg-short", "Enter"],
      expectedTmuxOptions,
    );
  });

  it("uses load-buffer + paste-buffer for long text (> 200 chars)", async () => {
    const runtime = create();
    const handle = makeHandle("msg-long");
    const longText = "x".repeat(250);

    // 1: C-u, 2: load-buffer, 3: paste-buffer, 4: unlinkSync (sync), 5: delete-buffer, 6: Enter
    mockTmuxSuccess(); // C-u
    mockTmuxSuccess(); // load-buffer
    mockTmuxSuccess(); // paste-buffer
    mockTmuxSuccess(); // delete-buffer (finally block)
    mockTmuxSuccess(); // Enter

    await runtime.sendMessage(handle, longText);

    expect(mockExecFileCustom).toHaveBeenCalledTimes(5);

    // Call 0: clear
    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      1,
      "tmux",
      ["send-keys", "-t", "msg-long", "C-u"],
      expectedTmuxOptions,
    );

    // Call 1: load-buffer with named buffer
    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      2,
      "tmux",
      [
        "load-buffer",
        "-b",
        "ao-test-uuid-1234",
        expect.stringContaining("ao-send-test-uuid-1234.txt"),
      ],
      expectedTmuxOptions,
    );

    // Call 2: paste-buffer
    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      3,
      "tmux",
      ["paste-buffer", "-b", "ao-test-uuid-1234", "-t", "msg-long", "-d"],
      expectedTmuxOptions,
    );

    // Verify writeFileSync was called with the message
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("ao-send-test-uuid-1234.txt"),
      longText,
      { encoding: "utf-8", mode: 0o600 },
    );

    // Verify unlinkSync was called for cleanup
    expect(fs.unlinkSync).toHaveBeenCalledWith(
      expect.stringContaining("ao-send-test-uuid-1234.txt"),
    );
  });

  it("uses load-buffer for multiline text", async () => {
    const runtime = create();
    const handle = makeHandle("msg-multi");

    mockTmuxSuccess(); // C-u
    mockTmuxSuccess(); // load-buffer
    mockTmuxSuccess(); // paste-buffer
    mockTmuxSuccess(); // delete-buffer (finally)
    mockTmuxSuccess(); // Enter

    await runtime.sendMessage(handle, "line1\nline2\nline3");

    // Should use buffer path, not send-keys -l
    expect(mockExecFileCustom).toHaveBeenNthCalledWith(
      2,
      "tmux",
      [
        "load-buffer",
        "-b",
        "ao-test-uuid-1234",
        expect.stringContaining("ao-send-test-uuid-1234.txt"),
      ],
      expectedTmuxOptions,
    );

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("ao-send-test-uuid-1234.txt"),
      "line1\nline2\nline3",
      { encoding: "utf-8", mode: 0o600 },
    );
  });

  it("cleans up buffer and temp file on paste failure", async () => {
    const runtime = create();
    const handle = makeHandle("msg-fail");
    const longText = "y".repeat(250);

    mockTmuxSuccess(); // C-u
    mockTmuxSuccess(); // load-buffer succeeds
    mockTmuxError("paste-buffer failed"); // paste-buffer fails
    // finally block:
    // unlinkSync is sync (mocked)
    mockTmuxSuccess(); // delete-buffer in finally
    // After finally, the error propagates — no Enter call

    await expect(runtime.sendMessage(handle, longText)).rejects.toThrow("paste-buffer failed");

    // unlinkSync should still be called for temp file cleanup
    expect(fs.unlinkSync).toHaveBeenCalledWith(
      expect.stringContaining("ao-send-test-uuid-1234.txt"),
    );

    // delete-buffer should be called in finally block
    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["delete-buffer", "-b", "ao-test-uuid-1234"],
      expectedTmuxOptions,
    );
  });
});

describe("runtime.getOutput()", () => {
  it("calls capture-pane with correct args and default lines", async () => {
    const runtime = create();
    const handle = makeHandle("output-test");

    mockTmuxSuccess("some output\nfrom tmux");

    const output = await runtime.getOutput(handle);

    expect(output).toBe("some output\nfrom tmux");
    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["capture-pane", "-t", "output-test", "-p", "-S", "-50"],
      expectedTmuxOptions,
    );
  });

  it("passes custom line count", async () => {
    const runtime = create();
    const handle = makeHandle("output-custom");

    mockTmuxSuccess("output");

    await runtime.getOutput(handle, 100);

    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["capture-pane", "-t", "output-custom", "-p", "-S", "-100"],
      expectedTmuxOptions,
    );
  });

  it("returns empty string on error", async () => {
    const runtime = create();
    const handle = makeHandle("output-err");

    mockTmuxError("session not found");

    const output = await runtime.getOutput(handle);

    expect(output).toBe("");
  });
});

describe("runtime.isAlive()", () => {
  it("returns true when has-session succeeds", async () => {
    const runtime = create();
    const handle = makeHandle("alive-test");

    mockTmuxSuccess();

    const alive = await runtime.isAlive(handle);

    expect(alive).toBe(true);
    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["has-session", "-t", "alive-test"],
      expectedTmuxOptions,
    );
  });

  it("returns false when tmux answers that the session does not exist", async () => {
    const runtime = create();
    const handle = makeHandle("dead-test");

    // tmux 3.4 answers a missing session with this text and exit code 1.
    mockTmuxFailure("has-session -t dead-test", "can't find session: dead-test\n");

    const alive = await runtime.isAlive(handle);

    expect(alive).toBe(false);
  });

  it.each(["can't find window: dead-test\n", "can't find pane: 5\n"])(
    "returns false for the other tmux not-found answer %j",
    async (stderr) => {
      mockTmuxFailure("has-session -t dead-test", stderr);
      await expect(create().isAlive(makeHandle("dead-test"))).resolves.toBe(false);
    },
  );

  it("returns false when a server with no session answers 'no current target' (m-1)", async () => {
    // tmux 3.4, `exit-empty off`, the last session ended: has-session prints this.
    mockTmuxFailure("has-session -t dead-test", "no current target\n");
    await expect(create().isAlive(makeHandle("dead-test"))).resolves.toBe(false);
  });

  it.each([
    {
      failure: "no server running (stale socket)",
      stderr: "no server running on /tmp/tmux-1000/default\n",
      code: "ERR_RUNTIME_NO_SERVER",
    },
    {
      failure: "no socket file",
      stderr: "error connecting to /tmp/tmux-1000/default (No such file or directory)\n",
      code: "ERR_RUNTIME_NO_SERVER",
    },
    {
      failure: "socket not accessible",
      stderr: "error connecting to /tmp/tmux-1000/default (Permission denied)\n",
      code: "ERR_RUNTIME_PROBE",
    },
    { failure: "another text", stderr: "server exited unexpectedly\n", code: "ERR_RUNTIME_PROBE" },
  ])("rejects with a typed error and a cause when $failure", async ({ stderr, code }) => {
    const failure = tmuxFailure("has-session -t alive-test", stderr);
    mockExecFileCustom.mockRejectedValueOnce(failure);

    const outcome = await create()
      .isAlive(makeHandle("alive-test"))
      .then(
        () => null,
        (err: unknown) => err,
      );

    expect(outcome).toBeInstanceOf(TmuxProbeError);
    expect(outcome).toMatchObject({ code, cause: failure });
    expect((outcome as Error).message).toContain(stderr.trim());
  });

  it("rejects when has-session times out", async () => {
    const timeout = Object.assign(new Error("Command failed: tmux has-session -t alive-test\n"), {
      code: null,
      killed: true,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
    });
    mockExecFileCustom.mockRejectedValueOnce(timeout);

    await expect(create().isAlive(makeHandle("alive-test"))).rejects.toMatchObject({
      name: "TmuxProbeError",
      code: "ERR_RUNTIME_PROBE",
      cause: timeout,
      message: expect.stringContaining("timed out after 5000 ms"),
    });
  });
});

describe("runtime.getMetrics()", () => {
  /** `list-sessions -F '#{session_created} #{session_name}'` output. */
  const sessionsCreated = (...rows: Array<[string, number]>) =>
    rows.map(([name, ms]) => `${Math.floor(ms / 1000)} ${name}`).join("\n");

  it("returns the age of the tmux session itself (#{session_created})", async () => {
    const now = Date.now();
    mockTmuxSuccess(sessionsCreated(["other", now - 7_200_000], ["metrics-test", now - 90_000]));

    const metrics = await create().getMetrics!(makeHandle("metrics-test", now - 5000));

    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["list-sessions", "-F", "#{session_created} #{session_name}"],
      expectedTmuxOptions,
    );
    // Whole seconds: the age is 90 s plus at most 1 s of rounding.
    expect(metrics.uptimeMs).toBeGreaterThanOrEqual(90_000);
    expect(metrics.uptimeMs).toBeLessThan(91_500);
  });

  it("reports a new session under an old name with its own age, not the handle's", async () => {
    const now = Date.now();
    mockTmuxSuccess(sessionsCreated(["metrics-test", now - 2_000]));

    const metrics = await create().getMetrics!(makeHandle("metrics-test", now - 3_600_000));

    expect(metrics.uptimeMs).toBeLessThan(3_500);
  });

  it("matches the exact name, not a session whose name only starts with it", async () => {
    mockTmuxSuccess(sessionsCreated(["metrics-test-10", Date.now() - 60_000]));

    await expect(create().getMetrics!(makeHandle("metrics-test"))).rejects.toThrow(
      "tmux session metrics-test not found",
    );
  });

  it("rejects with a typed error when tmux cannot list its sessions", async () => {
    mockTmuxFailure("list-sessions", "no server running on /tmp/tmux-1000/default\n");

    const rejection = await create()
      .getMetrics!(makeHandle("metrics-test"))
      .catch((err: unknown) => err);

    expect(rejection).toBeInstanceOf(TmuxProbeError);
    expect((rejection as TmuxProbeError).code).toBe("ERR_RUNTIME_NO_SERVER");
  });
});

describe("runtime.getAttachInfo()", () => {
  it("returns tmux type and attach command", async () => {
    const runtime = create();
    const handle = makeHandle("attach-test");

    const info = await runtime.getAttachInfo!(handle);

    expect(info).toEqual({
      type: "tmux",
      target: "attach-test",
      command: "tmux attach -t attach-test",
    });
  });
});
