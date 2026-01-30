# Epistemic Task Validation System

## Problem Statement

Agents working on tasks without sufficient epistemic grounding create significant risks:

1. **Wrong-task pathology**: Working efficiently on the wrong problem
2. **Tunnel vision**: Failing to consider alternatives that might be superior
3. **Confirmation bias**: Not seeking counter-evidence to the proposed approach
4. **Low-warrant execution**: Acting on insufficient justification

Current task systems treat tasks as atomic work units. The epistemic properties of *why this task* and *why this approach* remain invisible. An agent can complete a task perfectly while failing epistemically - solving the wrong problem or using a suboptimal method.

This system makes epistemic grounding a first-class concern by treating tasks as claims requiring evidence, defeater checking, and confidence thresholds before execution proceeds.

## Philosophical Foundation

### Epistemological Framework

This system draws from three complementary epistemological traditions:

**1. Reliabilism (Goldman)**
- Knowledge requires a reliable process for forming true beliefs
- Task validity depends on the reliability of the process that identified it
- A task has warrant when derived through historically calibrated methods

**2. Coherentism**
- Beliefs are justified by their coherence with other beliefs
- A task gains warrant from its consistency with:
  - The stated goal
  - Known constraints
  - Evidence about the problem domain
  - Alternative task evaluations

**3. Bayesian Epistemology**
- Beliefs are credences (confidence levels) updated by evidence
- Task confidence is derived from component confidences
- Evidence for/against the task updates its warrant

### What Constitutes "Sufficient Warrant"

A task has sufficient epistemic warrant when:

```
WARRANT = f(
  problem_identification_confidence,    -- Is this actually the problem?
  alternatives_exploration_thoroughness, -- Were other approaches considered?
  counter_analysis_strength,            -- Were objections addressed?
  method_calibration_status            -- Is the approach historically reliable?
)
```

Sufficient warrant is achieved when:
1. The composite confidence meets a configurable threshold (default: 0.6)
2. No active full-severity defeaters exist against the task justification
3. The calibration status is not 'degraded' or 'unknown'
4. At least one alternative was explicitly considered and documented

### Avoiding Infinite Regress

The regress problem (why trust the evidence for the evidence?) is addressed by:

1. **Foundational anchors**: Deterministic operations (parse success, file existence, test results) provide `DeterministicConfidence` values that require no further justification

2. **Measured baselines**: Historical calibration data provides `MeasuredConfidence` that grounds derived values in empirical outcomes

3. **Pragmatic cutoffs**: The system distinguishes:
   - **Inquiry context**: Where we trace evidence chains
   - **Action context**: Where we accept calibrated thresholds without infinite regress

4. **Bounded confidence**: When no calibration data exists, `BoundedConfidence` with explicit citations provides justified ranges, and `AbsentConfidence` honestly acknowledges unknowns

## Architecture

### TaskClaim Type

Tasks become first-class epistemic objects through the `TaskClaim` type:

```typescript
/**
 * A task as an epistemic claim - the assertion that this task
 * should be performed to achieve a goal.
 */
interface TaskClaim {
  /** Standard claim fields */
  id: ClaimId;
  proposition: string;  // "Task X should be performed to achieve goal Y"
  type: 'task_validity';

  /** Task-specific fields */
  task: {
    id: TaskId;
    description: string;
    goal: string;
    method: string;
  };

  /** Epistemic grounding - what justifies this task */
  grounding: TaskEpistemicGrounding;

  /** Overall task confidence (derived from grounding components) */
  confidence: ConfidenceValue;

  /** Calibration status of the derivation */
  calibrationStatus: CalibrationStatus;

  /** Active defeaters against this task */
  defeaters: ExtendedDefeater[];

  /** Status tracking */
  status: 'pending_validation' | 'validated' | 'blocked' | 'invalidated';

  /** Schema version for evolution */
  schemaVersion: string;
}

/**
 * The epistemic grounding for a task - evidence that it's the RIGHT task.
 */
interface TaskEpistemicGrounding {
  /** Evidence that this is actually the problem to solve */
  problemIdentification: {
    evidence: EvidenceId[];
    confidence: ConfidenceValue;
    method: 'user_statement' | 'analysis' | 'inferred' | 'measured';
  };

  /** Evidence that alternatives were considered */
  alternativesConsidered: {
    alternatives: Array<{
      description: string;
      reason_rejected: string;
      confidence_in_rejection: ConfidenceValue;
    }>;
    thoroughness: ConfidenceValue;  // How exhaustively were alternatives searched?
  };

  /** Evidence that counter-analyses were performed */
  counterAnalysis: {
    objections: Array<{
      objection: string;
      response: string;
      response_strength: ConfidenceValue;
    }>;
    completeness: ConfidenceValue;  // How thoroughly were objections sought?
  };

  /** Evidence for the chosen method/approach */
  methodWarrant: {
    method: string;
    historicalReliability: ConfidenceValue;  // Has this approach worked before?
    applicability: ConfidenceValue;  // Does it apply to this situation?
    calibrationData?: {
      datasetId: string;
      sampleSize: number;
      successRate: number;
    };
  };
}
```

