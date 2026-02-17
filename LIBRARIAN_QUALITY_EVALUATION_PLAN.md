# LiBrainian Quality Evaluation & Constructions Plan

> **Mode**: ORCHESTRATOR with WORKER SUBAGENTS
> **Goal**: Objectively evaluate LiBrainian's quality for 30 common agent tasks + build/test constructions
> **Pattern**: Following CODEX_ORCHESTRATOR.md methodology

---

## EXECUTIVE SUMMARY

This plan orchestrates three parallel workstreams:

1. **Stream A**: Quality Analysis of Bootstrap & LiBrainian (30 agent tasks)
2. **Stream B**: Build Helpful Constructions using LiBrainian Primitives
3. **Stream C**: Test Constructions on Real Project

All evaluated **objectively** using machine-verifiable metrics.

---

## ORCHESTRATION ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MAIN ORCHESTRATOR                                │
│  Coordinates all streams, spawns up to 3 concurrent workers              │
└─────────────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   STREAM A       │ │   STREAM B       │ │   STREAM C       │
│   Quality        │ │   Build          │ │   Test           │
│   Analysis       │ │   Constructions  │ │   Constructions  │
│   (30 tasks)     │ │   (12 primtives) │ │   (real project) │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

---

## STREAM A: QUALITY ANALYSIS (30 Common Agent Tasks)

### A.1 Task Categories

Based on CODEX_ORCHESTRATOR.md SF-01 to SF-30 and common agent workflows:

#### Category 1: Code Navigation (Tasks 1-6)
| Task ID | Task | Quality Criteria |
|---------|------|-----------------|
| T-01 | Find function by name | Recall@1, latency <500ms |
| T-02 | Find function by purpose (semantic) | Recall@5 >= 80% |
| T-03 | Navigate call graph (what calls X?) | Precision >= 90% |
| T-04 | Navigate dependency graph (what imports X?) | Precision >= 95% |
| T-05 | Find implementation of interface | Accuracy = 100% (deterministic) |
| T-06 | Find test file for source file | Recall >= 90% |

#### Category 2: Code Understanding (Tasks 7-12)
| Task ID | Task | Quality Criteria |
|---------|------|-----------------|
| T-07 | Explain function purpose | Faithfulness >= 85% |
| T-08 | Explain module architecture | Grounding >= 80% |
| T-09 | Identify design patterns | Precision >= 70% |
| T-10 | Understand error handling flow | Completeness >= 80% |
| T-11 | Trace data flow (input → output) | Accuracy >= 85% |
| T-12 | Identify side effects | Recall >= 75% |

#### Category 3: Code Modification Support (Tasks 13-18)
| Task ID | Task | Quality Criteria |
|---------|------|-----------------|
| T-13 | Find all usages before refactor | Recall = 100% |
| T-14 | Identify breaking change impact | Coverage >= 90% |
| T-15 | Suggest similar code patterns | Relevance >= 75% |
| T-16 | Find where to add new feature | Precision >= 80% |
| T-17 | Identify test coverage gaps | Accuracy >= 85% |
| T-18 | Find configuration locations | Recall >= 95% |

#### Category 4: Bug Investigation (Tasks 19-24)
| Task ID | Task | Quality Criteria |
|---------|------|-----------------|
| T-19 | Locate error source from stack trace | Accuracy >= 95% |
| T-20 | Find related bugs (similar patterns) | Recall >= 60% |
| T-21 | Identify race condition potential | Detection >= 50% |
| T-22 | Find null/undefined hazards | Precision >= 70% |
| T-23 | Trace exception propagation | Completeness >= 85% |
| T-24 | Find dead code | Precision >= 80% |

#### Category 5: HARD Scenarios (Tasks 25-30)
| Task ID | Task | Quality Criteria |
|---------|------|-----------------|
| T-25 | Dynamic metaprogramming analysis | "I don't know" if uncertain |
| T-26 | Framework magic (ORM, DI) | Grounding >= 60% |
| T-27 | Security vulnerability detection | Recall >= 50%, no false confidence |
| T-28 | Performance anti-pattern detection | Precision >= 65% |
| T-29 | Circular dependency analysis | Accuracy >= 90% |
| T-30 | Undocumented legacy code explanation | Honest uncertainty disclosure |

### A.2 Evaluation Protocol

For each task, we measure:

