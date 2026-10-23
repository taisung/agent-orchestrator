command: herdr pane read w3:p1 --source visible --lines 50
exit: 1
started: 2026-10-22T16:12:47,230255890-04:00
duration_ms: 28
stdout: noserver_stopped_pane_read_visible.txt (0 bytes)
stderr:
  {"id":"cli:pane:read","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock; run `herdr session attach aohd-1` to start or attach it"}}
