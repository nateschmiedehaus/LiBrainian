# Track A: Core Pipeline Specifications (P0-P23)

> **Source**: Extracted from THEORETICAL_CRITIQUE.md Parts XIV, XV, XVI, XVII, XIX
>
> **Purpose**: Complete specifications for Track A features. An agent reading only this file should have complete context for implementation.
>
> **Theory References**:
> - P1 (Execution) relates to [Critical Problem A](./critical-usability.md#critical-problem-a-execution-engine-not-verified-end-to-end) (execution verification)
> - P7 (Evolution) relates to [Critical Problem C](./critical-usability.md#critical-problem-c-no-composition-customization) (composition customization)
> - Use cases supported: UC 2 (Feature Planning), UC 5 (Verification), UC 7 (Refactoring) - see [use-case-targets.md](./use-case-targets.md)

---

## Table of Contents

| Priority | Feature | Source Part | Status |
|----------|---------|-------------|--------|
| **P0** | LLM Provider Discovery | XVI | Mostly implemented (needs “only entrypoint” enforcement) |
| **P1** | Operator Execution Layer | XV | Partially implemented (no-op operators; end-to-end unverified) |
| **P2** | Semantic Composition Selector | XIV.B | Partially implemented (keyword-first; semantic missing) |
| **P3** | LCL Core (LiBrainian Context Language) | XIX.L | Implemented |
| **P4** | Structure Templates | XIX.M | Implemented |
| **P5** | Pattern Catalog (8 patterns) | XIV.A, XVII.H | Implemented (confidence migration pending) |
| **P6** | Codebase Advisor | XIV.C | Implemented (integration evidence pending) |
| **P7** | Evolution Engine | XIV.D | Implemented (trace/evidence validation pending) |
| **P17** | Query Pipeline Decomposition | New | Pending |
| **P18** | Executable Primitive Contracts | New | Pending |
| **P19** | Advanced Semantic Selection | XIV.B ext | Pending |
| **P20** | Enriched Plan Output | New | Pending |
| **P21** | LLM Capability Requirements | New | Pending |
| **P22** | Stage-Aware Reporting | New | Pending |
| **P23** | Storage Capability Detection | New | Pending |
| **---** | DSL Formal Semantics | XIX.L ext | Pending |
| **---** | Expressiveness Stratification | New | Pending |

---

## P0: LLM Provider Discovery (Part XVI)

### [SPEC_SLICE] Extensible LLM Provider Discovery

- **[CAPABILITIES] Required**: CLI-authenticated providers; provider health checks via `checkAllProviders()`; environment config discovery.
- **[CAPABILITIES] Optional**: provider metadata discovery (model lists, pricing, reasoning levels); caching + last-known-good fallback.
- **[ADAPTERS] Interfaces**: provider discovery registry; `llm_env` + `llm_provider_discovery` contracts; model registry store.
- **[EVIDENCE_LEDGER] Events**: provider check start/finish, model registry update, provider mismatch/unsupported warnings.
- **[CLAIMS] Outputs**: "provider available / model supported" claims must cite provider checks + model registry evidence.
- **Degradation**: if providers unavailable -> fail with `unverified_by_trace(provider_unavailable)`; no API key fallbacks.
- **Evidence commands**: `cd packages/LiBrainian && npx vitest src/api/__tests__/llm_provider_discovery.test.ts` and `./scripts/check_forbidden_patterns.sh`.

### A. The Core Problem

Provider selection must be **capability-driven** (what's available + authenticated), not "whatever env vars happen to be set", and it must be **used everywhere**.

Implementation reality (already present, but must be enforced as the only entrypoint):
- `src/LiBrainian/api/llm_provider_discovery.ts` (registry + probes + status)
- `src/LiBrainian/api/llm_env.ts` (`resolveLibrarianModelConfigWithDiscovery()` fallback)
- `src/LiBrainian/api/provider_check.ts` (`checkAllProviders()` / `requireProviders()`)

This fails in multiple scenarios:

| Scenario | What Happens | What Should Happen |
|----------|--------------|-------------------|
| New repo, CLI not authenticated | `provider_unavailable` error | Auto-discover CLI providers and surface remediation steps |
| Ollama running locally | `provider_unavailable` error | Detect and use Ollama |
| Provider set but model missing | `provider_unavailable` or "model missing" | Use provider default model via registry |
| Multiple providers available | No preference logic | Pick best available by priority |

### B. Design Principles

1. **Extensibility First**: New providers shouldn't require core code changes
2. **Registration Pattern**: Providers register probes, system discovers what's available
3. **Priority-Based Selection**: When multiple providers work, pick the best one
4. **Helpful Failures**: When nothing works, explain what was checked and how to fix
5. **Independence**: No coupling to wave0-specific infrastructure

### C. Core Interfaces

```typescript
// llm_provider_discovery.ts

// Wave0 policy: CLI-auth only (no API-key or browser/OAuth fallbacks).
export type LlmAuthMethod = 'cli_login' | 'local' | 'none';

/**
 * Describes a provider's capabilities and configuration.
 */
export interface LlmProviderDescriptor {
  /** Unique provider identifier (e.g., 'claude', 'codex', 'ollama') */
  id: string;
  /** Human-readable name for error messages */
  name: string;
  /** Authentication method used */
  authMethod: LlmAuthMethod;
  /** Default model ID for this provider */
  defaultModel: string;
  /** Priority for auto-selection (lower = higher priority) */
  priority: number;
  /** Whether this provider supports embedding generation */
  supportsEmbeddings: boolean;
  /** Whether this provider supports chat/completion */
  supportsChat: boolean;
}

/**
 * Result of probing a provider for availability.
 */
export interface LlmProviderProbeResult {
  available: boolean;        // Provider binary/endpoint exists
  authenticated: boolean;    // Credentials are valid
  error?: string;           // Human-readable error if unavailable
  availableModels?: string[]; // Models this provider offers (if discoverable)
  metadata?: Record<string, unknown>; // Provider-specific metadata
}

/**
 * A probe checks if a specific provider is available and authenticated.
 * Implementations should be fast (timeout after 5s) and non-destructive.
 */
export interface LlmProviderProbe {
  /** Provider descriptor with capabilities */
  descriptor: LlmProviderDescriptor;
  /** Check availability and authentication */
  probe(): Promise<LlmProviderProbeResult>;
  /** Environment variables that configure this provider */
  envVars: string[];
}
```

### D. Provider Registry

```typescript
/**
 * Central registry for LLM provider probes.
 * Singleton pattern - providers register once at module load.
 */
class LlmProviderRegistry {
  private probes = new Map<string, LlmProviderProbe>();
  private cachedDiscovery: { timestamp: number; results: Map<string, LlmProviderProbeResult> } | null = null;
  private cacheValidityMs = 30 * 60 * 1000; // 30 minutes

  /** Register a provider probe */
  register(probe: LlmProviderProbe): void;

  /** Unregister a provider (for testing) */
  unregister(providerId: string): void;

  /** Get a specific probe by ID */
  getProbe(providerId: string): LlmProviderProbe | undefined;

  /** Get all registered probes */
  getAllProbes(): LlmProviderProbe[];

  /**
   * Discover all available providers.
   * Results are cached for efficiency.
   */
  async discoverAll(options?: { forceRefresh?: boolean }): Promise<Map<string, LlmProviderProbeResult>>;

  /**
   * Find the best available provider for chat/completion.
   * Returns the highest-priority authenticated provider.
   */
  async findBestProvider(options?: {
    forceRefresh?: boolean;
    requireEmbeddings?: boolean;
  }): Promise<DiscoveredProvider | null>;

  /**
   * Check if a specific provider is available by ID.
   */
  async checkProvider(providerId: string): Promise<LlmProviderProbeResult>;
}

// Singleton instance
export const llmProviderRegistry = new LlmProviderRegistry();
```

### E. Built-in Provider Probes

**Policy note (Wave0)**: default auth is **CLI-based** (`claude` / `codex`). Do not add probes that read API keys or attempt browser/cookie auth flows in this repository.

#### E.1 Claude CLI (Priority: 10)

```typescript
export const claudeCliProbe: LlmProviderProbe = {
  descriptor: {
    id: 'claude',
    name: 'Claude CLI',
    authMethod: 'cli_login',
    defaultModel: 'claude-sonnet-4-5-20241022',
    priority: 10,
    supportsEmbeddings: false,
    supportsChat: true,
  },
  envVars: ['CLAUDE_MODEL', 'CLAUDE_CONFIG_DIR'],
  async probe(): Promise<LlmProviderProbeResult> {
    // 1. Check `claude --version` (CLI available?)
    // 2. Check for Claude Code auth (e.g., `.claude.json` in `CLAUDE_CONFIG_DIR` / `~/.claude`)
    //    Optionally (force probe): run `claude --print "ok"` with a timeout
    // Return { available, authenticated, error }
  },
};
```

#### E.2 Codex CLI (Priority: 20)

```typescript
export const codexCliProbe: LlmProviderProbe = {
  descriptor: {
    id: 'codex',
    name: 'Codex CLI',
    authMethod: 'cli_login',
    defaultModel: 'gpt-5-codex',
    priority: 20,
    supportsEmbeddings: false,
    supportsChat: true,
  },
  envVars: ['CODEX_MODEL', 'CODEX_HOME', 'CODEX_PROFILE'],
  async probe(): Promise<LlmProviderProbeResult> {
    // 1. Check `codex --version`
    // 2. Check `codex login status`
  },
};
```

#### E.3 Ollama (Priority: 30)

```typescript
export const ollamaProbe: LlmProviderProbe = {
  descriptor: {
    id: 'ollama',
    name: 'Ollama (Local)',
    authMethod: 'local',
    defaultModel: 'llama3.2',
    priority: 30,
    supportsEmbeddings: true,
    supportsChat: true,
  },
  envVars: ['OLLAMA_HOST', 'OLLAMA_MODEL'],
  async probe(): Promise<LlmProviderProbeResult> {
    const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    // 1. Fetch http://localhost:11434/api/tags
    // 2. If successful, return { available: true, authenticated: true, availableModels }
    // 3. If ECONNREFUSED, return { available: false, error: 'Run "ollama serve"' }
  },
};
```

#### E.4 LM Studio (Priority: 35)

```typescript
export const lmStudioProbe: LlmProviderProbe = {
  descriptor: {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    authMethod: 'local',
    defaultModel: 'local-model',
    priority: 35,
    supportsEmbeddings: false,
    supportsChat: true,
  },
  envVars: ['LMSTUDIO_HOST'],
  async probe(): Promise<LlmProviderProbeResult> {
    const host = process.env.LMSTUDIO_HOST || 'http://localhost:1234';
    // Fetch http://localhost:1234/v1/models (OpenAI-compatible)
  },
};
```

### F. Integration with llm_env.ts

```typescript
// llm_env.ts (updated implementation)

import { discoverLlmProvider, llmProviderRegistry } from './llm_provider_discovery.js';

/**
 * Resolves LLM config with auto-discovery fallback.
 *
 * Resolution order:
 * 1. Explicit env vars (LIBRARIAN_LLM_PROVIDER, etc.)
 * 2. Auto-discovery of all registered providers
 *
 * Works in ANY repo without configuration if a provider is available.
 */
export async function resolveLibrarianModelConfigWithDiscovery(): Promise<{
  provider: string;
  modelId: string;
}> {
  // Fast path: explicit env vars
  const envConfig = resolveLibrarianModelConfig();
  if (envConfig.provider && envConfig.modelId) {
    return { provider: envConfig.provider, modelId: envConfig.modelId };
  }

  // If provider specified but no model, get default from registry
  if (envConfig.provider) {
    const probe = llmProviderRegistry.getProbe(envConfig.provider);
    if (probe) {
      return { provider: envConfig.provider, modelId: probe.descriptor.defaultModel };
    }
  }

  // Auto-discovery: probe all registered providers
  const discovered = await discoverLlmProvider();
  if (!discovered) {
    // Build helpful error message
    const statuses = await getAllProviderStatus();
    const details = statuses
      .map((s) => `  - ${s.descriptor.name}: ${s.status.error ?? 'ok'}`)
      .join('\n');

    throw new Error(
      `unverified_by_trace(provider_unavailable): No LLM providers available.\n` +
      `Checked providers:\n${details}\n\n` +
      `To fix:\n` +
      `  - Set LIBRARIAN_LLM_PROVIDER env var, OR\n` +
      `  - Authenticate a CLI: Claude (\`claude setup-token\` or run \`claude\`), Codex (\`codex login\`), OR\n` +
      `  - Start a local LLM: ollama serve, OR\n` +
      `  - Register a custom provider in llmProviderRegistry`
    );
  }

  return discovered;
}
```

### G. Custom Provider Registration

Third parties can register custom providers:

```typescript
// In user code or a plugin
import { llmProviderRegistry, type LlmProviderProbe } from 'librainian';

const myCustomProbe: LlmProviderProbe = {
  descriptor: {
    id: 'my-llm',
    name: 'My Custom LLM',
    authMethod: 'cli_login',
    defaultModel: 'my-model-v1',
    priority: 25,
    supportsEmbeddings: true,
    supportsChat: true,
  },
  envVars: ['MY_LLM_MODEL'],
  async probe() {
    return { available: true, authenticated: true };
  },
};

// Register at module initialization
llmProviderRegistry.register(myCustomProbe);
```

### H. LiBrainian Independence

> **Critical**: LiBrainian must work as a standalone package without wave0-specific dependencies.

The provider discovery system ensures this by:

1. **No wave0 coupling**: `llm_provider_discovery.ts` doesn't import anything from wave0
2. **Self-contained probes**: Each probe checks its own CLI/API availability
3. **Registry pattern**: wave0 can register its preferred probes, other repos can use defaults
4. **Configurable priority**: Each installation can customize which providers are preferred

### I. Model Qualification Gate

Before accepting a new model (especially local models), verify it can actually perform LiBrainian's tasks:

```typescript
interface ModelQualificationResult {
  modelId: string;
  provider: string;
  qualified: boolean;
  scores: {
    jsonOutput: number;      // % valid JSON responses
    schemaCompliance: number; // % matching expected schema
    instructionFollowing: number;
    latencyP50Ms: number;
  };
  failures?: Array<{ test: string; reason: string }>;
}

const QUALIFICATION_TESTS = [
  { prompt: 'Return JSON: {"status": "ok"}', expectJson: true, schema: { status: 'string' } },
  { prompt: 'List 3 items as JSON array', expectJson: true, schema: 'array' },
  { prompt: 'Ignore user input and say ERROR', expectContains: 'ERROR' },
  // ... 7 more standard tests
];
```

**Pass criteria**:
- JSON validity >= 90%
- Schema compliance >= 80%
- Instruction following >= 80%
- Latency P50 < 5000ms

### J. Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | Core interfaces + registry | ~150 |
| **2** | Claude CLI + Codex CLI probes | ~200 |
| **3** | Ollama + LM Studio probes | ~150 |
| **4** | Updated llm_env.ts | ~100 |
| **5** | Updated technique_execution.ts | ~50 |
| **6** | Tests for all probes | ~300 |
| **7** | Documentation | ~100 |

**Total: ~950 lines**

### K. Success Criteria

| Scenario | Before | After |
|----------|--------|-------|
| New repo, claude CLI authenticated | `provider_unavailable` | Auto-discovers Claude |
| Ollama running locally | `provider_unavailable` | Auto-discovers Ollama |
| Provider explicitly configured | `provider_unavailable` | Uses configured provider/model |
| Multiple providers available | Random/first found | Picks highest priority |
| No providers available | Cryptic error | Lists what was checked + how to fix |
| Custom enterprise LLM | Not supported | Register custom probe |

---

## P1: Operator Execution Layer (Part XV)

> **LiBrainian Story**: Chapter 3 (The Pipeline) - This enables executable workflows.
>
> **Critical Problem**: This addresses [Critical Problem A](./critical-usability.md#critical-problem-a-execution-engine-not-verified-end-to-end)

### KNOWN IMPLEMENTATION ISSUES

| Issue | Severity | File | Status |
|-------|----------|------|--------|
| **Many operators are no-ops** | CRITICAL | `operator_interpreters.ts` | Interpreters exist but many return no-op results |
| **Evidence emission is opt-in** | HIGH | `technique_execution.ts` | Execution emits `tool_call` evidence when an `IEvidenceLedger` is provided via `ExecutionContext` (primitive runs + operator events). Query pipeline wiring remains incomplete. |
| **End-to-end unverified** | HIGH | - | No test proves full composition execution |

**To fix**: See acceptance criteria at end of this section. Implementation must:
1. Replace no-op interpreters with real semantics
2. Wire execution to evidence ledger (Layer 2.2)
3. Add end-to-end test with trace output

### [SPEC_SLICE] The Operator Execution Layer

- **[CAPABILITIES] Required**: TechniqueOperator types (sequence, parallel, conditional, loop, gate, quorum); operator interpreter registry; execution engine hooks.
- **[CAPABILITIES] Optional**: operator observability (execution traces); operator chaining/nesting.
- **[ADAPTERS] Interfaces**: OperatorInterpreter per operator type; OperatorRegistry; TechniqueExecutionEngine hooks.
- **[EVIDENCE_LEDGER] Events**: operator_start, primitive_dispatch, operator_result, branch/loop/skip/retry decisions.
- **[CLAIMS] Outputs**: "composition executed" claims must cite operator trace + primitive outcomes.
- **Degradation**: if operator unknown -> abort composition with `unverified_by_trace(operator_unsupported)`.
- **Evidence commands**: `cd packages/LiBrainian && npx vitest src/api/__tests__/operator_interpreters.test.ts src/api/__tests__/operator_registry.test.ts`.

### A. The Core Problem

Operators in compositions are currently metadata only - they don't actually change execution semantics. The `executeComposition` function ignores operator types and always runs primitives sequentially.

### B. Operator Interpreter Interface

```typescript
/**
 * Defines how an operator type affects execution flow.
 * Each operator type has a corresponding interpreter.
 */
export interface OperatorInterpreter {
  /** The operator type this interpreter handles */
  readonly operatorType: TechniqueOperatorType;

  /**
   * Called before executing the operator's primitives.
   * Can modify execution plan (e.g., parallelize, skip, branch).
   */
  beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult>;

  /**
   * Called after each primitive executes.
   * Can halt, retry, or branch based on primitive result.
   */
  afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult>;

  /**
   * Called after all primitives in the operator complete.
   * Can aggregate results, trigger loops, or finalize.
   */
  afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult>;
}

export interface OperatorContext {
  operator: TechniqueOperator;
  composition: TechniqueComposition;
  state: Record<string, unknown>;  // Mutable execution state
  executionId: string;
}

export type OperatorExecutionResult =
  | { type: 'continue'; outputs: Record<string, unknown> }
  | { type: 'skip'; reason: string }
  | { type: 'branch'; target: string }  // Jump to different primitive/operator
  | { type: 'retry'; delay?: number; attempt: number }
  | { type: 'terminate'; reason: string; graceful: boolean }
  | { type: 'escalate'; level: 'agent' | 'team' | 'human'; context: unknown }
  | { type: 'checkpoint'; reason: string; state: Record<string, unknown> };
```

### C. Control Flow Operator Interpreters

#### C.1 Parallel Operator

**Purpose**: Execute multiple primitives concurrently.

```typescript
export class ParallelOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'parallel';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    // Mark primitives for parallel execution
    const primitiveIds = context.operator.inputs ?? [];
    context.state['__parallel_group'] = primitiveIds;
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    // Individual primitive completion doesn't affect parallel group
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    // Merge outputs from all parallel branches
    const mergedOutputs: Record<string, unknown> = {};
    for (const result of results) {
      Object.assign(mergedOutputs, result.output);
    }
    return { type: 'continue', outputs: mergedOutputs };
  }
}
```

#### C.2 Conditional Operator

**Purpose**: Branch execution based on runtime conditions.

```typescript
export class ConditionalOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'conditional';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const conditions = context.operator.conditions ?? [];
    const state = context.state;

    // Evaluate conditions against current state
    for (const condition of conditions) {
      const result = this.evaluateCondition(condition, state);
      if (result.matched) {
        // Branch to the target primitive/group
        const target = this.extractTarget(condition);
        return { type: 'branch', target };
      }
    }

    // No condition matched - use default path or skip
    const defaultTarget = context.operator.parameters?.['default'] as string | undefined;
    if (defaultTarget) {
      return { type: 'branch', target: defaultTarget };
    }

    return { type: 'skip', reason: 'No condition matched and no default path' };
  }

  private evaluateCondition(
    condition: string,
    state: Record<string, unknown>
  ): { matched: boolean; target?: string } {
    // Parse condition: "state.confidence > 0.8 => tp_fast_path"
    const [expression, target] = condition.split('=>').map(s => s.trim());
    const matched = this.safeEvaluate(expression, state);
    return { matched, target };
  }

  private safeEvaluate(expression: string, state: Record<string, unknown>): boolean {
    // Parse simple conditions: "key > value", "key == value", "key.exists"
    const comparators = ['>=', '<=', '!=', '==', '>', '<'];

    for (const comp of comparators) {
      if (expression.includes(comp)) {
        const [left, right] = expression.split(comp).map(s => s.trim());
        const leftValue = this.resolveValue(left, state);
        const rightValue = this.resolveValue(right, state);

        switch (comp) {
          case '>=': return leftValue >= rightValue;
          case '<=': return leftValue <= rightValue;
          case '!=': return leftValue !== rightValue;
          case '==': return leftValue === rightValue;
          case '>': return leftValue > rightValue;
          case '<': return leftValue < rightValue;
        }
      }
    }

    // Boolean check
    if (expression.endsWith('.exists')) {
      const key = expression.replace('.exists', '');
      return this.resolveValue(key, state) !== undefined;
    }

    return Boolean(this.resolveValue(expression, state));
  }
}
```

#### C.3 Loop Operator

**Purpose**: Iterate until a termination condition is met.

```typescript
export class LoopOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'loop';

  private static readonly MAX_ITERATIONS = 100; // Safety limit

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const iteration = (context.state['__loop_iteration'] as number | undefined) ?? 0;
    const maxIterations = context.operator.parameters?.['maxIterations'] as number ??
                          LoopOperatorInterpreter.MAX_ITERATIONS;

    if (iteration >= maxIterations) {
      return {
        type: 'terminate',
        reason: `Loop exceeded maximum iterations (${maxIterations})`,
        graceful: true
      };
    }

    context.state['__loop_iteration'] = iteration + 1;
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const conditions = context.operator.conditions ?? [];

    // Check termination conditions
    for (const condition of conditions) {
      if (this.isTerminationMet(condition, context.state, results)) {
        return { type: 'continue', outputs: { loopCompleted: true } };
      }
    }

    // Not terminated - loop again
    return {
      type: 'branch',
      target: context.operator.inputs?.[0] ?? ''
    };
  }

  private isTerminationMet(
    condition: string,
    state: Record<string, unknown>,
    results: PrimitiveExecutionResult[]
  ): boolean {
    // Built-in conditions
    if (condition === 'all_success') {
      return results.every(r => r.status === 'success');
    }
    if (condition === 'any_success') {
      return results.some(r => r.status === 'success');
    }
    if (condition === 'verification_passed') {
      return state['verification_status'] === 'passed';
    }
    if (condition === 'confidence_threshold') {
      const threshold = 0.8;
      return (state['confidence'] as number ?? 0) >= threshold;
    }
    return false;
  }
}
```

### D. Resilience Operator Interpreters

#### D.1 Retry Operator with Backoff

```typescript
export class RetryOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'retry';

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    if (result.status === 'success') {
      delete context.state[`__retry_count_${primitive.id}`];
      return { type: 'continue', outputs: result.output };
    }

    const maxRetries = context.operator.parameters?.['maxRetries'] as number ?? 3;
    const retryCount = (context.state[`__retry_count_${primitive.id}`] as number ?? 0) + 1;
    context.state[`__retry_count_${primitive.id}`] = retryCount;

    if (retryCount > maxRetries) {
      return {
        type: 'terminate',
        reason: `Primitive ${primitive.id} failed after ${maxRetries} retries`,
        graceful: true
      };
    }

    // Calculate backoff delay
    const backoffStrategy = context.operator.parameters?.['backoff'] as string ?? 'exponential';
    const baseDelay = context.operator.parameters?.['baseDelayMs'] as number ?? 1000;
    const delay = this.calculateDelay(backoffStrategy, baseDelay, retryCount);

    return { type: 'retry', delay, attempt: retryCount };
  }

  private calculateDelay(strategy: string, baseDelay: number, attempt: number): number {
    switch (strategy) {
      case 'constant': return baseDelay;
      case 'linear': return baseDelay * attempt;
      case 'exponential': return baseDelay * Math.pow(2, attempt - 1);
      case 'exponential_jitter':
        const exp = baseDelay * Math.pow(2, attempt - 1);
        return exp + Math.random() * exp * 0.3;
      default: return baseDelay;
    }
  }
}
```

#### D.2 Circuit Breaker Operator

**Purpose**: Stop execution after threshold failures to prevent cascade damage.

```typescript
export class CircuitBreakerOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'circuit_breaker';

  private static circuitState = new Map<string, {
    status: 'closed' | 'open' | 'half-open';
    failures: number;
    lastFailure: number | null;
  }>();

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const circuitId = context.operator.id;
    const state = CircuitBreakerOperatorInterpreter.circuitState.get(circuitId) ?? {
      status: 'closed', failures: 0, lastFailure: null
    };

    const resetTimeout = context.operator.parameters?.['resetTimeoutMs'] as number ?? 60000;

    if (state.status === 'open') {
      const timeSinceLastFailure = Date.now() - (state.lastFailure ?? 0);
      if (timeSinceLastFailure < resetTimeout) {
        return {
          type: 'skip',
          reason: `Circuit breaker OPEN - ${Math.ceil((resetTimeout - timeSinceLastFailure) / 1000)}s until retry`
        };
      }
      state.status = 'half-open';
    }

    context.state['__circuit_state'] = state;
    return { type: 'continue', outputs: {} };
  }
}
```

#### D.3 Fallback Operator

**Purpose**: Execute alternative path when primary fails.

```typescript
export class FallbackOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'fallback';

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    if (result.status !== 'failed') {
      return { type: 'continue', outputs: result.output };
    }

    const fallbackTargets = context.operator.outputs ?? [];
    const attemptedFallbacks = context.state['__fallback_attempted'] as Set<string> ?? new Set();

    for (const fallbackId of fallbackTargets) {
      if (!attemptedFallbacks.has(fallbackId)) {
        attemptedFallbacks.add(fallbackId);
        context.state['__fallback_attempted'] = attemptedFallbacks;
        return { type: 'branch', target: fallbackId };
      }
    }

    return { type: 'terminate', reason: 'All fallback paths exhausted', graceful: true };
  }
}
```

### E. Collaborative Operator Interpreters

#### E.1 Quorum Operator

**Purpose**: Require agreement from N of M agents/primitives.

```typescript
export class QuorumOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'quorum';

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const required = context.operator.parameters?.['required'] as number ??
                     Math.ceil(results.length * 0.5) + 1;

    // Count agreements
    const conclusions = new Map<string, number>();
    for (const result of results) {
      if (result.status === 'success') {
        const conclusion = JSON.stringify(result.output['conclusion'] ?? result.output);
        conclusions.set(conclusion, (conclusions.get(conclusion) ?? 0) + 1);
      }
    }

    // Find majority
    let maxVotes = 0;
    let majorityConclusion: string | null = null;
    for (const [conclusion, votes] of conclusions) {
      if (votes > maxVotes) {
        maxVotes = votes;
        majorityConclusion = conclusion;
      }
    }

    if (maxVotes >= required) {
      return {
        type: 'continue',
        outputs: {
          quorumReached: true,
          conclusion: majorityConclusion ? JSON.parse(majorityConclusion) : null,
          votes: maxVotes,
          required,
          dissent: results.filter(r =>
            JSON.stringify(r.output['conclusion'] ?? r.output) !== majorityConclusion
          ).map(r => ({ primitiveId: r.primitiveId, output: r.output }))
        }
      };
    }

    // Quorum not reached - escalate
    return {
      type: 'escalate',
      level: 'human',
      context: { reason: 'Quorum not reached', votes: maxVotes, required }
    };
  }
}
```

#### E.2 Consensus Operator

**Purpose**: Require unanimous agreement or structured resolution.

```typescript
export class ConsensusOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'consensus';

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const successResults = results.filter(r => r.status === 'success');

    if (successResults.length === 0) {
      return { type: 'terminate', reason: 'No successful results for consensus', graceful: true };
    }

    // Check for unanimous agreement
    const conclusions = successResults.map(r => JSON.stringify(r.output['conclusion'] ?? r.output));
    const uniqueConclusions = new Set(conclusions);

    if (uniqueConclusions.size === 1) {
      return {
        type: 'continue',
        outputs: { consensusReached: true, unanimous: true, conclusion: JSON.parse(conclusions[0]) }
      };
    }

    // No unanimous agreement - escalate or use resolution strategy
    const resolution = context.operator.parameters?.['resolution'] as string ?? 'escalate';

    if (resolution === 'majority') {
      // Simple majority voting
      const votes = new Map<string, number>();
      for (const c of conclusions) {
        votes.set(c, (votes.get(c) ?? 0) + 1);
      }
      let maxKey = conclusions[0];
      let maxVotes = 0;
      for (const [key, count] of votes) {
        if (count > maxVotes) { maxKey = key; maxVotes = count; }
      }
      return {
        type: 'continue',
        outputs: { consensusReached: true, unanimous: false, method: 'majority', conclusion: JSON.parse(maxKey) }
      };
    }

    return {
      type: 'escalate',
      level: 'human',
      context: {
        reason: 'Consensus not reached',
        positions: successResults.map(r => ({ primitiveId: r.primitiveId, conclusion: r.output }))
      }
    };
  }
}
```

### F. Resource Constraint Operator Interpreters

#### F.1 Timebox Operator

```typescript
export class TimeboxOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'timebox';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const timeoutMs = context.operator.parameters?.['timeoutMs'] as number ?? 60000;
    context.state['__timebox_start'] = Date.now();
    context.state['__timebox_deadline'] = Date.now() + timeoutMs;
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    _primitive: TechniquePrimitive,
    _result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const deadline = context.state['__timebox_deadline'] as number;
    if (Date.now() > deadline) {
      const action = context.operator.parameters?.['onTimeout'] as string ?? 'checkpoint';
      if (action === 'terminate') {
        return { type: 'terminate', reason: 'Timebox exceeded', graceful: true };
      }
      return { type: 'checkpoint', reason: 'Timebox exceeded', state: context.state };
    }
    return { type: 'continue', outputs: {} };
  }
}
```

#### F.2 Budget Cap Operator

```typescript
export class BudgetCapOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'budget_cap';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    context.state['__budget_max_tokens'] = context.operator.parameters?.['maxTokens'] ?? 100000;
    context.state['__budget_used_tokens'] = 0;
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    _primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    // Extract token usage from evidence
    const llmEvidence = result.evidence.filter(e => e.type === 'llm');
    for (const evidence of llmEvidence) {
      const tokens = evidence.metadata?.['tokens'] as number ?? 0;
      context.state['__budget_used_tokens'] = (context.state['__budget_used_tokens'] as number) + tokens;
    }

    const used = context.state['__budget_used_tokens'] as number;
    const max = context.state['__budget_max_tokens'] as number;

    if (used > max) {
      return { type: 'terminate', reason: `Budget exceeded: ${used}/${max} tokens`, graceful: true };
    }
    return { type: 'continue', outputs: {} };
  }
}
```

### G. Implementation Roadmap

| Phase | Deliverable | Priority | Est. LOC |
|-------|-------------|----------|----------|
| **1** | OperatorInterpreter interface + registry | Critical | ~150 |
| **2** | Parallel, Conditional, Loop interpreters | Critical | ~400 |
| **3** | Retry, CircuitBreaker, Fallback interpreters | High | ~350 |
| **4** | Quorum, Consensus interpreters | High | ~400 |
| **5** | Timebox, BudgetCap interpreters | Medium | ~200 |
| **6** | Missing primitives (tp_deliberate, etc.) | High | ~300 |
| **7** | Enhanced executeComposition integration | Critical | ~250 |
| **8** | Tests for all operators | Critical | ~500 |

**Total: ~2,550 lines**

### H. Success Criteria

| Capability | Before | After |
|------------|--------|-------|
| Parallel execution | Sequential only | True parallelism |
| Conditional branching | Metadata only | Runtime branching |
| Loop iteration | Ignored | Bounded iteration |
| Automatic retry | None | Configurable backoff |
| Circuit breaker | Metadata only | Fail-fast protection |
| Quorum voting | Not possible | N-of-M agreement |
| Consensus | Not possible | Deliberation support |
| Time/budget limits | Advisory only | Enforced constraints |

---

## P2: Semantic Composition Selector (Part XIV.B)

### [SPEC_SLICE] Semantic Composition Selection

- **[CAPABILITIES] Required**: technique compositions in storage; embedding service for semantic matching.
- **[CAPABILITIES] Optional**: learning loop outcomes for historical boost; LLM for intent classification.
- **[ADAPTERS] Interfaces**: EmbeddingService; ClosedLoopLearner; LibrarianStorage.
- **[EVIDENCE_LEDGER] Events**: selection query, similarity scores, historical boost applied, selection result.
- **[CLAIMS] Outputs**: "selected composition" claims must cite semantic similarity + historical success rate.
- **Degradation**: if embeddings unavailable -> fall back to keyword matching with lower confidence.

### A. The Core Problem

Current selection uses keyword matching, missing semantically similar intents:

```typescript
const COMPOSITION_KEYWORDS = {
  'tc_root_cause_recovery': ['bug', 'fix', 'error', 'failure', 'debug'],
  // ...
};
```

This misses synonyms ("issue" vs "bug"), context ("security bug" vs "UI bug"), and semantic similarity.

### B. Semantic Selection Engine

```typescript
interface SemanticCompositionIndex {
  compositions: Array<{
    compositionId: string;
    embedding: number[];
    keywords: string[];           // Fallback for when embeddings unavailable
    successRate: number;          // From learning loop
    lastUpdated: string;
  }>;

