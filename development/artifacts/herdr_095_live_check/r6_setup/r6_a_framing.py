# Part A (m-1, B-1): does herdr 0.9.5 close the connection after its one answer line (EOF), for each answer
# type; does it keep a connection that sends nothing; does it answer a request written after a delay.
import json, os, socket, sys, time; sys.path.insert(0, "/tmp/aohd3/scripts")
from r6lib import *
S = "/tmp/aohd3/xdg/config/herdr/sessions/aohd3-1/herdr.sock"
log = Log("a_framing_log")
os.makedirs("/tmp/aohd3/tmp/wsa", exist_ok=True)
def show(label, r):
    keep = {k: r.get(k) for k in ("peer_pid", "first_byte_ms", "newline_ms", "eof_ms", "deadline", "chunks", "bytes",
                                   "lines", "after_first_newline", "error")}
    keep["answer"] = (r.get("answer") or "")[:300]
    log.add(label, keep)
    return r
show("a_ping", call(S, "ping", {}))
w = show("a_workspace_create", call(S, "workspace.create", {"cwd": "/tmp/aohd3/tmp/wsa", "label": "aohd3-a", "focus": False}))
root = w["json"]["result"]["root_pane"]["pane_id"]
show("a_pane_get_root", call(S, "pane.get", {"pane_id": root}))
show("a_pane_process_info_root", call(S, "pane.process_info", {"pane_id": root}))
show("a_pane_get_not_found", call(S, "pane.get", {"pane_id": "wZZ:p1"}))
show("a_invalid_request", call(S, "pane.get", {}))
show("a_workspace_list", call(S, "workspace.list", {}))
sp = show("a_pane_split", call(S, "pane.split", {"target_pane_id": root, "direction": "right", "focus": False}))
second = sp["json"]["result"]["pane"]["pane_id"] if sp.get("json") and "result" in sp["json"] else None
log.add("a_second_pane", str(second))
if second:
    show("a_pane_close_second", call(S, "pane.close", {"pane_id": second}))
    show("a_pane_close_second_again", call(S, "pane.close", {"pane_id": second}))
# B: a connection that sends nothing; a request written after a delay.
for d in (0, 0.2, 1, 3, 10):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(S)
    time.sleep(d)
    t1 = time.monotonic()
    try:
        s.sendall(request("ping", {}))
        s.settimeout(5)
        buf = b""
        while True:
            c = s.recv(65536)
            if not c:
                break
            buf += c
        log.add(f"b_delayed_write_{d}s", {"answer": buf.decode()[:120], "eof_ms": round((time.monotonic() - t1) * 1000, 2)})
    except OSError as e:
        log.add(f"b_delayed_write_{d}s", {"error": f"{type(e).__name__} errno={e.errno}"})
    s.close()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(S)
s.settimeout(20)
t1 = time.monotonic()
try:
    c = s.recv(65536)
    log.add("b_idle_no_request_20s", {"recv": c.decode("utf-8", "replace"), "after_ms": round((time.monotonic() - t1) * 1000, 1)})
except socket.timeout:
    log.add("b_idle_no_request_20s", "no byte and no EOF within 20 s (the server keeps the idle connection)")
s.close()
log.add("a_root_pane", root)
log.save()
