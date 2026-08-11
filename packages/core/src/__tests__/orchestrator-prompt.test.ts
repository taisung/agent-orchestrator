import { describe, expect, it } from "vitest";
import { generateOrchestratorPrompt } from "../orchestrator-prompt.js";
import type { OrchestratorConfig } from "../types.js";

const config: OrchestratorConfig = {
  configPath: "/tmp/agent-orchestrator.yaml",
  defaults: {
    runtime: "tmux",
    agent: "claude-code",
    workspace: "worktree",
    notifiers: ["desktop"],
  },
  projects: {
    "my-app": {
      name: "My App",
      repo: "org/my-app",
      path: "/tmp/my-app",
      defaultBranch: "main",
      sessionPrefix: "app",
    },
  },
  notifiers: {},
  notificationRouting: {
    urgent: ["desktop"],
    action: ["desktop"],
    warning: [],
    info: [],
  },
  reactions: {},
  readyThresholdMs: 300_000,
};

describe("generateOrchestratorPrompt", () => {
  it("keeps source implementation out of the orchestrator session", () => {
    const prompt = generateOrchestratorPrompt({
      config,
      projectId: "my-app",
      project: config.projects["my-app"]!,
    });

    expect(prompt).toContain(
      "**Any source code change, including config and build-system files.**",
    );
    expect(prompt).toContain("The orchestrator never modifies the codebase directly");
  });

  it("mandates ao send and bans raw tmux access", () => {
    const prompt = generateOrchestratorPrompt({
      config,
      projectId: "my-app",
      project: config.projects["my-app"]!,
    });

    expect(prompt).toContain("Always use `ao send`");
    expect(prompt).toContain("— never raw `tmux send-keys`");
    expect(prompt).toContain("ao send --no-wait");
  });

  it("pushes implementation and PR claiming into worker sessions", () => {
    const prompt = generateOrchestratorPrompt({
      config,
      projectId: "my-app",
      project: config.projects["my-app"]!,
    });

    expect(prompt).toContain("### Must be delegated to a worker");
    expect(prompt).toContain("Never claim a PR into `app-orchestrator`");
    expect(prompt).toContain("Delegate implementation, test execution, or PR claiming");
  });
});
