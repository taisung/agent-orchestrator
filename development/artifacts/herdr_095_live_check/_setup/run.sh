#!/usr/bin/bash
# Run a command in the scratch environment only (no AO_*, no TMUX, scratch HOME and XDG).
exec /usr/bin/env -i HOME=/tmp/aohd/home TMPDIR=/tmp/aohd/tmp PATH=/tmp/aohd/bin \
  XDG_CONFIG_HOME=/tmp/aohd/xdg/config XDG_STATE_HOME=/tmp/aohd/xdg/state \
  XDG_DATA_HOME=/tmp/aohd/xdg/data XDG_CACHE_HOME=/tmp/aohd/xdg/cache \
  XDG_RUNTIME_DIR=/tmp/aohd/xdg/runtime LANG=C.UTF-8 TERM=xterm-256color "$@"
