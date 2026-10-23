# r6lib: capture helper, listener check and socket clients for the aohd3 checks (design r6, ao-65).
# Run only under /tmp/aohd3/scripts/run.sh (env -i, scratch HOME, XDG and PATH).
import datetime, json, os, shlex, socket, stat, struct, subprocess, time

OUT = "/tmp/aohd3/out"
LISTEN_FLAG = 0x00010000

def now():
    return datetime.datetime.now().astimezone().isoformat(timespec="microseconds")

def cap(name, argv, extra_env=None, timeout=30):
    env = dict(os.environ)
    env.update(extra_env or {})
    started = now()
    t0 = time.monotonic()
    try:
        p = subprocess.run(argv, env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)
        code, out, err = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as e:
        code, out, err = f"timeout after {timeout} s (killed by the capture)", e.stdout or b"", e.stderr or b""
    ms = int((time.monotonic() - t0) * 1000)
    text = out.decode("utf-8", "replace")
    ext = "json" if text.strip().startswith(("{", "[")) else "txt"
    with open(f"{OUT}/r6_{name}.{ext}", "wb") as f:
        f.write(out)
    envnote = " ".join(f"{k}={shlex.quote(v)}" for k, v in (extra_env or {}).items())
    with open(f"{OUT}/r6_{name}.cmd", "w") as f:
        f.write(f"command: {(envnote + ' ') if envnote else ''}{shlex.join(argv)}\n")
        f.write(f"exit: {code}\nstarted: {started}\nduration_ms: {ms}\n")
        f.write(f"stdout: r6_{name}.{ext} ({len(out)} bytes)\nstderr:\n")
        for line in err.decode("utf-8", "replace").splitlines():
            f.write(f"  {line}\n")
    return code, text, err.decode("utf-8", "replace")

class Log:
    def __init__(self, name):
        self.name, self.lines = name, []
    def add(self, label, obj):
        line = f"{label}: {obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)}"
        self.lines.append(line)
        print(line[:400], flush=True)
    def save(self):
        with open(f"{OUT}/r6_{self.name}.txt", "w") as f:
            f.write("\n".join(self.lines) + "\n")

def proc_stat(pid):
    """(state, start_ticks) or an error text."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            rest = f.read().rsplit(")", 1)[1].split()
        return {"state": rest[0], "ticks": rest[19]}
    except OSError as e:
        return {"error": f"{type(e).__name__} errno={e.errno}"}

def peer_of(s):
    pid, uid, gid = struct.unpack("3i", s.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    return pid

def lc(path):
    """The listener check of design r5 3.5: the socket file (dev, ino) and the LISTEN entries whose path is `path`."""
    r = {}
    try:
        st = os.lstat(path)
        r["file"] = [st.st_dev, st.st_ino]
        r["is_socket"] = stat.S_ISSOCK(st.st_mode)
        r["own"] = st.st_uid == os.getuid()
    except OSError as e:
        r["file_error"] = f"{type(e).__name__} errno={e.errno}"
    listen, other = [], 0
    with open("/proc/net/unix") as f:
        next(f)
        for line in f:
            parts = line.split(None, 7)
            if len(parts) == 8 and parts[7].rstrip("\n") == path:
                if int(parts[3], 16) & LISTEN_FLAG:
                    listen.append(parts[6])
                else:
                    other += 1
    r["listen"] = listen
    r["connected_entries"] = other
    return r

def lc_key(r):
    if "file" not in r or not r.get("is_socket") or not r.get("own") or len(r["listen"]) != 1:
        return None
    return (tuple(r["file"]), r["listen"][0])

def request(method, params, rid="aohd3"):
    return (json.dumps({"id": rid, "method": method, "params": params}) + "\n").encode()

def call_eof(path, payload, deadline=5.0, connect_only=False):
    """One connection; send the payload, then read until EOF or the deadline. Never closes the write side first."""
    r = {"sent": payload.decode("utf-8", "replace")}
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    t0 = time.monotonic()
    try:
        s.settimeout(deadline)
        s.connect(path)
        r["peer_pid"] = peer_of(s)
        s.sendall(payload)
        t1 = time.monotonic()
        buf, chunks, first_byte_ms, nl_ms = b"", 0, None, None
        while True:
            left = deadline - (time.monotonic() - t1)
            if left <= 0:
                r["deadline"] = True
                break
            s.settimeout(left)
            try:
                c = s.recv(65536)
            except socket.timeout:
                r["deadline"] = True
                break
            if not c:
                r["eof_ms"] = round((time.monotonic() - t1) * 1000, 2)
                break
            if first_byte_ms is None:
                first_byte_ms = round((time.monotonic() - t1) * 1000, 2)
            buf += c
            chunks += 1
            if nl_ms is None and b"\n" in buf:
                nl_ms = round((time.monotonic() - t1) * 1000, 2)
        r.update({"first_byte_ms": first_byte_ms, "newline_ms": nl_ms, "chunks": chunks, "bytes": len(buf),
                  "lines": buf.count(b"\n"), "after_first_newline": len(buf.split(b"\n", 1)[1]) if b"\n" in buf else None,
                  "answer": buf.decode("utf-8", "replace")})
    except OSError as e:
        r["error"] = f"{type(e).__name__} errno={e.errno}"
    finally:
        s.close()
    return r

def call(path, method, params, deadline=5.0):
    r = call_eof(path, request(method, params), deadline)
    try:
        r["json"] = json.loads(r.get("answer", "").split("\n", 1)[0])
    except Exception:
        r["json"] = None
    return r
