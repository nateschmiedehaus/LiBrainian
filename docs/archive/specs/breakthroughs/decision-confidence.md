# Decision-Theoretic Confidence Specification

> **Version**: 1.0.0
> **Status**: DRAFT
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: Based on von Neumann-Morgenstern utility theory and Bayesian decision theory.

---

## Executive Summary

**Current systems**: "Confidence = 0.75" (scalar)
**Decision-Theoretic**: "Confidence for ACTION X is [range] with expected utility E[U]"

Different actions have different confidence requirements:
- "Merge PR" needs ~0.95
- "Suggest review" needs ~0.6
- "Skip analysis" needs ~0.1

This specification transforms confidence from a passive scalar into an **action-relative decision guide** that tells agents what they can do given what they know.

---

## 1. The Problem with Scalar Confidence

### 1.1 One Number Doesn't Fit All Actions

A confidence of 0.75 means different things for different decisions:
- **Too low** for auto-merging code
- **Fine** for suggesting a code review
- **Overkill** for deciding to log something

### 1.2 What We Need

Confidence should answer: "What can I do with this knowledge?"

```typescript
// Instead of:
{ claim: "Function is safe", confidence: 0.75 }

// We need:
{
  claim: "Function is safe",
  forAction: {
    "auto_merge": { required: 0.95, current: 0.75, recommendation: "block" },
    "suggest_review": { required: 0.60, current: 0.75, recommendation: "proceed" },
    "log_observation": { required: 0.20, current: 0.75, recommendation: "proceed" }
  }
}
```

---

## 2. Decision-Theoretic Confidence

### 2.1 Core Types

```typescript
/**
 * Confidence that is relative to a set of possible actions.
 *
 * INVARIANT: All actions in the action set are mutually exclusive
 * INVARIANT: Expected utility is computed for each action
 */
interface DecisionTheoreticConfidence {
  /** The claim this confidence applies to */
  claim: Claim;

  /** Belief state (probability distribution) */
  beliefState: BeliefState;

  /** Action-relative confidence assessments */
  forActions: ActionConfidence[];

  /** Recommended action given current belief */
  recommendation: ActionRecommendation;

  /** How to improve confidence if needed */
  improvementPath?: ImprovementPath;
}
```

### 2.2 Belief State

```typescript
/**
 * Represents the current state of belief about a claim.
 */
interface BeliefState {
  /** Prior probability before evidence */
  prior: number;

  /** Evidence received */
  evidence: Evidence[];

  /** Posterior probability after evidence */
  posterior: number;

  /** Credible interval (Bayesian) */
  credibleInterval: {
    lower: number;
    upper: number;
    level: number;  // e.g., 0.95 for 95% CI
  };

  /** Entropy of the belief (uncertainty measure) */
  entropy: number;

  /** How to update this belief with new evidence */
  updateRule: UpdateRule;
}

interface Evidence {
  /** Source of evidence */
  source: string;

  /** Likelihood ratio P(E|H) / P(E|¬H) */
  likelihoodRatio: number;

  /** When was this evidence obtained */
  timestamp: Date;

  /** Weight in belief update */
  weight: number;
}

type UpdateRule =
  | { type: 'bayesian'; likelihoodModel: string }
  | { type: 'jeffrey'; partition: string[] }
  | { type: 'heuristic'; formula: string };
```

### 2.3 Action Confidence

```typescript
/**
 * Confidence assessment for a specific action.
 */
interface ActionConfidence {
  /** The action being considered */
  action: Action;

  /** Minimum confidence required for this action */
  requiredConfidence: number;

  /** Current confidence for this action */
  currentConfidence: ConfidenceValue;

  /** Expected utility of taking this action */
  expectedUtility: ExpectedUtility;

  /** Recommendation */
  recommendation: 'proceed' | 'gather_more' | 'block';

  /** Gap to required confidence (if blocking) */
  confidenceGap?: number;
}

interface Action {
  /** Action identifier */
  id: ActionId;

  /** Human-readable name */
  name: string;

  /** Action category */
  category: ActionCategory;

  /** Stakes of this action (affects required confidence) */
  stakes: ActionStakes;

  /** Reversibility */
  reversible: boolean;
}

type ActionId = string & { readonly __brand: 'ActionId' };

type ActionCategory =
  | 'information'     // Logging, observing
  | 'suggestion'      // Recommending without acting
  | 'modification'    // Changing code/state
  | 'deployment'      // Production changes
  | 'deletion';       // Irreversible removal

type ActionStakes = 'low' | 'medium' | 'high' | 'critical';
```

### 2.4 Expected Utility