```typescript
interface TaskEvaluation {
  taskId: string;

  // Primary metrics
  accuracy: number;          // Correctness
  recall: number;            // Completeness
  precision: number;         // Relevance
  faithfulness: number;      // No hallucination

  // Quality metrics
  confidenceCalibration: number;  // Stated vs actual accuracy
  latencyP50: number;             // Performance
  latencyP99: number;

  // Epistemic honesty
  hallucinationRate: number;      // Target < 5%
  iDontKnowRate: number;          // When appropriate
  defeaterDisclosure: boolean;    // Are contradictions surfaced?

  // Verdict
  verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'KNOWN_LIMITATION';
  evidence: string[];             // Machine-verifiable evidence
}
```

---

## STREAM B: BUILD CONSTRUCTIONS

### B.1 LiBrainian Primitives Available

From codebase exploration, these primitives are composable:

| Primitive | Type | Purpose |
|-----------|------|---------|
| `ConfidenceValue` | Epistemic | Typed confidence (deterministic, measured, derived, bounded, absent) |
| `Evidence` | Epistemic | Append-only audit trail |
| `Defeater` | Epistemic | Track contradictions (rebutting, undercutting, undermining) |
| `ContextPack` | Knowledge | Pre-computed knowledge bundle |
| `Claim` | Knowledge | Knowledge graph node with provenance |
| `PrimitiveContract` | Verification | Type-safe function with pre/postconditions |
| `VerificationPlan` | Strategic | Proof of correctness |
| `RelevanceEngine` | Query | Semantic + PageRank relevance |
| `ConstraintEngine` | Query | Validation and inference |
| `TddEngine` | Quality | Test generation |
| `QualityGates` | Epistemics | Stage-aware validation |
| `EvidenceLedger` | Audit | W3C PROV-compatible trace |

### B.2 Constructions to Build

#### Construction 1: Refactoring Safety Checker
```typescript
// Composes: ConstraintEngine + ConfidenceValue + Defeaters
RefactoringSafetyChecker = compose(
  findAllUsages,           // T-13: Find all usages
  analyzeImpact,           // T-14: Breaking changes
  checkConstraints,        // Validate no violations
  generateTestPlan         // T-17: Coverage gaps
);
// Output: { safe: boolean, risks: Risk[], confidence: ConfidenceValue }
```

#### Construction 2: Bug Investigation Assistant
```typescript
// Composes: ContextPacks + CallGraph + EvidenceLedger
BugInvestigationAssistant = compose(
  parseStackTrace,         // T-19: Error source
  traceExceptions,         // T-23: Propagation
  findRelatedPatterns,     // T-20: Similar bugs
  generateHypotheses       // Scientific Loop
);
// Output: { rootCause: Hypothesis[], confidence: ConfidenceValue, evidence: Evidence[] }
```

#### Construction 3: Feature Location Advisor
```typescript
// Composes: RelevanceEngine + PatternLibrary + QualityGates
FeatureLocationAdvisor = compose(
  semanticSearch,          // T-16: Where to add
  findPatterns,            // T-15: Similar code
  checkArchitecture,       // Module boundaries
  suggestLocation          // With confidence
);
// Output: { locations: Location[], rationale: string, confidence: ConfidenceValue }
```

#### Construction 4: Code Quality Reporter
```typescript
// Composes: QualityDetectors + TddEngine + Calibration
CodeQualityReporter = compose(
  detectIssues,            // All quality detectors
  prioritizeByROI,         // Impact vs effort
  generateTests,           // For verification
  calibrateConfidence      // Against outcomes
);
// Output: { issues: Issue[], roadmap: Phase[], confidence: ConfidenceValue }
```

#### Construction 5: Architecture Verifier
```typescript
// Composes: DependencyGraph + Constraints + UniversalCoherence
ArchitectureVerifier = compose(
  extractModules,          // Module structure
  checkCircular,           // T-29: Circular deps
  validateLayers,          // Layer violations
  assessCoherence          // Cross-level consistency
);
// Output: { violations: Violation[], health: Score, confidence: ConfidenceValue }
```

#### Construction 6: Security Audit Helper
```typescript
// Composes: SecurityIndexer + TaintAnalysis + Defeaters
SecurityAuditHelper = compose(
  findSecurityPatterns,    // T-27: Vulnerabilities
  traceUserInput,          // Data flow
  checkSanitization,       // Validation points
  generateDefeaters        // What could go wrong
);
// Output: { findings: Finding[], confidence: ConfidenceValue, caveats: string[] }
```

---

## STREAM C: TEST CONSTRUCTIONS ON REAL PROJECT

### C.1 Target Project Selection

**Criteria** (per CODEX_ORCHESTRATOR.md Phase 8):
- Real external repo (not AI-generated)
- TypeScript or JavaScript
- Has test suite
- 1,000+ LOC
- Post-2024 or obscure (to avoid training data contamination)

