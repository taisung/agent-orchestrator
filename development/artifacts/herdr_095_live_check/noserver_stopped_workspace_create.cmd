command: herdr workspace create --cwd /tmp/aohd/repo --label nsy --no-focus
exit: 1
started: 2026-10-22T16:12:47,715660939-04:00
duration_ms: 22
stdout: noserver_stopped_workspace_create.txt (0 bytes)
stderr:
  {"id":"cli:workspace:create","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock; run `herdr session attach aohd-1` to start or attach it"}}
