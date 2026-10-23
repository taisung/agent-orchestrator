/**
 * An old Herdr orchestrator record at core `spawnOrchestrator` (owner decision
 * OQ-F1 (b), 2026-10-22), through the built core with the real runtime-herdr
 * plugin. Only `herdr` is a stand-in: it answers with the recorded 0.9.5
 * answers of the live check. After fit F-1 a closed pane is `isAlive` false
 * and no server is RUNTIME_NO_SERVER_ERROR_CODE; for a Herdr record neither
 * is "gone", so project mode neither archives the old record nor starts a new
 * orchestrator. fit-1 refused with an interim text; Herdr fit-2 G (design r11
 * 5.3.10) refuses with OrchestratorStartBlockedError (`records`, kind
 * `unproven`) and message M. fit2-startup.test.ts has the other cases of G.
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
  isOrchestratorStartBlockedError,
  launchIdentityToken,
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

describe("Herdr fit-2 G: core spawnOrchestrator with an old Herdr orchestrator (project mode)", () => {
  for (const [name, answer] of [
    [
      "closedpane_pane_get",
      "herdr answered that the pane does not exist or that it has another terminal",
    ],
    ["noserver_never_pane_get", "no herdr server answers at the socket"],
  ] as const) {
    it(`${name}: blocked (unproven) with message M; the record stays, nothing is created`, async () => {
      herdrStandIn.paneGet = herdrRejection(herdrFixture(name));
      const { sessionsDir, sm } = setup();
      const before = readMetadataRaw(sessionsDir, "app-orchestrator")!;

      const err = await sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);

      expect(isOrchestratorStartBlockedError(err)).toBe(true);
      if (!isOrchestratorStartBlockedError(err)) return;
      expect(err.blocking.map((b) => [b.sessionId, b.kind])).toEqual([
        ["app-orchestrator", "unproven"],
      ]);
      expect(err.message).toBe(
        [
          "No new orchestrator was started for project my-app: AO cannot tell that every earlier herdr orchestrator launch of the project ended.",
          `app-orchestrator: status working. Herdr pane w3:p2 (terminal term_a), workspace w3, worktree ${join(root, "my-app")}, socket not recorded: ${answer}.`,
          "  Check:  'herdr' pane get 'w3:p2'",
          "  If it runs, use it:  ao session attach 'app-orchestrator'",
          `  If it does not run, or after you close it:  ao session kill 'app-orchestrator' --confirm-runtime-closed '${launchIdentityToken(before)}'`,
          "Before RH, AO takes no herdr answer as proof that a launch ended. Then run ao start again.",
        ].join("\n"),
      );

      const record = readMetadataRaw(sessionsDir, "app-orchestrator");
      expect(record?.["runtimeHandle"]).toBe(HANDLE);
      expect(record?.["status"]).toBe("working");
      expect(readdirSync(sessionsDir).filter((entry) => entry !== "app-orchestrator")).toEqual([]);
      expect(herdrStandIn.calls).toEqual([["pane", "get", "w3:p2"]]);
    });
  }
});
