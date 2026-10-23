import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { mockTmux, mockExec, mockDetectActivity } = vi.hoisted(() => ({
  mockTmux: vi.fn(),
  mockExec: vi.fn(),
  mockDetectActivity: vi.fn(),
}));

const { mockConfigRef, mockSessionManager, mockAgentRef } = vi.hoisted(() => ({
  mockConfigRef: { current: null as Record<string, unknown> | null },
  mockSessionManager: {
    get: vi.fn(),
    send: vi.fn(),
    deliver: vi.fn(),
  },
  /** The agent that the registry lookup gives; null gives the Claude Code mock. */
  mockAgentRef: { current: null as Record<string, unknown> | null },
}));

vi.mock("../../src/lib/shell.js", () => ({
  tmux: mockTmux,
  exec: mockExec,
  execSilent: vi.fn(),
  git: vi.fn(),
  gh: vi.fn(),
}));

vi.mock("../../src/lib/plugins.js", () => ({
  getAgent: () => ({
    name: "claude-code",
    processName: "claude",
    detectActivity: mockDetectActivity,
  }),
  getAgentByName: () => ({
    name: "claude-code",
    processName: "claude",
    detectActivity: mockDetectActivity,
  }),
  getAgentByNameFromRegistry: () =>
    mockAgentRef.current ?? {
      name: "claude-code",
      processName: "claude",
      detectActivity: mockDetectActivity,
    },
}));

vi.mock("../../src/lib/session-utils.js", () => ({
  findProjectForSession: () => null,
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@aoagents/ao-core")>();
  return {
    // The real target helpers: the tests check the targets that they build.
    exactSessionTarget: actual.exactSessionTarget,
    exactPaneTarget: actual.exactPaneTarget,
    // The real agent-pane helpers of a relaunched session (review r3).
    AGENT_PANE_FORMAT: actual.AGENT_PANE_FORMAT,
    agentPaneOf: actual.agentPaneOf,
    agentPaneTty: actual.agentPaneTty,
    isTmuxPaneGone: actual.isTmuxPaneGone,
    loadConfig: () => {
      if (!mockConfigRef.current) {
        throw new Error("no config");
      }
      return mockConfigRef.current;
    },
  };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async () => mockSessionManager,
  getPluginRegistry: async () => ({ get: vi.fn(), list: vi.fn(), register: vi.fn() }),
}));

import { Command } from "commander";
import { registerSend } from "../../src/commands/send.js";

let program: Command;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  program = new Command();
  program.exitOverride();
  registerSend(program);
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  mockTmux.mockReset();
  mockExec.mockReset();
  mockDetectActivity.mockReset();
  mockSessionManager.get.mockReset();
  mockSessionManager.send.mockReset();
  mockSessionManager.deliver.mockReset();
  mockConfigRef.current = null;
  mockAgentRef.current = null;
  mockExec.mockResolvedValue({ stdout: "", stderr: "" });
});

afterEach(() => {
  vi.useRealTimers();
  consoleSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  exitSpy.mockRestore();
});

