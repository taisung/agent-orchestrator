import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { spawn as spawnChild } from "node:child_process";
import { once } from "node:events";
import type * as OpenCodeApi from "../../opencode-api.js";
import {
  createOpenCodeSession,
  findOpenCodeSessionsByTitle,
  hasOpenCodeUserMessage,
  listOpenCodeSessionsByTitle,
  removeOpenCodeSession,
} from "../../opencode-api.js";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { validateConfig } from "../../config.js";
import { getStateRoot, getProjectBaseDir, getWorktreesDir } from "../../paths.js";
import {
  writeMetadata,
  readMetadata,
  readMetadataRaw,
  readArchivedMetadataRaw,
  updateMetadata,
} from "../../metadata.js";
import {
  type CleanupResult,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Agent,
  type AgentLaunchConfig,
  type AgentLaunchConfirmOptions,
  type AgentSessionPrepareContext,
  type OpenCodeAgentConfig,
  type PreparedAgentSession,
  type Session,
  type Workspace,
  type Tracker,
  SessionLaunchInProgressError,
} from "../../types.js";
import {
  setupTestContext,
  teardownTestContext,
  makeHandle,
  type TestContext,
} from "../test-utils.js";
import {
  installMockOpencode,
  installMockOpencodeApi,
  installMockGit,
  readMockApiEnvLog,
  readMockApiSessions,
  setMockApiUserMessages,
} from "./opencode-helpers.js";

// The title search stays real; the spies prove that no spawn path calls it
// (row 23, I-3).
vi.mock("../../opencode-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenCodeApi>();
  return {
    ...actual,
    findOpenCodeSessionsByTitle: vi.fn(actual.findOpenCodeSessionsByTitle),
    listOpenCodeSessionsByTitle: vi.fn(actual.listOpenCodeSessionsByTitle),
  };
});

let ctx: TestContext;
let tmpDir: string;
let sessionsDir: string;
let mockRuntime: Runtime;
let mockAgent: Agent;
let mockWorkspace: Workspace;
let mockRegistry: PluginRegistry;
let config: OrchestratorConfig;
let originalPath: string | undefined;

beforeEach(() => {
  vi.mocked(findOpenCodeSessionsByTitle).mockClear();
  vi.mocked(listOpenCodeSessionsByTitle).mockClear();
  ctx = setupTestContext();
  ({
    tmpDir,
    sessionsDir,
    mockRuntime,
    mockAgent,
    mockWorkspace,
    mockRegistry,
    config,
    originalPath,
  } = ctx);
});

afterEach(() => {
  teardownTestContext(ctx);
});

/**
 * The hooks of an `opencode` double, with the contract of the plugin (I-3):
 * `prepareAgentSession` creates `AO:<id>` through the real core helper
 * against the fake binary, with the pane environment that core gives it, or
 * takes the reused ID from `agentConfig`; `discard` removes only a session
 * that it created; `confirmLaunch` reads the session's `user` messages.
 * `log` records the order of the hook and runtime calls.
 */
function addOpenCodeHooks(agent: Agent, log: string[]): void {
  const environments = new Map<string, Record<string, string>>();
  agent.getEnvironment = vi.fn().mockImplementation((launch: AgentLaunchConfig) => ({
    AO_SESSION_ID: launch.sessionId,
    PATH: `/fake-home/.ao/bin:${process.env["PATH"] ?? ""}`,
  }));
  agent.prepareAgentSession = vi.fn(
    async (
      launch: AgentLaunchConfig,
      context: AgentSessionPrepareContext,
    ): Promise<PreparedAgentSession> => {
      log.push("prepare");
      const env = context.environment;
      const reused = (launch.projectConfig.agentConfig as OpenCodeAgentConfig | undefined)
        ?.opencodeSessionId;
      const id =
        reused ??
        (
          await createOpenCodeSession(
            { title: `AO:${launch.sessionId}`, location: { directory: context.workspacePath } },
            { env },
          )
        ).id;
      const created = reused === undefined;
      environments.set(id, env);
      return {
        metadata: { opencodeSessionId: id },
        agentConfig: { opencodeSessionId: id },
        created,
        discard: vi.fn(async () => {
          log.push(`discard:${id}`);
          if (created) await removeOpenCodeSession(id, undefined, env);
        }),
      };
    },
  );
  agent.confirmLaunch = vi.fn(
    async (
      _session: Session,
      prepared: PreparedAgentSession,
      options: AgentLaunchConfirmOptions,
    ) => {
      log.push("confirm");
      if (!options.promptExpected) return {};
      const id = prepared.metadata["opencodeSessionId"]!;
      const env = environments.get(id);
      return { promptDelivered: await hasOpenCodeUserMessage(id, env ? { env } : {}) };
    },
  );
}

/** A registry whose agent is an `opencode` double with the I-3 hooks; the other slots are the mocks. */
function openCodeRegistry(): { agent: Agent; registry: PluginRegistry; log: string[] } {
  const log: string[] = [];
  const agent: Agent = { ...mockAgent, name: "opencode" };
  addOpenCodeHooks(agent, log);
  const registry: PluginRegistry = {
    ...mockRegistry,
    get: vi.fn().mockImplementation((slot: string) => {
      if (slot === "runtime") return mockRuntime;
      if (slot === "agent") return agent;
      if (slot === "workspace") return mockWorkspace;
      return null;
    }),
  };
  return { agent, registry, log };
}

/** Make `my-app` an OpenCode project, with optional extra project config. */
function useOpenCodeProject(extra: Record<string, unknown> = {}): void {
  config = {
    ...config,
    defaults: { ...config.defaults, agent: "opencode" },
    projects: {
      ...config.projects,
      "my-app": {
        ...config.projects["my-app"],
        agent: "opencode",
        ...extra,
      },
    },
  };
}

/** The project base directory of `my-app`, where orchestrator prompt files live. */
function getProjectBaseDirForTest(): string {
  return getProjectBaseDir(config.configPath, config.projects["my-app"]!.path);
}

function captureStderr(): { lines: () => string; restore: () => void } {
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return {
    lines: () => spy.mock.calls.map((call) => String(call[0])).join(""),
    restore: () => spy.mockRestore(),
  };
}

