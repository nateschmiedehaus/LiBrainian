# Implementation Status & Known Issues

> **Purpose**: Map prior implementation attempts to the LiBrainian story chapters, showing what exists, what's broken, and what specs must address.
> **Source**: THEORETICAL_CRITIQUE.md work logs, hole registry, and problem tracking
> **Updated**: 2026-02-17

---

## ⚠️ CURRENT STATUS: VALIDATION PENDING unverified (evidence_manifest_missing)

unverified (evidence_manifest_missing): **Infrastructure (Phases 0-11)**: ✅ COMPLETE
- unverified (evidence_manifest_missing): ~3,500+ unit tests passing
- unverified (evidence_manifest_missing): All core components implemented
- unverified (evidence_manifest_missing): Scientific Loop agents built
- unverified (evidence_manifest_missing): Quality Parity components built
- unverified (evidence_manifest_missing): 7 real external repos cloned

unverified (evidence_manifest_missing): **Validation (Phases 12-22)**: ⏳ NOT STARTED
- unverified (evidence_manifest_missing): 57 work units pending
- unverified (evidence_manifest_missing): Key metrics NOT measured (Recall@5, Hallucination Rate, ECE, A/B Lift)
- unverified (evidence_manifest_missing): See `docs/librarian/WORKPLAN.md` for full validation plan

unverified (evidence_manifest_missing): ---

## How This Document Relates to the LiBrainian Story

Each chapter of the LiBrainian story (from AGENT_INSTRUCTIONS.md) has implementation artifacts. This document tracks:
- **What Codex built** (prior implementation attempts)
- **What works** (verified, can rely on)
- **What's broken** (exists but doesn't work correctly)
- **What's missing** (not implemented yet)
- **Which spec covers the fix**

---

## Chapter 1: The Problem (Understanding Why)

**Story**: Agents need to *understand* code, not just search it.

**Implementation Status**: ✅ Well-documented in THEORETICAL_CRITIQUE.md Parts I-IV

No code issues - this is foundational theory.

---

## Chapter 2: The Foundation (Layer 2 Infrastructure)

**Story**: We build infrastructure that captures evidence and negotiates capabilities.

### 2.1 LLM Adapter (P0)

| Aspect | Status | Details |
|--------|--------|---------|
| **Provider Discovery** | ✅ Implemented | `llm_provider_discovery.ts` exists |
| **Provider Registry** | ✅ Implemented | Registration pattern works |
| **CLI Probes** | ✅ Implemented | Claude, Codex probes exist |
| **Local Probes** | ✅ Implemented | Ollama, LM Studio probes exist |

**Known Issues**:
| Issue | Severity | File | Problem |
|-------|----------|------|---------|
| Provider bypass | RESOLVED | `utils/llm_service.ts` | Fixed 2026-01-24: legacy singleton no longer auto-constructs; LLM usage must go through adapters |
| Non-uniform gating | MEDIUM | Various | Some call sites bypass `checkAllProviders()` |

**Spec**: `track-a-core-pipeline.md` Section P0

### 2.2 Evidence Ledger

| Aspect | Status | Details |
|--------|--------|---------|
| **MCP Audit Log** | ✅ Partial | `mcp/audit.ts` exists |
| **Episodes** | ✅ Partial | `episodes_state.ts` records episodes |
| **Query Stages** | ✅ Partial | `query.ts` logs stages |
| **Unified Ledger** | ⚠️ Partial | `epistemics/evidence_ledger.ts` exists; MCP server tool calls and provider gate now emit `tool_call` evidence, but wiring across query/episodes/technique execution is incomplete |
| **Deterministic Replay** | ❌ Missing | Cannot replay runs |

**Known Issues**:
| Issue | Severity | Problem |
|-------|----------|---------|
| Fragmented logging | HIGH | Three separate logs (MCP, episodes, query) don't connect |
| No stable IDs | HIGH | Entries lack IDs for cross-referencing |
| No replay | MEDIUM | Can't reproduce runs for debugging |

