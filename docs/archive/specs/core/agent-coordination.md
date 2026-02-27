# Agent Coordination Specification

> **Version**: 1.0.0
> **Status**: DRAFT
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: Hierarchical multi-agent systems with fresh context windows.

---

## Executive Summary

LiBrainian supports a **hierarchical multi-agent architecture** where:
- A **main agent** orchestrates work
- **2-3 sub-agents** execute specific tasks with **fresh context windows**
- Only **2 layers deep** (main → sub-agents, no deeper nesting)
- Each sub-agent gets a focused task and returns a result

This enables parallelization, context efficiency, and specialized task execution.

---

## 1. Architecture Overview

### 1.1 The Two-Layer Constraint

```
┌─────────────────────────────────────────────────────────────────┐
│                        MAIN AGENT                                │
│  • Full conversation context                                     │
│  • Orchestrates sub-agents                                       │
│  • Synthesizes results                                           │
│  • Makes final decisions                                         │
└───────────┬───────────────┬───────────────┬─────────────────────┘
            │               │               │
            ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │ Sub-Agent│    │ Sub-Agent│    │ Sub-Agent│
     │    1     │    │    2     │    │    3     │
     │          │    │          │    │          │
     │ Fresh    │    │ Fresh    │    │ Fresh    │
     │ Context  │    │ Context  │    │ Context  │
     └──────────┘    └──────────┘    └──────────┘
         │               │               │
         └───────────────┴───────────────┘
                         │
                    NO DEEPER NESTING
                    (Sub-agents cannot spawn sub-agents)
```

### 1.2 Design Principles

1. **Fresh Context Windows**: Each sub-agent starts with only the task description, not the full conversation history
2. **Focused Tasks**: Sub-agents receive narrow, well-defined tasks
3. **No Nesting**: Sub-agents cannot spawn their own sub-agents (prevents runaway complexity)
4. **Result Synthesis**: Main agent aggregates and synthesizes sub-agent outputs
5. **Parallel Execution**: Independent sub-agents can run concurrently

---

## 2. Core Types

### 2.1 Agent Hierarchy

```typescript
/**
 * A coordinated agent system with main agent and sub-agents.
 *
 * INVARIANT: Maximum 2 layers (main + sub-agents)
 * INVARIANT: Maximum 3 concurrent sub-agents
 * INVARIANT: Sub-agents cannot spawn sub-agents
 */
interface AgentCoordinator {
  /** Unique identifier for this coordination session */
  id: CoordinationId;

  /** The main agent (orchestrator) */
  mainAgent: MainAgent;

  /** Currently active sub-agents */
  subAgents: Map<SubAgentId, SubAgent>;

  /** Maximum concurrent sub-agents */
  maxConcurrent: number;  // Default: 3

  /** Coordination state */
  state: CoordinationState;

  /** Evidence ledger for recording all agent actions */
  ledger: IEvidenceLedger;
}

type CoordinationId = string & { readonly __brand: 'CoordinationId' };
type SubAgentId = string & { readonly __brand: 'SubAgentId' };

type CoordinationState =
  | 'idle'
  | 'spawning'
  | 'executing'
  | 'aggregating'
  | 'complete'
  | 'failed';
```

### 2.2 Main Agent

```typescript
/**
 * The main agent that orchestrates sub-agents.
 */
interface MainAgent {
  /** Agent identifier */
  id: MainAgentId;

  /** Full conversation context */
  context: ConversationContext;

  /** Tasks delegated to sub-agents */
  delegatedTasks: DelegatedTask[];

  /** Results received from sub-agents */
  receivedResults: Map<SubAgentId, SubAgentResult>;

  /** Coordination capabilities */
  capabilities: MainAgentCapabilities;
}

type MainAgentId = string & { readonly __brand: 'MainAgentId' };

interface MainAgentCapabilities {
  /** Can spawn sub-agents */
  canSpawn: true;

  /** Can aggregate results */
  canAggregate: true;

  /** Maximum tasks to delegate */
  maxDelegations: number;

  /** Timeout for sub-agent completion */
  subAgentTimeoutMs: number;
}

interface ConversationContext {
  /** Full message history */
  messages: Message[];

  /** Current task being worked on */
  currentTask: string;

  /** Files already read */
  readFiles: string[];

  /** Accumulated knowledge */
  knowledge: Knowledge[];
}
```

### 2.3 Sub-Agent

