# Self-Improvement Primitives Specification

> **Source**: Extracted from THEORETICAL_CRITIQUE.md Part XIII: Using LiBrainian to Perfect LiBrainian
>
> **Problem Statement**: LiBrainian needs structured mechanisms for recursive self-improvement bounded by theoretical constraints
>
> **Purpose**: Define the 11 self-improvement primitives, 5 compositions, and supporting infrastructure for LiBrainian to analyze, verify, and improve itself

---

## Table of Contents

| Section | Description |
|---------|-------------|
| [Overview](#overview) | The meta-epistemic loop and self-improvement philosophy |
| [Self-Improvement Primitives](#self-improvement-primitives) | The 11 primitive operations |
| [Self-Improvement Compositions](#self-improvement-compositions) | The 5 orchestrated workflows |
| [SelfImprovementExecutor](#selfimprovementexecutor) | Execution engine specification |
| [Knowledge Freshness Detection](#knowledge-freshness-detection) | Staleness tracking and refresh |
| [Distribution Shift Warning](#distribution-shift-warning) | Detecting when assumptions no longer hold |
| [Health Dashboard Interface](#health-dashboard-interface) | Monitoring and visualization |
| [Meta-Improvement Loop](#meta-improvement-loop) | Using LiBrainian to improve LiBrainian |
| [Implementation Roadmap](#implementation-roadmap) | Phased delivery plan |

---

## Overview

### The Meta-Epistemic Loop

```
┌─────────────────────────────────────────────────────────────┐
│                    LiBrainian ON LiBrainian                    │
│                                                             │
│  ┌─────────────────┐      ┌─────────────────┐              │
│  │ 1. SELF-INDEX   │───▶  │ 2. SELF-QUERY   │              │
│  │                 │      │                 │              │
│  │ Bootstrap on    │      │ Query gaps,     │              │
│  │ LiBrainian code  │      │ inconsistencies │              │
│  └─────────────────┘      └────────┬────────┘              │
│                                    │                        │
│                                    ▼                        │
│  ┌─────────────────┐      ┌─────────────────┐              │
│  │ 4. SELF-LEARN   │◀──── │ 3. SELF-VERIFY  │              │
│  │                 │      │                 │              │
│  │ Update based on │      │ Verify claims   │              │
│  │ outcomes        │      │ about self      │              │
│  └─────────────────┘      └─────────────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Bounded Recursion**: Self-improvement is constrained by the theoretical framework (Part XII)
2. **Evidence-Backed**: Every improvement claim traces to verifiable evidence
3. **Calibrated Confidence**: All confidence values follow CONFIDENCE_REDESIGN.md types
4. **Gettier-Aware**: Detects and resolves "accidentally true" beliefs
5. **Episode-Recorded**: All operations produce auditable traces

---

## Self-Improvement Primitives

### Primitive Categories

| Category | Prefix | Purpose |
|----------|--------|---------|
| **Self-Indexing** | `tp_self_*` | Bootstrap and refresh LiBrainian's knowledge about itself |
| **Self-Analysis** | `tp_analyze_*` | Analyze architecture, soundness, and consistency |
| **Self-Verification** | `tp_verify_*` | Verify claims and calibration quality |
| **Self-Improvement** | `tp_improve_*` | Generate recommendations, plan fixes, create tests |
| **Self-Learning** | `tp_learn_*` | Learn from outcomes, extract patterns |

---

### 1. tp_self_bootstrap

Bootstrap LiBrainian knowledge index on LiBrainian source code itself.

```typescript
import type { ConfidenceValue } from '../epistemics/confidence.js';

interface TpSelfBootstrap {
  id: 'tp_self_bootstrap';
  name: 'Self-Bootstrap';
  category: 'self_improvement';
  description: 'Bootstrap LiBrainian knowledge index on LiBrainian source code itself';

  preconditions: [
    'LiBrainian source code accessible at known path',
    'Storage system initialized',
    'Embedding model available',
  ];

  inputs: {
    sourceRoot: {
      type: 'path';
      description: 'Root of LiBrainian source';
      required: true;
    };
    includeTests: {
      type: 'boolean';
      default: true;
      description: 'Include test files in index';
    };
    includeDocs: {
      type: 'boolean';
      default: true;
      description: 'Include documentation files in index';
    };
  };

  outputs: {
    indexReport: { type: 'BootstrapReport' };
    entityCount: { type: 'number' };
    relationshipCount: { type: 'number' };
    coverageMetrics: { type: 'CoverageMetrics' };
  };

  postconditions: [
    'All LiBrainian modules indexed',
    'All public interfaces documented',
    'Dependency graph complete',
    'Embedding vectors generated',
  ];

  estimatedCost: {
    tokens: 50000;
    time: '5-10 minutes';
  };

  confidence: ConfidenceValue;
}

interface BootstrapReport {
  status: 'complete' | 'partial' | 'failed';
  entitiesIndexed: number;
  relationshipsDiscovered: number;
  embeddingsGenerated: number;
  contextPacksCreated: number;
  timeElapsedMs: number;
  coverage: CoverageMetrics;
  errors: BootstrapError[];
}

interface CoverageMetrics {
  functions: number;  // 0.0-1.0
  classes: number;
  modules: number;
  relationships: number;
}
```

---

### 2. tp_self_refresh

Incrementally update LiBrainian knowledge based on recent changes.

```typescript
interface TpSelfRefresh {
  id: 'tp_self_refresh';
  name: 'Self-Refresh';
  category: 'self_improvement';
  description: 'Incrementally update LiBrainian knowledge based on recent changes';

  preconditions: [
    'Prior self-bootstrap completed',
    'Git history available',
  ];

  inputs: {
    since: {
      type: 'string';
      description: 'Git ref or timestamp (e.g., "HEAD~5", "2026-01-01")';
      required: true;
    };
    scope: {
      type: 'enum';
      values: ['changed_only', 'changed_and_dependents', 'full'];
      default: 'changed_and_dependents';
      description: 'How widely to refresh';
    };
  };

  outputs: {
    refreshedEntities: { type: 'string[]' };
    newEntities: { type: 'string[]' };
    removedEntities: { type: 'string[]' };
    staleness: { type: 'StalenessReport' };
  };

  postconditions: [
    'Changed files re-indexed',
    'Dependent entities refreshed',
    'Stale knowledge flagged',
  ];

  estimatedCost: {
    tokens: 5000;
    time: '30 seconds - 2 minutes';
  };

  confidence: ConfidenceValue;
}

interface StalenessReport {
  totalEntities: number;
  staleEntities: number;
  averageStaleness: number;
  mostStaleEntities: Array<{
    entityId: string;
    stalenessScore: number;
    lastRefreshed: Date;
    reason: string;
  }>;
}
```

---

### 3. tp_analyze_architecture

Analyze LiBrainian architecture for violations and improvements.

```typescript
interface TpAnalyzeArchitecture {
  id: 'tp_analyze_architecture';
  name: 'Analyze Architecture';
  category: 'self_improvement';
  description: 'Analyze LiBrainian architecture for violations and improvements';

  preconditions: ['Self-index available'];

  inputs: {
    checks: {
      type: 'array';
      items: 'ArchitectureCheck';
      default: ['circular_deps', 'large_interfaces', 'unclear_responsibility', 'dead_code'];
    };
    thresholds: {
      type: 'ArchitectureThresholds';
      default: {
        maxInterfaceMethods: 20;
        maxModuleSize: 500;
        maxCyclomaticComplexity: 15;
      };
    };
  };

  outputs: {
    violations: { type: 'ArchitectureViolation[]' };
    metrics: { type: 'ArchitectureMetrics' };
    suggestions: { type: 'ArchitectureSuggestion[]' };
    dependencyGraph: { type: 'DependencyGraph' };
  };

  postconditions: [
    'All requested checks performed',
    'Violations ranked by severity',
    'Actionable suggestions generated',
  ];

  estimatedCost: {
    tokens: 20000;
    time: '2-5 minutes';
  };

  confidence: ConfidenceValue;
}

type ArchitectureCheck =
  | 'circular_deps'
  | 'large_interfaces'
  | 'unclear_responsibility'
  | 'dead_code'
  | 'coupling_analysis'
  | 'cohesion_analysis'
  | 'layer_violations';

interface ArchitectureViolation {
  type: ArchitectureCheck;
  severity: 'critical' | 'high' | 'medium' | 'low';
  location: string;
  description: string;
  suggestion: string;
  affectedEntities: string[];
}

interface ArchitectureMetrics {
  totalModules: number;
  averageCoupling: number;
  averageCohesion: number;
  cyclomaticComplexity: { min: number; max: number; average: number };
  dependencyDepth: { min: number; max: number; average: number };
}
```

---

### 4. tp_analyze_consistency

Check consistency between LiBrainian claims and implementation.

```typescript
interface TpAnalyzeConsistency {
  id: 'tp_analyze_consistency';
  name: 'Analyze Self-Consistency';
  category: 'self_improvement';
  description: 'Check consistency between LiBrainian claims and implementation';

  preconditions: [
    'Self-index available',
    'Test suite available',
  ];

  inputs: {
    checkTypes: {
      type: 'array';
      items: 'ConsistencyCheck';
      default: ['interface_signature', 'behavior_test_evidence', 'doc_code_alignment'];
    };
  };

  outputs: {
    inconsistencies: { type: 'Inconsistency[]' };
    phantomClaims: { type: 'PhantomClaim[]' };    // Claims without code support
    untestedClaims: { type: 'UntestedClaim[]' };  // Claims without test evidence
    docDrift: { type: 'DocDrift[]' };              // Doc doesn't match code
  };

  postconditions: [
    'All inconsistencies identified',
    'Each inconsistency has suggested resolution',
  ];

  estimatedCost: {
    tokens: 15000;
    time: '2-4 minutes';
  };

  confidence: ConfidenceValue;
}

type ConsistencyCheck =
  | 'interface_signature'
  | 'behavior_test_evidence'
  | 'doc_code_alignment'
  | 'type_definition_match'
  | 'export_usage_match';

interface Inconsistency {
  type: ConsistencyCheck;
  severity: 'error' | 'warning' | 'info';
  claimed: string;
  actual: string;
  location: string;
  suggestedResolution: string;
}

interface PhantomClaim {
  claim: string;
  claimedLocation: string;
  searchedLocations: string[];
  confidence: ConfidenceValue;
}

interface UntestedClaim {
  claim: string;
  entityId: string;
  expectedTestPattern: string;
  searchedTestFiles: string[];
}

interface DocDrift {
  docLocation: string;
  codeLocation: string;
  docContent: string;
  codeContent: string;
  driftType: 'signature_mismatch' | 'behavior_mismatch' | 'missing_doc' | 'outdated_doc';
}
```

---

### 5. tp_verify_claim

Verify a specific claim LiBrainian makes about itself.

```typescript
interface TpVerifyClaim {
  id: 'tp_verify_claim';
  name: 'Verify Self-Claim';
  category: 'self_improvement';
  description: 'Verify a specific claim LiBrainian makes about itself';

  preconditions: [
    'Claim identified',
    'Verification strategy available for claim type',
  ];

  inputs: {
    claim: {
      type: 'Claim';
      required: true;
    };
    verificationBudget: {
      type: 'VerificationBudget';
      default: { maxTokens: 5000; maxTimeMs: 60000 };
    };
    requiredConfidence: {
      type: 'number';
      default: 0.9;
      description: 'Minimum confidence threshold for verification';
    };
  };

  outputs: {
    verified: { type: 'boolean | "unknown"' };
    confidence: { type: 'ConfidenceValue' };
    evidence: { type: 'Evidence[]' };
    epistemicStatus: { type: 'EpistemicStatus' };
    gettierAnalysis: { type: 'GettierAnalysis' };
  };

  postconditions: [
    'Verification completed within budget',
    'Confidence calibrated',
    'Gettier risk assessed',
  ];

  estimatedCost: {
    tokens: 5000;
    time: '30 seconds - 2 minutes';
  };

  confidence: ConfidenceValue;
}

interface Claim {
  id: string;
  text: string;
  type: 'behavioral' | 'structural' | 'performance' | 'correctness';
  source: string;
  context: string;
}

interface VerificationBudget {
  maxTokens: number;
  maxTimeMs: number;
  maxApiCalls?: number;
}

type EpistemicStatus =
  | 'verified_with_evidence'
  | 'refuted_with_evidence'
  | 'inconclusive'
  | 'unverifiable'
  | 'gettier_case';

interface GettierAnalysis {
  isGettierCase: boolean;
  gettierRisk: number;  // 0.0-1.0
  justificationStrength: number;
  truthBasis: 'causal' | 'coincidental' | 'unknown';
  mitigationPath?: string;
}

interface Evidence {
  type: 'code' | 'test' | 'trace' | 'assertion' | 'measurement';
  content: string;
  location: string;
  confidence: ConfidenceValue;
}
```

---

### 6. tp_verify_calibration

Verify that LiBrainian confidence scores are well-calibrated.

```typescript
interface TpVerifyCalibration {
  id: 'tp_verify_calibration';
  name: 'Verify Calibration Quality';
  category: 'self_improvement';
  description: 'Verify that LiBrainian confidence scores are well-calibrated';

  preconditions: [
    'Historical predictions available',
    'Outcome data available',
  ];

  inputs: {
    sampleSize: {
      type: 'number';
      default: 500;
      description: 'Number of historical predictions to analyze';
    };
    binCount: {
      type: 'number';
      default: 10;
      description: 'Number of confidence bins for calibration curve';
    };
    targetECE: {
      type: 'number';
      default: 0.05;
      description: 'Target Expected Calibration Error';
    };
  };

  outputs: {
    ece: { type: 'number' };                       // Expected Calibration Error
    mce: { type: 'number' };                       // Maximum Calibration Error
    reliabilityDiagram: { type: 'ReliabilityDiagram' };
    sampleComplexityAnalysis: { type: 'SampleComplexityAnalysis' };
    calibrationStatus: { type: 'CalibrationStatus' };
  };

  postconditions: [
    'Calibration error computed with confidence interval',
    'Sample sufficiency assessed',
  ];

  estimatedCost: {
    tokens: 3000;
    time: '15-30 seconds';
  };

  confidence: ConfidenceValue;
}

interface ReliabilityDiagram {
  bins: Array<{
    binCenter: number;
    predictedProbability: number;
    actualFrequency: number;
    sampleCount: number;
  }>;
  perfectCalibrationLine: [number, number][];
}

interface SampleComplexityAnalysis {
  currentSampleSize: number;
  requiredForEpsilon: (epsilon: number) => number;
  currentEpsilon: number;
  confidenceInterval: [number, number];
  powerAnalysis: {
    currentPower: number;
    detectableEffectSize: number;
    samplesForPower80: number;
  };
}

type CalibrationStatus =
  | 'well_calibrated'      // ECE < targetECE
  | 'miscalibrated'        // ECE >= targetECE
  | 'insufficient_data'    // Not enough samples
  | 'distribution_shift';  // Detected drift from training
```

---

### 7. tp_improve_generate_recommendations

Generate prioritized recommendations from analysis results.

```typescript
interface TpImproveGenerateRecommendations {
  id: 'tp_improve_generate_recommendations';
  name: 'Generate Improvement Recommendations';
  category: 'self_improvement';
  description: 'Generate prioritized recommendations from analysis results';

  preconditions: ['Analysis results available'];

  inputs: {
    analysisResults: {
      type: 'AnalysisResults';
      required: true;
    };
    prioritizationCriteria: {
      type: 'PrioritizationCriteria';
      default: {
        weights: {
          severity: 0.4;
          effort: 0.2;
          impact: 0.3;
          riskReduction: 0.1;
        };
      };
    };
    maxRecommendations: {
      type: 'number';
      default: 20;
    };
  };

  outputs: {
    recommendations: { type: 'Recommendation[]' };
    roadmap: { type: 'ImprovementRoadmap' };
    effortEstimates: { type: 'EffortEstimate[]' };
    dependencies: { type: 'RecommendationDependency[]' };
  };

  postconditions: [
    'Recommendations ranked by priority',
    'Dependencies between recommendations identified',
    'Effort estimated per recommendation',
  ];

  estimatedCost: {
    tokens: 10000;
    time: '1-2 minutes';
  };

  confidence: ConfidenceValue;
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  category: 'architecture' | 'correctness' | 'performance' | 'maintainability' | 'theoretical';
  priority: number;  // 0.0-1.0
  severity: 'critical' | 'high' | 'medium' | 'low';
  effort: EffortEstimate;
  impact: string;
  affectedFiles: string[];
  relatedIssues: string[];
}

interface ImprovementRoadmap {
  phases: Array<{
    name: string;
    recommendations: string[];  // Recommendation IDs
    estimatedDuration: string;
    dependencies: string[];     // Phase names
  }>;
  totalEstimatedEffort: string;
  criticalPath: string[];
}

interface EffortEstimate {
  loc: { min: number; max: number };
  hours: { min: number; max: number };
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';
  confidence: ConfidenceValue;
}

interface RecommendationDependency {
  from: string;  // Recommendation ID
  to: string;    // Recommendation ID
  type: 'blocks' | 'enables' | 'conflicts_with' | 'related_to';
}
```

---

### 8. tp_improve_plan_fix

Plan a fix for an identified issue.

```typescript
interface TpImprovePlanFix {
  id: 'tp_improve_plan_fix';
  name: 'Plan Fix';
  category: 'self_improvement';
  description: 'Plan a fix for an identified issue';

  preconditions: [
    'Issue identified',
    'Codebase context available',
  ];

  inputs: {
    issue: {
      type: 'Issue';
      required: true;
    };
    constraints: {
      type: 'FixConstraints';
      default: {
        maxFilesChanged: 10;
        preservePublicApi: true;
        requireBackwardCompatibility: true;
      };
    };
    maxComplexity: {
      type: 'ComplexityBudget';
      default: { maxLoc: 500; maxCyclomaticComplexity: 10 };
    };
  };

  outputs: {
    plan: { type: 'FixPlan' };
    affectedFiles: { type: 'string[]' };
    riskAssessment: { type: 'RiskAssessment' };
    verificationCriteria: { type: 'VerificationCriteria' };
  };

  postconditions: [
    'Plan is implementable',
    'Risks identified',
    'Verification criteria defined',
  ];

  estimatedCost: {
    tokens: 8000;
    time: '1-3 minutes';
  };

  confidence: ConfidenceValue;
}

interface Issue {
  id: string;
  type: 'bug' | 'architecture' | 'performance' | 'consistency' | 'theoretical';
  description: string;
  location: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  evidence: Evidence[];
}

interface FixPlan {
  summary: string;
  steps: Array<{
    order: number;
    description: string;
    file: string;
    changeType: 'add' | 'modify' | 'delete' | 'refactor';
    estimatedLoc: number;
  }>;
  rollbackPlan: string;
  testStrategy: string;
}

interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  risks: Array<{
    type: string;
    description: string;
    likelihood: number;  // 0.0-1.0
    impact: number;      // 0.0-1.0
    mitigation: string;
  }>;
}

interface VerificationCriteria {
  unitTests: string[];
  integrationTests: string[];
  manualChecks: string[];
  performanceBenchmarks?: string[];
}
```

---

### 9. tp_improve_adversarial_test

Generate adversarial test cases targeting known weaknesses.

```typescript
interface TpImproveAdversarialTest {
  id: 'tp_improve_adversarial_test';
  name: 'Generate Adversarial Test';
  category: 'self_improvement';
  description: 'Generate adversarial test cases targeting known weaknesses';

  preconditions: ['Weakness identified'];

  inputs: {
    weakness: {
      type: 'Weakness';
      required: true;
    };
    difficulty: {
      type: 'enum';
      values: ['easy', 'medium', 'hard', 'extreme'];
      default: 'hard';
    };
    count: {
      type: 'number';
      default: 10;
    };
  };

  outputs: {
    testCases: { type: 'AdversarialTestCase[]' };
    expectedFailureModes: { type: 'FailureMode[]' };
    coverageAnalysis: { type: 'WeaknessCoverage' };
  };

  postconditions: [
    'Test cases target specified weakness',
    'Expected failure modes documented',
  ];

  estimatedCost: {
    tokens: 5000;
    time: '30 seconds - 1 minute';
  };

  confidence: ConfidenceValue;
}

interface Weakness {
  id: string;
  type: 'edge_case' | 'boundary' | 'race_condition' | 'resource_exhaustion' | 'semantic_confusion';
  description: string;
  affectedComponent: string;
  discoveredBy: string;
  gettierRisk?: number;
}

interface AdversarialTestCase {
  id: string;
  name: string;
  description: string;
  input: unknown;
  expectedBehavior: 'fail' | 'degrade' | 'timeout' | 'incorrect_output';
  difficulty: 'easy' | 'medium' | 'hard' | 'extreme';
  targetedWeakness: string;
  testCode: string;
}

interface FailureMode {
  mode: string;
  probability: number;
  severity: 'crash' | 'incorrect' | 'degraded' | 'slow';
  recovery: string;
}

interface WeaknessCoverage {
  weaknessId: string;
  testsCovering: string[];
  uncoveredAspects: string[];
  coverageScore: number;  // 0.0-1.0
}
```

---

### 10. tp_learn_from_outcome

Update LiBrainian knowledge based on outcome feedback.

```typescript
interface TpLearnFromOutcome {
  id: 'tp_learn_from_outcome';
  name: 'Learn From Outcome';
  category: 'self_improvement';
  description: 'Update LiBrainian knowledge based on outcome feedback';

  preconditions: [
    'Outcome available',
    'Original prediction/claim available',
  ];

  inputs: {
    prediction: {
      type: 'Prediction';
      required: true;
    };
    actualOutcome: {
      type: 'Outcome';
      required: true;
    };
    context: {
      type: 'PredictionContext';
      required: true;
    };
  };

  outputs: {
    calibrationUpdate: { type: 'CalibrationUpdate' };
    knowledgeUpdates: { type: 'KnowledgeUpdate[]' };
    patternLearned: { type: 'LearnedPattern | null' };
    confidenceAdjustment: { type: 'ConfidenceAdjustment' };
  };

  postconditions: [
    'Calibration model updated',
    'Relevant knowledge updated',
    'Learning recorded in episode',
  ];

  estimatedCost: {
    tokens: 2000;
    time: '10-20 seconds';
  };

  confidence: ConfidenceValue;
}

interface Prediction {
  id: string;
  claim: string;
  predictedOutcome: unknown;
  statedConfidence: ConfidenceValue;
  timestamp: Date;
  context: string;
}

interface Outcome {
  predictionId: string;
  actualValue: unknown;
  wasCorrect: boolean;
  verificationMethod: 'automated' | 'human' | 'downstream_success';
  timestamp: Date;
}

interface CalibrationUpdate {
  previousECE: number;
  newECE: number;
  samplesAdded: number;
  binUpdates: Array<{
    bin: number;
    previousFrequency: number;
    newFrequency: number;
  }>;
}

interface KnowledgeUpdate {
  entityId: string;
  updateType: 'confidence_adjust' | 'claim_revise' | 'relationship_add' | 'relationship_remove';
  before: unknown;
  after: unknown;
  reason: string;
}

interface ConfidenceAdjustment {
  entityId: string;
  previous: ConfidenceValue;
  adjusted: ConfidenceValue;
  reason: string;
}
```

---

### 11. tp_learn_extract_pattern

Extract reusable pattern from successful improvement.

```typescript
interface TpLearnExtractPattern {
  id: 'tp_learn_extract_pattern';
  name: 'Extract Pattern';
  category: 'self_improvement';
  description: 'Extract reusable pattern from successful improvement';

  preconditions: [
    'Successful improvement completed',
    'Before/after state available',
  ];

  inputs: {
    improvement: {
      type: 'CompletedImprovement';
      required: true;
    };
    minGenerality: {
      type: 'number';
      default: 0.7;
      description: 'Minimum generality score for pattern extraction';
    };
  };

  outputs: {
    pattern: { type: 'ImprovementPattern | null' };
    applicability: { type: 'ApplicabilityConditions' };
    expectedBenefit: { type: 'ExpectedBenefit' };
  };

  postconditions: [
    'Pattern is generalizable (if extracted)',
    'Applicability conditions defined',
  ];

  estimatedCost: {
    tokens: 5000;
    time: '30 seconds - 1 minute';
  };

  confidence: ConfidenceValue;
}

interface CompletedImprovement {
  id: string;
  type: 'refactor' | 'fix' | 'optimization' | 'feature';
  before: {
    code: string;
    metrics: Record<string, number>;
    issues: Issue[];
  };
  after: {
    code: string;
    metrics: Record<string, number>;
    resolvedIssues: string[];
  };
  verificationResult: 'success' | 'partial' | 'failed';
}

interface ImprovementPattern {
  id: string;
  name: string;
  description: string;
  category: 'structural' | 'behavioral' | 'performance' | 'correctness';
  trigger: string;        // When to apply
  transformation: string; // What to do
  constraints: string[];  // When NOT to apply
  examples: Array<{
    before: string;
    after: string;
  }>;
  confidence: ConfidenceValue;
}

interface ApplicabilityConditions {
  requiredContext: string[];
  excludingContext: string[];
  codePatterns: string[];  // Regex or AST patterns
  estimatedApplicability: number;  // 0.0-1.0
}

interface ExpectedBenefit {
  metricImprovements: Record<string, { min: number; max: number }>;
  riskReduction: number;  // 0.0-1.0
  confidence: ConfidenceValue;
}
```

---

## Self-Improvement Compositions

### Composition 1: tc_self_audit_full

Complete audit of LiBrainian health, theoretical soundness, and consistency.

```typescript
interface TcSelfAuditFull {
  id: 'tc_self_audit_full';
  name: 'Full Self-Audit';
  description: 'Complete audit of LiBrainian health, theoretical soundness, and consistency';

  primitives: [
    'tp_self_bootstrap',
    'tp_analyze_architecture',
    'tp_analyze_theoretical_soundness',
    'tp_analyze_consistency',
    'tp_verify_calibration',
    'tp_improve_generate_recommendations',
  ];

  operators: [
    {
      id: 'op_bootstrap_gate';
      type: 'gate';
      inputs: ['tp_self_bootstrap'];
      conditions: ['bootstrap completed with >90% coverage'];
      onFail: 'abort_with_diagnostic';
    },
    {
      id: 'op_parallel_analysis';
      type: 'parallel';
      inputs: ['tp_analyze_architecture', 'tp_analyze_theoretical_soundness', 'tp_analyze_consistency'];
    },
    {
      id: 'op_aggregate_findings';
      type: 'aggregate';
      inputs: ['op_parallel_analysis', 'tp_verify_calibration'];
      aggregation: 'merge_findings';
    },
    {
      id: 'op_severity_gate';
      type: 'gate';
      inputs: ['op_aggregate_findings'];
      conditions: ['no critical blocking issues'];
      onFail: 'escalate_to_human';
    },
  ];

  flow: `
    tp_self_bootstrap
         │
         ▼
    op_bootstrap_gate ──[fail]──▶ ABORT
         │
         ▼
    ┌────┴────┬────────────┐
    │         │            │
    ▼         ▼            ▼
  tp_analyze  tp_analyze   tp_analyze
  _architecture _theoretical _consistency
    │         │            │
    └────┬────┴────────────┘
         │
         ▼
    op_parallel_analysis
         │
         ├───────────────────┐
         │                   │
         ▼                   ▼
    op_aggregate_findings  tp_verify_calibration
         │                   │
         └─────────┬─────────┘
                   │
                   ▼
         op_severity_gate ──[fail]──▶ ESCALATE
                   │
                   ▼
         tp_improve_generate_recommendations
                   │
                   ▼
              AUDIT_REPORT
  `;

  estimatedCost: {
    tokens: 100000;
    time: '15-30 minutes';
  };

  outputs: {
    auditReport: { type: 'FullAuditReport' };
    recommendations: { type: 'Recommendation[]' };
    roadmap: { type: 'ImprovementRoadmap' };
    healthScore: { type: 'number' };
  };
}

interface FullAuditReport {
  timestamp: Date;
  duration: number;
  healthScore: number;  // 0.0-1.0
  summary: string;
  architectureReport: ArchitectureReport;
  consistencyReport: ConsistencyReport;
  calibrationReport: CalibrationReport;
  criticalIssues: Issue[];
  recommendationCount: number;
}
```

---

### Composition 2: tc_self_check_incremental

Quick check after changes for immediate feedback.

```typescript
interface TcSelfCheckIncremental {
  id: 'tc_self_check_incremental';
  name: 'Incremental Self-Check';
  description: 'Quick check after changes for immediate feedback';

  primitives: [
    'tp_self_refresh',
    'tp_analyze_consistency',
    'tp_verify_calibration',
    'tp_learn_from_outcome',
  ];

  operators: [
    {
      id: 'op_refresh_gate';
      type: 'gate';
      inputs: ['tp_self_refresh'];
      conditions: ['refresh completed'];
    },
    {
      id: 'op_quick_checks';
      type: 'parallel';
      inputs: ['tp_analyze_consistency', 'tp_verify_calibration'];
    },
    {
      id: 'op_check_gate';
      type: 'gate';
      inputs: ['op_quick_checks'];
      conditions: ['no new critical inconsistencies', 'calibration within bounds'];
      onFail: 'flag_for_review';
    },
  ];

  flow: `
    tp_self_refresh
         │
         ▼
    op_refresh_gate
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  tp_analyze  tp_verify
  _consistency _calibration
    │         │
    └────┬────┘
         │
         ▼
    op_check_gate ──[fail]──▶ FLAG_FOR_REVIEW
         │
         ▼
    tp_learn_from_outcome
         │
         ▼
    INCREMENTAL_REPORT
  `;

  estimatedCost: {
    tokens: 15000;
    time: '2-5 minutes';
  };

  outputs: {
    incrementalReport: { type: 'IncrementalCheckReport' };
    newIssues: { type: 'Issue[]' };
    resolvedIssues: { type: 'Issue[]' };
  };
}

interface IncrementalCheckReport {
  timestamp: Date;
  duration: number;
  changesDetected: number;
  entitiesRefreshed: number;
  newIssues: Issue[];
  resolvedIssues: Issue[];
  calibrationDelta: number;
  status: 'healthy' | 'needs_attention' | 'degraded';
}
```

---

### Composition 3: tc_resolve_gettier_case

Systematically resolve a Gettier case (accidentally true belief).

```typescript
interface TcResolveGettierCase {
  id: 'tc_resolve_gettier_case';
  name: 'Resolve Gettier Case';
  description: 'Systematically resolve a Gettier case (accidentally true belief)';

  primitives: [
    'tp_verify_claim',
    'tp_analyze_theoretical_soundness',
    'tp_improve_plan_fix',
    'tp_improve_adversarial_test',
    'tp_learn_from_outcome',
  ];

  operators: [
    {
      id: 'op_initial_verify';
      type: 'execute';
      inputs: ['tp_verify_claim'];
      config: { requiredConfidence: 0.95; includeGettierAnalysis: true };
    },
    {
      id: 'op_gettier_gate';
      type: 'gate';
      inputs: ['op_initial_verify'];
      conditions: ['gettier_risk < 0.3'];
      onFail: 'continue_to_resolution';
    },
    {
      id: 'op_resolution_loop';
      type: 'iterate';
      inputs: ['tp_improve_plan_fix', 'tp_improve_adversarial_test'];
      maxIterations: 3;
      exitCondition: 'gettier_risk < 0.3';
    },
  ];

  flow: `
    tp_verify_claim (with gettier analysis)
         │
         ▼
    op_gettier_gate ──[pass]──▶ ALREADY_SAFE
         │
         ▼ [gettier_risk >= 0.3]
    tp_analyze_theoretical_soundness
         │
         ▼
    ┌────────────────────────────┐
    │   op_resolution_loop       │
    │                            │
    │  tp_improve_plan_fix       │
    │         │                  │
    │         ▼                  │
    │  tp_improve_adversarial    │
    │  _test                     │
    │         │                  │
    │         ▼                  │
    │  tp_verify_claim           │
    │         │                  │
    │  [gettier_risk < 0.3?]     │
    │    ├─[yes]──▶ EXIT         │
    │    └─[no]───▶ ITERATE      │
    └────────────────────────────┘
         │
         ▼
    tp_learn_from_outcome
         │
         ▼
    GETTIER_RESOLUTION_REPORT
  `;

  estimatedCost: {
    tokens: 40000;
    time: '10-20 minutes';
  };

  outputs: {
    resolutionReport: { type: 'GettierResolutionReport' };
    strengthenedJustification: { type: 'Justification' };
    newTests: { type: 'TestCase[]' };
  };
}

interface GettierResolutionReport {
  claimId: string;
  initialGettierRisk: number;
  finalGettierRisk: number;
  iterationsRequired: number;
  justificationStrengthened: boolean;
  newTestsAdded: number;
  resolution: 'resolved' | 'partially_resolved' | 'unresolvable';
  explanation: string;
}

interface Justification {
  claimId: string;
  evidenceChain: Evidence[];
  causalLinks: Array<{ from: string; to: string; strength: number }>;
  counterevidence: Evidence[];
  overallStrength: ConfidenceValue;
}
```

---

### Composition 4: tc_adversarial_self_test

Generate and run adversarial tests to find weaknesses.

```typescript
interface TcAdversarialSelfTest {
  id: 'tc_adversarial_self_test';
  name: 'Adversarial Self-Test Suite';
  description: 'Generate and run adversarial tests to find weaknesses';

  primitives: [
    'tp_analyze_architecture',
    'tp_analyze_theoretical_soundness',
    'tp_improve_adversarial_test',
    'tp_verify_claim',
    'tp_improve_plan_fix',
    'tp_learn_extract_pattern',
  ];

  operators: [
    {
      id: 'op_identify_weaknesses';
      type: 'parallel';
      inputs: ['tp_analyze_architecture', 'tp_analyze_theoretical_soundness'];
    },
    {
      id: 'op_weakness_aggregator';
      type: 'aggregate';
      inputs: ['op_identify_weaknesses'];
      aggregation: 'extract_weaknesses';
    },
    {
      id: 'op_generate_tests';
      type: 'map';
      inputs: ['tp_improve_adversarial_test'];
      over: 'weaknesses';
      config: { difficulty: 'hard'; count: 10 };
    },
    {
      id: 'op_run_tests';
      type: 'map';
      inputs: ['tp_verify_claim'];
      over: 'test_cases';
    },
    {
      id: 'op_failure_analysis';
      type: 'filter';
      inputs: ['op_run_tests'];
      predicate: 'test_failed';
    },
    {
      id: 'op_plan_fixes';
      type: 'map';
      inputs: ['tp_improve_plan_fix'];
      over: 'failures';
    },
  ];

  flow: `
    ┌────────────────┬─────────────────┐
    │                │                 │
    ▼                ▼                 │
  tp_analyze       tp_analyze          │
  _architecture    _theoretical        │
    │                │                 │
    └────────┬───────┘                 │
             │                         │
             ▼                         │
    op_weakness_aggregator             │
             │                         │
             ▼ [for each weakness]     │
    ┌────────────────────────┐         │
    │ tp_improve_adversarial │         │
    │ _test                  │         │
    └────────────────────────┘         │
             │                         │
             ▼ [test_cases]            │
    ┌────────────────────────┐         │
    │ op_run_tests           │         │
    │ (tp_verify_claim xN)   │         │
    └────────────────────────┘         │
             │                         │
             ▼                         │
    op_failure_analysis ───[0 failures]┘
             │
             ▼ [failures]
    ┌────────────────────────┐
    │ op_plan_fixes          │
    │ (tp_improve_plan_fix)  │
    └────────────────────────┘
             │
             ▼
    tp_learn_extract_pattern
             │
             ▼
    ADVERSARIAL_TEST_REPORT
  `;

  estimatedCost: {
    tokens: 80000;
    time: '20-40 minutes';
  };

  outputs: {
    testReport: { type: 'AdversarialTestReport' };
    weaknessesFound: { type: 'Weakness[]' };
    failedTests: { type: 'FailedTest[]' };
    fixPlans: { type: 'FixPlan[]' };
    patternsLearned: { type: 'LearnedPattern[]' };
  };
}

interface AdversarialTestReport {
  timestamp: Date;
  duration: number;
  weaknessesIdentified: number;
  testsGenerated: number;
  testsRun: number;
  testsFailed: number;
  fixesPlanned: number;
  patternsExtracted: number;
  overallRobustness: number;  // 0.0-1.0
}

interface FailedTest {
  testCase: AdversarialTestCase;
  actualBehavior: string;
  expectedBehavior: string;
  failureMode: FailureMode;
  stackTrace?: string;
}
```

---

### Composition 5: tc_continuous_improvement

Full improvement cycle from detection to learning.

```typescript
interface TcContinuousImprovement {
  id: 'tc_continuous_improvement';
  name: 'Continuous Self-Improvement Pipeline';
  description: 'Full improvement cycle from detection to learning';

  primitives: [
    'tp_self_refresh',
    'tp_analyze_architecture',
    'tp_analyze_theoretical_soundness',
    'tp_analyze_consistency',
    'tp_verify_calibration',
    'tp_improve_generate_recommendations',
    'tp_improve_plan_fix',
    'tp_verify_claim',
    'tp_learn_from_outcome',
    'tp_learn_extract_pattern',
  ];

  operators: [
    {
      id: 'op_detect_phase';
      type: 'sequence';
      inputs: ['tp_self_refresh', 'tp_analyze_architecture', 'tp_analyze_theoretical_soundness', 'tp_analyze_consistency'];
    },
    {
      id: 'op_assess_phase';
      type: 'sequence';
      inputs: ['tp_verify_calibration', 'tp_improve_generate_recommendations'];
    },
    {
      id: 'op_priority_gate';
      type: 'gate';
      inputs: ['op_assess_phase'];
      conditions: ['has_actionable_recommendations'];
      onFail: 'exit_healthy';
    },
    {
      id: 'op_fix_phase';
      type: 'iterate';
      inputs: ['tp_improve_plan_fix', 'tp_verify_claim'];
      over: 'top_recommendations';
      maxIterations: 5;
      exitCondition: 'all_verified_or_budget_exhausted';
    },
    {
      id: 'op_learn_phase';
      type: 'sequence';
      inputs: ['tp_learn_from_outcome', 'tp_learn_extract_pattern'];
    },
  ];

  flow: `
    ══════════════════════════════════════════════════════════════════
    PHASE 1: DETECT
    ══════════════════════════════════════════════════════════════════

    tp_self_refresh
         │
         ▼
    ┌────┴────┬────────────┬──────────────┐
    │         │            │              │
    ▼         ▼            ▼              │
  tp_analyze  tp_analyze   tp_analyze     │
  _architecture _theoretical _consistency │
    │         │            │              │
    └────┬────┴────────────┘              │
         │                                │
    ══════════════════════════════════════════════════════════════════
    PHASE 2: ASSESS
    ══════════════════════════════════════════════════════════════════
         │
         ▼
    tp_verify_calibration
         │
         ▼
    tp_improve_generate_recommendations
         │
         ▼
    op_priority_gate ──[no recommendations]──▶ EXIT_HEALTHY
         │
    ══════════════════════════════════════════════════════════════════
    PHASE 3: FIX (iterative)
    ══════════════════════════════════════════════════════════════════
         │
         ▼
    ┌───────────────────────────────────┐
    │  FOR EACH top_recommendation:    │
    │                                   │
    │    tp_improve_plan_fix           │
    │         │                        │
    │         ▼                        │
    │    [IMPLEMENT FIX]               │
    │         │                        │
    │         ▼                        │
    │    tp_verify_claim               │
    │         │                        │
    │    [verified?]                   │
    │      ├─[yes]──▶ next             │
    │      └─[no]───▶ retry or skip    │
    │                                   │
    └───────────────────────────────────┘
         │
    ══════════════════════════════════════════════════════════════════
    PHASE 4: LEARN
    ══════════════════════════════════════════════════════════════════
         │
         ▼
    tp_learn_from_outcome
         │
         ▼
    tp_learn_extract_pattern
         │
         ▼
    IMPROVEMENT_CYCLE_REPORT
  `;

  estimatedCost: {
    tokens: 150000;
    time: '30-60 minutes';
  };

  outputs: {
    cycleReport: { type: 'ImprovementCycleReport' };
    fixesApplied: { type: 'AppliedFix[]' };
    patternsLearned: { type: 'LearnedPattern[]' };
    nextCycleRecommendations: { type: 'Recommendation[]' };
    healthDelta: { type: 'HealthDelta' };
  };
}

interface ImprovementCycleReport {
  timestamp: Date;
  duration: number;
  phases: PhaseReport[];
  fixesAttempted: number;
  fixesSucceeded: number;
  patternsExtracted: number;
  healthBefore: number;
  healthAfter: number;
  status: 'complete' | 'partial' | 'failed';
}

interface PhaseReport {
  name: 'detect' | 'assess' | 'fix' | 'learn';
  status: 'success' | 'partial' | 'failed' | 'skipped';
  duration: number;
  findings: number;
  errors: string[];
}

interface HealthDelta {
  overall: number;
  byCategory: Record<string, number>;
  improved: string[];
  degraded: string[];
  unchanged: string[];
}
```

---

## SelfImprovementExecutor

Execution engine for self-improvement primitives and compositions.

```typescript
import type { ConfidenceValue } from '../epistemics/confidence.js';

/**
 * Self-Improvement Primitive Executor
 *
 * Executes self-improvement primitives with proper context and tracking.
 */
class SelfImprovementExecutor {
  constructor(
    private readonly LiBrainian: LiBrainian,
    private readonly storage: LibrarianStorage,
    private readonly episodeRecorder: EpisodeRecorder,
    private readonly config: ExecutorConfig
  ) {}

  /**
   * Execute a self-improvement primitive
   */
  async executePrimitive<T extends SelfImprovementPrimitive>(
    primitive: T,
    inputs: PrimitiveInputs<T>,
    context: ExecutionContext
  ): Promise<PrimitiveResult<T>> {
    // Record episode start
    const episode = await this.episodeRecorder.startEpisode({
      type: 'self_improvement',
      primitive: primitive.id,
      inputs,
    });

    try {
      // Check preconditions
      const preconditionCheck = await this.checkPreconditions(primitive, context);
      if (!preconditionCheck.satisfied) {
        throw new PreconditionError(primitive.id, preconditionCheck.failures);
      }

      // Execute primitive
      const result = await this.executeCore(primitive, inputs, context);

      // Verify postconditions
      const postconditionCheck = await this.checkPostconditions(primitive, result);
      if (!postconditionCheck.satisfied) {
        episode.addWarning('postcondition_partial', postconditionCheck.failures);
      }

      // Record success
      await this.episodeRecorder.completeEpisode(episode, {
        status: 'success',
        result,
        postconditions: postconditionCheck,
      });

      return result;
    } catch (error) {
      // Record failure
      await this.episodeRecorder.completeEpisode(episode, {
        status: 'failed',
        error,
      });
      throw error;
    }
  }

  /**
   * Execute a self-improvement composition
   */
  async *executeComposition<T extends SelfImprovementComposition>(
    composition: T,
    inputs: CompositionInputs<T>,
    context: ExecutionContext
  ): AsyncGenerator<CompositionStepResult, CompositionResult<T>> {
    const episode = await this.episodeRecorder.startEpisode({
      type: 'self_improvement_composition',
      composition: composition.id,
      inputs,
    });

    const state = new CompositionState(composition, inputs);

    try {
      while (!state.isComplete()) {
        const nextStep = state.getNextStep();

        if (nextStep.type === 'primitive') {
          const result = await this.executePrimitive(
            nextStep.primitive,
            state.getInputsFor(nextStep),
            context
          );
          state.recordResult(nextStep, result);
          yield { step: nextStep, result, state: state.snapshot() };
        } else if (nextStep.type === 'operator') {
          const result = await this.executeOperator(nextStep.operator, state, context);
          state.recordResult(nextStep, result);
          yield { step: nextStep, result, state: state.snapshot() };

          // Handle gate failures
          if (nextStep.operator.type === 'gate' && !result.passed) {
            if (nextStep.operator.onFail === 'abort_with_diagnostic') {
              throw new GateAbortError(nextStep.operator.id, result.diagnostic);
            } else if (nextStep.operator.onFail === 'escalate_to_human') {
              yield { step: nextStep, escalation: result.diagnostic };
              return state.getFinalResult();
            }
          }
        }
      }

      // Record composition completion
      await this.episodeRecorder.completeEpisode(episode, {
        status: 'success',
        finalState: state.snapshot(),
      });

      return state.getFinalResult();
    } catch (error) {
      await this.episodeRecorder.completeEpisode(episode, {
        status: 'failed',
        error,
        partialState: state.snapshot(),
      });
      throw error;
    }
  }

  /**
   * Execute an operator
   */
  private async executeOperator(
    operator: Operator,
    state: CompositionState,
    context: ExecutionContext
  ): Promise<OperatorResult> {
    switch (operator.type) {
      case 'gate':
        return this.executeGate(operator, state);

      case 'parallel':
        return this.executeParallel(operator, state, context);

      case 'iterate':
        return this.executeIterate(operator, state, context);

      case 'map':
        return this.executeMap(operator, state, context);

      case 'aggregate':
        return this.executeAggregate(operator, state);

      case 'filter':
        return this.executeFilter(operator, state);

      case 'sequence':
        return this.executeSequence(operator, state, context);

      default:
        throw new UnknownOperatorError((operator as Operator).type);
    }
  }

  private async executeGate(
    operator: GateOperator,
    state: CompositionState
  ): Promise<GateResult> {
    const inputResults = operator.inputs.map(id => state.getResult(id));

    for (const condition of operator.conditions) {
      const satisfied = await this.evaluateCondition(condition, inputResults);
      if (!satisfied) {
        return {
          passed: false,
          failedCondition: condition,
          diagnostic: await this.generateDiagnostic(condition, inputResults),
        };
      }
    }

    return { passed: true };
  }

  private async executeParallel(
    operator: ParallelOperator,
    state: CompositionState,
    context: ExecutionContext
  ): Promise<ParallelResult> {
    const primitives = operator.inputs.map(id =>
      this.findPrimitive(id, state.composition)
    );

    const results = await Promise.all(
      primitives.map(p =>
        this.executePrimitive(p, state.getInputsFor({ primitive: p }), context)
      )
    );

    return { results };
  }

  private async executeIterate(
    operator: IterateOperator,
    state: CompositionState,
    context: ExecutionContext
  ): Promise<IterateResult> {
    const iterations: IterationResult[] = [];

    for (let i = 0; i < operator.maxIterations; i++) {
      // Execute primitives in sequence
      for (const primitiveId of operator.inputs) {
        const primitive = this.findPrimitive(primitiveId, state.composition);
        const result = await this.executePrimitive(
          primitive,
          state.getInputsFor({ primitive }),
          context
        );
        state.recordIterationResult(i, primitiveId, result);
      }

      // Check exit condition
      if (await this.evaluateCondition(operator.exitCondition, state.snapshot())) {
        iterations.push({ iteration: i, exitedEarly: true });
        break;
      }

      iterations.push({ iteration: i, exitedEarly: false });
    }

    return { iterations, totalIterations: iterations.length };
  }

  private async executeMap(
    operator: MapOperator,
    state: CompositionState,
    context: ExecutionContext
  ): Promise<MapResult> {
    const items = state.getCollection(operator.over);
    const primitive = this.findPrimitive(operator.inputs[0], state.composition);

    const results = await Promise.all(
      items.map((item, index) =>
        this.executePrimitive(
          primitive,
          { ...operator.config, item, index },
          context
        )
      )
    );

    return { results, itemCount: items.length };
  }
}

// Type definitions
interface ExecutorConfig {
  maxParallelPrimitives: number;
  defaultTimeout: number;
  retryPolicy: RetryPolicy;
}

interface CompositionStepResult {
  step: Step;
  result?: unknown;
  state: CompositionSnapshot;
  escalation?: Diagnostic;
}

interface GateResult {
  passed: boolean;
  failedCondition?: string;
  diagnostic?: Diagnostic;
}

interface ParallelResult {
  results: unknown[];
}

interface IterateResult {
  iterations: IterationResult[];
  totalIterations: number;
}

interface IterationResult {
  iteration: number;
  exitedEarly: boolean;
}

interface MapResult {
  results: unknown[];
  itemCount: number;
}

type Operator =
  | GateOperator
  | ParallelOperator
  | IterateOperator
  | MapOperator
  | AggregateOperator
  | FilterOperator
  | SequenceOperator;

interface GateOperator {
  type: 'gate';
  id: string;
  inputs: string[];
  conditions: string[];
  onFail: 'abort_with_diagnostic' | 'escalate_to_human' | 'continue' | 'flag_for_review';
}

interface ParallelOperator {
  type: 'parallel';
  id: string;
  inputs: string[];
}

interface IterateOperator {
  type: 'iterate';
  id: string;
  inputs: string[];
  maxIterations: number;
  exitCondition: string;
  over?: string;
}

interface MapOperator {
  type: 'map';
  id: string;
  inputs: string[];
  over: string;
  config?: Record<string, unknown>;
}

// Error types
class PreconditionError extends Error {
  constructor(
    public readonly primitiveId: string,
    public readonly failures: string[]
  ) {
    super(`Preconditions not met for ${primitiveId}: ${failures.join(', ')}`);
  }
}

class GateAbortError extends Error {
  constructor(
    public readonly gateId: string,
    public readonly diagnostic: Diagnostic
  ) {
    super(`Gate ${gateId} aborted: ${diagnostic.message}`);
  }
}

class UnknownOperatorError extends Error {
  constructor(public readonly operatorType: string) {
    super(`Unknown operator type: ${operatorType}`);
  }
}
```

---

## Knowledge Freshness Detection

System for detecting and managing knowledge staleness.

```typescript
interface FreshnessDetector {
  /**
   * Assess freshness of all knowledge about a workspace
   */
  assessFreshness(options: FreshnessOptions): Promise<FreshnessReport>;

  /**
   * Get staleness score for a specific entity
   */
  getEntityStaleness(entityId: string): Promise<StalenessScore>;

  /**
   * Subscribe to freshness change events
   */
  onFreshnessChange(callback: (event: FreshnessEvent) => void): Unsubscribe;

  /**
   * Trigger refresh for stale entities
   */
  refreshStale(threshold: number): Promise<RefreshResult>;
}

interface FreshnessOptions {
  workspace: string;
  since?: string;  // Git ref or timestamp
  includeTransitive?: boolean;
  stalenessThreshold?: number;
}

interface FreshnessReport {
  timestamp: Date;
  workspace: string;
  totalEntities: number;
  freshEntities: number;
  staleEntities: number;
  staleness: {
    average: number;
    max: number;
    distribution: Array<{ bucket: string; count: number }>;
  };
  entities: EntityFreshness[];
  recommendations: RefreshRecommendation[];
}

interface EntityFreshness {
  entityId: string;
  type: string;
  lastIndexed: Date;
  lastFileModified: Date;
  stalenessScore: number;  // 0.0 = fresh, 1.0 = very stale
  stalenessReasons: StalenessReason[];
  dependentEntities: string[];
  refreshPriority: 'critical' | 'high' | 'medium' | 'low';
}

interface StalenessScore {
  value: number;  // 0.0-1.0
  components: {
    timeSinceIndexed: number;
    fileChanges: number;
    dependencyChanges: number;
    calibrationDrift: number;
  };
  confidence: ConfidenceValue;
}

type StalenessReason =
  | { type: 'file_modified'; path: string; modifiedAt: Date }
  | { type: 'dependency_changed'; dependencyId: string }
  | { type: 'time_decay'; daysSinceIndexed: number }
  | { type: 'calibration_drift'; previousAccuracy: number; expectedAccuracy: number }
  | { type: 'distribution_shift'; shiftMagnitude: number };

interface RefreshRecommendation {
  entityId: string;
  priority: number;
  reason: string;
  estimatedCost: { tokens: number; time: string };
}

interface FreshnessEvent {
  type: 'entity_became_stale' | 'entity_refreshed' | 'batch_stale';
  entityIds: string[];
  timestamp: Date;
  trigger: 'file_change' | 'time_decay' | 'manual' | 'dependency_cascade';
}

/**
 * Implementation constants
 */
const FRESHNESS_THRESHOLDS = {
  /** Entity is considered stale after this many days without refresh */
  TIME_DECAY_DAYS: 7,

  /** Staleness score above this triggers refresh recommendation */
  REFRESH_THRESHOLD: 0.5,

  /** Critical staleness requiring immediate attention */
  CRITICAL_THRESHOLD: 0.8,

  /** Decay rate per day (exponential) */
  DECAY_RATE: 0.05,
};
```

---

## Distribution Shift Warning

System for detecting when underlying assumptions no longer hold.

```typescript
interface DistributionShiftDetector {
  /**
   * Check for distribution shift in predictions
   */
  detectShift(options: ShiftDetectionOptions): Promise<ShiftReport>;

  /**
   * Monitor calibration drift over time
   */
  monitorCalibration(windowSize: number): Promise<CalibrationDriftReport>;

  /**
   * Get warning if current query is out-of-distribution
   */
  checkQueryDistribution(query: Query): Promise<DistributionWarning | null>;
}

interface ShiftDetectionOptions {
  /** Time window for comparison */
  comparisonWindow: {
    baseline: { start: Date; end: Date };
    current: { start: Date; end: Date };
  };

  /** Statistical tests to run */
  tests: ShiftTest[];

  /** Significance level for tests */
  alpha: number;
}

type ShiftTest =
  | 'kolmogorov_smirnov'
  | 'population_stability_index'
  | 'chi_squared'
  | 'wasserstein_distance';

interface ShiftReport {
  timestamp: Date;
  shiftDetected: boolean;
  severity: 'none' | 'minor' | 'moderate' | 'severe';
  tests: Array<{
    test: ShiftTest;
    statistic: number;
    pValue: number;
    significant: boolean;
  }>;
  affectedDimensions: string[];
  recommendations: ShiftRecommendation[];
  confidence: ConfidenceValue;
}

interface CalibrationDriftReport {
  timestamp: Date;
  windowSize: number;
  baseline: {
    ece: number;
    mce: number;
    sampleSize: number;
  };
  current: {
    ece: number;
    mce: number;
    sampleSize: number;
  };
  drift: {
    eceDelta: number;
    mceDelta: number;
    significant: boolean;
    direction: 'improving' | 'degrading' | 'stable';
  };
  trendAnalysis: {
    slope: number;
    projectedECE: number;
    daysUntilThreshold: number | null;
  };
}

interface DistributionWarning {
  severity: 'low' | 'medium' | 'high';
  message: string;
  reason: 'out_of_distribution' | 'sparse_region' | 'extrapolation_required';
  suggestedActions: string[];
  confidenceAdjustment: {
    multiplier: number;
    reason: string;
  };
}

type ShiftRecommendation =
  | { action: 'recalibrate'; urgency: 'immediate' | 'soon' | 'scheduled' }
  | { action: 'reindex'; scope: string[] }
  | { action: 'alert_human'; reason: string }
  | { action: 'widen_confidence_intervals'; factor: number };

/**
 * Population Stability Index thresholds
 */
const PSI_THRESHOLDS = {
  /** No significant shift */
  NONE: 0.1,
  /** Minor shift, monitor */
  MINOR: 0.2,
  /** Significant shift, action needed */
  SIGNIFICANT: 0.25,
};
```

---

## Health Dashboard Interface

Interface for monitoring LiBrainian's self-improvement health.

```typescript
interface HealthDashboard {
  /**
   * Get current health summary
   */
  getHealthSummary(): Promise<HealthSummary>;

  /**
   * Get detailed health metrics
   */
  getDetailedMetrics(): Promise<DetailedHealthMetrics>;

  /**
   * Get health history over time
   */
  getHealthHistory(options: HistoryOptions): Promise<HealthHistory>;

  /**
   * Get active alerts
   */
  getAlerts(): Promise<HealthAlert[]>;

  /**
   * Subscribe to health changes
   */
  onHealthChange(callback: (event: HealthChangeEvent) => void): Unsubscribe;

  /**
   * Export dashboard data
   */
  export(format: 'json' | 'csv' | 'html'): Promise<string>;
}

interface HealthSummary {
  timestamp: Date;
  overallScore: number;  // 0.0-1.0
  status: 'healthy' | 'degraded' | 'unhealthy' | 'critical';
  components: {
    indexFreshness: ComponentHealth;
    calibrationQuality: ComponentHealth;
    consistencyCheck: ComponentHealth;
    performanceMetrics: ComponentHealth;
  };
  recentChanges: string[];
  recommendations: string[];
}

interface ComponentHealth {
  name: string;
  score: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastChecked: Date;
  trend: 'improving' | 'stable' | 'degrading';
  details: string;
}

/**
 * =============================================================================
 * HEALTH SCORE COMPUTATION FORMULA
 * =============================================================================
 *
 * The overall health score is computed as a WEIGHTED GEOMETRIC MEAN of component
 * scores, with a MINIMUM FLOOR applied to prevent any single critical failure
 * from being masked.
 *
 * Formula:
 * --------
 *
 *   overallScore = min(
 *     geometricMean(w_i * s_i),     // Weighted geometric mean of components
 *     min(s_i) + FLOOR_PENALTY       // Floor based on worst component
 *   )
 *
 * Where:
 *   s_i = component score (0.0 to 1.0)
 *   w_i = component weight (sum to 1.0)
 *   FLOOR_PENALTY = 0.1  // Worst component + 10% is the ceiling
 *
 * Component Weights (default):
 * ----------------------------
 *   indexFreshness:     0.25  // Knowledge staleness
 *   calibrationQuality: 0.30  // Confidence accuracy (most important)
 *   consistencyCheck:   0.25  // Internal consistency
 *   performanceMetrics: 0.20  // Response times, error rates
 *
 * Why Geometric Mean?
 * -------------------
 * - Penalizes imbalance more than arithmetic mean
 * - A score of 0 in any component pulls overall to 0
 * - Encourages balanced improvement across all dimensions
 * - Example: [1.0, 1.0, 1.0, 0.5] -> 0.84 (arithmetic would give 0.875)
 *
 * Why Minimum Floor?
 * ------------------
 * - Prevents masking of critical failures
 * - If one component is 0.3, overall cannot exceed 0.4 regardless of others
 * - Forces attention to the weakest component
 *
 * Status Thresholds:
 * ------------------
 *   healthy:   score >= 0.8
 *   degraded:  0.5 <= score < 0.8
 *   unhealthy: 0.2 <= score < 0.5
 *   critical:  score < 0.2
 *
 * Implementation:
 * ---------------
 */
function computeHealthScore(components: Record<string, ComponentHealth>): number {
  const WEIGHTS: Record<string, number> = {
    indexFreshness: 0.25,
    calibrationQuality: 0.30,
    consistencyCheck: 0.25,
    performanceMetrics: 0.20,
  };

  const FLOOR_PENALTY = 0.1;

  const scores = Object.entries(components).map(([name, health]) => ({
    score: health.score,
    weight: WEIGHTS[name] ?? 0.25, // Default weight if unknown component
  }));

  // Geometric mean: exp(sum(w_i * ln(s_i)))
  // Handle zero scores specially to avoid -Infinity
  const hasZero = scores.some(s => s.score === 0);
  if (hasZero) {
    return 0; // Any zero component means overall health is zero
  }

  const weightedLogSum = scores.reduce(
    (sum, { score, weight }) => sum + weight * Math.log(score),
    0
  );
  const geometricMean = Math.exp(weightedLogSum);

  // Apply minimum floor
  const minScore = Math.min(...scores.map(s => s.score));
  const floorCeiling = minScore + FLOOR_PENALTY;

  return Math.min(geometricMean, floorCeiling);
}

function computeHealthStatus(score: number): 'healthy' | 'degraded' | 'unhealthy' | 'critical' {
  if (score >= 0.8) return 'healthy';
  if (score >= 0.5) return 'degraded';
  if (score >= 0.2) return 'unhealthy';
  return 'critical';
}

/**
 * Component Score Computation:
 * ============================
 *
 * Each component score is computed from its specific metrics:
 *
 * indexFreshness:
 *   score = 1 - (staleEntities / totalEntities) * stalePenalty
 *   where stalePenalty = averageStaleness / MAX_STALENESS_DAYS
 *
 * calibrationQuality:
 *   score = 1 - (ECE / TARGET_ECE)  // ECE = Expected Calibration Error
 *   clamped to [0, 1]
 *
 * consistencyCheck:
 *   score = 1 - (issueCount / totalClaims) * severityWeight
 *   where severityWeight varies by issue type
 *
 * performanceMetrics:
 *   score = (1 - errorRate) * (TARGET_LATENCY / actualLatency)
 *   clamped to [0, 1]
 */

interface DetailedHealthMetrics {
  // Index Health
  index: {
    totalEntities: number;
    freshEntities: number;
    staleEntities: number;
    averageStaleness: number;
    coverageByType: Record<string, number>;
    lastFullRefresh: Date;
    lastIncrementalRefresh: Date;
  };

  // Calibration Health
  calibration: {
    ece: number;
    mce: number;
    brierScore: number;
    sampleSize: number;
    lastCalibrated: Date;
    calibrationStatus: CalibrationStatus;
    reliabilityDiagram: ReliabilityDiagram;
  };

  // Consistency Health
  consistency: {
    phantomClaims: number;
    untestedClaims: number;
    docDrift: number;
    signatureMismatches: number;
    lastConsistencyCheck: Date;
  };

  // Performance Health
  performance: {
    averageQueryLatency: number;
    p95QueryLatency: number;
    averageIndexingLatency: number;
    cacheHitRate: number;
    errorRate: number;
  };

  // Self-Improvement Health
  selfImprovement: {
    cyclesRun: number;
    fixesApplied: number;
    patternsLearned: number;
    healthDeltaLastCycle: number;
    lastCycleTimestamp: Date;
    gettierCasesResolved: number;
    gettierCasesPending: number;
  };
}

interface HealthHistory {
  timeRange: { start: Date; end: Date };
  granularity: 'hour' | 'day' | 'week';
  dataPoints: Array<{
    timestamp: Date;
    overallScore: number;
    components: Record<string, number>;
  }>;
  trends: {
    overall: 'improving' | 'stable' | 'degrading';
    byComponent: Record<string, 'improving' | 'stable' | 'degrading'>;
  };
  events: HealthEvent[];
}

interface HealthAlert {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  component: string;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  suggestedAction: string;
  autoResolve?: {
    enabled: boolean;
    composition: string;
  };
}

interface HealthChangeEvent {
  type: 'score_changed' | 'status_changed' | 'alert_raised' | 'alert_resolved';
  component?: string;
  previousValue?: unknown;
  newValue?: unknown;
  timestamp: Date;
}

interface HealthEvent {
  timestamp: Date;
  type: 'improvement_cycle' | 'alert' | 'refresh' | 'calibration';
  description: string;
  impact: number;  // Score delta
}
```

---

## Meta-Improvement Loop

Using LiBrainian to improve LiBrainian - the recursive self-improvement protocol.

```typescript
/**
 * Meta-Improvement Protocol
 *
 * Orchestrates the use of LiBrainian to improve LiBrainian itself,
 * with safeguards against unbounded recursion and theoretical violations.
 */
interface MetaImprovementLoop {
  /**
   * Run a complete meta-improvement cycle
   */
  runCycle(options: MetaCycleOptions): Promise<MetaCycleReport>;

  /**
   * Schedule recurring meta-improvement
   */
  schedule(schedule: MetaSchedule): void;

  /**
   * Get meta-improvement history
   */
  getHistory(): Promise<MetaImprovementHistory>;

  /**
   * Validate that proposed improvement doesn't violate theoretical bounds
   */
  validateImprovement(improvement: ProposedImprovement): Promise<ValidationResult>;
}

interface MetaCycleOptions {
  /** Trigger for this cycle */
  trigger: 'commit' | 'scheduled' | 'manual' | 'health_degradation';

  /** Maximum resources for this cycle */
  budget: {
    maxTokens: number;
    maxTime: string;
    maxFixes: number;
  };

  /** Scope of improvement */
  scope: {
    includeArchitecture: boolean;
    includeTheoretical: boolean;
    includeCalibration: boolean;
    includePerformance: boolean;
  };

  /** Safety constraints */
  safety: {
    requireHumanApproval: boolean;
    maxRiskLevel: 'low' | 'medium' | 'high';
    dryRun: boolean;
  };
}

interface MetaCycleReport {
  cycleId: string;
  trigger: string;
  timestamp: Date;
  duration: number;

  // Detection phase
  detection: {
    entitiesScanned: number;
    issuesFound: number;
    newIssues: number;
    resolvedIssues: number;
  };

  // Assessment phase
  assessment: {
    healthScoreBefore: number;
    calibrationECE: number;
    consistencyScore: number;
    recommendations: Recommendation[];
  };

  // Fix phase
  fixes: {
    attempted: number;
    succeeded: number;
    failed: number;
    skipped: number;
    details: FixAttempt[];
  };

  // Learning phase
  learning: {
    patternsExtracted: number;
    calibrationUpdated: boolean;
    knowledgeUpdates: number;
  };

  // Outcome
  outcome: {
    healthScoreAfter: number;
    healthDelta: number;
    status: 'improved' | 'stable' | 'degraded';
    nextRecommendations: string[];
  };
}

interface ProposedImprovement {
  id: string;
  type: 'code_change' | 'config_change' | 'knowledge_update' | 'calibration_update';
  description: string;
  changes: unknown[];
  estimatedImpact: number;
  risk: RiskAssessment;
}

interface ValidationResult {
  valid: boolean;
  violations: TheoreticalViolation[];
  warnings: string[];
  suggestedModifications?: string[];
}

interface TheoreticalViolation {
  principle: string;  // From Part XII
  description: string;
  severity: 'blocking' | 'warning';
  reference: string;  // Section in THEORETICAL_CRITIQUE.md
}

interface MetaSchedule {
  type: 'cron' | 'interval' | 'git_hook';
  expression: string;  // Cron expression or interval
  enabled: boolean;
  maxConcurrent: number;
}

interface MetaImprovementHistory {
  totalCycles: number;
  successfulCycles: number;
  totalFixes: number;
  totalPatterns: number;
  healthTrend: Array<{ date: Date; score: number }>;
  recentCycles: MetaCycleReport[];
}

/**
 * Safety bounds for meta-improvement
 */
const META_IMPROVEMENT_BOUNDS = {
  /** Maximum recursion depth (LiBrainian improving LiBrainian improving...) */
  MAX_RECURSION_DEPTH: 1,

  /** Minimum time between cycles */
  MIN_CYCLE_INTERVAL_HOURS: 1,

  /** Maximum health degradation before abort */
  MAX_HEALTH_DEGRADATION: 0.1,

  /** Required approval threshold for high-risk changes */
  HIGH_RISK_APPROVAL_REQUIRED: true,

  /** Dry-run required for first N cycles */
  INITIAL_DRY_RUN_CYCLES: 3,
};
```

---

## Theoretical Limitations

### Lob's Theorem and Self-Verification Bounds

Lob's theorem (a strengthening of Godel's incompleteness theorems) establishes fundamental limits on what a formal system can prove about itself. For LiBrainian's self-improvement primitives, this has concrete implications:

**What Lob's Theorem Says:**
If a system can prove "if I can prove P, then P is true" for any statement P, then the system can already prove P. Contrapositively: a consistent system cannot prove its own consistency.

**Implications for Self-Verification:**

| Claim Type | Can Self-Verify? | Why / Why Not |
|------------|------------------|---------------|
| **Syntactic claims** | Yes | "Function X has 3 parameters" - verified by AST parsing |
| **Behavioral claims (with tests)** | Partially | Tests verify specific cases, not universal behavior |
| **Correctness claims** | No (in general) | "This code is correct" cannot be proven for Turing-complete programs |
| **Consistency claims** | No | "My knowledge base is consistent" hits Lob's theorem directly |
| **Calibration claims** | Partially | Can measure historical accuracy, cannot guarantee future accuracy |
| **Halting claims** | No | "This analysis will terminate" is undecidable |

### Breaking the Lobian Loop with External Outcomes

The self-verification primitives (`tp_verify_claim`, `tp_verify_calibration`) appear to create a problematic loop: LiBrainian verifying LiBrainian's claims. This would be epistemically vacuous if the verification were purely internal.

**How External Outcomes Break the Loop:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    VERIFICATION HIERARCHY                        │
│                                                                  │
│  Level 3: EXTERNAL WORLD (breaks Lobian loop)                   │
│  ├── Test suite execution (pass/fail is external fact)          │
│  ├── User feedback ("this answer was wrong")                    │
│  ├── Runtime behavior (actual errors, performance metrics)      │
│  └── Downstream success (code that uses advice compiles/works)  │
│                                                                  │
│  Level 2: CROSS-VALIDATION (partial independence)               │
│  ├── Different models checking each other                       │
│  ├── AST parser vs LLM synthesis comparison                     │
│  └── Multiple retrieval strategies agreeing                     │
│                                                                  │
│  Level 1: INTERNAL CONSISTENCY (necessary but not sufficient)   │
│  ├── Claims don't contradict each other                         │
│  ├── Evidence chains are well-formed                            │
│  └── Confidence values are calibrated historically              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Insight:** `tp_learn_from_outcome` is the critical primitive that grounds the self-improvement loop in external reality. Without outcomes from the real world, the system would be verifying its claims using only its own reasoning - which cannot establish truth.

### What Can vs Cannot Be Self-Verified

**Claims that CAN be meaningfully self-verified:**

1. **Existence claims with AST grounding**
   - "Function `processData` exists in `src/utils.ts`"
   - Verifiable by: AST parsing (external to LLM reasoning)

2. **Structural claims with test evidence**
   - "Function `validate` returns boolean"
   - Verifiable by: Type checker output, test execution

3. **Behavioral claims with outcome tracking**
   - "My code suggestions compile successfully 85% of the time"
   - Verifiable by: Tracking actual compilation outcomes over time

4. **Calibration claims with sufficient samples**
   - "When I say 80% confident, I'm right ~80% of the time"
   - Verifiable by: Statistical analysis of prediction/outcome pairs

**Claims that CANNOT be meaningfully self-verified:**

1. **Universal correctness claims**
   - "This code handles all edge cases correctly"
   - Why not: Would require exhaustive testing (impossible for most programs)

2. **Semantic understanding claims**
   - "I truly understand what this code does"
   - Why not: No external grounding for "understanding"

3. **Future performance claims**
   - "I will always give good advice on this codebase"
   - Why not: Distribution shift, novel situations

4. **Self-consistency claims**
   - "My knowledge base contains no contradictions"
   - Why not: Lob's theorem directly applies

### Practical Mitigations

Given these limitations, the self-improvement primitives implement several mitigations:

1. **Ground in external outcomes whenever possible**
   - `tp_learn_from_outcome` requires actual outcome data
   - `tp_verify_calibration` uses historical prediction/outcome pairs

2. **Use confidence bounds, not point estimates**
   - Acknowledge uncertainty in verification claims
   - Propagate uncertainty through evidence chains

3. **Detect Gettier cases**
   - `tp_verify_claim` includes Gettier analysis
   - Identifies "accidentally correct" beliefs that lack proper justification

4. **Require human escalation for high-risk claims**
   - `tc_continuous_improvement` has gates that escalate to humans
   - Critical architectural changes require external approval

5. **Track verification method strength**
   - AST verification > LLM synthesis verification
   - Test-based verification > consistency-based verification

### References

- Lob, M.H. (1955) "Solution of a Problem of Leon Henkin"
- Godel, K. (1931) "On Formally Undecidable Propositions"
- Yudkowsky, E. & Herreshoff, M. (2013) "Tiling Agents for Self-Modifying AI"
- Christiano, P. (2014) "Non-Omniscience, Probabilistic Inference, and Metamathematics"

---

## Automated Rollback Mechanism

The rollback mechanism provides safety infrastructure for self-improvement operations. When a self-improvement cycle degrades system health, the system must be able to restore to a known-good state.

### Rollback Interfaces

```typescript
import type { ConfidenceValue } from '../epistemics/confidence.js';

/**
 * Serialized state that can be restored.
 *
 * Contains all mutable state needed to restore the system to a checkpoint:
 * - Calibration reports
 * - Knowledge graph state
 * - Configuration values
 * - Learned patterns
 */
export interface SerializedState {
  /** Version for migration compatibility */
  version: string;
  /** Serialized calibration reports by category */
  calibration: Record<string, unknown>;
  /** Serialized patterns from tp_learn_extract_pattern */
  patterns: unknown[];
  /** Configuration values that may have been modified */
  config: Record<string, unknown>;
  /** Checksum for integrity verification */
  checksum: string;
}

/**
 * A point in time to which the system can be rolled back.
 */
export interface RollbackPoint {
  /** Unique identifier for this checkpoint */
  id: string;
  /** When the checkpoint was created */
  timestamp: Date;
  /** Serialized system state */
  state: SerializedState;
  /** Metadata about the checkpoint */
  metadata: {
    /** Why this checkpoint was created */
    reason: string;
    /** What operation triggered the checkpoint (e.g., primitive ID) */
    triggeredBy: string;
    /** Health score at checkpoint time */
    healthScore?: number;
    /** Tags for filtering */
    tags?: string[];
  };
}

/**
 * Manages checkpoints and rollback operations.
 */
export interface RollbackManager {
  /**
   * Create a checkpoint of current system state.
   *
   * @param reason - Human-readable reason for checkpoint
   * @returns The created RollbackPoint
   */
  createCheckpoint(reason: string): Promise<RollbackPoint>;

  /**
   * Restore system to a previous checkpoint.
   *
   * @param checkpointId - ID of the checkpoint to restore
   * @throws If checkpoint not found or restoration fails
   */
  rollback(checkpointId: string): Promise<void>;

  /**
   * List all available checkpoints.
   *
   * @returns Checkpoints ordered by timestamp (most recent first)
   */
  listCheckpoints(): RollbackPoint[];

  /**
   * Remove checkpoints older than maxAge.
   *
   * @param maxAge - Maximum age in milliseconds
   * @returns Number of checkpoints pruned
   */
  pruneOldCheckpoints(maxAge: number): number;

  /**
   * Get the most recent checkpoint.
   *
   * @returns Most recent checkpoint or undefined if none exist
   */
  getLatestCheckpoint(): RollbackPoint | undefined;

  /**
   * Verify checkpoint integrity.
   *
   * @param checkpointId - ID of checkpoint to verify
   * @returns True if checkpoint is valid and restorable
   */
  verifyCheckpoint(checkpointId: string): Promise<boolean>;
}
```

### Rollback Triggers

Rollback is triggered when any of the following conditions are met:

| Trigger | Threshold | Action |
|---------|-----------|--------|
| Health score drop | > 0.15 from checkpoint | Auto-rollback |
| Consecutive failures | >= 3 improvement attempts | Auto-rollback + escalate |
| Calibration degradation | ECE increases by > 0.1 | Auto-rollback |
| Critical error | Any unrecoverable error | Auto-rollback + alert |

### Implementation Notes

The rollback mechanism should:

1. **Create checkpoints before any self-improvement cycle**
   - Automatically in `tc_continuous_improvement`
   - Explicitly via `tp_improve_plan_fix` before applying fixes

2. **Verify checkpoints before rollback**
   - Checksum validation
   - Schema version compatibility check
   - Partial restoration is not allowed

3. **Maintain checkpoint history**
   - Keep at least 3 checkpoints
   - Prune checkpoints older than 7 days (configurable)
   - Tag important checkpoints (e.g., "pre-release", "stable")

4. **Integrate with health dashboard**
   - Show checkpoint timeline
   - Allow manual rollback from UI
   - Alert on rollback events

---

## Escalation Thresholds

Escalation determines when the self-improvement system should defer to human oversight. This section defines the triggers and decision tree for escalation.

### Escalation Levels

| Level | Name | Description | Human Involvement |
|-------|------|-------------|-------------------|
| 0 | **Autonomous** | System operates normally | None - full self-service |
| 1 | **Advisory** | System flags for review | Async notification |
| 2 | **Confirmation** | System pauses for approval | Must approve to continue |
| 3 | **Manual** | System cannot proceed | Human takes over |

### Health Score Thresholds

The health score (0.0-1.0) determines the base escalation level:

```
Health Score     Escalation Level
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
>= 0.8           Level 0 (Autonomous)
[0.6, 0.8)       Level 1 (Advisory)
[0.4, 0.6)       Level 2 (Confirmation)
< 0.4            Level 3 (Manual)
```

### Specific Trigger Conditions

Beyond health score, specific conditions trigger immediate escalation:

#### Level 1 (Advisory) Triggers

- First occurrence of a new error type
- Health score dropped > 0.05 in single cycle
- Calibration ECE increased > 0.03
- Distribution shift detected (PSI > 0.15)
- Pattern extraction failed for 2+ consecutive cycles

#### Level 2 (Confirmation) Triggers

- Health score dropped > 0.10 in single cycle
- Consecutive failures >= 2
- Calibration ECE increased > 0.07
- Any Gettier case detected with risk > 0.5
- Fix planned affects > 5 files
- Fix planned modifies public API

#### Level 3 (Manual) Triggers

- Health score dropped > 0.15 (after rollback)
- Consecutive failures >= 3 (after rollback)
- Calibration ECE > 0.25 (severely miscalibrated)
- Theoretical constraint violation detected
- Security-sensitive files affected
- Rollback itself failed

### Decision Tree

```
START: Self-improvement cycle triggered
         │
         ▼
    ┌─────────────────────┐
    │ Check health score  │
    └──────────┬──────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
 < 0.4?              >= 0.4?
    │                     │
    ▼                     ▼
 ESCALATE          Continue to
 Level 3           specific checks
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    Check for       Check for       Check for
    L2 triggers     L1 triggers     anomalies
         │               │               │
         ▼               ▼               ▼
    Any match?      Any match?      Any match?
    │     │         │     │         │     │
   Yes    No       Yes    No       Yes    No
    │     │         │     │         │     │
    ▼     └────┬────┘     └────┬────┘     │
 ESCALATE      │               │          │
 Level 2       ▼               ▼          │
          ESCALATE        PROCEED         │
          Level 1         Level 0 ◀───────┘
                              │
                              ▼
                    Execute improvement
                              │
                              ▼
                    Post-execution check
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
              Health improved?    Health degraded?
                    │                   │
                    ▼                   ▼
              COMPLETE            ROLLBACK
                                       │
                                       ▼
                                Check rollback
                                success
                                       │
                              ┌────────┴────────┐
                              │                 │
                              ▼                 ▼
                         Success           Failed
                              │                 │
                              ▼                 ▼
                    Log and continue      ESCALATE
                    (may trigger L1)      Level 3
```

### Escalation Actions

| Level | Automated Actions | Human Actions Required |
|-------|-------------------|------------------------|
| **L0** | Proceed normally | None |
| **L1** | Log event, send async notification, continue | Review within 24h |
| **L2** | Pause execution, create detailed report | Approve/reject within 1h |
| **L3** | Full stop, rollback to last known good, alert | Direct intervention required |

### Configuration

Escalation thresholds can be configured per-environment:

```typescript
interface EscalationConfig {
  /** Base health score thresholds [L3, L2, L1] */
  healthThresholds: [number, number, number];

  /** Consecutive failure threshold for L2 */
  consecutiveFailuresL2: number;

  /** Consecutive failure threshold for L3 */
  consecutiveFailuresL3: number;

  /** Health drop threshold for L1 */
  healthDropL1: number;

  /** Health drop threshold for L2 */
  healthDropL2: number;

  /** Health drop threshold for L3 (triggers rollback) */
  healthDropL3: number;

  /** Files affected threshold for L2 */
  filesAffectedL2: number;

  /** Whether to allow auto-rollback */
  autoRollbackEnabled: boolean;

  /** Timeout for L2 approval (ms) */
  l2ApprovalTimeout: number;
}

const DEFAULT_ESCALATION_CONFIG: EscalationConfig = {
  healthThresholds: [0.4, 0.6, 0.8],
  consecutiveFailuresL2: 2,
  consecutiveFailuresL3: 3,
  healthDropL1: 0.05,
  healthDropL2: 0.10,
  healthDropL3: 0.15,
  filesAffectedL2: 5,
  autoRollbackEnabled: true,
  l2ApprovalTimeout: 3600000, // 1 hour
};
```

---

## Implementation Roadmap

### Phase 1: Core Primitives (Week 1-2)

| Task | LOC Estimate |
|------|--------------|
| Define primitive type interfaces | ~200 |
| Implement tp_self_bootstrap | ~300 |
| Implement tp_self_refresh | ~200 |
| Implement tp_analyze_* (3 primitives) | ~400 |
| Unit tests for primitives | ~300 |
| **Phase 1 Total** | **~1,400** |

### Phase 2: Verification & Improvement Primitives (Week 2-3)

| Task | LOC Estimate |
|------|--------------|
| Implement tp_verify_claim | ~250 |
| Implement tp_verify_calibration | ~200 |
| Implement tp_improve_* (3 primitives) | ~400 |
| Implement tp_learn_* (2 primitives) | ~300 |
| Integration tests | ~200 |
| **Phase 2 Total** | **~1,350** |

### Phase 3: Compositions & Executor (Week 3-4)

| Task | LOC Estimate |
|------|--------------|
| Define composition interfaces | ~150 |
| Implement SelfImprovementExecutor | ~400 |
| Implement 5 compositions | ~500 |
| Operator implementations | ~300 |
| Composition tests | ~250 |
| **Phase 3 Total** | **~1,600** |

### Phase 4: Supporting Infrastructure (Week 4-5)

| Task | LOC Estimate |
|------|--------------|
| Knowledge freshness detection | ~300 |
| Distribution shift warning | ~250 |
| Health dashboard interface | ~350 |
| Meta-improvement loop | ~300 |
| Integration with existing LiBrainian | ~200 |
| **Phase 4 Total** | **~1,400** |

### Total Estimated LOC: ~5,750

---

## Success Criteria

| Metric | Target |
|--------|--------|
| All 11 primitives implemented | 11/11 |
| All 5 compositions functional | 5/5 |
| Unit test coverage | >85% |
| Integration test coverage | >70% |
| Health dashboard operational | Yes |
| Meta-improvement cycle passing | Yes |
| No theoretical violations | 0 |

---

## Dependencies

| This Spec | Depends On |
|-----------|------------|
| ConfidenceValue types | CONFIDENCE_REDESIGN.md |
| Episode recording | Track B (Bootstrap) |
| Storage system | LibrarianStorage |
| Calibration infrastructure | Track F (Calibration) |
| Embedding generation | Track A (Core Pipeline) |

---

## Related Specifications

- [THEORETICAL_CRITIQUE.md](../THEORETICAL_CRITIQUE.md) Part XII - Theoretical foundations
- [THEORETICAL_CRITIQUE.md](../THEORETICAL_CRITIQUE.md) Part XIII - Full self-improvement guide
- [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md) - Confidence value types
- [track-f-calibration.md](./track-f-calibration.md) - Calibration infrastructure
- [technique-contracts.md](./technique-contracts.md) - Executable contracts for primitives
