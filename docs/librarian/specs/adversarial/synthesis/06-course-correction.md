# Part 6: Course Correction Protocol

[Back to Index](./index.md) | [Previous: Bad Agents](./05-bad-agents.md) | [Next: Recommendations](./07-recommendations.md)

---

## 6.1 Design Principle: Positively Productive at Any Stage

The Librarian system must help agents correct course regardless of progress:
- NOT: "You're wrong, start over"
- YES: "Here's what's salvageable and how to proceed"

---

## 6.2 Stage 1: Pre-Planning (Before Work Begins)

**Objective**: Validate task understanding before investing effort.

```typescript
interface PrePlanningValidation {
  taskUnderstanding: EpistemicObject;
  groundingRequirements: GroundingRequirement[];
  goNoGoDecision: 'go' | 'no_go' | 'needs_clarification';
  blockers: string[];
}

interface GroundingRequirement {
  description: string;
  currentStatus: 'met' | 'unmet' | 'partial';
  howToMeet: string;
}

function validatePrePlanning(
  task: TaskDescription,
  agentUnderstanding: EpistemicObject
): PrePlanningValidation {
  const requirements: GroundingRequirement[] = [];

  // Requirement 1: Task is understood
  const understandingStrength = agentUnderstanding.attitude.strength?.value ?? 0;
  requirements.push({
    description: 'Agent demonstrates understanding of task',
    currentStatus: understandingStrength > 0.7 ? 'met' :
                   understandingStrength > 0.4 ? 'partial' : 'unmet',
    howToMeet: 'Paraphrase task requirements and verify with user'
  });

  // Requirement 2: Success criteria defined
  const hasCriteria = task.successCriteria && task.successCriteria.length > 0;
  requirements.push({
    description: 'Success criteria are defined',
    currentStatus: hasCriteria ? 'met' : 'unmet',
    howToMeet: 'Define measurable success criteria before starting'
  });

  // Requirement 3: Required information available
  const infoGaps = identifyInformationGaps(task);
  requirements.push({
    description: 'Required information is available',
    currentStatus: infoGaps.length === 0 ? 'met' :
                   infoGaps.length < 3 ? 'partial' : 'unmet',
    howToMeet: `Gather: ${infoGaps.join(', ')}`
  });

  // Go/No-Go decision
  const unmetCount = requirements.filter(r => r.currentStatus === 'unmet').length;
  const goNoGo = unmetCount === 0 ? 'go' :
                 unmetCount <= 1 ? 'needs_clarification' : 'no_go';

  return {
    taskUnderstanding: agentUnderstanding,
    groundingRequirements: requirements,
    goNoGoDecision: goNoGo,
    blockers: requirements
      .filter(r => r.currentStatus === 'unmet')
      .map(r => r.description)
  };
}
```

**Correction at Stage 1**:
```typescript
function correctAtPrePlanning(
  validation: PrePlanningValidation
): CorrectionAction[] {
  const actions: CorrectionAction[] = [];

  if (validation.goNoGoDecision === 'no_go') {
    actions.push({
      type: 'clarify_task',
      description: 'Task understanding insufficient. Please clarify before proceeding.',
      effort: 'low',
      specifics: validation.blockers
    });
  }

  if (validation.goNoGoDecision === 'needs_clarification') {
    actions.push({
      type: 'partial_proceed',
      description: 'Can proceed with assumptions. Document assumptions explicitly.',
      effort: 'low',
      specifics: validation.groundingRequirements
        .filter(r => r.currentStatus === 'partial')
        .map(r => r.howToMeet)
    });
  }

  return actions;
}
```

---

## 6.3 Stage 2: Early Work (0-25% Complete)

**Objective**: Detect wrong direction before significant investment.

