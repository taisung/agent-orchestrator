import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
  utimesSync,
  chmodSync,
} from "node:fs";
import type * as LaunchLock from "../../opencode-launch-lock.js";
import type * as OpenCodeApi from "../../opencode-api.js";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { validateConfig } from "../../config.js";
import { getStateRoot, getSessionsDir } from "../../paths.js";
import {
  writeMetadata,
  readMetadata,
  readMetadataRaw,
  readArchivedMetadataRaw,
} from "../../metadata.js";
import type {
  OrchestratorConfig,
  PluginRegistry,
  Runtime,
  Agent,
  AgentLaunchConfig,
  Workspace,
  Tracker,
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
  paneCreatesOpenCodeSession,
  addMockApiSession,
} from "./opencode-helpers.js";

// The spawn-time wait for the pane's OpenCode session (row 23) runs for real:
// real `opencode api` child processes against the fake binary and the real
// filters. Only its window is shorter (1 s, not 15 s), so a test where no
// session appears does not wait 15 s.
vi.mock("../../opencode-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenCodeApi>();
  return {
    ...actual,
    waitForOpenCodeSession: (
      match: OpenCodeApi.OpenCodeSessionMatch,
      windowMs: number,
      pollMs: number,
    ) => actual.waitForOpenCodeSession(match, Math.min(windowMs, 1_000), Math.min(pollMs, 100)),
  };
});