```typescript
/**
 * A sub-agent with a fresh context window.
 */
interface SubAgent {
  /** Unique identifier */
  id: SubAgentId;

  /** Parent (always the main agent) */
  parent: MainAgentId;

  /** The specific task assigned */
  task: SubAgentTask;

  /** Fresh context (NOT the full conversation) */
  context: FreshContext;

  /** Current execution state */
  state: SubAgentState;

  /** Result when complete */
  result?: SubAgentResult;

  /** Execution metadata */
  execution: SubAgentExecution;
}

interface SubAgentTask {
  /** Task identifier */
  id: TaskId;

  /** Clear description of what to do */
  description: string;

  /** Expected output type */
  expectedOutput: OutputType;

  /** Resources available to this agent */
  resources: TaskResources;

  /** Constraints on execution */
  constraints: TaskConstraints;
}

type TaskId = string & { readonly __brand: 'TaskId' };

type OutputType =
  | 'document'      // Create a document (spec, report)
  | 'code'          // Write code
  | 'analysis'      // Analyze and report findings
  | 'search'        // Find information
  | 'verification'; // Verify a claim

interface TaskResources {
  /** Files the agent can read */
  readableFiles: string[];

  /** Files the agent can write */
  writableFiles: string[];

  /** Tools available */
  tools: ToolId[];

  /** Token budget */
  tokenBudget: number;

  /** Time budget (ms) */
  timeBudgetMs: number;
}

interface TaskConstraints {
  /** Cannot spawn sub-agents */
  canSpawnSubAgents: false;

  /** Cannot modify files outside scope */
  scopedWrites: boolean;

  /** Must complete within timeout */
  hardTimeout: boolean;
}
```

### 2.4 Fresh Context

```typescript
/**
 * A fresh context window for a sub-agent.
 *
 * INVARIANT: Does NOT include full conversation history
 * INVARIANT: Only includes task-relevant information
 */
interface FreshContext {
  /** System prompt for the sub-agent */
  systemPrompt: string;

  /** The task description */
  task: string;

  /** Relevant context snippets (curated, not full history) */
  relevantContext: ContextSnippet[];

  /** Reference files to read */
  referenceFiles: string[];

  /** Expected format for output */
  outputFormat: OutputFormat;
}

interface ContextSnippet {
  /** What this snippet is about */
  topic: string;

  /** The actual content */
  content: string;

  /** Why this was included */
  relevance: string;
}

interface OutputFormat {
  /** Expected structure */
  structure: 'markdown' | 'json' | 'code' | 'free_text';

  /** Required sections (for structured output) */
  requiredSections?: string[];

  /** Maximum length */
  maxLength?: number;
}
```

### 2.5 Sub-Agent Results

```typescript
/**
 * Result returned by a sub-agent.
 */
interface SubAgentResult {
  /** Which sub-agent produced this */
  agentId: SubAgentId;

  /** Which task this is for */
  taskId: TaskId;

  /** Whether the task succeeded */
  success: boolean;

  /** The actual output */
  output: SubAgentOutput;

  /** Confidence in the result */
  confidence: ConfidenceValue;

  /** Execution metadata */
  metadata: ResultMetadata;
}

type SubAgentOutput =
  | { type: 'document'; content: string; path?: string }
  | { type: 'code'; files: FileWrite[] }
  | { type: 'analysis'; findings: Finding[] }
  | { type: 'search'; results: SearchResult[] }
  | { type: 'verification'; verified: boolean; evidence: string[] }
  | { type: 'error'; error: string; recoverable: boolean };

interface ResultMetadata {
  /** Time taken */
  durationMs: number;

  /** Tokens used */
  tokensUsed: number;

  /** Tools invoked */
  toolsUsed: ToolId[];

  /** Files read */
  filesRead: string[];

  /** Files written */
  filesWritten: string[];
}
```

---

## 3. Coordination Protocol

### 3.1 Task Delegation

```typescript
/**
 * Interface for delegating tasks to sub-agents.
 */
interface ITaskDelegator {
  /**
   * Spawn a sub-agent for a specific task.
   *
   * @returns SubAgentId for tracking
   */
  spawnSubAgent(task: SubAgentTask): Promise<SubAgentId>;

  /**
   * Spawn multiple sub-agents in parallel.
   *
   * @returns Map of task IDs to sub-agent IDs
   */
  spawnParallel(tasks: SubAgentTask[]): Promise<Map<TaskId, SubAgentId>>;

  /**
   * Wait for a sub-agent to complete.
   */
  waitFor(agentId: SubAgentId): Promise<SubAgentResult>;

  /**
   * Wait for all sub-agents to complete.
   */
  waitForAll(agentIds: SubAgentId[]): Promise<Map<SubAgentId, SubAgentResult>>;

  /**
   * Cancel a running sub-agent.
   */
  cancel(agentId: SubAgentId): Promise<void>;
}
```

