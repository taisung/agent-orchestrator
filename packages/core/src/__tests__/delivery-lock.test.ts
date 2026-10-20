import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as NetModule from "node:net";
import ts from "typescript";
import {
  deliveryLockName,
  holdDeliveryLock,
  isDeliveryLockHeld,
  isDeliveryLockSupported,
  printableLockName,
  tryHoldDeliveryLock,
  type DeliveryLock,
} from "../delivery-lock.js";

// A test can replace the socket that `connect` gives to the probe, to inject
// an error or no answer. Every other `node:net` call runs as it is.
const probeFaults = vi.hoisted(() => ({
  connect: undefined as undefined | ((socket: NetModule.Socket) => void),
}));
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof NetModule>();
  const connect = (...args: unknown[]) => {
    const fault = probeFaults.connect;
    if (!fault) return (actual.connect as (...a: unknown[]) => NetModule.Socket)(...args);
    const socket = new actual.Socket();
    fault(socket);
    return socket;
  };
  return { ...actual, connect, default: { ...actual, connect } };
});

// ---------------------------------------------------------------------------
// Real child processes run the same code: the test compiles delivery-lock.ts
// with the TypeScript compiler.
// ---------------------------------------------------------------------------

let childDir: string;
let scratch: string;
const children: ChildProcess[] = [];
const holds: DeliveryLock[] = [];

const CHILD = `
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tryHoldDeliveryLock } from "./delivery-lock.js";
const cmd = JSON.parse(process.argv[2]);
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const lock = await tryHoldDeliveryLock(cmd.name);
if (!lock) { say({ held: false }); process.exit(3); }
const grandchild = cmd.spawnChild
  ? spawn("sleep", ["300"], { stdio: "ignore", detached: false })
  : undefined;
say({ held: true, grandchild: grandchild?.pid });
const timer = setInterval(() => {
  if (cmd.releaseOn && existsSync(cmd.releaseOn)) {
    lock.release();
    say({ released: true });
    clearInterval(timer);
    setInterval(() => {}, 1 << 30);
  }
}, 5);
`;

interface Child {
  child: ChildProcess;
  next(predicate: (line: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
  exited: Promise<number | null>;
}

function runChild(cmd: Record<string, unknown>): Child {
  const child = spawn(process.execPath, [join(childDir, "child.js"), JSON.stringify(cmd)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env["PATH"] ?? "" },
  });
  children.push(child);
  const lines: Record<string, unknown>[] = [];
  const waiters: Array<() => void> = [];
  let buffer = "";
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      lines.push(JSON.parse(buffer.slice(0, at)) as Record<string, unknown>);
      buffer = buffer.slice(at + 1);
      for (const wake of waiters.splice(0)) wake();
    }
  });
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    child,
    exited,
    async next(predicate) {
      for (;;) {
        const found = lines.find(predicate);
        if (found) return found;
        const done = await Promise.race([
          new Promise<"line">((resolve) => waiters.push(() => resolve("line"))),
          exited.then(() => "exit" as const),
        ]);
        if (done === "exit" && !lines.find(predicate)) {
          throw new Error(`child ${child.pid} exited: ${stderr}`);
        }
      }
    },
  };
}

async function stop(child: Child): Promise<void> {
  if (child.child.exitCode === null && child.child.signalCode === null) {
    child.child.kill("SIGKILL");
  }
  await child.exited;
}

/** A lock name under this test's scratch directory (the state-root part of the rule). */
const nameFor = (label: string) => deliveryLockName("ledger", join(scratch, `${label}.json`));

async function hold(name: string): Promise<DeliveryLock> {
  const lock = await tryHoldDeliveryLock(name);
  expect(lock).not.toBeNull();
  holds.push(lock!);
  return lock!;
}

beforeAll(() => {
  childDir = mkdtempSync(join(tmpdir(), "ao-lock-child-"));
  const source = readFileSync(new URL("../delivery-lock.ts", import.meta.url), "utf-8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  writeFileSync(join(childDir, "delivery-lock.js"), output);
  writeFileSync(join(childDir, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(childDir, "child.js"), CHILD);
});

afterAll(() => {
  rmSync(childDir, { recursive: true, force: true });
});

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "ao-lock-"));
});

afterEach(async () => {
  for (const lock of holds.splice(0)) lock.release();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  rmSync(scratch, { recursive: true, force: true });
});

