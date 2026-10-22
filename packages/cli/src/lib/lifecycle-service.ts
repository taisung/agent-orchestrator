import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getProjectBaseDir, getStateRoot, type OrchestratorConfig } from "@aoagents/ao-core";

const LIFECYCLE_PID_FILE = "lifecycle-worker.pid";
const LIFECYCLE_LOG_FILE = "lifecycle-worker.log";
/** The logs of one detached stop: `orchestrator-stop-<time>-<caller PID>-<random>.{stdout,stderr}.log`. */
const DETACHED_STOP_LOG_PREFIX = "orchestrator-stop-";
/** Only the names that startDetachedStop makes (review r2 m-1). */
const DETACHED_STOP_LOG_PATTERN =
  /^orchestrator-stop-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+-[0-9a-f]{8}\.(?:stdout|stderr)\.log$/;
/** Logs of detached stops older than this are removed when the next one starts. */
const DETACHED_STOP_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_START_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;

export interface LifecycleWorkerStatus {
  running: boolean;
  pid: number | null;
  pidFile: string;
  logFile: string;
}

function getProjectBase(config: OrchestratorConfig, projectId: string): string {
  const project = config.projects[projectId];
  if (!project) {
    throw new Error(`Unknown project: ${projectId}`);
  }
  return getProjectBaseDir(config.configPath, project.path);
}

export function getLifecyclePidFile(config: OrchestratorConfig, projectId: string): string {
  return join(getProjectBase(config, projectId), LIFECYCLE_PID_FILE);
}