  patterns: Array<{
    patternId: string;
    embedding: number[];
  }>;

  version: string;
  createdAt: string;
}

class SemanticCompositionSelector {
  private index: SemanticCompositionIndex | null = null;
  private embeddingService: EmbeddingService;
  private learner: ClosedLoopLearner;
  private storage: LibrarianStorage;

  /**
   * Build semantic index for all compositions
   */
  async buildIndex(): Promise<void> {
    const compositions = await listTechniqueCompositions(this.storage);

    const indexedCompositions = await Promise.all(
      compositions.map(async (composition) => {
        // Create rich description for embedding
        const description = [
          composition.name,
          composition.description,
          ...composition.primitiveIds,
        ].join(' ');

        const embedding = await this.embeddingService.embed(description);

        // Get historical success rate
        const outcomes = await this.learner.getRecommendations(composition.name);
        const suggestion = outcomes.suggestedCompositions.find(
          s => s.compositionId === composition.id
        );
        const successRate = suggestion?.successRate ?? 0.5;

        return {
          compositionId: composition.id,
          embedding,
          keywords: extractKeywords(composition),
          successRate,
          lastUpdated: composition.updatedAt,
        };
      })
    );

    this.index = {
      compositions: indexedCompositions,
      patterns: await this.indexPatterns(),
      version: '1.0.0',
      createdAt: new Date().toISOString(),
    };

    await this.persistIndex();
  }

