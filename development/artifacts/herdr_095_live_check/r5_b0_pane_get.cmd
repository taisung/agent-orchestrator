command: HERDR_SOCKET_PATH=/tmp/aohd2/fake/b0.sock herdr pane get w1:p1
exit: 1
started: 2026-10-22T18:02:22.019274-04:00
duration_ms: 19
stdout: r5_b0_pane_get.txt (0 bytes)
stderr:
  Error: Custom { kind: Other, error: ErrorResponse(ErrorResponse { id: "api-client:status", error: ErrorBody { code: "pane_not_found", message: "fake: pane not found" } }) }
