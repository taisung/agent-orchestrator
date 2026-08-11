import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

const {
  mockRunRepoScript,
  mockFindConfigFile,
  mockLoadConfig,
  mockCreatePluginRegistry,
  mockCheckTmux,
  mockCheckHerdr,
  mockRegistry,
} = vi.hoisted(() => ({
  mockRunRepoScript: vi.fn(),
  mockFindConfigFile: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockCreatePluginRegistry: vi.fn(),
  mockCheckTmux: vi.fn(),
  mockCheckHerdr: vi.fn(),
  mockRegistry: {
    loadFromConfig: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock("../../src/lib/script-runner.js", () => ({
  runRepoScript: (...args: unknown[]) => mockRunRepoScript(...args),
}));

vi.mock("../../src/lib/preflight.js", () => ({
  preflight: {
    checkTmux: (...args: unknown[]) => mockCheckTmux(...args),
    checkHerdr: (...args: unknown[]) => mockCheckHerdr(...args),
  },
}));

vi.mock("@aoagents/ao-core", () => ({
  HERDR_RUNTIME_NAME: "herdr",
  createPluginRegistry: (...args: unknown[]) => mockCreatePluginRegistry(...args),
  findConfigFile: (...args: unknown[]) => mockFindConfigFile(...args),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  resolveNotifierTarget: (
    config: { notifiers?: Record<string, { plugin?: string }> },
    reference: string,
  ) => {
    const configured = config.notifiers?.[reference];
    return {
      reference,
      pluginName: configured?.plugin ?? reference,
    };
  },
}));

import { registerDoctor } from "../../src/commands/doctor.js";

function manifest(slot: string, name: string) {
  return { slot, name, description: `${name} plugin`, version: "1.0.0" };
}

function makeConfig() {
  return {
    configPath: "/tmp/agent-orchestrator.yaml",
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: {
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
      notifiers: ["alerts"],
      orchestrator: { agent: "codex" },
      worker: { agent: "claude-code" },
    },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: "/tmp/my-app",
        defaultBranch: "main",
        sessionPrefix: "app",
        runtime: "tmux",
        agent: "claude-code",
        workspace: "worktree",
        tracker: { plugin: "github" },
        scm: { plugin: "github" },
        orchestrator: { agent: "codex" },
        worker: { agent: "claude-code" },
      },
    },
    notifiers: {
      alerts: { plugin: "slack" },
    },
    notificationRouting: {
      urgent: ["alerts"],
      action: ["alerts"],
      warning: ["alerts"],
      info: ["alerts"],
    },
    reactions: {},
  };
}

describe("doctor command", () => {
  let program: Command;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerDoctor(program);

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    mockRunRepoScript.mockReset();
    mockRunRepoScript.mockResolvedValue(0);

    mockFindConfigFile.mockReset();
    mockFindConfigFile.mockReturnValue(null);

    mockLoadConfig.mockReset();

    mockCreatePluginRegistry.mockReset();
    mockCreatePluginRegistry.mockReturnValue(mockRegistry);

    mockCheckTmux.mockReset();
    mockCheckTmux.mockResolvedValue(undefined);
    mockCheckHerdr.mockReset();
    mockCheckHerdr.mockResolvedValue(undefined);

    mockRegistry.loadFromConfig.mockReset();
    mockRegistry.loadFromConfig.mockResolvedValue(undefined);
    mockRegistry.list.mockReset();
    mockRegistry.list.mockReturnValue([]);
    mockRegistry.get.mockReset();
    mockRegistry.get.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the doctor script with no extra args by default", async () => {
    await program.parseAsync(["node", "test", "doctor"]);

    expect(mockRunRepoScript).toHaveBeenCalledWith("ao-doctor.sh", []);
  });

  it("passes through --fix", async () => {
    await program.parseAsync(["node", "test", "doctor", "--fix"]);

    expect(mockRunRepoScript).toHaveBeenCalledWith("ao-doctor.sh", ["--fix"]);
  });

  it("checks configured plugin references when config is present", async () => {
    const config = makeConfig();
    mockFindConfigFile.mockReturnValue(config.configPath);
    mockLoadConfig.mockReturnValue(config);

    mockRegistry.list.mockImplementation((slot: string) => {
      switch (slot) {
        case "runtime":
          return [manifest("runtime", "tmux")];
        case "agent":
          return [manifest("agent", "claude-code"), manifest("agent", "codex")];
        case "workspace":
          return [manifest("workspace", "worktree")];
        case "tracker":
          return [manifest("tracker", "github")];
        case "scm":
          return [manifest("scm", "github")];
        case "notifier":
          return [manifest("notifier", "slack")];
        default:
          return [];
      }
    });

    await program.parseAsync(["node", "test", "doctor"]);

    expect(mockCreatePluginRegistry).toHaveBeenCalledTimes(1);
    expect(mockRegistry.loadFromConfig).toHaveBeenCalledWith(config, expect.any(Function));

    const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain('defaults.runtime -> runtime plugin "tmux"');
    expect(output).toContain('projects.my-app.scm.plugin -> scm plugin "github"');
    expect(output).toContain(
      'defaults.notifiers: alerts (plugin: slack) -> notifier plugin "slack"',
    );
  });

  it("fails when a referenced plugin cannot be loaded", async () => {
    const config = makeConfig();
    config.projects["my-app"].scm = { plugin: "gitlab" };
    mockFindConfigFile.mockReturnValue(config.configPath);
    mockLoadConfig.mockReturnValue(config);

    mockRegistry.list.mockImplementation((slot: string) => {
      switch (slot) {
        case "runtime":
          return [manifest("runtime", "tmux")];
        case "agent":
          return [manifest("agent", "claude-code"), manifest("agent", "codex")];
        case "workspace":
          return [manifest("workspace", "worktree")];
        case "tracker":
          return [manifest("tracker", "github")];
        case "scm":
          return [manifest("scm", "github")];
        case "notifier":
          return [manifest("notifier", "slack")];
        default:
          return [];
      }
    });

    await expect(program.parseAsync(["node", "test", "doctor"])).rejects.toThrow("process.exit(1)");

    const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain('projects.my-app.scm.plugin references scm plugin "gitlab"');
  });

  describe("runtime health", () => {
    /**
     * Config referencing the given runtimes, with every plugin resolving — so
     * these tests exercise runtime health rather than plugin resolution, which
     * would otherwise fail first and exit before the health section runs.
     */
    function withRuntimes(defaultRuntime: string, projectRuntime?: string) {
      const config = makeConfig();
      config.defaults.runtime = defaultRuntime;
      if (projectRuntime) config.projects["my-app"].runtime = projectRuntime;
      mockFindConfigFile.mockReturnValue(config.configPath);
      mockLoadConfig.mockReturnValue(config);

      const runtimes = [...new Set([defaultRuntime, projectRuntime].filter(Boolean))] as string[];
      mockRegistry.list.mockImplementation((slot: string) => {
        switch (slot) {
          case "runtime":
            return runtimes.map((name) => manifest("runtime", name));
          case "agent":
            return [manifest("agent", "claude-code"), manifest("agent", "codex")];
          case "workspace":
            return [manifest("workspace", "worktree")];
          case "tracker":
            return [manifest("tracker", "github")];
          case "scm":
            return [manifest("scm", "github")];
          case "notifier":
            return [manifest("notifier", "slack")];
          default:
            return [];
        }
      });
      return config;
    }

    const output = () => consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

    it("probes herdr when the config references it", async () => {
      withRuntimes("herdr", "herdr");

      await program.parseAsync(["node", "test", "doctor"]);

      expect(mockCheckHerdr).toHaveBeenCalledTimes(1);
      expect(output()).toContain("herdr runtime is available");
    });

    // The whole point: the plugin resolving says nothing about the server.
    it("fails with the fix when the herdr server is unreachable", async () => {
      withRuntimes("herdr");
      mockCheckHerdr.mockRejectedValue(
        new Error("herdr is installed but no server is running. Start one with: herdr server"),
      );

      await expect(program.parseAsync(["node", "test", "doctor"])).rejects.toThrow(
        "process.exit(1)",
      );

      expect(output()).toContain("herdr runtime is configured in defaults.runtime");
      expect(output()).toContain("no server is running");
    });

    it("names every config site that asked for a broken runtime", async () => {
      withRuntimes("herdr", "herdr");
      mockCheckHerdr.mockRejectedValue(new Error("boom"));

      await expect(program.parseAsync(["node", "test", "doctor"])).rejects.toThrow(
        "process.exit(1)",
      );

      expect(output()).toContain("defaults.runtime, projects.my-app.runtime");
    });

    it("does not probe herdr for a tmux-only config", async () => {
      withRuntimes("tmux", "tmux");

      await program.parseAsync(["node", "test", "doctor"]);

      expect(mockCheckHerdr).not.toHaveBeenCalled();
      expect(mockCheckTmux).toHaveBeenCalledTimes(1);
    });

    it("probes both when projects disagree with the default", async () => {
      withRuntimes("tmux", "herdr");

      await program.parseAsync(["node", "test", "doctor"]);

      expect(mockCheckTmux).toHaveBeenCalledTimes(1);
      expect(mockCheckHerdr).toHaveBeenCalledTimes(1);
    });

    it("passes runtimes that drive no external service", async () => {
      withRuntimes("process", "process");

      await program.parseAsync(["node", "test", "doctor"]);

      expect(mockCheckTmux).not.toHaveBeenCalled();
      expect(mockCheckHerdr).not.toHaveBeenCalled();
      expect(output()).toContain("process runtime needs no external service");
    });
  });

  it("resolves notifier aliases when sending test notifications", async () => {
    const config = makeConfig();
    const mockNotifier = { notify: vi.fn().mockResolvedValue(undefined) };
    mockFindConfigFile.mockReturnValue(config.configPath);
    mockLoadConfig.mockReturnValue(config);

    mockRegistry.list.mockImplementation((slot: string) => {
      switch (slot) {
        case "runtime":
          return [manifest("runtime", "tmux")];
        case "agent":
          return [manifest("agent", "claude-code"), manifest("agent", "codex")];
        case "workspace":
          return [manifest("workspace", "worktree")];
        case "tracker":
          return [manifest("tracker", "github")];
        case "scm":
          return [manifest("scm", "github")];
        case "notifier":
          return [manifest("notifier", "slack")];
        default:
          return [];
      }
    });
    mockRegistry.get.mockImplementation((slot: string, name: string) => {
      if (slot === "notifier" && name === "slack") {
        return mockNotifier;
      }
      return null;
    });

    await program.parseAsync(["node", "test", "doctor", "--test-notify"]);

    expect(mockRegistry.get).toHaveBeenCalledWith("notifier", "slack");
    expect(mockNotifier.notify).toHaveBeenCalledTimes(1);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("tests shared-plugin notifier aliases independently", async () => {
    const config = makeConfig();
    config.notifiers = {
      alerts: { plugin: "slack" },
      ops: { plugin: "slack" },
    };
    config.defaults.notifiers = ["alerts", "ops"];

    const alertsNotifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const opsNotifier = { notify: vi.fn().mockResolvedValue(undefined) };

    mockFindConfigFile.mockReturnValue(config.configPath);
    mockLoadConfig.mockReturnValue(config);

    mockRegistry.list.mockImplementation((slot: string) => {
      switch (slot) {
        case "runtime":
          return [manifest("runtime", "tmux")];
        case "agent":
          return [manifest("agent", "claude-code"), manifest("agent", "codex")];
        case "workspace":
          return [manifest("workspace", "worktree")];
        case "tracker":
          return [manifest("tracker", "github")];
        case "scm":
          return [manifest("scm", "github")];
        case "notifier":
          return [manifest("notifier", "slack")];
        default:
          return [];
      }
    });
    mockRegistry.get.mockImplementation((slot: string, name: string) => {
      if (slot === "notifier" && name === "alerts") {
        return alertsNotifier;
      }
      if (slot === "notifier" && name === "ops") {
        return opsNotifier;
      }
      return null;
    });

    await program.parseAsync(["node", "test", "doctor", "--test-notify"]);

    expect(mockRegistry.get).toHaveBeenCalledWith("notifier", "alerts");
    expect(mockRegistry.get).toHaveBeenCalledWith("notifier", "ops");
    expect(alertsNotifier.notify).toHaveBeenCalledTimes(1);
    expect(opsNotifier.notify).toHaveBeenCalledTimes(1);
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});
