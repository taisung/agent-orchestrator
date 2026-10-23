# Part D: the 0.9.5 socket API forms on the private server aohd2-1 (one request per connection).
import json, os, shutil, subprocess, sys, time; sys.path.insert(0, "/tmp/aohd2/scripts")
from r5lib import cap, note, sock_call
S = "/tmp/aohd2/xdg/config/herdr/sessions/aohd2-1/herdr.sock"
log = []
def call(name, payload, **kw):
    r = sock_call(S, payload if isinstance(payload, bytes) else payload.encode(), **kw)
    log.append(f"{name}: {json.dumps(r, ensure_ascii=False)}")
    print(log[-1][:500])
    return r
def req(method, params=None, rid="aohd2"):
    o = {"id": rid, "method": method}
    if params is not None: o["params"] = params
    return json.dumps(o) + "\n"
def ans(r):
    try: return json.loads(r.get("answer", "").strip().splitlines()[0])
    except Exception: return None
call("d_ping", req("ping", {}))
# invalid_request forms
call("d_pane_get_no_params", req("pane.get"))
call("d_pane_get_empty_params", req("pane.get", {}))
call("d_pane_get_pane_id_number", req("pane.get", {"pane_id": 7}))
call("d_pane_get_extra_param", req("pane.get", {"pane_id": "w9:p9", "zz": 1}))
call("d_unknown_method", req("pane.nosuch", {}))
call("d_not_json", "this is not json\n")
call("d_empty_line", "\n")
call("d_params_not_object", req("pane.get", ["w1:p1"]))
call("d_no_id", json.dumps({"method": "ping", "params": {}}) + "\n")
call("d_id_number", json.dumps({"id": 5, "method": "ping", "params": {}}) + "\n")
call("d_no_method", json.dumps({"id": "aohd2", "params": {}}) + "\n")
call("d_extra_top_level_field", json.dumps({"id": "aohd2", "method": "ping", "params": {}, "zz": 1}) + "\n")
# ID forms
for pid in ["w1:p1", "w1m:p1", "wI:p1", "wL:p1", "w0:p1", "w01:p1", "W1:P1", "w1:p0", " w1:p1", "w1:p1 "]:
    call(f"d_pane_get_id_{pid.strip().replace(':','_') or 'blank'}{'_sp' if pid != pid.strip() else ''}", req("pane.get", {"pane_id": pid}))
# partial and multiple requests on one connection
call("d_partial_no_newline_then_shutdown", '{"id":"aohd2","method":"ping","params":{}}', shut_write=True)
call("d_partial_cut_json_then_shutdown", '{"id":"aohd2","method":"pi', shut_write=True)
call("d_no_bytes_then_shutdown", "", shut_write=True)
call("d_two_requests_one_connection", req("ping", {}, "first") + req("ping", {}, "second"), read_all=True, shut_write=True, timeout=3)
# a workspace via the socket, its pane, process_info, closes
cwd = "/tmp/aohd2/tmp/ws1"; os.makedirs(cwd, exist_ok=True)
r = call("d_workspace_create", req("workspace.create", {"cwd": cwd, "label": "aohd2-d1", "focus": False}))
a = ans(r) or {}
res = a.get("result", {})
ws = res.get("workspace", {}).get("workspace_id"); root = (res.get("root_pane") or {}).get("pane_id")
log.append(f"workspace {ws} root pane {root}")
call("d_pane_get_root", req("pane.get", {"pane_id": root}))
call("d_pane_process_info_root", req("pane.process_info", {"pane_id": root}))
call("d_pane_send_input_env", req("pane.send_input", {"pane_id": root, "text": "env | grep -E '^(HERDR|XDG_CONFIG|HOME|SHELL)' | sort > /tmp/aohd2/tmp/pane_env.txt", "keys": ["Enter"]}))
time.sleep(1.5)
try:
    note("d_pane_env", open("/tmp/aohd2/tmp/pane_env.txt").read())
    log.append("pane env: " + open("/tmp/aohd2/tmp/pane_env.txt").read().replace("\n", " | "))
except OSError as e:
    log.append(f"pane env: not written ({e})")
r = call("d_pane_split", req("pane.split", {"target": root, "direction": "right", "focus": False}))
second = ((ans(r) or {}).get("result") or {}).get("pane", {}).get("pane_id")
log.append(f"second pane {second}")
call("d_pane_close_second", req("pane.close", {"pane_id": second}))
call("d_pane_get_second_after_close", req("pane.get", {"pane_id": second}))
call("d_pane_close_second_again", req("pane.close", {"pane_id": second}))
call("d_workspace_close_explicit_group_false", req("workspace.close", {"workspace_id": ws, "close_group": False}))
call("d_pane_get_root_after_ws_close", req("pane.get", {"pane_id": root}))
call("d_pane_process_info_after_ws_close", req("pane.process_info", {"pane_id": root}))
call("d_workspace_close_again", req("workspace.close", {"workspace_id": ws}))
call("d_workspace_get_closed", req("workspace.get", {"workspace_id": ws}))
# only pane: pane.close closes the workspace
cwd2 = "/tmp/aohd2/tmp/ws2"; os.makedirs(cwd2, exist_ok=True)
r = call("d_workspace_create_2", req("workspace.create", {"cwd": cwd2, "label": "aohd2-d2", "focus": False}))
res = (ans(r) or {}).get("result", {})
ws2 = res.get("workspace", {}).get("workspace_id"); root2 = (res.get("root_pane") or {}).get("pane_id")
call("d_pane_close_only_pane", req("pane.close", {"pane_id": root2}))
call("d_workspace_get_after_only_pane_close", req("workspace.get", {"workspace_id": ws2}))
# EACCES on the live server socket
os.chmod(S, 0)
call("d_eacces_socket_mode_000", req("ping", {}))
cap("d_eacces_cli_pane_get", ["herdr", "--session", "aohd2-1", "pane", "get", "w1:p1"])
os.chmod(S, 0o700)
call("d_after_chmod_back_ping", req("ping", {}))
# the CLI status with a running server
cap("d_status_server_json_running", ["herdr", "--session", "aohd2-1", "status", "server", "--json"])
note("d_socket_forms_log", "\n".join(log))
