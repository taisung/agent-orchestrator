# Part C (B-1): the r5 interleaving on real restarts of session aohd3-1. A Node client reads LC0 and the
# pre-connect LC on server A; the driver replaces A with B (server stop, server start: B restores the same
# pane IDs); then the client connects. guarded: LC again after connect, before the write. unguarded: the r5
# order (write at once). held: connected to A before the replacement, written after it.
import json, os, subprocess, sys, time; sys.path.insert(0, "/tmp/aohd3/scripts")
from r6lib import *
SESSION = "aohd3-1"
S = f"/tmp/aohd3/xdg/config/herdr/sessions/{SESSION}/herdr.sock"
T = "/tmp/aohd3/tmp"
log = Log("c_race_log")
servers = []

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
    pid = r.get("peer_pid")
    servers.append((n, p.pid, pid))
    with open("/tmp/aohd3/logs/pids.txt", "a") as f:
        f.write(f"race server {n}: strace {p.pid}, herdr {pid}, started {time.strftime('%T')}\n")
    log.add(f"server_{n}_started", {"strace_pid": p.pid, "herdr_pid": pid, "ticks": proc_stat(pid), "lc": lc(S)})
    return pid

def stop_server(label, pid):
    code, out, err = cap(f"c_{label}_server_stop", ["herdr", "--session", SESSION, "server", "stop"])
    for _ in range(100):
        if "error" in proc_stat(pid):
            break
        time.sleep(0.05)
    log.add(f"{label}_server_stop", {"exit": code, "old_pid": pid, "old_pid_now": proc_stat(pid)})

def node(mode, lc0, req, signal):
    with open(f"{T}/lc0.json", "w") as f:
        json.dump(lc0, f)
    with open(f"{T}/req.json", "w") as f:
        f.write(req.decode())
    return subprocess.Popen(["node", "/tmp/aohd3/scripts/r6_guard.mjs", mode, S, f"{T}/lc0.json", f"{T}/req.json", signal],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

def pane_state(label, pane):
    g = call(S, "pane.get", {"pane_id": pane})
    pi = call(S, "pane.process_info", {"pane_id": pane})
    shell = (((pi.get("json") or {}).get("result") or {}).get("process_info") or {}).get("shell_pid")
    st = {"pane_get": (g.get("answer") or "")[:240], "shell_pid": shell, "shell": proc_stat(shell) if shell else None,
          "workspace_list": [w["workspace_id"] for w in (((call(S, "workspace.list", {}).get("json") or {}).get("result") or {}).get("workspaces") or [])]}
    log.add(label, st)
    return shell

def case(name, mode, pane, restart_n):
    pid_a = call(S, "ping", {})["peer_pid"]
    s_a = pane_state(f"{name}_before_on_A", pane)
    lc0 = lc(S)
    log.add(f"{name}_lc0", lc0)
    sig = f"{T}/sig-{name}"
    p = node(mode, {"file": [str(x) for x in lc0["file"]], "isSocket": lc0["is_socket"], "own": lc0["own"], "listen": lc0["listen"]},
             request("pane.close", {"pane_id": pane}, rid=f"aohd3-{name}"), sig)
    time.sleep(1.0)   # the client did its pre-connect check (and, for held, its connect and post-connect check)
    stop_server(f"{name}_A", pid_a)
    pid_b = start_server(restart_n)
    s_b = pane_state(f"{name}_on_B_before_client", pane)
    open(sig, "w").close()
    out, _ = p.communicate(timeout=30)
    log.add(f"{name}_client", out.strip())
    s_after = pane_state(f"{name}_on_B_after_client", pane)
    log.add(f"{name}_summary", {"A_pid": pid_a, "B_pid": pid_b, "S_A": s_a, "S_A_now": proc_stat(s_a) if s_a else None,
                                 "S_B": s_b, "S_B_now": proc_stat(s_b) if s_b else None, "pane_after": pane, "shell_after": s_after})

# The pane w1:p1 of part A runs on the first server (started outside this script).
case("c1_guarded", "guarded", "w1:p1", 2)
case("c2_unguarded", "unguarded", "w1:p1", 3)
w = call(S, "workspace.create", {"cwd": "/tmp/aohd3/tmp/wsa", "label": "aohd3-c3", "focus": False})
log.add("c3_workspace_create", (w.get("answer") or "")[:200])
p3 = w["json"]["result"]["root_pane"]["pane_id"]
case("c3_held", "held", p3, 4)
log.add("servers", servers)
log.save()
