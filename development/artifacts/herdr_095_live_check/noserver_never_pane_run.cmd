command: herdr pane run w1:p1 bash /tmp/aohd/scripts/noop.sh
exit: 1
started: 2026-10-22T16:05:57,159025524-04:00
duration_ms: 24
stdout: noserver_never_pane_run.txt (0 bytes)
stderr:
  {"id":"cli:request","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock; run `herdr session attach aohd-1` to start or attach it"}}
