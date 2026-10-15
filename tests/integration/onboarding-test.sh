#!/bin/bash
# Integration test: Fresh developer onboarding experience
# Measures time and verifies each step of the onboarding flow

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Timing utilities
start_time=$(date +%s)
step_start=0

start_step() {
    echo -e "\n${BLUE}▶ $1${NC}"
    step_start=$(date +%s)
}

end_step() {
    local step_end=$(date +%s)
    local duration=$((step_end - step_start))
    echo -e "${GREEN}✓ $1 (${duration}s)${NC}"
}

fail_step() {
    echo -e "${RED}✗ $1${NC}"
    exit 1
}

# Test starts here
echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Agent Orchestrator - Onboarding Integration Test     ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo ""

# Step 1: Simulate git clone (already done by Docker COPY, but we cd into it)
start_step "Step 1: Navigate to repository"
cd /workspace/agent-orchestrator || fail_step "Repository not found"
end_step "Step 1: Repository accessible"

# Step 2: Run setup script
start_step "Step 2: Running ./scripts/setup.sh"
if ! ./scripts/setup.sh; then
    fail_step "Step 2: Setup script failed"
fi
end_step "Step 2: Setup completed"

# Step 3: Verify ao command is available
start_step "Step 3: Verify ao command"
if ! command -v ao &> /dev/null; then
    fail_step "Step 3: ao command not found (npm link failed?)"
fi
ao --version || fail_step "Step 3: ao --version failed"
end_step "Step 3: ao command available"

# Step 4: Create minimal test config
start_step "Step 4: Create test configuration"
mkdir -p /tmp/ao-test-project
cd /tmp/ao-test-project
git init
git config user.email "test@example.com"
git config user.name "Test User"

cat > agent-orchestrator.yaml << 'EOF'
dataDir: /tmp/ao-test-data
worktreeDir: /tmp/ao-test-worktrees

projects:
  test-project:
    repo: test/repo
    path: /tmp/ao-test-project
    defaultBranch: main
EOF

end_step "Step 4: Configuration created"

# Step 5: Verify config is valid
start_step "Step 5: Validate configuration"
# ao init would fail if run again, so we just verify the file is readable
if [ ! -f agent-orchestrator.yaml ]; then
    fail_step "Step 5: Config file not found"
fi
end_step "Step 5: Configuration validated"

start_step "Step 6: Load configuration with ao"
ao start --no-orchestrator || fail_step "Step 6: ao start --no-orchestrator failed"
end_step "Step 6: Configuration loaded by ao"

# Calculate total time
end_time=$(date +%s)
total_duration=$((end_time - start_time))

# Summary
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           🎉 All Tests Passed!                         ║${NC}"
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo ""
echo -e "${BLUE}Total onboarding time: ${total_duration}s"
echo ""

# Export metrics for CI
if [ -n "$GITHUB_ACTIONS" ]; then
    echo "onboarding_time_seconds=$total_duration" >> "$GITHUB_OUTPUT"
fi

exit 0
