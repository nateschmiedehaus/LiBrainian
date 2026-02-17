# Spec Coherence Analysis

> **Purpose**: Critical review of spec documentation across ALL dimensions of coherence to ensure the doc set enables efficient implementation toward LiBrainian's unified vision.
> **Created**: 2026-01-22
> **Status**: Coherence significantly improved, but not “final”. Remaining gaps include: spec↔gate drift, extraction completeness gaps, and integration wiring still missing.
>
> **Important**: Any “/10” coherence scores in this document are **subjective planning heuristics**, not measured evidence. Do not treat them as gates or proof.

---

## The Seven Dimensions of Coherence

This analysis evaluates the spec set across seven distinct coherence dimensions:

| Dimension | Definition | Pre-Fix (subjective) | Post-Fix (subjective) | Current (2026-01-24, subjective) |
|-----------|------------|---------|----------|-------|
| **Logical** | Parts follow from each other without contradiction | 6/10 | 8/10 | 8/10 |
| **Semantic** | Terminology is consistent across all specs | 4/10 | 7/10 | 8/10 |
| **Conceptual** | Underlying models/metaphors are compatible | 5/10 | 7/10 | 8/10 |
| **Narrative** | Documentation tells a unified story | 5/10 | 9/10 | 9/10 |
| **Technical** | Specs can be implementable without conflict | 6/10 | 8/10 | 8/10 |
| **Temporal** | Priority ordering is implementable | 5/10 | 8/10 | 8/10 |
| **Goal** | All parts aim at the same goal | 8/10 | 9/10 | 9/10 |

**Overall Coherence (subjective): 5.6/10 → 8.0/10 → ~8/10** (Current)

---

## Fixes Applied (Full Summary)

### Pass 1 (Initial Fixes)

1. ✅ Added "The LiBrainian Story" narrative to AGENT_INSTRUCTIONS.md
2. ✅ Created GLOSSARY.md with canonical definitions
3. ✅ Created IMPLEMENTATION_STATUS.md mapping prior issues to story chapters
4. ✅ Added Critical Problem → Track mapping
5. ✅ Added Use Case → Feature mapping
6. ✅ Added Known Implementation Issues section to AGENT_INSTRUCTIONS.md
7. ✅ Added semantic coherence note to Track E (raw confidence → `ConfidenceValue` with `absent` for uncalibrated)
8. ✅ Added implementation status notes to P1, P13, Track D
9. ✅ Marked P0 duplication in layer2-infrastructure.md for removal

### Pass 2 (Critical Improvements)

10. ✅ **PRINCIPLED CONFIDENCE REDESIGN**: Replaced `placeholder()` with honest `ConfidenceValue` type
    - Created `CONFIDENCE_REDESIGN.md` - full principled design (no arbitrary values)
    - Types: Deterministic, Derived, Measured, Bounded, Absent (NO raw numbers)
    - System handles `absent` confidence gracefully (degradation, not lies)

11. ✅ **Rewrote Track D**: From `placeholder(0.7, ...)` (labeled guess) to principled `ConfidenceValue`
    - Q1-Q4: Now define honest types, not escape hatches
    - Derivation rules (D1-D6): Mathematical composition of confidence
    - Degradation handlers: What to do when confidence is unknown

12. ✅ **Updated GLOSSARY**:
    - Replaced `QuantifiedValue` with `ConfidenceValue`
    - Made `EvidenceEntry` the CANONICAL definition (deprecated `ExecutionEvidence`)
    - Fixed `KnowledgeSource` to not claim arbitrary confidence values

13. ✅ **Fixed Track E**: Updated to use principled confidence, corrected lying "Implemented" statuses

14. ✅ **Search-Epistemology Unification**: Added explicit section explaining the relationship:
    - Search = mechanism (how we find information)
    - Epistemology = goal (producing understanding with evidence and confidence)

15. ✅ **Removed P0 Duplication**: Cut ~430 lines of duplicate content from `layer2-infrastructure.md`
    - Single authoritative spec now in `track-a-core-pipeline.md`
    - Clear comments marking removed content

16. ✅ **Consolidated Evidence Schemas**: Made `EvidenceEntry` the single source of truth
    - `ExecutionEvidence` deprecated as alias
    - All evidence types unified under one schema

### What “Coherent Specs” Means (Target)

