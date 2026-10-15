import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import ts from "typescript";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { acquireOpenCodeLaunchLock } from "../opencode-launch-lock.js";

let root: string;
let workspace: string;
const children: ChildProcess[] = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-opencode-lock-test-"));
  workspace = join(root, "workspace");
  mkdirSync(workspace);
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await exit;
    }
  }
  rmSync(root, { recursive: true, force: true });
});
const options = () => ({ root: join(root, "locks"), waitMs: 300 });

async function orphan(start: boolean): Promise<void> {
  const source = readFileSync(new URL("../opencode-launch-lock.ts", import.meta.url), "utf-8");
  const modulePath = join(root, "lock.mjs");
  writeFileSync(
    modulePath,
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
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
});
