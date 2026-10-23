#!/usr/bin/bash
# aohd herdr shim: selects the private session, blocks a client attach, logs every call,
# and records every socket connect of the real herdr client under strace.
sess=$(cat /tmp/aohd/session)
n=$(date +%s%N)
printf '%s pid=%s ppid=%s session=%s args:' "$(date +%T.%N)" "$$" "$PPID" "$sess" >> /tmp/aohd/logs/herdr-shim.log
printf ' %q' "$@" >> /tmp/aohd/logs/herdr-shim.log
printf '\n' >> /tmp/aohd/logs/herdr-shim.log
if [ "$1" = agent ] && [ "$2" = attach ]; then
  echo "aohd shim: blocked 'herdr agent attach $3' (no client attach in this check)" >&2
  exit 97
fi
exec /tmp/aohd/bin/strace -f -qq -e trace=connect,socket,execve -o "/tmp/aohd/logs/strace/c.$n.$$.txt" \
  <home>/.local/bin/herdr --session "$sess" "$@"
