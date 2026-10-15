import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeCreateConfig, RuntimeHandle } from "../../types.js";

export interface MockApiSession {
  id: string;
  title: string;
  updatedAt?: number;
  /** `time.created` in epoch ms; defaults to `updatedAt`, then 0. */
  createdAt?: number;
  /** `location.directory`; the record has no `location` when absent. */
  directory?: string;
}

export interface MockApiOptions {
  deleteLogPath?: string;
  interruptLogPath?: string;
  apiLogPath?: string;
  /** Every `api` call blocks this long before it answers (hanging binary). */
  apiDelaySeconds?: number;
  /** Operations that fail with `HTTP 500` and exit 1, e.g. `["session.get"]`. */
  failOperations?: string[];
  /** The `interrupted` value that `session.interrupt` answers (default false). */
  interrupted?: boolean;
  binName?: string;
}

/**
 * Install a mock `opencode` that speaks the 2.x API used by I-2
 * (`opencode api session.get/list/remove/interrupt`), with the answer shapes
 * of the real 2.0.29 binary (measured on an isolated store):
 * - `session.get`/`remove`/`interrupt` answer 404 for an unknown ID
 *   (stdout `{"_tag":"SessionNotFoundError",...}`, stderr 404, exit 1).
 * - `session.list` filters `search` as a substring of the title and
 *   `directory` as an exact `location.directory`, orders newest first by
 *   `time.created`, honors `limit`, and pages with `cursor.next`: every
 *   non-empty page has a `next` cursor (also a short last page), and the page
 *   after the last one is empty with no `next`.
 * - `session.remove` prints nothing (204), appends to the delete log and
 *   removes the session, so a second remove answers 404.
 * - `session.interrupt` prints the top-level `{"interrupted":false}` and
 *   appends to the interrupt log (or to the delete log when no interrupt log
 *   is given).
 * - `apiLogPath` gets one JSON argv line per call, written before any delay.
 * - `apiDelaySeconds` blocks the mock process itself (no `sleep` child), so a
 *   timeout kill leaves no orphan process.
 *
 * The mock reads its config (sessions, logs, delay) from `config.json` next to
 * the script on every call, so a test can add a session while a spawn runs
 * (`addMockApiSession`), and no process env leaks between tests.
 */
