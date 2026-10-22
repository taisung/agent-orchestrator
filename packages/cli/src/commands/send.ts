import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import {
  type Agent,
  type AgentMessageDelivery,
  type OpenCodeSessionManager,
  type Session,
  type SessionManager,
  type SessionMessageDelivery,
  exactPaneTarget,
  exactSessionTarget,
  loadConfig,
} from "@aoagents/ao-core";
import { readCodexScreen, type CodexComposer } from "@aoagents/ao-plugin-agent-codex";
import { exec, tmux } from "../lib/shell.js";
import { getAgentByName, getAgentByNameFromRegistry } from "../lib/plugins.js";
import { getPluginRegistry, getSessionManager } from "../lib/create-session-manager.js";

/**
 * Resolve session context: tmux target name and Agent plugin.
 * Loads config and looks up the session once, avoiding duplicate work.
 */
async function resolveSessionContext(sessionName: string): Promise<{
  tmuxTarget: string;
  runtimeName?: string;
  agent: Agent;
  session: Session | null;
  sessionManager: OpenCodeSessionManager | null;
}> {
  try {
    const config = loadConfig();
    const registry = await getPluginRegistry(config);
    const sm = await getSessionManager(config);
    const session = await sm.get(sessionName);
    if (session) {
      const tmuxTarget = session.runtimeHandle?.id ?? sessionName;
      const project = config.projects[session.projectId];
      const agentName = session.metadata["agent"] ?? project?.agent ?? config.defaults.agent;
      const runtimeName =
        session.runtimeHandle?.runtimeName ?? project?.runtime ?? config.defaults.runtime;
      return {
        tmuxTarget,
        runtimeName,
        agent: getAgentByNameFromRegistry(registry, agentName),
        session,
        sessionManager: sm,
      };
    }
  } catch {
    // No config or session not found — fall back to defaults
  }
  return {
    tmuxTarget: sessionName,
    runtimeName: "tmux",
    agent: getAgentByName("claude-code"),
    session: null,
    sessionManager: null,
  };
}

function isActive(agent: Agent, terminalOutput: string): boolean {
  return agent.detectActivity(terminalOutput) === "active";
}

function hasQueuedMessage(terminalOutput: string): boolean {
  return terminalOutput.includes("Press up to edit queued messages");
}