export function getLifecycleLogFile(config: OrchestratorConfig, projectId: string): string {
  return join(getProjectBase(config, projectId), LIFECYCLE_LOG_FILE);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

function readPid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;

  try {
    const raw = readFileSync(pidFile, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function writeLifecycleWorkerPid(
  config: OrchestratorConfig,
  projectId: string,
  pid: number,
): void {
  const pidFile = getLifecyclePidFile(config, projectId);
  mkdirSync(getProjectBase(config, projectId), { recursive: true });
  writeFileSync(pidFile, `${pid}\n`, "utf-8");
}

export function clearLifecycleWorkerPid(
  config: OrchestratorConfig,
  projectId: string,
  pid?: number,
): void {
  const pidFile = getLifecyclePidFile(config, projectId);
  if (!existsSync(pidFile)) return;

  if (pid !== undefined) {
    const currentPid = readPid(pidFile);
    if (currentPid !== null && currentPid !== pid) {
      return;
    }
  }

  try {
    unlinkSync(pidFile);
  } catch {
    // Best effort cleanup
  }
}

export function getLifecycleWorkerStatus(
  config: OrchestratorConfig,
  projectId: string,
): LifecycleWorkerStatus {
  const pidFile = getLifecyclePidFile(config, projectId);
  const logFile = getLifecycleLogFile(config, projectId);
  const pid = readPid(pidFile);

  if (pid !== null && isProcessRunning(pid)) {
    return { running: true, pid, pidFile, logFile };
  }

  if (pid !== null) {
    clearLifecycleWorkerPid(config, projectId, pid);
  }

  return { running: false, pid: null, pidFile, logFile };
}

/** The command that runs this ao CLI again with `aoArgs`. */
function resolveAoLaunch(aoArgs: string[]): { command: string; args: string[] } {
  const entry = process.argv[1];

  if (entry && /\.(?:c|m)?js$/i.test(entry)) {
    return {
      command: process.execPath,
      args: [entry, ...aoArgs],
    };
  }

  if (entry && /\.ts$/i.test(entry)) {
    return {
      command: "npx",
      args: ["tsx", entry, ...aoArgs],
    };
  }

  return {
    command: "ao",
    args: aoArgs,
  };
}

function resolveLifecycleWorkerLaunch(projectId: string): { command: string; args: string[] } {
  return resolveAoLaunch(["lifecycle-worker", projectId]);
}

async function waitForLifecycleWorker(
  config: OrchestratorConfig,
  projectId: string,
  timeoutMs = DEFAULT_START_TIMEOUT_MS,
): Promise<LifecycleWorkerStatus> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = getLifecycleWorkerStatus(config, projectId);
    if (status.running) {
      return status;
    }
    await sleep(100);
  }

  return getLifecycleWorkerStatus(config, projectId);
}

export async function ensureLifecycleWorker(
  config: OrchestratorConfig,
  projectId: string,
): Promise<LifecycleWorkerStatus & { started: boolean }> {
  const current = getLifecycleWorkerStatus(config, projectId);
  if (current.running) {
    return { ...current, started: false };
  }

  const baseDir = getProjectBase(config, projectId);
  const logFile = getLifecycleLogFile(config, projectId);
  mkdirSync(baseDir, { recursive: true });

  const stdoutFd = openSync(logFile, "a");
  const stderrFd = openSync(logFile, "a");

  try {
    const launch = resolveLifecycleWorkerLaunch(projectId);
    const child = spawn(launch.command, launch.args, {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      env: {
        ...process.env,
        AO_LIFECYCLE_PROJECT: projectId,
        AO_CONFIG_PATH: config.configPath,
        AO_STATE_ROOT: getStateRoot(),
      },
    });

    child.unref();

    // Write PID from the parent immediately after spawn to close the TOCTOU
    // window: without this, a second concurrent `ensureLifecycleWorker` call
    // could pass the "not running" check before the child writes its own PID.
    if (child.pid) {
      writeLifecycleWorkerPid(config, projectId, child.pid);
    }
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  const status = await waitForLifecycleWorker(config, projectId);
  if (!status.running) {
    throw new Error(
      `Lifecycle worker failed to start for project ${projectId}. See ${status.logFile}`,
    );
  }

  return { ...status, started: true };
}

/** A detached `ao stop`: its PID, its two log files, and its end. */
export interface DetachedStop {
  pid: number | null;
  /** Its stdout, in a file of this stop only. */
  stdoutLog: string;
  /** Its stderr, in a file of this stop only. */
  stderrLog: string;
  /** The exit code (null after a signal); rejects when the process did not start. */
  done: Promise<number | null>;
}

/**
 * Remove the logs of detached stops that are older than the max age: only
 * regular files (lstat, so a symlink is never removed or followed) with a
 * name that startDetachedStop makes. Best effort.
 */
function pruneDetachedStopLogs(baseDir: string): void {
  let names: string[];
  try {
    names = readdirSync(baseDir);
  } catch {
    return;
  }
  const oldest = Date.now() - DETACHED_STOP_LOG_MAX_AGE_MS;
  for (const name of names) {
    if (!DETACHED_STOP_LOG_PATTERN.test(name)) continue;
    const path = join(baseDir, name);
    try {
      const stat = lstatSync(path);
      if (stat.isFile() && stat.mtimeMs < oldest) unlinkSync(path);
    } catch {
      // Another stop removed it, or it cannot be read: leave it.
    }
  }
}

/**
 * Run `ao <aoArgs>` (an `ao stop`) in a detached process: its own session
 * with no controlling terminal, stdin closed, and its stdout and stderr in
 * logs of its own (`orchestrator-stop-<time>-<caller PID>-<random>.stdout.log`
 * and `.stderr.log` in the project base directory, created exclusively, so
 * two stops never share one; such logs older than 7 days are removed first). A
 * hangup of the caller's terminal does not reach it. `ao stop` runs the stop of every existing orchestrator record
 * this way (defect B, 2026-10-22). The child gets the config path and the
 * state root of this process, so it reads the same files, and the rest of
 * this environment (TMUX and PATH too), so its runtime calls reach the same
 * server.
 */
export function startDetachedStop(
  config: OrchestratorConfig,
  projectId: string,
  aoArgs: string[],
): DetachedStop {
  const baseDir = getProjectBase(config, projectId);
  mkdirSync(baseDir, { recursive: true });
  pruneDetachedStopLogs(baseDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const unique = `${stamp}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const stdoutLog = join(baseDir, `${DETACHED_STOP_LOG_PREFIX}${unique}.stdout.log`);
  const stderrLog = join(baseDir, `${DETACHED_STOP_LOG_PREFIX}${unique}.stderr.log`);

  const stdoutFd = openSync(stdoutLog, "wx");
  let stderrFd: number | null = null;
  let child: ReturnType<typeof spawn>;
  try {
    stderrFd = openSync(stderrLog, "wx");
    const launch = resolveAoLaunch(aoArgs);
    child = spawn(launch.command, launch.args, {
      cwd: dirname(config.configPath),
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      env: {
        ...process.env,
        AO_CONFIG_PATH: config.configPath,
        AO_STATE_ROOT: getStateRoot(),
      },
    });
  } finally {
    closeSync(stdoutFd);
    if (stderrFd !== null) closeSync(stderrFd);
  }

  const done = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code: number | null) => resolve(code));
  });
  return { pid: child.pid ?? null, stdoutLog, stderrLog, done };
}

export async function stopLifecycleWorker(
  config: OrchestratorConfig,
  projectId: string,
): Promise<boolean> {
  const status = getLifecycleWorkerStatus(config, projectId);
  if (!status.running || status.pid === null) {
    clearLifecycleWorkerPid(config, projectId);
    return false;
  }

  try {
    process.kill(status.pid, "SIGTERM");
  } catch {
    clearLifecycleWorkerPid(config, projectId, status.pid);
    return false;
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessRunning(status.pid)) {
      clearLifecycleWorkerPid(config, projectId, status.pid);
      return true;
    }
    await sleep(100);
  }

  try {
    process.kill(status.pid, "SIGKILL");
  } catch {
    // Best effort hard stop
  }

  clearLifecycleWorkerPid(config, projectId, status.pid);
  return true;
}
