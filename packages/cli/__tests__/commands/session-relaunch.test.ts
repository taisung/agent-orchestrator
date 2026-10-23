/**
 * Session relaunch (2026-10-22), R-6: `ao session relaunch <id> [--continue]`.
 * The session manager is a mock; these tests pin what the command passes to
 * it, what it prints, and its exit code in each case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  SessionRelaunchRefusedError,
  type SessionRelaunchOptions,
  type SessionRelaunchPlan,
  type SessionRelaunchResult,
} from "@aoagents/ao-core";

const { mockSessionManager, mockConfigRef } = vi.hoisted(() => ({
  mockSessionManager: { relaunch: vi.fn() } as { relaunch?: ReturnType<typeof vi.fn> },
  mockConfigRef: { current: { configPath: "/tmp/none.yaml", projects: {} } as unknown },
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@aoagents/ao-core")>();
  return { ...actual, loadConfig: () => mockConfigRef.current };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async () => mockSessionManager,
  getPluginRegistry: async () => ({ get: vi.fn() }),
}));

import { registerSession } from "../../src/commands/session.js";

const PLAN: SessionRelaunchPlan = {
  sessionId: "app-1",
  mode: "pane",
  agentName: "claude-code",
  model: "opus",
  launchCommand: "claude --model 'opus'",
};

let program: Command;
let logs: string[];
let errors: string[];

/** The relaunch mock: calls onStart like core, then answers `result`. */
function relaunchAnswers(result: Partial<SessionRelaunchResult>): void {
  mockSessionManager.relaunch = vi.fn(async (_id: string, options: SessionRelaunchOptions) => {
    const plan = result.plan ?? PLAN;
    options.onStart?.(plan);
    for (const warning of result.warnings ?? []) options.onWarning?.(warning);
    return { plan, running: true, agentState: "running", warnings: [], ...result };
  });
}

