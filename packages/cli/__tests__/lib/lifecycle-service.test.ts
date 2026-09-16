import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStateRoot, type OrchestratorConfig } from "@aoagents/ao-core";
import type * as NodeChildProcess from "node:child_process";
import type * as NodeFs from "node:fs";
import { fileURLToPath } from "node:url";

const {
  mockCloseSync,
  mockExistsSync,
  mockMkdirSync,
  mockOpenSync,
  mockReadFileSync,
  mockSpawn,
  mockUnlinkSync,
  mockUnref,
  mockWriteFileSync,
} = vi.hoisted(() => ({
  mockCloseSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockOpenSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockSpawn: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockUnref: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>();
  return { ...actual, spawn: mockSpawn };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    closeSync: mockCloseSync,
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    openSync: mockOpenSync,
    readFileSync: mockReadFileSync,
    unlinkSync: mockUnlinkSync,
    writeFileSync: mockWriteFileSync,
  };
});

import { ensureLifecycleWorker } from "../../src/lib/lifecycle-service.js";

const config = {
  configPath: fileURLToPath(new URL("../../package.json", import.meta.url)),
  projects: {
    app: {
      name: "app",
      path: "/tmp/ao-fix-round2/project",
    },
  },
} as OrchestratorConfig;

describe("ensureLifecycleWorker state-root propagation", () => {
  let originalNodeEnv: string | undefined;
  let originalStateRoot: string | undefined;
  let pidWritten: boolean;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalNodeEnv = process.env["NODE_ENV"];
    originalStateRoot = process.env["AO_STATE_ROOT"];
    pidWritten = false;

    mockExistsSync.mockImplementation(() => pidWritten);
    mockMkdirSync.mockReturnValue(undefined);
    mockOpenSync.mockReturnValue(41);
    mockReadFileSync.mockReturnValue("4242\n");
    mockSpawn.mockReturnValue({ pid: 4242, unref: mockUnref });
    mockWriteFileSync.mockImplementation(() => {
      pidWritten = true;
    });
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = originalNodeEnv;
    if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
    else process.env["AO_STATE_ROOT"] = originalStateRoot;
    killSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("passes the parent PID-scoped test root when AO_STATE_ROOT is unset", async () => {
    process.env["NODE_ENV"] = "test";
    delete process.env["AO_STATE_ROOT"];
    const parentStateRoot = getStateRoot();

    await ensureLifecycleWorker(config, "app");

    const spawnOptions = mockSpawn.mock.calls[0]?.[2] as {
      env: NodeJS.ProcessEnv;
    };
    expect(parentStateRoot).toContain(`ao-test-state-${process.pid}`);
    expect(spawnOptions.env["AO_STATE_ROOT"]).toBe(parentStateRoot);
  });

  it("passes the resolved explicit AO_STATE_ROOT override", async () => {
    process.env["NODE_ENV"] = "test";
    process.env["AO_STATE_ROOT"] = "/tmp/ao-fix-round2/state/../state";
    const resolvedStateRoot = getStateRoot();

    await ensureLifecycleWorker(config, "app");

    const spawnOptions = mockSpawn.mock.calls[0]?.[2] as {
      env: NodeJS.ProcessEnv;
    };
    expect(resolvedStateRoot).toBe("/tmp/ao-fix-round2/state");
    expect(spawnOptions.env["AO_STATE_ROOT"]).toBe(resolvedStateRoot);
  });
});