| Dimension | What “coherent” requires |
|-----------|----------------------|
| **Logical** | Dependencies are explicit and non-circular; status labels are evidence-backed. |
| **Semantic** | GLOSSARY terminology is consistent across tracks; no competing definitions. |
| **Conceptual** | Search/retrieval is a mechanism serving epistemic adequacy; no metaphor conflicts. |
| **Narrative** | “LiBrainian story” connects tracks to the system goal; readers can implement in order. |
| **Technical** | Interfaces/types don’t conflict; specs reference real code paths/gates/tests. |
| **Temporal** | Roadmap ordering matches dependencies and test tiers justified by provider requirements. |
| **Goal** | Each track contributes to “understanding with evidence” and discloses degraded modes honestly. |

### Pass 3 (Spec-Code Alignment - 2026-01-22)

Prior passes claimed fixes were complete but the actual spec files still contained raw confidence values.
This pass corrects those claims with actual fixes:

17. ✅ **Fixed Track E Primitives**: Replaced ALL raw `confidence: 0.7` values with `{ type: 'absent', reason: 'uncalibrated' }`
    - `tp_artifact_trace`, `tp_data_lineage`, `tp_policy_verify`, `tp_platform_map`, `tp_metric_trace`, `tp_timing_bound`, `tp_state_trace`

18. ✅ **Fixed Track B Bootstrap Phases**: Updated phase confidence descriptions and types
    - Changed `confidence: 0.6` → `expectedConfidenceType: 'absent'` for naming/structural/semantic phases
    - Changed `confidence: 1.0` → `expectedConfidenceType: 'deterministic'` for syntactic/behavioral phases
    - Updated `KnowledgeClaim.confidence` to use `ConfidenceValue` type
    - Rewrote "Quantification Invariant" section to reference principled approach

19. ✅ **Fixed Track A Pattern Example**: Replaced `confidence: 0.9` with `{ type: 'absent', reason: 'uncalibrated' }`

20. ✅ **Created ConfidenceValue Implementation**: `packages/LiBrainian/src/epistemics/confidence.ts` (~350 LOC)
    - All 5 confidence types defined and exported
    - Derivation rules D1-D6 implemented
    - Degradation handlers implemented
    - Type guards for runtime checking
    - Factory functions for clean API

21. ✅ **Updated Epistemics Exports**: Added all ConfidenceValue types/functions to `epistemics/index.ts`
    - Deprecated old `QuantifiedValue` and `placeholder()` exports

### Remaining Work (Not Coherence Issues)

These are **implementation tasks**, not coherence problems:

- Build verification (ensure new exports compile correctly)
- Code migration (update existing code to use new ConfidenceValue type)
- Operator interpreter implementations (no-ops → real)
- Learning loop wiring
- Calibration infrastructure

---

## LiBrainian's Core Vision (From THEORETICAL_CRITIQUE.md)

### The One-Sentence Goal
**LiBrainian is an epistemological system that produces *understanding* (not search results) that is evidence-backed, calibrated, defensible, and actionable for agents.**

### The Non-Negotiable Invariants

1. **Capability lattice is first-class**: Every operation declares required/optional capabilities; runtime negotiates; outputs disclose capability loss explicitly.

2. **Evidence ledger is unified**: Every LLM call, tool call, randomness draw, and read/write that influences claims is recorded with stable IDs.

3. **Claims are machine-checkable**: Anything presented as "supported" maps to evidence refs, not prose.

4. **Freshness is event-grounded**: Invalidations trigger from changes, not wall-clock priors.

5. **Executable workflows exist**: The technique system is runnable end-to-end, not just a planner.

6. **Calibration is environment-specific**: Confidence types are explicit and never silently treated as calibrated.

7. **Scaling strategy is deliberate**: Brute-force is allowed only with explicit disclosure.

8. **No paper capability**: Features are either implemented+gated OR marked spec-only.

9. **Adequacy gates are mandatory**: Detect missing prerequisites and fail-closed on strong claims.

### The 6 Architectural Invariants (G1-G6)

| # | Invariant | What It Means |
|---|-----------|---------------|
| G1 | Pure Function Core | `query()`, `search()`, etc. take all dependencies as parameters |
| G2 | Message Passing | External integration via `receive(message) → response` |
| G3 | Algebraic Composition | Operations form an algebra: closure, associativity, identity |
| G4 | Capability-Based Security | Security via unforgeable tokens, not permission lists |
| G5 | Context as Resource | Context is explicit, typed, and budget-managed |
| G6 | Self-Description | Every component describes its capabilities and evidence |

