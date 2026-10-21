/**
 * Defect tests of the same-ID design revision r2 (ao-52, design file
 * development/reviews/same_id_design_r2_opus.md), for the counterexamples of
 * review r1 (development/reviews/same_id_design_review_r1_astra6.md) that a
 * unit test can show: B-1 (two launches of an ID in the same second, also on
 * a restarted server at the same path), B-2 (a replacement between the create
 * and its launch keys) and B-5 (another server answers at the recorded socket
 * path). Each `defect` test fails on c516cead for the measured reason; the
 * `it` tests are controls that pass on c516cead and must stay green, so that
 * a fix that always rejects, never destroys or never answers false fails.
 *
 * Marking as in design r1 section 8.1: `defect(...)` is `it.fails`, and
 * `SAME_ID_DEFECTS=red` makes it a plain test. Each describe names its round.
 *
 * The tmux stand-in follows tmux 3.4 as measured on private servers (design
 * r2, measurements m1 to m5):
 * - session IDs count per server from $0, so a restarted server repeats them;
 * - `#{session_created}` and `#{start_time}` are whole seconds of a clock that
 *   the test holds still, so two launches can share both;
 * - one client command can hold several commands, separated by a `;`
 *   argument; they run in order with no other client between them, and the
 *   first failing command ends the list (its output so far is kept);
 * - `display-message` answers an unknown target with empty session fields but
 *   with the server fields (`#{pid}`, `#{socket_path}`) of the server that
 *   answers;
 * - an inner command of `if-shell` that holds `#{` or `$` is a syntax error;
 *   a format operator that tmux does not know expands to its own text;
 * - every server runs as a real process (a `sleep` child of this test), so a
 *   fix can read `/proc/<#{pid}>/stat`; a server that "dies" ends that child.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as childProcess from "node:child_process";
import type * as Fs from "node:fs";
import { RUNTIME_NO_SERVER_ERROR_CODE, type RuntimeHandle } from "@aoagents/ao-core";

const real = vi.hoisted(() => ({
  spawn: null as null | typeof childProcess.spawn,
  files: new Map<string, string>(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  real.spawn = actual.spawn;
  const mockExecFile = vi.fn();
  (mockExecFile as any)[Symbol.for("nodejs.util.promisify.custom")] = vi.fn();
  const refuseTmux =
    (name: string, fn: (...args: any[]) => unknown) =>
    (file: string, ...rest: any[]) => {
      if (String(file).endsWith("tmux")) throw new Error(`tmux stand-in: ${name} is not modelled`);
      return fn(file, ...rest);
    };
  return {
    ...actual,
    execFile: mockExecFile,
    execFileSync: refuseTmux("execFileSync", actual.execFileSync),
    spawn: refuseTmux("spawn", actual.spawn),
    spawnSync: refuseTmux("spawnSync", actual.spawnSync),
  };
});

// Temp files are kept in memory (a launch script, a message for load-buffer);
// every other `node:fs` call is real, so a fix can read /proc.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof Fs>()),
  writeFileSync: vi.fn((path: string, data: string) => {
    real.files.set(String(path), String(data));
  }),
  unlinkSync: vi.fn((path: string) => {
    real.files.delete(String(path));
  }),
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
  options: Map<string, string>;
  keys: string[];
}

interface FakeServer {
  pid: number;
  startTime: number;
  nextId: number;
  sessions: FakeSession[];
  buffers: Map<string, string>;
}

const UID = process.getuid?.() ?? 0;
const SOCKET = `/fake/A/tmux-${UID}/default`;
/** The servers that answer at a socket path. */
const servers = new Map<string, FakeServer>();
/** The "server processes": one sleeping child per server incarnation. */
const children: childProcess.ChildProcess[] = [];
/** The clock of the stand-in in whole seconds; the tests hold it still. */
let clock = 1_792_600_000;
/** Runs after a client command that made a session (the next client may act then). */
let afterCreateCommand: ((server: FakeServer, name: string) => Promise<void>) | undefined;

function startProcess(): number {
  const child = real.spawn!("/bin/sleep", ["300"], { stdio: "ignore" });
  children.push(child);
  if (!child.pid) throw new Error("stand-in: no sleep process");
  return child.pid;
}

