# Part B0: what does the CLI send? A fake server at HERDR_SOCKET_PATH logs every connection
# and answers each request with a pane_not_found envelope that echoes the request id.
import json, sys; sys.path.insert(0, "/tmp/aohd2/scripts")
from r5lib import cap, FakeServer, note
P = "/tmp/aohd2/fake/b0.sock"
def h(i, req):
    try:
        rid = json.loads(req).get("id")
    except Exception:
        rid = None
    return (json.dumps({"id": rid, "error": {"code": "pane_not_found", "message": "fake: pane not found"}}) + "\n").encode(), "close"
fs = FakeServer(P, h)
env = {"HERDR_SOCKET_PATH": P}
lines = []
for name, args in [("b0_pane_get", ["pane", "get", "w1:p1"]),
                   ("b0_pane_process_info", ["pane", "process-info", "--pane", "w1:p1"]),
                   ("b0_pane_get_empty_id", ["pane", "get", ""]),
                   ("b0_pane_get_bad_id", ["pane", "get", "not a pane"]),
                   ("b0_status_server_json", ["status", "server", "--json"])]:
    before = len(fs.log)
    code, out, err = cap(name, ["herdr"] + args, env)
    reqs = fs.log[before:]
    lines.append(f"{name}: exit={code} stdout={out.strip()!r} stderr={err.strip()!r}")
    for j, r in enumerate(reqs, 1):
        lines.append(f"  connection {j}: {r.strip()}")
fs.close()
note("b0_requests_log", "\n".join(lines))
print("\n".join(lines))
