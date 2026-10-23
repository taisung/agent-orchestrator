command: HERDR_SOCKET_PATH=/tmp/aohd2/fake/b_ping_protocol_19.sock herdr pane get w1:p1
exit: 1
started: 2026-10-22T18:03:58.069914-04:00
duration_ms: 18
stdout: r5_b_ping_protocol_19.txt (0 bytes)
stderr:
  {"id":"cli:pane:get","error":{"code":"protocol_mismatch","message":"client protocol 22 is newer than server protocol 19; restart the Herdr server before using this command. Stop the old server to use the new version.\nStopping exits pane processes.\nRun `HERDR_SOCKET_PATH=/tmp/aohd2/fake/b_ping_protocol_19.sock herdr server stop`, then restart Herdr with the same socket override."}}
