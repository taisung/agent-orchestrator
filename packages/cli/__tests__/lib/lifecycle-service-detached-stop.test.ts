/**
 * Defect B (2026-10-22): `startDetachedStop` runs the `ao stop` of an existing
 * orchestrator record in a process that the hangup of the caller's pane does
 * not reach: its own session (detached), no terminal on stdio, the same
 * config, state root and runtime environment (TMUX, PATH), and a stdout log
 * and a stderr log of its own (review r1 m-1, m-2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getProjectBaseDir, getStateRoot, type OrchestratorConfig } from "@aoagents/ao-core";
import type * as NodeChildProcess from "node:child_process";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>();
  return { ...actual, spawn: mockSpawn };
});

import { startDetachedStop } from "../../src/lib/lifecycle-service.js";

/** `orchestrator-stop-<ISO time with - for : and .>-<PID>-<8 hex>.<stream>.log`. */
function logName(stream: "stdout" | "stderr"): RegExp {
  return new RegExp(
    `^orchestrator-stop-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z-${process.pid}-[0-9a-f]{8}\\.${stream}\\.log$`,
  );
}

type SpawnOptions = {
  cwd: string;
  detached: boolean;
  stdio: unknown[];
  env: Record<string, string | undefined>;
};

let tmpDir: string;
let config: OrchestratorConfig;
let baseDir: string;
let child: EventEmitter & { pid?: number };
const savedEnv: { TMUX?: string; PATH?: string } = {};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ao-detached-stop-test-"));
  // The config hash reads the real path of the config file, so it must exist.
  writeFileSync(join(tmpDir, "agent-orchestrator.yaml"), "projects: {}\n");
  config = {
    configPath: join(tmpDir, "agent-orchestrator.yaml"),
    projects: { app: { name: "app", path: join(tmpDir, "project") } },
  } as OrchestratorConfig;
  baseDir = getProjectBaseDir(config.configPath, join(tmpDir, "project"));
  child = Object.assign(new EventEmitter(), { pid: 4321 });
  savedEnv.TMUX = process.env["TMUX"];
  savedEnv.PATH = process.env["PATH"];
  mockSpawn.mockReset();
  mockSpawn.mockImplementation((_cmd: string, _args: string[], options: SpawnOptions) => {
    // The child writes its output to the file descriptors it was given.
    writeSync(options.stdio[1] as number, "Orchestrator stopped\n");
    writeSync(options.stdio[2] as number, "- Stopping orchestrator session\n");
    return child;
  });
});

/** The contents of the stop logs in the project base directory, sorted. */
function stopLogContents(): string[] {
  return readdirSync(baseDir)
    .filter((name) => name.startsWith("orchestrator-stop"))
    .map((name) => readFileSync(join(baseDir, name), "utf-8"))
    .sort();
}

