/**
 * Session relaunch (2026-10-22), R-5 (b): the caller's terminal, and the
 * agent as a child of `ao` in the session's own pane.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { callerTerminal, runInCallerTerminal } from "../../src/lib/relaunch-terminal.js";

describe("callerTerminal", () => {
  it("answers the terminal of stdin first", () => {
    const readLink = vi.fn((path: string) => (path.endsWith("/0") ? "/dev/pts/3" : "/dev/pts/9"));

    expect(callerTerminal(readLink)).toBe("/dev/pts/3");
  });

  it("answers the terminal of stderr when stdin is not a terminal", () => {
    const links: Record<string, string> = {
      "/proc/self/fd/0": "pipe:[1234]",
      "/proc/self/fd/2": "/dev/pts/5",
      "/proc/self/fd/1": "/dev/pts/6",
    };

    expect(callerTerminal((path) => links[path])).toBe("/dev/pts/5");
  });

  it("answers null when no descriptor is a terminal", () => {
    const readLink = (path: string): string => {
      if (path.endsWith("/0")) throw new Error("ENOENT");
      return path.endsWith("/2") ? "/dev/null" : "/tmp/out.log";
    };

    expect(callerTerminal(readLink)).toBeNull();
  });
});

describe("runInCallerTerminal", () => {
  const before = {
    SIGINT: process.listenerCount("SIGINT"),
    SIGQUIT: process.listenerCount("SIGQUIT"),
    SIGTERM: process.listenerCount("SIGTERM"),
    SIGHUP: process.listenerCount("SIGHUP"),
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fakeChild(): ChildProcess & { kill: ReturnType<typeof vi.fn> } {
    const child = new EventEmitter() as ChildProcess & { kill: ReturnType<typeof vi.fn> };
    child.kill = vi.fn(() => true);
    return child;
  }

  it("runs the script with bash in the workspace on the inherited terminal", () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);

    runInCallerTerminal({ script: "/tmp/ao-launch-1.sh", cwd: "/work" }, spawn);
    child.emit("exit", 0, null);

    expect(spawn).toHaveBeenCalledWith("bash", ["/tmp/ao-launch-1.sh"], {
      cwd: "/work",
      stdio: "inherit",
    });
  });

  it("passes SIGHUP and SIGTERM on to the child, ignores SIGINT and SIGQUIT, and resolves 128 plus the signal", async () => {
    const child = fakeChild();
    const run = runInCallerTerminal({ script: "/s.sh", cwd: "/w" }, () => child);

    process.emit("SIGINT", "SIGINT");
    process.emit("SIGQUIT", "SIGQUIT");
    expect(child.kill).not.toHaveBeenCalled();
    process.emit("SIGTERM", "SIGTERM");
    process.emit("SIGHUP", "SIGHUP");
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGHUP"]]);

    child.emit("exit", null, "SIGHUP");

    expect(await run.exited).toBe(129);
    expect(process.listenerCount("SIGINT")).toBe(before.SIGINT);
    expect(process.listenerCount("SIGQUIT")).toBe(before.SIGQUIT);
    expect(process.listenerCount("SIGTERM")).toBe(before.SIGTERM);
    expect(process.listenerCount("SIGHUP")).toBe(before.SIGHUP);
  });

  it("resolves the child's exit code", async () => {
    const child = fakeChild();
    const run = runInCallerTerminal({ script: "/s.sh", cwd: "/w" }, () => child);

    child.emit("exit", 3, null);

    expect(await run.exited).toBe(3);
  });

  it("resolves 127 when the child cannot start", async () => {
    const child = fakeChild();
    const run = runInCallerTerminal({ script: "/s.sh", cwd: "/w" }, () => child);

    child.emit("error", new Error("spawn bash ENOENT"));

    expect(await run.exited).toBe(127);
    expect(process.listenerCount("SIGHUP")).toBe(before.SIGHUP);
  });
});
