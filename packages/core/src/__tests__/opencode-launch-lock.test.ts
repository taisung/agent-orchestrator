import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import ts from "typescript";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { installMockOpencodeApi, addMockApiSession } from "./session-manager/opencode-helpers.js";
import { acquireOpenCodeLaunchLock } from "../opencode-launch-lock.js";

let root: string;
let originalPath: string | undefined;
let workspace: string;
const children: ChildProcess[] = [];
beforeEach(() => {
  originalPath = process.env.PATH;
  root = mkdtempSync(join(tmpdir(), "ao-opencode-lock-test-"));
  workspace = join(root, "workspace");
  mkdirSync(workspace);
  const bin = installMockOpencodeApi(root, []);
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await exit;
    }
  }
  process.env.PATH = originalPath;
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});
const options = () => ({ root: join(root, "locks"), waitMs: 300 });

async function orphan(start: boolean): Promise<void> {
  const modulePath = join(root, "opencode-launch-lock.js");
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  for (const name of ["opencode-launch-lock", "opencode-api", "utils"]) {
    const source = readFileSync(new URL(`../${name}.ts`, import.meta.url), "utf-8");
    writeFileSync(
      join(root, `${name}.js`),
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    );
  }
  const moduleUrl = pathToFileURL(modulePath).href;
  const script = `import { acquireOpenCodeLaunchLock } from ${JSON.stringify(moduleUrl)};
    const lock = await acquireOpenCodeLaunchLock(${JSON.stringify(workspace)}, "AO:same", ${JSON.stringify(options())});
    ${start ? "await lock.start();" : ""}
    process.stdout.write("ready"); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  if (!child.stdout) throw new Error("child stdout missing");
  await once(child.stdout, "data");
  const exit = once(child, "exit");
  child.kill("SIGKILL");
  await exit;
}

describe("OpenCode launch ownership lock", () => {
  it("serializes aliases of a real directory until completion and release", async () => {
    const alias = join(root, "alias");
    symlinkSync(workspace, alias);
    const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
    const firstStart = await first.start();
    let secondAcquired = false;
    const second = acquireOpenCodeLaunchLock(alias, "AO:same", options()).then((lock) => {
      secondAcquired = true;
      return lock;
    });
    await pause(80);
    expect(secondAcquired).toBe(false);
    first.complete();
    first.release();
    const next = await second;
    expect(await next.start()).toBeGreaterThan(firstStart);
    next.complete();
    next.release();
  });

  it("does not serialize different titles or directories", async () => {
    const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
    const title = await acquireOpenCodeLaunchLock(workspace, "AO:other", options());
    const dir = await acquireOpenCodeLaunchLock(root, "AO:same", options());
    first.release();
    title.release();
    dir.release();
  });

  it("bounds waiting without stealing a live lock", async () => {
    const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
    const began = performance.now();
    await expect(acquireOpenCodeLaunchLock(workspace, "AO:same", options())).rejects.toThrow(
      "Timed out",
    );
    expect(performance.now() - began).toBeLessThan(1_500);
    first.release();
  });

  it("reclaims a dead owner that never launched a pane", async () => {
    await orphan(false);
    const next = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
    await next.start();
    next.complete();
    next.release();
    expect(readdirSync(options().root)).toEqual([]);
  });

  it("does not mistake an orphaned pane for a stale pre-launch lock", async () => {
    await orphan(true);
    await expect(acquireOpenCodeLaunchLock(workspace, "AO:same", options())).rejects.toThrow(
      "earlier OpenCode launch is unresolved",
    );
  });

  it("retains unresolved discovery after releasing, with no expiry", async () => {
    const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
    await first.start();
    first.release();
    await pause(50);
    await expect(acquireOpenCodeLaunchLock(workspace, "AO:same", options())).rejects.toThrow(
      "delayed create",
    );
  });
  it.each(["writable", "symlink"])("refuses a %s lock root", async (kind) => {
    mkdirSync(options().root, { mode: 0o700 });
    if (kind === "writable") chmodSync(options().root, 0o777);
    else {
      rmSync(options().root, { recursive: true });
      symlinkSync(workspace, options().root);
    }
    await expect(acquireOpenCodeLaunchLock(workspace, "AO:same", options())).rejects.toThrow(
      "Unsafe OpenCode launch lock root",
    );
  });

  it("recovers a completed create once while concurrent successors serialize", async () => {
    const bin = installMockOpencodeApi(root, []);
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
    const startedAt = await first.start();
    first.release();
    addMockApiSession(bin, {
      id: "ses_earlier",
      title: "AO:same",
      directory: workspace,
      createdAt: startedAt,
    });
    const a = acquireOpenCodeLaunchLock(workspace, "AO:same", { ...options(), waitMs: 2_000 });
    const b = acquireOpenCodeLaunchLock(workspace, "AO:same", { ...options(), waitMs: 2_000 });
    const next = await a;
    expect(await next.start()).toBeGreaterThan(startedAt);
    next.complete();
    next.release();
    const last = await b;
    last.release();
    expect(readdirSync(options().root)).toEqual([]);
  });

  it.each(["old", "wrong directory", "substring"])(
    "does not settle a marker using a %s decoy",
    async (kind) => {
      const bin = installMockOpencodeApi(root, []);
      process.env.PATH = `${bin}:${originalPath ?? ""}`;
      const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
      const startedAt = await first.start();
      first.release();
      addMockApiSession(bin, {
        id: "ses_decoy",
        title: kind === "substring" ? "AO:same-more" : "AO:same",
        directory: kind === "wrong directory" ? root : workspace,
        createdAt: kind === "old" ? startedAt - 1 : startedAt,
      });
      await expect(acquireOpenCodeLaunchLock(workspace, "AO:same", options())).rejects.toThrow(
        "unresolved",
      );
    },
  );

  it("reclaims an old ownerless directory after only the marker file was removed", async () => {
    const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
    await first.start();
    first.release();
    const path = join(options().root, readdirSync(options().root)[0]);
    rmSync(join(path, "pending.json"));
    utimesSync(path, new Date(0), new Date(0));
    const next = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
    next.release();
    expect(readdirSync(options().root)).toEqual([]);
  });

  it.each(["gone", "live", "unreachable", "herdr", "too young", "legacy"])(
    "requires old-marker and own-server death evidence: %s",
    async (state) => {
      const bin = installMockOpencodeApi(root, []);
      const log = join(root, "tmux-args");
      writeFileSync(
        join(bin, "tmux"),
        `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv.includes("display-message")) { console.log("/tmp/own-server"); process.exit(0); }
${state === "live" ? "process.exit(0);" : `console.error(${JSON.stringify(state === "unreachable" ? "no server running on /tmp/own-server" : "can't find session: earlier")}); process.exit(1);`}
`,
      );
      chmodSync(join(bin, "tmux"), 0o755);
      process.env.PATH = `${bin}:${originalPath ?? ""}`;
      const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
      await first.start();
      await first.recordRuntime({
        id: "earlier",
        runtimeName: state === "herdr" ? "herdr" : "tmux",
        data: {},
      });
      first.release();
      const file = join(options().root, readdirSync(options().root)[0], "pending.json");
      const pending = JSON.parse(readFileSync(file, "utf8"));
      if (state !== "too young") pending.startedAt = Date.now() - 60_000;
      if (state === "legacy") delete pending.tmuxSocket;
      writeFileSync(file, JSON.stringify(pending));
      if (state === "gone") {
        const next = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
        next.release();
        expect(readFileSync(log, "utf8")).toContain(
          '["-S","/tmp/own-server","has-session","-t","=earlier"]',
        );
      } else {
        await expect(acquireOpenCodeLaunchLock(workspace, "AO:same", options())).rejects.toThrow(
          "unresolved",
        );
      }
    },
  );
});
