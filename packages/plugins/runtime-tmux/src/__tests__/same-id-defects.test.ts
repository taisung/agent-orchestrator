/**
 * Defect tests of the same-ID design round (ao-48, design file
 * development/reviews/same_id_design_r1_opus.md). Each test fails on
 * ce49c9fd for the measured reason and describes the wanted behavior.
 *
 * Marking: `defect(...)` is `it.fails`, so the full suite stays green while
 * the defect is there, and the test turns red (vitest: "Expect test to fail")
 * as soon as a fix makes it pass. The fix round then changes `defect` to `it`.
 * Run `SAME_ID_DEFECTS=red pnpm vitest run same-id` to see the failures as
 * plain tests. Each describe names its implementation round (R1, R2), so
 * `-t "same-id R1"` selects one round.
 *
 * The tmux stand-in below follows tmux 3.4 as measured on a private server
 * (design file, Q1 and Q2): a session target is tried as `$N`, an exact name,
 * then the start of a name (one match only); `=name` matches exactly; a pane
 * or window target with a colon resolves its session part the same way;
 * `display-message` answers an unknown target with empty values (exit 0).
 * The server comes from `-S`, then `-L` (under TMUX_TMPDIR), then the socket
 * field of TMUX, then `$TMUX_TMPDIR/tmux-<uid>/default`. The stand-in refuses
 * `=name` without a colon as a pane or window target, because tmux 3.4 then
 * tries a window of that name in the current session first (measured). A fix
 * that uses another tmux command extends the stand-in with the same rules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as childProcess from "node:child_process";
import type * as Fs from "node:fs";
import { RUNTIME_NO_SERVER_ERROR_CODE, type RuntimeHandle } from "@aoagents/ao-core";

vi.mock("node:child_process", () => {
  const mockExecFile = vi.fn();
  (mockExecFile as any)[Symbol.for("nodejs.util.promisify.custom")] = vi.fn();
  return { execFile: mockExecFile };
});

// Temp files only; every other `node:fs` call is real (a fix may read /proc).
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof Fs>()),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { create } from "../index.js";

const execFileAsync = (childProcess.execFile as any)[
  Symbol.for("nodejs.util.promisify.custom")
] as ReturnType<typeof vi.fn>;

const RED = process.env["SAME_ID_DEFECTS"] === "red";
function defect(name: string, fn: () => Promise<void>): void {
  (RED ? it : it.fails)(name, fn);
}

// ---------------------------------------------------------------------------
// tmux 3.4 stand-in
// ---------------------------------------------------------------------------

interface FakeSession {
  name: string;
  id: string;
  created: number;
  tty: string;
  keys: string[];
  screen: string;
}

interface FakeServer {
  pid: number;
  startTime: number;
  sessions: FakeSession[];
}

const UID = process.getuid?.() ?? 0;
const servers = new Map<string, FakeServer>();
/** Socket paths whose file is gone while the server process runs (F-7). */
const hiddenSockets = new Set<string>();
let nextId = 0;
let afterNewSession: ((server: FakeServer, name: string) => void) | undefined;

function socketDir(env: NodeJS.ProcessEnv): string {
  return `${env["TMUX_TMPDIR"] || "/tmp"}/tmux-${UID}`;
}

function resolveSocket(args: string[], env: NodeJS.ProcessEnv): { path: string; rest: string[] } {
  let socket: string | undefined;
  let label: string | undefined;
  let i = 0;
  while (args[i] === "-S" || args[i] === "-L") {
    if (args[i] === "-S") socket = args[i + 1];
    else label = args[i + 1];
    i += 2;
  }
  const rest = args.slice(i);
  if (socket) return { path: socket, rest };
  if (label) return { path: `${socketDir(env)}/${label}`, rest };
  const tmuxVar = env["TMUX"];
  if (tmuxVar) return { path: tmuxVar.split(",")[0]!, rest };
  return { path: `${socketDir(env)}/default`, rest };
}

function startServer(path: string, sessionNames: string[] = [], startTime = 1_792_600_000): FakeServer {
  const server: FakeServer = { pid: 4242, startTime, sessions: [] };
  servers.set(path, server);
  for (const name of sessionNames) addSession(server, name);
  return server;
}

