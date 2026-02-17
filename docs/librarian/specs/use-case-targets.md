# Use Case Target Interfaces

> **Source**: THEORETICAL_CRITIQUE.md Part VI (lines 3495-4320)
> **Purpose**: Define the "10/10" ideal state for each use case
> **Status**: These are TARGET INTERFACES - what LiBrainian should be able to do
> **Note**: Any “current utility” or “/10” ratings in this file are **subjective planning heuristics**, not measured evidence. Do not treat them as gates or proof.

---

## Relationship to the Canonical Use-Case Matrix (UC-001…UC-310)

This file is a **human-readable set of exemplar target interfaces** (UC 1–20) extracted from Part VI.

The canonical, exhaustive inventory of LiBrainian “know anything about anything” needs (with explicit dependencies and mechanisms) is:
- `docs/LiBrainian/USE_CASE_MATRIX.md`

**Spec-system contract (non-negotiable):**
- The spec system MUST not drift into “interfaces-only”. Every use case must have **observable behavior**, including disclosures for missing capabilities and partial corpora.
- The foundation baseline MUST be explicitly verified for:
  - **L0 (Foundation) UC-001…UC-030** (inventory, baseline structure, ownership)

**Verification hooks (TDD)**
- Tier‑0: deterministic UC-matrix validation (no “coverage %” theater).
- Tier‑2: live-provider end-to-end execution of UC‑001…UC‑030 against a controlled fixture repo; fails honestly if providers unavailable.

---

## Table of Contents

