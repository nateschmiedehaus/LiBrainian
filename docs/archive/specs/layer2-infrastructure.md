# Layer 2 Infrastructure Specification

> **Extracted from**: THEORETICAL_CRITIQUE.md
> **Last updated**: 2026-01-22
> **Scope**: LLM Adapter, Evidence Ledger / Audit Trail, Capability Negotiation / Provider Discovery, Tool/MCP Adapter
>
> **LiBrainian Story**: Chapter 2 (The Foundation) - This is the trustworthy base everything else builds on.
>
> **Critical**: Layer 2 must be complete before Tracks A-F can be trusted. Without unified evidence and capability negotiation, claims are unverifiable.

---

## KNOWN IMPLEMENTATION ISSUES

| Task | Status | Issue |
|------|--------|-------|
| **2.1 LLM Adapter (P0)** | ✅ Mostly done | Provider bypass in `query_synthesis.ts` |
| **2.2 Evidence Ledger** | ❌ Fragmented | Three separate logs don't connect |
| **2.3 Capability Negotiation** | ❌ Not done | Operations don't declare capabilities |
| **2.4 Tool/MCP Adapter** | ⚠️ Partial | Missing rate limiting (P39), audit persistence (P40) |
| **P21 LLM Capability Declarations** | ❌ Spec only | Interface specified, not implemented |
| **P22 Per-Stage Diagnostics** | ❌ Spec only | Interface specified, not implemented |
| **P23 Storage Capability Detection** | ❌ Spec only | Interface specified, not implemented |

