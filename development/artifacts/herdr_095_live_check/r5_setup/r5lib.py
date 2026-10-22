# r5lib: capture helper and a fake herdr socket server for the aohd2 checks (design r5, ao-65).
# Run only under /tmp/aohd2/scripts/run.sh (env -i, scratch HOME, XDG and PATH).
import datetime, json, os, shlex, socket, struct, subprocess, threading, time

OUT = "/tmp/aohd2/out"

def cap(name, argv, extra_env=None, unset=(), timeout=30, stdin=subprocess.DEVNULL):
    env = {k: v for k, v in os.environ.items() if k not in unset}
    env.update(extra_env or {})
    started = datetime.datetime.now().astimezone().isoformat(timespec="microseconds")
    t0 = time.monotonic()
    try:
        p = subprocess.run(argv, env=env, stdin=stdin, capture_output=True, timeout=timeout)
        code, out, err = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as e:
        code, out, err = f"timeout after {timeout} s (killed by the capture)", e.stdout or b"", e.stderr or b""
    ms = int((time.monotonic() - t0) * 1000)
    text = out.decode("utf-8", "replace")
    ext = "json" if text.strip().startswith(("{", "[")) else "txt"
    with open(f"{OUT}/r5_{name}.{ext}", "wb") as f:
        f.write(out)
    envnote = " ".join(f"{k}={shlex.quote(v)}" for k, v in (extra_env or {}).items())
    unsetnote = " ".join(f"-u {k}" for k in unset)
    with open(f"{OUT}/r5_{name}.cmd", "w") as f:
        f.write(f"command: {' '.join([unsetnote, envnote] if (unsetnote or envnote) else []).strip()}{' ' if (unsetnote or envnote) else ''}{shlex.join(argv)}\n")
        f.write(f"exit: {code}\nstarted: {started}\nduration_ms: {ms}\n")
        f.write(f"stdout: r5_{name}.{ext} ({len(out)} bytes)\nstderr:\n")
        for line in err.decode("utf-8", "replace").splitlines():
            f.write(f"  {line}\n")
    return code, text, err.decode("utf-8", "replace")

def note(name, text):
    with open(f"{OUT}/r5_{name}.txt", "w") as f:
        f.write(text if text.endswith("\n") else text + "\n")

def peer_of(s):
    pid, uid, gid = struct.unpack("3i", s.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    return pid, uid

def start_ticks(pid):
    with open(f"/proc/{pid}/stat") as f:
        return f.read().rsplit(")", 1)[1].split()[19]

def sock_call(path, payload, timeout=5.0, shut_write=False, read_all=False):
    """One connection: send payload bytes, read the answer. Returns a dict (never raises)."""
    r = {"path": path, "sent": payload.decode("utf-8", "replace")}
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(path)
    except OSError as e:
        r["connect_error"] = f"{type(e).__name__} errno={e.errno} ({os.strerror(e.errno) if e.errno else ''})"
        s.close()
        return r
    try:
        pid, uid = peer_of(s)
        r["peer_pid"], r["peer_uid_is_self"] = pid, uid == os.getuid()
        try:
            r["peer_start_ticks"] = start_ticks(pid)
            r["peer_exe"] = os.readlink(f"/proc/{pid}/exe")
        except OSError as e:
            r["peer_proc_error"] = f"{type(e).__name__} errno={e.errno}"
    except OSError as e:
        r["peercred_error"] = str(e)
    try:
        if payload:
            s.sendall(payload)
        if shut_write:
            s.shutdown(socket.SHUT_WR)
        buf = b""
        while True:
            if not read_all and buf.endswith(b"\n"):
                break
            chunk = s.recv(65536)
            if not chunk:
                r["eof"] = True
                break
            buf += chunk
        r["answer"] = buf.decode("utf-8", "replace")
    except socket.timeout:
        r["answer"] = buf.decode("utf-8", "replace") if 'buf' in dir() else ""
        r["timeout"] = True
    except OSError as e:
        r["io_error"] = f"{type(e).__name__} errno={e.errno}"
    finally:
        s.close()
    return r

class FakeServer:
    """A stand-in herdr server on a unix socket. handler(i, request_bytes) -> (answer_bytes, then)
    where then is "close" (close after the answer), "hang" (keep the connection open, no more bytes)."""
    def __init__(self, path, handler, read_timeout=3.0):
        self.path, self.handler, self.read_timeout = path, handler, read_timeout
        self.log, self.hung, self.stop_flag = [], [], False
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.exists(path):
            os.unlink(path)
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.bind(path)
        self.sock.listen(16)
        self.sock.settimeout(0.2)
        self.t = threading.Thread(target=self._loop, daemon=True)
        self.t.start()
    def _loop(self):
        i = 0
        while not self.stop_flag:
            try:
                c, _ = self.sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            i += 1
            c.settimeout(self.read_timeout)
            buf = b""
            try:
                while not buf.endswith(b"\n"):
                    chunk = c.recv(65536)
                    if not chunk:
                        break
                    buf += chunk
            except socket.timeout:
                pass
            self.log.append(buf.decode("utf-8", "replace"))
            try:
                ans, then = self.handler(i, buf)
                if ans:
                    c.sendall(ans)
            except OSError:
                then = "close"
            if then == "hang":
                self.hung.append(c)
            else:
                try:
                    c.close()
                except OSError:
                    pass
    def close(self):
        self.stop_flag = True
        self.t.join(2)
        for c in self.hung:
            try: c.close()
            except OSError: pass
        try: self.sock.close()
        except OSError: pass
        if os.path.exists(self.path):
            os.unlink(self.path)
