# LiBrainian Usability Analysis: Non-Obvious Improvements for Agent-Facing Tools

> **Purpose**: Identify friction that agents specifically suffer from, drawing lessons from beloved CLI tools (ripgrep, fd, jq, fzf, gh).
>
> **Analysis Date**: 2026-01-30

---

## Executive Summary

After analyzing LiBrainian's codebase, I identified **9 non-obvious usability improvements** that would significantly improve the agent experience. The top 3 improvements should become implementation work units:

1. **Token-Aware Response Budgeting** - Agents waste context window on verbose responses
2. **Structured Error Contracts** - Error recovery requires parsing human-readable text
3. **Deterministic Output Mode** - Same query can produce different results due to cache state

---

## Ranked Improvements

### 1. Token-Aware Response Budgeting (PRIORITY: HIGH)

**The Problem**
Responses include full `ContextPack[]` arrays with verbose summaries, code snippets, and metadata. An L1 query can return 10,000+ tokens even when the agent only needs a 500-token answer. The `enforceTokenBudget` function exists but:
- It's a blunt instrument (removes entire supplementary section first)
- No way for agents to request "just the essentials"
- No token count in response metadata

**Why Agents Suffer**
- Context windows are finite; verbose responses crowd out other information
- Agents pay for tokens they don't use
- No feedback loop: agent can't know "this response is unusually large"

**Evidence from Code**
```typescript
// src/api/token_budget.ts:59
context.supplementary = { relatedFiles: [], recentChanges: [], patterns: [], antiPatterns: [], similarTasks: [], knowledgeSources: [] };
truncationSteps.push('removed_supplementary');
```
This is binary: all or nothing.

**Proposed Solution**
Add a `tokenBudget` parameter to queries with intelligent truncation:
```typescript
interface LibrarianQuery {
  tokenBudget?: number;  // Target response size
  tokenPriority?: 'synthesis' | 'snippets' | 'metadata';  // What to preserve
}

interface LibrarianResponse {
  usedTokens: number;  // Always present
  truncationApplied: boolean;
  truncationSummary?: string;  // "Reduced from 8 to 4 packs"
}
```

**World-Class Precedent**: `jq` has `--compact-output` and `--sort-keys` for predictable output size. ripgrep's `--max-count` limits results upfront.

---

### 2. Structured Error Contracts (PRIORITY: HIGH)

**The Problem**
Errors are human-readable strings that agents must parse:
```typescript
// src/cli/errors.ts
throw new CliError(message, code, ERROR_SUGGESTIONS[code], details);
```

The error codes exist (`PROVIDER_UNAVAILABLE`, `NOT_BOOTSTRAPPED`, etc.) but:
- Not included in JSON output
- Suggestion text must be parsed from string
- No machine-readable recovery hints

**Why Agents Suffer**
- String parsing is fragile and context-consuming
- Different phrasing of same error requires different handling
- Can't programmatically decide "should I retry?"

**Evidence from Code**
```typescript
// src/api/query.ts:527-537
throw new ProviderUnavailableError({
  feature: 'provider_check',
  reason: 'provider check failed',
  suggestion: 'check provider configuration',
});
```
Good structure, but lost when surfaced to CLI.

**Proposed Solution**
Standardized error envelope for all outputs:
```typescript
interface ErrorEnvelope {
  code: string;           // "ERR_PROVIDER_UNAVAILABLE"
  message: string;        // Human-readable
  retryable: boolean;     // Can agent retry?
  retryAfterMs?: number;  // Suggested wait time
  recoveryHints: string[];  // Machine-actionable suggestions
  details: Record<string, unknown>;  // Structured context
}
```

**World-Class Precedent**: GitHub CLI (`gh`) returns structured JSON errors with `type`, `message`, and often `documentation_url`.

---

### 3. Deterministic Output Mode (PRIORITY: HIGH)

**The Problem**
Query results vary based on:
- Cache state (`cacheHit: true/false` changes latency and sometimes content)
- Index state (indexing phase affects confidence caps)
- LLM synthesis (non-deterministic by nature)

**Why Agents Suffer**
- Same query twice can produce different results
- Testing/debugging is impossible
- Can't verify "did my change improve results?"

**Evidence from Code**
```typescript
// src/api/query.ts:603-605
const allowCache = isReadyPhase(indexState.phase);
const cacheKey = allowCache ? buildQueryCacheKey(query, version, llmRequirement, synthesisEnabled) : '';
```

```typescript
// src/api/query.ts:183-186
const INDEX_CONFIDENCE_CAP_MIN = q(0.1, [0, 1], 'Minimum confidence cap during indexing.');
const INDEX_CONFIDENCE_CAP_MAX = q(0.5, [0, 1], 'Maximum confidence cap during indexing.');
```

**Proposed Solution**
Add `--deterministic` mode:
```typescript
interface LibrarianQuery {
  deterministic?: boolean;  // Forces: no synthesis, stable sort, ignore cache
}
```

