/**
 * The record write protocol (killed-status round 3, 1.2): every Node writer
 * holds the record lock for its read, compare, write and rename, and every
 * write increments `generation`.
 *
 * The two-process tests run a second writer in a real child process (the
 * pattern of the review's B-2 reproducer). The child runs the same metadata,
 * record-lock and delivery-lock code, compiled with the TypeScript compiler.
 * "Takes": the child starts its write while the first writer is between its
 * read and its rename. "Holds": the child holds the lock while the first
 * writer starts. In both orders the second writer's record must end intact.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import type * as AtomicWrite from "../atomic-write.js";
import type * as DeliveryLock from "../delivery-lock.js";
import {
  deleteMetadata,
  readArchivedMetadataRaw,
  readMetadataRaw,
  reserveSessionId,
  updateMetadata,
  updateMetadataIf,
  writeMetadata,
} from "../metadata.js";
import { RECORD_LOCK_WAIT_MS, recordLockName } from "../record-lock.js";
import { isDeliveryLockHeld } from "../delivery-lock.js";

// The first writer pauses inside its locked section, after its read and
// compare and before it writes its temp file and renames it.
const writeHook = vi.hoisted(() => ({ fn: undefined as undefined | ((path: string) => void) }));
vi.mock("../atomic-write.js", async (importOriginal) => {
  const actual = await importOriginal<typeof AtomicWrite>();
  return {
    atomicWriteFileSync: (path: string, content: string) => {
      const hook = writeHook.fn;
      if (hook) {
        writeHook.fn = undefined;
        hook(path);
      }
      actual.atomicWriteFileSync(path, content);
    },
  };
});

// A test can turn the lock off, as on a platform without abstract sockets.
const lockPlatform = vi.hoisted(() => ({ supported: true }));
vi.mock("../delivery-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DeliveryLock>();
  return {
    ...actual,
    isDeliveryLockSupported: (platform?: string) =>
      lockPlatform.supported && actual.isDeliveryLockSupported(platform),
  };
});

const SOURCES = ["metadata", "record-lock", "delivery-lock", "atomic-write", "key-value"];

const CHILD = `
import { writeFileSync, existsSync } from "node:fs";
import { updateMetadata, deleteMetadata, reserveSessionId } from "./metadata.js";
import { withRecordLock } from "./record-lock.js";
const cmd = JSON.parse(process.argv[2]);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => Atomics.wait(sleeper, 0, 0, ms);
const actions = {
  restore: () =>
    updateMetadata(cmd.dir, cmd.id, {
      status: "spawning",
      runtimeHandle: "new",
      restoredAt: "2026-10-20T19:00:00.000Z",
    }),
  "archive-reserve": () => {
    deleteMetadata(cmd.dir, cmd.id, true);
    reserveSessionId(cmd.dir, cmd.id);
  },
  claim: () =>
    updateMetadata(cmd.dir, cmd.id, {
      pr: "https://github.com/org/my-app/pull/2",
      status: "pr_open",
      branch: "feat/two",
      prAutoDetect: "",
    }),
};
if (cmd.holdMs !== undefined) {
  withRecordLock(cmd.dir, cmd.id, () => {
    if (cmd.action) actions[cmd.action]();
    writeFileSync(cmd.ready, "");
    const until = Date.now() + cmd.holdMs;
    while (Date.now() < until && !(cmd.releaseOn && existsSync(cmd.releaseOn))) sleep(5);
  });
} else {
  writeFileSync(cmd.ready, "");
  actions[cmd.action]();
}
writeFileSync(cmd.done, "");
`;

let childDir: string;
let dir: string;
const children: ChildProcess[] = [];

beforeAll(() => {
  childDir = mkdtempSync(join(tmpdir(), "ao-record-lock-child-"));
  for (const name of SOURCES) {
    const source = readFileSync(new URL(`../${name}.ts`, import.meta.url), "utf-8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    writeFileSync(join(childDir, `${name}.js`), output);
  }
  writeFileSync(join(childDir, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(childDir, "child.js"), CHILD);
});

afterAll(() => {
  rmSync(childDir, { recursive: true, force: true });
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ao-record-lock-"));
  lockPlatform.supported = true;
});

afterEach(() => {
  writeHook.fn = undefined;
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  rmSync(dir, { recursive: true, force: true });
});

interface Child {
  child: ChildProcess;
  exited: Promise<number | null>;
  stderr: () => string;
}

function runChild(cmd: Record<string, unknown>): Child {
  const child = spawn(process.execPath, [join(childDir, "child.js"), JSON.stringify(cmd)], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { PATH: process.env["PATH"] ?? "" },
  });
  children.push(child);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, exited, stderr: () => stderr };
}

/** Wait without leaving the current synchronous section. */
function waitSync(done: () => boolean, ms: number): boolean {
  const deadline = Date.now() + ms;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!done()) {
    if (Date.now() >= deadline) return false;
    Atomics.wait(sleeper, 0, 0, 5);
  }
  return true;
}

