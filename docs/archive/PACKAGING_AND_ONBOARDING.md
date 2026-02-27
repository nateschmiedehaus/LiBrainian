# LiBrainian Packaging + Onboarding Guide

Status: partial
Scope: packaging, injection, and onboarding for any repo or agentic system.
Last Verified: 2026-01-04
Owner: librarianship
Evidence: plan only (implementation evidence lives in STATUS.md)

## Purpose
Define how LiBrainian is packaged, injected, and operated in any repository
with minimal friction and maximum portability.

## Packaging Principles
- Zero hard-coded repo assumptions.
- Minimal footprint and clean uninstall.
- Clear CLI entrypoints and configuration.
- Consistent audit and evidence artifacts.
- Documentation quality aligned with top OSS practices.

## Distribution Model
- Primary: npm package with CLI entrypoint `LiBrainian`.
- Secondary: source-embedded module under `src/LiBrainian` for monorepos.
- Optional: standalone binary wrapper for environments without Node tooling.

## Open-Source Packaging Standard
- Semantic versioning with changelog and migration notes.
- Minimal install surface and clear uninstall path.
- License, code of conduct, contribution guide, and security policy.
- Examples folder with real-world bootstrap and query runs.
- Compatibility matrix (Node versions, OSes, repo sizes).

## Extension and Plugin Surface
- Adapter plugins (new languages/frameworks).
- Knowledge modules (new domain maps).
- Query intents (new reasoning modes and response schemas).
- Method pack plugins (new problem-solving methods and templates).
- Provider adapters (LLM/embedding backends).

## Injection Modes
- Local workspace mode: adds `.LiBrainian/` state and SQLite DB in repo root.
- External workspace mode: stores state under a specified workspace path.
- Read-only mode: queries only; no indexing or bootstrap (provider gate still required).

## Repository Injection Checklist
1) `LiBrainian quickstart` runs auto-heal + bootstrap + baseline (preferred).
2) `LiBrainian check-providers` verifies CLI auth if quickstart ran degraded.
3) `LiBrainian status` confirms readiness and evidence links.
4) Add `docs/LiBrainian/` as the canonical knowledge docs.

## Required Files and Directories
- `.LiBrainian/` (state, sqlite, governor config, audit artifacts).
- `docs/LiBrainian/` (canonical docs for operation and governance).
- `state/audits/` (audits only; no runtime state elsewhere).

## Configuration
- `./.LiBrainian/governor.json` controls budgets and concurrency.
- `LIBRARIAN_LLM_PROVIDER` and `LIBRARIAN_LLM_MODEL` may be set by policy.
- Daily model selection writes `state/audits/model_selection/`.
- Configuration is explicit; no hidden defaults or implicit fallbacks.
- Provide a `LiBrainian config` CLI to print the effective config.

## CLI Surface (Required)
- `LiBrainian quickstart`: end-to-end onboarding recovery (fast by default).
- `LiBrainian bootstrap --scope <path>`: full index + knowledge generation.
- `LiBrainian status`: shows readiness, version, stats.
- `LiBrainian query --intent <text> --depth <L0|L1|L2>`: get context packs.
- `LiBrainian check-providers`: provider readiness gate.
- `LiBrainian validate`: run Tier-0 deterministic checks.
- `LiBrainian coverage --strict`: UC x method x scenario coverage audit.
- `LiBrainian smoke`: external repo smoke harness for agent-style validation.
- `LiBrainian journey`: agentic journey simulation across real repos.

## Onboarding Flow (Any Repo)
1) Run `LiBrainian quickstart` (fast) or `LiBrainian quickstart --mode full` (full).
2) Verify providers via CLI authentication if degraded.
3) Validate with Tier-0 and Tier-2 gates.
4) Run `LiBrainian journey` to simulate agent usage on real repos.
5) Use `LiBrainian query` via agent workflows.

## Agentic System Integration
- Expose ContextPackRequest and ContextPackBundle contracts.
- Add pre-task, mid-task, post-task hooks in the orchestrator.
- Store WorkflowRunRecords for audits and regression tracking.

