/**
 * The recorded herdr 0.9.5 answers of the live check
 * (development/artifacts/herdr_095_live_check), as test data. Each `<name>.cmd`
 * file holds the command, its exit code, the name of the stdout file and the
 * stderr lines (indented by two spaces). The files are read, never changed.
 */
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = fileURLToPath(
  new URL("../../../../../development/artifacts/herdr_095_live_check/", import.meta.url),
);

/** One recorded herdr call: its command line, exit code, stdout and stderr. */
export interface HerdrFixture {
  command: string;
  exit: number;
  stdout: string;
  stderr: string;
}

export function herdrFixture(name: string): HerdrFixture {
  const text = readFileSync(`${FIXTURES}${name}.cmd`, "utf-8");
  const field = (key: string): string => {
    const match = new RegExp(`^${key}: (.*)$`, "m").exec(text);
    if (!match) throw new Error(`fixture ${name} has no ${key} line`);
    return match[1];
  };
  const out = /^(\S+) \((\d+) bytes\)$/.exec(field("stdout"));
  if (!out) throw new Error(`fixture ${name} has a malformed stdout line`);
  const lines = text.split("\n");
  const stderrLines = lines
    .slice(lines.indexOf("stderr:") + 1)
    .filter((line) => line.startsWith("  "))
    .map((line) => line.slice(2));
  return {
    command: field("command"),
    exit: Number(field("exit")),
    stdout: Number(out[2]) > 0 ? readFileSync(`${FIXTURES}${out[1]}`, "utf-8") : "",
    stderr: stderrLines.map((line) => `${line}\n`).join(""),
  };
}

/**
 * The rejection of a promisified `execFile` for a recorded call that exited
 * with a non-zero code: Node sets `code` to the exit code, `signal` to null,
 * `killed` to false, and attaches stdout and stderr.
 */
export function herdrRejection(
  fixture: Pick<HerdrFixture, "command" | "exit" | "stdout" | "stderr">,
): Error {
  return Object.assign(new Error(`Command failed: ${fixture.command}\n${fixture.stderr}`), {
    code: fixture.exit,
    signal: null,
    killed: false,
    cmd: fixture.command,
    stdout: fixture.stdout,
    stderr: fixture.stderr,
  });
}

/** The answer of `herdr status server --json` with a running server (closedpane_status_server_json). */
export function statusRunning(): { stdout: string; stderr: string } {
  return { stdout: herdrFixture("closedpane_status_server_json").stdout, stderr: "" };
}

/** The socket of statusRunning(). */
export const STATUS_SOCKET = "/tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock";

/**
 * Herdr fit F-6: an empty executable file named `herdr` in a new temporary
 * directory, which is all of PATH until `restore`. It is never run: the
 * tests mock execFile.
 */
export function standInHerdrOnPath(): { dir: string; bin: string; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "ao-herdr-bin-"));
  const bin = join(dir, "herdr");
  closeSync(openSync(bin, "w", 0o755));
  const savedPath = process.env["PATH"];
  process.env["PATH"] = dir;
  return {
    dir,
    bin,
    restore: () => {
      process.env["PATH"] = savedPath;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Herdr fit-2: one section of a forms log of the live check
 * (`r8_cli_forms_log.txt`, `r9_cli_forms_log.txt`): the line `<section>:
 * <command>`, then the indented fields `exit=<n>`, `stdout=<repr>` and
 * `stderr=<repr>`, each text as a Python string literal in single quotes.
 * (The same reader as core's test fixture of the same name.)
 */
export function herdrFormsLogEntry(file: string, section: string): HerdrFixture {
  const lines = readFileSync(`${FIXTURES}${file}`, "utf-8").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${section}: `));
  if (start < 0) throw new Error(`${file} has no section ${section}`);
  const field = (key: string): string => {
    for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i++) {
      if (lines[i].startsWith(`  ${key}=`)) return lines[i].slice(key.length + 3);
    }
    throw new Error(`section ${section} of ${file} has no ${key} field`);
  };
  const text = (key: string): string => {
    const repr = field(key);
    if (repr.length < 2 || !repr.startsWith("'") || !repr.endsWith("'")) {
      throw new Error(`section ${section} of ${file} has a malformed ${key} field`);
    }
    return repr.slice(1, -1).replace(/\\(\\|n|')/g, (_, c: string) => (c === "n" ? "\n" : c));
  };
  return {
    command: lines[start].slice(section.length + 2),
    exit: Number(field("exit")),
    stdout: text("stdout"),
    stderr: text("stderr"),
  };
}

/** The answer of `herdr status server --json` of statusRunning(), with another socket. */
export function statusRunningAt(socket: string): { stdout: string; stderr: string } {
  const status = JSON.parse(statusRunning().stdout) as Record<string, unknown>;
  return { stdout: JSON.stringify({ ...status, socket }), stderr: "" };
}

/** A herdr 0.9.5 failure (exit 1, empty stdout, one stderr line) of a call. */
export function herdrCliFailure(command: string, id: string, code: string, message: string): Error {
  return herdrRejection({
    command,
    exit: 1,
    stdout: "",
    stderr: `${JSON.stringify({ id, error: { code, message } })}\n`,
  });
}

/** The rejection of a call that `execFile` stopped at its timeout (no herdr answer). */
export function herdrTimeout(command: string): Error {
  return Object.assign(new Error(`Command failed: ${command}\n`), {
    code: null,
    signal: "SIGTERM",
    killed: true,
    cmd: command,
    stdout: "",
    stderr: "",
  });
}
