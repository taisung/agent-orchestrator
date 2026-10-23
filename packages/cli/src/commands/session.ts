import { spawn } from "node:child_process";
import chalk from "chalk";
import type { Command } from "commander";
import {
  exactSessionTarget,
  isOrchestratorSession,
  isRuntimeStopUnconfirmedError,
  loadConfig,
  SessionNotRestorableError,
  SessionRelaunchRefusedError,
  WorkspaceMissingError,
  type Runtime,
  type SessionRelaunchPlan,
} from "@aoagents/ao-core";
import { git, getTmuxActivity } from "../lib/shell.js";
import { formatAge } from "../lib/format.js";
import { getPluginRegistry, getSessionManager } from "../lib/create-session-manager.js";
import { isOrchestratorSessionName } from "../lib/session-utils.js";
import {
  callerInForeground,
  callerTerminal,
  runInCallerTerminal,
} from "../lib/relaunch-terminal.js";

interface SessionListEntry {
  id: string;
  projectId: string;
  projectName: string;
  role: "worker" | "orchestrator";
  branch: string | null;
  status: string | null;
  issueId: string | null;
  pr: string | null;
  workspacePath: string | null;
  lastActivityAt: string | null;
}

export function registerSession(program: Command): void {
  const session = program
    .command("session")
    .description("Session management (ls, attach, kill, cleanup, restore, relaunch, claim-pr)");

  session
    .command("ls")
    .description("List all sessions")
    .option("-p, --project <id>", "Filter by project ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { project?: string; json?: boolean }) => {
      const config = loadConfig();
      if (opts.project && !config.projects[opts.project]) {
        console.error(chalk.red(`Unknown project: ${opts.project}`));
        process.exit(1);
      }

      const sm = await getSessionManager(config);
      const sessions = await sm.list(opts.project);

      // Group sessions by project
      const byProject = new Map<string, typeof sessions>();
      for (const s of sessions) {
        const list = byProject.get(s.projectId) ?? [];
        list.push(s);
        byProject.set(s.projectId, list);
      }

      // Iterate over all configured projects (not just ones with sessions)
      const projectIds = opts.project ? [opts.project] : Object.keys(config.projects);
      const allSessionPrefixes = Object.entries(config.projects).map(
        ([id, project]) => project.sessionPrefix ?? id,
      );
      const jsonOutput: SessionListEntry[] = [];

      for (const projectId of projectIds) {
        const project = config.projects[projectId];
        if (!project) continue;
        if (!opts.json) {
          console.log(chalk.bold(`\n${project.name || projectId}:`));
        }

        const projectSessions = (byProject.get(projectId) ?? []).sort((a, b) =>
          a.id.localeCompare(b.id),
        );

        if (projectSessions.length === 0) {
          if (!opts.json) {
            console.log(chalk.dim("  (no active sessions)"));
          }
          continue;
        }

        // Pre-fetch all branches and activities in parallel
        const branches = await Promise.all(
          projectSessions.map(async (s) => {
            if (s.workspacePath) {
              return git(["branch", "--show-current"], s.workspacePath).catch(() => null);
            }
            return null;
          }),
        );

        const activities = await Promise.all(
          projectSessions.map((s) => {
            const tmuxTarget = s.runtimeHandle?.id ?? s.id;
            return getTmuxActivity(tmuxTarget).catch(() => null);
          }),
        );

        for (let i = 0; i < projectSessions.length; i++) {
          const s = projectSessions[i];
          const liveBranch = branches[i];
          const activityTs = activities[i];

          // Priority: live branch from workspace > metadata branch > empty string
          const branchStr = s.workspacePath && liveBranch ? liveBranch : s.branch || "";
          const prUrl = s.metadata["pr"] ?? null;

          if (opts.json) {
            const role = isOrchestratorSession(
              s,
              project.sessionPrefix ?? projectId,
              allSessionPrefixes,
            )
              ? "orchestrator"
              : "worker";

            jsonOutput.push({
              id: s.id,
              projectId,
              projectName: project.name || projectId,
              role,
              branch: branchStr || null,
              status: s.status,
              issueId: s.issueId,
              pr: prUrl,
              workspacePath: s.workspacePath,
              lastActivityAt: activityTs ? new Date(activityTs).toISOString() : null,
            });

            continue;
          }

          const age = activityTs ? formatAge(activityTs) : "-";
          const parts = [chalk.green(s.id), chalk.dim(`(${age})`)];
          if (branchStr) parts.push(chalk.cyan(branchStr));
          if (s.status) parts.push(chalk.dim(`[${s.status}]`));
          if (prUrl) parts.push(chalk.blue(prUrl));

          console.log(`  ${parts.join("  ")}`);
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(jsonOutput, null, 2));
        return;
      }

      console.log();
    });

  session
    .command("attach")
    .description("Attach to a session through its persisted runtime")
    .argument("<session>", "Session name to attach")
    .action(async (sessionName: string) => {
      const config = loadConfig();
      const sm = await getSessionManager(config);
      const sessionInfo = await sm.get(sessionName);
      const handle = sessionInfo?.runtimeHandle;
      if (!handle) {
        console.error(chalk.red(`Session '${sessionName}' does not exist`));
        process.exit(1);
      }

      const registry = await getPluginRegistry(config);
      const runtime = registry.get<Runtime>("runtime", handle.runtimeName);
      if (!runtime) {
        console.error(chalk.red(`Runtime '${handle.runtimeName}' is not available`));
        process.exit(1);
      }

      // A rejected probe means the runtime cannot tell, not that the session is gone.
      const alive = await runtime.isAlive(handle).catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(
          chalk.red(`Cannot tell whether session '${sessionName}' is running: ${reason}`),
        );
        process.exit(1);
      });
      if (!alive) {
        console.error(chalk.red(`Session '${sessionName}' is not running`));
        process.exit(1);
      }

      const attachInfo = await runtime.getAttachInfo?.(handle);
      const target = attachInfo?.target ?? handle.id;
      let command: string;
      let args: string[];
      if (handle.runtimeName === "tmux") {
        command = "tmux";
        // An exact target: a plain `-t` also attaches to a session whose name
        // only starts with this one.
        args = ["attach", "-t", exactSessionTarget(handle.id)];
      } else if (handle.runtimeName === "herdr") {
        command = "herdr";
        args = ["agent", "attach", target];
      } else {
        console.error(
          chalk.red(
            `Runtime '${handle.runtimeName}' does not provide a supported native attach path`,
          ),
        );
        process.exit(1);
      }

      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { stdio: "inherit" });
        child.once("error", (err) => reject(err));
        child.once("exit", (code) => {
          if (code === 0 || code === null) {
            resolve();
            return;
          }
          reject(new Error(`${command} attach exited with code ${code}`));
        });
      }).catch((err) => {
        console.error(chalk.red(`Failed to attach to session ${sessionName}: ${err}`));
        process.exit(1);
      });
    });

  session
    .command("kill")
    .description("Kill a session and remove its worktree")
    .argument("<session>", "Session name to kill")
    .option("--purge-session", "Delete mapped OpenCode session during kill")
    .action(async (sessionName: string, opts: { purgeSession?: boolean }) => {
      const config = loadConfig();
      const sm = await getSessionManager(config);

      try {
        await sm.kill(sessionName, { purgeOpenCode: opts.purgeSession === true });
        console.log(chalk.green(`\nSession ${sessionName} killed.`));
      } catch (err) {
        // Same-ID R2a: a runtime stop that was not confirmed keeps the record
        // and the worktree; print the outcome and the next action.
        if (isRuntimeStopUnconfirmedError(err)) {
          console.error(chalk.red(`Failed to kill session ${sessionName}: ${err.message}`));
          console.error(chalk.yellow(`Next: ${err.hint}`));
          process.exit(1);
        }
        console.error(chalk.red(`Failed to kill session ${sessionName}: ${err}`));
        process.exit(1);
      }
    });

  session
    .command("cleanup")
    .description("Kill sessions where PR is merged or issue is closed")
    .option("-p, --project <id>", "Filter by project ID")
    .option("--dry-run", "Show what would be cleaned up without doing it")
    .action(async (opts: { project?: string; dryRun?: boolean }) => {
      const config = loadConfig();
      if (opts.project && !config.projects[opts.project]) {
        console.error(chalk.red(`Unknown project: ${opts.project}`));
        process.exit(1);
      }

      console.log(chalk.bold("Checking for completed sessions...\n"));

      const sm = await getSessionManager(config);

      const filterCleanupIds = (ids: string[]): string[] =>
        ids.filter((entry) => {
          const separator = entry.indexOf(":");
          const entryProjectId = separator === -1 ? opts.project : entry.slice(0, separator);
          const sessionId = separator === -1 ? entry : entry.slice(separator + 1);
          return !isOrchestratorSessionName(config, sessionId, entryProjectId);
        });

      const filterCleanupErrors = (errors: Array<{ sessionId: string; error: string }>) =>
        errors.filter(({ sessionId }) => {
          const separator = sessionId.indexOf(":");
          const entryProjectId = separator === -1 ? opts.project : sessionId.slice(0, separator);
          const normalizedSessionId = separator === -1 ? sessionId : sessionId.slice(separator + 1);
          return !isOrchestratorSessionName(config, normalizedSessionId, entryProjectId);
        });

      if (opts.dryRun) {
        // Dry-run delegates to sm.cleanup() with dryRun flag so it uses the
        // same live checks (PR state, runtime alive, tracker) as actual cleanup.
        const rawResult = await sm.cleanup(opts.project, { dryRun: true });
        const result = {
          ...rawResult,
          killed: filterCleanupIds(rawResult.killed),
          errors: filterCleanupErrors(rawResult.errors),
        };

        if (result.errors.length > 0) {
          for (const { sessionId, error } of result.errors) {
            console.error(chalk.red(`  Error checking ${sessionId}: ${error}`));
          }
        }

        if (result.killed.length === 0 && result.errors.length === 0) {
          console.log(chalk.dim("  No sessions to clean up."));
        } else {
          for (const id of result.killed) {
            console.log(chalk.yellow(`  Would kill ${id}`));
          }
          if (result.killed.length > 0) {
            console.log(
              chalk.dim(
                `\nDry run complete. ${result.killed.length} session${result.killed.length !== 1 ? "s" : ""} would be cleaned.`,
              ),
            );
          }
        }
      } else {
        const rawResult = await sm.cleanup(opts.project);
        const result = {
          ...rawResult,
          killed: filterCleanupIds(rawResult.killed),
          errors: filterCleanupErrors(rawResult.errors),
        };

        if (result.killed.length === 0 && result.errors.length === 0) {
          console.log(chalk.dim("  No sessions to clean up."));
        } else {
          if (result.killed.length > 0) {
            for (const id of result.killed) {
              console.log(chalk.green(`  Cleaned: ${id}`));
            }
          }
          if (result.errors.length > 0) {
            for (const { sessionId, error } of result.errors) {
              console.error(chalk.red(`  Error cleaning ${sessionId}: ${error}`));
            }
          }
          console.log(chalk.green(`\nCleanup complete. ${result.killed.length} sessions cleaned.`));
        }
      }
    });

  session
    .command("claim-pr")
    .description("Attach an existing PR to a session")
    .argument("<pr>", "Pull request number or URL")
    .argument("[session]", "Session name (defaults to AO_SESSION_NAME/AO_SESSION)")
    .option("--assign-on-github", "Assign the PR to the authenticated GitHub user")
    .action(
      async (
        prRef: string,
        sessionName: string | undefined,
        opts: { assignOnGithub?: boolean },
      ) => {
        const config = loadConfig();
        const resolvedSession =
          sessionName ?? process.env["AO_SESSION_NAME"] ?? process.env["AO_SESSION"];

        if (!resolvedSession) {
          console.error(
            chalk.red(
              "No session provided. Pass a session name or run this inside a managed AO session.",
            ),
          );
          process.exit(1);
        }

        const sm = await getSessionManager(config);

        try {
          const result = await sm.claimPR(resolvedSession, prRef, {
            assignOnGithub: opts.assignOnGithub,
          });

          console.log(chalk.green(`\nSession ${resolvedSession} claimed PR #${result.pr.number}.`));
          console.log(chalk.dim(`  PR:       ${result.pr.url}`));
          console.log(chalk.dim(`  Branch:   ${result.pr.branch}`));
          console.log(
            chalk.dim(
              `  Checkout: ${result.branchChanged ? "switched to PR branch" : "already on PR branch"}`,
            ),
          );
          if (result.takenOverFrom.length > 0) {
            console.log(chalk.dim(`  Took over from: ${result.takenOverFrom.join(", ")}`));
          }
          if (opts.assignOnGithub) {
            if (result.githubAssigned) {
              console.log(chalk.dim("  GitHub assignee: updated"));
            } else if (result.githubAssignmentError) {
              console.log(chalk.yellow(`  GitHub assignee: ${result.githubAssignmentError}`));
            }
          }
        } catch (err) {
          console.error(chalk.red(`Failed to claim PR for session ${resolvedSession}: ${err}`));
          process.exit(1);
        }
      },
    );

  session
    .command("restore")
    .description("Restore a terminated/crashed session in-place")
    .argument("<session>", "Session name to restore")
    .action(async (sessionName: string) => {
      const config = loadConfig();
      const sm = await getSessionManager(config);

      try {
        const restored = await sm.restore(sessionName);
        console.log(chalk.green(`\nSession ${sessionName} restored.`));
        if (restored.workspacePath) {
          console.log(chalk.dim(`  Worktree: ${restored.workspacePath}`));
        }
        if (restored.branch) {
          console.log(chalk.dim(`  Branch:   ${restored.branch}`));
        }
        console.log(chalk.dim(`  Attach:   ao session attach ${sessionName}`));
      } catch (err) {
        if (err instanceof SessionNotRestorableError) {
          console.error(chalk.red(`Cannot restore: ${err.reason}`));
        } else if (err instanceof WorkspaceMissingError) {
          console.error(chalk.red(`Workspace missing: ${err.message}`));
        } else if (isRuntimeStopUnconfirmedError(err)) {
          // Same-ID R2a (N-2): no second runtime while the old one may run.
          console.error(chalk.red(`Failed to restore session ${sessionName}: ${err.message}`));
          console.error(chalk.yellow(`Next: ${err.hint}`));
        } else {
          console.error(chalk.red(`Failed to restore session ${sessionName}: ${err}`));
        }
        process.exit(1);
      }
    });

  session
    .command("relaunch")
    .description(
      "Start the agent of a session again in its existing tmux pane, after the agent ended (for example after /exit)",
    )
    .argument("<session>", "Session ID")
    .option("--continue", "Continue the session's own agent conversation, by its recorded ID")
    .addHelpText(
      "after",
      `
Run it after the agent process ended, from another shell or from the session's
own pane. The launch command is built now, from the current config and prompt,
with the agent, runtime and model of the session (an orchestrator keeps its
prompt and its permissionless mode).

It refuses (exit 1, nothing changed) when the agent process still runs, when
its liveness is unknown, when the tmux session does not exist, when the pane of
the agent is not known (a session with several panes that no relaunch named) or
is gone (the pane of the last relaunch was closed), when another launch of the
session runs, when the session is terminal or has no active record, and for a
runtime other than tmux. Linux only: the checks read /proc.

From another shell, it types the launch line into the shell of the agent's pane
(by its pane ID) and exits 0 only when the agent process runs within 15 s. The
pane's shell must wait for input. It sends C-c, and it types only when a second
C-c shows a fresh, empty prompt line. A shell without a SIGINT trap drops any
half-typed text on C-c, so none of it runs. A shell that ignores SIGINT
(trap '' INT), or a SIGINT trap that reads input without printing a prompt,
shows no such line: then nothing is typed and the command fails (clear the line
by hand).

Limit: a SIGINT trap in the pane's shell that prints the prompt and reads input
(for example read -e -i) passes the fresh-prompt check; prefilled text can run,
or the launch line can be consumed. Relaunch only into a shell without such a
trap (trap -p INT in that shell prints the trap).

In the session's own pane (as the foreground job, not with &), the agent runs
as a child of this command on the same terminal (the launch script execs it),
and the command ends with the agent's exit code.

--continue resumes the conversation that the agent of the session's last
launch recorded (Claude Code: a SessionStart hook, bound to that launch's token
and pane). It refuses when that ID is not known, also after a restore. It also
refuses when a hook of that launch could not record an event and wrote a
failure mark of that launch instead (for example no flock, no bash 5, a failed
read, a stop by SIGTERM, SIGHUP or SIGINT). A hook that cannot write that mark
either gives no refusal (see the limit below). Without --continue, the agent
starts a new conversation.

Limit: the hook orders events by its own start time from the wall clock; a
delay before the hook body starts, or a clock step back, can leave the older
conversation as current. It can happen when two events of the agent (start,
resume, /clear, compact) come within seconds of each other, or when the clock
stepped back during the agent's run. Then relaunch without --continue and pick
the conversation in the agent (Claude Code: /resume). The command prints the ID
that it resumes, but it does not stop for a wrong one.

Limit: when the hook cannot write its failure mark, the older conversation
stays current, and --continue resumes it with no warning. It can happen when a
write fails for both the record and the mark (the directory of the conversation
records cannot be written, or the disk is full), when a hook never starts, or
when SIGKILL stops a hook. The directory is
~/.agent-orchestrator/<hash>-<project folder>/sessions/.agent-conversations.
If it could have refused writes, or a hook could have been stopped, relaunch
without --continue and pick the conversation in the agent (Claude Code:
/resume).

Limit: a restore or kill of the same session already in flight is not
excluded; do not relaunch while one runs (also a lifecycle reaction that
restores it, or a restore or kill in another shell).`,
    )
    .action(async (sessionName: string, opts: { continue?: boolean }) => {
      const config = loadConfig();
      const sm = await getSessionManager(config);
      if (!sm.relaunch) {
        console.error(chalk.red("This session manager cannot relaunch a session."));
        process.exit(1);
      }

      const describe = (plan: SessionRelaunchPlan): void => {
        const where = plan.mode === "pane" ? "in its tmux pane" : "in this terminal";
        const model = plan.model ? `, model ${plan.model}` : "";
        console.log(
          chalk.green(`Relaunching ${plan.sessionId} (${plan.agentName}${model}) ${where}.`),
        );
        console.log(
          chalk.dim(
            plan.conversation
              ? `  Conversation: ${plan.conversation.id} (from ${plan.conversation.source})`
              : "  Conversation: new",
          ),
        );
      };

      let result: Awaited<ReturnType<NonNullable<typeof sm.relaunch>>>;
      try {
        result = await sm.relaunch(sessionName, {
          continueConversation: opts.continue === true,
          callerTty: callerTerminal(),
          callerForeground: callerInForeground(),
          runInCallerTerminal: (launch) => runInCallerTerminal(launch),
          onStart: describe,
          // At once (review r1 M-3), also while the agent owns the terminal.
          onWarning: (warning) => console.error(chalk.yellow(`Warning: ${warning}`)),
        });
      } catch (err) {
        if (err instanceof SessionRelaunchRefusedError) {
          console.error(chalk.red(err.message));
          console.error(chalk.yellow(`Next: ${err.next}`));
        } else {
          const message = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`Failed to relaunch session ${sessionName}: ${message}`));
        }
        process.exit(1);
      }

      const unknown = result.agentState === "unknown";
      if (result.plan.mode === "caller-terminal" && result.child) {
        // The agent owns the terminal now: only warnings are written until it
        // ends, and the terminal goes back to the shell only when it ended.
        const code = await result.child.exited;
        if (!result.running) {
          console.error(
            chalk.red(
              unknown
                ? `AO could not tell within 15 s whether the agent process of ${sessionName} ran (the process check did not answer).`
                : `The agent of ${sessionName} ended before its process was seen running.`,
            ),
          );
          process.exit(code === 0 ? 1 : code);
        }
        process.exit(code);
      }

      if (!result.running) {
        console.error(
          chalk.red(
            unknown
              ? `AO could not tell within 15 s whether the agent process of ${sessionName} runs (the process check did not answer); it may run.`
              : `The agent process of ${sessionName} did not start within 15 s.`,
          ),
        );
        console.error(
          chalk.yellow(
            `Next: look at the pane with \`ao session attach ${sessionName}\`${unknown ? ", and check `ao session ls`" : ""}`,
          ),
        );
        process.exit(1);
      }
      console.log(chalk.green(`Session ${sessionName} relaunched: its agent process runs.`));
      console.log(chalk.dim(`  Attach:   ao session attach ${sessionName}`));
    });

  session
    .command("remap")
    .description("Re-discover and persist OpenCode session mapping for an AO session")
    .argument("<session>", "Session name to remap")
    .option("-f, --force", "Force fresh remap by re-discovering the OpenCode session")
    .action(async (sessionName: string, opts: { force?: boolean }) => {
      const config = loadConfig();
      const sm = await getSessionManager(config);

      try {
        const mapped = await sm.remap(sessionName, opts.force === true);
        console.log(chalk.green(`\nSession ${sessionName} remapped.`));
        console.log(chalk.dim(`  OpenCode session: ${mapped}`));
      } catch (err) {
        console.error(chalk.red(`Failed to remap session ${sessionName}: ${err}`));
        process.exit(1);
      }
    });
}
