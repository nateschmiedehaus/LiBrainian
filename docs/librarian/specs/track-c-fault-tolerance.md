# Track C: Fault-Tolerant Architecture (FT1-FT8)

> **Extracted from**: `docs/LiBrainian/THEORETICAL_CRITIQUE.md` Part XVII.D
> **Source**: Fault-Tolerant Architecture (Armstrong)
> **Purpose**: Never fail catastrophically - graceful degradation over total failure
>
> **LiBrainian Story**: Chapter 9 (The Resilient Foundation) - When components fail, the system adapts and recovers.
>
> **Armstrong's Verdict**: "Let it crash, but make crash recovery automatic and isolated. A system that can't fail gracefully isn't a system - it's a time bomb."

---

## Executive Summary

This specification defines the fault-tolerant architecture primitives required for production-grade resilience. Without these capabilities, any subsystem failure causes total system failure - an unacceptable outcome for a system that agents depend on.

### Track C Fault Tolerance Features

| Priority | Feature | Part Reference | Est. LOC | Status |
|----------|---------|----------------|----------|--------|
| **FT1** | Supervision Tree | XVII.D.1 | ~200 | Spec Only |
| **FT2** | Failure Categories | XVII.D | ~100 | Spec Only |
| **FT3** | Degradation Policies | XVII.D.2 | ~150 | Spec Only |
| **FT4** | Recovery Strategies | XVII.D | ~200 | Spec Only |
| **FT5** | Health Monitoring | XVII.D | ~150 | Spec Only |
| **FT6** | Fault Tolerance Primitives | XVII.D | ~200 | Spec Only |
| **FT7** | Circuit Breakers | XVII.D | ~150 | Spec Only |
| **FT8** | Failure Forensics | XVII.D | ~100 | Spec Only |

**Total for Fault-Tolerant Architecture: ~1,250 LOC**

---

## Theoretical Foundation

### The Problem

**Current State**: LiBrainian can fail completely if any subsystem fails. No supervision, no isolation, no recovery.

- LLM provider times out: entire query fails
- Storage writes fail: no fallback, no retry
- Network blips: operations abort without retry
- Component crashes: cascade failure to dependent components

**Armstrong's Insight**: Let it crash, but make crash recovery automatic and isolated.

### Why Fault Tolerance Matters for Agents

Agents cannot reason about failures they cannot observe or recover from:

1. **Visibility**: Agents need to know what failed and why
2. **Controllability**: Agents need options for recovery
3. **Predictability**: Failure behavior must be deterministic
4. **Graceful Degradation**: Partial results are better than no results
5. **Evidence**: Failure forensics must feed back into learning

### Erlang/OTP Philosophy

The Erlang approach to fault tolerance is based on:

1. **Let it crash**: Don't try to handle every possible error inline
2. **Supervision trees**: Parent processes monitor and restart children
3. **Isolation**: Failures in one process don't affect others
4. **Restart strategies**: Configurable policies for how to recover
5. **Maximum restart intensity**: Fail fast if restarts aren't working

---

## FT1: Supervision Tree Architecture

**Source**: Part XVII.D.1

### Problem Statement

How do you structure a system so that component failures are isolated and recovery is automatic?

Traditional try/catch blocks:
- Couple error handling to business logic
- Don't provide systematic recovery
- Miss errors at process boundaries
- Can't handle crash loops

### Technical Specification

#### Core Types

```typescript
/**
 * [FAULT_TOLERANCE] Supervision strategy determines restart behavior.
 *
 * Each strategy has different failure propagation semantics:
 * - one_for_one: Surgical, only restart the failed component
 * - one_for_all: Nuclear, restart everything (for tightly coupled components)
 * - rest_for_one: Ordered, restart failed and all started after it
 */
export type SupervisionStrategy =
  | 'one_for_one'    // Restart only the failed child
  | 'one_for_all'    // Restart all children if one fails
  | 'rest_for_one';  // Restart failed child and those started after it

/**
 * [FAULT_TOLERANCE] Restart policy determines worker lifecycle.
 */
export type RestartPolicy =
  | 'permanent'   // Always restart (critical services)
  | 'transient'   // Restart only on abnormal termination
  | 'temporary';  // Never restart (one-shot tasks)

/**
 * [FAULT_TOLERANCE] Supervision tree node - either supervisor or worker.
 */
export interface SupervisionTree {
  root: Supervisor;
  restartStrategy: SupervisionStrategy;
  maxRestarts: number;
  maxTime: number; // ms window for counting restarts
}

/**
 * [FAULT_TOLERANCE] Supervisor manages a collection of children.
 */
export interface Supervisor {
  id: string;
  strategy: SupervisionStrategy;
  maxRestarts: number;
  withinMs: number;
  children: (Supervisor | Worker)[];
  /** Current restart count in the window */
  restartCount: number;
  /** Window start time */
  windowStart: Date;
}

/**
 * [FAULT_TOLERANCE] Worker is a leaf node that performs actual work.
 */
export interface Worker {
  id: string;
  task: () => Promise<void>;
  onFailure: FailureHandler;
  restartPolicy: RestartPolicy;
  state: WorkerState;
}

export type WorkerState =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'restarting';

export type FailureHandler = (failure: Failure) => FailureDecision;

export type FailureDecision =
  | { action: 'restart'; delay?: number }
  | { action: 'stop'; reason: string }
  | { action: 'escalate'; to: string }
  | { action: 'ignore' };
```

#### Supervision Tree Implementation

