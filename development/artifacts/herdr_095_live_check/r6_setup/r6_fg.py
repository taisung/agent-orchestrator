# Part F (prior M-4 grammar): the pane counter past p0 and p11 (split, then close, 34 times in one workspace).
# Part G (M-1): the observation domain and S on server aohd3-2: the pane shell's environment, its pid and user
# namespaces and NSpid, the /proc mount, an exec in the pane (S keeps PID and ticks?), and a shell that exits
# by itself (what happens to the pane and the workspace?).
import json, os, subprocess, sys, time; sys.path.insert(0, "/tmp/aohd3/scripts")
from r6lib import *
S = "/tmp/aohd3/xdg/config/herdr/sessions/aohd3-2/herdr.sock"
T = "/tmp/aohd3/tmp"
flog, glog = Log("f_pane_counter_log"), Log("g_proc_domain_log")
os.makedirs(f"{T}/wsf", exist_ok=True)
os.makedirs(f"{T}/wsg", exist_ok=True)

w = call(S, "workspace.create", {"cwd": f"{T}/wsf", "label": "aohd3-f", "focus": False})
root = w["json"]["result"]["root_pane"]["pane_id"]
ids = [root]
for i in range(34):
    sp = call(S, "pane.split", {"target_pane_id": root, "direction": "right", "focus": False})
    pid = ((sp.get("json") or {}).get("result") or {}).get("pane", {}).get("pane_id")
    ids.append(pid or f"error: {(sp.get('answer') or '')[:120]}")
    if pid:
        call(S, "pane.close", {"pane_id": pid})
flog.add("f_workspace", w["json"]["result"]["workspace"]["workspace_id"])
flog.add("f_pane_ids_in_order", ids)
flog.save()

def environ(pid):
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            items = f.read().split(b"\0")
        return {k: v for k, _, v in (i.decode("utf-8", "replace").partition("=") for i in items) if k.startswith("HERDR_")}
    except OSError as e:
        return {"error": f"{type(e).__name__} errno={e.errno}"}

def status_lines(pid, keys=("NSpid", "Uid", "PPid")):
    try:
        with open(f"/proc/{pid}/status") as f:
            return [l.strip() for l in f if l.split(":")[0] in keys]
    except OSError as e:
        return f"{type(e).__name__} errno={e.errno}"

def ns(pid, kind):
    try:
        return os.readlink(f"/proc/{pid}/ns/{kind}")
    except OSError as e:
        return f"{type(e).__name__} errno={e.errno}"

def comm(pid):
    try:
        with open(f"/proc/{pid}/comm") as f:
            return f.read().strip()
    except OSError as e:
        return f"{type(e).__name__} errno={e.errno}"

w = call(S, "workspace.create", {"cwd": f"{T}/wsg", "label": "aohd3-g", "focus": False})
p = w["json"]["result"]["root_pane"]["pane_id"]
shell = call(S, "pane.process_info", {"pane_id": p})["json"]["result"]["process_info"]["shell_pid"]
glog.add("g_pane", {"pane": p, "shell": shell})
glog.add("g_shell_environ_herdr_keys", environ(shell))
glog.add("g_shell_status", status_lines(shell))
glog.add("g_shell_ns", {"pid": ns(shell, "pid"), "user": ns(shell, "user")})
glog.add("g_self", {"pid": os.getpid(), "proc_self": os.readlink("/proc/self"), "status": status_lines("self"),
                    "ns_pid": ns("self", "pid"), "ns_user": ns("self", "user"), "uid": os.getuid()})
with open("/proc/self/mountinfo") as f:
    glog.add("g_proc_mountinfo", [l.strip() for l in f if l.split()[4] == "/proc"])
nd = subprocess.run(["node", "-e", "const fs=require('fs');console.log(JSON.stringify({type:fs.statfsSync('/proc').type, "
                     "typeHex:'0x'+fs.statfsSync('/proc').type.toString(16), ns:fs.readlinkSync('/proc/self/ns/pid'), "
                     "self:fs.readlinkSync('/proc/self'), pid:process.pid, uid:process.getuid(), node:process.version}))"],
                    capture_output=True, text=True)
glog.add("g_node_statfs_proc", nd.stdout.strip() or nd.stderr.strip()[:300])
glog.add("g_server_ns", {"server_pid": call(S, "ping", {})["peer_pid"], "pid_ns": ns(call(S, "ping", {})["peer_pid"], "pid")})

before = {"stat": proc_stat(shell), "comm": comm(shell)}
call(S, "pane.send_input", {"pane_id": p, "text": "exec sh", "keys": ["Enter"]})
time.sleep(1.0)
after_pi = call(S, "pane.process_info", {"pane_id": p})
glog.add("g_exec_continuity", {"before": before, "after_stat": proc_stat(shell), "after_comm": comm(shell),
                               "process_info_after": (after_pi.get("answer") or "")[:300],
                               "environ_after": environ(shell)})

w2 = call(S, "workspace.create", {"cwd": f"{T}/wsg", "label": "aohd3-g-exit", "focus": False})
p2 = w2["json"]["result"]["root_pane"]["pane_id"]; ws2 = w2["json"]["result"]["workspace"]["workspace_id"]
s2 = call(S, "pane.process_info", {"pane_id": p2})["json"]["result"]["process_info"]["shell_pid"]
glog.add("g_exit_before", {"pane": p2, "workspace": ws2, "shell": s2, "stat": proc_stat(s2)})
call(S, "pane.send_input", {"pane_id": p2, "text": "exit", "keys": ["Enter"]})
time.sleep(1.5)
glog.add("g_exit_after", {"shell_stat": proc_stat(s2), "pane_get": (call(S, "pane.get", {"pane_id": p2}).get("answer") or "")[:300],
                          "workspace_get": (call(S, "workspace.get", {"workspace_id": ws2}).get("answer") or "")[:200]})
glog.save()
