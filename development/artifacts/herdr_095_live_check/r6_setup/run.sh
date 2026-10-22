#!/usr/bin/bash
# Run a command in the aohd3 scratch environment only (no AO_*, no TMUX, no HERDR_*, scratch HOME and XDG).
exec /usr/bin/env -i HOME=/tmp/aohd3/home TMPDIR=/tmp/aohd3/tmp PATH=/tmp/aohd3/bin \
  XDG_CONFIG_HOME=/tmp/aohd3/xdg/config XDG_STATE_HOME=/tmp/aohd3/xdg/state \
  XDG_DATA_HOME=/tmp/aohd3/xdg/data XDG_CACHE_HOME=/tmp/aohd3/xdg/cache \
  XDG_RUNTIME_DIR=/tmp/aohd3/xdg/runtime GIT_CONFIG_NOSYSTEM=1 LANG=C.UTF-8 TERM=xterm-256color "$@"