```typescript
/**
 * tp_supervision_tree: Erlang-style supervision for LiBrainian subsystems.
 *
 * Creates a supervision hierarchy that monitors children and applies
 * restart strategies when failures occur.
 */
export const tp_supervision_tree: TechniquePrimitive = {
  id: 'tp_supervision_tree',
  name: 'Supervision Tree',
  description: 'Erlang-style process supervision with configurable restart strategies',
  inputs: [
    { name: 'config', type: 'SupervisorConfig' },
  ],
  outputs: [
    { name: 'supervisor', type: 'Supervisor' },
    { name: 'healthStatus', type: 'SupervisorHealth' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Supervision tree structure is deterministic; restart behavior follows policy',
  } satisfies DeterministicConfidence,
};

/**
 * The LiBrainian supervision tree.
 *
 * Structure:
 * - librarian_root (one_for_one)
 *   - storage_supervisor (one_for_all) - tightly coupled storage
 *     - sqlite_worker
 *     - cache_worker
 *     - index_worker
 *   - extraction_supervisor (one_for_one)
 *     - parser_pool
 *     - llm_extractor
 *   - retrieval_supervisor (one_for_one)
 *     - semantic_retriever
 *     - graph_retriever
 *   - query_supervisor (one_for_one)
 *     - query_coordinator
 *     - synthesis_worker
 */
export const LIBRARIAN_SUPERVISION_TREE: SupervisorConfig = {
  id: 'librarian_root',
  strategy: 'one_for_one',
  maxRestarts: 3,
  withinMs: 60000,
  children: [
    {
      id: 'storage_supervisor',
      strategy: 'one_for_all',  // Storage must restart together
      maxRestarts: 3,
      withinMs: 30000,
      children: [
        { id: 'sqlite_worker', restartPolicy: 'permanent' },
        { id: 'cache_worker', restartPolicy: 'permanent' },
        { id: 'index_worker', restartPolicy: 'permanent' },
      ],
    },
    {
      id: 'extraction_supervisor',
      strategy: 'one_for_one',
      maxRestarts: 5,
      withinMs: 30000,
      children: [
        { id: 'parser_pool', restartPolicy: 'permanent' },
        { id: 'llm_extractor', restartPolicy: 'transient' },
      ],
    },
    {
      id: 'retrieval_supervisor',
      strategy: 'one_for_one',
      maxRestarts: 3,
      withinMs: 30000,
      children: [
        { id: 'semantic_retriever', restartPolicy: 'permanent' },
        { id: 'graph_retriever', restartPolicy: 'permanent' },
      ],
    },
  ],
};

/**
 * Supervisor interface for managing children.
 */
export interface SupervisorInterface {
  /**
   * Start the supervisor and all children.
   */
  start(): Promise<void>;

  /**
   * Stop the supervisor and all children gracefully.
   */
  stop(): Promise<void>;

  /**
   * Get current health status.
   */
  health(): SupervisorHealth;

  /**
   * Handle a child failure according to strategy.
   */
  handleFailure(childId: string, failure: Failure): Promise<FailureDecision>;

  /**
   * Get restart history for a child.
   */
  getRestartHistory(childId: string): RestartEvent[];
}

/**
 * Supervisor health aggregation.
 */
export interface SupervisorHealth {
  supervisorId: string;
  status: 'healthy' | 'degraded' | 'failing' | 'stopped';
  children: ChildHealth[];
  restartCount: number;
  lastRestart?: Date;
  confidence: ConfidenceValue;
}

export interface ChildHealth {
  id: string;
  type: 'supervisor' | 'worker';
  status: WorkerState;
  restartCount: number;
  lastFailure?: FailureSummary;
}

export interface RestartEvent {
  childId: string;
  timestamp: Date;
  reason: string;
  strategy: SupervisionStrategy;
  attempt: number;
  success: boolean;
}
```

### Acceptance Criteria

- [ ] Supervision tree can be configured declaratively
- [ ] one_for_one restarts only failed child
- [ ] one_for_all restarts all children when one fails
- [ ] rest_for_one restarts failed and subsequent children
- [ ] Restart intensity limits prevent crash loops
- [ ] Supervisor escalates when max restarts exceeded
- [ ] Health status aggregates child health
- [ ] ~200 LOC budget

---

## FT2: Failure Categories

**Source**: Part XVII.D

### Problem Statement

Not all failures are the same. Retry helps some failures but wastes resources on others.

### Technical Specification

```typescript
/**
 * [FAULT_TOLERANCE] Failure category determines recovery strategy.
 *
 * Different failure types require different handling:
 * - Transient: Retry will likely succeed
 * - Permanent: Retry won't help, fail fast
 * - Resource: Need to wait or reduce load
 * - Dependency: External system problem
 * - Corruption: Data integrity issue
 */
export type FailureCategory =
  | 'transient'
  | 'permanent'
  | 'resource_exhaustion'
  | 'dependency'
  | 'corruption';

/**
 * TransientFailure - Retry will likely succeed.
 * Examples: network timeout, temporary rate limit, transient lock
 */
export interface TransientFailure {
  category: 'transient';
  cause: string;
  retryable: true;
  suggestedDelay: number; // ms
  maxRetries: number;
  confidence: ConfidenceValue;
}

/**
 * PermanentFailure - Retry won't help.
 * Examples: invalid input, missing file, authorization denied
 */
export interface PermanentFailure {
  category: 'permanent';
  cause: string;
  retryable: false;
  remediation: string[];
  confidence: ConfidenceValue;
}

/**
 * ResourceExhaustion - Need to wait or reduce load.
 * Examples: out of memory, disk full, connection pool exhausted
 */
export interface ResourceExhaustion {
  category: 'resource_exhaustion';
  resource: string;
  current: number;
  limit: number;
  retryable: boolean;
  backoffStrategy: BackoffStrategy;
  confidence: ConfidenceValue;
}

/**
 * DependencyFailure - External system is down.
 * Examples: LLM provider unavailable, database offline, API unreachable
 */
export interface DependencyFailure {
  category: 'dependency';
  dependency: string;
  lastSuccessful?: Date;
  retryable: boolean;
  fallbackAvailable: boolean;
  fallback?: string;
  confidence: ConfidenceValue;
}

/**
 * CorruptionFailure - Data integrity issue.
 * Examples: checksum mismatch, invalid JSON, schema violation
 */
export interface CorruptionFailure {
  category: 'corruption';
  location: string;
  expected: string;
  actual: string;
  retryable: false;
  recoveryOptions: RecoveryOption[];
  confidence: ConfidenceValue;
}

export type Failure =
  | TransientFailure
  | PermanentFailure
  | ResourceExhaustion
  | DependencyFailure
  | CorruptionFailure;

/**
 * Classify a raw error into a failure category.
 */
export interface FailureClassifier {
  /**
   * Classify an error into a failure category.
   */
  classify(error: Error): Failure;

  /**
   * Register custom classifier for specific error types.
   */
  register(
    errorType: string,
    classifier: (error: Error) => Failure
  ): void;

  /**
   * Get classification confidence.
   */
  getConfidence(error: Error): ConfidenceValue;
}

/**
 * tp_classify_failure: Classify errors into failure categories.
 */
export const tp_classify_failure: TechniquePrimitive = {
  id: 'tp_classify_failure',
  name: 'Failure Classification',
  description: 'Classify errors into actionable failure categories',
  inputs: [
    { name: 'error', type: 'Error' },
    { name: 'context', type: 'FailureContext' },
  ],
  outputs: [
    { name: 'failure', type: 'Failure' },
    { name: 'suggestedAction', type: 'RecoveryAction' },
  ],
  confidence: {
    type: 'bounded',
    low: 0.7,
    high: 0.95,
    basis: 'theoretical',
    citation: 'Classification accuracy depends on error message quality and known patterns',
  } satisfies BoundedConfidence,
};
```

