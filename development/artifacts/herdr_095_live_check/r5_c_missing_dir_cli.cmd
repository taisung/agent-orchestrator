command: HERDR_SOCKET_PATH=/tmp/aohd2/c/nosuchdir/s.sock herdr pane get w1:p1
exit: 1
started: 2026-10-22T18:04:46.739665-04:00
duration_ms: 18
stdout: r5_c_missing_dir_cli.txt (0 bytes)
stderr:
  {"id":"cli:pane:get","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd2/c/nosuchdir/s.sock; run `herdr` to start or attach it"}}
