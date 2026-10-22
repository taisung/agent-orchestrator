# Part B: how the 0.9.5 CLI prints each server answer (fake server at HERDR_SOCKET_PATH).
# Part C: the CLI and a raw socket client on ECONNREFUSED, EACCES and ENOENT paths.
import json, os, socket, sys, time; sys.path.insert(0, "/tmp/aohd2/scripts")
from r5lib import cap, FakeServer, note, sock_call
PONG = {"type": "pong", "version": "0.9.5", "protocol": 22, "capabilities": {"live_handoff": True,
        "detached_server_daemon": False, "endpoint_protocol_generation": 1, "surface_interest": True,
        "health_check": True, "ssh_agent_registration": True}}
PANE = {"agent": "claude", "agent_status": "idle", "pane_id": "w1:p1", "terminal_id": "term_65e7000000000a1",
        "workspace_id": "w1", "tab_id": "w1:t1", "zz_extra": 1}
def line(o): return (json.dumps(o) + "\n").encode()
def rid(req):
    try: return json.loads(req).get("id")
    except Exception: return None
log = []
def run(name, args, second, ping=None):
    """second(req) -> (bytes, then) for the request after the ping; ping(req) likewise for the ping."""
    P = f"/tmp/aohd2/fake/{name}.sock"
    def h(i, req):
        try: is_ping = json.loads(req).get("method") == "ping"
        except Exception: is_ping = False
        if is_ping:
            return ping(req) if ping else (line({"id": rid(req), "result": PONG}), "close")
        return second(req)
    fs = FakeServer(P, h)
    code, out, err = cap(name, ["herdr"] + args, {"HERDR_SOCKET_PATH": P}, timeout=45)
    reqs = list(fs.log)
    fs.close()
    log.append(f"{name}: exit={code}\n  stdout={out!r}\n  stderr={err!r}")
    for j, r in enumerate(reqs, 1):
        log.append(f"  connection {j}: {r.strip()}")
    print(log[-1 - len(reqs)][:600]); [print(l[:400]) for l in log[-len(reqs):]] if reqs else None
