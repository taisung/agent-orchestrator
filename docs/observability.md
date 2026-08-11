# Observability Signals

This document describes runtime observability emitted by Agent Orchestrator.

## Goals

- Structured, low-noise telemetry for session lifecycle and operator workflows.
- Correlated traces across core services, lifecycle workers, and runtime operations.
- Clear failure reasons and current health surfaces for fast diagnosis.

## Emission Model

- **Structured logs**: JSON lines on stderr, controlled by `AO_LOG_LEVEL`.
  - Supported levels: `debug`, `info`, `warn`, `error`.
  - Default level: `warn` (production-safe, avoids high-volume info logs).
- **Durable snapshots**: process-local JSON snapshots under:
  - `~/.agent-orchestrator/{config-hash}-observability/processes/*.json`
- **Inspection**: use structured stderr logs and the durable per-process snapshots for detailed diagnosis.

## Correlation

- Core operations generate or propagate a `correlationId` through structured logs, metrics, and health records.

## Metrics

Counters are emitted per project and operation:

- `spawn` (`session.spawn`)
- `restore` (`session.restore`)
- `kill` (`session.kill`)
- `claim_pr` (`session.claim_pr`)
- `cleanup` (`session.cleanup`)
- `send` (`session.send`)
- `lifecycle_poll` (`lifecycle.poll`, `lifecycle.transition`)
- `api_request` (web API routes)
- `sse_connect`, `sse_snapshot`, `sse_disconnect`
- `websocket_connect`, `websocket_disconnect`, `websocket_error` (websocket servers)

Each metric counter tracks:

- `total`, `success`, `failure`
- `lastAt`, `lastSuccessAt`, `lastFailureAt`
- `lastFailureReason`

## Trace Fields

Recent traces keep operation-level diagnostics:

- `id`
- `timestamp`
- `component`
- `operation`
- `outcome`
- `correlationId`
- `projectId`
- `sessionId`
- `path`
- `reason`
- `durationMs`
- `data`

## Health Surfaces

Health records provide current status and failure context per surface:

- `surface` (for example: `lifecycle.worker`, `session.manager`)
- `status` (`ok`, `warn`, `error`)
- `updatedAt`
- `component`
- `projectId`
- `correlationId`
- `reason`
- `details`

## Operator-Facing Diagnostics

- **CLI**: `ao doctor`, `ao status`, and `ao status --watch` provide the supported operator views.
- **Logs**: structured stderr records include component, operation, outcome, correlation id, and failure reason.
- **Snapshots**: per-process JSON files preserve recent metrics, health, and trace records for offline inspection.

## Rollout Notes

1. Deploy with default `AO_LOG_LEVEL=warn` to avoid noisy logs.
2. Validate `ao doctor`, `ao status`, and the process snapshots in a canary environment.
3. If deeper triage is needed, temporarily raise `AO_LOG_LEVEL=info` (or `debug`), then revert to `warn`.
4. Monitor `lastFailureReason` and surface-level `reason` fields before enabling broader rollout.
