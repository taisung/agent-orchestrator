command: HERDR_SOCKET_PATH=/tmp/aohd2/s/custom.sock herdr --session aohd2-flag pane get w1:p1
exit: 1
started: 2026-10-22T18:02:10.489509-04:00
duration_ms: 17
stdout: r5_path_env_socket_and_flag_session.txt (0 bytes)
stderr:
  {"id":"cli:pane:get","error":{"code":"server_not_running","message":"no herdr server is running at /tmp/aohd2/xdg/config/herdr/sessions/aohd2-flag/herdr.sock; run `herdr session attach aohd2-flag` to start or attach it"}}