### Acceptance Criteria

- [ ] All failure types have clear recovery semantics
- [ ] Classifier handles common error patterns
- [ ] Custom classifiers can be registered
- [ ] Classification emits evidence for learning
- [ ] ~100 LOC budget

---

## FT3: Degradation Policies

**Source**: Part XVII.D.2

### Problem Statement

When a subsystem fails, what should the system do? Total failure is rarely the right answer.

### Technical Specification

```typescript
/**
 * [FAULT_TOLERANCE] Degradation level from full to offline.
 */
export type DegradationLevel =
  | 'full'      // All features available
  | 'reduced'   // Core features only
  | 'minimal'   // Read-only operations
  | 'offline';  // Cached data only

/**
 * [FAULT_TOLERANCE] Degradation policy for a component.
 */
export interface DegradationPolicy {
  component: string;
  levels: DegradationLevelConfig[];
  currentLevel: DegradationLevel;
  escalationThreshold: number; // failures before escalating
}

export interface DegradationLevelConfig {
  level: DegradationLevel;
  description: string;
  capabilities: string[];         // What's available at this level
  disabledCapabilities: string[]; // What's disabled at this level
  transitionConditions: TransitionCondition[];
}

export interface TransitionCondition {
  from: DegradationLevel;
  to: DegradationLevel;
  trigger: DegradationTrigger;
}

export type DegradationTrigger =
  | { type: 'failure_count'; threshold: number; window: number }
  | { type: 'latency'; threshold: number; percentile: number }
  | { type: 'error_rate'; threshold: number; window: number }
  | { type: 'dependency_down'; dependency: string }
  | { type: 'resource_exhausted'; resource: string }
  | { type: 'manual'; reason: string };

/**
 * Degraded behavior options.
 */
export type DegradedBehavior =
  | { type: 'return_cached'; maxAge: number }
  | { type: 'return_partial'; omit: string[] }
  | { type: 'return_error'; message: string }
  | { type: 'fallback_subsystem'; target: string }
  | { type: 'queue_for_retry'; timeout: number };

/**
 * LiBrainian degradation policies.
 */
export const LIBRARIAN_DEGRADATION_POLICIES: DegradationPolicy[] = [
  {
    component: 'semantic_retriever',
    currentLevel: 'full',
    escalationThreshold: 3,
    levels: [
      {
        level: 'full',
        description: 'Full semantic search with embeddings',
        capabilities: ['semantic_search', 'similarity_ranking', 'context_expansion'],
        disabledCapabilities: [],
        transitionConditions: [
          { from: 'full', to: 'reduced', trigger: { type: 'failure_count', threshold: 3, window: 60000 } },
        ],
      },
      {
        level: 'reduced',
        description: 'Keyword search fallback',
        capabilities: ['keyword_search', 'basic_ranking'],
        disabledCapabilities: ['semantic_search', 'similarity_ranking', 'context_expansion'],
        transitionConditions: [
          { from: 'reduced', to: 'minimal', trigger: { type: 'failure_count', threshold: 5, window: 60000 } },
          { from: 'reduced', to: 'full', trigger: { type: 'failure_count', threshold: 0, window: 60000 } },
        ],
      },
      {
        level: 'minimal',
        description: 'Cached results only',
        capabilities: ['cached_search'],
        disabledCapabilities: ['keyword_search', 'semantic_search', 'similarity_ranking', 'context_expansion'],
        transitionConditions: [
          { from: 'minimal', to: 'offline', trigger: { type: 'failure_count', threshold: 3, window: 30000 } },
        ],
      },
      {
        level: 'offline',
        description: 'No search available',
        capabilities: [],
        disabledCapabilities: ['*'],
        transitionConditions: [],
      },
    ],
  },
  {
    component: 'llm_extractor',
    currentLevel: 'full',
    escalationThreshold: 3,
    levels: [
      {
        level: 'full',
        description: 'Full LLM extraction',
        capabilities: ['extract_purpose', 'extract_summary', 'extract_relationships'],
        disabledCapabilities: [],
        transitionConditions: [
          { from: 'full', to: 'reduced', trigger: { type: 'dependency_down', dependency: 'llm_provider' } },
        ],
      },
      {
        level: 'reduced',
        description: 'AST extraction only',
        capabilities: ['extract_structure', 'extract_signatures'],
        disabledCapabilities: ['extract_purpose', 'extract_summary', 'extract_relationships'],
        transitionConditions: [],
      },
    ],
  },
];

/**
 * tp_degrade_gracefully: Trigger graceful degradation.
 */
export const tp_degrade_gracefully: TechniquePrimitive = {
  id: 'tp_degrade_gracefully',
  name: 'Graceful Degradation',
  description: 'Transition component to degraded state with explicit disclosure',
  inputs: [
    { name: 'component', type: 'string' },
    { name: 'trigger', type: 'DegradationTrigger' },
  ],
  outputs: [
    { name: 'previousLevel', type: 'DegradationLevel' },
    { name: 'newLevel', type: 'DegradationLevel' },
    { name: 'disclosure', type: 'DegradationDisclosure' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Degradation transitions follow deterministic policy rules',
  } satisfies DeterministicConfidence,
};

/**
 * Disclosure emitted when degradation occurs.
 */
export interface DegradationDisclosure {
  component: string;
  previousLevel: DegradationLevel;
  newLevel: DegradationLevel;
  trigger: DegradationTrigger;
  timestamp: Date;
  lostCapabilities: string[];
  remainingCapabilities: string[];
  estimatedRecoveryTime?: number;
  remediation?: string[];
}

/**
 * Degradation manager interface.
 */
export interface DegradationManager {
  /**
   * Get current degradation level for a component.
   */
  getLevel(component: string): DegradationLevel;

  /**
   * Trigger degradation transition.
   */
  degrade(component: string, trigger: DegradationTrigger): DegradationDisclosure;

  /**
   * Attempt to restore a component to a higher level.
   */
  restore(component: string): RestoreResult;

  /**
   * Check if a capability is available at current degradation level.
   */
  hasCapability(component: string, capability: string): boolean;

  /**
   * Subscribe to degradation events.
   */
  subscribe(handler: (disclosure: DegradationDisclosure) => void): void;
}
```