### 3.2 Result Aggregation

```typescript
/**
 * Interface for aggregating sub-agent results.
 */
interface IResultAggregator {
  /**
   * Aggregate results from multiple sub-agents.
   */
  aggregate(
    results: SubAgentResult[],
    strategy: AggregationStrategy
  ): Promise<AggregatedResult>;

  /**
   * Resolve conflicts between sub-agent outputs.
   */
  resolveConflicts(
    results: SubAgentResult[],
    conflicts: Conflict[]
  ): Promise<ResolvedResult>;

  /**
   * Synthesize a final answer from sub-agent outputs.
   */
  synthesize(
    results: SubAgentResult[],
    originalTask: string
  ): Promise<SynthesizedOutput>;
}

type AggregationStrategy =
  | 'merge'          // Combine all outputs
  | 'vote'           // Take majority/consensus
  | 'best'           // Take highest confidence
  | 'synthesize';    // LLM-synthesize from all

interface AggregatedResult {
  /** Combined output */
  output: SubAgentOutput;

  /** Aggregation method used */
  method: AggregationStrategy;

  /** Source results */
  sources: SubAgentId[];

  /** Any conflicts that were resolved */
  resolvedConflicts: Conflict[];

  /** Combined confidence */
  confidence: ConfidenceValue;
}

interface Conflict {
  /** What the conflict is about */
  topic: string;

  /** Conflicting claims */
  claims: Array<{ agentId: SubAgentId; claim: string }>;

  /** Resolution (if resolved) */
  resolution?: string;
}
```

### 3.3 Coordination Flow

```
ALGORITHM CoordinateSubAgents(mainTask):
  1. ANALYZE mainTask to identify parallelizable subtasks

  2. FOR each subtask:
       a. CREATE SubAgentTask with:
          - Clear description
          - Minimal relevant context (fresh window)
          - Resource constraints
          - Expected output format
       b. ENSURE subtask is independent (no cross-dependencies)

  3. SPAWN sub-agents (up to 3 concurrent):
       FOR each task in parallel:
         agent = spawnSubAgent(task)
         track(agent)

  4. WAIT for all sub-agents:
       results = waitForAll(agents)

  5. AGGREGATE results:
       IF conflicts exist:
         resolvedResults = resolveConflicts(results)
       ELSE:
         aggregatedResult = aggregate(results, strategy)

  6. SYNTHESIZE final output:
       finalOutput = synthesize(aggregatedResult, mainTask)

  7. RECORD evidence:
       ledger.append({
         kind: 'coordination',
         payload: { mainTask, subTasks, results, finalOutput }
       })

  RETURN finalOutput
```

---

## 4. Task Decomposition

### 4.1 When to Use Sub-Agents

```typescript
/**
 * Heuristics for when to delegate to sub-agents.
 */
interface DelegationDecider {
  /**
   * Should this task be delegated to sub-agents?
   */
  shouldDelegate(task: Task): DelegationDecision;
}

interface DelegationDecision {
  /** Whether to delegate */
  shouldDelegate: boolean;

  /** Reason for decision */
  reason: string;

  /** If delegating, suggested subtasks */
  suggestedSubtasks?: SubAgentTask[];

  /** Estimated benefit from parallelization */
  parallelizationBenefit?: number;
}

/**
 * Delegation heuristics.
 */
const DELEGATION_HEURISTICS = {
  // SHOULD delegate
  shouldDelegate: [
    'Task involves creating multiple independent documents',
    'Task involves analyzing multiple unrelated files',
    'Task involves parallel search/exploration',
    'Task would benefit from fresh context (accumulated context is noisy)',
    'Task has clear subtasks that don\'t depend on each other',
  ],

  // Should NOT delegate
  shouldNotDelegate: [
    'Task is simple and quick',
    'Subtasks have dependencies (must be sequential)',
    'Task requires accumulated conversation context',
    'Only one subtask identified',
    'Subtask results need complex coordination',
  ],
};
```

### 4.2 Task Decomposition Algorithm

```
ALGORITHM DecomposeTask(task):
  1. IDENTIFY independent components:
     - Multiple files to analyze → one sub-agent per file
     - Multiple documents to create → one sub-agent per document
     - Multiple searches to perform → one sub-agent per search

  2. VERIFY independence:
     FOR each pair of subtasks (A, B):
       IF A.output is needed for B.input:
         MERGE A and B (sequential dependency)
       IF A and B access same mutable state:
         MERGE A and B (state dependency)

  3. LIMIT to 3 sub-agents:
     IF subtasks.length > 3:
       GROUP related subtasks to reduce to 3

  4. FOR each subtask:
       CREATE fresh context with ONLY:
         - Task description
         - Relevant reference files (not full history)
         - Expected output format

  RETURN subtasks
```

