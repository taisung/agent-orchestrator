command: herdr workspace create --cwd /tmp/aohd/repo --label nsx --env AOHD_X=1 --no-focus
exit: 1
started: 2026-10-22T16:05:57,529112395-04:00
duration_ms: 23
stdout: noserver_never_workspace_create.txt (0 bytes)
stderr:
  {"id":"cli:workspace:create","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock; run `herdr session attach aohd-1` to start or attach it"}}