### Acceptance Criteria

- [ ] Degradation levels are clearly defined per component
- [ ] Transitions follow explicit trigger conditions
- [ ] Disclosure is emitted for every degradation
- [ ] Capabilities are gated by current level
- [ ] Restoration path exists for recovery
- [ ] ~150 LOC budget

---

## FT4: Recovery Strategies

**Source**: Part XVII.D

### Problem Statement

Different failures require different recovery strategies. One-size-fits-all retry is insufficient.

### Technical Specification

```typescript
/**
 * [FAULT_TOLERANCE] Recovery strategy types.
 */
export type RecoveryStrategy =
  | RetryWithBackoff
  | CircuitBreaker
  | Fallback
  | Checkpoint
  | Rebuild;

/**
 * RetryWithBackoff - Exponential backoff with jitter.
 */
export interface RetryWithBackoff {
  type: 'retry_with_backoff';
  initialDelay: number;      // ms
  maxDelay: number;          // ms
  multiplier: number;        // e.g., 2 for exponential
  jitter: number;            // 0-1, randomness factor
  maxAttempts: number;
  retryOn: FailureCategory[]; // Which failure types to retry
}

/**
 * CircuitBreaker - Stop trying after threshold.
 */
export interface CircuitBreaker {
  type: 'circuit_breaker';
  failureThreshold: number;  // Failures before opening
  successThreshold: number;  // Successes before closing
  timeout: number;           // ms before half-open
  state: CircuitBreakerState;
}

export type CircuitBreakerState =
  | 'closed'      // Normal operation
  | 'open'        // Failing fast
  | 'half_open';  // Testing recovery

/**
 * Fallback - Use alternative implementation.
 */
export interface Fallback {
  type: 'fallback';
  primary: string;           // Primary implementation
  fallbacks: string[];       // Fallback implementations in priority order
  condition: FailureCategory[];
}

/**
 * Checkpoint - Resume from last good state.
 */
export interface Checkpoint {
  type: 'checkpoint';
  checkpointId: string;
  stateDigest: string;
  createdAt: Date;
  validUntil?: Date;
}

/**
 * Rebuild - Reconstruct from source data.
 */
export interface Rebuild {
  type: 'rebuild';
  source: string;            // Where to rebuild from
  estimatedTime: number;     // ms
  dependencies: string[];    // What must be available
}

/**
 * Backoff strategy for retries.
 */
export interface BackoffStrategy {
  type: 'exponential' | 'linear' | 'constant' | 'fibonacci';
  initialDelay: number;
  maxDelay: number;
  jitter: boolean;
}

/**
 * tp_recover_component: Attempt component recovery.
 */
export const tp_recover_component: TechniquePrimitive = {
  id: 'tp_recover_component',
  name: 'Component Recovery',
  description: 'Attempt to recover a failed component using configured strategy',
  inputs: [
    { name: 'componentId', type: 'string' },
    { name: 'failure', type: 'Failure' },
    { name: 'strategy', type: 'RecoveryStrategy' },
  ],
  outputs: [
    { name: 'recovered', type: 'boolean' },
    { name: 'attempts', type: 'number' },
    { name: 'finalState', type: 'ComponentState' },
  ],
  confidence: {
    type: 'bounded',
    low: 0.5,
    high: 0.95,
    basis: 'theoretical',
    citation: 'Recovery success depends on failure type and strategy appropriateness',
  } satisfies BoundedConfidence,
};

/**
 * Recovery executor interface.
 */
export interface RecoveryExecutor {
  /**
   * Execute a recovery strategy.
   */
  execute<T>(
    operation: () => Promise<T>,
    strategy: RecoveryStrategy,
    context: RecoveryContext
  ): Promise<RecoveryResult<T>>;

  /**
   * Get recommended strategy for a failure type.
   */
  recommendStrategy(failure: Failure): RecoveryStrategy;

  /**
   * Record recovery outcome for learning.
   */
  recordOutcome(
    strategy: RecoveryStrategy,
    failure: Failure,
    result: RecoveryResult<unknown>
  ): void;
}

export interface RecoveryContext {
  componentId: string;
  operation: string;
  attempt: number;
  startTime: Date;
  previousAttempts: RecoveryAttempt[];
}

export interface RecoveryAttempt {
  attempt: number;
  strategy: RecoveryStrategy;
  startTime: Date;
  endTime: Date;
  success: boolean;
  error?: string;
}

export interface RecoveryResult<T> {
  success: boolean;
  value?: T;
  attempts: number;
  totalTime: number;
  finalStrategy: RecoveryStrategy;
  error?: Failure;
  confidence: ConfidenceValue;
}
```

### Acceptance Criteria

- [ ] Multiple recovery strategies available
- [ ] Strategies can be composed
- [ ] Backoff with jitter prevents thundering herd
- [ ] Circuit breaker prevents cascade failure
- [ ] Fallback provides alternative paths
- [ ] Checkpoint enables resume from last good state
- [ ] Recovery outcomes recorded for learning
- [ ] ~200 LOC budget

---

## FT5: Health Monitoring

**Source**: Part XVII.D

### Problem Statement

You can't fix what you can't see. Proactive health monitoring enables preemptive action.

### Technical Specification

