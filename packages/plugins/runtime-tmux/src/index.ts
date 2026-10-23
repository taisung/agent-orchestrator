import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PluginModule,
  type Runtime,
  type RuntimeCreateConfig,
  type RuntimeHandle,
  type RuntimeMetrics,
  type RuntimePaneState,
  type AttachInfo,
  shellEscape,
  exactPaneTarget,
  agentPaneTarget,
  exactSessionTarget,
  RUNTIME_NO_SERVER_ERROR_CODE,
} from "@aoagents/ao-core";

const execFileAsync = promisify(execFile);
const TMUX_COMMAND_TIMEOUT_MS = 5_000;

export const manifest = {
  name: "tmux",
  slot: "runtime" as const,
  description: "Runtime plugin: tmux sessions",
  version: "0.1.0",
};

/** Only allow safe characters in session IDs */
const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]+$/;

function assertValidSessionId(id: string): void {
  if (!SAFE_SESSION_ID.test(id)) {
    throw new Error(`Invalid session ID "${id}": must match ${SAFE_SESSION_ID}`);
  }
}

function writeLaunchScript(command: string): string {
  const scriptPath = join(tmpdir(), `ao-launch-${randomUUID()}.sh`);
  const content = `#!/usr/bin/env bash\nrm -- "$0" 2>/dev/null || true\n${command}\n`;
  writeFileSync(scriptPath, content, { encoding: "utf-8", mode: 0o700 });
  return `bash ${shellEscape(scriptPath)}`;
}

/**
 * tmux 3.4 answers that a target does not exist with "can't find session: X"
 * (has-session), "can't find window: X" (list-panes on a missing session) or
 * "can't find pane: X", and with "no current target" when its server runs
 * with no session at all (`exit-empty off`). Only these mean "gone"; any
 * other failure is unknown.
 */
const TMUX_TARGET_NOT_FOUND = /^(?:can't find (?:session|window|pane): |no current target$)/m;

/** tmux could not reach a server: a stale socket, or no socket file at all. */
const TMUX_NO_SERVER =
  /^(?:no server running on |error connecting to .* \(No such file or directory\)$)/m;

/** A tmux probe that could not tell whether the session exists. */
export class TmuxProbeError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "TmuxProbeError";
    this.code = code;
  }
}

function tmuxStderr(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err && typeof err.stderr === "string") {
    return err.stderr;
  }
  return "";
}

/** True when tmux answered that the target session, window or pane does not exist. */
function isTmuxTargetNotFound(err: unknown): boolean {
  return TMUX_TARGET_NOT_FOUND.test(tmuxStderr(err));
}

/** Wrap a failed tmux probe; the code tells "no server at all" from other failures. */
function tmuxProbeError(command: string, err: unknown): TmuxProbeError {
  const stderr = tmuxStderr(err).trim();
  const timedOut = !!err && typeof err === "object" && "killed" in err && err.killed === true;
  const detail = timedOut
    ? `timed out after ${TMUX_COMMAND_TIMEOUT_MS} ms`
    : stderr || (err instanceof Error ? err.message : String(err));
  const code = TMUX_NO_SERVER.test(stderr) ? RUNTIME_NO_SERVER_ERROR_CODE : "ERR_RUNTIME_PROBE";
  return new TmuxProbeError(`tmux ${command} could not answer: ${detail}`, code, { cause: err });
}

/** A tmux pane ID, for example `%4`. */
const PANE_ID = /^%\d+$/;

/**
 * The fields of `listPanes`, one pane per line, separated by spaces (tmux
 * 3.4 prints a tab in a format as "_"). Only the last field, the foreground
 * command, can hold a space.
 */
const PANE_LIST_FORMAT = "#{pane_id} #{pane_tty} #{pane_pid} #{pane_current_command}";

/** How long `runInPane` waits after C-c, so the shell shows its new prompt first. */
const RUN_IN_PANE_CLEAR_MS = 300;

