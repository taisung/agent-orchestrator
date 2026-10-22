/**
 * `ao send` to a tmux Claude Code pane, with the real claude-code plugin and
 * real 2.1.304 to 2.1.307 screens of `agent-claude-code/src/__fixtures__/`.
 * The idle wait and the verify loop of `send.ts` are the loop of every agent
 * except Codex; only the plugin's `detectActivity` reads the screens. tmux is
 * mocked; every key that the command sends is kept in `keys` in order. The
 * last describe sends to Gemini and OpenCode panes with their real plugins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import claudeCodePlugin from "@aoagents/ao-plugin-agent-claude-code";
import geminiPlugin from "@aoagents/ao-plugin-agent-gemini";
import opencodePlugin from "@aoagents/ao-plugin-agent-opencode";
import {
  REAL_DIALOG_FORM1_80_S20,
  REAL_DIALOG_PERMISSION_80_S20,
} from "../../../plugins/agent-opencode/src/__fixtures__/panes-2.0.31.js";
import IDLE_BYPASS_307 from "../../../plugins/agent-claude-code/src/__fixtures__/claude-2.1.307-idle-bypass.txt?raw";
import IDLE_PASTE_HINT_307 from "../../../plugins/agent-claude-code/src/__fixtures__/claude-2.1.307-idle-paste-hint.txt?raw";
import RUNNING_01_306 from "../../../plugins/agent-claude-code/src/__fixtures__/claude-2.1.306-running-01.txt?raw";
import RUNNING_DIFFPANEL_306 from "../../../plugins/agent-claude-code/src/__fixtures__/claude-2.1.306-running-diffpanel.txt?raw";
import DIALOG_T1_304 from "../../../plugins/agent-claude-code/src/__fixtures__/claude-2.1.304-dialog-t1-01_before.txt?raw";
import DIALOG_T5_OPEN_304 from "../../../plugins/agent-claude-code/src/__fixtures__/claude-2.1.304-dialog-t5-00_dialog_open.txt?raw";
import DIALOG_T5_PASTE3_304 from "../../../plugins/agent-claude-code/src/__fixtures__/claude-2.1.304-dialog-t5-paste3-03_verify1.txt?raw";

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

const PANE = "=claude-1:";
const ENTER = ["send-keys", "-t", PANE, "Enter"];
const CLEAR = ["send-keys", "-t", PANE, "C-u"];
const MESSAGE = "Rebase onto main and run the gates again.";
const SEND = [CLEAR, ["send-keys", "-t", PANE, "-l", MESSAGE], ENTER];

const WAITING = "Waiting for claude-1 to become idle...";
const PROCESSING = "Message sent and processing";
const NOT_CONFIRMED = "Message sent — could not confirm it was received";
const REFUSED =
  "Timeout waiting for claude-1: session is waiting for interactive input; not sending.";
const WAITS_FOR_ANSWER =
  "Message sent — the pane waits for an answer: check claude-1 (tmux pane =claude-1:)";

let program: Command;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
/** Every key and paste vector in the order the command sent it. */
let keys: string[][];
/** The screens that the next captures return; the last one repeats. */
let screens: string[];
/** Each printed line with the number of key vectors sent before it and the fake time. */
let lines: Array<[string, number, number]>;
let start: number;

function claudeSession(id = "claude-1", agent = "claude-code"): Record<string, unknown> {
  return {
    id,
    projectId: "my-app",
    status: "working",
    activity: "idle",
    branch: null,
    issueId: null,
    pr: null,
    workspacePath: null,
    runtimeHandle: { id, runtimeName: "tmux", data: {} },
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: { agent },
  };
}

function config(): Record<string, unknown> {
  return {
    configPath: "/tmp/agent-orchestrator.yaml",
    defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        sessionPrefix: "app",
        path: "/tmp/my-app",
        defaultBranch: "main",
        repo: "org/my-app",
        agent: "claude-code",
        runtime: "tmux",
      },
    },
    notifiers: {},
    notificationRouting: {},
    reactions: {},
  };
}

/** Run `ao send`, move the fake clock until the command ends, and give back what it threw. */
async function run(...args: string[]): Promise<unknown> {
  let settled = false;
  const done = program
    .parseAsync(["node", "test", "send", ...args])
    .then(
      () => null,
      (err: unknown) => err,
    )
    .finally(() => {
      settled = true;
    });
  for (let i = 0; i < 400 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(250);
  }
  return done;
}

/** Run `ao send`; it must end without an error. */
async function send(...args: string[]): Promise<void> {
  expect(await run(...args)).toBeNull();
}