async function endProcess(pid: number): Promise<void> {
  const child = children.find((c) => c.pid === pid);
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
}

function startServer(path: string): FakeServer {
  const server: FakeServer = {
    pid: startProcess(),
    startTime: clock,
    nextId: 0,
    sessions: [],
    buffers: new Map(),
  };
  servers.set(path, server);
  return server;
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
  const dir = `${env["TMUX_TMPDIR"] || "/tmp"}/tmux-${UID}`;
  const rest = args.slice(i);
  if (socket) return { path: socket, rest };
  if (label) return { path: `${dir}/${label}`, rest };
  const tmuxVar = env["TMUX"];
  if (tmuxVar) return { path: tmuxVar.split(",")[0]!, rest };
  return { path: `${dir}/default`, rest };
}

function failure(stderr: string, stdout = ""): Error {
  return Object.assign(new Error(`Command failed: tmux\n${stderr}`), {
    code: 1,
    killed: false,
    signal: null,
    stdout,
    stderr: `${stderr}\n`,
  });
}

function findSession(server: FakeServer, target: string): FakeSession | undefined {
  const part = target.split(":")[0]!;
  if (part.startsWith("$")) return server.sessions.find((s) => s.id === part);
  if (part.startsWith("=")) return server.sessions.find((s) => s.name === part.slice(1));
  const exact = server.sessions.find((s) => s.name === part);
  if (exact) return exact;
  const prefixed = server.sessions.filter((s) => s.name.startsWith(part));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

function expand(fmt: string, path: string, server: FakeServer, session?: FakeSession): string {
  const vars: Record<string, string> = {
    session_name: session?.name ?? "",
    session_id: session?.id ?? "",
    session_created: session ? String(session.created) : "",
    pane_tty: session ? `/dev/pts/${session.id.slice(1)}` : "",
    pane_current_command: session ? "bash" : "",
    socket_path: path,
    pid: String(server.pid),
    start_time: String(server.startTime),
    version: "3.4",
  };
  let out = fmt;
  // Innermost first: a plain variable or option, then an operator over plain text.
  for (let guard = 0; guard < 50 && out.includes("#{"); guard++) {
    const next = out.replace(/#\{([^{}]*)\}/g, (_m, body: string) => {
      if (body.startsWith("@")) return session?.options.get(body) ?? "";
      const op = /^([^:]*):(.*)$/s.exec(body);
      if (!op) return vars[body] ?? "";
      const [, name, operands] = op;
      const [a = "", b = ""] = operands!.split(",");
      if (name === "==") return a === b ? "1" : "0";
      if (name === "!=") return a !== b ? "1" : "0";
      return body; // an operator that tmux does not know expands to its own text (m2)
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Split an inner command of `if-shell` the way tmux 3.4 parses it (no formats, no `$`). */
function innerCommands(text: string): string[][] {
  if (text.includes("#{") || text.includes("$")) throw failure("syntax error");
  return text
    .split(/\s+;\s+/)
    .map((cmd) =>
      (cmd.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^['"]|['"]$/g, "")),
    );
}

interface Out {
  lines: string[];
}

function runOne(
  command: string[],
  path: string,
  server: FakeServer,
  out: Out,
  made: string[],
): void {
  const [name, ...params] = command;
  const target = flag(params, "-t");
  const lookup = (): FakeSession => {
    const found = target === undefined ? undefined : findSession(server, target);
    if (!found)
      throw failure(`can't find session: ${(target ?? "").split(":")[0]!.replace(/^=/, "")}`);
    return found;
  };
  switch (name) {
    case "new-session": {
      const sessionName = flag(params, "-s") ?? String(server.nextId);
      if (server.sessions.some((s) => s.name === sessionName)) {
        throw failure(`duplicate session: ${sessionName}`);
      }
      const session: FakeSession = {
        name: sessionName,
        id: `$${server.nextId++}`,
        created: clock,
        options: new Map(),
        keys: [],
      };
      server.sessions.push(session);
      made.push(sessionName);
      if (params.includes("-P")) {
        out.lines.push(expand(flag(params, "-F") ?? "#{session_name}:", path, server, session));
      }
      return;
    }
    case "has-session":
      lookup();
      return;
    case "kill-session": {
      const s = lookup();
      server.sessions = server.sessions.filter((x) => x !== s);
      return;
    }
    case "kill-server":
      servers.delete(path);
      return;
    case "set-option": {
      const positional = params.filter((p, i) => !p.startsWith("-") && params[i - 1] !== "-t");
      const [option = "", value = ""] = positional;
      if (target === undefined || !option.startsWith("@")) return;
      lookup().options.set(option, value);
      return;
    }
    case "send-keys": {
      const s = lookup();
      s.keys.push(...params.filter((p, i) => !p.startsWith("-") && params[i - 1] !== "-t"));
      return;
    }
    case "load-buffer": {
      const buffer = flag(params, "-b") ?? "buffer0";
      const file = params.at(-1) ?? "";
      server.buffers.set(buffer, real.files.get(file) ?? "");
      return;
    }
    case "paste-buffer": {
      const s = lookup();
      const buffer = flag(params, "-b") ?? "buffer0";
      s.keys.push(`[paste ${server.buffers.get(buffer) ?? ""}]`);
      if (params.includes("-d")) server.buffers.delete(buffer);
      return;
    }
    case "delete-buffer":
      server.buffers.delete(flag(params, "-b") ?? "buffer0");
      return;
    case "capture-pane":
      out.lines.push(`screen of ${lookup().name}`);
      return;
    case "list-panes":
      out.lines.push(expand(flag(params, "-F") ?? "", path, server, lookup()));
      return;
    case "display-message": {
      // CANFAIL: an unknown target gives empty session fields, exit 0.
      const s = target === undefined ? server.sessions.at(-1) : findSession(server, target);
      out.lines.push(expand(params.at(-1) ?? "", path, server, s));
      return;
    }
    case "list-sessions":
      for (const s of server.sessions)
        out.lines.push(expand(flag(params, "-F") ?? "", path, server, s));
      return;
    case "if-shell": {
      const positional = params.filter((p, i) => !p.startsWith("-") && params[i - 1] !== "-t");
      const [condition = "", then = "", otherwise] = positional;
      const s = target === undefined ? undefined : findSession(server, target);
      const value = expand(condition, path, server, s);
      const chosen = value !== "" && value !== "0" ? then : otherwise;
      if (!chosen) return;
      // A failure inside the inner commands does not end the outer list (m3).
      try {
        for (const inner of innerCommands(chosen)) runOne(inner, path, server, out, made);
      } catch (err) {
        out.lines.push(String((err as { stderr?: string }).stderr ?? "").trim());
      }
      return;
    }
    default:
      throw new Error(`tmux stand-in: unsupported command ${command.join(" ")}`);
  }
}

async function runTmux(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  if (args[0] === "-V") return "tmux 3.4";
  const { path, rest } = resolveSocket(args, env);
  const commands: string[][] = [[]];
  for (const arg of rest) {
    if (arg === ";") commands.push([]);
    else commands.at(-1)!.push(arg);
  }
  let server = servers.get(path);
  if (!server) {
    if (commands[0]![0] !== "new-session") throw failure(`no server running on ${path}`);
    server = startServer(path);
  }
  const out: Out = { lines: [] };
  const made: string[] = [];
  try {
    for (const command of commands) runOne(command, path, server, out, made);
  } catch (err) {
    const e = err as { stderr?: string };
    if (e.stderr === undefined) throw err;
    throw Object.assign(err as Error, { stdout: out.lines.join("\n") });
  }
  if (made.length > 0 && afterCreateCommand) {
    const hook = afterCreateCommand;
    afterCreateCommand = undefined;
    await hook(server, made[0]!);
  }
  return out.lines.join("\n");
}

function serverAt(path: string): FakeServer {
  const server = servers.get(path);
  if (!server) throw new Error(`no stand-in server at ${path}`);
  return server;
}

function sessionOf(path: string, name: string): FakeSession | undefined {
  return servers.get(path)?.sessions.find((s) => s.name === name);
}

async function launch(sessionId: string, launchCommand = "first-agent"): Promise<RuntimeHandle> {
  return create().create({ sessionId, workspacePath: "/ws", launchCommand, environment: {} });
}

async function answerOf(p: Promise<boolean>): Promise<{ alive: boolean } | { code: unknown }> {
  return p.then(
    (alive) => ({ alive }),
    (err: unknown) => ({ code: (err as { code?: unknown }).code ?? "rejected" }),
  );
}

const savedEnv = { TMUX: process.env["TMUX"], TMUX_TMPDIR: process.env["TMUX_TMPDIR"] };

beforeEach(() => {
  vi.clearAllMocks();
  servers.clear();
  real.files.clear();
  clock = 1_792_600_000;
  afterCreateCommand = undefined;
  delete process.env["TMUX"];
  // Every call of the plugin finds server A through its environment.
  process.env["TMUX_TMPDIR"] = "/fake/A";
  execFileAsync.mockImplementation(
    async (file: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
      if (file !== "tmux") throw new Error(`unexpected command ${file}`);
      return { stdout: `${await runTmux(args, opts?.env ?? process.env)}\n`, stderr: "" };
    },
  );
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  if (savedEnv.TMUX === undefined) delete process.env["TMUX"];
  else process.env["TMUX"] = savedEnv.TMUX;
  if (savedEnv.TMUX_TMPDIR === undefined) delete process.env["TMUX_TMPDIR"];
  else process.env["TMUX_TMPDIR"] = savedEnv.TMUX_TMPDIR;
});

// ---------------------------------------------------------------------------
// B-1: an identity that two launches in the same second cannot share
// ---------------------------------------------------------------------------

describe("[same-id R2] B-1: two launches of an ID in the same second", () => {
  /** The first launch of kr-1 ends; a second launch of kr-1 starts in the same second. */
  async function sameSecondReplacement(): Promise<{ first: RuntimeHandle; second: RuntimeHandle }> {
    const first = await launch("kr-1");
    const server = serverAt(SOCKET);
    server.sessions = server.sessions.filter((s) => s.name !== first.id);
    const second = await launch("kr-1", "second-agent");
    return { first, second };
  }

  /** The server of the first launch ends; a new server starts at the same path in the same second. */
  async function sameSecondRestart(): Promise<{ first: RuntimeHandle; second: RuntimeHandle }> {
    const first = await launch("kr-1");
    const old = serverAt(SOCKET);
    servers.delete(SOCKET);
    await endProcess(old.pid);
    const second = await launch("kr-1", "second-agent");
    // Measured (m4 section 5, review probe.log): $0 and both timestamps repeat.
    expect(serverAt(SOCKET).sessions[0]!.id).toBe("$0");
    expect(serverAt(SOCKET).startTime).toBe(old.startTime);
    return { first, second };
  }

  defect(
    "destroy of the first launch keeps a replacement of the ID that started in the same second",
    async () => {
      const { first, second } = await sameSecondReplacement();
      // Measured on c516cead: destroy by name ends the replacement. The
      // timestamp guard of design r1 ends it too (review B-1, m1 section 3).
      await create().destroy(first);
      expect(sessionOf(SOCKET, second.id), "the replacement was ended").toBeDefined();
    },
  );

  defect(
    "isAlive of the first launch answers false while a same-second replacement of the ID runs",
    async () => {
      const { first } = await sameSecondReplacement();
      await expect(answerOf(create().isAlive(first))).resolves.toEqual({ alive: false });
    },
  );

  defect(
    "after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID",
    async () => {
      const { first, second } = await sameSecondRestart();
      await create().destroy(first);
      expect(sessionOf(SOCKET, second.id), "the new server's session was ended").toBeDefined();
    },
  );

  defect(
    "after a same-second restart of the server, isAlive of the old launch answers false",
    async () => {
      // Session ID, session_created and start_time all repeat: only the server
      // process (its PID and start ticks) or a per-launch value differs.
      const { first } = await sameSecondRestart();
      await expect(answerOf(create().isAlive(first))).resolves.toEqual({ alive: false });
    },
  );

  it("control: destroy ends its own launch", async () => {
    const { second } = await sameSecondReplacement();
    await create().destroy(second);
    expect(sessionOf(SOCKET, second.id)).toBeUndefined();
  });

  it("control: isAlive of a live launch answers true", async () => {
    const { second } = await sameSecondReplacement();
    await expect(answerOf(create().isAlive(second))).resolves.toEqual({ alive: true });
  });
});

// ---------------------------------------------------------------------------
// B-2: the identity comes from the create command itself
// ---------------------------------------------------------------------------

describe("[same-id R2] B-2: a replacement between the create and its launch keys", () => {
  defect(
    "create: a replacement of the ID made directly after the create command never receives the first launch's keys",
    async () => {
      let replacement: RuntimeHandle | undefined;
      afterCreateCommand = async (server, name) => {
        // The new pane's shell ends at once; another launch of kr-1 then
        // creates its session and sends its own launch keys (review B-2:
        // a separate read-back returned the replacement's ID).
        server.sessions = server.sessions.filter((s) => s.name !== name);
        replacement = await launch("kr-1", "second-agent");
      };
      const handle = await launch("kr-1").catch(() => undefined);
      expect(replacement).toBeDefined();
      const keys = sessionOf(SOCKET, replacement!.id)?.keys.join(" ") ?? "";
      expect(keys, "the first launch's keys reached the replacement").not.toContain("first-agent");
      if (handle) {
        // A handle that create returns names its own launch, never the replacement.
        await expect(answerOf(create().isAlive(handle))).resolves.toEqual({ alive: false });
      }
    },
  );

  it("control: create on a healthy server sends the launch command into its own session", async () => {
    const handle = await launch("kr-1");
    expect(sessionOf(SOCKET, handle.id)?.keys.join(" ")).toContain("first-agent");
  });
});

// ---------------------------------------------------------------------------
// B-5: another server answers at the recorded socket path
// ---------------------------------------------------------------------------

describe("[same-id R2] B-5: another server answers at the recorded socket path", () => {
  /** The socket file of server A goes; server B starts at the same path. A runs on (m5). */
  function reboundSocket(): FakeServer {
    const original = serverAt(SOCKET);
    servers.delete(SOCKET);
    const other = startServer(SOCKET);
    other.sessions.push({ name: "other", id: "$0", created: clock, options: new Map(), keys: [] });
    other.nextId = 1;
    return original;
  }

  defect(
    "isAlive rejects while another server answers at the recorded socket and the recorded server process still runs",
    async () => {
      const handle = await launch("kr-1");
      reboundSocket();
      // Measured (m5): the new server answers "can't find session" and empty
      // session fields; the recorded server and its pane still run. Design r1
      // read this as dead; cleanup then removes a live worktree.
      const answer = await answerOf(create().isAlive(handle));
      expect(answer).not.toEqual({ alive: false });
      expect(answer).not.toEqual({ alive: true });
      expect(answer).not.toEqual({ code: RUNTIME_NO_SERVER_ERROR_CODE });
    },
  );

  defect(
    "isAlive answers false when no server answers at the recorded socket and the recorded server process has ended",
    async () => {
      // An ordinary dead server: the recorded process is gone, so its sessions
      // are gone. c516cead answers "no server" (unknown for 5 minutes in the
      // lifecycle); a fix must not make every gone server unknown for ever.
      const handle = await launch("kr-1");
      const original = serverAt(SOCKET);
      servers.delete(SOCKET);
      await endProcess(original.pid);
      await expect(answerOf(create().isAlive(handle))).resolves.toEqual({ alive: false });
    },
  );

  it("control: isAlive answers false when another server answers and the recorded server process has ended", async () => {
    const handle = await launch("kr-1");
    const original = reboundSocket();
    await endProcess(original.pid);
    await expect(answerOf(create().isAlive(handle))).resolves.toEqual({ alive: false });
  });

  it("control: isAlive answers false when the recorded server answers that the session is gone", async () => {
    const handle = await launch("kr-1");
    const server = serverAt(SOCKET);
    server.sessions = server.sessions.filter((s) => s.name !== handle.id);
    await expect(answerOf(create().isAlive(handle))).resolves.toEqual({ alive: false });
  });

  it("control: isAlive answers true for a live launch on the recorded server", async () => {
    const handle = await launch("kr-1");
    await expect(answerOf(create().isAlive(handle))).resolves.toEqual({ alive: true });
  });
});
