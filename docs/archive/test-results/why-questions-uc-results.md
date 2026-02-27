# WHY Questions Use Case Test Results

**Test Date:** 2026-01-31
**Test Purpose:** Assess whether LiBrainian explains rationale and design decisions for "WHY" questions
**Mode:** `--no-synthesis` (raw context packs without LLM synthesis)

---

## Executive Summary

| Question | Result | Explained Rationale? |
|----------|--------|---------------------|
| Why is there a validation_gates.ts file? | Partial | No - returned related functions, not rationale |
| Why does bootstrap have multiple phases? | Partial | No - returned phase-related code, not reasoning |
| Why use SQLite instead of PostgreSQL? | Fail | No - only 1 pack, no design decision context |
| Why is confidence calibration needed? | Partial | No - returned calibration code, not justification |
| Why separate epistemics from storage? | Partial | No - returned storage code, not architectural reasoning |

**Overall Assessment:** **FAIL** - LiBrainian does not effectively answer "WHY" questions. It retrieves semantically related code but fails to surface rationale, design documents, ADRs (Architecture Decision Records), or explanatory comments that would explain the reasoning behind architectural decisions.

---

## Detailed Results

### 1. Why is there a validation_gates.ts file?

**Query:** `"why is there a validation_gates.ts file"`
**Latency:** 1586ms
**Confidence:** 0.789
**Packs Found:** 9

**Context Packs Returned:**
- `createMockConfig` - Test helper function (validation_gates.test.ts)
- `hasFatalFailure` - Check for fatal failures (validation_gates.ts)
- `createCriterion` - Create gate criterion (quality_gates.ts)
- `createEmptyContext` - Empty validation context (validator.ts)
- `evaluateAllGates` - Evaluate gates against context (quality_gates.ts)
- `createEmptyValidation` - Empty skill validation (types.ts)
- `isEpistemicValidationEnabled` - Check validation status (validation_config.ts)
- `createTestContext` - Test helper (quality_gates.test.ts)
- `healthCommand` - Health check command (health.ts)

**Assessment:**
- **Did it explain rationale?** NO
- **What was returned:** Function signatures and locations related to validation
- **Missing:** No explanation of WHY the file exists, what problem it solves, or the design decision that led to its creation
- **Expected:** Documentation, comments, or ADRs explaining the purpose of validation gates in the architecture

---

### 2. Why does bootstrap have multiple phases?

**Query:** `"why does bootstrap have multiple phases"`
**Latency:** 2677ms
**Confidence:** 0.794
**Packs Found:** 9

**Context Packs Returned:**
- `getZeroKnowledgeProtocol` - Returns bootstrap phases (zero_knowledge_bootstrap.ts)
- `createBootstrapConfig` - Creates bootstrap configuration (bootstrap.ts)
- `isBootstrapRecoveryState` - Type guard for recovery state (bootstrap.ts)
- `createMockPhaseResult` - Test helper (validation_gates.test.ts)
- `createBootstrapErrorEvent` - Error event creation (events.ts)
- `createBootstrapPhaseCompleteEvent` - Phase completion event (events.ts)
- `createTieredBootstrap` - Create tiered bootstrap instance (tiered_bootstrap.ts)
- `getStatus` - Get bootstrap status (tiered_bootstrap.ts)
- `start` - Start tiered bootstrap process (tiered_bootstrap.ts)

**Assessment:**
- **Did it explain rationale?** NO
- **What was returned:** Functions related to bootstrap phases
- **Missing:** No explanation of WHY phases are needed, what problems they solve, or the architectural reasoning
- **Expected:** Design documentation explaining the benefits of phased bootstrap (e.g., progressive loading, error recovery, resource management)

---

### 3. Why use SQLite instead of PostgreSQL?

**Query:** `"why use SQLite instead of PostgreSQL"`
**Latency:** 3072ms
**Confidence:** 0.880
**Packs Found:** 1

**Context Packs Returned:**
- `createStorageFromBackend` - Creates storage from backend config (sqlite_storage.ts)

**Assessment:**
- **Did it explain rationale?** NO
- **What was returned:** Only 1 pack - a function that creates storage
- **Missing:** No comparison between SQLite and PostgreSQL, no explanation of the tradeoffs, no ADR
- **Expected:** Documentation explaining:
  - Zero-configuration deployment benefits
  - Single-file portability advantages
  - Local-first architecture reasoning
  - Performance characteristics for the use case
  - Tradeoffs considered (scalability, concurrency)

---

### 4. Why is confidence calibration needed?

**Query:** `"why is confidence calibration needed"`
**Latency:** 1238ms
**Confidence:** 0.775
**Packs Found:** 10

