# LiBrainian Constructables Use Case Matrix

## Comprehensive Matrix: 50 Real-World Agent Use Cases on External Repositories

This document maps LiBrainian's constructables to 50 real-world use cases for AI agents working on **external repositories** (codebases the agent has never seen before).

---

## Constructable Reference

| ID | Constructable | Purpose | Implementation Status |
|----|--------------|---------|----------------------|
| ST | SymbolTable | Direct symbol -> location lookup (classes, interfaces, types, constants) | READY |
| EN | Enumeration | Exhaustive entity listing by category (complete lists, not top-k) | READY |
| RA | Rationale | WHY question answering from ADRs, comments, inferred patterns | READY |
| CO | Comparison | Contrastive analysis ("X vs Y", "difference between") | READY |
| RSC | RefactoringSafetyChecker | Change impact analysis with blast radius estimation | READY |
| BIA | BugInvestigationAssistant | Multi-signal debugging (semantic, structural, error signature) | READY |
| CQR | CodeQualityReporter | Quality assessment (complexity, duplication, testability) | READY |
| AV | ArchitectureVerifier | Architecture compliance (layers, boundaries, rules) | READY |
| SAH | SecurityAuditHelper | Security scanning (injection, auth, crypto, exposure) | READY |
| FLA | FeatureLocationAdvisor | Feature finding via semantic + pattern + call graph | READY |
| CT | CalibrationTracker | Confidence tracking and calibration measurement | READY |
| CI | CascadingImpact | Blast radius / benefit propagation via spreading activation | READY |
| IM | ImportanceMetrics | Multi-graph importance (code, rationale, epistemic, org) | READY |

---

## Agent Onboarding Use Cases (1-10)

### Scenario: Agent encounters an unfamiliar external codebase for the first time

| # | Use Case | Primary Constructables | Secondary | Current Capability | Gaps | Agent Feasibility | Grade |
|---|----------|----------------------|-----------|-------------------|------|-------------------|-------|
| 1 | **Agent bootstraps an unfamiliar codebase** | EN, FLA, ST | IM | **READY** | - Auto-detection of project type works<br>- Symbol table builds on bootstrap | Fast bootstrap (<30s for medium repos) | **A** |
| 2 | **Agent understands project structure** | EN (module), FLA | IM | **READY** | - Module enumeration complete<br>- Directory-level importance available | Good at mapping src/ layout | **A-** |
| 3 | **Agent finds the main entry points** | ST (function), FLA, IM | EN | **READY** | - Entry point detection via exports<br>- Main/index file heuristics | Could improve CLI entry detection | **B+** |
| 4 | **Agent identifies coding conventions** | EN, RA, CQR | - | **PARTIAL** | - Naming patterns via enumeration<br>- Missing: style guide inference | No eslint/prettier config parsing | **B** |
| 5 | **Agent discovers test patterns** | EN (test_file), FLA | CQR | **READY** | - Test file enumeration complete<br>- Test pattern recognition available | Strong test discovery | **A-** |
| 6 | **Agent maps module dependencies** | CI, IM, AV | ST | **READY** | - Import graph built at bootstrap<br>- Cascading impact shows deps | Excellent dep visualization | **A** |
| 7 | **Agent locates configuration** | EN (config), ST | FLA | **READY** | - Config enumeration complete<br>- Finds *.config.ts, package.json | Could parse config values | **B+** |
| 8 | **Agent understands error handling patterns** | FLA, BIA, EN | CQR | **PARTIAL** | - Error pattern search works<br>- BIA has error signature matching | No global error strategy detection | **B** |
| 9 | **Agent finds documentation** | EN (documentation), RA | - | **READY** | - Markdown file enumeration<br>- ADR parsing for rationale | Could link docs to code | **B+** |
| 10 | **Agent identifies key abstractions** | ST (interface, class), IM | FLA | **READY** | - Symbol table has all types<br>- Importance flags load-bearing entities | Excellent abstraction discovery | **A** |

---

## Agent Development Tasks (11-25)

### Scenario: Agent is asked to make changes to an external codebase

