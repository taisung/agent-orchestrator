command: HERDR_SOCKET_PATH=/tmp/aohd2/s/custom.sock HERDR_SESSION=aohd2-env herdr pane get w1:p1
exit: 1
started: 2026-10-22T18:02:10.507676-04:00
duration_ms: 17
stdout: r5_path_env_socket_and_env_session.txt (0 bytes)
stderr:
  {"id":"cli:pane:get","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd2/s/custom.sock; run `herdr` to start or attach it"}}