afterEach(() => {
  for (const key of ["TMUX", "PATH"] as const) {
    const saved = savedEnv[key];
    if (saved === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = saved;
  }
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("startDetachedStop", () => {
  it("starts `ao stop` detached, with no terminal on stdio and the same config and state root", () => {
    const stop = startDetachedStop(config, "app", ["stop", "app", "--detached-stop-process"]);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = mockSpawn.mock.calls[0] as [string, string[], SpawnOptions];
    expect(command).toBe(process.execPath);
    expect(args.slice(-3)).toEqual(["stop", "app", "--detached-stop-process"]);
    expect(options.detached).toBe(true);
    expect(options.stdio[0]).toBe("ignore");
    expect(typeof options.stdio[1]).toBe("number");
    expect(typeof options.stdio[2]).toBe("number");
    expect(options.stdio[2]).not.toBe(options.stdio[1]);
    expect(options.cwd).toBe(dirname(config.configPath));
    expect(options.env["AO_CONFIG_PATH"]).toBe(config.configPath);
    expect(options.env["AO_STATE_ROOT"]).toBe(getStateRoot());

    expect(dirname(stop.stdoutLog)).toBe(baseDir);
    expect(dirname(stop.stderrLog)).toBe(baseDir);
    expect(basename(stop.stdoutLog)).toMatch(logName("stdout"));
    expect(basename(stop.stderrLog)).toMatch(logName("stderr"));
    expect(stop.stderrLog.replace(".stderr.log", "")).toBe(
      stop.stdoutLog.replace(".stdout.log", ""),
    );
    expect(stop.pid).toBe(4321);
    expect(readFileSync(stop.stdoutLog, "utf-8")).toBe("Orchestrator stopped\n");
    expect(readFileSync(stop.stderrLog, "utf-8")).toBe("- Stopping orchestrator session\n");
  });

  it("m-2: the child gets TMUX and PATH of this process unchanged", () => {
    process.env["TMUX"] = "/tmp/tmux-1000/fixture-server,4242,0";
    process.env["PATH"] = "/fixture/scratch/bin:/usr/bin:/bin";

    startDetachedStop(config, "app", ["stop", "app"]);

    const options = mockSpawn.mock.calls[0]?.[2] as SpawnOptions;
    expect(options.env["TMUX"]).toBe("/tmp/tmux-1000/fixture-server,4242,0");
    expect(options.env["PATH"]).toBe("/fixture/scratch/bin:/usr/bin:/bin");
  });

  it("m-1: each stop writes logs of its own", () => {
    const first = startDetachedStop(config, "app", ["stop", "app"]);
    const second = startDetachedStop(config, "app", ["stop", "app"]);

    // Two files per stop, none shared, each with only that stop's output.
    expect(stopLogContents()).toEqual([
      "- Stopping orchestrator session\n",
      "- Stopping orchestrator session\n",
      "Orchestrator stopped\n",
      "Orchestrator stopped\n",
    ]);
    expect(second.stdoutLog).not.toBe(first.stdoutLog);
    expect(second.stderrLog).not.toBe(first.stderrLog);
    for (const stop of [first, second]) {
      expect(readFileSync(stop.stdoutLog, "utf-8")).toBe("Orchestrator stopped\n");
      expect(readFileSync(stop.stderrLog, "utf-8")).toBe("- Stopping orchestrator session\n");
    }
  });

  it("m-1: two concurrent detached stops keep separate, whole logs", async () => {
    const { spawn: realSpawn } =
      await vi.importActual<typeof NodeChildProcess>("node:child_process");
    // A writes, waits while B starts and writes, then writes again.
    const scripts = [
      'process.stderr.write("A started\\n"); setTimeout(() => process.stdout.write("A finished\\n"), 300);',
      'process.stderr.write("B refused\\n"); process.exitCode = 1;',
    ];
    mockSpawn.mockImplementation((_cmd: string, _args: string[], options: SpawnOptions) =>
      realSpawn(
        process.execPath,
        ["-e", scripts.shift() ?? ""],
        options as NodeChildProcess.SpawnOptions,
      ),
    );

    const a = startDetachedStop(config, "app", ["stop", "app"]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const b = startDetachedStop(config, "app", ["stop", "app"]);
    const codes = await Promise.all([a.done, b.done]);

    expect(codes).toEqual([0, 1]);
    expect(stopLogContents()).toEqual(["", "A finished\n", "A started\n", "B refused\n"]);
    expect(b.stdoutLog).not.toBe(a.stdoutLog);
    expect(b.stderrLog).not.toBe(a.stderrLog);
    expect(readFileSync(a.stderrLog, "utf-8")).toBe("A started\n");
    expect(readFileSync(a.stdoutLog, "utf-8")).toBe("A finished\n");
    expect(readFileSync(b.stderrLog, "utf-8")).toBe("B refused\n");
    expect(readFileSync(b.stdoutLog, "utf-8")).toBe("");
  });

  it("removes logs of detached stops older than 7 days, and nothing else", () => {
    mkdirSync(baseDir, { recursive: true });
    const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
    const oneDayAgo = (Date.now() - 24 * 60 * 60 * 1000) / 1000;
    const oldLog = join(
      baseDir,
      "orchestrator-stop-2026-10-01T00-00-00-000Z-1-aaaaaaaa.stderr.log",
    );
    const recentLog = join(
      baseDir,
      "orchestrator-stop-2026-10-21T00-00-00-000Z-1-bbbbbbbb.stdout.log",
    );
    const otherOldFile = join(baseDir, "lifecycle-worker.log");
    for (const [path, time] of [
      [oldLog, eightDaysAgo],
      [recentLog, oneDayAgo],
      [otherOldFile, eightDaysAgo],
    ] as const) {
      writeFileSync(path, "x");
      utimesSync(path, time, time);
    }

    startDetachedStop(config, "app", ["stop", "app"]);

    expect(existsSync(oldLog)).toBe(false);
    expect(existsSync(recentLog)).toBe(true);
    expect(existsSync(otherOldFile)).toBe(true);
  });

  it("resolves with the exit code of the detached process", async () => {
    const stop = startDetachedStop(config, "app", ["stop", "app"]);
    child.emit("close", 1, null);

    await expect(stop.done).resolves.toBe(1);
  });

  it("rejects when the detached process does not start", async () => {
    const stop = startDetachedStop(config, "app", ["stop", "app"]);
    child.emit("error", new Error("spawn ao ENOENT"));

    await expect(stop.done).rejects.toThrow("spawn ao ENOENT");
  });
});
