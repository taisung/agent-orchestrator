command: herdr pane read w1:p1 --source recent-unwrapped --lines 50
exit: 1
started: 2026-10-22T16:05:56,941491823-04:00
duration_ms: 23
stdout: noserver_never_pane_read_recent_unwrapped.txt (0 bytes)
stderr:
  {"id":"cli:pane:read","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock; run `herdr session attach aohd-1` to start or attach it"}}