describe("send command", () => {
  describe("session existence check", () => {
    it("exits with error when session does not exist", async () => {
      mockTmux.mockResolvedValue(null); // has-session fails

      await expect(
        program.parseAsync(["node", "test", "send", "nonexistent", "hello"]),
      ).rejects.toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("does not exist"));
    });

    it("exits with error and no tmux call for a name that AO never gives a session", async () => {
      await expect(program.parseAsync(["node", "test", "send", "a.b", "hello"])).rejects.toThrow(
        "process.exit(1)",
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("does not exist"));
      expect(mockTmux).not.toHaveBeenCalled();
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe("busy detection", () => {
    it("detects idle session via agent plugin", async () => {
      // has-session succeeds
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") {
          const sIdx = args.indexOf("-S");
          if (sIdx >= 0 && args[sIdx + 1] === "-5") return "some output\n❯ ";
          if (sIdx >= 0 && args[sIdx + 1] === "-10") return "esc to interrupt\nThinking";
          return "";
        }
        return "";
      });

      // Agent detects idle for wait-for-idle, then active for verification
      mockDetectActivity
        .mockReturnValueOnce("idle") // wait-for-idle check
        .mockReturnValueOnce("active"); // verification check

      await program.parseAsync(["node", "test", "send", "my-session", "hello", "world"]);

      // Should have sent keys with -l (literal) flag
      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "=my-session:",
        "-l",
        "hello world",
      ]);
      // Should have sent Enter
      expect(mockExec).toHaveBeenCalledWith("tmux", ["send-keys", "-t", "=my-session:", "Enter"]);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Message sent and processing"),
      );
    });

    it("detects busy session and waits via agent plugin", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "some output";
        return "";
      });

      // First call: active (busy), second call: idle, third call: active (verification)
      mockDetectActivity
        .mockReturnValueOnce("active") // busy
        .mockReturnValueOnce("idle") // now idle
        .mockReturnValueOnce("active"); // verification: processing

      await program.parseAsync(["node", "test", "send", "my-session", "fix", "the", "bug"]);

      // Should have eventually sent the message
      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "=my-session:",
        "-l",
        "fix the bug",
      ]);
    });

    it("skips busy detection with --no-wait", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "Thinking\nesc to interrupt";
        return "";
      });

      // Agent detects active for verification
      mockDetectActivity.mockReturnValue("active");

      await program.parseAsync(["node", "test", "send", "--no-wait", "my-session", "urgent"]);

      // Should have sent the message without waiting
      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "=my-session:",
        "-l",
        "urgent",
      ]);
    });

    it("detects queued message state", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") {
          const sIdx = args.indexOf("-S");
          if (sIdx >= 0 && args[sIdx + 1] === "-5") return "Output\n❯ ";
          if (sIdx >= 0 && args[sIdx + 1] === "-10")
            return "Output\nPress up to edit queued messages";
          return "";
        }
        return "";
      });

      // Agent detects idle for wait-for-idle, then idle for verification (not processing)
      mockDetectActivity.mockReturnValue("idle");

      await program.parseAsync(["node", "test", "send", "my-session", "hello"]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Message queued"));
    });
  });

  describe("message delivery", () => {
    it("uses load-buffer for long messages", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "❯ ";
        return "";
      });

      mockDetectActivity
        .mockReturnValueOnce("idle") // wait-for-idle
        .mockReturnValueOnce("active"); // verification

      const longMsg = "x".repeat(250);
      await program.parseAsync(["node", "test", "send", "my-session", longMsg]);

      // Should have used load-buffer for long message
      expect(mockExec).toHaveBeenCalledWith("tmux", expect.arrayContaining(["load-buffer"]));
      // -p: bracketed paste, so a line break in the text is not an Enter
      expect(mockExec).toHaveBeenCalledWith("tmux", ["paste-buffer", "-p", "-t", "=my-session:"]);
    });

    it("uses send-keys for short messages", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "❯ ";
        return "";
      });

      mockDetectActivity
        .mockReturnValueOnce("idle") // wait-for-idle
        .mockReturnValueOnce("active"); // verification

      await program.parseAsync(["node", "test", "send", "my-session", "short", "msg"]);

      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "=my-session:",
        "-l",
        "short msg",
      ]);
    });

    it("clears partial input before sending", async () => {
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "❯ ";
        return "";
      });

      mockDetectActivity
        .mockReturnValueOnce("idle") // wait-for-idle
        .mockReturnValueOnce("active"); // verification

      await program.parseAsync(["node", "test", "send", "my-session", "hello"]);

      // C-u should be called to clear input
      expect(mockExec).toHaveBeenCalledWith("tmux", ["send-keys", "-t", "=my-session:", "C-u"]);
    });
  });

  describe("session manager integration", () => {
    function makeConfig(): Record<string, unknown> {
      return {
        configPath: "/tmp/agent-orchestrator.yaml",
        defaults: {
          runtime: "tmux",
          agent: "claude-code",
          workspace: "worktree",
          notifiers: [],
        },
        projects: {
          "my-app": {
            name: "My App",
            sessionPrefix: "app",
            path: "/tmp/my-app",
            defaultBranch: "main",
            repo: "org/my-app",
            agent: "claude-code",
            runtime: "tmux",
          },
        },
        notifiers: {},
        notificationRouting: {},
        reactions: {},
      };
    }

    it("delivers tmux AO sessions directly after resolving metadata", async () => {
      mockConfigRef.current = makeConfig();
      mockSessionManager.get.mockResolvedValue({
        id: "app-1",
        projectId: "my-app",
        status: "working",
        activity: "idle",
        branch: null,
        issueId: null,
        pr: null,
        workspacePath: null,
        runtimeHandle: { id: "tmux-target-1", runtimeName: "tmux", data: {} },
        agentInfo: null,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        metadata: { agent: "opencode" },
      });
      mockSessionManager.send.mockResolvedValue(undefined);
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "Working\nesc to interrupt";
        return "";
      });
      mockDetectActivity
        .mockReturnValueOnce("idle")
        .mockReturnValueOnce("active");

      await program.parseAsync(["node", "test", "send", "app-1", "hello", "opencode"]);

      expect(mockSessionManager.send).not.toHaveBeenCalled();
      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "=tmux-target-1:",
        "-l",
        "hello opencode",
      ]);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Message sent and processing"),
      );
    });

    describe("a relaunched session: the agent's pane that its last relaunch bound (review r3)", () => {
      function relaunchedSession(): Record<string, unknown> {
        return {
          id: "app-1",
          projectId: "my-app",
          status: "working",
          activity: "idle",
          branch: null,
          issueId: null,
          pr: null,
          workspacePath: null,
          // sm.get names the bound pane in memory (review r2 M-1).
          runtimeHandle: { id: "tmux-target-1", runtimeName: "tmux", data: { agentPane: "%5" } },
          agentInfo: null,
          createdAt: new Date(),
          lastActivityAt: new Date(),
          metadata: { agent: "claude-code" },
        };
      }

      /** tmux answers list-panes for the window of %5 with `panes`, or fails with `stderr`. */
      function paneAnswer(answer: { panes: string } | { stderr: string }): void {
        mockExec.mockImplementation(async (_cmd: string, args: string[]) => {
          if (args[0] !== "list-panes") return { stdout: "", stderr: "" };
          if ("stderr" in answer) {
            throw Object.assign(new Error(`Command failed: tmux list-panes\n${answer.stderr}`), {
              code: 1,
              killed: false,
              signal: null,
              stderr: answer.stderr,
            });
          }
          return { stdout: answer.panes, stderr: "" };
        });
      }

      beforeEach(() => {
        mockConfigRef.current = makeConfig();
        mockSessionManager.get.mockResolvedValue(relaunchedSession());
        mockTmux.mockImplementation(async (...args: string[]) => {
          if (args[0] === "has-session") return "";
          if (args[0] === "capture-pane") return "❯ ";
          return "";
        });
      });

      it("reads and types only into the bound pane, though another pane of the session is selected", async () => {
        // %3 is an idle shell in the selected window; %5 is the agent's pane.
        paneAnswer({ panes: "%5 tmux-target-1 /dev/pts/5\n%3 tmux-target-1 /dev/pts/3" });
        mockDetectActivity.mockReturnValueOnce("idle").mockReturnValueOnce("active");

        await program.parseAsync(["node", "test", "send", "app-1", "hello"]);

        const keys = mockExec.mock.calls.filter((call) =>
          ["send-keys", "paste-buffer"].includes(call[1][0]),
        );
        expect(keys.map((call) => call[1])).toEqual([
          ["send-keys", "-t", "%5", "C-u"],
          ["send-keys", "-t", "%5", "-l", "hello"],
          ["send-keys", "-t", "%5", "Enter"],
        ]);
        const reads = mockTmux.mock.calls.filter((call) => call[0] === "capture-pane");
        expect(reads.length).toBeGreaterThan(0);
        expect(new Set(reads.map((call) => call[2]))).toEqual(new Set(["%5"]));
        // The pane check ran before the wait and before the first key and the Enter.
        expect(mockExec.mock.calls.filter((call) => call[1][0] === "list-panes")).toHaveLength(3);
        expect(mockSessionManager.send).not.toHaveBeenCalled();
      });

      it("sends nothing and exits 1 when the bound pane now belongs to another tmux session", async () => {
        paneAnswer({ panes: "%5 other-session /dev/pts/5" });

        await expect(
          program.parseAsync(["node", "test", "send", "app-1", "hello"]),
        ).rejects.toThrow("process.exit(1)");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "Message not sent to app-1: its agent's tmux pane %5 (bound by its last relaunch) now belongs to another tmux session",
          ),
        );
        expect(mockExec.mock.calls.filter((call) => call[1][0] !== "list-panes")).toEqual([]);
        expect(mockTmux.mock.calls.filter((call) => call[0] === "capture-pane")).toEqual([]);
      });

      it("presses no Enter and exits 1 when the bound pane moved to another session after the text", async () => {
        let checks = 0;
        mockExec.mockImplementation(async (_cmd: string, args: string[]) => {
          if (args[0] !== "list-panes") return { stdout: "", stderr: "" };
          checks += 1;
          return {
            stdout: checks < 3 ? "%5 tmux-target-1 /dev/pts/5" : "%5 other-session /dev/pts/5",
            stderr: "",
          };
        });
        mockDetectActivity.mockReturnValueOnce("idle");

        await expect(
          program.parseAsync(["node", "test", "send", "app-1", "hello"]),
        ).rejects.toThrow("process.exit(1)");

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "Message typed into app-1 but not submitted (no Enter): its agent's tmux pane %5 (bound by its last relaunch) now belongs to another tmux session",
          ),
        );
        expect(
          mockExec.mock.calls.filter((call) => call[1][0] === "send-keys").map((call) => call[1]),
        ).toEqual([
          ["send-keys", "-t", "%5", "C-u"],
          ["send-keys", "-t", "%5", "-l", "hello"],
        ]);
      });

      it("sends nothing and exits 1 when the bound pane is gone or tmux cannot tell", async () => {
        paneAnswer({ stderr: "can't find pane: %5\n" });
        await expect(
          program.parseAsync(["node", "test", "send", "app-1", "hello"]),
        ).rejects.toThrow("process.exit(1)");
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "its agent's tmux pane %5 (bound by its last relaunch) no longer exists",
          ),
        );

        paneAnswer({ stderr: "warning: server connection failed\ncan't find pane: %5\n" });
        await expect(
          program.parseAsync(["node", "test", "send", "app-1", "hello"]),
        ).rejects.toThrow("process.exit(1)");
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "tmux could not tell whether pane %5 still belongs to tmux session tmux-target-1",
          ),
        );
        expect(
          mockExec.mock.calls.filter((call) => ["send-keys", "paste-buffer"].includes(call[1][0])),
        ).toEqual([]);
      });
    });

    describe("a recorded session whose tmux session is gone while a longer name lives", () => {
      /**
       * has-session as tmux 3.4 answers it: `=name` matches exactly; a plain
       * target matches an exact name, then the start of exactly one name.
       */
      function tmuxWithSessions(names: string[]): void {
        mockTmux.mockImplementation(async (...args: string[]) => {
          if (args[0] === "has-session") {
            const target = args[args.indexOf("-t") + 1] ?? "";
            if (target.startsWith("=")) return names.includes(target.slice(1)) ? "" : null;
            if (names.includes(target)) return "";
            return names.filter((name) => name.startsWith(target)).length === 1 ? "" : null;
          }
          if (args[0] === "capture-pane") return "❯ ";
          return "";
        });
      }

      function recordedSession(tmuxName: string): Record<string, unknown> {
        return {
          id: "app-1",
          projectId: "my-app",
          status: "working",
          activity: "idle",
          branch: null,
          issueId: null,
          pr: null,
          workspacePath: null,
          runtimeHandle: { id: tmuxName, runtimeName: "tmux", data: {} },
          agentInfo: null,
          createdAt: new Date(),
          lastActivityAt: new Date(),
          metadata: {},
        };
      }

      it("checks the exact name and sends through the session manager (restore), not directly", async () => {
        mockConfigRef.current = makeConfig();
        mockSessionManager.get.mockResolvedValue(recordedSession("abc-app-1"));
        mockSessionManager.send.mockResolvedValue(undefined);
        // abc-app-1 is dead; abc-app-10 is the only name that starts with it.
        tmuxWithSessions(["abc-app-10"]);

        await program.parseAsync(["node", "test", "send", "--no-wait", "app-1", "hello"]);

        expect(mockTmux).toHaveBeenCalledWith("has-session", "-t", "=abc-app-1");
        expect(mockTmux).not.toHaveBeenCalledWith("has-session", "-t", "abc-app-1");
        expect(mockSessionManager.send).toHaveBeenCalledWith("app-1", "hello");
        expect(mockExec).not.toHaveBeenCalled();
      });

      it("delivers directly when the session of the exact name lives (control)", async () => {
        mockConfigRef.current = makeConfig();
        mockSessionManager.get.mockResolvedValue(recordedSession("abc-app-1"));
        mockSessionManager.send.mockResolvedValue(undefined);
        tmuxWithSessions(["abc-app-1", "abc-app-10"]);
        mockDetectActivity.mockReturnValue("active");

        await program.parseAsync(["node", "test", "send", "--no-wait", "app-1", "hello"]);

        expect(mockTmux).toHaveBeenCalledWith("has-session", "-t", "=abc-app-1");
        expect(mockSessionManager.send).not.toHaveBeenCalled();
        expect(mockExec).toHaveBeenCalledWith("tmux", [
          "send-keys",
          "-t",
          "=abc-app-1:",
          "-l",
          "hello",
        ]);
      });
    });

    it("waits for tmux AO sessions before direct delivery", async () => {
      mockConfigRef.current = makeConfig();
      mockSessionManager.get.mockResolvedValue({
        id: "app-1",
        projectId: "my-app",
        status: "working",
        activity: "active",
        branch: null,
        issueId: null,
        pr: null,
        workspacePath: null,
        runtimeHandle: { id: "tmux-target-1", runtimeName: "tmux", data: {} },
        agentInfo: null,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        metadata: { agent: "opencode" },
      });
      mockSessionManager.send.mockResolvedValue(undefined);
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "some output";
        return "";
      });
      mockDetectActivity
        .mockReturnValueOnce("active")
        .mockReturnValueOnce("idle")
        .mockReturnValueOnce("active");

      await program.parseAsync(["node", "test", "send", "app-1", "fix", "mapping"]);

      expect(mockSessionManager.send).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Waiting for app-1 to become idle"),
      );
      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "=tmux-target-1:",
        "-l",
        "fix mapping",
      ]);
    });

    it("skips tmux checks for non-tmux AO sessions and still uses lifecycle send", async () => {
      mockConfigRef.current = makeConfig();
      mockSessionManager.get.mockResolvedValue({
        id: "app-1",
        projectId: "my-app",
        status: "working",
        activity: "active",
        branch: null,
        issueId: null,
        pr: null,
        workspacePath: null,
        runtimeHandle: { id: "proc-1", runtimeName: "process", data: {} },
        agentInfo: null,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        metadata: { agent: "opencode" },
      });
      mockSessionManager.send.mockResolvedValue(undefined);

      await program.parseAsync(["node", "test", "send", "app-1", "hello"]);

      expect(mockSessionManager.send).toHaveBeenCalledWith("app-1", "hello");
      expect(mockTmux).not.toHaveBeenCalledWith("has-session", "-t", expect.any(String));
    });

    it("passes file contents through direct tmux delivery for tmux AO sessions", async () => {
      mockConfigRef.current = makeConfig();
      mockSessionManager.get.mockResolvedValue({
        id: "app-1",
        projectId: "my-app",
        status: "working",
        activity: "idle",
        branch: null,
        issueId: null,
        pr: null,
        workspacePath: null,
        runtimeHandle: { id: "tmux-target-1", runtimeName: "tmux", data: {} },
        agentInfo: null,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        metadata: { agent: "opencode" },
      });
      mockSessionManager.send.mockResolvedValue(undefined);
      mockTmux.mockImplementation(async (...args: string[]) => {
        if (args[0] === "has-session") return "";
        if (args[0] === "capture-pane") return "Working\nesc to interrupt";
        return "";
      });
      mockDetectActivity
        .mockReturnValueOnce("idle")
        .mockReturnValueOnce("active");

      const filePath = join(tmpdir(), `ao-send-message-${Date.now()}.txt`);
      writeFileSync(filePath, "from file");

      try {
        await program.parseAsync(["node", "test", "send", "app-1", "--file", filePath]);
      } finally {
        rmSync(filePath, { force: true });
      }

      expect(mockSessionManager.send).not.toHaveBeenCalled();
      expect(mockExec).toHaveBeenCalledWith("tmux", [
        "send-keys",
        "-t",
        "=tmux-target-1:",
        "-l",
        "from file",
      ]);
    });
  });
});

