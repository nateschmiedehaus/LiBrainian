# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian Fixes: Critical (P1-P15)

> **FOR AGENTS**: Fix instructions for P1-P15 (Critical/High priority). All are marked RESOLVED but code examples remain useful.
> **Navigation**: [README.md](./README.md) | [system-wiring.md](./system-wiring.md) | [fixes-remaining.md](./fixes-remaining.md)

**Status**: All problems in this document are marked **[x] Resolved**.

---

## Quick Reference: Problems in This Document

| ID | Problem | Severity | Jump Link |
|----|---------|----------|-----------|
| P1 | LiBrainian not initialized at startup | CRITICAL | [#p1-LiBrainian-not-initialized](#p1-LiBrainian-not-initialized-at-startup-critical) |
| P2 | UnifiedOrchestrator canonical entrypoint | HIGH | [#p2-unifiedorchestrator](#p2-unifiedorchestrator-not-canonical-entrypoint-high) |
| P3 | `any` sweep | CRITICAL | [#p3-any-sweep](#p3-any-in-codebase-critical) |
| P4 | Workgraph quality gates | CRITICAL | [#p4-workgraph-quality](#p4-workgraph-quality-gates-critical) |
| P5 | Context assembly + LiBrainian | CRITICAL | [#p5-context-assembly](#p5-context-assembly-not-using-LiBrainian-critical) |
| P6 | Workgraph + LiBrainian signals | CRITICAL | [#p6-workgraph-LiBrainian](#p6-workgraph-not-using-LiBrainian-signals-critical) |
| P7 | Provider availability | HIGH | [#p7-provider-check](#p7-provider-availability-not-enforced-high) |
| P8 | Checkpoint/resume | HIGH | [#p8-checkpoint](#p8-checkpointresume-for-long-tasks-high) |
| P9 | Agent pool | HIGH | [#p9-agent-pool](#p9-agent-pool-implementation-high) |
| P10 | Sandbox enabled | HIGH | [#p10-sandbox](#p10-sandbox-not-enabled-by-default-high) |
| P11 | SQLite concurrent access | MEDIUM | [#p11-sqlite](#p11-sqlite-concurrent-access-medium) |
| P12 | Disabled tests | MEDIUM | [#p12-disabled-tests](#p12-disabled-tests-medium) |
| P13 | Expertise matching | MEDIUM | [#p13-expertise](#p13-expertise-matching-via-LiBrainian-medium) |
| P14 | Bootstrap timeout | MEDIUM | [#p14-bootstrap](#p14-bootstrap-timeout-recovery-medium) |
| P15 | Query API docs | MEDIUM | [#p15-query-api](#p15-query-api-documented-medium) |

---

---

## PART 2: FIX INSTRUCTIONS

### P1: LiBrainian Not Initialized at Startup (CRITICAL)

**Symptom**: `.LiBrainian/` directory never created. All agents work without semantic knowledge.

**Root Cause**: `preOrchestrationHook()` exported from LiBrainian but never called.

**Fix**:

```typescript
// src/orchestrator/unified_orchestrator.ts (canonical implementation)

import { preOrchestrationHook, isLibrarianReady } from '../LiBrainian';
import { requireProviders } from '../LiBrainian/api/provider_check';

export async function startOrchestrator(config: OrchestratorConfig): Promise<void> {
  // STEP 0: Require providers - HARD FAIL if unavailable
  await requireProviders({ llm: true, embedding: true });

  // STEP 1: Initialize LiBrainian BEFORE any agent work
  console.log('[orchestrator] Initializing LiBrainian...');

  const librarianResult = await preOrchestrationHook({
    workspaceRoot: config.workspaceRoot,
    timeout: 300_000,  // 5 minutes for bootstrap
    skipIfExists: true
  });

  // HARD FAIL on any initialization error - no fallback
  if (!librarianResult.success) {
    throw new Error(`LiBrainian initialization failed: ${librarianResult.error}`);
  }

  // STEP 2: Verify LiBrainian is ready
  if (!isLibrarianReady()) {
    throw new Error('LiBrainian not ready after initialization');
  }

  console.log('[orchestrator] LiBrainian ready, starting orchestration loop');

  // STEP 3: Now start the orchestration loop
  await runOrchestrationLoop(config);
}
```

**Implementation Notes (actual)**:
- Wired provider readiness gate + `preOrchestrationHook` in `src/orchestrator/unified_orchestrator.ts` before any agent startup.
- Added a hard `isLibrarianReady()` check that aborts startup if the gate does not resolve.
- Deviation: deterministic/Tier-0 mode skips provider + LiBrainian bootstrap to keep CI provider-free.
- User-requested lifecycle cleanup: `postOrchestrationHook` is now called from `UnifiedOrchestrator.stop()` (not part of P2 definition).

**Verification**:
```bash
# After fix, this directory should exist and contain data:
ls -la .LiBrainian/
# Target after fixes: LiBrainian.sqlite, embeddings/, etc.
```

---

### P2: Competing Orchestrator Implementations (CRITICAL)

**Symptom**: Three different orchestration systems existed:
- `archive/legacy/orchestrator/core.ts` (former 23-line stub)
- `src/orchestrator/unified_orchestrator.ts` (canonical implementation)
- `archive/legacy/orchestrator/orchestrator_loop.ts` (legacy loop variant)

**Root Cause**: Incremental development without cleanup.

**Note (deviation)**: The user requested a "postOrchestrationHook wiring" P2 step, which is now implemented in `UnifiedOrchestrator.stop()`. This does **not** resolve the competing orchestrator implementations described here, so the consolidation work below remains required.

**Implementation Notes (actual)**:
- `src/orchestrator/index.ts` now exports `UnifiedOrchestrator` (canonical) and `OrchestratorLoop` only.
- Legacy entrypoints are archived under `archive/legacy/orchestrator/` (core + loop + legacy orchestrator).
- Workflow orchestration lives in `src/orchestrator/workflow_orchestrator.ts` and is invoked by `TaskExecutionRouter`.
- Specialized orchestrators remain for distinct responsibilities (loop, policy, quality, etc.) per the P2 note; this is a deliberate deviation from the “archive legacy files” suggestion to avoid breaking runtime paths.

**Fix**:

1. **Designate canonical implementation**: `unified_orchestrator.ts`

2. **Merge functionality from others**:
```typescript
// src/orchestrator/index.ts - Single entry point

export { UnifiedOrchestrator } from './unified_orchestrator';
export type { OrchestratorConfig, TaskResult } from './types';

// Re-export ONLY what's needed, nothing else
```

3. **Delete or deprecate old files**:
```bash
# Move to archive, don't delete yet
mkdir -p archive/legacy/orchestrator
mv src/orchestrator/core.ts archive/legacy/orchestrator/
mv src/orchestrator/orchestrator_loop.ts archive/legacy/orchestrator/

# Update imports across codebase
grep -r "from.*orchestrator/core" src/ --include="*.ts" | cut -d: -f1 | xargs sed -i '' 's|orchestrator/core|orchestrator|g'
```

4. **Consolidate unified orchestrator**:
```typescript
// src/orchestrator/unified_orchestrator.ts

export class UnifiedOrchestrator {
  private LiBrainian: LiBrainian;
  private agentPool: AgentPool;
  private workgraph: WorkGraph;
  private scheduler: Scheduler;

  constructor(config: OrchestratorConfig) {
    // Canonical implementation for all orchestration
  }

  async run(task: Task): Promise<TaskResult> {
    // 1. Get context from LiBrainian
    const context = await this.LiBrainian.assembleContext(task);

    // 2. Schedule with semantic awareness
    const scheduled = await this.scheduler.schedule(task, context);

    // 3. Assign to appropriate agent
    const agent = await this.agentPool.assign(scheduled, context);

    // 4. Execute with monitoring
    const result = await agent.execute(scheduled, context);

    // 5. Report outcome for learning
    await this.LiBrainian.reportOutcome(task, result);

    return result;
  }
}
```

**Verification**:
```bash
# Should have only ONE orchestrator export
grep -r "class.*Orchestrator" src/orchestrator/ --include="*.ts"
# Target after consolidation: Only UnifiedOrchestrator
```

---

### P3: Type Safety Crisis (CRITICAL)

**Symptom**: 383+ instances of `any | unknown | never` across 93 files.

**Root Cause**: Rapid development without strict TypeScript.

**Fix**:

1. **Enable strict mode**:
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitReturns": true
  }
}
```

2. **Fix by priority** (highest impact first):
```bash
# Find all violations
grep -rn ": any" src/orchestrator/ --include="*.ts" | wc -l
# Fix each file, starting with most-imported

# Use this pattern to replace:
# BAD:  result: any
# GOOD: result: TaskExecutionResult
```

3. **Create missing types**:
```typescript
// src/orchestrator/types.ts

export interface TaskExecutionResult {
  success: boolean;
  taskId: string;
  output: string;
  artifacts: Artifact[];
  metrics: ExecutionMetrics;
  error?: ExecutionError;
}

export interface ExecutionMetrics {
  durationMs: number;
  tokensUsed: number;
  filesModified: string[];
  testsRun: number;
  testsPassed: number;
}

// ... define ALL types explicitly
```

4. **Add type guards**:
```typescript
function isTaskResult(x: unknown): x is TaskExecutionResult {
  return typeof x === 'object' && x !== null && 'success' in x && 'taskId' in x;
}
```

**Verification**:
```bash
npx tsc --noEmit 2>&1 | grep -c "any"
# Target after fixes: 0
```

**Implementation Notes (actual, partial)**:
- Removed `any` usages in `src/orchestrator/symbiosis_manager.ts`, `src/orchestrator/resource_lifecycle_manager.ts`,
  `src/orchestrator/evidence_bundle.ts`, `src/orchestrator/task_verifier_v2.ts`, and `src/orchestrator/autopilot_health_monitor.ts`.
- Remaining `any`/type-safety debt still tracked under P3 and will continue to be burned down.

---

### P4: Live Quality Review Blocks All Work (CRITICAL)

**Symptom**: Any provider-based task fails if `requires_live_quality_review !== true`.

**Location**: `src/workgraph/validator.ts:31-36`

**Root Cause**: Hardcoded policy with no escape.

**Fix**:

```typescript
// src/workgraph/validator.ts

interface QualityGateConfig {
  requireLiveReviewForProvider: boolean;
  allowOverrideWithJustification: boolean;
  exemptTaskTypes: TaskType[];
}

function validateQualityGates(task: Task, config: QualityGateConfig): ValidationResult {
  // Check if task requires live review
  if (task.execution.patch_strategy === 'provider') {
    // Allow override with justification
    if (config.allowOverrideWithJustification && task.override?.justification) {
      return { valid: true, note: `Live review skipped: ${task.override.justification}` };
    }

    // Exempt certain task types
    if (config.exemptTaskTypes.includes(task.type)) {
      return { valid: true, note: `Task type ${task.type} exempt from live review` };
    }

    // Require live review for complex changes
    if (config.requireLiveReviewForProvider && !task.definition_of_done.requires_live_quality_review) {
      // Suggest instead of hard fail
      return {
        valid: false,
        error: 'Provider task should have live review',
        suggestion: 'Add requires_live_quality_review: true or provide override justification',
        canProceed: task.complexity < 5  // Allow simple tasks
      };
    }
  }

  return { valid: true };
}
```

**Config**:
```typescript
// config/quality_gates.ts
export const defaultQualityGateConfig: QualityGateConfig = {
  requireLiveReviewForProvider: true,  // Can be disabled for dev
  allowOverrideWithJustification: true,
  exemptTaskTypes: ['investigation', 'review', 'documentation']
};
```

**Implementation Notes (actual)**:
- Added `src/workgraph/quality_gate_config.ts` with a typed `WorkGraphQualityGateConfig` and YAML loader.
- Policy is enforced via `state/workgraph_quality_gates.yaml` (optional). Defaults are strict but overrideable.
- Optional task override via `policy_overrides.live_quality_review` (requires `justification`).
- `replayWorkGraph()` now accepts a config parameter and `runWorkGraph()` loads the workspace config once.

---

### P5: Context Assembly Ignores LiBrainian (CRITICAL)

**Symptom**: Agents receive empty/incomplete context even when LiBrainian has knowledge.

**Location**: `src/orchestrator/context_assembler.ts`

**Fix**:

```typescript
// src/orchestrator/context_assembler.ts

import { assembleContext as librarianAssemble, QueryInterface } from '../LiBrainian';

export async function assembleTaskContext(task: Task): Promise<AgentKnowledgeContext> {
  // 1. Check LiBrainian readiness - HARD FAIL if not ready
  if (!isLibrarianReady()) {
    throw new Error('LiBrainian not ready - cannot assemble context');
  }

  // 2. Determine context level from task type
  const level = mapTaskTypeToLevel(task.type);

  // 3. Request context from LiBrainian
  const context = await librarianAssemble({
    taskId: task.id,
    taskDescription: task.description,
    taskType: task.type,
    targetPaths: task.targetFiles,
    level,
    requiredCoverage: task.requiredCoverage ?? 70
  });

  // 4. Validate context quality
  if (context.coverage.percentage < 70) {
    console.warn(`[context] Low coverage for ${task.id}: ${context.coverage.percentage}%`);
    // Surface gaps explicitly
    for (const gap of context.coverage.gaps) {
      if (gap.impact === 'blocking') {
        throw new Error(`Blocking knowledge gap: ${gap.location}`);
      }
    }
  }

  // 5. Attach query interface for on-demand queries
  context.query = createQueryInterface(task.id);

  return context;
}

function mapTaskTypeToLevel(type: TaskType): ContextLevel {
  switch (type) {
    case 'bug_fix': return 'L1';
    case 'feature': return 'L2';
    case 'refactor': return 'L2';
    case 'review': return 'L1';
    case 'investigation': return 'L0';
    case 'architecture': return 'L3';
    default: return 'L1';
  }
}
```

**Implementation Notes (actual)**:
- `ContextAssembler` now hard-fails when LiBrainian is enabled but not ready (deterministic mode auto-disables LiBrainian).
- `getLibrarianKnowledgeContext()` uses `LiBrainian.assembleContext()` with inferred depth/level and enforces coverage thresholds.
- LiBrainian knowledge context is injected into prompt assembly (key files, coverage gaps, low-confidence files).

---

### P6: Workgraph Doesn't Use LiBrainian (CRITICAL)

**Symptom**: Tasks scheduled FIFO without semantic awareness.

**Fix**:

```typescript
// src/workgraph/scheduler.ts

import { getSemanticSimilarity, getFileExpertise } from '../LiBrainian';

export class SemanticScheduler {
  async schedule(tasks: Task[]): Promise<ScheduledTask[]> {
    // 1. Group semantically similar tasks
    const groups = await this.groupBySimilarity(tasks);

    // 2. Order groups by priority and dependencies
    const ordered = this.orderGroups(groups);

    // 3. Match tasks to agent expertise
    const assigned = await this.matchExpertise(ordered);

    return assigned;
  }

  private async groupBySimilarity(tasks: Task[]): Promise<TaskGroup[]> {
    const groups: TaskGroup[] = [];

    for (const task of tasks) {
      // Find most similar existing group
      let bestGroup: TaskGroup | null = null;
      let bestSimilarity = 0;

      for (const group of groups) {
        const similarity = await getSemanticSimilarity(
          task.targetFiles,
          group.tasks[0].targetFiles
        );

        if (similarity > 0.7 && similarity > bestSimilarity) {
          bestGroup = group;
          bestSimilarity = similarity;
        }
      }

      if (bestGroup) {
        bestGroup.tasks.push(task);
      } else {
        groups.push({ tasks: [task], similarity: 1.0 });
      }
    }

    return groups;
  }

  private async matchExpertise(tasks: ScheduledTask[]): Promise<ScheduledTask[]> {
    for (const task of tasks) {
      // Get expertise requirements from LiBrainian
      const expertise = await getFileExpertise(task.targetFiles);

      // Annotate task with preferred agent type
      task.preferredAgent = expertise.recommendedAgent;
      task.requiredCapabilities = expertise.capabilities;
    }

    return tasks;
  }
}
```

---

### P7: Provider Availability Is Mandatory (HIGH)

**Symptom**: System attempts to run without providers, producing garbage.

**Principle**: Wave0 is a live agent system. Without providers, it cannot function. There is NO fallback - the system must **hard stop** with a clear error.

**Fix**:

```typescript
// src/LiBrainian/api/provider_check.ts

interface ProviderStatus {
  available: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
}

interface ProviderRequirement {
  llm: boolean;           // Claude/GPT for reasoning
  embedding: boolean;     // For semantic search
}

export async function requireProviders(needs: ProviderRequirement): Promise<void> {
  const status = await checkAllProviders();

  const missing: string[] = [];

  if (needs.llm && !status.llm.available) {
    missing.push(`LLM provider unavailable: ${status.llm.error}`);
  }

  if (needs.embedding && !status.embedding.available) {
    missing.push(`Embedding provider unavailable: ${status.embedding.error}`);
  }

  if (missing.length > 0) {
    // HARD STOP - no fallback, no degraded mode
    throw new ProviderUnavailableError({
      message: 'Wave0 requires live providers to function',
      missing,
      suggestion: 'Ensure API keys are set: ANTHROPIC_API_KEY, OPENAI_API_KEY',
      canRetry: true,
      retryAfterMs: 30_000
    });
  }
}

async function checkAllProviders(): Promise<AllProviderStatus> {
  const [llm, embedding] = await Promise.all([
    checkLLMProvider(),
    checkEmbeddingProvider()
  ]);

  return { llm, embedding };
}

async function checkLLMProvider(): Promise<ProviderStatus> {
  // Try providers in order of preference
  const providers = [
    { name: 'anthropic', key: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-20250514' },
    { name: 'openai', key: 'OPENAI_API_KEY', model: 'gpt-4o' }
  ];

  for (const p of providers) {
    if (process.env[p.key]) {
      try {
        const start = Date.now();
        await testProvider(p.name, p.model);
        return {
          available: true,
          provider: p.name,
          model: p.model,
          latencyMs: Date.now() - start
        };
      } catch (e) {
        continue;  // Try next provider
      }
    }
  }

  return {
    available: false,
    provider: 'none',
    model: 'none',
    latencyMs: 0,
    error: 'No LLM provider configured or all providers failed health check'
  };
}

// Usage at startup - BEFORE any work
export async function initializeWithProviderCheck(): Promise<void> {
  console.log('[wave0] Checking provider availability...');

  await requireProviders({ llm: true, embedding: true });

  console.log('[wave0] Providers available, proceeding with initialization');
}
```

**Startup Integration**:

```typescript
// src/orchestrator/unified_orchestrator.ts

export async function startOrchestrator(config: OrchestratorConfig): Promise<void> {
  // STEP 0: Provider check - HARD FAIL if unavailable
  await requireProviders({ llm: true, embedding: true });

  // Only proceed if providers are available
  // ... rest of initialization
}
```

**Error Handling**:

```typescript
class ProviderUnavailableError extends Error {
  constructor(public details: {
    message: string;
    missing: string[];
    suggestion: string;
    canRetry: boolean;
    retryAfterMs: number;
  }) {
    super(details.message);
    this.name = 'ProviderUnavailableError';
  }
}

// In CLI/runner:
try {
  await startOrchestrator(config);
} catch (e) {
  if (e instanceof ProviderUnavailableError) {
    console.error('═══════════════════════════════════════════════════════');
    console.error('WAVE0 CANNOT START: Providers unavailable');
    console.error('═══════════════════════════════════════════════════════');
    console.error('');
    console.error('Missing:');
    for (const m of e.details.missing) {
      console.error(`  • ${m}`);
    }
    console.error('');
    console.error('Solution:', e.details.suggestion);
    console.error('');
    process.exit(1);
  }
  throw e;
}
```

**No Emergency Mode**: Remove all "emergency mode" and "degraded operation" concepts. The system either works or stops.

**Status (Implemented)**:
- Provider readiness enforced via `requireProviders` in `src/orchestrator/unified_orchestrator.ts`.
- `src/LiBrainian/api/provider_check.ts` delegates to provider readiness gate with explicit remediation hints.
- Deterministic mode skips provider checks for Tier-0 runs only.

---

### P8: No Checkpoint/Resume for Long Tasks (HIGH)

**Symptom**: Long tasks fail completely on timeout/crash. No progress is saved.

**Fix**:

```typescript
// src/workgraph/checkpoint.ts

interface Checkpoint {
  taskId: string;
  timestamp: string;
  phase: string;
  phaseIndex: number;
  totalPhases: number;
  state: Record<string, unknown>;
  artifacts: string[];
  codeVersion: string;  // Git SHA at checkpoint
}

class CheckpointManager {
  private checkpointDir = '.wave0/checkpoints';

  async save(taskId: string, data: Partial<Checkpoint>): Promise<void> {
    const checkpoint: Checkpoint = {
      taskId,
      timestamp: new Date().toISOString(),
      phase: data.phase ?? 'unknown',
      phaseIndex: data.phaseIndex ?? 0,
      totalPhases: data.totalPhases ?? 1,
      state: data.state ?? {},
      artifacts: data.artifacts ?? [],
      codeVersion: await getCurrentCommit()
    };

    await mkdirp(this.checkpointDir);
    const path = join(this.checkpointDir, `${taskId}.json`);
    await writeFile(path, JSON.stringify(checkpoint, null, 2));
  }

  async resume(taskId: string): Promise<ResumeResult> {
    const path = join(this.checkpointDir, `${taskId}.json`);

    try {
      const data = await readFile(path, 'utf-8');
      const checkpoint: Checkpoint = JSON.parse(data);

      // Validate checkpoint is still valid
      const currentCommit = await getCurrentCommit();
      if (checkpoint.codeVersion !== currentCommit) {
        return {
          canResume: false,
          reason: 'Code changed since checkpoint',
          suggestion: 'Delete checkpoint and restart task'
        };
      }

      // Check age (24 hour max)
      const age = Date.now() - new Date(checkpoint.timestamp).getTime();
      if (age > 24 * 60 * 60 * 1000) {
        return { canResume: false, reason: 'Checkpoint expired (>24h)' };
      }

      return {
        canResume: true,
        checkpoint,
        resumeFromPhase: checkpoint.phaseIndex
      };
    } catch {
      return { canResume: false, reason: 'No checkpoint found' };
    }
  }

  async clear(taskId: string): Promise<void> {
    const path = join(this.checkpointDir, `${taskId}.json`);
    await unlink(path).catch(() => {});
  }
}

// Integration with task execution
async function executeTaskWithCheckpoints(task: Task): Promise<TaskResult> {
  const checkpointManager = new CheckpointManager();

  // Try to resume
  const resume = await checkpointManager.resume(task.id);
  const startPhase = resume.canResume ? resume.resumeFromPhase : 0;

  if (resume.canResume) {
    console.log(`[task] Resuming ${task.id} from phase ${startPhase}/${task.phases.length}`);
  }

  // Execute phases with checkpointing
  for (let i = startPhase; i < task.phases.length; i++) {
    const phase = task.phases[i];

    await executePhase(phase);

    // Checkpoint after each phase
    await checkpointManager.save(task.id, {
      phase: phase.name,
      phaseIndex: i + 1,
      totalPhases: task.phases.length,
      artifacts: await collectArtifacts()
    });
  }

  // Clear checkpoint on success
  await checkpointManager.clear(task.id);

  return { success: true };
}
```

---

### P9: Agent Pool is Stubs (HIGH)

**Symptom**: Comments say "stubs to satisfy TypeScript compilation". No real agent management.

**Status**: Implemented in `src/orchestrator/agent_pool.ts` with real queueing, capability-aware selection, and CLI execution bridges.

**Notes**: Agent selection now blends `AgentRegistry` capability scores with `ExpertiseMatcher` signals (LiBrainian-aware). Legacy executeWithCodex/Claude paths call real CLI executors with provider hard-stop.

**Fix**:

```typescript
// src/orchestrator/agent_pool.ts

interface AgentConfig {
  type: AgentType;
  capabilities: string[];
  maxConcurrent: number;
}

interface Agent {
  id: string;
  type: AgentType;
  capabilities: string[];
  status: 'idle' | 'busy' | 'terminated';
  currentTask?: string;
  metrics: AgentMetrics;
}

interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  avgDurationMs: number;
  recentFiles: string[];  // For expertise matching
}

export class AgentPool {
  private agents: Map<string, Agent> = new Map();
  private maxAgents: number;
  private waitQueue: Array<{ resolve: (agent: Agent) => void; task: Task }> = [];

  constructor(config: { maxAgents: number }) {
    this.maxAgents = config.maxAgents;
  }

  async acquire(task: Task, context: AgentKnowledgeContext): Promise<Agent> {
    // Find best available agent
    const available = [...this.agents.values()]
      .filter(a => a.status === 'idle');

    if (available.length > 0) {
      // Score and pick best match
      const scored = available.map(agent => ({
        agent,
        score: this.scoreMatch(agent, task, context)
      })).sort((a, b) => b.score - a.score);

      const best = scored[0].agent;
      best.status = 'busy';
      best.currentTask = task.id;
      return best;
    }

    // Spawn new agent if under limit
    if (this.agents.size < this.maxAgents) {
      return this.spawn(this.inferAgentType(task));
    }

    // Wait for an agent to become available
    return new Promise(resolve => {
      this.waitQueue.push({ resolve, task });
    });
  }

  release(agentId: string, result: TaskResult): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Update metrics
    agent.metrics.tasksCompleted += result.success ? 1 : 0;
    agent.metrics.tasksFailed += result.success ? 0 : 1;
    agent.metrics.recentFiles = result.filesModified?.slice(-10) ?? [];

    agent.status = 'idle';
    agent.currentTask = undefined;

    // Serve waiting tasks
    if (this.waitQueue.length > 0) {
      const { resolve, task } = this.waitQueue.shift()!;
      agent.status = 'busy';
      agent.currentTask = task.id;
      resolve(agent);
    }
  }

  private spawn(type: AgentType): Agent {
    const agent: Agent = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      capabilities: AGENT_CAPABILITIES[type],
      status: 'busy',
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        avgDurationMs: 0,
        recentFiles: []
      }
    };

    this.agents.set(agent.id, agent);
    return agent;
  }

  private scoreMatch(agent: Agent, task: Task, context: AgentKnowledgeContext): number {
    let score = 0;

    // Type match (coder for code tasks, etc.)
    const preferredType = this.inferAgentType(task);
    if (agent.type === preferredType) score += 20;

    // Capability match
    for (const cap of task.requiredCapabilities ?? []) {
      if (agent.capabilities.includes(cap)) score += 10;
    }

    // Expertise match (worked on similar files recently)
    const overlap = task.targetFiles.filter(f =>
      agent.metrics.recentFiles.includes(f)
    ).length;
    score += overlap * 5;

    // Success rate
    const total = agent.metrics.tasksCompleted + agent.metrics.tasksFailed;
    if (total > 0) {
      const successRate = agent.metrics.tasksCompleted / total;
      score += successRate * 10;
    }

    return score;
  }

  private inferAgentType(task: Task): AgentType {
    switch (task.type) {
      case 'bug_fix':
      case 'feature':
        return 'coder';
      case 'review':
        return 'reviewer';
      case 'refactor':
        return 'coder';
      default:
        return 'general';
    }
  }
}

const AGENT_CAPABILITIES: Record<AgentType, string[]> = {
  coder: ['read:src', 'write:src', 'exec:test', 'exec:build'],
  reviewer: ['read:src', 'read:tests'],
  tester: ['read:src', 'write:tests', 'exec:test'],
  documenter: ['read:src', 'write:docs'],
  general: ['read:src', 'write:src']
};
```

---

### P10: Sandbox Disabled by Default (HIGH)

**Symptom**: `LIBRARIAN_EXEC_SANDBOX` defaults to off. Commands can escape containment.

**Fix**:

```typescript
// src/spine/exec_tool.ts

// SANDBOX ON BY DEFAULT - must explicitly disable
const SANDBOX_ENABLED = process.env.LIBRARIAN_EXEC_SANDBOX !== '0';

// Allowed paths - STRICT by default
const DEFAULT_ALLOWED_PATHS = [
  process.cwd(),  // Only current workspace
];

const FORBIDDEN_COMMANDS = [
  'rm -rf /',
  'sudo',
  'chmod 777',
  '> /dev/',
  'curl | sh',
  'wget | sh',
];

export async function executeCommand(
  cmd: string,
  options: ExecOptions = {}
): Promise<ExecResult> {
  // 1. Check forbidden commands
  for (const forbidden of FORBIDDEN_COMMANDS) {
    if (cmd.includes(forbidden)) {
      return {
        success: false,
        error: `Forbidden command pattern: ${forbidden}`,
        blocked: true
      };
    }
  }

  // 2. Validate all paths in command
  const allowedPaths = options.allowedPaths ?? DEFAULT_ALLOWED_PATHS;
  const pathValidation = validateCommandPaths(cmd, allowedPaths);
  if (!pathValidation.valid) {
    return {
      success: false,
      error: `Path not allowed: ${pathValidation.invalidPath}`,
      blocked: true
    };
  }

  // 3. Execute with or without sandbox
  if (SANDBOX_ENABLED) {
    return executeInSandbox(cmd, {
      ...options,
      allowedPaths,
      timeout: options.timeout ?? 60_000,
      maxOutputSize: options.maxOutputSize ?? 1_000_000
    });
  } else {
    // Still validate, but warn
    console.warn('[exec] ⚠️  SANDBOX DISABLED - running unsandboxed');
    return executeUnsafe(cmd, options);
  }
}

function validateCommandPaths(cmd: string, allowed: string[]): PathValidation {
  // Extract paths from command (simplified - real impl needs proper parsing)
  const pathPatterns = [
    /(?:^|\s)(\/[^\s]+)/g,           // Absolute paths
    /(?:^|\s)(\.\.\/[^\s]+)/g,       // Parent directory refs
    /(?:^|\s)(~\/[^\s]+)/g,          // Home directory refs
  ];

  for (const pattern of pathPatterns) {
    let match;
    while ((match = pattern.exec(cmd)) !== null) {
      const path = resolve(match[1].replace('~', homedir()));
      const isAllowed = allowed.some(a => path.startsWith(resolve(a)));

      if (!isAllowed) {
        return { valid: false, invalidPath: path };
      }
    }
  }

  return { valid: true };
}
```

---

### P11: SQLite No Concurrent Access Control (MEDIUM)

**Symptom**: Multiple processes can corrupt the database.

**Fix**:

```typescript
// src/LiBrainian/storage/sqlite_storage.ts

import Database from 'better-sqlite3';
import { lockfile } from 'proper-lockfile';

export class SQLiteStorage {
  private db: Database.Database;
  private lockPath: string;
  private releaseLock?: () => Promise<void>;

  constructor(dbPath: string) {
    this.lockPath = `${dbPath}.lock`;
  }

  async open(): Promise<void> {
    // Acquire exclusive lock before opening
    try {
      this.releaseLock = await lockfile(this.lockPath, {
        stale: 30_000,      // Consider lock stale after 30s
        retries: {
          retries: 10,
          factor: 1.5,
          minTimeout: 100,
          maxTimeout: 5_000
        }
      });
    } catch (e) {
      throw new Error(`Database locked by another process: ${e.message}`);
    }

    // Open with WAL mode for better concurrency
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
    if (this.releaseLock) {
      await this.releaseLock();
    }
  }

  // Wrap all writes in transactions
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

// For read-only access (multiple readers OK)
export class SQLiteReader {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true });
    this.db.pragma('journal_mode = WAL');
  }

  // Read methods only...
}
```

---

### P12: 62 Disabled Test Files (MEDIUM)

**Symptom**: Large test coverage gaps. Unknown what's broken.

**Status**: Complete. All previously disabled tests are now enabled or marked obsolete in `state/audits/disabled_tests.json`.

**Fix**:

```bash
# Step 1: Inventory disabled tests
find . -name "*.test.ts.disabled" -o -name "*.disabled" | head -20

# Step 2: Categorize by reason
# Create tracking file:
cat > state/audits/disabled_tests.json << 'EOF'
{
  "inventory": [
    {
      "file": "src/tests/autopilot_e2e.test.ts.disabled",
      "reason": "Requires live providers",
      "tier": 2,
      "priority": "high",
      "owner": null
    }
  ],
  "stats": {
    "total": 62,
    "tier0_deterministic": 0,
    "tier1_provider": 0,
    "tier2_integration": 0,
    "obsolete": 0
  }
}
EOF

# Step 3: Re-enable one at a time
# For each file:
# 1. Rename to remove .disabled
# 2. Run the test
# 3. If fails: fix or mark with reason
# 4. If passes: keep enabled
```

```typescript
// scripts/reenable_tests.ts

interface DisabledTest {
  file: string;
  reason: string;
  tier: 0 | 1 | 2;
  priority: 'high' | 'medium' | 'low';
  status: 'disabled' | 'enabled' | 'obsolete';
}

async function inventoryDisabledTests(): Promise<DisabledTest[]> {
  const files = await glob('**/*.disabled', { cwd: 'src' });
  const tests: DisabledTest[] = [];

  for (const file of files) {
    // Read first few lines to understand what it tests
    const content = await readFile(file, 'utf-8');
    const reason = inferDisableReason(content);

    tests.push({
      file,
      reason,
      tier: inferTier(content),
      priority: inferPriority(file),
      status: 'disabled'
    });
  }

  return tests;
}

async function reenableTest(test: DisabledTest): Promise<ReenableResult> {
  const enabledPath = test.file.replace('.disabled', '');

  // Rename
  await rename(test.file, enabledPath);

  // Try to run
  try {
    await exec(`npm run test -- ${enabledPath}`);
    return { success: true, file: enabledPath };
  } catch (e) {
    // Revert
    await rename(enabledPath, test.file);
    return { success: false, file: test.file, error: e.message };
  }
}
```

---

### P13: No Expertise Matching for Agents (MEDIUM)

**Symptom**: Any agent handles any task. No specialization.

**Status**: Implemented via `src/orchestrator/expertise_matcher.ts` and integrated into `src/orchestrator/agent_pool.ts` selection.

**Notes**: Task expertise is inferred from LiBrainian context packs, task metadata, and file/language signals. Agent profiles update on successful outcomes.

**Fix** (already covered in P9 agent pool, but add LiBrainian integration):

```typescript
// src/orchestrator/expertise_matcher.ts

import { getFileExpertise, getTopicModel } from '../LiBrainian';

interface ExpertiseProfile {
  agent: Agent;
  domains: string[];          // e.g., ['auth', 'database', 'api']
  languages: string[];        // e.g., ['typescript', 'python']
  frameworks: string[];       // e.g., ['react', 'nestjs']
  recentSuccess: string[];    // Files recently worked on successfully
}

export class ExpertiseMatcher {
  private profiles: Map<string, ExpertiseProfile> = new Map();

  async matchTask(task: Task, agents: Agent[]): Promise<Agent> {
    // 1. Get task's expertise requirements from LiBrainian
    const taskExpertise = await this.analyzeTaskExpertise(task);

    // 2. Score each agent
    const scores = agents.map(agent => ({
      agent,
      score: this.calculateMatchScore(agent, taskExpertise)
    }));

    // 3. Return best match
    scores.sort((a, b) => b.score - a.score);
    return scores[0].agent;
  }

  private async analyzeTaskExpertise(task: Task): Promise<TaskExpertise> {
    const fileKnowledge = await Promise.all(
      task.targetFiles.map(f => getFileExpertise(f))
    );

    return {
      domains: [...new Set(fileKnowledge.flatMap(f => f.domains))],
      languages: [...new Set(fileKnowledge.flatMap(f => f.languages))],
      frameworks: [...new Set(fileKnowledge.flatMap(f => f.frameworks))],
      complexity: Math.max(...fileKnowledge.map(f => f.complexity))
    };
  }

  private calculateMatchScore(agent: Agent, required: TaskExpertise): number {
    const profile = this.profiles.get(agent.id);
    if (!profile) return 0;

    let score = 0;

    // Domain match
    for (const domain of required.domains) {
      if (profile.domains.includes(domain)) score += 15;
    }

    // Language match
    for (const lang of required.languages) {
      if (profile.languages.includes(lang)) score += 10;
    }

    // Framework match
    for (const fw of required.frameworks) {
      if (profile.frameworks.includes(fw)) score += 10;
    }

    // Recent success on similar files
    for (const file of required.targetFiles ?? []) {
      if (profile.recentSuccess.includes(file)) score += 20;
    }

    return score;
  }

  // Update profile after task completion
  updateProfile(agentId: string, result: TaskResult): void {
    const profile = this.profiles.get(agentId) ?? this.createEmptyProfile();

    if (result.success) {
      // Add to recent success
      profile.recentSuccess = [
        ...result.filesModified,
        ...profile.recentSuccess
      ].slice(0, 20);  // Keep last 20
    }

    this.profiles.set(agentId, profile);
  }
}
```

---

### P14: Bootstrap Has No Timeout Recovery (MEDIUM)

**Symptom**: If bootstrap times out, must start from scratch.

**Fix**:

```typescript
// src/LiBrainian/api/bootstrap.ts

interface BootstrapState {
  phase: 'discover' | 'parse' | 'embed' | 'analyze' | 'store' | 'complete';
  filesProcessed: number;
  totalFiles: number;
  lastFile: string;
  startedAt: string;
  checkpointAt: string;
}

export async function bootstrapWithRecovery(
  config: BootstrapConfig
): Promise<BootstrapResult> {
  const stateFile = '.LiBrainian/bootstrap_state.json';

  // Try to recover from previous run
  let state: BootstrapState | null = null;
  try {
    const saved = await readFile(stateFile, 'utf-8');
    state = JSON.parse(saved);
    console.log(`[bootstrap] Recovering from phase: ${state.phase}, file ${state.filesProcessed}/${state.totalFiles}`);
  } catch {
    // Fresh start
  }

  const phases: BootstrapPhase[] = [
    { name: 'discover', fn: discoverFiles },
    { name: 'parse', fn: parseFiles },
    { name: 'embed', fn: embedFiles },
    { name: 'analyze', fn: analyzeFiles },
    { name: 'store', fn: storeResults }
  ];

  // Find starting phase
  const startIndex = state
    ? phases.findIndex(p => p.name === state.phase)
    : 0;

  for (let i = startIndex; i < phases.length; i++) {
    const phase = phases[i];
    console.log(`[bootstrap] Starting phase: ${phase.name}`);

    try {
      await phase.fn(config, state);

      // Save state after each phase
      state = {
        phase: phases[i + 1]?.name ?? 'complete',
        filesProcessed: state?.filesProcessed ?? 0,
        totalFiles: state?.totalFiles ?? 0,
        lastFile: '',
        startedAt: state?.startedAt ?? new Date().toISOString(),
        checkpointAt: new Date().toISOString()
      };
      await writeFile(stateFile, JSON.stringify(state, null, 2));

    } catch (e) {
      if (e.message.includes('timeout')) {
        console.log(`[bootstrap] Timeout in ${phase.name}, state saved for recovery`);
        return { success: false, recoverable: true, state };
      }
      throw e;
    }
  }

  // Cleanup state file on success
  await unlink(stateFile).catch(() => {});

  return { success: true };
}
```

---

### P15: Query API Undocumented (MEDIUM)

**Symptom**: Hard to debug query results. Scoring algorithm opaque.

**Fix**:

```typescript
// src/LiBrainian/api/query.ts

/**
 * Query API for the Wave0 LiBrainian
 *
 * SCORING ALGORITHM (weighted signals):
 * - semantic similarity (0.4)
 * - PageRank (0.2)
 * - centrality (0.1)
 * - confidence (0.2)
 * - recency (0.1)
 *
 * PIPELINE:
 * 1) Embedding search for functions/modules above similarity threshold.
 * 2) Graph enrichment: PageRank + centrality metrics.
 * 3) Expansion: add community neighbors + graph-similar entities.
 * 4) Rank context packs using candidate scores as priors.
 *
 * CACHING:
 * - Query cache: 5 minute TTL, max 50 entries per process
 * - Embedding cache: LRU, 64 entries per EmbeddingService
 *
 * EVIDENCE:
 * - Line-level EvidenceRef entries included when storage supports it.
 */

interface QueryOptions {
  /** Maximum results to return (default: 10) */
  limit?: number;

  /** Minimum score threshold (default: 30) */
  minScore?: number;

  /** Include call graph expansion (default: true) */
  expand?: boolean;

  /** Filter to specific file types */
  fileTypes?: string[];

  /** Enable debug output */
  debug?: boolean;
}

interface QueryResult {
  results: ScoredResult[];

  /** Debug info if debug: true */
  debug?: {
    queryEmbeddingTime: number;
    searchTime: number;
    expansionTime: number;
    cacheHit: boolean;
    scoringBreakdown: Array<{
      file: string;
      similarity: number;
      centrality: number;
      recency: number;
      exactMatch: number;
      total: number;
    }>;
  };
}

export async function query(
  queryText: string,
  options: QueryOptions = {}
): Promise<QueryResult> {
  const debug = options.debug ?? false;
  const debugInfo: QueryResult['debug'] = debug ? {
    queryEmbeddingTime: 0,
    searchTime: 0,
    expansionTime: 0,
    cacheHit: false,
    scoringBreakdown: []
  } : undefined;

  // ... implementation with debug tracking ...

  return { results, debug: debugInfo };
}
```

---


---

**Next**: [fixes-remaining.md](./fixes-remaining.md) - P16-P31 fix instructions