vi.mock("../../opencode-launch-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof LaunchLock>();
  return {
    ...actual,
    acquireOpenCodeLaunchLock: (workspace: string, title: string) =>
      actual.acquireOpenCodeLaunchLock(workspace, title, {
        root: join(tmpDir, "launch-locks"),
        waitMs: 2_000,
      }),
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

/** A registry whose agent is an `opencode` double; the other slots are the mocks. */
function openCodeRegistry(): { agent: Agent; registry: PluginRegistry } {
  const agent: Agent = { ...mockAgent, name: "opencode" };
  const registry: PluginRegistry = {
    ...mockRegistry,
    get: vi.fn().mockImplementation((slot: string) => {
      if (slot === "runtime") return mockRuntime;
      if (slot === "agent") return agent;
      if (slot === "workspace") return mockWorkspace;
      return null;
    }),
  };
  return { agent, registry };
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

    const opencodeAgent: Agent = {
      ...mockAgent,
      name: "opencode",
    };

    const registryWithOpenCode: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return opencodeAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

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
  });

  it("does not replace a gone stored ID with a title match on issue reuse (row 24)", async () => {
    // D5: the stored ID 404s, and an older OpenCode session carries the title
    // of the old AO session. Reuse must not bind it. The new AO session stores
    // the OpenCode session that its own pane creates.
    const mockBin = installMockOpencodeApi(tmpDir, [
      { id: "ses_title_match", title: "AO:app-9", directory: "/tmp/old", createdAt: 1 },
    ]);
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    vi.mocked(mockRuntime.create).mockImplementation(paneCreatesOpenCodeSession(mockBin));
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

    expect(opencodeAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
        }),
      }),
    );

    const metadata = readMetadataRaw(sessionsDir, session.id);
    expect(metadata?.["opencodeSessionId"]).toBe(`ses_pane_${session.id}`);
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
    vi.mocked(mockRuntime.create).mockImplementation(paneCreatesOpenCodeSession(mockBin));
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

    expect(opencodeAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
        }),
      }),
    );
    expect(readMetadataRaw(sessionsDir, session.id)?.["opencodeSessionId"]).toBe(
      `ses_pane_${session.id}`,
    );
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

    const opencodeAgent: Agent = {
      ...mockAgent,
      name: "opencode",
    };

    const registryWithOpenCode: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return opencodeAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

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
    vi.mocked(mockRuntime.create).mockImplementation(paneCreatesOpenCodeSession(mockBin));
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

    expect(opencodeAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
        }),
      }),
    );

    // The strategy decides about older sessions only; the new pane's own
    // OpenCode session is still stored (row 23).
    const metadata = readMetadataRaw(sessionsDir, session.id);
    expect(metadata?.["opencodeSessionId"]).toBe(`ses_pane_${session.id}`);
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
    vi.mocked(mockRuntime.create).mockImplementation(paneCreatesOpenCodeSession(mockBin));
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
    expect(deleteLog).not.toContain(`sessionID=ses_pane_${session.id}`);

    expect(opencodeAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
        }),
      }),
    );

    const metadata = readMetadataRaw(sessionsDir, session.id);
    expect(metadata?.["opencodeSessionId"]).toBe(`ses_pane_${session.id}`);
  });

  it("keeps an old issue mapping that another live session uses on delete (m-4)", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-issue-shared.log");
    const mockBin = installMockOpencodeApi(
      tmpDir,
      [{ id: "ses_shared", title: "AO:app-8", directory: "/tmp/old1", createdAt: 1 }],
      { deleteLogPath },
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    vi.mocked(mockRuntime.create).mockImplementation(paneCreatesOpenCodeSession(mockBin));
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

  describe("OpenCode session of a new worker (row 23)", () => {
    it("stores the session that the pane creates after runtime.create returns (B-1)", async () => {
      // Measured with the real pane script: the pane creates the session 38
      // to 57 ms after runtime.create returns. The double waits 50 ms.
      const mockBin = installMockOpencodeApi(tmpDir, []);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      vi.mocked(mockRuntime.create).mockImplementation(
        paneCreatesOpenCodeSession(mockBin, { delayMs: 50 }),
      );
      const { registry } = openCodeRegistry();
      useOpenCodeProject();

      const sm = createSessionManager({ config, registry });
      const session = await sm.spawn({ projectId: "my-app" });

      expect(session.metadata["opencodeSessionId"]).toBe(`ses_pane_${session.id}`);
      expect(readMetadataRaw(sessionsDir, session.id)?.["opencodeSessionId"]).toBe(
        `ses_pane_${session.id}`,
      );
    });

    it("accepts only its own workspace and a session created after the spawn start (B-2)", async () => {
      // Another fleet with the same session prefix gives the same title in
      // another directory, and an older session has the title in this
      // workspace. Neither is this spawn's session, so the spawn stores none
      // and tells the operator to remap.
      const mockBin = installMockOpencodeApi(tmpDir, [
        {
          id: "ses_older_here",
          title: "AO:app-1",
          directory: "/tmp/ws",
          createdAt: Date.now() - 60_000,
        },
      ]);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      vi.mocked(mockRuntime.create).mockImplementation(async (rtConfig) => {
        addMockApiSession(mockBin, {
          id: "ses_other_fleet",
          title: "AO:app-1",
          directory: "/other/fleet/ws",
          createdAt: Date.now(),
        });
        return makeHandle(rtConfig.sessionId);
      });
      const { registry } = openCodeRegistry();
      useOpenCodeProject();
      const stderr = captureStderr();

      try {
        const sm = createSessionManager({ config, registry });
        const session = await sm.spawn({ projectId: "my-app" });

        expect(session.id).toBe("app-1");
        expect(session.metadata["opencodeSessionId"]).toBeUndefined();
        expect(readMetadataRaw(sessionsDir, "app-1")?.["opencodeSessionId"]).toBeUndefined();
        const warning = stderr.lines();
        expect(warning).toContain("no OpenCode session titled AO:app-1 appeared in /tmp/ws");
        expect(warning).toContain("ao session remap app-1");
        expect(warning.trim().split("\n")).toHaveLength(1);
      } finally {
        stderr.restore();
      }
    });

    it("stores none when two sessions of its title appear in its workspace", async () => {
      const mockBin = installMockOpencodeApi(tmpDir, []);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      vi.mocked(mockRuntime.create).mockImplementation(async (rtConfig) => {
        for (const id of ["ses_twin_a", "ses_twin_b"]) {
          addMockApiSession(mockBin, {
            id,
            title: "AO:app-1",
            directory: rtConfig.workspacePath,
            createdAt: Date.now(),
          });
        }
        return makeHandle(rtConfig.sessionId);
      });
      const { registry } = openCodeRegistry();
      useOpenCodeProject();
      const stderr = captureStderr();

      try {
        const sm = createSessionManager({ config, registry });
        const session = await sm.spawn({ projectId: "my-app" });

        expect(session.metadata["opencodeSessionId"]).toBeUndefined();
        const warning = stderr.lines();
        expect(warning).toContain("ses_twin_a");
        expect(warning).toContain("ses_twin_b");
        expect(warning).toContain("ao session remap app-1");
      } finally {
        stderr.restore();
      }
    });

    it("ends the wait at its bound when the binary hangs, and the spawn succeeds", async () => {
      const mockBin = installMockOpencodeApi(tmpDir, [], { apiDelaySeconds: 30 });
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { registry } = openCodeRegistry();
      useOpenCodeProject();
      const stderr = captureStderr();

      try {
        const sm = createSessionManager({ config, registry });
        const started = Date.now();
        const session = await sm.spawn({ projectId: "my-app" });
        const elapsedMs = Date.now() - started;

        expect(session.status).toBe("spawning");
        expect(session.metadata["opencodeSessionId"]).toBeUndefined();
        // The window in this file is 1 s; one search call ends within it.
        expect(elapsedMs).toBeLessThan(3_000);
        expect(stderr.lines()).toContain("ao session remap app-1");
        expect(stderr.lines().trim().split("\n")).toHaveLength(1);
      } finally {
        stderr.restore();
      }
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
      vi.mocked(mockRuntime.create).mockImplementation(paneCreatesOpenCodeSession(mockBin));
      const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();
      useOpenCodeProject({ orchestratorSessionStrategy: "delete" });

      const sm = createSessionManager({ config, registry: registryWithOpenCode });
      await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(existsSync(deleteLogPath)).toBe(false);
      expect(readFileSync(apiLogPath, "utf-8")).not.toContain("session.remove");

      expect(opencodeAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "app-orchestrator-1",
          projectConfig: expect.objectContaining({
            agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
          }),
        }),
      );

      const meta = readMetadataRaw(sessionsDir, "app-orchestrator-1");
      expect(meta?.["agent"]).toBe("opencode");
      expect(meta?.["opencodeSessionId"]).toBe("ses_pane_app-orchestrator-1");
    });

    it("stores the session that its pane creates, not an older same-title session (B-1, B-2)", async () => {
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
      vi.mocked(mockRuntime.create).mockImplementation(
        paneCreatesOpenCodeSession(mockBin, { delayMs: 50 }),
      );
      const { agent: opencodeAgent, registry: registryWithOpenCode } = openCodeRegistry();
      useOpenCodeProject({ orchestratorSessionStrategy: "reuse" });

      const sm = createSessionManager({ config, registry: registryWithOpenCode });
      const session = await sm.spawnOrchestrator({ projectId: "my-app" });

      expect(opencodeAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          projectConfig: expect.objectContaining({
            agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
          }),
        }),
      );
      expect(session.metadata["opencodeSessionId"]).toBe("ses_pane_app-orchestrator-1");
      const meta = readMetadataRaw(sessionsDir, "app-orchestrator-1");
      expect(meta?.["opencodeSessionId"]).toBe("ses_pane_app-orchestrator-1");
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
      vi.mocked(mockRuntime.create).mockImplementation(paneCreatesOpenCodeSession(mockBin));
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
      expect(opencodeAgent.getLaunchCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          projectConfig: expect.objectContaining({
            agentConfig: expect.not.objectContaining({ opencodeSessionId: expect.any(String) }),
          }),
        }),
      );
      const meta = readMetadataRaw(sessionsDir, "app-orchestrator");
      expect(meta?.["opencodeSessionId"]).toBe("ses_pane_app-orchestrator");
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

