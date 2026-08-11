import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExec } = vi.hoisted(() => ({
  mockExec: vi.fn(),
}));

vi.mock("../../src/lib/shell.js", () => ({
  exec: mockExec,
}));

import { preflight } from "../../src/lib/preflight.js";

beforeEach(() => {
  mockExec.mockReset();
});

describe("preflight.checkTmux", () => {
  it("passes when tmux is already installed", async () => {
    mockExec.mockResolvedValue({ stdout: "tmux 3.3a", stderr: "" });
    await expect(preflight.checkTmux()).resolves.toBeUndefined();
    expect(mockExec).toHaveBeenCalledWith("tmux", ["-V"]);
  });

  it("throws with install instructions when tmux is missing", async () => {
    mockExec.mockRejectedValue(new Error("ENOENT"));
    const err = await preflight.checkTmux().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("tmux is not installed");
    expect(err.message).toContain("Install it:");
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledWith("tmux", ["-V"]);
  });
});

describe("preflight.checkHerdr", () => {
  it("passes when a herdr server is running", async () => {
    mockExec.mockResolvedValue({ stdout: "status: running\nversion: 0.8.0", stderr: "" });
    await expect(preflight.checkHerdr()).resolves.toBeUndefined();
    expect(mockExec).toHaveBeenCalledWith("herdr", ["status", "server"]);
  });

  it("throws install instructions when the herdr binary is missing", async () => {
    mockExec.mockRejectedValue(new Error("ENOENT"));
    const err = await preflight.checkHerdr().catch((e: Error) => e);
    expect(err.message).toContain("herdr is not installed");
    expect(err.message).toContain("herdr.dev");
  });

  // Having the binary is not enough: herdr is a client to a long-running
  // server, and without one every runtime call fails opaquely.
  it("distinguishes an installed binary with no running server", async () => {
    mockExec.mockResolvedValue({ stdout: "status: not running", stderr: "" });
    const err = await preflight.checkHerdr().catch((e: Error) => e);
    expect(err.message).toContain("no server is running");
    expect(err.message).toContain("herdr server");
    expect(err.message).not.toContain("not installed");
  });
});

describe("preflight.checkGhAuth", () => {
  it("passes when gh is installed and authenticated", async () => {
    mockExec.mockResolvedValue({ stdout: "ok", stderr: "" });
    await expect(preflight.checkGhAuth()).resolves.toBeUndefined();
    expect(mockExec).toHaveBeenCalledWith("gh", ["--version"]);
    expect(mockExec).toHaveBeenCalledWith("gh", ["auth", "status"]);
  });

  it("throws 'not installed' when gh is missing (ENOENT)", async () => {
    mockExec.mockRejectedValue(new Error("ENOENT"));
    await expect(preflight.checkGhAuth()).rejects.toThrow("GitHub CLI (gh) is not installed");
    // Should only call --version, not auth status
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledWith("gh", ["--version"]);
  });

  it("throws 'not authenticated' when gh exists but auth fails", async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: "gh version 2.40", stderr: "" }) // --version succeeds
      .mockRejectedValueOnce(new Error("not logged in")); // auth status fails
    await expect(preflight.checkGhAuth()).rejects.toThrow("GitHub CLI is not authenticated");
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("includes correct fix instructions for each failure", async () => {
    // Not installed → install link
    mockExec.mockRejectedValue(new Error("ENOENT"));
    await expect(preflight.checkGhAuth()).rejects.toThrow("https://cli.github.com/");

    mockExec.mockReset();

    // Not authenticated → auth login
    mockExec
      .mockResolvedValueOnce({ stdout: "gh version 2.40", stderr: "" })
      .mockRejectedValueOnce(new Error("not logged in"));
    await expect(preflight.checkGhAuth()).rejects.toThrow("gh auth login");
  });
});