describe("spawn", () => {
  it("creates a session with workspace, runtime, and agent", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawn({ projectId: "my-app" });

    expect(session.id).toBe("app-1");
    expect(session.status).toBe("spawning");
    expect(session.projectId).toBe("my-app");
    expect(session.runtimeHandle).toEqual(makeHandle("rt-1"));

    // Verify workspace was created
    expect(mockWorkspace.create).toHaveBeenCalled();
    // Verify agent launch command was requested
    expect(mockAgent.getLaunchCommand).toHaveBeenCalled();
    // Verify runtime was created
    expect(mockRuntime.create).toHaveBeenCalled();
  });

  it("rejects a configured workspace plugin that is not available before creating a runtime", async () => {
    config.projects["my-app"]!.workspace = "clone";
    const registryWithoutClone: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string, name: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace" && name === "worktree") return mockWorkspace;
        return null;
      }),
      list: vi.fn().mockImplementation((slot: string) =>
        slot === "workspace"
          ? [
              {
                name: "worktree",
                slot: "workspace",
                description: "Git worktree workspace",
                version: "0.0.0",
              },
            ]
          : [],
      ),
    };
    const sm = createSessionManager({ config, registry: registryWithoutClone });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow(
      'workspace "clone" is not available; available: worktree',
    );
    expect(mockRuntime.create).not.toHaveBeenCalled();
  });

  it("continues to spawn with the available worktree workspace plugin", async () => {
    config.projects["my-app"]!.workspace = "worktree";
    const registryWithWorktree: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string, name: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace" && name === "worktree") return mockWorkspace;
        return null;
      }),
    };
    const sm = createSessionManager({ config, registry: registryWithWorktree });

    await expect(sm.spawn({ projectId: "my-app" })).resolves.toMatchObject({
      workspacePath: "/tmp/ws",
    });
    expect(mockRuntime.create).toHaveBeenCalledOnce();
  });

  it("passes the resolved AO_STATE_ROOT to the spawned runtime", async () => {
    const previousStateRoot = process.env["AO_STATE_ROOT"];
    const rawStateRoot = `${tmpDir}/state/../custom-state`;

    try {
      process.env["AO_STATE_ROOT"] = rawStateRoot;
      const resolvedStateRoot = getStateRoot();
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.spawn({ projectId: "my-app" });

      const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCall.environment).toMatchObject({ AO_STATE_ROOT: resolvedStateRoot });
      expect(resolvedStateRoot).not.toBe(rawStateRoot);
    } finally {
      if (previousStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
      else process.env["AO_STATE_ROOT"] = previousStateRoot;
    }
  });

  it("propagates the parent PID-based test state root to child ao processes", async () => {
    const previousStateRoot = process.env["AO_STATE_ROOT"];
    const previousNodeEnv = process.env["NODE_ENV"];

    try {
      delete process.env["AO_STATE_ROOT"];
      process.env["NODE_ENV"] = "test";
      const parentStateRoot = getStateRoot();
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.spawn({ projectId: "my-app" });

      const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const propagatedStateRoot = createCall.environment["AO_STATE_ROOT"];
      expect(parentStateRoot).toContain(`ao-test-state-${process.pid}`);
      expect(propagatedStateRoot).toBe(parentStateRoot);

      process.env["AO_STATE_ROOT"] = propagatedStateRoot;
      expect(getStateRoot()).toBe(parentStateRoot);
    } finally {
      if (previousStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
      else process.env["AO_STATE_ROOT"] = previousStateRoot;
      if (previousNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previousNodeEnv;
    }
  });

  it("uses issue ID to derive branch name", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-100" });

    expect(session.branch).toBe("feat/INT-100");
    expect(session.issueId).toBe("INT-100");
  });

  it("sanitizes free-text issueId into a valid branch slug", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawn({ projectId: "my-app", issueId: "fix login bug" });

    expect(session.branch).toBe("feat/fix-login-bug");
  });

  it("preserves casing for branch-safe issue IDs without tracker", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-9999" });

    expect(session.branch).toBe("feat/INT-9999");
  });

  it("sanitizes issueId with special characters", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawn({
      projectId: "my-app",
      issueId: "Fix: user can't login (SSO)",
    });

    expect(session.branch).toBe("feat/fix-user-can-t-login-sso");
  });

  it("truncates long slugs to 60 characters", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawn({
      projectId: "my-app",
      issueId:
        "this is a very long issue description that should be truncated to sixty characters maximum",
    });

    expect(session.branch!.replace("feat/", "").length).toBeLessThanOrEqual(60);
  });

  it("does not leave trailing dash after truncation", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    // Craft input where the 60th char falls on a word boundary (dash)
    const session = await sm.spawn({
      projectId: "my-app",
      issueId: "ab ".repeat(30), // "ab ab ab ..." → "ab-ab-ab-..." truncated at 60
    });

    const slug = session.branch!.replace("feat/", "");
    expect(slug).not.toMatch(/-$/);
    expect(slug).not.toMatch(/^-/);
  });

  it("falls back to sessionId when issueId sanitizes to empty string", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawn({ projectId: "my-app", issueId: "!!!" });

    // Slug is empty after sanitization, falls back to sessionId
    expect(session.branch).toMatch(/^feat\/app-\d+$/);
  });

  it("sanitizes issueId containing '..' (invalid in git branch names)", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawn({ projectId: "my-app", issueId: "foo..bar" });

    // '..' is invalid in git refs, so it should be slugified
    expect(session.branch).toBe("feat/foo-bar");
  });

  it("uses tracker.branchName when tracker is available", async () => {
    const mockTracker: Tracker = {
      name: "mock-tracker",
      getIssue: vi.fn().mockResolvedValue({}),
      isCompleted: vi.fn().mockResolvedValue(false),
      issueUrl: vi.fn().mockReturnValue(""),
      branchName: vi.fn().mockReturnValue("custom/INT-100-my-feature"),
      generatePrompt: vi.fn().mockResolvedValue(""),
    };

    const registryWithTracker: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        if (slot === "tracker") return mockTracker;
        return null;
      }),
    };

    const sm = createSessionManager({
      config,
      registry: registryWithTracker,
    });

    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-100" });
    expect(session.branch).toBe("custom/INT-100-my-feature");
  });

  it("increments session numbers correctly", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    // Pre-create some metadata to simulate existing sessions
    writeMetadata(sessionsDir, "app-3", { worktree: "/tmp", branch: "b", status: "working" });
    writeMetadata(sessionsDir, "app-7", { worktree: "/tmp", branch: "b", status: "working" });

    const session = await sm.spawn({ projectId: "my-app" });
    expect(session.id).toBe("app-8");
  });

  it("does not reuse a killed session branch on recreate", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const first = await sm.spawn({ projectId: "my-app" });
    expect(first.id).toBe("app-1");
    expect(first.branch).toBe("session/app-1");

    await sm.kill(first.id);

    const second = await sm.spawn({ projectId: "my-app" });
    expect(second.id).toBe("app-2");
    expect(second.branch).toBe("session/app-2");
  });

  it("skips remote session branches when allocating a fresh session id", async () => {
    const mockGitBin = installMockGit(tmpDir, ["session/app-22"]);
    process.env.PATH = `${mockGitBin}:${originalPath ?? ""}`;
    mkdirSync(config.projects["my-app"]!.path, { recursive: true });

    const sm = createSessionManager({ config, registry: mockRegistry });
    const session = await sm.spawn({ projectId: "my-app" });

    expect(session.id).toBe("app-23");
    expect(session.branch).toBe("session/app-23");
  });

  it("writes metadata file", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

    const meta = readMetadata(sessionsDir, "app-1");
    expect(meta).not.toBeNull();
    expect(meta!.status).toBe("spawning");
    expect(meta!.project).toBe("my-app");
    expect(meta!.issue).toBe("INT-42");
  });

  it("reuses OpenCode session mapping by issue when available", async () => {
    // I-2: reuse verifies the stored ID via `session.get`; seed the mock so
    // the stored session exists.
    const mockBin = installMockOpencode(
      tmpDir,
      JSON.stringify([{ id: "ses_existing", title: "AO:app-9" }]),
      join(tmpDir, "opencode-delete-reuse.log"),
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();

    config = {
      ...config,
      defaults: { ...config.defaults, agent: "opencode" },
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"],
          agent: "opencode",
        },
      },
    };

    writeMetadata(sessionsDir, "app-9", {
      worktree: "/tmp/old",
      branch: "feat/INT-42",
      status: "killed",
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      createdAt: "2026-01-01T00:00:00.000Z",
      opencodeSessionId: "ses_existing",
    });

    const sm = createSessionManager({ config, registry: registryWithOpenCode });
    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

    expect(opencodeAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          agentConfig: expect.objectContaining({ opencodeSessionId: "ses_existing" }),
        }),
      }),
    );

    const metadata = readMetadataRaw(sessionsDir, session.id);
    expect(metadata?.["opencodeSessionId"]).toBe("ses_existing");
    // A reused session is switched, never created.
    const prepared = await vi.mocked(opencodeAgent.prepareAgentSession!).mock.results[0]!.value;
    expect(prepared.created).toBe(false);
  });

  it("does not replace a gone stored ID with a title match on issue reuse (row 24)", async () => {
    // D5: the stored ID 404s, and an older OpenCode session carries the title
    // of the old AO session. Reuse must not bind it. The new AO session stores
    // the OpenCode session that its own spawn creates (I-3).
    const mockBin = installMockOpencodeApi(tmpDir, [
      { id: "ses_title_match", title: "AO:app-9", directory: "/tmp/old", createdAt: 1 },
    ]);
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();
    useOpenCodeProject();

    writeMetadata(sessionsDir, "app-9", {
      worktree: "/tmp/old",
      branch: "feat/INT-42",
      status: "killed",
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      createdAt: "2026-01-01T00:00:00.000Z",
      opencodeSessionId: "ses_gone",
    });

    const sm = createSessionManager({ config, registry: registryWithOpenCode });
    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

    // No stored ID is reused: prepareAgentSession creates a new session.
    expect(opencodeAgent.prepareAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
        }),
      }),
      expect.anything(),
    );

    const metadata = readMetadataRaw(sessionsDir, session.id);
    expect(metadata?.["opencodeSessionId"]).toBe("ses_created_1");
  });

  it("does not reuse a stored ID that session.get cannot check (M-2 L)", async () => {
    // The stored session exists, but `session.get` fails (HTTP 500). Reuse
    // must not trust an unchecked ID; the spawn goes on without reuse.
    const mockBin = installMockOpencodeApi(
      tmpDir,
      [{ id: "ses_existing", title: "AO:app-9", directory: "/tmp/old", createdAt: 1 }],
      { failOperations: ["session.get"] },
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();
    useOpenCodeProject();

    writeMetadata(sessionsDir, "app-9", {
      worktree: "/tmp/old",
      branch: "feat/INT-42",
      status: "killed",
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      opencodeSessionId: "ses_existing",
    });

    const sm = createSessionManager({ config, registry: registryWithOpenCode });
    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

    // No stored ID is reused: prepareAgentSession creates a new session.
    expect(opencodeAgent.prepareAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
        }),
      }),
      expect.anything(),
    );
    expect(readMetadataRaw(sessionsDir, session.id)?.["opencodeSessionId"]).toBe("ses_created_1");
  });

  it("reuses most recent session-id candidate without relying on timestamps", async () => {
    const mockBin = installMockOpencode(
      tmpDir,
      JSON.stringify([
        { id: "ses_invalid_ts", title: "AO:app-1" },
        { id: "ses_valid_newer", title: "AO:app-2" },
      ]),
      join(tmpDir, "opencode-delete-reuse-newer.log"),
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();

    config = {
      ...config,
      defaults: { ...config.defaults, agent: "opencode" },
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"],
          agent: "opencode",
        },
      },
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp/old-no-ts",
      branch: "feat/INT-42",
      status: "killed",
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      opencodeSessionId: "ses_invalid_ts",
    });

    writeMetadata(sessionsDir, "app-2", {
      worktree: "/tmp/new-with-ts",
      branch: "feat/INT-42",
      status: "killed",
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      opencodeSessionId: "ses_valid_newer",
    });

    const sm = createSessionManager({ config, registry: registryWithOpenCode });
    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

    expect(opencodeAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          agentConfig: expect.objectContaining({ opencodeSessionId: "ses_valid_newer" }),
        }),
      }),
    );

    const metadata = readMetadataRaw(sessionsDir, session.id);
    expect(metadata?.["opencodeSessionId"]).toBe("ses_valid_newer");
  });

  it("does not reuse issue mapping when opencodeIssueSessionStrategy is ignore", async () => {
    const mockBin = installMockOpencodeApi(tmpDir, [
      { id: "ses_existing", title: "AO:app-9", directory: "/tmp/old", createdAt: 1 },
    ]);
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();
    useOpenCodeProject({ opencodeIssueSessionStrategy: "ignore" });

    writeMetadata(sessionsDir, "app-9", {
      worktree: "/tmp/old",
      branch: "feat/INT-42",
      status: "killed",
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      opencodeSessionId: "ses_existing",
    });

    const sm = createSessionManager({ config, registry: registryWithOpenCode });
    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

    // No stored ID is reused: prepareAgentSession creates a new session.
    expect(opencodeAgent.prepareAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
        }),
      }),
      expect.anything(),
    );

    // The strategy decides about older sessions only; the session that this
    // spawn created is still stored (I-3).
    const metadata = readMetadataRaw(sessionsDir, session.id);
    expect(metadata?.["opencodeSessionId"]).toBe("ses_created_1");
  });

  it("deletes old issue mappings and starts fresh when opencodeIssueSessionStrategy is delete", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-issue.log");
    const mockBin = installMockOpencodeApi(
      tmpDir,
      [
        { id: "ses_old_1", title: "AO:app-8", directory: "/tmp/old1", createdAt: 1 },
        { id: "ses_old_2", title: "AO:app-9", directory: "/tmp/old2", createdAt: 2 },
      ],
      { deleteLogPath },
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();
    useOpenCodeProject({ opencodeIssueSessionStrategy: "delete" });

    writeMetadata(sessionsDir, "app-8", {
      worktree: "/tmp/old1",
      branch: "feat/INT-42",
      status: "killed",
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      opencodeSessionId: "ses_old_1",
      runtimeHandle: JSON.stringify(makeHandle("old-1")),
    });
    writeMetadata(sessionsDir, "app-9", {
      worktree: "/tmp/old2",
      branch: "feat/INT-42",
      status: "killed",
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      opencodeSessionId: "ses_old_2",
      runtimeHandle: JSON.stringify(makeHandle("old-2")),
    });

    vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
    vi.mocked(opencodeAgent.isProcessRunning).mockResolvedValue(false);
    const sm = createSessionManager({ config, registry: registryWithOpenCode });
    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

    const deleteLog = readFileSync(deleteLogPath, "utf-8");
    expect(deleteLog).toContain("session.remove");
    expect(deleteLog).toContain("sessionID=ses_old_1");
    expect(deleteLog).toContain("sessionID=ses_old_2");
    expect(deleteLog).not.toContain("sessionID=ses_created_1");

    // No stored ID is reused: prepareAgentSession creates a new session.
    expect(opencodeAgent.prepareAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
        }),
      }),
      expect.anything(),
    );

    const metadata = readMetadataRaw(sessionsDir, session.id);
    expect(metadata?.["opencodeSessionId"]).toBe("ses_created_1");
  });

  it("keeps an old issue mapping that another live session uses on delete (m-4)", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-issue-shared.log");
    const mockBin = installMockOpencodeApi(
      tmpDir,
      [{ id: "ses_shared", title: "AO:app-8", directory: "/tmp/old1", createdAt: 1 }],
      { deleteLogPath },
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    const { registry: registryWithOpenCode } = openCodeRegistry();
    useOpenCodeProject({ opencodeIssueSessionStrategy: "delete" });

    writeMetadata(sessionsDir, "app-8", {
      worktree: "/tmp/old1",
      branch: "feat/INT-42",
      status: "working",
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      opencodeSessionId: "ses_shared",
    });

    const sm = createSessionManager({ config, registry: registryWithOpenCode });
    await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

    expect(existsSync(deleteLogPath)).toBe(false);
  });

  describe("OpenCode session prepared before the pane (I-3)", () => {
    /** A worker workspace inside the managed worktree root, so a failed spawn destroys it. */
    function managedWorkspace(): string {
      const project = config.projects["my-app"]!;
      const path = join(getWorktreesDir(config.configPath, project.path), "app-1");
      mkdirSync(path, { recursive: true });
      vi.mocked(mockWorkspace.create).mockResolvedValue({
        path,
        branch: "session/app-1",
        sessionId: "app-1",
        projectId: "my-app",
      });
      return path;
    }

    /** The session record as `runtime.create` sees it, and the call order. */
    function recordRuntimeCreate(log: string[]): {
      recordAtCreate: () => Record<string, string> | null;
    } {
      let recordAtCreate: Record<string, string> | null = null;
      vi.mocked(mockRuntime.create).mockImplementation(async (rtConfig) => {
        log.push("runtime.create");
        recordAtCreate = readMetadataRaw(sessionsDir, rtConfig.environment["AO_SESSION"]!);
        return makeHandle(rtConfig.sessionId);
      });
      return { recordAtCreate: () => recordAtCreate };
    }

    it("creates and stores the session before runtime.create, then confirms the launch", async () => {
      const mockBin = installMockOpencodeApi(tmpDir, []);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry, log } = openCodeRegistry();
      const runtime = recordRuntimeCreate(log);
      agent.postLaunchSetup = vi.fn(async () => {
        log.push("postLaunchSetup");
      });
      useOpenCodeProject();

      const sm = createSessionManager({ config, registry });
      const session = await sm.spawn({ projectId: "my-app" });

      expect(log).toEqual(["prepare", "runtime.create", "postLaunchSetup", "confirm"]);
      // An `ao spawn` that dies after the pane starts leaves a record that
      // names the session it created.
      expect(runtime.recordAtCreate()).toMatchObject({
        opencodeSessionId: "ses_created_1",
        agent: "opencode",
        status: "spawning",
      });
      expect(agent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          projectConfig: expect.objectContaining({
            agentConfig: expect.objectContaining({ opencodeSessionId: "ses_created_1" }),
          }),
        }),
      );
      expect(session.metadata["opencodeSessionId"]).toBe("ses_created_1");
      const stored = readMetadataRaw(sessionsDir, session.id);
      expect(stored?.["opencodeSessionId"]).toBe("ses_created_1");
      const runtimeName = vi.mocked(mockRuntime.create).mock.calls[0]![0].sessionId;
      expect(stored?.["runtimeHandle"]).toBe(JSON.stringify(makeHandle(runtimeName)));
      expect(readMockApiSessions(mockBin).map((entry) => entry.title)).toEqual([
        `AO:${session.id}`,
      ]);
    });

    it("gives prepareAgentSession the pane environment, and every opencode api call of the spawn runs with it", async () => {
      const envLogPath = join(tmpDir, "opencode-env.log");
      const mockBin = installMockOpencodeApi(tmpDir, [], { envLogPath });
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject();
      // The `ao` process of an orchestrator carries the orchestrator's AO_* values.
      const saved = { session: process.env["AO_SESSION"], caller: process.env["AO_CALLER_TYPE"] };
      process.env["AO_SESSION"] = "orchestrator-real";
      process.env["AO_CALLER_TYPE"] = "orchestrator";
      try {
        const sm = createSessionManager({ config, registry });
        const session = await sm.spawn({ projectId: "my-app" });

        const context = vi.mocked(agent.prepareAgentSession!).mock.calls[0]![1];
        const paneEnvironment = vi.mocked(mockRuntime.create).mock.calls[0]![0].environment;
        expect(context.environment).toEqual(paneEnvironment);
        expect(context.environment["AO_SESSION"]).toBe(session.id);
        expect(context.environment["PATH"]).toMatch(/^\/fake-home\/\.ao\/bin:/);

        const calls = readMockApiEnvLog(envLogPath);
        expect(calls.map((call) => call.op)).toEqual(["session.create", "session.message.list"]);
        for (const call of calls) {
          expect(call.env["AO_SESSION"]).toBe(session.id);
          expect(call.env["AO_CALLER_TYPE"]).toBe("agent");
          expect(call.env["AO_SESSION_ID"]).toBe(session.id);
          expect(call.env["PATH"]).toMatch(/^\/fake-home\/\.ao\/bin:/);
        }
      } finally {
        for (const [key, value] of [
          ["AO_SESSION", saved.session],
          ["AO_CALLER_TYPE", saved.caller],
        ] as const) {
          if (value === undefined) Reflect.deleteProperty(process.env, key);
          else process.env[key] = value;
        }
      }
    });

    it("fails the spawn when the create fails: no runtime.create, reservation gone, workspace destroyed", async () => {
      const mockBin = installMockOpencodeApi(tmpDir, [], { failOperations: ["session.create"] });
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { registry } = openCodeRegistry();
      useOpenCodeProject();
      const workspace = managedWorkspace();

      const sm = createSessionManager({ config, registry });
      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow(/session.create failed/);

      expect(mockRuntime.create).not.toHaveBeenCalled();
      expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
      expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toBeNull();
      expect(mockWorkspace.destroy).toHaveBeenCalledWith(workspace);
    });

    it("fails the spawn on a dead pane and removes only the session that it created", async () => {
      const deleteLogPath = join(tmpDir, "opencode-delete-dead-pane.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_other", title: "AO:app-1", directory: "/tmp/ws", createdAt: 1 }],
        { deleteLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry, log } = openCodeRegistry();
      vi.mocked(mockRuntime.destroy).mockImplementation(async () => {
        log.push("runtime.destroy");
      });
      agent.confirmLaunch = vi.fn(async () => {
        log.push("confirm");
        throw new Error("the pane of app-1 did not run OpenCode on session ses_created_1");
      });
      useOpenCodeProject();
      const workspace = managedWorkspace();

      const sm = createSessionManager({ config, registry });
      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow(/did not run OpenCode/);

      // The runtime goes first, so no pane uses the session that is removed.
      expect(log).toEqual(["prepare", "confirm", "runtime.destroy", "discard:ses_created_1"]);
      expect(readFileSync(deleteLogPath, "utf-8").trim().split("\n")).toEqual([
        "api session.remove --param sessionID=ses_created_1",
      ]);
      expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_other"]);
      expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
      expect(mockWorkspace.destroy).toHaveBeenCalledWith(workspace);
    });

    it.each(["runtime.create", "postLaunchSetup"] as const)(
      "removes the created session when %s fails",
      async (stage) => {
        const deleteLogPath = join(tmpDir, `opencode-delete-${stage}.log`);
        const mockBin = installMockOpencodeApi(tmpDir, [], { deleteLogPath });
        process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
        const { agent, registry } = openCodeRegistry();
        if (stage === "runtime.create") {
          vi.mocked(mockRuntime.create).mockRejectedValueOnce(new Error("runtime failed"));
        } else {
          agent.postLaunchSetup = vi.fn().mockRejectedValue(new Error("setup failed"));
        }
        useOpenCodeProject();

        const sm = createSessionManager({ config, registry });
        await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow(/failed/);

        expect(readFileSync(deleteLogPath, "utf-8")).toContain("sessionID=ses_created_1");
        expect(readMockApiSessions(mockBin)).toEqual([]);
        expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
        expect(agent.confirmLaunch).not.toHaveBeenCalled();
      },
    );

    it("never removes a reused session when the launch fails", async () => {
      const deleteLogPath = join(tmpDir, "opencode-delete-reused.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_reused", title: "AO:app-9", directory: "/tmp/old", createdAt: 1 }],
        { deleteLogPath, interruptLogPath: join(tmpDir, "opencode-interrupt-reused.log") },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      agent.confirmLaunch = vi.fn().mockRejectedValue(new Error("pane is gone"));
      useOpenCodeProject();
      writeMetadata(sessionsDir, "app-9", {
        worktree: "/tmp/old",
        branch: "feat/INT-42",
        status: "killed",
        project: "my-app",
        issue: "INT-42",
        agent: "opencode",
        opencodeSessionId: "ses_reused",
      });

      const sm = createSessionManager({ config, registry });
      await expect(sm.spawn({ projectId: "my-app", issueId: "INT-42" })).rejects.toThrow(
        "pane is gone",
      );

      const prepared = await vi.mocked(agent.prepareAgentSession!).mock.results[0]!.value;
      expect(prepared.created).toBe(false);
      expect(prepared.discard).toHaveBeenCalledTimes(1);
      expect(existsSync(deleteLogPath)).toBe(false);
      expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_reused"]);
      // The older record that stores the reused ID stays.
      expect(readMetadataRaw(sessionsDir, "app-9")?.["opencodeSessionId"]).toBe("ses_reused");
    });

    it("runs no title search during the spawn", async () => {
      const apiLogPath = join(tmpDir, "opencode-api-no-title.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_older_here", title: "AO:app-1", directory: "/tmp/ws", createdAt: 1 }],
        { apiLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { registry } = openCodeRegistry();
      useOpenCodeProject();

      const sm = createSessionManager({ config, registry });
      const session = await sm.spawn({ projectId: "my-app" });

      expect(session.metadata["opencodeSessionId"]).toBe("ses_created_1");
      expect(findOpenCodeSessionsByTitle).not.toHaveBeenCalled();
      expect(listOpenCodeSessionsByTitle).not.toHaveBeenCalled();
      expect(readFileSync(apiLogPath, "utf-8")).not.toContain("session.list");
    });

    it("stores promptDelivered=true only after the session shows a user message", async () => {
      const mockBin = installMockOpencodeApi(tmpDir, []);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { registry } = openCodeRegistry();
      useOpenCodeProject();
      // The pane's TUI submits the launch prompt: one user message appears.
      vi.mocked(mockRuntime.create).mockImplementation(async (rtConfig) => {
        setMockApiUserMessages(mockBin, "ses_created_1", 1);
        return makeHandle(rtConfig.sessionId);
      });

      const sm = createSessionManager({ config, registry });
      const session = await sm.spawn({ projectId: "my-app" });

      expect(session.metadata["promptDelivered"]).toBe("true");
      expect(readMetadataRaw(sessionsDir, session.id)?.["promptDelivered"]).toBe("true");
    });

    it("stores promptDelivered=false and tells the operator when no user message shows", async () => {
      const mockBin = installMockOpencodeApi(tmpDir, []);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { registry } = openCodeRegistry();
      useOpenCodeProject();
      const stderr = captureStderr();

      try {
        const sm = createSessionManager({ config, registry });
        const session = await sm.spawn({ projectId: "my-app" });

        expect(session.status).toBe("spawning");
        expect(session.metadata["promptDelivered"]).toBe("false");
        expect(readMetadataRaw(sessionsDir, session.id)?.["promptDelivered"]).toBe("false");
        const lines = stderr.lines().trim().split("\n");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("app-1 runs, but its launch prompt did not show");
        expect(lines[0]).toContain("ao send app-1");
      } finally {
        stderr.restore();
      }
    });

    it("keeps the spawn order of an agent without the hooks", async () => {
      const order: string[] = [];
      let recordAtCreate: Record<string, string> | null = null;
      vi.mocked(mockAgent.getLaunchCommand).mockImplementation(() => {
        order.push("getLaunchCommand");
        return "mock-agent --start";
      });
      vi.mocked(mockAgent.getEnvironment).mockImplementation(() => {
        order.push("getEnvironment");
        return { AGENT_VAR: "1" };
      });
      vi.mocked(mockRuntime.create).mockImplementation(async (rtConfig) => {
        order.push("runtime.create");
        recordAtCreate = readMetadataRaw(sessionsDir, "app-1");
        return makeHandle(rtConfig.sessionId);
      });

      const sm = createSessionManager({ config, registry: mockRegistry });
      const session = await sm.spawn({ projectId: "my-app", prompt: "Go" });

      expect(order).toEqual(["getLaunchCommand", "getEnvironment", "runtime.create"]);
      // The record is still the empty reservation when the pane starts.
      expect(recordAtCreate).toEqual({});
      expect(session.metadata["promptDelivered"]).toBe("true");
    });
  });

  it("throws for unknown project", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });
    await expect(sm.spawn({ projectId: "nonexistent" })).rejects.toThrow("Unknown project");
  });

  it("throws when runtime plugin is missing", async () => {
    const emptyRegistry: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockReturnValue(null),
    };

    const sm = createSessionManager({ config, registry: emptyRegistry });
    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("not found");
  });

  describe("agent override", () => {
    let mockCodexAgent: Agent;
    let registryWithMultipleAgents: PluginRegistry;

    beforeEach(() => {
      mockCodexAgent = {
        name: "codex",
        processName: "codex",
        getLaunchCommand: vi.fn().mockReturnValue("codex --start"),
        getEnvironment: vi.fn().mockReturnValue({ CODEX_VAR: "1" }),
        detectActivity: vi.fn().mockReturnValue("active"),
        getActivityState: vi.fn().mockResolvedValue(null),
        isProcessRunning: vi.fn().mockResolvedValue(true),
        getSessionInfo: vi.fn().mockResolvedValue(null),
      };

      registryWithMultipleAgents = {
        ...mockRegistry,
        get: vi.fn().mockImplementation((slot: string, name: string) => {
          if (slot === "runtime") return mockRuntime;
          if (slot === "agent") {
            if (name === "mock-agent") return mockAgent;
            if (name === "codex") return mockCodexAgent;
            return null;
          }
          if (slot === "workspace") return mockWorkspace;
          return null;
        }),
      };
    });

    it("uses overridden agent when spawnConfig.agent is provided", async () => {
      const sm = createSessionManager({ config, registry: registryWithMultipleAgents });

      await sm.spawn({ projectId: "my-app", agent: "codex" });

      expect(mockCodexAgent.getLaunchCommand).toHaveBeenCalled();
      expect(mockAgent.getLaunchCommand).not.toHaveBeenCalled();
    });

    it("throws when agent override plugin is not found", async () => {
      const sm = createSessionManager({ config, registry: registryWithMultipleAgents });

      await expect(sm.spawn({ projectId: "my-app", agent: "nonexistent" })).rejects.toThrow(
        "Agent plugin 'nonexistent' not found",
      );
    });

    it("uses default agent when no override specified", async () => {
      const sm = createSessionManager({ config, registry: registryWithMultipleAgents });

      await sm.spawn({ projectId: "my-app" });

      expect(mockAgent.getLaunchCommand).toHaveBeenCalled();
      expect(mockCodexAgent.getLaunchCommand).not.toHaveBeenCalled();
    });

    it("persists agent name in metadata when override is used", async () => {
      const sm = createSessionManager({ config, registry: registryWithMultipleAgents });

      await sm.spawn({ projectId: "my-app", agent: "codex" });

      const meta = readMetadataRaw(sessionsDir, "app-1");
      expect(meta).not.toBeNull();
      expect(meta!["agent"]).toBe("codex");
    });

    it("persists default agent name in metadata when no override", async () => {
      const sm = createSessionManager({ config, registry: registryWithMultipleAgents });

      await sm.spawn({ projectId: "my-app" });

      const meta = readMetadataRaw(sessionsDir, "app-1");
      expect(meta).not.toBeNull();
      expect(meta!["agent"]).toBe("mock-agent");
    });

    it("uses project worker agent when configured and no spawn override is provided", async () => {
      const configWithWorkerAgent: OrchestratorConfig = {
        ...config,
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            agent: "mock-agent",
            worker: {
              agent: "codex",
            },
          },
        },
      };

      const sm = createSessionManager({
        config: configWithWorkerAgent,
        registry: registryWithMultipleAgents,
      });
      await sm.spawn({ projectId: "my-app" });

      expect(mockCodexAgent.getLaunchCommand).toHaveBeenCalled();
      expect(mockAgent.getLaunchCommand).not.toHaveBeenCalled();
      expect(readMetadataRaw(sessionsDir, "app-1")?.["agent"]).toBe("codex");
    });

    it("uses defaults worker agent when project agent is not set", async () => {
      const configWithDefaultWorkerAgent: OrchestratorConfig = {
        ...config,
        defaults: {
          ...config.defaults,
          worker: {
            agent: "codex",
          },
        },
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            agent: undefined,
          },
        },
      };

      const sm = createSessionManager({
        config: configWithDefaultWorkerAgent,
        registry: registryWithMultipleAgents,
      });
      await sm.spawn({ projectId: "my-app" });

      expect(mockCodexAgent.getLaunchCommand).toHaveBeenCalled();
      expect(readMetadataRaw(sessionsDir, "app-1")?.["agent"]).toBe("codex");
    });

    it("readMetadata returns agent field (typed SessionMetadata)", async () => {
      const sm = createSessionManager({ config, registry: registryWithMultipleAgents });

      await sm.spawn({ projectId: "my-app", agent: "codex" });

      const meta = readMetadata(sessionsDir, "app-1");
      expect(meta).not.toBeNull();
      expect(meta!.agent).toBe("codex");
    });
  });

  describe("model override", () => {
    it("uses overridden model when spawnConfig.model is provided", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.spawn({ projectId: "my-app", model: "gpt-5.6-terra" });

      expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gpt-5.6-terra" }),
      );
    });

    it("emits no model when neither override nor config specify one", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.spawn({ projectId: "my-app" });

      expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ model: undefined }),
      );
    });

    it("uses configured worker model when no spawn override is provided", async () => {
      const configWithWorkerModel: OrchestratorConfig = {
        ...config,
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            worker: {
              agentConfig: { model: "sonnet" },
            },
          },
        },
      };

      const sm = createSessionManager({ config: configWithWorkerModel, registry: mockRegistry });
      await sm.spawn({ projectId: "my-app" });

      expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ model: "sonnet" }),
      );
    });

    it("prefers spawn model override over configured model — backwards compatible with no override", async () => {
      const configWithWorkerModel: OrchestratorConfig = {
        ...config,
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            worker: {
              agentConfig: { model: "sonnet" },
            },
          },
        },
      };

      const sm = createSessionManager({ config: configWithWorkerModel, registry: mockRegistry });

      // Explicit override wins over config.
      await sm.spawn({ projectId: "my-app", model: "gpt-5.6-terra" });
      expect(mockAgent.getLaunchCommand).toHaveBeenLastCalledWith(
        expect.objectContaining({ model: "gpt-5.6-terra" }),
      );

      // Absent --model, behavior is unchanged: falls back to config.
      await sm.spawn({ projectId: "my-app" });
      expect(mockAgent.getLaunchCommand).toHaveBeenLastCalledWith(
        expect.objectContaining({ model: "sonnet" }),
      );
    });
  });

  it("forwards configured subagent to spawn launch when no override is provided", async () => {
    const configWithSubagent: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"],
          agentConfig: {
            subagent: "oracle",
          },
        },
      },
    };

    const sm = createSessionManager({
      config: configWithSubagent,
      registry: mockRegistry,
    });
    await sm.spawn({ projectId: "my-app" });

    expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ subagent: "oracle" }),
    );
  });

  it("prefers spawn subagent override over configured subagent", async () => {
    const configWithSubagent: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"],
          agentConfig: {
            subagent: "oracle",
          },
        },
      },
    };

    const sm = createSessionManager({
      config: configWithSubagent,
      registry: mockRegistry,
    });
    await sm.spawn({ projectId: "my-app", subagent: "librarian" });

    expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ subagent: "librarian" }),
    );
  });

  it("validates issue exists when issueId provided", async () => {
    const mockTracker: Tracker = {
      name: "mock-tracker",
      getIssue: vi.fn().mockResolvedValue({
        id: "INT-100",
        title: "Test issue",
        description: "Test description",
        url: "https://linear.app/test/issue/INT-100",
        state: "open",
        labels: [],
      }),
      isCompleted: vi.fn().mockResolvedValue(false),
      issueUrl: vi.fn().mockReturnValue("https://linear.app/test/issue/INT-100"),
      branchName: vi.fn().mockReturnValue("feat/INT-100"),
      generatePrompt: vi.fn().mockResolvedValue("Work on INT-100"),
    };

    const registryWithTracker: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        if (slot === "tracker") return mockTracker;
        return null;
      }),
    };

    const sm = createSessionManager({
      config,
      registry: registryWithTracker,
    });

    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-100" });

    expect(mockTracker.getIssue).toHaveBeenCalledWith("INT-100", config.projects["my-app"]);
    expect(session.issueId).toBe("INT-100");
  });

  it("succeeds with ad-hoc issue string when tracker returns IssueNotFoundError", async () => {
    const mockTracker: Tracker = {
      name: "mock-tracker",
      getIssue: vi.fn().mockRejectedValue(new Error("Issue INT-9999 not found")),
      isCompleted: vi.fn().mockResolvedValue(false),
      issueUrl: vi.fn().mockReturnValue(""),
      branchName: vi.fn().mockReturnValue("feat/INT-9999"),
      generatePrompt: vi.fn().mockResolvedValue(""),
    };

    const registryWithTracker: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        if (slot === "tracker") return mockTracker;
        return null;
      }),
    };

    const sm = createSessionManager({
      config,
      registry: registryWithTracker,
    });

    // Ad-hoc issue string should succeed — IssueNotFoundError is gracefully ignored
    const session = await sm.spawn({ projectId: "my-app", issueId: "INT-9999" });

    expect(session.issueId).toBe("INT-9999");
    expect(session.branch).toBe("feat/INT-9999");
    // tracker.branchName and generatePrompt should NOT be called when issue wasn't resolved
    expect(mockTracker.branchName).not.toHaveBeenCalled();
    expect(mockTracker.generatePrompt).not.toHaveBeenCalled();
    // Workspace and runtime should still be created
    expect(mockWorkspace.create).toHaveBeenCalled();
    expect(mockRuntime.create).toHaveBeenCalled();
  });

  it("succeeds with ad-hoc free-text when tracker returns 'invalid issue format'", async () => {
    const mockTracker: Tracker = {
      name: "mock-tracker",
      getIssue: vi.fn().mockRejectedValue(new Error("invalid issue format: fix login bug")),
      isCompleted: vi.fn().mockResolvedValue(false),
      issueUrl: vi.fn().mockReturnValue(""),
      branchName: vi.fn().mockReturnValue(""),
      generatePrompt: vi.fn().mockResolvedValue(""),
    };

    const registryWithTracker: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        if (slot === "tracker") return mockTracker;
        return null;
      }),
    };

    const sm = createSessionManager({
      config,
      registry: registryWithTracker,
    });

    const session = await sm.spawn({ projectId: "my-app", issueId: "fix login bug" });

    expect(session.issueId).toBe("fix login bug");
    expect(session.branch).toBe("feat/fix-login-bug");
    expect(mockTracker.branchName).not.toHaveBeenCalled();
    expect(mockWorkspace.create).toHaveBeenCalled();
  });

  it("fails on tracker auth errors", async () => {
    const mockTracker: Tracker = {
      name: "mock-tracker",
      getIssue: vi.fn().mockRejectedValue(new Error("Unauthorized")),
      isCompleted: vi.fn().mockResolvedValue(false),
      issueUrl: vi.fn().mockReturnValue(""),
      branchName: vi.fn().mockReturnValue("feat/INT-100"),
      generatePrompt: vi.fn().mockResolvedValue(""),
    };

    const registryWithTracker: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        if (slot === "tracker") return mockTracker;
        return null;
      }),
    };

    const sm = createSessionManager({
      config,
      registry: registryWithTracker,
    });

    await expect(sm.spawn({ projectId: "my-app", issueId: "INT-100" })).rejects.toThrow(
      "Failed to fetch issue",
    );

    // Should not create workspace or runtime when auth fails
    expect(mockWorkspace.create).not.toHaveBeenCalled();
    expect(mockRuntime.create).not.toHaveBeenCalled();
  });

  it("spawns without issue tracking when no issueId provided", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawn({ projectId: "my-app" });

    expect(session.issueId).toBeNull();
    // Uses session/{sessionId} to avoid conflicts with default branch
    expect(session.branch).toMatch(/^session\/app-\d+$/);
    expect(session.branch).not.toBe("main");
  });

  it("sends prompt post-launch when agent.promptDelivery is 'post-launch'", async () => {
    vi.useFakeTimers();
    const postLaunchAgent = {
      ...mockAgent,
      promptDelivery: "post-launch" as const,
    };
    const registryWithPostLaunch: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return postLaunchAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    const sm = createSessionManager({ config, registry: registryWithPostLaunch });
    const spawnPromise = sm.spawn({ projectId: "my-app", prompt: "Fix the bug" });
    await vi.advanceTimersByTimeAsync(5_000);
    await spawnPromise;

    // Prompt should be sent via runtime.sendMessage, not included in launch command
    expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String) }),
      expect.stringContaining("Fix the bug"),
    );
    vi.useRealTimers();
  });

  it("does not send prompt post-launch when agent.promptDelivery is not set", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.spawn({ projectId: "my-app", prompt: "Fix the bug" });

    // Default agent (no promptDelivery) should NOT trigger sendMessage for prompt
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
  });

  it("sends AO guidance post-launch even when no explicit prompt is provided", async () => {
    vi.useFakeTimers();
    const postLaunchAgent = {
      ...mockAgent,
      promptDelivery: "post-launch" as const,
    };
    const registryWithPostLaunch: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return postLaunchAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    const sm = createSessionManager({ config, registry: registryWithPostLaunch });
    const spawnPromise = sm.spawn({ projectId: "my-app" });
    await vi.advanceTimersByTimeAsync(5_000);
    await spawnPromise;

    expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String) }),
      expect.stringContaining("ao session claim-pr"),
    );
    vi.useRealTimers();
  });

  it("does not destroy session when post-launch prompt delivery fails", async () => {
    vi.useFakeTimers();
    const failingRuntime: Runtime = {
      ...mockRuntime,
      sendMessage: vi.fn().mockRejectedValue(new Error("tmux send failed")),
    };
    const postLaunchAgent = {
      ...mockAgent,
      promptDelivery: "post-launch" as const,
    };
    const registryWithFailingSend: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return failingRuntime;
        if (slot === "agent") return postLaunchAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    const sm = createSessionManager({ config, registry: registryWithFailingSend });
    const spawnPromise = sm.spawn({ projectId: "my-app", prompt: "Fix the bug" });
    // With retry logic (3 attempts at 3s, 6s, 9s delays before each attempt), need to advance 18s for all retries
    await vi.advanceTimersByTimeAsync(18_000);
    const session = await spawnPromise;

    // Session should still be returned successfully despite sendMessage failure
    expect(session.id).toBe("app-1");
    expect(session.status).toBe("spawning");
    // Runtime should NOT have been destroyed
    expect(failingRuntime.destroy).not.toHaveBeenCalled();
    // Verify promptDelivered is set to false in metadata
    expect(session.metadata.promptDelivered).toBe("false");
    vi.useRealTimers();
  }, 30_000);

  it("waits before sending post-launch prompt", async () => {
    vi.useFakeTimers();
    const postLaunchAgent = {
      ...mockAgent,
      promptDelivery: "post-launch" as const,
    };
    const registryWithPostLaunch: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return postLaunchAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    const sm = createSessionManager({ config, registry: registryWithPostLaunch });
    const spawnPromise = sm.spawn({ projectId: "my-app", prompt: "Fix the bug" });

    // Advance only 2s — not enough, message should not have been sent yet
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();

    // Advance the remaining 1s — now the first attempt should fire (3s total = 3000 * 1)
    await vi.advanceTimersByTimeAsync(1_000);
    await spawnPromise;
    expect(mockRuntime.sendMessage).toHaveBeenCalled();
    vi.useRealTimers();
  }, 20_000);

  describe("spawnOrchestrator", () => {
    it("throws when no workspace plugin is configured", async () => {
      const registryNoWorkspace: PluginRegistry = {
        ...mockRegistry,
        get: vi.fn().mockImplementation((slot: string) => {
          if (slot === "runtime") return mockRuntime;
          if (slot === "agent") return mockAgent;
          return null; // no workspace plugin
        }),
      };
      const sm = createSessionManager({ config, registry: registryNoWorkspace });

      await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
        "spawnOrchestrator requires a workspace plugin",
      );

      // Reserved session metadata should be cleaned up
      expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")).toBeNull();
      expect(mockRuntime.create).not.toHaveBeenCalled();
    });

    it("supports legacy project-root orchestrator mode", async () => {
      config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
      const sm = createSessionManager({ config, registry: mockRegistry });

      const session = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(session.id).toBe("app-orchestrator");
      expect(session.status).toBe("working");
      expect(session.projectId).toBe("my-app");
      expect(session.branch).toBe("main");
      expect(session.workspacePath).toBe(config.projects["my-app"]!.path);
      expect(mockWorkspace.create).not.toHaveBeenCalled();
      expect(mockRuntime.create).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: config.projects["my-app"]!.path }),
      );

      const meta = readMetadataRaw(sessionsDir, "app-orchestrator");
      expect(meta?.["branch"]).toBe("main");
      expect(meta?.["worktree"]).toBe(config.projects["my-app"]!.path);
      expect(meta?.["role"]).toBe("orchestrator");
    });

    it("allows project-root orchestrator mode without a workspace plugin", async () => {
      config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
      const registryNoWorkspace: PluginRegistry = {
        ...mockRegistry,
        get: vi.fn().mockImplementation((slot: string) => {
          if (slot === "runtime") return mockRuntime;
          if (slot === "agent") return mockAgent;
          return null;
        }),
      };
      const sm = createSessionManager({ config, registry: registryNoWorkspace });

      const session = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(session.id).toBe("app-orchestrator");
      expect(session.workspacePath).toBe(config.projects["my-app"]!.path);
      expect(mockRuntime.create).toHaveBeenCalled();
    });

    it("reuses an existing project-root orchestrator when strategy is reuse", async () => {
      config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
      config.projects["my-app"]!.orchestratorSessionStrategy = "reuse";
      writeMetadata(sessionsDir, "app-orchestrator", {
        worktree: config.projects["my-app"]!.path,
        branch: "main",
        status: "working",
        role: "orchestrator",
        project: "my-app",
        runtimeHandle: JSON.stringify(makeHandle("rt-existing")),
      });
      const sm = createSessionManager({ config, registry: mockRegistry });

      const session = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(session.id).toBe("app-orchestrator");
      expect(session.metadata["orchestratorSessionReused"]).toBe("true");
      expect(mockRuntime.create).not.toHaveBeenCalled();
      expect(mockWorkspace.create).not.toHaveBeenCalled();
    });

    it("creates orchestrator session with correct ID", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      const session = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(session.id).toBe("app-orchestrator-1");
      expect(session.status).toBe("working");
      expect(session.projectId).toBe("my-app");
      expect(session.branch).toBe("orchestrator/app-orchestrator-1");
      expect(session.issueId).toBeNull();
      expect(session.workspacePath).toBe("/tmp/ws");
    });

    it("creates a worktree with an orchestrator branch", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(mockWorkspace.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "app-orchestrator-1",
          branch: "orchestrator/app-orchestrator-1",
          projectId: "my-app",
        }),
      );
    });

    it("uses the worktree path returned by the workspace plugin", async () => {
      const worktreePath = join(tmpDir, "orchestrator-ws");
      (mockWorkspace.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        path: worktreePath,
        branch: "orchestrator/app-orchestrator-1",
        sessionId: "app-orchestrator-1",
        projectId: "my-app",
      });
      const sm = createSessionManager({ config, registry: mockRegistry });

      const session = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(session.workspacePath).toBe(worktreePath);
      expect(session.branch).toBe("orchestrator/app-orchestrator-1");
    });

    it("writes metadata with proper fields", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.spawnOrchestrator({ projectId: "my-app" });

      const meta = readMetadata(sessionsDir, "app-orchestrator-1");
      expect(meta).not.toBeNull();
      expect(meta!.status).toBe("working");
      expect(meta!.project).toBe("my-app");
      expect(meta!.branch).toBe("orchestrator/app-orchestrator-1");
      expect(meta!.tmuxName).toBeDefined();
      expect(meta!.runtimeHandle).toBeDefined();
    });

    it("writes metadata with worktree path and orchestrator role", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.spawnOrchestrator({ projectId: "my-app" });

      const meta = readMetadataRaw(sessionsDir, "app-orchestrator-1");
      expect(meta?.["role"]).toBe("orchestrator");
      expect(meta?.["branch"]).toBe("orchestrator/app-orchestrator-1");
      expect(meta?.["status"]).toBe("working");
      expect(meta?.["project"]).toBe("my-app");
    });

    it("increments the orchestrator counter for each new session", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      const s1 = await sm.spawnOrchestrator({ projectId: "my-app" });
      const s2 = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(s1.id).toBe("app-orchestrator-1");
      expect(s2.id).toBe("app-orchestrator-2");
      expect(mockWorkspace.create).toHaveBeenCalledTimes(2);
    });

    it("cleans up reserved metadata on workspace creation failure", async () => {
      (mockWorkspace.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("workspace creation failed"),
      );
      const sm = createSessionManager({ config, registry: mockRegistry });

      await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
        "workspace creation failed",
      );

      // Reserved session file should be cleaned up
      expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")).toBeNull();
    });

    it("destroys the worktree and metadata when runtime creation fails", async () => {
      const worktreePath = join(tmpDir, "orchestrator-ws-rt-fail");
      (mockWorkspace.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        path: worktreePath,
        branch: "orchestrator/app-orchestrator-1",
        sessionId: "app-orchestrator-1",
        projectId: "my-app",
      });
      (mockRuntime.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("runtime creation failed"),
      );
      const sm = createSessionManager({ config, registry: mockRegistry });

      await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
        "runtime creation failed",
      );

      expect(mockWorkspace.destroy).toHaveBeenCalledWith(worktreePath);
      expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")).toBeNull();
    });

    it("cleans up the worktree, metadata and prompt file when the agent refuses the launch", async () => {
      const worktreePath = join(tmpDir, "orchestrator-ws-refused");
      (mockWorkspace.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        path: worktreePath,
        branch: "orchestrator/app-orchestrator-1",
        sessionId: "app-orchestrator-1",
        projectId: "my-app",
      });
      let promptFileAtLaunch: string | undefined;
      let promptFileExistedAtLaunch = false;
      const refusingAgent: Agent = {
        ...mockAgent,
        getLaunchCommand: vi.fn().mockImplementation((launchConfig: AgentLaunchConfig) => {
          promptFileAtLaunch = launchConfig.systemPromptFile;
          promptFileExistedAtLaunch =
            promptFileAtLaunch !== undefined && existsSync(promptFileAtLaunch);
          throw new Error("agent refused the launch");
        }),
      };
      const registryWithRefusal: PluginRegistry = {
        ...mockRegistry,
        get: vi.fn().mockImplementation((slot: string) => {
          if (slot === "runtime") return mockRuntime;
          if (slot === "agent") return refusingAgent;
          if (slot === "workspace") return mockWorkspace;
          return null;
        }),
      };
      const sm = createSessionManager({ config, registry: registryWithRefusal });

      await expect(
        sm.spawnOrchestrator({ projectId: "my-app", systemPrompt: "You are the orchestrator." }),
      ).rejects.toThrow("agent refused the launch");

      // The prompt file existed when the agent refused, and the cleanup removed it.
      expect(promptFileExistedAtLaunch).toBe(true);
      expect(existsSync(promptFileAtLaunch!)).toBe(false);
      expect(mockWorkspace.destroy).toHaveBeenCalledWith(worktreePath);
      expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")).toBeNull();
      expect(mockRuntime.create).not.toHaveBeenCalled();
    });

    it("destroys the worktree when post-launch setup fails", async () => {
      const worktreePath = join(tmpDir, "orchestrator-ws-postlaunch-fail");
      (mockWorkspace.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        path: worktreePath,
        branch: "orchestrator/app-orchestrator-1",
        sessionId: "app-orchestrator-1",
        projectId: "my-app",
      });
      const postLaunchError = new Error("post-launch setup failed");
      const agentWithPostLaunch: typeof mockAgent = {
        ...mockAgent,
        postLaunchSetup: vi.fn().mockRejectedValueOnce(postLaunchError),
      };
      const registryWithPostLaunch: PluginRegistry = {
        ...mockRegistry,
        get: vi.fn().mockImplementation((slot: string) => {
          if (slot === "runtime") return mockRuntime;
          if (slot === "agent") return agentWithPostLaunch;
          if (slot === "workspace") return mockWorkspace;
          return null;
        }),
      };
      const sm = createSessionManager({ config, registry: registryWithPostLaunch });

      await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
        "post-launch setup failed",
      );

      expect(mockRuntime.destroy).toHaveBeenCalled();
      expect(mockWorkspace.destroy).toHaveBeenCalledWith(worktreePath);
      expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")).toBeNull();
    });

    it("deletes no OpenCode session by title on a delete-strategy start (Q7)", async () => {
      // I-2 row 24: the orchestrator `delete` strategy removes stored IDs
      // only. With no stored mapping, no session is removed, even though
      // older sessions carry the orchestrator title.
      const apiLogPath = join(tmpDir, "opencode-api-orchestrator-delete.log");
      const deleteLogPath = join(tmpDir, "opencode-delete-orchestrator.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [
          { id: "ses_old", title: "AO:app-orchestrator-1", createdAt: 1 },
          { id: "ses_new", title: "AO:app-orchestrator-1", createdAt: 2 },
        ],
        { apiLogPath, deleteLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();
      useOpenCodeProject({ orchestratorSessionStrategy: "delete" });

      const sm = createSessionManager({ config, registry: registryWithOpenCode });
      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(existsSync(deleteLogPath)).toBe(false);
      expect(readFileSync(apiLogPath, "utf-8")).not.toContain("session.remove");

      expect(opencodeAgent.prepareAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "app-orchestrator-1",
          projectConfig: expect.objectContaining({
            agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
          }),
        }),
        expect.anything(),
      );
      expect(readFileSync(apiLogPath, "utf-8")).not.toContain("session.list");

      const meta = readMetadataRaw(sessionsDir, "app-orchestrator-1");
      expect(meta?.["agent"]).toBe("opencode");
      expect(meta?.["opencodeSessionId"]).toBe("ses_created_1");
    });

    it("stores the session that its start creates, not an older same-title session (B-1, B-2)", async () => {
      const worktreePath = join(tmpDir, "orchestrator-ws-opencode");
      mkdirSync(worktreePath, { recursive: true });
      vi.mocked(mockWorkspace.create).mockResolvedValue({
        path: worktreePath,
        branch: "orchestrator/app-orchestrator-1",
        sessionId: "app-orchestrator-1",
        projectId: "my-app",
      });
      const mockBin = installMockOpencodeApi(tmpDir, [
        {
          id: "ses_older_orchestrator",
          title: "AO:app-orchestrator-1",
          directory: worktreePath,
          createdAt: Date.now() - 60_000,
        },
      ]);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();
      useOpenCodeProject({ orchestratorSessionStrategy: "reuse" });

      const sm = createSessionManager({ config, registry: registryWithOpenCode });
      const session = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(opencodeAgent.prepareAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          projectConfig: expect.objectContaining({
            agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
          }),
        }),
        expect.anything(),
      );
      expect(session.metadata["opencodeSessionId"]).toBe("ses_created_1");
      const meta = readMetadataRaw(sessionsDir, "app-orchestrator-1");
      expect(meta?.["opencodeSessionId"]).toBe("ses_created_1");
    });

    it("does not replace a gone stored orchestrator ID with a title match (M-2 M)", async () => {
      // Project-root mode keeps one orchestrator ID, so reuse finds the
      // archived mapping. The stored ID 404s, and an older session carries
      // the same title in the same directory.
      const projectPath = config.projects["my-app"]!.path;
      const mockBin = installMockOpencodeApi(tmpDir, [
        {
          id: "ses_title_match",
          title: "AO:app-orchestrator",
          directory: projectPath,
          createdAt: Date.now() - 60_000,
        },
      ]);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
      const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();
      useOpenCodeProject({
        orchestratorWorkspaceMode: "project",
        orchestratorSessionStrategy: "reuse",
      });

      writeMetadata(sessionsDir, "app-orchestrator", {
        worktree: projectPath,
        branch: "main",
        status: "working",
        role: "orchestrator",
        project: "my-app",
        agent: "opencode",
        opencodeSessionId: "ses_gone",
        runtimeHandle: JSON.stringify(makeHandle("rt-dead")),
      });

      const sm = createSessionManager({ config, registry: registryWithOpenCode });
      const session = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(session.id).toBe("app-orchestrator");
      expect(opencodeAgent.prepareAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          projectConfig: expect.objectContaining({
            agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
          }),
        }),
        expect.anything(),
      );
      const meta = readMetadataRaw(sessionsDir, "app-orchestrator");
      expect(meta?.["opencodeSessionId"]).toBe("ses_created_1");
    });

    it("reuses a stored orchestrator ID that still exists", async () => {
      const projectPath = config.projects["my-app"]!.path;
      const mockBin = installMockOpencodeApi(tmpDir, [
        { id: "ses_kept", title: "AO:app-orchestrator", directory: projectPath, createdAt: 1 },
      ]);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
      const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();
      useOpenCodeProject({
        orchestratorWorkspaceMode: "project",
        orchestratorSessionStrategy: "reuse",
      });

      writeMetadata(sessionsDir, "app-orchestrator", {
        worktree: projectPath,
        branch: "main",
        status: "working",
        role: "orchestrator",
        project: "my-app",
        agent: "opencode",
        opencodeSessionId: "ses_kept",
        runtimeHandle: JSON.stringify(makeHandle("rt-dead")),
      });

      const sm = createSessionManager({ config, registry: registryWithOpenCode });
      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(opencodeAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          projectConfig: expect.objectContaining({
            agentConfig: expect.objectContaining({ opencodeSessionId: "ses_kept" }),
          }),
        }),
      );
      expect(readMetadataRaw(sessionsDir, "app-orchestrator")?.["opencodeSessionId"]).toBe(
        "ses_kept",
      );
      const prepared = await vi.mocked(opencodeAgent.prepareAgentSession!).mock.results[0]!.value;
      expect(prepared.created).toBe(false);
    });

    describe("OpenCode session prepared before the pane (I-3)", () => {
      function orchestratorWorkspace(name: string): string {
        const worktreePath = join(tmpDir, name);
        mkdirSync(worktreePath, { recursive: true });
        vi.mocked(mockWorkspace.create).mockResolvedValue({
          path: worktreePath,
          branch: "orchestrator/app-orchestrator-1",
          sessionId: "app-orchestrator-1",
          projectId: "my-app",
        });
        return worktreePath;
      }

      it("creates and stores the session before runtime.create, with the orchestrator pane environment", async () => {
        const worktreePath = orchestratorWorkspace("orch-i3-good");
        const envLogPath = join(tmpDir, "opencode-env-orchestrator.log");
        const mockBin = installMockOpencodeApi(tmpDir, [], { envLogPath });
        process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
        const { agent, registry, log } = openCodeRegistry();
        let recordAtCreate: Record<string, string> | null = null;
        vi.mocked(mockRuntime.create).mockImplementation(async (rtConfig) => {
          log.push("runtime.create");
          recordAtCreate = readMetadataRaw(sessionsDir, "app-orchestrator-1");
          return makeHandle(rtConfig.sessionId);
        });
        agent.postLaunchSetup = vi.fn(async () => {
          log.push("postLaunchSetup");
        });
        useOpenCodeProject({ orchestratorSessionStrategy: "reuse" });

        const sm = createSessionManager({ config, registry });
        const session = await sm.spawnOrchestrator({ projectId: "my-app" });

        expect(log).toEqual(["prepare", "runtime.create", "postLaunchSetup", "confirm"]);
        expect(recordAtCreate).toMatchObject({
          opencodeSessionId: "ses_created_1",
          role: "orchestrator",
          worktree: worktreePath,
        });
        expect(session.metadata["opencodeSessionId"]).toBe("ses_created_1");
        const context = vi.mocked(agent.prepareAgentSession!).mock.calls[0]![1];
        expect(context.environment).toEqual(
          vi.mocked(mockRuntime.create).mock.calls[0]![0].environment,
        );
        for (const call of readMockApiEnvLog(envLogPath)) {
          expect(call.env["AO_SESSION"]).toBe("app-orchestrator-1");
          expect(call.env["AO_CALLER_TYPE"]).toBe("orchestrator");
        }
        // No prompt: no prompt check, so no promptDelivered key.
        expect(
          readMetadataRaw(sessionsDir, "app-orchestrator-1")?.["promptDelivered"],
        ).toBeUndefined();
        expect(findOpenCodeSessionsByTitle).not.toHaveBeenCalled();
        expect(listOpenCodeSessionsByTitle).not.toHaveBeenCalled();
      });

      it("fails the start on a create failure before any pane, and removes the worktree, record and prompt file", async () => {
        const worktreePath = orchestratorWorkspace("orch-i3-create-fail");
        const mockBin = installMockOpencodeApi(tmpDir, [], { failOperations: ["session.create"] });
        process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
        const { registry } = openCodeRegistry();
        useOpenCodeProject();
        const promptFile = join(
          getProjectBaseDirForTest(),
          "orchestrator-prompt-app-orchestrator-1.md",
        );

        const sm = createSessionManager({ config, registry });
        await expect(
          sm.spawnOrchestrator({ projectId: "my-app", systemPrompt: "You are the orchestrator." }),
        ).rejects.toThrow(/session.create failed/);

        expect(mockRuntime.create).not.toHaveBeenCalled();
        expect(mockWorkspace.destroy).toHaveBeenCalledWith(worktreePath);
        expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")).toBeNull();
        expect(existsSync(promptFile)).toBe(false);
      });

      it("fails the start on a dead pane and removes only the session that it created", async () => {
        const worktreePath = orchestratorWorkspace("orch-i3-dead-pane");
        const deleteLogPath = join(tmpDir, "opencode-delete-orchestrator-dead.log");
        const mockBin = installMockOpencodeApi(
          tmpDir,
          [
            {
              id: "ses_old_orch",
              title: "AO:app-orchestrator-1",
              directory: worktreePath,
              createdAt: 1,
            },
          ],
          { deleteLogPath },
        );
        process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
        const { agent, registry, log } = openCodeRegistry();
        vi.mocked(mockRuntime.destroy).mockImplementation(async () => {
          log.push("runtime.destroy");
        });
        agent.confirmLaunch = vi.fn(async () => {
          log.push("confirm");
          throw new Error("the pane of app-orchestrator-1 is gone");
        });
        useOpenCodeProject();

        const sm = createSessionManager({ config, registry });
        await expect(
          sm.spawnOrchestrator({ projectId: "my-app", systemPrompt: "You are the orchestrator." }),
        ).rejects.toThrow("is gone");

        expect(log).toEqual(["prepare", "confirm", "runtime.destroy", "discard:ses_created_1"]);
        expect(readFileSync(deleteLogPath, "utf-8")).toContain("sessionID=ses_created_1");
        expect(readFileSync(deleteLogPath, "utf-8")).not.toContain("ses_old_orch");
        expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_old_orch"]);
        expect(mockWorkspace.destroy).toHaveBeenCalledWith(worktreePath);
        expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")).toBeNull();
        expect(
          existsSync(join(getProjectBaseDirForTest(), "orchestrator-prompt-app-orchestrator-1.md")),
        ).toBe(false);
      });

      it("never removes a reused orchestrator session when the launch fails", async () => {
        const projectPath = config.projects["my-app"]!.path;
        const deleteLogPath = join(tmpDir, "opencode-delete-orchestrator-reused.log");
        const mockBin = installMockOpencodeApi(
          tmpDir,
          [{ id: "ses_kept", title: "AO:app-orchestrator", directory: projectPath, createdAt: 1 }],
          { deleteLogPath },
        );
        process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
        vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
        const { agent, registry } = openCodeRegistry();
        agent.confirmLaunch = vi.fn().mockRejectedValue(new Error("pane is gone"));
        useOpenCodeProject({
          orchestratorWorkspaceMode: "project",
          orchestratorSessionStrategy: "reuse",
        });
        writeMetadata(sessionsDir, "app-orchestrator", {
          worktree: projectPath,
          branch: "main",
          status: "working",
          role: "orchestrator",
          project: "my-app",
          agent: "opencode",
          opencodeSessionId: "ses_kept",
          runtimeHandle: JSON.stringify(makeHandle("rt-dead")),
        });

        const sm = createSessionManager({ config, registry });
        await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow("pane is gone");

        const prepared = await vi.mocked(agent.prepareAgentSession!).mock.results[0]!.value;
        expect(prepared.created).toBe(false);
        expect(existsSync(deleteLogPath)).toBe(false);
        expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_kept"]);
      });

      it("stores promptDelivered from the launch check when the start has a prompt", async () => {
        orchestratorWorkspace("orch-i3-prompt");
        const mockBin = installMockOpencodeApi(tmpDir, []);
        process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
        const { registry } = openCodeRegistry();
        useOpenCodeProject();
        const stderr = captureStderr();

        try {
          const sm = createSessionManager({ config, registry });
          const session = await sm.spawnOrchestrator({
            projectId: "my-app",
            systemPrompt: "You are the orchestrator.",
          });

          expect(session.metadata["promptDelivered"]).toBe("false");
          expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")?.["promptDelivered"]).toBe(
            "false",
          );
          expect(stderr.lines()).toContain(
            "app-orchestrator-1 runs, but its launch prompt did not show",
          );
        } finally {
          stderr.restore();
        }

        vi.mocked(mockRuntime.create).mockImplementation(async (rtConfig) => {
          setMockApiUserMessages(mockBin, "ses_created_2", 1);
          return makeHandle(rtConfig.sessionId);
        });
        const second = await createSessionManager({ config, registry }).spawnOrchestrator({
          projectId: "my-app",
          systemPrompt: "You are the orchestrator.",
        });
        expect(second.metadata["opencodeSessionId"]).toBe("ses_created_2");
        expect(second.metadata["promptDelivered"]).toBe("true");
      });
    });

    it("calls agent.setupWorkspaceHooks on worktree path", async () => {
      const agentWithHooks: Agent = {
        ...mockAgent,
        setupWorkspaceHooks: vi.fn().mockResolvedValue(undefined),
      };
      const registryWithHooks: PluginRegistry = {
        ...mockRegistry,
        get: vi.fn().mockImplementation((slot: string) => {
          if (slot === "runtime") return mockRuntime;
          if (slot === "agent") return agentWithHooks;
          if (slot === "workspace") return mockWorkspace;
          return null;
        }),
      };

      const sm = createSessionManager({ config, registry: registryWithHooks });
      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(agentWithHooks.setupWorkspaceHooks).toHaveBeenCalledWith(
        "/tmp/ws",
        expect.objectContaining({ dataDir: sessionsDir }),
      );
    });

    it("calls runtime.create with proper config", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(mockRuntime.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: "/tmp/ws",
          launchCommand: "mock-agent --start",
        }),
      );
    });

    it("does not persist orchestratorSessionReused metadata on newly created sessions", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.spawnOrchestrator({ projectId: "my-app" });

      const meta = readMetadataRaw(sessionsDir, "app-orchestrator-1");
      expect(meta?.["orchestratorSessionReused"]).toBeUndefined();
    });

    it("uses orchestratorModel when configured", async () => {
      const configWithOrchestratorModel: OrchestratorConfig = {
        ...config,
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            agentConfig: {
              model: "worker-model",
              orchestratorModel: "orchestrator-model",
            },
          },
        },
      };

      const sm = createSessionManager({
        config: configWithOrchestratorModel,
        registry: mockRegistry,
      });
      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ model: "orchestrator-model" }),
      );
    });

    it("keeps orchestrator launch permissionless even when shared config sets permissions", async () => {
      const configWithSharedPermissions: OrchestratorConfig = {
        ...config,
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            agentConfig: {
              permissions: "suggest",
            },
          },
        },
      };

      const sm = createSessionManager({
        config: configWithSharedPermissions,
        registry: mockRegistry,
      });
      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: "permissionless",
          projectConfig: expect.objectContaining({
            agentConfig: expect.objectContaining({ permissions: "permissionless" }),
          }),
        }),
      );
    });

    it("uses project orchestrator agent when configured", async () => {
      const mockCodexAgent: Agent = {
        ...mockAgent,
        name: "codex",
        processName: "codex",
        getLaunchCommand: vi.fn().mockReturnValue("codex --start"),
        getEnvironment: vi.fn().mockReturnValue({ CODEX_VAR: "1" }),
      };
      const registryWithMultipleAgents: PluginRegistry = {
        ...mockRegistry,
        get: vi.fn().mockImplementation((slot: string, name: string) => {
          if (slot === "runtime") return mockRuntime;
          if (slot === "workspace") return mockWorkspace;
          if (slot === "agent") {
            if (name === "codex") return mockCodexAgent;
            if (name === "mock-agent") return mockAgent;
          }
          return null;
        }),
      };
      const configWithOrchestratorAgent: OrchestratorConfig = {
        ...config,
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            agent: "mock-agent",
            orchestrator: {
              agent: "codex",
            },
          },
        },
      };

      const sm = createSessionManager({
        config: configWithOrchestratorAgent,
        registry: registryWithMultipleAgents,
      });
      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(mockCodexAgent.getLaunchCommand).toHaveBeenCalled();
      expect(mockAgent.getLaunchCommand).not.toHaveBeenCalled();
      expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")?.["agent"]).toBe("codex");
    });

    it("uses defaults orchestrator agent when project agent is not set", async () => {
      const mockCodexAgent: Agent = {
        ...mockAgent,
        name: "codex",
        processName: "codex",
        getLaunchCommand: vi.fn().mockReturnValue("codex --start"),
        getEnvironment: vi.fn().mockReturnValue({ CODEX_VAR: "1" }),
      };
      const registryWithMultipleAgents: PluginRegistry = {
        ...mockRegistry,
        get: vi.fn().mockImplementation((slot: string, name: string) => {
          if (slot === "runtime") return mockRuntime;
          if (slot === "workspace") return mockWorkspace;
          if (slot === "agent") {
            if (name === "codex") return mockCodexAgent;
            if (name === "mock-agent") return mockAgent;
          }
          return null;
        }),
      };
      const configWithDefaultOrchestratorAgent: OrchestratorConfig = {
        ...config,
        defaults: {
          ...config.defaults,
          orchestrator: {
            agent: "codex",
          },
        },
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            agent: undefined,
          },
        },
      };

      const sm = createSessionManager({
        config: configWithDefaultOrchestratorAgent,
        registry: registryWithMultipleAgents,
      });
      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(mockCodexAgent.getLaunchCommand).toHaveBeenCalled();
      expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")?.["agent"]).toBe("codex");
    });

    it("keeps shared worker permissions when role-specific config only overrides model", async () => {
      const configWithSharedPermissions: OrchestratorConfig = {
        ...config,
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            agentConfig: {
              permissions: "suggest",
            },
            worker: {
              agentConfig: {
                model: "worker-model",
              },
            },
          },
        },
      };

      const validatedConfig = validateConfig(configWithSharedPermissions);
      validatedConfig.configPath = config.configPath;
      const sm = createSessionManager({
        config: validatedConfig,
        registry: mockRegistry,
      });
      await sm.spawn({ projectId: "my-app" });

      expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ permissions: "suggest", model: "worker-model" }),
      );
    });

    it("uses role-specific orchestratorModel when configured", async () => {
      const configWithRoleOrchestratorModel: OrchestratorConfig = {
        ...config,
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            agentConfig: {
              model: "worker-model",
              orchestratorModel: "shared-orchestrator-model",
            },
            orchestrator: {
              agentConfig: {
                orchestratorModel: "role-orchestrator-model",
              },
            },
          },
        },
      };

      const sm = createSessionManager({
        config: configWithRoleOrchestratorModel,
        registry: mockRegistry,
      });
      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ model: "role-orchestrator-model" }),
      );
    });

    it("forwards configured subagent to orchestrator launch", async () => {
      const configWithSubagent: OrchestratorConfig = {
        ...config,
        projects: {
          ...config.projects,
          "my-app": {
            ...config.projects["my-app"],
            agentConfig: {
              subagent: "oracle",
            },
          },
        },
      };

      const sm = createSessionManager({
        config: configWithSubagent,
        registry: mockRegistry,
      });
      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ subagent: "oracle" }),
      );
    });

    it("writes system prompt to file and passes systemPromptFile to agent", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.spawnOrchestrator({
        projectId: "my-app",
        systemPrompt: "You are the orchestrator.",
      });

      // Should pass systemPromptFile (not inline systemPrompt) to avoid tmux truncation
      expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "app-orchestrator-1",
          systemPromptFile: expect.stringContaining("orchestrator-prompt-app-orchestrator-1.md"),
        }),
      );

      // Verify the file was actually written
      const callArgs = vi.mocked(mockAgent.getLaunchCommand).mock.calls[0][0];
      const promptFile = callArgs.systemPromptFile!;
      expect(existsSync(promptFile)).toBe(true);
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(promptFile, "utf-8")).toBe("You are the orchestrator.");
    });

    it("throws for unknown project", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      await expect(sm.spawnOrchestrator({ projectId: "nonexistent" })).rejects.toThrow(
        "Unknown project",
      );
    });

    it("throws when runtime plugin is missing", async () => {
      const emptyRegistry: PluginRegistry = {
        ...mockRegistry,
        get: vi.fn().mockReturnValue(null),
      };

      const sm = createSessionManager({ config, registry: emptyRegistry });

      await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow("not found");
    });

    it("returns session with runtimeHandle", async () => {
      const sm = createSessionManager({ config, registry: mockRegistry });

      const session = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(session.runtimeHandle).toEqual(makeHandle("rt-1"));
    });
  });
});

