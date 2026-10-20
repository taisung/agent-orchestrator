/**
 * Defect reproducers (M4, F3): a probe that cannot run answers "dead".
 *
 * On 2026-10-16 the lifecycle workers of two projects persisted `killed` for
 * every live session in one poll each (18:56:51Z and 18:57:03Z), for
 * claude-code, codex and OpenCode sessions alike. In a scratch config the
 * same write follows a few seconds of an unreachable tmux socket or of a
 * failing `ps` (development/reviews/killed_status_r1_opus.md, Q3).
 *
 * The lifecycle manager already treats a rejected `isAlive` as "unknown"
 * (lifecycle-manager.ts:389 `.catch(() => true)`), but the plugins never
 * reject: runtime-tmux `isAlive` maps every tmux error to `false`
 * (runtime-tmux/src/index.ts:175-181), and claude-code `isProcessRunning`
 * maps a failed `ps` to "no process" (agent-claude-code/src/index.ts:
 * 532-541, 581-582, 614-615). These tests fail on 654b3d28.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as childProcess from "node:child_process";
import type { RuntimeHandle } from "@aoagents/ao-core";

vi.mock("node:child_process", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("node:child_process")>();
  const mockExecFile = vi.fn();
  (mockExecFile as unknown as Record<symbol, unknown>)[Symbol.for("nodejs.util.promisify.custom")] =
    vi.fn();
  return { ...actual, execFile: mockExecFile };
});

const execFileAsync = (
  childProcess.execFile as unknown as Record<symbol, ReturnType<typeof vi.fn>>
)[Symbol.for("nodejs.util.promisify.custom")];

import { create as createTmuxRuntime } from "@aoagents/ao-plugin-runtime-tmux";
import {
  create as createClaudeCodeAgent,
  resetPsCache,
} from "@aoagents/ao-plugin-agent-claude-code";

const handle: RuntimeHandle = {
  id: "0e28352127dc-kr-orchestrator",
  runtimeName: "tmux",
  data: { createdAt: 1792510569606, workspacePath: "/tmp/ws" },
};

/** The error that `execFile` gives for a failed command (exit code 1). */
function commandFailed(command: string, stderr: string): Error {
  return Object.assign(new Error(`Command failed: ${command}\n${stderr}`), {
    code: 1,
    killed: false,
    signal: null,
    stdout: "",
    stderr,
  });
}

/** The error that `execFile` gives when its timeout kills the child. */
function commandTimedOut(command: string): Error {
  return Object.assign(new Error(`Command failed: ${command}\n`), {
    code: null,
    killed: true,
    signal: "SIGTERM",
    stdout: "",
    stderr: "",
  });
}

/** Settle a probe: a rejection means "unknown", which callers keep as alive. */
async function probe(answer: Promise<boolean>): Promise<{ alive: boolean } | { rejected: true }> {
  return answer.then(
    (alive) => ({ alive }),
    () => ({ rejected: true as const }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  resetPsCache();
});

describe("runtime-tmux isAlive when tmux cannot answer", () => {
  it("does not report a live session dead when the tmux server cannot be reached", async () => {
    // Measured with the socket of a private server removed: every client prints this.
    execFileAsync.mockRejectedValueOnce(
      commandFailed(
        `tmux has-session -t ${handle.id}`,
        "no server running on /tmp/tmux-44402/default\n",
      ),
    );

    const outcome = await probe(createTmuxRuntime().isAlive(handle));

    expect(execFileAsync).toHaveBeenCalledWith(
      "tmux",
      ["has-session", "-t", handle.id],
      expect.anything(),
    );
    expect(outcome).toEqual({ rejected: true });
  });

  it("does not report a live session dead when has-session times out", async () => {
    execFileAsync.mockRejectedValueOnce(commandTimedOut(`tmux has-session -t ${handle.id}`));

    const outcome = await probe(createTmuxRuntime().isAlive(handle));

    expect(execFileAsync).toHaveBeenCalledWith(
      "tmux",
      ["has-session", "-t", handle.id],
      expect.anything(),
    );
    expect(outcome).toEqual({ rejected: true });
  });
});

describe("claude-code isProcessRunning when ps cannot answer", () => {
  it("does not report the agent gone when ps fails", async () => {
    execFileAsync.mockImplementation(async (file: string) => {
      if (file === "tmux") return { stdout: "/dev/pts/7\n", stderr: "" };
      throw commandFailed("ps -eo pid,tty,args", "ps: simulated failure\n");
    });

    const outcome = await probe(createClaudeCodeAgent().isProcessRunning(handle));

    expect(execFileAsync).toHaveBeenCalledWith("ps", ["-eo", "pid,tty,args"], expect.anything());
    expect(outcome).toEqual({ rejected: true });
  });
});
