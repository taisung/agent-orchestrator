/**
 * `ao send` to a tmux Codex pane: the verify loop reads the Codex 0.163.0
 * screens of `agent-codex/src/__fixtures__/panes-0.163.0.ts` with the screen
 * parser of the Codex plugin, sends no key after the message, and reports one
 * of three lines. tmux is mocked; every key that the command sends is kept in
 * `keys` in order.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import codexPlugin from "@aoagents/ao-plugin-agent-codex";
import {
  DERIVED_MID_TURN_PASTE_0163,
  DERIVED_SUBMITTED_RUNNING_0163,
  REAL_IDLE_EMPTY_0163,
  REAL_UNSUBMITTED_PASTE_0163,
  REVIEW_B1_FOREIGN_DRAFT,
  REVIEW_B1_FOREIGN_PASTE,
  REVIEW_B2_NESTED_PROMPT,
  REVIEW_M1B_COMPOSER,
  REVIEW_M1B_FIRST_ROW,
  REVIEW_M2_NUMBERED_MESSAGE,
  REVIEW_R2_M1_MESSAGE,
  REVIEW_R2_M1_QUOTED_PROMPT,
  REVIEW_R2_M2_MESSAGE,
  REVIEW_R2_M2_NUMBERED_LIST,
  REVIEW_R2_M3_APPROVAL,
  RUNNING_ROW_0163,
  UNSUBMITTED_NOTICE_0163,
} from "../../../plugins/agent-codex/src/__fixtures__/panes-0.163.0.js";
import RUNNING_01 from "../../../plugins/agent-codex/src/__fixtures__/codex-0.163.0-running-01.txt?raw";
import RUNNING_02 from "../../../plugins/agent-codex/src/__fixtures__/codex-0.163.0-running-02.txt?raw";
import RUNNING_03 from "../../../plugins/agent-codex/src/__fixtures__/codex-0.163.0-running-03.txt?raw";
import RUNNING_04 from "../../../plugins/agent-codex/src/__fixtures__/codex-0.163.0-running-04.txt?raw";
import RUNNING_05 from "../../../plugins/agent-codex/src/__fixtures__/codex-0.163.0-running-05.txt?raw";
import RUNNING_06 from "../../../plugins/agent-codex/src/__fixtures__/codex-0.163.0-running-06.txt?raw";

/** The six real captures of a running turn (see `agent-codex/src/__fixtures__/panes-0.163.0.ts`). */
const REAL_RUNNING: Array<[string, string]> = [
  ["01", RUNNING_01],
  ["02", RUNNING_02],
  ["03", RUNNING_03],
  ["04", RUNNING_04],
  ["05", RUNNING_05],
  ["06", RUNNING_06],
];

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
/** The paste call with its flags left out: the tests hold with and without `-p` (ccec6ee4). */
const PASTE = ["paste-buffer", PANE];

const PROCESSING = "Message sent and processing";
const NOT_CONFIRMED = "Message sent — could not confirm it was received";
const NOT_SUBMITTED =
  "Message not submitted: the text is still in the input box of codex-1 (tmux pane =codex-1:); check the pane and press Enter";
const APPROVAL =
  "Message sent — the pane waits for an approval: check codex-1 (tmux pane =codex-1:)";

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