function addSession(server: FakeServer, name: string, created = 1_792_600_100): FakeSession {
  const n = nextId++;
  const session: FakeSession = {
    name,
    id: `$${n}`,
    created,
    tty: `/dev/pts/${n + 10}`,
    keys: [],
    screen: `screen of ${name}`,
  };
  server.sessions.push(session);
  return session;
}

function findSessionPart(server: FakeServer, part: string): FakeSession | undefined {
  if (part.startsWith("$")) return server.sessions.find((s) => s.id === part);
  if (part.startsWith("=")) return server.sessions.find((s) => s.name === part.slice(1));
  const exact = server.sessions.find((s) => s.name === part);
  if (exact) return exact;
  const prefixed = server.sessions.filter((s) => s.name.startsWith(part));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

type TargetKind = "session" | "window" | "pane";

function resolveTarget(server: FakeServer, target: string, kind: TargetKind): FakeSession | undefined {
  const colon = target.indexOf(":");
  if (colon >= 0) return findSessionPart(server, target.slice(0, colon));
  if (kind !== "session" && target.startsWith("=")) return undefined;
  return findSessionPart(server, target);
}

function notFound(target: string, kind: TargetKind): string {
  const colon = target.indexOf(":");
  if (colon >= 0 || kind === "session") {
    const part = colon >= 0 ? target.slice(0, colon) : target;
    return `can't find session: ${part.replace(/^=/, "")}`;
  }
  return kind === "window" ? `can't find window: ${target}` : `can't find pane: ${target}`;
}

function tmuxFailure(args: string[], stderr: string): Error {
  return Object.assign(new Error(`Command failed: tmux ${args.join(" ")}\n${stderr}`), {
    code: 1,
    killed: false,
    signal: null,
    stdout: "",
    stderr: `${stderr}\n`,
  });
}

function format(fmt: string, path: string, server: FakeServer, session?: FakeSession): string {
  const vars: Record<string, string> = {
    session_name: session?.name ?? "",
    session_id: session?.id ?? "",
    session_created: session ? String(session.created) : "",
    session_activity: session ? String(session.created + 5) : "",
    pane_tty: session?.tty ?? "",
    pane_id: session ? `%${session.id.slice(1)}` : "",
    pane_current_command: session ? "bash" : "",
    window_name: session ? "bash" : "",
    socket_path: path,
    pid: String(server.pid),
    start_time: String(server.startTime),
  };
  const substituted = fmt.replace(/#\{([a-z_]+)\}/g, (_m, name: string) => vars[name] ?? "");
  return substituted.replace(/#\{==:([^,{}]*),([^,{}]*)\}/g, (_m, a: string, b: string) =>
    a === b ? "1" : "0",
  );
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function runTmux(args: string[], env: NodeJS.ProcessEnv): string {
  const { path, rest } = resolveSocket(args, env);
  const [command, ...params] = rest;
  const found = servers.get(path) ?? (command === "new-session" ? startServer(path) : undefined);
  if (!found) {
    throw tmuxFailure(
      rest,
      hiddenSockets.has(path)
        ? `error connecting to ${path} (No such file or directory)`
        : `no server running on ${path}`,
    );
  }
  const server: FakeServer = found;
  const target = flagValue(params, "-t");
  const lookup = (kind: TargetKind): FakeSession => {
    const found = target === undefined ? undefined : resolveTarget(server, target, kind);
    if (!found) throw tmuxFailure(rest, notFound(target ?? "", kind));
    return found;
  };
  switch (command) {
    case "new-session": {
      const name = flagValue(params, "-s")!;
      if (server.sessions.some((s) => s.name === name)) {
        throw tmuxFailure(rest, `duplicate session: ${name}`);
      }
      addSession(server, name, Math.floor(Date.now() / 1000));
      afterNewSession?.(server, name);
      return "";
    }
    case "has-session":
      lookup("session");
      return "";
    case "kill-session": {
      const s = lookup("session");
      server.sessions = server.sessions.filter((x) => x !== s);
      return "";
    }
    case "send-keys": {
      const s = lookup("pane");
      const keys = params.filter((p, i) => p !== "-t" && params[i - 1] !== "-t" && p !== "-l");
      s.keys.push(...keys);
      return "";
    }
    case "paste-buffer": {
      const s = lookup("pane");
      s.keys.push(`[paste ${flagValue(params, "-b") ?? ""}]`);
      return "";
    }
    case "load-buffer":
    case "delete-buffer":
      return "";
    case "capture-pane":
      return lookup("pane").screen;
    case "list-panes":
      return format(flagValue(params, "-F") ?? "", path, server, lookup("window"));
    case "display-message": {
      // CANFAIL: an unknown target gives empty values, not an error.
      const s = target === undefined ? server.sessions.at(-1) : resolveTarget(server, target, "pane");
      return format(params.at(-1) ?? "", path, server, s);
    }
    case "list-sessions":
      return server.sessions
        .map((s) => format(flagValue(params, "-F") ?? "", path, server, s))
        .join("\n");
    case "if-shell": {
      // `if-shell -F [-t target] condition command [command]`: tmux evaluates
      // the condition and runs the chosen command in the same server step.
      const positional = params.filter(
        (p, i) => p !== "-F" && p !== "-t" && params[i - 1] !== "-t",
      );
      const [condition = "", then = "", otherwise] = positional;
      const s = target === undefined ? undefined : resolveTarget(server, target, "pane");
      const value = format(condition, path, server, s);
      const chosen = value !== "" && value !== "0" ? then : otherwise;
      if (!chosen) return "";
      return runTmux(["-S", path, ...chosen.split(" ").filter(Boolean)], env);
    }
    default:
      throw new Error(`tmux stand-in: unsupported command ${rest.join(" ")}`);
  }
}

function serverAt(path: string): FakeServer {
  const server = servers.get(path);
  if (!server) throw new Error(`no stand-in server at ${path}`);
  return server;
}

function names(path: string): string[] {
  return serverAt(path).sessions.map((s) => s.name);
}

function sessionAt(path: string, name: string): FakeSession {
  const s = serverAt(path).sessions.find((x) => x.name === name);
  if (!s) throw new Error(`no stand-in session ${name} at ${path}`);
  return s;
}

function tmuxHandle(id: string, data: Record<string, unknown> = {}): RuntimeHandle {
  return { id, runtimeName: "tmux", data: { createdAt: 1_792_600_100_000, ...data } };
}

const savedEnv = { TMUX: process.env["TMUX"], TMUX_TMPDIR: process.env["TMUX_TMPDIR"] };

beforeEach(() => {
  vi.resetAllMocks();
  servers.clear();
  hiddenSockets.clear();
  nextId = 0;
  afterNewSession = undefined;
  delete process.env["TMUX"];
  delete process.env["TMUX_TMPDIR"];
  execFileAsync.mockImplementation(
    async (file: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
      if (file !== "tmux") throw new Error(`unexpected command ${file}`);
      return { stdout: `${runTmux(args, opts?.env ?? process.env)}\n`, stderr: "" };
    },
  );
});

afterEach(() => {
  if (savedEnv.TMUX === undefined) delete process.env["TMUX"];
  else process.env["TMUX"] = savedEnv.TMUX;
  if (savedEnv.TMUX_TMPDIR === undefined) delete process.env["TMUX_TMPDIR"];
  else process.env["TMUX_TMPDIR"] = savedEnv.TMUX_TMPDIR;
});

const DEFAULT_SOCKET = `/tmp/tmux-${UID}/default`;

// ---------------------------------------------------------------------------
// R1: exact targets (D-A)
// ---------------------------------------------------------------------------

describe("[same-id R1] D-A: a plain tmux target matches a longer session name by prefix", () => {
  beforeEach(() => {
    // Only kr-10 lives; the session kr-1 of a record is dead.
    startServer(DEFAULT_SOCKET, ["kr-10"]);
  });

  it("isAlive answers false for a dead name while one live name starts with it", async () => {
    await expect(create().isAlive(tmuxHandle("kr-1"))).resolves.toBe(false);
  });

  it("destroy of a dead name does not end the live session whose name starts with it", async () => {
    await create().destroy(tmuxHandle("kr-1"));
    expect(names(DEFAULT_SOCKET)).toEqual(["kr-10"]);
  });

  it("sendMessage to a dead name types nothing into another session", async () => {
    await create()
      .sendMessage(tmuxHandle("kr-1"), "hello")
      .catch(() => undefined);
    expect(sessionAt(DEFAULT_SOCKET, "kr-10").keys).toEqual([]);
  });

  it("getOutput of a dead name does not read another session's screen", async () => {
    await expect(create().getOutput(tmuxHandle("kr-1"))).resolves.not.toContain("screen of kr-10");
  });

  it("the attach target of a dead name resolves to no session", async () => {
    const info = await create().getAttachInfo!(tmuxHandle("kr-1"));
    expect(resolveTarget(serverAt(DEFAULT_SOCKET), info.target, "session")).toBeUndefined();
  });

  it("create: the launch keys never reach another session when the new session ends first", async () => {
    // The new pane's shell exits at once, before the launch keys arrive.
    afterNewSession = (server, name) => {
      if (name === "kr-1") server.sessions = server.sessions.filter((s) => s.name !== name);
    };
    await create()
      .create({ sessionId: "kr-1", workspacePath: "/ws", launchCommand: "claude", environment: {} })
      .catch(() => undefined);
    expect(sessionAt(DEFAULT_SOCKET, "kr-10").keys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R2: server and launch identity (D-B, F-5 for tmux, F-7)
// ---------------------------------------------------------------------------

describe("[same-id R2] D-B: a call finds the tmux server only through its environment", () => {
  const SOCKET_A = `/fake/A/tmux-${UID}/default`;
  const SOCKET_B = `/fake/B/tmux-${UID}/default`;

  async function createOnA(name: string): Promise<RuntimeHandle> {
    process.env["TMUX_TMPDIR"] = "/fake/A";
    return create().create({
      sessionId: name,
      workspacePath: "/ws",
      launchCommand: "claude",
      environment: {},
    });
  }

  defect("isAlive answers true for a live session when the caller's environment names another server", async () => {
    const handle = await createOnA("kr-1");
    startServer(SOCKET_B, ["bystander"]);
    process.env["TMUX_TMPDIR"] = "/fake/B";
    // Measured with ao: `ao session cleanup` then archived the live session
    // and removed its worktree (design file, D-B case 2).
    await expect(create().isAlive(handle)).resolves.toBe(true);
  });

  defect("destroy from another server's environment does not end that server's session of the same name", async () => {
    const handle = await createOnA("kr-1");
    // A second pane of the same name on server B (measured: `ao send` from
    // B's environment relaunched kr-1 there, design file D-B case 3).
    startServer(SOCKET_B, ["kr-1"]);
    process.env["TMUX_TMPDIR"] = "/fake/B";
    await create().destroy(handle);
    expect(names(SOCKET_B)).toEqual(["kr-1"]);
    expect(names(SOCKET_A)).toEqual([]);
  });
});

describe("[same-id R2] F-5: destroy by name ends another launch of the same name", () => {
  defect("destroy keeps a newer session of the same name that another launch created", async () => {
    // The handle's launch started at createdAt; the live session of that
    // name was created 60 s later by another launch of the ID (a restore
    // after a kill). The core check passed before the command; the command
    // itself must not end the newer session.
    const server = startServer(DEFAULT_SOCKET);
    addSession(server, "kr-1", 1_792_600_160);
    await create().destroy(tmuxHandle("kr-1", { createdAt: 1_792_600_100_000 }));
    expect(names(DEFAULT_SOCKET)).toEqual(["kr-1"]);
  });
});

describe("[same-id R2] F-7: a hidden socket of a running server reads as no server", () => {
  defect("isAlive does not report 'no server' while the recorded server process still runs", async () => {
    process.env["TMUX_TMPDIR"] = "/fake/A";
    const socket = `/fake/A/tmux-${UID}/default`;
    // The recorded server process is this test process: it runs, and it
    // started at this start time (seconds, as tmux reports #{start_time}).
    const server = startServer(socket, [], Math.round(Date.now() / 1000 - process.uptime()));
    server.pid = process.pid;
    const handle = await create().create({
      sessionId: "kr-1",
      workspacePath: "/ws",
      launchCommand: "claude",
      environment: {},
    });
    // A tmp cleaner removes the socket file; the server and its panes run on.
    servers.delete(socket);
    hiddenSockets.add(socket);
    const answer = await create()
      .isAlive(handle)
      .then(
        (alive) => ({ alive }),
        (err: unknown) => ({ code: (err as { code?: unknown }).code }),
      );
    // Today the rejection has the no-server code, and the lifecycle persists
    // killed after 5 minutes of such answers (lifecycle-manager.ts:1574).
    expect(answer).not.toEqual({ code: RUNTIME_NO_SERVER_ERROR_CODE });
    expect(answer).not.toEqual({ alive: false });
  });
});
