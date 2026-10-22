# Part E: the executable of the peer. Server aohd2-2 runs from a byte copy; then the copy is removed.
import json, os, sys; sys.path.insert(0, "/tmp/aohd2/scripts")
from r5lib import cap, note, sock_call
S2 = "/tmp/aohd2/xdg/config/herdr/sessions/aohd2-2/herdr.sock"
PING = b'{"id":"aohd2","method":"ping","params":{}}\n'
log = []
def step(label, r):
    log.append(f"{label}: {json.dumps(r)}"); print(log[-1][:400])
step("e_ping_copy_present", sock_call(S2, PING))
c, o, e = cap("e_status_json_copy_present", ["herdr", "--session", "aohd2-2", "status", "server", "--json"]); log.append("e_status_json_copy_present: " + o.strip())
os.unlink("/tmp/aohd2/bin2/herdr")
step("e_ping_copy_removed", sock_call(S2, PING))
c, o, e = cap("e_status_json_copy_removed", ["herdr", "--session", "aohd2-2", "status", "server", "--json"]); log.append("e_status_json_copy_removed: " + o.strip())
c, o, e = cap("e_cli_pane_get_copy_removed", ["herdr", "--session", "aohd2-2", "pane", "get", "w1:p1"]); log.append(f"e_cli_pane_get_copy_removed: exit={c} out={o.strip()} err={e.strip()}")
c, o, e = cap("e_server_stop", ["herdr", "--session", "aohd2-2", "server", "stop"], timeout=40); log.append(f"e_server_stop: exit={c} out={o.strip()} err={e.strip()}")
step("e_ping_after_stop", sock_call(S2, PING))
log.append("socket files after stop: " + str(sorted(os.listdir(os.path.dirname(S2)))))
note("e_exe_log", "\n".join(log))
print("\n".join(log[-6:]))
