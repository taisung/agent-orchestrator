import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { mockHomedir } = vi.hoisted(() => ({
  mockHomedir: vi.fn<() => string>(),
}));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
}));

import {
  AO_METADATA_HELPER,
  GH_WRAPPER,
  GIT_WRAPPER,
  setupPathWrapperWorkspace,
} from "../agent-workspace-hooks.js";

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
    expect(readFileSync(markerPath, "utf8")).toBe("0.2.2");
  });

  it("repairs wrapper files when the marker is current but files are stale or missing", async () => {
    const helperPath = join(binDir, "ao-metadata-helper.sh");
    const ghPath = join(binDir, "gh");
    const gitPath = join(binDir, "git");
    const markerPath = join(binDir, ".ao-version");
    writeFileSync(helperPath, "current helper sentinel\n");
    writeFileSync(ghPath, "current gh sentinel\n");
    writeFileSync(gitPath, "current git sentinel\n");
    writeFileSync(markerPath, "0.2.2");

    await setupPathWrapperWorkspace(workspaceDir);

    // A matching marker with stale content must be repaired, not left alone.
    expect(readFileSync(helperPath, "utf8")).toBe(AO_METADATA_HELPER);
    expect(readFileSync(ghPath, "utf8")).toBe(GH_WRAPPER);
    expect(readFileSync(gitPath, "utf8")).toBe(GIT_WRAPPER);
    expect(readFileSync(markerPath, "utf8")).toBe("0.2.2");
  });

  it("leaves files untouched when the marker and all files are current", async () => {
    const helperPath = join(binDir, "ao-metadata-helper.sh");
    const ghPath = join(binDir, "gh");
    const gitPath = join(binDir, "git");
    const markerPath = join(binDir, ".ao-version");
    writeFileSync(helperPath, AO_METADATA_HELPER);
    writeFileSync(ghPath, GH_WRAPPER);
    writeFileSync(gitPath, GIT_WRAPPER);
    writeFileSync(markerPath, "0.2.2");
    const mtimeBefore = readFileSync(markerPath, "utf8");

    await setupPathWrapperWorkspace(workspaceDir);

    expect(readFileSync(helperPath, "utf8")).toBe(AO_METADATA_HELPER);
    expect(readFileSync(ghPath, "utf8")).toBe(GH_WRAPPER);
    expect(readFileSync(gitPath, "utf8")).toBe(GIT_WRAPPER);
    expect(readFileSync(markerPath, "utf8")).toBe(mtimeBefore);
  });
});