function hasUnsubmittedCodexInput(terminalOutput: string): boolean {
  const lines = terminalOutput.trimEnd().split("\n");
  const tail = lines.slice(-8).join("\n");

  // Codex's UI can accept a paste but miss the trailing Enter while the screen is
  // redrawing. In that case the input box shows either the literal message or a
  // "[Pasted Content ...]" placeholder next to the Codex prompt, and the footer
  // says "tab to queue message". This is not "delivered" yet; one extra Enter is
  // the safe recovery.
  return (
    /tab to queue message/i.test(tail) &&
    /(?:^|\n)\s*[›❯]\s+(?:\[Pasted Content\b|\S)/.test(tail)
  );
}

/**
 * True when the Codex composer shows this message: Codex shows a long paste
 * as "[Pasted Content ...]", and otherwise the first composer row starts the
 * message (whitespace collapsed, because the composer wraps it). This only
 * chooses the words of the report. The command sends no key to a Codex pane
 * after the message, and text that another sender typed can match too.
 */
function composerShowsMessage(composer: CodexComposer | null, message: string): boolean {
  if (composer === null || composer.empty) return false;
  if (/^\[Pasted Content\b/.test(composer.firstLine)) return true;
  const shown = composer.firstLine.replace(/\s+/g, " ");
  return message.replace(/\s+/g, " ").trim().startsWith(shown);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readMessageInput(opts: { file?: string }, messageParts: string[]): Promise<string> {
  const inlineMessage = messageParts.join(" ");
  if (!opts.file && !inlineMessage) {
    console.error(chalk.red("No message provided"));
    process.exit(1);
  }

  if (!opts.file) {
    return inlineMessage;
  }

  try {
    return readFileSync(opts.file, "utf-8");
  } catch (err) {
    console.error(chalk.red(`Cannot read file: ${opts.file} (${err})`));
    process.exit(1);
  }
}

/**
 * The exact tmux targets of a session name, or null for a name that AO never
 * gives a tmux session (so no such session exists). tmux 3.4 matches a plain
 * `-t` target by prefix: a send to a dead `kr-1` would type into a live `kr-10`.
 */
function exactTmuxTargets(name: string): { session: string; pane: string } | null {
  try {
    return { session: exactSessionTarget(name), pane: exactPaneTarget(name) };
  } catch {
    return null;
  }
}

async function sendViaTmux(pane: string, message: string): Promise<void> {
  await exec("tmux", ["send-keys", "-t", pane, "C-u"]);
  await sleep(200);

  if (message.includes("\n") || message.length > 200) {
    const tmpFile = join(tmpdir(), `ao-send-${Date.now()}.txt`);
    writeFileSync(tmpFile, message);
    try {
      await exec("tmux", ["load-buffer", tmpFile]);
      // -p: a pane whose program asked for bracketed paste (Claude Code,
      // Codex and Gemini all do) gets the text inside the paste markers, as
      // from a terminal paste, so no line break in it acts as an Enter and
      // the Enter below follows a finished paste. Other panes get the same
      // bytes as without -p.
      await exec("tmux", ["paste-buffer", "-p", "-t", pane]);
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {
        // ignore cleanup failure
      }
    }
  } else {
    await exec("tmux", ["send-keys", "-t", pane, "-l", message]);
  }

  await sleep(300);
  await exec("tmux", ["send-keys", "-t", pane, "Enter"]);
}

/** The line about pending human answers, or null when there are none. */
function pendingInputLine(delivery: AgentMessageDelivery): string | null {
  const waitsFor = delivery.waitsFor ?? [];
  const names = [
    ...(waitsFor.includes("permission") ? ["permission request"] : []),
    ...(waitsFor.includes("question") ? ["question"] : []),
  ];
  if (names.length === 0) return null;
  return `The message waits behind a pending ${names.join(" and a pending ")}: it runs after a human answers.`;
}

/**
 * I-5: deliver through core `send`, which hands the message to the agent's
 * own API (OpenCode: `session.prompt`, delivery `queue`). There is no idle
 * wait, no tmux paste, no Enter and no screen check: the response is the
 * admitted input. Exit 1 when the send fails.
 */
async function sendThroughAgent(
  sessionName: string,
  message: string,
  sessionManager: SessionManager,
): Promise<void> {
  let result: SessionMessageDelivery | undefined;
  try {
    if (sessionManager.deliver) {
      result = await sessionManager.deliver(sessionName, message);
    } else {
      await sessionManager.send(sessionName, message);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Message not sent to ${sessionName}: ${detail}`));
    process.exit(1);
  }

  if (!result || result.route === "runtime") {
    console.log(chalk.green("Message sent and processing"));
    return;
  }
  const delivery = result.delivery;
  console.log(
    chalk.green(
      `Message admitted to ${sessionName} (input ${delivery.inputId}, delivery ${delivery.mode})`,
    ),
  );
  if (delivery.recovered) {
    console.log(
      chalk.dim("The admission answer was lost; a read-back of the session found the message."),
    );
  }
  if (delivery.replayed) {
    console.log(
      chalk.dim(
        `An earlier attempt of this send already admitted input ${delivery.inputId}; nothing new was admitted.`,
      ),
    );
  }
  if (result.admissionUnrecorded) {
    console.log(
      chalk.yellow(
        `The delivery ledger could not record that input ${delivery.inputId} was admitted: a send of the same text to ${sessionName} in the next 10 min can reuse that ID and admit nothing new.`,
      ),
    );
  }
  if (delivery.busy) {
    console.log(
      chalk.dim(`${sessionName} is running a turn: the message goes in after its last answer.`),
    );
  }
  const pending = pendingInputLine(delivery);
  if (pending) console.log(chalk.yellow(pending));
}

export function registerSend(program: Command): void {
  program
    .command("send")
    .description(
      "Send a message to a session with busy detection and retry; an OpenCode session with a stored session ID gets it through the OpenCode API (session.prompt, delivery queue)",
    )
    .argument("<session>", "Session name")
    .argument("[message...]", "Message to send")
    .option("-f, --file <path>", "Send contents of a file instead")
    .option(
      "--no-wait",
      "Don't wait for session to become idle before sending (no effect for an OpenCode session with a stored session ID: the API queues the message)",
    )
    .option(
      "--timeout <seconds>",
      "Max seconds to wait for idle (no effect for an OpenCode session with a stored session ID)",
      "600",
    )
    .action(
      async (
        session: string,
        messageParts: string[],
        opts: { file?: string; wait?: boolean; timeout?: string },
      ) => {
        // Resolve session context once: tmux target, agent plugin, session data
        const {
          tmuxTarget,
          runtimeName,
          agent,
          session: existingSession,
          sessionManager,
        } = await resolveSessionContext(session);

        const message = await readMessageInput(opts, messageParts);

        // I-5: an agent that delivers through its own API (OpenCode with a
        // stored session ID) gets the message from core `send`. The API
        // queues a message for a busy session (0010 section 7), so
        // --no-wait and --timeout have no effect on this path.
        if (
          existingSession &&
          sessionManager &&
          agent.deliverMessage &&
          agent.canDeliverMessage?.(existingSession) === true
        ) {
          await sendThroughAgent(session, message, sessionManager);
          return;
        }

        const parsedTimeout = parseInt(opts.timeout || "600", 10);
        const timeoutMs = (isNaN(parsedTimeout) || parsedTimeout <= 0 ? 600 : parsedTimeout) * 1000;

        const canUseTmux = runtimeName === "tmux";
        const targets = canUseTmux ? exactTmuxTargets(tmuxTarget) : null;

        let tmuxSessionAlive = true;
        if (canUseTmux) {
          const exists = targets ? await tmux("has-session", "-t", targets.session) : null;
          tmuxSessionAlive = exists !== null;
          if (!tmuxSessionAlive && !existingSession) {
            console.error(chalk.red(`Session '${session}' does not exist`));
            process.exit(1);
          }
        }

        // Helper to capture output from the resolved tmux target
        async function captureOutput(lines: number): Promise<string> {
          if (!targets) return "";
          const output = await tmux("capture-pane", "-t", targets.pane, "-p", "-S", String(-lines));
          return output || "";
        }

        const delegatesToSessionManager = Boolean(existingSession && sessionManager);
        if (opts.wait !== false && canUseTmux) {
          const start = Date.now();
          let warned = false;
          while (true) {
            const output = await captureOutput(20);
            const state = agent.detectActivity(output);
            const active = state === "active";
            const waitingInput = state === "waiting_input";
            if (!active && !waitingInput) {
              break;
            }
            if (!warned) {
              console.log(chalk.dim(`Waiting for ${session} to become idle...`));
              warned = true;
            }
            if (Date.now() - start > timeoutMs) {
              if (waitingInput) {
                console.error(
                  chalk.red(
                    `Timeout waiting for ${session}: session is waiting for interactive input; not sending.`,
                  ),
                );
                process.exit(1);
              }
              console.log(chalk.yellow("Timeout waiting for idle. Sending anyway."));
              break;
            }
            await sleep(5000);
          }
        }

        if (!canUseTmux && !delegatesToSessionManager) {
          console.error(
            chalk.red(
              `Session '${session}' is not tmux-backed and cannot be sent without lifecycle routing`,
            ),
          );
          process.exit(1);
        }

        // For tmux-backed sessions, deliver directly here instead of delegating
        // to sessionManager.send().  The lifecycle route can restore dead
        // sessions, but it historically skipped this command's idle wait and
        // treated any screen change as confirmation.  That race lets worker
        // reports land in Codex's input box until a human presses Return.
        // Keep lifecycle delegation only for non-tmux runtimes.
        if ((!canUseTmux || !tmuxSessionAlive) && existingSession && sessionManager) {
          await sessionManager.send(session, message);
          console.log(chalk.green("Message sent and processing"));
          return;
        }

        // Only a live tmux session reaches this point, so its name is a valid target.
        const pane = exactPaneTarget(tmuxTarget);
        await sendViaTmux(pane, message);

        // A Codex pane gets no key after the message: an Enter can submit
        // text that another sender typed, or answer a prompt. The command
        // reads the screen up to three times and reports what it shows; exit
        // code 0 in every case. At each check the agent's detectActivity goes
        // first: an approval prompt (waiting_input) gets a line of its own.
        // Then "processing" needs the status block of a running turn directly
        // above the composer (the parser of the Codex plugin); words on the
        // screen and an unclear layout never give "processing". The loop
        // below is the loop of every other agent, unchanged.
        if (agent.name === "codex") {
          let composer: CodexComposer | null = null;
          for (let attempt = 1; attempt <= 3; attempt++) {
            await sleep(2000);
            const output = await captureOutput(10);
            if (agent.detectActivity(output) === "waiting_input") {
              console.log(
                chalk.yellow(
                  `Message sent — the pane waits for an approval: check ${session} (tmux pane ${pane})`,
                ),
              );
              return;
            }
            const screen = readCodexScreen(output);
            if (screen.runningTurn) {
              console.log(chalk.green("Message sent and processing"));
              return;
            }
            composer = screen.composer;
          }
          if (composerShowsMessage(composer, message)) {
            console.log(
              chalk.yellow(
                `Message not submitted: the text is still in the input box of ${session} (tmux pane ${pane}); check the pane and press Enter`,
              ),
            );
            return;
          }
          // An empty composer is no proof of delivery: a C-u of another
          // sender or a reset of the screen also empties it.
          console.log(chalk.yellow("Message sent — could not confirm it was received"));
          return;
        }

        // Verify delivery with retries
        for (let attempt = 1; attempt <= 3; attempt++) {
          await sleep(2000);
          const output = await captureOutput(10);
          if (isActive(agent, output)) {
            console.log(chalk.green("Message sent and processing"));
            return;
          }
          if (hasQueuedMessage(output)) {
            console.log(chalk.green("Message queued (session finishing previous task)"));
            return;
          }
          if (hasUnsubmittedCodexInput(output)) {
            await tmux("send-keys", "-t", pane, "Enter");
            await sleep(1000);
            continue;
          }
          if (attempt < 3) {
            await tmux("send-keys", "-t", pane, "Enter");
            await sleep(1000);
          }
        }

        console.log(chalk.yellow("Message sent — could not confirm it was received"));
      },
    );
}
