/**
 * Review r3 (M-1), the reviewer's attack claude-pr: the Claude Code
 * PostToolUse hook writes `pr` with `sed` and `mv`, and keeps the generation
 * and the launch identity of the record. The hook's own functions
 * (`hook_is_safe_branch`, `hook_is_safe_pr`, `update_metadata_key`, cut from
 * METADATA_UPDATER_SCRIPT) run in clean bash during the stop of a refused
 * archived restore, with the record path that the hook builds from
 * AO_DATA_DIR and AO_SESSION, and exit 0 before the stop answers. The
 * refused restore must keep the record with the hook's write. Measured on
 * c045f31b: the active record became null. The test is here, not in core,
 * so that it imports the hook text without a source import across packages.
 * The shared-helper cases are in core (runtime-stop-callers.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSessionManager,
  deleteMetadata,
  getProjectBaseDir,
  getSessionsDir,
  getWorktreesDir,
  readMetadataRaw,
  writeMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type RuntimeHandle,
  type Workspace,
} from "@aoagents/ao-core";
import { METADATA_UPDATER_SCRIPT } from "../index.js";

const PR_URL = "https://github.com/review/scratch/pull/99";

let tmpDir: string;
let config: OrchestratorConfig;
let sessionsDir: string;
let runtime: Runtime;
let registry: PluginRegistry;

function makeHandle(id: string): RuntimeHandle {
  return { id, runtimeName: "mock", data: {} };
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `ao-test-restore-hook-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
  const configPath = join(tmpDir, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  config = {
    configPath,
    defaults: { runtime: "mock", agent: "mock-agent", workspace: "mock-ws", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: join(tmpDir, "my-app"),
        defaultBranch: "main",
        sessionPrefix: "app",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
    readyThresholdMs: 300_000,
  };
  sessionsDir = getSessionsDir(configPath, join(tmpDir, "my-app"));
  mkdirSync(sessionsDir, { recursive: true });

  runtime = {
    name: "mock",
    create: vi.fn(async () => makeHandle("rt-new")),
    destroy: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => undefined),
    getOutput: vi.fn(async () => ""),
    isAlive: vi.fn(async () => true),
  };
  const agent: Agent = {
    name: "mock-agent",
    processName: "mock",
    getLaunchCommand: vi.fn(() => "mock-agent --start"),
    getEnvironment: vi.fn(() => ({})),
    detectActivity: vi.fn(() => "active" as const),
    getActivityState: vi.fn(async () => ({ state: "active" as const })),
    isProcessRunning: vi.fn(async () => true),
    getSessionInfo: vi.fn(async () => null),
  };
  const workspace: Workspace = {
    name: "mock-ws",
    create: vi.fn(async () => ({
      path: "/tmp/ws",
      branch: "feat/test",
      sessionId: "app-1",
      projectId: "my-app",
    })),
    destroy: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
  };
  const plugins: Record<string, unknown> = { runtime, agent, workspace };
  registry = {
    register: vi.fn(),
    get: vi.fn((slot: string) => plugins[slot] ?? null) as PluginRegistry["get"],
    list: vi.fn(() => []),
    loadBuiltins: vi.fn(async () => undefined),
    loadFromConfig: vi.fn(async () => undefined),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(getProjectBaseDir(config.configPath, join(tmpDir, "my-app")), {
    recursive: true,
    force: true,
  });
  rmSync(tmpDir, { recursive: true, force: true });
});

function archiveFiles(id: string): Array<[string, string]> {
  const dir = join(sessionsDir, "archive");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith(`${id}_`))
    .sort()
    .map((name) => [name, readFileSync(join(dir, name), "utf-8")]);
}

/** The hook's own shell functions, as METADATA_UPDATER_SCRIPT defines them. */
function hookFunctions(): string {
  return ["hook_is_safe_branch", "hook_is_safe_pr", "update_metadata_key"]
    .map((name) => {
      const match = METADATA_UPDATER_SCRIPT.match(
        new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"),
      );
      if (!match) throw new Error(`missing hook function ${name}`);
      return match[0];
    })
    .join("\n");
}

describe("review r3 reproducer, M-1: a refused restore keeps a completed Claude Code hook write", () => {
  it("review attack: claude-pr", async () => {
    const wt = join(getWorktreesDir(config.configPath, config.projects["my-app"]!.path), "app-1");
    mkdirSync(wt, { recursive: true });
    writeMetadata(sessionsDir, "app-1", {
      project: "my-app",
      worktree: wt,
      branch: "feat/original",
      status: "killed",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    deleteMetadata(sessionsDir, "app-1", true);
    const archiveBefore = archiveFiles("app-1");
    const functionsPath = join(tmpDir, "hook-functions.sh");
    writeFileSync(functionsPath, hookFunctions());
    const sm = createSessionManager({ config, registry });
    let copyBack: Record<string, string> | null = null;
    let written: Record<string, string> | null = null;
    runtime.stop = vi.fn(async () => {
      copyBack = readMetadataRaw(sessionsDir, "app-1");
      // Throws unless bash exits 0.
      execFileSync(
        "/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-c",
          'metadata_file="$AO_DATA_DIR/$AO_SESSION"; source "$1"; update_metadata_key pr "$2"',
          "review",
          functionsPath,
          PR_URL,
        ],
        {
          env: {
            HOME: process.env["HOME"] ?? "",
            PATH: "/usr/bin:/bin",
            AO_DATA_DIR: sessionsDir,
            AO_SESSION: "app-1",
          },
          encoding: "utf8",
        },
      );
      written = readMetadataRaw(sessionsDir, "app-1");
      return { outcome: "unknown" as const, detail: "controlled refusal" };
    });

    const err = await sm.restore("app-1").catch((e: unknown) => e);

    expect((err as Error).message).toContain("runtime stop unconfirmed");
    expect(runtime.create).not.toHaveBeenCalled();
    expect(readMetadataRaw(sessionsDir, "app-1"), "completed writer lost").toEqual(written);
    // The hook wrote its value and kept the generation and the launch identity.
    expect(copyBack!["pr"]).toBeUndefined();
    expect(written!["pr"]).toBe(PR_URL);
    expect(written!["generation"]).toBe(copyBack!["generation"]);
    expect(written!["reservationId"]).toBe(copyBack!["reservationId"]);
    expect(archiveFiles("app-1"), "the archive changed").toEqual(archiveBefore);
    expect(existsSync(wt), "the worktree was removed").toBe(true);
    const message = (err as Error).message;
    expect(message).toContain(
      "the archive copy-back of this restore changed during the stop (another operation on the ID wrote to it), so it was kept as the active record of app-1 with that write and was not removed; this restore did not change the workspace, and no new runtime was created; check that record with `ao session ls` before you restore again, because a restore now reads the active record and not the archive",
    );
    expect(message).not.toContain("was removed again");
  });
});
