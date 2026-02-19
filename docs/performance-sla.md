# Performance SLA

This document defines LiBrainian performance budgets and enforcement behavior.

## Query Latency

- P50: `< 500ms`
- P95: `< 2000ms`
- P99: `< 5000ms`
- First query (cold start): `< 10s`

Rationale: MCP tool responses above ~5 seconds degrade agent interaction quality and reliability.

## Indexing Throughput

- Small codebase (`< 1k files`): full index `< 30s`
- Medium codebase (`1k-10k files`): full index `< 5m`
- Large codebase (`10k-100k files`): full index `< 30m`
- Incremental reindex (`10 changed files`): `< 10s`

## Memory Budget

- Peak indexing memory (RSS): `< 2GB` on medium-scale workloads
- Runtime serving memory (RSS): `< 512MB`

## Runtime Diagnostics

Use the CLI benchmark command to generate a machine-readable report:

```bash
librarian benchmark --json --out state/eval/performance/PerformanceSLAReport.v1.json
librarian benchmark --json --out state/eval/performance/PerformanceSLAReport.v1.json --fail-on block
```

Report artifact:
- `PerformanceSLAReport.v1`
- includes measurements, thresholds, and pass/alert/block assessments.

## CI Enforcement Policy

The deterministic benchmark gate runs in CI on non-PR lanes (`push`, `workflow_dispatch`) to avoid noisy PR variance while still enforcing merge-ready budgets.

Threshold policy:
- `pass`: metric is within budget
- `alert`: metric exceeds budget by >20% (reported, non-blocking)
- `block`: metric exceeds budget by >100% (>2x target), merge-blocking

CI gate command:

```bash
npx librainian benchmark --queries 4 --incremental-files 5 --json --out state/eval/performance/PerformanceSLAReport.v1.json --fail-on block
```

CI job configuration uses `--fail-on block`, so only `block` status fails the job.