describe("a launch in progress keeps its OpenCode session (B-1)", () => {
  /** The start token that core stores for process `pid`: field 22 of `/proc/<pid>/stat`. */
  function startToken(pid: number): string {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    return `stat:${stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]}`;
  }

  /** Panes that `runtime.create` made; the runtime and the agent see only these as alive. */
  function livePanes(agent: Agent): Set<string> {
    const panes = new Set<string>();
    vi.mocked(mockRuntime.isAlive).mockImplementation(async (handle) => panes.has(handle.id));
    vi.mocked(agent.isProcessRunning).mockImplementation(async (handle) => panes.has(handle.id));
    vi.mocked(mockRuntime.create).mockImplementation(async (rtConfig) => {
      panes.add(rtConfig.sessionId);
      return makeHandle(rtConfig.sessionId);
    });
    return panes;
  }

  /** Run `during` once, at the first `runtime.create`, before that pane exists. */
  function pauseFirstRuntimeCreate(panes: Set<string>, during: () => Promise<void>): void {
    let paused = false;
    vi.mocked(mockRuntime.create).mockImplementation(async (rtConfig) => {
      if (!paused) {
        paused = true;
        await during();
      }
      panes.add(rtConfig.sessionId);
      return makeHandle(rtConfig.sessionId);
    });
  }

  /** Run `during` once, inside the first `prepareAgentSession`, before the real prepare. */
  function pauseFirstPrepare(agent: Agent, during: (sessionId: string) => Promise<void>): void {
    const prepare = agent.prepareAgentSession!;
    let paused = false;
    agent.prepareAgentSession = vi.fn(
      async (launch: AgentLaunchConfig, context: AgentSessionPrepareContext) => {
        if (!paused) {
          paused = true;
          await during(launch.sessionId);
        }
        return prepare(launch, context);
      },
    );
  }

  /** A process that ran and is gone now (reaped), with the start token it had. */
  async function deadProcess(): Promise<{ pid: number; start: string }> {
    const child = spawnChild("sleep", ["30"], { stdio: "ignore" });
    await once(child, "spawn");
    const pid = child.pid!;
    const start = startToken(pid);
    child.kill("SIGKILL");
    await once(child, "exit");
    expect(existsSync(`/proc/${pid}`)).toBe(false);
    return { pid, start };
  }

  function writeIssueRecord(id: string, openCodeSessionId: string, extra: Record<string, string>) {
    writeMetadata(sessionsDir, id, {
      worktree: `/tmp/${id}`,
      branch: "feat/INT-42",
      status: "spawning",
      tmuxName: `hash-${id}`,
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      opencodeSessionId: openCodeSessionId,
    });
    updateMetadata(sessionsDir, id, extra);
  }

  it("a second spawn of the issue with the delete strategy keeps the session of a spawn that waits at runtime.create", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-b1.log");
    const mockBin = installMockOpencodeApi(tmpDir, [], { deleteLogPath });
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    const { agent, registry } = openCodeRegistry();
    useOpenCodeProject({ opencodeIssueSessionStrategy: "delete" });
    const panes = livePanes(agent);
    const sm = createSessionManager({ config, registry });

    let recordAtPause: Record<string, string> | null = null;
    let sessionsAfterSecond: string[] = [];
    let second: Session | undefined;
    pauseFirstRuntimeCreate(panes, async () => {
      recordAtPause = readMetadataRaw(sessionsDir, "app-1");
      // The lifecycle's first poll can write `killed` before the pane exists;
      // it merges, so the launch keys stay.
      updateMetadata(sessionsDir, "app-1", { status: "killed" });
      second = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });
      sessionsAfterSecond = readMockApiSessions(mockBin).map((entry) => entry.id);
    });

    const first = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

    expect(recordAtPause).toMatchObject({
      opencodeSessionId: "ses_created_1",
      launchPid: String(process.pid),
      launchPidStart: startToken(process.pid),
    });
    expect(sessionsAfterSecond).toEqual(["ses_created_1", "ses_created_2"]);
    expect(existsSync(deleteLogPath)).toBe(false);
    expect([first.id, second?.id]).toEqual(["app-1", "app-2"]);
    // Both records name a live session, and each confirmed launch removed its keys.
    for (const [id, openCodeId] of [
      ["app-1", "ses_created_1"],
      ["app-2", "ses_created_2"],
    ] as const) {
      const raw = readMetadataRaw(sessionsDir, id);
      expect(raw?.["opencodeSessionId"]).toBe(openCodeId);
      expect(raw?.["launchPid"]).toBeUndefined();
      expect(raw?.["launchPidStart"]).toBeUndefined();
    }
    expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual([
      "ses_created_1",
      "ses_created_2",
    ]);
  });

  it.each(["worker", "orchestrator"] as const)(
    "keeps the launch keys of a %s through postLaunchSetup and the launch check, then removes them",
    async (role) => {
      const mockBin = installMockOpencodeApi(tmpDir, []);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject(role === "orchestrator" ? { orchestratorWorkspaceMode: "project" } : {});
      livePanes(agent);
      const seen: Array<Record<string, string> | null> = [];
      agent.postLaunchSetup = vi.fn(async (session: Session) => {
        seen.push(readMetadataRaw(sessionsDir, session.id));
      });
      const confirm = agent.confirmLaunch!;
      agent.confirmLaunch = vi.fn(
        async (
          session: Session,
          prepared: PreparedAgentSession,
          options: AgentLaunchConfirmOptions,
        ) => {
          seen.push(readMetadataRaw(sessionsDir, session.id));
          return confirm(session, prepared, options);
        },
      );
      const sm = createSessionManager({ config, registry });

      const session =
        role === "worker"
          ? await sm.spawn({ projectId: "my-app" })
          : await sm.spawnOrchestrator({ projectId: "my-app" });

      const claim = {
        launchPid: String(process.pid),
        launchPidStart: startToken(process.pid),
        opencodeSessionId: "ses_created_1",
      };
      expect(seen).toEqual([
        expect.objectContaining({ ...claim, runtimeHandle: expect.any(String) }),
        expect.objectContaining(claim),
      ]);
      const final = readMetadataRaw(sessionsDir, session.id);
      expect(final?.["opencodeSessionId"]).toBe("ses_created_1");
      expect(final?.["launchPid"]).toBeUndefined();
      expect(final?.["launchPidStart"]).toBeUndefined();
    },
  );

  it("cleanup while the spawn waits at runtime.create neither kills it nor removes its session", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-b1-cleanup.log");
    const mockBin = installMockOpencodeApi(tmpDir, [], { deleteLogPath });
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    const { agent, registry } = openCodeRegistry();
    useOpenCodeProject();
    const panes = livePanes(agent);
    const sm = createSessionManager({ config, registry });

    let result: CleanupResult | undefined;
    pauseFirstRuntimeCreate(panes, async () => {
      result = await sm.cleanup("my-app");
    });
    const session = await sm.spawn({ projectId: "my-app" });

    expect(result).toEqual({ killed: [], skipped: ["app-1"], errors: [] });
    expect(existsSync(deleteLogPath)).toBe(false);
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toBeNull();
    expect(readMetadataRaw(sessionsDir, session.id)?.["opencodeSessionId"]).toBe("ses_created_1");
    expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_created_1"]);
  });

  describe("an older record of the reused session, during the prepare", () => {
    function setupReuse(): {
      mockBin: string;
      deleteLogPath: string;
      agent: Agent;
      registry: PluginRegistry;
    } {
      const deleteLogPath = join(tmpDir, "opencode-delete-b1-reuse.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_old", title: "AO:app-8", directory: "/tmp/app-8", createdAt: 1 }],
        { deleteLogPath, interruptLogPath: join(tmpDir, "opencode-interrupt-b1-reuse.log") },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject();
      livePanes(agent);
      writeMetadata(sessionsDir, "app-8", {
        worktree: "/tmp/app-8",
        branch: "feat/INT-42",
        status: "killed",
        project: "my-app",
        issue: "INT-42",
        agent: "opencode",
        opencodeSessionId: "ses_old",
        runtimeHandle: JSON.stringify(makeHandle("old-8")),
      });
      return { mockBin, deleteLogPath, agent, registry };
    }

    it("cleanup kills the dead older record but keeps the reused session", async () => {
      const { mockBin, deleteLogPath, agent, registry } = setupReuse();
      const sm = createSessionManager({ config, registry });
      let result: CleanupResult | undefined;
      let launching = "";
      pauseFirstPrepare(agent, async (sessionId) => {
        launching = sessionId;
        result = await sm.cleanup("my-app");
      });
      const stderr = captureStderr();
      let session: Session;
      let warnings: string;
      try {
        session = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });
      } finally {
        warnings = stderr.lines();
        stderr.restore();
      }

      expect(session.id).toBe(launching);
      expect(session.metadata["opencodeSessionId"]).toBe("ses_old");
      expect(result?.killed).toEqual(["app-8"]);
      expect(result?.skipped).toEqual([launching]);
      expect(warnings).toContain(
        `ao: kept OpenCode session ses_old of app-8: the launch of session ${launching} by ao process ${process.pid} is in progress.`,
      );
      expect(existsSync(deleteLogPath)).toBe(false);
      expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_old"]);
    });

    it("a purge of the older record keeps the reused session", async () => {
      const { mockBin, deleteLogPath, agent, registry } = setupReuse();
      const sm = createSessionManager({ config, registry });
      let launching = "";
      let recordDuringPrepare: Record<string, string> | null = null;
      pauseFirstPrepare(agent, async (sessionId) => {
        launching = sessionId;
        recordDuringPrepare = readMetadataRaw(sessionsDir, sessionId);
        await sm.kill("app-8", { purgeOpenCode: true });
      });
      const stderr = captureStderr();
      let warnings: string;
      try {
        await sm.spawn({ projectId: "my-app", issueId: "INT-42" });
      } finally {
        warnings = stderr.lines();
        stderr.restore();
      }

      expect(recordDuringPrepare).toMatchObject({
        opencodeSessionId: "ses_old",
        launchPid: String(process.pid),
      });
      expect(warnings).toContain(
        `ao: kept OpenCode session ses_old of app-8: the launch of session ${launching} by ao process ${process.pid} is in progress.`,
      );
      expect(existsSync(deleteLogPath)).toBe(false);
      expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_old"]);
      expect(readArchivedMetadataRaw(sessionsDir, "app-8")?.["opencodeCleanedAt"]).toBeUndefined();
    });
  });

  it("a crashed launcher (dead PID, no pane) does not protect its ID, nor does a reused PID", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-b1-crashed.log");
    const mockBin = installMockOpencodeApi(
      tmpDir,
      [
        { id: "ses_crashed", title: "AO:app-6", directory: "/tmp/app-6", createdAt: 1 },
        { id: "ses_reused_pid", title: "AO:app-7", directory: "/tmp/app-7", createdAt: 2 },
        { id: "ses_live_launch", title: "AO:app-8", directory: "/tmp/app-8", createdAt: 3 },
      ],
      { deleteLogPath },
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    const { agent, registry } = openCodeRegistry();
    useOpenCodeProject({ opencodeIssueSessionStrategy: "delete" });
    livePanes(agent);
    const crashed = await deadProcess();
    writeIssueRecord("app-6", "ses_crashed", {
      launchPid: String(crashed.pid),
      launchPidStart: crashed.start,
    });
    // This PID runs, but it started at another time: another process got it.
    writeIssueRecord("app-7", "ses_reused_pid", {
      launchPid: String(process.pid),
      launchPidStart: "stat:1",
    });
    writeIssueRecord("app-8", "ses_live_launch", {
      launchPid: String(process.pid),
      launchPidStart: startToken(process.pid),
    });

    const sm = createSessionManager({ config, registry });
    await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

    const removed = readFileSync(deleteLogPath, "utf-8");
    expect(removed).toContain("sessionID=ses_crashed");
    expect(removed).toContain("sessionID=ses_reused_pid");
    expect(removed).not.toContain("sessionID=ses_live_launch");
    expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual([
      "ses_live_launch",
      "ses_created_1",
    ]);
  });

  it.each(["live", "crashed"] as const)(
    "the orchestrator delete strategy and a %s launcher that holds the older orchestrator ID",
    async (launcher) => {
      const projectPath = config.projects["my-app"]!.path;
      const deleteLogPath = join(tmpDir, `opencode-delete-b1-orchestrator-${launcher}.log`);
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_orch_shared", title: "AO:app-orchestrator", createdAt: 1 }],
        { deleteLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject({
        orchestratorWorkspaceMode: "project",
        orchestratorSessionStrategy: "delete",
      });
      livePanes(agent);
      writeMetadata(sessionsDir, "app-orchestrator", {
        worktree: projectPath,
        branch: "main",
        status: "killed",
        role: "orchestrator",
        project: "my-app",
        agent: "opencode",
        opencodeSessionId: "ses_orch_shared",
        runtimeHandle: JSON.stringify(makeHandle("rt-dead")),
      });
      const sm = createSessionManager({ config, registry });
      // The older orchestrator is archived; its archive names the older ID.
      await sm.kill("app-orchestrator");
      const owner =
        launcher === "live"
          ? { pid: process.pid, start: startToken(process.pid) }
          : await deadProcess();
      writeIssueRecord("app-3", "ses_orch_shared", {
        launchPid: String(owner.pid),
        launchPidStart: owner.start,
      });

      await sm.spawnOrchestrator({ projectId: "my-app" });

      if (launcher === "live") {
        expect(existsSync(deleteLogPath)).toBe(false);
        expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toContain("ses_orch_shared");
      } else {
        expect(readFileSync(deleteLogPath, "utf-8")).toContain("sessionID=ses_orch_shared");
      }
    },
  );

  describe("a kill, restore, remap or orchestrator start during the launch (B-2)", () => {
    function refusal(action: string, id: string): string {
      return (
        `Cannot ${action} session ${id}: ao process ${process.pid} is still launching it. ` +
        `Stop ao process ${process.pid} or wait for the launch to finish, then try again.`
      );
    }

    /** A zombie: a child that exited and that its parent (an exec'd `sleep`) never reaps. */
    async function zombieProcess(): Promise<{
      pid: number;
      start: string;
      stop: () => Promise<void>;
    }> {
      const parent = spawnChild("sh", ["-c", "sleep 0.3 & echo $!; exec sleep 30"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      const [chunk] = (await once(parent.stdout!, "data")) as [Buffer];
      const pid = Number(String(chunk).trim());
      let state = "";
      for (let i = 0; i < 150 && state !== "Z"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
        state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] ?? "";
      }
      expect(state).toBe("Z");
      return {
        pid,
        start: startToken(pid),
        stop: async () => {
          parent.kill("SIGKILL");
          await once(parent, "exit");
        },
      };
    }

    function olderIssueRecord(): void {
      writeMetadata(sessionsDir, "app-8", {
        worktree: "/tmp/app-8",
        branch: "feat/INT-42",
        status: "killed",
        project: "my-app",
        issue: "INT-42",
        agent: "opencode",
        opencodeSessionId: "ses_old",
        runtimeHandle: JSON.stringify(makeHandle("old-8")),
      });
    }

    it("refuses a kill of the launching record during the prepare: the record and its reused session stay, the spawn completes", async () => {
      const deleteLogPath = join(tmpDir, "opencode-delete-b2-prepare.log");
      const interruptLogPath = join(tmpDir, "opencode-interrupt-b2-prepare.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_old", title: "AO:app-8", directory: "/tmp/app-8", createdAt: 1 }],
        { deleteLogPath, interruptLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject();
      livePanes(agent);
      olderIssueRecord();
      const sm = createSessionManager({ config, registry });

      let launching = "";
      const refusals: unknown[] = [];
      let recordAfterKill: Record<string, string> | null = null;
      pauseFirstPrepare(agent, async (sessionId) => {
        launching = sessionId;
        for (const purgeOpenCode of [false, true]) {
          refusals.push(await sm.kill(sessionId, { purgeOpenCode }).catch((err: unknown) => err));
        }
        recordAfterKill = readMetadataRaw(sessionsDir, sessionId);
      });
      const session = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

      expect(refusals).toHaveLength(2);
      for (const err of refusals) {
        expect(err).toBeInstanceOf(SessionLaunchInProgressError);
        expect((err as Error).message).toBe(refusal("kill", launching));
      }
      expect(recordAfterKill).toMatchObject({
        opencodeSessionId: "ses_old",
        launchPid: String(process.pid),
      });
      expect(session.id).toBe(launching);
      expect(session.metadata["opencodeSessionId"]).toBe("ses_old");
      expect(readMetadataRaw(sessionsDir, launching)?.["opencodeSessionId"]).toBe("ses_old");
      expect(readArchivedMetadataRaw(sessionsDir, launching)).toBeNull();
      expect(existsSync(deleteLogPath)).toBe(false);
      expect(existsSync(interruptLogPath)).toBe(false);
      expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_old"]);
      expect(mockRuntime.destroy).not.toHaveBeenCalled();
      expect(mockWorkspace.destroy).not.toHaveBeenCalled();
    });

    it("refuses a kill of the launching record at runtime.create: the created session stays and the record names it", async () => {
      const deleteLogPath = join(tmpDir, "opencode-delete-b2-create.log");
      const interruptLogPath = join(tmpDir, "opencode-interrupt-b2-create.log");
      const mockBin = installMockOpencodeApi(tmpDir, [], { deleteLogPath, interruptLogPath });
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject();
      const panes = livePanes(agent);
      const sm = createSessionManager({ config, registry });

      const refusals: unknown[] = [];
      let recordAfterKill: Record<string, string> | null = null;
      pauseFirstRuntimeCreate(panes, async () => {
        for (const purgeOpenCode of [false, true]) {
          refusals.push(await sm.kill("app-1", { purgeOpenCode }).catch((err: unknown) => err));
        }
        recordAfterKill = readMetadataRaw(sessionsDir, "app-1");
      });
      const session = await sm.spawn({ projectId: "my-app" });

      expect(refusals.map((err) => (err as Error).message)).toEqual([
        refusal("kill", "app-1"),
        refusal("kill", "app-1"),
      ]);
      expect(recordAfterKill).toMatchObject({
        opencodeSessionId: "ses_created_1",
        launchPid: String(process.pid),
      });
      expect(session.id).toBe("app-1");
      const final = readMetadataRaw(sessionsDir, "app-1");
      expect(final?.["opencodeSessionId"]).toBe("ses_created_1");
      expect(final?.["launchPid"]).toBeUndefined();
      expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toBeNull();
      expect(existsSync(deleteLogPath)).toBe(false);
      expect(existsSync(interruptLogPath)).toBe(false);
      expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_created_1"]);
      expect(mockRuntime.destroy).not.toHaveBeenCalled();
    });

    it("refuses a kill while the workspace of the launch is made: the claim follows the reservation", async () => {
      const mockBin = installMockOpencodeApi(tmpDir, []);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject();
      livePanes(agent);
      const sm = createSessionManager({ config, registry });
      const create = vi.mocked(mockWorkspace.create).getMockImplementation()!;
      let recordAtCreate: Record<string, string> | null = null;
      let refused: unknown;
      vi.mocked(mockWorkspace.create).mockImplementationOnce(async (workspaceConfig) => {
        recordAtCreate = readMetadataRaw(sessionsDir, workspaceConfig.sessionId);
        refused = await sm.kill(workspaceConfig.sessionId).catch((err: unknown) => err);
        return create(workspaceConfig);
      });

      const session = await sm.spawn({ projectId: "my-app" });

      // The reserved record holds the launch keys before the workspace exists.
      expect(recordAtCreate).toEqual({
        launchPid: String(process.pid),
        launchPidStart: startToken(process.pid),
      });
      expect((refused as Error).message).toBe(refusal("kill", "app-1"));
      expect(session.id).toBe("app-1");
      expect(readMetadataRaw(sessionsDir, "app-1")?.["opencodeSessionId"]).toBe("ses_created_1");
      expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toBeNull();
      expect(mockWorkspace.destroy).not.toHaveBeenCalled();
    });

    it("refuses a restore and a remap of the launching record, also after the lifecycle wrote killed", async () => {
      const mockBin = installMockOpencodeApi(tmpDir, []);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject();
      const panes = livePanes(agent);
      const sm = createSessionManager({ config, registry });

      let restoreError: unknown;
      let remapError: unknown;
      pauseFirstRuntimeCreate(panes, async () => {
        // A launch without a pane looks dead; with `killed` it looks restorable.
        updateMetadata(sessionsDir, "app-1", { status: "killed" });
        restoreError = await sm.restore("app-1").catch((err: unknown) => err);
        remapError = await sm.remap("app-1", true).catch((err: unknown) => err);
      });
      const session = await sm.spawn({ projectId: "my-app" });

      expect(restoreError).toBeInstanceOf(SessionLaunchInProgressError);
      expect((restoreError as Error).message).toBe(refusal("restore", "app-1"));
      expect((remapError as Error).message).toBe(refusal("remap", "app-1"));
      // Only the spawn made a pane; the remap ran no title search.
      expect(mockRuntime.create).toHaveBeenCalledTimes(1);
      expect(findOpenCodeSessionsByTitle).not.toHaveBeenCalled();
      expect(session.id).toBe("app-1");
      expect(readMetadataRaw(sessionsDir, "app-1")?.["opencodeSessionId"]).toBe("ses_created_1");
      expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_created_1"]);
    });

    it("refuses to replace a project orchestrator whose launch waits at its launch check", async () => {
      const deleteLogPath = join(tmpDir, "opencode-delete-b2-orchestrator.log");
      const mockBin = installMockOpencodeApi(tmpDir, [], { deleteLogPath });
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject({
        orchestratorWorkspaceMode: "project",
        orchestratorSessionStrategy: "delete",
      });
      livePanes(agent);
      const sm = createSessionManager({ config, registry });
      const confirm = agent.confirmLaunch!;
      let second: unknown;
      let paused = false;
      agent.confirmLaunch = vi.fn(
        async (
          session: Session,
          prepared: PreparedAgentSession,
          options: AgentLaunchConfirmOptions,
        ) => {
          if (!paused) {
            paused = true;
            // The first start has a pane and a record with its runtime
            // handle; a second start with `delete` would destroy both.
            second = await sm
              .spawnOrchestrator({ projectId: "my-app" })
              .catch((err: unknown) => err);
          }
          return confirm(session, prepared, options);
        },
      );

      const first = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(second).toBeInstanceOf(SessionLaunchInProgressError);
      expect((second as Error).message).toBe(refusal("replace", "app-orchestrator"));
      expect(mockRuntime.destroy).not.toHaveBeenCalled();
      expect(mockRuntime.create).toHaveBeenCalledTimes(1);
      expect(first.id).toBe("app-orchestrator");
      const final = readMetadataRaw(sessionsDir, "app-orchestrator");
      expect(final?.["opencodeSessionId"]).toBe("ses_created_1");
      expect(final?.["launchPid"]).toBeUndefined();
      expect(existsSync(deleteLogPath)).toBe(false);
      expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_created_1"]);
    });

    it.each(["dead PID", "reused PID", "zombie"] as const)(
      "a %s launcher does not block the kill",
      async (kind) => {
        const deleteLogPath = join(tmpDir, `opencode-delete-b2-${kind.replace(" ", "-")}.log`);
        const mockBin = installMockOpencodeApi(
          tmpDir,
          [{ id: "ses_left", title: "AO:app-6", directory: "/tmp/app-6", createdAt: 1 }],
          { deleteLogPath },
        );
        process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
        const { agent, registry } = openCodeRegistry();
        useOpenCodeProject();
        livePanes(agent);
        const zombie = kind === "zombie" ? await zombieProcess() : undefined;
        try {
          const owner =
            kind === "dead PID"
              ? await deadProcess()
              : kind === "reused PID"
                ? { pid: process.pid, start: "stat:1" }
                : zombie!;
          writeIssueRecord("app-6", "ses_left", {
            launchPid: String(owner.pid),
            launchPidStart: owner.start,
          });

          const sm = createSessionManager({ config, registry });
          await sm.kill("app-6", { purgeOpenCode: true });

          expect(readMetadataRaw(sessionsDir, "app-6")).toBeNull();
          expect(readArchivedMetadataRaw(sessionsDir, "app-6")).not.toBeNull();
          expect(readFileSync(deleteLogPath, "utf-8")).toContain("sessionID=ses_left");
          expect(readMockApiSessions(mockBin)).toEqual([]);
        } finally {
          await zombie?.stop();
        }
      },
    );

    it("a dead prepare-only claim does not keep an older session from the delete strategy (M-4)", async () => {
      const deleteLogPath = join(tmpDir, "opencode-delete-m4.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_old", title: "AO:app-8", directory: "/tmp/app-8", createdAt: 1 }],
        { deleteLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject();
      livePanes(agent);
      olderIssueRecord();

      // A reuse launch of the issue dies on entry to the prepare; the record
      // that it leaves is the real prepare-only shape.
      let orphanId = "";
      let orphan: Record<string, string> | null = null;
      pauseFirstPrepare(agent, async (sessionId) => {
        orphanId = sessionId;
        orphan = readMetadataRaw(sessionsDir, sessionId);
        throw new Error("the launcher dies here");
      });
      await expect(
        createSessionManager({ config, registry }).spawn({
          projectId: "my-app",
          issueId: "INT-42",
        }),
      ).rejects.toThrow("the launcher dies here");
      expect(orphan).toEqual({
        launchPid: String(process.pid),
        launchPidStart: startToken(process.pid),
        opencodeSessionId: "ses_old",
      });
      const dead = await deadProcess();
      updateMetadata(sessionsDir, orphanId, {
        ...orphan!,
        launchPid: String(dead.pid),
        launchPidStart: dead.start,
      });

      useOpenCodeProject({ opencodeIssueSessionStrategy: "delete" });
      const session = await createSessionManager({ config, registry }).spawn({
        projectId: "my-app",
        issueId: "INT-42",
      });

      expect(readFileSync(deleteLogPath, "utf-8")).toContain("sessionID=ses_old");
      expect(session.metadata["opencodeSessionId"]).toBe("ses_created_1");
      expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual(["ses_created_1"]);
    });

    it("an old record without launch keys or runtime identity still keeps the older session (M-4)", async () => {
      const deleteLogPath = join(tmpDir, "opencode-delete-m4-old.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_old", title: "AO:app-8", directory: "/tmp/app-8", createdAt: 1 }],
        { deleteLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject({ opencodeIssueSessionStrategy: "delete" });
      livePanes(agent);
      olderIssueRecord();
      updateMetadata(sessionsDir, "app-9", { opencodeSessionId: "ses_old" });

      const stderr = captureStderr();
      let warnings: string;
      try {
        const sm = createSessionManager({ config, registry });
        await sm.spawn({ projectId: "my-app", issueId: "INT-42" });
        await sm.kill("app-8", { purgeOpenCode: true });
      } finally {
        warnings = stderr.lines();
        stderr.restore();
      }

      expect(existsSync(deleteLogPath)).toBe(false);
      expect(readMockApiSessions(mockBin).map((entry) => entry.id)).toEqual([
        "ses_old",
        "ses_created_1",
      ]);
      expect(warnings).toContain(
        "ao: kept OpenCode session ses_old of app-8: session app-9 may still use it (liveness could not be checked).",
      );
    });
  });
});

