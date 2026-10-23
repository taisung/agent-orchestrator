# Part C follow-up: what a connection made to server A sees after A stops (raw socket, no Node).
# Cases: (1) connected, A stops, then read; (2) connected, A stops, then write and read.
import json, os, socket, subprocess, sys, time; sys.path.insert(0, "/tmp/aohd3/scripts")
from r6lib import *
SESSION = "aohd3-1"
S = f"/tmp/aohd3/xdg/config/herdr/sessions/{SESSION}/herdr.sock"
log = Log("c_held_followup_log")

def our_entry(s):
    ino = os.readlink(f"/proc/self/fd/{s.fileno()}")
    with open("/proc/net/unix") as f:
        rows = [l.strip() for l in f if l.split()[6:7] == [ino[8:-1]]]
    return {"fd_link": ino, "proc_net_unix": rows}

def start_server(n):
    out = open(f"/tmp/aohd3/logs/server-race-{n}.out", "w")
    p = subprocess.Popen(["/tmp/aohd3/bin/strace", "-ff", "-qq", "-e", "trace=network,execve", "-o",
                          f"/tmp/aohd3/logs/strace/race{n}", "/tmp/aohd3/bin/herdr-real", "--session", SESSION, "server"],
                         stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    for _ in range(100):
        time.sleep(0.1)
        r = call(S, "ping", {})
        if r.get("json"):
            break
    with open("/tmp/aohd3/logs/pids.txt", "a") as f:
        f.write(f"race server {n}: strace {p.pid}, herdr {r.get('peer_pid')}, started {time.strftime('%T')}\n")
    log.add(f"server_{n}_started", {"strace_pid": p.pid, "herdr_pid": r.get("peer_pid"), "lc": lc(S)})
    return r.get("peer_pid")

for case in ("read_after_stop", "write_after_stop"):
    pid_a = call(S, "ping", {})["peer_pid"]
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(S)
    time.sleep(0.3)
    log.add(f"{case}_connected", {"server": pid_a, "peer_cred": peer_of(s), **our_entry(s)})
    code, out, err = cap(f"c_{case}_server_stop", ["herdr", "--session", SESSION, "server", "stop"])
    for _ in range(100):
        if "error" in proc_stat(pid_a):
            break
        time.sleep(0.05)
    log.add(f"{case}_after_stop", {"stop_exit": code, "server_now": proc_stat(pid_a), **our_entry(s)})
    s.settimeout(3)
    res = {}
    if case == "write_after_stop":
        try:
            s.sendall(request("ping", {}))
            res["write"] = "ok"
        except OSError as e:
            res["write"] = f"{type(e).__name__} errno={e.errno}"
    try:
        c = s.recv(65536)
        res["read"] = "EOF" if not c else c.decode()[:120]
    except socket.timeout:
        res["read"] = "no byte and no EOF within 3 s"
    except OSError as e:
        res["read"] = f"{type(e).__name__} errno={e.errno}"
    log.add(f"{case}_result", res)
    s.close()
    start_server(f"f{case[:4]}")
log.save()