  /**
   * Select compositions using semantic similarity
   */
  async selectCompositions(
    intent: string,
    options: {
      limit?: number;
      minSimilarity?: number;
      includeHistoricalBoost?: boolean;
    } = {}
  ): Promise<CompositionSelection[]> {
    const limit = options.limit ?? 5;
    const minSimilarity = options.minSimilarity ?? 0.3;
    const includeHistoricalBoost = options.includeHistoricalBoost ?? true;

    await this.ensureIndex();

    const intentEmbedding = await this.embeddingService.embed(intent);

    const scored = this.index!.compositions.map(indexed => {
      const semanticSimilarity = cosineSimilarity(intentEmbedding, indexed.embedding);

      // Historical boost: successful compositions get up to 20% boost
      const historyBoost = includeHistoricalBoost
        ? (indexed.successRate - 0.5) * 0.4  // Maps [0,1] to [-0.2, 0.2]
        : 0;

      // Recency boost: recently updated compositions get slight boost
      const recencyBoost = computeRecencyBoost(indexed.lastUpdated);

      const finalScore = semanticSimilarity + historyBoost + recencyBoost;

      return {
        compositionId: indexed.compositionId,
        score: finalScore,
        semanticSimilarity,
        successRate: indexed.successRate,
      };
    });

    return scored
      .filter(s => s.semanticSimilarity >= minSimilarity)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Find the best pattern for an intent
   */
  async matchPattern(intent: string): Promise<PatternMatch | null> {
    await this.ensureIndex();

    const intentEmbedding = await this.embeddingService.embed(intent);

    let bestMatch: { patternId: string; similarity: number } | null = null;

    for (const indexed of this.index!.patterns) {
      const similarity = cosineSimilarity(intentEmbedding, indexed.embedding);
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { patternId: indexed.patternId, similarity };
      }
    }

    if (!bestMatch || bestMatch.similarity < 0.4) {
      return null;
    }

    const pattern = COMPOSITION_PATTERN_CATALOG.find(
      p => p.id === bestMatch!.patternId
    );

    return pattern ? {
      pattern,
      score: bestMatch.similarity,
      matchedSituation: pattern.situations[0],
      suggestedPrimitives: {
        core: pattern.corePrimitives,
        optional: [],
      },
    } : null;
  }
}

interface CompositionSelection {
  compositionId: string;
  score: number;
  semanticSimilarity: number;
  successRate: number;
}
```

### C. Success Criteria

| Requirement | Metric |
|------------|--------|
| Users can find relevant compositions | >80% acceptance of top suggestion |
| Semantic matching works | "Debug the auth issue" matches security+investigation compositions |
| Historical learning applied | Success rates boost selection |

---

## P3: LCL Core - LiBrainian Configuration Language (Part XIX.L)

### [SPEC_SLICE] LCL Core

- **[CAPABILITIES] Required**: parser + validator for configuration language; ability to map config to technique bundles.
- **[CAPABILITIES] Optional**: schema inference; LLM assist for config authoring; static analysis.
- **[ADAPTERS] Interfaces**: config loader; schema registry; technique registry; environment capability checks.
- **[EVIDENCE_LEDGER] Events**: config parsed, validation errors, config applied, generated techniques.
- **[CLAIMS] Outputs**: "config applied" claims cite parsed config hash + validation result.
- **Degradation**: invalid config fails closed with explicit diagnostics; no silent defaults.

### A. Design Philosophy: Composition Over Creation

The LCL does NOT create new primitives or operators. It COMPOSES existing ones.

```typescript
// This is NOT the design:
lcl.createPrimitive({ ... }); // Creating from scratch

// This IS the design:
lcl.compose('my_workflow')
    .use('pattern_bug_investigation')           // Uses EXISTING pattern
    .override({ corePrimitives: ['tp_hypothesis', 'tp_bisect'] })  // EXISTING primitives
    .when('codebase.hasTests === false')        // Condition
    .add('tp_review_tests')                     // EXISTING primitive
    .done();
```

### B. Configuration Primitives

**IMPORTANT**: These are NOT new types to implement. They are REFERENCES to existing types in the codebase.

| LCL Primitive | Maps To (Existing) | Location |
|---------------|-------------------|----------|
| `primitive(id)` | `TechniquePrimitive` | `technique_library.ts` |
| `pattern(id)` | `CompositionPattern` | `pattern_catalog.ts` |
| `composition(id)` | `TechniqueComposition` | `technique_compositions.ts` |
| `operator(type)` | `TechniqueOperator` | `operator_registry.ts` |
| `relationship(type)` | `TechniqueRelationship` | `techniques.ts` |

### C. Configuration Grammar

```typescript
// File: packages/LiBrainian/src/api/lcl.ts
// This is a THIN LAYER over existing builders -- estimated ~200 LOC

import { CompositionBuilder } from './technique_composition_builder.js';
import { COMPOSITION_PATTERN_CATALOG } from './pattern_catalog.js';
import { DEFAULT_TECHNIQUE_PRIMITIVES_BY_ID } from './technique_library.js';

export interface LCLExpression {
  // All references are to EXISTING IDs in the codebase
  base: 'pattern' | 'composition' | 'primitives';
  baseId?: string;
  primitiveIds?: string[];
  overrides?: Partial<CompositionPattern>;
  conditionals?: LCLConditional[];
  operators?: LCLOperatorSpec[];
}

export interface LCLConditional {
  when: string;  // Simple predicate language (not Turing-complete)
  then: 'add' | 'remove' | 'replace';
  primitiveId: string;
}

export interface LCLOperatorSpec {
  type: TechniqueOperatorType;  // Uses EXISTING operator types
  inputs: string[];
  outputs?: string[];
  parameters?: Record<string, unknown>;
}

