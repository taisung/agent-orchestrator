command: herdr pane read w1:p1 --source visible --lines 50
exit: 1
started: 2026-10-22T16:05:56,984837664-04:00
duration_ms: 24
stdout: noserver_never_pane_read_visible.txt (0 bytes)
stderr:
  {"id":"cli:pane:read","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock; run `herdr session attach aohd-1` to start or attach it"}}
