# Epistemic Primitives Analysis

Analysis of LiBrainian's existing epistemic infrastructure for task validation.

## ConfidenceValue System (`src/epistemics/confidence.ts`)

### Purpose
A principled type system for confidence with **mandatory provenance**. Eliminates arbitrary numbers - every value must explain its origin.

### Core Types
| Type | Use Case | Value |
|------|----------|-------|
| `DeterministicConfidence` | Syntactic ops (parse success/failure) | 1.0 or 0.0 |
| `DerivedConfidence` | Computed from formula + inputs | 0.0-1.0 with formula trace |
| `MeasuredConfidence` | Calibrated from historical outcomes | Has datasetId, sampleSize, CI |
| `BoundedConfidence` | Theoretical bounds with citation | [low, high] + basis |
| `AbsentConfidence` | Genuinely unknown | reason: 'uncalibrated' / 'insufficient_data' |

### Key Operations
- **Derivation Rules (D1-D6)**:
  - `syntacticConfidence(success)` - deterministic 1.0/0.0
  - `sequenceConfidence(steps)` - min(steps) for sequential pipeline
  - `parallelAllConfidence(branches)` - product for independent AND
  - `parallelAnyConfidence(branches)` - 1-product(1-p) for independent OR
  - `uncalibratedConfidence()` - returns Absent
  - `measuredConfidence(data)` - from calibration data

- **Composition**:
  - `andConfidence(a, b)` - min semantics
  - `orConfidence(a, b)` - max semantics
  - `combinedConfidence(inputs)` - weighted average with provenance

- **Threshold Checking**:
  - `getNumericValue(conf)` - extract value or null if Absent
  - `getEffectiveConfidence(conf)` - conservative fallback (0 for Absent)
  - `checkConfidenceThreshold(conf, min)` - returns allowed/blocked + mitigation

### Relevance to Task Validation
- **Direct**: `checkConfidenceThreshold` can block operations below epistemic thresholds
- **Provenance tracking**: Every derived value has `formula` + `inputs` for audit
- **Calibration status**: Tracks whether confidence is `preserved`/`degraded`/`unknown`
- **Absent handling**: Explicit "we don't know" rather than guessing

---

## Calibration Laws (`src/epistemics/calibration_laws.ts`)

### Purpose
Formalizes algebraic laws that confidence operations must satisfy to form a bounded semilattice. Ensures mathematical correctness of composition.

### Key Structures
- **Semilattice Laws**: associativity, commutativity, idempotence, identity, absorption
- **ConfidenceSemilattice**: meet=andConfidence, join=orConfidence, top=1.0, bottom=absent

### Key Operations
- `verifyAllLaws(meet, join, values, meetId, joinId, eq)` - tests law satisfaction
- `checkAssociativity/Commutativity/Idempotence/Identity/Absorption` - individual law checks
- `CalibrationTracker` - traces calibration status through composition pipeline

### Calibration Rules
```typescript
CALIBRATION_RULES = [
  { operation: 'min', apply: inputs => allPreserved ? 'preserved' : 'degraded' },
  { operation: 'max', apply: inputs => allPreserved ? 'preserved' : 'degraded' },
  { operation: 'product', apply: inputs => allPreserved ? 'preserved' : 'degraded' },
  { operation: 'noisy_or', apply: inputs => allPreserved ? 'preserved' : 'degraded' },
]
```

### Relevance to Task Validation
- **Calibration propagation**: `CalibrationTracker.applyOperation()` traces how calibration degrades
- **Composition safety**: Laws ensure well-behaved confidence propagation
- **Degradation detection**: Can identify when task lacks preserved calibration

---

## Computed Confidence (`src/epistemics/computed_confidence.ts`)

### Purpose
Computes confidence from multiple signal sources. Replaces uniform 0.5 default with evidence-based values.

### Signal Components (weights sum to 1.0)
| Component | Weight | Signals |
|-----------|--------|---------|
| Structural | 0.50 | Type annotations, docstrings, exports, complexity, size |
| Semantic | 0.30 | Purpose quality, embedding cohesion, single responsibility |
| Historical | 0.15 | Retrieval success rate, validation pass rate, recency |
| Cross-validation | 0.05 | Extractor agreement/disagreement |

### Key Operations
- `computeConfidence(signals)` - returns overall [0.15, 0.85] with breakdown
- `extractSignalsFromFunction/File/ContextPack` - entity adapters
- `computeConfidenceStats(values)` - mean, stdDev, median, variance

### Design Principles
- **Never certain** (max 0.85) - epistemic humility
- **Never clueless** (min 0.15) - always some signal
- **Real variance** - entities have different confidences

### Relevance to Task Validation
- **Evidence-based**: Confidence reflects actual code quality signals
- **Diagnostic output**: `ComputedConfidenceResult.diagnostics.factors/suggestions`
- **Low confidence detection**: Functions with confidence < 0.5 flagged as issues

---

## Defeater Calculus (`src/epistemics/defeaters.ts`)

### Purpose
Implements Pollock's defeater theory for knowledge validation. Detects conditions that invalidate or reduce confidence in claims.

### Defeater Types
| Type | Action | Example |
|------|--------|---------|
| Rebutting | Direct contradiction | "Function returns X" vs "Function returns Y" |
| Undercutting | Attacks justification | "LLM was hallucinating" |
| Undermining | Reduces confidence | Stale data, partial evidence |

### Detection Context
```typescript
interface DetectionContext {
  changedFiles?: string[];      // Code changed since claim
  failedTests?: string[];       // Test failures
  newClaims?: Claim[];          // Check for contradictions
  timestamp?: string;           // Staleness check
  hashMismatches?: [...];       // Content drift
  providerStatus?: {...};       // Provider availability
}
```

