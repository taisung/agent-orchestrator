# Part I, second follow-up (R-H1): as r6_i2_signals.py, with the sid child forking before setsid().
# Part I, follow-up (R-H1): which signals does a pane close send to S's session, and does a child that left the
# session (setsid) survive? Server aohd3-5, started here under strace -ff. Children, started from the pane shell:
#   ign: a Python child in S's session that logs and ignores HUP, TERM, INT, QUIT, USR1
#   sid: a Python child that calls setsid() first (a new session), then logs and ignores the same signals
import os, subprocess, sys, time; sys.path.insert(0, "/tmp/aohd3/scripts")
from r6lib import *
SESSION = "aohd3-5"
S = f"/tmp/aohd3/xdg/config/herdr/sessions/{SESSION}/herdr.sock"
log = Log("i_signals_setsid_log")
T = "/tmp/aohd3/tmp/wsi3"
os.makedirs(T, exist_ok=True)
child = f"""import os, signal, sys, time
tag = sys.argv[1]
if tag == "sid":
    if os.fork() > 0:
        os._exit(0)
    os.setsid()
log = open("{T}/" + tag + ".log", "a", buffering=1)
log.write("start pid=%d sid=%d pgrp=%d\\n" % (os.getpid(), os.getsid(0), os.getpgrp()))
def h(n, f):
    log.write("signal %s\\n" % signal.Signals(n).name)
for s in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT, signal.SIGQUIT, signal.SIGUSR1):
    signal.signal(s, h)
time.sleep(900)
"""
with open(f"{T}/child.py", "w") as f:
    f.write(child)
out = open("/tmp/aohd3/logs/server-i3.out", "w")
srv = subprocess.Popen(["/tmp/aohd3/bin/strace", "-ff", "-qq", "-e", "trace=network,execve,kill", "-tt", "-o", "/tmp/aohd3/logs/strace/serveri3",
                        "/tmp/aohd3/bin/herdr-real", "--session", SESSION, "server"],
                       stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
for _ in range(100):
    time.sleep(0.1)
    r = call(S, "ping", {})
    if r.get("json"):
        break
server_pid = r.get("peer_pid")
with open("/tmp/aohd3/logs/pids.txt", "a") as f:
    f.write(f"server aohd3-5: strace {srv.pid}, herdr {server_pid}, started {time.strftime('%T')}\n")
log.add("server", {"strace_pid": srv.pid, "herdr_pid": server_pid})

def stat6(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            rest = f.read().rsplit(")", 1)[1].split()
        return {"state": rest[0], "ppid": rest[1], "pgrp": rest[2], "session": rest[3], "ticks": rest[19]}
    except OSError as e:
        return {"error": f"{type(e).__name__} errno={e.errno}"}

def readlog(tag):
    try:
        return open(f"{T}/{tag}.log").read().strip().splitlines()
    except OSError:
        return []

w = call(S, "workspace.create", {"cwd": T, "label": "aohd3-i2", "focus": False})
pane = w["json"]["result"]["root_pane"]["pane_id"]
shell = call(S, "pane.process_info", {"pane_id": pane})["json"]["result"]["process_info"]["shell_pid"]
call(S, "pane.send_input", {"pane_id": pane, "text": f"python3 {T}/child.py ign & python3 {T}/child.py sid &", "keys": ["Enter"]})
time.sleep(1.5)
pids = {}
for tag in ("ign", "sid"):
    first = readlog(tag)[:1]
    if first:
        pids[tag] = int(first[0].split()[1].split("=")[1])
log.add("i3_before_close", {"pane": pane, "shell": shell, "shell_stat": stat6(shell), "children": {t: {"pid": p, "stat": stat6(p)} for t, p in pids.items()},
                            "logs": {t: readlog(t) for t in ("ign", "sid")}})
c = call(S, "pane.close", {"pane_id": pane})
log.add("i3_pane_close", (c.get("answer") or "").strip())
time.sleep(2.0)
log.add("i3_after_close", {"shell_stat": stat6(shell), "children": {t: stat6(p) for t, p in pids.items()},
                           "logs": {t: readlog(t) for t in ("ign", "sid")}})
survivors = [p for p in pids.values() if "error" not in stat6(p) and stat6(p).get("state") not in ("Z", "X")]
log.add("i3_survivors", survivors)
with open("/tmp/aohd3/logs/pids.txt", "a") as f:
    f.write(f"survivors of the pane close (to stop by exact PID): {survivors}\n")
code, o, e = cap("i3_cleanup_server_stop", ["herdr", "--session", SESSION, "server", "stop"])
for _ in range(100):
    if "error" in stat6(server_pid):
        break
    time.sleep(0.05)
log.add("i3_server_stop", {"exit": code, "server_now": stat6(server_pid)})
log.save()
print("SURVIVORS", " ".join(str(p) for p in survivors))
