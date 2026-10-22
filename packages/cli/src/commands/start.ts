/**
 * `ao start` and `ao stop` commands — unified orchestrator startup.
 *
 * Supports two modes:
 *   1. `ao start [project]` — start from existing config
 *   2. `ao start <url>` — clone repo, auto-generate config, then start
 *
 * The orchestrator prompt is passed to the agent via --append-system-prompt
 * (or equivalent flag) at launch time — no file writing required.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, basename } from "node:path";
import { cwd } from "node:process";
import chalk from "chalk";
import ora from "ora";
import { Option, type Command } from "commander";
import {
  loadConfig,
  generateOrchestratorPrompt,
  generateSessionPrefix,
  findConfigFile,
  isRepoUrl,
  parseRepoUrl,
  resolveCloneTarget,
  isRepoAlreadyCloned,
  generateConfigFromUrl,
  configToYaml,
  normalizeOrchestratorSessionStrategy,
  isOrchestratorSession,
  isTerminalSession,
  isRuntimeStopUnconfirmedError,
  ConfigNotFoundError,
  RUNTIME_NO_SERVER_ERROR_CODE,
  type OrchestratorConfig,
  type ProjectConfig,
  type ParsedRepoUrl,
  type PluginRegistry,
  type Runtime,
  type Session,
} from "@aoagents/ao-core";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { exec, execSilent, git } from "../lib/shell.js";
import { getPluginRegistry, getSessionManager } from "../lib/create-session-manager.js";
import {
  ensureLifecycleWorker,
  startDetachedStop,
  stopLifecycleWorker,
  type DetachedStop,
} from "../lib/lifecycle-service.js";
import { isHumanCaller } from "../lib/caller-context.js";
import { detectEnvironment } from "../lib/detect-env.js";
import {
  detectAgentRuntime,
  detectAvailableAgents,
  type DetectedAgent,
} from "../lib/detect-agent.js";
import { detectDefaultBranch } from "../lib/git-utils.js";
import { promptConfirm, promptSelect } from "../lib/prompts.js";
import {
  detectProjectType,
  generateRulesFromTemplates,
  formatProjectTypeForDisplay,
} from "../lib/project-detection.js";
import { formatCommandError } from "../lib/cli-errors.js";
import { findProjectForDirectory } from "../lib/project-resolution.js";

const IS_TTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Resolve project from config.
 * If projectArg is provided, use it. If only one project exists, use that.
 * Otherwise, error with helpful message.
 */
async function resolveProject(
  config: OrchestratorConfig,
  projectArg?: string,
  action = "start",
): Promise<{ projectId: string; project: ProjectConfig }> {
  const projectIds = Object.keys(config.projects);

  if (projectIds.length === 0) {
    throw new Error("No projects configured. Add a project to agent-orchestrator.yaml.");
  }

  // Explicit project argument
  if (projectArg) {
    const project = config.projects[projectArg];
    if (!project) {
      throw new Error(
        `Project "${projectArg}" not found. Available projects:\n  ${projectIds.join(", ")}`,
      );
    }
    return { projectId: projectArg, project };
  }

  // Only one project — use it
  if (projectIds.length === 1) {
    const projectId = projectIds[0];
    return { projectId, project: config.projects[projectId] };
  }

  // Multiple projects — try matching cwd to a project path
  // Note: loadConfig() already expands ~ in project paths via expandPaths()
  const currentDir = resolve(cwd());
  const matchedProjectId = findProjectForDirectory(config.projects, currentDir);
  if (matchedProjectId) {
    return { projectId: matchedProjectId, project: config.projects[matchedProjectId] };
  }

  // No match — prompt if interactive, otherwise error
  if (isHumanCaller()) {
    const projectId = await promptSelect(
      `Choose project to ${action}:`,
      projectIds.map((id) => ({
        value: id,
        label: config.projects[id].name ?? id,
        hint: id,
      })),
    );
    return { projectId, project: config.projects[projectId] };
  } else {
    throw new Error(
      `Multiple projects configured. Specify which one to ${action}:\n  ${projectIds.map((id) => `ao ${action} ${id}`).join("\n  ")}`,
    );
  }
}

/**
 * Resolve project from config by matching against a repo URL's ownerRepo.
 * Used when `ao start <url>` loads an existing multi-project config — the user
 * can't pass both a URL and a project name since they share the same arg slot.
 *
 * Falls back to `resolveProject` (which handles single-project configs or
 * errors with a helpful message for ambiguous multi-project cases).
 */
async function resolveProjectByRepo(
  config: OrchestratorConfig,
  parsed: ParsedRepoUrl,
): Promise<{ projectId: string; project: ProjectConfig }> {
  const projectIds = Object.keys(config.projects);

  // Try to match by repo field (e.g. "owner/repo")
  for (const id of projectIds) {
    const project = config.projects[id];
    if (project.repo === parsed.ownerRepo) {
      return { projectId: id, project };
    }
  }

  // No repo match — fall back to standard resolution (works for single-project)
  return await resolveProject(config);
}

interface InstallAttempt {
  cmd: string;
  args: string[];
  label: string;
}

function canPromptForInstall(): boolean {
  return isHumanCaller() && IS_TTY;
}

function genericInstallHints(command: string): string[] {
  switch (command) {
    case "node":
    case "npm":
      return ["Install Node.js/npm from https://nodejs.org/"];
    case "pnpm":
      return ["corepack enable && corepack prepare pnpm@latest --activate", "npm install -g pnpm"];
    case "pipx":
      return ["python3 -m pip install --user pipx", "python3 -m pipx ensurepath"];
    default:
      return [];
  }
}

/**
 * Prompt the user to optionally switch orchestrator/worker agents at startup.
 * Shows only agents detected on the current system (reuses detectAvailableAgents).
 * Returns the chosen agents
 */
async function promptAgentSelection(): Promise<{
  orchestratorAgent: string;
  workerAgent: string;
} | null> {
  if (canPromptForInstall()) {
    const available = await detectAvailableAgents();
    if (available.length === 0) {
      console.log(chalk.yellow("No agent runtimes detected — using existing config."));
      return null;
    }

    const agentOptions = available.map((a) => ({ value: a.name, label: a.displayName }));

    const orchestratorAgent = await promptSelect("Orchestrator agent:", agentOptions);
    const workerAgent = await promptSelect("Worker agent:", agentOptions);

    return { orchestratorAgent, workerAgent };
  } else {
    return null;
  }
}

async function askYesNo(
  question: string,
  defaultYes = true,
  nonInteractiveDefault = defaultYes,
): Promise<boolean> {
  if (!canPromptForInstall()) return nonInteractiveDefault;
  return await promptConfirm(question, defaultYes);
}

