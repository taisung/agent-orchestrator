# Part E (NM-1, M-6): pane.close of the only pane of a primary workspace that has a linked worktree
# workspace, on server aohd3-2 (started here under strace -ff, so its git children are traced).
# E1: the primary is at the repository root. E2: the primary is an AO-like workspace (its cwd is a linked
# git worktree made with `git worktree add`, as AO does) that an operator used for `worktree create`.
import json, os, subprocess, sys, time; sys.path.insert(0, "/tmp/aohd3/scripts")
from r6lib import *
SESSION = "aohd3-2"
S = f"/tmp/aohd3/xdg/config/herdr/sessions/{SESSION}/herdr.sock"
R = "/tmp/aohd3/repo"
log = Log("e_nm1_log")

def git(label, *args, cwd=R):
    p = subprocess.run(["/tmp/aohd3/bin/strace", "-f", "-qq", "-e", "trace=connect,socket", "-o",
                        f"/tmp/aohd3/logs/strace/git.{label}", "git", *args], cwd=cwd, capture_output=True, text=True)
    log.add(f"git_{label}", {"args": list(args), "exit": p.returncode, "out": p.stdout.strip()[:600], "err": p.stderr.strip()[:300]})
    return p.stdout

out = open("/tmp/aohd3/logs/server-e.out", "w")
srv = subprocess.Popen(["/tmp/aohd3/bin/strace", "-ff", "-qq", "-e", "trace=network,execve", "-o", "/tmp/aohd3/logs/strace/servere",
                        "/tmp/aohd3/bin/herdr-real", "--session", SESSION, "server"],
                       stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
for _ in range(100):
    time.sleep(0.1)
    r = call(S, "ping", {})
    if r.get("json"):
        break
with open("/tmp/aohd3/logs/pids.txt", "a") as f:
    f.write(f"server aohd3-2: strace {srv.pid}, herdr {r.get('peer_pid')}, started {time.strftime('%T')}\n")
log.add("server", {"strace_pid": srv.pid, "herdr_pid": r.get("peer_pid"), "pong": (r.get("json") or {}).get("result", {}).get("version")})

os.makedirs(R, exist_ok=True)
git("init", "init", "-q")
with open(f"{R}/README", "w") as f:
    f.write("aohd3 scratch repository\n")
git("add", "add", "README")
git("commit", "commit", "-q", "-m", "scratch")
git("worktree_add_aolike", "worktree", "add", "-q", "-b", "ao-like", "/tmp/aohd3/repo-wt-ao")

def snapshot(label, items):
    ws = (((call(S, "workspace.list", {}).get("json") or {}).get("result") or {}).get("workspaces") or [])
    snap = {"workspaces": [(w["workspace_id"], w.get("label"), w.get("pane_count")) for w in ws]}
    for name, wsid, pane, shell in items:
        g = call(S, "workspace.get", {"workspace_id": wsid})
        p = call(S, "pane.get", {"pane_id": pane})
        snap[name] = {"workspace_get": (g.get("answer") or "")[:420], "pane_get_code_or_type": (
            ((p.get("json") or {}).get("error") or {}).get("code") or ((p.get("json") or {}).get("result") or {}).get("type")),
            "shell": shell, "shell_stat": proc_stat(shell)}
    snap["git_worktree_list"] = git(f"wtlist_{label}", "worktree", "list", "--porcelain").strip().splitlines()
    snap["git_branches"] = git(f"branches_{label}", "branch", "--list").strip().splitlines()
    snap["dirs"] = {d: os.path.isdir(d) for d in ("/tmp/aohd3/repo-wt-ao", "/tmp/aohd3/repo-wt-nm1a", "/tmp/aohd3/repo-wt-nm1b")}
    log.add(f"{label}", snap)

def shell_of(pane):
    return call(S, "pane.process_info", {"pane_id": pane})["json"]["result"]["process_info"]["shell_pid"]

def experiment(tag, primary_cwd, branch, path):
    w = call(S, "workspace.create", {"cwd": primary_cwd, "label": f"aohd3-{tag}-primary", "focus": False})
    log.add(f"{tag}_primary_create", (w.get("answer") or "")[:300])
    pw = w["json"]["result"]["workspace"]["workspace_id"]; pp = w["json"]["result"]["root_pane"]["pane_id"]
    l = call(S, "worktree.create", {"workspace_id": pw, "branch": branch, "path": path, "label": f"aohd3-{tag}-linked", "focus": False},
             deadline=30)
    log.add(f"{tag}_worktree_create", (l.get("answer") or "")[:900])
    if not (l.get("json") or {}).get("result"):
        return
    lw = l["json"]["result"]["workspace"]["workspace_id"]; lp = l["json"]["result"]["root_pane"]["pane_id"]
    time.sleep(0.5)
    items = [("primary", pw, pp, shell_of(pp)), ("linked", lw, lp, shell_of(lp))]
    snapshot(f"{tag}_before", items)
    c = call(S, "pane.close", {"pane_id": pp}, deadline=10)
    log.add(f"{tag}_pane_close_primary_only_pane", {"answer": c.get("answer"), "eof_ms": c.get("eof_ms")})
    time.sleep(1.0)
    snapshot(f"{tag}_after", items)

experiment("e1", R, "nm1a", "/tmp/aohd3/repo-wt-nm1a")
experiment("e2", "/tmp/aohd3/repo-wt-ao", "nm1b", "/tmp/aohd3/repo-wt-nm1b")
log.save()