**Context Packs Returned:**
- `applyCalibrationToPacks` - Apply calibration to packs (confidence_calibration.ts)
- `computeUncertaintyMetrics` - Compute metrics (confidence_calibration.ts)
- `getCalibrationStatus` - Get status (task_validation.ts)
- `createCalibratedConfidence` - Test helper (calibration_preservation.test.ts)
- `confidenceEquals` - Compare confidence values (calibration_laws.ts)
- `genMeasured` - Generate random confidence (calibration_property_tests.test.ts)
- `uncalibratedConfidence` - Absent confidence (confidence.ts)
- `createDerivedConfidence` - Test helper (calibration_tracker.test.ts)
- `createMeasured` - Test helper (calibration_laws.test.ts)
- `checkConfidenceThreshold` - Check threshold (confidence.ts)

**Assessment:**
- **Did it explain rationale?** NO
- **What was returned:** Functions related to confidence calibration
- **Missing:** No explanation of WHY calibration is needed, what problem it solves, or epistemic justification
- **Expected:** Documentation explaining:
  - The problem of overconfident/underconfident systems
  - Why accurate confidence estimates matter for decisions
  - The epistemic framework motivating calibration
  - How calibration improves query result quality

---

### 5. Why separate epistemics from storage?

**Query:** `"why separate epistemics from storage"`
**Latency:** 4706ms
**Confidence:** 0.782
**Packs Found:** 7

**Context Packs Returned:**
- `createEvidenceGraphStorage` - Create storage instance (epistemics/storage.ts)
- `deleteContradiction` - Delete contradiction (epistemics/storage.ts)
- `upsertContradiction` - Upsert contradiction (epistemics/storage.ts)
- `upsertEdge` - Upsert edge (epistemics/storage.ts)
- `upsertDefeater` - Upsert defeater (epistemics/storage.ts)
- `deserializeEvidenceGraph` - Deserialize graph (epistemics/types.ts)
- `findMinimalRemovalSet` - Find minimal removal set (epistemics/belief_revision.ts)

**Assessment:**
- **Did it explain rationale?** NO
- **What was returned:** Functions from epistemics storage module
- **Missing:** No explanation of the architectural separation, no discussion of concerns
- **Expected:** Documentation explaining:
  - Separation of concerns principle
  - Why epistemics logic shouldn't be coupled to storage implementation
  - Testability benefits
  - Ability to swap storage backends
  - Domain-driven design reasoning

---

## Root Cause Analysis

### Why WHY Questions Fail

1. **Semantic Similarity ≠ Rationale**
   - The system finds code that is semantically similar to the query terms
   - "validation_gates" → finds validation_gates.ts functions
   - But semantic similarity doesn't surface explanatory content

2. **No ADR/Design Document Indexing**
   - Architecture Decision Records (ADRs) would contain rationale
   - The system doesn't appear to prioritize or surface design documentation

3. **No Comment/Docstring Extraction for Rationale**
   - Code comments explaining "why" are not being surfaced
   - Function summaries describe "what" not "why"

4. **Query Intent Not Recognized**
   - System treats "why" questions the same as "what" or "where" questions
   - No special handling to seek explanatory/reasoning content

5. **Missing Rationale Extractor**
   - There is a `rationale_extractor.ts` in the codebase but:
     - Extracted rationales are not being surfaced in WHY queries
     - Or the extractor hasn't captured the design rationale

---

## Recommendations

### Short-term Fixes

1. **Query Intent Classification for WHY**
   - Detect "why" questions and boost rationale-related content
   - Prioritize comments, docstrings, and documentation

2. **Surface Rationale Packs**
   - When answering WHY queries, include packs from:
     - `rationale_extractor.ts` output
     - ADR documents
     - README sections explaining design

3. **Comment-Aware Retrieval**
   - Index and retrieve code comments that explain reasoning
   - Weight JSDoc/TSDoc `@description` and `@reason` tags

### Long-term Improvements

1. **ADR Integration**
   - Create ADR template and index ADR documents
   - Link code entities to their motivating ADRs

2. **Explicit Design Decision Tracking**
   - When code is analyzed, extract "why" explanations
   - Store as first-class context packs

3. **LLM-Assisted Rationale Inference**
   - When rationale is missing, use LLM to infer reasoning from code patterns
   - Mark as "inferred" with lower confidence

---

## Conclusion

LiBrainian currently **does not effectively answer WHY questions**. It returns semantically related code but fails to surface the reasoning, rationale, or design decisions behind architectural choices.

For WHY questions to work properly, LiBrainian needs:
1. Query intent classification to recognize rationale-seeking queries
2. Dedicated indexing of design documentation and ADRs
3. Extraction and surfacing of explanatory comments
4. Different retrieval strategies for different query intents

**Grade: D** - The system finds relevant code but completely misses the user's actual information need (understanding rationale).