When enabled:
- Skip LLM synthesis (use only retrieval)
- Sort results by stable key (packId, not score)
- Always use cache OR always skip cache (consistent)
- Include query fingerprint in response for verification

**World-Class Precedent**: Git's `--porcelain` mode produces machine-stable output. ripgrep's `--sort` flag ensures deterministic ordering.

---

### 4. Progressive Disclosure of Depth Levels (PRIORITY: MEDIUM)

**The Problem**
Depth levels are cryptic: `L0`, `L1`, `L2`, `L3`. The help text explains them but:
- No indication which level is "right" for a query
- No way to know "L2 would have found X but you asked for L1"
- Token cost per level isn't surfaced

**Why Agents Suffer**
- Must guess depth level
- Over-querying wastes tokens; under-querying misses results
- No feedback when depth was insufficient

**Evidence from Code**
```typescript
// src/api/context_levels.ts:10-14
L0: { level: 'L0', maxTokens: 2000, packLimit: 4, description: 'Minimal context' },
L1: { level: 'L1', maxTokens: 10000, packLimit: 8, description: 'Standard context' },
L2: { level: 'L2', maxTokens: 30000, packLimit: 12, description: 'Extended context' },
L3: { level: 'L3', maxTokens: 80000, packLimit: 20, description: 'Comprehensive context' },
```

**Proposed Solution**
1. Add `depthHint` to response:
```typescript
interface LibrarianResponse {
  depthHint?: {
    currentDepth: 'L1';
    suggestedDepth: 'L2';
    reason: 'Query matched 15 functions; L1 returned only 8';
  };
}
```

2. Add `--auto-depth` flag that starts at L0 and escalates if results are sparse

**World-Class Precedent**: ripgrep auto-detects binary files. fzf shows match count dynamically.

---

### 5. Cache Visibility and Control (PRIORITY: MEDIUM)

**The Problem**
Cache behavior is invisible:
- `cacheHit: boolean` is present but that's all
- No way to force cache refresh
- No way to see cache age or eviction reason

**Why Agents Suffer**
- Stale results without knowing they're stale
- Can't debug "why did this query get different results?"
- No cache warming for predictable latency

**Evidence from Code**
```typescript
// src/api/query.ts:72
type QueryCacheStore = LibrarianStorage & {
  getQueryCacheEntry?: (queryHash: string) => Promise<QueryCacheEntry | null>;
  pruneQueryCache?: (options: { maxEntries: number; maxAgeMs: number }) => Promise<number>;
};
```

**Proposed Solution**
```typescript
interface LibrarianQuery {
  cacheControl?: 'use' | 'skip' | 'refresh';  // Default: 'use'
}

interface LibrarianResponse {
  cache: {
    hit: boolean;
    ageMs?: number;
    expiresInMs?: number;
    key?: string;  // For debugging
  };
}
```

CLI addition: `LiBrainian cache status`, `LiBrainian cache clear`

**World-Class Precedent**: GitHub CLI has `gh cache list` and `gh cache delete`.

---

### 6. Command Aliasing and Shortcuts (PRIORITY: MEDIUM)

**The Problem**
Commands are verbose: `LiBrainian check-providers`, `LiBrainian config heal --diagnose-only`. No short forms exist.

**Why Agents Suffer**
- Every character costs context
- Typing errors in long commands
- Cognitive load matching commands to actions

**Evidence from Code**
```typescript
// src/cli/index.ts:56-145
const COMMANDS: Record<Command, { description: string; usage: string }> = {
  'check-providers': { ... },
  'config': { ... },
  // No aliases defined
};
```

**Proposed Solution**
Add natural aliases:
```
LiBrainian q        -> LiBrainian query
LiBrainian b        -> LiBrainian bootstrap
LiBrainian s        -> LiBrainian status
LiBrainian h        -> LiBrainian health
LiBrainian chk      -> LiBrainian check-providers
```

And compound shortcuts:
```
LiBrainian qq "intent"  -> LiBrainian query "intent" --json --no-synthesis
```

**World-Class Precedent**: Git has dozens of aliases (`git co` = `git checkout`). kubectl has `k` alias.

---

### 7. Output Format Negotiation (PRIORITY: MEDIUM)

**The Problem**
Output format is command-specific. Some have `--json`, some have `--format`, some have neither. Human output uses console.log with manual formatting.

**Why Agents Suffer**
- Must remember which commands support which flags
- Human-formatted output requires parsing
- No unified structured output format

**Evidence from Code**
```typescript
// src/cli/commands/query.ts:119-121
if (outputJson) {
  console.log(JSON.stringify(response, null, 2));
  return;
}
```

```typescript
// src/cli/commands/status.ts - No --json flag at all
```

**Proposed Solution**
Global `--output` flag with consistent behavior:
```
--output json     # Structured JSON (default for pipes)
--output jsonl    # JSON Lines (one object per line)
--output yaml     # YAML for readability
--output text     # Human-readable (default for TTY)
```

Auto-detect: if stdout is not a TTY, default to `--output json`.

**World-Class Precedent**: kubectl's `--output` flag works on every command. jq naturally outputs JSON.

---

