/**
 * Herdr fit-1 interim startup rule (owner decision OQ-F1 (b), 2026-10-22; the
 * fit-2 guard G replaces it), through core `spawnOrchestrator` (the built
 * core) with the real runtime-herdr plugin. Only `herdr` is a stand-in: it
 * answers with the recorded 0.9.5 answers of the live check. After fit F-1 a
 * closed pane is `isAlive` false and no server is RUNTIME_NO_SERVER_ERROR_CODE;
 * for a Herdr record neither is "gone", so project mode neither archives the
 * old record nor starts a new orchestrator. (Isolated mode reads no old
 * record in core; `ao start` checks it, see the CLI test
 * start-herdr-interim.test.ts.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";

const herdrStandIn = vi.hoisted(() => ({
  paneGet: null as unknown,
  calls: [] as string[][],
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  // No real herdr or tmux runs: the callback form refuses them.
  const execFile = ((cmd: string, ...rest: unknown[]) => {
    if (cmd === "herdr" || cmd === "tmux") throw new Error(`unexpected command: ${cmd}`);
    return (actual.execFile as (...args: unknown[]) => unknown)(cmd, ...rest);
  }) as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[], ...rest: unknown[]) => {
      if (cmd !== "herdr") {
        if (cmd === "tmux") throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
        return promisify(actual.execFile)(cmd, args, ...(rest as [ChildProcess.ExecFileOptions]));
      }
      herdrStandIn.calls.push(args);
      if (args[0] === "pane" && args[1] === "get") throw herdrStandIn.paneGet;
      throw new Error(`unexpected herdr call: ${args.join(" ")}`);
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

import {
  createSessionManager,
  getSessionsDir,
  readMetadataRaw,
  writeMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
} from "@aoagents/ao-core";
import { create } from "../index.js";
import { herdrFixture, herdrRejection } from "./herdr-fixtures.js";

const HANDLE = JSON.stringify({
  id: "w3:p2",
  runtimeName: "herdr",
  data: { workspaceId: "w3", paneId: "w3:p2", terminalId: "term_a", sessionId: "app" },
});

let root: string;
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-herdr-startup-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
  herdrStandIn.calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

function setup() {
  const projectPath = join(root, "my-app");
  mkdirSync(projectPath, { recursive: true });
  const configPath = join(root, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const config = {
    configPath,
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: { runtime: "herdr", agent: "stand-in", workspace: "worktree", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
        agent: "stand-in",
        runtime: "herdr",
        orchestratorWorkspaceMode: "project",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
  } as unknown as OrchestratorConfig;
  const sessionsDir = getSessionsDir(configPath, projectPath);
  mkdirSync(sessionsDir, { recursive: true });

  const runtime: Runtime = create();
  const agent = {
    name: "stand-in",
    processName: "stand-in",
    getLaunchCommand: () => "true",
    getEnvironment: () => ({}),
    detectActivity: () => "idle",
    getActivityState: async () => null,
    isProcessRunning: async () => true,
    getSessionInfo: async () => null,
  } as unknown as Agent;
  const registry = {
    register: vi.fn(),
    get: vi.fn((slot: string) => (slot === "runtime" ? runtime : slot === "agent" ? agent : null)),
    list: vi.fn(() => []),
    loadBuiltins: vi.fn(async () => undefined),
    loadFromConfig: vi.fn(async () => undefined),
  } as unknown as PluginRegistry;

  writeMetadata(sessionsDir, "app-orchestrator", {
    worktree: projectPath,
    branch: "main",
    status: "working",
    role: "orchestrator",
    project: "my-app",
    runtimeHandle: HANDLE,
  });
  return { sessionsDir, sm: createSessionManager({ config, registry }) };
}

describe("Herdr fit-1 interim: core spawnOrchestrator with an old Herdr orchestrator (project mode)", () => {
  for (const name of ["closedpane_pane_get", "noserver_never_pane_get"]) {
    it(`${name}: refuses as for an unknown answer; the record stays, nothing is created`, async () => {
      herdrStandIn.paneGet = herdrRejection(herdrFixture(name));
      const { sessionsDir, sm } = setup();

      await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
        "Cannot tell whether session app-orchestrator is alive, so it is neither reused nor replaced. Check the runtime and retry.",
      );

      const record = readMetadataRaw(sessionsDir, "app-orchestrator");
      expect(record?.["runtimeHandle"]).toBe(HANDLE);
      expect(record?.["status"]).toBe("working");
      expect(readdirSync(sessionsDir).filter((entry) => entry !== "app-orchestrator")).toEqual([]);
      expect(herdrStandIn.calls).toEqual([["pane", "get", "w3:p2"]]);
    });
  }
});
