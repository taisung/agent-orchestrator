command: strace -f -qq -e trace=connect\,socket -o /tmp/aohd/logs/strace/help.help_api_ping.txt <home>/.local/bin/herdr api ping --help
exit: 2
started: 2026-10-22T16:04:37,709293418-04:00
duration_ms: 21
stdout: help_api_ping.txt (0 bytes)
stderr:
  herdr api commands:
    herdr api snapshot
    herdr api schema [--json | --output PATH]