### ValidationCriteria

The system validates tasks against configurable criteria:

```typescript
/**
 * Criteria for determining if a task has sufficient epistemic grounding.
 */
interface TaskValidationCriteria {
  /** Minimum overall confidence to proceed */
  minimumConfidence: number;  // Default: 0.6

  /** Minimum confidence for problem identification */
  minimumProblemConfidence: number;  // Default: 0.7

  /** Minimum number of alternatives that must be considered */
  minimumAlternativesConsidered: number;  // Default: 1

  /** Whether counter-analysis is required */
  requireCounterAnalysis: boolean;  // Default: true

  /** Minimum objections that must be addressed */
  minimumObjectionsAddressed: number;  // Default: 1

  /** Whether method must have calibration data */
  requireMethodCalibration: boolean;  // Default: false (relaxed default)

  /** Calibration status requirements */
  allowDegradedCalibration: boolean;  // Default: true with warning
  allowUnknownCalibration: boolean;   // Default: false

  /** Defeater severity thresholds */
  blockOnFullDefeater: boolean;       // Default: true
  blockOnPartialDefeater: boolean;    // Default: false

  /** Maximum staleness for supporting evidence */
  maxEvidenceAgeMs: number;  // Default: 7 days
}

/**
 * Preset configurations for common use cases.
 */
const ValidationPresets = {
  /** Strict validation - for high-stakes decisions */
  strict: {
    minimumConfidence: 0.75,
    minimumProblemConfidence: 0.8,
    minimumAlternativesConsidered: 2,
    requireCounterAnalysis: true,
    minimumObjectionsAddressed: 2,
    requireMethodCalibration: true,
    allowDegradedCalibration: false,
    allowUnknownCalibration: false,
    blockOnFullDefeater: true,
    blockOnPartialDefeater: true,
    maxEvidenceAgeMs: 3 * 24 * 60 * 60 * 1000,  // 3 days
  },

  /** Standard validation - balanced approach */
  standard: {
    minimumConfidence: 0.6,
    minimumProblemConfidence: 0.7,
    minimumAlternativesConsidered: 1,
    requireCounterAnalysis: true,
    minimumObjectionsAddressed: 1,
    requireMethodCalibration: false,
    allowDegradedCalibration: true,
    allowUnknownCalibration: false,
    blockOnFullDefeater: true,
    blockOnPartialDefeater: false,
    maxEvidenceAgeMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
  },

  /** Relaxed validation - for exploratory work */
  relaxed: {
    minimumConfidence: 0.4,
    minimumProblemConfidence: 0.5,
    minimumAlternativesConsidered: 0,
    requireCounterAnalysis: false,
    minimumObjectionsAddressed: 0,
    requireMethodCalibration: false,
    allowDegradedCalibration: true,
    allowUnknownCalibration: true,
    blockOnFullDefeater: true,
    blockOnPartialDefeater: false,
    maxEvidenceAgeMs: 30 * 24 * 60 * 60 * 1000,  // 30 days
  },
} as const;
```

### TaskEpistemicValidator

The core validation component:

```typescript
/**
 * Validates that tasks have sufficient epistemic grounding before execution.
 */
interface ITaskEpistemicValidator {
  /**
   * Validate a task claim against the configured criteria.
   *
   * @param task - The task claim to validate
   * @param criteria - Validation criteria (defaults to 'standard' preset)
   * @returns Validation result with detailed diagnostics
   */
  validate(
    task: TaskClaim,
    criteria?: TaskValidationCriteria
  ): Promise<TaskValidationResult>;

  /**
   * Build grounding evidence for a task from available sources.
   *
   * @param task - Basic task information
   * @param context - Context for gathering evidence
   * @returns TaskClaim with populated grounding
   */
  buildGrounding(
    task: { id: TaskId; description: string; goal: string; method: string },
    context: GroundingContext
  ): Promise<TaskClaim>;

  /**
   * Check for defeaters against a task's justification.
   *
   * @param task - The task claim to check
   * @returns Array of active defeaters
   */
  checkDefeaters(task: TaskClaim): Promise<ExtendedDefeater[]>;

  /**
   * Generate remediation actions for a failed validation.
   *
   * @param result - The failed validation result
   * @returns Ordered list of remediation actions
   */
  generateRemediation(result: TaskValidationResult): RemediationPlan;
}

/**
 * Context for building task grounding.
 */
interface GroundingContext {
  /** The evidence ledger for querying past evidence */
  ledger: IEvidenceLedger;

  /** The evidence graph storage for claims and defeaters */
  storage: EvidenceGraphStorage;

  /** Current session ID for provenance */
  sessionId: SessionId;

  /** User-provided alternatives (if any) */
  userAlternatives?: string[];

  /** User-provided objections (if any) */
  userObjections?: string[];

  /** Method calibration data (if available) */
  methodCalibration?: {
    datasetId: string;
    sampleSize: number;
    successRate: number;
  };
}

/**
 * Result of task validation.
 */
interface TaskValidationResult {
  /** Whether the task passed validation */
  valid: boolean;

  /** Overall confidence in the task */
  confidence: ConfidenceValue;

  /** Calibration status of the confidence derivation */
  calibrationStatus: CalibrationStatus;

  /** Detailed breakdown of validation */
  breakdown: {
    problemIdentification: {
      met: boolean;
      confidence: ConfidenceValue;
      required: number;
      reason?: string;
    };
    alternativesConsidered: {
      met: boolean;
      count: number;
      required: number;
      alternatives: string[];
      reason?: string;
    };
    counterAnalysis: {
      met: boolean;
      objectionsAddressed: number;
      required: number;
      objections: string[];
      reason?: string;
    };
    methodWarrant: {
      met: boolean;
      confidence: ConfidenceValue;
      calibrated: boolean;
      reason?: string;
    };
    evidenceFreshness: {
      met: boolean;
      oldestEvidenceAge: number;
      maxAllowed: number;
      staleEvidence: EvidenceId[];
    };
  };

  /** Active defeaters against the task */
  defeaters: ExtendedDefeater[];

  /** Blocking reasons (if invalid) */
  blockingReasons: string[];

  /** Warnings (non-blocking issues) */
  warnings: string[];

  /** Remediation hint */
  remediation?: RemediationPlan;
}
```

### Integration with Existing Primitives

The validator composes existing Librarian primitives:

```typescript
class TaskEpistemicValidator implements ITaskEpistemicValidator {
  constructor(
    private ledger: IEvidenceLedger,
    private storage: EvidenceGraphStorage,
    private defeaterConfig: DefeaterEngineConfig = DEFAULT_DEFEATER_CONFIG
  ) {}

  async validate(
    task: TaskClaim,
    criteria: TaskValidationCriteria = ValidationPresets.standard
  ): Promise<TaskValidationResult> {
    // 1. Check overall confidence threshold
    const confidenceCheck = checkConfidenceThreshold(
      task.confidence,
      criteria.minimumConfidence
    );

    // 2. Compute and track calibration status
    const calibrationTracker = new CalibrationTracker('preserved');
    const inputConfidences = [
      task.grounding.problemIdentification.confidence,
      task.grounding.alternativesConsidered.thoroughness,
      task.grounding.counterAnalysis.completeness,
      task.grounding.methodWarrant.applicability,
    ];

    // Track through derivation operations
    calibrationTracker.applyOperation(
      'min',
      inputConfidences.map(c => getCalibrationStatus(c))
    );

    // 3. Check for defeaters
    const defeatersResult = await detectDefeaters(
      this.storage,
      {
        timestamp: new Date().toISOString(),
        changedFiles: [], // Could include related files
      },
      this.defeaterConfig
    );

    // Filter to defeaters affecting this task's supporting claims
    const relevantDefeaters = defeatersResult.defeaters.filter(d =>
      d.affectedClaimIds.some(id =>
        this.isTaskSupportingClaim(task, id)
      )
    );

    // 4. Apply defeaters to confidence
    const { confidence: defeatedConfidence, fullyDefeated } =
      applyDefeatersToConfidence(task.confidence, relevantDefeaters);

    // 5. Check evidence freshness
    const evidenceChain = await this.ledger.getChain(
      task.grounding.problemIdentification.evidence[0]
    );

    // 6. Build result
    return this.buildValidationResult(
      task,
      criteria,
      defeatedConfidence,
      calibrationTracker.getStatus(),
      relevantDefeaters,
      evidenceChain
    );
  }

  async buildGrounding(
    task: { id: TaskId; description: string; goal: string; method: string },
    context: GroundingContext
  ): Promise<TaskClaim> {
    // Query ledger for existing evidence about the problem
    const problemEvidence = await context.ledger.query({
      kinds: ['claim', 'extraction', 'synthesis'],
      textSearch: task.goal,
      limit: 10,
    });

    // Compute problem identification confidence
    const problemConfidence = problemEvidence.length > 0
      ? deriveSequentialConfidence(
          problemEvidence
            .filter(e => e.confidence)
            .map(e => e.confidence!)
        )
      : absent('insufficient_data');

    // Build alternatives from context or defaults
    const alternatives = context.userAlternatives?.map(alt => ({
      description: alt,
      reason_rejected: 'User provided alternative - pending evaluation',
      confidence_in_rejection: absent('uncalibrated') as ConfidenceValue,
    })) ?? [];

    // Build counter-analysis from context
    const objections = context.userObjections?.map(obj => ({
      objection: obj,
      response: 'Pending response',
      response_strength: absent('uncalibrated') as ConfidenceValue,
    })) ?? [];

    // Method warrant from calibration data or bounded estimate
    const methodConfidence = context.methodCalibration
      ? measuredConfidence({
          datasetId: context.methodCalibration.datasetId,
          sampleSize: context.methodCalibration.sampleSize,
          accuracy: context.methodCalibration.successRate,
          ci95: [
            Math.max(0, context.methodCalibration.successRate - 0.1),
            Math.min(1, context.methodCalibration.successRate + 0.1),
          ],
        })
      : bounded(0.3, 0.7, 'theoretical',
          'Uncalibrated method - conservative estimate');

    // Compose overall confidence
    const overallConfidence = sequenceConfidence([
      problemConfidence,
      alternatives.length > 0
        ? deterministic(true, 'alternatives_present')
        : absent('insufficient_data'),
      methodConfidence,
    ]);

    return {
      id: createClaimId(`task_claim_${task.id}`),
      proposition: `Task "${task.description}" should be performed to achieve: ${task.goal}`,
      type: 'task_validity',
      task,
      grounding: {
        problemIdentification: {
          evidence: problemEvidence.map(e => e.id),
          confidence: problemConfidence,
          method: problemEvidence.length > 0 ? 'analysis' : 'inferred',
        },
        alternativesConsidered: {
          alternatives,
          thoroughness: alternatives.length > 0
            ? deterministic(true, 'alternatives_documented')
            : absent('insufficient_data'),
        },
        counterAnalysis: {
          objections,
          completeness: objections.length > 0
            ? deterministic(true, 'objections_documented')
            : absent('insufficient_data'),
        },
        methodWarrant: {
          method: task.method,
          historicalReliability: methodConfidence,
          applicability: bounded(0.4, 0.8, 'theoretical',
            'Default applicability estimate'),
          calibrationData: context.methodCalibration,
        },
      },
      confidence: overallConfidence,
      calibrationStatus: computeCalibrationStatus([
        problemConfidence,
        methodConfidence,
      ]),
      defeaters: [],
      status: 'pending_validation',
      schemaVersion: '1.0.0',
    };
  }

  generateRemediation(result: TaskValidationResult): RemediationPlan {
    const actions: RemediationAction[] = [];

    // Check each breakdown component
    if (!result.breakdown.problemIdentification.met) {
      actions.push({
        type: 'gather_evidence',
        priority: 1,
        description: 'Gather more evidence that this is the correct problem to solve',
        suggestions: [
          'Query users to confirm problem understanding',
          'Search for related issues or requirements',
          'Analyze error logs or user reports',
        ],
        targetConfidence: result.breakdown.problemIdentification.required,
      });
    }

    if (!result.breakdown.alternativesConsidered.met) {
      actions.push({
        type: 'consider_alternatives',
        priority: 2,
        description: `Consider at least ${result.breakdown.alternativesConsidered.required} alternative approaches`,
        suggestions: [
          'Brainstorm alternative solutions',
          'Search for similar problems and their solutions',
          'Ask stakeholders for alternative ideas',
        ],
        targetCount: result.breakdown.alternativesConsidered.required,
      });
    }

    if (!result.breakdown.counterAnalysis.met) {
      actions.push({
        type: 'address_objections',
        priority: 3,
        description: `Address at least ${result.breakdown.counterAnalysis.required} potential objections`,
        suggestions: [
          'Consider what could go wrong with this approach',
          'Think about edge cases or failure modes',
          'Seek critical feedback from others',
        ],
        targetCount: result.breakdown.counterAnalysis.required,
      });
    }

    if (!result.breakdown.methodWarrant.met) {
      actions.push({
        type: 'validate_method',
        priority: 4,
        description: 'Strengthen confidence in the chosen method',
        suggestions: [
          'Find historical examples of this method succeeding',
          'Run a small-scale test of the approach',
          'Consult documentation or best practices',
        ],
        targetConfidence: 0.6,
      });
    }

    if (!result.breakdown.evidenceFreshness.met) {
      actions.push({
        type: 'refresh_evidence',
        priority: 5,
        description: 'Update stale evidence',
        staleEvidence: result.breakdown.evidenceFreshness.staleEvidence,
        suggestions: [
          'Re-run analysis on affected files',
          'Verify that cached evidence is still valid',
          'Check for recent changes to the codebase',
        ],
      });
    }

    // Handle defeaters
    for (const defeater of result.defeaters) {
      if (defeater.severity === 'full' || defeater.severity === 'partial') {
        actions.push({
          type: 'resolve_defeater',
          priority: 0, // Highest priority
          description: `Resolve ${defeater.severity} defeater: ${defeater.description}`,
          defeaterId: defeater.id,
          suggestions: defeater.autoResolvable
            ? [`Automatic resolution available: ${defeater.resolutionAction}`]
            : ['Manual intervention required'],
        });
      }
    }

    // Sort by priority
    actions.sort((a, b) => a.priority - b.priority);

    return {
      taskId: 'task_id_placeholder',  // Would come from result
      actions,
      estimatedEffort: this.estimateRemediationEffort(actions),
      criticalPath: actions.filter(a => a.priority <= 2),
    };
  }

  private estimateRemediationEffort(
    actions: RemediationAction[]
  ): { minimal: string; typical: string; thorough: string } {
    const count = actions.length;
    return {
      minimal: count <= 1 ? '5-15 minutes' : '15-30 minutes',
      typical: count <= 2 ? '30 minutes - 1 hour' : '1-2 hours',
      thorough: count <= 3 ? '2-4 hours' : '4-8 hours',
    };
  }
}
```