/** The vectors of a send of `message` with no key after it: clear, paste or type, Enter. */
function sendOnly(message: string): string[][] {
  const text =
    message.includes("\n") || message.length > 200
      ? PASTE
      : ["send-keys", "-t", PANE, "-l", message];
  return [CLEAR, text, ENTER];
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

describe("ao send to a Codex 0.163.0 pane", () => {
  it("reports a message that stays in the composer as not submitted, and sends no key", async () => {
    screens = [REAL_UNSUBMITTED_PASTE_0163];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
    expect(printed()).toEqual([NOT_SUBMITTED]);
  });

  it("prints processing when a running turn shows at a later check, and sends no key", async () => {
    screens = [REAL_UNSUBMITTED_PASTE_0163, DERIVED_SUBMITTED_RUNNING_0163];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
    expect(printed()).toEqual([PROCESSING]);
  });

  it("M-1 A: an emptied composer with no running turn is not processing", async () => {
    screens = [REAL_UNSUBMITTED_PASTE_0163, REAL_IDLE_EMPTY_0163];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });

  it("M-1 B: a message row that starts with '? for shortcuts' does not make the composer empty", async () => {
    const message = "Describe this UI\n? for shortcuts means help";
    screens = [REVIEW_M1B_FIRST_ROW, REVIEW_M1B_COMPOSER];

    await send("--no-wait", "codex-1", message);

    expect(keys).toEqual(sendOnly(message));
    expect(printed()).toEqual([NOT_SUBMITTED]);
  });

  it("prints the could-not-confirm line for a composer that is empty at every check", async () => {
    screens = [REAL_IDLE_EMPTY_0163];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });

  it("keeps the mid-turn case: a running turn above the paste prints processing", async () => {
    screens = [DERIVED_MID_TURN_PASTE_0163];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
    expect(printed()).toEqual([PROCESSING]);
  });

  it("B-2: reports a running turn whose composer quotes a transcript as processing", async () => {
    screens = [REVIEW_B2_NESTED_PROMPT];

    await send("--no-wait", "codex-1", "examine this transcript");

    expect(keys).toEqual(sendOnly("examine this transcript"));
    expect(printed()).toEqual([PROCESSING]);
  });

  it("M-2: reports a numbered message in the composer as not submitted, not processing", async () => {
    screens = [REVIEW_M2_NUMBERED_MESSAGE];

    await send("--no-wait", "codex-1", "1. Summarize the test failures");

    expect(keys).toEqual(sendOnly("1. Summarize the test failures"));
    expect(printed()).toEqual([NOT_SUBMITTED]);
  });

  it("prints the could-not-confirm line for composer text that is not this message", async () => {
    screens = [REAL_UNSUBMITTED_PASTE_0163];

    await send("--no-wait", "codex-1", "Rebase onto main and run the gates again.");

    expect(keys).toEqual(sendOnly("Rebase onto main and run the gates again."));
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });

  it("B-1: sends no key to a draft or a paste of another sender (the text match chooses only the words)", async () => {
    screens = [REVIEW_B1_FOREIGN_DRAFT];
    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);
    expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
    expect(printed()).toEqual([NOT_SUBMITTED]);

    keys = [];
    logSpy.mockClear();
    screens = [REVIEW_B1_FOREIGN_PASTE];
    await send("--no-wait", "codex-1", "hello");
    expect(keys).toEqual(sendOnly("hello"));
    expect(printed()).toEqual([NOT_SUBMITTED]);
  });

  it("prints the could-not-confirm line when no composer is in view, and sends no key", async () => {
    const approvalView = [
      "  Would you like to run the following command?",
      "",
      "  $ pnpm test",
      "",
      "› 1. Yes, proceed (y)",
      "  2. No, and tell Codex what to do differently (esc)",
    ].join("\n");
    screens = [approvalView];

    await send("--no-wait", "codex-1", "hello");

    expect(keys).toEqual(sendOnly("hello"));
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });

  it("review r2 M-1: a quoted prompt row does not make a finished turn processing", async () => {
    screens = [REVIEW_R2_M1_QUOTED_PROMPT];

    await send("--no-wait", "codex-1", REVIEW_R2_M1_MESSAGE);

    expect(keys).toEqual(sendOnly(REVIEW_R2_M1_MESSAGE));
    expect(printed()).toEqual([NOT_SUBMITTED]);
  });

  it("review r2 M-2: a two-item numbered message with the word 'Running' is not submitted, not processing", async () => {
    screens = [REVIEW_R2_M2_NUMBERED_LIST];

    await send("--no-wait", "codex-1", REVIEW_R2_M2_MESSAGE);

    expect(keys).toEqual(sendOnly(REVIEW_R2_M2_MESSAGE));
    expect(printed()).toEqual([NOT_SUBMITTED]);
  });

  it("review r2 M-3: an approval prompt prints the approval line, not processing, and sends no key", async () => {
    screens = [REVIEW_R2_M3_APPROVAL];

    await send("--no-wait", "codex-1", "hello");

    expect(keys).toEqual(sendOnly("hello"));
    expect(printed()).toEqual([APPROVAL]);
  });

  it("asks detectActivity first: an approval prompt wins over a status row above the composer", async () => {
    // Derived to show the order: "approval required" in the last 8 rows and
    // the status row of a running turn directly above the empty composer.
    const lines = DERIVED_SUBMITTED_RUNNING_0163.trimEnd().split("\n");
    const status = lines.indexOf(RUNNING_ROW_0163);
    const both = [...lines.slice(0, status), "  approval required", ...lines.slice(status)].join(
      "\n",
    );
    screens = [REAL_UNSUBMITTED_PASTE_0163, both];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
    expect(printed()).toEqual([APPROVAL]);
  });

  it("prints the could-not-confirm line, not processing, for running words with no composer in view", async () => {
    // An unclear layout: the transcript is below the last prompt row.
    // detectActivity reads it as active, but no status row is above a composer.
    screens = [`› old message\n${RUNNING_ROW_0163}\n  Running pnpm test`];

    await send("--no-wait", "codex-1", "hello");

    expect(keys).toEqual(sendOnly("hello"));
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });

  it.each(REAL_RUNNING)(
    "prints processing for real running capture %s with --no-wait, and sends no key",
    async (_n, capture) => {
      screens = [capture];

      await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

      expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
      expect(printed()).toEqual([PROCESSING]);
    },
  );

  it("waits for real running capture 01 in a regular send and pastes only after the timeout", async () => {
    screens = [RUNNING_01];
    const start = Date.now();
    /** Each printed line with the number of key vectors sent before it and the time. */
    const lines: Array<[string, number, number]> = [];
    logSpy.mockImplementation((line: unknown) => {
      lines.push([String(line), keys.length, Date.now() - start]);
    });

    await send("--timeout", "5", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(lines.map(([line, sent]) => [line, sent])).toEqual([
      ["Waiting for codex-1 to become idle...", 0],
      ["Timeout waiting for idle. Sending anyway.", 0],
      [PROCESSING, 3],
    ]);
    expect(lines[1]?.[2]).toBeGreaterThan(5000);
    expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
  });

  it("prints the could-not-confirm line for a status row with a row of another kind above the composer", async () => {
    // Derived from real capture 02: a "Worked for" row between the Tip row
    // and the two blank rows makes the status row a row of the transcript.
    const tip = "  └ Tip: Type / to open the command popup; Tab autocompletes slash commands.\n";
    const ended = RUNNING_02.replace(tip, `${tip}  Worked for 1s\n`);
    expect(ended).not.toBe(RUNNING_02);
    screens = [ended];

    await send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163);

    expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });

  it("does not wait for an idle Codex pane before it sends", async () => {
    screens = [REAL_IDLE_EMPTY_0163, REAL_IDLE_EMPTY_0163, DERIVED_SUBMITTED_RUNNING_0163];

    await send("codex-1", UNSUBMITTED_NOTICE_0163);

    expect(printed()).not.toContain("Waiting for codex-1 to become idle...");
    expect(keys).toEqual(sendOnly(UNSUBMITTED_NOTICE_0163));
    expect(printed()).toEqual([PROCESSING]);
  });
});

