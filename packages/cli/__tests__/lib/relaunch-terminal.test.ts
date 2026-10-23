/**
 * Session relaunch (2026-10-22), R-5 (b): the caller's terminal, and the
 * agent as a child of `ao` in the session's own pane.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import {
  callerInForeground,
  callerTerminal,
  runInCallerTerminal,
} from "../../src/lib/relaunch-terminal.js";

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

describe("callerInForeground (review r2)", () => {
  /** A /proc/<pid>/stat line with this pgrp (field 5) and tpgid (field 8). */
  const stat = (pgrp: number, tpgid: number) =>
    `4711 (node ao) S 4700 ${pgrp} ${pgrp} 34817 ${tpgid} 4194560 100 0 0 0`;

  it("is true for the foreground process group of the terminal, false for a background job", () => {
    expect(callerInForeground(() => stat(4711, 4711))).toBe(true);
    expect(callerInForeground(() => stat(4711, 4800))).toBe(false);
  });

  it("is null when /proc cannot tell (no file, no terminal, or a malformed line)", () => {
    expect(
      callerInForeground(() => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
    expect(callerInForeground(() => stat(4711, -1))).toBeNull();
    expect(callerInForeground(() => "garbage")).toBeNull();
  });

  it("reads this process's own stat by default", () => {
    expect([true, false, null]).toContain(callerInForeground());
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

  it("passes SIGTERM to a real agent that the script execs, and resolves only after the agent and its own child ended (review r1 M-2)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ao-relaunch-term-"));
    const pidOf = (name: string): number | null => {
      const path = join(dir, name);
      const text = existsSync(path) ? readFileSync(path, "utf-8").trim() : "";
      return /^[1-9]\d*$/.test(text) ? Number(text) : null;
    };
    const alive = (pid: number | null): boolean => {
      if (pid === null || pid <= 1) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    writeFileSync(
      join(dir, "agent.sh"),
      [
        "#!/bin/bash",
        'echo $$ > "$1/agent.pid"',
        "sleep 300 &",
        'echo $! > "$1/grandchild.pid"',
        'trap \'kill "$(cat "$1/grandchild.pid")" 2>/dev/null; exit 143\' TERM',
        "wait",
        "",
      ].join("\n"),
    );
    // The form of a core launch script: cd, then exec the agent.
    writeFileSync(
      join(dir, "launch.sh"),
      `#!/usr/bin/env bash\ncd -- '${dir}' || exit 1\nexec bash '${join(dir, "agent.sh")}' '${dir}'\n`,
    );
    let ended = false;

    try {
      const run = runInCallerTerminal({ script: join(dir, "launch.sh"), cwd: dir });
      void run.exited.then(() => {
        ended = true;
      });
      await vi.waitFor(() => expect(alive(pidOf("grandchild.pid"))).toBe(true), { timeout: 5_000 });
      const agent = pidOf("agent.pid");
      const grandchild = pidOf("grandchild.pid");
      expect(ended).toBe(false);

      process.emit("SIGTERM", "SIGTERM");

      expect(await run.exited).toBe(143);
      expect(alive(agent)).toBe(false);
      await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 3_000 });
    } finally {
      for (const pid of [pidOf("agent.pid"), pidOf("grandchild.pid")]) {
        if (alive(pid)) process.kill(pid as number, "SIGKILL");
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it("resolves 127 when the child cannot start", async () => {
    const child = fakeChild();
    const run = runInCallerTerminal({ script: "/s.sh", cwd: "/w" }, () => child);

    child.emit("error", new Error("spawn bash ENOENT"));

    expect(await run.exited).toBe(127);
    expect(process.listenerCount("SIGHUP")).toBe(before.SIGHUP);
  });
});
