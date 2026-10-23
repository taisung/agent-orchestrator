/**
 * The recorded herdr 0.9.5 answers of the live check
 * (development/artifacts/herdr_095_live_check), as test data. Each `<name>.cmd`
 * file holds the command, its exit code, the name of the stdout file and the
 * stderr lines (indented by two spaces). The files are read, never changed.
 */
import { readFileSync } from "node:fs";
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