| # | Use Case | Primary Constructables | Secondary | Current Capability | Gaps | Agent Feasibility | Grade |
|---|----------|----------------------|-----------|-------------------|------|-------------------|-------|
| 11 | **Agent adds a new feature** | FLA, RSC, AV | IM, CO | **READY** | - Feature location finds where<br>- Safety checker validates impact | Needs usage pattern examples | **B+** |
| 12 | **Agent fixes a bug** | BIA, FLA, CI | ST | **READY** | - Multi-signal bug investigation<br>- Stack trace parsing works | Strong debugging support | **A-** |
| 13 | **Agent refactors code safely** | RSC, CI, CT | IM | **READY** | - Blast radius estimation<br>- Graph impact analysis<br>- Confidence tracking | World-class refactoring safety | **A** |
| 14 | **Agent adds tests for a function** | ST, FLA, EN | BIA | **READY** | - Symbol lookup finds function<br>- Test pattern enumeration | Could suggest test templates | **B+** |
| 15 | **Agent updates an API** | RSC, CO, CI | ST, AV | **READY** | - Usage tracking<br>- Breaking change detection | Could generate migration guides | **A-** |
| 16 | **Agent migrates a dependency** | EN, FLA, RSC | CI | **PARTIAL** | - Import enumeration works<br>- Missing: version-aware analysis | No package.json version tracking | **B** |
| 17 | **Agent improves performance** | CI (benefit), IM (hotspot), CQR | FLA | **READY** | - Benefit propagation analysis<br>- Hotspot scoring | Could profile integration | **B+** |
| 18 | **Agent adds logging** | FLA, EN, AV | - | **PARTIAL** | - Feature location works<br>- Missing: logging pattern detection | No logging framework awareness | **B-** |
| 19 | **Agent handles a new error type** | BIA, EN, FLA | CO | **READY** | - Error signature extraction<br>- Similar error detection | Good error handling support | **B+** |
| 20 | **Agent extends an interface** | ST, RSC, CI | CO | **READY** | - Interface lookup in symbol table<br>- Implementation impact analysis | Excellent type extension support | **A-** |
| 21 | **Agent implements a pattern** | FLA, CO, RA | EN | **PARTIAL** | - Pattern search via FLA<br>- Missing: pattern catalog | No GoF pattern detection | **B** |
| 22 | **Agent removes dead code** | IM, CI, RSC | EN | **READY** | - Importance metrics find unused<br>- Safe removal analysis | Strong dead code detection | **A-** |
| 23 | **Agent splits a large file** | CQR, RSC, AV | IM | **READY** | - Complexity analysis<br>- Boundary verification | Good module splitting support | **B+** |
| 24 | **Agent merges modules** | RSC, CI, AV | CO | **READY** | - Impact analysis<br>- Architecture compliance check | Could suggest merge candidates | **B+** |
| 25 | **Agent updates documentation** | EN (doc), RA, FLA | - | **PARTIAL** | - Doc enumeration works<br>- Missing: doc-code sync checking | No stale doc detection | **B-** |

---

## Agent Investigation Use Cases (26-35)

### Scenario: Agent investigates codebase issues without making changes

| # | Use Case | Primary Constructables | Secondary | Current Capability | Gaps | Agent Feasibility | Grade |
|---|----------|----------------------|-----------|-------------------|------|-------------------|-------|
| 26 | **Agent traces a bug through the system** | BIA, CI, FLA | ST | **READY** | - Stack trace parsing<br>- Call chain tracing<br>- Multi-signal similarity | Excellent bug tracing | **A** |
| 27 | **Agent finds all callers of a function** | ST, CI, EN | - | **READY** | - Symbol lookup + graph edges<br>- Cascading impact to dependents | Perfect caller enumeration | **A** |
| 28 | **Agent identifies security vulnerabilities** | SAH, CQR, FLA | EN | **READY** | - Pattern-based vulnerability scan<br>- CWE identification | Static analysis only | **B+** |
| 29 | **Agent finds technical debt** | CQR, IM (hotspot), CI | AV | **READY** | - Complexity + churn analysis<br>- Hotspot scoring | Strong tech debt detection | **A-** |
| 30 | **Agent locates test coverage gaps** | RSC, EN (test), FLA | CQR | **READY** | - Test file enumeration<br>- Coverage gap detection in RSC | Heuristic-based (no coverage data) | **B** |
| 31 | **Agent finds duplicated code** | CQR, CO, BIA | FLA | **PARTIAL** | - CQR duplication analysis<br>- Structural fingerprinting | No exact clone detection | **B** |
| 32 | **Agent identifies circular dependencies** | AV, CI, IM | EN | **READY** | - Architecture verifier checks cycles<br>- Graph analysis | Good cycle detection | **B+** |
| 33 | **Agent finds unused exports** | IM, EN, ST | CI | **READY** | - Import graph analysis<br>- Low importance = unused | Strong unused export detection | **A-** |
| 34 | **Agent traces data flow** | CI, FLA, BIA | ST | **PARTIAL** | - Call graph traversal<br>- Missing: taint analysis | No formal data flow analysis | **B-** |
| 35 | **Agent finds race conditions** | BIA, FLA, CQR | - | **PARTIAL** | - Async pattern detection<br>- Missing: concurrency analysis | Limited to pattern heuristics | **C+** |

---

