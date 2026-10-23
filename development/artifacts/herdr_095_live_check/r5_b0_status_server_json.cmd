command: HERDR_SOCKET_PATH=/tmp/aohd2/fake/b0.sock herdr status server --json
exit: 1
started: 2026-10-22T18:02:22.096393-04:00
duration_ms: 17
stdout: r5_b0_status_server_json.txt (0 bytes)
stderr:
  Error: Custom { kind: Other, error: ErrorResponse(ErrorResponse { id: "api-client:status", error: ErrorBody { code: "pane_not_found", message: "fake: pane not found" } }) }