/** How long `runInPane` waits in all for the evidence of an empty prompt after a C-c. */
const RUN_IN_PANE_EVIDENCE_MS = 1_500;

/** How often `runInPane` reads the pane again while it waits for that evidence. */
const RUN_IN_PANE_POLL_MS = 100;

/** The cursor and screen fields of a pane snapshot, before the screen rows. */
const SNAPSHOT_FORMAT =
  "#{cursor_x} #{cursor_y} #{history_size} #{history_limit} #{pane_height} #{pane_in_mode} #{alternate_on}";

/** One read of a pane: its cursor, its history counters and its visible rows. */
export interface PaneSnapshot {
  cursorX: number;
  cursorY: number;
  historySize: number;
  historyLimit: number;
  /** Not in copy mode or another mode, and not on the alternate screen. */
  plain: boolean;
  /** The visible rows, exactly `pane_height` of them, trailing spaces removed. */
  rows: string[];
}

/**
 * The answer of `display-message -p SNAPSHOT_FORMAT ; capture-pane -p` for
 * one pane (one tmux call, so the cursor and the rows are of one moment),
 * or null when it is not one.
 */
export function parsePaneSnapshot(answer: string): PaneSnapshot | null {
  const [head = "", ...screen] = answer.split("\n");
  const match = /^(\d+) (\d+) (\d+) (\d+) ([1-9]\d*) ([01]) ([01])$/.exec(head);
  if (!match) return null;
  const [, x, y, size, limit, height, inMode, alternate] = match.map(Number);
  if (y >= height || screen.length > height) return null;
  const rows = Array.from({ length: height }, (_, i) => (screen[i] ?? "").trimEnd());
  return {
    cursorX: x,
    cursorY: y,
    historySize: size,
    historyLimit: limit,
    plain: inMode === 0 && alternate === 0,
    rows,
  };
}

/** The text of a row up to the cursor column (the row padded with spaces). */
function textBeforeCursor(row: string, cursorX: number): string {
  return row.padEnd(cursorX).slice(0, cursorX);
}

/**
 * Why `snap` is not an empty prompt line, or null when it is one: the text
 * before the cursor is not blank (the prompt), nothing follows the cursor
 * on its row, and the rows below the cursor are empty.
 */
export function emptyPromptProblem(snap: PaneSnapshot): string | null {
  if (!snap.plain) return "the pane is in a mode or on the alternate screen";
  const row = snap.rows[snap.cursorY] ?? "";
  if (!textBeforeCursor(row, snap.cursorX).trim()) return "no prompt before the cursor";
  if (row.slice(snap.cursorX).trim()) return "text after the cursor";
  if (snap.rows.slice(snap.cursorY + 1).some((r) => r.trim())) return "text below the cursor";
  return null;
}

/**
 * Review r2 M-2: the evidence that a C-c gave the shell a fresh, empty input
 * line. `a` is the pane after a first C-c (an empty prompt line), `b` after
 * a second one. A shell that discards its input on C-c echoes `^C` (unless
 * `echo-control-characters` is off) at the end of the prompt of `a` and
 * shows the same prompt on a later row, with nothing after the cursor. A
 * shell that ignores SIGINT leaves the screen as it is; a SIGINT trap that
 * reads input shows no prompt. Returns null for that evidence, else what is
 * missing. The rows that `a` had above its cursor must be the rows above
 * that prompt in `b`, scrolled by the lines that the history gained; when
 * the history is full (its size stays at its limit) every scroll that keeps
 * those rows equal is tried, and exactly one must give the evidence.
 */