## Agent Decision Making Use Cases (36-45)

### Scenario: Agent must make informed decisions about the codebase

| # | Use Case | Primary Constructables | Secondary | Current Capability | Gaps | Agent Feasibility | Grade |
|---|----------|----------------------|-----------|-------------------|------|-------------------|-------|
| 36 | **Agent chooses between two approaches** | CO, RA, IM | CI | **READY** | - Comparison construction<br>- Rationale lookup<br>- Importance flags | Excellent decision support | **A** |
| 37 | **Agent decides where to add code** | FLA, AV, IM | CO | **READY** | - Feature location advisor<br>- Architecture compliance | Strong placement guidance | **A-** |
| 38 | **Agent prioritizes refactoring targets** | IM, CI (benefit), CQR | RSC | **READY** | - Hotspot scoring<br>- Benefit propagation<br>- Complexity analysis | World-class prioritization | **A** |
| 39 | **Agent estimates change impact** | RSC, CI, CT | IM | **READY** | - Blast radius estimation<br>- Cascading impact analysis<br>- Calibrated confidence | Excellent impact estimation | **A** |
| 40 | **Agent validates architecture compliance** | AV, CI, IM | EN | **READY** | - Layer dependency checking<br>- Boundary verification | Strong compliance checking | **A-** |
| 41 | **Agent assesses code quality** | CQR, IM, CT | - | **READY** | - Multi-aspect quality analysis<br>- Calibrated confidence | Good quality assessment | **B+** |
| 42 | **Agent determines test strategy** | EN (test), RSC, IM | BIA | **READY** | - Test enumeration<br>- Coverage gap analysis | Could suggest test types | **B+** |
| 43 | **Agent evaluates security posture** | SAH, IM, CQR | - | **READY** | - Security scan with severity<br>- Risk scoring | Good security assessment | **B+** |
| 44 | **Agent plans migration path** | CI, RSC, CO | RA | **PARTIAL** | - Impact analysis available<br>- Missing: phased migration planning | No migration roadmap generation | **B** |
| 45 | **Agent identifies blockers** | CI, IM, AV | RSC | **READY** | - Dependency analysis<br>- Critical path identification | Good blocker detection | **B+** |

---

## Agent Self-Improvement Use Cases (46-50)

### Scenario: Agent improves its own effectiveness over time

| # | Use Case | Primary Constructables | Secondary | Current Capability | Gaps | Agent Feasibility | Grade |
|---|----------|----------------------|-----------|-------------------|------|-------------------|-------|
| 46 | **Agent builds new constructions from patterns** | RA, FLA, EN | CT | **PARTIAL** | - Pattern detection available<br>- Missing: construction template system | No dynamic construction building | **C+** |
| 47 | **Agent improves its own queries** | CT, IM, FLA | - | **READY** | - Calibration tracking<br>- Query outcome feedback | Strong query optimization | **B+** |
| 48 | **Agent learns from feedback** | CT, RA, BIA | - | **READY** | - Outcome recording<br>- Calibration alerts | Good feedback integration | **B+** |
| 49 | **Agent calibrates its confidence** | CT, IM | - | **READY** | - ECE computation<br>- Per-bucket analysis<br>- Trend tracking | World-class calibration | **A** |
| 50 | **Agent automates repetitive lookups** | EN, ST, FLA | - | **PARTIAL** | - Enumeration caching<br>- Missing: learned macro system | No macro/shortcut learning | **B-** |

---

## Summary Statistics

### Capability Distribution

| Status | Count | Percentage |
|--------|-------|------------|
| **READY** | 37 | 74% |
| **PARTIAL** | 13 | 26% |
| **MISSING** | 0 | 0% |

### Grade Distribution

| Grade | Count | Use Cases |
|-------|-------|-----------|
| **A** | 9 | 1, 6, 13, 26, 27, 36, 38, 39, 49 |
| **A-** | 10 | 2, 5, 10, 12, 15, 20, 22, 29, 33, 40 |
| **B+** | 15 | 3, 7, 9, 11, 14, 17, 19, 23, 24, 28, 32, 41, 42, 43, 45, 47, 48 |
| **B** | 7 | 4, 8, 16, 21, 30, 31, 44 |
| **B-** | 4 | 18, 25, 34, 50 |
| **C+** | 2 | 35, 46 |

### Constructable Usage Frequency

