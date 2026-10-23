// Part G (Node): does Node 25 offer the peer of a unix socket connection? What can it read instead?
import net from "node:net";
import { readlinkSync, readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2];
const out = { node: process.version };
const names = new Set();
for (let p = net.Socket.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p))
  for (const k of Object.getOwnPropertyNames(p)) names.add(k);
out.socketMethodsWithPeerOrCred = [...names].filter((k) => /peer|cred|ucred/i.test(k));
const s = net.createConnection(path);
s.on("connect", () => {
  const h = s._handle;
  out.handleType = h?.constructor?.name;
  out.handleMethodsWithPeerOrCred = h ? Object.getOwnPropertyNames(Object.getPrototypeOf(h)).filter((k) => /peer|cred|ucred|getsockopt/i.test(k)) : [];
  out.fd = h?.fd;
  try { out.ownFdLink = readlinkSync(`/proc/self/fd/${h.fd}`); } catch (e) { out.ownFdLink = String(e); }
  s.write('{"id":"aohd2-node","method":"ping","params":{}}\n');
});
let buf = "";
s.on("data", (d) => { buf += d; if (buf.includes("\n")) s.end(); });
s.on("close", () => {
  out.answer = buf.trim();
  const ino = /socket:\[(\d+)\]/.exec(out.ownFdLink ?? "")?.[1];
  out.ownInodeInProcNetUnix = ino ? readFileSync("/proc/net/unix", "utf8").split("\n").filter((l) => l.split(/\s+/)[6] === ino) : null;
  console.log(JSON.stringify(out, null, 1));
  writeFileSync("/tmp/aohd2/out/r5_g_node_peer_api.txt", JSON.stringify(out, null, 1) + "\n");
});
s.on("error", (e) => { console.log("error", e.code); });