### Key Operations
- `detectDefeaters(storage, context, config)` - returns defeaters + contradictions
- `applyDefeaterToConfidence(claim, defeater)` - reduces confidence based on severity
- `computeDefeatedStrength(base, defeaters)` - Bayesian reduction
- `detectUntrustedContent(content)` - flags unreliable sources
- `detectDependencyDrift(deps)` - detects stale dependencies

### Relevance to Task Validation
- **Staleness detection**: Claims older than threshold get defeaters
- **Hash mismatch**: Code changed since claim was made
- **Provider issues**: External dependency unavailable
- **Contradiction tracking**: Never silently reconciled

---

## Evidence Ledger (`src/epistemics/evidence_ledger.ts`)

### Purpose
Append-only log of ALL epistemic events for audit and calibration.

### Evidence Kinds
`extraction | retrieval | synthesis | claim | verification | contradiction | feedback | outcome | tool_call | episode | calibration`

### Evidence Relations
- `supports` - provides supporting evidence
- `derived_from` - computed from related entry
- `contradicts` - contradicts related entry
- `supersedes` - newer version replacing old

### Provenance Sources
`ast_parser | llm_synthesis | embedding_search | user_input | tool_output | system_observation`

### Key Properties
- **Append-only**: Entries never modified or deleted
- **Content-addressable IDs**: Deterministic hashing for reproducibility
- **Session tracking**: `SessionId` for replay/audit

### Relevance to Task Validation
- **Audit trail**: Complete trace of how conclusions were reached
- **Evidence chaining**: Tasks can reference supporting evidence
- **Outcome tracking**: Historical success/failure for calibration

---

## Verification Plans (`src/api/verification_plans.ts`)

### Purpose
Creates verification plans for query responses identifying what needs to be checked.

### Key Output
```typescript
interface VerificationPlan {
  target: string;                    // What to verify
  methods: VerificationMethod[];     // How to verify (code_review, automated_test, manual_test)
  expectedObservations: string[];    // What to look for
  artifacts: string[];               // Related files
}
```

### Relevance to Task Validation
- **Gap identification**: `coverageGaps`, `uncertainties`, `adequacyGaps`
- **Verification methods**: Suggests how to validate claims
- **Artifacts**: Links to source files for review

---

## Quality Issue Detection (`src/quality/issue_detector.ts`)

### Purpose
Detects quality issues from indexed data. Relevant for epistemic grounding because low-quality code = lower confidence.

### Issue Categories
- `size` - Long methods, large files
- `complexity` - Too many parameters
- `documentation` - Low confidence, missing purpose
- `coupling` - High fan-in/fan-out
- `dead_code` - Unreachable functions

### Relevance to Task Validation
- **Low confidence flagging**: `fn.confidence < 0.5` triggers documentation issue
- **Understanding gaps**: "LiBrainian has low confidence in its understanding"
- **Evidence trails**: Issues include `evidence[]` array

---

## Synthesis: How These Enable Task Validation

### Existing Primitives Compose Into:

1. **Confidence Threshold Gate**
   ```typescript
   const result = checkConfidenceThreshold(taskConfidence, MIN_EPISTEMIC_THRESHOLD);
   if (result.status === 'blocked') {
     return {
       valid: false,
       reason: result.reason,
       mitigation: result.mitigation
     };
   }
   ```

2. **Evidence Chain Validation**
   ```typescript
   // Check all claims supporting task have evidence
   for (const claim of taskClaims) {
     const evidence = ledger.query({ kind: 'claim', relatedTo: claim.id });
     if (evidence.length === 0 || hasActiveDefeaters(claim)) {
       flagInsufficientGrounding(claim);
     }
   }
   ```

3. **Calibration Preservation Check**
   ```typescript
   const tracker = new CalibrationTracker('preserved');
   for (const step of taskSteps) {
     tracker.applyOperation(step.operation, step.inputs.map(i => i.calibrationStatus));
   }
   if (tracker.getStatus() === 'degraded') {
     warn('Task has uncalibrated steps - confidence may be unreliable');
   }
   ```

4. **Defeater-Based Invalidation**
   ```typescript
   const detection = await detectDefeaters(storage, {
     changedFiles: filesModifiedSinceTaskCreated,
     timestamp: now,
   });
   if (detection.defeaters.length > 0) {
     for (const d of detection.defeaters) {
       if (d.affectedClaimIds.includes(taskClaimId)) {
         invalidateTask(task, d);
       }
     }
   }
   ```

5. **Verification Plan Generation**
   ```typescript
   const plan = createQueryVerificationPlan({
     query: taskQuery,
     packs: relatedContextPacks,
     synthesis: taskSynthesis,
   });
   if (plan && plan.expectedObservations.length > 0) {
     task.requiresVerification = true;
     task.verificationPlan = plan;
   }
   ```

### What's Missing for Full Task Validation

1. **Task-level ConfidenceValue aggregation** - Need to derive task confidence from component claims
2. **Epistemic grounding threshold** - Policy for "minimum evidence required"
3. **Active defeater checking** - Query defeaters affecting task claims
4. **Evidence sufficiency predicate** - "Does this task have enough grounding?"

### Recommended Composition

A `TaskEpistemicValidator` could compose:
- `computeCalibrationStatus()` for calibration health
- `checkConfidenceThreshold()` for minimum bar
- `detectDefeaters()` for invalidation conditions
- `createQueryVerificationPlan()` for what to verify
- Evidence ledger queries for provenance audit

The primitives exist; they need orchestration at the task level.