## OSS-Grade Documentation Contract
- Installation and first-run steps are runnable verbatim.
- Each CLI command has a minimal example and expected output.
- Failure modes and recovery are documented.
- Evidence artifacts are explained and easy to inspect.

## Uninstall and Cleanup
- Remove `.LiBrainian/` directory.
- Remove `state/audits/LiBrainian/` if no longer required.
- No other repo files should be touched by default.

## Documentation Standards
- Concise, evidence-backed claims only.
- Clear install/run/verify flow.
- No aspirational claims without evidence.

---

## Onboarding Measurement Baseline

Every onboarding run must establish a measurement baseline for future comparison.

### Required Baseline Metrics

| Metric | Measurement | Target |
|--------|-------------|--------|
| Bootstrap duration | Time from init to ready | < 5 min for 10k files |
| Entity coverage | Indexed / total | ≥ 90% |
| Confidence mean | Average confidence | ≥ 0.6 |
| Defeater count | Active defeaters | ≤ 10 |
| Provider latency | P50 query time | < 500ms |

### Baseline Capture

```bash
# Capture baseline during onboarding
LiBrainian bootstrap --scope . --emit-baseline

# Or run quickstart (baseline enabled by default)
LiBrainian quickstart

# Output: state/audits/LiBrainian/baselines/YYYY-MM-DD-HH-MM.json
```

### Baseline Schema

```typescript
interface OnboardingBaseline {
  kind: 'OnboardingBaseline.v1';
  schemaVersion: 1;

  // Identity
  workspacePath: string;
  capturedAt: string;         // ISO 8601

  // Environment
  environment: {
    nodeVersion: string;
    platform: string;
    providerAvailable: boolean;
    modelId: string;
  };

  // Metrics
  metrics: {
    bootstrapDurationMs: number;
    entityCoverage: number;
    confidenceMean: number;
    defeaterCount: number;
    providerLatencyP50Ms: number;
  };

  // Entity Counts
  entities: {
    files: number;
    functions: number;
    classes: number;
    modules: number;
  };

  // Quality
  quality: {
    orphanEntities: number;
    lowConfidenceEntities: number;
    missingOwnership: number;
  };
}
```

---

## Evidence Artifact Inventory

All onboarding and operation runs must produce these artifacts:

### Required Artifacts

| Artifact | Location | Schema |
|----------|----------|--------|
| Bootstrap report | `state/audits/LiBrainian/bootstrap/` | `BootstrapReport.v1` |
| Model selection | `state/audits/model_selection/` | `ModelSelectionRecord.v1` |
| Provider checks | `state/audits/providers/` | `ProviderCheckRecord.v1` |
| Baseline metrics | `state/audits/LiBrainian/baselines/` | `OnboardingBaseline.v1` |
| Gap report | `state/audits/LiBrainian/gaps/` | `GapReport.v1` |

### Conditional Artifacts

| Artifact | Condition | Schema |
|----------|-----------|--------|
| Retrieval quality | After query corpus run | `RetrievalQualityReport.v1` |
| Calibration | After golden set evaluation | `CalibrationReport.v1` |
| Performance | After load test | `PerformanceReport.v1` |
| Escalation ROI | After escalation events | `EscalationROIRecord.v1` |

### Artifact Retention

| Artifact Type | Retention | Reason |
|---------------|-----------|--------|
| Bootstrap | 30 days | Debugging |
| Model selection | 90 days | Compliance |
| Provider checks | 7 days | Debugging |
| Baselines | Indefinite | Trend analysis |
| Gap reports | Until resolved | Tracking |

### Artifact Verification

```bash
# Verify artifact completeness
LiBrainian audit --check-artifacts

# Expected output:
# BootstrapReport.v1: OK (2026-01-08)
# ModelSelectionRecord.v1: OK (2026-01-08)
# ProviderCheckRecord.v1: OK (2026-01-08)
# OnboardingBaseline.v1: OK (2026-01-08)
# GapReport.v1: OK (2026-01-08)
```