---

## Issues (Status as of 2026-01-24)

### Issue 1: CRITICAL - Duplication Between Specs

**Problem**: LLM Provider Discovery (P0) appears in BOTH:
- `track-a-core-pipeline.md` (lines 29-316)
- `layer2-infrastructure.md` (lines 99-250+)

**Impact**: Implementers don't know which is authoritative. Changes in one won't propagate to the other.

**Status**: **RESOLVED (2026-01-24)** — `layer2-infrastructure.md` contains only a P0 summary and points to `track-a-core-pipeline.md` as the authoritative spec.

---

### Issue 2: CRITICAL - Missing Theory → Implementation Mapping

**Problem**: The relationship between theoretical problems and implementation priorities is unclear:

| Critical Problem | Where Addressed? | Gap |
|------------------|------------------|-----|
| A: Execution Engine | P1 (Track A) | Only implicit link in theory ref |
| B: Learning Loop | P13 (Track C) | Buried in Track C, hard to find |
| B.1: Prediction Memory | P13 (Track C) | Same as above |
| C: Composition Customization | P7 (Track A) | Only mentioned in passing |
| D: Checkpointing | P1 (Track A) | Mentioned in execution, not explicit |
| E: Context Assembly | Not mapped | **MISSING from any track** |

**Impact**: An agent implementing features might miss critical usability problems. The "why" is disconnected from the "what".

**Status**: **RESOLVED (2026-01-24)** — `docs/LiBrainian/AGENT_INSTRUCTIONS.md` now contains “Critical Problem → Track Mapping”.

---

### Issue 3: HIGH - Subsystem Problems Not Mapped to Tracks

**Problem**: `subsystem-problems.md` contains Problems 26-57, but:
- Problems 43-46 (Epistemology) → No track assigned
- Problems 54-56 (Dynamics) → No track assigned
- Most problems just say "Pending" with no track reference

**Impact**: These problems will never be addressed because no implementation path exists.

**Status**: **PARTIALLY RESOLVED (2026-01-24)** — explicit mappings now exist for:
- Problems 43–46 → Track F Epistemology (`docs/LiBrainian/specs/track-f-epistemology.md`)
- Problems 54–56 → Track J Dynamics (`docs/LiBrainian/specs/track-j-dynamics.md`)

Remaining “Pending” items still need explicit track assignment to avoid being forgotten.

---

### Issue 4: HIGH - Use Cases Not Mapped to Tracks

**Problem**: `use-case-targets.md` defines 20 target interfaces showing current rating (avg 3.1/10) vs target (10/10), but:
- No mapping shows which tracks/features improve which use cases
- An implementer can't prioritize based on use case impact

**Impact**: Features may be implemented without improving actual utility.

**Status**: **RESOLVED (CENTRAL MAPPING) (2026-01-24)** — `docs/LiBrainian/AGENT_INSTRUCTIONS.md` now includes a central “Use Case → Feature Mapping”.

**Optional improvement**: Add per-track “Use Cases Enabled” sections as redundancy, but treat the central mapping as canonical to avoid duplication drift.

---

### Issue 5: MEDIUM - Circular Dependency in Priority Order

**Problem**: The dependency graph shows:
- Layer 2 (Infrastructure) → must complete before Layer 3 (Features)
- Track A (P0-P7) → shown as "Implemented"

But P0 (LLM Provider Discovery) IS part of Layer 2 Infrastructure, not Layer 3.

**Impact**: Confusing for implementers about what's actually done vs. what needs work.

**Fix Required**: Clarify that P0 IS Layer 2 Task 2.1 (LLM Adapter). Remove duplication.

---

### Issue 6: MEDIUM - Track F (Calibration) Disconnected

**Problem**: Track F (C1-C4) enables calibrated confidence, but:
- Track D (Q1-Q8) provides the quantification primitives C1-C4 need
- This dependency isn't shown in the dependency graph
- Calibration is mentioned as "ongoing, parallel to features" but this contradicts the theory that says calibration must be specific

**Impact**: Track F work may proceed without Q track foundations.

**Fix Required**: Show explicit Q → C dependency in the graph.

---

### Issue 7: MEDIUM - Missing "Evidence Ledger" Track

**Status**: **RESOLVED (2026-01-24)** — the canonical Evidence Ledger spec now exists in:
- `docs/LiBrainian/specs/core/evidence-ledger.md` (canonical V1 schema/API)
- `docs/LiBrainian/specs/layer2-infrastructure.md` (wiring requirements + vNext extensions)

