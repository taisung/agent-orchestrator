# Part D (B-1, R-H3): a live handoff on aohd3-1 with the guard. Does the handoff keep the socket file and the
# LISTEN socket (LC)? What does a connection made before the handoff get when it writes after it? Does the
# guarded Node client pass across the handoff? import_exe is a byte copy of the 0.9.5 binary.
import json, os, socket, subprocess, sys, time; sys.path.insert(0, "/tmp/aohd3/scripts")
from r6lib import *
S = "/tmp/aohd3/xdg/config/herdr/sessions/aohd3-1/herdr.sock"
T = "/tmp/aohd3/tmp"
log = Log("d_handoff_log")
os.makedirs(f"{T}/wsd", exist_ok=True)
w = call(S, "workspace.create", {"cwd": f"{T}/wsd", "label": "aohd3-d", "focus": False})
pane = w["json"]["result"]["root_pane"]["pane_id"]
term = w["json"]["result"]["root_pane"]["terminal_id"]
pi = call(S, "pane.process_info", {"pane_id": pane})
shell = pi["json"]["result"]["process_info"]["shell_pid"]
r0 = call(S, "ping", {})
old = r0["peer_pid"]
lc0 = lc(S)
log.add("d_before", {"server": old, "server_stat": proc_stat(old), "pane": pane, "terminal": term, "shell": shell,
                     "shell_stat": proc_stat(shell), "lc": lc0})
# A connection made before the handoff, written after it.
held = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
held.connect(S)
log.add("d_held_connected", {"peer_cred": peer_of(held)})
# The guarded Node client: pre-connect check now, connect after the handoff.
with open(f"{T}/lc0d.json", "w") as f:
    json.dump({"file": [str(x) for x in lc0["file"]], "isSocket": True, "own": True, "listen": lc0["listen"]}, f)
with open(f"{T}/reqd.json", "w") as f:
    f.write(request("pane.process_info", {"pane_id": pane}, rid="aohd3-d-guarded").decode())
node = subprocess.Popen(["node", "/tmp/aohd3/scripts/r6_guard.mjs", "guarded", S, f"{T}/lc0d.json", f"{T}/reqd.json", f"{T}/sig-d"],
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(1.0)
h = call(S, "server.live_handoff", {"import_exe": "/tmp/aohd3/bin2/herdr", "expected_version": "0.9.5", "expected_protocol": 22},
         deadline=40)
log.add("d_live_handoff", {"answer": h.get("answer"), "eof_ms": h.get("eof_ms"), "error": h.get("error")})
time.sleep(2)
r1 = call(S, "ping", {})
new = r1["peer_pid"]
lc1 = lc(S)
log.add("d_after", {"server": new, "server_stat": proc_stat(new), "old_server_now": proc_stat(old), "lc": lc1,
                    "lc_equal": lc_key(lc0) == lc_key(lc1), "shell_stat": proc_stat(shell),
                    "pane_get": (call(S, "pane.get", {"pane_id": pane}).get("answer") or "")[:200]})
try:
    with open(f"/proc/{new}/status") as f:
        ppid = [l.strip() for l in f if l.startswith("PPid")]
    log.add("d_new_server", {"ppid": ppid, "exe": os.readlink(f"/proc/{new}/exe")})
except OSError as e:
    log.add("d_new_server", str(e))
held.settimeout(3)
try:
    held.sendall(request("ping", {}, rid="aohd3-d-held"))
    c = held.recv(65536)
    log.add("d_held_result", {"read": "EOF" if not c else c.decode()[:160]})
except socket.timeout:
    log.add("d_held_result", "no byte and no EOF within 3 s")
except OSError as e:
    log.add("d_held_result", f"{type(e).__name__} errno={e.errno}")
held.close()
open(f"{T}/sig-d", "w").close()
out, _ = node.communicate(timeout=30)
log.add("d_guarded_client", out.strip())
log.add("d_shell_after_all", proc_stat(shell))
with open("/tmp/aohd3/logs/pids.txt", "a") as f:
    f.write(f"handoff on aohd3-1: old herdr {old}, successor herdr {new} (not under strace), {time.strftime('%T')}\n")
log.save()