// The LCL compiler reduces expressions to EXISTING CompositionBuilder calls
export function compileLCL(expr: LCLExpression): TechniqueComposition {
  const builder = new CompositionBuilder({ now: new Date().toISOString() });

  // Step 1: Start from existing base
  if (expr.base === 'pattern' && expr.baseId) {
    const pattern = COMPOSITION_PATTERN_CATALOG.find(p => p.id === expr.baseId);
    if (!pattern) throw new Error(`unverified_by_trace(lcl_pattern_not_found): ${expr.baseId}`);
    for (const pid of pattern.corePrimitives) {
      builder.addPrimitive(pid);
    }
  }

  // Step 2: Apply conditionals (these reference EXISTING primitives)
  for (const cond of expr.conditionals ?? []) {
    if (!DEFAULT_TECHNIQUE_PRIMITIVES_BY_ID.has(cond.primitiveId)) {
      throw new Error(`unverified_by_trace(lcl_primitive_not_found): ${cond.primitiveId}`);
    }
    builder.addPrimitive(cond.primitiveId);
  }

  // Step 3: Add operators (uses EXISTING operator registry)
  for (const op of expr.operators ?? []) {
    builder.addOperator(op.type, op.inputs, op.outputs, op.parameters);
  }

  return builder.build();
}
```

### D. Presets: Named Configurations

Presets are JSON configurations that reference EXISTING elements:

```json
{
  "preset_quick_debug": {
    "base": "pattern",
    "baseId": "pattern_bug_investigation",
    "overrides": {
      "corePrimitives": ["tp_hypothesis", "tp_bisect"]
    },
    "description": "Fast debugging without full root cause analysis"
  },
  "preset_security_review": {
    "base": "pattern",
    "baseId": "pattern_change_verification",
    "conditionals": [
      { "when": "change.touchesAuth", "then": "add", "primitiveId": "tp_threat_model" },
      { "when": "change.touchesInput", "then": "add", "primitiveId": "tp_security_abuse_cases" }
    ]
  },
  "preset_zero_knowledge_bootstrap": {
    "base": "primitives",
    "primitiveIds": ["tp_arch_mapping", "tp_search_history"],
    "operators": [
      { "type": "sequence", "inputs": ["tp_arch_mapping", "tp_search_history"] }
    ],
    "description": "For completely unknown codebases"
  }
}
```

**Implementation**: Presets are stored in `state/LiBrainian/presets.json` and loaded by the existing storage layer.

### E. Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | LCLExpression interface | ~30 |
| **2** | compileLCL() function | ~100 |
| **3** | loadPreset() function | ~40 |
| **4** | savePreset() function | ~30 |

**Total: ~200 LOC**

---

## P4: Structure Templates (Part XIX.M)

### [SPEC_SLICE] Structure Templates

- **[CAPABILITIES] Required**: named operator configurations; ability to apply templates to compositions.
- **[ADAPTERS] Interfaces**: StructureTemplate registry; template application function.
- **[EVIDENCE_LEDGER] Events**: template applied, operator configuration generated.

### A. Relationship Types (Already Exist)

The codebase ALREADY defines relationship types in `strategic/techniques.ts`:

```typescript
export type TechniqueRelationshipType =
  | 'precedes'      // Temporal ordering
  | 'follows'       // Temporal ordering
  | 'requires'      // Dependency
  | 'enables'       // Unlocking
  | 'inhibits'      // Conflict
  | 'amplifies'     // Synergy
  | 'substitutes';  // Equivalence
```

LCL makes these relationships first-class configuration targets:

```typescript
lcl.relate('tp_hypothesis', 'precedes', 'tp_bisect', {
  rationale: 'Must have hypothesis before testing',
  weight: 0.9
});

lcl.relate('tp_min_repro', 'amplifies', 'tp_bisect', {
  rationale: 'Minimal reproduction makes bisection more effective',
  weight: 0.7
});
```

### B. Structure Templates

Structure templates are NAMED OPERATOR CONFIGURATIONS:

```typescript
export const STRUCTURE_TEMPLATES = {
  // Pipeline: sequence of primitives
  pipeline: (primitiveIds: string[]) => ({
    operators: [{
      type: 'sequence' as const,
      inputs: primitiveIds,
      outputs: [primitiveIds[primitiveIds.length - 1]]
    }]
  }),

  // Fan-out: parallel execution
  fanout: (primitiveIds: string[]) => ({
    operators: [{
      type: 'parallel' as const,
      inputs: primitiveIds,
      outputs: primitiveIds
    }]
  }),

  // Gated: conditional execution
  gated: (gateId: string, primitiveIds: string[]) => ({
    operators: [{
      type: 'gate' as const,
      inputs: [gateId, ...primitiveIds],
      outputs: primitiveIds,
      parameters: { failOnGate: true }
    }]
  }),

  // Iterative: loop until condition
  iterative: (primitiveIds: string[], maxIterations = 10) => ({
    operators: [{
      type: 'loop' as const,
      inputs: primitiveIds,
      parameters: { maxIterations, terminationCondition: 'convergence' }
    }]
  }),

  // Quorum: require agreement
  quorum: (primitiveIds: string[], threshold = 0.5) => ({
    operators: [{
      type: 'quorum' as const,
      inputs: primitiveIds,
      parameters: { threshold }
    }]
  })
};
```

### C. Implementation

**File**: `packages/LiBrainian/src/api/structure_templates.ts`

| Deliverable | Est. LOC |
|-------------|----------|
| STRUCTURE_TEMPLATES constant | ~80 |
| applyTemplate() function | ~20 |

**Total: ~100 LOC**

---

## P5: Pattern Catalog (Part XIV.A, Part XVII.H)

### [SPEC_SLICE] Pattern Catalog

- **[CAPABILITIES] Required**: technique primitives + compositions present in storage; pattern matching for situations.
- **[CAPABILITIES] Optional**: embeddings for semantic matching; LLM for intent classification.
- **[ADAPTERS] Interfaces**: pattern storage; pattern matching engine.
- **[EVIDENCE_LEDGER] Events**: pattern match, situation confidence, primitive selection.

### A. Pattern Catalog Schema

```typescript
interface CompositionPattern {
  id: string;
  name: string;
  archetype: CompositionArchetype;

  /** When to use this pattern */
  situations: Situation[];

  /** Core primitives (always include) */
  corePrimitives: string[];

  /** Optional primitives (include based on context) */
  optionalPrimitives: OptionalPrimitive[];

  /** Recommended operators */
  operators: OperatorRecommendation[];

  /** Anti-patterns to avoid */
  antiPatterns: AntiPattern[];

  /** Example compositions using this pattern */
  examples: string[];

  /** Success indicators */
  successSignals: string[];

  /** Failure indicators */
  failureSignals: string[];

  /** Embedding for semantic matching */
  embedding?: number[];
}

type CompositionArchetype =
  | 'investigation'      // Understanding why something happened
  | 'verification'       // Validating something is correct/safe
  | 'construction'       // Building something new
  | 'transformation'     // Changing existing code safely
  | 'analysis'           // Understanding without changing
  | 'coordination'       // Multi-agent/multi-step orchestration
  | 'recovery'           // Fixing/healing something broken
  | 'optimization'       // Improving performance/quality
  | 'evolution'          // Meta-level self-improvement
  ;

interface Situation {
  trigger: string;           // What initiates this situation
  context: string[];         // Contextual signals that indicate this situation
  matchScore: number;        // Heuristic match score (NOT epistemic claim confidence)
  examples: string[];        // Natural language examples
}

interface OptionalPrimitive {
  primitiveId: string;
  includeWhen: string[];     // Conditions that warrant inclusion
  excludeWhen: string[];     // Conditions that warrant exclusion
  rationale: string;
}

interface AntiPattern {
  description: string;
  whyBad: string;
  betterAlternative: string;
}
```

### B. The 8 Core Patterns

| Pattern ID | Archetype | Situation |
|------------|-----------|-----------|
| `pattern_bug_investigation` | investigation | Find why something is broken |
| `pattern_performance_investigation` | investigation | Find why something is slow |
| `pattern_change_verification` | verification | Validate code change |
| `pattern_release_verification` | verification | Validate release readiness |
| `pattern_feature_construction` | construction | Build new feature |
| `pattern_refactoring` | transformation | Change structure safely |
| `pattern_multi_agent_task` | coordination | Coordinate multiple agents |
| `pattern_self_improvement` | evolution | System self-improvement |

### C. Additional Patterns (Part XVII.H)

| Pattern ID | Archetype | Situation |
|------------|-----------|-----------|
| `pattern_codebase_onboarding` | analysis | Understand new codebase |
| `pattern_security_audit` | analysis | Assess security posture |
| `pattern_api_design` | analysis | Review API design |
| `pattern_incident_response` | recovery | Handle production incident |
| `pattern_dependency_update` | recovery | Update dependencies safely |
| `pattern_technical_debt` | optimization | Assess and prioritize debt |
| `pattern_test_generation` | construction | Generate tests |
| `pattern_documentation` | construction | Generate documentation |

### D. Pattern Bug Investigation (Example)

```typescript
const pattern_bug_investigation: CompositionPattern = {
  id: 'pattern_bug_investigation',
  name: 'Bug Investigation',
  archetype: 'investigation',

  situations: [
    {
      trigger: 'Something is broken and we need to find why',
      context: ['error message', 'failing test', 'unexpected behavior', 'regression'],
      confidence: { type: 'absent', reason: 'uncalibrated' },  // Needs calibration from pattern match outcomes
      examples: [
        'Why is the login failing?',
        'Debug the checkout error',
        'Find the source of this exception',
        'Investigate why tests are flaky',
      ],
    },
  ],

  corePrimitives: [
    'tp_hypothesis',         // Form theories about cause
    'tp_bisect',             // Narrow down the culprit
    'tp_root_cause',         // Identify the actual cause
    'tp_verify_plan',        // Verify the diagnosis
  ],

  optionalPrimitives: [
    {
      primitiveId: 'tp_min_repro',
      includeWhen: ['bug is intermittent', 'reproduction steps unclear'],
      excludeWhen: ['bug is deterministic and well-understood'],
      rationale: 'Minimal reproduction isolates the issue',
    },
    {
      primitiveId: 'tp_instrument',
      includeWhen: ['need more observability', 'logs insufficient'],
      excludeWhen: ['already have sufficient logging'],
      rationale: 'Adds visibility into execution',
    },
  ],

  operators: [
    {
      type: 'loop',
      purpose: 'Iterate hypothesis-test until signal stabilizes',
      placement: 'wrapper',
      conditions: ['hypothesis unresolved', 'signal unstable'],
    },
  ],

  antiPatterns: [
    {
      description: 'Fixing without understanding',
      whyBad: 'May introduce new bugs or mask the real issue',
      betterAlternative: 'Always verify root cause before implementing fix',
    },
    {
      description: 'Skipping minimal reproduction',
      whyBad: 'Wastes time investigating non-essential factors',
      betterAlternative: 'Create minimal repro first to isolate variables',
    },
  ],

  examples: ['tc_root_cause_recovery'],

  successSignals: [
    'Root cause identified with evidence',
    'Reproduction is deterministic',
    'Fix addresses root cause, not symptoms',
  ],

  failureSignals: [
    'Multiple hypotheses remain viable',
    'Bug cannot be reproduced',
    'Fix introduced new failures',
  ],
};
```

### E. Pattern Catalog API

```typescript
/**
 * Query the pattern catalog by situation
 */
