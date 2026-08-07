import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

vi.mock("node:util", () => ({
  promisify:
    (_fn: unknown) =>
    (...args: any[]) =>
      mockExecFile(...args),
}));

const { getHerdrPaneProcesses, isHerdrProcessRunning, HERDR_RUNTIME_NAME } =
  await import("../herdr.js");

function paneProcesses(processes: unknown[]) {
  return {
    stdout: JSON.stringify({
      id: "cli:pane:process_info",
      result: {
        process_info: {
          foreground_process_group_id: 1,
          foreground_processes: processes,
          pane_id: "w8:p1",
          shell_pid: 2,
        },
        type: "pane_process_info",
      },
    }),
    stderr: "",
  };
}

const CLAUDE = {
  argv: ["claude", "--model", "sonnet"],
  cmdline: "claude --model sonnet",
  name: "claude",
  pid: 4242,
};
const BASH = { argv: ["bash"], cmdline: "bash", name: "bash", pid: 7 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HERDR_RUNTIME_NAME", () => {
  it("matches the runtime plugin's manifest name", () => {
    expect(HERDR_RUNTIME_NAME).toBe("herdr");
  });
});

describe("getHerdrPaneProcesses", () => {
  it("queries the given pane", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([CLAUDE]));

    await getHerdrPaneProcesses("w8:p1");

    expect(mockExecFile.mock.calls[0][0]).toBe("herdr");
    expect(mockExecFile.mock.calls[0][1]).toEqual(["pane", "process-info", "--pane", "w8:p1"]);
  });

  it("returns pid, name and cmdline for each foreground process", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([CLAUDE, BASH]));

    expect(await getHerdrPaneProcesses("w8:p1")).toEqual([
      { pid: 4242, name: "claude", cmdline: "claude --model sonnet" },
      { pid: 7, name: "bash", cmdline: "bash" },
    ]);
  });

  it("falls back to joining argv when cmdline is absent", async () => {
    mockExecFile.mockResolvedValueOnce(
      paneProcesses([{ argv: ["codex", "-m", "gpt"], name: "codex", pid: 9 }]),
    );

    const [proc] = await getHerdrPaneProcesses("w8:p1");
    expect(proc.cmdline).toBe("codex -m gpt");
  });

  it("returns empty when herdr is not installed", async () => {
    mockExecFile.mockRejectedValueOnce(new Error("ENOENT"));
    expect(await getHerdrPaneProcesses("w8:p1")).toEqual([]);
  });

  // herdr reports failures in the body with exit code 0, so an error body must
  // not be mistaken for "succeeded with no processes".
  it("returns empty on a herdr error body", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ error: { code: "pane_not_found", message: "gone" } }),
      stderr: "",
    });
    expect(await getHerdrPaneProcesses("w8:p1")).toEqual([]);
  });

  it("returns empty on unparseable output", async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: "not json", stderr: "" });
    expect(await getHerdrPaneProcesses("w8:p1")).toEqual([]);
  });

  it("returns empty for an empty pane id without shelling out", async () => {
    expect(await getHerdrPaneProcesses("")).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("skips malformed entries", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([null, {}, CLAUDE]));
    expect(await getHerdrPaneProcesses("w8:p1")).toHaveLength(1);
  });
});

describe("isHerdrProcessRunning", () => {
  it("is true when a process matches the agent regex", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([BASH, CLAUDE]));
    expect(await isHerdrProcessRunning("w8:p1", /(?:^|\/)claude(?:\s|$)/)).toBe(true);
  });

  it("is false when only an unrelated process is running", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([BASH]));
    expect(await isHerdrProcessRunning("w8:p1", /(?:^|\/)claude(?:\s|$)/)).toBe(false);
  });

  it("matches on the bare process name for dot-prefixed binaries", async () => {
    // Some agents install as `.agent`; the name field carries it even when the
    // cmdline is a long absolute path.
    mockExecFile.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "/opt/x/bin/.agent --flag", name: ".agent", pid: 3 }]),
    );
    expect(await isHerdrProcessRunning("w8:p1", /(?:^|\/)\.?agent\b(?:\s|$)/)).toBe(true);
  });

  it("does not match a substring of a longer name", async () => {
    mockExecFile.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "claude-code --x", name: "claude-code", pid: 3 }]),
    );
    expect(await isHerdrProcessRunning("w8:p1", /(?:^|\/)claude(?:\s|$)/)).toBe(false);
  });

  it("matches an absolute path invocation", async () => {
    mockExecFile.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "/usr/local/bin/codex --model x", name: "codex", pid: 3 }]),
    );
    expect(await isHerdrProcessRunning("w8:p1", /(?:^|\/)codex(?:\s|$)/)).toBe(true);
  });

  it("is false when the pane has no processes", async () => {
    mockExecFile.mockResolvedValueOnce(paneProcesses([]));
    expect(await isHerdrProcessRunning("w8:p1", /codex/)).toBe(false);
  });
});