---

## 5. Sub-Agent Lifecycle

### 5.1 States

```
┌─────────┐     spawn      ┌──────────┐    execute    ┌───────────┐
│ pending │───────────────▶│ spawning │──────────────▶│ executing │
└─────────┘                └──────────┘               └─────┬─────┘
                                                            │
                           ┌──────────────┬────────────────┘
                           │              │
                           ▼              ▼
                     ┌──────────┐   ┌──────────┐
                     │ complete │   │  failed  │
                     └──────────┘   └──────────┘
```

### 5.2 State Machine

```typescript
type SubAgentState =
  | 'pending'    // Task assigned, not yet spawned
  | 'spawning'   // Being initialized
  | 'executing'  // Running
  | 'complete'   // Finished successfully
  | 'failed'     // Failed (error or timeout)
  | 'cancelled'; // Manually cancelled

interface SubAgentLifecycle {
  /** Current state */
  state: SubAgentState;

  /** State history */
  history: StateTransition[];

  /** Error (if failed) */
  error?: SubAgentError;

  /** Result (if complete) */
  result?: SubAgentResult;
}

interface StateTransition {
  from: SubAgentState;
  to: SubAgentState;
  timestamp: Date;
  reason: string;
}

interface SubAgentError {
  code: SubAgentErrorCode;
  message: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
}

type SubAgentErrorCode =
  | 'TIMEOUT'           // Exceeded time budget
  | 'TOKEN_LIMIT'       // Exceeded token budget
  | 'TOOL_ERROR'        // Tool invocation failed
  | 'OUTPUT_INVALID'    // Output didn't match expected format
  | 'SPAWN_FAILED'      // Failed to spawn agent
  | 'CANCELLED';        // Manually cancelled
```

---

## 6. Resource Management

### 6.1 Token Budgets

```typescript
/**
 * Token budget allocation for coordinated agents.
 */
interface TokenBudgetManager {
  /** Total budget for the coordination session */
  totalBudget: number;

  /** Budget reserved for main agent */
  mainAgentBudget: number;

  /** Budget per sub-agent */
  perSubAgentBudget: number;

  /** Budget for aggregation */
  aggregationBudget: number;

  /** Current usage */
  usage: {
    mainAgent: number;
    subAgents: Map<SubAgentId, number>;
    aggregation: number;
  };
}

/**
 * Default budget allocation.
 */
const DEFAULT_BUDGET_ALLOCATION = {
  mainAgentPercent: 30,      // 30% for orchestration
  perSubAgentPercent: 20,    // 20% per sub-agent (max 3 = 60%)
  aggregationPercent: 10,    // 10% for synthesis
};
```

### 6.2 Concurrency Control

```typescript
/**
 * Controls concurrent sub-agent execution.
 */
interface ConcurrencyController {
  /** Maximum concurrent sub-agents */
  maxConcurrent: number;  // Default: 3

  /** Currently running */
  running: Set<SubAgentId>;

  /** Queued (waiting for slot) */
  queued: SubAgentTask[];

  /**
   * Request a slot for a new sub-agent.
   * Blocks if at capacity.
   */
  acquireSlot(): Promise<void>;

  /**
   * Release a slot when sub-agent completes.
   */
  releaseSlot(): void;
}
```

---

## 7. TDD Test Specifications

### 7.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `spawn_sub_agent` | Valid task | SubAgentId returned |
| `spawn_respects_limit` | 4 tasks | Only 3 concurrent |
| `fresh_context_no_history` | Task with context | Context is fresh |
| `sub_agent_cannot_spawn` | Sub-agent tries to spawn | Error thrown |
| `timeout_cancels_agent` | Slow task | Failed state after timeout |
| `aggregate_merge` | 3 results | Combined output |
| `aggregate_conflict` | Conflicting results | Conflict detected |
| `budget_tracked` | Token usage | Accurate tracking |

### 7.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `parallel_spec_creation` | 3 specs in parallel | Outputs meet required schema/sections; structural validators pass; forbidden patterns absent |
| `result_synthesis` | Multiple analyses | Synthesis includes per-agent provenance; contradictions are surfaced explicitly (not overwritten) |
| `error_recovery` | One agent fails | Failure recorded in ledger; remaining results returned with explicit incompleteness markers |
| `resource_isolation` | Concurrent file access | Cross-scope writes are rejected; conflicting writes are detected and recorded |