G = ["pane", "get", "w1:p1"]
ok = lambda o: (lambda req: (line({"id": rid(req), **o}), "close"))
run("b_pane_get_result", G, ok({"result": {"type": "pane_info", "pane": PANE}}))
run("b_pane_get_pane_not_found", G, ok({"error": {"code": "pane_not_found", "message": "pane w1:p1 not found"}}))
run("b_pane_get_unknown_code", G, ok({"error": {"code": "zz_unknown_code", "message": "fake"}}))
run("b_pane_get_error_and_result", G, ok({"error": {"code": "pane_not_found", "message": "x"}, "result": {"type": "pane_info", "pane": PANE}}))
run("b_pane_get_error_not_object", G, ok({"error": "pane_not_found"}))
run("b_pane_get_error_no_code", G, ok({"error": {"message": "no code"}}))
run("b_pane_get_garbage", G, lambda req: (b"not json at all\n", "close"))
run("b_pane_get_partial", G, lambda req: (b'{"id":"cli:pane:get","result":{"ty', "close"))
run("b_pane_get_close_no_answer", G, lambda req: (b"", "close"))
run("b_pane_get_hang", G, lambda req: (b"", "hang"))
run("b_pane_get_other_pane", G, ok({"result": {"type": "pane_info", "pane": {**PANE, "pane_id": "w9:p9"}}}))
run("b_pane_get_wrong_id", G, lambda req: (line({"id": "someone-else", "result": {"type": "pane_info", "pane": PANE}}), "close"))
run("b_pane_get_two_lines", G, lambda req: (line({"id": rid(req), "error": {"code": "pane_not_found", "message": "x"}}) + line({"id": rid(req), "result": {"type": "pane_info", "pane": PANE}}), "close"))
run("b_pane_get_no_result_no_error", G, ok({"pane": PANE}))
run("b_pane_get_server_not_running_from_server", G, ok({"error": {"code": "server_not_running", "message": "fake server says so"}}))
run("b_ping_protocol_19", G, ok({"result": {"type": "pane_info", "pane": PANE}}), ping=lambda req: (line({"id": rid(req), "result": {**PONG, "version": "0.8.0", "protocol": 19}}), "close"))
run("b_ping_version_0_9_4", G, ok({"result": {"type": "pane_info", "pane": PANE}}), ping=lambda req: (line({"id": rid(req), "result": {**PONG, "version": "0.9.4"}}), "close"))
run("b_ping_hang", G, ok({"result": {"type": "pane_info", "pane": PANE}}), ping=lambda req: (b"", "hang"))
run("b_ping_garbage", G, ok({"result": {"type": "pane_info", "pane": PANE}}), ping=lambda req: (b"garbage\n", "close"))
run("b_ping_close", G, ok({"result": {"type": "pane_info", "pane": PANE}}), ping=lambda req: (b"", "close"))
PI = ["pane", "process-info", "--pane", "w1:p1"]
run("b_process_info_result", PI, ok({"result": {"type": "pane_process_info", "process_info": {"pane_id": "w1:p1", "shell_pid": 11, "foreground_process_group_id": 12, "foreground_processes": [{"pid": 12, "name": "claude", "cmdline": "claude --x", "argv": ["claude", "--x"], "cwd": "/tmp"}]}}}))
run("b_process_info_pane_not_found", PI, ok({"error": {"code": "pane_not_found", "message": "pane not found"}}))
okok = ok({"result": {"type": "ok"}})
run("b_req_workspace_close", ["workspace", "close", "w1"], okok)
run("b_req_workspace_close_group", ["workspace", "close", "w1", "--group"], okok)
run("b_req_pane_close", ["pane", "close", "w1:p1"], okok)
run("b_req_agent_prompt", ["agent", "prompt", "w1:p1", "hello"], okok)
run("b_req_pane_send_text", ["pane", "send-text", "w1:p1", "hello"], okok)
run("b_req_pane_send_keys", ["pane", "send-keys", "w1:p1", "Enter"], okok)
run("b_req_pane_read", ["pane", "read", "w1:p1", "--source", "recent-unwrapped", "--lines", "5"], okok)
run("b_req_pane_run", ["pane", "run", "w1:p1", "bash", "/tmp/aohd2/tmp/x.sh"], okok)
run("b_req_workspace_create", ["workspace", "create", "--cwd", "/tmp/aohd2/tmp", "--label", "aohd2-x", "--env", "A=1", "--no-focus"], okok)
note("b_cli_forms_log", "\n".join(log))

# Part C
clog = []
def both(name, path):
    code, out, err = cap(name + "_cli", ["herdr", "pane", "get", "w1:p1"], {"HERDR_SOCKET_PATH": path}, timeout=30)
    r = sock_call(path, b'{"id":"aohd2","method":"ping","params":{}}\n')
    clog.append(f"{name}: cli exit={code} stdout={out!r} stderr={err!r}\n  socket client: {json.dumps(r)}")
    print(clog[-1][:700])
os.makedirs("/tmp/aohd2/c", exist_ok=True)
# C1 a stale socket file (bound, never listening, closed)
p = "/tmp/aohd2/c/stale.sock"; s = socket.socket(socket.AF_UNIX); s.bind(p); s.close()
both("c_stale_socket_file", p)
# C2 a regular file at the socket path
p = "/tmp/aohd2/c/regular.sock"; open(p, "w").close()
both("c_regular_file", p)
# C3 a live fake server whose socket file has mode 000
P = "/tmp/aohd2/c/mode000/s.sock"
fs = FakeServer(P, lambda i, req: (line({"id": rid(req), "result": PONG}), "close"))
os.chmod(P, 0)
both("c_socket_mode_000", P)
os.chmod(P, 0o755)
# C4 the same live fake server, its directory without search permission
os.chmod(os.path.dirname(P), 0o600)
both("c_dir_no_search", P)
os.chmod(os.path.dirname(P), 0o755)
both("c_live_fake_server_control", P)
log_c_requests = list(fs.log); fs.close()
# C5 a missing directory
both("c_missing_dir", "/tmp/aohd2/c/nosuchdir/s.sock")
clog.append(f"requests that reached the mode-000/dir server: {log_c_requests}")
note("c_access_forms_log", "\n".join(clog))
