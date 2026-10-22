command: /tmp/aohd/ao/ao send aohd-3 aohd\ scratch\ send\ while\ blocked
exit: 1
started: 2026-10-22T16:19:20,147944338-04:00
duration_ms: 813
stdout: ao_send_blocked.txt (0 bytes)
stderr:
  file://<home>/.worktrees/agent-orchestrator/ao-65/packages/core/dist/session-manager.js:3127
                  throw new Error(`Cannot send to session ${sessionId}: ${reason} (${detail})`, {
                        ^
  
  Error: Cannot send to session aohd-3: session needed to be restarted before delivery (Session aohd-3 cannot be restored: session is not in a terminal state)
      at restoreForDelivery (file://<home>/.worktrees/agent-orchestrator/ao-65/packages/core/dist/session-manager.js:3127:23)
      at async deliver (file://<home>/.worktrees/agent-orchestrator/ao-65/packages/core/dist/session-manager.js:3321:24)
      at async Object.send (file://<home>/.worktrees/agent-orchestrator/ao-65/packages/core/dist/session-manager.js:2982:24)
      at async Command.<anonymous> (file://<home>/.worktrees/agent-orchestrator/ao-65/packages/cli/dist/commands/send.js:273:13) {
    [cause]: SessionNotRestorableError: Session aohd-3 cannot be restored: session is not in a terminal state
        at restore (file://<home>/.worktrees/agent-orchestrator/ao-65/packages/core/dist/session-manager.js:3543:19)
        at async restoreForDelivery (file://<home>/.worktrees/agent-orchestrator/ao-65/packages/core/dist/session-manager.js:3121:34)
        at async deliver (file://<home>/.worktrees/agent-orchestrator/ao-65/packages/core/dist/session-manager.js:3321:24)
        at async Object.send (file://<home>/.worktrees/agent-orchestrator/ao-65/packages/core/dist/session-manager.js:2982:24)
        at async Command.<anonymous> (file://<home>/.worktrees/agent-orchestrator/ao-65/packages/cli/dist/commands/send.js:273:13) {
      sessionId: 'aohd-3',
      reason: 'session is not in a terminal state'
    }
  }
  
  Node.js v25.7.0
