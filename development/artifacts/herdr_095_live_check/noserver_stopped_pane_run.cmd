command: herdr pane run w3:p1 bash /tmp/aohd/scripts/noop.sh
exit: 1
started: 2026-10-22T16:12:47,341555184-04:00
duration_ms: 20
stdout: noserver_stopped_pane_run.txt (0 bytes)
stderr:
  {"id":"cli:request","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock; run `herdr session attach aohd-1` to start or attach it"}}