describe("ao send to another agent: the loop of 09546110", () => {
  beforeEach(() => {
    mockConfigRef.current = config("claude-code");
    mockSessionManager.get.mockResolvedValue({ ...codexSession(), metadata: {} });
    mockAgentRef.current = {
      name: "claude-code",
      processName: "claude",
      detectActivity: () => "idle",
    };
  });

  it("sends two retry Enters to a screen with no running turn", async () => {
    screens = [REAL_IDLE_EMPTY_0163];

    await send("--no-wait", "codex-1", "hello");

    expect(retryKeys()).toEqual([ENTER, ENTER]);
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });

  it("sends an Enter at each check to a prompt with text and 'tab to queue message'", async () => {
    screens = ["output\n› draft\ntab to queue message"];

    await send("--no-wait", "codex-1", "hello");

    expect(retryKeys()).toEqual([ENTER, ENTER, ENTER]);
    expect(printed()).toEqual([NOT_CONFIRMED]);
  });

  it("prints processing with no retry when the agent reads the screen as active", async () => {
    mockAgentRef.current = {
      name: "claude-code",
      processName: "claude",
      detectActivity: () => "active",
    };
    screens = [REAL_IDLE_EMPTY_0163];

    await send("--no-wait", "codex-1", "hello");

    expect(retryKeys()).toEqual([]);
    expect(printed()).toEqual([PROCESSING]);
  });
});
