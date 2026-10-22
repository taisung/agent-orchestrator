/**
 * Session relaunch (2026-10-22), review r1 M-3: the end-state write of a
 * relaunch. No path may leave a long-lived `ao` (the caller's own pane: it
 * stays for the agent's life) holding the launch keys: after three failed
 * writes or an I/O error, later tries run, and the failure is reported at
 * once, while the agent still runs. A launch script that cannot be removed
 * does not stop the end-state write either.
 *
 * `updateMetadataIf` is the real one, except that the end-state writes (the
 * only writes that clear `launchPid`) fail as the queue says.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { readMetadataRaw, updateMetadata, writeMetadata } from "../../metadata.js";
import type * as Metadata from "../../metadata.js";
import {
  LAUNCH_GRACE_MS,
  SessionLaunchInProgressError,
  type OrchestratorConfig,
  type RuntimeHandle,
  type RuntimePaneState,
  type SessionManager,
  type SessionRelaunchChild,
} from "../../types.js";
import {
  createMockPlugins,
  createMockRegistry,
  createTestEnvironment,
  type MockPlugins,
  type TestEnvironment,
} from "../test-utils.js";

const fault = vi.hoisted(() => ({ queue: [] as Array<"conflict" | "io"> }));

vi.mock("../../metadata.js", async (importOriginal) => {
  const actual = await importOriginal<typeof Metadata>();
  return {
    ...actual,
    updateMetadataIf: vi.fn((...args: Parameters<typeof actual.updateMetadataIf>) => {
      if (args[3]["launchPid"] === "" && fault.queue.length > 0) {
        if (fault.queue.shift() === "io") {
          throw Object.assign(new Error("EIO: i/o error, rename"), { code: "EIO" });
        }
        return null;
      }
      return actual.updateMetadataIf(...args);
    }),
  };
});

const PANE_TTY = "/dev/pts/77";

let env: TestEnvironment;
let plugins: MockPlugins;
let config: OrchestratorConfig;
let sm: SessionManager;
let agentRunning: boolean;

function writeRecord(sessionId: string): void {
  writeMetadata(env.sessionsDir, sessionId, {
    worktree: join(env.tmpDir, "ws"),
    branch: "feat/x",
    status: "working",
    tmuxName: `h-${sessionId}`,
    project: "my-app",
    agent: "mock-agent",
    createdAt: new Date(Date.now() - LAUNCH_GRACE_MS - 60_000).toISOString(),
    runtimeHandle: JSON.stringify({ id: `h-${sessionId}`, runtimeName: "tmux", data: {} }),
  });
  updateMetadata(env.sessionsDir, sessionId, {});
}

function recordOf(sessionId: string): Record<string, string> | null {
  return readMetadataRaw(env.sessionsDir, sessionId);
}

/** A child in the session's own pane that has not ended (the agent runs). */
function liveChild(): {
  run: (launch: { script: string }) => SessionRelaunchChild;
  end: (code: number) => void;
} {
  let end: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    end = resolve;
  });
  return {
    run: (launch) => {
      rmSync(launch.script, { force: true });
      agentRunning = true;
      return { exited };
    },
    end: (code) => end(code),
  };
}

beforeEach(() => {
  fault.queue = [];
  env = createTestEnvironment();
  plugins = createMockPlugins();
  agentRunning = false;
  Object.assign(plugins.runtime, {
    name: "tmux",
    isAlive: vi.fn().mockResolvedValue(true),
    listPanes: vi.fn(
      async (): Promise<RuntimePaneState[]> => [
        { paneId: "%3", tty: PANE_TTY, foregroundCommand: "ao", shellIdle: false },
      ],
    ),
    runInPane: vi.fn(async (_handle: RuntimeHandle, _paneId: string, _command: string) => {
      agentRunning = true;
    }),
  });
  vi.mocked(plugins.agent.isProcessRunning).mockImplementation(async () => agentRunning);
  config = env.config;
  sm = createSessionManager({
    config,
    registry: createMockRegistry({ runtime: plugins.runtime, agent: plugins.agent }),
  });
});

