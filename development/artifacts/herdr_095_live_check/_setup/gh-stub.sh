#!/usr/bin/bash
# aohd gh stub: answers only --version and auth status.
case "$1 $2" in
  "--version "*) echo "gh version 0.0.0-aohd-stub";;
  "auth status") echo "aohd stub: logged in"; exit 0;;
  *) echo "aohd gh stub: refused: $*" >&2; exit 1;;
esac
