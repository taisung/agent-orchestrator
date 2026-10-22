#!/usr/bin/bash
# poll.sh PANE SECONDS: print each change of (agent, agent_status) of the pane, with ms since start.
p=$1; secs=$2; t0=$(date +%s%N); last=""
while [ $(( ($(date +%s%N)-t0)/1000000 )) -lt $((secs*1000)) ]; do
  out=$(herdr pane get "$p" 2>&1)
  s=$(printf '%s' "$out" | python3 -I -c 'import json,sys
try:
  d=json.load(sys.stdin)
  if "error" in d: print("error", d["error"]["code"])
  else:
    q=d["result"]["pane"]; print(q.get("agent"), q.get("agent_status"), q.get("terminal_id"))
except Exception as e: print("unparsed", repr(sys.stdin))' 2>&1)
  if [ "$s" != "$last" ]; then echo "+$(( ($(date +%s%N)-t0)/1000000 ))ms $s"; last=$s; fi
  sleep 0.1
done
echo "+$(( ($(date +%s%N)-t0)/1000000 ))ms end ($last)"