```typescript
/**
 * Expected utility calculation for an action.
 */
interface ExpectedUtility {
  /** Utility if claim is true and action is taken */
  utilityIfTrueAndAct: number;

  /** Utility if claim is false and action is taken */
  utilityIfFalseAndAct: number;

  /** Utility if claim is true and action is NOT taken */
  utilityIfTrueAndRefrain: number;

  /** Utility if claim is false and action is NOT taken */
  utilityIfFalseAndRefrain: number;

  /** Computed expected utility of acting */
  expectedUtilityAct: number;

  /** Computed expected utility of refraining */
  expectedUtilityRefrain: number;

  /** Net expected utility (act - refrain) */
  netExpectedUtility: number;
}

/**
 * Compute expected utility given belief state.
 */
function computeExpectedUtility(
  belief: BeliefState,
  utilities: Omit<ExpectedUtility, 'expectedUtilityAct' | 'expectedUtilityRefrain' | 'netExpectedUtility'>
): ExpectedUtility {
  const p = belief.posterior;

  const expectedUtilityAct =
    p * utilities.utilityIfTrueAndAct + (1 - p) * utilities.utilityIfFalseAndAct;

  const expectedUtilityRefrain =
    p * utilities.utilityIfTrueAndRefrain + (1 - p) * utilities.utilityIfFalseAndRefrain;

  return {
    ...utilities,
    expectedUtilityAct,
    expectedUtilityRefrain,
    netExpectedUtility: expectedUtilityAct - expectedUtilityRefrain,
  };
}
```

---

## 3. Action Thresholds

### 3.1 Threshold Registry

```typescript
/**
 * Registry of confidence thresholds for actions.
 */
interface IThresholdRegistry {
  /**
   * Get threshold for an action.
   */
  getThreshold(actionId: ActionId): ActionThreshold;

  /**
   * Register a new action threshold.
   */
  register(threshold: ActionThreshold): void;

  /**
   * List all registered thresholds.
   */
  list(): ActionThreshold[];
}

interface ActionThreshold {
  actionId: ActionId;
  actionName: string;

  /** Minimum confidence to proceed */
  minConfidence: number;

  /** Confidence below which to block */
  blockBelow: number;

  /** Confidence above which to auto-proceed */
  autoAbove: number;

  /** Source of this threshold */
  source: 'default' | 'calibrated' | 'user_defined';

  /** Last calibration date */
  calibratedAt?: Date;
}
```

### 3.2 Default Thresholds

```typescript
const DEFAULT_THRESHOLDS: ActionThreshold[] = [
  // Information actions - low bar
  {
    actionId: 'log_observation' as ActionId,
    actionName: 'Log Observation',
    minConfidence: 0.2,
    blockBelow: 0.1,
    autoAbove: 0.3,
    source: 'default',
  },
  // Suggestion actions - medium bar
  {
    actionId: 'suggest_review' as ActionId,
    actionName: 'Suggest Code Review',
    minConfidence: 0.5,
    blockBelow: 0.3,
    autoAbove: 0.7,
    source: 'default',
  },
  {
    actionId: 'suggest_refactor' as ActionId,
    actionName: 'Suggest Refactoring',
    minConfidence: 0.6,
    blockBelow: 0.4,
    autoAbove: 0.8,
    source: 'default',
  },
  // Modification actions - high bar
  {
    actionId: 'apply_fix' as ActionId,
    actionName: 'Apply Automated Fix',
    minConfidence: 0.8,
    blockBelow: 0.7,
    autoAbove: 0.95,
    source: 'default',
  },
  // Deployment actions - very high bar
  {
    actionId: 'auto_merge' as ActionId,
    actionName: 'Automatically Merge PR',
    minConfidence: 0.95,
    blockBelow: 0.9,
    autoAbove: 0.99,
    source: 'default',
  },
  // Deletion actions - highest bar
  {
    actionId: 'delete_dead_code' as ActionId,
    actionName: 'Delete Dead Code',
    minConfidence: 0.98,
    blockBelow: 0.95,
    autoAbove: 0.999,
    source: 'default',
  },
];
```

---

## 4. Decision Engine

### 4.1 Engine Interface

```typescript
/**
 * Makes decisions based on confidence and utility.
 */
interface IDecisionEngine {
  /**
   * Evaluate confidence for a claim against possible actions.
   */
  evaluate(
    claim: Claim,
    belief: BeliefState,
    actions: Action[]
  ): Promise<DecisionTheoreticConfidence>;

  /**
   * Get recommendation for a specific action.
   */
  getRecommendation(
    claim: Claim,
    belief: BeliefState,
    action: Action
  ): Promise<ActionRecommendation>;

  /**
   * Find actions that are currently viable.
   */
  findViableActions(
    claim: Claim,
    belief: BeliefState,
    allActions: Action[]
  ): Promise<Action[]>;

  /**
   * Compute what evidence would enable an action.
   */
  whatWouldEnable(
    claim: Claim,
    belief: BeliefState,
    action: Action
  ): Promise<ImprovementPath>;
}
```

### 4.2 Recommendation

