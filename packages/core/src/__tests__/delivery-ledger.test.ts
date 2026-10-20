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
  deliveryLedgerPath,
  isDeliveryOwnerAlive,
  readDeliveryLedger,
  readProcessStartTime,
  removeDeliveryLedger,
  settleDelivery,
  type DeliveryEntry,
} from "../delivery-ledger.js";

const KEY = "ses_ledgerTest01";
const MINUTE = 60_000;

let dir: string;
let minted = 0;
const mint = () => `msg_test${++minted}`;
const sha = (text: string) => createHash("sha256").update(text, "utf-8").digest("hex");
const ledgerFile = () => deliveryLedgerPath(dir, KEY);
const entries = () => readDeliveryLedger(dir, KEY);
const begin = (text: string) => beginDelivery({ dir, key: KEY, textSha256: sha(text), mint });

function writeLedger(list: DeliveryEntry[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(ledgerFile(), JSON.stringify({ version: 1, key: KEY, entries: list }));
}

function entry(text: string, overrides: Partial<DeliveryEntry> = {}): DeliveryEntry {
  const at = new Date().toISOString();
  return {
    inputId: `msg_crafted${++minted}`,
    textSha256: sha(text),
    createdAt: at,
    updatedAt: at,
    state: "sending",
    owner: { pid: process.pid, startTime: readProcessStartTime(process.pid), token: randomUUID() },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Real child processes: the test compiles delivery-ledger.ts (and the one
// core file that it imports) with the TypeScript compiler, so each child
// runs the same code as core, on every Node version that core supports.
// ---------------------------------------------------------------------------

let childDir: string;
const children: ChildProcess[] = [];

const CHILD = `
import { appendFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { beginDelivery, changeDeliveryLedger, settleDelivery } from "./delivery-ledger.js";
const cmd = JSON.parse(process.argv[2]);
const sha = (t) => createHash("sha256").update(t, "utf-8").digest("hex");
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let n = 0;
const mint = () => "msg_c" + process.pid + "x" + ++n;
while (cmd.go && !existsSync(cmd.go)) await new Promise((r) => setTimeout(r, 2));
const base = { dir: cmd.dir, key: cmd.key };
if (cmd.op === "begin-and-hang") {
  const a = await beginDelivery({ ...base, textSha256: sha(cmd.text), mint });
  // The service admits the input; then the answer never comes.
  appendFileSync(cmd.service, a.inputId + "\\n");
  say({ began: a.inputId });
  setInterval(() => {}, 1 << 30);
} else if (cmd.op === "begin") {
  const a = await beginDelivery({ ...base, textSha256: sha(cmd.text), mint });
  say({ inputId: a.inputId, reused: a.reused });
} else if (cmd.op === "hold-lock") {
  await changeDeliveryLedger(cmd.dir, cmd.key, (entries) => {
    appendFileSync(cmd.trace, "enter " + process.pid + "\\n");
    say({ holding: true });
    sleep(cmd.holdMs);
    appendFileSync(cmd.trace, "exit " + process.pid + "\\n");
    return { entries: cmd.add ? [...entries, cmd.add] : entries, result: undefined };
  });
  say({ done: true });
} else if (cmd.op === "cycles") {
  for (let i = 0; i < cmd.count; i++) {
    const a = await beginDelivery({ ...base, textSha256: sha(cmd.prefix + "-" + i), mint });
    await settleDelivery({ ...base, attempt: a, outcome: "unknown" });
  }
  say({ done: true });
} else if (cmd.op === "sleep") {
  say({ ready: true });
  setInterval(() => {}, 1 << 30);
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

/** A process that ran and ended: its PID and start time name a dead owner. */
async function deadOwner(): Promise<{ pid: number; startTime: string | null }> {
  const sleeper = runChild({ op: "sleep" });
  await sleeper.next((line) => line["ready"] === true);
  const owner = { pid: sleeper.child.pid!, startTime: readProcessStartTime(sleeper.child.pid!) };
  sleeper.child.kill("SIGKILL");
  await sleeper.exited;
  return owner;
}

beforeAll(() => {
  childDir = mkdtempSync(join(tmpdir(), "ao-ledger-child-"));
  for (const name of ["delivery-ledger", "atomic-write"]) {
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
  dir = join(mkdtempSync(join(tmpdir(), "ao-ledger-")), "deliveries");
});

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  chmodSync(join(dir, ".."), 0o755);
  if (existsSync(dir)) chmodSync(dir, 0o755);
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("delivery ledger: one input ID per logical send (I-5 round 3)", () => {
  it("persists a sending entry with this process as its owner, and a clear removes the file", async () => {
    const attempt = await begin("hello");

    expect(attempt.reused).toBe(false);
    expect(entries()).toEqual([
      {
        inputId: attempt.inputId,
        textSha256: sha("hello"),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        state: "sending",
        owner: {
          pid: process.pid,
          startTime: readProcessStartTime(process.pid),
          token: attempt.token,
        },
      },
    ]);
    expect(readProcessStartTime(process.pid)).toMatch(/^\d+$/);

    await expect(settleDelivery({ dir, key: KEY, attempt, outcome: "clear" })).resolves.toBe(true);
    expect(existsSync(ledgerFile())).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
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
    expect(retry).toEqual({ inputId: first.inputId, token: expect.any(String), reused: true });
    expect(entries().find((e) => e.inputId === first.inputId)).toEqual(
      expect.objectContaining({
        state: "sending",
        owner: expect.objectContaining({ token: retry.token }),
      }),
    );
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

  describe("owner liveness of a sending entry (B-2)", () => {
    it("reuses the entry of a process that ended", async () => {
      const dead = entry("from a dead process", {
        owner: { ...(await deadOwner()), token: randomUUID() },
      });
      writeLedger([dead]);

      const retry = await begin("from a dead process");

      expect(retry).toEqual(expect.objectContaining({ inputId: dead.inputId, reused: true }));
    });

    it("never reuses the entry of a live process, and counts PID reuse as dead", async () => {
      const sleeper = runChild({ op: "sleep" });
      await sleeper.next((line) => line["ready"] === true);
      const pid = sleeper.child.pid!;
      const live = entry("live owner", {
        owner: { pid, startTime: readProcessStartTime(pid), token: randomUUID() },
      });
      // The same PIDs with another start time: earlier processes that had them.
      const reusedChildPid = entry("reused child pid", {
        owner: { pid, startTime: "1", token: randomUUID() },
      });
      const reusedOwnPid = entry("reused own pid", {
        owner: { pid: process.pid, startTime: "1", token: randomUUID() },
      });
      writeLedger([live, reusedChildPid, reusedOwnPid]);

      expect((await begin("live owner")).inputId).not.toBe(live.inputId);
      expect((await begin("reused child pid")).inputId).toBe(reusedChildPid.inputId);
      expect((await begin("reused own pid")).inputId).toBe(reusedOwnPid.inputId);
      expect(isDeliveryOwnerAlive(live.owner)).toBe(true);
      expect(isDeliveryOwnerAlive({ pid, startTime: null })).toBe(true);
    });

    it("B-2: a child that began a send and was stopped with SIGKILL: the retry takes its ID, so the service admits once", async () => {
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
      sender.child.kill("SIGKILL");
      await sender.exited;

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

    it("item 4: a failed clear after a success: this process gives the same text a new ID", async () => {
      const done = await begin("ADMITTED ONCE");
      chmodSync(dir, 0o555);
      const started = Date.now();
      const cleared = await settleDelivery({ dir, key: KEY, attempt: done, outcome: "clear" });
      const elapsed = Date.now() - started;
      chmodSync(dir, 0o755);

      expect(cleared).toBe(false);
      // The clear was tried again after 200 ms and 1 s.
      expect(elapsed).toBeGreaterThanOrEqual(1_150);
      const next = await begin("ADMITTED ONCE");
      expect(next.inputId).not.toBe(done.inputId);
      // A live other process does not take it either (its owner, this process, runs).
      const other = runChild({ op: "begin", dir, key: KEY, text: "ADMITTED ONCE" });
      const answer = await other.next((line) => typeof line["inputId"] === "string");
      expect(answer["inputId"]).not.toBe(done.inputId);
    });
  });

  describe("a corrupt ledger fails closed", () => {
    const cases: Array<[string, string]> = [
      ["not JSON", "[broken-json"],
      ["another version", JSON.stringify({ version: 2, key: KEY, entries: [] })],
      ["another key", JSON.stringify({ version: 1, key: "ses_other", entries: [] })],
      [
        "an invalid entry",
        JSON.stringify({ version: 1, key: KEY, entries: [{ ...entry("x"), textSha256: "abc" }] }),
      ],
      [
        "an input ID twice",
        (() => {
          const one = entry("twice");
          return JSON.stringify({ version: 1, key: KEY, entries: [one, { ...one }] });
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

    it("removeDeliveryLedger removes a corrupt file too", async () => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(ledgerFile(), "[broken-json");
      await removeDeliveryLedger(dir, KEY);
      expect(readdirSync(dir)).toEqual([]);
    });
  });

  describe("the lock", () => {
    const lockFile = () => `${ledgerFile()}.lock`;
    const writeLock = (owner: { pid: number; startTime: string | null }, token = randomUUID()) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(lockFile(), JSON.stringify({ ...owner, token, at: new Date().toISOString() }));
    };

    it("a lock of a live owner makes the caller wait, then fail definite; nothing changes", async () => {
      const trace = join(dir, "..", "trace.txt");
      const holder = runChild({ op: "hold-lock", dir, key: KEY, holdMs: 4_000, trace });
      await holder.next((line) => line["holding"] === true);

      const started = Date.now();
      const err = (await begin("waits").catch((e: unknown) => e)) as Error;
      const waited = Date.now() - started;

      expect(err).toBeInstanceOf(DeliveryLedgerBusyError);
      expect(err.message).toContain(`by the live process ${holder.child.pid}`);
      expect(waited).toBeGreaterThanOrEqual(DELIVERY_LOCK_WAIT_MS);
      expect(waited).toBeLessThan(3_500);
      expect(existsSync(ledgerFile())).toBe(false);
    });

    it("waits for a live holder that ends inside the bound, and both changes stay (M-2 interleave)", async () => {
      const trace = join(dir, "..", "trace.txt");
      const add = entry("added by the holder", { state: "unknown" });
      const holder = runChild({ op: "hold-lock", dir, key: KEY, holdMs: 300, trace, add });
      await holder.next((line) => line["holding"] === true);

      const mine = await begin("added while the lock was held");

      expect(entries().map((e) => e.inputId)).toEqual([add.inputId, mine.inputId]);
      expect(readFileSync(trace, "utf-8")).toMatch(/^enter \d+\nexit \d+\n$/);
    });

    it("breaks the lock of a dead owner, and the lock of this process that nobody holds", async () => {
      writeLock(await deadOwner());
      const a = await begin("after a dead lock");
      writeLock({ pid: process.pid, startTime: readProcessStartTime(process.pid) });
      const b = await begin("after a left lock");

      expect(entries().map((e) => e.inputId)).toEqual([a.inputId, b.inputId]);
      expect(readdirSync(dir)).toEqual([`${KEY}.json`]);
    });

    it("only one of many waiters that break one stale lock holds it at a time", async () => {
      writeLock(await deadOwner());
      const trace = join(dir, "..", "trace.txt");
      writeFileSync(trace, "");
      const go = join(dir, "..", "go");
      const waiters = Array.from({ length: 6 }, () =>
        runChild({ op: "hold-lock", dir, key: KEY, holdMs: 40, trace, go }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      writeFileSync(go, "");
      for (const waiter of waiters) await waiter.next((line) => line["done"] === true);

      const steps = readFileSync(trace, "utf-8").trim().split("\n");
      expect(steps).toHaveLength(12);
      for (let i = 0; i < steps.length; i += 2) {
        const [enter, pidIn] = steps[i]!.split(" ");
        const [exit, pidOut] = steps[i + 1]!.split(" ");
        expect([enter, exit, pidIn]).toEqual(["enter", "exit", pidOut]);
      }
      expect(existsSync(lockFile())).toBe(false);
    });
  });

  it("M-2: two real processes that change one ledger at the same time lose no entry", async () => {
    const go = join(dir, "..", "go");
    const a = runChild({ op: "cycles", dir, key: KEY, count: 15, prefix: "A", go });
    const b = runChild({ op: "cycles", dir, key: KEY, count: 15, prefix: "B", go });
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeFileSync(go, "");
    await a.next((line) => line["done"] === true);
    await b.next((line) => line["done"] === true);

    const all = entries();
    expect(all).toHaveLength(30);
    expect(new Set(all.map((e) => e.inputId)).size).toBe(30);
    expect(all.every((e) => e.state === "unknown")).toBe(true);
    const hashes = new Set(all.map((e) => e.textSha256));
    for (const prefix of ["A", "B"]) {
      for (let i = 0; i < 15; i++) expect(hashes.has(sha(`${prefix}-${i}`))).toBe(true);
    }
  });

  it("changeDeliveryLedger removes an empty ledger and keeps a key out of a path", async () => {
    writeLedger([entry("gone soon", { state: "unknown" })]);
    await changeDeliveryLedger(dir, KEY, () => ({ entries: [], result: undefined }));
    expect(existsSync(ledgerFile())).toBe(false);
    expect(() => deliveryLedgerPath(dir, "../escape")).toThrow(/key .* is not valid/);
  });
});
