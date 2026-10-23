/**
 * Session relaunch (2026-10-22), review r1 M-5 and M-1, review r2 M-2:
 * `runInPane` and `listPanes` against a real bash in a real tmux pane. The
 * owner's half-typed text must never run, wherever the cursor is, also at a
 * continuation prompt (PS2), and also in a shell that ignores or traps
 * SIGINT: there `runInPane` types nothing and says so.
 *
 * Every tmux call goes to a private server of this test file: a `tmux`
 * wrapper first on PATH adds `-S <test directory>/tmux.sock` and removes
 * TMUX (tmux uses the TMUX socket over its default socket when TMUX is set).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { RuntimeHandle } from "@aoagents/ao-core";
import { create } from "../index.js";

function findOnPath(name: string): string | null {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  return null;
}

const tmuxBin = findOnPath("tmux");
const bashBin = findOnPath("bash");
const supported = process.platform === "linux" && tmuxBin !== null && bashBin !== null;

let dir = "";
let savedPath: string | undefined;
let sessions = 0;

function tmux(...args: string[]): string {
  const result = spawnSync(join(dir, "bin", "tmux"), args, {
    encoding: "utf-8",
    env: { PATH: `${join(dir, "bin")}:/usr/bin:/bin`, HOME: dir, TERM: "xterm-256color" },
  });
  if (result.status !== 0) throw new Error(`tmux ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trimEnd();
}

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

/** Run a line in the pane's shell and wait for its next prompt. */
async function runLine(paneId: string, line: string): Promise<void> {
  const before = tmux("capture-pane", "-p", "-t", paneId)
    .split("\n")
    .filter((r) => r).length;
  typeText(paneId, line);
  typeKeys(paneId, "Enter");
  await waitFor(
    () =>
      tmux("capture-pane", "-p", "-t", paneId)
        .split("\n")
        .filter((r) => r).length > before,
    5_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
}

/** A new tmux session with an idle bash; its handle and its first pane ID. */
async function newShellSession(): Promise<{ handle: RuntimeHandle; paneId: string }> {
  sessions += 1;
  const name = `relaunch-shell-${sessions}`;
  tmux("new-session", "-d", "-s", name, "-x", "200", "-y", "50", "bash --noprofile --norc");
  const paneId = tmux("display-message", "-p", "-t", `=${name}:`, "#{pane_id}");
  const prompt = await waitFor(
    () => /bash-[\d.]+\$/.test(tmux("capture-pane", "-p", "-t", paneId)),
    5_000,
  );
  if (!prompt) throw new Error(`no bash prompt in ${paneId}`);
  return { handle: { id: name, runtimeName: "tmux", data: {} }, paneId };
}

function typeKeys(paneId: string, ...keys: string[]): void {
  for (const key of keys) tmux("send-keys", "-t", paneId, key);
}

function typeText(paneId: string, text: string): void {
  tmux("send-keys", "-t", paneId, "-l", text);
}

describe.skipIf(!supported)(
  "runInPane and listPanes on a real bash in a private tmux server",
  () => {
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "ao-relaunch-shell-"));
      mkdirSync(join(dir, "bin"));
      const wrapper = join(dir, "bin", "tmux");
      writeFileSync(
        wrapper,
        `#!/bin/sh\nexec env -u TMUX '${tmuxBin}' -S '${join(dir, "tmux.sock")}' -f /dev/null "$@"\n`,
      );
      chmodSync(wrapper, 0o755);
      savedPath = process.env["PATH"];
      process.env["PATH"] = `${join(dir, "bin")}${delimiter}${savedPath ?? ""}`;
    });

    afterAll(() => {
      if (dir) {
        spawnSync(join(dir, "bin", "tmux"), ["kill-server"], { stdio: "ignore" });
        rmSync(dir, { recursive: true, force: true });
      }
      process.env["PATH"] = savedPath;
    });

    const cases: Array<{ name: string; owner: (paneId: string, mark: string) => Promise<void> }> = [
      {
        name: "the cursor is at the start of the owner's line",
        owner: async (paneId, mark) => {
          typeText(paneId, `touch ${mark}-1; touch ${mark}-2`);
          typeKeys(paneId, "C-a");
        },
      },
      {
        name: "the cursor is in the middle of the owner's line",
        owner: async (paneId, mark) => {
          typeText(paneId, `touch ${mark}-1; touch ${mark}-2`);
          typeKeys(paneId, "C-a", ...Array<string>(`touch ${mark}-1`.length).fill("Right"));
        },
      },
      {
        name: "the cursor is at the end of the owner's line",
        owner: async (paneId, mark) => {
          typeText(paneId, `touch ${mark}-1; touch ${mark}-2`);
        },
      },
      {
        name: "the shell shows a continuation prompt (PS2)",
        owner: async (paneId, mark) => {
          typeText(paneId, `echo "open quote; touch ${mark}-1`);
          typeKeys(paneId, "Enter");
          await waitFor(() => /^> /m.test(tmux("capture-pane", "-p", "-t", paneId)), 2_000);
          typeText(paneId, `touch ${mark}-2`);
        },
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      it(`runs only the launch line when ${testCase.name}`, async () => {
        const { handle, paneId } = await newShellSession();
        const mark = join(dir, `owner-${index}`);
        const launched = join(dir, `launched-${index}`);
        await testCase.owner(paneId, mark);

        await create().runInPane!(handle, paneId, `touch ${launched}`);
        await waitFor(() => existsSync(launched), 5_000);
        // Time for any owner text that the Enter submitted to run too.
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(existsSync(`${mark}-1`), "the owner's text before the cursor ran").toBe(false);
        expect(existsSync(`${mark}-2`), "the owner's text after the cursor ran").toBe(false);
        expect(existsSync(launched), "the launch line did not run").toBe(true);
      }, 20_000);
    }

    const refusals: Array<{
      name: string;
      shell: (paneId: string, mark: string) => Promise<void>;
      owner: (paneId: string, mark: string) => Promise<void>;
    }> = [
      {
        name: "SIGINT is ignored (trap '' INT) and the owner's text is before the cursor",
        shell: (paneId) => runLine(paneId, "trap '' INT"),
        owner: async (paneId, mark) => {
          typeText(paneId, `touch ${mark}-1; touch ${mark}-2`);
        },
      },
      {
        name: "SIGINT is ignored (trap '' INT) and the cursor is at the start of the owner's line",
        shell: (paneId) => runLine(paneId, "trap '' INT"),
        owner: async (paneId, mark) => {
          typeText(paneId, `; touch ${mark}-1; touch ${mark}-2`);
          typeKeys(paneId, "C-a");
        },
      },
      {
        name: "a SIGINT trap reads the next input line (trap 'read -r x' INT)",
        shell: (paneId, mark) =>
          runLine(paneId, `trap 'read -r x; printf "%s" "$x" > ${mark}-trap-input' INT`),
        owner: async (paneId, mark) => {
          typeText(paneId, `touch ${mark}-1; touch ${mark}-2`);
          typeKeys(paneId, "C-a");
        },
      },
    ];

    for (const [index, testCase] of refusals.entries()) {
      it(`types nothing and says so when ${testCase.name} (review r2 M-2)`, async () => {
        const { handle, paneId } = await newShellSession();
        const mark = join(dir, `refusal-${index}`);
        const launched = join(dir, `refusal-launched-${index}`);
        await testCase.shell(paneId, mark);
        await testCase.owner(paneId, mark);

        await expect(create().runInPane!(handle, paneId, `touch ${launched}`)).rejects.toThrow(
          /did not show a fresh, empty prompt line after C-c \(.*\), so nothing was typed/,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(existsSync(`${mark}-1`), "the owner's text before the cursor ran").toBe(false);
        expect(existsSync(`${mark}-2`), "the owner's text after the cursor ran").toBe(false);
        expect(existsSync(launched), "the launch line ran").toBe(false);
        expect(existsSync(`${mark}-trap-input`), "a trap read typed text").toBe(false);
        expect(tmux("capture-pane", "-p", "-t", paneId)).not.toContain(launched);
      }, 20_000);
    }

    it("runs only the launch line at the bottom row of a pane whose history is full", async () => {
      tmux("set-option", "-g", "history-limit", "3");
      const { handle, paneId } = await newShellSession();
      tmux("set-option", "-g", "history-limit", "2000");
      const mark = join(dir, "owner-full");
      const launched = join(dir, "launched-full");
      await runLine(paneId, "for i in $(seq 80); do echo line$i; done");
      typeText(paneId, `touch ${mark}-1; touch ${mark}-2`);
      typeKeys(paneId, "C-a");
      expect(tmux("display-message", "-p", "-t", paneId, "#{history_size} #{history_limit}")).toBe(
        "3 3",
      );

      await create().runInPane!(handle, paneId, `touch ${launched}`);
      await waitFor(() => existsSync(launched), 5_000);
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(existsSync(`${mark}-1`)).toBe(false);
      expect(existsSync(`${mark}-2`)).toBe(false);
      expect(existsSync(launched)).toBe(true);
    }, 20_000);

    it("runs only the launch line under a prompt of two lines", async () => {
      const { handle, paneId } = await newShellSession();
      const mark = join(dir, "owner-two-lines");
      const launched = join(dir, "launched-two-lines");
      await runLine(paneId, "PS1='ao test \\w\\n\\$ '");
      typeText(paneId, `touch ${mark}-1; touch ${mark}-2`);
      typeKeys(paneId, "C-a", "Right", "Right");

      await create().runInPane!(handle, paneId, `touch ${launched}`);
      await waitFor(() => existsSync(launched), 5_000);
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(existsSync(`${mark}-1`)).toBe(false);
      expect(existsSync(`${mark}-2`)).toBe(false);
      expect(existsSync(launched)).toBe(true);
    }, 20_000);

    it("lists the panes of every window, and tells an idle shell from a job in the foreground", async () => {
      const { handle, paneId } = await newShellSession();
      const second = tmux(
        "new-window",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "-t",
        `=${handle.id}:`,
        "bash --noprofile --norc",
      );
      await waitFor(() => /bash-[\d.]+\$/.test(tmux("capture-pane", "-p", "-t", second)), 5_000);
      typeText(second, "sleep 30");
      typeKeys(second, "Enter");
      await waitFor(
        () => tmux("display-message", "-p", "-t", second, "#{pane_current_command}") === "sleep",
        5_000,
      );

      const panes = await create().listPanes!(handle);

      expect(panes).toEqual([
        expect.objectContaining({ paneId, foregroundCommand: "bash", shellIdle: true }),
        expect.objectContaining({ paneId: second, foregroundCommand: "sleep", shellIdle: false }),
      ]);
      await expect(create().runInPane!(handle, second, "true")).rejects.toThrow(
        /does not wait for input now/,
      );
      await expect(
        create().runInPane!({ ...handle, id: "relaunch-other" }, paneId, "true"),
      ).rejects.toThrow(/belongs to "relaunch-shell-\d+", not to session relaunch-other/);
    }, 20_000);
  },
);