const marker = (name: string) => join(dir, `.${name}`);

/** The record that the lifecycle read before its probes: working, old handle. */
function seedRecord(fields: Record<string, string> = {}): Record<string, string> {
  writeMetadata(dir, "kr-1", { worktree: "/tmp", branch: "main", status: "working" });
  updateMetadata(dir, "kr-1", { runtimeHandle: "old", ...fields });
  return readMetadataRaw(dir, "kr-1")!;
}

/** The lifecycle's status write of a confirmed death, against the version it read. */
function lifecycleKill(read: Record<string, string>): Record<string, string> | null {
  return updateMetadataIf(
    dir,
    "kr-1",
    {
      generation: read["generation"],
      status: read["status"],
      runtimeHandle: read["runtimeHandle"],
      pr: read["pr"],
    },
    { status: "killed", killedReason: read["pr"] ? "pr-closed" : "runtime" },
  );
}

/**
 * "Takes": while the lifecycle is between its read and its rename, a child
 * starts `action`. The lifecycle waits up to 1.5 s for the child to finish
 * (without the lock it does; with the lock it cannot), then renames.
 */
async function takeDuringRename(
  action: string,
  read: Record<string, string>,
): Promise<{ written: Record<string, string> | null; childFinishedInside: boolean }> {
  let child: Child | undefined;
  let childFinishedInside = false;
  writeHook.fn = (path) => {
    expect(path).toBe(join(dir, "kr-1"));
    child = runChild({ action, dir, id: "kr-1", ready: marker("ready"), done: marker("done") });
    expect(waitSync(() => existsSync(marker("ready")), 10_000)).toBe(true);
    childFinishedInside = waitSync(() => existsSync(marker("done")), 1_500);
  };
  const written = lifecycleKill(read);
  expect(child).toBeDefined();
  expect(await child!.exited, child!.stderr()).toBe(0);
  return { written, childFinishedInside };
}

/** "Holds": a child holds the lock (after its own `action`) while the lifecycle writes. */
async function writeWhileHeld(
  action: string,
  read: Record<string, string>,
): Promise<{ written: Record<string, string> | null; waitedMs: number }> {
  const child = runChild({
    action,
    dir,
    id: "kr-1",
    ready: marker("ready"),
    done: marker("done"),
    holdMs: 800,
  });
  await vi.waitFor(() => expect(existsSync(marker("ready"))).toBe(true), {
    timeout: 10_000,
    interval: 5,
  });
  const started = Date.now();
  const written = lifecycleKill(read);
  const waitedMs = Date.now() - started;
  expect(await child.exited, child.stderr()).toBe(0);
  return { written, waitedMs };
}

