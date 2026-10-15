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

function tmuxFixture(state: "gone" | "live" = "gone"): void {
  const bin = join(root, "tmux-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "tmux"),
    `#!/bin/sh
if [ "$1" = display-message ]; then echo /tmp/own-server; exit 0; fi
${state === "live" ? "exit 0" : `echo "can't find session: earlier" >&2; exit 1`}
`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}:${process.env.PATH}`;
}

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

  it.each(["lock", "lease"])(
    "names the live PID and blocking %s without a removal command",
    async (kind) => {
      const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
      const key = readdirSync(options().root).find((entry) => !entry.endsWith(".lease"));
      if (!key) throw new Error("missing lock");
      const path = join(options().root, key);
      // Simulate an older holder without the recovery lease, or a lease alone.
      rmSync(kind === "lock" ? `${path}.lease` : path, { recursive: true });
      const error = await acquireOpenCodeLaunchLock(workspace, "AO:same", options()).catch(
        (error: unknown) => error,
      );
      expect(String(error)).toContain(`(${kind === "lease" ? `${path}.lease` : path})`);
      expect(String(error)).toContain(`wait, or stop PID ${process.pid} first`);
      expect(String(error)).not.toContain("rm ");
      first.release();
    },
  );

  it.each(["marker", "directory"])(
    "completes and releases after its %s was removed",
    async (kind) => {
      const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
      await first.start();
      const key = readdirSync(options().root).find((entry) => !entry.endsWith(".lease"));
      if (!key) throw new Error("missing lock");
      const path = join(options().root, key);
      rmSync(kind === "directory" ? path : join(path, "pending.json"), { recursive: true });
      expect(() => first.complete()).not.toThrow();
      expect(first.pending).toBe(false);
      expect(() => first.release()).not.toThrow();
      expect(readdirSync(options().root)).toEqual([]);
    },
  );

  it("preserves a young empty directory while its launcher publishes an owner", async () => {
    const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
    await first.start();
    first.release();
    const path = join(options().root, readdirSync(options().root)[0]);
    rmSync(join(path, "pending.json"));
    const waiting = acquireOpenCodeLaunchLock(workspace, "AO:same", options()).catch(
      (error: unknown) => error,
    );
    await pause(80);
    // A round-3 launcher publishes its owner after mkdir, without a lease.
    writeFileSync(join(path, `${process.pid}-abcdef.owner`), "", { flag: "wx" });
    expect(String(await waiting)).toContain(`wait, or stop PID ${process.pid} first`);
    expect(readdirSync(path)).toEqual([`${process.pid}-abcdef.owner`]);
  });

  it.each(["live", "no handle", "no socket", "herdr"])(
    "refuses an outside matching create while the earlier pane is %s",
    async (kind) => {
      const bin = installMockOpencodeApi(root, []);
      process.env.PATH = `${bin}:${originalPath ?? ""}`;
      tmuxFixture("live");
      const first = await acquireOpenCodeLaunchLock(workspace, "AO:same", options());
      const startedAt = await first.start();
      if (kind !== "no handle")
        await first.recordRuntime({
          id: "earlier",
          runtimeName: kind === "herdr" ? "herdr" : "tmux",
          data: {},
        });
      first.release();
      const file = join(options().root, readdirSync(options().root)[0], "pending.json");
      if (kind === "no socket") {
        const marker = JSON.parse(readFileSync(file, "utf8"));
        delete marker.tmuxSocket;
        writeFileSync(file, JSON.stringify(marker));
      }
      addMockApiSession(bin, {
        id: "ses_manual",
        title: "AO:same",
        directory: workspace,
        createdAt: startedAt,
      });
      await expect(acquireOpenCodeLaunchLock(workspace, "AO:same", options())).rejects.toThrow(
        "A live earlier pane or unverified pane death keeps its marker",
      );
      expect(JSON.parse(readFileSync(file, "utf8")).startedAt).toBe(startedAt);
    },
  );

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
      chmodSync(workspace, 0o700);
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
    tmuxFixture();
    await first.recordRuntime({ id: "earlier", runtimeName: "tmux", data: {} });
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
      tmuxFixture();
      await first.recordRuntime({ id: "earlier", runtimeName: "tmux", data: {} });
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
