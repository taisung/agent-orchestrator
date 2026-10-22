# Part I (R-H1): after the pane closes and S ends, does a process of S's session that ignores SIGHUP survive,
# and does it keep S's PID as its session ID (field 6 of /proc/<pid>/stat)? Server aohd3-3, started here
# under strace -ff. Also a plain background child that does not ignore SIGHUP, as a control.
import os, subprocess, sys, time; sys.path.insert(0, "/tmp/aohd3/scripts")
from r6lib import *
SESSION = "aohd3-3"
S = f"/tmp/aohd3/xdg/config/herdr/sessions/{SESSION}/herdr.sock"
log = Log("i_session_log")
out = open("/tmp/aohd3/logs/server-i.out", "w")
srv = subprocess.Popen(["/tmp/aohd3/bin/strace", "-ff", "-qq", "-e", "trace=network,execve", "-o", "/tmp/aohd3/logs/strace/serveri",
                        "/tmp/aohd3/bin/herdr-real", "--session", SESSION, "server"],
                       stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
for _ in range(100):
    time.sleep(0.1)
    r = call(S, "ping", {})
    if r.get("json"):
        break
server_pid = r.get("peer_pid")
with open("/tmp/aohd3/logs/pids.txt", "a") as f:
    f.write(f"server aohd3-3: strace {srv.pid}, herdr {server_pid}, started {time.strftime('%T')}\n")
log.add("server", {"strace_pid": srv.pid, "herdr_pid": server_pid})

def stat6(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            rest = f.read().rsplit(")", 1)[1].split()
        return {"state": rest[0], "ppid": rest[1], "pgrp": rest[2], "session": rest[3], "ticks": rest[19]}
    except OSError as e:
        return {"error": f"{type(e).__name__} errno={e.errno}"}

def session_members(sid):
    found = []
    for d in os.listdir("/proc"):
        if d.isdigit():
            st = stat6(d)
            if st.get("session") == str(sid):
                found.append((int(d), st.get("state"), st.get("pgrp")))
    return sorted(found)

os.makedirs("/tmp/aohd3/tmp/wsi", exist_ok=True)
w = call(S, "workspace.create", {"cwd": "/tmp/aohd3/tmp/wsi", "label": "aohd3-i", "focus": False})
pane = w["json"]["result"]["root_pane"]["pane_id"]
shell = call(S, "pane.process_info", {"pane_id": pane})["json"]["result"]["process_info"]["shell_pid"]
# One child that ignores SIGHUP, one that does not; both started from the pane shell, in its session.
call(S, "pane.send_input", {"pane_id": pane, "text": "sh -c 'trap \"\" HUP; exec sleep 600' & sleep 700 &", "keys": ["Enter"]})
time.sleep(1.0)
members = session_members(shell)
log.add("i_before_close", {"pane": pane, "shell": shell, "shell_stat": stat6(shell), "session_members": members})
c = call(S, "pane.close", {"pane_id": pane})
log.add("i_pane_close", (c.get("answer") or "").strip())
time.sleep(1.5)
after = {pid: stat6(pid) for pid, _, _ in members}
log.add("i_after_close", {"shell_stat": stat6(shell), "members_now": after, "session_scan_now": session_members(shell)})
survivors = [pid for pid, st in after.items() if "error" not in st and st.get("state") not in ("Z", "X")]
log.add("i_survivors", survivors)
log.save()
for pid in survivors:
    with open("/tmp/aohd3/logs/pids.txt", "a") as f:
        f.write(f"survivor of the pane close: {pid} (to stop by exact PID)\n")
print("SURVIVORS", " ".join(str(p) for p in survivors))
code, o, e = cap("i_cleanup_server_stop", ["herdr", "--session", SESSION, "server", "stop"])
for _ in range(100):
    if "error" in stat6(server_pid):
        break
    time.sleep(0.05)
log.add("i_server_stop", {"exit": code, "server_now": stat6(server_pid)})
log.save()