export function freshPromptProblem(a: PaneSnapshot, b: PaneSnapshot): string | null {
  const before = emptyPromptProblem(a);
  if (before) return `after the first C-c: ${before}`;
  const after = emptyPromptProblem(b);
  if (after) return `after the second C-c: ${after}`;
  if (b.rows.length !== a.rows.length) return "the pane changed its size";
  const unchanged =
    a.cursorX === b.cursorX &&
    a.cursorY === b.cursorY &&
    a.historySize === b.historySize &&
    a.rows.every((row, i) => row === b.rows[i]);
  if (unchanged) return "the second C-c changed nothing (the shell may ignore SIGINT)";
  if (b.historySize < a.historySize) return "the history of the pane was cleared";
  const prompt = textBeforeCursor(a.rows[a.cursorY] ?? "", a.cursorX);
  const minShift = b.historySize - a.historySize;
  const maxShift = b.historySize < b.historyLimit ? minShift : a.cursorY;
  let passing = 0;
  for (let shift = minShift; shift <= maxShift; shift++) {
    const echoRow = a.cursorY - shift;
    if (echoRow < 0) break;
    // The rows above the prompt of `a`, scrolled by `shift`.
    let same = true;
    for (let i = 0; i < echoRow && same; i++) same = b.rows[i] === a.rows[i + shift];
    if (!same || b.cursorY <= echoRow) continue;
    // The prompt of `a` with the echo of the second C-c, or without it.
    const echo = (b.rows[echoRow] ?? "").trimEnd();
    if (echo !== `${prompt}^C`.trimEnd() && echo !== prompt.trimEnd()) continue;
    // The upper lines of a prompt of several lines repeat those of `a`.
    const upper = b.cursorY - echoRow - 1;
    if (upper > a.cursorY) continue;
    let repeated = true;
    for (let j = 0; j < upper && repeated; j++) {
      repeated = b.rows[echoRow + 1 + j] === a.rows[a.cursorY - upper + j];
    }
    if (!repeated) continue;
    if (
      b.cursorX !== a.cursorX ||
      textBeforeCursor(b.rows[b.cursorY] ?? "", b.cursorX) !== prompt
    ) {
      continue;
    }
    passing++;
  }
  if (passing === 1) return null;
  return passing === 0
    ? "no new prompt line after the second C-c"
    : "more than one way to read the scrolled screen";
}

interface ParsedPane {
  paneId: string;
  tty: string;
  pid: number;
  foregroundCommand: string;
}

/** One line of PANE_LIST_FORMAT, or null when it is not one. */
function parsePaneLine(line: string): ParsedPane | null {
  const match = /^(\S+) (\S+) (\S+) (.*)$/.exec(line);
  const [, paneId = "", tty = "", pid = "", rawCommand = ""] = match ?? [];
  const foregroundCommand = rawCommand.trim();
  if (
    !match ||
    !PANE_ID.test(paneId) ||
    !/^\/dev\/\S+$/.test(tty) ||
    !/^[1-9]\d*$/.test(pid) ||
    !foregroundCommand
  ) {
    return null;
  }
  return { paneId, tty, pid: Number(pid), foregroundCommand };
}

/**
 * Session relaunch: true when the process group of the pane's shell `pid` is
 * the foreground process group of its terminal (no job runs, so the shell
 * reads the next input line), false when another group is in the
 * foreground, null when /proc cannot tell (no Linux /proc, or the process
 * ended). Fields 5 and 8 of /proc/<pid>/stat: pgrp and tpgid.
 */
function shellWaitsForInput(pid: number): boolean | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
  } catch {
    return null;
  }
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const pgrp = Number(fields[2]);
  const tpgid = Number(fields[5]);
  if (!Number.isInteger(pgrp) || !Number.isInteger(tpgid) || tpgid <= 0) return null;
  return pgrp === tpgid;
}

/** Run a tmux command and return stdout */
async function tmux(...args: string[]): Promise<string> {
  return runTmux(args);
}

/** Run a tmux command with an optional client environment and return stdout */
async function runTmux(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync("tmux", args, {
    timeout: TMUX_COMMAND_TIMEOUT_MS,
    ...(env && { env }),
  });
  return stdout.trimEnd();
}