```typescript
interface EarlyWorkCheck {
  progress: number;  // 0.0 - 0.25
  directionCorrect: boolean;
  deviations: Deviation[];
  pivotCost: 'trivial' | 'low' | 'medium';
}

interface Deviation {
  expected: EpistemicObject;
  actual: EpistemicObject;
  severity: 'minor' | 'major' | 'critical';
  explanation: string;
}

function checkEarlyWork(
  plan: TaskPlan,
  currentWork: CoherenceNetwork
): EarlyWorkCheck {
  const deviations: Deviation[] = [];

  // Compare planned vs actual
  for (const planned of plan.earlyMilestones) {
    const actual = findCorrespondingWork(currentWork, planned);

    if (!actual) {
      deviations.push({
        expected: planned,
        actual: null,
        severity: 'major',
        explanation: `Expected milestone "${planned.content.value}" not found`
      });
    } else if (!workMatchesPlan(actual, planned)) {
      deviations.push({
        expected: planned,
        actual,
        severity: assessDeviationSeverity(planned, actual),
        explanation: `Work deviates from plan: ${explainDeviation(planned, actual)}`
      });
    }
  }

  const criticalDeviations = deviations.filter(d => d.severity === 'critical');

  return {
    progress: 0.25,
    directionCorrect: criticalDeviations.length === 0,
    deviations,
    pivotCost: deviations.length === 0 ? 'trivial' :
               criticalDeviations.length === 0 ? 'low' : 'medium'
  };
}
```

**Correction at Stage 2**:
```typescript
function correctAtEarlyWork(
  check: EarlyWorkCheck
): CorrectionAction[] {
  const actions: CorrectionAction[] = [];

  if (!check.directionCorrect) {
    // Critical deviation - recommend pivot
    actions.push({
      type: 'pivot',
      description: 'Early detection of wrong direction. Recommend course change.',
      effort: check.pivotCost,
      specifics: check.deviations
        .filter(d => d.severity === 'critical')
        .map(d => d.explanation)
    });
  }

  for (const deviation of check.deviations.filter(d => d.severity === 'minor')) {
    actions.push({
      type: 'minor_adjustment',
      description: `Minor deviation: ${deviation.explanation}`,
      effort: 'trivial',
      specifics: [`Adjust: ${deviation.expected.content.value}`]
    });
  }

  return actions;
}
```

---

## 6.4 Stage 3: Mid-Work (25-75% Complete)

**Objective**: Handle sunk cost bias; make evidence-based continuation decisions.

```typescript
interface MidWorkAnalysis {
  progress: number;  // 0.25 - 0.75
  sunkCost: WorkInvestment;
  salvageValue: number;  // How much can be reused if we pivot?
  completionProbability: number;
  newEvidence: EpistemicObject[];
  recommendation: 'continue' | 'partial_rollback' | 'full_pivot';
}

interface WorkInvestment {
  timeHours: number;
  filesModified: number;
  testsWritten: number;
  documentationAdded: number;
}

function analyzeMidWork(
  plan: TaskPlan,
  currentWork: CoherenceNetwork,
  newEvidence: EpistemicObject[]
): MidWorkAnalysis {

  const investment = calculateInvestment(currentWork);

  // New evidence may change our understanding
  const evidenceImpact = assessEvidenceImpact(newEvidence, plan);

  // Calculate salvage value
  const salvageValue = calculateSalvageValue(currentWork, plan);

  // Estimate completion probability given new evidence
  const completionProb = estimateCompletion(
    currentWork,
    plan,
    newEvidence
  );

  // Decision logic (not purely sunk-cost based)
  let recommendation: 'continue' | 'partial_rollback' | 'full_pivot';

  if (completionProb > 0.7 && salvageValue > 0.8) {
    recommendation = 'continue';
  } else if (completionProb > 0.4 && salvageValue > 0.5) {
    recommendation = 'partial_rollback';
  } else {
    recommendation = 'full_pivot';
  }

  // Override: If new evidence fundamentally changes requirements
  if (evidenceImpact.fundamentalChange) {
    recommendation = 'full_pivot';
  }

  return {
    progress: calculateProgress(currentWork, plan),
    sunkCost: investment,
    salvageValue,
    completionProbability: completionProb,
    newEvidence,
    recommendation
  };
}
```