export function installMockOpencodeApi(
  tmpDir: string,
  sessions: MockApiSession[],
  options?: MockApiOptions,
): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const binDir = join(tmpDir, options?.binName ?? `mock-bin-${unique}`);
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "opencode");
  writeMockConfig(binDir, {
    sessions,
    deleteLogPath: options?.deleteLogPath ?? null,
    interruptLogPath: options?.interruptLogPath ?? null,
    apiLogPath: options?.apiLogPath ?? null,
    apiDelaySeconds: options?.apiDelaySeconds ?? 0,
    failOperations: options?.failOperations ?? [],
    interrupted: options?.interrupted ?? false,
  });
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const configPath = path.join(__dirname, "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const sessions = config.sessions || [];
if (config.apiLogPath) {
  fs.appendFileSync(config.apiLogPath, JSON.stringify(argv) + "\\n");
}
if (config.apiDelaySeconds > 0) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, config.apiDelaySeconds * 1000);
}
const params = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--param" && i + 1 < argv.length) {
    const raw = argv[i + 1];
    const eq = raw.indexOf("=");
    if (eq !== -1) params[raw.slice(0, eq)] = raw.slice(eq + 1);
    i++;
  }
}
const created = (s) => (s.createdAt !== undefined ? s.createdAt : s.updatedAt !== undefined ? s.updatedAt : 0);
const apiRecord = (s) => ({
  id: s.id,
  title: s.title,
  time: { created: created(s), ...(s.updatedAt !== undefined ? { updated: s.updatedAt } : {}) },
  ...(s.directory !== undefined ? { location: { directory: s.directory } } : {}),
});
const notFound = (id) => {
  process.stdout.write(JSON.stringify({ _tag: "SessionNotFoundError", sessionID: id, message: "Session not found: " + id }) + "\\n");
  process.stderr.write("HTTP 404 Not Found\\n");
  process.exit(1);
};
const writeConfig = (next) => {
  const tmp = configPath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, configPath);
};
if (argv[0] !== "api") { process.stderr.write("unexpected: " + argv.join(" ") + "\\n"); process.exit(1); }
const op = argv[1];
if ((config.failOperations || []).includes(op)) {
  process.stderr.write("HTTP 500 Internal Server Error\\n");
  process.exit(1);
}
if (op === "session.get") {
  const found = sessions.find((s) => s.id === params.sessionID);
  if (!found) notFound(params.sessionID);
  process.stdout.write(JSON.stringify({ data: apiRecord(found) }) + "\\n");
  process.exit(0);
}
if (op === "session.list") {
  const search = params.search || "";
  const matched = sessions
    .filter((s) => !search || (s.title || "").includes(search))
    .filter((s) => params.directory === undefined || s.directory === params.directory)
    .sort((a, b) => created(b) - created(a));
  const offset = params.cursor ? JSON.parse(Buffer.from(params.cursor, "base64url").toString("utf-8")).offset : 0;
  const limit = params.limit ? Number.parseInt(params.limit, 10) : matched.length;
  const page = matched.slice(offset, offset + limit);
  const cursor = page.length > 0
    ? { next: Buffer.from(JSON.stringify({ offset: offset + page.length })).toString("base64url") }
    : {};
  process.stdout.write(JSON.stringify({ data: page.map(apiRecord), cursor }) + "\\n");
  process.exit(0);
}
if (op === "session.remove") {
  if (config.deleteLogPath) {
    fs.appendFileSync(config.deleteLogPath, argv.join(" ") + "\\n");
  }
  const found = sessions.find((s) => s.id === params.sessionID);
  if (!found) notFound(params.sessionID);
  writeConfig({ ...config, sessions: sessions.filter((s) => s.id !== params.sessionID) });
  process.exit(0);
}
if (op === "session.interrupt") {
  const logPath = config.interruptLogPath || config.deleteLogPath;
  if (logPath) {
    fs.appendFileSync(logPath, argv.join(" ") + "\\n");
  }
  const found = sessions.find((s) => s.id === params.sessionID);
  if (!found) notFound(params.sessionID);
  process.stdout.write(JSON.stringify({ interrupted: config.interrupted === true }) + "\\n");
  process.exit(0);
}
process.stderr.write("unknown operation " + op + "\\n");
process.exit(1);
`;
  writeFileSync(scriptPath, script, "utf-8");
  chmodSync(scriptPath, 0o755);
  return binDir;
}

function writeMockConfig(binDir: string, config: Record<string, unknown>): void {
  const configPath = join(binDir, "config.json");
  const tmpPath = `${configPath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(config), "utf-8");
  renameSync(tmpPath, configPath);
}

/** The sessions that the mock in `binDir` holds now. */
export function readMockApiSessions(binDir: string): MockApiSession[] {
  const config = JSON.parse(readFileSync(join(binDir, "config.json"), "utf-8")) as {
    sessions?: MockApiSession[];
  };
  return config.sessions ?? [];
}

/** Add a session to the mock in `binDir`, as a create on the service would. */
export function addMockApiSession(binDir: string, session: MockApiSession): void {
  const config = JSON.parse(readFileSync(join(binDir, "config.json"), "utf-8")) as Record<
    string,
    unknown
  >;
  const sessions = (config["sessions"] as MockApiSession[] | undefined) ?? [];
  writeMockConfig(binDir, { ...config, sessions: [...sessions, session] });
}

/**
 * A `Runtime.create` double that behaves like the real pane script since
 * `b90ac08f`: the OpenCode session `AO:<id>` is created only after `create`
 * returns, in the workspace directory, `delayMs` later. The ID is
 * `ses_pane_<id>`.
 */
