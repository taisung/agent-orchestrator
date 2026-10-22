/**
 * Review r1 M-3 (2026-10-22): a `Runtime.isAlive` answer that is not a
 * boolean (`undefined`, `null`, `0` from a faulty plugin) is no answer. The
 * enrichment of `sm.list` and `sm.get` keeps the stored status, as for a
 * rejection, and `spawnOrchestrator` neither reuses nor replaces the record.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSessionManager } from "../../session-manager.js";
import { writeMetadata, readMetadataRaw, readArchivedMetadataRaw } from "../../metadata.js";
import type { OrchestratorConfig, PluginRegistry, Runtime } from "../../types.js";
import {
  setupTestContext,
  teardownTestContext,
  makeHandle,
  type TestContext,
} from "../test-utils.js";

let ctx: TestContext;
let sessionsDir: string;
let mockRuntime: Runtime;
let mockRegistry: PluginRegistry;
let config: OrchestratorConfig;

const MALFORMED = [
  { answer: "undefined", value: undefined },
  { answer: "null", value: null },
  { answer: "0", value: 0 },
] as const;

beforeEach(() => {
  ctx = setupTestContext();
  ({ sessionsDir, mockRuntime, mockRegistry, config } = ctx);
  config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
  writeMetadata(sessionsDir, "app-orchestrator", {
    worktree: config.projects["my-app"]!.path,
    branch: "main",
    status: "working",
    role: "orchestrator",
    project: "my-app",
    runtimeHandle: JSON.stringify(makeHandle("rt-old")),
  });
});

afterEach(() => {
  teardownTestContext(ctx);
});

describe("a malformed isAlive answer (review r1 M-3)", () => {
  it.each(MALFORMED)(
    "sm.list and sm.get keep the stored status when isAlive answers $answer",
    async ({ value }) => {
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(value as unknown as boolean);
      const sm = createSessionManager({ config, registry: mockRegistry });

      const listed = (await sm.list("my-app")).find((s) => s.id === "app-orchestrator");
      const got = await sm.get("app-orchestrator");

      expect(listed?.status).toBe("working");
      expect(listed?.activity).not.toBe("exited");
      expect(got?.status).toBe("working");
      expect(got?.activity).not.toBe("exited");
    },
  );

  it.each(MALFORMED)(
    "spawnOrchestrator neither reuses nor replaces the record when isAlive answers $answer",
    async ({ answer, value }) => {
      vi.mocked(mockRuntime.isAlive).mockResolvedValue(value as unknown as boolean);
      const sm = createSessionManager({ config, registry: mockRegistry });

      await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
        `Cannot tell whether session app-orchestrator is alive (the liveness check answered ${answer}, not true or false), so it is neither reused nor replaced. Check the runtime and retry.`,
      );

      expect(readMetadataRaw(sessionsDir, "app-orchestrator")?.["runtimeHandle"]).toBe(
        JSON.stringify(makeHandle("rt-old")),
      );
      expect(readArchivedMetadataRaw(sessionsDir, "app-orchestrator")).toBeNull();
      expect(mockRuntime.create).not.toHaveBeenCalled();
      expect(mockRuntime.destroy).not.toHaveBeenCalled();
    },
  );
});