**Partial Rollback Procedure**:
```typescript
interface RollbackPlan {
  keep: ObjectId[];      // Work to preserve
  discard: ObjectId[];   // Work to abandon
  modify: ObjectId[];    // Work to adapt
  reasoning: string[];
}

function planPartialRollback(
  currentWork: CoherenceNetwork,
  newDirection: TaskPlan
): RollbackPlan {
  const keep: ObjectId[] = [];
  const discard: ObjectId[] = [];
  const modify: ObjectId[] = [];
  const reasoning: string[] = [];

  for (const [id, obj] of currentWork.objects) {
    // Check if work is still valuable in new direction
    const relevance = assessRelevanceToNewPlan(obj, newDirection);

    if (relevance.fullyRelevant) {
      keep.push(id);
      reasoning.push(`Keep ${id}: Still relevant to new plan`);
    } else if (relevance.partiallyRelevant) {
      modify.push(id);
      reasoning.push(`Modify ${id}: ${relevance.adaptationNeeded}`);
    } else {
      discard.push(id);
      reasoning.push(`Discard ${id}: Not relevant to new direction`);
    }
  }

  return { keep, discard, modify, reasoning };
}
```

---

## 6.5 Stage 4: Late Work (75-99% Complete)

**Objective**: Resist completion bias; ensure quality over speed.

```typescript
interface LateWorkAnalysis {
  progress: number;  // 0.75 - 0.99
  completionBias: boolean;  // Are we rushing to finish?
  qualityIndicators: QualityIndicator[];
  criticalIssues: CriticalIssue[];
  recommendation: 'complete' | 'pause_and_fix' | 'last_minute_pivot';
}

interface QualityIndicator {
  name: string;
  status: 'passing' | 'failing' | 'unknown';
  importance: 'critical' | 'important' | 'nice_to_have';
}

function analyzeLateWork(
  plan: TaskPlan,
  currentWork: CoherenceNetwork
): LateWorkAnalysis {

  // Detect completion bias
  const recentChanges = getRecentChanges(currentWork);
  const completionBias = detectCompletionBias(recentChanges);

  // Quality indicators
  const qualityIndicators: QualityIndicator[] = [
    {
      name: 'All tests passing',
      status: runTests(currentWork) ? 'passing' : 'failing',
      importance: 'critical'
    },
    {
      name: 'No ungrounded claims',
      status: evaluateCoherence(currentWork).status.coherent ? 'passing' : 'failing',
      importance: 'critical'
    },
    {
      name: 'Documentation complete',
      status: hasDocumentation(currentWork) ? 'passing' : 'unknown',
      importance: 'important'
    }
  ];

  // Critical issues that block completion
  const criticalIssues = qualityIndicators
    .filter(q => q.importance === 'critical' && q.status === 'failing')
    .map(q => ({
      name: q.name,
      description: `Critical quality gate failing: ${q.name}`,
      mustFix: true
    }));

  // Recommendation
  let recommendation: 'complete' | 'pause_and_fix' | 'last_minute_pivot';

  if (criticalIssues.length === 0) {
    recommendation = 'complete';
  } else if (criticalIssues.every(i => isQuicklyFixable(i))) {
    recommendation = 'pause_and_fix';
  } else {
    // Critical issue that's not quickly fixable = major problem
    recommendation = 'last_minute_pivot';
  }

  return {
    progress: 0.9,
    completionBias,
    qualityIndicators,
    criticalIssues,
    recommendation
  };
}
```

**Completion Bias Detection**:
```typescript
function detectCompletionBias(recentChanges: Change[]): boolean {
  // Signs of completion bias:
  // 1. Skipping tests
  // 2. Reducing scope without grounding
  // 3. "TODO: fix later" comments increasing
  // 4. Grounding strength decreasing for recent objects

  const skippedTests = recentChanges.filter(c =>
    c.type === 'test' && c.action === 'skip');

  const todoComments = recentChanges.filter(c =>
    c.content.includes('TODO') || c.content.includes('FIXME'));

  const weakGrounding = recentChanges.filter(c =>
    c.groundingStrength && c.groundingStrength < 0.5);

  return skippedTests.length > 2 ||
         todoComments.length > 5 ||
         weakGrounding.length > 3;
}
```