export function create(): Runtime {
  return {
    name: "tmux",

    async create(config: RuntimeCreateConfig): Promise<RuntimeHandle> {
      assertValidSessionId(config.sessionId);
      const sessionName = config.sessionId;

      // Build environment flags: -e KEY=VALUE for each env var
      const envArgs: string[] = [];
      for (const [key, value] of Object.entries(config.environment ?? {})) {
        envArgs.push("-e", `${key}=${value}`);
      }

      // Create tmux session in detached mode.
      // tmux 3.4 gives a new pane the PATH of the client that runs
      // `new-session` when that client is not attached (spawn.c: "only
      // unattached clients"), not the `-e PATH` value. So the client runs with
      // the built PATH, and the pane's login shell then applies its startup
      // files on top of it. `-e PATH` stays, so the session environment
      // (`show-environment`) still holds it. Node also looks up the tmux
      // binary with this PATH.
      const panePath = config.environment?.["PATH"];
      await runTmux(
        ["new-session", "-d", "-s", sessionName, "-c", config.workspacePath, ...envArgs],
        panePath ? { ...process.env, PATH: panePath } : undefined,
      );

      // Send the launch command — clean up the session if this fails.
      // Use a temp script for long commands so the pane shows a short
      // invocation instead of a pasted wall of shell. Exact targets: if the
      // new session ends first, a plain target would reach another session
      // whose name starts with this one.
      const pane = exactPaneTarget(sessionName);
      try {
        if (config.launchCommand.length > 200) {
          const invocation = writeLaunchScript(config.launchCommand);
          await tmux("send-keys", "-t", pane, "-l", invocation);
          await sleep(300);
          await tmux("send-keys", "-t", pane, "Enter");
        } else {
          await tmux("send-keys", "-t", pane, config.launchCommand, "Enter");
        }
      } catch (err: unknown) {
        try {
          await tmux("kill-session", "-t", exactSessionTarget(sessionName));
        } catch {
          // Best-effort cleanup
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to send launch command to session "${sessionName}": ${msg}`, {
          cause: err,
        });
      }

      return {
        id: sessionName,
        runtimeName: "tmux",
        data: {
          createdAt: Date.now(),
          workspacePath: config.workspacePath,
        },
      };
    },

    /**
     * Resolves when tmux killed the session or answered that it does not
     * exist. Every other failure (no server, a timeout, an unknown error)
     * rejects with the failure as `cause` (same-ID R2a): core `stopRuntime`
     * then asks `isAlive`, and a caller goes on only after a confirmed stop.
     */
    async destroy(handle: RuntimeHandle): Promise<void> {
      const target = exactSessionTarget(handle.id);
      try {
        await tmux("kill-session", "-t", target);
      } catch (err: unknown) {
        if (isTmuxTargetNotFound(err)) return;
        throw tmuxProbeError(`kill-session -t ${target}`, err);
      }
    },

    async sendMessage(handle: RuntimeHandle, message: string): Promise<void> {
      // The agent's pane when core names it (review r2 M-1), else the
      // session's current pane.
      const pane = agentPaneTarget(handle);
      // Clear any partial input
      await tmux("send-keys", "-t", pane, "C-u");

      // For long or multiline messages, use load-buffer + paste-buffer
      // Use randomUUID to avoid temp file collisions on concurrent sends
      if (message.includes("\n") || message.length > 200) {
        const bufferName = `ao-${randomUUID()}`;
        const tmpPath = join(tmpdir(), `ao-send-${randomUUID()}.txt`);
        writeFileSync(tmpPath, message, { encoding: "utf-8", mode: 0o600 });
        try {
          await tmux("load-buffer", "-b", bufferName, tmpPath);
          await tmux("paste-buffer", "-b", bufferName, "-t", pane, "-d");
        } finally {
          // Clean up temp file and tmux buffer (in case paste-buffer failed
          // and the -d flag didn't delete it)
          try {
            unlinkSync(tmpPath);
          } catch {
            // ignore cleanup errors
          }
          try {
            await tmux("delete-buffer", "-b", bufferName);
          } catch {
            // Buffer may already be deleted by -d flag — that's fine
          }
        }
      } else {
        // Use -l (literal) so text like "Enter" or "Space" isn't interpreted
        // as tmux key names
        await tmux("send-keys", "-t", pane, "-l", message);
      }

      // Small delay to let tmux process the pasted text before pressing Enter.
      // Without this, Enter can arrive before the text is fully rendered.
      await sleep(300);
      await tmux("send-keys", "-t", pane, "Enter");
    },

    async getOutput(handle: RuntimeHandle, lines = 50): Promise<string> {
      try {
        return await tmux("capture-pane", "-t", agentPaneTarget(handle), "-p", "-S", `-${lines}`);
      } catch {
        return "";
      }
    },

    async isAlive(handle: RuntimeHandle): Promise<boolean> {
      const target = exactSessionTarget(handle.id);
      try {
        await tmux("has-session", "-t", target);
        return true;
      } catch (err: unknown) {
        // Only tmux's own "not found" answer is dead. An unreachable server, a
        // timeout or any other failure rejects: callers keep the session.
        if (isTmuxTargetNotFound(err)) return false;
        throw tmuxProbeError(`has-session -t ${target}`, err);
      }
    },

    async getMetrics(handle: RuntimeHandle): Promise<RuntimeMetrics> {
      // The age of the tmux session itself, so a new session under an old
      // name shows its own age (the lifecycle compares it with the handle's
      // createdAt). `list-sessions` and an exact name: a `-t` target also
      // matches a session whose name only starts with this one. The number
      // comes first (tmux prints a tab in a format as "_").
      const listed = await tmux("list-sessions", "-F", "#{session_created} #{session_name}").catch(
        (err: unknown) => {
          throw tmuxProbeError("list-sessions", err);
        },
      );
      for (const line of listed.split("\n")) {
        const space = line.indexOf(" ");
        const seconds = Number.parseInt(line.slice(0, space), 10);
        if (space > 0 && line.slice(space + 1) === handle.id && Number.isFinite(seconds)) {
          return { uptimeMs: Math.max(0, Date.now() - seconds * 1000) };
        }
      }
      throw new Error(`tmux session ${handle.id} not found`);
    },

    async getAttachInfo(handle: RuntimeHandle): Promise<AttachInfo> {
      const target = exactSessionTarget(handle.id);
      return {
        type: "tmux",
        target,
        // Quoted: zsh expands a word that starts with "=" to a command path.
        command: `tmux attach -t ${shellEscape(target)}`,
      };
    },

    /**
     * Session relaunch (2026-10-22): every pane of the session, in every
     * window (`list-panes -s`), with its pane ID, its TTY, its foreground
     * command, and whether its own shell waits for input (`shellIdle`, from
     * the shell's /proc stat). Null only for tmux's own "not found" answer.
     * Any other failure, or an answer that is not a list of panes, rejects.
     */
    async listPanes(handle: RuntimeHandle): Promise<RuntimePaneState[] | null> {
      const target = exactSessionTarget(handle.id);
      let answer: string;
      try {
        answer = await tmux("list-panes", "-s", "-t", target, "-F", PANE_LIST_FORMAT);
      } catch (err: unknown) {
        if (isTmuxTargetNotFound(err)) return null;
        throw tmuxProbeError(`list-panes -s -t ${target}`, err);
      }
      const panes = answer.split("\n").map(parsePaneLine);
      if (answer === "" || panes.some((pane) => pane === null)) {
        throw new TmuxProbeError(
          `tmux list-panes -s -t ${target} answered ${JSON.stringify(answer.slice(0, 120))}, not a list of panes`,
          "ERR_RUNTIME_PROBE",
          { cause: undefined },
        );
      }
      return panes.map((pane) => {
        const { pid, ...state } = pane as ParsedPane;
        return { ...state, shellIdle: shellWaitsForInput(pid) };
      });
    },

    /**
     * Session relaunch (2026-10-22): type `command` and Enter into the shell
     * of pane `paneId`. Every tmux call targets that pane ID, so a change of
     * the active window or pane cannot redirect the text. First it checks
     * that the pane still belongs to the session and that its own shell
     * still waits for input. Then it ends any mode of the pane (copy mode)
     * and sends C-c: the shell drops the whole input line, wherever the
     * cursor is, and also a continuation (PS2) input, and shows a new
     * prompt. Then it types the text literally, waits 300 ms, and sends
     * Enter. The owner's half-typed text is dropped, never run.
     */
    async runInPane(handle: RuntimeHandle, paneId: string, command: string): Promise<void> {
      if (!PANE_ID.test(paneId)) {
        throw new Error(`Invalid tmux pane ID ${JSON.stringify(paneId)}`);
      }
      let answer: string;
      try {
        answer = await tmux("display-message", "-p", "-t", paneId, "#{session_name} #{pane_pid}");
      } catch (err: unknown) {
        throw new Error(`Failed to read tmux pane ${paneId}`, { cause: err });
      }
      const [sessionName, pid] = answer.split(" ");
      if (sessionName !== handle.id) {
        throw new Error(
          `tmux pane ${paneId} belongs to ${JSON.stringify(sessionName ?? "")}, not to session ${handle.id}`,
        );
      }
      if (shellWaitsForInput(Number(pid)) !== true) {
        throw new Error(`The shell of tmux pane ${paneId} does not wait for input now`);
      }
      // Review r2 M-2: C-c clears the input line only in a shell that does
      // not ignore or trap SIGINT, and the foreground check above does not
      // show that. So a second C-c must show a fresh prompt line (see
      // freshPromptProblem) before any text is typed; else nothing is typed.
      const snapshot = async (): Promise<PaneSnapshot> => {
        let answer: string;
        try {
          answer = await tmux(
            "display-message",
            "-p",
            "-t",
            paneId,
            SNAPSHOT_FORMAT,
            ";",
            "capture-pane",
            "-p",
            "-t",
            paneId,
          );
        } catch (err: unknown) {
          throw new Error(`Failed to read tmux pane ${paneId}`, { cause: err });
        }
        const snap = parsePaneSnapshot(answer);
        if (!snap) {
          throw new Error(
            `tmux answered ${JSON.stringify(answer.slice(0, 80))} for pane ${paneId}, not a cursor and a screen`,
          );
        }
        return snap;
      };
      /** Read the pane until `problem` gives none, or the evidence time ends. */
      const settled = async (
        problem: (snap: PaneSnapshot) => string | null,
      ): Promise<{ snap: PaneSnapshot; problem: string | null }> => {
        const end = Date.now() + RUN_IN_PANE_EVIDENCE_MS;
        await sleep(RUN_IN_PANE_CLEAR_MS);
        for (;;) {
          const snap = await snapshot();
          const found = problem(snap);
          if (!found || Date.now() >= end) return { snap, problem: found };
          await sleep(RUN_IN_PANE_POLL_MS);
        }
      };
      const refuse = (problem: string): never => {
        throw new Error(
          `The shell of tmux pane ${paneId} did not show a fresh, empty prompt line after C-c (${problem}), so nothing was typed. It may ignore or trap SIGINT. Clear its input line by hand, or start the program there by hand`,
        );
      };
      const keys = async (...args: string[]): Promise<void> => {
        try {
          await tmux("send-keys", "-t", paneId, ...args);
        } catch (err: unknown) {
          throw new Error(`Failed to type the command into tmux pane ${paneId}`, { cause: err });
        }
      };
      try {
        await tmux("copy-mode", "-q", "-t", paneId);
      } catch (err: unknown) {
        throw new Error(`Failed to type the command into tmux pane ${paneId}`, { cause: err });
      }
      await keys("C-c");
      const first = await settled(emptyPromptProblem);
      if (first.problem) refuse(`after the first C-c: ${first.problem}`);
      await keys("C-c");
      const second = await settled((snap) => freshPromptProblem(first.snap, snap));
      if (second.problem) refuse(second.problem);
      await keys("-l", command);
      await sleep(300);
      await keys("Enter");
    },
  };
}

export default { manifest, create } satisfies PluginModule<Runtime>;
