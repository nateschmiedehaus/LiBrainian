# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian Fixes: Remaining (P16-P31)

> **FOR AGENTS**: Fix instructions for P16-P31 (Security, type safety, cleanup). P16 is P0 CRITICAL - fix FIRST.
> **Navigation**: [README.md](./README.md) | [fixes-critical.md](./fixes-critical.md) | [validation.md](./validation.md)

**Status**: All problems in this document are marked **[x] Resolved**.

**Note**: P16 (Command Injection) is marked as P0 CRITICAL and must be fixed FIRST before any other work.

---

## Quick Reference: Problems in This Document

| ID | Problem | Severity | Jump Link |
|----|---------|----------|-----------|
| **P16** | Command injection vulnerability | **P0 CRITICAL** | [#p16-command-injection](#p16-command-injection-vulnerability-p0-critical---fix-first) |
| P17 | LiBrainian failure hard-stops | CRITICAL | [#p17-LiBrainian-failure](#p17-LiBrainian-failure-hard-stops-critical) |
| P18 | Mock orchestrator fallbacks | CRITICAL | [#p18-mock-fallbacks](#p18-mock-orchestrator-fallbacks-removed-critical) |
| P19 | Safe JSON.parse wrappers | HIGH | [#p19-json-parse](#p19-safe-jsonparse-wrappers-high) |
| P20 | TODO/FIXME/HACK debt | HIGH | [#p20-todo-debt](#p20-todofixmehack-debt-high) |
| P21 | Type-safe error handling | HIGH | [#p21-error-handling](#p21-type-safe-error-handling-high) |
| P22 | @ts-ignore removed | MEDIUM | [#p22-ts-ignore](#p22-ts-ignore-removed-medium) |
| P23 | Disabled tests re-enabled | HIGH | [#p23-disabled-tests](#p23-disabled-tests-re-enabled-high) |
| P24 | Execution backends | CRITICAL | [#p24-execution-backends](#p24-execution-backends-critical) |
| P25 | Policy engine enforced | CRITICAL | [#p25-policy-engine](#p25-policy-engine-critical) |
| P26 | Domain expert routing | HIGH | [#p26-domain-expert](#p26-domain-expert-routing-high) |
| P27 | Agent registry | HIGH | [#p27-agent-registry](#p27-agent-registry-high) |
| P28 | Evolution coordinator | HIGH | [#p28-evolution](#p28-evolution-coordinator-high) |
| P29 | promote_operator split | MEDIUM | [#p29-promote-operator](#p29-promote_operator-split-medium) |
| P30 | Legacy orchestrator archived | LOW | [#p30-legacy](#p30-legacy-orchestrator-archived-low) |
| P31 | UnifiedOrchestrator modularized | MEDIUM | [#p31-modularized](#p31-unifiedorchestrator-modularized-medium) |

---

---

### P16: Command Injection Vulnerability (P0 CRITICAL - FIX FIRST)

**Symptom**: Arbitrary code execution via unsanitized git parameters.

**Location**: `src/spine/external_project_operator.ts:68-76`

**The Problem**:
```typescript
// VULNERABLE - string interpolation allows injection
execSync(`git clone --branch ${request.source.branch} ${request.source.url} ${targetDir}`);
execSync(`git checkout ${request.source.revision}`);

// Attack vector: branch = "; rm -rf / #"
// Result: git clone --branch ; rm -rf / # ... executes rm -rf /
```

**Fix**:

```typescript
// src/spine/git_sanitizer.ts (NEW FILE)

const GIT_REF_PATTERN = /^[a-zA-Z0-9._\/-]+$/;
const GIT_URL_PATTERN = /^(https?:\/\/|git@|ssh:\/\/)[a-zA-Z0-9._\/-]+$/;
const GIT_SHA_PATTERN = /^[a-fA-F0-9]{7,40}$/;

export function validateGitUrl(url: string): void {
  if (!GIT_URL_PATTERN.test(url)) {
    throw new Error(`Invalid git URL: ${url}`);
  }
  // Block injection attempts
  if (url.includes(';') || url.includes('|') || url.includes('`') || url.includes('$')) {
    throw new Error(`Suspicious characters in git URL: ${url}`);
  }
}

export function validateGitRef(ref: string): void {
  if (!GIT_REF_PATTERN.test(ref)) {
    throw new Error(`Invalid git ref: ${ref}`);
  }
  if (ref.length > 256) {
    throw new Error(`Git ref too long: ${ref.length} chars`);
  }
}

export function validateGitRevision(revision: string): void {
  if (!GIT_REF_PATTERN.test(revision) && !GIT_SHA_PATTERN.test(revision)) {
    throw new Error(`Invalid git revision: ${revision}`);
  }
}
```

```typescript
// src/spine/external_project_operator.ts - USE spawn NOT execSync

import { spawn } from 'child_process';
import { validateGitUrl, validateGitRef, validateGitRevision } from './git_sanitizer.js';

async function cloneRepository(url: string, branch: string, targetDir: string): Promise<void> {
  // VALIDATE ALL INPUTS
  validateGitUrl(url);
  validateGitRef(branch);

  // USE spawn WITH ARRAY ARGS - NO SHELL INTERPOLATION
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['clone', '--branch', branch, '--depth', '1', url, targetDir], {
      stdio: 'pipe',
      timeout: 300_000
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git clone failed with code ${code}`));
    });

    proc.on('error', reject);
  });
}
```

**Security Test** (REQUIRED):
```typescript
// src/spine/__tests__/git_sanitizer.test.ts

describe('git_sanitizer', () => {
  test('REJECTS command injection in URL', () => {
    expect(() => validateGitUrl('https://example.com; rm -rf /')).toThrow();
    expect(() => validateGitUrl('https://example.com | cat /etc/passwd')).toThrow();
    expect(() => validateGitUrl('https://example.com`whoami`')).toThrow();
  });

  test('REJECTS command injection in ref', () => {
    expect(() => validateGitRef('; rm -rf /')).toThrow();
    expect(() => validateGitRef('main; whoami')).toThrow();
  });
});
```

**Verification**:
```bash
npm run test:tier0 -- --grep "git_sanitizer"
```

---

### P17: LiBrainian Failure Does Not Hard-Stop (CRITICAL)

**Symptom**: LiBrainian initialization fails silently, agents proceed without knowledge.

**Root Cause**: Error handling returns success with "degraded mode" instead of failing.

**Fix**:

```typescript
// src/LiBrainian/integration/wave0_integration.ts

export async function preOrchestrationHook(options: PreOrchestrationOptions): Promise<PreOrchestrationResult> {
  // Skip in deterministic mode (Tier-0 tests)
  if (process.env.LIBRARIAN_DETERMINISTIC === '1') {
    return { success: true, skipped: true, reason: 'deterministic_mode' };
  }

  try {
    await ensureLibrarianReady(options);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error('[FATAL] LiBrainian initialization failed:', message);
    console.error('[FATAL] Wave0 cannot operate without LiBrainian.');

    // HARD FAIL - no fallback, no emergency mode
    throw new Error(`LiBrainian initialization failed: ${message}. Wave0 requires LiBrainian.`);
  }
}
```

**Principle**: Wave0 without LiBrainian is like a surgeon without eyes. There is no "degraded mode" - the system stops.

**Status (Implemented)**:
- `preOrchestrationHook` and `ensureLibrarianReady` now hard-fail; emergency mode entry removed.
- `enrichTaskContext` now throws when LiBrainian is unavailable or query fails (no empty-context fallback).
- Outcome recording and reindex notifications propagate failures instead of silently skipping.

---

### P18: Mock Orchestrator Returns Fake Success (CRITICAL)

**Symptom**: Tests pass but production fails; mock returns `{ success: true }` unconditionally.

**Fix**:

1. **Search and destroy mock fallbacks**:
```bash
grep -rn "mock\|Mock\|fallback\|Fallback\|emergency\|Emergency" src/ --include="*.ts" | grep -v test | grep -v __tests__
```

2. **For each occurrence**:
   - If test helper: Move to `__tests__/` or delete
   - If production fallback: Remove, throw instead
   - If degraded mode flag: Remove entirely

**Pattern**:
```typescript
// BAD - fake success
async function getEmbedding(text: string): Promise<number[]> {
  try {
    return await embeddingService.embed(text);
  } catch {
    return Array(1536).fill(0).map(() => Math.random());  // NEVER DO THIS
  }
}

// GOOD - honest failure
async function getEmbedding(text: string): Promise<number[]> {
  const result = await embeddingService.embed(text);
  if (!result.success) {
    throw new ProviderUnavailableError('Embedding service unavailable');
  }
  return result.embedding;
}
```

**Status (Implemented)**:
- `src/orchestrator/workflow_orchestrator.ts` now throws when no role executor is configured (no mock success).
- `src/orchestrator/checks/runner.ts` fails unimplemented checks instead of returning a mock pass.

---

### P19: Unchecked JSON.parse (60+ occurrences) (HIGH)

**Symptom**: Invalid JSON crashes the system with unhelpful stack traces.

**Fix**:

```typescript
// src/utils/safe_json.ts (NEW FILE)

export function safeJsonParse<T>(
  input: string,
  context: string
): { success: true; data: T } | { success: false; error: string } {
  try {
    const data = JSON.parse(input) as T;
    return { success: true, data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: `JSON parse error in ${context}: ${message}` };
  }
}

// Usage:
const result = safeJsonParse<TaskConfig>(configStr, 'task config file');
if (!result.success) {
  throw new Error(result.error);
}
const config = result.data;
```

**Fix pattern for all JSON.parse calls**:
```bash
# Find all occurrences
grep -rn "JSON.parse" src/ --include="*.ts" | grep -v __tests__
# Wrap each in safeJsonParse
```

---

### P20: TODO/FIXME/HACK Debt (106 occurrences) (HIGH)

**Symptom**: Incomplete code paths, known bugs, technical debt markers.

**Fix**:

1. **Inventory all markers**:
```bash
grep -rn "TODO\|FIXME\|HACK\|XXX" src/ --include="*.ts" > state/audits/tech_debt.txt
```

2. **Categorize by severity**:
   - `// TODO: implement` → CRITICAL (blocking)
   - `// FIXME: race condition` → HIGH (correctness)
   - `// HACK: workaround for X` → MEDIUM (maintainability)
   - `// TODO: optimize later` → LOW (performance)

3. **Either fix or create tracked issues** - no untracked TODOs in production code.

---

### P21: Type-Unsafe Error Handling (30+ occurrences) (HIGH)

**Symptom**: `catch (e: any)` or `catch (e)` with `.message` access.

**Fix**:

```typescript
// BAD
catch (e: any) {
  console.log(e.message);  // Crashes if e is not Error
}

// GOOD
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(message);
}

// ALSO GOOD - typed error wrapper
import { toErrorMessage } from '../utils/errors.js';

catch (error) {
  console.log(toErrorMessage(error));
}
```

```typescript
// src/utils/errors.ts

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}

export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(toErrorMessage(error));
}
```

---

### P22: @ts-ignore Bypass (15 occurrences) (MEDIUM)

**Symptom**: TypeScript safety disabled with `@ts-ignore` or `@ts-expect-error`.

**Fix**:

1. **Find all bypasses**:
```bash
grep -rn "@ts-ignore\|@ts-expect-error" src/ --include="*.ts" | grep -v __tests__
```

2. **For each occurrence**, determine why it exists:
   - Bad typing: Add proper types
   - Third-party lib issue: Use module augmentation or `declare`
   - Legitimate need: Document with `@ts-expect-error` and explanation

3. **Never use `@ts-ignore`** - use `@ts-expect-error` with explanation if truly needed.

---

### P23: 62 Disabled Test Files (HIGH)

**Symptom**: Large test coverage gaps. Unknown what's broken.

**Status**: Complete. Disabled tests are cleared; audit file reflects enabled/obsolete status.

**Fix**:

```bash
# Step 1: Inventory
find . -name "*.test.ts.disabled" -o -name "*.disabled" | wc -l

# Step 2: Create tracking
cat > state/audits/disabled_tests.json << 'EOF'
{
  "inventory": [],
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
# 2. Run: npm run test:tier0 -- --grep "filename"
# 3. If fails: fix or mark with reason
# 4. If passes: keep enabled
```

---

### P24: Execution Backends Missing (CRITICAL)

**Symptom**: All execution via `execSync` with no isolation, no resource limits, no parallelism.

**Fix**:

```typescript
// src/spine/execution_backends/types.ts

export type IsolationLevel = 'none' | 'process' | 'container' | 'vm';

export interface ExecOptions {
  workdir: string;
  timeout?: number;
  memoryLimit?: string;
  cpuLimit?: number;
  allowNetwork?: boolean;
  env?: Record<string, string>;
}

export interface ExecResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed?: boolean;
}

export interface ExecutionBackend {
  readonly name: string;
  readonly isolationLevel: IsolationLevel;
  isAvailable(): Promise<boolean>;
  execute(command: string[], options: ExecOptions): Promise<ExecResult>;
}
```

```typescript
// src/spine/execution_backends/local_backend.ts

import { spawn } from 'child_process';
import type { ExecutionBackend, ExecOptions, ExecResult } from './types.js';

export class LocalBackend implements ExecutionBackend {
  readonly name = 'local';
  readonly isolationLevel = 'process' as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(command: string[], options: ExecOptions): Promise<ExecResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const proc = spawn(command[0], command.slice(1), {
        cwd: options.workdir,
        env: { ...process.env, ...options.env },
        timeout: options.timeout ?? 120_000,
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code, signal) => {
        resolve({
          success: code === 0,
          exitCode: code ?? -1,
          stdout: stdout.slice(0, 100_000),
          stderr: stderr.slice(0, 100_000),
          durationMs: Date.now() - startTime,
          killed: signal === 'SIGTERM' || signal === 'SIGKILL'
        });
      });
    });
  }
}
```

```typescript
// src/spine/execution_backends/docker_backend.ts

export class DockerBackend implements ExecutionBackend {
  readonly name = 'docker';
  readonly isolationLevel = 'container' as const;
  private readonly image: string;

  constructor(image = 'node:20-slim') {
    this.image = image;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.runDockerInfo();
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async execute(command: string[], options: ExecOptions): Promise<ExecResult> {
    const dockerArgs = [
      'run', '--rm',
      '--workdir', '/workspace',
      '-v', `${options.workdir}:/workspace`,
      '--memory', options.memoryLimit ?? '512m',
      '--cpus', String(options.cpuLimit ?? 1),
      options.allowNetwork ? '' : '--network=none',
      this.image,
      ...command
    ].filter(Boolean);

    // ... execute docker command
  }
}
```

**Status (Implemented)**:
- Added `src/spine/execution_backends/types.ts`, `src/spine/execution_backends/local_backend.ts`, `src/spine/execution_backends/docker_backend.ts`.
- `execTool` now resolves a backend via `src/spine/execution_backends/index.ts` and hard-fails when sandbox is required but Docker is unavailable.

---

### P25: Policy Engine Stub (CRITICAL)

**Symptom**: Policies scattered across files, no centralized enforcement.

**Fix**:

```typescript
// src/spine/policy_engine.ts

export interface PolicyRule {
  id: string;
  name: string;
  action: 'allow' | 'deny' | 'require_approval';
  resource: string;  // Glob: 'file:src/**', 'cmd:rm *', 'network:*'
  reason: string;
}

export interface PolicyDecision {
  allowed: boolean;
  rule?: PolicyRule;
  reason: string;
  requiresApproval?: boolean;
}

export class PolicyEngine {
  private rules: PolicyRule[] = [];

  constructor() {
    this.loadDefaultRules();
  }

  private loadDefaultRules(): void {
    this.rules = [
      {
        id: 'deny-rm-rf-root',
        name: 'Block recursive root deletion',
        action: 'deny',
        resource: 'cmd:rm -rf /',
        reason: 'Catastrophic deletion blocked'
      },
      {
        id: 'deny-sudo',
        name: 'Block privilege escalation',
        action: 'deny',
        resource: 'cmd:sudo *',
        reason: 'Privilege escalation not allowed'
      },
      {
        id: 'deny-curl-pipe-sh',
        name: 'Block remote code execution',
        action: 'deny',
        resource: 'cmd:curl * | *sh*',
        reason: 'Remote code execution blocked'
      },
      {
        id: 'deny-env-files',
        name: 'Block committing env files',
        action: 'deny',
        resource: 'file:**/.env*',
        reason: 'Environment files must not be committed'
      }
    ];
  }

  evaluate(action: string, resource: string): PolicyDecision {
    for (const rule of this.rules) {
      if (this.matchesResource(resource, rule.resource)) {
        if (rule.action === 'deny') {
          return { allowed: false, rule, reason: rule.reason };
        }
        if (rule.action === 'require_approval') {
          return { allowed: false, rule, reason: rule.reason, requiresApproval: true };
        }
      }
    }

    return { allowed: true, reason: 'No blocking rules matched' };
  }

  private matchesResource(actual: string, pattern: string): boolean {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(actual);
  }
}

export const globalPolicyEngine = new PolicyEngine();
```

**Status (Implemented)**:
- Added `src/spine/policy_engine.ts` with rule evaluation and glob matching.
- Added `config/policies.json` for rule overrides; defaults load if file missing.
- `execTool` enforces command policy decisions and returns `unverified_by_trace(policy_denied)` on violations.

---

### P26: Domain Expert Routing Unimplemented (HIGH)

**Symptom**: Human review requests have no routing, just file-based polling.

**Status**: Implemented via `src/orchestrator/hitl/domain_expert_router.ts` and wired into `src/orchestrator/quality_gate_orchestrator.ts`.

**Notes**: When shadow/demo is disabled, domain expert review now generates HITL requests under `state/audits/hitl` and waits for human responses with timeout handling.

**Fix**:

```typescript
// src/orchestrator/hitl/domain_expert_router.ts

export interface HumanReviewRequest {
  id: string;
  taskId: string;
  type: 'approval' | 'judgment' | 'verification';
  title: string;
  description: string;
  context: { files: string[]; diff?: string; rationale: string };
  options: string[];
  createdAt: string;
  expiresAt?: string;
}

export interface HumanReviewResponse {
  requestId: string;
  decision: string;
  feedback?: string;
  reviewer?: string;
  respondedAt: string;
}

export class DomainExpertRouter {
  private readonly reviewDir: string;

  constructor(workspaceRoot: string) {
    this.reviewDir = join(workspaceRoot, 'state', 'audits', 'hitl');
  }

  async requestReview(request: HumanReviewRequest): Promise<HumanReviewResponse> {
    await mkdir(this.reviewDir, { recursive: true });

    const requestPath = join(this.reviewDir, `request_${request.id}.json`);
    await writeFile(requestPath, JSON.stringify(request, null, 2));

    console.log(`[HITL] Human review requested: ${requestPath}`);

    return this.waitForResponse(request.id, request.expiresAt);
  }

  private async waitForResponse(requestId: string, expiresAt?: string): Promise<HumanReviewResponse> {
    const responsePath = join(this.reviewDir, `response_${requestId}.json`);
    const timeout = expiresAt ? new Date(expiresAt).getTime() - Date.now() : 3600_000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (existsSync(responsePath)) {
        const content = await readFile(responsePath, 'utf-8');
        return JSON.parse(content) as HumanReviewResponse;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    return {
      requestId,
      decision: 'Timeout',
      feedback: `No response within ${Math.round(timeout / 60000)} minutes`,
      respondedAt: new Date().toISOString()
    };
  }
}
```

---

### P27: Agent Pool Undefined (HIGH)

**Symptom**: Comments say "stubs to satisfy TypeScript". No real agent management.

**Status**: Implemented capability-aware registry in `src/orchestrator/agent_registry.ts` and wired into `src/orchestrator/agent_pool.ts`.

**Notes**: Registry tracks availability + capability matches; selection blends registry scores with expertise heuristics for task routing.

**Fix**:

```typescript
// src/orchestrator/agent_registry.ts

export interface AgentCapability {
  domain: 'code' | 'test' | 'review' | 'docs' | 'security' | 'devops';
  languages?: string[];
}

export interface RegisteredAgent {
  id: string;
  name: string;
  capabilities: AgentCapability[];
  status: 'available' | 'busy' | 'offline';
  metrics: { tasksCompleted: number; successRate: number; avgDurationMs: number };
}

export class AgentRegistry {
  private agents = new Map<string, RegisteredAgent>();

  register(agent: Omit<RegisteredAgent, 'status' | 'metrics'>): void {
    this.agents.set(agent.id, {
      ...agent,
      status: 'available',
      metrics: { tasksCompleted: 0, successRate: 0, avgDurationMs: 0 }
    });
  }

  findByCapability(required: Partial<AgentCapability>): RegisteredAgent[] {
    return [...this.agents.values()]
      .filter(a => a.status === 'available')
      .filter(a => this.matchesCapability(a, required))
      .sort((a, b) => b.metrics.successRate - a.metrics.successRate);
  }

  acquire(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'available') return false;
    agent.status = 'busy';
    return true;
  }

  release(agentId: string, result: { success: boolean; durationMs: number }): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.status = 'available';
    agent.metrics.tasksCompleted++;

    const total = agent.metrics.tasksCompleted;
    agent.metrics.successRate =
      (agent.metrics.successRate * (total - 1) + (result.success ? 1 : 0)) / total;
    agent.metrics.avgDurationMs =
      (agent.metrics.avgDurationMs * (total - 1) + result.durationMs) / total;
  }
}

// Default registry with standard agents
export const globalAgentRegistry = new AgentRegistry();
globalAgentRegistry.register({ id: 'coder', name: 'General Coder', capabilities: [{ domain: 'code' }] });
globalAgentRegistry.register({ id: 'tester', name: 'Tester', capabilities: [{ domain: 'test' }] });
globalAgentRegistry.register({ id: 'reviewer', name: 'Reviewer', capabilities: [{ domain: 'review' }] });
```

---

### P28: Self-Modification Incomplete (HIGH)

**Status**: Implemented.

**What’s in place**:
- `EvolutionCoordinator` tracks task outcomes, updates `PolicyOptimizer`, and feeds fitness scores into `GenePoolManager`.
- Evolution state persists under `state/evolution/state.json`; outcome + generation reports are written under `state/evolution/outcomes/` and `state/evolution/generations/`.
- `UnifiedOrchestrator` wires `EvolutionCoordinator.init()` on startup and records outcomes on every task completion with gene IDs and quality scores.
- Evolved prompts are injected into task context via `GenePoolManager.selectPrompt()` and mapped in `taskGeneIdMap` for fitness attribution.

**Implementation references**:
- `src/self_evolution/evolution_coordinator.ts`
- `src/orchestrator/unified_orchestrator.ts`

---

### P29: promote_operator.ts Monolith (3700 lines) (MEDIUM)

**Symptom**: Single 3700-line file is unmaintainable.

**Implemented** (deviates from suggested filenames but preserves intent: split by phase, <400 lines each, promote_operator thin):

```
src/autopilot/
├── promote_operator.ts (thin re-export)
└── promotion/
    ├── run_autopilot.ts (<400 lines orchestrator)
    ├── artifact_context.ts
    ├── finalize_run.ts
    └── phases/
        ├── discovery_phase.ts
        ├── run_arbiter.ts
        ├── run_coordinator.ts
        ├── run_health_steward.ts
        ├── run_quality_critic.ts
        ├── run_security_critic.ts
        ├── run_subprocess_roles.ts
        ├── run_verifier.ts
        └── run_worker.ts
```

**Why the deviation**: The current promotion pipeline already uses role-based phases (coordinator/worker/verifier/critics/arbiter). Splitting along those roles keeps responsibilities explicit and preserves existing semantics without inventing new phase boundaries. `run_autopilot.ts` now orchestrates the role flow and delegates all heavy logic to phase modules.

---

### P30: OrchestratorLoop Legacy Debt (LOW)

**Symptom**: Multiple orchestrator implementations cause confusion.

**Status**: Complete.

**Implemented**:
- Archived `src/orchestrator/orchestrator_loop.ts` to `archive/legacy/orchestrator/orchestrator_loop.ts`.
- Updated `src/bin/autopilot.ts` to run `UnifiedOrchestrator.runContinuous()` instead of OrchestratorLoop.
- Updated `src/scas/integration/autopilot_integration.ts` to subscribe to `UnifiedOrchestrator` task events.
- Removed OrchestratorLoop exports from `src/orchestrator/index.ts`.
- Archived `src/orchestrator/core.ts` and `src/orchestrator/legacy_orchestrator.ts`.
- Replaced `TaskExecutionRouter` workflow bridge with `createWorkflowOrchestrator()` in `src/orchestrator/workflow_orchestrator.ts`.

**Notes**:
- Any remaining OrchestratorLoop coverage will be handled under P12/P23 test re-enable work.

---

### P31: UnifiedOrchestrator Size Creep (131KB) (MEDIUM)

**Symptom**: Single file growing too large for effective maintenance.

**Status**: Complete.

**Implemented**:
- Extracted prompt construction into `src/orchestrator/unified/prompt_builder.ts`.
- `UnifiedOrchestrator.buildPrompt()` now delegates to the shared prompt builder and records evolved gene IDs via `recordEvolvedPrompt`.
- Removed inline prompt-assembly helper methods from `UnifiedOrchestrator` to reduce file size and consolidate logic.
- Constructor initialization moved into `src/orchestrator/unified/orchestrator_init_*.ts` helpers.
- Startup lifecycle moved into `src/orchestrator/unified/start_support.ts`.
- Agent spawning delegated to `src/orchestrator/unified/agent_factory.ts`.
- Entropy/signal monitoring moved into `src/orchestrator/unified/entropy_monitor.ts`.

**Notes**:
- `unified_orchestrator.ts` is still large but now delegates core init/start/agent spawn/entropy tasks to dedicated modules.

---


---

**Next**: [validation.md](./validation.md) - Verification checklists and appendices
