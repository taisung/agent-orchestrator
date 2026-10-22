// r6 guard client (design r6, ao-65): the listener check LC and the connect-then-check order in Node 25.
// Usage: node r6_guard.mjs <mode> <socket> <lc0.json|-> <request.json|-> [signal-file]
//   lc         print LC(socket)
//   guarded    pre-connect LC == LC0; wait for the signal file; connect; LC == LC0 again; then write
//   unguarded  pre-connect LC == LC0; wait for the signal file; connect; write (the r5 order)
//   held       pre-connect LC == LC0; connect; LC == LC0; wait for the signal file; then write
import fs from "node:fs";
import net from "node:net";

const LISTEN_FLAG = 0x00010000;
const [mode, path, lc0File, reqFile, signal] = process.argv.slice(2);

function lc(p) {
  const r = {};
  try {
    const st = fs.lstatSync(p, { bigint: true });
    r.file = [String(st.dev), String(st.ino)];
    r.isSocket = st.isSocket();
    r.own = Number(st.uid) === process.getuid();
  } catch (e) {
    r.fileError = e.code;
  }
  r.listen = [];
  for (const line of fs.readFileSync("/proc/net/unix", "utf8").split("\n").slice(1)) {
    const m = /^(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) ?(.*)$/.exec(line.trim());
    if (m && m[8] === p && (parseInt(m[4], 16) & LISTEN_FLAG) !== 0) r.listen.push(m[7]);
  }
  return r;
}
function key(r) {
  if (!r.file || !r.isSocket || !r.own || r.listen.length !== 1) return null;
  return `${r.file[0]}:${r.file[1]}/${r.listen[0]}`;
}
async function waitFor(file, ms = 60000) {
  const t0 = Date.now();
  while (!fs.existsSync(file)) {
    if (Date.now() - t0 > ms) throw new Error(`no signal file ${file}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
function connect(p) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ path: p });
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });
}
function exchange(s, payload, deadline = 3000) {
  return new Promise((resolve) => {
    const chunks = [];
    const t = setTimeout(() => {
      s.destroy();
      resolve({ deadline: true, answer: Buffer.concat(chunks).toString("utf8") });
    }, deadline);
    s.on("data", (c) => chunks.push(c));
    s.on("end", () => {
      clearTimeout(t);
      resolve({ eof: true, answer: Buffer.concat(chunks).toString("utf8") });
    });
    s.on("error", (e) => {
      clearTimeout(t);
      resolve({ error: e.code, answer: Buffer.concat(chunks).toString("utf8") });
    });
    s.write(payload);
  });
}

const out = { mode, path };
if (mode === "lc") {
  out.lc = lc(path);
  out.key = key(out.lc);
  console.log(JSON.stringify(out));
  process.exit(0);
}
const lc0 = JSON.parse(fs.readFileSync(lc0File, "utf8"));
const k0 = key(lc0);
const payload = fs.readFileSync(reqFile, "utf8");
out.k0 = k0;
out.preConnect = key(lc(path));
if (out.preConnect !== k0 || k0 === null) {
  out.result = "refused before connect: LC differs from LC0";
  console.log(JSON.stringify(out));
  process.exit(0);
}
if (mode !== "held") {
  out.waitedForSignal = true;
  await waitFor(signal);
}
let s;
try {
  s = await connect(path);
} catch (e) {
  out.result = `connect failed: ${e.code}`;
  console.log(JSON.stringify(out));
  process.exit(0);
}
if (mode === "guarded" || mode === "held") {
  out.postConnect = key(lc(path));
  if (out.postConnect !== k0) {
    s.destroy();
    out.result = "refused after connect: LC differs from LC0; nothing written";
    console.log(JSON.stringify(out));
    process.exit(0);
  }
}
if (mode === "held") {
  out.waitedForSignal = true;
  await waitFor(signal);
  out.beforeWrite = key(lc(path));
}
const ans = await exchange(s, payload);
Object.assign(out, ans);
out.result = "written";
out.after = key(lc(path));
console.log(JSON.stringify(out));