/** The printed lines with the number of key vectors sent before each one. */
function linesWithKeys(): Array<[string, number]> {
  return lines.map(([line, sent]) => [line, sent]);
}

beforeEach(() => {
  vi.useFakeTimers();
  program = new Command();
  program.exitOverride();
  registerSend(program);
  keys = [];
  screens = [];
  lines = [];
  start = Date.now();
  const record = (line: unknown): void => {
    lines.push([String(line), keys.length, Date.now() - start]);
  };
  logSpy = vi.spyOn(console, "log").mockImplementation(record);
  errorSpy = vi.spyOn(console, "error").mockImplementation(record);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  mockConfigRef.current = config();
  mockAgentRef.current = claudeCodePlugin.create();
  mockSessionManager.get.mockReset().mockResolvedValue(claudeSession());
  mockSessionManager.send.mockReset();
  mockExec.mockReset().mockImplementation(async (_cmd: string, args: string[]) => {
    if (args[0] === "paste-buffer") keys.push(["paste-buffer", args[args.indexOf("-t") + 1] ?? ""]);
    else if (args[0] !== "load-buffer") keys.push(args);
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

describe("ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens)", () => {
  it.each([
    ["claude-2.1.307-idle-bypass.txt", IDLE_BYPASS_307],
    ["claude-2.1.307-idle-paste-hint.txt", IDLE_PASTE_HINT_307],
  ])("sends at once to the idle screen %s in a regular send", async (_name, idle) => {
    // The idle screen at the idle wait, then a running turn at the first check.
    // The timeout only bounds a wait that must not happen.
    screens = [idle, RUNNING_01_306];

    await send("--timeout", "30", "claude-1", MESSAGE);

    expect(linesWithKeys()).toEqual([[PROCESSING, 3]]);
    expect(keys).toEqual(SEND);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("waits while the pane runs a turn, and sends when it is idle", async () => {
    screens = [RUNNING_01_306, RUNNING_DIFFPANEL_306, IDLE_BYPASS_307, RUNNING_01_306];

    await send("--timeout", "60", "claude-1", MESSAGE);

    expect(linesWithKeys()).toEqual([
      [WAITING, 0],
      [PROCESSING, 3],
    ]);
    // Two polls of 5 s read a running turn before the idle screen.
    expect(lines[1]?.[2]).toBeGreaterThanOrEqual(10_000);
    expect(keys).toEqual(SEND);
  });

  it.each([
    ["claude-2.1.304-dialog-t1-01_before.txt", DIALOG_T1_304],
    ["claude-2.1.304-dialog-t5-00_dialog_open.txt", DIALOG_T5_OPEN_304],
    ["claude-2.1.304-dialog-t5-paste3-03_verify1.txt", DIALOG_T5_PASTE3_304],
  ])("waits at the dialog %s and refuses at the timeout, with no key", async (_name, dialog) => {
    screens = [dialog];

    expect(await run("--timeout", "5", "claude-1", MESSAGE)).toEqual(new Error("process.exit(1)"));

    expect(linesWithKeys()).toEqual([
      [WAITING, 0],
      [REFUSED, 0],
    ]);
    expect(lines[1]?.[2]).toBeGreaterThan(5000);
    expect(keys).toEqual([]);
  });

  it("prints processing for a running turn at the first check, with no retry Enter", async () => {
    screens = [RUNNING_01_306];

    await send("--no-wait", "claude-1", MESSAGE);

    expect(linesWithKeys()).toEqual([[PROCESSING, 3]]);
    expect(keys).toEqual(SEND);
  });

  it("keeps the retry Enters of the loop for a pane that stays idle (unchanged loop)", async () => {
    screens = [IDLE_BYPASS_307];

    await send("--no-wait", "claude-1", MESSAGE);

    expect(linesWithKeys()).toEqual([[NOT_CONFIRMED, 5]]);
    expect(keys).toEqual([...SEND, ENTER, ENTER]);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

describe("the verify loop: a pane that waits for an answer gets a line of its own and no key", () => {
  it.each([
    ["claude-2.1.304-dialog-t1-01_before.txt", DIALOG_T1_304],
    ["claude-2.1.304-dialog-t5-00_dialog_open.txt", DIALOG_T5_OPEN_304],
    ["claude-2.1.304-dialog-t5-paste3-03_verify1.txt", DIALOG_T5_PASTE3_304],
  ])(
    "prints the line for the dialog %s after a --no-wait send, with no retry Enter",
    async (_name, dialog) => {
      screens = [dialog];

      await send("--no-wait", "claude-1", MESSAGE);

      expect(linesWithKeys()).toEqual([[WAITS_FOR_ANSWER, 3]]);
      expect(keys).toEqual(SEND);
    },
  );

  it("prints the line when a dialog shows at the first check of a regular send", async () => {
    // Idle at the idle wait, then the dialog that the message opened.
    screens = [IDLE_BYPASS_307, DIALOG_T1_304];

    await send("--timeout", "30", "claude-1", MESSAGE);

    expect(linesWithKeys()).toEqual([[WAITS_FOR_ANSWER, 3]]);
    expect(keys).toEqual(SEND);
  });

  it("idle, then a dialog: the idle check keeps its retry Enter, the dialog check sends no key", async () => {
    // --no-wait: check 1 reads the idle screen (the retry Enter of 48f500af
    // for a screen that is not active), checks 2 and 3 would read the dialog.
    screens = [IDLE_BYPASS_307, DIALOG_T1_304];

    await send("--no-wait", "claude-1", MESSAGE);

    expect(linesWithKeys()).toEqual([[WAITS_FOR_ANSWER, 4]]);
    expect(keys).toEqual([...SEND, ENTER]);
  });

  it("prints the line for a dialog at the last check, after two retry Enters to an idle screen", async () => {
    screens = [IDLE_BYPASS_307, IDLE_BYPASS_307, DIALOG_T5_PASTE3_304];

    await send("--no-wait", "claude-1", MESSAGE);

    expect(linesWithKeys()).toEqual([[WAITS_FOR_ANSWER, 5]]);
    expect(keys).toEqual([...SEND, ENTER, ENTER]);
  });

  it.each([
    ["REAL_DIALOG_PERMISSION_80_S20", REAL_DIALOG_PERMISSION_80_S20],
    ["REAL_DIALOG_FORM1_80_S20", REAL_DIALOG_FORM1_80_S20],
  ])(
    "sends no retry Enter to an OpenCode pane that reads waiting_input (real 2.0.31 capture %s)",
    async (_name, dialog) => {
      const agent = opencodePlugin.create();
      expect(agent.detectActivity(dialog)).toBe("waiting_input");
      mockAgentRef.current = agent;
      mockSessionManager.get.mockResolvedValue(claudeSession("oc-1", "opencode"));
      screens = [dialog];

      await send("--no-wait", "oc-1", "hello");

      expect(linesWithKeys()).toEqual([
        ["Message sent — the pane waits for an answer: check oc-1 (tmux pane =oc-1:)", 3],
      ]);
      expect(keys).toEqual([
        ["send-keys", "-t", "=oc-1:", "C-u"],
        ["send-keys", "-t", "=oc-1:", "-l", "hello"],
        ["send-keys", "-t", "=oc-1:", "Enter"],
      ]);
    },
  );

  it("sends no retry Enter to a Gemini pane that reads waiting_input (derived approval prompt)", async () => {
    // No real Gemini capture is in the repo: the screen is the one of the
    // Gemini plugin test for an approval prompt.
    const prompt = "Do you approve this?\n(y)es (n)o";
    const agent = geminiPlugin.create();
    expect(agent.detectActivity(prompt)).toBe("waiting_input");
    mockAgentRef.current = agent;
    mockSessionManager.get.mockResolvedValue(claudeSession("gem-1", "gemini"));
    screens = [prompt];

    await send("--no-wait", "gem-1", "hello");

    expect(linesWithKeys()).toEqual([
      ["Message sent — the pane waits for an answer: check gem-1 (tmux pane =gem-1:)", 3],
    ]);
    expect(keys).toEqual([
      ["send-keys", "-t", "=gem-1:", "C-u"],
      ["send-keys", "-t", "=gem-1:", "-l", "hello"],
      ["send-keys", "-t", "=gem-1:", "Enter"],
    ]);
  });

  it("keeps the queued line, the processing line and the retry rules for screens that do not wait", async () => {
    const queued = IDLE_BYPASS_307.replace(
      "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent",
      "  Press up to edit queued messages",
    );
    expect(queued).not.toBe(IDLE_BYPASS_307);
    screens = [queued];
    await send("--no-wait", "claude-1", MESSAGE);
    expect(linesWithKeys()).toEqual([["Message queued (session finishing previous task)", 3]]);
    expect(keys).toEqual(SEND);

    keys = [];
    lines = [];
    screens = [IDLE_BYPASS_307, RUNNING_DIFFPANEL_306];
    await send("--no-wait", "claude-1", MESSAGE);
    expect(linesWithKeys()).toEqual([[PROCESSING, 4]]);
    expect(keys).toEqual([...SEND, ENTER]);
  });
});