**Candidate repos from eval-corpus** (if available) or clone:
1. A medium-sized open source TypeScript project
2. The LiBrainian codebase itself (dog-fooding)

### C.2 Test Protocol

```
FOR each construction:
  1. INSTANTIATE construction with target project
  2. RUN 5 representative tasks
  3. VERIFY outputs against ground truth (AST facts)
  4. MEASURE:
     - Accuracy (correct?)
     - Latency (fast enough?)
     - Confidence calibration (honest?)
  5. RECORD results in eval-results/
```

### C.3 Success Criteria

| Construction | Accuracy Target | Latency Target | Calibration Target |
|--------------|-----------------|----------------|-------------------|
| RefactoringSafetyChecker | >= 90% | p50 < 2s | ECE < 0.15 |
| BugInvestigationAssistant | >= 75% | p50 < 3s | ECE < 0.15 |
| FeatureLocationAdvisor | >= 70% | p50 < 1s | ECE < 0.20 |
| CodeQualityReporter | >= 85% | p50 < 5s | ECE < 0.10 |
| ArchitectureVerifier | >= 95% | p50 < 3s | ECE < 0.10 |
| SecurityAuditHelper | >= 60% | p50 < 5s | ECE < 0.25 |

---

## WORK UNITS

### Phase 1: Setup & Baseline (WU-E001 to WU-E003)

| WU ID | Name | Stream | Dependencies | Est. |
|-------|------|--------|--------------|------|
| WU-E001 | Verify all tests pass | Setup | None | 1 |
| WU-E002 | Bootstrap LiBrainian on target project | Setup | WU-E001 | 2 |
| WU-E003 | Generate ground truth from AST | Setup | WU-E002 | 2 |

### Phase 2: Quality Analysis - Navigation (WU-E101 to WU-E106)

| WU ID | Name | Stream | Dependencies | Est. |
|-------|------|--------|--------------|------|
| WU-E101 | Evaluate T-01: Find function by name | A | WU-E003 | 1 |
| WU-E102 | Evaluate T-02: Semantic function search | A | WU-E003 | 1 |
| WU-E103 | Evaluate T-03: Call graph navigation | A | WU-E003 | 1 |
| WU-E104 | Evaluate T-04: Dependency graph navigation | A | WU-E003 | 1 |
| WU-E105 | Evaluate T-05: Interface implementation | A | WU-E003 | 1 |
| WU-E106 | Evaluate T-06: Test file mapping | A | WU-E003 | 1 |

### Phase 3: Quality Analysis - Understanding (WU-E201 to WU-E206)

| WU ID | Name | Stream | Dependencies | Est. |
|-------|------|--------|--------------|------|
| WU-E201 | Evaluate T-07: Function explanation | A | WU-E106 | 1 |
| WU-E202 | Evaluate T-08: Module architecture | A | WU-E106 | 1 |
| WU-E203 | Evaluate T-09: Design patterns | A | WU-E106 | 1 |
| WU-E204 | Evaluate T-10: Error handling flow | A | WU-E106 | 1 |
| WU-E205 | Evaluate T-11: Data flow tracing | A | WU-E106 | 1 |
| WU-E206 | Evaluate T-12: Side effect identification | A | WU-E106 | 1 |

### Phase 4: Quality Analysis - Modification (WU-E301 to WU-E306)

| WU ID | Name | Stream | Dependencies | Est. |
|-------|------|--------|--------------|------|
| WU-E301 | Evaluate T-13: Find all usages | A | WU-E206 | 1 |
| WU-E302 | Evaluate T-14: Breaking change impact | A | WU-E206 | 1 |
| WU-E303 | Evaluate T-15: Similar patterns | A | WU-E206 | 1 |
| WU-E304 | Evaluate T-16: Feature location | A | WU-E206 | 1 |
| WU-E305 | Evaluate T-17: Test coverage gaps | A | WU-E206 | 1 |
| WU-E306 | Evaluate T-18: Configuration locations | A | WU-E206 | 1 |

### Phase 5: Quality Analysis - Bug Investigation (WU-E401 to WU-E406)

| WU ID | Name | Stream | Dependencies | Est. |
|-------|------|--------|--------------|------|
| WU-E401 | Evaluate T-19: Stack trace analysis | A | WU-E306 | 1 |
| WU-E402 | Evaluate T-20: Related bug patterns | A | WU-E306 | 1 |
| WU-E403 | Evaluate T-21: Race condition detection | A | WU-E306 | 1 |
| WU-E404 | Evaluate T-22: Null hazard detection | A | WU-E306 | 1 |
| WU-E405 | Evaluate T-23: Exception propagation | A | WU-E306 | 1 |
| WU-E406 | Evaluate T-24: Dead code detection | A | WU-E306 | 1 |