**Spec**: `layer2-infrastructure.md` Section "Evidence Ledger"

### 2.3 Capability Negotiation

| Aspect | Status | Details |
|--------|--------|---------|
| **Capability Types** | ✅ Defined | In specs |
| **Runtime Negotiation** | ⚠️ Partial | `api/capability_contracts.ts` exists; wiring into operations and reporting is incomplete |
| **Degradation Disclosure** | ⚠️ Partial | `degradedMode` can be computed; systematic surfacing in user-facing outputs is incomplete |

**Spec**: `layer2-infrastructure.md` Section "Capability Negotiation"

### 2.4 Tool/MCP Adapter

| Aspect | Status | Details |
|--------|--------|---------|
| **Basic Integration** | ✅ Implemented | MCP works |
| **Rate Limiting** | ❌ Missing | Problem 39 |
| **Response Versioning** | ❌ Missing | Problem 42 |
| **Audit Persistence** | ⚠️ Partial | Audit logger exists and can persist to disk; full retention/versioning semantics still incomplete |

**Spec**: `layer2-infrastructure.md` Section "Tool/MCP Adapter"

---

## Chapter 3: The Pipeline (Track A: P0-P7)

**Story**: Composition-based retrieval that produces knowledge claims, not search results.

### P1: Operator Execution

| Aspect | Status | Details |
|--------|--------|---------|
| **TechniqueExecutionEngine** | ✅ Exists | `technique_execution.ts` |
| **Operator Registry** | ✅ Exists | `operator_registry.ts` |
| **Operator Interpreters** | ⚠️ Partial | `operator_interpreters.ts` - many are no-ops |
| **End-to-End Verification** | ❌ Missing | Critical Problem A |

**Known Issues**:
| Issue | Severity | File | Problem |
|-------|----------|------|---------|
| No-op operators | CRITICAL | `operator_interpreters.ts` | Many operators implemented as explicit no-ops |
| Evidence emission is opt-in | HIGH | `technique_execution.ts` | Execution emits `tool_call` evidence when an `IEvidenceLedger` is provided via `ExecutionContext` (primitive runs + operator events). Query pipeline wiring remains incomplete. |
| No verified traces | HIGH | - | Can't prove executions are complete |

**Spec**: `track-a-core-pipeline.md` Section P1 + `critical-usability.md` Critical A

### P2: Semantic Composition Selector

| Aspect | Status | Details |
|--------|--------|---------|
| **Selector Function** | ✅ Exists | `composition_selector.ts` |
| **Keyword Matching** | ✅ Works | Basic matching implemented |
| **Semantic Matching** | ❌ Missing | Uses keywords, not embeddings |

**Known Issues**:
| Issue | Severity | File | Problem |
|-------|----------|------|---------|
| Keyword-only | HIGH | `composition_selector.ts` | Hardcoded lists like `['bug', 'fix', 'error']` miss synonyms |
| No learning | MEDIUM | - | Selector doesn't learn from outcomes |

**Spec**: `track-a-core-pipeline.md` Section P2

### P3-P4: LCL Core + Structure Templates

| Aspect | Status | Details |
|--------|--------|---------|
| **LCL Core** | ✅ Implemented | Works |
| **Structure Templates** | ✅ Implemented | Works |

No major issues identified.

### P5: Pattern Catalog

| Aspect | Status | Details |
|--------|--------|---------|
| **Catalog** | ✅ Implemented | `pattern_catalog.ts` |
| **Confidence Values** | ⚠️ Broken | Uses legacy raw numeric confidence instead of `ConfidenceValue` |

**Known Issues**:
| Issue | Severity | File | Problem |
|-------|----------|------|---------|
| Legacy confidence | MEDIUM | `pattern_catalog.ts` | Uses raw numeric confidence / labeled guesses instead of `ConfidenceValue` (typically `{ type: 'absent', reason: 'uncalibrated' }` until calibrated) |

