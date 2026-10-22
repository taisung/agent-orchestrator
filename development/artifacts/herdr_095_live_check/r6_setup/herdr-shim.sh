#!/usr/bin/bash
# aohd3 herdr shim: logs every call, runs the real client under strace (connect, socket, execve),
# and refuses a client attach and the bare TUI start.
n=$(date +%s%N)
{ printf '%s pid=%s args:' "$(date +%T.%N)" "$$"; printf ' %q' "$@"; printf '\n'; } >> /tmp/aohd3/logs/herdr-shim.log
case "$*" in
  "agent attach"*|"") echo "aohd3 shim: refused 'herdr $*'" >&2; exit 97;;
esac
exec /tmp/aohd3/bin/strace -f -qq -e trace=connect,socket,execve -o "/tmp/aohd3/logs/strace/c.$n.$$.txt" \
  /tmp/aohd3/bin/herdr-real "$@"