**Guardrail**: Layer 2 must reference the canonical `EvidenceEntry`/`IEvidenceLedger` types and avoid introducing a competing “LedgerEntry” v1 schema (extensions are explicitly versioned as vNext).

---

## Coherence Matrix

This matrix shows which specs support which core vision elements:

| Spec File | G1 Pure | G2 Msg | G3 Algebra | G4 Caps | G5 Context | G6 Self | Evidence | Calibration |
|-----------|---------|--------|------------|---------|------------|---------|----------|-------------|
| track-a-core-pipeline | Partial | No | No | Yes | Partial | No | Partial | No |
| track-b-bootstrap | Yes | No | No | Yes | Yes | Yes | No | Yes |
| track-c-extended | Partial | No | No | Partial | Yes | No | Partial | Partial |
| track-d-quantification | Yes | No | No | No | No | Yes | No | YES |
| track-e-domain | No | No | Partial | No | No | Yes | No | No |
| track-f-calibration | No | No | No | No | No | No | YES | YES |
| layer2-infrastructure | Yes | Yes | No | Yes | No | Yes | YES | No |
| critical-usability | Yes | No | No | Partial | Yes | No | YES | No |
| use-case-targets | No | No | No | No | Yes | Yes | No | No |
| subsystem-problems | Partial | No | No | Partial | Partial | Partial | Partial | Partial |

**Key Gaps**:
- **G3 (Algebraic Composition)**: Almost no spec addresses operator algebra verification
- **G2 (Message Passing)**: Only Layer 2 addresses actor interface
- **Evidence Ledger**: Split across multiple specs, not unified

---

## Recommended Fixes

### Immediate (Block Implementation)

1. **Remove P0 duplication** from `layer2-infrastructure.md` - reference `track-a-core-pipeline.md` instead

2. **Add Critical Problem → Track mapping** to AGENT_INSTRUCTIONS.md:
   ```
   Critical A → P1 (Operator Execution) + Layer 2.2 (Evidence Ledger)
   Critical B → P13 (Track C)
   Critical B.1 → P13 (Track C)
   Critical C → P7 (Track A)
   Critical D → P1 (Track A)
   Critical E → NEW: Add to Track C or create Task
   ```

3. **Add Use Case → Track mapping** to AGENT_INSTRUCTIONS.md

### Short-Term (Before P11+)

4. **Assign subsystem problems** to tracks:
   - Problems 43-46 → Track F (Calibration/Epistemology extension)
   - Problems 54-56 → Track C (Extended, as P19-P21)

5. **Add Evidence Ledger schema** to `layer2-infrastructure.md`

6. **Show Q → C dependency** explicitly in AGENT_INSTRUCTIONS.md graph

### Medium-Term (Before Verification)

7. **Add G3 verification** tests to track-a-core-pipeline.md

8. **Unify confidence systems** across specs (currently each track defines its own)

---

## Verification Checklist

After fixes are applied, verify:

- [ ] No spec content is duplicated across files
- [ ] Every Critical Problem maps to at least one P track
- [ ] Every Subsystem Problem maps to a track or is explicitly deferred
- [ ] Every Use Case maps to enabling features
- [ ] Layer 2 → Layer 3 dependency is unambiguous
- [ ] Track D → Track F dependency is shown
- [ ] Evidence Ledger has a single authoritative schema
- [ ] G1-G6 invariants are addressed by at least one spec each

---

## Summary

The spec set is **structurally sound** but has **coherence gaps** that could cause implementation divergence:

| Category | Score | Issue |
|----------|-------|-------|
| Vision alignment | 8/10 | All specs serve the same goal |
| Cross-referencing | 5/10 | Many specs don't link to related specs |
| Duplication | 4/10 | P0 appears twice, causing confusion |
| Problem coverage | 6/10 | Critical Problems mapped, Subsystem Problems not |
| Use case traceability | 4/10 | Use cases defined but not mapped to implementations |

**Overall Coherence Score (subjective): 5.4/10**

Fixes above would bring this to **9/10** - sufficient for efficient implementation.

---

## Detailed Dimension Analysis

### 1. LOGICAL COHERENCE (Score: 6/10)

**Definition**: Do the parts follow logically from each other? Are there contradictions?

**Contradictions Found**:

1. **Track D vs Track E**: Track D establishes the Quantification Invariant requiring all confidence values be marked as placeholder/configurable/calibrated/derived. But Track E (Domain Primitives) contains:
   ```typescript
   confidence: 0.7  // Raw number, not wrapped
   ```
   This directly violates the invariant Track D establishes.

2. **"Implemented" vs "Layer 2 Required"**: Track A shows P0-P7 as "Implemented," but AGENT_INSTRUCTIONS.md says Layer 2 must complete first. If P0 IS Layer 2.1, the labeling is inconsistent.

3. **Calibration Timing**: Track F says calibration is "ongoing, parallel to features." But Track D says Q1-Q4 must come BEFORE features. Calibration depends on quantification - they can't be parallel.

**Logical Dependencies That Should Be Explicit**:
```
Layer 0 (Build) → Layer 1 (Extraction) → Layer 2 (Infrastructure)
                                              ↓
                    ┌───────────────────────────────────────────────────┐
                    ↓                         ↓                         ↓
              Track D (Q1-Q4)          Track A (P0-P7)            Layer 2.2 (Ledger)
                    ↓                         ↓                         ↓
              Track E (D1-D7)     →     Track B (P8-P10)     →     Track C (P11-P18)
                    ↓                                                   ↓
              Track F (C1-C4) ←─────────────────────────────────────────┘
```

---

### 2. SEMANTIC COHERENCE (Score: 4/10)

**Definition**: Is terminology consistent across all specs?

**Term Inconsistencies Found**:

| Term | Track D Definition | Track E/F Usage | Conflict |
|------|-------------------|-----------------|----------|
| `confidence` | `ConfidenceValue` with provenance | Raw `number` | YES |
| `knowledge` | Part of KnowledgeState (facts/inferences/unknowns) | Vague "understanding" | YES |
| `evidence` | EvidenceEntry with type/input/output/metadata | Various ad-hoc references | YES |
| `claim` | What CalibrationProtocol tracks | What KnowledgeState stores | Different schemas |
| `primitive` | TechniquePrimitive with confidence | DomainPrimitive without source | Inconsistent |

**Fix Required**: Create a GLOSSARY.md that defines canonical meanings, then update all specs to use them.

---

### 3. CONCEPTUAL COHERENCE (Score: 5/10)

**Definition**: Are the underlying models and metaphors compatible?

**Conflicting Metaphors Found**:

1. **LiBrainian-as-Search vs LiBrainian-as-Epistemology**:
   - Track A talks about "retrieval" and "queries" (search metaphor)
   - Track B talks about "knowledge states" and "claims" (epistemology metaphor)
   - These are compatible but the relationship isn't clear

2. **Confidence-as-Number vs Confidence-as-Evidence**:
   - Track D/F: Confidence is a derived/calibrated quantity
   - Track E: Confidence is a field on a primitive
   - These need reconciliation

3. **Execution-as-Planning vs Execution-as-Running**:
   - Critical Problem A talks about "verifying execution end-to-end"
   - Track A talks about "compositions" and "operators"
   - The connection between compositions and actual execution isn't clear

**Unified Conceptual Model Needed**:
```
                    EPISTEMOLOGICAL LAYER
    ┌──────────────────────────────────────────────────┐
    │  Claims ← Evidence ← Ledger ← Observations       │
    │    ↓                                             │
    │  Confidence = f(evidence_strength, calibration)  │
    └──────────────────────────────────────────────────┘
                         ↓
                    TECHNIQUE LAYER
    ┌──────────────────────────────────────────────────┐
    │  Compositions ← Operators ← Primitives           │
    │    ↓                                             │
    │  Execution = run(composition, context, ledger)   │
    └──────────────────────────────────────────────────┘
                         ↓
                    DOMAIN LAYER
    ┌──────────────────────────────────────────────────┐
    │  Use Cases ← Domain Primitives ← Aspect Matrix   │
    └──────────────────────────────────────────────────┘
```

---

### 4. NARRATIVE COHERENCE (Score: 5/10)

**Definition**: Does the documentation tell a unified story?

**Current Narrative Structure** (Fragmented):

- Track A: "Here's how to build the core pipeline"
- Track B: "Here's how to bootstrap from nothing"
- Track C: "Here's some advanced features"
- Track D: "We need to fix our confidence problem"
- Track E: "We need to support all domains"
- Track F: "We need to calibrate confidence"

**What's Missing**: The story of WHY these pieces fit together and WHAT they produce collectively.