**Spec**: `track-a-core-pipeline.md` Section P5 + `track-d-quantification.md` Q6

### P6: Codebase Advisor

| Aspect | Status | Details |
|--------|--------|---------|
| **Advisor** | ✅ Implemented | `codebase_advisor.ts` |
| **Integration Testing** | ❌ Missing | Full integration not verified |

### P7: Evolution Engine

| Aspect | Status | Details |
|--------|--------|---------|
| **Engine** | ✅ Implemented | `composition_evolution.ts` |
| **State Persistence** | ⚠️ Unverified | Needs real trace validation |
| **Composition Customization** | ✅ Done | Critical Problem C solved |

**Spec**: `track-a-core-pipeline.md` Section P7 + `critical-usability.md` Critical C

---

## Chapter 4: The Bootstrap (Track B: P8-P10)

**Story**: Building knowledge progressively from certainty (AST) to inference (LLM).

### P8: Zero-Knowledge Bootstrap

| Aspect | Status | Details |
|--------|--------|---------|
| **Protocol** | ✅ Implemented | `zero_knowledge_bootstrap.ts` |
| **Phase Progression** | ✅ Implemented | 6 phases work |
| **Per-File Timeout** | ⚠️ Partial | Problem 27 partially addressed |

**Known Issues**:
| Issue | Severity | Problem |
|-------|----------|---------|
| File hangs | MEDIUM | One file can block entire phase (Problem 27) |
| Unbounded LLM retry | MEDIUM | Retry strategy unbounded (Problem 28) |

**Spec**: `track-b-bootstrap.md` Section P8 + `subsystem-problems.md` Problems 27-28

### P9: Universal Applicability

| Aspect | Status | Details |
|--------|--------|---------|
| **Situation Mapping** | ✅ Implemented | `universal_applicability.ts` |
| **Coverage** | ⚠️ Incomplete | Not all situations map to protocols |

### P10: Epistemic Policy

| Aspect | Status | Details |
|--------|--------|---------|
| **Policy System** | ✅ Implemented | `epistemic_policy.ts` |

---

## Chapter 5: The Honesty (Track D: Q1-Q8 + Track F: C1-C4)

**Story**: Epistemic honesty through quantification and calibration.

### Track D: Quantification

| Feature | Status | Details |
|---------|--------|---------|
| **Q1: ConfidenceValue Type** | ✅ Implemented | `packages/LiBrainian/src/epistemics/confidence.ts` |
| **Q2: Derivation Rules** | ✅ Implemented | D1-D6 in `confidence.ts` |
| **Q3: Degradation Handlers** | ✅ Implemented | `getEffectiveConfidence()`, `selectWithDegradation()`, etc. |
| **Q4: Migration Script** | ⚠️ Manual | Specs migrated, code migration pending |
| **Q5-Q7: Code Migrations** | ⚠️ Partial | Specs use ConfidenceValue, code still uses raw numbers |
| **Q8: TypeScript Enforcement** | ✅ Enabled | TypeScript will reject `confidence: 0.7` when type is `ConfidenceValue` |

**COHERENCE ISSUE RESOLVED**: Track E primitives now use `{ type: 'absent', reason: 'uncalibrated' }` in specs. Code migration still needed.

**Known Issues**:
| Issue | Severity | File | Problem |
|-------|----------|------|---------|
| technique_library.ts | HIGH | `technique_library.ts` | Uses raw confidence numbers |
| pattern_catalog.ts | HIGH | `pattern_catalog.ts` | Uses raw confidence numbers |
| track-e-domain.md | HIGH | Spec file | Uses raw confidence in examples |

**Spec**: `track-d-quantification.md`

### Track F: Calibration