afterEach(() => {
  env.cleanup();
});

describe("Review r1 M-3: the launch keys never stay with a long-lived ao", () => {
  it("reports three failed compares at once and clears the keys by a later try while the agent runs", async () => {
    writeRecord("app-1");
    fault.queue = ["conflict", "conflict", "conflict"];
    const child = liveChild();
    const onWarning = vi.fn();

    const result = await sm.relaunch!("app-1", {
      callerTty: PANE_TTY,
      runInCallerTerminal: child.run,
      onWarning,
    });

    expect(result.running).toBe(true);
    // Reported at once, while the child still runs (it has not ended).
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringMatching(
        /launch keys of app-1 could not be cleared yet \(its record changed during each write\)/,
      ),
    );
    expect(recordOf("app-1")!["launchPid"]).toBe(String(process.pid));
    await vi.waitFor(() => expect(recordOf("app-1")!["launchPid"]).toBeUndefined(), {
      timeout: 5_000,
      interval: 50,
    });
    expect(onWarning).toHaveBeenLastCalledWith("the launch keys of app-1 were cleared at try 4");
    const killed = await sm.kill("app-1").catch((e: unknown) => e);
    expect(killed).not.toBeInstanceOf(SessionLaunchInProgressError);
    child.end(0);
  });

  it("reports an I/O error at once and clears the keys by a later try while the agent runs", async () => {
    writeRecord("app-1");
    fault.queue = ["io", "io", "io", "io"];
    const child = liveChild();
    const onWarning = vi.fn();

    const result = await sm.relaunch!("app-1", {
      callerTty: PANE_TTY,
      runInCallerTerminal: child.run,
      onWarning,
    });

    expect(result.running).toBe(true);
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringMatching(/could not be cleared yet \(EIO: i\/o error, rename\)/),
    );
    await vi.waitFor(() => expect(recordOf("app-1")!["launchPid"]).toBeUndefined(), {
      timeout: 8_000,
      interval: 50,
    });
    expect(onWarning).toHaveBeenLastCalledWith("the launch keys of app-1 were cleared at try 5");
    expect(recordOf("app-1")!["status"]).toBe("working");
    child.end(0);
  }, 15_000);

  it("writes the end state also when the launch script cannot be removed after a failed start", async () => {
    writeRecord("app-1");
    const before = recordOf("app-1")!;
    vi.mocked(plugins.runtime.listPanes!).mockResolvedValue([
      { paneId: "%3", tty: PANE_TTY, foregroundCommand: "bash", shellIdle: true },
    ]);
    vi.mocked(plugins.runtime.runInPane!).mockImplementation(async (_handle, _paneId, command) => {
      // The script path is now a directory that is not empty: rmSync throws.
      const script = /^bash '([^']+)'$/.exec(command)![1];
      rmSync(script, { force: true });
      mkdirSync(join(script, "inside"), { recursive: true });
      throw new Error("send-keys failed");
    });
    const onWarning = vi.fn();

    try {
      await expect(sm.relaunch!("app-1", { onWarning })).rejects.toThrow(
        /could not start its agent \(send-keys failed\)/,
      );

      expect(onWarning).toHaveBeenCalledWith(
        expect.stringMatching(/the launch script .*ao-launch-.*\.sh could not be removed/),
      );
      const after = recordOf("app-1")!;
      expect(after["launchPid"]).toBeUndefined();
      expect(after["restoredAt"]).toBeUndefined();
      expect(after["launchToken"]).toBe(before["launchToken"]);
    } finally {
      const command = vi.mocked(plugins.runtime.runInPane!).mock.calls[0]?.[2] ?? "";
      const script = /^bash '([^']+)'$/.exec(command)?.[1];
      if (script) rmSync(script, { recursive: true, force: true });
    }
  });
});
