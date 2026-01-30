# Librarian Epistemics Framework

> **A principled approach to confidence and reasoning for AI agents**

The Epistemics module is the heart of Librarian's approach to trustworthy AI assistance. Rather than treating confidence as a magic number, Librarian implements a rigorous epistemic framework grounded in formal epistemology, probability theory, and belief revision.

---

## Table of Contents

1. [Overview](#overview)
2. [Core Modules](#core-modules)
   - [Confidence System](#confidence-system)
   - [Evidence Ledger](#evidence-ledger)
   - [Defeater Calculus](#defeater-calculus)
   - [Calibration](#calibration)
3. [Advanced Modules](#advanced-modules)
   - [Conative Attitudes](#conative-attitudes)
   - [Temporal Grounding](#temporal-grounding)
   - [Intuitive Grounding](#intuitive-grounding)
   - [Inference Auditing](#inference-auditing)
   - [Quality Gates](#quality-gates)
   - [Universal Coherence](#universal-coherence)
4. [Theoretical Foundations](#theoretical-foundations)
   - [Belief Functions](#belief-functions)
   - [AGM Belief Revision](#agm-belief-revision)
   - [Credal Sets](#credal-sets)
   - [Multi-Agent Epistemics](#multi-agent-epistemics)
5. [Quick Start Examples](#quick-start-examples)
6. [API Reference](#api-reference)

---

## Overview

Librarian's epistemics layer addresses a fundamental problem in AI-assisted development: **How can an agent communicate what it knows, what it doesn't know, and how certain it is?**

### Design Principles

1. **Confidence as a First-Class Primitive** - Confidence values have proper types, algebraic laws, and semantics
2. **Evidence Traceability** - Every claim can be traced to its sources via an append-only ledger
3. **Formal Defeat Tracking** - Explicit modeling of what undermines claims
4. **Calibration** - Confidence scores are meaningful and match actual reliability
5. **Temporal Awareness** - Knowledge ages and can become stale
6. **Course Correction** - Systems to detect and fix reasoning errors

---

## Core Modules

### Confidence System

The confidence system provides typed confidence values with proper semantics.

```typescript
import {
  deterministic,
  bounded,
  absent,
  sequenceConfidence,
  parallelAllConfidence,
  parallelAnyConfidence,
  getNumericValue,
  meetsThreshold,
} from 'librarian/epistemics';

// Deterministic confidence (known exactly)
const certain = deterministic(0.95);

// Bounded confidence (interval)
const uncertain = bounded(0.6, 0.8);

// Absent confidence (unknown)
const unknown = absent('data_unavailable');

// Combine sequentially (AND semantics)
const sequential = sequenceConfidence([certain, uncertain]);
// Result: min(0.95, [0.6, 0.8]) = bounded

// Combine in parallel (all must succeed)
const allMustSucceed = parallelAllConfidence([certain, uncertain]);

// Combine in parallel (any can succeed)
const anyCanSucceed = parallelAnyConfidence([certain, uncertain]);

// Extract numeric value with degradation
const value = getNumericValue(uncertain); // 0.7 (midpoint)

// Check threshold
const passes = meetsThreshold(certain, 0.9); // true
```

#### Confidence Types

| Type | Description | Use Case |
|------|-------------|----------|
| `DeterministicConfidence` | Exact known value | Syntactic checks, verified facts |
| `BoundedConfidence` | Interval [lower, upper] | Uncertain estimates |
| `MeasuredConfidence` | Calibrated from outcomes | Learning from feedback |
| `DerivedConfidence` | Computed via formula | Combining multiple sources |
| `AbsentConfidence` | Unknown with reason | Missing data, timeouts |

### Evidence Ledger

The Evidence Ledger is an append-only log of all epistemic events, providing full traceability.

```typescript
import {
  createEvidenceLedger,
  createEvidenceId,
  createSessionId,
} from 'librarian/epistemics';

const ledger = await createEvidenceLedger('./librarian.db');
const sessionId = createSessionId();

// Append extraction evidence
await ledger.append({
  id: createEvidenceId(),
  sessionId,
  timestamp: new Date(),
  kind: 'extraction',
  provenance: {
    source: 'ast_parser',
    agentId: 'librarian-indexer',
  },
  payload: {
    kind: 'extraction',
    entityType: 'function',
    entityId: 'src/auth/validate.ts::validateToken',
    extractedFacts: ['validates JWT tokens', 'throws on expiry'],
    confidence: deterministic(0.99),
  },
});

// Query the ledger
const entries = await ledger.query({
  sessionId,
  kinds: ['extraction', 'claim'],
  minConfidence: 0.8,
});

// Export to W3C PROV format
import { exportToPROVJSON } from 'librarian/epistemics';
const provDocument = await exportToPROVJSON(entries);
```

### Defeater Calculus

The defeater system tracks what undermines claims, with proper semantics for defeat.

```typescript
import {
  detectDefeaters,
  applyDefeaters,
  buildDefeaterGraph,
  computeGroundedExtension,
} from 'librarian/epistemics';

// Detect defeaters for a claim
const result = await detectDefeaters({
  claim: {
    id: 'claim-123',
    content: 'Function X is pure',
    confidence: deterministic(0.9),
  },
  context: {
    codebaseState: currentState,
    evidenceGraph: graph,
  },
});

// Defeater types:
// - REBUTTING: Contradicts the claim directly
// - UNDERCUTTING: Attacks the support relationship
// - UNDERMINING: Attacks the source credibility

// Apply defeaters to adjust confidence
const adjusted = applyDefeaters(claim, result.defeaters);

// Handle cycles with grounded semantics
const graph = buildDefeaterGraph(allDefeaters);
const grounded = computeGroundedExtension(graph);
```

### Calibration

Ensure confidence scores are meaningful through proper calibration.

```typescript
import {
  ClaimOutcomeTracker,
  computeCalibrationCurve,
  buildCalibrationReport,
  adjustConfidenceScore,
  computeBrierScore,
  isotonicCalibration,
  computeMinSamplesForCalibration,
} from 'librarian/epistemics';

// Track claim outcomes
const tracker = new ClaimOutcomeTracker(storage);

await tracker.trackClaim({
  claimId: 'claim-456',
  category: 'function_purpose',
  predictedConfidence: 0.85,
});

await tracker.recordOutcome({
  claimId: 'claim-456',
  actualOutcome: true, // Claim was correct
  verificationMethod: 'human_review',
});

// Build calibration curve
const samples = await tracker.getSamples({ category: 'function_purpose' });
const curve = computeCalibrationCurve(samples, { numBuckets: 10 });

// Check calibration quality
const report = buildCalibrationReport(curve);
console.log(`ECE: ${report.expectedCalibrationError}`);
console.log(`Brier Score: ${computeBrierScore(samples)}`);

// Apply isotonic calibration
const mapping = isotonicCalibration(samples);
const calibrated = adjustConfidenceScore(0.85, mapping);

// PAC-based sample requirements
const required = computeMinSamplesForCalibration({
  epsilon: 0.05,  // Error tolerance
  delta: 0.1,     // Failure probability
});
```

---

## Advanced Modules

### Conative Attitudes

Model action-directed mental states: intentions, preferences, goals, and desires.

```typescript
import {
  createIntention,
  createGoal,
  createPreference,
  createBDIAgentState,
  evaluatePracticalCoherence,
  deriveIntentionFromGoal,
} from 'librarian/epistemics';

// Create an intention
const intention = createIntention({
  content: { type: 'proposition', value: 'Refactor authentication module' },
  commitment: 0.9,
  conditions: [
    { satisfied: false, description: 'Tests pass' },
    { satisfied: true, description: 'Branch created' },
  ],
});

// Create a goal with success criteria
const goal = createGoal({
  content: { type: 'proposition', value: 'Improve code coverage to 90%' },
  desirability: 0.95,
  criteria: [
    { description: 'Unit test coverage >= 90%', weight: 0.6 },
    { description: 'Integration test coverage >= 80%', weight: 0.4 },
  ],
});

// Create preferences
const preference = createPreference({
  options: ['Option A', 'Option B', 'Option C'],
  ordering: [
    { better: 0, worse: 1 }, // A > B
    { better: 1, worse: 2 }, // B > C
  ],
});

// BDI Agent State
const agentState = createBDIAgentState({
  agentId: 'coding-agent-1',
  beliefs: [/* ... */],
  desires: [/* ... */],
  intentions: [intention],
  goals: [goal],
  preferences: [preference],
});

// Check practical coherence
const coherence = evaluatePracticalCoherence(agentState);
if (!coherence.isCoherent) {
  console.log('Conflicts:', coherence.conflicts);
}

// Derive intention from goal
const derivedIntention = deriveIntentionFromGoal(goal, agentState.beliefs);
```

### Temporal Grounding

Track knowledge validity over time with decay functions.

```typescript
import {
  constructTemporalGrounding,
  isGroundingValid,
  getGroundingStrength,
  detectStaleGroundings,
  refreshGrounding,
  TEMPORAL_PRESETS,
} from 'librarian/epistemics';

// Create temporal grounding with preset
const grounding = constructTemporalGrounding({
  groundingId: 'grnd-001',
  originalStrength: 0.9,
  preset: 'medium_term', // 7 days validity
});

// Or with custom bounds
const customGrounding = constructTemporalGrounding({
  groundingId: 'grnd-002',
  originalStrength: 0.95,
  bounds: {
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    decayFunction: 'exponential',
    halfLife: 14 * 24 * 60 * 60 * 1000, // 14 days
  },
});

// Check validity
const isValid = isGroundingValid(grounding);

// Get current strength (with decay applied)
const currentStrength = getGroundingStrength(grounding);

// Detect stale groundings in a collection
const stale = detectStaleGroundings(allGroundings, {
  strengthThreshold: 0.5,
});

// Refresh after re-verification
const refreshed = refreshGrounding(grounding, {
  newVerificationTime: new Date(),
  newStrength: 0.92,
});

// Available presets
// - EPHEMERAL: 1 hour, linear decay
// - SHORT_TERM: 24 hours, exponential decay
// - MEDIUM_TERM: 7 days, exponential decay
// - LONG_TERM: 90 days, logarithmic decay
// - PERMANENT: No decay
```

### Intuitive Grounding

Handle intuition-based knowledge with paths to formal justification.

```typescript
import {
  createIntuitiveGrounding,
  canUpgrade,
  findBestUpgradePath,
  upgradeGrounding,
  getArticulabilityScore,
  detectPattern,
  analogyFromPrior,
} from 'librarian/epistemics';

// Create intuitive grounding
const intuition = createIntuitiveGrounding({
  source: 'pattern_recognition',
  articulability: 'partial', // 'none' | 'partial' | 'full'
  description: 'This looks like the decorator pattern',
  priorExperiences: ['project-a/decorators', 'project-b/middleware'],
});

// Check articulability
const score = getArticulabilityScore(intuition);

// Find upgrade path to formal justification
const canUpgradeNow = canUpgrade(intuition, {
  availableEvidence: currentEvidence,
  targetGroundingType: 'testimonial',
});

const upgradePath = findBestUpgradePath(intuition, currentEvidence);
// Returns: { targetType: 'inferential', requiredSteps: [...], confidence: 0.85 }

// Upgrade when evidence is available
const upgraded = upgradeGrounding(intuition, {
  targetType: 'inferential',
  evidence: [
    { type: 'code_analysis', content: 'AST matches decorator pattern' },
  ],
});

// Detect patterns
const patternResult = detectPattern(codeSnippet, {
  knownPatterns: ['decorator', 'observer', 'factory'],
});

// Create analogy from prior experience
const analogy = analogyFromPrior({
  currentSituation: 'Middleware chain in Express',
  priorExperience: 'Decorator pattern in Java',
  mappings: [
    { from: 'decorator.wrap()', to: 'middleware.use()' },
  ],
});
```

### Inference Auditing

Detect and fix bad reasoning patterns.

```typescript
import {
  auditInference,
  auditChain,
  detectFallacy,
  checkCircularity,
  suggestFix,
  InferenceFallacy,
  FALLACY_DESCRIPTIONS,
} from 'librarian/epistemics';

// Create inference steps
const step1 = createInferenceStep({
  premises: [
    { id: 'p1', content: 'Function A calls function B' },
    { id: 'p2', content: 'Function B modifies global state' },
  ],
  conclusion: { id: 'c1', content: 'Function A has side effects' },
  rule: 'transitive_effect',
});

// Audit a single inference
const audit = auditInference(step1);
if (audit.fallacies.length > 0) {
  for (const fallacy of audit.fallacies) {
    console.log(`Fallacy: ${fallacy.type}`);
    console.log(`Severity: ${fallacy.severity}`);
    console.log(`Description: ${FALLACY_DESCRIPTIONS[fallacy.type]}`);
    console.log(`Fix: ${suggestFix(fallacy)}`);
  }
}

// Audit a chain of inferences
const chainAudit = auditChain([step1, step2, step3]);

// Check for specific issues
const isCircular = checkCircularity([step1, step2, step3]);

// Available fallacy types:
// - CIRCULAR_REASONING
// - HASTY_GENERALIZATION
// - FALSE_CAUSE
// - APPEAL_TO_AUTHORITY
// - COMPOSITION_FALLACY
// - DIVISION_FALLACY
// - EQUIVOCATION
// - MISSING_EVIDENCE
```

### Quality Gates

Enforce epistemic standards during agent operations.

```typescript
import {
  createQualityGate,
  evaluateGate,
  createGateChain,
  getStandardGates,
} from 'librarian/epistemics';

// Create a quality gate
const confidenceGate = createQualityGate({
  id: 'min-confidence',
  name: 'Minimum Confidence',
  check: async (context) => {
    const confidence = context.currentConfidence;
    return {
      passed: getNumericValue(confidence) >= 0.7,
      message: confidence < 0.7
        ? 'Confidence too low for autonomous action'
        : 'Confidence sufficient',
      recommendations: confidence < 0.7
        ? ['Gather more evidence', 'Request human review']
        : [],
    };
  },
});

// Evaluate a gate
const result = await evaluateGate(confidenceGate, {
  currentConfidence: bounded(0.6, 0.8),
  claim: currentClaim,
  evidence: currentEvidence,
});

// Chain multiple gates
const gateChain = createGateChain([
  getStandardGates().minConfidence(0.7),
  getStandardGates().noUnresolvedDefeaters(),
  getStandardGates().temporalValidity(),
  getStandardGates().noFallacies(),
]);

const chainResult = await gateChain.evaluate(context);
if (!chainResult.allPassed) {
  // Handle course correction
  for (const failure of chainResult.failures) {
    console.log(`Gate failed: ${failure.gateName}`);
    console.log(`Recommendations: ${failure.recommendations.join(', ')}`);
  }
}
```

### Universal Coherence

Evaluate belief consistency across abstraction levels.

```typescript
import {
  constructCoherenceNetwork,
  evaluateCoherence,
  detectConflicts,
  findGroundingChain,
  applyPreset,
  PRESETS,
} from 'librarian/epistemics';

// Create a coherence network with preset
const network = constructCoherenceNetwork({
  preset: 'software_dev',
});

// Add epistemic objects
const claim = constructEpistemicObject({
  content: constructContent({
    type: 'proposition',
    value: 'Module X is well-tested',
  }),
  attitude: constructAttitude({
    type: 'belief',
    strength: { value: 0.85, basis: 'measured' },
  }),
  level: 'concrete', // 'meta' | 'abstract' | 'concrete' | 'ground'
});

// Evaluate coherence
const result = evaluateCoherence(network, {
  stakes: 'high',
  context: { domain: 'production_deployment' },
});

console.log(`Coherent: ${result.isCoherent}`);
console.log(`Score: ${result.score}`);

// Detect conflicts
const conflicts = detectConflicts(network);
for (const conflict of conflicts) {
  console.log(`Conflict between: ${conflict.object1Id} and ${conflict.object2Id}`);
  console.log(`Type: ${conflict.type}`);
}

// Find grounding chain
const chain = findGroundingChain(network, claimId);
console.log(`Grounding depth: ${chain.length}`);

// Available presets
// - SOFTWARE_DEV_PRESET: For code understanding
// - SCIENTIFIC_METHOD_PRESET: For research/experiments
// - LEGAL_REASONING_PRESET: For compliance/audit
```

---

## Theoretical Foundations

### Belief Functions

Dempster-Shafer theory for handling uncertainty with imprecise probability.

```typescript
import {
  createBeliefMass,
  belief,
  plausibility,
  beliefInterval,
  combineDempster,
  analyzeConflict,
  toBoundedConfidence,
} from 'librarian/epistemics';

// Create belief mass function
const mass = createBeliefMass({
  frame: ['bug', 'feature', 'refactor'],
  assignments: [
    { subset: ['bug'], mass: 0.4 },
    { subset: ['feature'], mass: 0.3 },
    { subset: ['bug', 'feature'], mass: 0.2 },
    // Remaining 0.1 goes to frame (uncertainty)
  ],
});

// Compute belief and plausibility
const belBug = belief(mass, ['bug']); // Lower bound
const plBug = plausibility(mass, ['bug']); // Upper bound
const interval = beliefInterval(mass, ['bug']); // [bel, pl]

// Combine evidence from multiple sources
const combined = combineDempster(mass1, mass2);

// Analyze conflict
const conflict = analyzeConflict(mass1, mass2);
if (conflict.severity === 'high') {
  console.log('Sources strongly disagree');
}

// Convert to bounded confidence
const confidence = toBoundedConfidence(mass, ['bug']);
```

### AGM Belief Revision

Formal belief update following the AGM postulates.

```typescript
import {
  createBeliefBase,
  expand,
  contract,
  revise,
  checkAGMPostulates,
  computeEntrenchmentFromConfidence,
} from 'librarian/epistemics';

// Create belief base
const beliefs = createBeliefBase({
  beliefs: [
    { id: 'b1', content: 'A', entrenchment: 0.9 },
    { id: 'b2', content: 'B', entrenchment: 0.7 },
    { id: 'b3', content: 'A -> B', entrenchment: 0.8 },
  ],
});

// Expand: Add new belief (no conflict)
const expanded = expand(beliefs, { content: 'C', entrenchment: 0.6 });

// Contract: Remove belief (minimal change)
const contracted = contract(beliefs, 'B');

// Revise: Add potentially conflicting belief
const revised = revise(beliefs, { content: '~A', entrenchment: 0.95 });

// Verify AGM postulates hold
const postulates = checkAGMPostulates(beliefs, revisionOperation);
console.log(`Success: ${postulates.success}`);
console.log(`Closure: ${postulates.closure}`);
console.log(`Inclusion: ${postulates.inclusion}`);

// Compute entrenchment from confidence
const entrenchment = computeEntrenchmentFromConfidence(
  deterministic(0.85)
);
```

### Credal Sets

Handle imprecise probability with interval arithmetic.

```typescript
import {
  createInterval,
  createCredalSet,
  sequenceIntervals,
  parallelIntervalsAnd,
  composeConfidenceCredal,
  trackImprecisionPropagation,
} from 'librarian/epistemics';

// Create intervals
const interval1 = createInterval(0.6, 0.8);
const interval2 = createInterval(0.7, 0.9);

// Sequence (AND)
const seq = sequenceIntervals(interval1, interval2);

// Parallel AND
const parAnd = parallelIntervalsAnd([interval1, interval2]);

// Create credal set
const credal = createCredalSet({
  outcomes: ['success', 'failure'],
  constraints: [
    { outcome: 'success', lower: 0.6, upper: 0.8 },
  ],
});

// Compose with confidence
const composed = composeConfidenceCredal(
  bounded(0.7, 0.9),
  credal
);

// Track imprecision propagation
const propagation = trackImprecisionPropagation([
  bounded(0.6, 0.8),
  bounded(0.7, 0.9),
  bounded(0.5, 0.7),
]);
console.log(`Total imprecision: ${propagation.totalImprecision}`);
```

### Multi-Agent Epistemics

Social epistemology for multi-agent scenarios.

```typescript
import {
  createAgentProfile,
  createAgentBelief,
  resolveDisagreement,
  aggregateBeliefs,
  evaluateTestimony,
  computeGroupConsensus,
  isCommonKnowledge,
} from 'librarian/epistemics';

// Create agent profiles
const agent1 = createAgentProfile({
  id: 'agent-1',
  expertise: { 'typescript': 0.9, 'security': 0.6 },
  reliability: 0.85,
});

const agent2 = createAgentProfile({
  id: 'agent-2',
  expertise: { 'typescript': 0.7, 'security': 0.95 },
  reliability: 0.90,
});

// Create beliefs
const belief1 = createAgentBelief({
  agentId: 'agent-1',
  proposition: 'Code is secure',
  confidence: 0.8,
  basis: 'analysis',
});

const belief2 = createAgentBelief({
  agentId: 'agent-2',
  proposition: 'Code is secure',
  confidence: 0.4,
  basis: 'analysis',
});

// Resolve disagreement
const resolution = resolveDisagreement({
  beliefs: [belief1, belief2],
  agents: [agent1, agent2],
  strategy: 'expertise_weighted', // or 'equal_weight', 'supra_majority'
  domain: 'security',
});

// Aggregate beliefs (opinion pools)
const aggregated = aggregateBeliefs({
  beliefs: [belief1, belief2],
  weights: [0.4, 0.6], // Based on security expertise
  method: 'linear', // or 'logarithmic'
});

// Evaluate testimony
const evaluation = evaluateTestimony({
  testimony: belief1,
  witness: agent1,
  domain: 'security',
});
console.log(`Trustworthy: ${evaluation.trustworthy}`);
console.log(`Adjusted confidence: ${evaluation.adjustedConfidence}`);

// Check common knowledge
const isCommon = isCommonKnowledge({
  proposition: 'Tests must pass before merge',
  agents: [agent1, agent2],
  level: 2, // Everyone knows that everyone knows
});
```

---

## Quick Start Examples

### Example 1: Confident Code Analysis

```typescript
import { createLibrarian } from 'librarian';
import { getNumericValue, meetsThreshold } from 'librarian/epistemics';

const librarian = await createLibrarian({ workspace: '.' });
await librarian.initialize();

const result = await librarian.query({
  intent: 'How does authentication work?',
  depth: 'L2',
});

// Check confidence before acting
if (meetsThreshold(result.confidence, 0.8)) {
  console.log('High confidence answer:', result.synthesis.answer);
} else {
  console.log('Low confidence - requesting review');
  console.log('Uncertainties:', result.uncertainties);
}
```

### Example 2: Learning from Feedback

```typescript
import { ClaimOutcomeTracker, buildCalibrationReport } from 'librarian/epistemics';

const tracker = new ClaimOutcomeTracker(storage);

// After agent makes predictions
const prediction = await agent.predict(task);
await tracker.trackClaim({
  claimId: prediction.id,
  category: 'code_location',
  predictedConfidence: prediction.confidence,
});

// After human verification
await tracker.recordOutcome({
  claimId: prediction.id,
  actualOutcome: wasCorrect,
  verificationMethod: 'human_review',
});

// Periodically check calibration
const report = buildCalibrationReport(await tracker.getSamples());
if (report.expectedCalibrationError > 0.1) {
  console.log('Agent needs recalibration');
}
```

### Example 3: Handling Stale Knowledge

```typescript
import {
  detectStaleGroundings,
  refreshGrounding,
  TEMPORAL_PRESETS,
} from 'librarian/epistemics';

// Check for stale knowledge before using it
const stale = detectStaleGroundings(context.groundings, {
  strengthThreshold: 0.5,
});

if (stale.length > 0) {
  console.log(`${stale.length} groundings are stale`);

  // Refresh or warn
  for (const grounding of stale) {
    if (canRefresh(grounding)) {
      const refreshed = await refreshGrounding(grounding);
      updateContext(refreshed);
    } else {
      addWarning(`Knowledge about ${grounding.subject} may be outdated`);
    }
  }
}
```

---

## API Reference

For complete API documentation, see the inline TypeScript documentation in:

- `/src/epistemics/index.ts` - Main exports
- `/src/epistemics/confidence.ts` - Confidence system
- `/src/epistemics/evidence_ledger.ts` - Evidence tracking
- `/src/epistemics/defeaters.ts` - Defeater calculus
- `/src/epistemics/calibration.ts` - Calibration curves
- `/src/epistemics/conative_attitudes.ts` - Intentions/goals/preferences
- `/src/epistemics/temporal_grounding.ts` - Time-based validity
- `/src/epistemics/intuitive_grounding.ts` - Pattern recognition
- `/src/epistemics/inference_auditor.ts` - Fallacy detection
- `/src/epistemics/quality_gates.ts` - Quality enforcement
- `/src/epistemics/universal_coherence.ts` - Coherence framework
- `/src/epistemics/belief_functions.ts` - Dempster-Shafer
- `/src/epistemics/belief_revision.ts` - AGM theory
- `/src/epistemics/credal_sets.ts` - Imprecise probability
- `/src/epistemics/multi_agent.ts` - Social epistemics

---

## Further Reading

- [API Reference](./API.md) - Full Librarian API documentation
- [Architecture Excellence Review](./ARCHITECTURE_EXCELLENCE_REVIEW.md) - System architecture analysis
- [Theoretical Critique](./THEORETICAL_CRITIQUE.md) - Epistemological foundations
- [Confidence Decay](./CONFIDENCE_DECAY.md) - Temporal confidence dynamics

---

*The Epistemics module is designed to make AI agents more trustworthy by ensuring they know what they know, acknowledge what they don't know, and communicate uncertainty honestly.*