### 7.3 BDD Scenarios

```gherkin
Feature: Agent Coordination
  As a LiBrainian system
  I want to coordinate multiple sub-agents
  So that I can parallelize work and maintain fresh context

	  Scenario: Parallel spec creation
	    Given I have 6 specs to create
	    And each spec is independent
	    When I spawn sub-agents for each spec
	    Then up to 3 sub-agents run concurrently
	    And each sub-agent has a fresh context window
	    And each spec output meets required structure (headers/sections) and passes deterministic validators

  Scenario: Fresh context isolation
    Given the main agent has 50 messages in context
    When a sub-agent is spawned
    Then the sub-agent receives only:
      | Content |
      | Task description |
      | Relevant reference files |
      | Expected output format |
    And the sub-agent does NOT receive the 50 messages

  Scenario: Sub-agent cannot spawn sub-agents
    Given a sub-agent is executing
    When the sub-agent tries to spawn its own sub-agent
    Then an error is returned
    And the sub-agent continues with its original task

  Scenario: Result aggregation with conflicts
    Given 3 sub-agents analyze the same codebase
    And agent 1 says "function is safe"
    And agent 2 says "function is unsafe"
    And agent 3 says "function is safe"
    When results are aggregated
    Then the conflict is detected
    And the majority opinion is noted
    And the final output includes the conflict resolution
```

---

## 8. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| Evidence Ledger | Records coordination events | Writes |
| Token Budget | Tracks usage across agents | Both |
| Tool Registry | Provides tools to sub-agents | Reads |
| Query Engine | Sub-agents can query | Reads |
| File System | Scoped read/write access | Both |

---

## 9. Example Usage

### 9.1 Creating Multiple Specs in Parallel

```typescript
// Main agent code
async function createSpecsInParallel(specs: SpecDefinition[]): Promise<void> {
  const coordinator = new AgentCoordinator({ maxConcurrent: 3 });

  // Create tasks for each spec
  const tasks: SubAgentTask[] = specs.map(spec => ({
    id: `spec_${spec.name}` as TaskId,
    description: `Create the specification file ${spec.path}. ${spec.instructions}`,
    expectedOutput: 'document',
    resources: {
      readableFiles: spec.referenceFiles,
      writableFiles: [spec.path],
      tools: ['Read', 'Write', 'Glob', 'Grep'],
      tokenBudget: 30000,
      timeBudgetMs: 300000,
    },
    constraints: {
      canSpawnSubAgents: false,
      scopedWrites: true,
      hardTimeout: true,
    },
  }));

  // Spawn sub-agents in parallel
  const agentIds = await coordinator.spawnParallel(tasks);

  // Wait for all to complete
  const results = await coordinator.waitForAll([...agentIds.values()]);

  // Aggregate and report
  const successes = [...results.values()].filter(r => r.success).length;
  console.log(`Created ${successes}/${specs.length} specs successfully`);
}
```

### 9.2 Parallel Code Analysis

```typescript
// Main agent code
async function analyzeCodebaseInParallel(files: string[]): Promise<Analysis> {
  const coordinator = new AgentCoordinator({ maxConcurrent: 3 });

  // Split files into chunks for parallel analysis
  const chunks = chunkArray(files, Math.ceil(files.length / 3));

  const tasks: SubAgentTask[] = chunks.map((chunk, i) => ({
    id: `analysis_${i}` as TaskId,
    description: `Analyze these files for security vulnerabilities: ${chunk.join(', ')}`,
    expectedOutput: 'analysis',
    resources: {
      readableFiles: chunk,
      writableFiles: [],
      tools: ['Read', 'Grep'],
      tokenBudget: 20000,
      timeBudgetMs: 120000,
    },
    constraints: {
      canSpawnSubAgents: false,
      scopedWrites: true,
      hardTimeout: true,
    },
  }));

  const agentIds = await coordinator.spawnParallel(tasks);
  const results = await coordinator.waitForAll([...agentIds.values()]);

  // Merge all findings
  const allFindings = [...results.values()]
    .filter(r => r.success && r.output.type === 'analysis')
    .flatMap(r => (r.output as AnalysisOutput).findings);

  return { findings: allFindings, filesAnalyzed: files.length };
}
```

---

## 10. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] AgentCoordinator implemented
- [ ] TaskDelegator implemented
- [ ] ResultAggregator implemented
- [ ] Fresh context isolation implemented
- [ ] Concurrency control implemented
- [ ] Gate passed

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