**Unified Narrative** (Should be in AGENT_INSTRUCTIONS.md):

> **The LiBrainian Story**
>
> **Chapter 1: The Problem** - Agents need to understand code, not just search it. Understanding requires evidence-backed claims with calibrated confidence.
>
> **Chapter 2: The Foundation** - We build infrastructure (Layer 2) that captures evidence and negotiates capabilities. Without this, nothing else is trustworthy.
>
> **Chapter 3: The Pipeline** - We build composition-based retrieval (Track A) that produces knowledge claims, not search results. Each claim has evidence and confidence.
>
> **Chapter 4: The Bootstrap** - We solve the cold-start problem (Track B) by building knowledge progressively from certainty to inference.
>
> **Chapter 5: The Honesty** - We enforce epistemic honesty (Track D) by requiring all confidence values to be derived/calibrated/configurable/placeholder. We then calibrate them (Track F) from real outcomes.
>
> **Chapter 6: The Universality** - We extend to all domains (Track E) through aspect-based decomposition, without losing epistemic rigor.
>
> **Chapter 7: The Completion** - We add advanced features (Track C) that build on the honest, calibrated, universal foundation.

---

### 5. TECHNICAL COHERENCE (Score: 6/10)

**Definition**: Can the specs be implemented without conflict?

**Technical Conflicts Found**:

1. **Type Incompatibilities**:
   - Track D defines `ConfidenceValue` with explicit provenance and conservative handling for `absent`
   - Track E defines primitives with `confidence: number`
   - These can't coexist without wrapper code

2. **Interface Duplication**:
   - `EvidenceEntry` in layer2-infrastructure.md
   - `ExecutionEvidence` in critical-usability.md
   - `KnowledgeClaim.evidence` in track-b-bootstrap.md
   - Three different evidence schemas

3. **State Management Conflicts**:
   - `KnowledgeState` in track-b-bootstrap.md
   - `ZeroKnowledgeProtocolState` in track-b-bootstrap.md
   - `CalibrationProtocol` state in track-f-calibration.md
   - No unified state model

**Fix Required**: Create canonical types in a single spec file, reference everywhere else.

---

### 6. TEMPORAL COHERENCE (Score: 5/10)

**Definition**: Does the priority ordering make sense? Can you implement in the stated order?

**Ordering Issues Found**:

1. **Q before D**: Track D (Q1-Q8) should come before Track E (D1-D7), but both show "Implemented." If D1-D7 are implemented, they MUST have been done with raw confidence values, violating Q1-Q8.

2. **C after Q**: Track F (C1-C4) depends on Track D (Q2), but the dependency isn't explicit in the graph.

3. **Critical Problems vs P-tracks**: The Critical Problems are severity-ordered (A > B > C > D > E), but the P-tracks aren't aligned to this ordering.

**Correct Ordering**:
```
1. Layer 0: Build (must pass)
2. Layer 1: Extraction (must pass)
3. Layer 2: Infrastructure (2.1-2.4)
4. Track D: Q1-Q4 (quantification primitives)
5. Track A: P0-P7 (core pipeline, using ConfidenceValue)
6. Track B: P8-P10 (bootstrap, using ConfidenceValue)
7. Track E: D1-D7 (domain, using ConfidenceValue)
8. Track F: C1-C4 (calibration, producing measured confidence when evidence exists)
9. Track C: P11-P18 (extended features)
```

---

### 7. GOAL COHERENCE (Score: 8/10)

**Definition**: Do all parts aim at the same goal?

**Analysis**: Yes, all specs aim at the same goal (epistemological adequacy for agents), but they express it differently:

| Spec | How It Expresses the Goal |
|------|--------------------------|
| Track A | "Retrieval with synthesis" |
| Track B | "Knowledge from nothing" |
| Track C | "Advanced understanding" |
| Track D | "Epistemic honesty" |
| Track E | "Universal applicability" |
| Track F | "Honest calibration" |

**What's Missing**: An explicit statement in each spec about HOW it contributes to the unified goal.

**Fix**: Add to each spec:
```markdown
## Contribution to LiBrainian's Goal

This track contributes to LiBrainian's goal of epistemological adequacy by:
- [specific contribution]
- [how it depends on other tracks]
- [what other tracks depend on it]
```

---

## Fixes Applied

The following fixes have been identified and should be applied to achieve 9/10 coherence:

### Fix 1: Add Glossary
Create `specs/GLOSSARY.md` with canonical definitions.

### Fix 2: Update Track E to Use ConfidenceValue
All raw `confidence: 0.7` examples should become honest `ConfidenceValue` entries (typically `{ type: 'absent', reason: 'uncalibrated' }` until calibrated).

### Fix 3: Add Unified Evidence Schema
Consolidate the three evidence schemas into one authoritative definition.

### Fix 4: Add Narrative Section to AGENT_INSTRUCTIONS
Add "The LiBrainian Story" section showing how tracks connect.

### Fix 5: Add Critical Problem → Track Mapping
Explicit table in AGENT_INSTRUCTIONS.md.

### Fix 6: Add Use Case → Feature Mapping
Explicit table showing which features enable which use cases.

### Fix 7: Fix Ordering in Dependency Graph
Show Q → D → C dependency explicitly.

### Fix 8: Add "Contribution to Goal" Section
Each track spec gets a section explaining its role.

---

## Pass 4 - Comprehensive Spec Integration (January 2026)

> **Status**: PARTIAL (spec set expanded, but extraction remains incomplete)
> **Purpose**: Expand extracted spec coverage and make integration guidance executable (gates + tests + wiring).

### Summary Statistics

| Metric | Value |
|--------|-------|
| Total new spec files created | ~20 (varies by extraction pass) |
| Total existing specs updated | ~5 (varies by extraction pass) |
| Total estimated new LOC specified | large (theoretical) |
| Extraction coverage | see `EXTRACTION_GAP_REPORT.md` (coverage is not complete) |

### New Spec Files Created

#### Track Extensions and New Tracks

| # | File | Description | Priority/Source |
|---|------|-------------|-----------------|
| 1 | `track-g-retrieval-uncertainty.md` | RAG information bottleneck, uncertainty quantification in retrieval | P2 (Critical) |
| 2 | `technique-contracts.md` | Executable primitive contracts with pre/post conditions | P17 |
| 3 | `track-f-epistemology.md` | Gettier problems, social epistemology, epistemic injustice, defeasibility | P43-46 |
| 4 | `track-j-dynamics.md` | Stability analysis, bifurcation detection, emergence patterns | P54-57 |
| 5 | `track-c-hierarchical-knowledge.md` | Four-level hierarchy (project/module/file/symbol) for massive codebases | New |
| 6 | `self-improvement-primitives.md` | 11 core primitives + 5 composite workflows for agent self-improvement | New |
| 7 | `implementation-dependencies.md` | S1-S16 dependency graph with explicit ordering constraints | New |
| 8 | `use-case-capability-matrix.md` | Reverse-engineered capability requirements for 50+ use cases | New |
| 9 | `track-k-business-knowledge.md` | Non-software business domain modeling (40 primitives) | New |
| 10 | `track-c-causal-reasoning.md` | Do-calculus, counterfactual analysis, root cause identification | New |
| 11 | `track-c-agentic-workflows.md` | Human-in-the-loop patterns, multi-agent coordination, cost management | New |
| 12 | `track-i-multi-repo.md` | Cross-repository analysis, dependency tracking, API contract verification | New |
| 13 | `track-a-tiered-language-support.md` | Four-tier language parsing (Tier 1: full AST, Tier 4: text-only) | New |
| 14 | `track-c-fault-tolerance.md` | Supervision trees, degradation policies, circuit breakers | New |
| 15 | `track-d-polyglot-contracts.md` | Cross-language contract tracing (FFI, gRPC, REST) | New |
| 16 | `track-g-debugging.md` | Executable debugging (git bisect integration, instrumentation, tracing) | New |
| 17 | `track-h-review.md` | Diff-aware code review with semantic understanding | New |
| 18 | `track-h-incidents.md` | Incident investigation, timeline reconstruction, blast radius analysis | New |

### Existing Specs Updated

| # | File | Changes |
|---|------|---------|
| 1 | `track-a-core-pipeline.md` | Added P17-P23 (technique contracts, DSL semantics, expressiveness stratification) |
| 2 | `track-e-domain.md` | Added D3-D11 (security primitives, performance analysis, API discovery, test quality metrics, documentation generation, migration planning, architecture conformance, technical debt quantification, dependency analysis) |
| 3 | `layer2-infrastructure.md` | Added P21-P23, enhanced evidence ledger specification, epistemic kernel formalization |

### Coherence Assessment