describe("a lock that the OS releases (I-5 round 4, M-4)", () => {
  it("is exclusive across processes, and the kernel frees it at once when its holder gets kill -9", async () => {
    const name = nameFor("across");
    const holder = runChild({ name });
    await holder.next((line) => line["held"] === true);

    expect(await tryHoldDeliveryLock(name)).toBeNull();
    expect(await isDeliveryLockHeld(name)).toBe(true);

    holder.child.kill("SIGKILL");
    await holder.exited;

    // No wait and no file to remove: the first bind after the exit wins.
    const lock = await hold(name);
    expect(lock.name).toBe(name);
    expect(await isDeliveryLockHeld(name)).toBe(true);
  });

  it("is exclusive inside one process too, and a release frees it", async () => {
    const name = nameFor("inside");
    const first = await hold(name);

    expect(await tryHoldDeliveryLock(name)).toBeNull();
    first.release();
    expect(await isDeliveryLockHeld(name)).toBe(false);
    await hold(name);
  });

  it("a child process of the holder does not keep the name after the holder ends (close-on-exec)", async () => {
    const name = nameFor("grandchild");
    const holder = runChild({ name, spawnChild: true });
    const { grandchild } = await holder.next((line) => line["held"] === true);
    expect(typeof grandchild).toBe("number");
    try {
      holder.child.kill("SIGKILL");
      await holder.exited;
      // The `sleep` child of the holder still runs, and the name is free.
      expect(() => process.kill(grandchild as number, 0)).not.toThrow();
      expect(await isDeliveryLockHeld(name)).toBe(false);
      await hold(name);
    } finally {
      process.kill(grandchild as number, "SIGKILL");
    }
  });

  it("a probe never takes a name: many probes leave a held name held and a free name free", async () => {
    const heldName = nameFor("probed-held");
    const freeName = nameFor("probed-free");
    const holder = runChild({ name: heldName });
    await holder.next((line) => line["held"] === true);

    for (let i = 0; i < 20; i++) {
      expect(await isDeliveryLockHeld(heldName)).toBe(true);
      expect(await isDeliveryLockHeld(freeName)).toBe(false);
    }

    expect(await tryHoldDeliveryLock(heldName)).toBeNull();
    await hold(freeName);
    await stop(holder);
  });

  it("a release acts only on its own hold: a second release of an earlier hold does not free a later holder", async () => {
    const name = nameFor("stale-release");
    const earlier = await hold(name);
    earlier.release();
    const holder = runChild({ name });
    await holder.next((line) => line["held"] === true);

    earlier.release();

    expect(await isDeliveryLockHeld(name)).toBe(true);
    expect(await tryHoldDeliveryLock(name)).toBeNull();
    await stop(holder);

    // The same rule inside one process: a later hold of this process stays.
    const later = await hold(name);
    earlier.release();
    expect(await tryHoldDeliveryLock(name)).toBeNull();
    later.release();
    expect(await isDeliveryLockHeld(name)).toBe(false);
  });

  it("a probe counts only a refusal as free: every other error and no answer in 1 s count as held", async () => {
    const name = nameFor("probe-errors");
    const probeWith = (code: string) => {
      probeFaults.connect = (socket) =>
        process.nextTick(() =>
          socket.emit("error", Object.assign(new Error(`connect ${code}`), { code })),
        );
      return isDeliveryLockHeld(name);
    };
    try {
      for (const code of ["ECONNREFUSED", "ENOENT"]) {
        expect(await probeWith(code), code).toBe(false);
      }
      for (const code of ["EAGAIN", "EACCES", "EMFILE", "ECONNRESET", "ETIMEDOUT"]) {
        expect(await probeWith(code), code).toBe(true);
      }

      // No answer: the socket never connects and never fails.
      probeFaults.connect = () => {};
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let result: boolean | undefined;
      void isDeliveryLockHeld(name).then((held) => (result = held));
      await vi.advanceTimersByTimeAsync(999);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toBe(true);
    } finally {
      vi.useRealTimers();
      probeFaults.connect = undefined;
    }
    // The real probe again: nobody holds this name.
    expect(await isDeliveryLockHeld(name)).toBe(false);
  });

  it("holdDeliveryLock waits for a holder that releases, and gives null after the wait for one that keeps it", async () => {
    const name = nameFor("wait");
    const go = join(scratch, "go");
    const holder = runChild({ name, releaseOn: go });
    await holder.next((line) => line["held"] === true);

    const kept = await holdDeliveryLock(name, 300);
    expect(kept).toBeNull();
    expect(await isDeliveryLockHeld(name)).toBe(true);

    const waiting = holdDeliveryLock(name, 30_000);
    writeFileSync(go, "");
    const lock = await waiting;
    expect(lock).not.toBeNull();
    holds.push(lock!);
    await holder.next((line) => line["released"] === true);
    await stop(holder);
  });

  it("names of two state roots, two kinds and two users do not block each other", async () => {
    const rootA = join(scratch, "rootA", "deliveries", "ses_same.json");
    const rootB = join(scratch, "rootB", "deliveries", "ses_same.json");
    await hold(deliveryLockName("ledger", rootA));

    expect(await tryHoldDeliveryLock(deliveryLockName("ledger", rootA))).toBeNull();
    await hold(deliveryLockName("ledger", rootB));
    await hold(deliveryLockName("attempt", rootA));

    const getuid = vi.spyOn(process, "getuid").mockReturnValue(4242);
    try {
      const otherUser = deliveryLockName("ledger", rootA);
      expect(printableLockName(otherUser)).toMatch(/^@ao-delivery-4242-ledger-[0-9a-f]{32}$/);
      await hold(otherUser);
    } finally {
      getuid.mockRestore();
    }
  });

  it("is a Linux primitive: other platforms have none", () => {
    expect(isDeliveryLockSupported("linux")).toBe(true);
    expect(isDeliveryLockSupported("darwin")).toBe(false);
    expect(isDeliveryLockSupported("win32")).toBe(false);
  });
});