describe("the pane environment of the reuse resolver (m-1)", () => {
  const outer = { AO_SESSION: "orchestrator-real", AO_CALLER_TYPE: "orchestrator" };
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [key, value] of Object.entries(outer)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  function oldIssueRecord(openCodeSessionId: string): void {
    writeMetadata(sessionsDir, "app-8", {
      worktree: "/tmp/app-8",
      branch: "feat/INT-42",
      status: "killed",
      project: "my-app",
      issue: "INT-42",
      agent: "opencode",
      opencodeSessionId: openCodeSessionId,
      runtimeHandle: JSON.stringify(makeHandle("old-8")),
    });
  }

  it.each(["reuse", "delete"] as const)(
    "gives every spawn API call of the %s strategy, the resolver's too, the pane environment",
    async (strategy) => {
      const envLogPath = join(tmpDir, `opencode-env-resolver-${strategy}.log`);
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_old", title: "AO:app-8", directory: "/tmp/app-8", createdAt: 1 }],
        { envLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject({ opencodeIssueSessionStrategy: strategy });
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
      vi.mocked(agent.isProcessRunning).mockResolvedValue(false);
      oldIssueRecord("ses_old");

      const sm = createSessionManager({ config, registry });
      const session = await sm.spawn({ projectId: "my-app", issueId: "INT-42" });

      const calls = readMockApiEnvLog(envLogPath);
      expect(calls.map((call) => call.op)).toEqual(
        strategy === "reuse"
          ? ["session.get", "session.message.list"]
          : ["session.remove", "session.create", "session.message.list"],
      );
      const paneEnvironment = vi.mocked(mockRuntime.create).mock.calls[0]![0].environment;
      for (const call of calls) {
        expect(call.env["AO_SESSION"]).toBe(session.id);
        expect(call.env["AO_CALLER_TYPE"]).toBe("agent");
        expect(call.env["AO_SESSION_ID"]).toBe(session.id);
        expect(call.env["PATH"]).toBe(paneEnvironment["PATH"]);
      }
    },
  );

  it.each(["reuse", "delete"] as const)(
    "gives the orchestrator resolver of the %s strategy the orchestrator pane environment",
    async (strategy) => {
      const projectPath = config.projects["my-app"]!.path;
      const envLogPath = join(tmpDir, `opencode-env-orch-resolver-${strategy}.log`);
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [
          {
            id: "ses_orch_old",
            title: "AO:app-orchestrator",
            directory: projectPath,
            createdAt: 1,
          },
        ],
        { envLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      useOpenCodeProject({
        orchestratorWorkspaceMode: "project",
        orchestratorSessionStrategy: strategy,
      });
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
      vi.mocked(agent.isProcessRunning).mockResolvedValue(false);
      writeMetadata(sessionsDir, "app-orchestrator", {
        worktree: projectPath,
        branch: "main",
        status: "working",
        role: "orchestrator",
        project: "my-app",
        agent: "opencode",
        opencodeSessionId: "ses_orch_old",
        runtimeHandle: JSON.stringify(makeHandle("rt-dead")),
      });

      const sm = createSessionManager({ config, registry });
      // A start with `delete` drops a dead project-mode record without an
      // archive; the resolver finds the older ID in the archive of a kill.
      await sm.kill("app-orchestrator");
      await sm.spawnOrchestrator({ projectId: "my-app" });

      const calls = readMockApiEnvLog(envLogPath);
      expect(calls[0]?.op).toBe(strategy === "reuse" ? "session.get" : "session.remove");
      for (const call of calls) {
        expect(call.env["AO_SESSION"]).toBe("app-orchestrator");
        expect(call.env["AO_CALLER_TYPE"]).toBe("orchestrator");
      }
    },
  );
});
