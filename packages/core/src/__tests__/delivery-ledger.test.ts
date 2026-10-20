import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  DELIVERY_LEDGER_MAX_ENTRIES,
  DELIVERY_LOCK_WAIT_MS,
  DeliveryLedgerBusyError,
  DeliveryLedgerCorruptError,
  beginDelivery,
  changeDeliveryLedger,
  deliveryAttemptLockName,
  deliveryLedgerLockName,
  deliveryLedgerPath,
  readDeliveryLedger,
  removeDeliveryLedger,
  removeExpiredDeliveryLedgers,
  settleDelivery,
  type DeliveryEntry,
} from "../delivery-ledger.js";
import { isDeliveryLockHeld, tryHoldDeliveryLock, type DeliveryLock } from "../delivery-lock.js";

const KEY = "ses_ledgerTest01";
const MINUTE = 60_000;

let dir: string;
let minted = 0;
const mint = () => `msg_test${++minted}`;
const sha = (text: string) => createHash("sha256").update(text, "utf-8").digest("hex");
const ledgerFile = () => deliveryLedgerPath(dir, KEY);
const entries = () => readDeliveryLedger(dir, KEY);
const begin = (text: string) => beginDelivery({ dir, key: KEY, textSha256: sha(text), mint });
const holds: DeliveryLock[] = [];

function writeLedger(list: DeliveryEntry[], key = KEY): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(deliveryLedgerPath(dir, key), JSON.stringify({ version: 2, key, entries: list }));
}