---

## 6.6 Stage 5: Post-Completion

**Objective**: Retrospective validation and remediation when errors discovered after "done."

```typescript
interface PostCompletionAnalysis {
  deliverable: CoherenceNetwork;
  validationResults: ValidationResult[];
  errorsDiscovered: DiscoveredError[];
  propagationAnalysis: PropagationAnalysis;
  remediationPlan: RemediationPlan;
}

interface DiscoveredError {
  id: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  discoveredVia: 'testing' | 'user_report' | 'monitoring' | 'review';
  affectedComponents: string[];
}

interface PropagationAnalysis {
  errorSource: ObjectId;
  affectedObjects: ObjectId[];
  propagationChain: Grounding[];
  containmentBoundary: ObjectId[];  // Where does the error stop affecting things?
}

function analyzePostCompletion(
  deliverable: CoherenceNetwork,
  errors: DiscoveredError[]
): PostCompletionAnalysis {

  const validationResults = validateDeliverable(deliverable);

  const propagationAnalyses: PropagationAnalysis[] = [];

  for (const error of errors) {
    // Find the source object
    const sourceObject = findErrorSource(deliverable, error);

    // Trace propagation
    const affected = traceErrorPropagation(deliverable, sourceObject);

    propagationAnalyses.push({
      errorSource: sourceObject,
      affectedObjects: affected.objects,
      propagationChain: affected.groundings,
      containmentBoundary: findContainmentBoundary(deliverable, affected)
    });
  }

  const remediationPlan = createRemediationPlan(
    deliverable,
    errors,
    propagationAnalyses
  );

  return {
    deliverable,
    validationResults,
    errorsDiscovered: errors,
    propagationAnalysis: propagationAnalyses[0],  // Simplified
    remediationPlan
  };
}
```

**Remediation Plan**:
```typescript
interface RemediationPlan {
  immediateActions: RemediationAction[];
  shortTermActions: RemediationAction[];
  preventionMeasures: PreventionMeasure[];
  estimatedEffort: string;
}

function createRemediationPlan(
  deliverable: CoherenceNetwork,
  errors: DiscoveredError[],
  propagation: PropagationAnalysis[]
): RemediationPlan {
  const plan: RemediationPlan = {
    immediateActions: [],
    shortTermActions: [],
    preventionMeasures: [],
    estimatedEffort: ''
  };

  for (const error of errors) {
    if (error.severity === 'critical') {
      plan.immediateActions.push({
        type: 'hotfix',
        description: `Fix critical error: ${error.description}`,
        affectedFiles: error.affectedComponents,
        groundingRequired: 'Full regression test coverage'
      });
    } else {
      plan.shortTermActions.push({
        type: 'scheduled_fix',
        description: `Fix ${error.severity} error: ${error.description}`,
        affectedFiles: error.affectedComponents,
        groundingRequired: 'Unit test coverage'
      });
    }

    // Prevention
    plan.preventionMeasures.push({
      type: 'test_addition',
      description: `Add test to catch: ${error.description}`,
      rationale: 'Prevent regression of this error'
    });
  }

  // Estimate effort
  const criticalCount = errors.filter(e => e.severity === 'critical').length;
  const majorCount = errors.filter(e => e.severity === 'major').length;
  plan.estimatedEffort = criticalCount > 0 ?
    'Immediate attention required' :
    majorCount > 2 ? '1-2 days' : 'Few hours';

  return plan;
}
```

---

[Back to Index](./index.md) | [Previous: Bad Agents](./05-bad-agents.md) | [Next: Recommendations](./07-recommendations.md)
