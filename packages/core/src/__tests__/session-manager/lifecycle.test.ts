import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as OpenCodeApi from "../../opencode-api.js";
import { mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createSessionManager } from "../../session-manager.js";
import {
  writeMetadata,
  updateMetadata,
  readMetadata,
  readArchivedMetadataRaw,
  deleteMetadata,
} from "../../metadata.js";
import { getSessionsDir, getWorktreesDir } from "../../paths.js";
import type {
  OrchestratorConfig,
  PluginRegistry,
  Runtime,
  Agent,
  Workspace,
  Tracker,
  SCM,
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
  installMockOpencodeWithNotFoundDelete,
  readMockApiSessions,
} from "./opencode-helpers.js";

// A test can lower the bound of every `opencode api` remove and interrupt call
// (the real bound is 10 s), so a hanging-binary test ends in a few seconds.
// The calls stay real child processes against the fake binary.
const apiBound = vi.hoisted(() => ({ capMs: undefined as number | undefined }));
vi.mock("../../opencode-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenCodeApi>();
  const bound = (timeoutMs?: number): number | undefined =>
    apiBound.capMs === undefined
      ? timeoutMs
      : Math.min(timeoutMs ?? actual.OPENCODE_API_TIMEOUT_MS, apiBound.capMs);
  return {
    ...actual,
    removeOpenCodeSession: (sessionId: string, timeoutMs?: number) =>
      actual.removeOpenCodeSession(sessionId, bound(timeoutMs)),
    interruptOpenCodeSession: (sessionId: string, timeoutMs?: number) =>
      actual.interruptOpenCodeSession(sessionId, bound(timeoutMs)),
  };
});

let ctx: TestContext;
let tmpDir: string;
let configPath: string;
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
    configPath,
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
  apiBound.capMs = undefined;
  teardownTestContext(ctx);
});

