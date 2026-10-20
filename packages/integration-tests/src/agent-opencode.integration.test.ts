/**
 * Integration tests for the OpenCode agent plugin.
 *
 * Requires:
 *   - `opencode` binary on PATH
 *   - tmux installed and running
 *   - Any supported API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY,
 *     GEMINI_API_KEY, ZAI_API_KEY, ZAI_CODING_PLAN_API_KEY, KIMI_API_KEY,
 *     OPENROUTER_API_KEY, GROK_API_KEY, GITHUB_TOKEN, COPILOT_API_KEY)
 *
 * Skipped automatically when prerequisites are missing.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ActivityDetection, AgentSessionInfo } from "@aoagents/ao-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import claudeCodePlugin from "@aoagents/ao-plugin-agent-claude-code";
import codexPlugin from "@aoagents/ao-plugin-agent-codex";
import geminiPlugin from "@aoagents/ao-plugin-agent-gemini";
import opencodePlugin from "@aoagents/ao-plugin-agent-opencode";
import {
  isTmuxAvailable,
  killSessionsByPrefix,
  createSession,
  killSession,
} from "./helpers/tmux.js";
import { pollUntilEqual, sleep } from "./helpers/polling.js";
import { makeTmuxHandle, makeSession } from "./helpers/session-factory.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Prerequisites
// ---------------------------------------------------------------------------

const SESSION_PREFIX = "ao-inttest-opencode-";

async function findOpencodeBinary(): Promise<string | null> {
  try {
    await execFileAsync("which", ["opencode"], { timeout: 5_000 });
    return "opencode";
  } catch {
    return null;
  }
}

/** Verify opencode can start (has API key, binary works). */
async function canOpencodeRun(bin: string): Promise<boolean> {
  const probe = "ao-inttest-opencode-probe";
  try {
    await killSessionsByPrefix(probe);
    await createSession(probe, `${bin} run 'Say hello'`, tmpdir());
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1_000));
      try {
        await execFileAsync("tmux", ["has-session", "-t", probe], { timeout: 5_000 });
      } catch {
        return true;
      }
    }
    await killSession(probe);
    return false;
  } catch {
    return false;
  }
}

const tmuxOk = await isTmuxAvailable();
const opencodeBin = await findOpencodeBinary();

async function hasOpencodeCredentials(): Promise<boolean> {
  const hasEnvKey = Boolean(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.ZAI_API_KEY ||
    process.env.ZAI_CODING_PLAN_API_KEY ||
    process.env.KIMI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.GROK_API_KEY ||
    process.env.GITHUB_TOKEN ||
    process.env.COPILOT_API_KEY,
  );

  if (hasEnvKey) return true;

  try {
    const authPath = join(homedir(), ".local", "share", "opencode", "auth.json");
    await readFile(authPath, "utf-8");
    return true;
  } catch {
    return false;
  }
}

const hasCredentials = await hasOpencodeCredentials();
const opencodeReady = opencodeBin !== null && hasCredentials && (await canOpencodeRun(opencodeBin));
const canRun = tmuxOk && opencodeReady;

// ---------------------------------------------------------------------------
// Lifecycle Tests (requires opencode + tmux + API key)
// ---------------------------------------------------------------------------

