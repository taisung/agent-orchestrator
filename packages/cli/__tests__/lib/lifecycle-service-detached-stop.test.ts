/**
 * Defect B (2026-10-22): `startDetachedStop` runs the `ao stop` of the session
 * that the caller runs in, in a process that the hangup of that session's
 * pane does not reach: its own session (detached), no terminal on stdio, the
 * same config and state root.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getProjectBaseDir, getStateRoot, type OrchestratorConfig } from "@aoagents/ao-core";
import type * as NodeChildProcess from "node:child_process";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>();
  return { ...actual, spawn: mockSpawn };
});

import { startDetachedStop } from "../../src/lib/lifecycle-service.js";

let tmpDir: string;
let config: OrchestratorConfig;
let child: EventEmitter & { pid?: number };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ao-detached-stop-test-"));
  // The config hash reads the real path of the config file, so it must exist.
  writeFileSync(join(tmpDir, "agent-orchestrator.yaml"), "projects: {}\n");
  config = {
    configPath: join(tmpDir, "agent-orchestrator.yaml"),
    projects: { app: { name: "app", path: join(tmpDir, "project") } },
  } as OrchestratorConfig;
  child = Object.assign(new EventEmitter(), { pid: 4321 });
  mockSpawn.mockReset();
  mockSpawn.mockImplementation((_cmd: string, _args: string[], options: { stdio: unknown[] }) => {
    // The child writes its output to the file descriptor it was given.
    writeSync(options.stdio[1] as number, "Stopping orchestrator for app\n");
    return child;
  });
});

afterEach(() => {
  rmSync(getProjectBaseDir(config.configPath, join(tmpDir, "project")), {
    recursive: true,
    force: true,
  });
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("startDetachedStop", () => {
  it("starts `ao stop` detached, with no terminal on stdio and the same config and state root", () => {
    const stop = startDetachedStop(config, "app", ["stop", "app", "--detached-stop-process"]);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = mockSpawn.mock.calls[0] as [
      string,
      string[],
      {
        cwd: string;
        detached: boolean;
        stdio: unknown[];
        env: Record<string, string | undefined>;
      },
    ];
    expect(command).toBe(process.execPath);
    expect(args.slice(-3)).toEqual(["stop", "app", "--detached-stop-process"]);
    expect(options.detached).toBe(true);
    expect(options.stdio[0]).toBe("ignore");
    expect(typeof options.stdio[1]).toBe("number");
    expect(options.stdio[2]).toBe(options.stdio[1]);
    expect(options.cwd).toBe(dirname(config.configPath));
    expect(options.env["AO_CONFIG_PATH"]).toBe(config.configPath);
    expect(options.env["AO_STATE_ROOT"]).toBe(getStateRoot());

    const baseDir = getProjectBaseDir(config.configPath, join(tmpDir, "project"));
    expect(stop.logFile).toBe(join(baseDir, "orchestrator-stop.log"));
    expect(stop.pid).toBe(4321);
    expect(readFileSync(stop.logFile, "utf-8")).toBe("Stopping orchestrator for app\n");
  });

  it("writes the log new for each stop", () => {
    startDetachedStop(config, "app", ["stop", "app"]);
    const stop = startDetachedStop(config, "app", ["stop", "app"]);

    expect(readFileSync(stop.logFile, "utf-8")).toBe("Stopping orchestrator for app\n");
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