describe("send through the OpenCode API (I-5)", () => {
  function makeConfig(): Record<string, unknown> {
    return {
      configPath: "/tmp/agent-orchestrator.yaml",
      defaults: { runtime: "tmux", agent: "opencode", workspace: "worktree", notifiers: [] },
      projects: {
        "my-app": {
          name: "My App",
          sessionPrefix: "app",
          path: "/tmp/my-app",
          defaultBranch: "main",
          repo: "org/my-app",
          agent: "opencode",
          runtime: "tmux",
        },
      },
      notifiers: {},
      notificationRouting: {},
      reactions: {},
    };
  }

  function openCodeSession(metadata: Record<string, string>) {
    return {
      id: "app-1",
      projectId: "my-app",
      status: "working",
      activity: "active",
      branch: null,
      issueId: null,
      pr: null,
      workspacePath: null,
      runtimeHandle: { id: "tmux-target-1", runtimeName: "tmux", data: {} },
      agentInfo: null,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: { agent: "opencode", ...metadata },
    };
  }

  const deliverMessage = vi.fn();

  /** An OpenCode-like agent: it delivers to a session with a stored ID. */
  function useOpenCodeAgent() {
    mockAgentRef.current = {
      name: "opencode",
      processName: "opencode",
      detectActivity: mockDetectActivity,
      canDeliverMessage: (session: { metadata: Record<string, string> }) =>
        Boolean(session.metadata["opencodeSessionId"]),
      deliverMessage,
    };
  }

  const ADMITTED = {
    route: "agent",
    delivery: { inputId: "msg_admitted", mode: "queue", waitsFor: [], busy: false },
  };

  function logged(): string[] {
    return consoleSpy.mock.calls.map((call: unknown[]) => String(call[0]));
  }

  beforeEach(() => {
    mockConfigRef.current = makeConfig();
    useOpenCodeAgent();
    mockSessionManager.get.mockResolvedValue(openCodeSession({ opencodeSessionId: "ses_stored" }));
  });

  it("delegates to core deliver, prints the admitted ID, and makes no tmux call", async () => {
    mockSessionManager.deliver.mockResolvedValue(ADMITTED);

    await program.parseAsync(["node", "test", "send", "app-1", "hello", "opencode"]);

    expect(mockSessionManager.deliver).toHaveBeenCalledTimes(1);
    expect(mockSessionManager.deliver).toHaveBeenCalledWith("app-1", "hello opencode");
    expect(mockSessionManager.send).not.toHaveBeenCalled();
    expect(mockTmux).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockDetectActivity).not.toHaveBeenCalled();
    expect(deliverMessage).not.toHaveBeenCalled();
    expect(logged()).toEqual([
      expect.stringContaining("Message admitted to app-1 (input msg_admitted, delivery queue)"),
    ]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("prints the busy, pending-input and read-back lines", async () => {
    mockSessionManager.deliver.mockResolvedValue({
      route: "agent",
      delivery: {
        inputId: "msg_found",
        mode: "queue",
        waitsFor: ["permission", "question"],
        busy: true,
        recovered: true,
      },
    });

    await program.parseAsync(["node", "test", "send", "app-1", "hello"]);

    const lines = logged().join("\n");
    expect(lines).toContain("Message admitted to app-1 (input msg_found, delivery queue)");
    expect(lines).toContain("a read-back of the session found the message");
    expect(lines).toContain("app-1 is running a turn: the message goes in after its last answer.");
    expect(lines).toContain(
      "The message waits behind a pending permission request and a pending question: it runs after a human answers.",
    );
  });

  it("prints one replay line when an earlier attempt of this send already admitted the input", async () => {
    mockSessionManager.deliver.mockResolvedValue({
      route: "agent",
      delivery: { inputId: "msg_15700b5b500162SRBvJM39N0N5", mode: "queue", replayed: true },
    });

    await program.parseAsync(["node", "test", "send", "app-1", "hello"]);

    expect(logged()).toEqual([
      expect.stringContaining(
        "Message admitted to app-1 (input msg_15700b5b500162SRBvJM39N0N5, delivery queue)",
      ),
      expect.stringContaining(
        "An earlier attempt of this send already admitted input msg_15700b5b500162SRBvJM39N0N5; nothing new was admitted.",
      ),
    ]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("prints no replay line for a new admission", async () => {
    mockSessionManager.deliver.mockResolvedValue(ADMITTED);

    await program.parseAsync(["node", "test", "send", "app-1", "hello"]);

    expect(logged().join("\n")).not.toContain("An earlier attempt");
    expect(logged().join("\n")).not.toContain("could not record");
  });

  it("M-5: keeps the admission line and prints one line when the ledger could not record the admission", async () => {
    mockSessionManager.deliver.mockResolvedValue({
      route: "agent",
      delivery: { inputId: "msg_unrecorded", mode: "queue" },
      admissionUnrecorded: true,
    });

    await program.parseAsync(["node", "test", "send", "app-1", "hello"]);

    expect(logged()).toEqual([
      expect.stringContaining("Message admitted to app-1 (input msg_unrecorded, delivery queue)"),
      expect.stringContaining(
        "The delivery ledger could not record that input msg_unrecorded was admitted: a send of the same text to app-1 in the next 10 min can reuse that ID and admit nothing new.",
      ),
    ]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("prints the question line alone", async () => {
    mockSessionManager.deliver.mockResolvedValue({
      route: "agent",
      delivery: { inputId: "msg_1", mode: "queue", waitsFor: ["question"], busy: false },
    });

    await program.parseAsync(["node", "test", "send", "app-1", "hello"]);

    const lines = logged().join("\n");
    expect(lines).toContain(
      "The message waits behind a pending question: it runs after a human answers.",
    );
    expect(lines).not.toContain("running a turn");
  });

  it("exits 1 with the error of a failed send, and makes no tmux call", async () => {
    mockSessionManager.deliver.mockRejectedValue(
      new Error("the OpenCode session ses_stored of app-1 does not exist"),
    );

    await expect(program.parseAsync(["node", "test", "send", "app-1", "hello"])).rejects.toThrow(
      "process.exit(1)",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Message not sent to app-1: the OpenCode session ses_stored of app-1 does not exist",
      ),
    );
    expect(mockTmux).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("gives the same API call with --no-wait and with --timeout", async () => {
    mockSessionManager.deliver.mockResolvedValue(ADMITTED);

    await program.parseAsync(["node", "test", "send", "--no-wait", "app-1", "hello"]);
    await program.parseAsync(["node", "test", "send", "--timeout", "5", "app-1", "hello"]);

    expect(mockSessionManager.deliver.mock.calls).toEqual([
      ["app-1", "hello"],
      ["app-1", "hello"],
    ]);
    expect(mockTmux).not.toHaveBeenCalled();
  });

  it("sends file contents through the API", async () => {
    mockSessionManager.deliver.mockResolvedValue(ADMITTED);
    const filePath = join(tmpdir(), `ao-send-api-${Date.now()}.txt`);
    writeFileSync(filePath, "from file\nline two");
    try {
      await program.parseAsync(["node", "test", "send", "app-1", "--file", filePath]);
    } finally {
      rmSync(filePath, { force: true });
    }

    expect(mockSessionManager.deliver).toHaveBeenCalledWith("app-1", "from file\nline two");
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("keeps the tmux path for an OpenCode session without a stored ID", async () => {
    mockSessionManager.get.mockResolvedValue(openCodeSession({}));
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "has-session") return "";
      if (args[0] === "capture-pane") return "Working\nesc interrupt";
      return "";
    });
    mockDetectActivity.mockReturnValueOnce("idle").mockReturnValueOnce("active");

    await program.parseAsync(["node", "test", "send", "app-1", "hello"]);

    expect(mockSessionManager.deliver).not.toHaveBeenCalled();
    expect(mockExec).toHaveBeenCalledWith("tmux", [
      "send-keys",
      "-t",
      "=tmux-target-1:",
      "-l",
      "hello",
    ]);
  });

  it("says in the help text that --no-wait and --timeout have no effect on this path", () => {
    const send = program.commands.find((command) => command.name() === "send")!;
    const help = send.helpInformation().replace(/\s+/g, " ");
    expect(help).toContain(
      "--no-wait Don't wait for session to become idle before sending (no effect for an OpenCode session with a stored session ID: the API queues the message)",
    );
    expect(help).toContain(
      "--timeout <seconds> Max seconds to wait for idle (no effect for an OpenCode session with a stored session ID)",
    );
  });
});
