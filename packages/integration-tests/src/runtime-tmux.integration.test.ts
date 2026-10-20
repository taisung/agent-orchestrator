import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tmuxPlugin from "@aoagents/ao-plugin-runtime-tmux";
import {
  NO_SERVER_BOUND_MS,
  RUNTIME_NO_SERVER_ERROR_CODE,
  createLifecycleManager,
  createSessionManager,
  getSessionsDir,
  readMetadataRaw,
  writeMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type RuntimeHandle,
} from "@aoagents/ao-core";
import { isTmuxAvailable, killSessionsByPrefix } from "./helpers/tmux.js";
import { sleep } from "./helpers/polling.js";

const tmuxOk = await isTmuxAvailable();
const SESSION_PREFIX = "ao-inttest-tmux-";

describe.skipIf(!tmuxOk)("runtime-tmux (integration)", () => {
  const runtime = tmuxPlugin.create();
  const sessionId = `${SESSION_PREFIX}${Date.now()}`;
  let handle: RuntimeHandle;

  beforeAll(async () => {
    await killSessionsByPrefix(SESSION_PREFIX);
    // A second session keeps the tmux server up after `destroy`. Without it, a
    // server whose last session ends exits, and isAlive rejects ("no server
    // running") instead of answering false: the last describe block covers that.
    await runtime.create({
      sessionId: `${SESSION_PREFIX}keeper-${Date.now()}`,
      workspacePath: "/tmp",
      launchCommand: "cat",
      environment: { AO_TEST: "1" },
    });
  }, 30_000);

  afterAll(async () => {
    try {
      await runtime.destroy(handle);
    } catch {
      /* best-effort cleanup */
    }
    await killSessionsByPrefix(SESSION_PREFIX);
  }, 30_000);

  it("creates a tmux session", async () => {
    handle = await runtime.create({
      sessionId,
      workspacePath: "/tmp",
      launchCommand: "cat", // cat will wait for stdin
      environment: { AO_TEST: "1" },
    });

    expect(handle.id).toBe(sessionId);
    expect(handle.runtimeName).toBe("tmux");
  });

  it("isAlive returns true for running session", async () => {
    expect(await runtime.isAlive(handle)).toBe(true);
  });

  it("sendMessage sends text and getOutput captures it", async () => {
    await runtime.sendMessage(handle, "hello world");
    await sleep(500); // give tmux time to process
    const output = await runtime.getOutput(handle);
    expect(output).toContain("hello world");
  });

  it("sendMessage handles long text via buffer", async () => {
    const longText = "x".repeat(250);
    await runtime.sendMessage(handle, longText);
    await sleep(500);
    const output = await runtime.getOutput(handle);
    // tmux wraps long text at column width, so strip ANSI escapes and newlines
    // eslint-disable-next-line no-control-regex
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, "").replace(/\n/g, "");
    expect(stripped).toContain(longText);
  });

  it("getMetrics returns uptime", async () => {
    const metrics = await runtime.getMetrics!(handle);
    expect(metrics.uptimeMs).toBeGreaterThan(0);
  });

  it("getAttachInfo returns tmux command", async () => {
    const info = await runtime.getAttachInfo!(handle);
    expect(info.type).toBe("tmux");
    expect(info.target).toBe(sessionId);
    expect(info.command).toContain("tmux attach");
  });

  it("destroy kills the session", async () => {
    await runtime.destroy(handle);
    // tmux answers "can't find session": the one answer that means gone.
    expect(await runtime.isAlive(handle)).toBe(false);
  });

  it("destroy is idempotent", async () => {
    // Should not throw even though session is already dead
    await runtime.destroy(handle);
  });
});