### Remediation Actions

When validation fails, the system provides actionable remediation:

```typescript
/**
 * A plan for remediating a failed task validation.
 */
interface RemediationPlan {
  /** ID of the task being remediated */
  taskId: string;

  /** Ordered list of remediation actions */
  actions: RemediationAction[];

  /** Estimated effort to complete remediation */
  estimatedEffort: {
    minimal: string;   // Just the blocking issues
    typical: string;   // Blocking + major warnings
    thorough: string;  // Complete remediation
  };

  /** Critical path - actions that must be completed */
  criticalPath: RemediationAction[];
}

/**
 * A single remediation action.
 */
interface RemediationAction {
  /** Type of action */
  type:
    | 'gather_evidence'
    | 'consider_alternatives'
    | 'address_objections'
    | 'validate_method'
    | 'refresh_evidence'
    | 'resolve_defeater';

  /** Priority (0 = highest) */
  priority: number;

  /** Human-readable description */
  description: string;

  /** Suggested approaches */
  suggestions: string[];

  /** Target confidence (for evidence gathering) */
  targetConfidence?: number;

  /** Target count (for alternatives/objections) */
  targetCount?: number;

  /** Stale evidence IDs (for refresh) */
  staleEvidence?: EvidenceId[];

  /** Defeater ID (for resolution) */
  defeaterId?: string;
}
```

