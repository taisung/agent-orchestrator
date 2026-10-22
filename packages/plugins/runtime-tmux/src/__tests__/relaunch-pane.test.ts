/**
 * Session relaunch (2026-10-22): the two runtime-tmux additions that a
 * relaunch uses on an existing pane, `getPaneState` and `runInPane`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as childProcess from "node:child_process";
import { RUNTIME_NO_SERVER_ERROR_CODE, type RuntimeHandle } from "@aoagents/ao-core";

vi.mock("node:child_process", () => {
  const mockExecFile = vi.fn();
  (mockExecFile as any)[Symbol.for("nodejs.util.promisify.custom")] = vi.fn();
  return { execFile: mockExecFile };
});

const mockExecFileCustom = (childProcess.execFile as any)[
  Symbol.for("nodejs.util.promisify.custom")
] as ReturnType<typeof vi.fn>;
const expectedTmuxOptions = { timeout: 5_000 };

function mockTmuxSuccess(stdout = "") {
  mockExecFileCustom.mockResolvedValueOnce({ stdout: stdout + "\n", stderr: "" });
}

function mockTmuxFailure(command: string, stderr: string) {
  mockExecFileCustom.mockRejectedValueOnce(
    Object.assign(new Error(`Command failed: tmux ${command}\n${stderr}`), {
      code: 1,
      killed: false,
      signal: null,
      stdout: "",
      stderr,
    }),
  );
}

function makeHandle(id: string): RuntimeHandle {
  return { id, runtimeName: "tmux", data: { createdAt: 1000, workspacePath: "/tmp/ws" } };
}

import { create, TmuxProbeError } from "../index.js";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runtime.getPaneState()", () => {
  it("answers the TTY and the foreground command of the exact pane target", async () => {
    mockTmuxSuccess("/dev/pts/4 bash");

    const state = await create().getPaneState!(makeHandle("app-1"));

    expect(state).toEqual({ tty: "/dev/pts/4", foregroundCommand: "bash" });
    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["display-message", "-p", "-t", "=app-1:", "#{pane_tty} #{pane_current_command}"],
      expectedTmuxOptions,
    );
  });

  it("keeps a foreground command with a space in it", async () => {
    mockTmuxSuccess("/dev/pts/9 my tool");

    expect(await create().getPaneState!(makeHandle("app-1"))).toEqual({
      tty: "/dev/pts/9",
      foregroundCommand: "my tool",
    });
  });

  it("answers null only when tmux answers that the session does not exist", async () => {
    mockTmuxFailure("display-message", "can't find session: =app-1\n");

    expect(await create().getPaneState!(makeHandle("app-1"))).toBeNull();
  });

  it("rejects with the no-server code when no tmux server runs", async () => {
    mockTmuxFailure("display-message", "no server running on /tmp/tmux-1000/default\n");

    const err = await create().getPaneState!(makeHandle("app-1")).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TmuxProbeError);
    expect((err as TmuxProbeError).code).toBe(RUNTIME_NO_SERVER_ERROR_CODE);
  });

  it.each([[""], ["bash"], ["pts/4 bash"], ["/dev/pts/4 "], ["/dev/pts/4 bash\n/dev/pts/5 zsh"]])(
    "rejects an answer that is not a TTY and a command: %j",
    async (answer) => {
      mockTmuxSuccess(answer);

      await expect(create().getPaneState!(makeHandle("app-1"))).rejects.toThrow(
        /not a pane TTY and a command/,
      );
    },
  );

  it("rejects without a tmux call for a handle ID that is not a safe tmux name", async () => {
    await expect(create().getPaneState!(makeHandle("bad.name"))).rejects.toThrow(
      /^Invalid tmux session name/,
    );
    expect(mockExecFileCustom).not.toHaveBeenCalled();
  });
});

describe("runtime.runInPane()", () => {
  it("clears the input, types the command literally, then presses Enter", async () => {
    mockTmuxSuccess();
    mockTmuxSuccess();
    mockTmuxSuccess();

    await create().runInPane!(makeHandle("app-1"), "bash '/tmp/ao-launch-1.sh'");

    expect(mockExecFileCustom.mock.calls).toEqual([
      ["tmux", ["send-keys", "-t", "=app-1:", "C-u"], expectedTmuxOptions],
      [
        "tmux",
        ["send-keys", "-t", "=app-1:", "-l", "bash '/tmp/ao-launch-1.sh'"],
        expectedTmuxOptions,
      ],
      ["tmux", ["send-keys", "-t", "=app-1:", "Enter"], expectedTmuxOptions],
    ]);
  });

  it("rejects with the pane and the tmux failure as cause, and presses no Enter after a failed type", async () => {
    mockTmuxSuccess();
    mockTmuxFailure("send-keys", "can't find pane: =app-1:\n");

    const err = await create().runInPane!(makeHandle("app-1"), "bash '/tmp/ao-launch-1.sh'").catch(
      (e: unknown) => e,
    );

    expect((err as Error).message).toBe("Failed to type the command into tmux pane =app-1:");
    expect((err as Error).cause).toBeInstanceOf(Error);
    expect(mockExecFileCustom).toHaveBeenCalledTimes(2);
  });
});