describe("OpenCode ownership across fleets", () => {
  it.each(["worker", "orchestrator"] as const)(
    "serializes overlapping %s launches before the second pane creates its session",
    async (kind) => {
      useOpenCodeProject({
        orchestratorWorkspaceMode: "project",
        orchestratorSessionStrategy: "ignore",
      });
      const workspace = join(tmpDir, "shared-repo");
      mkdirSync(workspace);
      config.projects["my-app"].path = workspace;
      const otherConfig = { ...config, configPath: join(tmpDir, "fleet-b", "config.yaml") };
      mkdirSync(join(tmpDir, "fleet-b"));
      writeFileSync(otherConfig.configPath, "projects: {}\n");
      const firstDir = getSessionsDir(config.configPath, workspace);
      const secondDir = getSessionsDir(otherConfig.configPath, workspace);
      expect(firstDir).not.toBe(secondDir);
      vi.mocked(mockWorkspace.create).mockResolvedValue({
        path: workspace,
        branch: "main",
        sessionId: "app-1",
        projectId: "my-app",
      });
      const mockBin = installMockOpencodeApi(tmpDir, []);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { registry } = openCodeRegistry();
      let pane = 0;
      let firstMappedBeforeSecondLaunch = false;
      vi.mocked(mockRuntime.create).mockImplementation(async (launch) => {
        const mine = ++pane;
        const id = launch.environment["AO_SESSION"];
        if (mine === 2) {
          firstMappedBeforeSecondLaunch =
            readMetadataRaw(firstDir, id)?.["opencodeSessionId"] === "ses_fleet_a";
        }
        // B appears only AFTER A was found, so another quiet poll is no fix.
        setTimeout(
          () =>
            addMockApiSession(mockBin, {
              id: mine === 1 ? "ses_fleet_a" : "ses_fleet_b",
              title: `AO:${id}`,
              directory: workspace,
              createdAt: Date.now(),
            }),
          mine === 1 ? 300 : 350,
        );
        return makeHandle(`fleet-${mine}`);
      });
      const a = createSessionManager({ config, registry });
      const b = createSessionManager({ config: otherConfig, registry });
      const start = (sm: ReturnType<typeof createSessionManager>) =>
        kind === "worker"
          ? sm.spawn({ projectId: "my-app" })
          : sm.spawnOrchestrator({ projectId: "my-app" });
      const first = start(a);
      await vi.waitFor(() => expect(pane).toBe(1), { interval: 1 });
      const second = start(b);
      const [resultA, resultB] = await Promise.all([first, second]);
      expect(firstMappedBeforeSecondLaunch).toBe(true);
      expect(resultA.metadata["opencodeSessionId"]).toBe("ses_fleet_a");
      expect(resultB.metadata["opencodeSessionId"]).toBe("ses_fleet_b");
      expect(readMetadataRaw(secondDir, resultB.id)?.["opencodeSessionId"]).toBe("ses_fleet_b");
    },
  );

  it("refuses an unresolved create, then recovers its late result without binding it to the next start", async () => {
    useOpenCodeProject({
      orchestratorWorkspaceMode: "project",
      orchestratorSessionStrategy: "ignore",
    });
    const mockBin = installMockOpencodeApi(tmpDir, []);
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
    const { registry } = openCodeRegistry();
    const stderr = captureStderr();
    try {
      const a = createSessionManager({ config, registry });
      const first = await a.spawnOrchestrator({ projectId: "my-app" });
      expect(first.metadata["opencodeSessionId"]).toBeUndefined();
      const otherConfig = { ...config, configPath: join(tmpDir, "fleet-b", "config.yaml") };
      mkdirSync(join(tmpDir, "fleet-b"));
      writeFileSync(otherConfig.configPath, "projects: {}\n");
      const b = createSessionManager({ config: otherConfig, registry });
      await expect(b.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
        "earlier OpenCode launch is unresolved",
      );
      expect(mockRuntime.create).toHaveBeenCalledTimes(1);
      addMockApiSession(mockBin, {
        id: "ses_late_a",
        title: `AO:${first.id}`,
        directory: config.projects["my-app"].path,
        createdAt: Date.now(),
      });
      vi.mocked(mockRuntime.create).mockImplementation(paneCreatesOpenCodeSession(mockBin));
      const second = await b.spawnOrchestrator({ projectId: "my-app" });
      expect(second.metadata["opencodeSessionId"]).toBe(`ses_pane_${second.id}`);
      expect(second.metadata["opencodeSessionId"]).not.toBe("ses_late_a");
      expect(stderr.lines()).toContain("earlier create finished");

      expect(stderr.lines()).toContain(`ao session remap ${first.id}`);
    } finally {
      stderr.restore();
    }
  });
  it.each(["before delivery", "Herdr before delivery", "unknown", "post-launch"])(
    "allows the next worker after a %s runtime failure",
    async (stage) => {
      useOpenCodeProject();
      const bin = installMockOpencodeApi(tmpDir, []);
      process.env.PATH = `${bin}:${originalPath ?? ""}`;
      const { agent, registry } = openCodeRegistry();
      if (stage === "before delivery") {
        mockRuntime = { ...mockRuntime, name: "tmux" };
        vi.mocked(mockRuntime.create).mockRejectedValueOnce(
          Object.assign(new Error("new-session failed"), {
            cmd: "tmux new-session -d -s app-1",
          }),
        );
      } else if (stage === "Herdr before delivery") {
        mockRuntime = { ...mockRuntime, name: "herdr" };
        vi.mocked(mockRuntime.create).mockRejectedValueOnce(
          new Error("herdr error unavailable: server stopped"),
        );
      } else if (stage === "unknown") {
        vi.mocked(mockRuntime.create).mockRejectedValueOnce(new Error("create uncertain"));
      } else {
        agent.postLaunchSetup = vi
          .fn()
          .mockRejectedValueOnce(new Error("setup failed"))
          .mockResolvedValue(undefined);
      }
      const sm = createSessionManager({ config, registry });
      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow();
      if (stage.endsWith("before delivery"))
        expect(readdirSync(join(tmpDir, "launch-locks"))).toEqual([]);
      else expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["status"]).toBe("killed");
      vi.mocked(mockRuntime.create).mockImplementation(paneCreatesOpenCodeSession(bin));
      const next = await sm.spawn({ projectId: "my-app" });
      expect(next.id).toBe(stage.endsWith("before delivery") ? "app-1" : "app-2");
      expect(next.metadata["opencodeSessionId"]).toBe(`ses_pane_${next.id}`);
    },
  );

  it.each(["ownerless", "pane never created"])(
    "recovers a %s marker on a fresh orchestrator start",
    async (kind) => {
      useOpenCodeProject({
        orchestratorWorkspaceMode: "project",
        orchestratorSessionStrategy: "ignore",
      });
      const bin = installMockOpencodeApi(tmpDir, []);
      writeFileSync(
        join(bin, "tmux"),
        `#!/bin/sh
if [ "$1" = display-message ]; then echo /tmp/ao27-test-socket; exit 0; fi
echo "can't find session: earlier" >&2
exit 1
`,
      );
      chmodSync(join(bin, "tmux"), 0o755);
      process.env.PATH = `${bin}:${originalPath ?? ""}`;
      const { registry } = openCodeRegistry();
      vi.mocked(mockRuntime.create).mockResolvedValue({
        id: "earlier",
        runtimeName: "tmux",
        data: {},
      });
      mkdirSync(join(tmpDir, "fleet-old"));
      const firstConfig = { ...config, configPath: join(tmpDir, "fleet-old", "config.yaml") };
      writeFileSync(firstConfig.configPath, "projects: {}\n");
      const first = await createSessionManager({ config: firstConfig, registry }).spawnOrchestrator(
        { projectId: "my-app" },
      );
      expect(first.metadata["opencodeSessionId"]).toBeUndefined();
      const root = join(tmpDir, "launch-locks");
      const dir = join(root, readdirSync(root)[0]);
      const file = join(dir, "pending.json");
      if (kind === "ownerless") {
        rmSync(file);
        utimesSync(dir, new Date(0), new Date(0));
      } else {
        const marker = JSON.parse(readFileSync(file, "utf8"));
        expect(marker.runtimeHandle.id).toBe("earlier");
        marker.startedAt = Date.now() - 60_000;
        writeFileSync(file, JSON.stringify(marker));
      }
      vi.mocked(mockRuntime.create).mockImplementation(paneCreatesOpenCodeSession(bin));
      const next = await createSessionManager({ config, registry }).spawnOrchestrator({
        projectId: "my-app",
      });
      expect(next.metadata["opencodeSessionId"]).toBe(`ses_pane_${next.id}`);
    },
  );
});