describe("kill", () => {
  it("destroys runtime, workspace, and archives metadata", async () => {
    const managedWorktree = join(
      getWorktreesDir(config.configPath, config.projects["my-app"]!.path),
      "app-1",
    );
    writeMetadata(sessionsDir, "app-1", {
      worktree: managedWorktree,
      branch: "main",
      status: "working",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.kill("app-1");

    expect(mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-1"));
    expect(mockWorkspace.destroy).toHaveBeenCalledWith(managedWorktree, expect.any(Function));
    expect(readMetadata(sessionsDir, "app-1")).toBeNull(); // archived + deleted
  });

  it("does not destroy workspace paths outside managed roots", async () => {
    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp/ws",
      branch: "main",
      status: "working",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.kill("app-1");

    expect(mockWorkspace.destroy).not.toHaveBeenCalled();
  });

  it("destroys workspace under legacy ~/.worktrees root", async () => {
    const legacyWorktree = join(homedir(), ".worktrees", "my-app", "app-1");
    writeMetadata(sessionsDir, "app-1", {
      worktree: legacyWorktree,
      branch: "main",
      status: "working",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.kill("app-1");

    expect(mockWorkspace.destroy).toHaveBeenCalledWith(legacyWorktree, expect.any(Function));
  });

  it("never destroys workspace equal to project path", async () => {
    writeMetadata(sessionsDir, "app-1", {
      worktree: config.projects["my-app"]!.path,
      branch: "main",
      status: "working",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.kill("app-1");

    expect(mockWorkspace.destroy).not.toHaveBeenCalled();
  });

  it("does not destroy workspace when worktree resolves to project path", async () => {
    const projectPath = config.projects["my-app"]?.path;
    if (!projectPath) throw new Error("missing project path");

    writeMetadata(sessionsDir, "app-1", {
      worktree: `${projectPath}/`,
      branch: "main",
      status: "working",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.kill("app-1");

    expect(mockWorkspace.destroy).not.toHaveBeenCalled();
  });

  it("throws for nonexistent session", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });
    await expect(sm.kill("nonexistent")).rejects.toThrow("not found");
  });

  it("tolerates runtime destroy failure", async () => {
    const failRuntime: Runtime = {
      ...mockRuntime,
      destroy: vi.fn().mockRejectedValue(new Error("already gone")),
    };
    const registryWithFail: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return failRuntime;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp",
      branch: "main",
      status: "working",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: registryWithFail });
    // Should not throw even though runtime.destroy fails
    await expect(sm.kill("app-1")).resolves.toBeUndefined();
  });

  it("does not purge mapped OpenCode session on default kill", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-kill-default.log");
    const mockBin = installMockOpencode(tmpDir, "[]", deleteLogPath);
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp/ws",
      branch: "main",
      status: "working",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_keep",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.kill("app-1");

    expect(existsSync(deleteLogPath)).toBe(false);
  });

  it("purges mapped OpenCode session when requested", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-kill-purge.log");
    const mockBin = installMockOpencodeApi(
      tmpDir,
      [
        { id: "ses_purge", title: "AO:app-1", directory: "/tmp/ws" },
        { id: "ses_other", title: "AO:app-2", directory: "/tmp/ws2" },
      ],
      { deleteLogPath },
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp/ws",
      branch: "main",
      status: "working",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_purge",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.kill("app-1", { purgeOpenCode: true });

    // Row 20: interrupt first, then remove, both by the stored ID only. The
    // interrupt must come first: a remove of a running session leaves its
    // loop running in the service.
    const calls = readFileSync(deleteLogPath, "utf-8").trim().split("\n");
    expect(calls).toEqual([
      "api session.interrupt --param sessionID=ses_purge",
      "api session.remove --param sessionID=ses_purge",
    ]);
    expect(readMockApiSessions(mockBin).map((session) => session.id)).toEqual(["ses_other"]);
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"]).toBeTruthy();
  });

  it("skips purge when mapped OpenCode session id is invalid", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-kill-invalid.log");
    const mockBin = installMockOpencode(tmpDir, "[]", deleteLogPath);
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp/ws",
      branch: "main",
      status: "working",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses bad id",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.kill("app-1", { purgeOpenCode: true });

    expect(existsSync(deleteLogPath)).toBe(false);
  }, 15000);

  it("does not search by title on purge when no ID is stored (Q7)", async () => {
    // A same-title session exists in the session's workspace. Without a
    // stored ID, a purge touches no OpenCode session.
    const apiLogPath = join(tmpDir, "opencode-api-kill-unmapped.log");
    const mockBin = installMockOpencodeApi(
      tmpDir,
      [{ id: "ses_same_title", title: "AO:app-1", directory: "/tmp/ws" }],
      { apiLogPath },
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp/ws",
      branch: "main",
      status: "working",
      project: "my-app",
      agent: "opencode",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.kill("app-1", { purgeOpenCode: true });

    expect(existsSync(apiLogPath)).toBe(false);
    expect(readMockApiSessions(mockBin).map((session) => session.id)).toEqual(["ses_same_title"]);
  });

  describe("purge of an OpenCode session that another session uses (m-4)", () => {
    function writeSharedPair(otherStatus: string): void {
      writeMetadata(sessionsDir, "app-1", {
        worktree: "/tmp/ws",
        branch: "feat/INT-42",
        status: "working",
        project: "my-app",
        issue: "INT-42",
        agent: "opencode",
        opencodeSessionId: "ses_shared",
        runtimeHandle: JSON.stringify(makeHandle("rt-1")),
      });
      writeMetadata(sessionsDir, "app-2", {
        worktree: "/tmp/ws2",
        branch: "feat/INT-42",
        status: otherStatus,
        project: "my-app",
        issue: "INT-42",
        agent: "opencode",
        opencodeSessionId: "ses_shared",
        runtimeHandle: JSON.stringify(makeHandle("rt-2")),
      });
    }

    it("neither interrupts nor removes it while the other session is live", async () => {
      const apiLogPath = join(tmpDir, "opencode-api-kill-shared.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_shared", title: "AO:app-1", directory: "/tmp/ws" }],
        { apiLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      writeSharedPair("working");
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      try {
        const sm = createSessionManager({ config, registry: mockRegistry });
        await sm.kill("app-1", { purgeOpenCode: true });

        expect(existsSync(apiLogPath)).toBe(false);
        expect(readMockApiSessions(mockBin).map((session) => session.id)).toEqual(["ses_shared"]);
        expect(stderr.mock.calls.map((call) => String(call[0])).join("")).toContain(
          "kept OpenCode session ses_shared of app-1: live session app-2 uses it",
        );
        // Not marked cleaned, so a later `ao session cleanup` can remove it.
        expect(
          readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"],
        ).toBeUndefined();
      } finally {
        stderr.mockRestore();
      }
    });

    it.each(["merged", "killed", "done", "terminated", "cleanup"])(
      "keeps a live %s holder during purge and archived cleanup",
      async (status) => {
        const apiLogPath = join(tmpDir, "live-terminal.log");
        const mockBin = installMockOpencodeApi(
          tmpDir,
          [{ id: "ses_shared", title: "AO:app-1", directory: "/tmp/ws" }],
          { apiLogPath },
        );
        process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
        writeSharedPair(status);
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        try {
          const sm = createSessionManager({ config, registry: mockRegistry });
          await sm.kill("app-1", { purgeOpenCode: true });
          const result = await sm.cleanup();
          expect(result.skipped).toContain("app-1");
          expect(readMockApiSessions(mockBin).map((s) => s.id)).toEqual(["ses_shared"]);
          expect(existsSync(apiLogPath)).toBe(false);
          expect(
            stderr.mock.calls.filter((call) =>
              String(call[0]).includes("live session app-2 uses it"),
            ),
          ).toHaveLength(2);
          expect(
            readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"],
          ).toBeUndefined();
        } finally {
          stderr.mockRestore();
        }
      },
    );

    it.each([
      "runtime error",
      "agent error",
      "agent alive",
      "missing handle",
      "missing plugin",
      "hang",
    ])("keeps a merged holder with %s", async (mode) => {
      const mockBin = installMockOpencodeApi(tmpDir, [
        { id: "ses_shared", title: "AO:app-1", directory: "/tmp/ws" },
      ]);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      writeSharedPair("merged");
      if (mode === "runtime error")
        vi.mocked(mockRuntime.isAlive).mockRejectedValue(new Error("unavailable"));
      if (mode === "agent error" || mode === "agent alive") {
        vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
        if (mode === "agent error")
          vi.mocked(mockAgent.isProcessRunning).mockRejectedValue(new Error("unavailable"));
      }
      if (mode === "missing handle") updateMetadata(sessionsDir, "app-2", { runtimeHandle: "" });
      if (mode === "missing plugin") {
        const original = vi.mocked(mockRegistry.get).getMockImplementation();
        if (!original) throw new Error("missing registry mock implementation");
        vi.spyOn(mockRegistry, "get").mockImplementation((slot, name) =>
          slot === "runtime" ? null : original(slot, name),
        );
      }
      if (mode === "hang")
        vi.mocked(mockRuntime.isAlive).mockImplementation(() => new Promise(() => {}));
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const sm = createSessionManager({ config, registry: mockRegistry });
        await sm.kill("app-1", { purgeOpenCode: true });
        // Direct purge already tests the bound; avoid list()'s separate timeout on the hanging double.
        if (mode !== "hang") await sm.cleanup();
        expect(readMockApiSessions(mockBin).map((s) => s.id)).toEqual(["ses_shared"]);
        expect(stderr.mock.calls.map((call) => String(call[0])).join("")).toContain(
          mode === "agent alive" ? "live session app-2 uses it" : "liveness could not be checked",
        );
      } finally {
        stderr.mockRestore();
      }
    });

    it.each([
      "permission denied",
      "no server running on /tmp/other",
      "error connecting to /tmp/other (No such file or directory)",
      "unexpected exit code",
      "",
    ])("keeps a holder when tmux reports %s as false", async (diagnostic) => {
      const mockBin = installMockOpencodeApi(tmpDir, [{ id: "ses_shared", title: "AO:app-1" }]);
      writeFileSync(
        join(mockBin, "tmux"),
        `#!/usr/bin/env node\nconsole.error(${JSON.stringify(diagnostic === "unexpected exit code" ? "can't find session: holder" : diagnostic)}); process.exit(${diagnostic === "unexpected exit code" ? 2 : 1});\n`,
      );
      chmodSync(join(mockBin, "tmux"), 0o755);
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      writeSharedPair("merged");
      updateMetadata(sessionsDir, "app-2", {
        runtimeHandle: JSON.stringify({ id: "holder", runtimeName: "tmux", data: {} }),
      });
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
      vi.mocked(mockAgent.isProcessRunning).mockResolvedValue(false);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const sm = createSessionManager({ config, registry: mockRegistry });
        await sm.kill("app-1", { purgeOpenCode: true });
        const cleaned = await sm.cleanup();
        expect(cleaned.killed).not.toContain("app-2");
        expect(readMetadata(sessionsDir, "app-2")).not.toBeNull();
        expect(readMockApiSessions(mockBin).map((session) => session.id)).toEqual(["ses_shared"]);
        expect(stderr.mock.calls.map((call) => String(call[0])).join("")).toContain(
          "liveness could not be checked",
        );
      } finally {
        stderr.mockRestore();
      }
    });

    it("keeps a Herdr holder after a negative runtime check without trusting the agent negative", async () => {
      const bin = installMockOpencodeApi(tmpDir, [{ id: "ses_shared", title: "AO:app-1" }]);
      process.env.PATH = `${bin}:${originalPath ?? ""}`;
      writeSharedPair("merged");
      updateMetadata(sessionsDir, "app-2", {
        runtimeHandle: JSON.stringify({ id: "w1:p1", runtimeName: "herdr", data: {} }),
      });
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
      vi.mocked(mockAgent.isProcessRunning).mockResolvedValue(false);
      const sm = createSessionManager({ config, registry: mockRegistry });
      await sm.kill("app-1", { purgeOpenCode: true });
      const result = await sm.cleanup();
      expect(result.killed).not.toContain("app-2");
      expect(readMockApiSessions(bin).map((s) => s.id)).toEqual(["ses_shared"]);
      expect(mockAgent.isProcessRunning).not.toHaveBeenCalled();
    });

    it("removes the shared ID after tmux explicitly answers that the holder is gone", async () => {
      const bin = installMockOpencodeApi(tmpDir, [{ id: "ses_shared", title: "AO:app-1" }]);
      writeFileSync(
        join(bin, "tmux"),
        '#!/bin/sh\necho "can\'t find session: holder" >&2\nexit 1\n',
      );
      chmodSync(join(bin, "tmux"), 0o755);
      process.env.PATH = `${bin}:${originalPath ?? ""}`;
      writeSharedPair("merged");
      updateMetadata(sessionsDir, "app-2", {
        runtimeHandle: JSON.stringify({ id: "holder", runtimeName: "tmux", data: {} }),
      });
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
      vi.mocked(mockAgent.isProcessRunning).mockResolvedValue(false);
      await createSessionManager({ config, registry: mockRegistry }).kill("app-1", {
        purgeOpenCode: true,
      });
      expect(readMockApiSessions(bin)).toEqual([]);
    });

    it("removes it when the other session that stores it is killed", async () => {
      const deleteLogPath = join(tmpDir, "opencode-delete-kill-shared-dead.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_shared", title: "AO:app-1", directory: "/tmp/ws" }],
        { deleteLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      writeSharedPair("killed");
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
      vi.mocked(mockAgent.isProcessRunning).mockResolvedValue(false);

      const sm = createSessionManager({ config, registry: mockRegistry });
      await sm.kill("app-1", { purgeOpenCode: true });

      expect(readFileSync(deleteLogPath, "utf-8")).toContain(
        "api session.remove --param sessionID=ses_shared",
      );
      expect(readMockApiSessions(mockBin)).toEqual([]);
    });

    it("cleanup keeps an archived mapping while a live session uses it", async () => {
      const apiLogPath = join(tmpDir, "opencode-api-cleanup-shared.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_shared", title: "AO:app-1", directory: "/tmp/ws" }],
        { apiLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      writeSharedPair("working");
      deleteMetadata(sessionsDir, "app-1", true);

      const sm = createSessionManager({ config, registry: mockRegistry });
      const result = await sm.cleanup();

      expect(result.skipped).toContain("app-1");
      expect(result.killed).not.toContain("app-1");
      expect(existsSync(apiLogPath)).toBe(false);
      expect(readMockApiSessions(mockBin).map((session) => session.id)).toEqual(["ses_shared"]);
    });
  });

  it("warns once with the ID and the retry when the purge fails, and cleanup retries it (m-5)", async () => {
    const failingBin = installMockOpencodeApi(
      tmpDir,
      [{ id: "ses_stuck", title: "AO:app-1", directory: "/tmp/ws" }],
      { failOperations: ["session.remove"] },
    );
    process.env.PATH = `${failingBin}:${originalPath ?? ""}`;

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp/ws",
      branch: "main",
      status: "working",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_stuck",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const sm = createSessionManager({ config, registry: mockRegistry });
    try {
      await expect(sm.kill("app-1", { purgeOpenCode: true })).resolves.toBeUndefined();
      const warning = stderr.mock.calls.map((call) => String(call[0])).join("");
      expect(warning.trim().split("\n")).toHaveLength(1);
      expect(warning).toContain("could not remove OpenCode session ses_stuck of app-1");
      expect(warning).toContain("`ao session cleanup` retries the removal");
    } finally {
      stderr.mockRestore();
    }
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"]).toBeUndefined();

    // The service answers again: cleanup removes the archived mapping.
    const deleteLogPath = join(tmpDir, "opencode-delete-retry.log");
    const workingBin = installMockOpencodeApi(
      tmpDir,
      [{ id: "ses_stuck", title: "AO:app-1", directory: "/tmp/ws" }],
      { deleteLogPath },
    );
    process.env.PATH = `${workingBin}:${originalPath ?? ""}`;
    const result = await sm.cleanup();

    expect(result.killed).toContain("app-1");
    expect(readFileSync(deleteLogPath, "utf-8")).toContain(
      "api session.remove --param sessionID=ses_stuck",
    );
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"]).toBeTruthy();
  }, 30_000);

  it("ends a purge at its bound when the binary hangs, and still archives", async () => {
    apiBound.capMs = 1_500;
    const apiLogPath = join(tmpDir, "opencode-api-kill-hang.log");
    const mockBin = installMockOpencodeApi(
      tmpDir,
      [{ id: "ses_hang", title: "AO:app-1", directory: "/tmp/ws" }],
      { apiDelaySeconds: 60, apiLogPath },
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp/ws",
      branch: "main",
      status: "working",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_hang",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const sm = createSessionManager({ config, registry: mockRegistry });
      const started = Date.now();
      await sm.kill("app-1", { purgeOpenCode: true });
      const elapsedMs = Date.now() - started;

      // One bounded interrupt, then one bounded remove: a timeout ends the
      // remove retries. Two bounds plus process exits, far below the 60 s
      // that the binary hangs.
      const operations = readFileSync(apiLogPath, "utf-8")
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as string[])[1]);
      expect(operations).toEqual(["session.interrupt", "session.remove"]);
      expect(elapsedMs).toBeLessThan(6_000);
      const warning = stderr.mock.calls.map((call) => String(call[0])).join("");
      expect(warning).toContain("did not answer within 1500 ms");
      // One line: the `execFile` message of a timeout ends with a newline.
      expect(warning.trim().split("\n")).toHaveLength(1);
    } finally {
      stderr.mockRestore();
    }
    expect(readMetadata(sessionsDir, "app-1")).toBeNull();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"]).toBeUndefined();
  }, 20_000);
});