function gitInstallAttempts(): InstallAttempt[] {
  if (process.platform === "darwin") {
    return [{ cmd: "brew", args: ["install", "git"], label: "brew install git" }];
  }
  if (process.platform === "linux") {
    return [
      {
        cmd: "sudo",
        args: ["apt-get", "install", "-y", "git"],
        label: "sudo apt-get install -y git",
      },
      { cmd: "sudo", args: ["dnf", "install", "-y", "git"], label: "sudo dnf install -y git" },
    ];
  }
  if (process.platform === "win32") {
    return [
      {
        cmd: "winget",
        args: ["install", "--id", "Git.Git", "-e", "--source", "winget"],
        label: "winget install --id Git.Git -e --source winget",
      },
    ];
  }
  return [];
}

function gitInstallHints(): string[] {
  if (process.platform === "darwin") return ["brew install git"];
  if (process.platform === "win32") return ["winget install --id Git.Git -e --source winget"];
  return ["sudo apt install git      # Debian/Ubuntu", "sudo dnf install git      # Fedora/RHEL"];
}

function ghInstallAttempts(): InstallAttempt[] {
  if (process.platform === "darwin") {
    return [{ cmd: "brew", args: ["install", "gh"], label: "brew install gh" }];
  }
  if (process.platform === "linux") {
    return [
      {
        cmd: "sudo",
        args: ["apt-get", "install", "-y", "gh"],
        label: "sudo apt-get install -y gh",
      },
      { cmd: "sudo", args: ["dnf", "install", "-y", "gh"], label: "sudo dnf install -y gh" },
    ];
  }
  if (process.platform === "win32") {
    return [
      {
        cmd: "winget",
        args: ["install", "--id", "GitHub.cli", "-e", "--source", "winget"],
        label: "winget install --id GitHub.cli -e --source winget",
      },
    ];
  }
  return [];
}