describe.skipIf(!tmuxOk)("runtime-tmux: the last session of a server ends (integration)", () => {
  // A server of its own: its own socket directory and no TMUX variable (tmux
  // ignores TMUX_TMPDIR while TMUX is set). The state root is scratch too.
  const saved = {
    TMUX: process.env["TMUX"],
    TMUX_TMPDIR: process.env["TMUX_TMPDIR"],
    AO_STATE_ROOT: process.env["AO_STATE_ROOT"],
  };
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "ao-inttest-tmux-last-"));
    mkdirSync(join(scratch, "sockets"));
    delete process.env["TMUX"];
    process.env["TMUX_TMPDIR"] = join(scratch, "sockets");
    process.env["AO_STATE_ROOT"] = join(scratch, "state");
  });

  afterAll(() => {
    vi.useRealTimers();
    if (saved.TMUX === undefined) delete process.env["TMUX"];
    else process.env["TMUX"] = saved.TMUX;
    if (saved.TMUX_TMPDIR === undefined) delete process.env["TMUX_TMPDIR"];
    else process.env["TMUX_TMPDIR"] = saved.TMUX_TMPDIR;
    if (saved.AO_STATE_ROOT === undefined) delete process.env["AO_STATE_ROOT"];
    else process.env["AO_STATE_ROOT"] = saved.AO_STATE_ROOT;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("answers 'no server' after the server exits, and the lifecycle kills the record only after NO_SERVER_BOUND_MS", async () => {
    const runtime = tmuxPlugin.create();
    const handle = await runtime.create({
      sessionId: `${SESSION_PREFIX}last-${Date.now()}`,
      workspacePath: "/tmp",
      launchCommand: "cat",
      environment: { AO_TEST: "1" },
    });
    expect(await runtime.isAlive(handle)).toBe(true);

    // The only session ends, so the server exits (exit-empty is on by default).
    await runtime.destroy(handle);
    await vi.waitFor(
      async () =>
        expect(await runtime.isAlive(handle).catch((err: unknown) => err)).toMatchObject({
          code: RUNTIME_NO_SERVER_ERROR_CODE,
        }),
      { timeout: 5_000, interval: 50 },
    );

    // The 1.1 item 3 rule: unknown for NO_SERVER_BOUND_MS, then killed (runtime).
    const projectPath = join(scratch, "project");
    mkdirSync(projectPath, { recursive: true });
    const configPath = join(scratch, "agent-orchestrator.yaml");
    writeFileSync(configPath, "projects: {}\n");
    const config: OrchestratorConfig = {
      configPath,
      port: 3000,
      readyThresholdMs: 300_000,
      defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
      projects: {
        kr: {
          name: "kr",
          repo: "org/kr",
          path: projectPath,
          defaultBranch: "main",
          sessionPrefix: "kr",
        },
      },
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
    };
    const agent: Agent = {
      name: "claude-code",
      processName: "claude",
      getLaunchCommand: () => "claude",
      getEnvironment: () => ({}),
      detectActivity: () => "active",
      getActivityState: async () => null,
      isProcessRunning: async () => true,
      getSessionInfo: async () => null,
    };
    const registry: PluginRegistry = {
      register: () => {},
      get: ((slot: string) =>
        slot === "runtime" ? runtime : slot === "agent" ? agent : null) as PluginRegistry["get"],
      list: () => [],
      loadBuiltins: async () => {},
      loadFromConfig: async () => {},
    };
    const sessionsDir = getSessionsDir(configPath, projectPath);
    writeMetadata(sessionsDir, "kr-1", {
      worktree: "/tmp",
      branch: "main",
      status: "working",
      project: "kr",
      tmuxName: handle.id,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      runtimeHandle: JSON.stringify(handle),
    });
    const lifecycle = createLifecycleManager({
      config,
      registry,
      sessionManager: createSessionManager({ config, registry }),
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    for (const offset of [0, 2 * 60_000, NO_SERVER_BOUND_MS - 60_000]) {
      vi.setSystemTime(start + offset);
      await lifecycle.check("kr-1");
      expect(readMetadataRaw(sessionsDir, "kr-1")?.["status"]).toBe("working");
    }
    vi.setSystemTime(start + NO_SERVER_BOUND_MS);
    await lifecycle.check("kr-1");
    expect(readMetadataRaw(sessionsDir, "kr-1")).toMatchObject({
      status: "killed",
      killedReason: "runtime",
    });
  });
});
