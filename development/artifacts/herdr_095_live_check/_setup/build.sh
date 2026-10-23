#!/usr/bin/bash
# Offline install and build of the ao-65 worktree, in the scratch env (no lifecycle scripts: husky
# would write the shared git config). Every connect of pnpm and its children is traced.
set -o pipefail
cd <home>/.worktrees/agent-orchestrator/ao-65 || exit 1
echo "== install $(date +%T)"
strace -f -qq -e trace=connect -o /tmp/aohd/logs/strace-pnpm-install.txt \
  pnpm install --offline --frozen-lockfile --ignore-scripts \
  --store-dir <home>/.local/share/pnpm/store
echo "install exit=$? $(date +%T)"
echo "== build $(date +%T)"
strace -f -qq -e trace=connect -o /tmp/aohd/logs/strace-pnpm-build.txt \
  pnpm build
echo "build exit=$? $(date +%T)"