describe("1.2 item 6: a second writer between the first writer's read and rename", () => {
  it("restore (takes): the restored record stays intact", async () => {
    const read = seedRecord();
    const { written, childFinishedInside } = await takeDuringRename("restore", read);

    expect(childFinishedInside).toBe(false);
    expect(written).not.toBeNull();
    expect(readMetadataRaw(dir, "kr-1")).toMatchObject({
      status: "spawning",
      runtimeHandle: "new",
      restoredAt: "2026-10-20T19:00:00.000Z",
    });
    expect(readMetadataRaw(dir, "kr-1")!["killedReason"]).toBeUndefined();
  }, 20_000);

  it("restore (holds): the lifecycle waits for the lock and then writes nothing", async () => {
    const read = seedRecord();
    const { written, waitedMs } = await writeWhileHeld("restore", read);

    expect(written).toBeNull();
    expect(waitedMs).toBeGreaterThanOrEqual(300);
    expect(readMetadataRaw(dir, "kr-1")).toMatchObject({
      status: "spawning",
      runtimeHandle: "new",
    });
  }, 20_000);

  it("archive plus a new reservation of the same ID (takes): the new reservation stays intact", async () => {
    const read = seedRecord();
    const { childFinishedInside } = await takeDuringRename("archive-reserve", read);

    expect(childFinishedInside).toBe(false);
    // The archive holds the lifecycle's write; the live record is the new, empty reservation.
    expect(readMetadataRaw(dir, "kr-1")).toEqual({});
    expect(readArchivedMetadataRaw(dir, "kr-1")).toMatchObject({ status: "killed" });
  }, 20_000);

  it("archive plus a new reservation of the same ID (holds): the lifecycle writes nothing", async () => {
    const read = seedRecord();
    const { written } = await writeWhileHeld("archive-reserve", read);

    expect(written).toBeNull();
    expect(readMetadataRaw(dir, "kr-1")).toEqual({});
    expect(readArchivedMetadataRaw(dir, "kr-1")).toMatchObject({ status: "working" });
  }, 20_000);

  it("claimPR's write (takes, M-2): the claimed open PR stays intact", async () => {
    const read = seedRecord({ status: "pr_open", pr: "https://github.com/org/my-app/pull/1" });
    const { childFinishedInside } = await takeDuringRename("claim", read);

    expect(childFinishedInside).toBe(false);
    expect(readMetadataRaw(dir, "kr-1")).toMatchObject({
      status: "pr_open",
      pr: "https://github.com/org/my-app/pull/2",
      branch: "feat/two",
    });
    expect(readMetadataRaw(dir, "kr-1")!["killedReason"]).toBeUndefined();
  }, 20_000);

  it("claimPR's write (holds, M-2): the lifecycle writes nothing", async () => {
    const read = seedRecord({ status: "pr_open", pr: "https://github.com/org/my-app/pull/1" });
    const { written } = await writeWhileHeld("claim", read);

    expect(written).toBeNull();
    expect(readMetadataRaw(dir, "kr-1")).toMatchObject({
      status: "pr_open",
      pr: "https://github.com/org/my-app/pull/2",
    });
  }, 20_000);
});