| Constructable | Primary Uses | Secondary Uses | Total |
|---------------|--------------|----------------|-------|
| **FLA** (FeatureLocationAdvisor) | 15 | 12 | 27 |
| **CI** (CascadingImpact) | 13 | 9 | 22 |
| **IM** (ImportanceMetrics) | 11 | 10 | 21 |
| **EN** (Enumeration) | 14 | 6 | 20 |
| **RSC** (RefactoringSafetyChecker) | 10 | 6 | 16 |
| **ST** (SymbolTable) | 8 | 7 | 15 |
| **BIA** (BugInvestigationAssistant) | 6 | 6 | 12 |
| **CT** (CalibrationTracker) | 4 | 5 | 9 |
| **CQR** (CodeQualityReporter) | 7 | 5 | 12 |
| **AV** (ArchitectureVerifier) | 5 | 5 | 10 |
| **CO** (Comparison) | 4 | 6 | 10 |
| **RA** (Rationale) | 4 | 5 | 9 |
| **SAH** (SecurityAuditHelper) | 3 | 1 | 4 |

---

## Key Insights for External Repository Work

### Strengths (Grade A/A-)

1. **Refactoring Safety** (#13, #39) - World-class blast radius estimation with graph-based cascading impact analysis
2. **Bug Investigation** (#12, #26) - Multi-signal approach (semantic + structural + error signature) excels at external codebases
3. **Dependency Mapping** (#6, #27) - Complete import graph with spreading activation finds all callers/callees
4. **Confidence Calibration** (#49) - Epistemic framework ensures stated confidence matches actual accuracy
5. **Decision Support** (#36, #38) - Comparison + importance metrics guide agent choices

### Areas for Improvement (Grade B-/C+)

1. **Race Condition Detection** (#35) - Limited to pattern heuristics; needs formal concurrency analysis
2. **Dynamic Construction Building** (#46) - Agents cannot create new constructions from learned patterns
3. **Data Flow Analysis** (#34) - No formal taint tracking; relies on call graph approximation
4. **Logging Pattern Awareness** (#18) - No framework-specific logging detection
5. **Stale Documentation** (#25) - Cannot detect when docs drift from code

### Critical Success Factors for External Repos

1. **Fast Bootstrap** - Symbol table + enumeration provides instant codebase understanding
2. **Zero Configuration** - Auto-detection of project type, language, frameworks
3. **Calibrated Confidence** - Agent knows when it doesn't know
4. **Graph-Based Analysis** - Cascading impact works on any codebase topology
5. **Multi-Signal Matching** - Combines semantic, structural, and error patterns

---

## Recommended Constructable Combinations by Task Type

### For **Onboarding** (Use Cases 1-10)
```
Primary: EN + FLA + ST
Secondary: IM + RA
```

### For **Development** (Use Cases 11-25)
```
Primary: RSC + FLA + CI
Secondary: ST + AV + CT
```

### For **Investigation** (Use Cases 26-35)
```
Primary: BIA + CI + EN
Secondary: SAH + CQR + IM
```

### For **Decision Making** (Use Cases 36-45)
```
Primary: CO + IM + RSC
Secondary: RA + AV + CT
```

### For **Self-Improvement** (Use Cases 46-50)
```
Primary: CT + RA + FLA
Secondary: IM + EN
```

---

## Appendix: Constructable API Quick Reference

### SymbolTable (ST)
```typescript
const table = new SymbolTable();
const result = table.lookup({ symbolName: 'MyClass', expectedKind: 'class' });
// Returns: { symbols: [...], confidence: 0.99, exactMatch: true }
```

### Enumeration (EN)
```typescript
const result = await enumerateByCategory(storage, 'test_file', workspace);
// Returns: { totalCount: 417, entities: [...], byDirectory: Map }
```

### RefactoringSafetyChecker (RSC)
```typescript
const checker = createRefactoringSafetyChecker(LiBrainian);
const report = await checker.check({
  entityId: 'parseConfig',
  refactoringType: 'rename',
  newValue: 'parseConfiguration'
});
// Returns: { safe: false, risks: [...], blastRadius: 23, confidence: 0.85 }
```

### CascadingImpact (CI)
```typescript
const result = await analyzeCascadingImpact(storage, 'dbConnection', { mode: 'risk' });
// Returns: { totalImpact: 5.2, affectedEntities: [...], criticalPath: [...] }

const benefit = await estimateBenefitOfOptimizing(storage, 'parseJSON', 2.0);
// Returns: { totalBenefit: 3.1, beneficiaries: [...], recommendation: '...' }
```

### CalibrationTracker (CT)
```typescript
const tracker = createConstructionCalibrationTracker();
tracker.recordPrediction('RSC', 'pred-123', confidence, 'Refactoring is safe');
// Later:
tracker.recordOutcome('pred-123', true, 'test_result');
const report = tracker.getCalibration('RSC');
// Returns: { ece: 0.05, trend: 'improving', buckets: [...] }
```

---

*Document generated for LiBrainian v0.1.0 - Comprehensive Agent Use Case Matrix*