```typescript
/**
 * [FAULT_TOLERANCE] Component health status.
 */
export interface ComponentHealth {
  componentId: string;
  status: HealthStatus;
  lastCheck: Date;
  nextCheck: Date;
  metrics: HealthMetrics;
  dependencies: DependencyHealth[];
  confidence: ConfidenceValue;
}

export type HealthStatus =
  | 'healthy'       // All checks passing
  | 'degraded'      // Some checks failing
  | 'unhealthy'     // Critical checks failing
  | 'unknown';      // No recent check

export interface HealthMetrics {
  /** Success rate over window */
  successRate: number;
  /** Average latency (ms) */
  avgLatency: number;
  /** P99 latency (ms) */
  p99Latency: number;
  /** Error rate over window */
  errorRate: number;
  /** Current queue depth (if applicable) */
  queueDepth?: number;
  /** Memory usage (bytes) */
  memoryUsage?: number;
  /** Active connections */
  activeConnections?: number;
}

export interface DependencyHealth {
  dependencyId: string;
  status: HealthStatus;
  latency?: number;
  lastSuccess?: Date;
}

/**
 * Health check definition.
 */
export interface HealthCheck {
  id: string;
  name: string;
  description: string;
  check: () => Promise<HealthCheckResult>;
  interval: number;     // ms between checks
  timeout: number;      // ms before check times out
  critical: boolean;    // If true, failure = unhealthy
}

export interface HealthCheckResult {
  passed: boolean;
  message: string;
  metrics?: Record<string, number>;
  duration: number;
}

/**
 * tp_health_check: Check component health.
 */
export const tp_health_check: TechniquePrimitive = {
  id: 'tp_health_check',
  name: 'Health Check',
  description: 'Check health of a component and its dependencies',
  inputs: [
    { name: 'componentId', type: 'string' },
    { name: 'checks', type: 'HealthCheck[]' },
  ],
  outputs: [
    { name: 'health', type: 'ComponentHealth' },
    { name: 'alerts', type: 'HealthAlert[]' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Health checks are deterministic given component state',
  } satisfies DeterministicConfidence,
};

/**
 * Health monitor interface.
 */
export interface HealthMonitor {
  /**
   * Register a health check.
   */
  register(check: HealthCheck): void;

  /**
   * Get current health status.
   */
  getHealth(componentId: string): ComponentHealth;

  /**
   * Get aggregate system health.
   */
  getSystemHealth(): SystemHealth;

  /**
   * Run all checks immediately.
   */
  checkNow(): Promise<ComponentHealth[]>;

  /**
   * Subscribe to health changes.
   */
  subscribe(
    componentId: string,
    handler: (health: ComponentHealth) => void
  ): void;

  /**
   * Set alert thresholds.
   */
  setThresholds(thresholds: HealthThresholds): void;
}

export interface SystemHealth {
  status: HealthStatus;
  components: ComponentHealth[];
  degradedComponents: string[];
  unhealthyComponents: string[];
  overallConfidence: ConfidenceValue;
}

export interface HealthThresholds {
  /** Latency threshold for degraded (ms) */
  latencyDegradedMs: number;
  /** Latency threshold for unhealthy (ms) */
  latencyUnhealthyMs: number;
  /** Error rate threshold for degraded */
  errorRateDegraded: number;
  /** Error rate threshold for unhealthy */
  errorRateUnhealthy: number;
}

export interface HealthAlert {
  componentId: string;
  type: 'degraded' | 'unhealthy' | 'recovered';
  message: string;
  timestamp: Date;
  metrics: HealthMetrics;
  suggestedAction?: string;
}
```

### Acceptance Criteria

- [ ] Health checks run on configurable intervals
- [ ] Dependency health is aggregated
- [ ] Alerts trigger on threshold breach
- [ ] Proactive degradation before failure
- [ ] Health history is available for analysis
- [ ] ~150 LOC budget

---

## FT6: Fault Tolerance Primitives

**Source**: Part XVII.D

### Problem Statement

Fault tolerance needs to be composable with other primitives and techniques.

### Technical Specification

```typescript
/**
 * tp_isolate_failure: Isolate a failing component.
 *
 * Prevents failure propagation by isolating the component
 * and redirecting traffic to healthy alternatives.
 */
export const tp_isolate_failure: TechniquePrimitive = {
  id: 'tp_isolate_failure',
  name: 'Failure Isolation',
  description: 'Isolate failing component to prevent cascade failure',
  inputs: [
    { name: 'componentId', type: 'string' },
    { name: 'failure', type: 'Failure' },
  ],
  outputs: [
    { name: 'isolated', type: 'boolean' },
    { name: 'redirectedTo', type: 'string | null' },
    { name: 'affectedOperations', type: 'string[]' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Isolation is a deterministic operation',
  } satisfies DeterministicConfidence,
};

/**
 * tp_bulkhead: Apply bulkhead pattern.
 *
 * Limits concurrent operations to prevent resource exhaustion
 * and contain failures to specific partitions.
 */
export const tp_bulkhead: TechniquePrimitive = {
  id: 'tp_bulkhead',
  name: 'Bulkhead Pattern',
  description: 'Limit concurrent operations to isolate failures',
  inputs: [
    { name: 'partition', type: 'string' },
    { name: 'maxConcurrent', type: 'number' },
  ],
  outputs: [
    { name: 'acquired', type: 'boolean' },
    { name: 'queuePosition', type: 'number | null' },
    { name: 'waitTime', type: 'number | null' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Bulkhead admission is deterministic',
  } satisfies DeterministicConfidence,
};

/**
 * tp_timeout: Apply timeout with fallback.
 *
 * Ensures operations complete within a time budget
 * or fail fast with appropriate handling.
 */
export const tp_timeout: TechniquePrimitive = {
  id: 'tp_timeout',
  name: 'Timeout',
  description: 'Apply timeout to operation with fallback',
  inputs: [
    { name: 'operation', type: 'string' },
    { name: 'timeout', type: 'number' },
    { name: 'fallback', type: 'FallbackConfig | null' },
  ],
  outputs: [
    { name: 'completed', type: 'boolean' },
    { name: 'timedOut', type: 'boolean' },
    { name: 'usedFallback', type: 'boolean' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Timeout behavior is deterministic',
  } satisfies DeterministicConfidence,
};

/**
 * tp_rate_limit: Apply rate limiting.
 *
 * Prevents overload by limiting request rate.
 */
export const tp_rate_limit: TechniquePrimitive = {
  id: 'tp_rate_limit',
  name: 'Rate Limiting',
  description: 'Limit request rate to prevent overload',
  inputs: [
    { name: 'bucket', type: 'string' },
    { name: 'limit', type: 'RateLimitConfig' },
  ],
  outputs: [
    { name: 'allowed', type: 'boolean' },
    { name: 'retryAfter', type: 'number | null' },
    { name: 'remaining', type: 'number' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Rate limiting is deterministic',
  } satisfies DeterministicConfidence,
};

/**
 * Rate limit configuration.
 */
export interface RateLimitConfig {
  /** Requests allowed per window */
  limit: number;
  /** Window duration (ms) */
  window: number;
  /** Burst allowance above limit */
  burst?: number;
  /** What to do when limited */
  onLimited: 'reject' | 'queue' | 'degrade';
}

/**
 * Bulkhead configuration.
 */
export interface BulkheadConfig {
  /** Maximum concurrent operations */
  maxConcurrent: number;
  /** Maximum queue size */
  maxQueue: number;
  /** Queue timeout (ms) */
  queueTimeout: number;
}

/**
 * Fallback configuration.
 */
export interface FallbackConfig {
  /** Fallback operation */
  operation: string;
  /** When to use fallback */
  trigger: 'timeout' | 'error' | 'always';
  /** Maximum fallback attempts */
  maxAttempts: number;
}
```

