# Part G: who holds the listening socket of the herdr path? (/proc/net/unix + /proc/<pid>/fd, no SO_PEERCRED)
import os, sys, json; sys.path.insert(0, "/tmp/aohd2/scripts")
from r5lib import note, sock_call
S = sys.argv[1]
def listen_inodes(path):
    out = []
    for line in open("/proc/net/unix").read().splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 8 and parts[7] == path:
            flags, st, ino = int(parts[3], 16), parts[5], parts[6]
            out.append({"inode": ino, "listen": bool(flags & 0x10000), "state": st})
    return out
def holders(inode):
    me, res = os.getuid(), []
    for p in os.listdir("/proc"):
        if not p.isdigit(): continue
        try:
            if os.stat(f"/proc/{p}").st_uid != me: continue
            for fd in os.listdir(f"/proc/{p}/fd"):
                try:
                    if os.readlink(f"/proc/{p}/fd/{fd}") == f"socket:[{inode}]":
                        res.append({"pid": int(p), "fd": int(fd), "comm": open(f"/proc/{p}/comm").read().strip()})
                except OSError: pass
        except OSError: pass
    return res
L = listen_inodes(S)
r = {"path": S, "proc_net_unix": L, "holders": {x["inode"]: holders(x["inode"]) for x in L},
     "ping_peer": {k: v for k, v in sock_call(S, b'{"id":"aohd2","method":"ping","params":{}}\n').items() if k.startswith("peer")}}
print(json.dumps(r, indent=1))
note(sys.argv[2], json.dumps(r, indent=1))