## Implementation Path

### Phase 1: Core Types and Validator (Week 1)

1. **Add types to `src/epistemics/task_validation.ts`**
   - `TaskClaim` interface
   - `TaskEpistemicGrounding` interface
   - `TaskValidationCriteria` interface and presets
   - `TaskValidationResult` interface
   - `RemediationPlan` and `RemediationAction` interfaces

2. **Implement basic validator**
   - `TaskEpistemicValidator` class
   - `validate()` method using `checkConfidenceThreshold`
   - `CalibrationTracker` integration

### Phase 2: Grounding Builder (Week 2)

1. **Implement `buildGrounding()`**
   - Query evidence ledger for supporting evidence
   - Compute component confidences
   - Derive overall confidence using `sequenceConfidence`

2. **Integrate with defeater detection**
   - Use `detectDefeaters()` from `defeaters.ts`
   - Apply `applyDefeatersToConfidence()`

### Phase 3: Remediation System (Week 3)

1. **Implement `generateRemediation()`**
   - Analyze validation breakdown
   - Generate prioritized action list
   - Estimate effort

2. **Create remediation workflows**
   - Interactive prompts for gathering evidence
   - Templates for documenting alternatives
   - Structured objection capture

### Phase 4: Integration and Presets (Week 4)

1. **Integrate with agent workflow**
   - Hook validation into task execution pipeline
   - Add `--epistemic-validation` CLI flag
   - Create validation middleware

2. **Configuration presets**
   - `strict`, `standard`, `relaxed` presets
   - Per-project configuration via `.librarian.json`
   - Environment variable overrides

## Preset Configuration

Users select validation policy through configuration:

```json
// .librarian.json
{
  "epistemicValidation": {
    "enabled": true,
    "preset": "standard",
    "overrides": {
      "minimumAlternativesConsidered": 2,
      "requireMethodCalibration": true
    }
  }
}
```

Or via environment:

```bash
LIBRARIAN_EPISTEMIC_PRESET=strict
LIBRARIAN_MIN_TASK_CONFIDENCE=0.7
```

Or programmatically:

```typescript
const validator = new TaskEpistemicValidator(ledger, storage);

// Use preset
const result = await validator.validate(task, ValidationPresets.strict);

// Or custom criteria
const result = await validator.validate(task, {
  ...ValidationPresets.standard,
  minimumConfidence: 0.75,
  requireMethodCalibration: true,
});
```

## Open Questions

1. **Calibration data bootstrapping**: How do we calibrate task-level methods when there's no historical data? Options:
   - Start with bounded confidence and tighten as data accumulates
   - Use transfer learning from similar methods
   - Accept `absent` confidence with relaxed validation during bootstrap

2. **Alternative thoroughness**: How do we measure if alternatives were *sufficiently* explored? Options:
   - Minimum count (current approach)
   - Diversity metric (how different are the alternatives?)
   - Coverage of solution space (requires domain knowledge)

3. **Counter-analysis completeness**: What constitutes a sufficient objection set? Options:
   - Known failure mode coverage
   - Stakeholder objection checklist
   - Automated objection generation via LLM

4. **Real-time vs. batch validation**: Should validation happen:
   - Before task starts (current design)
   - Continuously during execution
   - At checkpoints
   - All of the above?

5. **Validation cost**: Full validation adds overhead. How do we:
   - Cache validation results?
   - Invalidate cache appropriately?
   - Balance thoroughness vs. speed?

6. **Human-in-the-loop**: When should validation escalate to human review?
   - Confidence below threshold but above blocking level?
   - Novel method types?
   - High-stakes task categories?

7. **Composing task validation**: For complex tasks with subtasks:
   - Validate parent and all children?
   - Derive parent confidence from children?
   - Allow different validation levels per subtask?