describe.skipIf(!canRun)("agent-opencode (integration)", () => {
  const agent = opencodePlugin.create();
  const sessionName = `${SESSION_PREFIX}${Date.now()}`;
  let tmpDir: string;

  let aliveRunning = false;
  let aliveActivityState: ActivityDetection | null | undefined;
  let exitedRunning: boolean;
  let exitedActivityState: ActivityDetection | null;
  let sessionInfo: AgentSessionInfo | null;

  beforeAll(async () => {
    await killSessionsByPrefix(SESSION_PREFIX);
    tmpDir = await mkdtemp(join(tmpdir(), "ao-inttest-opencode-"));

    const cmd = `${opencodeBin} run 'Say hello and nothing else'`;
    await createSession(sessionName, cmd, tmpDir);

    const handle = makeTmuxHandle(sessionName);
    const session = makeSession("inttest-opencode", handle, tmpDir);

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const running = await agent.isProcessRunning(handle);
      if (running) {
        aliveRunning = true;
        const activityState = await agent.getActivityState(session);
        if (activityState?.state !== "exited") {
          aliveActivityState = activityState;
          break;
        }
      }
      await sleep(500);
    }

    exitedRunning = await pollUntilEqual(() => agent.isProcessRunning(handle), false, {
      timeoutMs: 90_000,
      intervalMs: 2_000,
    });

    exitedActivityState = await agent.getActivityState(session);
    sessionInfo = await agent.getSessionInfo(session);
  }, 120_000);

  afterAll(async () => {
    await killSession(sessionName);
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);

  it("isProcessRunning -> true while agent is alive", () => {
    expect(aliveRunning).toBe(true);
  });

  it("getActivityState -> returns null while agent is running (no per-session tracking)", () => {
    if (aliveActivityState !== undefined) {
      expect(aliveActivityState).toBeNull();
    }
  });

  it("isProcessRunning -> false after agent exits", () => {
    expect(exitedRunning).toBe(false);
  });

  it("getActivityState -> returns exited after agent process terminates", () => {
    expect(exitedActivityState?.state).toBe("exited");
  });

  it("getSessionInfo -> null (not implemented for opencode)", () => {
    expect(sessionInfo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fake `opencode` binaries for the version gate and the session create
// ---------------------------------------------------------------------------

/**
 * Write a fake `opencode` to a new directory and return the directory. It
 * prints `version` for `--version`, answers `opencode api session.create` and
 * `session.get` like 2.0.29, and appends each call (argv and AO_SESSION) to
 * `calls.jsonl` in the directory. I-3 runs the version gate and the create in
 * Node before the pane starts, so the tests below put this fake on PATH and
 * do not depend on the host's OpenCode (CI installs none).
 */
async function writeFakeOpencode(version: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ao-inttest-opencode-fake-"));
  const log = join(dir, "calls.jsonl");
  const store = join(dir, "sessions.json");
  const script = `#!${process.execPath}
const fs = require("node:fs");
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, aoSession: process.env.AO_SESSION ?? null }) + "\\n");
if (argv[0] === "--version") { process.stdout.write(${JSON.stringify(version)} + "\\n"); process.exit(0); }
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(${JSON.stringify(store)}, "utf-8")); } catch {}
if (argv[0] === "api" && argv[1] === "session.create") {
  const body = JSON.parse(argv[argv.indexOf("-d") + 1]);
  const session = { id: "ses_inttest1", title: body.title, directory: body.location.directory };
  if (body.model) session.model = { ...body.model, variant: body.model.variant || "default" };
  if (body.agent) session.agent = body.agent;
  sessions[session.id] = session;
  fs.writeFileSync(${JSON.stringify(store)}, JSON.stringify(sessions));
  process.stdout.write(JSON.stringify({ data: session }) + "\\n");
  process.exit(0);
}
if (argv[0] === "api" && argv[1] === "session.get") {
  const id = argv[argv.indexOf("--param") + 1].replace(/^sessionID=/, "");
  if (!sessions[id]) { process.stdout.write(JSON.stringify({ _tag: "SessionNotFoundError" })); process.exit(1); }
  process.stdout.write(JSON.stringify({ data: sessions[id] }) + "\\n");
  process.exit(0);
}
process.stderr.write("unexpected call\\n");
process.exit(2);
`;
  await writeFile(join(dir, "opencode"), script, { mode: 0o755 });
  return dir;
}

async function readFakeCalls(
  dir: string,
): Promise<Array<{ argv: string[]; aoSession: string | null }>> {
  const text = await readFile(join(dir, "calls.jsonl"), "utf-8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { argv: string[]; aoSession: string | null });
}

// ---------------------------------------------------------------------------
// Launch command tests: a pure string on the prepared session ID (I-3)
// ---------------------------------------------------------------------------

describe("getLaunchCommand (integration)", () => {
  const agent = opencodePlugin.create();

  const baseConfig = {
    sessionId: "test-1",
    projectConfig: {
      name: "test",
      repo: "owner/repo",
      path: "/workspace",
      defaultBranch: "main",
      sessionPrefix: "test",
      agentConfig: { opencodeSessionId: "ses_abc123" },
    },
  };

  it("opens the TUI on the prepared session with the prompt, and no flags for the stored settings", () => {
    const cmd = agent.getLaunchCommand({
      ...baseConfig,
      subagent: "sisyphus",
      model: "opencode-go/muse-spark-1.3-contributor",
      prompt: "fix the bug",
    });
    expect(cmd).toBe("exec opencode --session 'ses_abc123' --prompt 'fix the bug'");
  });

  it("joins systemPrompt and the task prompt", () => {
    const cmd = agent.getLaunchCommand({
      ...baseConfig,
      systemPrompt: "You are an orchestrator",
      prompt: "do the task",
    });
    expect(cmd).toBe(`exec opencode --session 'ses_abc123' --prompt 'You are an orchestrator

do the task'`);
  });

  it("reads systemPromptFile in the pane, before the task prompt", () => {
    const cmd = agent.getLaunchCommand({
      ...baseConfig,
      systemPromptFile: "/tmp/orchestrator-prompt.md",
      prompt: "do the task",
    });
    expect(cmd).toBe(
      "exec opencode --session 'ses_abc123' --prompt \"$(cat '/tmp/orchestrator-prompt.md'; printf '\\n\\n'; printf %s 'do the task')\"",
    );
  });

  it("escapes single quotes in a prompt and in a prompt file path", () => {
    expect(agent.getLaunchCommand({ ...baseConfig, systemPrompt: "it's important" })).toBe(
      "exec opencode --session 'ses_abc123' --prompt 'it'\\''s important'",
    );
    expect(agent.getLaunchCommand({ ...baseConfig, systemPromptFile: "/tmp/it's-prompt.md" })).toBe(
      "exec opencode --session 'ses_abc123' --prompt \"$(cat '/tmp/it'\\''s-prompt.md')\"",
    );
  });

  it("omits --prompt for an empty prompt", () => {
    expect(agent.getLaunchCommand({ ...baseConfig, prompt: "" })).toBe(
      "exec opencode --session 'ses_abc123'",
    );
  });

  it("throws without a prepared session ID", () => {
    expect(() =>
      agent.getLaunchCommand({
        ...baseConfig,
        projectConfig: { ...baseConfig.projectConfig, agentConfig: {} },
        prompt: "start",
      }),
    ).toThrow("prepareAgentSession must create the session before the launch command");
  });
});

// ---------------------------------------------------------------------------
// Version gate and session create through real child processes (fake binary)
// ---------------------------------------------------------------------------

describe("prepareAgentSession with the version gate (integration)", () => {
  const agent = opencodePlugin.create();
  const originalPath = process.env.PATH;
  const dirs: string[] = [];
  const config = {
    sessionId: "gate-1",
    projectConfig: {
      name: "test",
      repo: "owner/repo",
      path: "/workspace",
      defaultBranch: "main",
      sessionPrefix: "test",
    },
    subagent: "plan",
    prompt: "start",
  };

  async function onlyOnPath(dir: string): Promise<string> {
    dirs.push(dir);
    process.env.PATH = dir;
    return dir;
  }

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it("accepts opencode v2.0.29: it creates the session with the pane environment, and detect() finds it", async () => {
    const dir = await onlyOnPath(await writeFakeOpencode("opencode v2.0.29"));
    const workspace = await mkdtemp(join(tmpdir(), "ao-inttest-opencode-ws-"));
    dirs.push(workspace);

    const prepared = await agent.prepareAgentSession!(config, {
      workspacePath: workspace,
      environment: { AO_SESSION: "gate-1", PATH: dir },
    });

    expect(prepared.metadata).toEqual({ opencodeSessionId: "ses_inttest1" });
    expect(prepared.created).toBe(true);
    const calls = await readFakeCalls(dir);
    expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([
      ["--version"],
      ["api", "session.create"],
      ["api", "session.get"],
    ]);
    const body = JSON.parse(calls[1]!.argv[3]!) as Record<string, unknown>;
    expect(body).toEqual({
      title: "AO:gate-1",
      agent: "plan",
      location: { directory: await realpath(workspace) },
    });
    // The API calls run with the session's own AO_SESSION, not the outer one.
    expect(calls.slice(1).map((call) => call.aoSession)).toEqual(["gate-1", "gate-1"]);
    expect(opencodePlugin.detect!()).toBe(true);
  });

  it("refuses 1.18.35 before any API call, and detect() hides it", async () => {
    const dir = await onlyOnPath(await writeFakeOpencode("1.18.35"));
    await expect(
      agent.prepareAgentSession!(config, { workspacePath: tmpdir(), environment: { PATH: dir } }),
    ).rejects.toThrow("ao needs OpenCode 2.0.29 or later (found 1.18.35)");
    expect((await readFakeCalls(dir)).map((call) => call.argv[0])).toEqual(["--version"]);
    expect(opencodePlugin.detect!()).toBe(false);
  });

  it("refuses a host with no opencode on PATH and says so", async () => {
    const dir = await onlyOnPath(await mkdtemp(join(tmpdir(), "ao-inttest-opencode-empty-")));
    await expect(
      agent.prepareAgentSession!(config, { workspacePath: tmpdir(), environment: { PATH: dir } }),
    ).rejects.toThrow("not found on PATH");
    expect(opencodePlugin.detect!()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEnvironment tests
// ---------------------------------------------------------------------------

describe("getEnvironment (integration)", () => {
  const agent = opencodePlugin.create();

  const baseConfig = {
    sessionId: "sess-123",
    projectConfig: {
      name: "test",
      repo: "owner/repo",
      path: "/workspace",
      defaultBranch: "main",
      sessionPrefix: "test",
    },
  };

  it("sets AO_SESSION_ID", () => {
    const env = agent.getEnvironment(baseConfig);
    expect(env["AO_SESSION_ID"]).toBe("sess-123");
  });

  it("sets AO_ISSUE_ID when provided", () => {
    const env = agent.getEnvironment({ ...baseConfig, issueId: "GH-42" });
    expect(env["AO_ISSUE_ID"]).toBe("GH-42");
  });

  it("omits AO_ISSUE_ID when not provided", () => {
    const env = agent.getEnvironment(baseConfig);
    expect(env["AO_ISSUE_ID"]).toBeUndefined();
  });

  it("does not set AO_PROJECT_ID (caller's responsibility)", () => {
    const env = agent.getEnvironment(baseConfig);
    expect(env["AO_PROJECT_ID"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// send hook tests (I-5)
// ---------------------------------------------------------------------------

describe("send hook (I-5, integration)", () => {
  it("is in the OpenCode plugin only: Claude Code, Codex and Gemini keep the runtime path", () => {
    const opencode = opencodePlugin.create();
    expect(typeof opencode.canDeliverMessage).toBe("function");
    expect(typeof opencode.deliverMessage).toBe("function");
    expect(typeof opencode.checkMessage).toBe("function");
    for (const plugin of [claudeCodePlugin, codexPlugin, geminiPlugin]) {
      const agent = plugin.create();
      expect(agent.canDeliverMessage, plugin.manifest.name).toBeUndefined();
      expect(agent.deliverMessage, plugin.manifest.name).toBeUndefined();
      expect(agent.checkMessage, plugin.manifest.name).toBeUndefined();
    }
  });

  it("refuses with the real checkMessage a message that cannot go on the command line", () => {
    const agent = opencodePlugin.create();
    expect(() => agent.checkMessage?.("x".repeat(200 * 1024))).toThrow(
      /more than the 131071 bytes .*nothing was sent/,
    );
    expect(() => agent.checkMessage?.("Fix the CI failures")).not.toThrow();
  });

  it("keeps an OpenCode session without a valid stored session ID on the runtime path", () => {
    const agent = opencodePlugin.create();
    const session = makeSession("ao-inttest-send", makeTmuxHandle("ao-inttest-send"), tmpdir());
    expect(agent.canDeliverMessage?.(session)).toBe(false);
    expect(
      agent.canDeliverMessage?.({ ...session, metadata: { opencodeSessionId: "not-an-id" } }),
    ).toBe(false);
    expect(
      agent.canDeliverMessage?.({
        ...session,
        metadata: { opencodeSessionId: "ses_ea933c29bffeFbxN7vNocDfbvl" },
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectActivity tests
// ---------------------------------------------------------------------------

describe("detectActivity (integration)", () => {
  const agent = opencodePlugin.create();

  it("returns idle for empty terminal output", () => {
    expect(agent.detectActivity("")).toBe("idle");
  });

  it("returns idle for whitespace-only terminal output", () => {
    expect(agent.detectActivity("   \n  ")).toBe("idle");
  });

  it("returns active for non-empty terminal output", () => {
    expect(agent.detectActivity("opencode is working\n")).toBe("active");
  });

  it("returns active for output with ANSI codes", () => {
    expect(agent.detectActivity("\u001b[32mSuccess\u001b[0m\n")).toBe("active");
  });

  it("returns active for multiline output", () => {
    expect(agent.detectActivity("line1\nline2\nline3\n")).toBe("active");
  });
});
