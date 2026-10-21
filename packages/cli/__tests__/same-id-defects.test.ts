/**
 * Defect tests of the same-ID design round (ao-48, design file
 * development/reviews/same_id_design_r1_opus.md). Each test fails on
 * ce49c9fd for the measured reason and describes the wanted behavior.
 *
 * Marking: `defect(...)` is `it.fails`, so the full suite stays green while
 * the defect is there, and the test turns red (vitest: "Expect test to fail")
 * as soon as a fix makes it pass. The fix round then changes `defect` to `it`.
 * Run `SAME_ID_DEFECTS=red pnpm vitest run same-id` to see the failures as
 * plain tests. Round R1 (exact tmux targets).
 *
 * D-A in the CLI: `lib/shell.ts` `getTmuxActivity` (`ao status`,
 * `ao session ls`) and the raw tmux path of `ao send` use plain targets.
 * Measured with the worktree build on a private server (design file, D-A):
 * with kr-1 dead and a bystander kr-10, `ao send --no-wait kr-1` typed its
 * text into kr-10 and printed "Message sent and processing". The real
 * `lib/shell.ts` runs here; only the child process is a stand-in that
 * resolves targets as tmux 3.4 does (exact name, then the start of one name;
 * `=name` exact; `display-message` answers an unknown target with empty
 * values and exit 0).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as ChildProcess from "node:child_process";

const fake = vi.hoisted(() => ({
  sessions: new Map<string, { keys: string[]; activity: number }>(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const find = (target: string) => {
    const part = target.split(":")[0]!;
    if (part.startsWith("=")) return fake.sessions.get(part.slice(1));
    const exact = fake.sessions.get(part);
    if (exact) return exact;
    const prefixed = [...fake.sessions.keys()].filter((n) => n.startsWith(part));
    return prefixed.length === 1 ? fake.sessions.get(prefixed[0]!) : undefined;
  };
  const tmux = (args: string[]): string => {
    const hasTarget = args.includes("-t");
    const target = hasTarget ? args[args.indexOf("-t") + 1]! : "";
    const session = hasTarget ? find(target) : undefined;
    if (args[0] === "display-message") return session ? String(session.activity) : "";
    if (hasTarget && !session) {
      throw Object.assign(new Error(`Command failed: tmux ${args.join(" ")}`), {
        code: 1,
        stderr: `can't find session: ${target.split(":")[0]!.replace(/^=/, "")}\n`,
      });
    }
    switch (args[0]) {
      case "has-session":
      case "load-buffer":
        return "";
      case "send-keys":
        session!.keys.push(...args.slice(args.indexOf("-t") + 2).filter((a) => a !== "-l"));
        return "";
      case "paste-buffer":
        session!.keys.push("[paste]");
        return "";
      case "capture-pane":
        return "❯ ";
      default:
        throw new Error(`tmux stand-in: unsupported ${args.join(" ")}`);
    }
  };
  const execFile = ((...args: Parameters<typeof actual.execFile>) =>
    actual.execFile(...args)) as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[]) => {
      if (cmd !== "tmux") throw new Error(`unexpected command: ${cmd}`);
      return { stdout: tmux(args), stderr: "" };
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

vi.mock("../src/lib/plugins.js", () => {
  // "active" ends the delivery check of `ao send` after its first 2 s wait.
  const agent = { name: "claude-code", processName: "claude", detectActivity: () => "active" };
  return {
    getAgent: () => agent,
    getAgentByName: () => agent,
    getAgentByNameFromRegistry: () => agent,
  };
});

vi.mock("../src/lib/session-utils.js", () => ({
  findProjectForSession: () => null,
}));

vi.mock("@aoagents/ao-core", () => ({
  loadConfig: () => {
    throw new Error("no config");
  },
}));

vi.mock("../src/lib/create-session-manager.js", () => ({
  getSessionManager: async () => ({ get: vi.fn(), send: vi.fn(), deliver: vi.fn() }),
  getPluginRegistry: async () => ({ get: vi.fn(), list: vi.fn(), register: vi.fn() }),
}));

import { Command } from "commander";
import { getTmuxActivity } from "../src/lib/shell.js";
import { registerSend } from "../src/commands/send.js";

const RED = process.env["SAME_ID_DEFECTS"] === "red";
function defect(name: string, fn: () => Promise<void>): void {
  (RED ? it : it.fails)(name, fn);
}

beforeEach(() => {
  fake.sessions.clear();
  // Only kr-10 lives; kr-1 is dead.
  fake.sessions.set("kr-10", { keys: [], activity: 1_792_600_200 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("[same-id R1] D-A: the CLI tmux calls match a longer session name by prefix", () => {
  defect("getTmuxActivity of a dead name does not report another session's activity", async () => {
    // `ao status` showed "1s ago" for the dead kr-1 (the bystander's activity).
    await expect(getTmuxActivity("kr-1")).resolves.toBeNull();
  });

  defect("ao send --no-wait to a dead name types nothing into another session", async () => {
    const program = new Command();
    program.exitOverride();
    registerSend(program);
    await program
      .parseAsync(["node", "ao", "send", "--no-wait", "kr-1", "echo", "probe"])
      .catch(() => undefined);
    expect(fake.sessions.get("kr-10")!.keys).toEqual([]);
  });
});
