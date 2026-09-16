import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { mockHomedir } = vi.hoisted(() => ({
  mockHomedir: vi.fn<() => string>(),
}));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
}));

import { AO_METADATA_HELPER, setupPathWrapperWorkspace } from "../agent-workspace-hooks.js";

describe("PATH wrapper version upgrades", () => {
  let testRoot: string;
  let homeDir: string;
  let binDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    testRoot = mkdtempSync("/tmp/ao-wrapper-version-");
    homeDir = join(testRoot, "home");
    binDir = join(homeDir, ".ao", "bin");
    workspaceDir = join(testRoot, "workspace");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    mockHomedir.mockReturnValue(homeDir);
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("replaces the pre-allowlist helper when the marker has the previous version", async () => {
    const helperPath = join(binDir, "ao-metadata-helper.sh");
    const markerPath = join(binDir, ".ao-version");
    writeFileSync(helperPath, "#!/usr/bin/env bash\n# old helper without ao_state_root\n");
    writeFileSync(markerPath, "0.2.0");

    await setupPathWrapperWorkspace(workspaceDir);

    expect(readFileSync(helperPath, "utf8")).toBe(AO_METADATA_HELPER);
    expect(readFileSync(helperPath, "utf8")).toContain("local ao_state_root=");
    expect(readFileSync(markerPath, "utf8")).toBe("0.2.1");
  });

  it("leaves wrapper files untouched when the marker has the current version", async () => {
    const helperPath = join(binDir, "ao-metadata-helper.sh");
    const ghPath = join(binDir, "gh");
    const gitPath = join(binDir, "git");
    const markerPath = join(binDir, ".ao-version");
    writeFileSync(helperPath, "current helper sentinel\n");
    writeFileSync(ghPath, "current gh sentinel\n");
    writeFileSync(gitPath, "current git sentinel\n");
    writeFileSync(markerPath, "0.2.1");

    await setupPathWrapperWorkspace(workspaceDir);

    expect(readFileSync(helperPath, "utf8")).toBe("current helper sentinel\n");
    expect(readFileSync(ghPath, "utf8")).toBe("current gh sentinel\n");
    expect(readFileSync(gitPath, "utf8")).toBe("current git sentinel\n");
    expect(readFileSync(markerPath, "utf8")).toBe("0.2.1");
  });
});