| Feature | Status | Details |
|---------|--------|---------|
| **C1: Claim-Outcome Tracking** | ⚠️ Partial | Recording exists, no unified tracking |
| **C2: Calibration Curve** | ❌ Not Done | No curve computation |
| **C3: Confidence Adjustment** | ❌ Not Done | No adjustment from outcomes |
| **C4: Calibration Dashboard** | ❌ Not Done | No visibility |

**Known Issues**:
| Issue | Severity | Problem |
|-------|----------|---------|
| Time Decay Fallacy | MEDIUM | Problem 5 - decay without cause |
| Confidence Monism | MEDIUM | Problem 6 - one model for all types |
| No calibration data | HIGH | No historical outcomes to calibrate from |

**Spec**: `track-f-calibration.md`

---

## Chapter 6: The Universality (Track E: D1-D7)

**Story**: Supporting all domains through aspect-based decomposition.

### D1: Domain Primitives

| Aspect | Status | Details |
|--------|--------|---------|
| **14 Primitives** | ✅ Defined | 7 existing + 7 new |
| **Aspect Coverage** | ✅ Complete | 9 fundamental aspects covered |
| **Confidence Values** | ❌ Broken | Uses raw numbers |

**STATUS**: Track E spec primitives now use `{ type: 'absent', reason: 'uncalibrated' }`. Code migration to use `ConfidenceValue` type is pending.

**Spec**: `track-e-domain.md` Section D1

### D2-D7: Compositions and Protocol

| Feature | Status | Details |
|---------|--------|---------|
| **D2: 10 Compositions** | ✅ Defined | Spec complete |
| **D3: Construction Protocol** | ✅ Defined | Spec complete |
| **D4: Aspect Decomposer** | ✅ Defined | Spec complete |
| **D5: Composition Validator** | ✅ Defined | Spec complete |
| **D6: Universal Tests** | ❌ Not Done | Tests not implemented |
| **D7: Adequacy Gates** | ⚠️ Partial | Difficulty detectors exist |

---

## Chapter 7: The Completion (Track C: P11-P18)

**Story**: Advanced features building on honest, calibrated foundation.

### P11-P12: Storage Improvements

| Feature | Status | Details |
|---------|--------|---------|
| **P11: Storage Interface Split** | ✅ Implemented | `StorageSlices` exists |
| **P12: Transaction Boundaries** | ⚠️ Partial | Helpers exist, not all flows wrapped |

**Known Issues**:
| Issue | Severity | Problem |
|-------|----------|---------|
| Monolithic storage | MEDIUM | Problem 24 - still partially monolithic |
| Transaction gaps | MEDIUM | Bootstrap ingest, graph writes not wrapped |

### P13: Prediction-Oriented Memory (Critical B + B.1)

| Aspect | Status | Details |
|--------|--------|---------|
| **ClosedLoopLearner** | ✅ Implemented | `learning_loop.ts` |
| **Prediction-Weighted Retrieval** | ✅ Implemented | Works |
| **Consolidation** | ✅ Implemented | Works |
| **Tiering** | ✅ Implemented | Works |
| **Evidence Refresh** | ❌ Missing | B.1 not complete |
| **Selector Wiring** | ⚠️ Unverified | Needs verification |

**Known Issues**:
| Issue | Severity | Problem |
|-------|----------|---------|
| Episodes not used | HIGH | Problem 37 - recorded but not acted on |
| No generative learning | MEDIUM | Doesn't propose new compositions |

**Spec**: `track-c-extended.md` P13 + `critical-usability.md` Critical B, B.1

### P14-P18: Advanced Features

| Feature | Status | Details |
|---------|--------|---------|
| **P14: Self-Aware Oracle** | ⚠️ Spec only | Not implemented |
| **P15: Proof-Carrying Context** | ⚠️ Spec only | Not implemented |
| **P16: Causal Discovery** | ⚠️ Spec only | Not implemented |
| **P17: Bi-Temporal Knowledge** | ⚠️ Spec only | Not implemented |
| **P18: Metacognitive Architecture** | ⚠️ Spec only | Not implemented |

---

## Build Status

### Current Blockers

