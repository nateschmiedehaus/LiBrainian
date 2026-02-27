# Primitive Extraction Feasibility Assessment

**Date**: 2026-01-27
**Status**: ANALYSIS COMPLETE

---

## Executive Summary

**Verdict: SPEC-FIRST, EXTRACT LATER**

The LiBrainian spec system has substantial implemented primitives (not just aspirational specs), but extraction NOW would be premature. The patterns are mature enough to document as a standalone conceptual framework, but the implementations need more real-world validation before being extracted as a reusable library.

---

## Implementation Reality Check

### Codebase Scale

| Metric | Value |
|--------|-------|
| Implementation LOC (non-test) | ~191,000 |
| Test files | 255 |
| Epistemics module LOC | 8,305 |
| Epistemics tests passing | 249/249 |

### Core Primitives: IMPLEMENTED

| Primitive | LOC | Tests | Status |
|-----------|-----|-------|--------|
| **ConfidenceValue Type System** | 693 | Many | Fully implemented with 5 types (deterministic, derived, measured, bounded, absent) |
| **Evidence Ledger** | 690 | 17 | Append-only log with provenance tracking |
| **Defeaters** | 852 | Yes | Full defeater system |
| **Contracts** | 582 | Yes | Pre/post conditions, invariants |
| **Causal Reasoning** | 774 | 44 | Just implemented - cause/effect graph traversal |
| **Storage** | 1,132 | Yes | Epistemic storage with claims, edges |

### Spec-Only (Not Yet Implemented)

| Pattern | Spec Status | Code Status |
|---------|-------------|-------------|
| Construction Templates (T1-T12) | Fully specified | Partial wiring |
| Work Objects (WorkGraph) | Specified | Partial |
| Self-Improvement Primitives (11) | Specified | Not implemented |
| Calibration Curves | Specified | Not computed |
| Deterministic Replay | Specified | Not complete |

---

## Gap Analysis

### What Works Well

1. **ConfidenceValue System** - The principled "no arbitrary numbers" approach is solid
   - 5 confidence types with mandatory provenance
   - Type guards, derivation rules (D1-D6)
   - Forces honest uncertainty disclosure

2. **Evidence Ledger** - Clean append-only design
   - Proper branded types (EvidenceId, SessionId)
   - 11 evidence kinds
   - Provenance tracking

3. **Defeater System** - Epistemically rigorous
   - Tracks what could invalidate a claim
   - Integrates with confidence

4. **Causal Reasoning** - Just built, well tested
   - Graph-based cause/effect tracking
   - Path finding with strength calculation

### What's Aspirational

1. **Construction Templates** - Great design, partial implementation
   - T1-T12 templates exist as specs
   - UC mapping strategy documented
   - But compiler/registry not fully wired

2. **Self-Improvement Loop** - Specified, not built
   - 11 primitives + 5 compositions designed
   - Would be powerful but needs implementation

3. **Calibration** - Core types exist, curves not computed
   - ConfidenceValue includes MeasuredConfidence
   - But no actual calibration data collection yet

---

## Decision Matrix

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Extract Now** | Early feedback, forces clean boundaries | Premature, API churn risk, maintenance burden | NO |
| **Spec-First** | Document patterns, validate in-place, iterate | Slower to market, but lower risk | YES |
| **No Extract** | Focus on LiBrainian only | Miss opportunity for broader impact | NO |

---

## Recommended Path: Spec-First Approach

### Phase 1: Document the Pattern Language (Now)

Create a conceptual document (not a library) describing:
- The Epistemic Primitives pattern catalog
- ConfidenceValue as a reference design
- Evidence Ledger as a reference design
- Defeater systems as a reference design

This can be published as a paper/blog without code extraction.

### Phase 2: Validate in LiBrainian (Next 2-4 weeks)

- Complete construction template wiring
- Build calibration curve computation
- Validate patterns with real repos (external eval corpus)

### Phase 3: Extract if Validated (Future)

Only after patterns prove out in real usage:
- Extract minimal kernel
- Define clean API boundaries
- Publish as `@wave0/epistemic-kit` or similar

---

## What's Actually Extractable Today

If forced to extract NOW, the minimal viable kernel would be:

```
epistemic-kit/
├── confidence/
│   ├── types.ts          # ConfidenceValue union type
│   ├── guards.ts         # Type guards
│   ├── derivation.ts     # D1-D6 rules
│   └── index.ts
├── evidence/
│   ├── ledger.ts         # IEvidenceLedger interface
│   ├── types.ts          # EvidenceKind, Provenance
│   └── index.ts
├── defeaters/
│   ├── types.ts          # Defeater types
│   └── index.ts
└── index.ts
```

Estimated: ~2,000 LOC extractable today, but limited utility without the full system.

---

## Risks

1. **Premature Abstraction** - Extracting before patterns stabilize
2. **API Churn** - Breaking changes as LiBrainian evolves
3. **Maintenance Burden** - Two packages to maintain
4. **Lost Context** - Patterns lose meaning outside LiBrainian

---

## Next Steps

1. **Mark Task #4 Complete** with this assessment
2. **Update Task #1** - Narrow to "document pattern language" not "design extraction"
3. **Skip Tasks #2 and #3** for now - positioning and integration premature
4. **Create New Task** - "Write Epistemic Primitives pattern paper/doc"

---

## References

- `docs/LiBrainian/specs/core/primitive-contracts.md`
- `docs/LiBrainian/specs/core/evidence-ledger.md`
- `docs/LiBrainian/specs/self-improvement-primitives.md`
- `docs/LiBrainian/specs/core/construction-templates.md`
- `docs/LiBrainian/specs/IMPLEMENTATION_STATUS.md`
- `src/epistemics/*.ts` (implementations)