async function runInteractiveCommand(cmd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.once("error", (err) => {
      reject(
        formatCommandError(err, {
          cmd,
          args,
          action: "run an interactive installer",
          installHints: genericInstallHints(cmd),
        }),
      );
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${code ?? "unknown"}): ${cmd} ${args.join(" ")}`));
    });
  });
}

async function tryInstallWithAttempts(
  attempts: InstallAttempt[],
  verify: () => Promise<boolean>,
): Promise<boolean> {
  for (const attempt of attempts) {
    try {
      console.log(chalk.dim(`  Running: ${attempt.label}`));
      await runInteractiveCommand(attempt.cmd, attempt.args);
      if (await verify()) return true;
    } catch {
      // Try next installer
    }
  }
  return verify();
}

async function ensureGit(context: string): Promise<void> {
  const hasGit = (await execSilent("git", ["--version"])) !== null;
  if (hasGit) return;

  console.log(chalk.yellow(`⚠ Git is required for ${context}.`));
  const shouldInstall = await askYesNo("Install Git now?", true, false);
  if (shouldInstall) {
    const installed = await tryInstallWithAttempts(
      gitInstallAttempts(),
      async () => (await execSilent("git", ["--version"])) !== null,
    );
    if (installed) {
      console.log(chalk.green("  ✓ Git installed successfully"));
      return;
    }
  }

  console.error(chalk.red("\n✗ Git is required but is not installed.\n"));
  console.log(chalk.bold("  Install Git manually, then re-run ao start:\n"));
  for (const hint of gitInstallHints()) {
    console.log(chalk.cyan(`    ${hint}`));
  }
  console.log();
  process.exit(1);
}

interface AgentInstallOption {
  id: string;
  label: string;
  cmd: string;
  args: string[];
}

export const OPENCODE_NPM_PACKAGE = "@opencode/cli";
export const LEGACY_OPENCODE_NPM_PACKAGE = "opencode-ai";

function hasLegacyOpenCodePackage(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { dependencies?: Record<string, unknown> };
    const deps = parsed.dependencies ?? {};
    return LEGACY_OPENCODE_NPM_PACKAGE in deps;
  } catch {
    return false;
  }
}

/**
 * Read-only check for a globally installed `opencode-ai` package.
 * Runs `npm ls -g opencode-ai --depth=0 --json` and reports whether the
 * package is present. Never throws: an unreadable result means "absent",
 * so a failed detection cannot crash `ao start`.
 */
export async function isLegacyOpenCodeInstalled(): Promise<boolean> {
  try {
    const result = await exec("npm", [
      "ls",
      "-g",
      LEGACY_OPENCODE_NPM_PACKAGE,
      "--depth=0",
      "--json",
    ]);
    return hasLegacyOpenCodePackage(result.stdout);
  } catch (err) {
    const stdout = (err as { stdout?: unknown }).stdout;
    if (typeof stdout === "string" && stdout.length > 0) {
      return hasLegacyOpenCodePackage(stdout);
    }
    return false;
  }
}

/** Install args for OpenCode 2.x. Adds `--force` when the legacy package owns the `opencode` bin. */
export function buildOpenCodeInstallArgs(hasLegacy: boolean): string[] {
  const base = ["install", "-g", OPENCODE_NPM_PACKAGE];
  return hasLegacy ? [...base, "--force"] : base;
}

/** One-line reason for `--force`, or null when no flag is needed. */
export function openCodeInstallNotice(hasLegacy: boolean): string | null {
  if (!hasLegacy) return null;
  return (
    `${LEGACY_OPENCODE_NPM_PACKAGE} is installed globally, ` +
    `adding --force to replace its opencode bin.`
  );
}

/**
 * Resolve the OpenCode install command with a read-only legacy check.
 * Returns the npm args and the notice to print (null when no flag).
 */
export async function resolveOpenCodeInstall(): Promise<{
  args: string[];
  notice: string | null;
}> {
  const hasLegacy = await isLegacyOpenCodeInstalled();
  return { args: buildOpenCodeInstallArgs(hasLegacy), notice: openCodeInstallNotice(hasLegacy) };
}

export const AGENT_INSTALL_OPTIONS: AgentInstallOption[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    cmd: "npm",
    args: ["install", "-g", "@anthropic-ai/claude-code"],
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    cmd: "npm",
    args: ["install", "-g", "@openai/codex"],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    cmd: "npm",
    args: ["install", "-g", "@google/gemini-cli"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    cmd: "npm",
    args: ["install", "-g", OPENCODE_NPM_PACKAGE],
  },
];

async function promptInstallAgentRuntime(available: DetectedAgent[]): Promise<DetectedAgent[]> {
  if (available.length > 0 || !canPromptForInstall()) return available;

  console.log(chalk.yellow("⚠ No supported agent runtime detected."));
  console.log(
    chalk.dim("  You can install one now (recommended) or continue and install later.\n"),
  );
  const choice = await promptSelect("Choose runtime to install:", [
    ...AGENT_INSTALL_OPTIONS.map((option) => ({
      value: option.id,
      label: option.label,
      hint: [option.cmd, ...option.args].join(" "),
    })),
    { value: "skip", label: "Skip for now" },
  ]);
  if (choice === "skip") {
    return available;
  }

  const selected = AGENT_INSTALL_OPTIONS.find((option) => option.id === choice);
  if (!selected) {
    return available;
  }

  console.log(chalk.dim(`  Installing ${selected.label}...`));
  try {
    if (selected.id === "opencode") {
      const resolved = await resolveOpenCodeInstall();
      if (resolved.notice) {
        console.log(chalk.dim(`  ${resolved.notice}`));
      }
      await runInteractiveCommand(selected.cmd, resolved.args);
    } else {
      await runInteractiveCommand(selected.cmd, selected.args);
    }
    const refreshed = await detectAvailableAgents();
    if (refreshed.length > 0) {
      console.log(chalk.green(`  ✓ ${selected.label} installed successfully`));
    }
    return refreshed;
  } catch {
    console.log(chalk.yellow(`  ⚠ Could not install ${selected.label} automatically.`));
    return available;
  }
}

/**
 * Clone a repo with authentication support.
 *
 * Strategy:
 *   1. Try `gh repo clone owner/repo target -- --depth 1` — handles GitHub auth
 *      for private repos via the user's `gh auth` token.
 *   2. Fall back to `git clone --depth 1` with SSH URL — works for users with
 *      SSH keys configured (common for private repos without gh).
 *   3. Final fallback to `git clone --depth 1` with HTTPS URL — works for
 *      public repos without any auth setup.
 */
async function cloneRepo(parsed: ParsedRepoUrl, targetDir: string, cwd: string): Promise<void> {
  // 1. Try gh repo clone (handles GitHub auth automatically)
  if (parsed.host === "github.com") {
    const ghAvailable = (await execSilent("gh", ["auth", "status"])) !== null;
    if (ghAvailable) {
      try {
        await exec("gh", ["repo", "clone", parsed.ownerRepo, targetDir, "--", "--depth", "1"], {
          cwd,
        });
        return;
      } catch {
        // gh clone failed — fall through to git clone with SSH
      }
    }
  }

  // 2. Try git clone with SSH URL (works with SSH keys for private repos)
  const sshUrl = `git@${parsed.host}:${parsed.ownerRepo}.git`;
  try {
    await exec("git", ["clone", "--depth", "1", sshUrl, targetDir], { cwd });
    return;
  } catch {
    // SSH failed — fall through to HTTPS
  }

  // 3. Final fallback: HTTPS (works for public repos)
  await exec("git", ["clone", "--depth", "1", parsed.cloneUrl, targetDir], { cwd });
}

/**
 * Handle `ao start <url>` — clone repo, generate config, return loaded config.
 * Also returns the parsed URL so the caller can match by repo when the config
 * contains multiple projects.
 */
async function handleUrlStart(
  url: string,
): Promise<{ config: OrchestratorConfig; parsed: ParsedRepoUrl; autoGenerated: boolean }> {
  const spinner = ora();

  // 1. Parse URL
  spinner.start("Parsing repository URL");
  const parsed = parseRepoUrl(url);
  spinner.succeed(`Repository: ${chalk.cyan(parsed.ownerRepo)} (${parsed.host})`);

  await ensureGit("repository cloning");

  // 2. Determine target directory
  const cwd = process.cwd();
  const targetDir = resolveCloneTarget(parsed, cwd);
  const alreadyCloned = isRepoAlreadyCloned(targetDir, parsed.cloneUrl);

  // 3. Clone or reuse
  if (alreadyCloned) {
    console.log(chalk.green(`  Reusing existing clone at ${targetDir}`));
  } else {
    spinner.start(`Cloning ${parsed.ownerRepo}`);
    try {
      await cloneRepo(parsed, targetDir, cwd);
      spinner.succeed(`Cloned to ${targetDir}`);
    } catch (err) {
      spinner.fail("Clone failed");
      throw new Error(
        `Failed to clone ${parsed.ownerRepo}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  // 4. Check for existing config
  const configPath = resolve(targetDir, "agent-orchestrator.yaml");
  const configPathAlt = resolve(targetDir, "agent-orchestrator.yml");

  if (existsSync(configPath)) {
    console.log(chalk.green(`  Using existing config: ${configPath}`));
    return { config: loadConfig(configPath), parsed, autoGenerated: false };
  }

  if (existsSync(configPathAlt)) {
    console.log(chalk.green(`  Using existing config: ${configPathAlt}`));
    return { config: loadConfig(configPathAlt), parsed, autoGenerated: false };
  }

  // 5. Auto-generate config
  spinner.start("Generating config");
  const rawConfig = generateConfigFromUrl({
    parsed,
    repoPath: targetDir,
  });

  const yamlContent = configToYaml(rawConfig);
  writeFileSync(configPath, yamlContent);
  spinner.succeed(`Config generated: ${configPath}`);

  return { config: loadConfig(configPath), parsed, autoGenerated: true };
}

/**
 * Auto-create agent-orchestrator.yaml when no config exists.
 * Detects environment, project type, and generates config with smart defaults.
 * Returns the loaded config.
 */
async function autoCreateConfig(workingDir: string): Promise<OrchestratorConfig> {
  console.log(chalk.bold.cyan("\n  Agent Orchestrator — First Run Setup\n"));
  console.log(chalk.dim("  Detecting project and generating config...\n"));

  const env = await detectEnvironment(workingDir);
  const projectType = detectProjectType(workingDir);

  // Show detection results
  if (env.isGitRepo) {
    console.log(chalk.green("  ✓ Git repository detected"));
    if (env.ownerRepo) {
      console.log(chalk.dim(`    Remote: ${env.ownerRepo}`));
    }
    if (env.currentBranch) {
      console.log(chalk.dim(`    Branch: ${env.currentBranch}`));
    }
  }

  if (projectType.languages.length > 0 || projectType.frameworks.length > 0) {
    console.log(chalk.green("  ✓ Project type detected"));
    const formattedType = formatProjectTypeForDisplay(projectType);
    formattedType.split("\n").forEach((line) => {
      console.log(chalk.dim(`    ${line}`));
    });
  }

  console.log();

  const agentRules = generateRulesFromTemplates(projectType);

  // Build config with smart defaults
  const projectId = env.isGitRepo ? basename(workingDir) : "my-project";
  const repo = env.ownerRepo || "owner/repo";
  const path = env.isGitRepo ? workingDir : `~/${projectId}`;
  const defaultBranch = env.defaultBranch || "main";

  // Detect available agent runtimes via plugin registry
  let detectedAgents = await detectAvailableAgents();
  detectedAgents = await promptInstallAgentRuntime(detectedAgents);
  const agent = await detectAgentRuntime(detectedAgents);
  console.log(chalk.green(`  ✓ Agent runtime: ${agent}`));

  const config: Record<string, unknown> = {
    defaults: {
      runtime: "tmux",
      agent,
      workspace: "worktree",
      notifiers: [],
    },
    projects: {
      [projectId]: {
        name: projectId,
        sessionPrefix: generateSessionPrefix(projectId),
        repo,
        path,
        defaultBranch,
        ...(agentRules ? { agentRules } : {}),
      },
    },
  };

  const outputPath = resolve(workingDir, "agent-orchestrator.yaml");
  if (existsSync(outputPath)) {
    console.log(chalk.yellow(`⚠ Config already exists: ${outputPath}`));
    console.log(chalk.dim("  Use 'ao start' to start with the existing config.\n"));
    return loadConfig(outputPath);
  }
  const yamlContent = yamlStringify(config, { indent: 2 });
  writeFileSync(outputPath, yamlContent);

  console.log(chalk.green(`✓ Config created: ${outputPath}\n`));

  if (repo === "owner/repo") {
    console.log(chalk.yellow("⚠ Could not detect GitHub remote."));
    console.log(chalk.dim("  Update the 'repo' field in the config before spawning agents.\n"));
  }

  if (!env.hasTmux) {
    console.log(chalk.yellow("⚠ tmux not found — will prompt to install at startup"));
  }
  if (!env.hasGh) {
    console.log(
      chalk.yellow("⚠ GitHub CLI (gh) not found — optional, but recommended for GitHub workflows."),
    );
    const shouldInstallGh = await askYesNo("Install GitHub CLI now?", false);
    if (shouldInstallGh) {
      const installedGh = await tryInstallWithAttempts(
        ghInstallAttempts(),
        async () => (await execSilent("gh", ["--version"])) !== null,
      );
      if (installedGh) {
        env.hasGh = true;
        console.log(chalk.green("  ✓ GitHub CLI installed successfully"));
      } else {
        console.log(chalk.yellow("  ⚠ Could not install GitHub CLI automatically."));
      }
    }
  }
  if (!env.ghAuthed && env.hasGh) {
    console.log(chalk.yellow("⚠ GitHub CLI not authenticated — run: gh auth login"));
  }

  return loadConfig(outputPath);
}

/**
 * Add a new project to an existing config.
 * Detects git info, project type, generates rules, appends to config YAML.
 * Returns the project ID that was added.
 */
async function addProjectToConfig(
  config: OrchestratorConfig,
  projectPath: string,
): Promise<string> {
  await ensureGit("adding projects");

  const resolvedPath = resolve(projectPath.replace(/^~/, process.env["HOME"] || ""));
  let projectId = basename(resolvedPath);

  // Avoid overwriting an existing project with the same directory name
  if (config.projects[projectId]) {
    let i = 2;
    while (config.projects[`${projectId}-${i}`]) i++;
    const newId = `${projectId}-${i}`;
    console.log(
      chalk.yellow(`  ⚠ Project "${projectId}" already exists — using "${newId}" instead.`),
    );
    projectId = newId;
  }

  console.log(chalk.dim(`\n  Adding project "${projectId}"...\n`));

  // Validate git repo
  const isGitRepo = (await git(["rev-parse", "--git-dir"], resolvedPath)) !== null;
  if (!isGitRepo) {
    throw new Error(`"${resolvedPath}" is not a git repository.`);
  }

  // Detect git remote
  let ownerRepo: string | null = null;
  const gitRemote = await git(["remote", "get-url", "origin"], resolvedPath);
  if (gitRemote) {
    const match = gitRemote.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/);
    if (match) ownerRepo = match[1];
  }

  const defaultBranch = await detectDefaultBranch(resolvedPath, ownerRepo);

  // Generate unique session prefix
  let prefix = generateSessionPrefix(projectId);
  const existingPrefixes = new Set(
    Object.values(config.projects).map(
      (p) => p.sessionPrefix || generateSessionPrefix(basename(p.path)),
    ),
  );
  if (existingPrefixes.has(prefix)) {
    let i = 2;
    while (existingPrefixes.has(`${prefix}${i}`)) i++;
    prefix = `${prefix}${i}`;
  }

  // Detect project type and generate rules
  const projectType = detectProjectType(resolvedPath);
  const agentRules = generateRulesFromTemplates(projectType);

  // Show what was detected
  console.log(chalk.green(`  ✓ Git repository`));
  if (ownerRepo) {
    console.log(chalk.dim(`    Remote: ${ownerRepo}`));
  }
  console.log(chalk.dim(`    Default branch: ${defaultBranch}`));
  console.log(chalk.dim(`    Session prefix: ${prefix}`));

  if (projectType.languages.length > 0 || projectType.frameworks.length > 0) {
    console.log(chalk.green("  ✓ Project type detected"));
    const formattedType = formatProjectTypeForDisplay(projectType);
    formattedType.split("\n").forEach((line) => {
      console.log(chalk.dim(`    ${line}`));
    });
  }

  // Load raw YAML, append project, rewrite
  const rawYaml = readFileSync(config.configPath, "utf-8");
  const rawConfig = yamlParse(rawYaml);
  if (!rawConfig.projects) rawConfig.projects = {};

  rawConfig.projects[projectId] = {
    name: projectId,
    repo: ownerRepo || "owner/repo",
    path: resolvedPath,
    defaultBranch,
    sessionPrefix: prefix,
    ...(agentRules ? { agentRules } : {}),
  };

  writeFileSync(config.configPath, yamlStringify(rawConfig, { indent: 2 }));
  console.log(chalk.green(`\n✓ Added "${projectId}" to ${config.configPath}\n`));

  if (!ownerRepo) {
    console.log(chalk.yellow("⚠ Could not detect GitHub remote."));
    console.log(chalk.dim("  Update the 'repo' field in the config before spawning agents.\n"));
  }

  return projectId;
}

