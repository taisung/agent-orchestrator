/**
 * Review r2 M-1 (2026-10-22): the caller of `ao stop` copies ALL the output
 * of the detached stop, also to a slow reader, before it ends. Real
 * processes: the real `registerStop` and `startDetachedStop`, a real child
 * that writes 4 MiB to each log, and real reader processes on real pipes
 * that read slowly. The mock of `process.exit` destroys both pipes, as a
 * real exit drops the writes that are still queued.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Socket } from "node:net";
import { getProjectBaseDir, type OrchestratorConfig } from "@aoagents/ao-core";

const { mockConfigRef } = vi.hoisted(() => ({
  mockConfigRef: { current: null as unknown },
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@aoagents/ao-core")>();
  return {
    ...actual,
    loadConfig: (path?: string) => (path ? actual.loadConfig(path) : mockConfigRef.current),
  };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async () => ({
    get: async (id: string) => ({
      id,
      status: "working",
      runtimeHandle: { id: "hash-app-orchestrator", runtimeName: "tmux", data: {} },
    }),
  }),
  getPluginRegistry: async () => null,
}));

vi.mock("../../src/lib/shell.js", () => ({
  tmux: vi.fn(),
  exec: vi.fn(),
  execSilent: vi.fn().mockResolvedValue(null),
  git: vi.fn(),
  gh: vi.fn(),
  getTmuxSessions: vi.fn().mockResolvedValue([]),
  getTmuxActivity: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/lib/prompts.js", () => ({ promptSelect: vi.fn(), promptConfirm: vi.fn() }));

import { Command } from "commander";
import { registerStop } from "../../src/commands/start.js";

/** Bytes of payload that the child writes to each of its logs. */
const PAYLOAD = 4 * 1024 * 1024;
/** One chunk of the relay. */
const CHUNK = 64 * 1024;

/** The detached stop: `ao stop` started with argv[1] = this script. */
const CHILD = `
import { writeSync } from "node:fs";
const size = Number(process.env.AO_RELAY_TEST_BYTES);
writeSync(1, "BEGIN" + "x".repeat(size) + "END\\n");
writeSync(2, "ERROR-BEGIN" + "y".repeat(size) + "ERROR-END\\n");
const mode = process.env.AO_RELAY_TEST_MODE;
if (mode === "signal") process.kill(process.pid, "SIGTERM");
else process.exitCode = Number(mode);
`;

/** Reads stdin in 16 KiB steps with a 1 ms pause, then prints the byte count and the tail. */
const SLOW_READER = `
const fs = require("node:fs");
const buf = Buffer.alloc(16384);
let total = 0;
let tail = "";
const step = () => {
  let n;
  try {
    n = fs.readSync(0, buf, 0, buf.length, null);
  } catch (err) {
    if (err.code === "EAGAIN") return setTimeout(step, 1);
    throw err;
  }
  if (n === 0) return process.stdout.write(JSON.stringify({ total, tail }));
  total += n;
  tail = (tail + buf.toString("latin1", 0, n)).slice(-200);
  setTimeout(step, 1);
};
step();
`;

/** Reads 4 KiB, then closes its stdin (the writer gets EPIPE). */
const EARLY_CLOSE_READER = `
const fs = require("node:fs");
const n = fs.readSync(0, Buffer.alloc(4096), 0, 4096, null);
fs.closeSync(0);
process.stdout.write(JSON.stringify({ total: n, tail: "" }));
`;

interface Reader {
  pipe: Socket;
  result: Promise<{ total: number; tail: string }>;
  /** The largest number of bytes queued in the pipe stream after a write. */
  maxQueued(): number;
}

const readers: ChildProcess[] = [];

function startReader(script: string): Reader {
  const proc = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "inherit"] });
  readers.push(proc);
  const pipe = proc.stdin as Socket;
  pipe.on("error", () => {}); // EPIPE in the early-close case
  let output = "";
  proc.stdout?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  const result = new Promise<{ total: number; tail: string }>((resolve) => {
    proc.on("close", () => resolve(JSON.parse(output || '{"total":-1,"tail":""}')));
  });
  let maxQueued = 0;
  const write = pipe.write.bind(pipe) as (...args: unknown[]) => boolean;
  pipe.write = ((...args: unknown[]) => {
    const taken = write(...args);
    maxQueued = Math.max(maxQueued, pipe.writableLength);
    return taken;
  }) as typeof pipe.write;
  return { pipe, result, maxQueued: () => maxQueued };
}

let tmpDir: string;
let config: OrchestratorConfig;
let baseDir: string;
let savedArgv1: string | undefined;
let exitCodes: number[];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ao-stop-relay-test-"));
  const configPath = join(tmpDir, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const projectPath = join(tmpDir, "my-app");
  mkdirSync(projectPath, { recursive: true });
  config = {
    configPath,
    defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
  } as unknown as OrchestratorConfig;
  mockConfigRef.current = config;
  baseDir = getProjectBaseDir(configPath, projectPath);

  // resolveAoLaunch starts `process.execPath <argv[1]> stop ...`: argv[1] is the child.
  const child = join(tmpDir, "child.mjs");
  writeFileSync(child, CHILD);
  savedArgv1 = process.argv[1];
  process.argv[1] = child;
  process.env["AO_RELAY_TEST_BYTES"] = String(PAYLOAD);
  process.exitCode = undefined;
  exitCodes = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedArgv1 !== undefined) process.argv[1] = savedArgv1;
  Reflect.deleteProperty(process.env, "AO_RELAY_TEST_BYTES");
  Reflect.deleteProperty(process.env, "AO_RELAY_TEST_MODE");
  process.exitCode = undefined;
  for (const reader of readers.splice(0)) {
    if (reader.exitCode === null && reader.signalCode === null) reader.kill("SIGKILL");
  }
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Runs `ao stop my-app` with stdout and stderr on the pipes of `out` and
 * `err`. When the command returns, the pipes end (Node ends the process
 * after its writes); `process.exit` destroys them first.
 */
