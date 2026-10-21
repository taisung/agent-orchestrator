/**
 * Defect tests of the same-ID design round (ao-48, design file
 * development/reviews/same_id_design_r1_opus.md). Each test fails on
 * ce49c9fd for the measured reason and describes the wanted behavior.
 *
 * Marking: `defect(...)` is `it.fails`, so the full suite stays green while
 * the defect is there, and the test turns red (vitest: "Expect test to fail")
 * as soon as a fix makes it pass. The fix round then changes `defect` to `it`.
 * Run `SAME_ID_DEFECTS=red pnpm vitest run same-id` to see the failures as
 * plain tests. Each describe names its implementation round (R1, R2).
 *
 * The stand-in answers `tmux list-panes` as tmux 3.4 does (measured on a
 * private server, design file Q1): a plain target is tried as an exact name,
 * then as the start of one name; `=name:` matches exactly; the server comes
 * from `-S`, then `-L`, then TMUX, then `$TMUX_TMPDIR/tmux-<uid>/default`.
 * `ps -eo pid,tty,args` lists the processes of the stand-in panes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as childProcess from "node:child_process";
import type { RuntimeHandle } from "@aoagents/ao-core";

vi.mock("node:child_process", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("node:child_process")>();
  const mockExecFile = vi.fn();
  (mockExecFile as unknown as Record<symbol, unknown>)[Symbol.for("nodejs.util.promisify.custom")] =
    vi.fn();
  // No real binary runs: a version probe or a `detect` call fails the test.
  const execFileSync = (cmd: string): never => {
    throw new Error(`unexpected execFileSync: ${cmd}`);
  };
  return { ...actual, execFile: mockExecFile, execFileSync };
});

import { create, resetPsCache } from "../index.js";

const execFileAsync = (
  childProcess.execFile as unknown as Record<symbol, ReturnType<typeof vi.fn>>
)[Symbol.for("nodejs.util.promisify.custom")];

const RED = process.env["SAME_ID_DEFECTS"] === "red";
function defect(name: string, fn: () => Promise<void>): void {
  (RED ? it : it.fails)(name, fn);
}

const AGENT_ARGS = "claude --dangerously-skip-permissions";
const UID = process.getuid?.() ?? 0;
/** socket path -> session name -> pane tty */
const servers = new Map<string, Map<string, string>>();
/** pane tty (without /dev/) -> process args */
const processes = new Map<string, string>();
let psFails = false;

function resolveSocket(args: string[], env: NodeJS.ProcessEnv): { path: string; rest: string[] } {
  let socket: string | undefined;
  let label: string | undefined;
  let i = 0;
  while (args[i] === "-S" || args[i] === "-L") {
    if (args[i] === "-S") socket = args[i + 1];
    else label = args[i + 1];
    i += 2;
  }
  const dir = `${env["TMUX_TMPDIR"] || "/tmp"}/tmux-${UID}`;
  const tmuxVar = env["TMUX"];
  const path = socket ?? (label ? `${dir}/${label}` : tmuxVar ? tmuxVar.split(",")[0]! : `${dir}/default`);
  return { path, rest: args.slice(i) };
}

function failure(command: string, stderr: string): Error {
  return Object.assign(new Error(`Command failed: ${command}\n${stderr}`), {
    code: 1,
    killed: false,
    signal: null,
    stdout: "",
    stderr: `${stderr}\n`,
  });
}

function listPanes(args: string[], env: NodeJS.ProcessEnv): string {
  const { path, rest } = resolveSocket(args, env);
  const sessions = servers.get(path);
  if (!sessions) throw failure(`tmux ${rest.join(" ")}`, `no server running on ${path}`);
  if (rest[0] !== "list-panes") throw new Error(`tmux stand-in: unsupported ${rest.join(" ")}`);
  const target = rest[rest.indexOf("-t") + 1] ?? "";
  const colon = target.indexOf(":");
  const part = colon >= 0 ? target.slice(0, colon) : target;
  let tty: string | undefined;
  if (part.startsWith("=")) {
    tty = colon >= 0 ? sessions.get(part.slice(1)) : undefined;
  } else {
    tty = sessions.get(part);
    if (tty === undefined) {
      const prefixed = [...sessions.keys()].filter((name) => name.startsWith(part));
      if (prefixed.length === 1) tty = sessions.get(prefixed[0]!);
    }
  }
  if (tty === undefined) {
    throw failure(
      `tmux ${rest.join(" ")}`,
      colon >= 0 ? `can't find session: ${part.replace(/^=/, "")}` : `can't find window: ${target}`,
    );
  }
  return `/dev/${tty}\n`;
}

function ps(): string {
  if (psFails) throw failure("ps -eo pid,tty,args", "ps: simulated failure");
  const lines = ["    PID TT       ARGS"];
  let pid = 1000;
  for (const [tty, args] of processes) lines.push(`${pid++} ${tty} ${args}`);
  return `${lines.join("\n")}\n`;
}

const savedEnv = { TMUX: process.env["TMUX"], TMUX_TMPDIR: process.env["TMUX_TMPDIR"] };

beforeEach(() => {
  vi.resetAllMocks();
  resetPsCache();
  servers.clear();
  processes.clear();
  psFails = false;
  delete process.env["TMUX"];
  delete process.env["TMUX_TMPDIR"];
  execFileAsync.mockImplementation(
    async (file: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
      if (file === "tmux") return { stdout: listPanes(args, opts?.env ?? process.env), stderr: "" };
      if (file === "ps") return { stdout: ps(), stderr: "" };
      throw new Error(`unexpected command ${file}`);
    },
  );
});

afterEach(() => {
  if (savedEnv.TMUX === undefined) delete process.env["TMUX"];
  else process.env["TMUX"] = savedEnv.TMUX;
  if (savedEnv.TMUX_TMPDIR === undefined) delete process.env["TMUX_TMPDIR"];
  else process.env["TMUX_TMPDIR"] = savedEnv.TMUX_TMPDIR;
});

function tmuxHandle(id: string, data: Record<string, unknown> = {}): RuntimeHandle {
  return { id, runtimeName: "tmux", data: { createdAt: 1_792_600_100_000, ...data } };
}

describe("[same-id R1] D-A: the claude-code pane read matches a longer session name by prefix", () => {
  it("isProcessRunning answers false for a dead name while the agent runs in a session whose name starts with it", async () => {
    servers.set(`/tmp/tmux-${UID}/default`, new Map([["kr-10", "pts/40"]]));
    processes.set("pts/40", AGENT_ARGS);
    await expect(create().isProcessRunning(tmuxHandle("kr-1"))).resolves.toBe(false);
  });
});

describe("[same-id R2] D-B: the claude-code pane read finds the tmux server only through the environment", () => {
  defect("isProcessRunning finds the agent on the server that the handle names, from another server's environment", async () => {
    // `tmuxSocket` is the R2 handle field named in the design file (Q2): the
    // socket path that runtime-tmux reads back from `#{socket_path}` at create.
    const socketA = `/fake/A/tmux-${UID}/default`;
    servers.set(socketA, new Map([["kr-1", "pts/41"]]));
    servers.set(`/fake/B/tmux-${UID}/default`, new Map([["bystander", "pts/42"]]));
    processes.set("pts/41", AGENT_ARGS);
    process.env["TMUX_TMPDIR"] = "/fake/B";
    await expect(
      create().isProcessRunning(tmuxHandle("kr-1", { tmuxSocket: socketA })),
    ).resolves.toBe(true);
  });
});