### Acceptance Criteria

- [ ] Isolation prevents cascade failures
- [ ] Bulkhead limits concurrent operations
- [ ] Timeout ensures operations complete in budget
- [ ] Rate limiting prevents overload
- [ ] All primitives are composable
- [ ] ~200 LOC budget

---

## FT7: Circuit Breakers

**Source**: Part XVII.D

### Problem Statement

Continuously retrying a failing service wastes resources and delays recovery.

### Technical Specification

```typescript
/**
 * [FAULT_TOLERANCE] Circuit breaker for service protection.
 */
export interface CircuitBreakerConfig {
  /** Identifier for this breaker */
  id: string;
  /** Service being protected */
  service: string;
  /** Failures before opening */
  failureThreshold: number;
  /** Successes before closing (when half-open) */
  successThreshold: number;
  /** Time before testing recovery (ms) */
  resetTimeout: number;
  /** Failure categories to track */
  trackedFailures: FailureCategory[];
}

/**
 * Circuit breaker instance.
 */
export interface CircuitBreakerInstance {
  /** Current state */
  state: CircuitBreakerState;
  /** Failure count in current window */
  failureCount: number;
  /** Success count in half-open state */
  successCount: number;
  /** Last state transition time */
  lastTransition: Date;
  /** Time until next state check */
  nextCheck?: Date;
}

/**
 * Circuit breaker manager.
 */
export interface CircuitBreakerManager {
  /**
   * Create a circuit breaker for a service.
   */
  create(config: CircuitBreakerConfig): CircuitBreakerInstance;

  /**
   * Execute operation through circuit breaker.
   */
  execute<T>(
    breakerId: string,
    operation: () => Promise<T>
  ): Promise<CircuitBreakerResult<T>>;

  /**
   * Record a success (for manual tracking).
   */
  recordSuccess(breakerId: string): void;

  /**
   * Record a failure (for manual tracking).
   */
  recordFailure(breakerId: string, failure: Failure): void;

  /**
   * Force breaker to specific state (admin).
   */
  forceState(breakerId: string, state: CircuitBreakerState): void;

  /**
   * Get all breaker statuses.
   */
  getAllStatuses(): CircuitBreakerStatus[];
}

export interface CircuitBreakerResult<T> {
  success: boolean;
  value?: T;
  blocked: boolean;  // Was operation blocked by open breaker?
  state: CircuitBreakerState;
  failure?: Failure;
}

export interface CircuitBreakerStatus {
  id: string;
  service: string;
  state: CircuitBreakerState;
  failureCount: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  transitionHistory: StateTransition[];
}

export interface StateTransition {
  from: CircuitBreakerState;
  to: CircuitBreakerState;
  timestamp: Date;
  reason: string;
}

/**
 * tp_circuit_breaker: Apply circuit breaker pattern.
 */
export const tp_circuit_breaker: TechniquePrimitive = {
  id: 'tp_circuit_breaker',
  name: 'Circuit Breaker',
  description: 'Protect services from cascade failure with circuit breaker',
  inputs: [
    { name: 'service', type: 'string' },
    { name: 'config', type: 'CircuitBreakerConfig' },
  ],
  outputs: [
    { name: 'state', type: 'CircuitBreakerState' },
    { name: 'blocked', type: 'boolean' },
    { name: 'metrics', type: 'CircuitBreakerMetrics' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'Circuit breaker state machine is deterministic',
  } satisfies DeterministicConfidence,
};

export interface CircuitBreakerMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  blockedRequests: number;
  timeInOpen: number;
  timeInClosed: number;
  transitionCount: number;
}
```

### Acceptance Criteria

- [ ] Circuit opens after failure threshold
- [ ] Circuit tests recovery in half-open state
- [ ] Circuit closes after success threshold
- [ ] Blocked requests fail fast
- [ ] State transitions are logged
- [ ] Metrics available for analysis
- [ ] ~150 LOC budget

---

## FT8: Failure Forensics

**Source**: Part XVII.D

### Problem Statement

Learning from failures requires understanding root causes, not just symptoms.

### Technical Specification

