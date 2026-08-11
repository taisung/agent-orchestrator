#!/bin/bash
# try-pr.sh — switch the global 'ao' command to a PR worktree for manual testing
#
# Usage:
#   bash scripts/try-pr.sh <session-id> # Build and link a session worktree
#   bash scripts/try-pr.sh --restore    # Switch back to main

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

RESTORE_FILE="$HOME/.ao-try-pr-restore"
MAIN_REPO="$(cd "$(dirname "$0")/.." && pwd)"

# ── restore ────────────────────────────────────────────────────────────────────
if [ "$1" = "--restore" ]; then
  if [ ! -f "$RESTORE_FILE" ]; then
    echo -e "${RED}Nothing to restore — no active try-pr session found.${RESET}"
    exit 1
  fi
  AO_SHIM=$(which ao)
  # Restore original shim
  if [ -f "$RESTORE_FILE.shim" ]; then
    cp "$RESTORE_FILE.shim" "$AO_SHIM"
    chmod +x "$AO_SHIM"
    rm "$RESTORE_FILE.shim"
  fi
  rm "$RESTORE_FILE"
  echo -e "${GREEN}✔ Done. ao now points to main.${RESET}"
  exit 0
fi

# ── parse args ─────────────────────────────────────────────────────────────────
SESSION="${1:?Usage: bash scripts/try-pr.sh <session-id>}"

WORKTREES_DIR="${AO_WORKTREES_DIR:-$HOME/.worktrees/ao}"
WORKTREE="$WORKTREES_DIR/$SESSION"

if [ ! -d "$WORKTREE" ]; then
  echo -e "${RED}Worktree not found: $WORKTREE${RESET}"
  echo "Available sessions:"
  ls "$WORKTREES_DIR" 2>/dev/null | sed 's/^/  /' || echo "  (none)"
  exit 1
fi

BRANCH=$(git -C "$WORKTREE" branch --show-current 2>/dev/null || echo "unknown")

cd "$WORKTREE"

# ── build CLI/core/plugins ─────────────────────────────────────────────────────
echo -e "\n${BOLD}Building $SESSION${RESET} (branch: ${CYAN}$BRANCH${RESET})\n"

pnpm --filter @aoagents/ao-core \
     --filter @aoagents/ao-cli \
     --filter '@aoagents/ao-plugin-*' \
     build

# ── link ao ───────────────────────────────────────────────────────────────────
# Directly update the pnpm shim to point at the worktree's dist/index.js
AO_SHIM=$(which ao)
AO_TARGET="$WORKTREE/packages/cli/dist/index.js"

echo -e "\n${BOLD}Linking ao${RESET} → $AO_TARGET\n"

# Save the original shim so we can restore it
cp "$AO_SHIM" "$RESTORE_FILE.shim"
echo "$MAIN_REPO" > "$RESTORE_FILE"

# Rewrite the shim to point at the worktree
cat > "$AO_SHIM" <<EOF
#!/bin/sh
exec node "$AO_TARGET" "\$@"
EOF
chmod +x "$AO_SHIM"

echo -e "${GREEN}✔ ao now points to: ${BOLD}$SESSION${RESET}${GREEN} ($BRANCH)${RESET}"
echo ""
echo -e "  Test your changes, then restore with:"
echo -e "  ${CYAN}bash scripts/try-pr.sh --restore${RESET}"
echo ""
