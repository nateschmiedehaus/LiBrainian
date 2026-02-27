# Use Case Capability Matrix: Reverse-Engineering LiBrainian Requirements

> **Purpose**: This document reverse-engineers the actual knowledge and thinking capabilities required to effectively support each use case category. It maps capability requirements to existing specs, implementation status, and identifies gaps.
>
> **Philosophy**: This is NOT a simple list of use cases. For each use case, we analyze:
> - What must the system KNOW?
> - What must the system be able to REASON about?
> - What must be BUILDABLE/CONFIGURABLE by users?
> - What GAPS exist between requirements and current capabilities?
>
> **Source References**:
> - [use-case-targets.md](./use-case-targets.md) - Target interfaces for UC 1-20
> - [technique-contracts.md](./technique-contracts.md) - Executable primitive contracts
> - [track-e-domain.md](./track-e-domain.md) - Universal domain support
> - [self-improvement-primitives.md](./self-improvement-primitives.md) - Self-improvement capabilities
> - [GLOSSARY.md](./GLOSSARY.md) - Canonical definitions

---

## Table of Contents

1. [Capability Framework](#capability-framework)
2. [Development Use Cases (UC-D01 to UC-D20)](#development-use-cases)
3. [Operations Use Cases (UC-O01 to UC-O10)](#operations-use-cases)
4. [Team Use Cases (UC-T01 to UC-T10)](#team-use-cases)
5. [Planning Use Cases (UC-P01 to UC-P10)](#planning-use-cases)
6. [Cross-Cutting Capability Summary](#cross-cutting-capability-summary)
7. [Gap Analysis Summary](#gap-analysis-summary)
8. [Primitive/Composition Requirements Map](#primitivecomposition-requirements-map)

---

## Capability Framework

### Knowledge Requirement Categories

| Category | Code | Description |
|----------|------|-------------|
| **Entities** | K-ENT | What discrete things must be known (files, functions, people, decisions) |
| **Relationships** | K-REL | What connections between entities (calls, imports, ownership, causality) |
| **Context** | K-CTX | What surrounding knowledge (domain, conventions, constraints, goals) |
| **External** | K-EXT | What outside knowledge (docs, standards, best practices, vulnerabilities) |

### Thinking Capability Categories

| Category | Code | Description |
|----------|------|-------------|
| **Causal** | T-CAU | Why did X happen? What would happen if Y? |
| **Counterfactual** | T-CTF | What if we had done Z instead? |
| **Planning** | T-PLN | How do we get from A to B? |
| **Diagnosis** | T-DIA | What's wrong and why? |
| **Synthesis** | T-SYN | Combine multiple sources into coherent answer |
| **Evaluation** | T-EVL | Is this good? By what criteria? |

### Constructability Categories

| Category | Code | Description |
|----------|------|-------------|
| **Primitives** | C-PRM | Custom atomic operations for domain-specific needs |
| **Compositions** | C-CMP | Custom workflow patterns combining primitives |
| **Knowledge Sources** | C-KSR | Custom external APIs, databases, docs |
| **Evaluation Criteria** | C-EVL | Custom quality/success metrics |

---

## Development Use Cases

### UC-D01: Bug Investigation

**Scenario**: Agent investigating "TypeError: Cannot read property 'user' of undefined"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D01-K01 | K-ENT | Stack trace locations (file, line, function) | track-a P3 (LCL) | Partial | No stack trace parser primitive |
| D01-K02 | K-ENT | Variable states at crash point | - | No | Missing runtime state capture |
| D01-K03 | K-REL | Call chain leading to error | track-a P1 (Operators) | Partial | Call graph exists, not correlated to stack |
| D01-K04 | K-REL | Data flow to undefined value | track-e D1 (tp_data_lineage) | Spec only | Not implemented |
| D01-K05 | K-CTX | Error handling conventions in codebase | track-c P13 (Learning) | Partial | No pattern extraction for error handling |
| D01-K06 | K-CTX | Recent changes to affected code | - | No | Missing git correlation primitive |
| D01-K07 | K-EXT | Related issues in tracker | use-case-targets UC1 | No | No issue tracker integration |
| D01-K08 | K-EXT | Similar errors in logs | use-case-targets UC1 | No | No log integration |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D01-T01 | T-CAU | Determine WHY value is undefined | - | No | Requires causal reasoning over data flow |
| D01-T02 | T-DIA | Isolate root cause vs symptom | technique-contracts | Spec only | tp_root_cause not executable |
| D01-T03 | T-CTF | Predict: "Would fix X prevent this?" | - | No | No counterfactual reasoning framework |
| D01-T04 | T-SYN | Correlate error with recent changes | - | No | No git-error correlation |
| D01-T05 | T-EVL | Assess completeness of investigation | use-case-targets UC1 | Spec only | No coverage estimation |

#### Constructability Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D01-C01 | C-PRM | Custom error pattern matchers | technique-contracts | Framework only | No domain-specific error patterns |
| D01-C02 | C-KSR | Issue tracker API integration | - | No | No external knowledge source framework |
| D01-C03 | C-KSR | Log aggregation integration | - | No | No log source adapter |

#### New Primitives Needed

```typescript
tp_parse_stack_trace: {
  inputs: ['stackTrace: string', 'language: string'],
  outputs: ['frames: StackFrame[]', 'errorType: string', 'message: string'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'regex_parse' }
}

tp_correlate_git_changes: {
  inputs: ['entityId: EntityId', 'timeRange: TimeRange'],
  outputs: ['commits: Commit[]', 'authors: Author[]', 'changeType: ChangeType'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_trace_undefined_source: {
  inputs: ['variablePath: string', 'errorLocation: Location'],
  outputs: ['possibleSources: DataFlowPath[]', 'likelySource: DataFlowPath'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}
```

---

### UC-D02: Feature Implementation

**Scenario**: Agent receives "Add rate limiting to the API"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D02-K01 | K-ENT | All API endpoints | track-e D5 (API primitives) | Spec only | Not implemented |
| D02-K02 | K-ENT | Existing middleware chain | - | No | No middleware analysis primitive |
| D02-K03 | K-REL | Request flow through system | track-e D1 (tp_data_lineage) | Spec only | Not implemented |
| D02-K04 | K-REL | Shared state (e.g., rate limit counters) | track-e D1 (tp_state_trace) | Spec only | Not implemented |
| D02-K05 | K-CTX | Project conventions for middleware | track-c P13 | Partial | Pattern extraction incomplete |
| D02-K06 | K-CTX | Performance requirements | - | No | No SLA/requirements knowledge |
| D02-K07 | K-EXT | Rate limiting best practices | - | No | No external docs integration |
| D02-K08 | K-EXT | Similar implementations in ecosystem | - | No | No ecosystem knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D02-T01 | T-PLN | Design feature architecture | track-a P2 (Compositions) | Partial | Selection is keyword-based, not semantic |
| D02-T02 | T-PLN | Sequence implementation steps | use-case-targets UC2 | Spec only | EnrichedWorkNode not implemented |
| D02-T03 | T-EVL | Estimate complexity/effort | use-case-targets UC2 | Spec only | No estimation framework |
| D02-T04 | T-SYN | Identify all affected locations | track-a P6 (Advisor) | Implemented | Works |
| D02-T05 | T-CTF | "What if we use approach X vs Y?" | - | No | No tradeoff analysis framework |

#### Constructability Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D02-C01 | C-CMP | Feature implementation workflow | track-a P7 (Evolution) | Implemented | Compositions customizable |
| D02-C02 | C-EVL | Feature completeness criteria | - | No | No custom acceptance criteria framework |
| D02-C03 | C-KSR | Architecture decision records | track-e D9 | Spec only | Not implemented |

---

### UC-D03: Refactoring

**Scenario**: "Refactor the user service to use dependency injection"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D03-K01 | K-ENT | All classes and their dependencies | track-a P1 | Implemented | Via AST/graph |
| D03-K02 | K-ENT | All instantiation sites | - | No | No constructor call analysis |
| D03-K03 | K-REL | Dependency graph (who needs whom) | track-a P5 (Patterns) | Implemented | Basic graph exists |
| D03-K04 | K-REL | Coupling metrics | analysis/technical_debt | Partial | Coupling analysis exists |
| D03-K05 | K-CTX | Current DI patterns in codebase | track-c P13 | Partial | Pattern extraction incomplete |
| D03-K06 | K-CTX | Test coverage of affected code | track-e D11 | Spec only | Not implemented |
| D03-K07 | K-EXT | DI best practices for language | - | No | No external knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D03-T01 | T-PLN | Safe incremental refactoring path | use-case-targets UC7 | Spec only | RefactoringStep not executable |
| D03-T02 | T-DIA | Identify coupling hotspots | analysis/technical_debt | Implemented | Basic metrics |
| D03-T03 | T-EVL | Verify each step preserves behavior | use-case-targets UC7 | Spec only | No verification execution |
| D03-T04 | T-CAU | "Why is this tightly coupled?" | - | No | No historical coupling analysis |
| D03-T05 | T-CTF | "What breaks if we change X?" | - | No | Impact analysis incomplete |

#### New Primitives Needed

```typescript
tp_analyze_coupling: {
  inputs: ['entityId: EntityId', 'couplingType: CouplingType'],
  outputs: ['coupledEntities: EntityId[]', 'couplingStrength: number', 'couplingType: string'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'static_analysis' }
}

tp_plan_safe_refactor: {
  inputs: ['sourcePattern: Pattern', 'targetPattern: Pattern', 'scope: EntityId[]'],
  outputs: ['steps: RefactoringStep[]', 'checkpoints: Checkpoint[]', 'risks: Risk[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_verify_behavior_preserved: {
  inputs: ['before: Snapshot', 'after: Snapshot', 'testSuite: TestSuite'],
  outputs: ['preserved: boolean', 'failures: TestFailure[]', 'coverage: CoverageReport'],
  confidence: { type: 'measured', measurement: { /* from test results */ } }
}
```

---

### UC-D04: Debugging

**Scenario**: "Why is the authentication failing intermittently?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D04-K01 | K-ENT | Authentication code paths | track-e D1 | Spec only | tp_state_trace not implemented |
| D04-K02 | K-ENT | Session/token handling code | - | No | No auth-specific primitives |
| D04-K03 | K-REL | Race conditions in auth flow | - | No | No concurrency analysis |
| D04-K04 | K-REL | External service dependencies | track-e D1 (tp_distribution_map) | Spec only | Not implemented |
| D04-K05 | K-CTX | "Intermittent" pattern (timing, load) | - | No | No temporal pattern analysis |
| D04-K06 | K-EXT | Related log entries | - | No | No log integration |
| D04-K07 | K-EXT | Metrics (error rates, latencies) | - | No | No metrics integration |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D04-T01 | T-DIA | Generate hypotheses for intermittent failure | use-case-targets UC4 | Spec only | Hypothesis[] not generated |
| D04-T02 | T-DIA | Rank hypotheses by likelihood | use-case-targets UC4 | Spec only | RankedHypothesis not implemented |
| D04-T03 | T-CAU | Trace causal chain from symptom to root | self-improvement tp_verify_claim | Partial | Evidence chain exists |
| D04-T04 | T-PLN | Design diagnostic experiment | - | No | No experiment planning |
| D04-T05 | T-SYN | Correlate timing with external factors | - | No | No temporal correlation |

#### New Primitives Needed

```typescript
tp_generate_hypotheses: {
  inputs: ['symptom: Symptom', 'context: ContextPack[]', 'maxHypotheses: number'],
  outputs: ['hypotheses: Hypothesis[]', 'ranking: number[]', 'evidence: Evidence[][]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_analyze_race_conditions: {
  inputs: ['entryPoint: EntityId', 'sharedState: EntityId[]'],
  outputs: ['races: RaceCondition[]', 'recommendations: string[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_correlate_temporal_patterns: {
  inputs: ['events: Event[]', 'timeWindow: Duration', 'pattern: PatternType'],
  outputs: ['correlations: Correlation[]', 'anomalies: Anomaly[]'],
  confidence: { type: 'measured', measurement: { /* from historical accuracy */ } }
}
```

---

### UC-D05: Code Review

**Scenario**: Reviewer needs context for a PR with 15 changed files

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D05-K01 | K-ENT | All changed functions/classes | - | No | No diff-aware entity extraction |
| D05-K02 | K-ENT | Test files covering changes | - | No | No test-code mapping |
| D05-K03 | K-REL | Callers of changed code | track-a P1 | Implemented | Call graph exists |
| D05-K04 | K-REL | Impact on downstream consumers | use-case-targets UC6 | Spec only | ConsumerImpact not implemented |
| D05-K05 | K-CTX | Project coding standards | - | No | No style guide knowledge |
| D05-K06 | K-CTX | Historical issues in affected areas | use-case-targets UC6 | Spec only | No issue correlation |
| D05-K07 | K-EXT | Similar PRs and their outcomes | use-case-targets UC6 | Spec only | Episode[] retrieval incomplete |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D05-T01 | T-EVL | "Is this change safe?" | - | No | No safety evaluation framework |
| D05-T02 | T-DIA | "What could break?" | use-case-targets UC6 | Spec only | ImpactAssessment not implemented |
| D05-T03 | T-SYN | Generate review checklist | use-case-targets UC6 | Spec only | ReviewChecklist not implemented |
| D05-T04 | T-CTF | "What if this edge case occurs?" | - | No | No edge case reasoning |
| D05-T05 | T-EVL | "Does this follow best practices?" | - | No | No practice evaluation |

#### New Primitives Needed

```typescript
tp_analyze_diff: {
  inputs: ['diff: Diff', 'baseRef: GitRef'],
  outputs: ['changedEntities: EntityId[]', 'changeTypes: ChangeType[]', 'complexity: number'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'diff_parse' }
}

tp_assess_change_impact: {
  inputs: ['changedEntities: EntityId[]', 'impactScope: ImpactScope'],
  outputs: ['affectedConsumers: Consumer[]', 'riskLevel: RiskLevel', 'testGaps: TestGap[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_generate_review_checklist: {
  inputs: ['changes: Change[]', 'projectContext: ProjectContext'],
  outputs: ['checklist: ChecklistItem[]', 'focusAreas: FocusArea[]', 'risks: Risk[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}
```

---

### UC-D06: Testing

**Scenario**: "What important code paths are not covered by tests?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D06-K01 | K-ENT | All testable code paths | - | No | No path enumeration primitive |
| D06-K02 | K-ENT | Existing test cases | - | No | No test discovery primitive |
| D06-K03 | K-REL | Test -> Code coverage mapping | - | No | No coverage analysis |
| D06-K04 | K-REL | Code complexity vs test coverage | - | No | No risk-weighted coverage |
| D06-K05 | K-CTX | Testing conventions in project | - | No | No test pattern extraction |
| D06-K06 | K-EXT | Testing best practices for domain | - | No | No external knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D06-T01 | T-EVL | Prioritize coverage gaps by risk | use-case-targets UC11 | Spec only | RiskWeightedReport not implemented |
| D06-T02 | T-PLN | Generate test cases for gaps | use-case-targets UC11 | Spec only | TestCase[] generation not implemented |
| D06-T03 | T-SYN | Identify mock requirements | use-case-targets UC11 | Spec only | MockRequirement[] not implemented |
| D06-T04 | T-CAU | "Why is this path untested?" | - | No | No historical analysis |

#### New Primitives Needed

```typescript
tp_enumerate_code_paths: {
  inputs: ['entryPoint: EntityId', 'maxDepth: number'],
  outputs: ['paths: CodePath[]', 'branchPoints: BranchPoint[]', 'complexity: number'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'static_analysis' }
}

tp_map_test_coverage: {
  inputs: ['testFiles: string[]', 'codeFiles: string[]'],
  outputs: ['coverageMap: CoverageMap', 'uncoveredPaths: CodePath[]', 'coveragePercent: number'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'coverage_tool' }
}

tp_generate_test_skeleton: {
  inputs: ['targetEntity: EntityId', 'testFramework: string'],
  outputs: ['testCode: string', 'mocks: MockRequirement[]', 'assertions: Assertion[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}
```

---

### UC-D07: Documentation

**Scenario**: "Generate documentation for our internal SDK"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D07-K01 | K-ENT | Public API surface | track-e D5 | Spec only | API primitives not implemented |
| D07-K02 | K-ENT | Type definitions | track-a P1 | Implemented | Via AST |
| D07-K03 | K-REL | API usage examples in codebase | - | No | No usage pattern extraction |
| D07-K04 | K-REL | Concept relationships | - | No | No concept graph |
| D07-K05 | K-CTX | Documentation conventions | - | No | No doc style knowledge |
| D07-K06 | K-EXT | Industry doc standards | - | No | No external knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D07-T01 | T-SYN | Infer documentation structure | use-case-targets UC13 | Spec only | DocStructure not implemented |
| D07-T02 | T-SYN | Generate examples from usage | use-case-targets UC13 | Spec only | Example[] generation not implemented |
| D07-T03 | T-EVL | Assess documentation completeness | use-case-targets UC13 | Spec only | DocCoverageReport not implemented |
| D07-T04 | T-PLN | Organize content by audience | - | No | No audience-aware organization |

---

### UC-D08: Performance Optimization

**Scenario**: "Why is the dashboard loading slowly?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D08-K01 | K-ENT | Performance-critical code paths | track-e D1 (tp_timing_bound) | Spec only | Not implemented |
| D08-K02 | K-ENT | Database queries | - | No | No query analysis primitive |
| D08-K03 | K-REL | Request waterfall | - | No | No request tracing |
| D08-K04 | K-REL | Caching layers | - | No | No cache analysis |
| D08-K05 | K-CTX | Performance SLAs | - | No | No SLA knowledge |
| D08-K06 | K-EXT | Profiling data | use-case-targets UC9 | Spec only | No profiling integration |
| D08-K07 | K-EXT | Industry benchmarks | - | No | No benchmark knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D08-T01 | T-DIA | Identify performance hotspots | use-case-targets UC9 | Spec only | Hotspot[] not implemented |
| D08-T02 | T-CAU | "Why is this slow?" | - | No | No performance root cause analysis |
| D08-T03 | T-PLN | Suggest optimizations | use-case-targets UC9 | Spec only | Optimization[] not implemented |
| D08-T04 | T-EVL | Estimate optimization impact | use-case-targets UC9 | Spec only | ImpactEstimate not implemented |
| D08-T05 | T-CTF | "What if we cache X?" | - | No | No caching impact prediction |

#### New Primitives Needed

```typescript
tp_analyze_query_performance: {
  inputs: ['queryLocation: EntityId', 'schemaContext: SchemaContext'],
  outputs: ['complexity: QueryComplexity', 'nPlusOne: boolean', 'suggestions: Optimization[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_identify_hotspots: {
  inputs: ['profileData: Profile', 'threshold: number'],
  outputs: ['hotspots: Hotspot[]', 'callTree: CallTree', 'recommendations: string[]'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'profile_analysis' }
}

tp_suggest_caching: {
  inputs: ['dataFlow: DataFlow', 'accessPatterns: AccessPattern[]'],
  outputs: ['cachingOpportunities: CachingOpportunity[]', 'estimatedSavings: Duration'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}
```

---

### UC-D09: Security Hardening

**Scenario**: "Audit the API endpoints for security vulnerabilities"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D09-K01 | K-ENT | All API endpoints and inputs | track-e D3 | Spec only | Security primitives spec only |
| D09-K02 | K-ENT | Authentication/authorization code | - | No | No auth flow analysis |
| D09-K03 | K-REL | Data flow from input to sensitive ops | track-e D1 (tp_data_lineage) | Spec only | Not implemented |
| D09-K04 | K-REL | Trust boundaries | - | No | No trust boundary analysis |
| D09-K05 | K-CTX | Security policies | - | No | No policy knowledge |
| D09-K06 | K-EXT | OWASP Top 10 | track-e D3 (tp_owasp_check) | Spec only | Not implemented |
| D09-K07 | K-EXT | CVE database | track-e D3 (tp_vulnerability_check) | Spec only | Not implemented |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D09-T01 | T-DIA | Identify vulnerabilities | track-e D3 | Spec only | Not executable |
| D09-T02 | T-EVL | Assess risk level | track-e D3 | Spec only | RiskScore not implemented |
| D09-T03 | T-PLN | Prioritize remediation | use-case-targets UC8 | Spec only | Remediation[] not implemented |
| D09-T04 | T-CAU | Trace attack vectors | - | No | No attack vector analysis |
| D09-T05 | T-SYN | Generate threat model | use-case-targets UC8 | Spec only | ThreatModel not implemented |

---

### UC-D10: Dependency Management

**Scenario**: "Plan upgrade of React from 17 to 18"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D10-K01 | K-ENT | All usages of React APIs | - | No | No API usage analysis |
| D10-K02 | K-ENT | Transitive dependencies | track-e D3 (tp_dependency_audit) | Spec only | Not implemented |
| D10-K03 | K-REL | Peer dependency compatibility | - | No | No compatibility analysis |
| D10-K04 | K-REL | Breaking change impact | - | No | No breaking change mapping |
| D10-K05 | K-EXT | Changelog/migration guide | - | No | No changelog integration |
| D10-K06 | K-EXT | Community migration experiences | - | No | No community knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D10-T01 | T-PLN | Generate migration steps | use-case-targets UC12 | Spec only | MigrationStep[] not implemented |
| D10-T02 | T-DIA | Identify breaking changes | use-case-targets UC12 | Spec only | BreakingChange[] not implemented |
| D10-T03 | T-EVL | Estimate migration effort | use-case-targets UC12 | Spec only | EffortEstimate not implemented |
| D10-T04 | T-CTF | "What if we stay on old version?" | - | No | No risk projection |

---

### UC-D11: API Design

**Scenario**: "Review our REST API design for consistency and best practices"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D11-K01 | K-ENT | All endpoints (paths, methods, params) | track-e D5 | Spec only | Not implemented |
| D11-K02 | K-ENT | Response schemas | - | No | No schema extraction |
| D11-K03 | K-REL | Naming consistency patterns | - | No | No naming analysis |
| D11-K04 | K-CTX | API versioning strategy | - | No | No versioning knowledge |
| D11-K05 | K-EXT | RESTful best practices | - | No | No external knowledge |
| D11-K06 | K-EXT | OpenAPI/Swagger standards | - | No | No spec knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D11-T01 | T-EVL | Assess consistency | use-case-targets UC10 | Spec only | ConsistencyReport not implemented |
| D11-T02 | T-EVL | Check RESTful conventions | use-case-targets UC10 | Spec only | ConventionViolation[] not implemented |
| D11-T03 | T-DIA | Detect breaking changes | use-case-targets UC10 | Spec only | BreakingChange[] not implemented |
| D11-T04 | T-SYN | Generate OpenAPI spec | use-case-targets UC10 | Spec only | OpenAPISpec not implemented |

---

### UC-D12: Database Design

**Scenario**: "Design the schema for a new feature"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D12-K01 | K-ENT | Existing schema | - | No | No schema extraction primitive |
| D12-K02 | K-ENT | Entity relationships | - | No | No ER diagram extraction |
| D12-K03 | K-REL | Query patterns | - | No | No query usage analysis |
| D12-K04 | K-REL | Index usage | - | No | No index analysis |
| D12-K05 | K-CTX | Database conventions | - | No | No naming/type conventions |
| D12-K06 | K-EXT | Normalization best practices | - | No | No external knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D12-T01 | T-PLN | Design new tables/relations | - | No | No schema design assistance |
| D12-T02 | T-EVL | Assess normalization level | - | No | No normalization analysis |
| D12-T03 | T-CTF | "What if we denormalize X?" | - | No | No tradeoff analysis |
| D12-T04 | T-DIA | Identify potential performance issues | - | No | No schema performance analysis |

---

### UC-D13: Migration Planning

**Scenario**: "Plan data migration from PostgreSQL to DynamoDB"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D13-K01 | K-ENT | Source schema | - | No | No schema extraction |
| D13-K02 | K-ENT | Target constraints | - | No | No target system knowledge |
| D13-K03 | K-REL | Data access patterns | - | No | No access pattern analysis |
| D13-K04 | K-REL | Data volume/growth | - | No | No data statistics |
| D13-K05 | K-CTX | Downtime tolerance | - | No | No operational constraints |
| D13-K06 | K-EXT | Migration best practices | - | No | No migration knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D13-T01 | T-PLN | Design migration strategy | - | No | No migration planning |
| D13-T02 | T-EVL | Assess risk | - | No | No migration risk analysis |
| D13-T03 | T-DIA | Identify schema incompatibilities | - | No | No schema comparison |
| D13-T04 | T-CTF | "What if migration fails at step X?" | - | No | No rollback planning |

---

### UC-D14: Technical Debt Reduction

**Scenario**: "Identify and prioritize our technical debt"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D14-K01 | K-ENT | Code quality metrics | analysis/technical_debt | Implemented | Basic metrics exist |
| D14-K02 | K-ENT | TODO/FIXME/HACK comments | - | No | No comment extraction |
| D14-K03 | K-REL | Debt interconnections | - | No | No debt dependency graph |
| D14-K04 | K-REL | Debt-incident correlation | use-case-targets UC15 | Spec only | Incident[] not integrated |
| D14-K05 | K-CTX | Business impact | use-case-targets UC15 | Spec only | BusinessImpact not implemented |
| D14-K06 | K-EXT | Industry debt metrics | - | No | No external benchmarks |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D14-T01 | T-DIA | Identify debt items | analysis/technical_debt | Implemented | Basic detection |
| D14-T02 | T-EVL | Prioritize by business impact | use-case-targets UC15 | Spec only | Not implemented |
| D14-T03 | T-PLN | Create remediation plan | use-case-targets UC15 | Spec only | RemediationPlan not implemented |
| D14-T04 | T-CAU | "Why did this debt accumulate?" | - | No | No historical analysis |

---

### UC-D15: Architecture Evolution

**Scenario**: "Should we migrate to microservices?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D15-K01 | K-ENT | Current module boundaries | track-a P5 | Implemented | Basic patterns |
| D15-K02 | K-ENT | Service boundaries (if any) | - | No | No service extraction |
| D15-K03 | K-REL | Cross-module coupling | analysis/technical_debt | Partial | Basic coupling metrics |
| D15-K04 | K-REL | Data sharing patterns | - | No | No shared data analysis |
| D15-K05 | K-CTX | Team structure | - | No | No team knowledge |
| D15-K06 | K-EXT | Architecture patterns | - | No | No pattern library |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| D15-T01 | T-EVL | Assess current architecture | self-improvement tp_analyze_architecture | Spec only | Not executable |
| D15-T02 | T-CTF | Analyze tradeoffs | use-case-targets UC17 | Spec only | TradeoffMatrix not implemented |
| D15-T03 | T-PLN | Plan evolution path | - | No | No evolution planning |
| D15-T04 | T-CAU | "Why is current architecture like this?" | - | No | No architectural archaeology |

---

### UC-D16 to UC-D20: Additional Development Use Cases

For brevity, the following use cases follow similar patterns:

| Use Case | Key Gaps |
|----------|----------|
| **UC-D16: Code Clone Detection** | tp_code_clone_analysis exists but no deduplication planner |
| **UC-D17: Error Handling Standardization** | No error pattern extraction, no standardization planner |
| **UC-D18: Logging Improvement** | No logging pattern analysis, no structured logging advisor |
| **UC-D19: Configuration Management** | No config analysis primitive, no secret detection |
| **UC-D20: Build System Optimization** | No build graph analysis, no optimization suggestions |

---

## Operations Use Cases

### UC-O01: Incident Investigation

**Scenario**: "Production is down, investigate the root cause"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| O01-K01 | K-ENT | Affected services/components | - | No | No runtime topology |
| O01-K02 | K-ENT | Recent deployments | - | No | No deployment tracking |
| O01-K03 | K-REL | Service dependencies | track-e D2 (tc_industrial_backend) | Spec only | Not implemented |
| O01-K04 | K-REL | Error propagation paths | - | No | No error flow analysis |
| O01-K05 | K-CTX | Normal vs abnormal behavior | - | No | No baseline knowledge |
| O01-K06 | K-EXT | Log entries | use-case-targets UC16 | Spec only | No log integration |
| O01-K07 | K-EXT | Metrics/alerts | - | No | No metrics integration |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| O01-T01 | T-DIA | Identify triggering event | use-case-targets UC16 | Spec only | Event not implemented |
| O01-T02 | T-CAU | Trace causal chain | - | No | No causal analysis |
| O01-T03 | T-SYN | Construct timeline | use-case-targets UC16 | Spec only | IncidentTimeline not implemented |
| O01-T04 | T-PLN | Suggest immediate mitigation | use-case-targets UC16 | Spec only | Mitigation[] not implemented |
| O01-T05 | T-SYN | Generate runbook | use-case-targets UC16 | Spec only | Runbook not implemented |

#### New Primitives Needed

```typescript
tp_correlate_logs: {
  inputs: ['timeRange: TimeRange', 'filters: LogFilter[]'],
  outputs: ['correlatedLogs: CorrelatedLogs', 'anomalies: Anomaly[]', 'patterns: Pattern[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_trace_error_propagation: {
  inputs: ['errorEvent: Event', 'serviceGraph: ServiceGraph'],
  outputs: ['propagationPath: Service[]', 'rootService: Service', 'affectedServices: Service[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_construct_incident_timeline: {
  inputs: ['events: Event[]', 'deployments: Deployment[]', 'alerts: Alert[]'],
  outputs: ['timeline: IncidentTimeline', 'triggeringEvent: Event', 'contributingFactors: Factor[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}
```

---

### UC-O02: Root Cause Analysis

**Scenario**: "Why did the payment failures spike yesterday?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| O02-K01 | K-ENT | Payment code paths | track-e D2 (tc_payment_system) | Spec only | Not implemented |
| O02-K02 | K-ENT | External service dependencies | - | No | No external dependency map |
| O02-K03 | K-REL | Correlation with changes | - | No | No deployment correlation |
| O02-K04 | K-REL | Correlation with load | - | No | No load correlation |
| O02-K05 | K-EXT | Historical failure patterns | - | No | No historical analysis |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| O02-T01 | T-CAU | Identify root cause(s) | technique-contracts tp_root_cause | Spec only | Not executable |
| O02-T02 | T-DIA | Distinguish correlation vs causation | - | No | No causal inference |
| O02-T03 | T-SYN | Generate postmortem template | use-case-targets UC16 | Spec only | PostmortemTemplate not implemented |

---

### UC-O03: Capacity Planning

**Scenario**: "Will our infrastructure handle 10x traffic?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| O03-K01 | K-ENT | Resource bottlenecks | - | No | No bottleneck analysis |
| O03-K02 | K-ENT | Scaling constraints | - | No | No scaling analysis |
| O03-K03 | K-REL | Resource dependencies | - | No | No resource graph |
| O03-K04 | K-CTX | Current utilization | - | No | No metrics integration |
| O03-K05 | K-EXT | Cloud scaling capabilities | - | No | No infrastructure knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| O03-T01 | T-PLN | Project resource needs | - | No | No capacity modeling |
| O03-T02 | T-CTF | "What if traffic 10x?" | - | No | No scaling projection |
| O03-T03 | T-EVL | Identify bottlenecks | - | No | No bottleneck prediction |

---

### UC-O04: Deployment Verification

**Scenario**: "Verify the new deployment is working correctly"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| O04-K01 | K-ENT | Deployed changes | - | No | No deployment diff |
| O04-K02 | K-ENT | Health check endpoints | - | No | No health endpoint discovery |
| O04-K03 | K-REL | Affected functionality | - | No | No change-function mapping |
| O04-K04 | K-CTX | Success criteria | - | No | No deployment criteria |
| O04-K05 | K-EXT | Monitoring dashboards | - | No | No dashboard integration |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| O04-T01 | T-EVL | Assess deployment health | - | No | No health assessment |
| O04-T02 | T-DIA | Detect anomalies | - | No | No anomaly detection |
| O04-T03 | T-PLN | Generate verification checklist | use-case-targets UC5 | Spec only | VerificationChecklist not implemented |

---

### UC-O05: Rollback Planning

**Scenario**: "Plan rollback for the release if issues occur"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| O05-K01 | K-ENT | Database migrations | - | No | No migration tracking |
| O05-K02 | K-ENT | State changes | - | No | No state change analysis |
| O05-K03 | K-REL | Rollback dependencies | - | No | No dependency analysis |
| O05-K04 | K-CTX | Rollback constraints | - | No | No constraint knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| O05-T01 | T-PLN | Design rollback steps | use-case-targets UC7 | Spec only | RollbackPlan not implemented |
| O05-T02 | T-DIA | Identify blocking factors | - | No | No blocker analysis |
| O05-T03 | T-CTF | "Can we rollback migration X?" | - | No | No reversibility analysis |

---

### UC-O06 to UC-O10: Additional Operations Use Cases

| Use Case | Key Gaps |
|----------|----------|
| **UC-O06: Monitoring Setup** | No metrics discovery, no alert rule generation |
| **UC-O07: Alerting Configuration** | No alert pattern analysis, no threshold recommendation |
| **UC-O08: Runbook Creation** | No procedure extraction, no runbook templating |
| **UC-O09: SLA Compliance** | No SLA tracking, no violation prediction |
| **UC-O10: Cost Optimization** | No resource cost analysis, no optimization suggestions |

---

## Team Use Cases

### UC-T01: Developer Onboarding

**Scenario**: "Create an onboarding guide for a new backend developer"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| T01-K01 | K-ENT | Core modules by importance | use-case-targets UC14 | Spec only | Area[] prioritization not implemented |
| T01-K02 | K-ENT | Team experts per area | use-case-targets UC18 | Spec only | Expert[] not implemented |
| T01-K03 | K-REL | Concept prerequisites | use-case-targets UC14 | Spec only | Prerequisite[] not implemented |
| T01-K04 | K-REL | Learning dependencies | - | No | No learning path graph |
| T01-K05 | K-CTX | Role-specific relevance | use-case-targets UC14 | Spec only | DeveloperRole not implemented |
| T01-K06 | K-EXT | Getting started docs | - | No | No doc integration |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| T01-T01 | T-PLN | Create learning path | use-case-targets UC14 | Spec only | LearningPath not implemented |
| T01-T02 | T-SYN | Generate concept explanations | use-case-targets UC14 | Spec only | Explanation not implemented |
| T01-T03 | T-EVL | Estimate learning time | use-case-targets UC14 | Spec only | TimeEstimate not implemented |
| T01-T04 | T-PLN | Suggest starter tasks | use-case-targets UC14 | Spec only | StarterTask[] not implemented |

#### New Primitives Needed

```typescript
tp_identify_core_concepts: {
  inputs: ['codebase: Codebase', 'role: DeveloperRole'],
  outputs: ['concepts: Concept[]', 'importanceRanking: number[]', 'dependencies: ConceptGraph'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_generate_learning_path: {
  inputs: ['concepts: Concept[]', 'priorKnowledge: string[]', 'availableTime: Duration'],
  outputs: ['path: LearningPath', 'milestones: Milestone[]', 'resources: Resource[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_suggest_starter_tasks: {
  inputs: ['codebase: Codebase', 'skillLevel: SkillLevel', 'interests: string[]'],
  outputs: ['tasks: StarterTask[]', 'estimatedDifficulty: Difficulty[]', 'learningValue: number[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}
```

---

### UC-T02: Knowledge Transfer

**Scenario**: "Document the payment system before the expert leaves"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| T02-K01 | K-ENT | Key code components | track-a P6 | Implemented | Advisor exists |
| T02-K02 | K-ENT | Undocumented decisions | - | No | No decision extraction |
| T02-K03 | K-REL | Implicit dependencies | use-case-targets UC18 | Spec only | HiddenDep[] not implemented |
| T02-K04 | K-CTX | Historical context | - | No | No git archaeology |
| T02-K05 | K-CTX | Known gotchas | - | No | No gotcha extraction |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| T02-T01 | T-SYN | Extract tribal knowledge | use-case-targets UC18 | Spec only | TribalKnowledge not implemented |
| T02-T02 | T-DIA | Identify knowledge gaps | - | No | No gap analysis |
| T02-T03 | T-PLN | Structure knowledge base | use-case-targets UC18 | Spec only | KnowledgeBase not implemented |

---

### UC-T03: Code Archaeology

**Scenario**: "Understand why this weird pattern exists"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| T03-K01 | K-ENT | Code evolution over time | - | No | No temporal analysis |
| T03-K02 | K-ENT | Related commits | - | No | No commit correlation |
| T03-K03 | K-REL | Author intentions | - | No | No commit message analysis |
| T03-K04 | K-REL | Related issues/PRs | - | No | No VCS integration |
| T03-K05 | K-CTX | Contemporary constraints | - | No | No historical context |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| T03-T01 | T-CAU | "Why was this written this way?" | - | No | No intentional reasoning |
| T03-T02 | T-SYN | Reconstruct decision timeline | - | No | No timeline construction |
| T03-T03 | T-EVL | "Is this still necessary?" | - | No | No necessity evaluation |

#### New Primitives Needed

```typescript
tp_analyze_code_evolution: {
  inputs: ['entityId: EntityId', 'timeRange: TimeRange'],
  outputs: ['timeline: EvolutionTimeline', 'majorChanges: Change[]', 'authors: Author[]'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'git_analysis' }
}

tp_extract_decision_rationale: {
  inputs: ['commits: Commit[]', 'relatedIssues: Issue[]'],
  outputs: ['decisions: Decision[]', 'rationale: string[]', 'constraints: string[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_assess_code_necessity: {
  inputs: ['entityId: EntityId', 'usageContext: UsageContext'],
  outputs: ['necessary: boolean', 'deadCodeRisk: number', 'recommendations: string[]'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}
```

---

### UC-T04: Decision Archaeology

**Scenario**: "Why did we choose PostgreSQL over MongoDB?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| T04-K01 | K-ENT | Architecture Decision Records | track-e D9 | Spec only | ADR not implemented |
| T04-K02 | K-ENT | Related discussions | - | No | No discussion integration |
| T04-K03 | K-REL | Decision context | - | No | No context extraction |
| T04-K04 | K-REL | Tradeoff analysis | use-case-targets UC17 | Spec only | TradeoffMatrix not implemented |
| T04-K05 | K-CTX | Constraints at decision time | - | No | No historical constraints |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| T04-T01 | T-SYN | Reconstruct decision rationale | use-case-targets UC17 | Spec only | ADR generation only |
| T04-T02 | T-EVL | "Is this decision still valid?" | - | No | No decision re-evaluation |
| T04-T03 | T-CTF | "What if we had chosen X?" | - | No | No alternative analysis |

---

### UC-T05: Pattern Extraction

**Scenario**: "What patterns do we use for API error handling?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| T05-K01 | K-ENT | Error handling code | - | No | No error pattern extraction |
| T05-K02 | K-ENT | Variations in patterns | track-a P5 | Partial | Basic patterns |
| T05-K03 | K-REL | Pattern prevalence | - | No | No pattern statistics |
| T05-K04 | K-CTX | Pattern evolution | - | No | No temporal analysis |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| T05-T01 | T-SYN | Identify common patterns | track-a P5 | Implemented | Pattern catalog exists |
| T05-T02 | T-EVL | Assess pattern quality | - | No | No pattern evaluation |
| T05-T03 | T-SYN | Generate pattern documentation | - | No | No auto-documentation |

---

### UC-T06 to UC-T10: Additional Team Use Cases

| Use Case | Key Gaps |
|----------|----------|
| **UC-T06: Best Practice Identification** | No practice extraction, no quality benchmarking |
| **UC-T07: Convention Documentation** | No convention detection, no style guide generation |
| **UC-T08: Team Expertise Mapping** | No expertise tracking, no code ownership analysis |
| **UC-T09: Review Standards Creation** | No review pattern extraction, no checklist generation |
| **UC-T10: Pair Programming Matching** | No skill complementarity analysis |

---

## Planning Use Cases

### UC-P01: Estimation

**Scenario**: "How long will this feature take to implement?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| P01-K01 | K-ENT | Scope of changes | use-case-targets UC2 | Spec only | affectedFiles not implemented |
| P01-K02 | K-ENT | Complexity factors | - | No | No complexity analysis |
| P01-K03 | K-REL | Dependencies on other work | - | No | No work dependency graph |
| P01-K04 | K-CTX | Historical estimation accuracy | - | No | No estimation feedback loop |
| P01-K05 | K-EXT | Similar past tasks | use-case-targets UC2 | Spec only | Episode[] retrieval incomplete |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| P01-T01 | T-PLN | Decompose into subtasks | track-a P2 | Partial | Composition selection |
| P01-T02 | T-EVL | Estimate each subtask | use-case-targets UC2 | Spec only | estimatedChanges not implemented |
| P01-T03 | T-SYN | Aggregate with uncertainty | - | No | No uncertainty propagation |
| P01-T04 | T-CAU | "Why might this take longer?" | - | No | No risk factor analysis |

#### New Primitives Needed

```typescript
tp_estimate_complexity: {
  inputs: ['taskDescription: string', 'affectedEntities: EntityId[]'],
  outputs: ['complexity: ComplexityScore', 'factors: ComplexityFactor[]', 'confidence: ConfidenceInterval'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

tp_analyze_historical_estimates: {
  inputs: ['taskType: TaskType', 'similarTasks: Task[]'],
  outputs: ['accuracy: number', 'biasDirection: 'under' | 'over' | 'neutral', 'adjustmentFactor: number'],
  confidence: { type: 'measured', measurement: { /* from historical data */ } }
}

tp_propagate_uncertainty: {
  inputs: ['estimates: Estimate[]', 'dependencies: DependencyGraph'],
  outputs: ['aggregateEstimate: Estimate', 'confidenceInterval: Interval', 'criticalPath: string[]'],
  confidence: { type: 'derived', formula: 'monte_carlo_simulation' }
}
```

---

### UC-P02: Risk Assessment

**Scenario**: "What could go wrong with this migration?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| P02-K01 | K-ENT | Change scope | - | No | No change enumeration |
| P02-K02 | K-ENT | Historical failures | - | No | No failure history |
| P02-K03 | K-REL | Failure propagation paths | - | No | No failure graph |
| P02-K04 | K-CTX | Risk tolerance | - | No | No risk context |
| P02-K05 | K-EXT | Industry risk patterns | - | No | No external knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| P02-T01 | T-DIA | Identify risk factors | self-improvement tp_improve_plan_fix | Spec only | RiskAssessment partial |
| P02-T02 | T-EVL | Assess likelihood/impact | - | No | No risk scoring |
| P02-T03 | T-PLN | Plan mitigations | self-improvement | Spec only | Not implemented |
| P02-T04 | T-CTF | "What if risk X materializes?" | - | No | No contingency planning |

---

### UC-P03: Impact Analysis

**Scenario**: "What systems will be affected by changing this API?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| P03-K01 | K-ENT | Direct consumers | track-a P1 | Implemented | Call graph |
| P03-K02 | K-ENT | Transitive consumers | - | No | No transitive analysis |
| P03-K03 | K-REL | External consumers | - | No | No external consumer tracking |
| P03-K04 | K-REL | Contract dependencies | - | No | No API contract analysis |
| P03-K05 | K-CTX | Breaking change policy | - | No | No policy knowledge |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| P03-T01 | T-SYN | Enumerate all affected parties | use-case-targets UC6 | Spec only | ConsumerImpact not implemented |
| P03-T02 | T-EVL | Assess impact severity | - | No | No severity scoring |
| P03-T03 | T-PLN | Plan communication | - | No | No stakeholder planning |

---

### UC-P04: Dependency Mapping

**Scenario**: "Map all dependencies for our core service"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| P04-K01 | K-ENT | Code dependencies | track-a P1 | Implemented | Basic graph |
| P04-K02 | K-ENT | Runtime dependencies | - | No | No runtime analysis |
| P04-K03 | K-REL | Dependency health | track-e D3 | Spec only | Not implemented |
| P04-K04 | K-REL | Version constraints | - | No | No version analysis |
| P04-K05 | K-EXT | Dependency vulnerabilities | track-e D3 | Spec only | Not implemented |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| P04-T01 | T-SYN | Build complete dependency graph | - | No | No full graph construction |
| P04-T02 | T-EVL | Assess dependency health | track-e D3 | Spec only | Not implemented |
| P04-T03 | T-DIA | Identify circular dependencies | analysis/technical_debt | Partial | Basic detection |

---

### UC-P05: Release Planning

**Scenario**: "What can we ship in the next sprint?"

#### Knowledge Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| P05-K01 | K-ENT | Work items in progress | - | No | No task tracker integration |
| P05-K02 | K-ENT | Completion status | - | No | No progress tracking |
| P05-K03 | K-REL | Work item dependencies | - | No | No task dependency graph |
| P05-K04 | K-CTX | Team capacity | - | No | No capacity knowledge |
| P05-K05 | K-EXT | Sprint calendar | - | No | No calendar integration |

#### Thinking Requirements

| Req ID | Category | Requirement | Current Spec | Implemented | Gap |
|--------|----------|-------------|--------------|-------------|-----|
| P05-T01 | T-PLN | Optimize release scope | - | No | No optimization |
| P05-T02 | T-EVL | Assess release readiness | - | No | No readiness check |
| P05-T03 | T-CTF | "What if we defer X?" | - | No | No scope tradeoff analysis |

---

### UC-P06 to UC-P10: Additional Planning Use Cases

| Use Case | Key Gaps |
|----------|----------|
| **UC-P06: Roadmap Alignment** | No roadmap integration, no alignment analysis |
| **UC-P07: Resource Allocation** | No skill matching, no availability tracking |
| **UC-P08: Sprint Planning** | No velocity tracking, no capacity modeling |
| **UC-P09: Technical Strategy** | No strategy framework, no OKR alignment |
| **UC-P10: Backlog Prioritization** | No value scoring, no dependency-aware prioritization |

---

## Cross-Cutting Capability Summary

### Knowledge Capability Matrix

| Capability | Development | Operations | Team | Planning | Spec Coverage | Implementation |
|------------|-------------|------------|------|----------|---------------|----------------|
| **Entity extraction (code)** | High | Medium | High | Medium | Good | Partial |
| **Relationship mapping (code)** | High | Medium | High | High | Good | Partial |
| **Context understanding** | High | Medium | High | Medium | Low | Minimal |
| **External knowledge** | High | High | Medium | Medium | Low | None |
| **Historical analysis** | Medium | High | High | High | Low | None |
| **Runtime state** | Medium | High | Low | Low | None | None |

### Thinking Capability Matrix

| Capability | Development | Operations | Team | Planning | Spec Coverage | Implementation |
|------------|-------------|------------|------|----------|---------------|----------------|
| **Causal reasoning** | High | High | High | Medium | Low | None |
| **Counterfactual reasoning** | Medium | Medium | Medium | High | None | None |
| **Planning** | High | High | Medium | High | Partial | Minimal |
| **Diagnosis** | High | High | Medium | Medium | Partial | Minimal |
| **Synthesis** | High | High | High | Medium | Partial | Partial |
| **Evaluation** | High | High | Medium | High | Partial | Minimal |

### Constructability Matrix

| Capability | Specification | Implementation | Gap Priority |
|------------|---------------|----------------|--------------|
| **Custom primitives** | technique-contracts | Framework only | High |
| **Custom compositions** | track-a P7 | Implemented | Low |
| **Custom knowledge sources** | None | None | Critical |
| **Custom evaluation criteria** | None | None | High |

---

## Gap Analysis Summary

### Critical Gaps (Block Multiple Use Cases)

| Gap ID | Description | Affected Use Cases | Recommended Primitive/Feature |
|--------|-------------|-------------------|-------------------------------|
| **G-001** | No external knowledge source framework | D01, D02, D07, D09, D10, O01, O02, T01, P02 | `ExternalKnowledgeAdapter` interface |
| **G-002** | No causal reasoning framework | D01, D04, O01, O02, T03, T04 | `CausalReasoningEngine` |
| **G-003** | No temporal/historical analysis | D01, D04, D14, O01, T03, T04, T05, P01 | `tp_analyze_temporal_patterns` |
| **G-004** | No VCS integration (beyond basic) | D01, D05, T03, T04 | `GitIntegration` enhanced adapter |
| **G-005** | No runtime state knowledge | D01, D04, O01, O02, O04 | `RuntimeStateCapture` |
| **G-006** | No metrics/logs integration | D04, D08, O01, O02, O03, O04 | `ObservabilityIntegration` |

### High Priority Gaps

| Gap ID | Description | Affected Use Cases | Recommended Primitive/Feature |
|--------|-------------|-------------------|-------------------------------|
| **G-007** | Security primitives spec-only | D09 | Implement track-e D3 |
| **G-008** | No estimation framework | D02, P01 | `tp_estimate_complexity` |
| **G-009** | No impact analysis | D05, P03 | `tp_assess_change_impact` |
| **G-010** | No test coverage mapping | D06, D03 | `tp_map_test_coverage` |
| **G-011** | Domain primitives spec-only | Multiple | Implement track-e D1-D11 |
| **G-012** | No counterfactual reasoning | D03, T04, P02, P05 | `CounterfactualEngine` |

### Medium Priority Gaps

| Gap ID | Description | Affected Use Cases | Recommended Primitive/Feature |
|--------|-------------|-------------------|-------------------------------|
| **G-013** | No learning path generation | T01 | `tp_generate_learning_path` |
| **G-014** | No ADR integration | T04, D15 | Implement track-e D9 |
| **G-015** | No runbook generation | O01, O08 | `tp_generate_runbook` |
| **G-016** | No API design analysis | D11 | Implement track-e D5 |
| **G-017** | No database schema analysis | D12, D13 | `tp_analyze_schema` |

---

## Primitive/Composition Requirements Map

### New Primitives Required by Gap Priority

#### Critical Priority Primitives

```typescript
// G-001: External Knowledge Framework
interface ExternalKnowledgeSource {
  id: string;
  type: 'issue_tracker' | 'log_aggregator' | 'metrics' | 'docs' | 'cvdb';
  query(params: QueryParams): Promise<KnowledgeResult>;
  subscribe?(filter: Filter): AsyncIterable<KnowledgeEvent>;
}

// G-002: Causal Reasoning
tp_trace_causality: {
  inputs: ['effect: Event', 'candidates: Entity[]', 'context: ContextPack[]'],
  outputs: ['causalChain: CausalLink[]', 'rootCause: Entity', 'confidence: ConfidenceValue'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

// G-003: Temporal Analysis
tp_analyze_temporal_patterns: {
  inputs: ['entities: EntityId[]', 'timeRange: TimeRange', 'patternTypes: PatternType[]'],
  outputs: ['patterns: TemporalPattern[]', 'anomalies: Anomaly[]', 'trends: Trend[]'],
  confidence: { type: 'measured', measurement: { /* from historical accuracy */ } }
}

// G-004: Enhanced Git Integration
tp_correlate_vcs_history: {
  inputs: ['entityId: EntityId', 'correlationType: 'issues' | 'prs' | 'reviews' | 'all'],
  outputs: ['correlations: VCSCorrelation[]', 'authors: AuthorContribution[]', 'timeline: Timeline'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'vcs_analysis' }
}

// G-005: Runtime State
tp_capture_runtime_state: {
  inputs: ['processId: string', 'captureType: 'memory' | 'stack' | 'vars' | 'all'],
  outputs: ['state: RuntimeState', 'variables: Variable[]', 'callStack: StackFrame[]'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'debugger_capture' }
}

// G-006: Observability Integration
tp_query_observability: {
  inputs: ['source: 'logs' | 'metrics' | 'traces'', 'query: ObservabilityQuery'],
  outputs: ['results: ObservabilityResult[]', 'aggregations: Aggregation[]'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'query_result' }
}
```

#### High Priority Primitives

```typescript
// G-007: Security (implement existing specs)
// See track-e-domain.md D3 for tp_security_scan, tp_vulnerability_check, tp_owasp_check

// G-008: Estimation
tp_estimate_task_effort: {
  inputs: ['task: TaskDescription', 'context: ProjectContext', 'historicalData: Episode[]'],
  outputs: ['estimate: Estimate', 'confidenceInterval: Interval', 'factors: Factor[]'],
  confidence: { type: 'measured', measurement: { /* from historical accuracy */ } }
}

// G-009: Impact Analysis
tp_analyze_change_impact: {
  inputs: ['changes: Change[]', 'scope: 'direct' | 'transitive' | 'full'],
  outputs: ['impact: ImpactAssessment', 'affectedEntities: EntityId[]', 'riskLevel: RiskLevel'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}

// G-010: Test Coverage
tp_analyze_test_coverage: {
  inputs: ['codeEntities: EntityId[]', 'testEntities: EntityId[]'],
  outputs: ['coverageMap: CoverageMap', 'gaps: CoverageGap[]', 'riskWeightedScore: number'],
  confidence: { type: 'deterministic', value: 1.0, reason: 'coverage_tool' }
}

// G-012: Counterfactual Reasoning
tp_evaluate_counterfactual: {
  inputs: ['scenario: Scenario', 'alternativeAction: Action', 'context: ContextPack[]'],
  outputs: ['projectedOutcome: Outcome', 'differences: Difference[]', 'confidence: ConfidenceValue'],
  confidence: { type: 'absent', reason: 'uncalibrated' }
}
```

### New Compositions Required

```typescript
// Incident Investigation Composition (Operations)
tc_incident_investigation: {
  primitives: ['tp_correlate_logs', 'tp_trace_error_propagation', 'tp_construct_incident_timeline', 'tp_trace_causality'],
  operators: [
    { type: 'parallel', inputs: ['tp_correlate_logs', 'tp_trace_error_propagation'] },
    { type: 'sequence', inputs: ['tp_construct_incident_timeline', 'tp_trace_causality'] }
  ]
}

// Developer Onboarding Composition (Team)
tc_developer_onboarding: {
  primitives: ['tp_identify_core_concepts', 'tp_generate_learning_path', 'tp_suggest_starter_tasks'],
  operators: [
    { type: 'sequence', inputs: ['tp_identify_core_concepts', 'tp_generate_learning_path', 'tp_suggest_starter_tasks'] }
  ]
}

// Estimation Composition (Planning)
tc_task_estimation: {
  primitives: ['tp_estimate_complexity', 'tp_analyze_historical_estimates', 'tp_propagate_uncertainty'],
  operators: [
    { type: 'parallel', inputs: ['tp_estimate_complexity', 'tp_analyze_historical_estimates'] },
    { type: 'sequence', inputs: ['tp_propagate_uncertainty'] }
  ]
}

// Code Review Composition (Development)
tc_code_review_assistant: {
  primitives: ['tp_analyze_diff', 'tp_assess_change_impact', 'tp_generate_review_checklist'],
  operators: [
    { type: 'sequence', inputs: ['tp_analyze_diff', 'tp_assess_change_impact'] },
    { type: 'sequence', inputs: ['tp_generate_review_checklist'] }
  ]
}
```

---

## Implementation Roadmap

### Phase 1: Critical Infrastructure (Weeks 1-4)

| Priority | Item | Estimated LOC | Dependencies |
|----------|------|---------------|--------------|
| P0 | External Knowledge Source Framework | ~400 | None |
| P0 | Enhanced Git Integration | ~300 | None |
| P1 | Observability Integration Interface | ~350 | None |
| P1 | Temporal Analysis Primitive | ~250 | None |

### Phase 2: Core Reasoning (Weeks 5-8)

| Priority | Item | Estimated LOC | Dependencies |
|----------|------|---------------|--------------|
| P0 | Causal Reasoning Framework | ~500 | Phase 1 |
| P1 | Impact Analysis Primitives | ~300 | Phase 1 |
| P1 | Test Coverage Analysis | ~250 | None |
| P2 | Counterfactual Reasoning | ~400 | Causal Reasoning |

### Phase 3: Domain Primitives (Weeks 9-12)

| Priority | Item | Estimated LOC | Dependencies |
|----------|------|---------------|--------------|
| P0 | Implement track-e D3 (Security) | ~500 | Phase 1 |
| P1 | Implement track-e D5 (API) | ~300 | None |
| P1 | Estimation Framework | ~350 | Phase 2 |
| P2 | Implement track-e D9 (Architecture) | ~300 | None |

### Phase 4: Advanced Compositions (Weeks 13-16)

| Priority | Item | Estimated LOC | Dependencies |
|----------|------|---------------|--------------|
| P1 | Incident Investigation Composition | ~200 | Phase 1, 2 |
| P1 | Code Review Composition | ~200 | Phase 2 |
| P2 | Developer Onboarding Composition | ~200 | Phase 2 |
| P2 | Task Estimation Composition | ~200 | Phase 3 |

**Total Estimated New LOC: ~5,000**

---

## Verification

### How to Verify Gap Coverage

```bash
# Check which primitives are spec-only vs implemented
cd packages/LiBrainian && rg "tp_[a-z_]+:" src/technique/ --glob '*.ts'

# Check composition execution evidence
cd packages/LiBrainian && npx vitest src/api/__tests__/technique_validation.test.ts

# Verify external integration readiness
./scripts/check_forbidden_patterns.sh
```

### Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| Use cases with >80% knowledge coverage | ~20% | >70% |
| Use cases with >80% thinking coverage | ~10% | >60% |
| Primitives implemented (not spec-only) | ~30% | >80% |
| External knowledge sources integrated | 0 | >3 |
| Compositions for each use case category | 0 | >10 |

---

## Related Specifications

- [use-case-targets.md](./use-case-targets.md) - Target interfaces for primary use cases
- [technique-contracts.md](./technique-contracts.md) - Executable contract framework
- [track-a-core-pipeline.md](./track-a-core-pipeline.md) - Core pipeline specifications
- [track-e-domain.md](./track-e-domain.md) - Domain primitive specifications
- [self-improvement-primitives.md](./self-improvement-primitives.md) - Self-improvement capabilities
- [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) - Current implementation status
