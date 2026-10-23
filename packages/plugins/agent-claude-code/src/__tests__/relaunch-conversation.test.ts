/**
 * Session relaunch (2026-10-22), R-2: `ao session relaunch --continue`
 * resumes the session's OWN conversation, by the ID that the SessionStart
 * hook recorded for the agent of the session's last launch. Never the newest
 * transcript of the workspace's Claude project folder, never by a time
 * window (review r1 M-1, M-4).
 *
 * The hook tests run the real hook script under stand-in `claude` processes
 * (bash scripts named claude). Each stand-in tree starts through a double
 * fork, so its parent is init and no claude process of the test runner is
 * above it. A stand-in `tmux` answers the pane's terminal: a plain file that
 * the pane's agent has as its stdin. One test uses a real tmux server of its
 * own (a second window of the same tmux session).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
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
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentLaunchConfig, Session } from "@aoagents/ao-core";
import { create, SESSION_START_SCRIPT, toClaudeProjectPath } from "../index.js";

const OUTER = "11111111-2222-4333-8444-555555555555";
const NESTED = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const THIS_LAUNCH = "0d4c1f3e-9a8b-4c7d-8e6f-5a4b3c2d1e0f";
const EARLIER_LAUNCH = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

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
    AO_LAUNCH_TOKEN: THIS_LAUNCH,
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
  await vi.waitFor(() => expect(existsSync(done)).toBe(true), { timeout: 8_000, interval: 20 });
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
  // as the agent's Bash tool would start `claude -p` (it inherits the
  // environment of the agent, also its launch token and TMUX_PANE).
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

describe("SessionStart hook: records only the agent of an AO launch", () => {
  it("records the conversation, the launch token and the pane of the launch's agent, and prints nothing", async () => {
    await runDetached(claudeTree(OUTER), paneTty);

    expect(recorded()).toEqual({
      agent: "claude-code",
      conversationId: OUTER,
      source: "startup",
      transcriptPath: `/t/${OUTER}.jsonl`,
      agentPid: expect.stringMatching(/^\d+$/),
      launchToken: THIS_LAUNCH,
      paneId: "%1",
      paneTty,
      eventAt: expect.stringMatching(/^\d{16}$/),
    });
    expect(readFileSync(join(dir, `${OUTER}.out`), "utf-8")).toBe("");
  });

  it("keeps the later clear when the hook of the earlier startup of the same agent ends after it (review r2 M-3)", async () => {
    // The earlier hook waits 1.4 s in its tmux step (within its 2 s budget).
    writeFileSync(
      join(fakeBin, "tmux"),
      `#!/bin/bash\nif [ -n "\${TMUX_DELAY:-}" ]; then sleep "$TMUX_DELAY"; fi\nif [ "$1" = display-message ] && [ "$4" = "%1" ]; then echo ${shq(paneTty)}; exit 0; fi\nexit 1\n`,
      { mode: 0o755 },
    );
    // One stand-in claude (one agent PID, launch token and pane) runs the
    // hook for its startup in the background, as an async hook runs, and
    // 100 ms later the hook for a /clear.
    const twoEvents = join(dir, "two-events");
    mkdirSync(twoEvents);
    writeFileSync(
      join(twoEvents, "claude"),
      [
        "#!/bin/bash",
        'event() { printf \'{"session_id":"%s","source":"%s","transcript_path":"%s/%s.jsonl"}\' "$1" "$2" "$HOOK_OUT_DIR" "$1"; }',
        'TMUX_DELAY=1.4 bash "$1" <<< "$(event "$2" startup)" > /dev/null 2>&1 &',
        "sleep 0.1",
        'bash "$1" <<< "$(event "$3" clear)" > /dev/null 2>&1',
        "wait",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(join(dir, `${OUTER}.jsonl`), "{}\n");
    writeFileSync(join(dir, `${OTHER}.jsonl`), "{}\n");

    await runDetached([join(twoEvents, "claude"), hook, OUTER, OTHER].map(shq).join(" "), paneTty);

    expect(recorded()).toMatchObject({
      conversationId: OTHER,
      source: "clear",
      launchToken: THIS_LAUNCH,
      paneId: "%1",
    });
    const lookup = await create().getOwnConversationId!(sessionOf(join(dir, "ws")), {
      dataDir: sessionsDir,
      launchToken: THIS_LAUNCH,
      pane: { id: "%1", tty: paneTty },
    });
    expect(lookup.id).toBe(OTHER);
  });

  it("does not record a claude without the launch token (one that someone starts in another pane or window)", async () => {
    await runDetached(claudeTree(OUTER), paneTty, treeEnv({ AO_LAUNCH_TOKEN: "" }));

    expect(recorded()).toBeNull();
  });

  it("does not record a claude whose launch token is not a UUID", async () => {
    await runDetached(claudeTree(OUTER), paneTty, treeEnv({ AO_LAUNCH_TOKEN: "x; touch y" }));

    expect(recorded()).toBeNull();
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

  it("does not record a claude whose stdin is another terminal", async () => {
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

  it("records the same without jq and without timeout (the fallback paths)", async () => {
    const tools = join(dir, "tools");
    mkdirSync(tools);
    for (const tool of [
      "bash",
      "cat",
      "readlink",
      "mkdir",
      "mv",
      "rm",
      "grep",
      "head",
      "cut",
      "touch",
      "flock",
    ]) {
      const path = execFileSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf-8" }).trim();
      symlinkSync(path, join(tools, tool));
    }

    await runDetached(claudeTree(OUTER), paneTty, treeEnv({ PATH: `${fakeBin}:${tools}` }));

    expect(recorded()).toMatchObject({
      conversationId: OUTER,
      source: "startup",
      launchToken: THIS_LAUNCH,
    });
  });

  it("keeps the later clear when the hook of the earlier startup is slow inside its write (the lock; review r2 M-3)", async () => {
    // The earlier hook holds its write 1 s (in mv, within its 2 s budget):
    // without the lock the later hook would write in between and lose.
    writeFileSync(
      join(fakeBin, "mv"),
      `#!/bin/bash\nif [ -n "\${MV_DELAY:-}" ]; then sleep "$MV_DELAY"; fi\nexec ${shq(
        execFileSync("bash", ["-c", "command -v mv"], { encoding: "utf-8" }).trim(),
      )} "$@"\n`,
      { mode: 0o755 },
    );
    const twoEvents = join(dir, "two-events-lock");
    mkdirSync(twoEvents);
    writeFileSync(
      join(twoEvents, "claude"),
      [
        "#!/bin/bash",
        'event() { printf \'{"session_id":"%s","source":"%s","transcript_path":"/t/%s.jsonl"}\' "$1" "$2" "$1"; }',
        'MV_DELAY=1 bash "$1" <<< "$(event "$2" startup)" > /dev/null 2>&1 &',
        "sleep 0.3",
        'bash "$1" <<< "$(event "$3" clear)" > /dev/null 2>&1',
        "wait",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    await runDetached([join(twoEvents, "claude"), hook, OUTER, OTHER].map(shq).join(" "), paneTty);

    expect(recorded()).toMatchObject({ conversationId: OTHER, source: "clear" });
  });

  it("records nothing without flock, which keeps the newest event (review r2 M-3)", async () => {
    const tools = join(dir, "tools");
    mkdirSync(tools);
    for (const tool of [
      "bash",
      "cat",
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

    expect(recorded()).toBeNull();
  });

  it("ends within its budget when tmux does not answer (review r1 m-1)", async () => {
    writeFileSync(join(fakeBin, "tmux"), "#!/bin/bash\nexec sleep 20\n", { mode: 0o755 });

    const startedAt = Date.now();
    await runDetached(claudeTree(OUTER), paneTty);

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(recorded()).toBeNull();
  }, 15_000);

  it("ends within its budget when its stdin stays open (review r1 m-1)", async () => {
    const child = spawn("bash", [hook], { stdio: ["pipe", "ignore", "ignore"], env: treeEnv() });
    const startedAt = Date.now();

    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(code).toBe(0);
    child.stdin.end();
  }, 15_000);
});

function findOnPath(name: string): string | null {
  for (const entry of (process.env["PATH"] ?? "").split(delimiter)) {
    if (entry && existsSync(join(entry, name))) return join(entry, name);
  }
  return null;
}

const tmuxBin = findOnPath("tmux");

describe.skipIf(process.platform !== "linux" || tmuxBin === null)(
  "SessionStart hook in a real tmux session (review r1 M-1)",
  () => {
    it("keeps the record of the launch's agent when a claude starts in a second window of the session", async () => {
      const bin = join(dir, "realbin");
      mkdirSync(bin);
      const socket = join(dir, "tmux.sock");
      writeFileSync(
        join(bin, "tmux"),
        `#!/bin/sh\nexec env -u TMUX ${shq(tmuxBin ?? "tmux")} -S ${shq(socket)} -f /dev/null "$@"\n`,
      );
      chmodSync(join(bin, "tmux"), 0o755);
      // A stand-in Claude Code: runs the workspace's hook with the
      // SessionStart JSON, marks that it is done, then stays (as an agent).
      writeFileSync(
        join(bin, "claude"),
        [
          "#!/bin/bash",
          'json=$(printf \'{"session_id":"%s","source":"startup","transcript_path":"%s"}\' "$1" "$2")',
          'bash .claude/ao-session-start.sh <<< "$json" > /dev/null 2>&1',
          'touch "$3"',
          "exec sleep 300",
          "",
        ].join("\n"),
      );
      chmodSync(join(bin, "claude"), 0o755);
      const workspace = join(dir, "ws");
      mkdirSync(join(workspace, ".claude"), { recursive: true });
      writeFileSync(join(workspace, ".claude", "ao-session-start.sh"), SESSION_START_SCRIPT, {
        mode: 0o755,
      });
      const transcripts = join(dir, "t");
      mkdirSync(transcripts);
      for (const id of [OUTER, OTHER]) writeFileSync(join(transcripts, `${id}.jsonl`), "{}\n");
      const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, TERM: "xterm-256color" };
      const tmux = (...args: string[]): string => {
        const result = spawnSync(join(bin, "tmux"), args, { encoding: "utf-8", env });
        if (result.status !== 0) throw new Error(`tmux ${args.join(" ")}: ${result.stderr}`);
        return result.stdout.trim();
      };

      try {
        // The launch: the tmux session environment has AO_SESSION and
        // AO_DATA_DIR (as runtime-tmux creates it); only the launch command
        // gives the token to its claude.
        const firstPane = tmux(
          "new-session",
          "-d",
          "-P",
          "-F",
          "#{pane_id}",
          "-s",
          "relaunch-m1",
          "-c",
          workspace,
          "-e",
          "AO_SESSION=app-1",
          "-e",
          `AO_DATA_DIR=${sessionsDir}`,
          `env AO_LAUNCH_TOKEN=${THIS_LAUNCH} claude ${OUTER} ${join(transcripts, `${OUTER}.jsonl`)} ${join(dir, "done-first")}`,
        );
        await vi.waitFor(() => expect(existsSync(join(dir, "done-first"))).toBe(true), {
          timeout: 8_000,
          interval: 50,
        });
        const first = recorded();
        expect(first).toMatchObject({
          conversationId: OUTER,
          launchToken: THIS_LAUNCH,
          paneId: firstPane,
        });

        // A claude that someone starts in a second window of the same session.
        const secondPane = tmux(
          "new-window",
          "-d",
          "-P",
          "-F",
          "#{pane_id}",
          "-t",
          "=relaunch-m1:",
          "-c",
          workspace,
          `claude ${OTHER} ${join(transcripts, `${OTHER}.jsonl`)} ${join(dir, "done-second")}`,
        );
        await vi.waitFor(() => expect(existsSync(join(dir, "done-second"))).toBe(true), {
          timeout: 8_000,
          interval: 50,
        });
        expect(tmux("show-environment", "-t", "=relaunch-m1", "AO_SESSION")).toBe(
          "AO_SESSION=app-1",
        );

        expect(recorded()).toEqual(first);
        const lookup = await create().getOwnConversationId!(sessionOf(join(dir, "ws")), {
          dataDir: sessionsDir,
          launchToken: THIS_LAUNCH,
          pane: { id: firstPane, tty: first?.["paneTty"] ?? "" },
        });
        expect(lookup.id).toBe(OUTER);
        const fromSecond = await create().getOwnConversationId!(sessionOf(join(dir, "ws")), {
          dataDir: sessionsDir,
          launchToken: THIS_LAUNCH,
          pane: { id: secondPane, tty: "/dev/null" },
        });
        expect(fromSecond.id).toBeNull();
      } finally {
        spawnSync(join(bin, "tmux"), ["kill-server"], { env, stdio: "ignore" });
      }
    }, 30_000);
  },
);

function sessionOf(workspace: string): Session {
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

describe("getOwnConversationId: only the ID that the agent of the last launch recorded", () => {
  const agent = create();
  const workspace = "/work/space-1";
  const pane = { id: "%1", tty: "/dev/pts/1" };
  const context = () => ({ dataDir: sessionsDir, launchToken: THIS_LAUNCH, pane });

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

  function writeRecord(fields: Record<string, string>): void {
    mkdirSync(join(sessionsDir, ".agent-conversations"), { recursive: true });
    writeFileSync(
      recordFile(),
      Object.entries({ launchToken: THIS_LAUNCH, paneId: "%1", ...fields })
        .filter(([, value]) => value !== "")
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  }

  it("returns the recorded ID even when a newer transcript of another conversation is in the folder", async () => {
    const own = writeTranscript(OUTER, 120_000);
    writeTranscript(NESTED, 1_000);
    writeRecord({
      agent: "claude-code",
      conversationId: OUTER,
      source: "clear",
      transcriptPath: own,
    });

    const lookup = await agent.getOwnConversationId!(sessionOf(workspace), context());

    expect(lookup.id).toBe(OUTER);
    expect(lookup.id === null ? "" : lookup.source).toMatch(
      /SessionStart hook record .*source clear, the token of the last launch, pane %1/,
    );
  });

  it("refuses when no conversation is recorded, though transcripts are in the folder", async () => {
    writeTranscript(OUTER, 1_000);

    const lookup = await agent.getOwnConversationId!(sessionOf(workspace), context());

    expect(lookup).toEqual({
      id: null,
      reason: expect.stringMatching(/no conversation of this session is recorded/),
    });
  });

  it("refuses a fresh record of an earlier launch: a fast reuse of the ID whose new hook did not run (review r1 M-4)", async () => {
    const own = writeTranscript(OUTER, 1_000);
    // Written a moment ago, after the new launch, but by the agent of the
    // launch before it (the hook of the new agent failed or did not run).
    writeRecord({
      agent: "claude-code",
      conversationId: OUTER,
      transcriptPath: own,
      launchToken: EARLIER_LAUNCH,
    });

    const lookup = await agent.getOwnConversationId!(sessionOf(workspace), context());

    expect(lookup).toEqual({
      id: null,
      reason: expect.stringMatching(/recorded by another launch than the session's last one/),
    });
  });

  it("refuses a record without a launch token (a hook of an older build)", async () => {
    const own = writeTranscript(OUTER, 1_000);
    writeRecord({
      agent: "claude-code",
      conversationId: OUTER,
      transcriptPath: own,
      launchToken: "",
    });

    const lookup = await agent.getOwnConversationId!(sessionOf(workspace), context());

    expect(lookup.id).toBeNull();
  });

  it("refuses a record from another tmux pane", async () => {
    const own = writeTranscript(OUTER, 1_000);
    writeRecord({ agent: "claude-code", conversationId: OUTER, transcriptPath: own, paneId: "%9" });

    const lookup = await agent.getOwnConversationId!(sessionOf(workspace), context());

    expect(lookup).toEqual({
      id: null,
      reason: expect.stringMatching(/recorded in tmux pane %9, not in the session's pane %1/),
    });
  });

  it("refuses a record of another agent or with an ID that is not a UUID", async () => {
    writeTranscript(OUTER, 1_000);
    writeRecord({ agent: "codex", conversationId: OUTER });
    const other = await agent.getOwnConversationId!(sessionOf(workspace), context());
    writeRecord({ agent: "claude-code", conversationId: "latest" });
    const malformed = await agent.getOwnConversationId!(sessionOf(workspace), context());

    expect(other.id).toBeNull();
    expect(malformed.id).toBeNull();
  });

  it("refuses when the recorded conversation has no transcript", async () => {
    writeTranscript(NESTED, 1_000);
    writeRecord({ agent: "claude-code", conversationId: OUTER, transcriptPath: "" });

    const lookup = await agent.getOwnConversationId!(sessionOf(workspace), context());

    expect(lookup).toEqual({ id: null, reason: expect.stringMatching(/has no transcript/) });
  });

  it("finds the transcript in the workspace's Claude project folder when no usable path is recorded", async () => {
    writeTranscript(OUTER, 1_000);
    writeRecord({
      agent: "claude-code",
      conversationId: OUTER,
      transcriptPath: "/elsewhere/another.jsonl",
    });

    const lookup = await agent.getOwnConversationId!(sessionOf(workspace), context());

    expect(lookup.id).toBe(OUTER);
  });
});

describe("getLaunchCommand: the launch token, and --resume <id> for --continue", () => {
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
    const spawned = agent.getLaunchCommand(base);
    const relaunch = agent.getLaunchCommand({ ...base, continueConversationId: OUTER });

    expect(relaunch).toBe(`${spawned} --resume '${OUTER}'`);
    expect(spawned).toBe(
      `claude --dangerously-skip-permissions --model 'opus' --append-system-prompt "$(cat '/prompts/orchestrator-prompt-app-orchestrator.md')"`,
    );
  });

  it("has no --resume without a conversation ID", () => {
    expect(agent.getLaunchCommand(base)).not.toContain("--resume");
  });

  it("gives the launch token to the claude process alone, with env in front, not to the environment", () => {
    const withToken = agent.getLaunchCommand({ ...base, launchToken: THIS_LAUNCH });

    expect(withToken).toBe(`env AO_LAUNCH_TOKEN='${THIS_LAUNCH}' ${agent.getLaunchCommand(base)}`);
    expect(agent.getEnvironment({ ...base, launchToken: THIS_LAUNCH })).not.toHaveProperty(
      "AO_LAUNCH_TOKEN",
    );
  });
});

describe("setupWorkspaceHooks: the SessionStart hook", () => {
  const agent = create();
  const entry = {
    hooks: [{ type: "command", command: ".claude/ao-session-start.sh", timeout: 5, async: true }],
  };

  function settingsOf(workspace: string): {
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
  } {
    return JSON.parse(readFileSync(join(workspace, ".claude", "settings.json"), "utf-8"));
  }

  it("installs the script and one async SessionStart entry next to the PostToolUse entry", async () => {
    const workspace = join(dir, "ws");
    mkdirSync(workspace);

    await agent.setupWorkspaceHooks!(workspace, { dataDir: sessionsDir });

    const script = join(workspace, ".claude", "ao-session-start.sh");
    expect(readFileSync(script, "utf-8")).toBe(SESSION_START_SCRIPT);
    expect(statSync(script).mode & 0o777).toBe(0o755);
    const settings = settingsOf(workspace);
    expect(settings.hooks["SessionStart"]).toEqual([entry]);
    expect(settings.hooks["PostToolUse"][0].hooks[0]["command"]).toBe(
      ".claude/metadata-updater.sh",
    );
  });

  it("keeps other SessionStart entries, adds no second AO entry, and makes an older AO entry async", async () => {
    const workspace = join(dir, "ws");
    mkdirSync(join(workspace, ".claude"), { recursive: true });
    const own = { matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] };
    const older = {
      hooks: [{ type: "command", command: ".claude/ao-session-start.sh", timeout: 10 }],
    };
    writeFileSync(
      join(workspace, ".claude", "settings.json"),
      JSON.stringify({ hooks: { SessionStart: [own, older] } }),
    );

    await agent.setupWorkspaceHooks!(workspace, { dataDir: sessionsDir });
    await agent.setupWorkspaceHooks!(workspace, { dataDir: sessionsDir });

    expect(settingsOf(workspace).hooks["SessionStart"]).toEqual([own, entry]);
  });
});