/**
 * Create config without starting the lifecycle worker or orchestrator.
 * Used by deprecated `ao init` wrapper.
 */
export async function createConfigOnly(): Promise<void> {
  await autoCreateConfig(cwd());
}

/**
 * Ensure tmux is available — interactive install with user consent if missing.
 * Called from runStartup() so ALL ao start
 * paths (normal, URL, retry with existing config) are covered.
 */
function tmuxInstallAttempts(): InstallAttempt[] {
  if (process.platform === "darwin") {
    return [{ cmd: "brew", args: ["install", "tmux"], label: "brew install tmux" }];
  }
  if (process.platform === "linux") {
    return [
      {
        cmd: "sudo",
        args: ["apt-get", "install", "-y", "tmux"],
        label: "sudo apt-get install -y tmux",
      },
      { cmd: "sudo", args: ["dnf", "install", "-y", "tmux"], label: "sudo dnf install -y tmux" },
    ];
  }
  return [];
}

function tmuxInstallHints(): string[] {
  if (process.platform === "darwin") return ["brew install tmux"];
  if (process.platform === "win32")
    return ["# Install WSL first, then inside WSL:", "sudo apt install tmux"];
  return ["sudo apt install tmux      # Debian/Ubuntu", "sudo dnf install tmux      # Fedora/RHEL"];
}

