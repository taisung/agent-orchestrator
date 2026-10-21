/**
 * `ao send` to a tmux Codex pane: the verify loop reads the Codex 0.163.0
 * screens of `agent-codex/src/__fixtures__/panes-0.163.0.ts` through the real
 * Codex `detectActivity`. tmux is mocked; every key that the command sends is
 * kept in `keys` in order.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import codexPlugin from "@aoagents/ao-plugin-agent-codex";
import {
  DERIVED_MID_TURN_PASTE_0163,
  DERIVED_SUBMITTED_RUNNING_0163,
  REAL_IDLE_EMPTY_0163,
  REAL_UNSUBMITTED_PASTE_0163,
  UNSUBMITTED_NOTICE_0163,
} from "../../../plugins/agent-codex/src/__fixtures__/panes-0.163.0.js";

const { mockTmux, mockExec, mockConfigRef, mockSessionManager, mockAgentRef } = vi.hoisted(() => ({
  mockTmux: vi.fn(),
  mockExec: vi.fn(),
  mockConfigRef: { current: null as Record<string, unknown> | null },
  mockSessionManager: { get: vi.fn(), send: vi.fn() },
  mockAgentRef: { current: null as Record<string, unknown> | null },
}));

vi.mock("../../src/lib/shell.js", () => ({
  tmux: mockTmux,
  exec: mockExec,
  execSilent: vi.fn(),
  git: vi.fn(),
  gh: vi.fn(),
}));

vi.mock("../../src/lib/plugins.js", () => ({
  getAgentByName: () => mockAgentRef.current,
  getAgentByNameFromRegistry: () => mockAgentRef.current,
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@aoagents/ao-core")>();
  return {
    ...actual,
    loadConfig: () => {
      if (!mockConfigRef.current) throw new Error("no config");
      return mockConfigRef.current;
    },
  };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async () => mockSessionManager,
  getPluginRegistry: async () => ({ get: vi.fn(), list: vi.fn(), register: vi.fn() }),
}));

import { Command } from "commander";
import { registerSend } from "../../src/commands/send.js";

const PANE = "=codex-1:";
const ENTER = ["send-keys", "-t", PANE, "Enter"];
const CLEAR = ["send-keys", "-t", PANE, "C-u"];
const PASTE = ["paste-buffer", "-p", "-t", PANE];

const PROCESSING = "Message sent and processing";
const NOT_CONFIRMED = "Message sent — could not confirm it was received";
const EMPTY_NOT_CONFIRMED =
  "Message sent — the input box is empty but no turn is running: could not confirm it was received";

let program: Command;
let logSpy: ReturnType<typeof vi.spyOn>;
/** Every key and paste vector in the order the command sent it (initial and retry). */
let keys: string[][];
/** The screens that the next captures return; the last one repeats. */
let screens: string[];

function codexSession(): Record<string, unknown> {
  return {
    id: "codex-1",
    projectId: "my-app",
    status: "working",
    activity: "idle",
    branch: null,
    issueId: null,
    pr: null,
    workspacePath: null,
    runtimeHandle: { id: "codex-1", runtimeName: "tmux", data: {} },
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: { agent: "codex" },
  };
}

function config(agent: string): Record<string, unknown> {
  return {
    configPath: "/tmp/agent-orchestrator.yaml",
    defaults: { runtime: "tmux", agent, workspace: "worktree", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        sessionPrefix: "app",
        path: "/tmp/my-app",
        defaultBranch: "main",
        repo: "org/my-app",
        agent,
        runtime: "tmux",
      },
    },
    notifiers: {},
    notificationRouting: {},
    reactions: {},
  };
}

/** Run `ao send` and move the fake clock until the command ends. */
async function send(...args: string[]): Promise<void> {
  let settled = false;
  const done = program.parseAsync(["node", "test", "send", ...args]).finally(() => {
    settled = true;
  });
  for (let i = 0; i < 400 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(250);
  }
  await done;
}

function printed(): string[] {
  return logSpy.mock.calls.map((call) => String(call[0]));
}

