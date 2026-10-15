import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AO_METADATA_HELPER,
  GH_WRAPPER,
  GIT_WRAPPER,
  buildAgentPath,
  setupPathWrapperWorkspace,
} from "../agent-workspace-hooks.js";

const { mockWriteFile, mockMkdir, mockReadFile, mockRename } = vi.hoisted(() => ({
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockReadFile: vi.fn(),
  mockRename: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  readFile: mockReadFile,
  rename: mockRename,
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

describe("buildAgentPath", () => {
  it("prepends ao bin dir to PATH", () => {
    const result = buildAgentPath("/usr/bin:/bin");
    expect(result).toMatch(/^\/home\/testuser\/.ao\/bin:/);
    expect(result).toContain("/usr/bin");
    expect(result).toContain("/bin");
  });

  it("deduplicates entries", () => {
    const result = buildAgentPath("/usr/local/bin:/usr/bin:/usr/local/bin");
    const entries = result.split(":");
    const unique = new Set(entries);
    expect(entries.length).toBe(unique.size);
  });

  it("uses default PATH when basePath is undefined", () => {
    const result = buildAgentPath(undefined);
    expect(result).toMatch(/^\/home\/testuser\/.ao\/bin:/);
    expect(result).toContain("/usr/bin");
  });

  it("keeps the inherited order after the ao bin dir and adds no /usr/local/bin", () => {
    // /usr/local/bin can hold old agent binaries (claude, codex, gemini) that
    // must not shadow the user's copies; GH_PATH already selects gh.
    expect(buildAgentPath("/home/u/.local/bin:/usr/bin:/usr/local/bin:/bin")).toBe(
      "/home/testuser/.ao/bin:/home/u/.local/bin:/usr/bin:/usr/local/bin:/bin",
    );
    expect(buildAgentPath(undefined)).toBe("/home/testuser/.ao/bin:/usr/bin:/bin");
  });
});

describe("AO_METADATA_HELPER", () => {
  it("updates metadata under the configured state root and rejects paths outside it", () => {
    const stateRoot = mkdtempSync("/var/tmp/ao-x-");
    const outsideRoot = mkdtempSync("/var/tmp/ao-outside-");
    const sessionsDir = join(stateRoot, "instance", "sessions");
    const outsideSessionsDir = join(outsideRoot, "instance", "sessions");
    const helperPath = join(stateRoot, "ao-metadata-helper.sh");
    const sessionId = "app-1";
    const metadataPath = join(sessionsDir, sessionId);
    const outsideMetadataPath = join(outsideSessionsDir, sessionId);

    try {
      mkdirSync(sessionsDir, { recursive: true });
      mkdirSync(outsideSessionsDir, { recursive: true });
      writeFileSync(helperPath, AO_METADATA_HELPER);
      writeFileSync(metadataPath, "status=working\n");
      writeFileSync(outsideMetadataPath, "status=working\n");

      const runHelper = (dataDir: string): void => {
        execFileSync(
          "bash",
          [
            "-c",
            'source "$1"; update_ao_metadata "$2" "$3"',
            "bash",
            helperPath,
            "status",
            "updated",
          ],
          {
            env: {
              ...process.env,
              AO_STATE_ROOT: stateRoot,
              AO_DATA_DIR: dataDir,
              AO_SESSION: sessionId,
            },
          },
        );
      };

      runHelper(sessionsDir);
      expect(readFileSync(metadataPath, "utf8")).toBe("status=updated\n");

      runHelper(outsideSessionsDir);
      expect(readFileSync(outsideMetadataPath, "utf8")).toBe("status=working\n");
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe("setupPathWrapperWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
  });

  it("creates ao bin directory", async () => {
    await setupPathWrapperWorkspace("/workspace");
    expect(mockMkdir).toHaveBeenCalledWith("/home/testuser/.ao/bin", { recursive: true });
  });

  it("writes wrapper scripts when version marker is missing", async () => {
    await setupPathWrapperWorkspace("/workspace");
    // atomicWriteFile writes to .tmp then renames
    expect(mockRename).toHaveBeenCalled();
    // .ao/AGENTS.md is written directly
    const agentsMdWrites = mockWriteFile.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes(".ao/AGENTS.md"),
    );
    expect(agentsMdWrites).toHaveLength(1);
  });

  it("skips wrapper rewrite when version matches and files are current", async () => {
    mockReadFile.mockImplementation((path: string) => {
      const p = String(path);
      if (p.endsWith(".ao-version")) return Promise.resolve("0.2.2");
      if (p.endsWith("ao-metadata-helper.sh")) return Promise.resolve(AO_METADATA_HELPER);
      if (p.endsWith("/gh")) return Promise.resolve(GH_WRAPPER);
      if (p.endsWith("/git")) return Promise.resolve(GIT_WRAPPER);
      return Promise.reject(new Error("ENOENT"));
    });

    await setupPathWrapperWorkspace("/workspace");

    // A current marker plus current files suppresses all helper/wrapper rewrites.
    const renamedPaths = mockRename.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(renamedPaths.filter((p: string) => p.includes("/gh."))).toHaveLength(0);
    expect(renamedPaths.filter((p: string) => p.includes("/git."))).toHaveLength(0);
  });

  it("repairs a missing wrapper file when the version marker matches", async () => {
    mockReadFile.mockImplementation((path: string) => {
      const p = String(path);
      if (p.endsWith(".ao-version")) return Promise.resolve("0.2.2");
      if (p.endsWith("ao-metadata-helper.sh")) return Promise.resolve(AO_METADATA_HELPER);
      if (p.endsWith("/gh")) return Promise.resolve(GH_WRAPPER);
      if (p.endsWith("/git")) return Promise.reject(new Error("ENOENT"));
      return Promise.reject(new Error("ENOENT"));
    });

    await setupPathWrapperWorkspace("/workspace");

    // Missing git wrapper must be rewritten even though the marker matches.
    expect(mockRename).toHaveBeenCalled();
    const renamedTmpPaths = mockRename.mock.calls.map((c: unknown[]) => String(c[0]));
    const renamedDestPaths = mockRename.mock.calls.map((c: unknown[]) => String(c[1]));
    const allRenamed = [...renamedTmpPaths, ...renamedDestPaths];
    expect(allRenamed.some((p: string) => p.includes("/git"))).toBe(true);
  });

  it("repairs a stale wrapper file when the version marker matches", async () => {
    mockReadFile.mockImplementation((path: string) => {
      const p = String(path);
      if (p.endsWith(".ao-version")) return Promise.resolve("0.2.2");
      if (p.endsWith("ao-metadata-helper.sh")) return Promise.resolve(AO_METADATA_HELPER);
      if (p.endsWith("/gh")) return Promise.resolve("# stale gh\n");
      if (p.endsWith("/git")) return Promise.resolve(GIT_WRAPPER);
      return Promise.reject(new Error("ENOENT"));
    });

    await setupPathWrapperWorkspace("/workspace");

    expect(mockRename).toHaveBeenCalled();
  });

  it("writes .ao/AGENTS.md with session context", async () => {
    await setupPathWrapperWorkspace("/workspace");

    const agentsMdWrites = mockWriteFile.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes(".ao/AGENTS.md"),
    );
    expect(agentsMdWrites).toHaveLength(1);
    expect(String(agentsMdWrites[0][1])).toContain("Agent Orchestrator");
  });
});