async function run(...args: string[]): Promise<string | null> {
  try {
    await program.parseAsync(["node", "test", "session", "relaunch", ...args]);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

beforeEach(() => {
  program = new Command();
  program.exitOverride();
  registerSession(program);
  logs = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errors.push(a.map(String).join(" "));
  });
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  relaunchAnswers({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session relaunch", () => {
  it("relaunches in the pane, prints the plan and exits 0 when the agent process runs", async () => {
    expect(await run("app-1")).toBeNull();

    const options = mockSessionManager.relaunch!.mock.calls[0][1] as SessionRelaunchOptions;
    expect(mockSessionManager.relaunch).toHaveBeenCalledWith("app-1", expect.any(Object));
    expect(options.continueConversation).toBe(false);
    expect(typeof options.runInCallerTerminal).toBe("function");
    expect(options.callerTty === null || typeof options.callerTty === "string").toBe(true);
    // Review r2: core refuses a background ao in the session's own pane.
    expect(options.callerForeground === null || typeof options.callerForeground === "boolean").toBe(
      true,
    );
    expect(logs.join("\n")).toContain(
      "Relaunching app-1 (claude-code, model opus) in its tmux pane.",
    );
    expect(logs.join("\n")).toContain("Conversation: new");
    expect(logs.join("\n")).toContain("Session app-1 relaunched: its agent process runs.");
    expect(errors).toEqual([]);
  });

  it("passes --continue and prints the conversation and the source of its ID", async () => {
    relaunchAnswers({
      plan: {
        ...PLAN,
        conversation: { id: "0b5c3a52-6c55-4a0e-9d1f-6f0f3d2a9e11", source: "the hook record" },
      },
    });

    expect(await run("app-1", "--continue")).toBeNull();

    const options = mockSessionManager.relaunch!.mock.calls[0][1] as SessionRelaunchOptions;
    expect(options.continueConversation).toBe(true);
    expect(logs.join("\n")).toContain(
      "Conversation: 0b5c3a52-6c55-4a0e-9d1f-6f0f3d2a9e11 (from the hook record)",
    );
  });

  it("exits 1 with the reason and the next action on a refusal", async () => {
    mockSessionManager.relaunch = vi
      .fn()
      .mockRejectedValue(
        new SessionRelaunchRefusedError(
          "app-1",
          "its agent process (claude) still runs",
          "end the agent first (Claude Code: /exit), then try again",
        ),
      );

    expect(await run("app-1")).toBe("process.exit(1)");

    expect(errors).toEqual([
      expect.stringContaining(
        "Cannot relaunch session app-1: its agent process (claude) still runs",
      ),
      expect.stringContaining("Next: end the agent first (Claude Code: /exit), then try again"),
    ]);
  });

  it("exits 1 with the error when the relaunch fails after its checks", async () => {
    mockSessionManager.relaunch = vi
      .fn()
      .mockRejectedValue(
        new Error("The relaunch of app-1 could not start its agent (send-keys failed)"),
      );

    expect(await run("app-1")).toBe("process.exit(1)");

    expect(errors.join("\n")).toContain(
      "Failed to relaunch session app-1: The relaunch of app-1 could not start its agent (send-keys failed)",
    );
  });

  it("exits 1 when the agent process does not start within the bound", async () => {
    relaunchAnswers({ running: false, agentState: "absent" });

    expect(await run("app-1")).toBe("process.exit(1)");

    expect(errors.join("\n")).toContain("The agent process of app-1 did not start within 15 s.");
    expect(errors.join("\n")).toContain("Next: look at the pane with `ao session attach app-1`");
    expect(logs.join("\n")).not.toContain("relaunched: its agent process runs");
  });

  it("exits 1 and says that it may run when the process check gave no answer in time (review r1 M-7)", async () => {
    relaunchAnswers({ running: false, agentState: "unknown" });

    expect(await run("app-1")).toBe("process.exit(1)");

    expect(errors.join("\n")).toContain(
      "AO could not tell within 15 s whether the agent process of app-1 runs (the process check did not answer); it may run.",
    );
    expect(errors.join("\n")).toContain("and check `ao session ls`");
  });

  it("prints each warning of the end state at once, also while the agent still runs in the own pane (review r1 M-3)", async () => {
    let endChild: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      endChild = resolve;
    });
    relaunchAnswers({
      plan: { ...PLAN, mode: "caller-terminal" },
      child: { exited },
      warnings: ["the launch keys of app-1 could not be cleared yet (EIO)"],
    });

    const finished = run("app-1");
    await vi.waitFor(() => expect(mockSessionManager.relaunch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(errors).toEqual(["Warning: the launch keys of app-1 could not be cleared yet (EIO)"]);
    endChild(0);
    expect(await finished).toBe("process.exit(0)");
    expect(errors).toHaveLength(1);
  });

  it("in the session's own pane, waits for the agent and exits with its exit code", async () => {
    relaunchAnswers({
      plan: { ...PLAN, mode: "caller-terminal" },
      child: { exited: Promise.resolve(3) },
    });

    expect(await run("app-1")).toBe("process.exit(3)");

    expect(logs.join("\n")).toContain(
      "Relaunching app-1 (claude-code, model opus) in this terminal.",
    );
    expect(logs.join("\n")).not.toContain("relaunched: its agent process runs");
  });

  it("in the session's own pane, exits 0 when the agent ran and ended with 0", async () => {
    relaunchAnswers({
      plan: { ...PLAN, mode: "caller-terminal" },
      child: { exited: Promise.resolve(0) },
    });

    expect(await run("app-1")).toBe("process.exit(0)");
  });

  it("in the session's own pane, exits 1 when the child ended before the agent process was seen", async () => {
    relaunchAnswers({
      plan: { ...PLAN, mode: "caller-terminal" },
      running: false,
      agentState: "absent",
      child: { exited: Promise.resolve(0) },
    });

    expect(await run("app-1")).toBe("process.exit(1)");

    expect(errors.join("\n")).toContain("ended before its process was seen running");
  });

  it("exits 1 when the session manager cannot relaunch", async () => {
    delete mockSessionManager.relaunch;

    expect(await run("app-1")).toBe("process.exit(1)");

    expect(errors.join("\n")).toContain("cannot relaunch a session");
  });

  it("documents the refusals, both callers and --continue in its help", () => {
    const relaunch = program.commands
      .find((c) => c.name() === "session")!
      .commands.find((c) => c.name() === "relaunch")!;
    let help = "";
    relaunch.configureOutput({ writeOut: (s) => (help += s) });
    relaunch.outputHelp();

    // The help wraps its lines; the phrases are checked across the breaks.
    const text = help.replace(/\s+/g, " ");
    expect(text).toContain("--continue");
    expect(text).toContain("when the agent process still runs");
    expect(text).toContain("or is gone (the pane of the last relaunch was closed)");
    expect(text).toContain("Linux only: the checks read /proc.");
    expect(text).toContain(
      "In the session's own pane (as the foreground job, not with &), the agent runs as a child of this command",
    );
    expect(text).toContain("exits 0 only when the agent process runs within 15 s");
    expect(text).toContain("it types only when a second C-c shows a fresh, empty prompt line");
    expect(text).toContain("Then any half-typed text in the pane is dropped (C-c), never run.");
    expect(text).toContain("A shell that ignores or traps SIGINT shows no such line");
    expect(text).toContain("a restore or kill that started before the relaunch is not excluded");
  });
});
