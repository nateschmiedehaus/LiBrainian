# Milestone Brief (M0 -> M4)

Last updated: 2026-03-01

## Backlog Snapshot

- Total open issues: 337
- M0: 9
- M1: 55
- M2: 59
- M3: 56
- M4: 158

## Execution Policy

1. Active implementation order is strict: `M0 -> M1`.
2. `M2/M3/M4` remain frozen until explicit go/no-go approval after M1.
3. No cross-milestone parallelization.

## M0: Dogfood-Ready

Open issues (2026-03-01): 9

Priority queue (dependency-aware):

1. `#666` API surface hallucination prevention
2. `#716` Replace invalid eval corpus with real external repos
3. `#809` Self-understanding retrieval pathology
4. `#701` `security.riskScore` + parse-failure behavior
5. `#699` tribal knowledge extraction quality
6. `#872` MCP usage enforcement for non-trivial tasks
7. `#883` MCP tool-surface reduction and steering
8. `#887` query latency envelope
9. `#895` orchestration contract + milestone governance completion

Dependency map:

- `#666` and `#716` are upstream quality preconditions for `#809`.
- `#809` should stabilize retrieval behavior before tuning higher-level extraction quality (`#701`, `#699`).
- `#872/#883/#887` should run after core retrieval/corpus correctness to avoid optimizing broken behavior.

Estimated waves:

- Wave 1: `#666`, `#716`
- Wave 2: `#809`
- Wave 3: `#701`, `#699`
- Wave 4: `#872`, `#883`, `#887`, `#895`

Stop conditions before M1:

- All M0 issues closed with evidence.
- Required quality-sensitive issues include `issue-quality-analysis` artifacts.
- No unresolved ship-blocking labels in M0.
- `npx tsc --noEmit` + relevant tests green.
- Explicit go/no-go decision logged.

## M1: Construction MVP

Open issues (2026-03-01): 55

Focus:

- Construction runtime integrity (truthfulness, executability, error clarity)
- Query decomposition and maintainability debt (for example `query.ts` split)
- Patrol process reliability and evidence hygiene

Estimated waves: 6-8

Stop conditions before M2:

- Construction smoke/reality signals are meaningful (no structural-noise gate failures).
- Open M1 ship-blocking issues closed.
- Patrol evidence supports claim-vs-reality consistency.
- Explicit go/no-go decision logged.

## M2: Agent Integration (Frozen)

Open issues (2026-03-01): 59

Focus once unfrozen:

- Adapter/harness integration
- External retriever interfaces
- Durable stress/chaos harnesses

Estimated waves: 6-7

Stop conditions before M3:

- Integration reliability under CI and local runs.
- No unresolved critical agent-integration regressions.
- Explicit go/no-go decision logged.

## M3: Scale & Epistemics (Frozen)

Open issues (2026-03-01): 56

Focus once unfrozen:

- Benchmarking, comparative evaluation, and governance telemetry
- Epistemic calibration and operational quality reporting

Estimated waves: 5-6

Stop conditions before M4:

- Benchmark pipeline stability and repeatability.
- No unresolved critical correctness regressions.
- Explicit go/no-go decision logged.

## M4: World-Class (Frozen)

Open issues (2026-03-01): 158

Focus once unfrozen:

- Advanced research tracks and long-horizon capability work.

Required preprocessing before implementation:

- Triage compression into implement-now vs defer/archive buckets.
- Dependency clustering to avoid low-signal churn.

Estimated waves: 12+ after compression.

