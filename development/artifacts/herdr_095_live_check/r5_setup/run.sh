#!/usr/bin/bash
# Run a command in the aohd2 scratch environment only (no AO_*, no TMUX, no HERDR_*, scratch HOME and XDG).
exec /usr/bin/env -i HOME=/tmp/aohd2/home TMPDIR=/tmp/aohd2/tmp PATH=/tmp/aohd2/bin \
  XDG_CONFIG_HOME=/tmp/aohd2/xdg/config XDG_STATE_HOME=/tmp/aohd2/xdg/state \
  XDG_DATA_HOME=/tmp/aohd2/xdg/data XDG_CACHE_HOME=/tmp/aohd2/xdg/cache \
  XDG_RUNTIME_DIR=/tmp/aohd2/xdg/runtime LANG=C.UTF-8 TERM=xterm-256color "$@"