describe("cleanup", () => {
  it("kills sessions with merged PRs", async () => {
    const mockSCM: SCM = {
      name: "mock-scm",
      detectPR: vi.fn(),
      getPRState: vi.fn().mockResolvedValue("merged"),
      mergePR: vi.fn(),
      closePR: vi.fn(),
      getCIChecks: vi.fn(),
      getCISummary: vi.fn(),
      getReviews: vi.fn(),
      getReviewDecision: vi.fn(),
      getPendingComments: vi.fn(),
      getAutomatedComments: vi.fn(),
      getMergeability: vi.fn(),
    };

    const registryWithSCM: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        if (slot === "scm") return mockSCM;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp",
      branch: "main",
      status: "pr_open",
      project: "my-app",
      pr: "https://github.com/org/repo/pull/10",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: registryWithSCM });
    const result = await sm.cleanup();

    expect(result.killed).toContain("app-1");
    expect(result.skipped).toHaveLength(0);
  });

  it("deletes mapped OpenCode session during cleanup", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete.log");
    const mockBin = installMockOpencode(
      tmpDir,
      JSON.stringify([{ id: "ses_cleanup", title: "AO:app-1" }]),
      deleteLogPath,
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    const mockSCM: SCM = {
      name: "mock-scm",
      detectPR: vi.fn(),
      getPRState: vi.fn().mockResolvedValue("merged"),
      mergePR: vi.fn(),
      closePR: vi.fn(),
      getCIChecks: vi.fn(),
      getCISummary: vi.fn(),
      getReviews: vi.fn(),
      getReviewDecision: vi.fn(),
      getPendingComments: vi.fn(),
      getAutomatedComments: vi.fn(),
      getMergeability: vi.fn(),
    };

    const registryWithSCM: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        if (slot === "scm") return mockSCM;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp",
      branch: "main",
      status: "pr_open",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_cleanup",
      pr: "https://github.com/org/repo/pull/10",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: registryWithSCM });
    const result = await sm.cleanup();

    expect(result.killed).toContain("app-1");
    const deleteLog = readFileSync(deleteLogPath, "utf-8");
    expect(deleteLog).toContain("session.remove");
    expect(deleteLog).toContain("sessionID=ses_cleanup");
  });

  it("treats missing mapped OpenCode session as already cleaned", async () => {
    const mockBin = installMockOpencodeWithNotFoundDelete(tmpDir, "[]");
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    const mockSCM: SCM = {
      name: "mock-scm",
      detectPR: vi.fn(),
      getPRState: vi.fn().mockResolvedValue("merged"),
      mergePR: vi.fn(),
      closePR: vi.fn(),
      getCIChecks: vi.fn(),
      getCISummary: vi.fn(),
      getReviews: vi.fn(),
      getReviewDecision: vi.fn(),
      getPendingComments: vi.fn(),
      getAutomatedComments: vi.fn(),
      getMergeability: vi.fn(),
    };

    const registryWithSCM: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        if (slot === "scm") return mockSCM;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp",
      branch: "main",
      status: "pr_open",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_missing",
      pr: "https://github.com/org/repo/pull/10",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: registryWithSCM });
    const result = await sm.cleanup();

    expect(result.killed).toContain("app-1");
    expect(result.errors).toEqual([]);
  });

  it("deletes mapped OpenCode session from archived killed sessions", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-archived.log");
    const mockBin = installMockOpencode(
      tmpDir,
      JSON.stringify([{ id: "ses_archived", title: "AO:app-6" }]),
      deleteLogPath,
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    writeMetadata(sessionsDir, "app-6", {
      worktree: "/tmp",
      branch: "main",
      status: "spawning",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_archived",
      runtimeHandle: JSON.stringify(makeHandle("rt-6")),
    });
    deleteMetadata(sessionsDir, "app-6", true);

    const sm = createSessionManager({ config, registry: mockRegistry });
    const result = await sm.cleanup();

    expect(result.killed).toContain("app-6");
    const deleteLog = readFileSync(deleteLogPath, "utf-8");
    expect(deleteLog).toContain("session.remove");
    expect(deleteLog).toContain("sessionID=ses_archived");
  });

  it("does not skip archived cleanup for matching session IDs in other projects", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-archived-cross-project.log");
    const mockBin = installMockOpencode(
      tmpDir,
      JSON.stringify([{ id: "ses_archived_project2", title: "AO:app-1" }]),
      deleteLogPath,
    );
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    const project2Path = join(tmpDir, "my-app-2");
    const configWithSecondProject: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "my-app-2": {
          name: "My App 2",
          repo: "org/my-app-2",
          path: project2Path,
          defaultBranch: "main",
          sessionPrefix: "app",
          scm: { plugin: "github" },
          tracker: { plugin: "github" },
        },
      },
    };
    const sessionsDir2 = getSessionsDir(configPath, project2Path);
    mkdirSync(sessionsDir2, { recursive: true });

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp/project-1",
      branch: "main",
      status: "working",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    writeMetadata(sessionsDir2, "app-1", {
      worktree: "/tmp/project-2",
      branch: "main",
      status: "killed",
      project: "my-app-2",
      agent: "opencode",
      opencodeSessionId: "ses_archived_project2",
      runtimeHandle: JSON.stringify(makeHandle("rt-2")),
    });
    deleteMetadata(sessionsDir2, "app-1", true);

    const sm = createSessionManager({ config: configWithSecondProject, registry: mockRegistry });
    const result = await sm.cleanup();

    const deleteLog = readFileSync(deleteLogPath, "utf-8");
    expect(deleteLog).toContain("session.remove");
    expect(deleteLog).toContain("sessionID=ses_archived_project2");
    expect(result.killed).toContain("my-app-2:app-1");
    expect(result.skipped).toContain("my-app:app-1");
  });

  it("skips invalid archived OpenCode session ids during cleanup", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-archived-invalid.log");
    const mockBin = installMockOpencode(tmpDir, "[]", deleteLogPath);
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    writeMetadata(sessionsDir, "app-8", {
      worktree: "/tmp",
      branch: "main",
      status: "spawning",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses bad id",
      runtimeHandle: JSON.stringify(makeHandle("rt-8")),
    });
    deleteMetadata(sessionsDir, "app-8", true);

    const sm = createSessionManager({ config, registry: mockRegistry });
    const result = await sm.cleanup();

    expect(result.killed).not.toContain("app-8");
    expect(result.errors).toEqual([]);
    expect(result.skipped).toContain("app-8");
    expect(existsSync(deleteLogPath)).toBe(false);
  });

  it("does not delete archived OpenCode sessions in cleanup dry-run", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-archived-dry-run.log");
    const mockBin = installMockOpencode(tmpDir, "[]", deleteLogPath);
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    writeMetadata(sessionsDir, "app-7", {
      worktree: "/tmp",
      branch: "main",
      status: "spawning",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_archived_dry_run",
      runtimeHandle: JSON.stringify(makeHandle("rt-7")),
    });
    deleteMetadata(sessionsDir, "app-7", true);

    const sm = createSessionManager({ config, registry: mockRegistry });
    const result = await sm.cleanup(undefined, { dryRun: true });

    expect(result.killed).toContain("app-7");
    expect(existsSync(deleteLogPath)).toBe(false);
  });

  it("skips sessions without merged PRs or completed issues", async () => {
    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp",
      branch: "main",
      status: "working",
      project: "my-app",
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    const result = await sm.cleanup();

    expect(result.killed).toHaveLength(0);
    expect(result.skipped).toContain("app-1");
  });

  it("skips orchestrator sessions by role metadata", async () => {
    const deadRuntime: Runtime = {
      ...mockRuntime,
      isAlive: vi.fn().mockResolvedValue(false),
    };
    const registryWithDead: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return deadRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    // Session with role=orchestrator but a name that does NOT end in "-orchestrator"
    // so only the role metadata check can protect it (not the name fallback)
    writeMetadata(sessionsDir, "app-99", {
      worktree: "/tmp",
      branch: "main",
      status: "working",
      role: "orchestrator",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-orch")),
    });

    const sm = createSessionManager({ config, registry: registryWithDead });
    const result = await sm.cleanup();

    expect(result.killed).toHaveLength(0);
    expect(result.skipped).toContain("app-99");
  });

  it("skips orchestrator sessions by name fallback (no role metadata)", async () => {
    const deadRuntime: Runtime = {
      ...mockRuntime,
      isAlive: vi.fn().mockResolvedValue(false),
    };
    const registryWithDead: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return deadRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    // Pre-existing orchestrator session without role field
    writeMetadata(sessionsDir, "app-orchestrator", {
      worktree: "/tmp",
      branch: "main",
      status: "working",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-orch")),
    });

    const sm = createSessionManager({ config, registry: registryWithDead });
    const result = await sm.cleanup();

    expect(result.killed).toHaveLength(0);
    expect(result.skipped).toContain("app-orchestrator");
  });

  it("never cleans the canonical orchestrator session even with stale worker-like metadata", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-orchestrator.log");
    const mockBin = installMockOpencode(tmpDir, "[]", deleteLogPath);
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    const deadRuntime: Runtime = {
      ...mockRuntime,
      isAlive: vi.fn().mockResolvedValue(false),
    };
    const mockSCM: SCM = {
      name: "mock-scm",
      detectPR: vi.fn(),
      getPRState: vi.fn().mockResolvedValue("merged"),
      mergePR: vi.fn(),
      closePR: vi.fn(),
      getCIChecks: vi.fn(),
      getCISummary: vi.fn(),
      getReviews: vi.fn(),
      getReviewDecision: vi.fn(),
      getPendingComments: vi.fn(),
      getAutomatedComments: vi.fn(),
      getMergeability: vi.fn(),
    };
    const mockTracker: Tracker = {
      name: "mock-tracker",
      getIssue: vi.fn().mockResolvedValue({
        id: "INT-42",
        title: "Issue",
        description: "",
        url: "https://example.com/INT-42",
        state: "closed",
        labels: [],
      }),
      isCompleted: vi.fn().mockResolvedValue(true),
      issueUrl: vi.fn().mockReturnValue("https://example.com/INT-42"),
      branchName: vi.fn().mockReturnValue("feat/INT-42"),
      generatePrompt: vi.fn().mockResolvedValue(""),
    };
    const registryWithSignals: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return deadRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        if (slot === "scm") return mockSCM;
        if (slot === "tracker") return mockTracker;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-orchestrator", {
      worktree: "/tmp",
      branch: "main",
      status: "ci_failed",
      project: "my-app",
      issue: "INT-42",
      pr: "https://github.com/org/repo/pull/10",
      agent: "opencode",
      opencodeSessionId: "ses_orchestrator_active",
      runtimeHandle: JSON.stringify(makeHandle("rt-orchestrator")),
    });

    const sm = createSessionManager({ config, registry: registryWithSignals });
    const result = await sm.cleanup();

    expect(result.killed).not.toContain("app-orchestrator");
    expect(result.skipped).toContain("app-orchestrator");
    expect(existsSync(deleteLogPath)).toBe(false);
  });

  it("never cleans archived orchestrator mappings even when metadata looks stale", async () => {
    const deleteLogPath = join(tmpDir, "opencode-delete-archived-orchestrator.log");
    const mockBin = installMockOpencode(tmpDir, "[]", deleteLogPath);
    process.env.PATH = `${mockBin}:${originalPath ?? ""}`;

    writeMetadata(sessionsDir, "app-orchestrator", {
      worktree: "/tmp",
      branch: "main",
      status: "killed",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_orchestrator_archived",
      pr: "https://github.com/org/repo/pull/88",
      runtimeHandle: JSON.stringify(makeHandle("rt-orchestrator")),
    });
    deleteMetadata(sessionsDir, "app-orchestrator", true);

    const sm = createSessionManager({ config, registry: mockRegistry });
    const result = await sm.cleanup();

    expect(result.killed).not.toContain("app-orchestrator");
    expect(result.skipped).toContain("app-orchestrator");
    expect(existsSync(deleteLogPath)).toBe(false);
  });

  it("kills sessions with dead runtimes", async () => {
    const deadRuntime: Runtime = {
      ...mockRuntime,
      isAlive: vi.fn().mockResolvedValue(false),
    };
    const registryWithDead: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return deadRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp",
      branch: "main",
      status: "working",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
    });

    const sm = createSessionManager({ config, registry: registryWithDead });
    const result = await sm.cleanup();

    expect(result.killed).toContain("app-1");
  });
  it.each(["unmapped", "unshared"])(
    "archives a dead Herdr OpenCode session with an %s ID",
    async (kind) => {
      const bin = installMockOpencodeApi(tmpDir, [{ id: "ses_only", title: "AO:app-1" }]);
      process.env.PATH = `${bin}:${originalPath ?? ""}`;
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
      writeMetadata(sessionsDir, "app-1", {
        worktree: "/tmp",
        branch: "main",
        status: "working",
        project: "my-app",
        agent: "opencode",
        ...(kind === "unshared" ? { opencodeSessionId: "ses_only" } : {}),
        runtimeHandle: JSON.stringify({ id: "w1:p1", runtimeName: "herdr", data: {} }),
      });
      const sm = createSessionManager({ config, registry: mockRegistry });
      expect((await sm.cleanup()).killed).toContain("app-1");
      expect(readMetadata(sessionsDir, "app-1")).toBeNull();
      expect(readArchivedMetadataRaw(sessionsDir, "app-1")).not.toBeNull();
      expect((await sm.cleanup()).killed).not.toContain("app-1");
    },
  );
});
