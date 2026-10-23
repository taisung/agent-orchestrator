command: HERDR_SOCKET_PATH=/tmp/aohd2/fake/b_pane_get_error_and_result.sock herdr pane get w1:p1
exit: 1
started: 2026-10-22T18:03:10.571839-04:00
duration_ms: 20
stdout: r5_b_pane_get_error_and_result.txt (0 bytes)
stderr:
  {"error":{"code":"pane_not_found","message":"x"},"id":"cli:pane:get","result":{"pane":{"agent":"claude","agent_status":"idle","pane_id":"w1:p1","tab_id":"w1:t1","terminal_id":"term_65e7000000000a1","workspace_id":"w1","zz_extra":1},"type":"pane_info"}}