### Phase 6: Quality Analysis - HARD Scenarios (WU-E501 to WU-E506)

| WU ID | Name | Stream | Dependencies | Est. |
|-------|------|--------|--------------|------|
| WU-E501 | Evaluate T-25: Metaprogramming | A | WU-E406 | 2 |
| WU-E502 | Evaluate T-26: Framework magic | A | WU-E406 | 2 |
| WU-E503 | Evaluate T-27: Security vulnerabilities | A | WU-E406 | 2 |
| WU-E504 | Evaluate T-28: Performance anti-patterns | A | WU-E406 | 2 |
| WU-E505 | Evaluate T-29: Circular dependencies | A | WU-E406 | 1 |
| WU-E506 | Evaluate T-30: Legacy code | A | WU-E406 | 2 |

### Phase 7: Build Constructions (WU-E601 to WU-E606)

| WU ID | Name | Stream | Dependencies | Est. |
|-------|------|--------|--------------|------|
| WU-E601 | Build RefactoringSafetyChecker | B | WU-E003 | 3 |
| WU-E602 | Build BugInvestigationAssistant | B | WU-E003 | 3 |
| WU-E603 | Build FeatureLocationAdvisor | B | WU-E003 | 2 |
| WU-E604 | Build CodeQualityReporter | B | WU-E003 | 3 |
| WU-E605 | Build ArchitectureVerifier | B | WU-E003 | 2 |
| WU-E606 | Build SecurityAuditHelper | B | WU-E003 | 3 |

### Phase 8: Test Constructions (WU-E701 to WU-E706)

| WU ID | Name | Stream | Dependencies | Est. |
|-------|------|--------|--------------|------|
| WU-E701 | Test RefactoringSafetyChecker | C | WU-E601 | 2 |
| WU-E702 | Test BugInvestigationAssistant | C | WU-E602 | 2 |
| WU-E703 | Test FeatureLocationAdvisor | C | WU-E603 | 2 |
| WU-E704 | Test CodeQualityReporter | C | WU-E604 | 2 |
| WU-E705 | Test ArchitectureVerifier | C | WU-E605 | 2 |
| WU-E706 | Test SecurityAuditHelper | C | WU-E606 | 2 |

### Phase 9: Analysis & Report (WU-E801 to WU-E803)

| WU ID | Name | Stream | Dependencies | Est. |
|-------|------|--------|--------------|------|
| WU-E801 | Aggregate quality metrics | All | WU-E506 | 1 |
| WU-E802 | Aggregate construction results | All | WU-E706 | 1 |
| WU-E803 | Generate final evaluation report | All | WU-E801, WU-E802 | 2 |

---

## MASTER STATE

```
CURRENT_PHASE: 1 (Setup)
COMPLETED_UNITS: []
IN_PROGRESS_UNITS: []
BLOCKED_UNITS: []
NEXT_UNITS: [WU-E001, WU-E002, WU-E003]

METRICS:
  quality_tasks_evaluated: 0/30
  constructions_built: 0/6
  constructions_tested: 0/6

AGGREGATE_SCORES:
  navigation_accuracy: pending
  understanding_faithfulness: pending
  modification_recall: pending
  bug_investigation_precision: pending
  hard_scenario_honesty: pending
  construction_utility: pending
```

---

## EXECUTION STRATEGY

### Parallel Execution (3 workers max)

**Wave 1** (parallel): WU-E001
**Wave 2** (after E001): WU-E002, WU-E003 (parallel with E601-E606)
**Wave 3**: Quality analysis tasks (E101-E506) run parallel with construction building (E601-E606)
**Wave 4**: Construction testing (E701-E706)
**Wave 5**: Final analysis (E801-E803)

### Verification After Each Work Unit

```bash
# Verify no regressions
npm test -- --run

# Verify types
npx tsc --noEmit

# Record evidence
echo "WU-EXXX: [status]" >> eval-results/progress.log
```

---

## OUTPUT ARTIFACTS

1. `eval-results/quality-analysis-30-tasks.json` - Per-task metrics
2. `eval-results/constructions-implementation.md` - Construction code + docs
3. `eval-results/construction-test-results.json` - Test outcomes
4. `eval-results/final-evaluation-report.md` - Comprehensive report
5. `eval-results/calibration-curves.png` - Confidence calibration

---

## BEGIN EXECUTION

Starting with **WU-E001: Verify all tests pass**.

If tests fail, fix them first per CODEX_ORCHESTRATOR.md protocol.