async function runStop(mode: string, out: Reader, err: Reader): Promise<number | undefined> {
  process.env["AO_RELAY_TEST_MODE"] = mode;
  vi.spyOn(process, "stdout", "get").mockReturnValue(out.pipe as unknown as NodeJS.WriteStream);
  vi.spyOn(process, "stderr", "get").mockReturnValue(err.pipe as unknown as NodeJS.WriteStream);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    exitCodes.push(Number(code));
    out.pipe.destroy();
    err.pipe.destroy();
    throw new Error(`process.exit(${code})`);
  });
  const program = new Command();
  program.exitOverride();
  registerStop(program);
  await program.parseAsync(["node", "test", "stop", "my-app"]).catch(() => {});
  out.pipe.end();
  err.pipe.end();
  const code = exitCodes[0] ?? process.exitCode;
  return code === undefined ? undefined : Number(code);
}

/** The two logs of the one detached stop of the test. */
function stopLogs(): { stdout: string; stderr: string } {
  const names = readdirSync(baseDir).filter((name) => name.startsWith("orchestrator-stop-"));
  const stdout = names.find((name) => name.endsWith(".stdout.log"));
  const stderr = names.find((name) => name.endsWith(".stderr.log"));
  if (!stdout || !stderr) throw new Error(`no stop logs in ${baseDir}: ${names.join(", ")}`);
  return { stdout: join(baseDir, stdout), stderr: join(baseDir, stderr) };
}

const STDOUT_BYTES = PAYLOAD + "BEGIN".length + "END\n".length;
const STDERR_BYTES = PAYLOAD + "ERROR-BEGIN".length + "ERROR-END\n".length;

describe("ao stop: the caller copies all the output of the detached stop (review r2 M-1)", () => {
  it("a failed stop (exit 7) to slow readers: every byte, both end markers, exit code 7", async () => {
    const out = startReader(SLOW_READER);
    const err = startReader(SLOW_READER);

    const code = await runStop("7", out, err);
    const [stdout, stderr] = await Promise.all([out.result, err.result]);

    expect({ stdout: stdout.total, stderr: stderr.total }).toEqual({
      stdout: STDOUT_BYTES,
      stderr: STDERR_BYTES,
    });
    expect(stdout.tail.endsWith("END\n")).toBe(true);
    expect(stderr.tail.endsWith("ERROR-END\n")).toBe(true);
    expect(code).toBe(7);
    expect(exitCodes).toEqual([]);
    // Backpressure: never more than one chunk waits in a stream.
    expect(Math.max(out.maxQueued(), err.maxQueued())).toBeLessThanOrEqual(CHUNK);
  }, 30_000);

  it("a stop that works (exit 0) to slow readers: every byte, with backpressure", async () => {
    const out = startReader(SLOW_READER);
    const err = startReader(SLOW_READER);

    const code = await runStop("0", out, err);
    const [stdout, stderr] = await Promise.all([out.result, err.result]);

    expect(Math.max(out.maxQueued(), err.maxQueued())).toBeLessThanOrEqual(CHUNK);
    expect({ stdout: stdout.total, stderr: stderr.total }).toEqual({
      stdout: STDOUT_BYTES,
      stderr: STDERR_BYTES,
    });
    expect(stdout.tail.endsWith("END\n")).toBe(true);
    expect(stderr.tail.endsWith("ERROR-END\n")).toBe(true);
    expect(code ?? 0).toBe(0);
  }, 30_000);

  it("a detached stop ended by a signal: every byte, then the signal line, exit code 1", async () => {
    const out = startReader(SLOW_READER);
    const err = startReader(SLOW_READER);

    const code = await runStop("signal", out, err);
    const [stdout, stderr] = await Promise.all([out.result, err.result]);
    const logs = stopLogs();
    const line = `\nThe detached stop was ended by a signal; its output: ${logs.stdout} and ${logs.stderr}\n`;

    expect({ stdout: stdout.total, stderr: stderr.total }).toEqual({
      stdout: STDOUT_BYTES,
      stderr: STDERR_BYTES + Buffer.byteLength(line),
    });
    expect(stdout.tail.endsWith("END\n")).toBe(true);
    expect(stderr.tail.endsWith(line.slice(-150))).toBe(true);
    expect(code).toBe(1);
  }, 30_000);

  it("an output error (the stdout reader closes): stderr gets every byte and a note, exit code 7 stays", async () => {
    const out = startReader(EARLY_CLOSE_READER);
    const err = startReader(SLOW_READER);

    const code = await runStop("7", out, err);
    const [stdout, stderr] = await Promise.all([out.result, err.result]);
    const logs = stopLogs();
    const note = `ao stop: could not write the stdout of the detached stop (write EPIPE); all of it is in ${logs.stdout}\n`;

    expect(stdout.total).toBe(4096);
    expect(stderr.total).toBe(STDERR_BYTES + Buffer.byteLength(note));
    expect(stderr.tail.endsWith(note.slice(-150))).toBe(true);
    expect(stderr.tail).not.toContain("did not start");
    expect(code).toBe(7);
    // The logs keep all of it.
    expect(readFileSync(logs.stdout).length).toBe(STDOUT_BYTES);
  }, 30_000);
});
