# LiBrainian Hazard Register (Truth-First)

Status: authoritative
Scope: Known failure modes + preventive controls
Last Verified: 2026-02-02
Owner: librarianship
Evidence: docs only (implementation evidence lives in STATUS.md)

---

## Purpose
This register enumerates the critical ways LiBrainian can fail to meet its
truth-first, fail-safe contract. Each hazard includes preventive controls
and verification hooks. Any new feature must update this register.

## Hazard Format
- **ID**: unique identifier
- **Failure Mode**: what goes wrong
- **Impact**: user/system impact
- **Root Causes**: likely causes
- **Preventive Controls**: required controls
- **Verification Hooks**: tests/artifacts that prove control effectiveness
- **Status**: open | mitigated | verified

---

## Hazard Catalog

### HZ-001 Evidence Drift
- **Failure Mode**: Docs/STATUS/GATES claim success without artifacts.
- **Impact**: False confidence, unsafe agent behavior.
- **Root Causes**: Manual edits, stale metrics, missing evidence pipeline.
- **Preventive Controls**:
  - Evidence manifest is the single source of truth.
  - STATUS/GATES/validation are generated from manifest only.
- **Verification Hooks**: Manifest reconciliation tests; CI gate on manifest coverage.
- **Status**: open

### HZ-002 Metric Gaming / Overfitting
- **Failure Mode**: Metrics improve on dev corpus but regress on real repos.
- **Impact**: Overstated quality, real-world failures.
- **Root Causes**: Single corpus, no holdout set.
- **Preventive Controls**:
  - Separate dev vs holdout corpora.
  - Only holdout unlocks “pass”.
- **Verification Hooks**: Holdout eval artifacts in manifest.
- **Status**: open

### HZ-003 Synthetic Corpus Contamination
- **Failure Mode**: Evaluation uses synthetic or model-generated repos.
- **Impact**: Circular validation, invalid claims.
- **Root Causes**: Repo selection not enforced.
- **Preventive Controls**:
  - Real repo requirement with origin metadata checks.
  - Contamination risk score.
- **Verification Hooks**: eval-corpus manifest with repo metadata.
- **Status**: open

### HZ-004 Provider-Gated Claims Without Live Proof
- **Failure Mode**: LLM-dependent features claimed without live run evidence.
- **Impact**: False claims of semantic understanding.
- **Root Causes**: Offline runs or skipped provider tests.
- **Preventive Controls**:
  - Provider availability gate.
  - Fail closed when providers unavailable.
- **Verification Hooks**: Provider audit artifacts in manifest.
- **Status**: open

### HZ-005 Calibration Lies
- **Failure Mode**: Confidence values not tied to empirical accuracy.
- **Impact**: Overconfident outputs and unsafe decisions.
- **Root Causes**: No calibration curve on holdout data.
- **Preventive Controls**:
  - Calibration artifacts from holdout corpus.
  - Confidence output references calibration cohort.
- **Verification Hooks**: Calibration reports + ECE in manifest.
- **Status**: open

### HZ-006 Deterministic Core Bypassed
- **Failure Mode**: Listing/exhaustive tasks routed to semantic search.
- **Impact**: Missing results, false negatives.
- **Root Causes**: Query router defaults to semantic retrieval.
- **Preventive Controls**:
  - Deterministic routing rules for list/exhaustive intents.
- **Verification Hooks**: Routing tests with deterministic-only assertions.
- **Status**: open

### HZ-007 Sub-Agent Context Bleed
- **Failure Mode**: Agents modify overlapping scope or cross-contaminate decisions.
- **Impact**: Inconsistent changes, hidden regressions.
- **Root Causes**: No file-scope locking or work-unit isolation.
- **Preventive Controls**:
  - Explicit file allowlists per work unit.
  - Orchestrator-only integration.
- **Verification Hooks**: Work-unit lockfile, CI check for scope violations.
- **Status**: open

### HZ-008 Silent Fallback
- **Failure Mode**: Provider or index failure yields silent partial answers.
- **Impact**: Undetected gaps, false reliability.
- **Root Causes**: Missing disclosure enforcement.
- **Preventive Controls**:
  - Disclosure required in outputs for any fallback path.
- **Verification Hooks**: Negative tests for provider outage.
- **Status**: open

### HZ-009 Organizational/Cognitive Maps Unverifiable
- **Failure Mode**: Ownership/learning/decision graphs without evidence.
- **Impact**: Trust erosion, misguidance.
- **Root Causes**: No deterministic sources.
- **Preventive Controls**:
  - Evidence field required for each org/cognitive node.
- **Verification Hooks**: Schema validation + oracle checks.
- **Status**: open

### HZ-010 Performance Measurement Mis-specified
- **Failure Mode**: Memory/latency targets measured on test harness.
- **Impact**: False performance claims.
- **Root Causes**: Mixed metrics and lack of isolation.
- **Preventive Controls**:
  - Dedicated perf benchmark with clear definitions.
- **Verification Hooks**: Perf report artifact.
- **Status**: open

---

## Change Policy
Any feature work must:
1) identify affected hazards,
2) update controls and verification hooks,
3) produce evidence artifacts for mitigations.