```typescript
/**
 * [FAULT_TOLERANCE] Failure forensics for post-mortem analysis.
 */
export interface FailureForensics {
  /** Failure identifier */
  id: string;
  /** When the failure occurred */
  timestamp: Date;
  /** Component that failed */
  component: string;
  /** Failure classification */
  failure: Failure;
  /** Root cause analysis */
  rootCause: RootCauseAnalysis;
  /** Contributing factors */
  contributingFactors: ContributingFactor[];
  /** Recovery actions taken */
  recoveryActions: RecoveryActionRecord[];
  /** Time to recovery (ms) */
  timeToRecovery?: number;
  /** Lessons learned */
  lessons: Lesson[];
}

export interface RootCauseAnalysis {
  /** Primary cause */
  cause: string;
  /** Confidence in this analysis */
  confidence: ConfidenceValue;
  /** Evidence supporting this analysis */
  evidence: EvidenceRef[];
  /** Alternative hypotheses considered */
  alternativeHypotheses: Hypothesis[];
}

export interface Hypothesis {
  cause: string;
  likelihood: number;
  ruledOutBy?: string;
}

export interface ContributingFactor {
  factor: string;
  severity: 'critical' | 'major' | 'minor';
  mitigated: boolean;
  mitigation?: string;
}

export interface RecoveryActionRecord {
  action: string;
  timestamp: Date;
  success: boolean;
  duration: number;
  notes?: string;
}

export interface Lesson {
  type: 'prevention' | 'detection' | 'recovery';
  description: string;
  actionItems: ActionItem[];
  priority: 'high' | 'medium' | 'low';
}

export interface ActionItem {
  description: string;
  owner?: string;
  dueDate?: Date;
  completed: boolean;
}

/**
 * Forensic analyzer interface.
 */
export interface ForensicAnalyzer {
  /**
   * Analyze a failure for root cause.
   */
  analyze(
    failure: Failure,
    context: FailureContext
  ): Promise<FailureForensics>;

  /**
   * Get failure patterns over time.
   */
  getPatterns(
    component: string,
    timeWindow: TimeWindow
  ): FailurePattern[];

  /**
   * Generate incident report.
   */
  generateReport(
    forensics: FailureForensics,
    format: 'markdown' | 'json'
  ): string;

  /**
   * Link to evidence ledger entries.
   */
  linkEvidence(
    forensicsId: string,
    evidenceRefs: EvidenceRef[]
  ): void;
}

export interface FailureContext {
  /** Recent events leading to failure */
  recentEvents: LedgerEntry[];
  /** System state at failure time */
  systemState: SystemState;
  /** Active operations at failure time */
  activeOperations: Operation[];
  /** Resource levels at failure time */
  resourceLevels: ResourceLevels;
}

export interface FailurePattern {
  pattern: string;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  components: string[];
  severity: 'critical' | 'major' | 'minor';
  trend: 'increasing' | 'decreasing' | 'stable';
}

/**
 * Integration with Evidence Ledger.
 */
export interface EvidenceRef {
  ledgerEntryId: string;
  relevance: string;
  strength: 'strong' | 'moderate' | 'weak';
}
```

### Acceptance Criteria

- [ ] Root cause analysis with confidence
- [ ] Contributing factors identified
- [ ] Recovery actions recorded
- [ ] Patterns detected over time
- [ ] Integration with evidence ledger
- [ ] ~100 LOC budget

---

## Compositions

This section defines higher-level compositions that combine the fault tolerance primitives.

### tc_resilient_operation

Wrap any operation with fault tolerance.

```typescript
export const tc_resilient_operation: TechniqueComposition = {
  id: 'tc_resilient_operation',
  name: 'Resilient Operation',
  description: 'Wrap operation with timeout, retry, circuit breaker, and fallback',
  primitives: [
    'tp_timeout',
    'tp_circuit_breaker',
    'tp_recover_component',
    'tp_classify_failure',
    'tp_health_check',
  ],
  operators: [
    {
      type: 'sequence',
      inputs: ['tp_circuit_breaker', 'tp_timeout', 'operation'],
      parameters: {},
    },
    {
      type: 'fallback',
      inputs: ['tp_recover_component'],
      parameters: { on: 'error' },
    },
    {
      type: 'parallel',
      inputs: ['tp_health_check'],
      parameters: { continuous: true },
    },
  ],
  confidence: {
    type: 'derived',
    value: 0.9,
    formula: 'min(circuit_breaker.confidence, timeout.confidence) * recovery_factor',
    inputs: [
      { name: 'circuit_breaker', value: { type: 'deterministic', value: 1.0, reason: 'Deterministic state machine' } },
      { name: 'timeout', value: { type: 'deterministic', value: 1.0, reason: 'Deterministic timeout' } },
    ],
  } satisfies DerivedConfidence,
};
```

### tc_supervised_subsystem

Subsystem with full supervision.

```typescript
export const tc_supervised_subsystem: TechniqueComposition = {
  id: 'tc_supervised_subsystem',
  name: 'Supervised Subsystem',
  description: 'Subsystem with supervision tree, health monitoring, and graceful degradation',
  primitives: [
    'tp_supervision_tree',
    'tp_health_check',
    'tp_degrade_gracefully',
    'tp_isolate_failure',
    'tp_recover_component',
  ],
  operators: [
    {
      type: 'parallel',
      inputs: ['tp_supervision_tree', 'tp_health_check'],
      parameters: { continuous: true },
    },
    {
      type: 'conditional',
      inputs: ['tp_degrade_gracefully'],
      parameters: { when: 'health.status == degraded' },
    },
    {
      type: 'conditional',
      inputs: ['tp_isolate_failure'],
      parameters: { when: 'health.status == unhealthy' },
    },
    {
      type: 'fallback',
      inputs: ['tp_recover_component'],
      parameters: { on: 'isolation' },
    },
  ],
  confidence: {
    type: 'derived',
    value: 0.95,
    formula: 'min(supervision.confidence, health_check.confidence)',
    inputs: [
      { name: 'supervision', value: { type: 'deterministic', value: 1.0, reason: 'Supervision is deterministic' } },
      { name: 'health_check', value: { type: 'deterministic', value: 1.0, reason: 'Health checks are deterministic' } },
    ],
  } satisfies DerivedConfidence,
};
```

### tc_self_healing_pipeline

Pipeline that detects and recovers from failures automatically.

```typescript
export const tc_self_healing_pipeline: TechniqueComposition = {
  id: 'tc_self_healing_pipeline',
  name: 'Self-Healing Pipeline',
  description: 'Pipeline with automatic failure detection, classification, and recovery',
  primitives: [
    'tp_health_check',
    'tp_classify_failure',
    'tp_circuit_breaker',
    'tp_recover_component',
    'tp_degrade_gracefully',
  ],
  operators: [
    {
      type: 'parallel',
      inputs: ['tp_health_check'],
      parameters: { interval: 5000, continuous: true },
    },
    {
      type: 'conditional',
      inputs: ['tp_classify_failure'],
      parameters: { when: 'failure_detected' },
    },
    {
      type: 'branch',
      inputs: ['tp_circuit_breaker', 'tp_recover_component', 'tp_degrade_gracefully'],
      parameters: {
        condition: 'failure.category',
        mapping: {
          transient: 'tp_recover_component',
          permanent: 'tp_degrade_gracefully',
          resource_exhaustion: 'tp_circuit_breaker',
          dependency: 'tp_circuit_breaker',
          corruption: 'tp_degrade_gracefully',
        },
      },
    },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated',
  } satisfies AbsentConfidence,
};
```