#### Type System Consistency
- **ConfidenceValue types**: All specs now use `ConfidenceValue` types (deterministic, derived, measured, bounded, absent)
- **No raw numbers**: Zero instances of `confidence: 0.7` pattern remain in new specs
- **Degradation handlers**: All specs define behavior when confidence is absent

#### Cross-Reference Integrity
| From | To | Relationship |
|------|-----|-------------|
| `track-g-retrieval-uncertainty.md` | `track-d-quantification.md` | Uses Q1-Q4 derivation rules |
| `track-f-epistemology.md` | `CONFIDENCE_REDESIGN.md` | Extends confidence types with epistemic qualifiers |
| `track-j-dynamics.md` | `track-c-extended.md` | Builds on P11-P18 patterns |
| `track-c-hierarchical-knowledge.md` | `track-b-bootstrap.md` | Extends bootstrap phases |
| `implementation-dependencies.md` | All tracks | Central dependency authority |
| `use-case-capability-matrix.md` | All tracks | Reverse-engineered requirements |

#### Implementation Dependency Documentation
- **S1-S16 stages** fully mapped with explicit predecessor/successor relationships
- **No circular dependencies** in the documented graph
- **Parallel implementation paths** identified where possible

### Remaining Gaps (Honest Assessment)

#### Theoretical Items Not Yet in Specs

| Item | From | Status | Reason |
|------|------|--------|--------|
| P58-P62 (Quantum epistemology) | `subsystem-problems.md` | Deferred | Research-only, no near-term implementation |
| P63-P67 (Category-theoretic foundations) | `subsystem-problems.md` | Deferred | Requires specialized expertise |
| P68-P70 (Formal verification integration) | `subsystem-problems.md` | Partially covered | `technique-contracts.md` covers contracts, not full FV |

#### Known Implementation Blockers

| Blocker | Affected Specs | Mitigation |
|---------|----------------|------------|
| No calibration data yet | `track-f-calibration.md`, `track-f-epistemology.md` | All confidence starts as `absent` |
| Multi-repo auth complexity | `track-i-multi-repo.md` | Documented as optional capability |
| Language support variability | `track-a-tiered-language-support.md` | Tier system handles graceful degradation |

### Pass 4 Status (Honest)

Pass 4 is not fully verified. The spec set expanded, but:
- Extraction completeness remains incomplete (see `EXTRACTION_GAP_REPORT.md` for current coverage accounting).
- Some cross-references and gates drift as implementation evolves (avoid “checked boxes” without re-running evidence).
- Integration wiring (evidence ledger ↔ subsystems, capability negotiation ↔ operations) is still ongoing work.

---

## Appendix: Full Spec File Inventory (Post-Pass 4)

### Core Tracks
- `track-a-core-pipeline.md` - P0-P7, P17-P23
- `track-b-bootstrap.md` - P8-P10
- `track-c-extended.md` - P11-P18
- `track-d-quantification.md` - Q1-Q8
- `track-e-domain.md` - D1-D11
- `track-f-calibration.md` - C1-C4

### New Tracks (Pass 4)
- `track-f-epistemology.md` - Gettier, social, injustice, defeasibility
- `track-g-retrieval-uncertainty.md` - RAG uncertainty
- `track-g-debugging.md` - Executable debugging
- `track-h-review.md` - Code review
- `track-h-incidents.md` - Incident investigation
- `track-i-multi-repo.md` - Cross-repository
- `track-j-dynamics.md` - Stability and emergence
- `track-k-business-knowledge.md` - Business domain

### Specialized Specs (Pass 4)
- `track-a-tiered-language-support.md` - Language tiers
- `track-c-hierarchical-knowledge.md` - Knowledge hierarchy
- `track-c-causal-reasoning.md` - Causal analysis
- `track-c-agentic-workflows.md` - Agent coordination
- `track-c-fault-tolerance.md` - Fault tolerance
- `track-d-polyglot-contracts.md` - Cross-language contracts
- `technique-contracts.md` - Executable contracts
- `self-improvement-primitives.md` - Self-improvement
- `implementation-dependencies.md` - Dependency graph
- `use-case-capability-matrix.md` - Capability matrix

### Infrastructure and Meta
- `layer2-infrastructure.md` - Core infrastructure
- `GLOSSARY.md` - Canonical definitions
- `CONFIDENCE_REDESIGN.md` - Confidence type system
- `COHERENCE_ANALYSIS.md` - This document
