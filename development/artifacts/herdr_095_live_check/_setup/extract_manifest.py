import sys, re
data = open(sys.argv[1], 'rb').read()
want = sys.argv[2].encode()
# manifest headers: id = "<x>"\nversion = "..."\nmin_engine_version
hdr = re.compile(rb'\nid = "([a-z_\-]+)"\nversion = "([^"]+)"\nmin_engine_version')
heads = [(m.start(), m.group(1).decode(), m.group(2).decode()) for m in hdr.finditer(data)]
print("manifests:", [(h[1], h[2]) for h in heads], file=sys.stderr)
for i, (pos, name, ver) in enumerate(heads):
    if name.encode() != want: continue
    end = heads[i+1][0] if i+1 < len(heads) else pos + 60000
    chunk = data[pos:end]
    # stop at first NUL
    nul = chunk.find(b'\0')
    if nul >= 0: chunk = chunk[:nul]
    sys.stdout.write(chunk.decode('utf-8', 'replace'))