### 8. Latency Budget Declarations (PRIORITY: LOW)

**The Problem**
No way to tell LiBrainian "I need an answer in 500ms, give me the best you can." The timeout is binary (either completes or fails).

**Why Agents Suffer**
- Can't trade quality for speed
- Must guess appropriate timeout
- No partial results on timeout

**Evidence from Code**
```typescript
// src/types.ts:631-632
// 0 or undefined means no timeout (preferred)
timeoutMs?: number;
```

**Proposed Solution**
```typescript
interface LibrarianQuery {
  latencyBudgetMs?: number;  // Target latency, not hard timeout
  latencyStrategy?: 'best_effort' | 'partial_ok' | 'strict';
}

interface LibrarianResponse {
  actualLatencyMs: number;  // Already present as latencyMs
  budgetExceeded: boolean;
  earlyTermination?: {
    reason: 'latency_budget';
    completedStages: StageName[];
    skippedStages: StageName[];
  };
}
```

**World-Class Precedent**: Elasticsearch has `timeout` parameter that returns partial results.

---

### 9. Semantic Versioning of Response Schema (PRIORITY: LOW)

**The Problem**
Response schema evolves but no version indicator. Agents can't detect breaking changes.

**Why Agents Suffer**
- Schema changes break parsing
- No deprecation warnings
- Can't target specific response version

**Evidence from Code**
```typescript
// src/types.ts:671-711
export interface LibrarianResponse {
  // Many fields, no schema version
  query: LibrarianQuery;
  packs: ContextPack[];
  // ...
}
```

**Proposed Solution**
Add response schema versioning:
```typescript
interface LibrarianResponse {
  $schema: 'LiBrainian-response/v1';  // Immutable schema identifier
  $version: '2.1.0';  // Current response version
  $deprecated?: string[];  // Fields that will be removed
}
```

CLI: `LiBrainian --schema-version 1` to get v1-compatible responses.

**World-Class Precedent**: OpenAPI/JSON Schema use `$schema`. AWS API versions are explicit.

---

## Top 3 Implementation Work Units

Based on agent impact and implementation feasibility:

### WU-USABILITY-001: Token-Aware Response Budgeting

**Scope**:
1. Add `tokenBudget` and `tokenPriority` to `LibrarianQuery`
2. Add `usedTokens`, `truncationApplied`, `truncationSummary` to `LibrarianResponse`
3. Implement intelligent truncation in `enforceTokenBudget`:
   - Priority-based field pruning
   - Configurable snippet length limits
   - Pack count limits based on budget
4. CLI: `--token-budget N` flag for query command

**Estimated Effort**: 2-3 days

**Files to Modify**:
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/types.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/token_budget.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/commands/query.ts`

---

### WU-USABILITY-002: Structured Error Contracts

**Scope**:
1. Define `ErrorEnvelope` type with code, retryable, recoveryHints
2. Update all `CliError` throws to include structured fields
3. Update CLI error handling to output JSON errors when `--json` is set
4. Add retry metadata to provider errors
5. Document error codes in help/README

**Estimated Effort**: 1-2 days

**Files to Modify**:
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/errors.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/index.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/provider_check.ts`

---

### WU-USABILITY-003: Deterministic Output Mode

**Scope**:
1. Add `deterministic?: boolean` to `LibrarianQuery`
2. When enabled:
   - Force `llmRequirement: 'disabled'`
   - Sort packs by `packId` (stable) not score
   - Either always skip cache or always use cache (configurable)
   - Include `queryFingerprint` in response
3. CLI: `--deterministic` flag
4. Document in help text

**Estimated Effort**: 1 day

**Files to Modify**:
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/types.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/commands/query.ts`

---

## Observations: What Beloved CLIs Do Right

### ripgrep
- **Fast by default**: No configuration needed, sensible defaults
- **Progressive disclosure**: Simple invocation works, flags add power
- **Stable output**: `--sort` ensures reproducibility
- **Machine-friendly**: JSON output with `--json`

### jq
- **Composable**: Output of one filter is input to next
- **Predictable**: Same input, same output, always
- **Size-aware**: `--compact-output` for minimal output

### fzf
- **Interactive but scriptable**: Works in both modes
- **Fast feedback**: Shows results as you type
- **Exit codes**: Non-zero on no match, enables scripting

### gh (GitHub CLI)
- **Structured errors**: JSON error objects with type/message
- **Aliases**: Natural shortcuts for common operations
- **Output negotiation**: `--json` works everywhere

---

## Conclusion

LiBrainian has a solid foundation but optimizes for human developers over agent consumers. The key insight is that **agents have different constraints than humans**:

| Dimension | Human | Agent |
|-----------|-------|-------|
| Context | Unlimited | Finite window |
| Errors | Readable text | Parseable structure |
| Output | Pretty formatted | Machine parseable |
| Latency | Willing to wait | Every ms costs |
| Determinism | Doesn't matter | Critical for testing |

The recommended work units (token budgeting, structured errors, deterministic mode) address the highest-impact friction points specific to agent consumers.
