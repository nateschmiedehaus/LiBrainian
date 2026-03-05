# Milestone Brief (M0 -> M4)

Last updated: 2026-03-05

## Backlog Snapshot

Generated from live GitHub issue ledger on 2026-03-05.

- Total open issues: 353
- M0: 30 total (20 executable, 15 execution-ready)
- M1: 51 total (7 executable, 7 execution-ready)
- M2: 58 total (7 executable, 6 execution-ready)
- M3: 56 total (2 executable, 2 execution-ready)
- M4: 158 total (2 executable, 2 execution-ready)

## Execution Policy

Execution truth comes from generated ledger artifacts under `state/portfolio/` and `state/milestones/`. This brief is a synced summary, not the primary execution source.

Milestone counts distinguish:

- `total`: every open issue assigned to the milestone
- `executable`: source issues that count toward milestone completion
- `execution-ready`: executable issues that are ready for a worker now

Milestone completion is based on `executable`, not raw `total`.

1. Active implementation order is strict: `M0 -> M1`.
2. `M2/M3/M4` remain frozen until explicit go/no-go approval after M1.
3. No cross-milestone parallelization.

## M0: Dogfood-Ready

Open issues (2026-03-05): 30 total / 20 executable / 15 execution-ready

### Product Contract

At M0 completion, LiBrainian is a real repo-understanding tool for agents:

- reliable `query` / `./ask` on real repositories
- truthful `status` and `doctor`
- agent-usable MCP discovery and tool selection
- bounded, actionable failure behavior instead of opaque breakage
- evidence based on real external repos, not circular evaluation

### Exact M0 executable source set

- Retrieval/query correctness: `#906 #908 #910 #912`
- Runtime/provider reliability: `#905 #907 #909 #911`
- Freshness and graceful degradation: `#888 #889`
- Agent adoption surface: `#872 #913 #914 #915 #916 #917 #918 #919 #920`
- Proof/evidence legitimacy: `#716`

Tracking-only M0 parent issues:

- `#850 #852 #883`

Excluded from M0 completion:

- `#458`

### Product Bundles

- Bundle B — daily-use reliability and truthful health:
  `#905 #907 #909 #911 #889`
- Bundle A — daily-use retrieval correctness:
  `#906 #908 #910 #912`
- Bundle C — freshness and real-repo trust:
  `#888 #716`
- Bundle D — agent adoption surface:
  `#872 #913 #914 #915 #916 #917 #918 #919 #920`

### Stop conditions before M1

- All executable M0 source issues closed with evidence.
- Required quality-sensitive issues include `issue-quality-analysis` artifacts.
- `query`/`./ask` is useful on real repos.
- `status` and `doctor` are truthful and non-contradictory.
- MCP discovery/default tool choice is good enough for real agent sessions.
- Evidence uses real external repos rather than circular eval artifacts.
- `npx tsc --noEmit` + relevant tests green.

## M1: Construction MVP

Open issues (2026-03-05): 51 total / 7 executable / 7 execution-ready

Focus:

- Construction runtime integrity (truthfulness, executability, error clarity)
- Query decomposition and maintainability debt (for example `query.ts` split)
- Patrol process reliability and evidence hygiene
- M1 preparation must compress the board into executable source issues before activation

Estimated waves: 6-8

Stop conditions before M2:

- Construction smoke/reality signals are meaningful (no structural-noise gate failures).
- Open M1 ship-blocking issues closed.
- Patrol evidence supports claim-vs-reality consistency.
- Explicit go/no-go decision logged.

## M2: Agent Integration (Frozen)

Open issues (2026-03-05): 58 total / 7 executable / 6 execution-ready

Focus once unfrozen:

- Adapter/harness integration
- External retriever interfaces
- Durable stress/chaos harnesses
- Milestone must be compressed into executable source issues before activation

Estimated waves: 6-7

Stop conditions before M3:

- Integration reliability under CI and local runs.
- No unresolved critical agent-integration regressions.
- Explicit go/no-go decision logged.

## M3: Scale & Epistemics (Frozen)

Open issues (2026-03-05): 56 total / 2 executable / 2 execution-ready

Focus once unfrozen:

- Benchmarking, comparative evaluation, and governance telemetry
- Epistemic calibration and operational quality reporting
- Milestone must be compressed into executable source issues before activation

Estimated waves: 5-6

Stop conditions before M4:

- Benchmark pipeline stability and repeatability.
- No unresolved critical correctness regressions.
- Explicit go/no-go decision logged.

## M4: World-Class (Frozen)

Open issues (2026-03-05): 158 total / 2 executable / 2 execution-ready

Focus once unfrozen:

- Advanced research tracks and long-horizon capability work.
- Milestone must be compressed into executable source issues before activation

Required preprocessing before implementation:

- Triage compression into implement-now vs defer/archive buckets.
- Dependency clustering to avoid low-signal churn.

Estimated waves: 12+ after compression.
