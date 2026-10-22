#!/usr/bin/bash
# Run the built ao entry in the scratch env with the scratch config.
exec /tmp/aohd/run AO_CONFIG_PATH=/tmp/aohd/ao/agent-orchestrator.yaml SHELL=/tmp/aohd/bin/bash \
  node <home>/.worktrees/agent-orchestrator/ao-65/packages/cli/dist/index.js "$@"
