import {
  chmodSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface MockApiSession {
  id: string;
  title: string;
  updatedAt?: number;
}

/**
 * Install a mock `opencode` that speaks the 2.x API used by I-2
 * (`opencode api session.get/list/remove/interrupt`).
 *
 * The mock reads its config (seeded sessions, log paths, delay) from a
 * `config.json` next to the script, so no process env leaks between tests.
 * - `session.get`/`remove`/`interrupt` answer 404 for any unseeded ID
 *   (stdout `{"_tag":"SessionNotFoundError",...}`, stderr 404, exit 1).
 * - `session.list --param search=<text>` returns seeded sessions whose title
 *   contains the search text; the helper filters for the exact title.
 * - `session.remove` prints nothing (204) and appends to the delete log;
 *   `session.interrupt` prints `{"data":{"interrupted":false}}` and appends
 *   to the interrupt log (or delete log when no interrupt log is given).
 * - `apiDelaySeconds` sleeps before every `api` call (hanging-binary check).
 */
export function installMockOpencodeApi(
  tmpDir: string,
  sessions: MockApiSession[],
  options?: {
    deleteLogPath?: string;
    interruptLogPath?: string;
    apiLogPath?: string;
    apiDelaySeconds?: number;
    binName?: string;
  },
): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const binDir = join(tmpDir, options?.binName ?? `mock-bin-${unique}`);
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "opencode");
  const configPath = join(binDir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      sessions,
      deleteLogPath: options?.deleteLogPath ?? null,
      interruptLogPath: options?.interruptLogPath ?? null,
      apiLogPath: options?.apiLogPath ?? null,
      apiDelaySeconds: options?.apiDelaySeconds ?? 0,
    }),
    "utf-8",
  );
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const argv = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf-8"));
const sessions = config.sessions || [];
if (config.apiDelaySeconds > 0) { cp.execSync("sleep " + config.apiDelaySeconds); }
if (config.apiLogPath) {
  fs.appendFileSync(config.apiLogPath, JSON.stringify(argv) + "\\n");
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
const apiRecord = (s) => ({ id: s.id, title: s.title, time: s.updatedAt !== undefined ? { updated: s.updatedAt } : {} });
if (argv[0] !== "api") { process.stderr.write("unexpected: " + argv.join(" ") + "\\n"); process.exit(1); }
const op = argv[1];
if (op === "session.get") {
  const found = sessions.find((s) => s.id === params.sessionID);
  if (!found) {
    process.stdout.write(JSON.stringify({ _tag: "SessionNotFoundError", sessionID: params.sessionID, message: "Session not found: " + params.sessionID }) + "\\n");
    process.stderr.write("HTTP 404 Not Found\\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ data: apiRecord(found) }) + "\\n");
  process.exit(0);
}
if (op === "session.list") {
  const search = params.search || "";
  const matched = sessions.filter((s) => !search || (s.title || "").includes(search));
  process.stdout.write(JSON.stringify({ data: matched.map(apiRecord), cursor: {} }) + "\\n");
  process.exit(0);
}
if (op === "session.remove") {
  if (config.deleteLogPath) {
    fs.appendFileSync(config.deleteLogPath, argv.join(" ") + "\\n");
  }
  const found = sessions.find((s) => s.id === params.sessionID);
  if (!found) {
    process.stdout.write(JSON.stringify({ _tag: "SessionNotFoundError", sessionID: params.sessionID, message: "Session not found: " + params.sessionID }) + "\\n");
    process.stderr.write("HTTP 404 Not Found\\n");
    process.exit(1);
  }
  process.exit(0);
}
if (op === "session.interrupt") {
  const logPath = config.interruptLogPath || config.deleteLogPath;
  if (logPath) {
    fs.appendFileSync(logPath, argv.join(" ") + "\\n");
  }
  const found = sessions.find((s) => s.id === params.sessionID);
  if (!found) {
    process.stdout.write(JSON.stringify({ _tag: "SessionNotFoundError", sessionID: params.sessionID, message: "Session not found: " + params.sessionID }) + "\\n");
    process.stderr.write("HTTP 404 Not Found\\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ data: { interrupted: false } }) + "\\n");
  process.exit(0);
}
process.stderr.write("unknown operation " + op + "\\n");
process.exit(1);
`;
  writeFileSync(scriptPath, script, "utf-8");
  chmodSync(scriptPath, 0o755);
  return binDir;
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
      return [{ id, title, ...(updatedAt !== undefined ? { updatedAt } : {}) }];
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
