#!/usr/bin/bash
# matrix CASE PANE WORKSPACE: run every herdr call of AO's code for one case, through the shim.
c=$1; p=$2; w=$3
cap=/tmp/aohd/cap
$cap ${c}_pane_get herdr pane get "$p"
$cap ${c}_pane_process_info herdr pane process-info --pane "$p"
$cap ${c}_pane_read_recent_unwrapped herdr pane read "$p" --source recent-unwrapped --lines 50
$cap ${c}_pane_read_visible herdr pane read "$p" --source visible --lines 50
$cap ${c}_agent_prompt herdr agent prompt "$p" "aohd matrix prompt $c"
$cap ${c}_pane_send_text herdr pane send-text "$p" "aohd matrix text $c"
$cap ${c}_pane_send_keys herdr pane send-keys "$p" Enter
$cap ${c}_pane_run herdr pane run "$p" bash /tmp/aohd/scripts/noop.sh
$cap ${c}_status_server herdr status server
$cap ${c}_status_server_json herdr status server --json