1. [Bug Fix Context](#use-case-1-bug-fix-context)
2. [Feature Planning](#use-case-2-feature-planning)
3. [Codebase Exploration](#use-case-3-codebase-exploration)
4. [Debugging Assistant](#use-case-4-debugging-assistant)
5. [Change Verification](#use-case-5-change-verification)
6. [Code Review](#use-case-6-code-review)
7. [Refactoring Planning](#use-case-7-refactoring-planning)
8. [Security Audit](#use-case-8-security-audit)
9. [Performance Investigation](#use-case-9-performance-investigation)
10. [API Design Review](#use-case-10-api-design-review)
11. [Test Coverage Gap Analysis](#use-case-11-test-coverage-gap-analysis)
12. [Dependency Upgrade Planning](#use-case-12-dependency-upgrade-planning)
13. [Documentation Generation](#use-case-13-documentation-generation)
14. [Onboarding New Developer](#use-case-14-onboarding-new-developer)
15. [Technical Debt Assessment](#use-case-15-technical-debt-assessment)
16. [Incident Investigation](#use-case-16-incident-investigation)
17. [Architecture Decision Support](#use-case-17-architecture-decision-support)
18. [Legacy Code Understanding](#use-case-18-legacy-code-understanding)
19. [Compliance Checking](#use-case-19-compliance-checking)
20. [Multi-Repository Analysis](#use-case-20-multi-repository-analysis)

---

## Summary Table (Subjective Planning Heuristic)

| # | Use Case | Current (subjective) | Target (aspirational) | Primary Gap |
|---|----------|---------|--------|-------------|
| 1 | Bug fix context | 6/10 | 10/10 | Issue/log integration |
| 2 | Feature planning | 4/10 | 10/10 | Semantic selection, estimates |
| 3 | Codebase exploration | 5/10 | 10/10 | Guided learning, visuals |
| 4 | Debugging | 3/10 | 10/10 | Stack trace, execution |
| 5 | Change verification | 2/10 | 10/10 | Test execution, tracking |
| 6 | Code review | 3/10 | 10/10 | Diff-aware, impact analysis |
| 7 | Refactoring | 4/10 | 10/10 | Safe incremental path |
| 8 | Security audit | 3/10 | 10/10 | OWASP, automated scanning |
| 9 | Performance | 2/10 | 10/10 | Profiling, optimization |
| 10 | API design | 3/10 | 10/10 | Best practices, consistency |
| 11 | Test gaps | 4/10 | 10/10 | Risk-weighted, generation |
| 12 | Dependency upgrade | 2/10 | 10/10 | Breaking changes, migration |
| 13 | Documentation | 3/10 | 10/10 | Structure, examples |
| 14 | Onboarding | 3/10 | 10/10 | Role-specific path |
| 15 | Tech debt | 4/10 | 10/10 | Business impact, tracking |
| 16 | Incidents | 2/10 | 10/10 | Logs, timeline, runbooks |
| 17 | Architecture decisions | 3/10 | 10/10 | Tradeoffs, ADR generation |
| 18 | Legacy code | 4/10 | 10/10 | Archaeological analysis |
| 19 | Compliance | 2/10 | 10/10 | Framework integration |
| 20 | Multi-repo | 1/10 | 10/10 | Cross-repo analysis |

---

## Key Patterns for 10/10 Utility

> **Theory Reference**: These patterns emerge from analyzing all 20 use cases

### 1. Domain Integration
Every use case requires integration with domain-specific tools:
- Bug fixing → Issue trackers, error logs
- Security → OWASP frameworks, scanners
- Compliance → Regulatory frameworks

### 2. Execution, Not Just Description
Every technique primitive needs an executor:
- `tp_bisect` → Actually runs binary search
- `tp_verify_plan` → Actually runs verification
- `tp_threat_model` → Actually generates threat model

### 3. Progressive Detail
Users need layered information:
- Quick answer (1 sentence)
- Context (1 paragraph)
- Deep dive (full analysis)

### 4. Conversational Context
Real work is iterative (see [Critical Problem E](./critical-usability.md#critical-problem-e-no-progressive-context-assembly)):
- Follow-up questions with context
- Drill-down into specifics
- Accumulating understanding

### 5. Actionable Output
Every response should include:
- What to do next
- How to do it
- What tools to use
- Expected outcome

---

## Use Case 1: Bug Fix Context

**Scenario**: Agent investigating "TypeError: Cannot read property 'user' of undefined"

**Current Gaps**: No issue integration, no error logs, no historical context, can't verify completeness

```typescript
interface BugFixContext extends LibrarianResponse {
  // Issue integration
  relatedIssues: Issue[];           // From GitHub/Jira
  errorLogs: ErrorLogEntry[];       // Recent errors matching keywords

  // Historical context
  previousFixes: Episode[];         // Past fixes in this area
  regressionRisk: RegressionAnalysis; // What might break

  // Completeness verification
  coverageAdequacy: 'unknown' | 'partial' | 'adequate'; // Never guess a %; adequacy must be trace-backed
  missedAreas: string[];            // Suggested areas to also check
}
```

---

## Use Case 2: Feature Planning

**Scenario**: Agent receives "Add rate limiting to the API"

**Current Gaps**: Keyword-based composition selection, generic plan steps, no resource estimation

```typescript
interface FeaturePlan extends PlanWorkResult {
  // Semantic composition selection
  selectedComposition: {
    composition: TechniqueComposition;
    matchReason: 'semantic' | 'learned' | 'explicit';
    matchScore: number; // heuristic ranking signal (NOT epistemic claim confidence)
    alternatives: CompositionMatch[];
  };

  // Context-aware steps
  steps: EnrichedWorkNode[];  // Each step knows relevant files

  // Resource estimation
  estimates: {
    complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
    affectedFiles: number;
    estimatedChanges: 'small' | 'medium' | 'large';
    riskAreas: RiskArea[];
  };

  // Similar past implementations
  similarFeatures: Episode[];
}
```

---

## Use Case 3: Codebase Exploration

**Scenario**: New developer asks "How does payment processing work?"

**Current Gaps**: No visual representation, no reading order, no API vs implementation distinction

```typescript
interface ExplorationSession {
  // Visual understanding
  architectureDiagram: MermaidDiagram;
  dataFlowDiagram: MermaidDiagram;

  // Guided reading
  readingOrder: {
    file: string;
    purpose: string;
    focusAreas: string[];
    timeEstimate: 'quick' | 'medium' | 'deep';
  }[];

  // Layered understanding
  publicApi: EntitySummary[];       // Start here
  internalModules: EntitySummary[]; // Then go deeper
  implementationDetails: EntitySummary[]; // If needed

  // Conversational context
  followUp(question: string): Promise<ExplorationSession>;
  drillDown(entityId: string): Promise<ExplorationSession>;
}
```

---

## Use Case 4: Debugging Assistant

**Scenario**: "TypeError: Cannot read property 'user' of undefined"

**Current Gaps**: No stack trace integration, no code path correlation, non-executable primitives

```typescript
interface DebuggingAssistant {
  // Stack trace integration
  parseStackTrace(trace: string): ParsedStack;
  correlateWithCode(stack: ParsedStack): CodeCorrelation[];

  // Hypothesis generation
  generateHypotheses(error: ErrorInfo): Hypothesis[];
  rankHypotheses(hypotheses: Hypothesis[], context: ContextPack[]): RankedHypothesis[];

  // Executable debugging
  executeBisect(testCommand: string): BisectResult;
  instrumentCode(targetFile: string, probes: Probe[]): InstrumentationResult;

  // Guided debugging
  nextStep(): DebuggingStep;
  recordFinding(finding: Finding): void;
}
```

---

## Use Case 5: Change Verification

**Scenario**: Verify correctness after authentication changes

**Current Gaps**: No automated execution, no test runner integration, no progress tracking

```typescript
interface VerificationExecutor {
  // Test execution
  runTests(testPattern: string): Promise<TestResults>;
  runAffectedTests(changedFiles: string[]): Promise<TestResults>;

  // Verification tracking
  createVerificationChecklist(changes: Change[]): VerificationChecklist;
  markVerified(item: ChecklistItem, evidence: Evidence): void;
  getProgress(): VerificationProgress;

  // Automated checks
  runStaticAnalysis(): StaticAnalysisResult;
  runSecurityScan(): SecurityScanResult;
  checkTypeErrors(): TypeCheckResult;

  // Synthesis
  generateVerificationReport(): VerificationReport;
}
```

---

## Use Case 6: Code Review

**Scenario**: Reviewer needs context for a PR with 15 changed files

**Current Gaps**: No diff-aware context, no "what could break" analysis, no reviewer checklist

```typescript
interface CodeReviewAssistant {
  // Diff-aware context
  analyzeChanges(diff: Diff): ChangeAnalysis;
  getContextForChange(change: Change): ContextPack[];

  // Impact analysis
  whatCouldBreak(changes: Change[]): ImpactAssessment;
  affectedTests(): TestMapping[];
  affectedConsumers(): ConsumerImpact[];

  // Review guidance
  generateChecklist(changes: Change[]): ReviewChecklist;
  suggestFocusAreas(): FocusArea[];
  flagRiskyChanges(): RiskyChange[];

  // Historical comparison
  similarPRs(): Episode[];
  pastIssuesInArea(): Issue[];
}
```

---

## Use Case 7: Refactoring Planning

**Scenario**: "Refactor the user service to use dependency injection"

**Current Gaps**: No current state analysis, no step-by-step safe path, no rollback strategy

```typescript
interface RefactoringPlanner {
  // Current state analysis
  analyzeCurrentPattern(): PatternAnalysis;
  identifyDependencies(): DependencyGraph;
  findCouplingPoints(): CouplingPoint[];

  // Safe refactoring path
  planIncrementalSteps(): RefactoringStep[];
  identifySafeCheckpoints(): Checkpoint[];
  estimateRisk(step: RefactoringStep): RiskAssessment;

  // Verification per step
  verificationPlan(step: RefactoringStep): VerificationPlan;
  runVerification(plan: VerificationPlan): VerificationResult;

  // Rollback
  createRollbackPlan(): RollbackPlan;
  canRollback(step: RefactoringStep): boolean;
}
```

---

## Use Case 8: Security Audit

**Scenario**: "Audit the API endpoints for security vulnerabilities"

**Current Gaps**: No security-specific analysis, no OWASP integration, no automated scanning

```typescript
interface SecurityAuditor {
  // Comprehensive scanning
  scanForVulnerabilities(): VulnerabilityReport;
  checkOWASPTop10(): OWASPCheckResult;
  analyzeTaintFlow(): TaintAnalysis;

  // Endpoint-specific
  auditEndpoint(endpoint: Endpoint): EndpointAudit;
  checkAuthenticationFlow(): AuthFlowAudit;
  checkAuthorizationRules(): AuthZAudit;

  // Secrets and configuration
  scanForSecrets(): SecretScanResult;
  auditConfiguration(): ConfigAudit;

  // Remediation
  suggestRemediations(vuln: Vulnerability): Remediation[];
  prioritizeByRisk(vulns: Vulnerability[]): PrioritizedList;
  generateSecurityReport(): SecurityReport;
}
```

---

## Use Case 9: Performance Investigation

**Scenario**: "Why is the dashboard loading slowly?"

**Current Gaps**: No performance-specific context, no profiling integration, no optimization suggestions

```typescript
interface PerformanceInvestigator {
  // Performance context
  getPerformanceHotspots(): Hotspot[];
  analyzeComplexity(fn: FunctionRef): ComplexityAnalysis;
  identifyNPlusOne(): NPlusOneQuery[];

  // Profiling integration
  suggestProfilingPoints(): ProfilingPoint[];
  analyzeProfile(profile: Profile): ProfileAnalysis;

  // Optimization
  suggestOptimizations(hotspot: Hotspot): Optimization[];
  estimateImpact(optimization: Optimization): ImpactEstimate;
  findCachingOpportunities(): CachingOpportunity[];

  // Benchmarking
  createBenchmark(area: string): Benchmark;
  compareBeforeAfter(before: Benchmark, after: Benchmark): Comparison;
}
```

---

## Use Case 10: API Design Review

**Scenario**: "Review our REST API design for consistency and best practices"

**Current Gaps**: No API-specific analysis, no RESTful best practice checking, no consistency analysis

```typescript
interface APIDesignReviewer {
  // Consistency analysis
  analyzeNamingConsistency(): ConsistencyReport;
  analyzeResponseStructures(): StructureAnalysis;
  analyzeErrorHandling(): ErrorHandlingAnalysis;

  // Best practices
  checkRESTfulConventions(): ConventionViolation[];
  checkVersioningStrategy(): VersioningAnalysis;
  checkPaginationPatterns(): PaginationAnalysis;

  // Documentation
  generateOpenAPISpec(): OpenAPISpec;
  findUndocumentedEndpoints(): Endpoint[];
  suggestDocumentationImprovements(): DocSuggestion[];

  // Breaking changes
  detectBreakingChanges(oldSpec: OpenAPISpec): BreakingChange[];
  suggestNonBreakingAlternatives(change: BreakingChange): Alternative[];
}
```

---

## Use Case 11: Test Coverage Gap Analysis

**Scenario**: "What important code paths are not covered by tests?"

**Current Gaps**: No risk-weighted coverage, no path analysis, no test generation

```typescript
interface TestGapAnalyzer {
  // Risk-weighted coverage
  analyzeRiskWeightedCoverage(): RiskWeightedReport;
  identifyHighRiskUntested(): HighRiskPath[];

  // Path analysis
  findUntestedPaths(): CodePath[];
  findUntestedBranches(): Branch[];
  findUntestedErrorHandlers(): ErrorHandler[];

  // Test generation
  suggestTestCases(path: CodePath): TestCase[];
  generateTestSkeleton(fn: FunctionRef): TestSkeleton;
  identifyMockRequirements(fn: FunctionRef): MockRequirement[];

  // Prioritization
  prioritizeByRisk(gaps: CoverageGap[]): PrioritizedGap[];
  estimateTestingEffort(gap: CoverageGap): EffortEstimate;
}
```

---

## Use Case 12: Dependency Upgrade Planning

**Scenario**: "Plan upgrade of React from 17 to 18"

**Current Gaps**: No breaking change analysis, no migration path, no compatibility checking

```typescript
interface DependencyUpgradePlanner {
  // Breaking change analysis
  analyzeBreakingChanges(from: Version, to: Version): BreakingChange[];
  findAffectedCode(changes: BreakingChange[]): AffectedCode[];

  // Migration path
  generateMigrationSteps(): MigrationStep[];
  identifyBlockers(): Blocker[];
  estimateMigrationEffort(): EffortEstimate;

  // Compatibility
  checkPeerDependencies(): CompatibilityReport;
  checkTransitiveDependencies(): TransitiveReport;

  // Gradual rollout
  planIncrementalMigration(): IncrementalPlan;
  identifyFeatureFlagPoints(): FeatureFlagPoint[];
  createRollbackStrategy(): RollbackStrategy;
}
```

---

## Use Case 13: Documentation Generation

**Scenario**: "Generate documentation for our internal SDK"

**Current Gaps**: No structure inference, no example generation, no cross-referencing

```typescript
interface DocumentationGenerator {
  // Structure inference
  inferDocumentationStructure(): DocStructure;
  identifyPublicAPI(): PublicAPI;
  categorizeByConcept(): ConceptCategory[];

  // Content generation
  generateModuleOverview(module: Module): string;
  generateFunctionDoc(fn: FunctionRef): FunctionDoc;
  generateExamples(fn: FunctionRef): Example[];

  // Cross-referencing
  linkRelatedConcepts(): ConceptLink[];
  generateGlossary(): Glossary;
  createQuickReference(): QuickRef;

  // Quality
  checkDocCoverage(): DocCoverageReport;
  findOutdatedDocs(): OutdatedDoc[];
  suggestImprovements(): DocSuggestion[];
}
```

---

## Use Case 14: Onboarding New Developer

**Scenario**: "Create an onboarding guide for a new backend developer"

**Current Gaps**: No role-specific guidance, no learning path, no progressive complexity

```typescript
interface OnboardingGenerator {
  // Role-specific
  identifyRelevantAreas(role: DeveloperRole): Area[];
  prioritizeByImportance(areas: Area[]): PrioritizedArea[];

  // Learning path
  createLearningPath(role: DeveloperRole): LearningPath;
  identifyPrerequisites(area: Area): Prerequisite[];
  estimateLearningTime(path: LearningPath): TimeEstimate;

  // Key concepts
  extractKeyConcepts(): Concept[];
  explainConceptWithContext(concept: Concept): Explanation;
  findConceptExamples(concept: Concept): Example[];

  // Progressive complexity
  stratifyByComplexity(areas: Area[]): ComplexityLayer[];
  suggestFirstTasks(): StarterTask[];
  createMentorshipGuide(): MentorGuide;
}
```

---

## Use Case 15: Technical Debt Assessment

**Scenario**: "Identify and prioritize our technical debt"

**Current Gaps**: No debt categorization, no business impact analysis, no tracking over time

```typescript
interface TechnicalDebtAssessor {
  // Categorization
  identifyDebtItems(): DebtItem[];
  categorizeDebt(): DebtCategory[];
  measureDebtMetrics(): DebtMetrics;

  // Business impact
  estimateBusinessImpact(item: DebtItem): BusinessImpact;
  linkToIncidents(item: DebtItem): Incident[];
  calculateMaintenanceTax(area: Area): MaintenanceTax;

  // Remediation
  createRemediationPlan(item: DebtItem): RemediationPlan;
  estimateRemediationEffort(plan: RemediationPlan): Effort;
  identifyQuickWins(): QuickWin[];

  // Tracking
  trackDebtOverTime(): DebtTrend;
  setDebtBudget(): DebtBudget;
  alertOnDebtIncrease(): Alert[];
}
```

---

## Use Case 16: Incident Investigation

**Scenario**: "Production is down, investigate the root cause"

**Current Gaps**: No log integration, no timeline construction, no blast radius analysis

```typescript
interface IncidentInvestigator {
  // Log integration
  correlateLogEntries(timeRange: TimeRange): CorrelatedLogs;
  identifyAnomalies(): Anomaly[];
  traceRequestFlow(requestId: string): RequestTrace;

  // Timeline construction
  constructTimeline(): IncidentTimeline;
  identifyTriggeringEvent(): Event;
  findContributingFactors(): Factor[];

  // Blast radius
  analyzeBlastRadius(): BlastRadius;
  identifyAffectedUsers(): UserImpact;
  findRelatedSystems(): SystemDependency[];

  // Response
  suggestImmediateMitigation(): Mitigation[];
  generateRunbook(incident: Incident): Runbook;
  createPostmortemTemplate(): PostmortemTemplate;
}
```

---

## Use Case 17: Architecture Decision Support

**Scenario**: "Should we use microservices or a monolith for the new feature?"

**Current Gaps**: No tradeoff analysis, no precedent finding, no decision documentation

```typescript
interface ArchitectureDecisionSupport {
  // Tradeoff analysis
  analyzeTradeoffs(options: ArchOption[]): TradeoffMatrix;
  scoreOptions(criteria: Criteria[]): ScoredOptions;
  identifyRisks(option: ArchOption): Risk[];

  // Precedents
  findSimilarDecisions(): ADR[];
  findIndustryExamples(): Example[];
  analyzeOutcomes(precedent: ADR): OutcomeAnalysis;

  // Constraints
  checkExistingConstraints(): ConstraintViolation[];
  analyzeTeamCapability(option: ArchOption): CapabilityAnalysis;
  estimateImplementationCost(option: ArchOption): CostEstimate;

  // Documentation
  generateADR(decision: Decision): ADR;
  trackDecisionOutcome(adrId: string): OutcomeTracker;
}
```

---

## Use Case 18: Legacy Code Understanding

**Scenario**: "Understand this 10-year-old module before modifying it"

**Current Gaps**: No archaeological analysis, no implicit knowledge extraction, no safe modification zones

```typescript
interface LegacyCodeArchaeologist {
  // Archaeological analysis
  analyzeCodeEvolution(): EvolutionTimeline;
  identifyLayeredPatterns(): PatternLayer[];
  findDeadCode(): DeadCode[];

  // Implicit knowledge
  extractImplicitRules(): ImplicitRule[];
  identifyMagicNumbers(): MagicNumber[];
  findHiddenDependencies(): HiddenDep[];

  // Safe zones
  identifySafeModificationZones(): SafeZone[];
  findBrittleAreas(): BrittleArea[];
  mapTestCoverage(): CoverageMap;

  // Knowledge capture
  captureTribalKnowledge(): TribalKnowledge;
  identifyExperts(area: Area): Expert[];
  generateKnowledgeBase(): KnowledgeBase;
}
```

---

## Use Case 19: Compliance Checking

**Scenario**: "Verify our codebase meets SOC2 compliance requirements"

**Current Gaps**: No compliance framework integration, no evidence collection, no gap analysis

```typescript
interface ComplianceChecker {
  // Framework integration
  loadComplianceFramework(framework: 'SOC2' | 'HIPAA' | 'GDPR'): Framework;
  mapRequirementsToCode(): RequirementMapping;

  // Evidence collection
  collectEvidence(requirement: Requirement): Evidence[];
  generateEvidenceReport(): EvidenceReport;
  linkToArtifacts(evidence: Evidence): Artifact[];

  // Gap analysis
  identifyGaps(): ComplianceGap[];
  prioritizeGaps(): PrioritizedGap[];
  estimateRemediationEffort(gap: ComplianceGap): Effort;

  // Tracking
  trackRemediationProgress(): Progress;
  scheduleReview(): ReviewSchedule;
  generateAuditReport(): AuditReport;
}
```

---

## Use Case 20: Multi-Repository Analysis

**Scenario**: "Analyze dependencies and patterns across our 50 microservices"

**Current Gaps**: No multi-repo support, no cross-repo dependency analysis, no global view

```typescript
interface MultiRepoAnalyzer {
  // Cross-repo indexing
  indexRepositories(repos: Repository[]): MultiRepoIndex;
  buildGlobalDependencyGraph(): GlobalDepGraph;

  // Pattern analysis
  findSharedPatterns(): SharedPattern[];
  findInconsistencies(): Inconsistency[];
  identifyDuplication(): Duplication[];

  // Dependency health
  analyzeCircularDependencies(): CircularDep[];
  findVersionMismatches(): VersionMismatch[];
  identifyBroadcastChanges(): BroadcastChange[];

  // Global view
  generateSystemArchitecture(): SystemArchDiagram;
  createServiceCatalog(): ServiceCatalog;
  trackCrossRepoChanges(): ChangeTracker;
}
```

---

## Implementation Notes

### Relationship to Core Infrastructure

These use cases require the core infrastructure to be in place:

| Use Case Group | Required Infrastructure |
|----------------|------------------------|
| 1-4 (Investigation) | [Critical Problem E](./critical-usability.md) - Progressive Context |
| 5-7 (Execution) | [Critical Problem A](./critical-usability.md) - Execution Engine |
| 8-10 (Analysis) | [Track E](./track-e-domain.md) - Domain Primitives |
| 11-15 (Planning) | [Critical Problem B](./critical-usability.md) - Learning Loop |
| 16-20 (Advanced) | Full infrastructure + domain extensions |

### Implementation Priority

1. **Core First**: Implement Critical Problems A-E before advanced use cases
2. **Foundational Use Cases**: UC 1-5 can be partially supported with current infrastructure
3. **Domain Extensions**: UC 8-10, 16-19 require domain-specific primitives
4. **Multi-repo**: UC 20 requires architecture changes

### Cross-References

- Execution primitives → [track-a-core-pipeline.md](./track-a-core-pipeline.md) (P1)
- Learning from outcomes → [track-c-extended.md](./track-c-extended.md) (P13)
- Domain primitives → [track-e-domain.md](./track-e-domain.md) (D1-D4)
- Calibrated confidence → [track-f-calibration.md](./track-f-calibration.md) (C1-C4)
