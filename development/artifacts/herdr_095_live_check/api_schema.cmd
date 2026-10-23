command: strace -f -qq -e trace=connect\,socket\,openat -o /tmp/aohd/logs/strace/schema.txt <home>/.local/bin/herdr api schema --json
exit: 0
started: 2026-10-22T16:04:58,287730320-04:00
duration_ms: 14
stdout: api_schema.json (272578 bytes)
stderr:
