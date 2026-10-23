#!/usr/bin/bash
# cap NAME CMD...: run CMD in the scratch env; keep stdout raw in NAME.json or NAME.txt,
# and the command, exit code, timing and stderr in NAME.cmd.
FX=<home>/.worktrees/agent-orchestrator/ao-65/development/artifacts/herdr_095_live_check
name=$1; shift
t0=$(date +%s%N)
/tmp/aohd/run "$@" > "$FX/$name.out" 2> "$FX/$name.err"
ec=$?
t1=$(date +%s%N)
if [ -s "$FX/$name.out" ] && /usr/bin/python3 -I -c 'import json,sys; json.load(open(sys.argv[1]))' "$FX/$name.out" 2>/dev/null; then ext=json; else ext=txt; fi
mv "$FX/$name.out" "$FX/$name.$ext"
{
  printf 'command:'; printf ' %q' "$@"; printf '\n'
  echo "exit: $ec"
  echo "started: $(date -d @$((t0/1000000000)).$(printf %09d $((t0%1000000000))) --iso-8601=ns)"
  echo "duration_ms: $(( (t1-t0)/1000000 ))"
  echo "stdout: $name.$ext ($(wc -c < "$FX/$name.$ext") bytes)"
  echo "stderr:"
  sed 's/^/  /' "$FX/$name.err"
} > "$FX/$name.cmd"
rm -f "$FX/$name.err"
echo "[$name] exit=$ec ${ext} $(( (t1-t0)/1000000 ))ms"
