# Part G2: /proc/net/unix keeps the bind path of a socket. A rename of the socket file and a new bind at the
# same path give two LISTEN entries with that path. Also the cost of one read of /proc/net/unix.
import os, socket, sys, time, json; sys.path.insert(0, "/tmp/aohd2/scripts")
from r5lib import note
P = "/tmp/aohd2/g2/s.sock"; os.makedirs("/tmp/aohd2/g2", exist_ok=True)
def entries(path):
    res = []
    for line in open("/proc/net/unix").read().splitlines()[1:]:
        f = line.split(None, 7)
        if len(f) == 8 and f[7] == path:
            res.append({"inode": f[6], "listen": bool(int(f[3], 16) & 0x10000)})
    return res
log = []
a = socket.socket(socket.AF_UNIX); a.bind(P); a.listen(1)
log.append(f"server A bound at P: {entries(P)}; stat ino {os.stat(P).st_ino}")
os.rename(P, P + ".old")
log.append(f"after rename P -> P.old: entries(P) {entries(P)}; entries(P.old) {entries(P + '.old')}; P exists {os.path.exists(P)}")
b = socket.socket(socket.AF_UNIX); b.bind(P); b.listen(1)
log.append(f"server B bound at P: entries(P) {entries(P)}; stat ino {os.stat(P).st_ino}")
a.close()
log.append(f"server A closed: entries(P) {entries(P)}")
b.close(); os.unlink(P); os.unlink(P + ".old")
t0 = time.monotonic(); n = len(open("/proc/net/unix").read().splitlines()); ms = (time.monotonic() - t0) * 1000
log.append(f"/proc/net/unix: {n} lines, one read {ms:.2f} ms")
t0 = time.monotonic(); cnt = 0
for p in os.listdir("/proc"):
    if p.isdigit():
        try:
            if os.stat(f"/proc/{p}").st_uid == os.getuid():
                for fd in os.listdir(f"/proc/{p}/fd"):
                    try: os.readlink(f"/proc/{p}/fd/{fd}"); cnt += 1
                    except OSError: pass
        except OSError: pass
log.append(f"holder scan of every own process: {cnt} fd links, {(time.monotonic() - t0) * 1000:.0f} ms")
note("g2_rename_and_cost", "\n".join(log)); print("\n".join(log))