**See**: [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for full details.

---

## Table of Contents

1. [Overview](#overview)
2. [Architectural Position](#architectural-position)
3. [Part XVI: Extensible LLM Provider Discovery](#part-xvi-extensible-llm-provider-discovery)
4. [Evidence Ledger / Audit Trail](#evidence-ledger--audit-trail)
5. [LLM Capability Declarations (P21)](#llm-capability-declarations-p21)
6. [Per-Stage Diagnostics (P22)](#per-stage-diagnostics-p22)
7. [Storage Capability Detection (P23)](#storage-capability-detection-p23)
8. [Evidence Ledger Enhancements](#evidence-ledger-enhancements)
9. [Epistemic Kernel Mapping](#epistemic-kernel-mapping)
10. [Capability Negotiation / Provider Discovery](#capability-negotiation--provider-discovery)
11. [Tool/MCP Adapter](#toolmcp-adapter)
12. [Implementation Priorities](#implementation-priorities)
13. [Acceptance Criteria](#acceptance-criteria)

---

## Overview

Layer 2 Infrastructure provides the foundation for LiBrainian's independence and portability. It enables:

- **Provider-agnostic LLM access** via the LLM Adapter
- **Auditable, replayable operations** via the Evidence Ledger
- **Environment negotiation** via Capability Contracts
- **Extensible tool access** via the Tool/MCP Adapter

### Non-Negotiable Invariants

These invariants MUST be maintained:

1. **[CAPABILITIES] Capability lattice is first-class**: every operation declares required/optional capabilities; runtime negotiates; outputs disclose capability loss explicitly.

2. **[EVIDENCE_LEDGER] Evidence ledger is unified**: every LLM call, tool call, randomness draw, and read/write that influences claims is recorded with stable IDs (or the run must explicitly surface `unverified_by_trace(replay_unavailable)`).

3. **[CLAIMS] Claims are machine-checkable**: anything presented as "supported" maps to evidence refs, not prose "citations".

4. **No paper capability**: a feature is either (a) implemented + gated with evidence commands, or (b) marked spec-only with prerequisites and explicit "how to verify".

---

## Architectural Position

Layer 2 sits between the Pure Core (Layer 1) and Protocol Adapters (Layer 3):

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      LiBrainian (Independent Core)                        │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ LAYER 1: PURE CORE (G1)                                            │  │
│  │                                                                    │  │
│  │   query(intent, ctx, llm)  →  Result<Answer, Uncertainty>          │  │
│  │   search(pattern, corpus)  →  Result<Matches, NotFound>            │  │
│  │   compose(ops, algebra)    →  Result<Composition, Invalid>         │  │
│  │   verify(claim, evidence)  →  Result<Verified, Refuted>            │  │
│  │                                                                    │  │
│  │   - No global state                                                │  │
│  │   - All dependencies explicit                                      │  │
│  │   - Pure functions (same input → same output)                      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ LAYER 2: INFRASTRUCTURE (G2, G4, G6)                               │  │
│  │                                                                    │  │
│  │   - LLM Adapter (provider discovery, model registry)               │  │
│  │   - Evidence Ledger (audit trail, replay)                          │  │
│  │   - Capability Negotiation (what can this environment do?)         │  │
│  │   - Tool/MCP Adapter (external capabilities)                       │  │
│  │                                                                    │  │
│  │   receive(message: LibrarianMessage): LibrarianResponse            │  │
│  │                                                                    │  │
│  │   - Message routing to pure functions                              │  │
│  │   - State management (if any) explicit                             │  │
│  │   - Capability token validation (G4)                               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
└────────────────────────────────────┼─────────────────────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ LAYER 3: MCP    │       │ LAYER 3: CLI    │       │ LAYER 3: HTTP   │
│ Adapter (G7)    │       │ Adapter (G7)    │       │ Adapter (G7)    │
│                 │       │                 │       │                 │
│ - Optional      │       │ - Optional      │       │ - Optional      │
│ - Thin wrapper  │       │ - Thin wrapper  │       │ - Thin wrapper  │
│ - Protocol only │       │ - Protocol only │       │ - Protocol only │
└─────────────────┘       └─────────────────┘       └─────────────────┘
```

---

## Task 2.1: LLM Provider Discovery (P0)

> **AUTHORITATIVE SPEC**: See [`track-a-core-pipeline.md` Section P0](./track-a-core-pipeline.md#p0-llm-provider-discovery-part-xvi) for the complete specification.
>
> This section provides a summary only. Do NOT duplicate the full spec here.

### Summary

**Purpose**: All LLM calls go through a single adapter for evidence and policy.

**Key Files**:
- `packages/LiBrainian/src/api/llm_provider_discovery.ts` (registry + probes)
- `packages/LiBrainian/src/api/llm_env.ts` (config resolution with discovery fallback)
- `packages/LiBrainian/src/api/provider_check.ts` (`checkAllProviders()` / `requireProviders()`)

**Verification**: `rg "new LLMService\(" packages/LiBrainian/src --glob '!**/adapters/**' --glob '!**/__tests__/**'`

**Acceptance**: Zero matches outside adapters/tests.

### How 2.1 Relates to Other Layer 2 Tasks

```
2.1 LLM Adapter (P0)    ──┐
                          │
2.2 Evidence Ledger ◄─────┼── 2.1 emits events TO 2.2
                          │
2.3 Capability Contracts  │── 2.1 USES capability negotiation
                          │
2.4 Tool Adapter ◄────────┘── 2.4 depends on 2.2 for logging
```

### Key Points (from full spec)

1. **Capability-driven**: Provider selection based on what's available + authenticated
2. **Extensibility**: New providers via registration pattern, no core changes needed
3. **Priority-based**: When multiple providers work, pick highest priority
4. **Helpful failures**: When nothing works, explain what was checked and how to fix
5. **Independence**: No coupling to wave0-specific infrastructure

| Scenario | Before | After |
|----------|--------|-------|
| New repo, claude authenticated | `provider_unavailable` | Auto-discovers Claude |
| Ollama running locally | `provider_unavailable` | Auto-discovers Ollama |
| No providers available | Cryptic error | Lists what was checked + how to fix |

**For full interfaces, probes, and implementation details, see [track-a-core-pipeline.md](./track-a-core-pipeline.md#c-core-interfaces).**

---

## REMOVED: Duplicate Content

> Sections B-L of the original LLM Provider Discovery spec have been removed from this file.
> They are now the authoritative spec in `track-a-core-pipeline.md`.
>
> **DO NOT re-add them here.** This duplication was identified in the Coherence Analysis
> as Issue #1 (CRITICAL).

---

### Full Specification Reference

For complete details including:
- Core interfaces (`LlmProviderDescriptor`, `LlmProviderProbeResult`, `LlmProviderProbe`)
- Provider Registry implementation
- Built-in probes (Claude CLI, Codex CLI, Ollama, LM Studio)
- Integration with `llm_env.ts` and `technique_execution.ts`
- Custom provider registration
- Model qualification gate

**See: [`track-a-core-pipeline.md` P0 Section](./track-a-core-pipeline.md#p0-llm-provider-discovery-part-xvi)**

---

<!--
  REMOVED DUPLICATE CONTENT:
  ~450 lines of LLM Provider Discovery spec (sections C through L) were removed
  from this file on 2026-01-22 as part of coherence analysis Issue #1.

  The authoritative spec is in track-a-core-pipeline.md.
  DO NOT re-add the duplicate content here.
-->

<!-- MARKER: End of LLM Provider Discovery summary. Evidence Ledger follows. -->

<!--
  ═══════════════════════════════════════════════════════════════════════════
  DUPLICATE CONTENT REMOVED (2026-01-22)

  ~430 lines of LLM Provider Discovery content were removed here.
  Sections D-L are now ONLY in track-a-core-pipeline.md.

  The authoritative spec is: track-a-core-pipeline.md#p0-llm-provider-discovery-part-xvi

  DO NOT re-add this content. If you need to update provider discovery,
  update track-a-core-pipeline.md instead.
  ═══════════════════════════════════════════════════════════════════════════
-->

<!-- END OF P0 SUMMARY - All detailed content is in track-a-core-pipeline.md -->

---

## Evidence Ledger / Audit Trail

### Theoretical Foundation

The Evidence Ledger is the append-only system of record for all observations and actions that justify claims. Without it, you cannot:
- Prove improvement or detect regressions
- Replay runs for debugging
- Audit agent behavior
- Ground "citations" in machine-checkable evidence

**Theory**: best-in-world outcomes require *auditability* and *debuggable epistemics*; without a ledger, you cannot prove improvement or detect regressions.

### Current State (Partial Implementation)

Implementation hooks today:
- MCP audit log (`packages/LiBrainian/src/mcp/audit.ts`)
- Episodes (`packages/LiBrainian/src/state/episodes_state.ts`)
- Query stages (`packages/LiBrainian/src/api/query.ts`)
- Evidence ledger core (`packages/LiBrainian/src/epistemics/evidence_ledger.ts`) with Tier-0 tests (`packages/LiBrainian/src/epistemics/__tests__/evidence_ledger.test.ts`)

**What's missing**: full wiring across subsystems (so entries correlate) + deterministic replay/checkpointing + integrity metadata (sequence/checksum).

### The Evidence Ledger Specification (V1 - Implemented)

**Authoritative** (kept in sync with implementation):
- Spec: `docs/LiBrainian/specs/core/evidence-ledger.md`
- Code: `packages/LiBrainian/src/epistemics/evidence_ledger.ts`

V1 uses `EvidenceEntry` + `IEvidenceLedger` as the single canonical schema and API. **Do not** introduce a second competing “LedgerEntry” type in docs. If we add replay, integrity metadata (sequence/checksums), or richer event taxonomies, those must be **vNext extensions** layered on top of `EvidenceEntry` with an explicit migration plan (see “Evidence Ledger vNext” below).

### Evidence Ledger Events (Minimum Required)

Per-subsystem events that MUST be logged:

#### Provider Discovery Events
- **V1 encoding**: record as `EvidenceEntry(kind='tool_call')` using the `ToolCallEvidence` payload, with `toolName` identifying the provider probe/check.
- **VNext**: add a dedicated `provider_probe`/`capability_probe` event kind (see “Evidence Ledger vNext”).

#### Operator Execution Events
- **V1 encoding**: record high-level execution as `EvidenceEntry(kind='episode')` (episode summary) and/or `EvidenceEntry(kind='tool_call')` (operator execution as an explicit tool call).
- **VNext**: add `operator_event` as a first-class event kind to avoid losing causality detail.

#### LLM Call Events
- **V1 encoding**: record as `EvidenceEntry(kind='synthesis')` with model/tokens metadata where possible.
- **VNext**: add structured `llm_call_*` events for replay + cost accounting.

#### Tool Call Events
- **V1 encoding**: record as `EvidenceEntry(kind='tool_call')` using `ToolCallEvidence`.

### Persistent Audit Log Implementation

```typescript
interface PersistentAuditLog {
  /** Append entry (buffered write) */
  append(entry: AuditEntry): void;

  /** Query historical entries */
  query(filter: AuditFilter): Promise<AuditEntry[]>;

  /** Export for compliance */
  export(format: 'json' | 'csv', filter: AuditFilter): Promise<Buffer>;
}

interface AuditEntry {
  timestamp: Date;
  sessionId: string;
  userId?: string;
  tool: string;
  params: unknown;
  result: 'success' | 'error' | 'rate_limited';
  durationMs: number;
  tokensUsed?: number;
}

class FileAuditLog implements PersistentAuditLog {
  private buffer: AuditEntry[] = [];
  private flushInterval: NodeJS.Timeout;

  constructor(
    private logDir: string,
    private flushIntervalMs: number = 5000
  ) {
    this.flushInterval = setInterval(() => this.flush(), flushIntervalMs);
  }

  append(entry: AuditEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= 100) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = this.buffer;
    this.buffer = [];

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `audit-${date}.jsonl`);

    await fs.appendFile(
      logFile,
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    );
  }
}
```

### Write-Ahead Logging with Crash Recovery

For world-class durability:

```typescript
/**
 * WRITE-AHEAD LOGGING FOR AUDIT
 *
 * WAL ensures:
 * 1. No audit entry is ever lost (durability)
 * 2. Crash recovery is automatic (consistency)
 * 3. Concurrent writes are serialized (isolation)
 * 4. Failed writes are detected (integrity)
 */
interface WriteAheadAuditLog {
  /** Sequence number for ordering */
  readonly sequence: bigint;

  /** Append entry with durability guarantee */
  append(entry: AuditEntry): Promise<AppendResult>;

  /** Checkpoint current WAL to archive */
  checkpoint(): Promise<CheckpointResult>;

  /** Recover from crash (called on startup) */
  recover(): Promise<RecoveryResult>;

  /** Query with optional time-travel */
  query(
    filter: AuditFilter,
    asOf?: Timestamp
  ): AsyncIterable<AuditEntry>;
}

interface AppendResult {
  /** Assigned sequence number */
  sequence: bigint;
  /** Time of durable write */
  durableAt: Timestamp;
  /** Checksum for verification */
  checksum: string;
}

interface RecoveryResult {
  /** Number of entries recovered */
  recovered: number;
  /** Number of entries lost (corrupted) */
  lost: number;
  /** Last valid sequence number */
  lastSequence: bigint;
  /** Recovery duration */
  durationMs: number;
}
```

### TLA+ Specification for Audit Durability

```tla
---- MODULE AuditWAL ----
EXTENDS Naturals, Sequences

VARIABLES wal, checkpoint, sequence

DurabilityInvariant ==
  \A e \in CommittedEntries:
    e \in wal \/ e \in ArchivedSegments

OrderingInvariant ==
  \A e1, e2 \in wal:
    e1.sequence < e2.sequence => e1.timestamp =< e2.timestamp

CrashRecovery ==
  AfterCrash =>
    \A e \in wal: Checksum(e) = e.checksum =>
      e \in RecoveredEntries

====
```

### Performance Targets

- Append latency: <1ms (mmap, no fsync per entry)
- Recovery time: <1s for 1M entries
- Query throughput: 100K entries/second for filtered scans

---

## LLM Capability Declarations (P21)

> **Purpose**: Declare what capabilities an LLM must have for a given operation, enabling capability-driven provider selection and graceful degradation.

### LlmCapability Interface

```typescript
/**
 * [CAPABILITIES] LLM capability declaration
 *
 * Operations declare required/optional LLM capabilities.
 * Provider selection uses these to find compatible models.
 */
type LlmCapabilityType =
  | 'json_output'           // Model can produce structured JSON
  | 'schema_compliance'     // Model can follow JSON Schema constraints
  | 'instruction_following' // Model reliably follows instructions
  | 'code_generation'       // Model can generate syntactically valid code
  | 'reasoning'             // Model can perform multi-step reasoning
  | 'tool_use'              // Model can use function/tool calling
  | 'vision'                // Model can process images
  | 'long_context';         // Model supports >32K context

interface LlmCapabilityRequirement {
  /** The capability type */
  capability: LlmCapabilityType;
  /** Whether this capability is required or optional */
  required: boolean;
  /** Minimum quality level (0-1) if applicable */
  minQuality?: number;
  /** Reason this capability is needed (for error messages) */
  reason: string;
}

interface LlmCapabilityDeclaration {
  /** Operation or stage requiring these capabilities */
  operationId: string;
  /** Required capabilities (operation fails without these) */
  required: LlmCapabilityRequirement[];
  /** Optional capabilities (operation degrades without these) */
  optional: LlmCapabilityRequirement[];
  /** Fallback strategy when optional capabilities missing */
  degradationStrategy?: DegradationStrategy;
}

type DegradationStrategy =
  | { type: 'skip'; message: string }
  | { type: 'simplify'; simplifiedPrompt: string }
  | { type: 'retry_with_examples'; examples: unknown[] }
  | { type: 'fail_closed'; reason: string };
```

### Capability Validation Functions

```typescript
interface LlmCapabilityValidator {
  /**
   * Validate a model has required capabilities
   * Returns missing capabilities if validation fails
   */
  validate(
    model: LlmModelDescriptor,
    declaration: LlmCapabilityDeclaration
  ): CapabilityValidationResult;

  /**
   * Probe a model for its actual capabilities
   * Uses test prompts to verify claimed capabilities
   */
  probe(
    model: LlmModelDescriptor,
    capabilities: LlmCapabilityType[]
  ): Promise<CapabilityProbeResult>;

  /**
   * Find best model for given requirements
   * Returns ranked list of compatible models
   */
  findCompatible(
    declaration: LlmCapabilityDeclaration,
    available: LlmModelDescriptor[]
  ): CompatibleModelResult[];
}

interface CapabilityValidationResult {
  valid: boolean;
  missing: LlmCapabilityRequirement[];
  degraded: LlmCapabilityRequirement[];
  effectiveCapabilities: LlmCapabilityType[];
}

interface CapabilityProbeResult {
  /** Probed capabilities and their results */
  results: Map<LlmCapabilityType, CapabilityProbeOutcome>;
  /** Time taken to probe */
  durationMs: number;
  /** Tokens used for probing */
  tokensUsed: number;
}

interface CapabilityProbeOutcome {
  /** Whether capability is confirmed */
  available: boolean;
  /** Measured quality (0-1) */
  quality: number;
  /** Evidence from probe (digest of test output) */
  evidenceDigest: string;
  /** Failure reason if not available */
  failureReason?: string;
}
```

### Capability Declaration Registry

```typescript
/**
 * Registry of capability declarations for all operations
 */
interface CapabilityDeclarationRegistry {
  /** Register a capability declaration */
  register(declaration: LlmCapabilityDeclaration): void;

  /** Get declaration for an operation */
  get(operationId: string): LlmCapabilityDeclaration | undefined;

  /** List all registered operations */
  list(): string[];

  /** Find operations compatible with a model */
  findCompatibleOperations(model: LlmModelDescriptor): string[];
}

// Standard declarations for core operations
const CORE_CAPABILITY_DECLARATIONS: LlmCapabilityDeclaration[] = [
  {
    operationId: 'query_synthesis',
    required: [
      { capability: 'instruction_following', required: true, reason: 'Must follow query format instructions' },
      { capability: 'reasoning', required: true, reason: 'Must synthesize from multiple sources' },
    ],
    optional: [
      { capability: 'json_output', required: false, reason: 'Structured output preferred' },
    ],
  },
  {
    operationId: 'code_explanation',
    required: [
      { capability: 'code_generation', required: true, reason: 'Must understand code syntax' },
      { capability: 'reasoning', required: true, reason: 'Must explain code behavior' },
    ],
    optional: [],
  },
  {
    operationId: 'schema_extraction',
    required: [
      { capability: 'json_output', required: true, reason: 'Must produce valid JSON' },
      { capability: 'schema_compliance', required: true, reason: 'Must follow schema constraints' },
    ],
    optional: [],
    degradationStrategy: { type: 'fail_closed', reason: 'Schema extraction requires strict JSON output' },
  },
];
```

---

## Per-Stage Diagnostics (P22)

> **Purpose**: Provide detailed diagnostics for each stage of an operation, enabling root cause analysis, performance optimization, and error attribution.

### DiagnosticOutput Interface

```typescript
/**
 * [EVIDENCE_LEDGER] Per-stage diagnostic output
 *
 * Every stage emits diagnostic information for debugging,
 * performance analysis, and error attribution.
 */
interface DiagnosticOutput {
  /** Stage identifier */
  stageId: string;
  /** Stage name (human-readable) */
  stageName: string;
  /** Parent stage (for nested stages) */
  parentStageId?: string;

  /** Timing information */
  timing: StageTiming;
  /** Resource usage */
  resources: StageResources;
  /** Token consumption (if LLM involved) */
  tokens?: TokenUsage;

  /** Stage outcome */
  outcome: StageOutcome;
  /** Error details (if failed) */
  error?: StageError;

  /** Inputs consumed (digests for privacy) */
  inputDigests: Record<string, string>;
  /** Outputs produced (digests for privacy) */
  outputDigests: Record<string, string>;

  /** Trace references for drill-down */
  traceRefs: string[];
}

interface StageTiming {
  /** Stage start time (ISO) */
  startedAt: string;
  /** Stage end time (ISO) */
  completedAt: string;
  /** Total duration (ms) */
  durationMs: number;
  /** Time waiting for resources (ms) */
  waitTimeMs: number;
  /** Time in computation (ms) */
  computeTimeMs: number;
  /** Time in I/O (ms) */
  ioTimeMs: number;
}

interface StageResources {
  /** Peak memory usage (bytes) */
  peakMemoryBytes: number;
  /** Memory allocated during stage (bytes) */
  allocatedBytes: number;
  /** Memory freed during stage (bytes) */
  freedBytes: number;
  /** CPU time consumed (ms) */
  cpuTimeMs: number;
  /** File handles opened */
  fileHandlesOpened: number;
  /** Network requests made */
  networkRequests: number;
}

interface TokenUsage {
  /** Prompt tokens sent */
  promptTokens: number;
  /** Completion tokens received */
  completionTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** Estimated cost (USD) */
  estimatedCostUsd: number;
  /** Model used */
  model: string;
  /** Provider used */
  provider: string;
}

type StageOutcome =
  | { status: 'success'; summary: string }
  | { status: 'partial'; summary: string; degradation: string }
  | { status: 'failed'; summary: string }
  | { status: 'skipped'; reason: string };
```

### Error Attribution

```typescript
/**
 * Stage error with attribution
 */
interface StageError {
  /** Error category for routing */
  category: ErrorCategory;
  /** Error code (machine-readable) */
  code: string;
  /** Error message (human-readable) */
  message: string;
  /** Stack trace (sanitized) */
  stack?: string;
  /** Causal chain (which earlier stage caused this?) */
  causedBy?: string[];
  /** Suggested remediation */
  remediation?: RemediationStep[];
  /** Is this error retryable? */
  retryable: boolean;
  /** Retry strategy if retryable */
  retryStrategy?: RetryStrategy;
}

type ErrorCategory =
  | 'input_validation'    // Bad input data
  | 'configuration'       // Missing or invalid config
  | 'provider'            // LLM/external service issue
  | 'resource'            // Memory, disk, network
  | 'timeout'             // Operation took too long
  | 'permission'          // Authorization failure
  | 'logic'               // Bug in stage logic
  | 'dependency'          // Missing dependency
  | 'unknown';            // Unclassified error

interface RemediationStep {
  action: string;
  command?: string;
  documentation?: string;
}

interface RetryStrategy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}
```

### Diagnostic Aggregation

```typescript
/**
 * Aggregate diagnostics across all stages
 */
interface DiagnosticAggregator {
  /** Add stage diagnostic */
  add(diagnostic: DiagnosticOutput): void;

  /** Get all diagnostics for a run */
  getAll(): DiagnosticOutput[];

  /** Get critical path (longest chain) */
  getCriticalPath(): DiagnosticOutput[];

  /** Get failed stages with attribution */
  getFailures(): DiagnosticOutput[];

  /** Get resource summary */
  getResourceSummary(): ResourceSummary;

  /** Export for analysis */
  export(format: 'json' | 'flamegraph' | 'table'): string;
}

interface ResourceSummary {
  totalDurationMs: number;
  totalTokens: number;
  totalCostUsd: number;
  peakMemoryBytes: number;
  stageCount: number;
  failedStages: number;
  slowestStage: { stageId: string; durationMs: number };
  mostExpensiveStage: { stageId: string; tokens: number };
}
```

---

## Storage Capability Detection (P23)

> **Purpose**: Detect available storage capabilities at runtime, enabling capability-based behavior adaptation without hard-coding storage assumptions.

### StorageCapabilities Interface

```typescript
/**
 * [CAPABILITIES] Storage capability detection
 *
 * LiBrainian adapts to what storage can do, not what we assume.
 */
interface StorageCapabilities {
  /** Storage backend identifier */
  backendId: string;
  /** Backend type (sqlite, postgres, memory, etc.) */
  backendType: StorageBackendType;

  /** Feature detection results */
  features: StorageFeatures;

  /** Performance characteristics */
  performance: StoragePerformance;

  /** Limitations */
  limitations: StorageLimitations;
}

type StorageBackendType =
  | 'sqlite'
  | 'postgres'
  | 'mysql'
  | 'mongodb'
  | 'memory'
  | 'file_system'
  | 'unknown';

interface StorageFeatures {
  /** Supports ACID transactions */
  transactions: boolean;
  /** Supports nested/savepoint transactions */
  nestedTransactions: boolean;

  /** Supports full-text search */
  fullTextSearch: boolean;
  /** Full-text search variant */
  fullTextSearchType?: 'fts5' | 'tsvector' | 'elasticsearch' | 'custom';

  /** Supports vector similarity search */
  vectorSearch: boolean;
  /** Vector search dimensions supported */
  vectorDimensions?: number[];
  /** Vector distance metrics supported */
  vectorMetrics?: ('cosine' | 'euclidean' | 'dot_product')[];

  /** Supports schema migrations */
  migrations: boolean;
  /** Migration tracking style */
  migrationStyle?: 'table' | 'file' | 'none';

  /** Supports JSON columns */
  jsonColumns: boolean;
  /** Supports JSON path queries */
  jsonPathQueries: boolean;

  /** Supports foreign keys */
  foreignKeys: boolean;
  /** Supports cascade operations */
  cascadeOperations: boolean;

  /** Supports triggers */
  triggers: boolean;
  /** Supports stored procedures */
  storedProcedures: boolean;

  /** Supports concurrent writes */
  concurrentWrites: boolean;
  /** Isolation levels supported */
  isolationLevels?: ('read_uncommitted' | 'read_committed' | 'repeatable_read' | 'serializable')[];
}

interface StoragePerformance {
  /** Approximate read latency (ms) */
  readLatencyMs: number;
  /** Approximate write latency (ms) */
  writeLatencyMs: number;
  /** Approximate max throughput (ops/sec) */
  maxThroughput: number;
  /** Connection pool size */
  connectionPoolSize: number;
}

interface StorageLimitations {
  /** Maximum row size (bytes) */
  maxRowSize?: number;
  /** Maximum text field size (bytes) */
  maxTextSize?: number;
  /** Maximum blob size (bytes) */
  maxBlobSize?: number;
  /** Maximum query complexity (joins, etc.) */
  maxQueryComplexity?: number;
  /** Maximum concurrent connections */
  maxConnections?: number;
}
```

### Capability Detection Functions

```typescript
interface StorageCapabilityDetector {
  /**
   * Detect capabilities of a storage backend
   */
  detect(backend: StorageBackend): Promise<StorageCapabilities>;

  /**
   * Check if specific feature is available
   */
  hasFeature(feature: keyof StorageFeatures): boolean;

  /**
   * Get best available feature for a requirement
   * (e.g., best available search: vector > fts > like)
   */
  getBestFeature(requirement: FeatureRequirement): FeatureSelection;
}

interface FeatureRequirement {
  need: 'search' | 'storage' | 'transaction' | 'migration';
  preference: ('vector' | 'fulltext' | 'basic')[];
  fallback: boolean;
}

interface FeatureSelection {
  selected: string;
  available: string[];
  degraded: boolean;
  degradationReason?: string;
}
```

### Capability-Based Adaptation

```typescript
/**
 * Adapter that uses detected capabilities
 */
interface CapabilityAwareStorageAdapter {
  /** Execute search using best available method */
  search(query: SearchQuery): Promise<SearchResult>;

  /** Execute write using best available transaction support */
  write(operation: WriteOperation): Promise<WriteResult>;

  /** Execute migration using available migration support */
  migrate(migration: Migration): Promise<MigrationResult>;
}

// Example: Search adapts to available capabilities
function adaptSearchToCapabilities(
  query: SearchQuery,
  capabilities: StorageCapabilities
): AdaptedSearch {
  if (capabilities.features.vectorSearch && query.vector) {
    return { type: 'vector', query: buildVectorQuery(query) };
  }
  if (capabilities.features.fullTextSearch && query.text) {
    return { type: 'fulltext', query: buildFtsQuery(query) };
  }
  return { type: 'basic', query: buildLikeQuery(query) };
}
```

---

## Evidence Ledger vNext (Schema + Replay) — Not Implemented Yet

> **Purpose**: Complete the Evidence Ledger specification with schemas for all event types, correlation IDs, replay mechanisms, and forensic chain reconstruction.

### Complete Event Schemas

```typescript
/**
 * VNext schema: richer, replay-capable event taxonomy.
 *
 * IMPORTANT: This is intentionally separate from V1 `EvidenceEntry` to avoid spec↔code drift.
 * If/when we implement this, we must provide a migration from V1 and gates proving correctness.
 */

type LedgerEntryTypeV2 =
  | 'llm_call'
  | 'tool_call'
  | 'operator_event'
  | 'file_read'
  | 'file_write'
  | 'randomness_draw'
  | 'checkpoint';

type LedgerPayloadV2 =
  | LlmCallPayload
  | ToolCallPayload
  | OperatorEventPayload
  | FileReadPayload
  | FileWritePayload
  | RandomnessPayload
  | CheckpointPayload;

interface LedgerEntryV2 {
  id: string;
  type: LedgerEntryTypeV2;
  /** ISO timestamp */
  timestamp: string;
  payload: LedgerPayloadV2;
}

interface LedgerFilterV2 {
  types?: LedgerEntryTypeV2[];
  since?: string;
  until?: string;
  traceId?: string;
}

// LLM Call Events
interface LlmCallPayload {
  type: 'llm_call';
  /** Unique call ID */
  callId: string;
  /** Provider ID */
  provider: string;
  /** Model ID */
  model: string;
  /** Prompt digest (hash of full prompt) */
  promptDigest: string;
  /** Prompt preview (first N chars, sanitized) */
  promptPreview: string;
  /** Response digest */
  responseDigest: string;
  /** Response preview */
  responsePreview: string;
  /** Token counts */
  tokens: { prompt: number; completion: number; total: number };
  /** Latency (ms) */
  latencyMs: number;
  /** Cost (USD) */
  costUsd: number;
  /** Temperature and other params */
  params: Record<string, unknown>;
  /** Capability requirements for this call */
  requiredCapabilities: LlmCapabilityType[];
  /** Was response cached? */
  cached: boolean;
  /** Retry attempt number (0 = first try) */
  attempt: number;
}

// Tool Call Events
interface ToolCallPayload {
  type: 'tool_call';
  /** Unique call ID */
  callId: string;
  /** Tool identifier */
  toolId: string;
  /** Tool namespace (mcp, skill, builtin) */
  namespace: string;
  /** Arguments digest */
  argsDigest: string;
  /** Arguments preview (sanitized) */
  argsPreview: string;
  /** Result digest */
  resultDigest: string;
  /** Result preview (sanitized) */
  resultPreview: string;
  /** Outcome */
  outcome: 'success' | 'error' | 'timeout' | 'rate_limited';
  /** Error details if failed */
  error?: { code: string; message: string };
  /** Duration (ms) */
  durationMs: number;
  /** Resources affected */
  affectedResources: string[];
  /** Was this call idempotent? */
  idempotent: boolean;
}

// Operator Events
interface OperatorEventPayload {
  type: 'operator_event';
  /** Event subtype */
  subtype: OperatorEventSubtype;
  /** Operator ID */
  operatorId: string;
  /** Operator type */
  operatorType: string;
  /** Input primitive IDs */
  inputPrimitiveIds: string[];
  /** Output primitive IDs */
  outputPrimitiveIds: string[];
  /** Execution details */
  details: Record<string, unknown>;
}

type OperatorEventSubtype =
  | 'started'
  | 'completed'
  | 'failed'
  | 'branch_taken'
  | 'retry_scheduled'
  | 'checkpoint_created'
  | 'coverage_gap_detected';

// File I/O Events
interface FileReadPayload {
  type: 'file_read';
  path: string;
  contentDigest: string;
  sizeBytes: number;
  encoding: string;
  modifiedAt: string;
}

interface FileWritePayload {
  type: 'file_write';
  path: string;
  contentDigest: string;
  sizeBytes: number;
  operation: 'create' | 'update' | 'delete';
  previousDigest?: string;
}

// Randomness Events (for replay determinism)
interface RandomnessPayload {
  type: 'randomness_draw';
  source: string;
  value: string;
  purpose: string;
}

// Checkpoint Events
interface CheckpointPayload {
  type: 'checkpoint';
  checkpointId: string;
  stateDigest: string;
  entryCount: number;
  reason: string;
}
```

### Correlation IDs for Causality Tracing

```typescript
/**
 * Correlation ID system for tracing causality
 */
interface CorrelationContext {
  /** Root operation ID (top-level query/command) */
  rootId: string;
  /** Parent entry ID (immediate cause) */
  parentId: string;
  /** Current entry ID */
  entryId: string;
  /** Span for distributed tracing compatibility */
  spanId: string;
  /** Trace ID for cross-system correlation */
  traceId: string;
  /** Causality depth (0 = root, 1 = first child, etc.) */
  depth: number;
  /** Fork index (for parallel execution branches) */
  forkIndex: number;
}

interface LedgerEntryV2WithCorrelation extends LedgerEntryV2 {
  /** Correlation context for causality tracing */
  correlation: CorrelationContext;
}

/**
 * Build causality graph from ledger entries
 */
function buildCausalityGraph(
  entries: LedgerEntryV2WithCorrelation[]
): CausalityGraph {
  const nodes = new Map<string, CausalityNode>();
  const edges: CausalityEdge[] = [];

  for (const entry of entries) {
    nodes.set(entry.id, {
      id: entry.id,
      type: entry.type,
      timestamp: entry.timestamp,
      depth: entry.correlation.depth,
    });

    if (entry.correlation.parentId) {
      edges.push({
        from: entry.correlation.parentId,
        to: entry.id,
        relation: 'caused',
      });
    }
  }

  return { nodes, edges };
}

interface CausalityGraph {
  nodes: Map<string, CausalityNode>;
  edges: CausalityEdge[];
}

interface CausalityNode {
  id: string;
  type: LedgerEntryTypeV2;
  timestamp: string;
  depth: number;
}

interface CausalityEdge {
  from: string;
  to: string;
  relation: 'caused' | 'preceded' | 'forked';
}
```

### Replay Mechanism Specification

```typescript
/**
 * Replay mechanism for reproducible execution
 */
interface ReplayController {
  /** Start replay from a checkpoint */
  startReplay(checkpointId: string): Promise<ReplaySession>;

  /** Step through replay entries */
  step(session: ReplaySession): Promise<ReplayStepResult>;

  /** Run replay to completion */
  runToCompletion(session: ReplaySession): Promise<ReplayResult>;

  /** Verify replay matches original */
  verify(session: ReplaySession, original: LedgerEntryV2[]): VerificationResult;
}

interface ReplaySession {
  /** Session ID */
  id: string;
  /** Starting checkpoint */
  checkpointId: string;
  /** Current position in replay */
  position: number;
  /** Total entries to replay */
  totalEntries: number;
  /** Replay mode */
  mode: ReplayMode;
  /** Mocked external calls */
  mocks: ReplayMocks;
}

type ReplayMode =
  | 'strict'      // Fail if any divergence
  | 'lenient'     // Allow minor divergences
  | 'diagnostic'; // Record all divergences without failing

interface ReplayMocks {
  /** LLM call results (keyed by prompt digest) */
  llmCalls: Map<string, string>;
  /** Tool call results (keyed by args digest) */
  toolCalls: Map<string, string>;
  /** Randomness values (keyed by source + purpose) */
  randomness: Map<string, string>;
  /** File contents (keyed by path + timestamp) */
  fileContents: Map<string, string>;
}

interface ReplayStepResult {
  entry: LedgerEntryV2;
  replayed: boolean;
  divergence?: ReplayDivergence;
}

interface ReplayDivergence {
  field: string;
  expected: unknown;
  actual: unknown;
  severity: 'critical' | 'warning' | 'info';
}

interface ReplayResult {
  success: boolean;
  entriesReplayed: number;
  divergences: ReplayDivergence[];
  duration: number;
}

interface VerificationResult {
  verified: boolean;
  matchRate: number;
  mismatches: Array<{
    entryId: string;
    divergences: ReplayDivergence[];
  }>;
}
```

### Forensic Chain Reconstruction

```typescript
/**
 * Forensic analysis for post-mortem investigation
 */
interface ForensicAnalyzer {
  /** Reconstruct event chain leading to an outcome */
  reconstructChain(
    targetEntryId: string,
    ledger: EvidenceLedgerKernelV2
  ): Promise<ForensicChain>;

  /** Find all entries related to a claim */
  findEvidenceForClaim(
    claimId: string,
    ledger: EvidenceLedgerKernelV2
  ): Promise<ClaimEvidence>;

  /** Identify failure root cause */
  identifyRootCause(
    failureEntryId: string,
    ledger: EvidenceLedgerKernelV2
  ): Promise<RootCauseAnalysis>;

  /** Generate human-readable incident report */
  generateReport(
    chain: ForensicChain,
    format: 'markdown' | 'json' | 'html'
  ): string;
}

interface ForensicChain {
  /** Target entry we're investigating */
  target: LedgerEntryV2;
  /** All causal ancestors */
  ancestors: LedgerEntryV2[];
  /** All causal descendants */
  descendants: LedgerEntryV2[];
  /** Timeline of events */
  timeline: TimelineEvent[];
  /** Decision points (branches taken) */
  decisions: DecisionPoint[];
  /** Resource consumption along the chain */
  resources: ResourceTrace;
}

interface TimelineEvent {
  entry: LedgerEntryV2;
  relativeTimeMs: number;
  significance: 'high' | 'medium' | 'low';
  annotation?: string;
}

interface DecisionPoint {
  entryId: string;
  decision: string;
  alternatives: string[];
  reason: string;
}

interface ResourceTrace {
  totalTokens: number;
  totalCostUsd: number;
  totalDurationMs: number;
  peakMemoryBytes: number;
  externalCalls: number;
}

interface ClaimEvidence {
  claimId: string;
  supportingEntries: LedgerEntryV2[];
  evidenceStrength: 'strong' | 'moderate' | 'weak';
  gaps: string[];
}

interface RootCauseAnalysis {
  rootCauseEntry: LedgerEntryV2;
  contributingFactors: LedgerEntryV2[];
  classification: ErrorCategory;
  confidence: ConfidenceValue;
  suggestedFixes: string[];
}
```

---

## Epistemic Kernel Mapping

> **Purpose**: Map Layer 2 Infrastructure to the core epistemic kernel concepts, ensuring all infrastructure components support LiBrainian's epistemological foundation.

### Kernel Concept Overview

The Epistemic Kernel is LiBrainian's foundation for producing meaningful, verifiable understanding. Layer 2 Infrastructure implements five core kernel concepts:

| Kernel Concept | Layer 2 Implementation | Purpose |
|----------------|----------------------|---------|
| **CAPABILITIES** | Provider Discovery + Capability Negotiation | What can this environment do? |
| **EVIDENCE_LEDGER** | Evidence Ledger + Audit Trail | What was observed/done? |
| **CLAIMS** | Claim Evidence Mapping | What can we assert with evidence? |
| **BUDGETS** | Token/Time/IO Bounds | What are our resource limits? |
| **REPLAY** | Replay Mechanism | Can we reproduce this run? |

### CAPABILITIES (Provisioning & Discovery)

```typescript
/**
 * [CAPABILITIES] Kernel concept: What can this environment do?
 *
 * Maps to:
 * - LLM Provider Discovery (P0)
 * - LLM Capability Declarations (P21)
 * - Storage Capability Detection (P23)
 * - Tool/Skill Registry
 */
interface CapabilitiesKernel {
  /** Provision: Set up available capabilities */
  provision(config: ProvisionConfig): Promise<ProvisionResult>;

  /** Discover: Find what's available */
  discover(): Promise<DiscoveryResult>;

  /** Require: Fail if capabilities missing */
  require(capabilities: CapabilityId[]): void;

  /** Query: What capabilities are available? */
  query(filter?: CapabilityFilter): CapabilityDescriptor[];

  /** Negotiate: Find best match for requirements */
  negotiate(requirements: CapabilityRequirement[]): NegotiationResult;
}

interface ProvisionConfig {
  llmProviders?: LlmProviderConfig[];
  storageBackend?: StorageConfig;
  tools?: ToolConfig[];
  budgets?: BudgetConfig;
}

interface DiscoveryResult {
  llmProviders: LlmProviderDescriptor[];
  storageCapabilities: StorageCapabilities;
  tools: ToolDescriptor[];
  constraints: EnvironmentConstraints;
}
```

### EVIDENCE_LEDGER (Schema & Replay)

```typescript
/**
 * [EVIDENCE_LEDGER] Kernel concept: What was observed/done?
 *
 * Maps to:
 * - Evidence Ledger (complete schema)
 * - Per-Stage Diagnostics (P22)
 * - Correlation IDs
 * - Forensic Chain Reconstruction
 */
interface EvidenceLedgerKernelV2 {
  /** Schema: Define event types */
  readonly schema: LedgerSchemaV2;

  /** Record: Append an observation */
  record(entry: LedgerEntryV2): Promise<RecordResult>;

  /** Query: Find entries matching criteria */
  query(filter: LedgerFilterV2): AsyncIterable<LedgerEntryV2>;

  /** Trace: Build causality chain */
  trace(entryId: string): Promise<CausalityGraph>;

  /** Replay: Reproduce a run */
  replay(checkpointId: string): ReplayController;
}

interface LedgerSchemaV2 {
  version: string;
  eventTypes: LedgerEntryTypeV2[];
  payloadSchemas: Map<LedgerEntryTypeV2, JSONSchema>;
  validate(entry: LedgerEntryV2): ValidationResult;
}
```

### CLAIMS (Machine-Checkable Format)

```typescript
/**
 * [CLAIMS] Kernel concept: What can we assert with evidence?
 *
 * Maps to:
 * - Claim Evidence Mapping
 * - Confidence Calibration
 * - Defeasible Claims
 */
interface ClaimsKernel {
  /** Make: Create a claim with evidence */
  make(claim: Claim, evidence: EvidenceRef[]): ClaimResult;

  /** Verify: Check if claim is still supported */
  verify(claimId: string): VerificationResult;

  /** Challenge: Present counter-evidence */
  challenge(claimId: string, counterEvidence: EvidenceRef[]): ChallengeResult;

  /** Query: Find claims about a topic */
  query(topic: string): Claim[];
}

interface Claim {
  /** Claim identifier */
  id: string;
  /** What is being claimed */
  statement: string;
  /** Machine-checkable form */
  predicate: ClaimPredicate;
  /** Evidence references */
  evidenceRefs: EvidenceRef[];
  /** Raw confidence (from extraction) */
  rawConfidence: number;
  /** Calibrated confidence (from feedback) */
  calibratedConfidence: number;
  /** Claim status */
  status: ClaimStatus;
  /** Defeasibility: can this be overturned? */
  defeasible: boolean;
}

type ClaimPredicate =
  | { type: 'exists'; entityId: string }
  | { type: 'has_property'; entityId: string; property: string; value: unknown }
  | { type: 'relation'; fromId: string; relation: string; toId: string }
  | { type: 'composite'; operator: 'and' | 'or'; predicates: ClaimPredicate[] };

type ClaimStatus =
  | 'active'       // Currently believed true
  | 'challenged'   // Counter-evidence exists
  | 'retracted'    // No longer believed
  | 'superseded';  // Replaced by newer claim

interface EvidenceRef {
  ledgerEntryId: string;
  relevance: string;
  strength: 'strong' | 'moderate' | 'weak';
}
```

### BUDGETS (Token/Time/IO Bounds)

```typescript
/**
 * [BUDGETS] Kernel concept: What are our resource limits?
 *
 * Maps to:
 * - Token Budgets
 * - Time Limits
 * - I/O Quotas
 * - Cost Controls
 */
interface BudgetsKernel {
  /** Get: Current budget state */
  get(): BudgetState;

  /** Consume: Use budget for an operation */
  consume(usage: ResourceUsage): ConsumeResult;

  /** Reserve: Pre-allocate budget */
  reserve(amount: ResourceUsage): ReserveResult;

  /** Release: Return unused reservation */
  release(reservationId: string): void;

  /** Adjust: Modify budget limits (admin) */
  adjust(adjustment: BudgetAdjustment): void;
}

interface BudgetState {
  tokens: TokenBudget;
  time: TimeBudget;
  io: IoBudget;
  cost: CostBudget;
}

interface TokenBudget {
  limit: number;
  used: number;
  remaining: number;
  reservations: number;
}

interface TimeBudget {
  limitMs: number;
  elapsedMs: number;
  remainingMs: number;
  deadline?: string;
}

interface IoBudget {
  maxReads: number;
  maxWrites: number;
  readsUsed: number;
  writesUsed: number;
  maxBytesRead: number;
  maxBytesWritten: number;
  bytesRead: number;
  bytesWritten: number;
}

interface CostBudget {
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
}

type ConsumeResult =
  | { success: true; remaining: ResourceUsage }
  | { success: false; reason: 'budget_exceeded'; overage: ResourceUsage };
```

### REPLAY (Determinism Marking)

```typescript
/**
 * [REPLAY] Kernel concept: Can we reproduce this run?
 *
 * Maps to:
 * - Replay Mechanism Specification
 * - Determinism Tracking
 * - Non-Replayable Marking
 */
interface ReplayKernel {
  /** Mark: Tag current execution for replay handling */
  mark(marker: ReplayMarker): void;

  /** Check: Is this execution replayable? */
  isReplayable(): ReplayabilityResult;

  /** Checkpoint: Create replay restoration point */
  checkpoint(reason: string): Promise<CheckpointResult>;

  /** Restore: Replay from checkpoint */
  restore(checkpointId: string): Promise<ReplaySession>;

  /** Verify: Compare replay to original */
  verify(session: ReplaySession): Promise<VerificationResult>;
}

interface ReplayMarker {
  /** What is being marked */
  scope: string;
  /** Is this section replayable? */
  replayable: boolean;
  /** If not replayable, why? */
  reason?: NonReplayableReason;
  /** Can we mock this for replay? */
  mockable?: boolean;
  /** Mock key for replay lookup */
  mockKey?: string;
}

type NonReplayableReason =
  | 'external_api'          // Calls external service
  | 'randomness'            // Uses non-seeded randomness
  | 'time_dependent'        // Depends on current time
  | 'user_input'            // Requires interactive input
  | 'side_effect'           // Has irreversible side effects
  | 'non_deterministic_llm' // LLM response varies
  | 'environment_state';    // Depends on mutable environment

interface ReplayabilityResult {
  replayable: boolean;
  nonReplayableSegments: Array<{
    scope: string;
    reason: NonReplayableReason;
    mockable: boolean;
  }>;
  coveragePercent: number;
}

/**
 * Replayability best practices:
 *
 * 1. Mark non-replayable sections explicitly
 * 2. Provide mock keys for mockable sections
 * 3. Record randomness draws to ledger
 * 4. Checkpoint before external calls
 * 5. Use `unverified_by_trace(replay_unavailable)` honestly
 */
```

### Integration: How the Kernel Supports LiBrainian

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          EPISTEMIC KERNEL                                │
│                                                                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│  │ CAPABILITIES│ │EVIDENCE_    │ │   CLAIMS    │ │   BUDGETS   │        │
│  │             │ │LEDGER       │ │             │ │             │        │
│  │ - Discovery │ │ - Schema    │ │ - Predicate │ │ - Tokens    │        │
│  │ - Provision │ │ - Replay    │ │ - Evidence  │ │ - Time      │        │
│  │ - Negotiate │ │ - Forensics │ │ - Calibrate │ │ - I/O       │        │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘        │
│         │               │               │               │                │
│         └───────────────┴───────────────┴───────────────┘                │
│                                   │                                      │
│                                   ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                           REPLAY                                  │   │
│  │                                                                   │   │
│  │   - Determinism marking                                           │   │
│  │   - Checkpoint/restore                                            │   │
│  │   - Verification                                                  │   │
│  │   - Non-replayable disclosure                                     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────┐
                    │   MEANINGFUL EPISTEMOLOGY │
                    │                           │
                    │ Claims are machine-       │
                    │ checkable, evidence-      │
                    │ backed, calibrated,       │
                    │ defeasible, and           │
                    │ reproducible              │
                    └───────────────────────────┘
```

---

## Capability Negotiation / Provider Discovery

### Theoretical Foundation

Future agent environments are unpredictable; the only stable interface is a **negotiated capability lattice**. Instead of assuming what's available, LiBrainian must:

1. **Discover** what capabilities exist in this environment
2. **Negotiate** which capabilities to use
3. **Disclose** when capabilities are missing or degraded

**Theory**: portability requires treating "tools/providers/models" as replaceable substrates, not assumptions.

### Current State (V0)

Minimal capability negotiation is implemented as fail-closed contracts:
- `packages/LiBrainian/src/api/capability_contracts.ts` (`Capability`, `CapabilityContract`, `negotiateCapabilities`, `requireCapabilities`)
- Tier-0 tests: `packages/LiBrainian/src/__tests__/capability_contracts.test.ts`

This is intentionally smaller than the full lattice below (no descriptors/schemas yet). The next step is wiring: operations must declare required/optional capabilities and surface `degradedMode` in outputs (never silent).

### Capability Contracts

```typescript
/**
 * [CAPABILITIES] Capability contracts
 *
 * "What can this environment do?"
 * (LLM, embeddings, repo access, file watching, MCP, tools, budgets)
 */
interface CapabilityLattice {
  /** Check if a capability is available */
  has(capability: CapabilityId): boolean;

  /** Get capability descriptor if available */
  get(capability: CapabilityId): CapabilityDescriptor | undefined;

  /** Require capabilities (fail-closed if missing) */
  require(capabilities: CapabilityId[]): void;

  /** Check capabilities (return missing) */
  check(capabilities: CapabilityId[]): CapabilityCheckResult;

  /** Negotiate best available from options */
  negotiate(options: CapabilityRequirement[]): NegotiationResult;
}

interface CapabilityDescriptor {
  id: string;
  name: string;
  version: string;
  /** Self-describing schema for inputs/outputs */
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  /** What this capability does (for semantic matching) */
  description: string;
  tags: string[];
  /** Evidence of capability (tests, examples, history) */
  evidence: CapabilityEvidence;
  /** When this capability was discovered */
  discoveredAt: string;
  /** Source (skill, tool, MCP, external, emergent) */
  source: CapabilitySource;
}

type CapabilitySource =
  | { type: 'skill'; skillId: string }
  | { type: 'mcp_tool'; serverId: string; toolName: string }
  | { type: 'external_api'; endpoint: string }
  | { type: 'agent_learned'; agentId: string; episodeId: string }
  | { type: 'composition'; componentIds: string[] }
  | { type: 'unknown'; metadata: Record<string, unknown> };
```

### The Emergent Capability Protocol

> **Key insight**: We can't predict what capabilities agents will develop. LiBrainian must support capabilities that DON'T EXIST YET.

```typescript
// Framework for unknown future capabilities
interface EmergentCapabilityProtocol {
  // 1. Capability Advertisement
  advertise(capability: CapabilityDescriptor): void;

  // 2. Capability Discovery
  discover(query: CapabilityQuery): CapabilityDescriptor[];

  // 3. Capability Negotiation
  negotiate(required: CapabilityRequirement[], available: CapabilityDescriptor[]): NegotiationResult;

  // 4. Capability Invocation (generic)
  invoke<T>(capabilityId: string, params: unknown): Promise<T>;

  // 5. Capability Learning
  learn(invocation: CapabilityInvocation, outcome: Outcome): void;
}

interface NegotiationResult {
  /** Successfully negotiated capabilities */
  granted: CapabilityDescriptor[];
  /** Required capabilities that couldn't be granted */
  denied: Array<{ requirement: CapabilityRequirement; reason: string }>;
  /** Optional capabilities that were unavailable */
  degraded: Array<{ requirement: CapabilityRequirement; fallback?: CapabilityDescriptor }>;
}
```

### Integration with Existing Systems

```
┌─────────────────────────────────────────────────────────────────────┐
│                    EMERGENT CAPABILITY LAYER                        │
│                                                                     │
│  Capability Registry ─── Discovery ─── Negotiation ─── Invocation  │
│         │                   │               │              │        │
└─────────┼───────────────────┼───────────────┼──────────────┼────────┘
          │                   │               │              │
          ▼                   ▼               ▼              ▼
┌─────────────────┐  ┌─────────────┐  ┌───────────┐  ┌─────────────┐
│ Skills System   │  │ MCP Tools   │  │ Patterns  │  │ Learning    │
│ (skills/*.ts)   │  │ (mcp/*.ts)  │  │ (catalog) │  │ Loop        │
└─────────────────┘  └─────────────┘  └───────────┘  └─────────────┘
          │                   │               │              │
          └───────────────────┴───────────────┴──────────────┘
                              │
                    ┌─────────────────┐
                    │ Technique       │
                    │ Compositions    │
                    └─────────────────┘
```

### Degraded Capability Handling

```typescript
interface DegradedCapability {
  /** What's missing */
  missingCapability: Capability;
  /** What's still available */
  availableCapabilities: Capability[];
  /** What was lost */
  lostCapabilities: Capability[];
  /** How to remediate */
  remediation: RemediationSteps;
}

function handleProviderFailure(
  failure: ProviderFailure
): DegradedCapability {
  // Determine what capabilities are affected
  // Calculate fallback options
  // Generate remediation steps
  // Return degraded state with full disclosure
}
```

### Default Protocol: Run Before Doing Work

This is the minimal protocol LiBrainian should run automatically at the start of: bootstrap, query, and plan compilation.

1. **Preflight** (environment/providers/filesystem/config): use the existing preflight framework (`packages/LiBrainian/src/preflight/checks.ts`).

2. **Capability probe (tools/resources)**: if MCP (or any tool registry) is present, ingest its tool/resource descriptors into `[CAPABILITIES]` and record them as evidence (so "tool available" is a claimable fact).

3. **Adequacy scan**: infer what evidence is required for the task type (build/test/data/metrics/rollbacks) and check whether the repo can supply it now.

4. **Remediation emission**: produce a short remediation plan, expressed as compositions of primitives/operators with explicit gates.

5. **Fail-closed on strong claims**: if adequacy is missing, LiBrainian must not allow "works / verified / safe" claims; it should return `unverified_by_trace(adequacy_missing)` with the exact missing items.

---

## Tool/MCP Adapter

### What Already Exists

| Component | Location | Status |
|-----------|----------|--------|
| **Skills System** | `packages/LiBrainian/src/skills/types.ts` | 570 LOC types defined |
| **Skill Loader** | `packages/LiBrainian/src/skills/loader.ts` | Implemented |
| **Skill Validator** | `packages/LiBrainian/src/skills/validator.ts` | Implemented |
| **MCP Tools** | `packages/LiBrainian/src/mcp/` | 20+ tools exposed |
| **Method Packs** | `packages/LiBrainian/src/api/packs.ts` | Skill->MethodPack adapter |

### The Skills Architecture

```typescript
// Skills are portable procedural knowledge that agents can use
interface AgentSkill {
  identity: { id, name, version, namespace };
  definition: {
    trigger: { taskTypes, intentPatterns, filePatterns, condition };
    workflow: WorkflowStep[];  // script, command, llm, decision, parallel, conditional, manual
    inputs: SkillInput[];
    outputs: SkillOutput[];
    dependencies: SkillDependency[];
  };
  scripts: SkillScript[];   // Executable scripts
  resources: SkillResource[]; // Templates, examples, configs
}
```

### What's Missing for Full Tool/Skill Support

| Priority | Feature | Description | LOC Est. |
|----------|---------|-------------|----------|
| **T1** | Tool Registry Integration | Connect skills to technique primitives | ~150 |
| **T2** | Dynamic Tool Discovery | Probe for available tools at runtime | ~200 |
| **T3** | Tool Capability Negotiation | Agents query "what can you do?" | ~150 |
| **T4** | Skill Composition | Combine skills into compound workflows | ~200 |
| **T5** | Emergent Capability Protocol | Framework for unknown future capabilities | ~300 |

### MCP Integration Subsystem

**Overview**: Model Context Protocol server exposing 20+ tools for Claude integration.

#### Problem 39: No Rate Limiting

MCP server accepts unlimited requests:
- Can be DoS'd with many large queries
- No throttling
- Resource exhaustion possible

**Solution**: Implement adaptive rate control with backpressure:

```typescript
interface RateLimitConfig {
  /** Requests per minute per session */
  requestsPerMinute: number;
  /** Tokens per minute per session */
  tokensPerMinute: number;
  /** Concurrent requests per session */
  maxConcurrent: number;
  /** Burst allowance */
  burstAllowance: number;
}

interface AdaptiveRateController {
  /** Current system load [0, 1] */
  readonly load: number;
  /** Current effective limits (adaptive) */
  readonly effectiveLimits: EffectiveLimits;
  /** Request admission with priority */
  admit(request: Request, priority: Priority): AdmitResult;
  /** Update limits based on feedback */
  feedback(result: RequestResult): void;
}

type Priority = 'critical' | 'high' | 'normal' | 'low' | 'background';

type AdmitResult =
  | { admitted: true; deadline: Timestamp; budget: TokenBudget }
  | { admitted: false; retryAfter: Timestamp; reason: string }
  | { queued: true; position: number; estimatedWait: number };
```

#### Problem 40: No Audit Persistence

Audit log is in-memory only:
- Lost on server restart
- Can't analyze historical access
- No compliance trail

**Solution**: See Evidence Ledger section above for persistent audit logging.

### Prebuilt Capability Packs

Keep scenario-agnostic by shipping a small number of **packs** (bundles of detectors + primitives + compositions):

- `pack_ml_adequacy`: adequacy spec + simulation + calibration + leakage/shift detectors
- `pack_release_safety`: rollout/rollback, migrations (expand/contract), canary, incident/runbooks
- `pack_distributed_resilience`: timeouts/retries/backpressure, ordering, idempotency, fault-injection
- `pack_security_baseline`: secrets/redaction, trust boundaries, authz scenario tests, auditability
- `pack_perf_budgeting`: benchmarks, profiling, load tests, capacity/cost budgets (including governor policies)
- `pack_tooling_mcp`: tool/resource capability ingestion + tool-call evidence emission (so tool usage is auditable and supports claims)
- `pack_provenance_attestation`: signed build/test/eval artifacts (when available) to upgrade evidence strength for "verified" claims
- `pack_replay_determinism`: record/replay substrate integration (when available) to upgrade reproducibility and regression falsifiability

---

## Implementation Priorities

### Tool/Skill Support (T1-T5)

| Priority | Feature | Description | LOC Est. |
|----------|---------|-------------|----------|
| **T1** | Tool Registry Integration | Connect skills to technique primitives | ~150 |
| **T2** | Dynamic Tool Discovery | Probe for available tools at runtime | ~200 |
| **T3** | Tool Capability Negotiation | Agents query "what can you do?" | ~150 |
| **T4** | Skill Composition | Combine skills into compound workflows | ~200 |
| **T5** | Emergent Capability Protocol | Framework for unknown future capabilities | ~300 |

### Architectural Priorities (G1-G8)

| Priority | Feature | Principle | LOC | Description |
|----------|---------|-----------|-----|-------------|
| **G1** | Pure Core Refactor | G1 | ~150 | Ensure all core functions take dependencies as parameters |
| **G2** | Actor Interface | G2 | ~100 | Add `receive(message): response` wrapper for integration |
| **G3** | Operator Algebra Tests | G3 | ~200 | Add property-based tests for algebraic laws |
| **G4** | Capability Tokens | G4 | ~200 | Replace permission checks with capability tokens |
| **G5** | Context Budget API | G5 | ~150 | Add explicit token budgets to all context operations |
| **G6** | Self-Description Schemas | G6 | ~100 | Add JSON Schema self-description to all primitives |
| **G7** | Protocol Adapters | G1, G2 | ~300 | MCP, CLI, HTTP as thin adapters over pure core |
| **G8** | Independence Tests | G1-G6 | ~200 | Integration tests that verify independence invariants |

### The Six Architectural Invariants

| # | Principle | Invariant | Violation Example |
|---|-----------|-----------|-------------------|
| **G1** | Pure Function Core | `query()`, `search()`, `compose()`, `verify()` take all dependencies as parameters | Hidden global state, implicit LLM dependency |
| **G2** | Message Passing | External integration via `receive(message) -> response` | Direct function calls that bypass the actor interface |
| **G3** | Algebraic Composition | Operations form an algebra: closure, associativity, identity | Ad-hoc composition that doesn't follow operator laws |
| **G4** | Capability-Based | Security via unforgeable tokens, not permission lists | `if (user.hasRole('admin'))` checks |
| **G5** | Context as Resource | Context is explicit, typed, and budget-managed | Implicit context accumulation, unbounded retrieval |
| **G6** | Self-Description | Every component describes its capabilities and evidence | Magic strings, undocumented assumptions |

---

## Acceptance Criteria

### LLM Provider Discovery

- [ ] `resolveLibrarianModelConfigWithDiscovery()` is the ONLY entrypoint for LLM config
- [ ] All call sites use discovery (no direct `LLMService` instantiation)
- [ ] Provider probes emit `[EVIDENCE_LEDGER]` events
- [ ] Helpful error messages when no providers available
- [ ] Custom providers can be registered via `llmProviderRegistry.register()`
- [ ] Model qualification gate runs for new local models

### Evidence Ledger

- [ ] Unified ledger exists spanning all subsystems
- [ ] All LLM calls emit evidence events
- [ ] All tool calls emit evidence events
- [ ] Checkpoint/replay mechanism works
- [ ] Crash recovery preserves entries

### Capability Negotiation

- [ ] Capability lattice is queryable at runtime
- [ ] Operations declare required/optional capabilities
- [ ] Degraded mode disclosures are explicit
- [ ] `unverified_by_trace(capability_missing)` used appropriately

### Tool/MCP Adapter

- [ ] Rate limiting prevents abuse
- [ ] Audit log persists across restarts
- [ ] Tool calls emit evidence events
- [ ] Tool capability negotiation works

### Evidence Commands

```bash
# LLM Provider Discovery
cd packages/LiBrainian && npx vitest src/api/__tests__/llm_provider_discovery.test.ts

# Provider check
cd packages/LiBrainian && npx tsc --noEmit

# MCP Integration
cd packages/LiBrainian && npx vitest src/mcp/__tests__/schema.test.ts

# Full Tier-0
npm run test:tier0
```

---

## References

- **Primary source**: `docs/LiBrainian/THEORETICAL_CRITIQUE.md`
- **Part XVI**: Lines 15547-16058 (Extensible LLM Provider Discovery)
- **Evidence Ledger**: Lines 165-224, 2792-2806, 7032-7310
- **Capability Negotiation**: Lines 165-224, 680-772
- **Tool/MCP Adapter**: Lines 647-772, 6805-7310
- **Architecture**: Lines 800-862
