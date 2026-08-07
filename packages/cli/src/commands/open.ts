import chalk from "chalk";
import type { Command } from "commander";
import { loadConfig, HERDR_RUNTIME_NAME } from "@aoagents/ao-core";
import { exec, getTmuxSessions } from "../lib/shell.js";
import { getSessionManager } from "../lib/create-session-manager.js";
import { matchesPrefix, stripHashPrefix } from "../lib/session-utils.js";
import { DEFAULT_PORT } from "../lib/constants.js";

async function openInTerminal(sessionName: string, newWindow?: boolean): Promise<boolean> {
  try {
    const args = newWindow ? ["--new-window", sessionName] : [sessionName];
    await exec("open-iterm-tab", args);
    return true;
  } catch {
    // Fall back to tmux attach hint
    return false;
  }
}

/**
 * Map session name -> herdr pane id, for sessions running on the herdr runtime.
 *
 * Session discovery below is tmux-based, so herdr-backed sessions would
 * otherwise be invisible to `ao open` entirely. Reading the session manager
 * (metadata-based, runtime-agnostic) surfaces them and tells us how to attach.
 * Best-effort: a broken config or registry must not break `ao open` for tmux.
 */
async function getHerdrPanes(config: ReturnType<typeof loadConfig>): Promise<Map<string, string>> {
  const panes = new Map<string, string>();
  try {
    const sm = await getSessionManager(config);
    for (const session of await sm.list()) {
      const handle = session.runtimeHandle;
      if (handle?.runtimeName === HERDR_RUNTIME_NAME && handle.id) {
        panes.set(session.id, handle.id);
      }
    }
  } catch {
    // No config, no registry, or no sessions — fall through to tmux-only.
  }
  return panes;
}

export function registerOpen(program: Command): void {
  program
    .command("open")
    .description("Open session(s) in terminal tabs")
    .argument("[target]", 'Session name, project ID, or "all" to open everything')
    .option("-w, --new-window", "Open in a new terminal window")
    .action(async (target: string | undefined, opts: { newWindow?: boolean }) => {
      const config = loadConfig();
      const allTmux = await getTmuxSessions();
      const herdrPanes = await getHerdrPanes(config);

      // Sessions may live in either runtime; resolve targets against both so a
      // herdr-only project is not reported as having nothing to open.
      const allSessions = [...new Set([...allTmux, ...herdrPanes.keys()])];

      let sessionsToOpen: string[] = [];

      if (!target || target === "all") {
        // Open all sessions across all projects
        for (const [projectId, project] of Object.entries(config.projects)) {
          const prefix = project.sessionPrefix || projectId;
          const matching = allSessions.filter((s) => matchesPrefix(s, prefix));
          sessionsToOpen.push(...matching);
        }
      } else if (config.projects[target]) {
        // Open all sessions for a specific project
        const project = config.projects[target];
        const prefix = project.sessionPrefix || target;
        sessionsToOpen = allSessions.filter((s) => matchesPrefix(s, prefix));
      } else if (allSessions.includes(target)) {
        // Open a specific session
        sessionsToOpen = [target];
      } else {
        console.error(
          chalk.red(`Unknown target: ${target}\nSpecify a session name, project ID, or "all".`),
        );
        process.exit(1);
      }

      if (sessionsToOpen.length === 0) {
        console.log(chalk.dim("No sessions to open."));
        return;
      }

      console.log(
        chalk.bold(
          `Opening ${sessionsToOpen.length} session${sessionsToOpen.length > 1 ? "s" : ""}...\n`,
        ),
      );

      const port = config.port ?? DEFAULT_PORT;
      for (const session of sessionsToOpen.sort()) {
        // herdr owns its own terminals; attaching is a herdr command rather than
        // an iTerm tab. Print it instead of running it — attach needs a TTY, and
        // this CLI may be running headless or inside another agent's session.
        const pane = herdrPanes.get(session);
        if (pane) {
          console.log(
            `  ${chalk.yellow(session)} — attach with: ${chalk.cyan(`herdr agent attach ${pane}`)}`,
          );
          continue;
        }

        const opened = await openInTerminal(session, opts.newWindow);
        if (opened) {
          console.log(chalk.green(`  Opened: ${session}`));
        } else {
          const sessionId = stripHashPrefix(session);
          console.log(
            `  ${chalk.yellow(session)} — view at: ${chalk.dim(`http://localhost:${port}/sessions/${sessionId}`)}`,
          );
        }
      }
      console.log();
    });
}