describe("1.2 item 1: the record lock", () => {
  it("is free at once when its holder gets kill -9, and leaves no file", async () => {
    seedRecord();
    const holder = runChild({
      dir,
      id: "kr-1",
      ready: marker("ready"),
      done: marker("done"),
      holdMs: 60_000,
    });
    await vi.waitFor(() => expect(existsSync(marker("ready"))).toBe(true), {
      timeout: 10_000,
      interval: 5,
    });
    const name = recordLockName(dir, "kr-1");
    expect(await isDeliveryLockHeld(name)).toBe(true);

    holder.child.kill("SIGKILL");
    await holder.exited;

    expect(await isDeliveryLockHeld(name)).toBe(false);
    const started = Date.now();
    updateMetadata(dir, "kr-1", { summary: "after the crash" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(readdirSync(dir).sort()).toEqual([".ready", "kr-1"]);
  }, 20_000);

  it("refuses the write, and changes nothing, when another process holds it too long", async () => {
    const before = seedRecord();
    const holder = runChild({
      dir,
      id: "kr-1",
      ready: marker("ready"),
      done: marker("done"),
      holdMs: RECORD_LOCK_WAIT_MS + 5_000,
      releaseOn: marker("release"),
    });
    await vi.waitFor(() => expect(existsSync(marker("ready"))).toBe(true), {
      timeout: 10_000,
      interval: 5,
    });

    expect(() => updateMetadata(dir, "kr-1", { status: "killed" })).toThrow(
      `is held by another process for more than ${RECORD_LOCK_WAIT_MS} ms`,
    );
    expect(readMetadataRaw(dir, "kr-1")).toEqual(before);

    writeFileSync(marker("release"), "");
    expect(await holder.exited).toBe(0);
  }, 30_000);

  it("is skipped on a platform without it: the write does not wait", async () => {
    seedRecord();
    const holder = runChild({
      dir,
      id: "kr-1",
      ready: marker("ready"),
      done: marker("done"),
      holdMs: 10_000,
      releaseOn: marker("release"),
    });
    await vi.waitFor(() => expect(existsSync(marker("ready"))).toBe(true), {
      timeout: 10_000,
      interval: 5,
    });
    lockPlatform.supported = false;

    const started = Date.now();
    updateMetadata(dir, "kr-1", { summary: "unlocked" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(readMetadataRaw(dir, "kr-1")!["summary"]).toBe("unlocked");

    writeFileSync(marker("release"), "");
    expect(await holder.exited).toBe(0);
  }, 20_000);
});

describe("1.2 item 3: the generation counter", () => {
  it("increments with every write, and no caller can set it", () => {
    writeMetadata(dir, "kr-1", { worktree: "/tmp", branch: "main", status: "working" });
    expect(readMetadataRaw(dir, "kr-1")!["generation"]).toBe("1");
    updateMetadata(dir, "kr-1", { summary: "x" });
    expect(readMetadataRaw(dir, "kr-1")!["generation"]).toBe("2");
    expect(updateMetadataIf(dir, "kr-1", { generation: "2" }, { summary: "y" })).toMatchObject({
      generation: "3",
    });
    updateMetadata(dir, "kr-1", { generation: "99" });
    expect(readMetadataRaw(dir, "kr-1")!["generation"]).toBe("4");
  });

  it("continues after an archive, so a copy-back or a new record never repeats one", () => {
    seedRecord();
    expect(readMetadataRaw(dir, "kr-1")!["generation"]).toBe("2");
    deleteMetadata(dir, "kr-1", true);

    // An empty reservation has no generation; its first write continues from the archive.
    expect(reserveSessionId(dir, "kr-1")).toBe(true);
    expect(readMetadataRaw(dir, "kr-1")).toEqual({});
    updateMetadata(dir, "kr-1", { status: "spawning" });
    expect(readMetadataRaw(dir, "kr-1")!["generation"]).toBe("3");

    deleteMetadata(dir, "kr-1", true);
    writeMetadata(dir, "kr-1", { worktree: "/tmp", branch: "main", status: "killed" });
    expect(readMetadataRaw(dir, "kr-1")!["generation"]).toBe("4");
  });

  it("a conditional write against an older generation, or a gone record, writes nothing", () => {
    const read = seedRecord();
    updateMetadata(dir, "kr-1", { opencodeSessionId: "ses_new" });

    expect(
      updateMetadataIf(dir, "kr-1", { generation: read["generation"] }, { a: "1" }),
    ).toBeNull();
    deleteMetadata(dir, "kr-1", true);
    expect(updateMetadataIf(dir, "kr-1", {}, { status: "killed" })).toBeNull();
    expect(readMetadataRaw(dir, "kr-1")).toBeNull();
  });

  it("removes killedReason when any write moves the status away from killed", () => {
    seedRecord({ status: "killed", killedReason: "runtime" });
    updateMetadata(dir, "kr-1", { status: "spawning", runtimeHandle: "new" });

    expect(readMetadataRaw(dir, "kr-1")).toMatchObject({ status: "spawning" });
    expect(readMetadataRaw(dir, "kr-1")!["killedReason"]).toBeUndefined();
  });
});