```typescript
interface ActionRecommendation {
  /** The recommended action (or null if none) */
  action: Action | null;

  /** Recommendation type */
  type: 'proceed' | 'gather_more' | 'block' | 'escalate';

  /** Explanation */
  explanation: string;

  /** Confidence in the recommendation itself */
  confidence: ConfidenceValue;

  /** Alternative actions if primary is blocked */
  alternatives: ActionConfidence[];
}
```

### 4.3 Improvement Path

```typescript
/**
 * How to improve confidence to enable an action.
 */
interface ImprovementPath {
  /** Target action */
  targetAction: Action;

  /** Current confidence */
  currentConfidence: number;

  /** Required confidence */
  requiredConfidence: number;

  /** Gap to close */
  gap: number;

  /** Suggested evidence to gather */
  suggestedEvidence: SuggestedEvidence[];

  /** Estimated effort to reach threshold */
  estimatedEffort: EffortEstimate;
}

interface SuggestedEvidence {
  /** What to look for */
  description: string;

  /** How to gather this evidence */
  method: EvidenceGatheringMethod;

  /** Expected likelihood ratio if found */
  expectedLR: number;

  /** Expected confidence boost */
  expectedBoost: number;
}

type EvidenceGatheringMethod =
  | { type: 'run_tests'; tests: string[] }
  | { type: 'code_review'; areas: string[] }
  | { type: 'static_analysis'; tool: string }
  | { type: 'dynamic_analysis'; scenario: string }
  | { type: 'expert_consultation'; topic: string };

interface EffortEstimate {
  level: 'trivial' | 'minor' | 'moderate' | 'significant' | 'major';
  description: string;
}
```

---

## 5. Bayesian Update

### 5.1 Update Function

```typescript
/**
 * Update belief state with new evidence.
 */
function updateBelief(
  current: BeliefState,
  newEvidence: Evidence
): BeliefState {
  // Bayes' rule: P(H|E) = P(E|H) * P(H) / P(E)
  const priorOdds = current.posterior / (1 - current.posterior);
  const posteriorOdds = priorOdds * newEvidence.likelihoodRatio;
  const posterior = posteriorOdds / (1 + posteriorOdds);

  return {
    ...current,
    evidence: [...current.evidence, newEvidence],
    posterior,
    entropy: computeEntropy(posterior),
    // Credible interval narrows with more evidence
    credibleInterval: updateCredibleInterval(current.credibleInterval, posterior, newEvidence),
  };
}

function computeEntropy(p: number): number {
  if (p === 0 || p === 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}
```

---

## 6. TDD Test Specifications

### 6.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `belief_update_increases_confidence` | Prior 0.5, LR 10 | Posterior > 0.5 |
| `belief_update_decreases_confidence` | Prior 0.5, LR 0.1 | Posterior < 0.5 |
| `expected_utility_positive` | High utility if true | EU > 0 |
| `expected_utility_negative` | High cost if false | EU < 0 |
| `threshold_proceed` | Confidence > threshold | Recommendation: proceed |
| `threshold_block` | Confidence < block level | Recommendation: block |
| `threshold_gather_more` | In between | Recommendation: gather_more |
| `entropy_maximum_at_0.5` | p = 0.5 | Entropy = 1.0 |
| `entropy_zero_at_extremes` | p = 0 or 1 | Entropy = 0 |

### 6.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `decision_with_multiple_actions` | 5 actions | Correct ranking by viability |
| `improvement_path_accurate` | Gap analysis | Suggested evidence is actionable |
| `calibrated_thresholds` | Historical data | Thresholds reflect outcomes |

### 6.3 BDD Scenarios

```gherkin
Feature: Decision-Theoretic Confidence
  As an agent
  I want confidence that tells me what I can do
  So that I take appropriate actions given my knowledge

  Scenario: Suggesting vs auto-merging
    Given I have belief 0.75 that "code change is safe"
    When I evaluate actions
    Then "suggest_review" has recommendation "proceed"
    And "auto_merge" has recommendation "block"
    And the improvement path shows what would enable auto_merge

  Scenario: Updating belief with new evidence
    Given I have prior belief 0.5
    And I observe evidence with likelihood ratio 10
    When I update my belief
    Then posterior is approximately 0.91
    And entropy decreases
    And new actions may become viable

  Scenario: Finding improvement path
    Given I want to "delete_dead_code" (requires 0.98)
    And my current confidence is 0.85
    When I request an improvement path
    Then I receive suggestions like:
      | Method | Expected Boost |
      | Run coverage tests | +0.05 |
      | Static analysis | +0.03 |
      | Manual review | +0.07 |
```

---

## 7. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| Evidence Ledger | Records decisions and outcomes | Writes |
| Calibration | Uses outcomes to calibrate thresholds | Reads/Writes |
| Query Engine | Provides belief state to decisions | Reads |
| Agent Orchestrator | Receives action recommendations | Reads |
| Active Learning | Uses improvement paths for exploration | Reads |

---

## 8. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Belief state implementation
- [ ] Decision engine implementation
- [ ] Threshold registry implementation
- [ ] Gate passed

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