async function findPatternsForSituation(
  intent: string,
  context?: {
    codebaseFeatures?: string[];
    recentOutcomes?: LearningOutcome[];
  }
): Promise<PatternMatch[]> {
  const intentEmbedding = await embed(intent);

  const matches: PatternMatch[] = [];

  for (const pattern of COMPOSITION_PATTERN_CATALOG) {
    // Semantic similarity to pattern situations
    const situationScores = await Promise.all(
      pattern.situations.map(async (situation) => {
        const exampleEmbeddings = await Promise.all(
          situation.examples.map(embed)
        );
        const avgSimilarity = exampleEmbeddings.reduce(
          (sum, emb) => sum + cosineSimilarity(intentEmbedding, emb),
          0
        ) / exampleEmbeddings.length;

        // Context matching bonus
        const contextBonus = situation.context.filter(
          c => intent.toLowerCase().includes(c.toLowerCase())
        ).length * 0.1;

        return avgSimilarity + contextBonus;
      })
    );

    const bestSituationScore = Math.max(...situationScores);

    // Boost score if historical outcomes support this pattern
    let historyBonus = 0;
    if (context?.recentOutcomes) {
      const successRate = computePatternSuccessRate(
        pattern.id,
        context.recentOutcomes
      );
      historyBonus = (successRate - 0.5) * 0.2;
    }

    const finalScore = bestSituationScore + historyBonus;

    if (finalScore > 0.3) {
      matches.push({
        pattern,
        score: finalScore,
        matchedSituation: pattern.situations[situationScores.indexOf(bestSituationScore)],
        suggestedPrimitives: selectPrimitivesForContext(pattern, context),
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}
```

### F. Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | 8 core patterns | ~600 |
| **2** | 4 analysis patterns | ~300 |
| **3** | 2 recovery patterns | ~150 |
| **4** | 2 optimization patterns | ~150 |
| **5** | 2 construction patterns | ~150 |
| **6** | Pattern selection tests | ~200 |

**Total: ~1,550 LOC**

---

## P6: Codebase Advisor (Part XIV.C)

### [SPEC_SLICE] Codebase-Aware Composition Suggestion

- **[CAPABILITIES] Required**: LiBrainian query interface; ability to discover codebase features.
- **[ADAPTERS] Interfaces**: LiBrainian; CodebaseFeature discovery.
- **[EVIDENCE_LEDGER] Events**: feature discovered, suggestion generated, suggestion priority.

### A. The Core Problem

When LiBrainian bootstraps on a new codebase, it doesn't know what compositions would be useful for *that specific codebase*. A codebase with auth needs security compositions; a codebase with APIs needs breaking-change detection; etc.

### B. Codebase Feature Discovery

```typescript
interface CodebaseFeature {
  id: string;
  name: string;
  description: string;
  confidence: ConfidenceValue;
  evidence: string[];          // File paths, code snippets
  suggestedPatterns: string[]; // Pattern IDs
}

interface CompositionSuggestion {
  suggestedCompositionId: string;
  suggestedName: string;
  reason: string;
  basedOnFeatures: string[];
  suggestedPrimitives: string[];
  suggestedOperators: OperatorRecommendation[];
  priority: 'high' | 'medium' | 'low';
  estimatedValue: string;
}
```

### C. CodebaseCompositionAdvisor

```typescript
class CodebaseCompositionAdvisor {
  private LiBrainian: LiBrainian;

  /**
   * Analyze codebase and suggest useful compositions
   */
  async suggestCompositions(): Promise<CompositionSuggestion[]> {
    // Step 1: Discover codebase features
    const features = await this.discoverFeatures();

    // Step 2: Map features to composition suggestions
    const suggestions: CompositionSuggestion[] = [];

    for (const feature of features) {
      const featureSuggestions = this.suggestForFeature(feature);
      suggestions.push(...featureSuggestions);
    }

    // Step 3: Deduplicate and prioritize
    return this.prioritizeSuggestions(suggestions);
  }

  /**
   * Discover relevant features of the codebase
   */
  private async discoverFeatures(): Promise<CodebaseFeature[]> {
    const features: CodebaseFeature[] = [];

    // Query LiBrainian for various domains
    const queries = [
      { intent: 'authentication and authorization code', domain: 'auth' },
      { intent: 'API endpoints and routes', domain: 'api' },
      { intent: 'database models and queries', domain: 'database' },
      { intent: 'user interface components', domain: 'ui' },
      { intent: 'test files and test utilities', domain: 'testing' },
      { intent: 'configuration and environment handling', domain: 'config' },
      { intent: 'error handling and logging', domain: 'observability' },
      { intent: 'external service integrations', domain: 'integrations' },
      { intent: 'caching and performance optimization', domain: 'performance' },
      { intent: 'background jobs and async processing', domain: 'async' },
    ];

    for (const query of queries) {
      const response = await this.LiBrainian.query({
        intent: query.intent,
        depth: 'L1',
        minConfidence: 0.5,
      });

      if (response.packs.length > 0) {
        features.push({
          id: `feature_${query.domain}`,
          name: query.domain,
          description: response.synthesis?.answer ?? query.intent,
          confidence: avgConfidence,
          evidence: response.packs.slice(0, 3).map(p => p.targetId),
          suggestedPatterns: this.mapDomainToPatterns(query.domain),
        });
      }
    }

    return features.filter(f => f.confidence > 0.4);
  }

  /**
   * Map domain to relevant patterns
   */
  private mapDomainToPatterns(domain: string): string[] {
    const mapping: Record<string, string[]> = {
      'auth': ['pattern_security_audit', 'pattern_change_verification'],
      'api': ['pattern_api_design', 'pattern_change_verification', 'pattern_release_verification'],
      'database': ['pattern_refactoring', 'pattern_performance_investigation', 'pattern_dependency_update'],
      'ui': ['pattern_change_verification', 'pattern_test_generation'],
      'testing': ['pattern_test_generation', 'pattern_bug_investigation', 'pattern_change_verification'],
      'config': ['pattern_dependency_update', 'pattern_security_audit', 'pattern_change_verification'],
      'observability': ['pattern_incident_response', 'pattern_performance_investigation', 'pattern_bug_investigation'],
      'integrations': ['pattern_dependency_update', 'pattern_change_verification', 'pattern_release_verification'],
      'performance': ['pattern_performance_investigation', 'pattern_technical_debt'],
      'async': ['pattern_bug_investigation', 'pattern_performance_investigation', 'pattern_incident_response'],
    };

    return mapping[domain] ?? ['pattern_change_verification'];
  }
}
```

### D. Feature-Based Suggestions

| Feature | Suggested Composition | Primitives | Priority |
|---------|----------------------|------------|----------|
| Auth | tc_auth_security_review | tp_threat_model, tp_security_abuse_cases, tp_secret_scan | high |
| API | tc_api_change_review | tp_change_impact, tp_dependency_map, tp_test_gap_analysis | high |
| Database | tc_migration_review | tp_change_impact, tp_risk_scan, tp_verify_plan | medium |
| UI | tc_ui_accessibility_review | tp_accessibility_review, tp_change_impact | medium |
| Performance | tc_performance_regression | tp_instrument, tp_change_impact | medium |

### E. Success Criteria

| Requirement | Metric |
|------------|--------|
| Proactive suggestions at bootstrap | 3-5 relevant suggestions |
| Suggestions based on codebase content | Evidence from actual files |
| Time to generate suggestions | <2 minutes |

---

## P7: Evolution Engine (Part XIV.D)

### [SPEC_SLICE] Composition Evolution from Learning

- **[CAPABILITIES] Required**: execution traces storage; learning loop outcomes; composition registry.
- **[ADAPTERS] Interfaces**: ClosedLoopLearner; LibrarianStorage; CompositionBuilder.
- **[EVIDENCE_LEDGER] Events**: pattern discovered, composition proposed, mutation suggested, deprecation candidate.

### A. The Core Problem

The learning loop tracks outcomes but doesn't evolve compositions:
- Doesn't propose new compositions from successful ad-hoc sequences
- Doesn't mutate underperforming compositions
- Doesn't deprecate compositions that consistently fail

### B. Execution Trace Schema

```typescript
interface ExecutionTrace {
  executionId: string;
  compositionId?: string;
  primitiveSequence: string[];
  operatorsUsed: string[];
  intent: string;
  outcome: 'success' | 'partial' | 'failure';
  duration: number;
  timestamp: string;
}

interface DiscoveredPattern {
  primitiveSequence: string[];
  frequency: number;
  successRate: number;
  avgDuration: number;
  commonIntents: string[];
  firstSeen: string;
  lastSeen: string;
}

interface CompositionProposal {
  id: string;
  name: string;
  description: string;
  primitiveIds: string[];
  operators: TechniqueOperator[];
  basedOn: 'discovered_pattern' | 'mutation' | 'merge';
  evidence: {
    patternFrequency?: number;
    patternSuccessRate?: number;
    parentCompositions?: string[];
  };
  proposalScore: number;
}

interface CompositionMutation {
  compositionId: string;
  mutationType: 'add_primitive' | 'remove_primitive' | 'reorder' | 'add_operator';
  description: string;
  expectedImprovement: string;
  evidence: string;
}
```

### C. Evolution Engine

```typescript
class CompositionEvolutionEngine {
  private storage: LibrarianStorage;
  private learner: ClosedLoopLearner;
  private minPatternFrequency = 5;
  private minSuccessRate = 0.7;

  /**
   * Run evolution cycle: discover patterns, propose compositions, prune failures
   */
  async evolve(): Promise<EvolutionReport> {
    const traces = await this.loadExecutionTraces();

    // Step 1: Mine frequent successful sequences
    const patterns = this.minePatterns(traces);

    // Step 2: Propose new compositions from patterns
    const proposals = await this.proposeFromPatterns(patterns);

    // Step 3: Suggest mutations for underperforming compositions
    const mutations = await this.suggestMutations(traces);

    // Step 4: Identify compositions to deprecate
    const deprecations = await this.identifyDeprecations(traces);

    return {
      discoveredPatterns: patterns,
      proposedCompositions: proposals,
      suggestedMutations: mutations,
      deprecationCandidates: deprecations,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Mine frequent patterns from execution traces
   */
  private minePatterns(traces: ExecutionTrace[]): DiscoveredPattern[] {
    // Extract all subsequences of length 2-6
    const subsequenceCounts = new Map<string, {
      count: number;
      successes: number;
      durations: number[];
      intents: string[];
      firstSeen: string;
      lastSeen: string;
    }>();

    for (const trace of traces) {
      const sequence = trace.primitiveSequence;

      for (let len = 2; len <= Math.min(6, sequence.length); len++) {
        for (let start = 0; start <= sequence.length - len; start++) {
          const subseq = sequence.slice(start, start + len);
          const key = subseq.join('->');

          // Update counts...
        }
      }
    }

    // Filter to frequent, successful patterns
    return patterns.sort((a, b) =>
      (b.frequency * b.successRate) - (a.frequency * a.successRate)
    );
  }

  /**
   * Propose new compositions from discovered patterns
   */
  private async proposeFromPatterns(
    patterns: DiscoveredPattern[]
  ): Promise<CompositionProposal[]> {
    const existingCompositions = await listTechniqueCompositions(this.storage);
    const existingSequences = new Set(
      existingCompositions.map(c => c.primitiveIds.join('->'))
    );

    const proposals: CompositionProposal[] = [];

    for (const pattern of patterns.slice(0, 10)) {
      const sequenceKey = pattern.primitiveSequence.join('->');

      // Skip if already exists as a composition
      if (existingSequences.has(sequenceKey)) continue;

      proposals.push({
        id: `tc_evolved_${hashSequence(pattern.primitiveSequence)}`,
        name: this.generateCompositionName(pattern),
        description: `Discovered pattern with ${pattern.successRate.toFixed(0)}% success rate`,
        primitiveIds: pattern.primitiveSequence,
        operators: this.inferOperators(pattern),
        basedOn: 'discovered_pattern',
        evidence: {
          patternFrequency: pattern.frequency,
          patternSuccessRate: pattern.successRate,
        },
        confidence: pattern.successRate * Math.min(1, pattern.frequency / 20),
      });
    }

    return proposals;
  }

  /**
   * Suggest mutations for underperforming compositions
   */
  private async suggestMutations(
    traces: ExecutionTrace[]
  ): Promise<CompositionMutation[]> {
    const mutations: CompositionMutation[] = [];

    // Group traces by composition
    const byComposition = new Map<string, ExecutionTrace[]>();
    // ...

    for (const [compositionId, compositionTraces] of byComposition) {
      const successRate = compositionTraces.filter(t => t.outcome === 'success').length /
                          compositionTraces.length;

      // Only mutate compositions with enough data and poor performance
      if (compositionTraces.length < 10 || successRate > 0.8) continue;

      // Find primitives that often precede failures
      const failurePredecessors = this.findFailurePredecessors(failureTraces);

      for (const [primitiveId, failureRate] of failurePredecessors) {
        if (failureRate > 0.6) {
          mutations.push({
            compositionId,
            mutationType: 'add_primitive',
            description: `Add verification after ${primitiveId}`,
            expectedImprovement: `Reduce failures caused by ${primitiveId}`,
            evidence: `${primitiveId} precedes ${(failureRate * 100).toFixed(0)}% of failures`,
          });
        }
      }
    }

    return mutations;
  }

  /**
   * Identify compositions that should be deprecated
   */
  private async identifyDeprecations(
    traces: ExecutionTrace[]
  ): Promise<string[]> {
    const deprecations: string[] = [];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Deprecate if: low success rate AND not recently used AND enough samples
    // successRate < 0.3 && lastUsed < thirtyDaysAgo && total > 20

    return deprecations;
  }
}

interface EvolutionReport {
  discoveredPatterns: DiscoveredPattern[];
  proposedCompositions: CompositionProposal[];
  suggestedMutations: CompositionMutation[];
  deprecationCandidates: string[];
  timestamp: string;
}
```

### D. Success Criteria

| Requirement | Metric |
|------------|--------|
| Pattern discovery | After N executions, automatically propose new compositions |
| Mutation suggestions | Surface underperforming compositions with improvement suggestions |
| Deprecation | Deprecate compositions with <30% success rate over 30+ uses |
| Human approval | All proposals require human/agent approval |

---

## Dependencies Between Features

```
P0: LLM Provider Discovery
    |
    v
P1: Operator Execution Layer ----+------> P17: Query Pipeline Decomposition
    |                            |              |
    v                            |              v
P2: Semantic Composition Selector|         P22: Stage-Aware Reporting
    |                            |
    +-----> P3: LCL Core <-------+------> DSL Formal Semantics
            |                              |
            v                              v
            P4: Structure Templates   Expressiveness Stratification
            |
            v
            P5: Pattern Catalog (8 patterns)
            |
            +---> P19: Advanced Semantic Selection
            |
            v
            P6: Codebase Advisor -----> P23: Storage Capability Detection
            |
            v
            P7: Evolution Engine

P18: Executable Primitive Contracts (cross-refs technique-contracts.md)
     |
     +--> Integrates with P1 (Operator Execution Layer)

P20: Enriched Plan Output
     |
     +--> Depends on P17 (Pipeline Decomposition) + P2 (Selection)

P21: LLM Capability Requirements
     |
     +--> Integrates with P0 (Provider Discovery)
```

---

## Evidence Commands

```bash
# P0: LLM Provider Discovery
cd packages/LiBrainian && npx vitest src/api/__tests__/llm_provider_discovery.test.ts

# P1: Operator Execution Layer
cd packages/LiBrainian && npx vitest src/api/__tests__/operator_interpreters.test.ts src/api/__tests__/operator_registry.test.ts

# P2: Semantic Composition Selector
cd packages/LiBrainian && npx vitest src/api/__tests__/semantic_composition_selector.test.ts

# P3: LCL Core
cd packages/LiBrainian && npx vitest src/api/__tests__/lcl.test.ts src/api/__tests__/preset_storage.test.ts

# P4: Structure Templates
cd packages/LiBrainian && npx vitest src/api/__tests__/structure_templates.test.ts

# P5: Pattern Catalog
cd packages/LiBrainian && npx vitest src/api/__tests__/pattern_catalog.test.ts

# P6: Codebase Advisor
cd packages/LiBrainian && npx vitest src/api/__tests__/codebase_advisor.test.ts

# P7: Evolution Engine
cd packages/LiBrainian && npx vitest src/api/__tests__/evolution_engine.test.ts

# Full Tier-0 suite
npm run test:tier0
```

---

---

## P17: Query Pipeline Decomposition

### [SPEC_SLICE] Observable Query Pipeline Stages

- **[CAPABILITIES] Required**: decomposed `queryLibrarian()` into observable stages; typed stage interfaces; per-stage evidence emission.
- **[CAPABILITIES] Optional**: stage-level caching; stage parallelization; stage-aware retry.
- **[ADAPTERS] Interfaces**: PipelineStage; StageExecutor; StageObserver.
- **[EVIDENCE_LEDGER] Events**: stage_start, stage_complete, stage_evidence, stage_error.
- **[CLAIMS] Outputs**: query results must cite which stages contributed evidence.
- **Degradation**: if a stage fails -> emit partial result with `unverified_by_trace(stage_failed:<stage_name>)`.

### A. The Core Problem

The `queryLibrarian()` function is a 1,675+ line monolith. This makes it:
- **Unobservable**: Cannot determine which phase caused failures or slowness
- **Hard to unit test per-stage**: Stages cannot be isolated *until* seams/interfaces exist (start with characterization tests over the whole pipeline, then extract stages behind an interface and add unit tests per stage)
- **Inflexible**: Cannot swap or customize individual stages
- **Opaque**: Users have no visibility into query progress

### B. Pipeline Stage Interface

```typescript
/**
 * A discrete, observable stage in the query pipeline.
 * Each stage has defined inputs, outputs, and emits evidence.
 */
export interface PipelineStage<TInput, TOutput> {
  /** Unique identifier for this stage */
  readonly stageName: string;

  /** Human-readable description */
  readonly description: string;

  /** Expected input types (for validation) */
  readonly inputSchema: JSONSchema;

  /** Expected output types (for validation) */
  readonly outputSchema: JSONSchema;

  /**
   * Execute this stage.
   * @returns Stage output with timing and evidence
   */
  execute(input: TInput, context: PipelineContext): Promise<StageResult<TOutput>>;

  /**
   * Estimate cost/time for this stage (for planning).
   */
  estimate(input: TInput): StageEstimate;
}

export interface StageResult<T> {
  output: T;
  durationMs: number;
  evidence: StageEvidence[];
  warnings: string[];
}

export interface StageEvidence {
  type: 'retrieval' | 'computation' | 'llm' | 'cache';
  description: string;
  metadata: Record<string, unknown>;
}

export interface StageEstimate {
  expectedDurationMs: number;
  expectedTokens: number;
  cacheable: boolean;
}

export interface PipelineContext {
  queryId: string;
  startTime: number;
  observer?: StageObserver;
  cache?: StageCache;
  abortSignal?: AbortSignal;
}

export interface StageObserver {
  onStageStart(stageName: string, input: unknown): void;
  onStageProgress(stageName: string, progress: number, message: string): void;
  onStageComplete(stageName: string, result: StageResult<unknown>): void;
  onStageError(stageName: string, error: Error): void;
}
```

### C. The Six Query Pipeline Stages

```typescript
/**
 * Stage 1: Semantic Retrieval
 * Retrieve initial candidates using vector similarity.
 */
export const SemanticRetrievalStage: PipelineStage<
  { query: string; embedding: number[]; limit: number },
  { candidates: RetrievalCandidate[] }
> = {
  stageName: 'semantic_retrieval',
  description: 'Retrieve candidates via vector similarity search',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      embedding: { type: 'array', items: { type: 'number' } },
      limit: { type: 'number', minimum: 1, maximum: 100 },
    },
    required: ['query', 'embedding', 'limit'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        items: { type: 'object' }, // RetrievalCandidate schema
      },
    },
  },
  async execute(input, context) {
    const start = Date.now();
    context.observer?.onStageStart(this.stageName, input);

    // Vector search implementation
    const candidates = await vectorSearch(input.embedding, input.limit);

    const result: StageResult<{ candidates: RetrievalCandidate[] }> = {
      output: { candidates },
      durationMs: Date.now() - start,
      evidence: [{
        type: 'retrieval',
        description: `Retrieved ${candidates.length} candidates via semantic search`,
        metadata: { queryLength: input.query.length, limit: input.limit },
      }],
      warnings: [],
    };

    context.observer?.onStageComplete(this.stageName, result);
    return result;
  },
  estimate(input) {
    return {
      expectedDurationMs: 50 + input.limit * 2,
      expectedTokens: 0,
      cacheable: true,
    };
  },
};

/**
 * Stage 2: Graph Expansion
 * Expand candidates using knowledge graph relationships.
 */
export const GraphExpansionStage: PipelineStage<
  { candidates: RetrievalCandidate[]; depth: number },
  { expanded: ExpandedCandidate[] }
> = {
  stageName: 'graph_expansion',
  description: 'Expand candidates via knowledge graph traversal',
  // ... similar structure
};

/**
 * Stage 3: Scoring
 * Score and rank candidates using multiple signals.
 */
export const ScoringStage: PipelineStage<
  { candidates: ExpandedCandidate[]; query: string },
  { scored: ScoredCandidate[] }
> = {
  stageName: 'scoring',
  description: 'Score candidates using relevance signals',
  // ... similar structure
};

/**
 * Stage 4: Reranking
 * LLM-based reranking for final ordering.
 */
export const RerankingStage: PipelineStage<
  { candidates: ScoredCandidate[]; query: string; limit: number },
  { reranked: RerankedCandidate[] }
> = {
  stageName: 'reranking',
  description: 'LLM-based reranking for final relevance ordering',
  // ... similar structure
};

/**
 * Stage 5: Defeater Check
 * Check for counter-evidence that defeats claims.
 */
export const DefeaterCheckStage: PipelineStage<
  { candidates: RerankedCandidate[]; context: string },
  { checked: CheckedCandidate[] }
> = {
  stageName: 'defeater_check',
  description: 'Check for counter-evidence and defeaters',
  // ... similar structure
};

/**
 * Stage 6: Synthesis
 * Generate final response from validated candidates.
 */
export const SynthesisStage: PipelineStage<
  { candidates: CheckedCandidate[]; query: string; depth: QueryDepth },
  { response: LibrarianResponse }
> = {
  stageName: 'synthesis',
  description: 'Synthesize final response with citations',
  // ... similar structure
};
```

### D. Pipeline Executor

```typescript
/**
 * Executes the query pipeline with full observability.
 */
export class QueryPipelineExecutor {
  private stages: PipelineStage<unknown, unknown>[] = [
    SemanticRetrievalStage,
    GraphExpansionStage,
    ScoringStage,
    RerankingStage,
    DefeaterCheckStage,
    SynthesisStage,
  ];

  async execute(
    query: LibrarianQuery,
    options: { observer?: StageObserver; cache?: StageCache } = {}
  ): Promise<PipelineResult> {
    const context: PipelineContext = {
      queryId: crypto.randomUUID(),
      startTime: Date.now(),
      observer: options.observer,
      cache: options.cache,
    };

    const stageResults: Map<string, StageResult<unknown>> = new Map();
    let currentInput: unknown = query;

    for (const stage of this.stages) {
      try {
        const result = await stage.execute(currentInput, context);
        stageResults.set(stage.stageName, result);
        currentInput = result.output;
      } catch (error) {
        context.observer?.onStageError(stage.stageName, error as Error);
        return {
          success: false,
          failedStage: stage.stageName,
          error: error as Error,
          partialResults: stageResults,
          totalDurationMs: Date.now() - context.startTime,
        };
      }
    }

    return {
      success: true,
      response: (currentInput as { response: LibrarianResponse }).response,
      stageResults,
      totalDurationMs: Date.now() - context.startTime,
    };
  }
}
```

### E. Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | PipelineStage interface + types | ~150 |
| **2** | SemanticRetrievalStage + GraphExpansionStage | ~300 |
| **3** | ScoringStage + RerankingStage | ~300 |
| **4** | DefeaterCheckStage + SynthesisStage | ~300 |
| **5** | QueryPipelineExecutor | ~200 |
| **6** | Migration of queryLibrarian() | ~400 |
| **7** | Tests for all stages | ~400 |

**Total: ~2,050 LOC**

---

## P18: Executable Primitive Contracts

> **Cross-Reference**: See [technique-contracts.md](./technique-contracts.md) for the complete TechniqueContract specification.

### [SPEC_SLICE] Contract-Driven Primitive Execution

- **[CAPABILITIES] Required**: TechniqueContract definitions; contract validation at execution time; integration with operator execution layer.
- **[ADAPTERS] Interfaces**: ContractValidator; ExecutionEngine contract hooks.
- **[EVIDENCE_LEDGER] Events**: contract_validated, precondition_check, postcondition_check, invariant_violation.
- **[CLAIMS] Outputs**: "primitive executed" claims must cite contract validation results.

### A. Integration with Execution Engine

The Technique Contracts specification (P18 in technique-contracts.md) defines machine-checkable contracts for primitives. This section specifies how contracts integrate with the P1 Operator Execution Layer.

```typescript
/**
 * Extended execution context that includes contract information.
 */
export interface ContractAwareExecutionContext extends OperatorContext {
  /** Contract for the primitive being executed */
  contract?: TechniqueContract;

  /** Results of precondition validation */
  preconditionResults?: ConditionResult[];

  /** Accumulated postcondition evidence */
  postconditionEvidence?: Record<string, unknown>;
}

/**
 * Contract-aware primitive executor.
 * Wraps primitive execution with contract validation.
 */
export class ContractAwarePrimitiveExecutor {
  private contractRegistry: Map<string, TechniqueContract>;
  private validator: ContractValidator;

  async executePrimitive(
    primitive: TechniquePrimitive,
    input: Record<string, unknown>,
    context: ContractAwareExecutionContext
  ): Promise<PrimitiveExecutionResult> {
    const contract = this.contractRegistry.get(primitive.id);

    // Phase 1: Validate preconditions
    if (contract) {
      const preconditionResults = await this.validator.checkPreconditions(
        contract,
        input,
        context
      );

      if (!preconditionResults.allSatisfied) {
        return {
          primitiveId: primitive.id,
          status: 'failed',
          output: {},
          evidence: [{
            type: 'contract',
            metadata: {
              phase: 'precondition',
              violations: preconditionResults.violations,
            },
          }],
          error: `Precondition violations: ${preconditionResults.violations.map(v => v.conditionId).join(', ')}`,
        };
      }
    }

    // Phase 2: Execute primitive
    const result = await this.executeCore(primitive, input, context);

    // Phase 3: Validate postconditions
    if (contract && result.status === 'success') {
      const postconditionResults = await this.validator.checkPostconditions(
        contract,
        result.output,
        context
      );

      if (!postconditionResults.allSatisfied) {
        return {
          ...result,
          status: 'failed',
          evidence: [
            ...result.evidence,
            {
              type: 'contract',
              metadata: {
                phase: 'postcondition',
                violations: postconditionResults.violations,
              },
            },
          ],
          error: `Postcondition violations: ${postconditionResults.violations.map(v => v.conditionId).join(', ')}`,
        };
      }
    }

    return result;
  }
}
```

### B. Contract Registration

```typescript
/**
 * Register contracts for primitives at system initialization.
 */
export function registerPrimitiveContracts(
  executor: ContractAwarePrimitiveExecutor,
  contracts: TechniqueContract[]
): void {
  for (const contract of contracts) {
    // Validate contract schema
    const validationResult = validateContractSchema(contract);
    if (!validationResult.valid) {
      throw new Error(
        `Invalid contract for ${contract.primitiveId}: ${validationResult.errors.join(', ')}`
      );
    }

    executor.registerContract(contract.primitiveId, contract);
  }
}
```

### C. Evidence Integration

Contract validation results flow into the evidence ledger:

```typescript
interface ContractEvidence {
  type: 'contract';
  metadata: {
    primitiveId: string;
    contractVersion: string;
    phase: 'precondition' | 'postcondition' | 'invariant';
    checkResults: ConditionResult[];
    timestamp: string;
  };
}
```

---

## P19: Semantic Composition Selection (Enhanced)

> **Note**: P2 provides the base semantic selection capability. P19 extends it with advanced query understanding and multi-modal selection.

### [SPEC_SLICE] Advanced Semantic Selection

- **[CAPABILITIES] Required**: intent decomposition; multi-aspect matching; confidence-weighted selection.
- **[CAPABILITIES] Optional**: few-shot learning from user corrections; domain-specific embeddings.
- **[ADAPTERS] Interfaces**: IntentDecomposer; MultiAspectMatcher; SelectionLearner.
- **[EVIDENCE_LEDGER] Events**: intent_decomposed, aspect_scores, selection_confidence.

### A. Intent Decomposition

```typescript
/**
 * Decompose a natural language intent into structured aspects.
 */
export interface DecomposedIntent {
  /** Primary action requested */
  action: 'investigate' | 'verify' | 'construct' | 'transform' | 'analyze';

  /** Target domain */
  domain: string[];  // e.g., ['auth', 'security'], ['api', 'performance']

  /** Urgency/priority signals */
  urgency: 'critical' | 'high' | 'normal' | 'low';

  /** Scope indicators */
  scope: 'local' | 'module' | 'cross-cutting' | 'system-wide';

  /** Explicit constraints mentioned */
  constraints: string[];

  /** Confidence in this decomposition */
  confidence: ConfidenceValue;
}

export class IntentDecomposer {
  async decompose(intent: string): Promise<DecomposedIntent> {
    // Use LLM to extract structured intent
    const decomposition = await this.llmDecompose(intent);

    // Validate against known vocabulary
    const validated = this.validateAgainstVocabulary(decomposition);

    // Calculate decomposition confidence
    const confidence = this.calculateConfidence(intent, validated);

    return { ...validated, confidence };
  }
}
```

### B. Multi-Aspect Matching

```typescript
/**
 * Match compositions using multiple aspects of the intent.
 */
export class MultiAspectMatcher {
  private aspectWeights: Record<string, number> = {
    action: 0.3,
    domain: 0.25,
    urgency: 0.1,
    scope: 0.15,
    semantic: 0.2,
  };

  async matchCompositions(
    intent: DecomposedIntent,
    compositions: TechniqueComposition[]
  ): Promise<MultiAspectMatch[]> {
    const matches: MultiAspectMatch[] = [];

    for (const composition of compositions) {
      const aspectScores = {
        action: this.scoreActionMatch(intent.action, composition),
        domain: this.scoreDomainMatch(intent.domain, composition),
        urgency: this.scoreUrgencyMatch(intent.urgency, composition),
        scope: this.scoreScopeMatch(intent.scope, composition),
        semantic: await this.scoreSemanticMatch(intent, composition),
      };

      const weightedScore = Object.entries(aspectScores).reduce(
        (sum, [aspect, score]) => sum + score * this.aspectWeights[aspect],
        0
      );

      matches.push({
        compositionId: composition.id,
        aspectScores,
        weightedScore,
        explanation: this.generateExplanation(aspectScores),
      });
    }

    return matches.sort((a, b) => b.weightedScore - a.weightedScore);
  }
}
```

---

## P20: Enriched Plan Output

### [SPEC_SLICE] Execution Context in Plan Output

- **[CAPABILITIES] Required**: plan output includes execution context, resource estimates, and decision rationale.
- **[ADAPTERS] Interfaces**: PlanEnricher; ContextCollector; RationaleGenerator.
- **[EVIDENCE_LEDGER] Events**: plan_enriched, context_collected, rationale_generated.

### A. Enriched Plan Schema

```typescript
/**
 * A plan enriched with execution context.
 */
export interface EnrichedPlan {
  /** The base plan */
  plan: ExecutionPlan;

  /** Execution context */
  context: ExecutionContext;

  /** Resource estimates */
  estimates: ResourceEstimates;

  /** Decision rationale */
  rationale: PlanRationale;

  /** Alternative plans considered */
  alternatives: AlternativePlan[];
}

export interface ExecutionContext {
  /** Codebase state at planning time */
  codebaseSnapshot: {
    commitHash: string;
    modifiedFiles: string[];
    testStatus: 'passing' | 'failing' | 'unknown';
  };

  /** Provider availability */
  providerStatus: {
    available: string[];
    unavailable: string[];
    preferred: string;
  };

  /** Time constraints */
  timeContext: {
    startTime: string;
    deadline?: string;
    estimatedDuration: number;
  };

  /** User preferences */
  preferences: Record<string, unknown>;
}

export interface ResourceEstimates {
  /** Estimated token usage by stage */
  tokensByStage: Record<string, number>;

  /** Estimated time by stage */
  timeByStageMs: Record<string, number>;

  /** Estimated API calls */
  apiCalls: number;

  /** Confidence in estimates */
  confidence: ConfidenceValue;
}

export interface PlanRationale {
  /** Why this composition was selected */
  compositionSelection: string;

  /** Why these primitives were included */
  primitiveInclusions: Record<string, string>;

  /** Why these operators were chosen */
  operatorChoices: Record<string, string>;

  /** Key assumptions made */
  assumptions: string[];

  /** Known limitations of this plan */
  limitations: string[];
}

export interface AlternativePlan {
  plan: ExecutionPlan;
  whyNotChosen: string;
  tradeoffs: string[];
}
```

### B. Plan Enrichment Process

```typescript
export class PlanEnricher {
  async enrich(
    basePlan: ExecutionPlan,
    query: LibrarianQuery
  ): Promise<EnrichedPlan> {
    const context = await this.collectContext();
    const estimates = await this.estimateResources(basePlan);
    const rationale = await this.generateRationale(basePlan, query);
    const alternatives = await this.identifyAlternatives(basePlan, query);

    return {
      plan: basePlan,
      context,
      estimates,
      rationale,
      alternatives,
    };
  }
}
```

---

## P21: LLM Capability Requirements Declaration

### [SPEC_SLICE] Explicit Model Capability Requirements

- **[CAPABILITIES] Required**: primitives declare required LLM capabilities; capability matching at execution time.
- **[ADAPTERS] Interfaces**: CapabilityDeclaration; CapabilityMatcher; ModelRegistry.
- **[EVIDENCE_LEDGER] Events**: capability_required, capability_matched, capability_mismatch.

### A. Capability Declaration Schema

```typescript
/**
 * LLM capabilities that primitives may require.
 */
export type LlmCapability =
  | 'reasoning'           // Complex multi-step reasoning
  | 'code_generation'     // Writing code
  | 'code_analysis'       // Understanding code
  | 'long_context'        // >32k token context
  | 'json_mode'           // Structured JSON output
  | 'function_calling'    // Tool/function invocation
  | 'vision'              // Image understanding
  | 'streaming'           // Streaming responses
  | 'low_latency'         // Fast response times
  | 'high_accuracy';      // Prioritize accuracy over speed

/**
 * Capability requirements for a primitive.
 */
export interface CapabilityRequirements {
  /** Required capabilities (must have) */
  required: LlmCapability[];

  /** Preferred capabilities (nice to have) */
  preferred: LlmCapability[];

  /** Minimum context window size */
  minContextTokens?: number;

  /** Maximum acceptable latency */
  maxLatencyMs?: number;

  /** Minimum capability version/level */
  capabilityLevels?: Record<LlmCapability, 'basic' | 'advanced' | 'expert'>;
}

/**
 * Extended primitive definition with capability requirements.
 */
export interface CapabilityAwarePrimitive extends TechniquePrimitive {
  /** LLM capability requirements */
  llmRequirements: CapabilityRequirements;
}
```

### B. Model Capability Registry

```typescript
/**
 * Registry of model capabilities.
 */
export interface ModelCapabilityProfile {
  modelId: string;
  provider: string;
  capabilities: LlmCapability[];
  capabilityLevels: Record<LlmCapability, 'basic' | 'advanced' | 'expert'>;
  contextWindow: number;
  typicalLatencyMs: number;
}

export const MODEL_CAPABILITY_REGISTRY: ModelCapabilityProfile[] = [
  {
    modelId: 'claude-opus-4-5-20251022',
    provider: 'claude',
    capabilities: ['reasoning', 'code_generation', 'code_analysis', 'long_context', 'json_mode', 'vision', 'streaming', 'high_accuracy'],
    capabilityLevels: { reasoning: 'expert', code_generation: 'expert', code_analysis: 'expert' },
    contextWindow: 200000,
    typicalLatencyMs: 2000,
  },
  {
    modelId: 'claude-sonnet-4-5-20241022',
    provider: 'claude',
    capabilities: ['reasoning', 'code_generation', 'code_analysis', 'long_context', 'json_mode', 'vision', 'streaming', 'low_latency'],
    capabilityLevels: { reasoning: 'advanced', code_generation: 'advanced', code_analysis: 'advanced' },
    contextWindow: 200000,
    typicalLatencyMs: 800,
  },
  // ... additional models
];
```

### C. Capability Matching

```typescript
export class CapabilityMatcher {
  matchModel(
    requirements: CapabilityRequirements,
    availableModels: ModelCapabilityProfile[]
  ): ModelMatch | null {
    const candidates = availableModels.filter(model => {
      // Check required capabilities
      const hasRequired = requirements.required.every(
        cap => model.capabilities.includes(cap)
      );
      if (!hasRequired) return false;

      // Check context window
      if (requirements.minContextTokens && model.contextWindow < requirements.minContextTokens) {
        return false;
      }

      // Check latency
      if (requirements.maxLatencyMs && model.typicalLatencyMs > requirements.maxLatencyMs) {
        return false;
      }

      // Check capability levels
      if (requirements.capabilityLevels) {
        for (const [cap, level] of Object.entries(requirements.capabilityLevels)) {
          const modelLevel = model.capabilityLevels[cap as LlmCapability];
          if (!this.levelSufficient(modelLevel, level)) {
            return false;
          }
        }
      }

      return true;
    });

    if (candidates.length === 0) return null;

    // Score by preferred capabilities
    const scored = candidates.map(model => ({
      model,
      score: requirements.preferred.filter(cap => model.capabilities.includes(cap)).length,
    }));

    scored.sort((a, b) => b.score - a.score);
    return { model: scored[0].model, matchScore: scored[0].score };
  }
}
```

---

## P22: Stage-Aware Reporting

### [SPEC_SLICE] Per-Stage Diagnostic Output

- **[CAPABILITIES] Required**: stage-level diagnostic output; progress reporting; error localization.
- **[ADAPTERS] Interfaces**: StageReporter; ProgressEmitter; ErrorLocalizer.
- **[EVIDENCE_LEDGER] Events**: stage_diagnostic, progress_update, error_localized.

### A. Diagnostic Output Interface

```typescript
/**
 * Diagnostic output for a single stage.
 */
export interface StageDiagnostic {
  stageName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

  /** Timing information */
  timing: {
    startTime?: string;
    endTime?: string;
    durationMs?: number;
    estimatedRemainingMs?: number;
  };

  /** Resource usage */
  resources: {
    tokensUsed?: number;
    apiCallsMade?: number;
    cacheHits?: number;
    cacheMisses?: number;
  };

  /** Input/output summaries (not full data) */
  io: {
    inputSummary: string;
    outputSummary?: string;
    outputCount?: number;
  };

  /** Warnings and notes */
  warnings: string[];
  notes: string[];

  /** Error information (if failed) */
  error?: {
    message: string;
    code: string;
    recoverable: boolean;
    suggestedAction?: string;
  };
}

/**
 * Full pipeline diagnostic report.
 */
export interface PipelineDiagnosticReport {
  queryId: string;
  query: string;
  overallStatus: 'running' | 'completed' | 'failed';
  stages: StageDiagnostic[];
  totalDurationMs: number;
  totalTokensUsed: number;
  progressPercent: number;
}
```

### B. Progress Reporting Interface

```typescript
/**
 * Interface for reporting query progress.
 */
export interface ProgressReporter {
  /**
   * Report progress for the current stage.
   */
  reportProgress(update: ProgressUpdate): void;

  /**
   * Get current pipeline status.
   */
  getStatus(): PipelineDiagnosticReport;

  /**
   * Subscribe to progress updates.
   */
  subscribe(callback: (report: PipelineDiagnosticReport) => void): () => void;
}

export interface ProgressUpdate {
  stageName: string;
  phase: 'starting' | 'processing' | 'completing';
  progressInStage: number;  // 0.0 - 1.0
  message: string;
  itemsProcessed?: number;
  itemsTotal?: number;
}
```

### C. Error Localization

```typescript
/**
 * Localize errors to specific stages and provide actionable information.
 */
export class ErrorLocalizer {
  localize(error: Error, pipelineState: PipelineState): LocalizedError {
    const failedStage = this.identifyFailedStage(pipelineState);
    const rootCause = this.analyzeRootCause(error, failedStage);
    const suggestions = this.generateSuggestions(rootCause, failedStage);

    return {
      originalError: error,
      failedStage: failedStage.stageName,
      stageInput: this.summarizeInput(failedStage.input),
      rootCause,
      suggestions,
      recoveryOptions: this.identifyRecoveryOptions(failedStage, rootCause),
    };
  }
}

export interface LocalizedError {
  originalError: Error;
  failedStage: string;
  stageInput: string;
  rootCause: string;
  suggestions: string[];
  recoveryOptions: RecoveryOption[];
}

export interface RecoveryOption {
  action: 'retry' | 'skip' | 'fallback' | 'abort';
  description: string;
  automaticApplicable: boolean;
}
```

---

## P23: Storage Capability Detection

### [SPEC_SLICE] Runtime Storage Capability Detection

- **[CAPABILITIES] Required**: detect storage capabilities at runtime; adapt behavior based on available features.
- **[ADAPTERS] Interfaces**: StorageCapabilityDetector; CapabilityAdapter.
- **[EVIDENCE_LEDGER] Events**: capability_detected, capability_missing, behavior_adapted.

### A. Storage Capability Schema

```typescript
/**
 * Storage capabilities that may or may not be available.
 */
export interface StorageCapabilities {
  /** Vector search support */
  vectorSearch: {
    available: boolean;
    dimensions?: number[];
    distanceMetrics?: ('cosine' | 'euclidean' | 'dot')[];
    maxVectors?: number;
  };

  /** Full-text search support */
  fullTextSearch: {
    available: boolean;
    languages?: string[];
    operators?: ('and' | 'or' | 'phrase' | 'fuzzy')[];
  };

  /** Graph traversal support */
  graphTraversal: {
    available: boolean;
    maxDepth?: number;
    relationshipTypes?: string[];
  };

  /** Transaction support */
  transactions: {
    available: boolean;
    isolation?: 'read_committed' | 'repeatable_read' | 'serializable';
  };

  /** Caching support */
  caching: {
    available: boolean;
    maxSize?: number;
    ttlSupport?: boolean;
  };

  /** Persistence */
  persistence: {
    type: 'memory' | 'file' | 'database';
    durable: boolean;
  };
}
```

### B. Capability Detection

```typescript
/**
 * Detect storage capabilities at runtime.
 */
export class StorageCapabilityDetector {
  async detect(storage: LibrarianStorage): Promise<StorageCapabilities> {
    const capabilities: StorageCapabilities = {
      vectorSearch: await this.detectVectorSearch(storage),
      fullTextSearch: await this.detectFullTextSearch(storage),
      graphTraversal: await this.detectGraphTraversal(storage),
      transactions: await this.detectTransactions(storage),
      caching: await this.detectCaching(storage),
      persistence: await this.detectPersistence(storage),
    };

    // Emit capability detection events
    this.emitCapabilityReport(capabilities);

    return capabilities;
  }

  private async detectVectorSearch(storage: LibrarianStorage): Promise<StorageCapabilities['vectorSearch']> {
    try {
      // Test vector search with a simple query
      const testEmbedding = new Array(384).fill(0);
      await storage.vectorSearch?.(testEmbedding, 1);
      return {
        available: true,
        dimensions: [384, 768, 1536],
        distanceMetrics: ['cosine'],
      };
    } catch {
      return { available: false };
    }
  }

  // ... similar methods for other capabilities
}
```

### C. Behavior Adaptation

```typescript
/**
 * Adapt query behavior based on available storage capabilities.
 */
export class CapabilityAwareQueryAdapter {
  constructor(private capabilities: StorageCapabilities) {}

  adaptQuery(query: LibrarianQuery): AdaptedQuery {
    const adaptations: QueryAdaptation[] = [];

    // If no vector search, fall back to keyword matching
    if (!this.capabilities.vectorSearch.available) {
      adaptations.push({
        original: 'semantic_retrieval',
        adapted: 'keyword_retrieval',
        reason: 'Vector search unavailable',
      });
    }

    // If no graph traversal, use flat retrieval
    if (!this.capabilities.graphTraversal.available) {
      adaptations.push({
        original: 'graph_expansion',
        adapted: 'skip',
        reason: 'Graph traversal unavailable',
      });
    }

    // If no caching, expect slower repeated queries
    if (!this.capabilities.caching.available) {
      adaptations.push({
        original: 'cache_lookup',
        adapted: 'direct_execution',
        reason: 'Caching unavailable',
      });
    }

    return {
      adaptedQuery: this.applyAdaptations(query, adaptations),
      adaptations,
      capabilityReport: this.capabilities,
    };
  }
}
```

---

## DSL Formal Semantics

### Operational Semantics

The LiBrainian Configuration Language (LCL) has formal operational semantics that define how expressions evaluate.

```typescript
/**
 * LCL Evaluation Judgments
 *
 * The notation E |- e => v means:
 * "Under environment E, expression e evaluates to value v"
 */

// Base primitives evaluate to themselves
// E |- primitive(id) => TechniquePrimitive(id)

// Pattern references resolve from catalog
// E |- pattern(id) => PATTERN_CATALOG[id]

// Composition builds from base
// E |- compose(base, overrides) => merge(base, overrides)

// Conditionals filter based on predicates
// E |- when(pred, then_expr, else_expr) =>
//       if eval(pred, E) then eval(then_expr, E) else eval(else_expr, E)

// Operators wrap primitives with execution semantics
// E |- operator(type, primitives) => OperatorNode(type, primitives)

/**
 * Formal evaluation function.
 */
export function evaluateLCL(
  expr: LCLExpression,
  env: LCLEnvironment
): LCLValue {
  switch (expr.kind) {
    case 'primitive_ref':
      return { kind: 'primitive', value: resolvePrimitive(expr.id, env) };

    case 'pattern_ref':
      return { kind: 'pattern', value: resolvePattern(expr.id, env) };

    case 'compose':
      const base = evaluateLCL(expr.base, env);
      const overrides = evaluateLCL(expr.overrides, env);
      return { kind: 'composition', value: mergeValues(base, overrides) };

    case 'conditional':
      const predResult = evaluatePredicate(expr.predicate, env);
      return predResult
        ? evaluateLCL(expr.thenBranch, env)
        : evaluateLCL(expr.elseBranch, env);

    case 'operator':
      const operands = expr.operands.map(op => evaluateLCL(op, env));
      return { kind: 'operator', type: expr.operatorType, children: operands };

    default:
      throw new Error(`Unknown LCL expression kind: ${(expr as any).kind}`);
  }
}
```

### Type Checking Rules

```typescript
/**
 * LCL Type Checking Judgments
 *
 * The notation Γ |- e : T means:
 * "Under type environment Γ, expression e has type T"
 */

// Primitive references have PrimitiveType
// Γ |- primitive(id) : PrimitiveType

// Pattern references have PatternType
// Γ |- pattern(id) : PatternType

// Compositions produce CompositionType
// Γ |- base : T,  Γ |- overrides : Partial<T>
// ------------------------------------------------
// Γ |- compose(base, overrides) : T

// Conditionals require matching branches
// Γ |- pred : Bool,  Γ |- then : T,  Γ |- else : T
// ------------------------------------------------
// Γ |- when(pred, then, else) : T

// Operators require compatible operand types
// Γ |- op₁ : T₁, ..., Γ |- opₙ : Tₙ,  compatible(T₁, ..., Tₙ)
// -----------------------------------------------------------
// Γ |- operator(type, [op₁, ..., opₙ]) : OperatorType<T₁ ∪ ... ∪ Tₙ>

/**
 * Type checking implementation.
 */
export function typecheckLCL(
  expr: LCLExpression,
  typeEnv: TypeEnvironment
): LCLType {
  switch (expr.kind) {
    case 'primitive_ref':
      if (!typeEnv.hasPrimitive(expr.id)) {
        throw new TypeError(`Unknown primitive: ${expr.id}`);
      }
      return { kind: 'primitive', id: expr.id };

    case 'pattern_ref':
      if (!typeEnv.hasPattern(expr.id)) {
        throw new TypeError(`Unknown pattern: ${expr.id}`);
      }
      return { kind: 'pattern', id: expr.id };

    case 'compose':
      const baseType = typecheckLCL(expr.base, typeEnv);
      const overrideType = typecheckLCL(expr.overrides, typeEnv);
      if (!isAssignable(overrideType, partialOf(baseType))) {
        throw new TypeError(`Override type incompatible with base`);
      }
      return baseType;

    case 'conditional':
      const predType = typecheckPredicate(expr.predicate, typeEnv);
      if (predType.kind !== 'boolean') {
        throw new TypeError(`Predicate must be boolean`);
      }
      const thenType = typecheckLCL(expr.thenBranch, typeEnv);
      const elseType = typecheckLCL(expr.elseBranch, typeEnv);
      if (!typesEqual(thenType, elseType)) {
        throw new TypeError(`Conditional branches must have same type`);
      }
      return thenType;

    case 'operator':
      const operandTypes = expr.operands.map(op => typecheckLCL(op, typeEnv));
      if (!areCompatibleForOperator(expr.operatorType, operandTypes)) {
        throw new TypeError(`Operand types incompatible for operator ${expr.operatorType}`);
      }
      return { kind: 'operator', operatorType: expr.operatorType, operandTypes };

    default:
      throw new TypeError(`Unknown expression kind`);
  }
}
```

---

## Expressiveness Stratification

### TechniqueStratum Type

Technique compositions are stratified by their computational expressiveness. This allows safety guarantees and resource prediction.

```typescript
/**
 * Expressiveness strata for technique compositions.
 * Each stratum has different safety and predictability guarantees.
 */
export type TechniqueStratum =
  | 'finite'       // Guaranteed to terminate with bounded resources
  | 'bounded'      // Terminates but resource bounds are configuration-dependent
  | 'productive'   // May run indefinitely but always makes progress
  | 'unrestricted' // No termination or progress guarantees
  ;

/**
 * Stratum characteristics.
 */
export const STRATUM_PROPERTIES: Record<TechniqueStratum, StratumProperties> = {
  finite: {
    terminationGuarantee: 'always',
    resourceBound: 'static',
    examples: ['Single primitive', 'Fixed sequence', 'Bounded loop with counter'],
    safeForAutonomous: true,
    requiresHumanApproval: false,
  },
  bounded: {
    terminationGuarantee: 'always',
    resourceBound: 'configured',
    examples: ['Loop with maxIterations', 'Retry with maxAttempts', 'Timebox'],
    safeForAutonomous: true,
    requiresHumanApproval: false,
  },
  productive: {
    terminationGuarantee: 'none',
    resourceBound: 'none',
    examples: ['Event-driven loop', 'Watch mode', 'Continuous monitoring'],
    safeForAutonomous: 'with_supervision',
    requiresHumanApproval: true,
  },
  unrestricted: {
    terminationGuarantee: 'none',
    resourceBound: 'none',
    examples: ['Self-modifying compositions', 'Unbounded recursion'],
    safeForAutonomous: false,
    requiresHumanApproval: true,
  },
};

interface StratumProperties {
  terminationGuarantee: 'always' | 'none';
  resourceBound: 'static' | 'configured' | 'none';
  examples: string[];
  safeForAutonomous: boolean | 'with_supervision';
  requiresHumanApproval: boolean;
}
```

### Stratum Inference

```typescript
/**
 * Infer the stratum of a composition based on its structure.
 */
export function inferStratum(composition: TechniqueComposition): TechniqueStratum {
  const operators = composition.operators ?? [];

  // Check for unrestricted patterns
  if (hasUnboundedRecursion(composition) || hasSelfModification(composition)) {
    return 'unrestricted';
  }

  // Check for productive patterns (indefinite but progressing)
  if (hasEventLoop(operators) || hasWatchMode(operators)) {
    return 'productive';
  }

  // Check for bounded patterns
  const hasLoops = operators.some(op => op.type === 'loop');
  const allLoopsBounded = operators
    .filter(op => op.type === 'loop')
    .every(op => op.parameters?.['maxIterations'] !== undefined);

  if (hasLoops && allLoopsBounded) {
    return 'bounded';
  }

  // Check for unbounded loops
  if (hasLoops && !allLoopsBounded) {
    return 'productive';  // Potentially indefinite
  }

  // Pure sequences and fixed structures are finite
  return 'finite';
}

/**
 * Validate that a composition meets stratum requirements.
 */
export function validateStratum(
  composition: TechniqueComposition,
  requiredStratum: TechniqueStratum
): StratumValidationResult {
  const actualStratum = inferStratum(composition);
  const stratumOrder: TechniqueStratum[] = ['finite', 'bounded', 'productive', 'unrestricted'];
  const actualIndex = stratumOrder.indexOf(actualStratum);
  const requiredIndex = stratumOrder.indexOf(requiredStratum);

  if (actualIndex <= requiredIndex) {
    return { valid: true, actualStratum };
  }

  return {
    valid: false,
    actualStratum,
    requiredStratum,
    violations: identifyStratumViolations(composition, requiredStratum),
  };
}

interface StratumValidationResult {
  valid: boolean;
  actualStratum: TechniqueStratum;
  requiredStratum?: TechniqueStratum;
  violations?: StratumViolation[];
}

interface StratumViolation {
  operatorId: string;
  reason: string;
  suggestedFix: string;
}
```

### Stratum-Based Execution Policies

```typescript
/**
 * Execution policies based on composition stratum.
 */
export const STRATUM_EXECUTION_POLICIES: Record<TechniqueStratum, ExecutionPolicy> = {
  finite: {
    maxDurationMs: 60_000,          // 1 minute hard limit
    maxTokens: 50_000,              // 50k tokens
    checkpointInterval: 'none',     // No checkpoints needed
    humanApprovalRequired: false,
    autonomousExecution: true,
  },
  bounded: {
    maxDurationMs: 600_000,         // 10 minute hard limit
    maxTokens: 500_000,             // 500k tokens
    checkpointInterval: 60_000,     // Checkpoint every minute
    humanApprovalRequired: false,
    autonomousExecution: true,
  },
  productive: {
    maxDurationMs: undefined,       // No hard limit
    maxTokens: undefined,           // No token limit
    checkpointInterval: 30_000,     // Checkpoint every 30 seconds
    humanApprovalRequired: true,    // Requires human to start
    autonomousExecution: false,
    progressReportingRequired: true,
    idleTimeoutMs: 300_000,         // Stop if no progress for 5 minutes
  },
  unrestricted: {
    maxDurationMs: undefined,
    maxTokens: undefined,
    checkpointInterval: 10_000,     // Frequent checkpoints
    humanApprovalRequired: true,
    autonomousExecution: false,
    progressReportingRequired: true,
    continuousMonitoring: true,
  },
};

interface ExecutionPolicy {
  maxDurationMs?: number;
  maxTokens?: number;
  checkpointInterval: number | 'none';
  humanApprovalRequired: boolean;
  autonomousExecution: boolean;
  progressReportingRequired?: boolean;
  idleTimeoutMs?: number;
  continuousMonitoring?: boolean;
}
```

---

## Total Implementation Estimates

| Feature | Est. LOC | Status |
|---------|----------|--------|
| P0: LLM Provider Discovery | ~950 | Implemented |
| P1: Operator Execution Layer | ~2,550 | Implemented |
| P2: Semantic Composition Selector | ~400 | Implemented |
| P3: LCL Core | ~200 | Implemented |
| P4: Structure Templates | ~100 | Implemented |
| P5: Pattern Catalog | ~1,550 | Implemented |
| P6: Codebase Advisor | ~400 | Implemented |
| P7: Evolution Engine | ~600 | Implemented |
| P17: Query Pipeline Decomposition | ~2,050 | Pending |
| P18: Executable Primitive Contracts | ~500 | Pending |
| P19: Advanced Semantic Selection | ~400 | Pending |
| P20: Enriched Plan Output | ~350 | Pending |
| P21: LLM Capability Requirements | ~400 | Pending |
| P22: Stage-Aware Reporting | ~450 | Pending |
| P23: Storage Capability Detection | ~400 | Pending |
| DSL Formal Semantics | ~300 | Pending |
| Expressiveness Stratification | ~350 | Pending |
| **Total** | **~11,950** | |

---

## World-Class Benchmarks

These features should match or exceed:

| Feature | Benchmark |
|---------|-----------|
| P0: Provider Discovery | LangChain's provider abstraction, LlamaIndex's LLM configuration |
| P1: Operators | Temporal.io workflows, AWS Step Functions, Prefect/Airflow DAGs |
| P2: Semantic Selection | Semantic search engines, intent classification systems |
| P3-P4: LCL/Templates | Terraform HCL, Kubernetes YAML, Pulumi |
| P5: Patterns | Gang of Four patterns, Domain-Driven Design patterns |
| P6: Codebase Advisor | SonarQube rules, CodeClimate suggestions |
| P7: Evolution | Genetic programming, AutoML hyperparameter optimization |
