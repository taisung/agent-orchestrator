/**
 * Session relaunch (2026-10-22), R-2: `ao session relaunch --continue`
 * resumes the session's OWN conversation, by the ID that the SessionStart
 * hook recorded for the pane's own Claude Code. Never the newest transcript
 * of the workspace's Claude project folder.
 *
 * The hook tests run the real hook script under stand-in `claude` processes
 * (bash scripts named claude). Each stand-in tree starts through a double
 * fork, so its parent is init and no claude process of the test runner is
 * above it. A stand-in `tmux` answers the pane's terminal: a plain file that
 * the pane's agent has as its stdin.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentLaunchConfig, Session } from "@aoagents/ao-core";
import { create, SESSION_START_SCRIPT, toClaudeProjectPath } from "../index.js";

const OUTER = "11111111-2222-4333-8444-555555555555";
const NESTED = "66666666-7777-4888-9999-aaaaaaaaaaaa";

let dir: string;
let sessionsDir: string;
let hook: string;
let fakeBin: string;
let paneTty: string;
let otherTty: string;
let runs = 0;
const savedHome = process.env["HOME"];

function shq(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function treeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: `${fakeBin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
    HOME: dir,
    AO_SESSION: "app-1",
    AO_DATA_DIR: sessionsDir,
    TMUX_PANE: "%1",
    HOOK_OUT_DIR: dir,
    ...overrides,
  };
}

/**
 * Run `command` with stdin from `stdinPath` in a process tree whose top has
 * init as its parent, and wait until it ends.
 */
async function runDetached(
  command: string,
  stdinPath: string,
  env: Record<string, string> = treeEnv(),
): Promise<void> {
  runs += 1;
  const done = join(dir, `done-${runs}`);
  const launcher = join(dir, `launch-${runs}.sh`);
  writeFileSync(
    launcher,
    `#!/bin/bash\n${command} < ${shq(stdinPath)} > /dev/null 2>&1\ntouch ${shq(done)}\n`,
  );
  execFileSync("bash", ["-c", `( bash ${shq(launcher)} & )`], { env, stdio: "ignore" });
  await vi.waitFor(() => expect(existsSync(done)).toBe(true), { timeout: 5_000, interval: 20 });
}

/** A stand-in Claude Code that runs the hook for `id`, then optionally a nested claude. */
function claudeTree(id: string, nested?: { id: string; stdin?: string }): string {
  const args = [hook, id, ...(nested ? [nested.id, nested.stdin ?? "/dev/null"] : [])];
  return [join(fakeBin, "claude"), ...args].map(shq).join(" ");
}

function recordFile(): string {
  return join(sessionsDir, ".agent-conversations", "app-1");
}