/** The key vectors after the first Enter (the one that follows the text): what the verify loop sent. */
function retryKeys(): string[][] {
  const firstEnter = keys.findIndex((vector) => vector.join(" ") === ENTER.join(" "));
  return keys.slice(firstEnter + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
  program = new Command();
  program.exitOverride();
  registerSend(program);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  keys = [];
  screens = [];
  mockConfigRef.current = config("codex");
  mockAgentRef.current = codexPlugin.create();
  mockSessionManager.get.mockReset().mockResolvedValue(codexSession());
  mockSessionManager.send.mockReset();
  mockExec.mockReset().mockImplementation(async (_cmd: string, args: string[]) => {
    if (args[0] !== "load-buffer") keys.push(args);
    return { stdout: "", stderr: "" };
  });
  mockTmux.mockReset().mockImplementation(async (...args: string[]) => {
    if (args[0] === "has-session") return "";
    if (args[0] === "capture-pane") return screens.length > 1 ? screens.shift() : screens[0];
    keys.push(args);
    return "";
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ao send to a Codex 0.163.0 pane", () => {
  it("sends one more Enter to the unsubmitted paste and prints processing once the turn runs", async () => {
    screens = [REAL_UNSUBMITTED_PASTE_0163, DERIVED_SUBMITTED_RUNNING_0163];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual([CLEAR, PASTE, ENTER, ENTER]);
    expect(printed()).toEqual([PROCESSING]);
  });

  it("prints processing when the composer is empty after its Enter (Codex took the message)", async () => {
    screens = [REAL_UNSUBMITTED_PASTE_0163, REAL_IDLE_EMPTY_0163];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual([CLEAR, PASTE, ENTER, ENTER]);
    expect(printed()).toEqual([PROCESSING]);
  });

  it("prints the could-not-confirm line when the paste stays in the composer", async () => {
    screens = [REAL_UNSUBMITTED_PASTE_0163];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    // Two retry Enters (after checks 1 and 2); check 3 still shows the paste.
    expect(retryKeys()).toEqual([ENTER, ENTER]);
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });

  it("sends no Enter and does not print processing for an idle empty composer", async () => {
    screens = [REAL_IDLE_EMPTY_0163];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual([CLEAR, PASTE, ENTER]);
    expect(printed()).toEqual([EMPTY_NOT_CONFIRMED]);
  });

  it("keeps the mid-turn case: a running turn above the paste prints processing with no Enter", async () => {
    screens = [DERIVED_MID_TURN_PASTE_0163];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual([CLEAR, PASTE, ENTER]);
    expect(printed()).toEqual([PROCESSING]);
  });

  it("sends no Enter to composer text that is not this message", async () => {
    screens = [REAL_UNSUBMITTED_PASTE_0163];

    await send("--no-wait", "codex-1", "Rebase onto main and run the gates again.");

    expect(keys).toEqual([
      CLEAR,
      ["send-keys", "-t", PANE, "-l", "Rebase onto main and run the gates again."],
      ENTER,
    ]);
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });

  it("sends one more Enter to a paste that Codex shows as [Pasted Content ...]", async () => {
    const lines = REAL_UNSUBMITTED_PASTE_0163.split("\n");
    const composer = lines.findIndex((line) => line.startsWith("› "));
    const placeholder = [
      ...lines.slice(0, composer),
      "› [Pasted Content 1204 chars]",
      ...lines.slice(composer + 3),
    ].join("\n");
    screens = [placeholder, DERIVED_SUBMITTED_RUNNING_0163];

    await send("--no-wait", "codex-1", "x".repeat(1204));

    expect(retryKeys()).toEqual([ENTER]);
    expect(printed()).toEqual([PROCESSING]);
  });

  it("does not wait for an idle Codex pane before it sends", async () => {
    screens = [REAL_IDLE_EMPTY_0163, REAL_IDLE_EMPTY_0163, DERIVED_SUBMITTED_RUNNING_0163];

    await send("codex-1", UNSUBMITTED_NOTICE_0163);

    expect(printed()).not.toContain("Waiting for codex-1 to become idle...");
    expect(keys).toEqual([CLEAR, PASTE, ENTER]);
    expect(printed()).toEqual([PROCESSING]);
  });

  it("keeps the retry of other agents: an idle Claude Code screen gets two retry Enters", async () => {
    mockConfigRef.current = config("claude-code");
    mockSessionManager.get.mockResolvedValue({ ...codexSession(), metadata: {} });
    mockAgentRef.current = {
      name: "claude-code",
      processName: "claude",
      detectActivity: () => "idle",
    };
    screens = [REAL_IDLE_EMPTY_0163];

    await send("--no-wait", "codex-1", "hello");

    expect(retryKeys()).toEqual([ENTER, ENTER]);
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });
});
