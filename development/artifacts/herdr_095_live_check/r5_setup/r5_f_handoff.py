# Part F: server.live_handoff on the scratch server aohd2-3. Which process serves after it, and do the
# pane IDs, terminal IDs and pane processes stay? import_exe is a byte copy of the 0.9.5 binary.
import json, os, sys, time; sys.path.insert(0, "/tmp/aohd2/scripts")
from r5lib import cap, note, sock_call
S = "/tmp/aohd2/xdg/config/herdr/sessions/aohd2-3/herdr.sock"
log = []
def call(name, method, params, timeout=5.0):
    r = sock_call(S, (json.dumps({"id": "aohd2", "method": method, "params": params}) + "\n").encode(), timeout=timeout)
    log.append(f"{name}: {json.dumps(r, ensure_ascii=False)}"); print(log[-1][:420])
    try: return json.loads(r.get("answer", "").strip().splitlines()[0])
    except Exception: return None
def alive(pid):
    try:
        with open(f"/proc/{pid}/stat") as f: return f.read().rsplit(")", 1)[1].split()[19]
    except OSError as e: return f"gone ({type(e).__name__})"
os.makedirs("/tmp/aohd2/tmp/ws3", exist_ok=True)
call("f_ping_before", "ping", {})
a = call("f_workspace_create", "workspace.create", {"cwd": "/tmp/aohd2/tmp/ws3", "label": "aohd2-f", "focus": False})
root = a["result"]["root_pane"]["pane_id"]; term = a["result"]["root_pane"]["terminal_id"]
b = call("f_pane_process_info_before", "pane.process_info", {"pane_id": root})
shell = b["result"]["process_info"]["shell_pid"]
r0 = sock_call(S, b'{"id":"aohd2","method":"ping","params":{}}\n')
old_pid, old_ticks = r0["peer_pid"], r0["peer_start_ticks"]
log.append(f"before: server pid {old_pid} ticks {old_ticks}; pane {root} terminal {term}; shell pid {shell} ticks {alive(shell)}")
call("f_live_handoff", "server.live_handoff", {"import_exe": "/tmp/aohd2/bin3/herdr", "expected_version": "0.9.5", "expected_protocol": 22}, timeout=40)
time.sleep(2)
r1 = sock_call(S, b'{"id":"aohd2","method":"ping","params":{}}\n')
log.append(f"f_ping_after: {json.dumps(r1)}")
c = call("f_pane_get_after", "pane.get", {"pane_id": root})
d = call("f_pane_process_info_after", "pane.process_info", {"pane_id": root})
log.append(f"after: server pid {r1.get('peer_pid')} ticks {r1.get('peer_start_ticks')} exe {r1.get('peer_exe')}; old server {old_pid}: {alive(old_pid)}; "
           f"terminal after {((c or {}).get('result') or {}).get('pane', {}).get('terminal_id')} (before {term}); "
           f"shell pid {shell}: {alive(shell)}")
note("f_handoff_log", "\n".join(log))
print("\n".join(log[-2:]))