function recorded(): Record<string, string> | null {
  if (!existsSync(recordFile())) return null;
  return Object.fromEntries(
    readFileSync(recordFile(), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ao-relaunch-conv-"));
  sessionsDir = join(dir, "sessions");
  mkdirSync(sessionsDir);
  hook = join(dir, "ao-session-start.sh");
  writeFileSync(hook, SESSION_START_SCRIPT, { mode: 0o755 });
  fakeBin = join(dir, "bin");
  mkdirSync(fakeBin);
  paneTty = join(dir, "pane-tty");
  otherTty = join(dir, "other-tty");
  writeFileSync(paneTty, "");
  writeFileSync(otherTty, "");
  writeFileSync(
    join(fakeBin, "tmux"),
    `#!/bin/bash\nif [ "$1" = display-message ] && [ "$4" = "%1" ]; then echo ${shq(paneTty)}; exit 0; fi\nexit 1\n`,
    { mode: 0o755 },
  );
  // Runs the hook as Claude Code runs a SessionStart hook (the JSON on its
  // stdin, its stdout kept); with a third argument it starts a nested claude,
  // as the agent's Bash tool would start `claude -p`.
  writeFileSync(
    join(fakeBin, "claude"),
    [
      "#!/bin/bash",
      'json=$(printf \'{"session_id":"%s","source":"startup","transcript_path":"/t/%s.jsonl"}\' "$2" "$2")',
      'bash "$1" <<< "$json" > "$HOOK_OUT_DIR/$2.out" 2>&1',
      'if [ "$#" -ge 3 ]; then "$0" "$1" "$3" < "$4"; fi',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  process.env["HOME"] = dir;
});

afterEach(() => {
  process.env["HOME"] = savedHome;
  rmSync(dir, { recursive: true, force: true });
});

describe("SessionStart hook: records only the pane's own agent (Note 1, item 1)", () => {
  it("records the conversation of the pane's own Claude Code and prints nothing", async () => {
    await runDetached(claudeTree(OUTER), paneTty);

    expect(recorded()).toMatchObject({
      agent: "claude-code",
      conversationId: OUTER,
      source: "startup",
      transcriptPath: `/t/${OUTER}.jsonl`,
      agentPid: expect.stringMatching(/^\d+$/),
    });
    expect(readFileSync(join(dir, `${OUTER}.out`), "utf-8")).toBe("");
  });

  it("does not let a nested claude -p (stdin not the pane terminal) change the record", async () => {
    await runDetached(claudeTree(OUTER, { id: NESTED }), paneTty);

    expect(recorded()?.["conversationId"]).toBe(OUTER);
    expect(existsSync(join(dir, `${NESTED}.out`))).toBe(true);
  });

  it("does not let a nested claude on the pane terminal change the record (a claude runs above it)", async () => {
    await runDetached(claudeTree(OUTER, { id: NESTED, stdin: paneTty }), paneTty);

    expect(recorded()?.["conversationId"]).toBe(OUTER);
    expect(existsSync(join(dir, `${NESTED}.out`))).toBe(true);
  });

  it("does not record a claude whose stdin is another terminal (another pane of the session)", async () => {
    await runDetached(claudeTree(OUTER), otherTty);

    expect(recorded()).toBeNull();
  });

  it("does not record when no claude process runs above the hook", async () => {
    const input = join(dir, "input.json");
    writeFileSync(input, JSON.stringify({ session_id: OUTER, source: "startup" }));

    await runDetached(`bash ${shq(hook)}`, input);

    expect(recorded()).toBeNull();
  });

  it("does not record without a valid AO_SESSION", async () => {
    await runDetached(claudeTree(OUTER), paneTty, treeEnv({ AO_SESSION: "../app-1" }));

    expect(recorded()).toBeNull();
    expect(existsSync(join(sessionsDir, ".agent-conversations"))).toBe(false);
  });

  it("records the same without jq (the fallback parse)", async () => {
    const tools = join(dir, "tools");
    mkdirSync(tools);
    for (const tool of [
      "bash",
      "cat",
      "tr",
      "readlink",
      "mkdir",
      "mv",
      "rm",
      "grep",
      "head",
      "cut",
      "touch",
    ]) {
      const path = execFileSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf-8" }).trim();
      symlinkSync(path, join(tools, tool));
    }

    await runDetached(claudeTree(OUTER), paneTty, treeEnv({ PATH: `${fakeBin}:${tools}` }));

    expect(recorded()).toMatchObject({ conversationId: OUTER, source: "startup" });
  });
});

describe("getOwnConversationId: only the recorded ID of this session", () => {
  const agent = create();
  const workspace = "/work/space-1";

  function session(): Session {
    return {
      id: "app-1",
      projectId: "my-app",
      status: "working",
      activity: null,
      branch: null,
      issueId: null,
      pr: null,
      workspacePath: workspace,
      runtimeHandle: null,
      agentInfo: null,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: {},
    };
  }

  function projectDir(): string {
    const path = join(dir, ".claude", "projects", toClaudeProjectPath(workspace));
    mkdirSync(path, { recursive: true });
    return path;
  }

  function writeTranscript(id: string, ageMs: number): string {
    const path = join(projectDir(), `${id}.jsonl`);
    writeFileSync(path, "{}\n");
    const at = new Date(Date.now() - ageMs);
    utimesSync(path, at, at);
    return path;
  }

  function writeRecord(fields: Record<string, string>, writtenAt = new Date()): void {
    mkdirSync(join(sessionsDir, ".agent-conversations"), { recursive: true });
    writeFileSync(
      recordFile(),
      Object.entries(fields)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
    utimesSync(recordFile(), writtenAt, writtenAt);
  }

  const launchedAt = () => new Date(Date.now() - 60_000);

  it("returns the recorded ID even when a newer transcript of another conversation is in the folder", async () => {
    const own = writeTranscript(OUTER, 120_000);
    writeTranscript(NESTED, 1_000);
    writeRecord({
      agent: "claude-code",
      conversationId: OUTER,
      source: "clear",
      transcriptPath: own,
    });

    const lookup = await agent.getOwnConversationId!(session(), {
      dataDir: sessionsDir,
      launchedAt: launchedAt(),
    });

    expect(lookup.id).toBe(OUTER);
    expect(lookup.id === null ? "" : lookup.source).toMatch(
      /SessionStart hook record .*source clear/,
    );
  });

  it("refuses when no conversation is recorded, though transcripts are in the folder", async () => {
    writeTranscript(OUTER, 1_000);

    const lookup = await agent.getOwnConversationId!(session(), {
      dataDir: sessionsDir,
      launchedAt: launchedAt(),
    });

    expect(lookup).toEqual({
      id: null,
      reason: expect.stringMatching(/no conversation of this session is recorded/),
    });
  });

  it("refuses a record older than the session's last launch", async () => {
    const own = writeTranscript(OUTER, 1_000);
    const launch = launchedAt();
    writeRecord(
      { agent: "claude-code", conversationId: OUTER, transcriptPath: own },
      new Date(launch.getTime() - 600_000),
    );

    const lookup = await agent.getOwnConversationId!(session(), {
      dataDir: sessionsDir,
      launchedAt: launch,
    });

    expect(lookup).toEqual({
      id: null,
      reason: expect.stringMatching(/before the session's last launch/),
    });
  });

  it("accepts a record written up to 5 s before the launch time (a restore writes restoredAt after the start)", async () => {
    const own = writeTranscript(OUTER, 1_000);
    const launch = launchedAt();
    writeRecord(
      { agent: "claude-code", conversationId: OUTER, transcriptPath: own },
      new Date(launch.getTime() - 3_000),
    );

    const lookup = await agent.getOwnConversationId!(session(), {
      dataDir: sessionsDir,
      launchedAt: launch,
    });

    expect(lookup.id).toBe(OUTER);
  });

  it("refuses a record of another agent or with an ID that is not a UUID", async () => {
    writeTranscript(OUTER, 1_000);
    writeRecord({ agent: "codex", conversationId: OUTER });
    const other = await agent.getOwnConversationId!(session(), {
      dataDir: sessionsDir,
      launchedAt: launchedAt(),
    });
    writeRecord({ agent: "claude-code", conversationId: "latest" });
    const malformed = await agent.getOwnConversationId!(session(), {
      dataDir: sessionsDir,
      launchedAt: launchedAt(),
    });

    expect(other.id).toBeNull();
    expect(malformed.id).toBeNull();
  });

  it("refuses when the recorded conversation has no transcript", async () => {
    writeTranscript(NESTED, 1_000);
    writeRecord({ agent: "claude-code", conversationId: OUTER, transcriptPath: "" });

    const lookup = await agent.getOwnConversationId!(session(), {
      dataDir: sessionsDir,
      launchedAt: launchedAt(),
    });

    expect(lookup).toEqual({ id: null, reason: expect.stringMatching(/has no transcript/) });
  });

  it("finds the transcript in the workspace's Claude project folder when no usable path is recorded", async () => {
    writeTranscript(OUTER, 1_000);
    writeRecord({
      agent: "claude-code",
      conversationId: OUTER,
      transcriptPath: "/elsewhere/another.jsonl",
    });

    const lookup = await agent.getOwnConversationId!(session(), {
      dataDir: sessionsDir,
      launchedAt: launchedAt(),
    });

    expect(lookup.id).toBe(OUTER);
  });
});

describe("getLaunchCommand: --resume <id> for --continue", () => {
  const agent = create();
  const base: AgentLaunchConfig = {
    sessionId: "app-1",
    projectConfig: {
      name: "My App",
      repo: "org/my-app",
      path: "/work",
      defaultBranch: "main",
      sessionPrefix: "app",
    },
    permissions: "permissionless",
    model: "opus",
    systemPromptFile: "/prompts/orchestrator-prompt-app-orchestrator.md",
  };

  it("appends --resume with the ID last, so the spawn arguments stay in front", () => {
    const spawn = agent.getLaunchCommand(base);
    const relaunch = agent.getLaunchCommand({ ...base, continueConversationId: OUTER });

    expect(relaunch).toBe(`${spawn} --resume '${OUTER}'`);
    expect(spawn).toBe(
      `claude --dangerously-skip-permissions --model 'opus' --append-system-prompt "$(cat '/prompts/orchestrator-prompt-app-orchestrator.md')"`,
    );
  });

  it("has no --resume without a conversation ID", () => {
    expect(agent.getLaunchCommand(base)).not.toContain("--resume");
  });
});

describe("setupWorkspaceHooks: the SessionStart hook", () => {
  const agent = create();

  function settingsOf(workspace: string): {
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
  } {
    return JSON.parse(readFileSync(join(workspace, ".claude", "settings.json"), "utf-8"));
  }

  it("installs the script and one SessionStart entry next to the PostToolUse entry", async () => {
    const workspace = join(dir, "ws");
    mkdirSync(workspace);

    await agent.setupWorkspaceHooks!(workspace, { dataDir: sessionsDir });

    const script = join(workspace, ".claude", "ao-session-start.sh");
    expect(readFileSync(script, "utf-8")).toBe(SESSION_START_SCRIPT);
    expect(statSync(script).mode & 0o777).toBe(0o755);
    const settings = settingsOf(workspace);
    expect(settings.hooks["SessionStart"]).toEqual([
      { hooks: [{ type: "command", command: ".claude/ao-session-start.sh", timeout: 10 }] },
    ]);
    expect(settings.hooks["PostToolUse"][0].hooks[0]["command"]).toBe(
      ".claude/metadata-updater.sh",
    );
  });

  it("keeps other SessionStart entries and adds no second AO entry", async () => {
    const workspace = join(dir, "ws");
    mkdirSync(join(workspace, ".claude"), { recursive: true });
    const own = { matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] };
    writeFileSync(
      join(workspace, ".claude", "settings.json"),
      JSON.stringify({ hooks: { SessionStart: [own] } }),
    );

    await agent.setupWorkspaceHooks!(workspace, { dataDir: sessionsDir });
    await agent.setupWorkspaceHooks!(workspace, { dataDir: sessionsDir });

    expect(settingsOf(workspace).hooks["SessionStart"]).toEqual([
      own,
      { hooks: [{ type: "command", command: ".claude/ao-session-start.sh", timeout: 10 }] },
    ]);
  });
});