| Blocker | Status | Impact |
|---------|--------|--------|
| **Missing Exports** | ✅ Resolved | Previously failing exports are now present; update this table only when re-observed. |
| **Typecheck Gate** | ✅ GREEN | Verified 2026-01-24: `cd packages/LiBrainian && npx tsc --noEmit` |
| **Tier-0 Gate** | ✅ GREEN | Verified 2026-01-24: `npm run test:tier0` |

### Test Status

| Test Suite | Status | Notes |
|------------|--------|-------|
| `LiBrainian.test.ts` | ✅ Passes in isolation | |
| `mvp_librarian.system.test.ts` | ✅ Passes in isolation | |
| `npm run test:tier0` | ✅ Passes | Verified 2026-01-24 (Tier-0 deterministic gate) |
| Full `npm test` | ⚠️ Unverified | Completion proof pack not re-run in this status doc |

---

## Priority Order for Fixes

Based on the LiBrainian story and dependencies:

### Tier 0: Build Must Pass
1. Fix missing exports (`telemetry/logger.js`, etc.)
2. Get typecheck gate green

### Tier 1: Foundation (Chapter 2)
3. Enforce LLM adapter gate (no direct `LLMService` instantiation outside adapters/tests)
4. Unify evidence ledger (connect MCP, episodes, query logs)

### Tier 2: Honesty (Chapter 5)
5. Migrate `technique_library.ts` to use `ConfidenceValue` (remove raw numbers and labeled-guess patterns)
6. Migrate `pattern_catalog.ts` to use `ConfidenceValue` (treat unknowns as `{ type: 'absent', reason: 'uncalibrated' }` until calibrated)
7. Keep specs aligned with `ConfidenceValue` (do not reintroduce labeled-guess confidence examples)

### Tier 3: Pipeline Verification (Chapter 3)
8. Implement non-no-op operator interpreters
9. Add evidence emission to execution engine
10. Verify end-to-end execution (Critical A)

### Tier 4: Learning Closure (Chapter 7)
11. Wire learning loop to selector
12. Add generative composition learning

---

## Cross-Reference to Specs

| Issue Category | Primary Spec | Secondary Specs |
|----------------|--------------|-----------------|
| Provider bypass | track-a-core-pipeline.md | layer2-infrastructure.md |
| Evidence ledger | layer2-infrastructure.md | critical-usability.md |
| Raw confidence | track-d-quantification.md | track-e-domain.md, track-a-core-pipeline.md |
| Operator no-ops | track-a-core-pipeline.md | critical-usability.md |
| Learning loop | track-c-extended.md | critical-usability.md |
| Bootstrap issues | track-b-bootstrap.md | subsystem-problems.md |

---

## Verification Checklist

After fixes, verify:

- [ ] `npm run build` passes
- [x] `npm run test:tier0` passes (verified 2026-01-24; re-run after significant changes)
- [ ] No raw confidence numbers in technique files
- [ ] Provider discovery used everywhere (grep for `new LLMService`)
- [ ] Evidence ledger has unified schema
- [ ] At least one composition executes end-to-end with trace
- [ ] Learning loop wired to selector

<!-- IMPLEMENTATION_STATUS_AUTOGEN_START -->
### Implementation Evidence Snapshot (Autogenerated)
Generated: 2026-02-17T15:51:36.000Z

Retrieval Recall@5: 0.82 (target 0.8)
Context Precision: 0.74 (target 0.7)
Hallucination Rate: 0.03 (target 0.05)
Faithfulness: 0.87 (target 0.85)
Answer Relevancy: 0.79 (target 0.75)

A/B Lift: 0.2083 (target 0.2, p-value 0.0937) → MET
Memory per 1K LOC: 0.9 MB (target 50 MB) → MET
Scenario Families: 30/30 (100%)

Narrative status below has not been reconciled to evidence.
<!-- IMPLEMENTATION_STATUS_AUTOGEN_END -->