async function ensureTmux(): Promise<void> {
  const hasTmux = (await execSilent("tmux", ["-V"])) !== null;
  if (hasTmux) return;

  console.log(chalk.yellow('⚠ tmux is required for runtime "tmux".'));
  const shouldInstall = await askYesNo("Install tmux now?", true, false);
  if (shouldInstall) {
    const installed = await tryInstallWithAttempts(
      tmuxInstallAttempts(),
      async () => (await execSilent("tmux", ["-V"])) !== null,
    );
    if (installed) {
      console.log(chalk.green("  ✓ tmux installed successfully"));
      return;
    }
  }

  console.error(chalk.red("\n✗ tmux is required but is not installed.\n"));
  console.log(chalk.bold("  Install tmux manually, then re-run ao start:\n"));
  for (const hint of tmuxInstallHints()) {
    console.log(chalk.cyan(`    ${hint}`));
  }
  console.log();
  process.exit(1);
}

/**
 * The liveness of an orchestrator record that `ao start` may reuse.
 * `unchecked`: the record stores no runtime handle (a launch that is not done
 * yet, or an external record), so it is not probed, as in `sm.list`.
 */
type OrchestratorLiveness =
  | { state: "alive" }
  | { state: "unchecked" }
  | { state: "gone"; reason: string }
  | { state: "unknown"; reason: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Defect A (2026-10-22): `sm.list` keeps the stored status when
 * `Runtime.isAlive` rejects, so the record of an orchestrator whose tmux
 * server ended still reads `working`, and `ao start` reused it. `ao start`
 * now asks the runtime itself, with the rule of `isOrchestratorRuntimeAlive`
 * in core: true is alive; false, or a rejection with
 * RUNTIME_NO_SERVER_ERROR_CODE (no server runs at all, so no session can
 * exist), is gone; any other rejection, or an answer that is not a boolean,
 * is unknown. Only a record with a stored handle is probed (the records whose
 * liveness `sm.list` trusts).
 */
async function checkOrchestratorLiveness(
  registry: PluginRegistry,
  config: OrchestratorConfig,
  project: ProjectConfig,
  session: Session,
): Promise<OrchestratorLiveness> {
  const handle = session.runtimeHandle;
  const storedHandle =
    Boolean(session.metadata?.["runtimeHandle"]) || Boolean(session.metadata?.["tmuxName"]?.trim());
  if (!handle || !storedHandle) return { state: "unchecked" };

  const runtimeName = handle.runtimeName || project.runtime || config.defaults.runtime;
  const runtime = registry.get<Runtime>("runtime", runtimeName);
  if (!runtime) {
    return { state: "unknown", reason: `no runtime plugin "${runtimeName}" is loaded` };
  }
  try {
    const alive: unknown = await runtime.isAlive(handle);
    if (alive === true) return { state: "alive" };
    if (alive === false) {
      return { state: "gone", reason: `${runtimeName} answered that ${handle.id} does not exist` };
    }
    return {
      state: "unknown",
      reason: `the liveness check of ${runtimeName} session ${handle.id} answered ${String(alive)}, not true or false`,
    };
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    if (code === RUNTIME_NO_SERVER_ERROR_CODE) {
      return { state: "gone", reason: `no ${runtimeName} server runs (${errorMessage(err)})` };
    }
    return { state: "unknown", reason: errorMessage(err) };
  }
}

/**
 * Shared startup logic: launch the lifecycle worker and orchestrator session.
 * Used by both normal and URL-based start flows.
 */
async function runStartup(
  config: OrchestratorConfig,
  projectId: string,
  project: ProjectConfig,
  opts?: { orchestrator?: boolean },
): Promise<void> {
  // Ensure tmux is available before doing anything — covers all entry paths
  // (normal start, URL start, retry with existing config)
  const runtime = config.defaults?.runtime ?? "tmux";
  if (runtime === "tmux") {
    await ensureTmux();
  }

  const sessionId = `${project.sessionPrefix}-orchestrator`;
  const shouldStartLifecycle = opts?.orchestrator !== false;
  let lifecycleStatus: Awaited<ReturnType<typeof ensureLifecycleWorker>> | null = null;
  const orchestratorSessionStrategy = normalizeOrchestratorSessionStrategy(
    project.orchestratorSessionStrategy,
  );

  console.log(chalk.bold(`\nStarting orchestrator for ${chalk.cyan(project.name)}\n`));

  const spinner = ora();
  let reused = false;

  if (shouldStartLifecycle) {
    try {
      spinner.start("Starting lifecycle worker");
      lifecycleStatus = await ensureLifecycleWorker(config, projectId);
      spinner.succeed(
        lifecycleStatus.started
          ? `Lifecycle worker started${lifecycleStatus.pid ? ` (PID ${lifecycleStatus.pid})` : ""}`
          : `Lifecycle worker already running${lifecycleStatus.pid ? ` (PID ${lifecycleStatus.pid})` : ""}`,
      );
    } catch (err) {
      spinner.fail("Lifecycle worker failed to start");
      throw new Error(
        `Failed to start lifecycle worker: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  // Create orchestrator session (unless --no-orchestrator or existing orchestrators found)
  let selectedOrchestratorId: string | null = null;

  if (opts?.orchestrator !== false) {
    const sm = await getSessionManager(config);

    // Check for existing orchestrator sessions for this project
    let allSessions;
    try {
      allSessions = await sm.list(projectId);
    } catch (err) {
      spinner.fail("Failed to list sessions");
      throw new Error(
        `Failed to list sessions: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const allSessionPrefixes = Object.entries(config.projects).map(
      ([, p]) => p.sessionPrefix ?? generateSessionPrefix(p.name ?? ""),
    );
    const candidates = allSessions.filter(
      (s) =>
        isOrchestratorSession(s, project.sessionPrefix ?? projectId, allSessionPrefixes) &&
        !isTerminalSession(s),
    );

    // Defect A: a candidate is reused only when it is alive (or unchecked, as
    // before); a gone one is left to `spawnOrchestrator`, which archives or
    // replaces its record (project mode) or starts the next ID (isolated
    // mode). An unknown one stops the start: it may still run.
    const registry = candidates.length > 0 ? await getPluginRegistry(config) : null;
    const checked = registry
      ? await Promise.all(
          candidates.map(async (session) => ({
            session,
            liveness: await checkOrchestratorLiveness(registry, config, project, session),
          })),
        )
      : [];
    const existingOrchestrators = checked
      .filter((c) => c.liveness.state === "alive" || c.liveness.state === "unchecked")
      .map((c) => c.session);
    const unknownOrchestrators = checked.flatMap((c) =>
      c.liveness.state === "unknown"
        ? [
            `Cannot tell whether orchestrator session ${c.session.id} is alive (${c.liveness.reason}).`,
          ]
        : [],
    );

    if (existingOrchestrators.length === 0 && unknownOrchestrators.length > 0) {
      spinner.fail("Orchestrator liveness unknown");
      throw new Error(
        [
          ...unknownOrchestrators,
          `${unknownOrchestrators.length === 1 ? "It is" : "They are"} neither reused nor replaced, ` +
            "and no new orchestrator was started. Check the runtime and run `ao start` again.",
        ].join(" "),
      );
    }
    if (existingOrchestrators.length === 0) {
      for (const c of checked) {
        if (c.liveness.state === "gone") {
          spinner.info(
            `Orchestrator session ${c.session.id} does not run: ${c.liveness.reason}. Starting a new one.`,
          );
        }
      }
    }

    if (existingOrchestrators.length > 0) {
      // Existing orchestrators found — use the most recently active one.
      const sortedOrchestrators = [...existingOrchestrators].sort(
        (a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0),
      );
      const selected = sortedOrchestrators[0];
      selectedOrchestratorId = selected.id;
      spinner.succeed(
        `Using existing orchestrator session: ${selected.id}` +
          (existingOrchestrators.length > 1
            ? ` (${existingOrchestrators.length - 1} other session(s) available)`
            : ""),
      );
    } else {
      // No existing orchestrators — spawn a new one
      try {
        spinner.start("Creating orchestrator session");
        const systemPrompt = generateOrchestratorPrompt({ config, projectId, project });
        const session = await sm.spawnOrchestrator({ projectId, systemPrompt });
        selectedOrchestratorId = session.id;
        reused =
          orchestratorSessionStrategy === "reuse" &&
          session.metadata?.["orchestratorSessionReused"] === "true";
        spinner.succeed(reused ? "Orchestrator session reused" : "Orchestrator session created");
      } catch (err) {
        spinner.fail("Orchestrator setup failed");
        throw new Error(
          `Failed to setup orchestrator: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
  }

  // Print summary
  console.log(chalk.bold.green("\n✓ Startup complete\n"));

  if (shouldStartLifecycle && lifecycleStatus) {
    const lifecycleLabel = lifecycleStatus.started ? "started" : "already running";
    const lifecycleTarget = lifecycleStatus.pid
      ? `${lifecycleLabel} (PID ${lifecycleStatus.pid})`
      : lifecycleLabel;
    console.log(chalk.cyan("Lifecycle:"), lifecycleTarget);
  }

  if (opts?.orchestrator !== false && !reused) {
    const orchSessionId = selectedOrchestratorId ?? sessionId;
    console.log(chalk.cyan("Orchestrator:"), `ao session attach ${orchSessionId}`);
  } else if (reused) {
    console.log(chalk.cyan("Orchestrator:"), `reused existing session (${sessionId})`);
  }

  console.log(chalk.dim(`Config: ${config.configPath}`));
}

// =============================================================================
// COMMAND REGISTRATION
// =============================================================================

export function registerStart(program: Command): void {
  program
    .command("start [project]")
    .description(
      "Start the orchestrator agent (auto-creates config on first run, adds projects by path/URL)",
    )
    .addOption(new Option("--no-dashboard").hideHelp())
    .option("--no-orchestrator", "Skip starting the orchestrator agent")
    .option("--interactive", "Prompt to configure config settings")
    .action(
      async (
        projectArg?: string,
        opts?: {
          orchestrator?: boolean;
          interactive?: boolean;
        },
      ) => {
        try {
          let config: OrchestratorConfig;
          let projectId: string;
          let project: ProjectConfig;

          if (projectArg && isRepoUrl(projectArg)) {
            // ── URL argument: clone + auto-config + start ──
            console.log(chalk.bold.cyan("\n  Agent Orchestrator — Quick Start\n"));
            const result = await handleUrlStart(projectArg);
            config = result.config;
            ({ projectId, project } = await resolveProjectByRepo(config, result.parsed));
          } else if (projectArg && isLocalPath(projectArg)) {
            // ── Path argument: add project if new, then start ──
            const resolvedPath = resolve(projectArg.replace(/^~/, process.env["HOME"] || ""));

            // Try to load existing config
            let configPath: string | undefined;
            try {
              configPath = findConfigFile() ?? undefined;
            } catch {
              // No config found — create one first
            }

            if (!configPath) {
              // No config anywhere — auto-create in cwd, then add the path as project
              config = await autoCreateConfig(cwd());
              // If the path is different from cwd, add it as a second project
              if (resolve(cwd()) !== resolvedPath) {
                const addedId = await addProjectToConfig(config, resolvedPath);
                config = loadConfig(config.configPath);
                projectId = addedId;
                project = config.projects[projectId];
              } else {
                ({ projectId, project } = await resolveProject(config));
              }
            } else {
              config = loadConfig(configPath);

              // Check if project is already in config (match by path)
              const existingEntry = Object.entries(config.projects).find(
                ([, p]) =>
                  resolve(p.path.replace(/^~/, process.env["HOME"] || "")) === resolvedPath,
              );

              if (existingEntry) {
                // Already in config — just start it
                projectId = existingEntry[0];
                project = existingEntry[1];
              } else {
                // New project — add it to config
                const addedId = await addProjectToConfig(config, resolvedPath);
                config = loadConfig(config.configPath);
                projectId = addedId;
                project = config.projects[projectId];
              }
            }
          } else {
            // ── No arg or project ID: load config or auto-create ──
            let loadedConfig: OrchestratorConfig | null = null;
            try {
              loadedConfig = loadConfig();
            } catch (err) {
              if (err instanceof ConfigNotFoundError) {
                // First run — auto-create config
                loadedConfig = await autoCreateConfig(cwd());
              } else {
                throw err;
              }
            }
            config = loadedConfig;
            ({ projectId, project } = await resolveProject(config, projectArg));
          }

          // ── Agent selection prompt ──
          const agentOverride = opts?.interactive ? await promptAgentSelection() : null;
          if (agentOverride) {
            const { orchestratorAgent, workerAgent } = agentOverride;

            const rawYaml = readFileSync(config.configPath, "utf-8");
            const rawConfig = yamlParse(rawYaml);
            const proj = rawConfig.projects[projectId];
            proj.orchestrator = { ...(proj.orchestrator ?? {}), agent: orchestratorAgent };
            proj.worker = { ...(proj.worker ?? {}), agent: workerAgent };
            writeFileSync(config.configPath, yamlStringify(rawConfig, { indent: 2 }));
            console.log(chalk.dim(`  ✓ Saved to ${config.configPath}\n`));

            config = loadConfig(config.configPath);
            project = config.projects[projectId];
          }

          await runStartup(config, projectId, project, opts);
        } catch (err) {
          if (err instanceof Error) {
            console.error(chalk.red("\nError:"), err.message);
          } else {
            console.error(chalk.red("\nError:"), String(err));
          }
          process.exit(1);
        }
      },
    );
}

/**
 * Check if arg looks like a local path (not a project ID).
 * Paths contain / or ~ or . at the start.
 */
function isLocalPath(arg: string): boolean {
  return arg.startsWith("/") || arg.startsWith("~") || arg.startsWith("./") || arg.startsWith("..");
}

interface StopOptions {
  purgeSession?: boolean;
  /** Set only on the detached `ao stop` (defect B). */
  detachedStopProcess?: boolean;
}

/** The hidden flag of the `ao stop` that runs in the detached process (defect B). */
const DETACHED_STOP_FLAG = "--detached-stop-process";

/** How often the caller looks for new output of the detached stop. */
const DETACHED_STOP_RELAY_MS = 100;

/** After Ctrl-C, how long the caller waits for its note to be written. */
const DETACHED_STOP_NOTE_MS = 2_000;

/** When the detached stop still runs after this, the caller writes one progress note. */
const DETACHED_STOP_PROGRESS_MS = 30_000;

/** Writes `data` to `out`; resolves when `out` has taken it, rejects on an output error. */
function writeOut(out: NodeJS.WriteStream, data: string | Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    out.write(data, (err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

/** Copies one log of the detached stop to `out`. */
interface LogRelay {
  /**
   * Copies what the log gained since the last copy. Each chunk is written,
   * and its write has ended, before the next chunk is read (backpressure).
   */
  copy(): Promise<void>;
  /**
   * Writes `text` to `out` between two chunk writes, and only when `due()`
   * still answers true at that time. An output error of this write becomes
   * `outputError`. Resolves false when `out` has an output error, else true.
   */
  write(text: string, due: () => boolean): Promise<boolean>;
  close(): void;
  /** The first error of `out` (EPIPE, for example); nothing more goes to `out` after it. */
  readonly outputError: unknown;
}

function logRelay(file: string, out: NodeJS.WriteStream): LogRelay {
  let fd: number | null = null;
  let offset = 0;
  let outputError: unknown = null;
  const chunk = Buffer.alloc(64 * 1024);
  // One write to `out` at a time, in the order asked. A text of `write` thus
  // goes between two chunks, never into one. A chunk ends where the log ended
  // when it was read, not at the end of a line, so the text can split a line.
  let turns: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(task: () => Promise<T>): Promise<T> => {
    const result = turns.then(task);
    turns = result.catch(() => {}); // The caller of inTurn gets the rejection.
    return result;
  };
  const send = async (data: string | Uint8Array): Promise<void> => {
    try {
      await writeOut(out, data);
    } catch (err) {
      outputError = err;
    }
  };
  /** Copies one chunk; resolves false when there is nothing more to copy now. */
  const copyChunk = async (): Promise<boolean> => {
    if (outputError !== null) return false;
    let read: number;
    try {
      fd ??= openSync(file, "r");
      read = readSync(fd, chunk, 0, chunk.length, offset);
    } catch {
      return false; // The next copy tries again; the log stays for the operator.
    }
    if (read <= 0) return false;
    offset += read;
    await send(Buffer.from(chunk.subarray(0, read)));
    return outputError === null;
  };
  return {
    get outputError(): unknown {
      return outputError;
    },
    async copy(): Promise<void> {
      let more = true;
      while (more) more = await inTurn(copyChunk);
    },
    write(text: string, due: () => boolean): Promise<boolean> {
      return inTurn(async () => {
        if (outputError === null && due()) await send(text);
        return outputError === null;
      });
    },
    close(): void {
      if (fd !== null) closeSync(fd);
    },
  };
}

/** Resolves when `promise` settles or after `ms`, whichever comes first. */
function settledOrAfter(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const settled = (): void => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(settled, settled);
  });
}

/**
 * Copy the logs of the detached stop through `relays` while the stop runs,
 * and all the rest after it ends (review r2 M-1: a slow reader gets every
 * byte, and no output is still queued when this returns). The stderr relay
 * comes first, as the stop writes its stderr lines (the spinner, a refusal)
 * before its stdout lines. When the stop still runs after
 * DETACHED_STOP_PROGRESS_MS, `onStillRunning` runs once, at that time, also
 * while a copy waits for a slow reader (review r4 m-2); its `running`
 * answers false from when this sees the end of the stop. Resolves with its
 * exit code (null after a signal); rejects when it did not start.
 */
async function relayDetachedStop(
  stop: DetachedStop,
  relays: LogRelay[],
  onStillRunning: (running: () => boolean) => Promise<void>,
): Promise<number | null> {
  let ended = false;
  const end = stop.done.then(
    () => {
      ended = true;
    },
    () => {
      ended = true;
    },
  );
  let progress: Promise<void> = Promise.resolve();
  const progressTimer = setTimeout(() => {
    progress = onStillRunning(() => !ended);
  }, DETACHED_STOP_PROGRESS_MS);
  try {
    for (;;) {
      // A copy that starts after the end reads each log to its last byte.
      const last = ended;
      for (const relay of relays) await relay.copy();
      if (last) break;
      await settledOrAfter(end, DETACHED_STOP_RELAY_MS);
    }
  } finally {
    clearTimeout(progressTimer);
    // A write of the note that has not started by now finds `running` false.
    await progress;
    relays.forEach((relay) => relay.close());
  }
  return await stop.done;
}

/**
 * Defect B (2026-10-22), review r1 M-1 and M-2: the stop of an existing
 * orchestrator record runs in a detached process, from every caller. A kill
 * hangs up every pane of the killed session, and the hangup ends an `ao stop`
 * that runs in one of them after the kill and before the archive and the
 * lifecycle stop. A check of where the caller runs could read "outside"
 * wrongly (an empty tmux answer, no TMUX_PANE) or wait without a bound, so
 * there is none. The detached process runs the stop that ran here before:
 * kill, archive, then the lifecycle stop (only after a confirmed kill,
 * same-ID R2a). When the kill hangs up this process, the detached one goes on.
 *
 * This process copies the detached stdout and stderr to its own while the
 * stop runs, all of it before this returns, and returns the detached exit
 * code (1 after a signal or when it did not start). An error of this
 * process's own output (EPIPE when the reader closed, for example) ends the
 * copy to that stream only: it is reported on the other stream, the logs keep
 * the output, and the exit code stays the detached one. Ctrl-C ends this
 * process (exit 130) as soon as its note is written: the stop goes on, the
 * note names the detached PID and the logs, and output that a slow reader has
 * not taken yet is dropped (the logs keep it). The wait has no deadline, as
 * the result of the stop is not known before it ends: when the stop still
 * runs after DETACHED_STOP_PROGRESS_MS, this process writes one note that
 * names the detached PID and the logs, and that Ctrl-C leaves the stop running.
 */
async function stopInDetachedProcess(
  config: OrchestratorConfig,
  projectId: string,
  purgeSession: boolean,
): Promise<number> {
  const stop = startDetachedStop(config, projectId, [
    "stop",
    projectId,
    ...(purgeSession ? ["--purge-session"] : []),
    DETACHED_STOP_FLAG,
  ]);
  const logs = `${stop.stdoutLog} and ${stop.stderrLog}`;
  // Ctrl-C: exit 130 when the note is written (it waits behind at most one
  // relayed chunk or the progress note), or after DETACHED_STOP_NOTE_MS when
  // the reader does not take it. A second Ctrl-C ends this process at once
  // (the handler is gone).
  const onInterrupt = (): void => {
    const exit = (): void => {
      clearTimeout(timer);
      process.exit(130);
    };
    const timer = setTimeout(exit, DETACHED_STOP_NOTE_MS);
    process.stderr.write(
      `\nao stop: the stop goes on in the detached process${stop.pid ? ` (PID ${stop.pid})` : ""}; ` +
        `its output: ${logs}\n`,
      exit,
    );
  };
  // An output error reaches the relay through the write callback. Without a
  // listener, the "error" event of the stream would end this process.
  const onOutputError = (): void => {};
  process.once("SIGINT", onInterrupt);
  process.stdout.on("error", onOutputError);
  process.stderr.on("error", onOutputError);

  try {
    const stderrRelay = logRelay(stop.stderrLog, process.stderr);
    const stdoutRelay = logRelay(stop.stdoutLog, process.stdout);
    // The note goes to stderr, or to stdout when stderr has an output error,
    // also one that the note's own write finds (review r4 m-1). The relay
    // keeps that error and reports it at the end.
    const stillRunning = async (running: () => boolean): Promise<void> => {
      const note =
        `ao stop: the stop still runs in the detached process${stop.pid ? ` (PID ${stop.pid})` : ""} ` +
        `after ${DETACHED_STOP_PROGRESS_MS / 1_000} s; Ctrl-C leaves it running; its output: ${logs}\n`;
      if (!(await stderrRelay.write(note, running))) await stdoutRelay.write(note, running);
    };
    let code: number;
    let message = "";
    try {
      const result = await relayDetachedStop(stop, [stderrRelay, stdoutRelay], stillRunning);
      code = result ?? 1;
      if (result === null) {
        message = `The detached stop was ended by a signal; its output: ${logs}`;
      }
    } catch (err) {
      code = 1;
      message =
        `The detached stop did not start (${errorMessage(err)}); nothing was stopped. ` +
        `Check that this ao can run, then run \`ao stop ${projectId}\` again.`;
    }
    // The stop has ended, so its Ctrl-C note would be false: Ctrl-C now ends
    // this process as usual.
    process.removeListener("SIGINT", onInterrupt);

    const lines: string[] = [];
    for (const [relay, name, log] of [
      [stdoutRelay, "stdout", stop.stdoutLog],
      [stderrRelay, "stderr", stop.stderrLog],
    ] as const) {
      if (relay.outputError !== null) {
        lines.push(
          chalk.yellow(
            `ao stop: could not write the ${name} of the detached stop ` +
              `(${errorMessage(relay.outputError)}); all of it is in ${log}`,
          ),
        );
      }
    }
    if (message) lines.push(chalk.red(`\n${message}`));
    const target =
      stderrRelay.outputError === null
        ? process.stderr
        : stdoutRelay.outputError === null
          ? process.stdout
          : null;
    if (lines.length > 0 && target) {
      try {
        await writeOut(target, `${lines.join("\n")}\n`);
      } catch {
        // Nothing more can be printed; the exit code still tells the result.
      }
    }
    return code;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    // An "error" event comes after the write callback: let it reach the listener.
    await new Promise((resolve) => setImmediate(resolve));
    process.stdout.removeListener("error", onOutputError);
    process.stderr.removeListener("error", onOutputError);
  }
}

export function registerStop(program: Command): void {
  program
    .command("stop [project]")
    .description("Stop the orchestrator agent and lifecycle worker")
    .option("--purge-session", "Delete mapped OpenCode session when stopping")
    .addOption(new Option(DETACHED_STOP_FLAG).hideHelp())
    .action(async (projectArg?: string, opts: StopOptions = {}) => {
      let retry = "ao stop";
      try {
        const config = loadConfig();
        const { projectId: _projectId, project } = await resolveProject(config, projectArg, "stop");
        const sessionId = `${project.sessionPrefix}-orchestrator`;
        retry = `ao stop ${_projectId}`;
        const inDetachedProcess = opts.detachedStopProcess === true;

        // The detached process prints no heading: its caller printed it.
        if (!inDetachedProcess) {
          console.log(chalk.bold(`\nStopping orchestrator for ${chalk.cyan(project.name)}\n`));
        }

        // Kill orchestrator session via SessionManager
        const sm = await getSessionManager(config);
        const existing = await sm.get(sessionId);

        // Defect B: the kill, the archive and the lifecycle stop of an
        // existing record run in the detached process (this command with
        // DETACHED_STOP_FLAG), never in the caller.
        // Review r2 M-1: the exit code is set, not passed to process.exit, so
        // the process ends only after its stdout and stderr took every byte.
        if (existing && !inDetachedProcess) {
          const code = await stopInDetachedProcess(config, _projectId, opts.purgeSession === true);
          if (code !== 0) process.exitCode = code;
          return;
        }

        if (existing) {
          const spinner = ora("Stopping orchestrator session").start();
          const purgeOpenCode = opts?.purgeSession === true;
          try {
            await sm.kill(sessionId, { purgeOpenCode });
          } catch (err) {
            spinner.fail("Orchestrator session not stopped");
            throw err;
          }
          spinner.succeed("Orchestrator session stopped");
        } else {
          console.log(chalk.yellow(`Orchestrator session "${sessionId}" is not running`));
        }

        const lifecycleStopped = await stopLifecycleWorker(config, _projectId);
        if (lifecycleStopped) {
          console.log(chalk.green("Lifecycle worker stopped"));
        } else {
          console.log(chalk.yellow("Lifecycle worker not running"));
        }

        console.log(chalk.bold.green("\n✓ Orchestrator stopped\n"));
        console.log(chalk.dim(`  Projects: ${Object.keys(config.projects).join(", ")}\n`));
      } catch (err) {
        if (isRuntimeStopUnconfirmedError(err)) {
          // Same-ID R2a (review r1, F-3): the refusal names the outcome, its
          // detail and the next action, as `ao session kill` does. The
          // lifecycle worker stays as it is while the orchestrator may run.
          console.error(
            chalk.red(`\nFailed to stop orchestrator session ${err.sessionId}: ${err.message}`),
          );
          const hint = typeof err.hintFor === "function" ? err.hintFor(retry) : err.hint;
          console.error(chalk.yellow(`Next: ${hint}`));
          console.error(chalk.dim("The lifecycle worker was not stopped."));
          process.exit(1);
        }
        if (err instanceof Error) {
          console.error(chalk.red("\nError:"), err.message);
        } else {
          console.error(chalk.red("\nError:"), String(err));
        }
        process.exit(1);
      }
    });
}