export function paneCreatesOpenCodeSession(
  binDir: string,
  options?: { delayMs?: number },
): (config: RuntimeCreateConfig) => Promise<RuntimeHandle> {
  return async (config: RuntimeCreateConfig) => {
    const aoSessionId = config.environment["AO_SESSION"] ?? config.sessionId;
    setTimeout(() => {
      addMockApiSession(binDir, {
        id: `ses_pane_${aoSessionId}`,
        title: `AO:${aoSessionId}`,
        directory: config.workspacePath,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }, options?.delayMs ?? 0);
    return { id: config.sessionId, runtimeName: "mock", data: {} };
  };
}

function cliJsonToApiSessions(sessionListJson: string): MockApiSession[] {
  try {
    const parsed: unknown = JSON.parse(sessionListJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): MockApiSession[] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const id = typeof record["id"] === "string" ? record["id"] : undefined;
      const title = typeof record["title"] === "string" ? record["title"] : "";
      if (!id) return [];
      const rawUpdated = record["updated"];
      let updatedAt: number | undefined;
      if (typeof rawUpdated === "number" && Number.isFinite(rawUpdated)) {
        updatedAt = rawUpdated;
      } else if (typeof rawUpdated === "string") {
        const trimmed = rawUpdated.trim();
        if (/^\d+$/.test(trimmed)) updatedAt = Number(trimmed);
        else {
          const parsedMs = Date.parse(trimmed);
          if (!Number.isNaN(parsedMs)) updatedAt = parsedMs;
        }
      } else if (
        record["time"] &&
        typeof record["time"] === "object" &&
        record["time"] !== null &&
        typeof (record["time"] as Record<string, unknown>)["updated"] === "number"
      ) {
        updatedAt = (record["time"] as Record<string, unknown>)["updated"] as number;
      }
      const createdAt = typeof record["created"] === "number" ? record["created"] : undefined;
      const directory = typeof record["directory"] === "string" ? record["directory"] : undefined;
      return [
        {
          id,
          title,
          ...(updatedAt !== undefined ? { updatedAt } : {}),
          ...(createdAt !== undefined ? { createdAt } : {}),
          ...(directory !== undefined ? { directory } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * Legacy signature: converts old CLI list JSON into API sessions.
 * `listDelaySeconds` becomes the API delay (hanging-binary check).
 */
export function installMockOpencode(
  tmpDir: string,
  sessionListJson: string,
  deleteLogPath: string,
  listDelaySeconds = 0,
  listLogPath?: string,
): string {
  return installMockOpencodeApi(tmpDir, cliJsonToApiSessions(sessionListJson), {
    deleteLogPath,
    apiLogPath: listLogPath,
    apiDelaySeconds: listDelaySeconds,
    binName: "mock-bin",
  });
}

export function installMockOpencodeSequence(
  tmpDir: string,
  sessionListJsons: string[],
  deleteLogPath: string,
  listLogPath?: string,
): string {
  const last = sessionListJsons.at(-1) ?? "[]";
  return installMockOpencode(tmpDir, last, deleteLogPath, 0, listLogPath);
}

export function installMockOpencodeWithNotFoundDelete(
  tmpDir: string,
  sessionListJson: string,
): string {
  return installMockOpencode(tmpDir, sessionListJson, join(tmpDir, "opencode-notfound-delete.log"));
}

export function installMockGit(
  tmpDir: string,
  remoteBranches: string[],
): string {
  const binDir = join(tmpDir, "mock-git-bin");
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "git");
  const refs = remoteBranches
    .map((branch) => `deadbeef\trefs/heads/${branch}`)
    .join("\\n")
    .replace(/'/g, "'\\''");
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ "$1" == "ls-remote" && "$2" == "--heads" && "$3" == "origin" ]]; then',
      `  printf '%b\\n' '${refs}'`,
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
  return binDir;
}
