# Track C: Agentic Workflow Primitives (W1-W6)

> **Extracted from**: `docs/LiBrainian/THEORETICAL_CRITIQUE.md` Part XIX
> **Source**: Additional Agentic Workflow Gaps (25 Greats' Audit)
> **Purpose**: Production-grade agentic workflow support
>
> **LiBrainian Story**: Chapter 8 (The Orchestra) - Agents working in concert, observed, guided, and improved.
>
> **The 25 Greats' Verdict**: "These six gaps - testing, cost, HITL, multi-agent, versioning, observability - are the difference between a demo and a production system." (Armstrong)

---

## Executive Summary

This specification defines the agentic workflow primitives required for production-grade agent systems. Without these capabilities, agents are "black boxes that will fail unpredictably" (Brooks).

### Track C Features

| Priority | Feature | Part Reference | Est. LOC | Status |
|----------|---------|----------------|----------|--------|
| **W1** | Agent Testing & Evaluation | XIX (Gap 1) | ~300 | Spec Only |
| **W2** | Cost Management | XIX (Gap 2) | ~200 | Spec Only |
| **W3** | Human-in-the-Loop | XIX (Gap 3) | ~250 | Spec Only |
| **W4** | Multi-Agent Coordination | XIX (Gap 4) | ~300 | Spec Only |
| **W5** | Workflow Versioning & Rollback | XIX (Gap 5) | ~200 | Spec Only |
| **W6** | Agent Observability | XIX (Gap 6) | ~250 | Spec Only |

**Total for Agentic Workflow Support: ~1,500 LOC**

---

## Theoretical Foundation

### The Production Gap

**Dijkstra**: "Testing agents is harder than testing functions because agents are non-deterministic. The test framework must capture and replay behaviors, not just assert outputs."

**Brooks**: "No silver bullet, but proper workflow support is the closest thing. An agent without observability is a black box that will fail unpredictably."

**Armstrong**: "An agent system without proper workflow support is like an actor system without supervision trees - it will fail badly."

### Why Agents Need Workflow Primitives

Traditional software testing verifies that code compiles and functions return correct values. Agent testing must verify:

1. **Behavior**: Does the agent make good decisions?
2. **Cost**: Does the agent use resources efficiently?
3. **Safety**: Does the agent pause for human review when needed?
4. **Coordination**: Do multiple agents work together without conflicts?
5. **Evolution**: Can workflows be versioned and rolled back?
6. **Observability**: Can we understand what agents are doing right now?

---

## W1: Agent Testing & Evaluation

**Source**: Part XIX (Gap 1)

### Problem Statement

How do you test that an agent BEHAVES correctly, not just that its code compiles?

Traditional unit tests verify function outputs. Agent tests must verify:
- Decision quality across scenarios
- Behavior consistency under replay
- Regression detection when agent logic changes
- Evaluation against quality criteria

### Technical Specification

#### Primitives

```typescript
/**
 * tp_agent_test_trace: Trace agent behavior for testing
 *
 * Captures all decisions, tool calls, and state transitions during
 * agent execution for later replay and evaluation.
 */
export const tp_agent_test_trace: TechniquePrimitive = {
  id: 'tp_agent_test_trace',
  name: 'Agent Test Tracing',
  description: 'Capture agent behavior for replay and evaluation',
  inputs: [
    { name: 'agentId', type: 'string' },
    { name: 'scenario', type: 'TestScenario' },
  ],
  outputs: [
    { name: 'trace', type: 'AgentTrace' },
    { name: 'decisions', type: 'Decision[]' },
    { name: 'toolCalls', type: 'ToolCall[]' },
  ],
  confidence: {
    type: 'bounded',
    low: 0.7,
    high: 0.95,
    basis: 'theoretical',
    citation: 'Trace capture is deterministic; completeness depends on instrumentation coverage',
  } satisfies BoundedConfidence,
};

/**
 * tp_agent_eval: Evaluate agent performance against criteria
 *
 * Applies evaluation criteria to agent traces to produce scores,
 * identify failures, and generate recommendations.
 */
export const tp_agent_eval: TechniquePrimitive = {
  id: 'tp_agent_eval',
  name: 'Agent Evaluation',
  description: 'Evaluate agent behavior against quality criteria',
  inputs: [
    { name: 'trace', type: 'AgentTrace' },
    { name: 'criteria', type: 'EvalCriteria' },
  ],
  outputs: [
    { name: 'scores', type: 'EvalScore[]' },
    { name: 'failures', type: 'Failure[]' },
    { name: 'recommendations', type: 'Recommendation[]' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated',
  } satisfies AbsentConfidence,
};
```

#### Core Interfaces

```typescript
/**
 * Test scenario definition for agent behavior testing.
 */
export interface TestScenario {
  /** Unique identifier for the scenario */
  id: string;

  /** Human-readable description */
  description: string;

  /** Initial state for the agent */
  initialState: AgentState;

  /** Inputs to provide to the agent */
  inputs: AgentInput[];

  /** Expected behaviors (not outputs - behaviors) */
  expectedBehaviors: ExpectedBehavior[];

  /** Optional: maximum duration before timeout */
  timeoutMs?: number;
}

/**
 * Expected behavior specification.
 * Note: We specify BEHAVIORS, not exact outputs, because agents are non-deterministic.
 */
export interface ExpectedBehavior {
  /** What behavior to check for */
  behavior: 'calls_tool' | 'makes_decision' | 'reaches_state' | 'avoids_action';

  /** Parameters for the behavior check */
  parameters: Record<string, unknown>;

  /** Is this required or optional? */
  required: boolean;

  /** Confidence in this expectation */
  confidence: ConfidenceValue;
}

/**
 * Complete trace of agent execution.
 */
export interface AgentTrace {
  /** Unique identifier for this trace */
  traceId: string;

  /** Agent that was traced */
  agentId: string;

  /** Scenario that was executed */
  scenarioId: string;

  /** All decisions made during execution */
  decisions: Decision[];

  /** All tool calls made during execution */
  toolCalls: ToolCall[];

  /** State transitions */
  stateTransitions: StateTransition[];

  /** Timing information */
  timing: {
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
  };

  /** Environment snapshot for reproducibility */
  environment: EnvironmentSnapshot;
}

/**
 * Agent test suite definition.
 */
export interface AgentTestSuite {
  /** Suite identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this suite tests */
  description: string;

  /** Test cases in this suite */
  testCases: TestScenario[];

  /** Evaluation criteria for the suite */
  evaluationCriteria: EvalCriteria;

  /** Regression baseline (if any) */
  baseline?: AgentTrace[];
}

/**
 * Evaluation criteria for agent behavior.
 */
export interface EvalCriteria {
  /** Minimum score thresholds */
  thresholds: {
    overall: number;
    perBehavior: Record<string, number>;
  };

  /** Weights for different criteria */
  weights: {
    decisionQuality: number;
    toolUseEfficiency: number;
    stateManagement: number;
    errorHandling: number;
  };

  /** Custom evaluators */
  customEvaluators?: CustomEvaluator[];
}

/**
 * Result of agent evaluation.
 */
export interface AgentEvalResult {
  /** Overall pass/fail */
  passed: boolean;

  /** Detailed scores */
  scores: {
    overall: number;
    decisionQuality: number;
    toolUseEfficiency: number;
    stateManagement: number;
    errorHandling: number;
    custom: Record<string, number>;
  };

  /** Specific failures identified */
  failures: EvalFailure[];

  /** Insights from the evaluation */
  insights: EvalInsight[];

  /** Recommendations for improvement */
  recommendations: string[];

  /** Confidence in evaluation */
  confidence: ConfidenceValue;
}

/**
 * Evaluation failure details.
 */
export interface EvalFailure {
  /** What criterion failed */
  criterion: string;

  /** Where in the trace the failure occurred */
  traceLocation: TraceLocation;

  /** Expected vs actual */
  expected: string;
  actual: string;

  /** Severity */
  severity: 'critical' | 'major' | 'minor';
}

/**
 * Insight from evaluation.
 */
export interface EvalInsight {
  /** Type of insight */
  type: 'pattern' | 'anomaly' | 'improvement_opportunity';

  /** Description */
  description: string;

  /** Evidence from trace */
  evidence: TraceLocation[];

  /** Confidence in this insight */
  confidence: ConfidenceValue;
}
```

#### Agent Test Framework

```typescript
/**
 * Framework for testing agent behavior.
 */
export interface AgentTestFramework {
  /**
   * Define a test scenario.
   */
  defineScenario(scenario: TestScenario): ScenarioId;

  /**
   * Run an agent with full tracing enabled.
   */
  runWithTrace(agentId: string, scenarioId: ScenarioId): Promise<AgentTrace>;

  /**
   * Replay a trace for debugging.
   * @param fromStep - Optional step number to replay from
   */
  replay(trace: AgentTrace, fromStep?: number): Promise<void>;

  /**
   * Evaluate a trace against criteria.
   */
  evaluate(trace: AgentTrace, criteria: EvalCriteria): AgentEvalResult;

  /**
   * Detect regressions between traces.
   */
  detectRegression(
    newTrace: AgentTrace,
    baselineTrace: AgentTrace
  ): RegressionReport;

  /**
   * Run a full test suite.
   */
  runSuite(suite: AgentTestSuite): Promise<SuiteResult>;
}

/**
 * Regression detection report.
 */
export interface RegressionReport {
  /** Did we detect a regression? */
  hasRegression: boolean;

  /** Specific regressions found */
  regressions: Regression[];

  /** Improvements found (better than baseline) */
  improvements: Improvement[];

  /** Summary statistics */
  summary: {
    newBehaviors: number;
    removedBehaviors: number;
    changedBehaviors: number;
    scoreChange: number;
  };

  /** Confidence in regression detection */
  confidence: ConfidenceValue;
}
```

### Acceptance Criteria

- [ ] Test scenarios capture initial state, inputs, and expected behaviors
- [ ] Traces include all decisions, tool calls, and state transitions
- [ ] Replay produces identical behavior given same environment snapshot
- [ ] Evaluation produces scores, failures, and recommendations
- [ ] Regression detection compares new traces to baselines
- [ ] Suite execution aggregates results across multiple scenarios
- [ ] ~300 LOC budget

---

## W2: Cost Management

**Source**: Part XIX (Gap 2)

### Problem Statement

LLM calls are expensive. How do agents minimize cost while maintaining quality?

Production agent systems must:
- Track token usage and costs across operations
- Set and enforce budgets
- Identify optimization opportunities
- Make cost-quality tradeoffs intelligently

### Technical Specification

#### Primitives

```typescript
/**
 * tp_cost_trace: Track token/API costs through workflow
 *
 * Records all token usage and costs for an operation, enabling
 * cost analysis and optimization.
 */
export const tp_cost_trace: TechniquePrimitive = {
  id: 'tp_cost_trace',
  name: 'Cost Tracing',
  description: 'Track token usage and cost across agent operations',
  inputs: [
    { name: 'operation', type: 'Operation' },
  ],
  outputs: [
    { name: 'tokenUsage', type: 'TokenUsage' },
    { name: 'costUSD', type: 'number' },
    { name: 'breakdown', type: 'CostBreakdown' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Cost tracking is deterministic given accurate token counts',
  } satisfies DeterministicConfidence,
};

/**
 * tp_cost_optimize: Suggest cost optimizations
 *
 * Analyzes cost traces to identify opportunities for caching,
 * batching, and model selection optimization.
 */
export const tp_cost_optimize: TechniquePrimitive = {
  id: 'tp_cost_optimize',
  name: 'Cost Optimization',
  description: 'Identify opportunities to reduce costs (caching, batching, model selection)',
  inputs: [
    { name: 'traces', type: 'CostTrace[]' },
  ],
  outputs: [
    { name: 'opportunities', type: 'CostOpportunity[]' },
    { name: 'modelDowngrades', type: 'ModelDowngrade[]' },
    { name: 'cachingOpportunities', type: 'CacheOpportunity[]' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated',
  } satisfies AbsentConfidence,
};
```

#### Core Interfaces

```typescript
/**
 * Token usage breakdown.
 */
export interface TokenUsage {
  /** Input tokens (prompt) */
  inputTokens: number;

  /** Output tokens (completion) */
  outputTokens: number;

  /** Total tokens */
  totalTokens: number;

  /** Model used */
  model: string;

  /** Provider */
  provider: 'claude' | 'codex' | 'other';
}

/**
 * Cost breakdown by category.
 */
export interface CostBreakdown {
  /** Input token costs */
  inputCost: number;

  /** Output token costs */
  outputCost: number;

  /** Total cost */
  totalCost: number;

  /** Currency */
  currency: 'USD';

  /** Per-stage breakdown */
  perStage: {
    stageName: string;
    cost: number;
    percentage: number;
  }[];
}

/**
 * Cost profile for a workflow or agent.
 */
export interface CostProfile {
  /** Profile identifier */
  id: string;

  /** Time period */
  period: {
    start: Date;
    end: Date;
  };

  /** Total cost */
  totalCost: number;

  /** Per-stage costs */
  perStageCosts: Map<string, number>;

  /** Per-model costs */
  perModelCosts: Map<string, number>;

  /** Cost trend */
  trend: 'increasing' | 'decreasing' | 'stable';

  /** Anomalies detected */
  anomalies: CostAnomaly[];
}

/**
 * Budget configuration with limits and alerts.
 */
export interface CostBudget {
  /** Budget identifier */
  id: string;

  /** Scope of the budget */
  scope: 'agent' | 'workflow' | 'task' | 'global';

  /** Scope identifier (agent ID, workflow ID, etc.) */
  scopeId?: string;

  /** Budget limit */
  limit: {
    amount: number;
    currency: 'USD';
    period: 'hour' | 'day' | 'week' | 'month' | 'task';
  };

  /** Alert thresholds (percentage of budget) */
  alerts: {
    warning: number;  // e.g., 0.75 for 75%
    critical: number; // e.g., 0.90 for 90%
  };

  /** What to do when budget exceeded */
  onExceeded: 'warn' | 'throttle' | 'block';

  /** Current usage */
  currentUsage: number;
}

/**
 * Cost optimization opportunity.
 */
export interface CostOpportunity {
  /** Type of optimization */
  type: 'caching' | 'batching' | 'model_downgrade' | 'prompt_optimization';

  /** Estimated savings */
  estimatedSavings: {
    amount: number;
    percentage: number;
  };

  /** Implementation effort */
  effort: 'low' | 'medium' | 'high';

  /** Description */
  description: string;

  /** Confidence in savings estimate */
  confidence: ConfidenceValue;
}

/**
 * Model downgrade suggestion.
 */
export interface ModelDowngrade {
  /** Current model */
  currentModel: string;

  /** Suggested model */
  suggestedModel: string;

  /** Expected cost reduction */
  costReduction: number;

  /** Expected quality impact */
  qualityImpact: 'none' | 'minimal' | 'moderate' | 'significant';

  /** Use cases where downgrade is safe */
  safeUseCases: string[];

  /** Confidence in recommendation */
  confidence: ConfidenceValue;
}

/**
 * Caching opportunity.
 */
export interface CacheOpportunity {
  /** Query pattern that could be cached */
  pattern: string;

  /** Hit rate estimate */
  estimatedHitRate: number;

  /** Cost savings if cached */
  estimatedSavings: number;

  /** Cache duration recommendation */
  recommendedTTL: number;

  /** Confidence in opportunity */
  confidence: ConfidenceValue;
}
```

#### Cost Management Interface

```typescript
/**
 * Cost management system for agents.
 */
export interface CostManagement {
  /**
   * Set a budget for an agent, workflow, or task.
   */
  setBudget(budget: CostBudget): void;

  /**
   * Get current budget status.
   */
  getBudgetStatus(budgetId: string): BudgetStatus;

  /**
   * Track cost for an operation.
   */
  trackCost(operation: Operation, tokenUsage: TokenUsage): void;

  /**
   * Select model based on cost/quality tradeoff.
   */
  selectModel(
    task: Task,
    qualityRequired: number,
    budgetRemaining: number
  ): ModelSelection;

  /**
   * Check if query should be cached.
   */
  shouldCache(query: string, cost: number): boolean;

  /**
   * Get cached result if available.
   */
  getCached(query: string): CachedResult | null;

  /**
   * Get cost profile for analysis.
   */
  getCostProfile(scope: string, period: TimePeriod): CostProfile;

  /**
   * Identify optimization opportunities.
   */
  findOptimizations(traces: CostTrace[]): CostOpportunity[];
}

/**
 * Model selection result.
 */
export interface ModelSelection {
  /** Selected model */
  model: string;

  /** Why this model was selected */
  reason: string;

  /** Expected cost */
  expectedCost: number;

  /** Expected quality */
  expectedQuality: number;

  /** Alternatives considered */
  alternatives: {
    model: string;
    reason_rejected: string;
  }[];
}
```

### Acceptance Criteria

- [ ] Token usage tracked for all LLM operations
- [ ] Cost breakdown available per-stage and per-model
- [ ] Budgets enforced with warning/throttle/block actions
- [ ] Caching opportunities identified from query patterns
- [ ] Model selection considers cost-quality tradeoff
- [ ] Cost profiles enable trend analysis
- [ ] ~200 LOC budget

---

## W3: Human-in-the-Loop (HITL)

**Source**: Part XIX (Gap 3)

### Problem Statement

Agents need to pause for human approval, input, or guidance. How is this modeled?

Production agent systems must:
- Create checkpoints for human review
- Resume from human-approved checkpoints
- Request clarification when uncertain
- Escalate issues appropriately

### Technical Specification

#### Primitives

```typescript
/**
 * tp_hitl_checkpoint: Create checkpoint for human review
 *
 * Pauses agent execution and creates a checkpoint that requires
 * human approval before continuing.
 */
export const tp_hitl_checkpoint: TechniquePrimitive = {
  id: 'tp_hitl_checkpoint',
  name: 'Human Checkpoint',
  description: 'Create a checkpoint requiring human approval',
  inputs: [
    { name: 'context', type: 'AgentContext' },
    { name: 'question', type: 'string' },
    { name: 'options', type: 'Option[]' },
  ],
  outputs: [
    { name: 'checkpointId', type: 'string' },
    { name: 'status', type: 'CheckpointStatus' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Checkpoint creation is deterministic',
  } satisfies DeterministicConfidence,
};

/**
 * tp_hitl_resume: Resume from human-approved checkpoint
 *
 * Resumes agent execution after receiving human input,
 * incorporating the human decision into the agent context.
 */
export const tp_hitl_resume: TechniquePrimitive = {
  id: 'tp_hitl_resume',
  name: 'Resume from Human',
  description: 'Resume agent execution with human-provided input',
  inputs: [
    { name: 'checkpointId', type: 'string' },
    { name: 'humanResponse', type: 'HumanResponse' },
  ],
  outputs: [
    { name: 'resumedContext', type: 'AgentContext' },
    { name: 'decision', type: 'Decision' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Resume from checkpoint is deterministic',
  } satisfies DeterministicConfidence,
};
```

#### Core Interfaces

```typescript
/**
 * Checkpoint state for human review.
 */
export interface HitlCheckpoint {
  /** Unique checkpoint identifier */
  id: string;

  /** Agent that created the checkpoint */
  agentId: string;

  /** Current agent state (serialized for resume) */
  state: SerializedAgentState;

  /** Why the checkpoint was created */
  rationale: string;

  /** Question for the human */
  question: string;

  /** Options presented to the human */
  options: HitlOption[];

  /** Risk level of the pending action */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** Deadline for response (optional) */
  deadline?: Date;

  /** Context for the human to make a decision */
  decisionContext: {
    /** What the agent was trying to do */
    intent: string;

    /** What has been done so far */
    progress: string[];

    /** What will happen based on the decision */
    consequences: Record<string, string>;

    /** Relevant artifacts */
    artifacts: Artifact[];
  };

  /** Status */
  status: 'pending' | 'approved' | 'rejected' | 'timeout' | 'cancelled';

  /** Timestamps */
  createdAt: Date;
  respondedAt?: Date;
}

/**
 * Option presented to human at checkpoint.
 */
export interface HitlOption {
  /** Option identifier */
  id: string;

  /** Display label */
  label: string;

  /** Detailed description */
  description: string;

  /** Recommended or not */
  recommended: boolean;

  /** What will happen if selected */
  consequence: string;
}

/**
 * Human decision at a checkpoint.
 */
export interface HumanDecision {
  /** Checkpoint this decision is for */
  checkpointId: string;

  /** Selected option */
  selectedOption: string;

  /** Human's reasoning (optional but encouraged) */
  reasoning?: string;

  /** Additional input from human */
  additionalInput?: string;

  /** Modifications to agent context */
  contextModifications?: Record<string, unknown>;

  /** Who made the decision */
  decidedBy: {
    userId: string;
    userName?: string;
  };

  /** When decided */
  decidedAt: Date;
}

/**
 * Approval workflow configuration.
 */
export interface ApprovalWorkflow {
  /** Workflow identifier */
  id: string;

  /** What triggers this workflow */
  triggers: ApprovalTrigger[];

  /** Approval chain */
  approvers: Approver[];

  /** Timeout configuration */
  timeout: {
    duration: number;
    action: 'auto_reject' | 'auto_approve' | 'escalate';
  };

  /** Escalation path */
  escalation?: {
    afterTimeout: boolean;
    afterRejection: boolean;
    escalateTo: string;
  };
}

/**
 * What triggers an approval requirement.
 */
export interface ApprovalTrigger {
  /** Trigger type */
  type: 'risk_level' | 'action_type' | 'resource_type' | 'custom';

  /** Trigger condition */
  condition: {
    riskLevel?: 'high' | 'critical';
    actionTypes?: string[];
    resourcePatterns?: string[];
    customPredicate?: string;
  };
}

/**
 * Approver in the approval chain.
 */
export interface Approver {
  /** User or role */
  type: 'user' | 'role';

  /** Identifier */
  id: string;

  /** Required or any-of */
  required: boolean;
}
```

#### Human-in-the-Loop Interface

```typescript
/**
 * Human-in-the-loop integration for agents.
 */
export interface HumanInTheLoop {
  /**
   * Create a checkpoint requiring human response.
   */
  checkpoint(
    reason: CheckpointReason,
    context: AgentContext
  ): Promise<HumanDecision>;

  /**
   * Request approval for a high-stakes action.
   */
  requireApproval(
    action: Action,
    risk: RiskLevel
  ): Promise<boolean>;

  /**
   * Ask human for clarification.
   */
  askClarification(
    question: string,
    options?: string[]
  ): Promise<string>;

  /**
   * Send progress update (non-blocking).
   */
  notifyProgress(update: ProgressUpdate): void;

  /**
   * Escalate an issue to human oversight.
   */
  escalate(
    issue: Issue,
    severity: Severity
  ): Promise<Resolution>;

  /**
   * Configure approval workflow.
   */
  configureWorkflow(workflow: ApprovalWorkflow): void;

  /**
   * Get pending checkpoints.
   */
  getPendingCheckpoints(): HitlCheckpoint[];

  /**
   * Cancel a pending checkpoint.
   */
  cancelCheckpoint(checkpointId: string, reason: string): void;
}

/**
 * Reason for creating a checkpoint.
 */
export type CheckpointReason =
  | { type: 'approval_required'; action: string }
  | { type: 'clarification_needed'; question: string }
  | { type: 'risk_threshold'; riskLevel: RiskLevel }
  | { type: 'scheduled'; description: string }
  | { type: 'error_recovery'; error: Error };

/**
 * Risk level assessment.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Resolution from human escalation.
 */
export interface Resolution {
  /** How was it resolved */
  type: 'continue' | 'abort' | 'modify' | 'defer';

  /** Instructions from human */
  instructions?: string;

  /** Modified context */
  modifiedContext?: Record<string, unknown>;

  /** Who resolved */
  resolvedBy: string;

  /** When resolved */
  resolvedAt: Date;
}
```

### Acceptance Criteria

- [ ] Checkpoints serialize full agent state for resume
- [ ] Options include consequences and recommendations
- [ ] Human decisions include reasoning for audit trail
- [ ] Approval workflows configurable for different risk levels
- [ ] Timeouts handled with configurable actions
- [ ] Escalation paths defined for unresolved checkpoints
- [ ] ~250 LOC budget

---

## W4: Multi-Agent Coordination

**Source**: Part XIX (Gap 4)

### Problem Statement

How do multiple agents share information, coordinate, and avoid conflicts?

Production multi-agent systems must:
- Discover available agents and their capabilities
- Broadcast information to relevant agents
- Coordinate task distribution
- Resolve conflicts when agents disagree

### Technical Specification

#### Primitives

```typescript
/**
 * tp_agent_broadcast: Broadcast information to multiple agents
 *
 * Sends a message to one or more agents, with delivery tracking.
 */
export const tp_agent_broadcast: TechniquePrimitive = {
  id: 'tp_agent_broadcast',
  name: 'Agent Broadcast',
  description: 'Broadcast information to other agents',
  inputs: [
    { name: 'message', type: 'AgentMessage' },
    { name: 'recipients', type: 'AgentId[] | "all"' },
  ],
  outputs: [
    { name: 'delivered', type: 'DeliveryReceipt[]' },
  ],
  confidence: {
    type: 'bounded',
    low: 0.9,
    high: 0.99,
    basis: 'theoretical',
    citation: 'Message delivery depends on agent availability and network',
  } satisfies BoundedConfidence,
};

/**
 * tp_agent_coordinate: Coordinate parallel agent work
 *
 * Distributes tasks among agents based on capabilities and
 * current load, handling conflicts.
 */
export const tp_agent_coordinate: TechniquePrimitive = {
  id: 'tp_agent_coordinate',
  name: 'Agent Coordination',
  description: 'Coordinate task allocation between agents',
  inputs: [
    { name: 'task', type: 'Task' },
    { name: 'agents', type: 'AgentCapability[]' },
  ],
  outputs: [
    { name: 'allocation', type: 'TaskAllocation' },
    { name: 'conflicts', type: 'Conflict[]' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated',
  } satisfies AbsentConfidence,
};
```

#### Core Interfaces

```typescript
/**
 * Message for inter-agent communication.
 */
export interface AgentMessage {
  /** Unique message identifier */
  id: string;

  /** Sender agent */
  from: AgentId;

  /** Recipient(s) */
  to: AgentId[] | 'all';

  /** Message type */
  type: 'info' | 'request' | 'response' | 'alert' | 'finding';

  /** Message payload */
  payload: {
    /** Topic/category */
    topic: string;

    /** Content */
    content: unknown;

    /** Priority */
    priority: 'low' | 'normal' | 'high' | 'urgent';
  };

  /** Correlation ID for request-response */
  correlationId?: string;

  /** Timestamp */
  timestamp: Date;

  /** Time-to-live (optional) */
  ttl?: number;
}

/**
 * Coordination protocol configuration.
 */
export interface CoordinationProtocol {
  /** Protocol identifier */
  id: string;

  /** Protocol type */
  type: 'leader_election' | 'consensus' | 'auction' | 'contract_net';

  /** Task distribution strategy */
  distribution: {
    /** How tasks are allocated */
    strategy: 'round_robin' | 'least_loaded' | 'capability_match' | 'auction';

    /** Load balancing */
    loadBalancing: boolean;

    /** Maximum tasks per agent */
    maxTasksPerAgent?: number;
  };

  /** Result aggregation */
  aggregation: {
    /** How results are combined */
    strategy: 'merge' | 'vote' | 'first' | 'consensus';

    /** Minimum agreement for consensus */
    consensusThreshold?: number;
  };

  /** Conflict resolution */
  conflictResolution: {
    /** How conflicts are resolved */
    strategy: 'priority' | 'vote' | 'arbitrate' | 'merge';

    /** Timeout before escalation */
    timeoutMs: number;

    /** Escalation target */
    escalateTo?: string;
  };
}

/**
 * Agent capability descriptor.
 */
export interface AgentCapability {
  /** Agent identifier */
  agentId: AgentId;

  /** What the agent can do */
  capabilities: string[];

  /** Current load (0-1) */
  currentLoad: number;

  /** Maximum concurrent tasks */
  maxConcurrent: number;

  /** Specializations */
  specializations: string[];

  /** Performance metrics */
  metrics: {
    avgTaskDuration: number;
    successRate: number;
    lastActive: Date;
  };
}

/**
 * Task allocation result.
 */
export interface TaskAllocation {
  /** Task being allocated */
  taskId: string;

  /** Assignments */
  assignments: {
    agentId: AgentId;
    subtaskId?: string;
    role: 'primary' | 'secondary' | 'observer';
  }[];

  /** Coordination requirements */
  coordination: {
    /** Sync points */
    syncPoints: string[];

    /** Communication channels */
    channels: string[];

    /** Deadline */
    deadline?: Date;
  };

  /** Allocation confidence */
  confidence: ConfidenceValue;
}

/**
 * Conflict between agents.
 */
export interface Conflict {
  /** Conflict identifier */
  id: string;

  /** Agents involved */
  agents: AgentId[];

  /** Type of conflict */
  type: 'resource' | 'decision' | 'priority' | 'result';

  /** What they disagree about */
  subject: string;

  /** Each agent's position */
  positions: {
    agentId: AgentId;
    position: unknown;
    confidence: ConfidenceValue;
    reasoning: string;
  }[];

  /** Status */
  status: 'detected' | 'resolving' | 'resolved' | 'escalated';

  /** Resolution (if resolved) */
  resolution?: ConflictResolution;
}

/**
 * Conflict resolution result.
 */
export interface ConflictResolution {
  /** How it was resolved */
  method: 'priority' | 'vote' | 'arbitration' | 'merge' | 'escalation';

  /** Final decision */
  decision: unknown;

  /** Rationale */
  rationale: string;

  /** Dissenting agents (if any) */
  dissenters?: AgentId[];

  /** Resolved by */
  resolvedBy: AgentId | 'system' | 'human';

  /** Timestamp */
  resolvedAt: Date;
}
```

#### Multi-Agent Protocol Interface

```typescript
/**
 * Multi-agent communication and coordination protocol.
 */
export interface MultiAgentProtocol {
  /**
   * Discover available agents.
   */
  discoverAgents(): AgentCapability[];

  /**
   * Send message to specific agent.
   */
  send(to: AgentId, message: AgentMessage): Promise<DeliveryReceipt>;

  /**
   * Broadcast message to multiple agents.
   */
  broadcast(message: AgentMessage): Promise<DeliveryReceipt[]>;

  /**
   * Receive messages (async iterator).
   */
  receive(): AsyncIterable<AgentMessage>;

  /**
   * Acquire lock on a resource.
   */
  acquireLock(resource: ResourceId): Promise<Lock>;

  /**
   * Release a held lock.
   */
  releaseLock(lock: Lock): void;

  /**
   * Publish a finding for other agents.
   */
  publishFinding(finding: Finding): void;

  /**
   * Subscribe to findings on a topic.
   */
  subscribeTo(topic: Topic): AsyncIterable<Finding>;

  /**
   * Report a conflict for resolution.
   */
  reportConflict(conflict: Conflict): void;

  /**
   * Resolve a conflict.
   */
  resolveConflict(conflict: Conflict, resolution: ConflictResolution): void;

  /**
   * Allocate task to agents.
   */
  allocateTask(task: Task, protocol: CoordinationProtocol): Promise<TaskAllocation>;

  /**
   * Aggregate results from multiple agents.
   */
  aggregateResults(
    taskId: string,
    results: AgentResult[],
    protocol: CoordinationProtocol
  ): AggregatedResult;
}

/**
 * Delivery receipt for messages.
 */
export interface DeliveryReceipt {
  /** Message ID */
  messageId: string;

  /** Recipient */
  recipient: AgentId;

  /** Delivery status */
  status: 'delivered' | 'pending' | 'failed';

  /** Timestamp */
  timestamp: Date;

  /** Error (if failed) */
  error?: string;
}

/**
 * Resource lock.
 */
export interface Lock {
  /** Lock ID */
  id: string;

  /** Resource locked */
  resource: ResourceId;

  /** Holder */
  holder: AgentId;

  /** Acquired at */
  acquiredAt: Date;

  /** Expires at */
  expiresAt: Date;
}

/**
 * Finding published by an agent.
 */
export interface Finding {
  /** Finding ID */
  id: string;

  /** Publishing agent */
  publisher: AgentId;

  /** Topic */
  topic: string;

  /** Content */
  content: unknown;

  /** Confidence */
  confidence: ConfidenceValue;

  /** Timestamp */
  timestamp: Date;
}
```

### Acceptance Criteria

- [ ] Agent discovery returns capabilities and current load
- [ ] Messages delivered with receipt confirmation
- [ ] Locks prevent concurrent access to resources
- [ ] Findings shared via pub/sub mechanism
- [ ] Conflicts detected and tracked
- [ ] Resolution strategies implemented (priority, vote, arbitrate)
- [ ] Task allocation considers capabilities and load
- [ ] ~300 LOC budget

---

## W5: Workflow Versioning & Rollback

**Source**: Part XIX (Gap 5)

### Problem Statement

Agent configurations change. How do you version, compare, and rollback?

Production workflow systems must:
- Version workflow configurations
- Compare versions to understand changes
- Rollback to previous versions safely
- A/B test workflow variations

### Technical Specification

#### Primitives

```typescript
/**
 * tp_workflow_version: Version a workflow configuration
 *
 * Creates a versioned snapshot of a workflow configuration,
 * enabling comparison and rollback.
 */
export const tp_workflow_version: TechniquePrimitive = {
  id: 'tp_workflow_version',
  name: 'Workflow Versioning',
  description: 'Version control for agent workflows',
  inputs: [
    { name: 'workflow', type: 'WorkflowConfig' },
  ],
  outputs: [
    { name: 'versionId', type: 'string' },
    { name: 'diff', type: 'WorkflowDiff' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Versioning is deterministic',
  } satisfies DeterministicConfidence,
};

/**
 * tp_workflow_rollback: Rollback to previous workflow version
 *
 * Restores a workflow to a previous version, with safety checks
 * and rollback reporting.
 */
export const tp_workflow_rollback: TechniquePrimitive = {
  id: 'tp_workflow_rollback',
  name: 'Workflow Rollback',
  description: 'Rollback workflow to previous version',
  inputs: [
    { name: 'versionId', type: 'string' },
  ],
  outputs: [
    { name: 'restoredWorkflow', type: 'WorkflowConfig' },
    { name: 'rollbackReport', type: 'RollbackReport' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Rollback is deterministic',
  } satisfies DeterministicConfidence,
};
```

#### Core Interfaces

```typescript
/**
 * Versioned workflow configuration.
 */
export interface WorkflowVersion {
  /** Version identifier */
  versionId: string;

  /** Workflow identifier */
  workflowId: string;

  /** Version number (semantic or incremental) */
  versionNumber: string;

  /** The workflow configuration */
  composition: WorkflowConfig;

  /** Parameters for this version */
  parameters: Record<string, unknown>;

  /** When created */
  timestamp: Date;

  /** Who created it */
  createdBy: string;

  /** Commit message */
  message: string;

  /** Tags */
  tags: string[];

  /** Parent version (for branching) */
  parentVersion?: string;
}

/**
 * Workflow configuration.
 */
export interface WorkflowConfig {
  /** Workflow identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description */
  description: string;

  /** Primitives used */
  primitives: string[];

  /** Operators connecting primitives */
  operators: OperatorConfig[];

  /** Parameters */
  parameters: ParameterConfig[];

  /** Metadata */
  metadata: Record<string, unknown>;
}

/**
 * Diff between workflow versions.
 */
export interface WorkflowDiff {
  /** From version */
  from: string;

  /** To version */
  to: string;

  /** Changes */
  changes: {
    /** Added primitives */
    addedPrimitives: string[];

    /** Removed primitives */
    removedPrimitives: string[];

    /** Changed operators */
    changedOperators: {
      path: string;
      oldValue: unknown;
      newValue: unknown;
    }[];

    /** Changed parameters */
    changedParameters: {
      name: string;
      oldValue: unknown;
      newValue: unknown;
    }[];
  };

  /** Impact assessment */
  impact: {
    /** Breaking changes */
    breaking: boolean;

    /** Affected areas */
    affectedAreas: string[];

    /** Risk level */
    riskLevel: 'low' | 'medium' | 'high';
  };
}

/**
 * Rollback report.
 */
export interface RollbackReport {
  /** Rollback identifier */
  id: string;

  /** From version */
  fromVersion: string;

  /** To version */
  toVersion: string;

  /** Status */
  status: 'success' | 'partial' | 'failed';

  /** What was rolled back */
  rolledBack: {
    primitives: string[];
    operators: string[];
    parameters: string[];
  };

  /** What couldn't be rolled back */
  retained: {
    item: string;
    reason: string;
  }[];

  /** Timestamp */
  timestamp: Date;

  /** Verification results */
  verification: {
    passed: boolean;
    tests: TestResult[];
  };
}

/**
 * Migration between workflow versions.
 */
export interface WorkflowMigration {
  /** Migration identifier */
  id: string;

  /** From version */
  from: string;

  /** To version */
  to: string;

  /** Migration steps */
  steps: MigrationStep[];

  /** State transformation */
  stateTransform?: (oldState: unknown) => unknown;

  /** Is this reversible? */
  reversible: boolean;

  /** Reverse migration (if reversible) */
  reverse?: WorkflowMigration;
}

/**
 * Migration step.
 */
export interface MigrationStep {
  /** Step order */
  order: number;

  /** Description */
  description: string;

  /** Action */
  action: 'add' | 'remove' | 'modify' | 'transform';

  /** Target */
  target: string;

  /** Transformation */
  transform?: (value: unknown) => unknown;
}
```

#### Workflow Version Control Interface

```typescript
/**
 * Version control for agent workflows.
 */
export interface WorkflowVersionControl {
  /**
   * Commit a new version of a workflow.
   */
  commit(workflow: WorkflowConfig, message: string): VersionId;

  /**
   * Tag a version.
   */
  tag(versionId: VersionId, tag: string): void;

  /**
   * Get version history.
   */
  history(workflowId: WorkflowId): WorkflowVersion[];

  /**
   * Get diff between versions.
   */
  diff(versionA: VersionId, versionB: VersionId): WorkflowDiff;

  /**
   * Rollback to a previous version.
   */
  rollback(versionId: VersionId): RollbackReport;

  /**
   * Get a specific version.
   */
  getVersion(versionId: VersionId): WorkflowVersion;

  /**
   * Get latest version.
   */
  getLatest(workflowId: WorkflowId): WorkflowVersion;

  /**
   * Create migration between versions.
   */
  createMigration(from: VersionId, to: VersionId): WorkflowMigration;

  /**
   * Execute migration.
   */
  migrate(migration: WorkflowMigration): MigrationResult;

  /**
   * Set up A/B split between versions.
   */
  split(
    versionA: VersionId,
    versionB: VersionId,
    ratio: number
  ): SplitConfig;

  /**
   * Compare performance between split versions.
   */
  comparePerformance(splitId: SplitId): PerformanceComparison;
}

/**
 * A/B split configuration.
 */
export interface SplitConfig {
  /** Split identifier */
  id: string;

  /** Version A */
  versionA: VersionId;

  /** Version B */
  versionB: VersionId;

  /** Traffic ratio (0-1 for version A) */
  ratio: number;

  /** Metrics to track */
  metrics: string[];

  /** Duration */
  duration: {
    start: Date;
    end?: Date;
  };

  /** Status */
  status: 'active' | 'paused' | 'completed';
}

/**
 * Performance comparison between versions.
 */
export interface PerformanceComparison {
  /** Split ID */
  splitId: string;

  /** Version A metrics */
  versionA: {
    version: VersionId;
    samples: number;
    metrics: Record<string, MetricValue>;
  };

  /** Version B metrics */
  versionB: {
    version: VersionId;
    samples: number;
    metrics: Record<string, MetricValue>;
  };

  /** Statistical significance */
  significance: {
    metric: string;
    pValue: number;
    significant: boolean;
    winner?: 'A' | 'B' | 'tie';
  }[];

  /** Recommendation */
  recommendation: {
    action: 'promote_a' | 'promote_b' | 'continue' | 'stop';
    confidence: ConfidenceValue;
    reasoning: string;
  };
}
```

### Acceptance Criteria

- [ ] Versions store complete workflow configuration
- [ ] Diff shows added/removed/changed elements
- [ ] Rollback verifies success with tests
- [ ] Migrations transform state between versions
- [ ] A/B splits route traffic by ratio
- [ ] Performance comparison includes statistical significance
- [ ] ~200 LOC budget

---

## W6: Agent Observability

**Source**: Part XIX (Gap 6)

### Problem Statement

What is an agent doing RIGHT NOW? How do you debug a stuck agent?

Production agent systems must:
- Observe agent state in real-time
- Stream agent thoughts and actions
- Diagnose problems
- Enable intervention (pause, resume, abort)

### Technical Specification

#### Primitives

```typescript
/**
 * tp_agent_observe: Observe agent behavior in real-time
 *
 * Provides real-time visibility into agent state, current task,
 * progress, and blockers.
 */
export const tp_agent_observe: TechniquePrimitive = {
  id: 'tp_agent_observe',
  name: 'Agent Observation',
  description: 'Observe current agent state and progress',
  inputs: [
    { name: 'agentId', type: 'string' },
  ],
  outputs: [
    { name: 'state', type: 'AgentState' },
    { name: 'currentTask', type: 'Task' },
    { name: 'progress', type: 'Progress' },
    { name: 'blockers', type: 'Blocker[]' },
  ],
  confidence: {
    type: 'bounded',
    low: 0.9,
    high: 0.99,
    basis: 'theoretical',
    citation: 'Observation accuracy depends on instrumentation coverage',
  } satisfies BoundedConfidence,
};

/**
 * tp_agent_diagnose: Diagnose agent problems
 *
 * Analyzes agent symptoms to identify root causes and
 * suggest remediation.
 */
export const tp_agent_diagnose: TechniquePrimitive = {
  id: 'tp_agent_diagnose',
  name: 'Agent Diagnosis',
  description: 'Diagnose why an agent is stuck or failing',
  inputs: [
    { name: 'agentId', type: 'string' },
    { name: 'symptoms', type: 'Symptom[]' },
  ],
  outputs: [
    { name: 'diagnosis', type: 'Diagnosis' },
    { name: 'rootCause', type: 'RootCause' },
    { name: 'remediation', type: 'Remediation[]' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated',
  } satisfies AbsentConfidence,
};
```

#### Core Interfaces

```typescript
/**
 * Real-time observation of agent behavior.
 */
export interface AgentObservation {
  /** Agent being observed */
  agentId: string;

  /** Observation timestamp */
  timestamp: Date;

  /** Current thoughts/reasoning */
  thoughts: string[];

  /** Current action being taken */
  currentAction: {
    type: string;
    target: string;
    startedAt: Date;
    progress: number;
  } | null;

  /** Agent state */
  state: AgentState;

  /** Resource usage */
  resources: {
    tokensUsed: number;
    costIncurred: number;
    timeElapsed: number;
  };

  /** Active context */
  context: {
    taskDescription: string;
    relevantFiles: string[];
    recentDecisions: Decision[];
  };
}

/**
 * Agent state enumeration.
 */
export type AgentState =
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'waiting_for_input'
  | 'waiting_for_approval'
  | 'blocked'
  | 'error'
  | 'completed';

/**
 * Diagnosis of agent problem.
 */
export interface AgentDiagnosis {
  /** Agent diagnosed */
  agentId: string;

  /** Diagnosis timestamp */
  timestamp: Date;

  /** Symptoms observed */
  symptoms: Symptom[];

  /** Primary issue identified */
  primaryIssue: Issue;

  /** Contributing factors */
  contributingFactors: Factor[];

  /** Root cause analysis */
  rootCause: RootCause;

  /** Confidence in diagnosis */
  confidence: ConfidenceValue;

  /** Recommendations */
  recommendations: Recommendation[];

  /** Evidence supporting diagnosis (must reference the Evidence Ledger) */
  evidence: DiagnosticEvidenceItem[];
}

/**
 * Symptom observed in agent behavior.
 */
export interface Symptom {
  /** Symptom type */
  type: 'stuck' | 'slow' | 'looping' | 'error' | 'high_cost' | 'incorrect_output';

  /** Description */
  description: string;

  /** Severity */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** First observed */
  firstObserved: Date;

  /** Frequency */
  frequency: 'once' | 'intermittent' | 'consistent';
}

/**
 * Issue identified in diagnosis.
 */
export interface Issue {
  /** Issue type */
  type: string;

  /** Description */
  description: string;

  /** Impact */
  impact: string;

  /** Urgency */
  urgency: 'immediate' | 'soon' | 'when_convenient';
}

/**
 * Root cause of agent problem.
 */
export interface RootCause {
  /** Category */
  category: 'configuration' | 'resource' | 'logic' | 'external' | 'unknown';

  /** Description */
  description: string;

  /** Evidence ledger entry IDs (`EvidenceEntry.id`) */
  evidenceIds: string[];

  /** Confidence */
  confidence: ConfidenceValue;
}

/**
 * Remediation action.
 */
export interface Remediation {
  /** Action to take */
  action: string;

  /** Type */
  type: 'automatic' | 'manual' | 'requires_approval';

  /** Expected outcome */
  expectedOutcome: string;

  /** Risk */
  risk: 'low' | 'medium' | 'high';

  /** Steps */
  steps: string[];
}

/**
 * Evidence item for diagnosis.
 *
 * IMPORTANT: This is not the canonical Evidence Ledger entry type.
 * When persisted, it MUST reference an evidence ledger entry ID (see `docs/LiBrainian/specs/core/evidence-ledger.md`).
 */
export interface DiagnosticEvidenceItem {
  /** Evidence type */
  type: 'log' | 'metric' | 'trace' | 'state_snapshot';

  /** Source */
  source: string;

  /** Content */
  content: unknown;

  /** Timestamp */
  timestamp: Date;

  /** Evidence ledger entry ID (`EvidenceEntry.id`) if recorded */
  evidenceId?: string;

  /** Relevance to diagnosis */
  relevance: number;
}
```

#### Agent Observability Interface

```typescript
/**
 * Observability system for agents.
 */
export interface AgentObservability {
  /**
   * Get current agent state.
   */
  currentState(agentId: AgentId): AgentState;

  /**
   * Subscribe to agent events (real-time stream).
   */
  subscribe(agentId: AgentId): AsyncIterable<AgentObservation>;

  /**
   * Get agent metrics for a time window.
   */
  getMetrics(agentId: AgentId, window: TimeWindow): AgentMetrics;

  /**
   * Get current call stack (what's the agent doing?).
   */
  getCallStack(agentId: AgentId): CallStack;

  /**
   * Get recent decisions for debugging.
   */
  getRecentDecisions(agentId: AgentId, limit: number): Decision[];

  /**
   * Set up an alert condition.
   */
  setAlert(condition: AlertCondition, handler: AlertHandler): AlertId;

  /**
   * Remove an alert.
   */
  removeAlert(alertId: AlertId): void;

  /**
   * Diagnose agent problems.
   */
  diagnose(agentId: AgentId): AgentDiagnosis;

  /**
   * Pause agent execution.
   */
  pause(agentId: AgentId): void;

  /**
   * Resume agent execution.
   */
  resume(agentId: AgentId): void;

  /**
   * Abort agent execution.
   */
  abort(agentId: AgentId, reason: string): void;

  /**
   * Inject context into agent (for debugging).
   */
  injectContext(agentId: AgentId, context: Record<string, unknown>): void;

  /**
   * Get evidence ledger entries for agent.
   */
  getEvidence(agentId: AgentId, filter?: EvidenceFilter): EvidenceEntry[];
}

/**
 * Agent metrics.
 */
export interface AgentMetrics {
  /** Agent ID */
  agentId: string;

  /** Time window */
  window: TimeWindow;

  /** Task metrics */
  tasks: {
    completed: number;
    failed: number;
    inProgress: number;
    avgDuration: number;
  };

  /** Cost metrics */
  cost: {
    total: number;
    perTask: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };

  /** Quality metrics */
  quality: {
    successRate: number;
    reworkRate: number;
    humanInterventions: number;
  };

  /** Resource metrics */
  resources: {
    tokensUsed: number;
    apiCalls: number;
    cacheHitRate: number;
  };
}

/**
 * Call stack for debugging.
 */
export interface CallStack {
  /** Current operation */
  current: {
    name: string;
    args: unknown;
    startedAt: Date;
  };

  /** Stack frames */
  frames: {
    name: string;
    source: string;
    startedAt: Date;
  }[];
}

/**
 * Alert condition.
 */
export interface AlertCondition {
  /** What to watch */
  metric: string;

  /** Condition */
  condition: 'above' | 'below' | 'equals' | 'changes';

  /** Threshold */
  threshold: number;

  /** Duration before firing */
  duration: number;
}

/**
 * Alert handler.
 */
export type AlertHandler = (alert: Alert) => void;

/**
 * Fired alert.
 */
export interface Alert {
  /** Alert ID */
  id: string;

  /** Condition that fired */
  condition: AlertCondition;

  /** Current value */
  currentValue: number;

  /** Agent affected */
  agentId: string;

  /** Timestamp */
  timestamp: Date;
}
```

### Acceptance Criteria

- [ ] Real-time observation stream available
- [ ] Metrics aggregated over configurable windows
- [ ] Call stack shows current operation chain
- [ ] Alerts fire when conditions met
- [ ] Diagnosis identifies root cause with evidence
- [ ] Intervention (pause/resume/abort) works reliably
- [ ] Evidence integrated with evidence ledger
- [ ] ~250 LOC budget

---

## Compositions

This section defines higher-level compositions that combine the primitives above.

### tc_supervised_execution

Human-supervised agent execution with automatic checkpoints.

```typescript
export const tc_supervised_execution: TechniqueComposition = {
  id: 'tc_supervised_execution',
  name: 'Human-Supervised Agent Execution',
  description: 'Agent execution with automatic human checkpoints for high-risk operations',
  primitives: [
    'tp_agent_observe',
    'tp_hitl_checkpoint',
    'tp_hitl_resume',
    'tp_agent_diagnose',
  ],
  operators: [
    {
      type: 'parallel',
      inputs: ['tp_agent_observe'],
      parameters: { continuous: true },
    },
    {
      type: 'conditional',
      inputs: ['tp_hitl_checkpoint'],
      parameters: { when: 'riskLevel >= high' },
    },
    {
      type: 'fallback',
      inputs: ['tp_agent_diagnose'],
      parameters: { on: 'error' },
    },
  ],
  confidence: {
    type: 'derived',
    value: 0.95,
    formula: 'min(observe.confidence, checkpoint.confidence)',
    inputs: [
      { name: 'observe', value: { type: 'bounded', low: 0.9, high: 0.99, basis: 'theoretical' } },
      { name: 'checkpoint', value: { type: 'deterministic', value: 1.0, reason: 'Checkpoints are deterministic' } },
    ],
  } satisfies DerivedConfidence,
};
```

### tc_cost_aware_execution

Cost-constrained execution with automatic optimization.

```typescript
export const tc_cost_aware_execution: TechniqueComposition = {
  id: 'tc_cost_aware_execution',
  name: 'Cost-Aware Agent Execution',
  description: 'Agent execution with cost tracking, budgets, and optimization',
  primitives: [
    'tp_cost_trace',
    'tp_cost_optimize',
    'tp_agent_observe',
  ],
  operators: [
    {
      type: 'parallel',
      inputs: ['tp_cost_trace', 'tp_agent_observe'],
      parameters: { continuous: true },
    },
    {
      type: 'periodic',
      inputs: ['tp_cost_optimize'],
      parameters: { interval: '5m' },
    },
    {
      type: 'gate',
      inputs: ['budget_check'],
      parameters: { failOn: 'budget_exceeded' },
    },
  ],
  confidence: {
    type: 'derived',
    value: 1.0,
    formula: 'cost_trace.confidence',
    inputs: [
      { name: 'cost_trace', value: { type: 'deterministic', value: 1.0, reason: 'Cost tracking is deterministic' } },
    ],
  } satisfies DerivedConfidence,
};
```

### tc_multi_agent_task

Coordinated multi-agent task execution.

```typescript
export const tc_multi_agent_task: TechniqueComposition = {
  id: 'tc_multi_agent_task',
  name: 'Multi-Agent Task Execution',
  description: 'Coordinated task execution across multiple agents with conflict resolution',
  primitives: [
    'tp_agent_coordinate',
    'tp_agent_broadcast',
    'tp_agent_observe',
    'tp_agent_diagnose',
  ],
  operators: [
    {
      type: 'sequence',
      inputs: ['tp_agent_coordinate', 'execute_distributed'],
      parameters: {},
    },
    {
      type: 'parallel',
      inputs: ['tp_agent_observe', 'tp_agent_broadcast'],
      parameters: { continuous: true },
    },
    {
      type: 'conditional',
      inputs: ['tp_agent_diagnose'],
      parameters: { when: 'conflict_detected' },
    },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated',
  } satisfies AbsentConfidence,
};
```

### tc_recoverable_workflow

Workflow with checkpoint/resume capability for long-running operations.

```typescript
export const tc_recoverable_workflow: TechniqueComposition = {
  id: 'tc_recoverable_workflow',
  name: 'Recoverable Workflow',
  description: 'Long-running workflow with checkpoint/resume and rollback capability',
  primitives: [
    'tp_workflow_version',
    'tp_workflow_rollback',
    'tp_hitl_checkpoint',
    'tp_hitl_resume',
    'tp_agent_observe',
  ],
  operators: [
    {
      type: 'periodic',
      inputs: ['tp_workflow_version'],
      parameters: { interval: 'on_milestone' },
    },
    {
      type: 'parallel',
      inputs: ['tp_agent_observe'],
      parameters: { continuous: true },
    },
    {
      type: 'fallback',
      inputs: ['tp_workflow_rollback'],
      parameters: { on: 'critical_failure' },
    },
    {
      type: 'conditional',
      inputs: ['tp_hitl_checkpoint'],
      parameters: { when: 'milestone_reached' },
    },
  ],
  confidence: {
    type: 'derived',
    value: 1.0,
    formula: 'min(version.confidence, rollback.confidence)',
    inputs: [
      { name: 'version', value: { type: 'deterministic', value: 1.0, reason: 'Versioning is deterministic' } },
      { name: 'rollback', value: { type: 'deterministic', value: 1.0, reason: 'Rollback is deterministic' } },
    ],
  } satisfies DerivedConfidence,
};
```

---

## The Full Agentic Workflow Composition

The complete composition combining all workflow primitives.

```typescript
export const tc_agentic_workflow: TechniqueComposition = {
  id: 'tc_agentic_workflow',
  name: 'Full Agentic Workflow Support',
  description: 'Complete support for agentic development workflows',
  primitives: [
    // Testing (W1)
    'tp_agent_test_trace',
    'tp_agent_eval',
    // Cost (W2)
    'tp_cost_trace',
    'tp_cost_optimize',
    // HITL (W3)
    'tp_hitl_checkpoint',
    'tp_hitl_resume',
    // Multi-agent (W4)
    'tp_agent_broadcast',
    'tp_agent_coordinate',
    // Versioning (W5)
    'tp_workflow_version',
    'tp_workflow_rollback',
    // Observability (W6)
    'tp_agent_observe',
    'tp_agent_diagnose',
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_agent_observe', 'tp_cost_trace'] },
    { type: 'conditional', inputs: ['tp_hitl_checkpoint'], parameters: { when: 'riskLevel > threshold' } },
    { type: 'gate', inputs: ['tp_agent_eval'], parameters: { failOnRegression: true } },
  ],
  patterns: ['pattern_multi_agent_task', 'pattern_self_improvement'],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated',
  } satisfies AbsentConfidence,
};
```

---

## Implementation Dependencies

### Dependency Graph

```
W1 (Agent Testing) ─────────────────────┐
                                        │
W2 (Cost Management) ───────────────────┼──> Foundation Layer
                                        │
W6 (Observability) ─────────────────────┤
                                        │
                                        v
W3 (Human-in-the-Loop) ─────────────────┬──> Control Layer
                                        │
W4 (Multi-Agent Coordination) ──────────┤
                                        │
                                        v
W5 (Workflow Versioning) ───────────────────> Evolution Layer
```

### Feature Dependencies

| Feature | Depends On | Enables |
|---------|-----------|---------|
| **W1** | W6 (for traces) | All compositions (testing gate) |
| **W2** | None | Cost-aware execution |
| **W3** | W6 (for state) | Supervised execution |
| **W4** | W6 (for coordination state) | Multi-agent tasks |
| **W5** | W1 (for regression testing) | Recoverable workflows |
| **W6** | None | W1, W3, W4 |

### Integration with Evidence Ledger

All workflow primitives integrate with the evidence ledger:

| Primitive | Evidence Types |
|-----------|---------------|
| tp_agent_test_trace | trace, assertion |
| tp_agent_eval | score, failure |
| tp_cost_trace | metric |
| tp_hitl_checkpoint | checkpoint, decision |
| tp_agent_coordinate | allocation, conflict |
| tp_workflow_version | version, diff |
| tp_agent_observe | state, metric |
| tp_agent_diagnose | diagnosis, root_cause |

---

## Summary

Track C Agentic Workflow Primitives provide production-grade support for:

1. **W1 (Agent Testing)**: Trace, replay, and evaluate agent behavior
2. **W2 (Cost Management)**: Track, budget, and optimize LLM costs
3. **W3 (Human-in-the-Loop)**: Checkpoint, approve, and guide agent execution
4. **W4 (Multi-Agent Coordination)**: Communicate, coordinate, and resolve conflicts
5. **W5 (Workflow Versioning)**: Version, compare, and rollback workflow configurations
6. **W6 (Agent Observability)**: Observe, diagnose, and intervene in agent execution

**Total estimated LOC**: ~1,500

Without these capabilities, agent systems are "black boxes that will fail unpredictably" (Brooks). With them, agents become production-ready systems that can be tested, monitored, coordinated, and evolved.

---

## The 25 Greats' Verdict

**Armstrong**: "These six gaps - testing, cost, HITL, multi-agent, versioning, observability - are the difference between a demo and a production system. Address them."

**Brooks**: "No silver bullet, but proper workflow support is the closest thing. An agent without observability is a black box that will fail unpredictably."

**Dijkstra**: "Testing agents is harder than testing functions because agents are non-deterministic. The test framework must capture and replay behaviors, not just assert outputs."