---

## Integration Points

### Integration with layer2-infrastructure.md

The fault tolerance system integrates with Layer 2 Infrastructure:

| Fault Tolerance Feature | Layer 2 Integration |
|------------------------|---------------------|
| Health events | Evidence Ledger records all health status changes |
| Failure classification | Per-Stage Diagnostics (P22) |
| Circuit breaker state | Provider Discovery graceful degradation |
| Recovery actions | Capability Negotiation fallback handling |

### Integration with track-c-agentic-workflows.md

The fault tolerance system enables workflow recovery:

| Fault Tolerance Feature | Agentic Workflow Integration |
|------------------------|------------------------------|
| Checkpoints | W5 Workflow Versioning - resume from checkpoint |
| Degradation disclosure | W6 Agent Observability - agent can observe degradation |
| Failure forensics | W1 Agent Testing - failure analysis in test traces |
| Circuit breakers | W4 Multi-Agent Coordination - isolate failing agents |

### Integration with Evidence Ledger

All fault tolerance events are recorded in the evidence ledger:

| Event Type | Evidence Entry |
|------------|---------------|
| Health check | `health_check_result` |
| Degradation | `degradation_event` |
| Circuit breaker transition | `circuit_breaker_transition` |
| Recovery attempt | `recovery_attempt` |
| Failure classification | `failure_classified` |
| Supervision restart | `supervisor_restart` |

---

## Implementation Dependencies

### Dependency Graph

```
FT1 (Supervision Tree) ─────────────────┐
                                        │
FT5 (Health Monitoring) ────────────────┼──> Foundation Layer
                                        │
FT2 (Failure Categories) ───────────────┤
                                        │
                                        v
FT3 (Degradation Policies) ─────────────┬──> Policy Layer
                                        │
FT7 (Circuit Breakers) ─────────────────┤
                                        │
                                        v
FT4 (Recovery Strategies) ──────────────┬──> Recovery Layer
                                        │
FT6 (Fault Tolerance Primitives) ───────┤
                                        │
                                        v
FT8 (Failure Forensics) ────────────────────> Learning Layer
```

### Feature Dependencies

| Feature | Depends On | Enables |
|---------|-----------|---------|
| **FT1** | None | FT3, FT5 (supervision provides structure) |
| **FT2** | None | FT4, FT7 (classification drives strategy) |
| **FT3** | FT1, FT5 | Graceful degradation of components |
| **FT4** | FT2 | Appropriate recovery actions |
| **FT5** | FT1 | FT3, FT7 (health drives transitions) |
| **FT6** | FT2, FT4 | Composable fault tolerance |
| **FT7** | FT2, FT5 | Service protection |
| **FT8** | FT2, FT4, FT5 | Learning from failures |

---

## Summary

Track C Fault-Tolerant Architecture provides production-grade resilience:

1. **FT1 (Supervision Tree)**: Erlang-style process supervision with configurable restart strategies
2. **FT2 (Failure Categories)**: Classification of failures for appropriate handling
3. **FT3 (Degradation Policies)**: Graceful degradation over total failure
4. **FT4 (Recovery Strategies)**: Multiple recovery approaches (retry, fallback, checkpoint)
5. **FT5 (Health Monitoring)**: Proactive health checks and dependency tracking
6. **FT6 (Fault Tolerance Primitives)**: Composable building blocks (timeout, bulkhead, rate limit)
7. **FT7 (Circuit Breakers)**: Service protection from cascade failure
8. **FT8 (Failure Forensics)**: Root cause analysis and learning from failures

**Total estimated LOC**: ~1,250

Without these capabilities, LiBrainian is "a time bomb waiting to fail catastrophically" (Armstrong). With them, failures become observable, recoverable, and educational.

---

## Armstrong's Verdict

**Armstrong**: "The philosophy is simple: let it crash, but make crash recovery automatic and isolated. A supervision tree with proper restart strategies turns catastrophic failures into minor hiccups. The key insight is that most failures are transient - if you just restart the component, it will probably work."

**The Erlang Way**:
1. Fail fast - don't try to handle every edge case inline
2. Supervisor handles restart - clean separation of concerns
3. Isolate failures - don't let one crash bring down the system
4. Learn from crashes - forensics feed back into prevention

---

## Acceptance Criteria Summary

- [ ] Supervision tree with one_for_one, one_for_all, rest_for_one strategies
- [ ] Failure classification into 5 categories
- [ ] Degradation policies with 4 levels (full, reduced, minimal, offline)
- [ ] Recovery strategies (retry, circuit breaker, fallback, checkpoint, rebuild)
- [ ] Health monitoring with dependency aggregation
- [ ] Fault tolerance primitives (isolate, bulkhead, timeout, rate limit)
- [ ] Circuit breakers with closed/open/half-open states
- [ ] Failure forensics with root cause analysis
- [ ] Integration with evidence ledger
- [ ] Integration with agentic workflows
- [ ] ~1,250 LOC total budget

---

## Evidence Commands

```bash
# Type check
cd packages/LiBrainian && npx tsc --noEmit

# Tests (when implemented)
cd packages/LiBrainian && npx vitest src/infrastructure/__tests__/supervision.test.ts
cd packages/LiBrainian && npx vitest src/infrastructure/__tests__/circuit_breaker.test.ts
cd packages/LiBrainian && npx vitest src/infrastructure/__tests__/health_monitor.test.ts

# Full Tier-0
npm run test:tier0
```

---

## Files to Create

- `packages/LiBrainian/src/infrastructure/supervision.ts`
- `packages/LiBrainian/src/infrastructure/failure_categories.ts`
- `packages/LiBrainian/src/infrastructure/degradation.ts`
- `packages/LiBrainian/src/infrastructure/recovery.ts`
- `packages/LiBrainian/src/infrastructure/health_monitor.ts`
- `packages/LiBrainian/src/infrastructure/fault_tolerance_primitives.ts`
- `packages/LiBrainian/src/infrastructure/circuit_breaker.ts`
- `packages/LiBrainian/src/infrastructure/failure_forensics.ts`
- `packages/LiBrainian/src/infrastructure/__tests__/supervision.test.ts`
- `packages/LiBrainian/src/infrastructure/__tests__/fault_tolerance.test.ts`
