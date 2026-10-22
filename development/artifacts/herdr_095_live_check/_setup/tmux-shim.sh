#!/usr/bin/bash
# aohd tmux shim: every tmux call of the code goes to the private server -L aohd-ao.
printf '%s pid=%s ppid=%s args:' "$(date +%T.%N)" "$$" "$PPID" >> /tmp/aohd/logs/tmux-shim.log
printf ' %q' "$@" >> /tmp/aohd/logs/tmux-shim.log; printf '\n' >> /tmp/aohd/logs/tmux-shim.log
exec /usr/bin/env -u TMUX /usr/bin/tmux -L aohd-ao "$@"
