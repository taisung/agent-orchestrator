#!/usr/bin/bash
# aohd stand-in for Claude Code: no model, no network. It draws the screen forms of herdr's
# claude manifest (2026.10.11.1): the OSC title "✳ " (idle) or a braille spinner (working),
# a prompt box with "❯", and a "✻ …" working line. Each line it reads is logged with a
# timestamp as delivery evidence. AOHD_BOOT_SECS: seconds of boot, during which typed input
# is discarded (as a real claude does at its splash). AOHD_WORK_SECS: seconds per turn.
boot=${AOHD_BOOT_SECS:-0}; work=${AOHD_WORK_SECS:-$(cat /tmp/aohd/standin.work 2>/dev/null || echo 3)}
log=/tmp/aohd/logs/claude-standin.$$.log
echo "$(date +%s.%N) start pid=$$ args=$* boot=$boot work=$work" >> "$log"
rule() { printf '%*s\n' 70 '' | sed 's/ /─/g'; }
idle() {
  printf '\033]0;✳ Claude Code\007'
  rule; printf '❯ \n'; rule; printf '  ? for shortcuts\n'
}
printf '\033]0;⠋ Claude Code\007'
printf ' ✻ Welcome to Claude Code (aohd stand-in)\n\n'
if [ "$boot" != 0 ]; then
  sleep "$boot"
  # discard what was typed during boot
  while IFS= read -r -t 0.05 dropped; do echo "$(date +%s.%N) dropped-at-boot: $dropped" >> "$log"; done
fi
echo "$(date +%s.%N) ready" >> "$log"
idle
# /tmp/aohd/standin.drop: seconds after the prompt box is drawn in which typed input is
# discarded (a cold agent that shows its box before it reads input, doc 0004 section 5).
drop=$(cat /tmp/aohd/standin.drop 2>/dev/null || echo 0)
if [ "$drop" != 0 ]; then
  end=$(( $(date +%s) + drop ))
  while [ "$(date +%s)" -lt "$end" ]; do
    if IFS= read -r -t 1 x; then echo "$(date +%s.%N) dropped-cold: ${#x} chars" >> "$log"; fi
  done
  echo "$(date +%s.%N) accepting input" >> "$log"
fi
while IFS= read -r line; do
  # one message: the first line plus every line that follows within 0.3 s (a paste)
  n=1; while IFS= read -r -t 0.3 more; do line+=$'\n'"$more"; n=$((n+1)); done
  echo "$(date +%s.%N) received: lines=$n chars=${#line} first=$(printf '%s' "$line" | head -1 | od -An -c | tr -s ' ' | head -c 160)" >> "$log"
  # a message that starts with AOHD_BLOCK draws a Bash permission prompt (herdr: blocked);
  # the next message answers it
  if [ -n "$blocked" ]; then
    blocked=; echo "$(date +%s.%N) permission answered" >> "$log"
    printf '\033[2J\033[H● permission answered\n\n'; idle; continue
  fi
  if [[ "$line" == AOHD_BLOCK* ]]; then
    blocked=1; echo "$(date +%s.%N) permission prompt shown" >> "$log"
    printf '\033[2J\033[H● Bash(rm -f /tmp/aohd/nothing)\n\n'
    rule; printf ' Bash command\n\n   rm -f /tmp/aohd/nothing\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel\n'
    continue
  fi
  printf '\033]0;⠋ Claude Code\007'
  printf '\n> %s\n\n✻ Thinking… (1s · esc to interrupt)\n' "$line"
  sleep "$(cat /tmp/aohd/standin.work 2>/dev/null || echo "$work")"
  printf "\033[2J\033[H● aohd stand-in received %d characters\n\n" "${#line}"
  echo "$(date +%s.%N) turn-done" >> "$log"
  idle
done
echo "$(date +%s.%N) stdin closed" >> "$log"
