# sock.py SOCKET JSON_REQUEST: one request on one connection; print the peer (SO_PEERCRED)
# with its start ticks, the raw answer line, and the connect error if any.
import json, socket, struct, sys
path, req = sys.argv[1], sys.argv[2]
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(5)
try:
    s.connect(path)
except OSError as e:
    print(json.dumps({"connect_error": type(e).__name__, "errno": e.errno})); sys.exit(0)
pid, uid, gid = struct.unpack("3i", s.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
try:
    with open(f"/proc/{pid}/stat") as f:
        ticks = f.read().rsplit(")", 1)[1].split()[19]
except OSError as e:
    ticks = f"unreadable: {e}"
s.sendall(req.encode() + b"\n")
buf = b""
while not buf.endswith(b"\n"):
    chunk = s.recv(65536)
    if not chunk: break
    buf += chunk
print(json.dumps({"peer_pid": pid, "peer_uid_is_self": uid == __import__("os").getuid(), "peer_start_ticks": ticks}), file=sys.stderr)
sys.stdout.write(buf.decode())