/** An entry whose attempt lock nobody holds (a random token), unless a test holds it. */
function entry(text: string, overrides: Partial<DeliveryEntry> = {}): DeliveryEntry {
  const at = new Date().toISOString();
  return {
    inputId: `msg_crafted${++minted}`,
    textSha256: sha(text),
    createdAt: at,
    updatedAt: at,
    state: "sending",
    owner: { pid: process.pid, token: randomUUID() },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Real child processes: the test compiles delivery-ledger.ts, delivery-lock.ts
// and atomic-write.ts with the TypeScript compiler, so each child runs the
// same code as core. In the copies, `node:fs` is a thin wrapper that can make
// `rmSync` or `renameSync` of one path fail (EACCES), so a child can fail
// exactly one step of a settle.
// ---------------------------------------------------------------------------

let childDir: string;
const children: ChildProcess[] = [];

const FAULT_FS = `
import * as fs from "node:fs";
export * from "node:fs";
export const faults = { rm: new Set(), rename: new Set() };
const fail = (op, path) => {
  const err = new Error("EACCES: injected " + op + " fault, " + path);
  err.code = "EACCES";
  throw err;
};
export function rmSync(path, options) {
  if (faults.rm.has(String(path))) fail("rm", path);
  return fs.rmSync(path, options);
}
export function renameSync(from, to) {
  if (faults.rename.has(String(to))) fail("rename", to);
  return fs.renameSync(from, to);
}
`;

const CHILD = `
import { appendFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import { faults } from "./fault-fs.js";
import {
  beginDelivery,
  changeDeliveryLedger,
  deliveryLedgerLockName,
  settleDelivery,
} from "./delivery-ledger.js";
const cmd = JSON.parse(process.argv[2]);
const sha = (t) => createHash("sha256").update(t, "utf-8").digest("hex");
const block = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const idle = () => setInterval(() => {}, 1 << 30);
let n = 0;
const mint = () => "msg_c" + process.pid + "x" + ++n;
const waitFor = async (file) => {
  while (file && !existsSync(file)) await new Promise((r) => setTimeout(r, 2));
};
await waitFor(cmd.go);
const base = { dir: cmd.dir, key: cmd.key };
if (cmd.op === "begin-and-hang") {
  const a = await beginDelivery({ ...base, textSha256: sha(cmd.text), mint });
  // The service admits the input; then the answer never comes.
  if (cmd.service) appendFileSync(cmd.service, a.inputId + "\\n");
  say({ began: a.inputId, token: a.token });
  idle();
} else if (cmd.op === "begin-stop-after-claim") {
  // Stop for good just after the ledger lock of the claim closes, before
  // beginDelivery returns: the claim is in the file at this point.
  const close = net.Server.prototype.close;
  net.Server.prototype.close = function (...args) {
    const name = this.address();
    const result = close.apply(this, args);
    if (name === deliveryLedgerLockName(cmd.dir, cmd.key)) {
      say({ stopped: "after-claim" });
      block();
    }
    return result;
  };
  await beginDelivery({ ...base, textSha256: sha(cmd.text), mint });
  say({ returned: true });
} else if (cmd.op === "begin-settle") {
  const a = await beginDelivery({ ...base, textSha256: sha(cmd.text), mint });
  say({ began: a.inputId, token: a.token });
  await waitFor(cmd.settleOn);
  for (const path of cmd.failRm ?? []) faults.rm.add(path);
  for (const path of cmd.failRename ?? []) faults.rename.add(path);
  const written = await settleDelivery({ ...base, attempt: a, outcome: cmd.outcome });
  faults.rm.clear();
  faults.rename.clear();
  say({ settled: written, inputId: a.inputId });
  if (cmd.stay) idle();
} else if (cmd.op === "begin") {
  const a = await beginDelivery({ ...base, textSha256: sha(cmd.text), mint });
  say({ inputId: a.inputId, reused: a.reused });
} else if (cmd.op === "change") {
  // pause: "in-change" (after the read, before the write) or "before-unlock"
  // (after the write, before the lock release); trace: enter and exit lines.
  say({ calling: true });
  await changeDeliveryLedger(
    cmd.dir,
    cmd.key,
    async (entries) => {
      if (cmd.trace) appendFileSync(cmd.trace, "enter " + process.pid + "\\n");
      if (cmd.pause === "in-change") { say({ paused: "in-change" }); block(); }
      if (cmd.until) { say({ paused: "until" }); await waitFor(cmd.until); }
      if (cmd.trace) appendFileSync(cmd.trace, "exit " + process.pid + "\\n");
      return { entries: cmd.add ? [...entries, cmd.add] : entries, result: undefined };
    },
    {
      beforeUnlock: () => {
        if (cmd.pause === "before-unlock") { say({ paused: "before-unlock" }); block(); }
      },
    },
  );
  say({ done: true });
} else if (cmd.op === "cycles") {
  for (let i = 0; i < cmd.count; i++) {
    await changeDeliveryLedger(cmd.dir, cmd.key, (entries) => {
      appendFileSync(cmd.trace, "enter " + process.pid + " " + i + "\\n");
      const add = { ...cmd.template, inputId: "msg_" + cmd.prefix + i, textSha256: sha(cmd.prefix + i) };
      appendFileSync(cmd.trace, "exit " + process.pid + " " + i + "\\n");
      return { entries: [...entries, add], result: undefined };
    });
  }
  say({ done: true });
}
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

async function kill9(child: Child): Promise<void> {
  child.child.kill("SIGKILL");
  await child.exited;
}

function isAlive(child: Child): boolean {
  return child.child.exitCode === null && child.child.signalCode === null;
}

beforeAll(() => {
  childDir = mkdtempSync(join(tmpdir(), "ao-ledger-child-"));
  for (const name of ["delivery-ledger", "delivery-lock", "atomic-write"]) {
    const source = readFileSync(new URL(`../${name}.ts`, import.meta.url), "utf-8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    writeFileSync(join(childDir, `${name}.js`), output.replaceAll('"node:fs"', '"./fault-fs.js"'));
  }
  writeFileSync(join(childDir, "fault-fs.js"), FAULT_FS);
  writeFileSync(join(childDir, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(childDir, "child.js"), CHILD);
});

afterAll(() => {
  rmSync(childDir, { recursive: true, force: true });
});

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "ao-ledger-")), "deliveries");
});

afterEach(async () => {
  for (const lock of holds.splice(0)) lock.release();
  const stopping = children.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.on("exit", resolve));
    child.kill("SIGKILL");
    await exited;
  });
  await Promise.all(stopping);
  chmodSync(join(dir, ".."), 0o755);
  if (existsSync(dir)) chmodSync(dir, 0o755);
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("delivery ledger: one input ID per logical send (I-5 rounds 3 and 4)", () => {
  it("persists a sending entry, holds its attempt lock until the settle, and an admitted send leaves no file", async () => {
    const attempt = await begin("hello");

    expect(attempt.reused).toBe(false);
    expect(entries()).toEqual([
      {
        inputId: attempt.inputId,
        textSha256: sha("hello"),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        state: "sending",
        owner: { pid: process.pid, token: attempt.token },
      },
    ]);
    const attemptLock = deliveryAttemptLockName(dir, KEY, attempt.token);
    expect(await isDeliveryLockHeld(attemptLock)).toBe(true);

    await expect(settleDelivery({ dir, key: KEY, attempt, outcome: "admitted" })).resolves.toBe(
      true,
    );
    expect(existsSync(ledgerFile())).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    expect(await isDeliveryLockHeld(attemptLock)).toBe(false);
  });

  it("gives a new ID to a second attempt of the same text while the first is in flight", async () => {
    const first = await begin("same");
    const second = await begin("same");

    expect(second.inputId).not.toBe(first.inputId);
    expect(entries().map((e) => e.state)).toEqual(["sending", "sending"]);
  });

  it("an unknown attempt gives its ID to the next attempt of the same text, and not to another text", async () => {
    const first = await begin("retry me");
    await settleDelivery({ dir, key: KEY, attempt: first, outcome: "unknown" });

    const other = await begin("another text");
    const retry = await begin("retry me");

    expect(other.inputId).not.toBe(first.inputId);
    expect(retry).toEqual(expect.objectContaining({ inputId: first.inputId, reused: true }));
    expect(entries().find((e) => e.inputId === first.inputId)).toEqual(
      expect.objectContaining({
        state: "sending",
        owner: { pid: process.pid, token: retry.token },
      }),
    );
  });

  it("a definite refusal removes the entry, so the same text then gets a new ID", async () => {
    const refused = await begin("refused");
    await settleDelivery({ dir, key: KEY, attempt: refused, outcome: "none" });

    expect(existsSync(ledgerFile())).toBe(false);
    expect((await begin("refused")).inputId).not.toBe(refused.inputId);
  });

  it("reuses an entry changed 9 min ago, and removes one changed 11 min ago", async () => {
    const old = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();
    const nine = entry("nine", { state: "unknown", createdAt: old(30), updatedAt: old(9) });
    const eleven = entry("eleven", { state: "unknown", createdAt: old(11), updatedAt: old(11) });
    writeLedger([nine, eleven]);

    expect((await begin("nine")).inputId).toBe(nine.inputId);
    const fresh = await begin("eleven");

    expect(fresh.inputId).not.toBe(eleven.inputId);
    expect(entries().map((e) => e.inputId)).toEqual([nine.inputId, fresh.inputId]);
  });

  it("refuses a new send when the ledger is full, and still reuses an ID in it", async () => {
    const full = Array.from({ length: DELIVERY_LEDGER_MAX_ENTRIES }, (_, i) =>
      entry(`text ${i}`, { state: "unknown" }),
    );
    writeLedger(full);
    const before = readFileSync(ledgerFile(), "utf-8");

    await expect(begin("one more")).rejects.toThrow(/holds 200 sends younger than 10 min/);
    expect(readFileSync(ledgerFile(), "utf-8")).toBe(before);
    expect((await begin("text 7")).inputId).toBe(full[7]!.inputId);
  });

  it("on a platform without the lock (darwin), refuses before it writes anything", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      await expect(begin("no lock here")).rejects.toThrow(
        /needs a lock that the OS releases \(a Linux abstract Unix socket\), and darwin has none/,
      );
      await expect(
        changeDeliveryLedger(dir, KEY, () => ({ entries: [], result: undefined })),
      ).rejects.toThrow(/darwin has none/);
      expect(await removeExpiredDeliveryLedgers(dir)).toEqual({ removed: [], failed: [] });
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
    expect(existsSync(dir)).toBe(false);
  });

  describe("attempt liveness across processes (B-2, B-3)", () => {
    it("B-3: a long-lived child whose write of unknown fails stays alive; a retry from this process takes its ID", async () => {
      mkdirSync(dir, { recursive: true });
      const owner = runChild({
        op: "begin-settle",
        dir,
        key: KEY,
        text: "LIVE OWNER FAILED UNKNOWN",
        outcome: "unknown",
        failRename: [ledgerFile()],
        stay: true,
      });
      const { began, token } = await owner.next((line) => typeof line["began"] === "string");
      const { settled } = await owner.next((line) => "settled" in line);

      expect(settled).toBe(false);
      expect(isAlive(owner)).toBe(true);
      expect(entries()).toEqual([
        expect.objectContaining({
          inputId: began,
          state: "sending",
          owner: { pid: owner.child.pid, token },
        }),
      ]);

      const retry = await begin("LIVE OWNER FAILED UNKNOWN");

      expect(retry).toEqual(expect.objectContaining({ inputId: began, reused: true }));
      expect(isAlive(owner)).toBe(true);
    });

    it("B-3: a child with its attempt in flight: an equal send from this process gets a new ID; after its unknown settle the next takes its ID", async () => {
      mkdirSync(dir, { recursive: true });
      const settleOn = join(dir, "..", "settle");
      const owner = runChild({
        op: "begin-settle",
        dir,
        key: KEY,
        text: "IN FLIGHT",
        outcome: "unknown",
        settleOn,
        stay: true,
      });
      const { began } = await owner.next((line) => typeof line["began"] === "string");

      const concurrent = await begin("IN FLIGHT");
      expect(concurrent.inputId).not.toBe(began);

      writeFileSync(settleOn, "");
      await owner.next((line) => line["settled"] === true);
      const retry = await begin("IN FLIGHT");

      expect(retry.inputId).toBe(began);
    });

    it("B-2: a child that began a send and was ended with kill -9: the retry takes its ID, so the service admits once", async () => {
      const service = join(dir, "..", "service-admitted.txt");
      writeFileSync(service, "");
      const sender = runChild({
        op: "begin-and-hang",
        dir,
        key: KEY,
        text: "CRASH SAME TEXT",
        service,
      });
      const { began } = await sender.next((line) => typeof line["began"] === "string");
      await kill9(sender);

      const retry = await begin("CRASH SAME TEXT");
      // The fake service follows the reconcile rule of 2.0.32: a known ID is answered again.
      const admitted = new Set(readFileSync(service, "utf-8").split("\n").filter(Boolean));
      admitted.add(retry.inputId);

      expect(retry.inputId).toBe(began);
      expect(admitted.size).toBe(1);
    });

    it("a failed write of unknown in this process: the next send of this process takes the same ID", async () => {
      const first = await begin("UNKNOWN WRITE SAME TEXT");
      chmodSync(dir, 0o555);
      const written = await settleDelivery({ dir, key: KEY, attempt: first, outcome: "unknown" });
      chmodSync(dir, 0o755);

      expect(written).toBe(false);
      expect(entries()).toEqual([
        expect.objectContaining({ inputId: first.inputId, state: "sending" }),
      ]);
      expect((await begin("UNKNOWN WRITE SAME TEXT")).inputId).toBe(first.inputId);
    });

    it("the probe does not take an attempt lock: after a claim whose write failed, another process takes the ID", async () => {
      const ended = entry("PROBED THEN FAILED");
      writeLedger([ended]);
      chmodSync(dir, 0o555);
      await expect(begin("PROBED THEN FAILED")).rejects.toThrow(
        /could not write the delivery ledger/,
      );
      chmodSync(dir, 0o755);

      const other = runChild({ op: "begin", dir, key: KEY, text: "PROBED THEN FAILED" });
      const answer = await other.next((line) => typeof line["inputId"] === "string");

      expect(answer).toEqual({ inputId: ended.inputId, reused: true });
    });

    it("a settle of an earlier attempt does not change a later claim of the same input ID", async () => {
      const earlier = await begin("CLAIMED AGAIN");
      await settleDelivery({ dir, key: KEY, attempt: earlier, outcome: "unknown" });
      const later = runChild({
        op: "begin-settle",
        dir,
        key: KEY,
        text: "CLAIMED AGAIN",
        outcome: "unknown",
        settleOn: join(dir, "..", "never"),
      });
      const { began, token } = await later.next((line) => typeof line["began"] === "string");
      expect(began).toBe(earlier.inputId);

      await settleDelivery({ dir, key: KEY, attempt: earlier, outcome: "none" });
      await settleDelivery({ dir, key: KEY, attempt: earlier, outcome: "admitted" });

      expect(entries()).toEqual([
        expect.objectContaining({
          inputId: began,
          state: "sending",
          owner: { pid: later.child.pid, token },
        }),
      ]);
    });

    it("the attempt lock is held before the claim is in the file: a child stopped just after its claim keeps its ID", async () => {
      const owner = runChild({
        op: "begin-stop-after-claim",
        dir,
        key: KEY,
        text: "CLAIM THEN STOP",
      });
      await owner.next((line) => line["stopped"] === "after-claim");
      const [claim] = entries();
      expect(claim).toMatchObject({ state: "sending", owner: { pid: owner.child.pid } });

      const mine = await begin("CLAIM THEN STOP");
      holds.push(mine.hold);
      expect(mine.reused).toBe(false);
      expect(mine.inputId).not.toBe(claim!.inputId);

      // Once the owner ends, its claim is free, and the next attempt takes it.
      await kill9(owner);
      const retry = await begin("CLAIM THEN STOP");
      holds.push(retry.hold);
      expect(retry).toMatchObject({ inputId: claim!.inputId, reused: true });
    });

    it("two spellings of one ledger dir (a symbolic link) share the ledger lock and the attempt locks", async () => {
      mkdirSync(dir, { recursive: true });
      const alias = join(dir, "..", "alias-of-deliveries");
      symlinkSync(dir, alias);

      const held = await tryHoldDeliveryLock(deliveryLedgerLockName(dir, KEY));
      expect(held).not.toBeNull();
      holds.push(held!);
      expect(await tryHoldDeliveryLock(deliveryLedgerLockName(alias, KEY))).toBeNull();
      held!.release();

      const owner = runChild({ op: "begin-and-hang", dir, key: KEY, text: "TWO SPELLINGS" });
      const { began } = await owner.next((line) => typeof line["began"] === "string");
      const mine = await beginDelivery({
        dir: alias,
        key: KEY,
        textSha256: sha("TWO SPELLINGS"),
        mint,
      });
      holds.push(mine.hold);

      expect(mine.reused).toBe(false);
      expect(mine.inputId).not.toBe(began);
      expect(entries().map((e) => e.inputId)).toEqual([began, mine.inputId]);
    });

    it("a settle of unknown or of a definite refusal keeps its attempt lock until its write: while it waits for the ledger lock, the attempt stays held", async () => {
      for (const outcome of ["unknown", "none"] as const) {
        const attempt = await begin(`SETTLE WAITS ${outcome}`);
        const attemptLock = deliveryAttemptLockName(dir, KEY, attempt.token);
        const blocker = await tryHoldDeliveryLock(deliveryLedgerLockName(dir, KEY));
        expect(blocker).not.toBeNull();
        holds.push(blocker!);

        const settling = settleDelivery({ dir, key: KEY, attempt, outcome });
        // The settle cannot write while this test holds the ledger lock.
        expect(await isDeliveryLockHeld(attemptLock), outcome).toBe(true);
        expect(entries().find((e) => e.inputId === attempt.inputId)?.state, outcome).toBe(
          "sending",
        );

        blocker!.release();
        await expect(settling, outcome).resolves.toBe(true);
        expect(await isDeliveryLockHeld(attemptLock), outcome).toBe(false);
      }
      expect(entries().map((e) => e.state)).toEqual(["unknown"]);
    });
  });

  describe("an admitted send is never reused (M-5)", () => {
    it("M-5: a success whose clear fails, then the child exits: an equal send from this process gets a new ID", async () => {
      mkdirSync(dir, { recursive: true });
      const sender = runChild({
        op: "begin-settle",
        dir,
        key: KEY,
        text: "INTENDED AGAIN",
        outcome: "admitted",
        failRm: [ledgerFile()],
      });
      const { began } = await sender.next((line) => typeof line["began"] === "string");
      const { settled } = await sender.next((line) => "settled" in line);
      await sender.exited;

      expect(settled).toBe(true);
      expect(entries()).toEqual([expect.objectContaining({ inputId: began, state: "admitted" })]);

      const again = await begin("INTENDED AGAIN");

      expect(again.reused).toBe(false);
      expect(again.inputId).not.toBe(began);
      expect(entries().map((e) => e.inputId)).toEqual([again.inputId]);
    });

    it("M-5: when the admitted mark fails three times, the child keeps its attempt lock: equal sends get new IDs while it runs", async () => {
      mkdirSync(dir, { recursive: true });
      const sender = runChild({
        op: "begin-settle",
        dir,
        key: KEY,
        text: "MARK FAILS",
        outcome: "admitted",
        failRename: [ledgerFile()],
        failRm: [ledgerFile()],
        stay: true,
      });
      const { began, token } = await sender.next((line) => typeof line["began"] === "string");
      const { settled } = await sender.next((line) => "settled" in line);

      expect(settled).toBe(false);
      expect(entries()).toEqual([expect.objectContaining({ inputId: began, state: "sending" })]);
      expect(await isDeliveryLockHeld(deliveryAttemptLockName(dir, KEY, token as string))).toBe(
        true,
      );
      const whileRunning = await begin("MARK FAILS");
      expect(whileRunning.inputId).not.toBe(began);
      await settleDelivery({ dir, key: KEY, attempt: whileRunning, outcome: "admitted" });

      // The documented limit: after the process ends, its entry is like one of
      // a process that ended during the call, and an equal send takes its ID.
      await kill9(sender);
      expect((await begin("MARK FAILS")).inputId).toBe(began);
    });
  });

  describe("the ledger lock (M-4)", () => {
    it("M-4: a child that holds the lock is ended with kill -9: the next change takes the lock at once, with no file to remove", async () => {
      const holder = runChild({ op: "change", dir, key: KEY, pause: "in-change" });
      await holder.next((line) => line["paused"] === "in-change");
      const lockName = deliveryLedgerLockName(dir, KEY);
      expect(await tryHoldDeliveryLock(lockName)).toBeNull();
      const filesWhileHeld = readdirSync(dir);

      await kill9(holder);

      const lock = await tryHoldDeliveryLock(lockName);
      expect(lock).not.toBeNull();
      lock!.release();
      expect(filesWhileHeld).toEqual([]);
      const attempt = await begin("after the holder ended");
      expect(entries().map((e) => e.inputId)).toEqual([attempt.inputId]);
    });

    it("M-4: a child ended at each step of a change or a send leaves no state that blocks a later send", async () => {
      const kept = entry("kept", { state: "unknown" });
      const steps: Array<
        [string, Record<string, unknown>, (l: Record<string, unknown>) => boolean]
      > = [
        ["waits for the lock", { op: "change" }, (l) => l["calling"] === true],
        [
          "holds the lock, before the write",
          { op: "change", pause: "in-change", add: entry("lost") },
          (l) => l["paused"] === "in-change",
        ],
        [
          "after the write, before the release",
          { op: "change", pause: "before-unlock", add: entry("written") },
          (l) => l["paused"] === "before-unlock",
        ],
        [
          "holds an attempt lock (a send in flight)",
          { op: "begin-and-hang", text: "kept" },
          (l) => typeof l["began"] === "string",
        ],
      ];
      for (const [step, cmd, reached] of steps) {
        writeLedger([kept]);
        let ours: DeliveryLock | null = null;
        if (step === "waits for the lock")
          ours = await tryHoldDeliveryLock(deliveryLedgerLockName(dir, KEY));
        const child = runChild({ ...cmd, dir, key: KEY });
        await child.next(reached);
        await kill9(child);
        ours?.release();

        const lock = await tryHoldDeliveryLock(deliveryLedgerLockName(dir, KEY));
        expect(lock, step).not.toBeNull();
        lock!.release();
        const retry = await begin("kept");
        expect(retry.inputId, step).toBe(kept.inputId);
        await settleDelivery({ dir, key: KEY, attempt: retry, outcome: "unknown" });
        const ids = entries().map((e) => e.inputId);
        expect(ids, step).toContain(kept.inputId);
        expect(ids.length, step).toBeLessThanOrEqual(2);
        rmSync(ledgerFile(), { force: true });
      }
      expect(readdirSync(dir).filter((name) => name.includes(".tmp."))).toEqual([]);
    });

    it("mutual exclusion: six real processes change one ledger 20 times each; no entry is lost and no two are inside at once", async () => {
      mkdirSync(dir, { recursive: true });
      const trace = join(dir, "..", "trace.txt");
      writeFileSync(trace, "");
      const go = join(dir, "..", "go");
      const template = entry("template", { state: "unknown" });
      const workers = Array.from({ length: 6 }, (_, w) =>
        runChild({ op: "cycles", dir, key: KEY, count: 20, prefix: `w${w}x`, trace, go, template }),
      );
      writeFileSync(go, "");
      for (const worker of workers) await worker.next((line) => line["done"] === true);

      const all = entries();
      expect(all).toHaveLength(120);
      expect(new Set(all.map((e) => e.inputId)).size).toBe(120);
      const steps = readFileSync(trace, "utf-8").trim().split("\n");
      expect(steps).toHaveLength(240);
      for (let i = 0; i < steps.length; i += 2) {
        const [enter, pidIn, seqIn] = steps[i]!.split(" ");
        const [exit, pidOut, seqOut] = steps[i + 1]!.split(" ");
        expect([enter, exit, pidIn, seqIn]).toEqual(["enter", "exit", pidOut, seqOut]);
      }
    });

    it("a live holder makes the caller wait, then fail definite; the error names the lock, and nothing changes", async () => {
      writeLedger([entry("before", { state: "unknown" })]);
      const before = readFileSync(ledgerFile(), "utf-8");
      const holder = runChild({ op: "change", dir, key: KEY, pause: "in-change" });
      await holder.next((line) => line["paused"] === "in-change");

      const started = Date.now();
      const err = (await begin("waits").catch((e: unknown) => e)) as Error;
      const waited = Date.now() - started;

      expect(err).toBeInstanceOf(DeliveryLedgerBusyError);
      expect(err.message).toContain(
        `is locked by another process for more than ${DELIVERY_LOCK_WAIT_MS} ms`,
      );
      expect(err.message).toMatch(
        /the abstract socket @ao-delivery-\d+-ledger-[0-9a-f]{32}; `ss -xlp`/,
      );
      expect(waited).toBeGreaterThanOrEqual(DELIVERY_LOCK_WAIT_MS);
      // The holder ran for the whole wait.
      expect(isAlive(holder)).toBe(true);
      expect(readFileSync(ledgerFile(), "utf-8")).toBe(before);
    });

    it("waits for a live holder that ends inside the bound, and both changes stay", async () => {
      mkdirSync(dir, { recursive: true });
      const trace = join(dir, "..", "trace.txt");
      const until = join(dir, "..", "until");
      const add = entry("added by the holder", { state: "unknown" });
      const holder = runChild({ op: "change", dir, key: KEY, until, trace, add });
      await holder.next((line) => line["paused"] === "until");

      const mine = begin("added while the lock was held");
      writeFileSync(until, "");
      const attempt = await mine;

      expect(entries().map((e) => e.inputId)).toEqual([add.inputId, attempt.inputId]);
      expect(readFileSync(trace, "utf-8")).toMatch(/^enter \d+\nexit \d+\n$/);
    });
  });

  describe("a corrupt ledger fails closed", () => {
    const cases: Array<[string, string]> = [
      ["not JSON", "[broken-json"],
      ["another version", JSON.stringify({ version: 1, key: KEY, entries: [] })],
      ["another key", JSON.stringify({ version: 2, key: "ses_other", entries: [] })],
      [
        "an invalid entry",
        JSON.stringify({ version: 2, key: KEY, entries: [{ ...entry("x"), textSha256: "abc" }] }),
      ],
      [
        "an input ID twice",
        (() => {
          const one = entry("twice");
          return JSON.stringify({ version: 2, key: KEY, entries: [one, { ...one }] });
        })(),
      ],
    ];
    for (const [name, content] of cases) {
      it(`${name}: a definite refusal that names the file; the file does not change`, async () => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(ledgerFile(), content);

        const err = (await begin("CORRUPT RETRY").catch((e: unknown) => e)) as Error;

        expect(err).toBeInstanceOf(DeliveryLedgerCorruptError);
        expect(err.message).toContain(ledgerFile());
        expect(err.message).toContain("remove the file to clear it");
        expect(readFileSync(ledgerFile(), "utf-8")).toBe(content);
        expect(readdirSync(dir).sort()).toEqual([`${KEY}.json`]);
      });
    }

    it("removeDeliveryLedger removes a corrupt file too, and a missing one is no error", async () => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(ledgerFile(), "[broken-json");
      await removeDeliveryLedger(dir, KEY);
      expect(readdirSync(dir)).toEqual([]);
      await expect(removeDeliveryLedger(dir, KEY)).resolves.toBeUndefined();
    });
  });

  it("m-2: the sweep removes a ledger with no live entry and an old temp file; it keeps a live, a locked and a corrupt ledger", async () => {
    const old = new Date(Date.now() - 11 * MINUTE).toISOString();
    writeLedger(
      [entry("old", { state: "unknown", updatedAt: old }), entry("done", { state: "admitted" })],
      "ses_expired",
    );
    writeLedger([entry("fresh", { state: "unknown" })], "ses_live");
    writeLedger([entry("old", { state: "unknown", updatedAt: old })], "ses_locked");
    writeFileSync(deliveryLedgerPath(dir, "ses_corrupt"), "[broken-json");
    const oldTemp = join(dir, "ses_live.json.tmp.123.456");
    const newTemp = join(dir, "ses_live.json.tmp.123.789");
    writeFileSync(oldTemp, "{");
    writeFileSync(newTemp, "{");
    const past = new Date(Date.now() - 11 * MINUTE);
    utimesSync(oldTemp, past, past);
    const lock = await tryHoldDeliveryLock(deliveryLedgerLockName(dir, "ses_locked"));
    holds.push(lock!);

    const sweep = await removeExpiredDeliveryLedgers(dir);

    expect(sweep.failed).toEqual([]);
    expect(sweep.removed.sort()).toEqual([deliveryLedgerPath(dir, "ses_expired"), oldTemp].sort());
    expect(readdirSync(dir).sort()).toEqual(
      ["ses_corrupt.json", "ses_live.json", "ses_live.json.tmp.123.789", "ses_locked.json"].sort(),
    );
  });

  it("changeDeliveryLedger removes an empty ledger and keeps a key out of a path", async () => {
    writeLedger([entry("gone soon", { state: "unknown" })]);
    await changeDeliveryLedger(dir, KEY, () => ({ entries: [], result: undefined }));
    expect(existsSync(ledgerFile())).toBe(false);
    expect(() => deliveryLedgerPath(dir, "../escape")).toThrow(/key .* is not valid/);
  });
});
