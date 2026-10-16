import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { listMetadata, readMetadataRaw, writeMetadata } from "../../metadata.js";
import type { Workspace } from "../../types.js";
import {
  setupTestContext,
  teardownTestContext,
  makeHandle,
  type TestContext,
} from "../test-utils.js";

let ctx: TestContext;

beforeEach(() => {
  ctx = setupTestContext();
});

afterEach(() => {
  teardownTestContext(ctx);
});

describe("m-13 restore branch gate", () => {
  it("restore with stored branch=-Bvictim throws naming the session and runs no git", async () => {
    const wsPath = join(ctx.tmpDir, "ws-app-1");
    // Workspace missing so restore would call workspace.restore.
    const mockWorkspaceWithRestore: Workspace = {
      ...ctx.mockWorkspace,
      exists: vi.fn().mockResolvedValue(false),
      restore: vi.fn().mockResolvedValue({
        path: wsPath,
        branch: "-Bvictim",
        sessionId: "app-1",
        projectId: "my-app",
      }),
    };
    const registry = {
      ...ctx.mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return ctx.mockRuntime;
        if (slot === "agent") return ctx.mockAgent;
        if (slot === "workspace") return mockWorkspaceWithRestore;
        return null;
      }),
    };

    writeMetadata(ctx.sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "-Bvictim",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config: ctx.config, registry });
    await expect(sm.restore("app-1")).rejects.toThrow(/app-1.*branch metadata.*is not valid/i);
    expect(mockWorkspaceWithRestore.restore).not.toHaveBeenCalled();
    expect(ctx.mockRuntime.create).not.toHaveBeenCalled();
  });

  it("restore still works for a valid stored branch", async () => {
    const wsPath = join(ctx.tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });
    writeMetadata(ctx.sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
    const restored = await sm.restore("app-1");
    expect(restored.branch).toBe("feat/TEST-1");
  });
});

describe("m-13 spawn branch gate", () => {
  it("spawn with branch=-Bvictim throws and creates no workspace", async () => {
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
    await expect(
      sm.spawn({ projectId: "my-app", branch: "-Bvictim", prompt: "hi" }),
    ).rejects.toThrow(/branch metadata.*is not valid/i);
    expect(ctx.mockWorkspace.create).not.toHaveBeenCalled();
  });

  // m-15: a spawn that the branch gate refuses must not leave its reserved
  // session record. Count the records before and after.
  it("m-15 refused spawn leaves no session record", async () => {
    const before = listMetadata(ctx.sessionsDir).length;
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
    await expect(
      sm.spawn({ projectId: "my-app", branch: "-Bvictim", prompt: "hi" }),
    ).rejects.toThrow(/branch metadata.*is not valid/i);
    const after = listMetadata(ctx.sessionsDir).length;
    expect(after).toBe(before);
    expect(readMetadataRaw(ctx.sessionsDir, "app-1")).toBeNull();
    expect(ctx.mockWorkspace.create).not.toHaveBeenCalled();
  });

  // m-15: the orchestrator spawn gate has the same order as the worker
  // spawn path: a refusal deletes the reservation. The isolated orchestrator
  // branch orchestrator/<prefix>-orchestrator-<n> always passes with a
  // schema-valid prefix ([a-zA-Z0-9_-]+), so force the gate to refuse by
  // mocking the rule for this test only.
  it("m-15 refused orchestrator spawn leaves no session record", async () => {
    const branchNameModule = await import("../../utils/branch-name.js");
    const real = branchNameModule.isSafeBranchName;
    const spy = vi
      .spyOn(branchNameModule, "isSafeBranchName")
      .mockImplementation((name: string) =>
        name.startsWith("orchestrator/") ? false : real(name),
      );
    try {
      const before = listMetadata(ctx.sessionsDir).length;
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
      await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
        /branch metadata.*is not valid/i,
      );
      const after = listMetadata(ctx.sessionsDir).length;
      expect(after).toBe(before);
      expect(readMetadataRaw(ctx.sessionsDir, "app-orchestrator-1")).toBeNull();
      expect(ctx.mockWorkspace.create).not.toHaveBeenCalled();
      expect(readdirSync(ctx.sessionsDir)).not.toContain("app-orchestrator-1");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("m-13 claimPR branch gate", () => {
  it("claimPR with pr.branch=-Bvictim throws and runs no checkout", async () => {
    const wsPath = join(ctx.tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });
    writeMetadata(ctx.sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "working",
      project: "my-app",
    });
    const mockSCM = {
      name: "github",
      resolvePR: vi.fn().mockResolvedValue({
        number: 1,
        url: "https://github.com/org/my-app/pull/1",
        title: "t",
        owner: "org",
        repo: "my-app",
        branch: "-Bvictim",
        baseBranch: "main",
        isDraft: false,
      }),
      getPRState: vi.fn().mockResolvedValue("open"),
      checkoutPR: vi.fn().mockResolvedValue(true),
    };
    const registry = {
      ...ctx.mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return ctx.mockRuntime;
        if (slot === "agent") return ctx.mockAgent;
        if (slot === "workspace") return ctx.mockWorkspace;
        if (slot === "scm") return mockSCM;
        if (slot === "tracker") return null;
        return null;
      }),
    };
    const sm = createSessionManager({ config: ctx.config, registry });
    await expect(sm.claimPR("app-1", "1")).rejects.toThrow(/app-1.*branch metadata.*is not valid/i);
    expect(mockSCM.checkoutPR).not.toHaveBeenCalled();
  });
});
