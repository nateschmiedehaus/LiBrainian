# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# World-Class LiBrainian Implementation Plan

## Executive Summary

This document outlines the complete plan to transform the LiBrainian into a world-class knowledge system that perfectly serves agentic systems. It addresses:

1. **Knowledge Ontology** - Complete knowledge model for any codebase
2. **Resilient Architecture** - Fault-tolerant design with graceful degradation
3. **Provider Failover** - Claude ↔ Codex automatic switching
4. **Codebase Cleanup** - Refactoring existing code for maintainability
5. **Integration Safety** - Preventing component integration failures
6. **Agent Optimization** - Delivering knowledge optimized for autonomous agents

---

## Table of Contents

1. [Knowledge Ontology](#1-knowledge-ontology)
2. [Emergent Entity Discovery](#2-emergent-entity-discovery)
3. [Provider Architecture](#3-provider-architecture)
4. [Resilient Core Infrastructure](#4-resilient-core-infrastructure)
5. [Codebase Cleanup Plan](#5-codebase-cleanup-plan)
6. [Integration Failure Prevention](#6-integration-failure-prevention)
7. [Agent-Optimized Query Interface](#7-agent-optimized-query-interface)
8. [Implementation Phases](#8-implementation-phases)
9. [File-by-File Changes](#9-file-by-file-changes)
10. [Testing Strategy](#10-testing-strategy)
11. [Local Embedding & Retrieval Pipeline](#11-local-embedding--retrieval-pipeline)
12. [File Watcher & Freshness Management](#12-file-watcher--freshness-management)
13. [Knowledge Aggregation](#13-knowledge-aggregation)
14. [Multi-Agent Coordination](#14-multi-agent-coordination)
15. [Agent Lifecycle & Context-Aware Knowledge](#15-agent-lifecycle--context-aware-knowledge)
16. [Predictive Prefetching](#16-predictive-prefetching)
17. [Agent Failure Recovery](#17-agent-failure-recovery)
18. [Agent Learning Integration](#18-agent-learning-integration)
19. [Confidence Calibration for Autonomy](#19-confidence-calibration-for-autonomy)
20. [Edge Cases & Failure Handling](#20-edge-cases--failure-handling)
21. [Existing Test Coverage](#21-existing-test-coverage)
22. [Implicit, Modular & Adaptive Systems](#22-implicit-modular--adaptive-systems)
23. [Bootstrap Integration Testing](#23-bootstrap-integration-testing)

---

## 1. Knowledge Ontology

### 1.1 Knowledge Domains

The LiBrainian tracks 12 knowledge domains with 150+ attributes:

| Domain | Purpose | Key Attributes |
|--------|---------|----------------|
| **Identity** | What is this? | Name, path, type, language, framework |
| **Semantics** | What does it do? | Purpose, behavior, contracts, side effects |
| **Structure** | How is it organized? | Complexity, patterns, shape, size |
| **Relationships** | How does it connect? | Dependencies, dependents, data flows |
| **History** | How has it evolved? | Age, change frequency, stability, authors |
| **Ownership** | Who is responsible? | Team, experts, reviewers, SLA |
| **Risk** | What could go wrong? | Complexity risk, change risk, security risk |
| **Testing** | How is it verified? | Coverage, strategies, fixtures, mocks |
| **Security** | What are the threats? | Attack surface, sensitive data, auth boundaries |
| **Rationale** | Why does it exist? | Design decisions, constraints, trade-offs |
| **Tribal** | What's undocumented? | Conventions, gotchas, tips, history |
| **Quality** | How healthy is it? | Tech debt, code smells, improvement opportunities |

### 1.2 Knowledge Types

```typescript
// src/LiBrainian/knowledge/types/index.ts

// Composed from focused type files
export interface UniversalKnowledge {
  identity: IdentityKnowledge;
  semantics: SemanticKnowledge;
  structure: StructuralKnowledge;
  relationships: RelationshipKnowledge;
  history: HistoryKnowledge;
  ownership: OwnershipKnowledge;
  risk: RiskKnowledge;
  testing: TestingKnowledge;
  security: SecurityKnowledge;
  rationale: RationaleKnowledge;
  tribal: TribalKnowledge;
  quality: QualityKnowledge;
}

// Each domain is a focused interface (~100-150 lines each)
// See: src/LiBrainian/knowledge/types/*.ts
```

### 1.3 Freshness Requirements

| Knowledge Type | Staleness Tolerance | Trigger for Refresh |
|----------------|---------------------|---------------------|
| Identity | 0 (always fresh) | File system change |
| Structure | 0 (always fresh) | File content change |
| Relationships | 1 minute | Import/export change |
| Semantics | 1 hour | Significant code change |
| History | 5 minutes | New commit |
| Testing | 10 minutes | Test file change |
| Risk | 1 hour | Dependency or code change |
| Quality | 1 day | Periodic reassessment |
| Tribal | 1 week | Manual or inferred update |

---

## 2. Emergent Entity Discovery

### 2.1 Entity Taxonomy

Beyond explicit code entities (files, functions, classes), we discover emergent entities:

```typescript
type KnowledgeableEntity =
  // Explicit (from code)
  | 'file' | 'function' | 'class' | 'method' | 'interface' | 'type'

  // Structural (from file system)
  | 'directory' | 'module' | 'package'

  // Emergent (discovered)
  | 'component'      // UI/service component
  | 'subsystem'      // Related module group
  | 'system'         // Major functional area
  | 'layer'          // Architectural layer
  | 'domain'         // Business domain
  | 'feature'        // User-facing feature
  | 'workflow'       // Business process
  | 'boundary'       // Module boundary
  | 'hotspot'        // High-change area
  | 'debt_cluster';  // Tech debt concentration
```

### 2.2 Discovery Methods

| Method | LLM Required | Discovers |
|--------|--------------|-----------|
| Directory structure | No | Modules, packages |
| Naming conventions | No | Services, controllers, repositories |
| Import clustering | No | Components, subsystems |
| Co-change clustering | No | Subsystems, features |
| Ownership clustering | No | Domains, team areas |
| Semantic clustering | Embeddings only | Related code groups |
| Architectural patterns | Yes | Layers, patterns |
| Feature inference | Yes | Features, workflows |

### 2.3 Implementation

```typescript
// src/LiBrainian/discovery/entity_discoverer.ts

class EmergentEntityDiscoverer {
  // Discoverers run in order, each can use results from previous
  private discoverers: EntityDiscoverer[] = [
    // Tier 1: No external dependencies
    new DirectoryDiscoverer(),
    new ModuleDiscoverer(),
    new NamingConventionDiscoverer(),

    // Tier 2: Uses git history
    new CoChangeClusterDiscoverer(),
    new OwnershipClusterDiscoverer(),
    new HotspotDiscoverer(),

    // Tier 3: Uses embeddings
    new SemanticClusterDiscoverer(),

    // Tier 4: Uses LLM
    new ArchitecturalPatternDiscoverer(),
    new FeatureDiscoverer(),
  ];

  async discoverAll(codebase: CodebaseIndex): Promise<Result<EmergentEntity[], DiscoveryError>> {
    // Each discoverer validates its output
    // Circular references detected and removed
    // Entities deduplicated and merged
  }
}
```

---

## 3. Provider Architecture

### 3.1 Simple Failover (Not Degradation)

When one provider is unavailable, use the other. Both provide full capabilities.

```typescript
// src/LiBrainian/providers/router.ts

class ProviderRouter {
  async execute<T>(request: ProviderRequest): Promise<Result<T, ProviderError>> {
    // Try Claude first
    if (await this.claudeProvider.isAvailable()) {
      const result = await this.claudeProvider.execute<T>(request);
      if (result.ok) return result;
    }

    // Fall back to Codex
    if (await this.codexProvider.isAvailable()) {
      const result = await this.codexProvider.execute<T>(request);
      if (result.ok) return result;
    }

    // Both unavailable - queue for retry
    return this.queueForRetry(request);
  }
}
```

### 3.2 Capability Matrix

| Feature | Claude | Codex | Local |
|---------|--------|-------|-------|
| Text understanding | ✅ Haiku/Sonnet | ✅ 5.2 low/med | ❌ |
| Code analysis | ✅ Haiku/Sonnet | ✅ 5.2 low/med | ❌ |
| Embeddings | ❌ | ❌ | ✅ MiniLM |
| Re-ranking | ❌ | ❌ | ✅ Cross-encoder |
| AST parsing | ❌ | ❌ | ✅ Tree-sitter |
| Git history | ❌ | ❌ | ✅ git CLI |

### 3.3 Provider Implementation

```typescript
// src/LiBrainian/providers/claude_provider.ts

class ClaudeProvider implements Provider {
  readonly id = 'claude';
  readonly capabilities = ['text_understanding', 'code_analysis', 'summarization'];

  private circuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 60000,
  });

  private rateLimiter = new TokenBucketRateLimiter({
    tokensPerSecond: 10,
    bucketSize: 50,
  });

  async isAvailable(): Promise<boolean> {
    return !this.circuitBreaker.isOpen();
  }

  async execute<T>(request: ProviderRequest): Promise<Result<T, ProviderError>> {
    // Rate limit check
    if (!await this.rateLimiter.acquire()) {
      return Err(new ProviderError('claude', 'rate_limit', true, 'Local rate limit'));
    }

    // Circuit breaker check
    if (this.circuitBreaker.isOpen()) {
      return Err(new ProviderError('claude', 'circuit_open', true, 'Circuit breaker open'));
    }

    try {
      const response = await this.callWithTimeout(request);
      const validated = this.validateResponse<T>(response);

      if (validated.ok) {
        this.circuitBreaker.recordSuccess();
        return validated;
      }

      this.circuitBreaker.recordFailure();
      return validated;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      return Err(this.classifyError(error));
    }
  }
}
```

---

## 4. Resilient Core Infrastructure

### 4.1 Result Type (Replace Exceptions)

**Problem:** Mixed error handling with `.catch(() => {})`, thrown exceptions, and string errors.

**Solution:**

```typescript
// src/LiBrainian/core/result.ts

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Helpers for common operations
export async function safeAsync<T>(
  fn: () => Promise<T>
): Promise<Result<T, Error>> {
  try {
    return Ok(await fn());
  } catch (e) {
    return Err(e as Error);
  }
}

export function safeSync<T>(fn: () => T): Result<T, Error> {
  try {
    return Ok(fn());
  } catch (e) {
    return Err(e as Error);
  }
}

// Safe file operations (replace .catch(() => {}))
export async function safeUnlink(path: string): Promise<Result<void, Error>> {
  return safeAsync(() => fs.unlink(path));
}

export async function safeReadFile(path: string): Promise<Result<string, Error>> {
  return safeAsync(() => fs.readFile(path, 'utf-8'));
}
```

### 4.2 Error Hierarchy (Replace String Errors)

**Problem:** Inconsistent error formats like `'unverified_by_trace(provider_unavailable): ...'`.

**Solution:**

```typescript
// src/LiBrainian/core/errors.ts

export abstract class LibrarianError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  readonly timestamp = Date.now();

  toJSON(): ErrorJSON {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }

  toString(): string {
    return `[${this.code}] ${this.message}`;
  }
}

export class StorageError extends LibrarianError {
  readonly code = 'STORAGE_ERROR';
  constructor(
    readonly operation: 'read' | 'write' | 'delete' | 'lock',
    readonly retryable: boolean,
    message: string,
    readonly cause?: Error,
  ) {
    super(`Storage ${operation} failed: ${message}`);
  }
}

export class ProviderError extends LibrarianError {
  readonly code = 'PROVIDER_ERROR';
  constructor(
    readonly provider: 'claude' | 'codex',
    readonly reason: 'timeout' | 'rate_limit' | 'quota' | 'auth' | 'network' | 'invalid_response',
    readonly retryable: boolean,
    message: string,
  ) {
    super(`Provider ${provider} ${reason}: ${message}`);
  }
}

export class ExtractionError extends LibrarianError {
  readonly code = 'EXTRACTION_ERROR';
  constructor(
    readonly extractor: string,
    readonly phase: 'parse' | 'transform' | 'validate' | 'store',
    readonly retryable: boolean,
    message: string,
  ) {
    super(`Extraction ${extractor} failed at ${phase}: ${message}`);
  }
}

export class ValidationError extends LibrarianError {
  readonly code = 'VALIDATION_ERROR';
  readonly retryable = false;
  constructor(
    readonly field: string,
    readonly expected: string,
    readonly received: string,
  ) {
    super(`Validation failed for ${field}: expected ${expected}, got ${received}`);
  }
}

export class QueryError extends LibrarianError {
  readonly code = 'QUERY_ERROR';
  constructor(
    readonly phase: 'parse' | 'retrieve' | 'rank' | 'synthesize',
    readonly retryable: boolean,
    message: string,
  ) {
    super(`Query failed at ${phase}: ${message}`);
  }
}
```

### 4.3 Execution Infrastructure

```typescript
// src/LiBrainian/core/execution.ts

interface ExecutionOptions {
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  retryBackoffMultiplier: number;
  circuitBreakerKey?: string;
}

const DEFAULT_OPTIONS: ExecutionOptions = {
  timeoutMs: 30000,
  retries: 3,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 2,
};

export async function executeWithResilience<T>(
  operation: () => Promise<T>,
  options: Partial<ExecutionOptions> = {},
): Promise<Result<T, ExecutionError>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check circuit breaker
  if (opts.circuitBreakerKey) {
    const breaker = CircuitBreakerRegistry.get(opts.circuitBreakerKey);
    if (breaker.isOpen()) {
      return Err(new ExecutionError('circuit_open', opts.circuitBreakerKey));
    }
  }

  let lastError: Error | undefined;
  let delay = opts.retryDelayMs;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      // Race with timeout
      const result = await Promise.race([
        operation(),
        rejectAfter(opts.timeoutMs),
      ]);

      // Success
      if (opts.circuitBreakerKey) {
        CircuitBreakerRegistry.get(opts.circuitBreakerKey).recordSuccess();
      }

      return Ok(result);
    } catch (error) {
      lastError = error as Error;

      // Record failure
      if (opts.circuitBreakerKey) {
        CircuitBreakerRegistry.get(opts.circuitBreakerKey).recordFailure();
      }

      // Check if retryable
      if (!isRetryable(error)) {
        break;
      }

      // Wait before retry (except on last attempt)
      if (attempt < opts.retries) {
        await sleep(delay);
        delay *= opts.retryBackoffMultiplier;
      }
    }
  }

  return Err(new ExecutionError('max_retries', lastError?.message ?? 'Unknown error'));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof LibrarianError) {
    return error.retryable;
  }
  // Network errors are retryable
  if (error instanceof Error) {
    return error.message.includes('ECONNRESET') ||
           error.message.includes('ETIMEDOUT') ||
           error.message.includes('ENOTFOUND');
  }
  return false;
}
```

### 4.4 Health Check System

```typescript
// src/LiBrainian/core/health.ts

interface HealthCheck {
  readonly name: string;
  readonly criticality: 'critical' | 'degraded' | 'optional';
  check(): Promise<HealthStatus>;
}

interface HealthStatus {
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
  lastSuccess?: number;
  consecutiveFailures: number;
}

interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'critical';
  components: Map<string, HealthStatus>;
  capabilities: Capability[];
  recommendations: string[];
}

class HealthRegistry {
  private checks = new Map<string, HealthCheck>();
  private statuses = new Map<string, HealthStatus>();
  private monitoringInterval?: NodeJS.Timer;

  register(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  async checkAll(): Promise<SystemHealth> {
    const results = await Promise.allSettled(
      Array.from(this.checks.entries()).map(async ([name, check]) => {
        try {
          const status = await Promise.race([
            check.check(),
            rejectAfter(5000).catch(() => ({
              healthy: false,
              message: 'Health check timed out',
              consecutiveFailures: (this.statuses.get(name)?.consecutiveFailures ?? 0) + 1,
            })),
          ]);
          this.statuses.set(name, status);
          return { name, status, criticality: check.criticality };
        } catch (error) {
          const status: HealthStatus = {
            healthy: false,
            message: (error as Error).message,
            consecutiveFailures: (this.statuses.get(name)?.consecutiveFailures ?? 0) + 1,
          };
          this.statuses.set(name, status);
          return { name, status, criticality: check.criticality };
        }
      })
    );

    return this.aggregateHealth(results);
  }

  startMonitoring(intervalMs: number = 30000): void {
    this.monitoringInterval = setInterval(() => {
      this.checkAll().catch(console.error);
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }
}

export const healthRegistry = new HealthRegistry();
```

---

## 5. Codebase Cleanup Plan

### 5.1 Files to Split

#### sqlite_storage.ts (3,801 lines → 6 files)

```
src/LiBrainian/storage/
├── index.ts                    # Re-exports
├── types.ts                    # Cleaned interfaces
├── connection.ts               # Connection, WAL, pragmas
├── migrations.ts               # Schema migrations
├── repositories/
│   ├── entity_repository.ts    # Functions, modules, files
│   ├── embedding_repository.ts # Vector storage
│   ├── graph_repository.ts     # Edges, relationships
│   ├── knowledge_repository.ts # Universal knowledge
│   └── metadata_repository.ts  # Config, version
└── sqlite_storage.ts           # Thin facade (~200 lines)
```

#### bootstrap.ts (1,138 lines → 4 files)

```
src/LiBrainian/api/bootstrap/
├── index.ts                    # Re-exports
├── orchestrator.ts             # Main flow (~200 lines)
├── recovery.ts                 # Recovery state
├── phases.ts                   # Phase definitions
└── ingestion_coordinator.ts    # Ingest source coordination
```

#### query.ts (1,113 lines → 5 files)

```
src/LiBrainian/query/
├── index.ts                    # Re-exports
├── processor.ts                # Query orchestration (~150 lines)
├── retriever.ts                # Candidate retrieval
├── scorer.ts                   # Scoring and ranking
├── synthesizer.ts              # Answer synthesis
└── cache.ts                    # Query caching
```

#### universal_types.ts (1,658 lines → 12 files)

```
src/LiBrainian/knowledge/types/
├── index.ts                    # Composes all (~50 lines)
├── identity.ts                 # ~100 lines
├── semantics.ts                # ~150 lines
├── structure.ts                # ~100 lines
├── relationships.ts            # ~150 lines
├── quality.ts                  # ~150 lines
├── history.ts                  # ~100 lines
├── ownership.ts                # ~100 lines
├── testing.ts                  # ~100 lines
├── security.ts                 # ~100 lines
├── rationale.ts                # ~100 lines
└── tribal.ts                   # ~100 lines
```

### 5.2 Abstractions to Create

#### Parser Abstraction

**Problem:** Duplicate parseToml, parseYaml, parseJSON across 12+ indexers.

**Solution:**

```typescript
// src/LiBrainian/ingest/parsers/index.ts

export interface Parser<T> {
  readonly format: string;
  readonly extensions: string[];
  canParse(content: string): boolean;
  parse(content: string): Result<T, ParseError>;
}

export class JsonParser implements Parser<unknown> {
  readonly format = 'json';
  readonly extensions = ['.json', '.jsonc'];

  canParse(content: string): boolean {
    const t = content.trim();
    return t.startsWith('{') || t.startsWith('[');
  }

  parse(content: string): Result<unknown, ParseError> {
    try {
      return Ok(JSON.parse(content));
    } catch (e) {
      return Err(new ParseError('json', (e as Error).message));
    }
  }
}

export class YamlParser implements Parser<unknown> {
  readonly format = 'yaml';
  readonly extensions = ['.yaml', '.yml'];
  // ...
}

export class TomlParser implements Parser<unknown> {
  readonly format = 'toml';
  readonly extensions = ['.toml'];
  // ...
}

// Auto-detect parser
export class UniversalParser {
  private parsers = [new JsonParser(), new YamlParser(), new TomlParser()];

  parse(content: string, hintExtension?: string): Result<unknown, ParseError> {
    // Try by extension hint first
    if (hintExtension) {
      const parser = this.parsers.find(p => p.extensions.includes(hintExtension));
      if (parser) {
        return parser.parse(content);
      }
    }

    // Try each parser
    for (const parser of this.parsers) {
      if (parser.canParse(content)) {
        const result = parser.parse(content);
        if (result.ok) return result;
      }
    }

    return Err(new ParseError('unknown', 'No parser could handle content'));
  }
}
```

**Files to update:**
- `adr_indexer.ts`
- `config_indexer.ts`
- `deps_indexer.ts`
- `schema_indexer.ts`
- `ci_indexer.ts`

#### Repository Pattern

**Problem:** Scattered storage.upsertX, storage.getX calls.

**Solution:**

```typescript
// src/LiBrainian/storage/repository.ts

export interface Repository<T, ID = string> {
  get(id: ID): Promise<Result<T | null, StorageError>>;
  getMany(ids: ID[]): Promise<Result<T[], StorageError>>;
  save(entity: T): Promise<Result<void, StorageError>>;
  saveMany(entities: T[]): Promise<Result<void, StorageError>>;
  delete(id: ID): Promise<Result<void, StorageError>>;
  exists(id: ID): Promise<Result<boolean, StorageError>>;
}

export interface TransactionalRepository<T, ID = string> extends Repository<T, ID> {
  transaction<R>(fn: (repo: Repository<T, ID>) => Promise<R>): Promise<Result<R, StorageError>>;
}

// Base implementation
export abstract class SQLiteRepository<T, ID = string> implements Repository<T, ID> {
  constructor(protected db: Database, protected tableName: string) {}

  async get(id: ID): Promise<Result<T | null, StorageError>> {
    return executeWithResilience(async () => {
      const row = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id);
      return row ? this.fromRow(row) : null;
    }, { timeoutMs: 1000, retries: 2, retryDelayMs: 100, retryBackoffMultiplier: 2 });
  }

  protected abstract fromRow(row: unknown): T;
  protected abstract toRow(entity: T): unknown;
}
```

#### Base Extractor

**Problem:** Inconsistent extraction patterns across knowledge types.

**Solution:**

```typescript
// src/LiBrainian/extraction/base_extractor.ts

export abstract class BaseExtractor<TInput, TOutput> {
  abstract readonly id: string;
  abstract readonly domain: KnowledgeDomain;
  abstract readonly requiredCapabilities: Capability[];

  async extract(input: TInput): Promise<Result<ExtractionResult<TOutput>, ExtractionError>> {
    // 1. Validate input
    const validated = this.validateInput(input);
    if (!validated.ok) {
      return Err(new ExtractionError(this.id, 'validate', false, validated.error.message));
    }

    // 2. Check capabilities
    const caps = await getAvailableCapabilities();
    const canRun = this.requiredCapabilities.every(c => caps.has(c));

    // 3. Extract or fallback
    if (canRun) {
      return this.doExtract(validated.value);
    } else {
      return this.fallbackExtract(validated.value);
    }
  }

  protected abstract validateInput(input: TInput): Result<TInput, ValidationError>;
  protected abstract doExtract(input: TInput): Promise<Result<ExtractionResult<TOutput>, ExtractionError>>;
  protected abstract fallbackExtract(input: TInput): Promise<Result<ExtractionResult<TOutput>, ExtractionError>>;

  estimateQuality(caps: Set<Capability>): 'full' | 'degraded' | 'minimal' {
    const hasAll = this.requiredCapabilities.every(c => caps.has(c));
    if (hasAll) return 'full';
    if (caps.size > 0) return 'degraded';
    return 'minimal';
  }
}
```

### 5.3 Dead Code to Remove

| File | Reason | Action |
|------|--------|--------|
| `engines/relevance.ts` | Just re-exports `relevance_engine.ts` | Delete |
| `engines/constraint.ts` | Just re-exports `constraint_engine.ts` | Delete |
| `engines/meta.ts` | Just re-exports `meta_engine.ts` | Delete |

Update `engines/index.ts` to consolidate all exports.

### 5.4 Naming Conventions to Fix

| Current | Should Be | Files |
|---------|-----------|-------|
| `create*Indexer()` | `create*IngestionSource()` | Standardize all |
| `'unverified_by_trace(x): ...'` | `new ExtractionError(...)` | All error sites |
| `ensure*()` private methods | `migrate*()` or `init*()` | sqlite_storage.ts |

---

## 6. Integration Failure Prevention

### 6.1 Canonical Types (Prevent Format Mismatches)

```typescript
// src/LiBrainian/core/contracts.ts

// Branded types prevent mixing incompatible IDs
type Brand<T, B> = T & { readonly __brand: B };

export type EntityId = Brand<string, 'EntityId'>;
export type EmbeddingId = Brand<string, 'EmbeddingId'>;
export type FilePath = Brand<string, 'FilePath'>;
export type Timestamp = Brand<number, 'Timestamp'>;

// Constructors validate and normalize
export function createEntityId(type: EntityType, identifier: string): EntityId {
  const normalized = identifier.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${type}:${normalized}` as EntityId;
}

export function createFilePath(raw: string): Result<FilePath, ValidationError> {
  if (!raw) return Err(new ValidationError('path', 'non-empty string', 'empty'));
  if (raw.includes('\0')) return Err(new ValidationError('path', 'no null bytes', 'has null bytes'));

  const normalized = path.normalize(raw).replace(/\\/g, '/');
  return Ok(normalized as FilePath);
}

export function createTimestamp(value: number | Date): Timestamp {
  const ms = value instanceof Date ? value.getTime() : value;
  // Detect if seconds (< year 2000 in ms) and convert
  const normalized = ms < 946684800000 ? ms * 1000 : ms;
  return normalized as Timestamp;
}

// Embedding with locked dimensions
export interface ValidatedEmbedding {
  readonly vector: Float32Array;
  readonly dimensions: 384;
  readonly modelId: 'all-MiniLM-L6-v2';
  readonly normalizedL2: true;
}

export function createValidatedEmbedding(
  vector: number[] | Float32Array
): Result<ValidatedEmbedding, ValidationError> {
  if (vector.length !== 384) {
    return Err(new ValidationError('dimensions', '384', String(vector.length)));
  }

  const arr = vector instanceof Float32Array ? vector : new Float32Array(vector);

  // Check for NaN
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) {
      return Err(new ValidationError('vector', 'no NaN values', `NaN at index ${i}`));
    }
  }

  // Normalize L2
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  const norm = Math.sqrt(sum);
  for (let i = 0; i < arr.length; i++) arr[i] /= norm;

  return Ok({
    vector: arr,
    dimensions: 384,
    modelId: 'all-MiniLM-L6-v2',
    normalizedL2: true,
  });
}
```

### 6.2 Schema Version Registry

```typescript
// src/LiBrainian/core/schema_registry.ts

const SCHEMA_VERSIONS = {
  embedding: 1,
  knowledge: 1,
  entity: 1,
  graph: 1,
  query: 1,
  config: 1,
} as const;

type SchemaType = keyof typeof SCHEMA_VERSIONS;

interface Versioned<T> {
  readonly __schemaVersion: number;
  readonly __schemaType: SchemaType;
  readonly data: T;
}

export function wrap<T>(type: SchemaType, data: T): Versioned<T> {
  return {
    __schemaVersion: SCHEMA_VERSIONS[type],
    __schemaType: type,
    data,
  };
}

export function unwrap<T>(versioned: Versioned<T>): Result<T, SchemaError> {
  const expected = SCHEMA_VERSIONS[versioned.__schemaType];

  if (versioned.__schemaVersion !== expected) {
    // Try migration
    const migrated = migrate(versioned);
    if (migrated.ok) return migrated;

    return Err(new SchemaError(
      versioned.__schemaType,
      expected,
      versioned.__schemaVersion,
    ));
  }

  return Ok(versioned.data);
}

// Migration registry
const migrations = new Map<string, (old: unknown) => unknown>();

export function registerMigration(
  type: SchemaType,
  fromVersion: number,
  toVersion: number,
  fn: (old: unknown) => unknown,
): void {
  migrations.set(`${type}:${fromVersion}:${toVersion}`, fn);
}
```

### 6.3 Event Bus (Loose Coupling)

```typescript
// src/LiBrainian/core/event_bus.ts

type LibrarianEvent =
  | { type: 'file:changed'; path: FilePath; timestamp: Timestamp }
  | { type: 'file:deleted'; path: FilePath; timestamp: Timestamp }
  | { type: 'entity:indexed'; entityId: EntityId; timestamp: Timestamp }
  | { type: 'entity:invalidated'; entityId: EntityId; reason: string }
  | { type: 'embedding:computed'; entityId: EntityId; embeddingId: EmbeddingId }
  | { type: 'knowledge:extracted'; entityId: EntityId; domain: KnowledgeDomain }
  | { type: 'provider:available'; provider: 'claude' | 'codex' }
  | { type: 'provider:unavailable'; provider: 'claude' | 'codex'; reason: string }
  | { type: 'health:degraded'; component: string; status: HealthStatus }
  | { type: 'health:recovered'; component: string };

type EventHandler<T extends LibrarianEvent = LibrarianEvent> = (event: T) => void | Promise<void>;

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private eventLog: LibrarianEvent[] = [];
  private maxLogSize = 1000;

  emit(event: LibrarianEvent): void {
    // Log event
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    // Notify handlers (async, non-blocking)
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        Promise.resolve()
          .then(() => handler(event))
          .catch(e => console.error(`Event handler error for ${event.type}:`, e));
      }
    }
  }

  on<T extends LibrarianEvent['type']>(
    type: T,
    handler: EventHandler<Extract<LibrarianEvent, { type: T }>>,
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler as EventHandler);
    };
  }

  getRecentEvents(count = 100): LibrarianEvent[] {
    return this.eventLog.slice(-count);
  }
}

export const eventBus = new EventBus();
```

### 6.4 Transaction Coordinator

```typescript
// src/LiBrainian/core/transaction_coordinator.ts

interface TransactionContext {
  readonly id: string;
  readonly name: string;
  readonly startedAt: Timestamp;
  readonly rollbacks: Array<() => Promise<void>>;

  addRollback(fn: () => Promise<void>): void;
}

class TransactionCoordinator {
  private active = new Map<string, TransactionContext>();

  async execute<T>(
    name: string,
    fn: (ctx: TransactionContext) => Promise<T>,
  ): Promise<Result<T, TransactionError>> {
    const ctx: TransactionContext = {
      id: crypto.randomUUID(),
      name,
      startedAt: Date.now() as Timestamp,
      rollbacks: [],
      addRollback(fn) { this.rollbacks.push(fn); },
    };

    this.active.set(ctx.id, ctx);

    try {
      const result = await fn(ctx);
      this.active.delete(ctx.id);
      return Ok(result);
    } catch (error) {
      // Rollback in reverse order
      for (const rollback of ctx.rollbacks.reverse()) {
        try {
          await rollback();
        } catch (e) {
          console.error(`Rollback failed in ${name}:`, e);
        }
      }

      this.active.delete(ctx.id);
      return Err(new TransactionError(name, error as Error));
    }
  }

  getActive(): TransactionContext[] {
    return Array.from(this.active.values());
  }
}

export const transactionCoordinator = new TransactionCoordinator();
```

### 6.5 Resource Manager

```typescript
// src/LiBrainian/core/resource_manager.ts

interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
  available: number;
  waiting: number;
}

function createSemaphore(limit: number): Semaphore {
  let available = limit;
  const waiting: Array<() => void> = [];

  return {
    async acquire() {
      if (available > 0) {
        available--;
        return;
      }
      await new Promise<void>(resolve => waiting.push(resolve));
      available--;
    },
    release() {
      available++;
      if (waiting.length > 0) {
        const next = waiting.shift()!;
        next();
      }
    },
    get available() { return available; },
    get waiting() { return waiting.length; },
  };
}

class ResourceManager {
  private semaphores = new Map<string, Semaphore>();

  private limits = {
    providerCalls: 10,
    dbWrites: 5,
    fileReads: 20,
    embeddings: 3,
    reranking: 2,
  };

  async withLimit<T>(
    resource: keyof typeof this.limits,
    fn: () => Promise<T>,
  ): Promise<T> {
    const semaphore = this.getSemaphore(resource);
    await semaphore.acquire();
    try {
      return await fn();
    } finally {
      semaphore.release();
    }
  }

  private getSemaphore(resource: string): Semaphore {
    if (!this.semaphores.has(resource)) {
      const limit = this.limits[resource as keyof typeof this.limits] ?? 10;
      this.semaphores.set(resource, createSemaphore(limit));
    }
    return this.semaphores.get(resource)!;
  }

  getStats(): Record<string, { available: number; waiting: number }> {
    const stats: Record<string, { available: number; waiting: number }> = {};
    for (const [name, sem] of this.semaphores) {
      stats[name] = { available: sem.available, waiting: sem.waiting };
    }
    return stats;
  }
}

export const resourceManager = new ResourceManager();
```

---

## 7. Agent-Optimized Query Interface

### 7.1 Query Types

```typescript
// src/LiBrainian/query/types.ts

type AgentQueryIntent =
  // Understanding
  | 'what_does_this_do'
  | 'how_does_this_work'
  | 'why_is_this_here'

  // Discovery
  | 'find_similar_to'
  | 'find_usages_of'
  | 'find_dependencies_of'
  | 'find_dependents_of'

  // Impact
  | 'what_breaks_if_i_change'
  | 'what_tests_cover'
  | 'who_owns_this'

  // Risk
  | 'is_this_safe_to_modify'
  | 'what_are_the_constraints'
  | 'what_patterns_apply'

  // Context
  | 'get_context_for_task'
  | 'summarize_area'
  | 'trace_data_flow';

interface AgentQuery {
  intent: AgentQueryIntent;
  target: {
    type: 'file' | 'function' | 'class' | 'module' | 'concept' | 'area';
    identifier: string;
    scope?: string;
  };
  context?: {
    currentTask?: string;
    currentFile?: string;
    recentFiles?: string[];
  };
  preferences?: {
    maxResults?: number;
    detailLevel: 'minimal' | 'standard' | 'comprehensive';
    includeCode?: boolean;
  };
}
```

### 7.2 Agent-Optimized Responses

```typescript
// src/LiBrainian/query/response.ts

interface AgentQueryResponse {
  // Machine-readable decisions
  decisions: {
    canModifySafely: boolean;
    requiresReview: boolean;
    testsRequired: string[];
    filesToCheck: string[];
    patternsToFollow: string[];
    constraintsToRespect: Constraint[];
  };

  // Autonomy guidance
  autonomy: {
    canActWithoutAsking: boolean;
    shouldConfirmWith: 'user' | 'test' | 'none';
    confidenceScore: number;
    uncertainties: string[];
  };

  // Proactive guidance
  proactive: {
    likelyNextSteps: string[];
    commonMistakes: string[];
    relatedChangesNeeded: string[];
    suggestedApproach: string;
  };

  // Answer content
  answer: {
    summary: string;
    explanation: string;
    structured?: unknown;
    codeSnippets?: Array<{ file: string; code: string; lines: [number, number] }>;
  };

  // Quality metadata
  confidence: {
    overall: number;
    dataQuality: number;
    inferenceQuality: number;
    freshness: number;
    limitations: string[];
  };

  // Sources
  sources: Array<{
    type: 'code' | 'doc' | 'history' | 'inference';
    location: string;
    relevance: number;
  }>;
}
```

### 7.3 High-Level Agent API

```typescript
// src/LiBrainian/api/agent_interface.ts

class LibrarianAgentAPI {
  // "I'm about to modify this file, what do I need to know?"
  async getModificationContext(filePath: string): Promise<ModificationContext> {
    const [purpose, deps, dependents, tests, ownership, constraints, risk, history, coChange] =
      await Promise.all([
        this.query({ intent: 'what_does_this_do', target: { type: 'file', identifier: filePath } }),
        this.query({ intent: 'find_dependencies_of', target: { type: 'file', identifier: filePath } }),
        this.query({ intent: 'find_dependents_of', target: { type: 'file', identifier: filePath } }),
        this.query({ intent: 'what_tests_cover', target: { type: 'file', identifier: filePath } }),
        this.query({ intent: 'who_owns_this', target: { type: 'file', identifier: filePath } }),
        this.query({ intent: 'what_are_the_constraints', target: { type: 'file', identifier: filePath } }),
        this.query({ intent: 'is_this_safe_to_modify', target: { type: 'file', identifier: filePath } }),
        this.getRecentHistory(filePath),
        this.getCoChangedFiles(filePath),
      ]);

    return {
      purpose: purpose.answer,
      dependencies: deps.answer.structured,
      dependents: dependents.answer.structured,
      tests: tests.answer.structured,
      ownership: ownership.answer.structured,
      constraints: constraints.answer.structured,
      riskLevel: risk.answer.structured,
      recentChanges: history,
      coChangedFiles: coChange,
      suggestedApproach: this.deriveSuggestedApproach(risk, constraints),
    };
  }

  // "Should I proceed with this change?"
  async assessChange(
    file: string,
    description: string,
  ): Promise<ChangeAssessment> {
    const risk = await this.query({
      intent: 'is_this_safe_to_modify',
      target: { type: 'file', identifier: file },
      context: { currentTask: description },
    });

    return {
      canProceed: risk.autonomy.canActWithoutAsking,
      confidence: risk.confidence.overall,
      blockers: risk.decisions.constraintsToRespect.filter(c => c.blocking),
      warnings: risk.proactive.commonMistakes,
      requiredTests: risk.decisions.testsRequired,
      suggestedApproach: risk.proactive.suggestedApproach,
    };
  }

  // "What files are related to this concept?"
  async findRelatedFiles(concept: string): Promise<RelatedFiles> {
    const similar = await this.query({
      intent: 'find_similar_to',
      target: { type: 'concept', identifier: concept },
      preferences: { maxResults: 20, detailLevel: 'standard' },
    });

    return {
      files: similar.sources.map(s => ({
        path: s.location,
        relevance: s.relevance,
        reason: s.type,
      })),
      clusters: this.clusterByDirectory(similar.sources),
    };
  }
}
```

---

## 8. Implementation Phases

### Phase 0: Foundation (Week 1)

| Task | Files | Status |
|------|-------|--------|
| Create Result type | `src/LiBrainian/core/result.ts` | New |
| Create Error hierarchy | `src/LiBrainian/core/errors.ts` | New |
| Create Contracts | `src/LiBrainian/core/contracts.ts` | New |
| Create Execution utils | `src/LiBrainian/core/execution.ts` | New |
| Update `.catch(() => {})` sites | 6 files | Modify |
| Update string error sites | 10+ files | Modify |

### Phase 1: Storage Split (Week 2)

| Task | Files | Status |
|------|-------|--------|
| Create connection.ts | `src/LiBrainian/storage/connection.ts` | New |
| Create migrations.ts | `src/LiBrainian/storage/migrations.ts` | New |
| Create entity_repository.ts | `src/LiBrainian/storage/repositories/entity_repository.ts` | New |
| Create embedding_repository.ts | `src/LiBrainian/storage/repositories/embedding_repository.ts` | New |
| Create graph_repository.ts | `src/LiBrainian/storage/repositories/graph_repository.ts` | New |
| Create knowledge_repository.ts | `src/LiBrainian/storage/repositories/knowledge_repository.ts` | New |
| Refactor sqlite_storage.ts | `src/LiBrainian/storage/sqlite_storage.ts` | Modify (3801→200 lines) |

### Phase 2: Query & Bootstrap Split (Week 2-3)

| Task | Files | Status |
|------|-------|--------|
| Create query/processor.ts | `src/LiBrainian/query/processor.ts` | New |
| Create query/retriever.ts | `src/LiBrainian/query/retriever.ts` | New |
| Create query/scorer.ts | `src/LiBrainian/query/scorer.ts` | New |
| Create query/synthesizer.ts | `src/LiBrainian/query/synthesizer.ts` | New |
| Create bootstrap/orchestrator.ts | `src/LiBrainian/api/bootstrap/orchestrator.ts` | New |
| Create bootstrap/recovery.ts | `src/LiBrainian/api/bootstrap/recovery.ts` | New |
| Create bootstrap/phases.ts | `src/LiBrainian/api/bootstrap/phases.ts` | New |

### Phase 3: Abstractions (Week 3)

| Task | Files | Status |
|------|-------|--------|
| Create Parser abstraction | `src/LiBrainian/ingest/parsers/` | New |
| Create Repository base | `src/LiBrainian/storage/repository.ts` | New |
| Create BaseExtractor | `src/LiBrainian/extraction/base_extractor.ts` | New |
| Update ingest indexers | 12 files | Modify |

### Phase 4: Integration Layer (Week 4)

| Task | Files | Status |
|------|-------|--------|
| Create EventBus | `src/LiBrainian/core/event_bus.ts` | New |
| Create SchemaRegistry | `src/LiBrainian/core/schema_registry.ts` | New |
| Create TransactionCoordinator | `src/LiBrainian/core/transaction_coordinator.ts` | New |
| Create ResourceManager | `src/LiBrainian/core/resource_manager.ts` | New |
| Create HealthRegistry | `src/LiBrainian/core/health.ts` | New |
| Wire components | All | Modify |

### Phase 5: Provider Layer (Week 4)

| Task | Files | Status |
|------|-------|--------|
| Create ProviderRouter | `src/LiBrainian/providers/router.ts` | New |
| Create ClaudeProvider | `src/LiBrainian/providers/claude_provider.ts` | New |
| Create CodexProvider | `src/LiBrainian/providers/codex_provider.ts` | New |
| Create CircuitBreaker | `src/LiBrainian/providers/circuit_breaker.ts` | New |

### Phase 6: Entity Discovery (Week 5)

| Task | Files | Status |
|------|-------|--------|
| Create EntityDiscoverer | `src/LiBrainian/discovery/entity_discoverer.ts` | New |
| Create DirectoryDiscoverer | `src/LiBrainian/discovery/discoverers/directory.ts` | New |
| Create CoChangeDiscoverer | `src/LiBrainian/discovery/discoverers/cochange.ts` | New |
| Create PatternDiscoverer | `src/LiBrainian/discovery/discoverers/pattern.ts` | New |

### Phase 7: Agent Interface (Week 5)

| Task | Files | Status |
|------|-------|--------|
| Create AgentAPI | `src/LiBrainian/api/agent_interface.ts` | New |
| Create response types | `src/LiBrainian/query/response.ts` | New |
| Integrate with orchestrator | `src/orchestrator/` | Modify |

### Phase 8: Cleanup (Week 6)

| Task | Files | Status |
|------|-------|--------|
| Delete wrapper files | `engines/relevance.ts`, `constraint.ts`, `meta.ts` | Delete |
| Consolidate exports | `engines/index.ts` | Modify |
| Split universal_types.ts | `knowledge/types/` | New + Delete old |
| Remove dead code | Various | Modify |

---

## 9. File-by-File Changes

### New Files to Create

```
src/LiBrainian/
├── core/
│   ├── result.ts                 # Result type, safe operations
│   ├── errors.ts                 # Error hierarchy
│   ├── contracts.ts              # Branded types, validators
│   ├── execution.ts              # Timeout, retry, circuit breaker
│   ├── event_bus.ts              # Event system
│   ├── schema_registry.ts        # Schema versioning
│   ├── transaction_coordinator.ts # Transaction management
│   ├── resource_manager.ts       # Concurrency limits
│   └── health.ts                 # Health check system
├── providers/
│   ├── router.ts                 # Provider routing
│   ├── claude_provider.ts        # Claude implementation
│   ├── codex_provider.ts         # Codex implementation
│   └── circuit_breaker.ts        # Circuit breaker
├── storage/
│   ├── connection.ts             # DB connection
│   ├── migrations.ts             # Schema migrations
│   ├── repository.ts             # Base repository
│   └── repositories/
│       ├── entity_repository.ts
│       ├── embedding_repository.ts
│       ├── graph_repository.ts
│       ├── knowledge_repository.ts
│       └── metadata_repository.ts
├── query/
│   ├── processor.ts              # Query orchestration
│   ├── retriever.ts              # Candidate retrieval
│   ├── scorer.ts                 # Scoring/ranking
│   ├── synthesizer.ts            # Answer synthesis
│   ├── cache.ts                  # Query cache
│   └── response.ts               # Response types
├── api/
│   ├── agent_interface.ts        # High-level agent API
│   └── bootstrap/
│       ├── orchestrator.ts
│       ├── recovery.ts
│       ├── phases.ts
│       └── ingestion_coordinator.ts
├── discovery/
│   ├── entity_discoverer.ts      # Discovery orchestration
│   └── discoverers/
│       ├── directory.ts
│       ├── module.ts
│       ├── naming.ts
│       ├── cochange.ts
│       ├── ownership.ts
│       └── pattern.ts
├── extraction/
│   └── base_extractor.ts         # Base extractor class
├── ingest/
│   └── parsers/
│       ├── index.ts
│       ├── json_parser.ts
│       ├── yaml_parser.ts
│       └── toml_parser.ts
└── knowledge/
    └── types/
        ├── index.ts              # Composed UniversalKnowledge
        ├── identity.ts
        ├── semantics.ts
        ├── structure.ts
        ├── relationships.ts
        ├── quality.ts
        ├── history.ts
        ├── ownership.ts
        ├── testing.ts
        ├── security.ts
        ├── rationale.ts
        └── tribal.ts
```

### Files to Modify

| File | Change | Lines Before | Lines After |
|------|--------|--------------|-------------|
| `storage/sqlite_storage.ts` | Split into repositories | 3,801 | ~200 |
| `api/bootstrap.ts` | Split into modules | 1,138 | ~150 |
| `api/query.ts` | Split into modules | 1,113 | ~150 |
| `knowledge/universal_types.ts` | Split into types | 1,658 | ~50 |
| `engines/index.ts` | Consolidate exports | 20 | 30 |
| All ingest indexers | Use shared parsers | Various | -20% each |

### Files to Delete

| File | Reason |
|------|--------|
| `engines/relevance.ts` | Redundant re-export |
| `engines/constraint.ts` | Redundant re-export |
| `engines/meta.ts` | Redundant re-export |
| `api/bootstrap.ts` | After split complete |
| `api/query.ts` | After split complete |
| `knowledge/universal_types.ts` | After split complete |

---

## 10. Testing Strategy

### 10.1 Unit Tests for New Core

```typescript
// src/LiBrainian/core/__tests__/result.test.ts
describe('Result', () => {
  test('Ok wraps value', () => {
    const r = Ok(42);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
  });

  test('Err wraps error', () => {
    const r = Err(new Error('fail'));
    expect(r.ok).toBe(false);
    expect(r.error.message).toBe('fail');
  });

  test('safeAsync catches exceptions', async () => {
    const r = await safeAsync(() => Promise.reject(new Error('boom')));
    expect(r.ok).toBe(false);
  });
});

// src/LiBrainian/core/__tests__/contracts.test.ts
describe('Contracts', () => {
  test('createFilePath rejects empty', () => {
    const r = createFilePath('');
    expect(r.ok).toBe(false);
  });

  test('createFilePath normalizes slashes', () => {
    const r = createFilePath('foo\\bar\\baz');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('foo/bar/baz');
  });

  test('createTimestamp converts seconds to ms', () => {
    const ts = createTimestamp(1704067200); // 2024-01-01 in seconds
    expect(ts).toBe(1704067200000);
  });
});
```

### 10.2 Integration Tests for Components

```typescript
// src/LiBrainian/__tests__/provider_failover.test.ts
describe('Provider Failover', () => {
  test('falls back to codex when claude unavailable', async () => {
    mockClaudeUnavailable();

    const router = new ProviderRouter();
    const result = await router.execute({ prompt: 'test' });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('codex');
  });

  test('queues when both unavailable', async () => {
    mockClaudeUnavailable();
    mockCodexUnavailable();

    const router = new ProviderRouter();
    const result = await router.execute({ prompt: 'test' });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NO_PROVIDERS');
  });
});

// src/LiBrainian/__tests__/transaction_coordinator.test.ts
describe('TransactionCoordinator', () => {
  test('rolls back on failure', async () => {
    const rollbackCalled = { value: false };

    const result = await transactionCoordinator.execute('test', async (ctx) => {
      ctx.addRollback(async () => { rollbackCalled.value = true; });
      throw new Error('fail');
    });

    expect(result.ok).toBe(false);
    expect(rollbackCalled.value).toBe(true);
  });
});
```

### 10.3 End-to-End Tests

```typescript
// src/LiBrainian/__tests__/e2e/agent_workflow.test.ts
describe('Agent Workflow E2E', () => {
  test('agent can get modification context', async () => {
    const LiBrainian = await createLibrarian(testRepo);
    const api = new LibrarianAgentAPI(LiBrainian);

    const context = await api.getModificationContext('src/auth.ts');

    expect(context.purpose).toBeDefined();
    expect(context.dependencies).toBeDefined();
    expect(context.tests).toBeDefined();
    expect(context.riskLevel).toBeDefined();
  });

  test('agent can assess change safety', async () => {
    const LiBrainian = await createLibrarian(testRepo);
    const api = new LibrarianAgentAPI(LiBrainian);

    const assessment = await api.assessChange(
      'src/auth.ts',
      'Add rate limiting to login'
    );

    expect(assessment.canProceed).toBeDefined();
    expect(assessment.confidence).toBeGreaterThan(0);
  });
});
```

---

## 11. Local Embedding & Retrieval Pipeline

### 11.1 Existing Infrastructure (Already Built)

We already have working local embedding infrastructure:

| Component | File | Status |
|-----------|------|--------|
| Unified Embedding Pipeline | `src/LiBrainian/api/embedding_providers/unified_embedding_pipeline.ts` | ✅ Working |
| Cross-Encoder Reranker | `src/LiBrainian/api/embedding_providers/cross_encoder_reranker.ts` | ✅ Working |
| Co-Change Signals | `src/LiBrainian/api/embedding_providers/co_change_signals.ts` | ✅ Working |
| Function Chunking | `src/LiBrainian/api/embedding_providers/function_chunking.ts` | ✅ Working |
| Real Embeddings | `src/LiBrainian/api/embedding_providers/real_embeddings.ts` | ✅ Working |

### 11.2 Local Models

```typescript
// All models run locally via @xenova/transformers - no API calls

const LOCAL_MODELS = {
  // Bi-encoder for fast retrieval
  embedding: {
    id: 'all-MiniLM-L6-v2',
    xenovaId: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    avgLatencyMs: 10,
    purpose: 'Fast semantic similarity for initial retrieval',
  },

  // Cross-encoder for precise re-ranking
  reranker: {
    id: 'ms-marco-MiniLM-L-6-v2',
    xenovaId: 'Xenova/ms-marco-MiniLM-L-6-v2',
    avgLatencyMs: 15,
    purpose: 'Accurate query-document relevance scoring',
  },
};
```

### 11.3 Retrieval Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    RETRIEVAL PIPELINE                           │
├─────────────────────────────────────────────────────────────────┤
│  1. Query embedding (MiniLM, ~10ms)                             │
│     Query → embed → 384-dim vector                              │
│                                                                 │
│  2. Candidate retrieval (cosine similarity, ~5ms)               │
│     Vector → top-100 candidates from index                      │
│                                                                 │
│  3. Co-change boosting (~2ms)                                   │
│     Boost candidates that co-change with context files          │
│                                                                 │
│  4. Cross-encoder re-ranking (~150ms for 50 candidates)         │
│     (query, candidate) → relevance score → top-10               │
│                                                                 │
│  5. Result synthesis                                            │
│     Top candidates → structured response                        │
└─────────────────────────────────────────────────────────────────┘
```

### 11.4 Function Chunking

Code is chunked at function boundaries, not arbitrary token limits:

```typescript
// src/LiBrainian/api/embedding_providers/function_chunking.ts

interface FunctionChunk {
  id: string;
  filePath: string;
  functionName: string;
  startLine: number;
  endLine: number;
  code: string;
  signature: string;
  docstring?: string;

  // Chunking metadata
  isPartial: boolean;     // True if function was too large and split
  partIndex?: number;
  totalParts?: number;
}

// Benefits:
// - Semantic coherence (whole functions, not cut mid-logic)
// - Better embeddings (meaningful units)
// - Precise retrieval (link to exact function)
```

### 11.5 Integration with Knowledge System

```typescript
// Each entity gets multiple embeddings for different aspects

interface EntityEmbeddings {
  // Primary semantic embedding
  semantic: ValidatedEmbedding;

  // Optional specialized embeddings
  signature?: ValidatedEmbedding;    // Function signature only
  docstring?: ValidatedEmbedding;    // Documentation only
  usage?: ValidatedEmbedding;        // How it's used (from call sites)
}

// Query can target specific aspect
type QueryAspect = 'semantic' | 'signature' | 'docstring' | 'usage' | 'all';
```

---

## 12. File Watcher & Freshness Management

### 12.1 File Watcher Integration

```typescript
// src/LiBrainian/integration/file_watcher.ts (already exists, needs enhancement)

class EnhancedFileWatcher {
  private watcher: FSWatcher;
  private debounceMs = 100;
  private pending = new Map<string, NodeJS.Timeout>();

  async start(rootPath: string): Promise<void> {
    this.watcher = watch(rootPath, {
      persistent: true,
      recursive: true,
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
      ],
    });

    this.watcher.on('change', (eventType, filename) => {
      this.handleChange(eventType, filename);
    });
  }

  private handleChange(eventType: string, filename: string): void {
    // Debounce rapid changes
    const existing = this.pending.get(filename);
    if (existing) clearTimeout(existing);

    this.pending.set(filename, setTimeout(() => {
      this.pending.delete(filename);
      this.processChange(eventType, filename);
    }, this.debounceMs));
  }

  private processChange(eventType: string, filename: string): void {
    const filePath = createFilePath(filename);
    if (!filePath.ok) return;

    if (eventType === 'rename') {
      // Could be create or delete - check existence
      if (existsSync(filePath.value)) {
        eventBus.emit({ type: 'file:changed', path: filePath.value, timestamp: now() });
      } else {
        eventBus.emit({ type: 'file:deleted', path: filePath.value, timestamp: now() });
      }
    } else {
      eventBus.emit({ type: 'file:changed', path: filePath.value, timestamp: now() });
    }
  }
}
```

### 12.2 Freshness Manager

```typescript
// src/LiBrainian/knowledge/freshness_manager.ts

interface FreshnessConfig {
  domain: KnowledgeDomain;
  maxStalenessMs: number;
  refreshPriority: 'immediate' | 'high' | 'normal' | 'low';
}

const FRESHNESS_CONFIGS: FreshnessConfig[] = [
  { domain: 'identity', maxStalenessMs: 0, refreshPriority: 'immediate' },
  { domain: 'structure', maxStalenessMs: 0, refreshPriority: 'immediate' },
  { domain: 'relationships', maxStalenessMs: 60_000, refreshPriority: 'high' },
  { domain: 'semantics', maxStalenessMs: 3600_000, refreshPriority: 'normal' },
  { domain: 'history', maxStalenessMs: 300_000, refreshPriority: 'normal' },
  { domain: 'testing', maxStalenessMs: 600_000, refreshPriority: 'normal' },
  { domain: 'risk', maxStalenessMs: 3600_000, refreshPriority: 'normal' },
  { domain: 'quality', maxStalenessMs: 86400_000, refreshPriority: 'low' },
  { domain: 'tribal', maxStalenessMs: 604800_000, refreshPriority: 'low' },
];

class FreshnessManager {
  private lastRefresh = new Map<string, Map<KnowledgeDomain, Timestamp>>();
  private refreshQueue = new PriorityQueue<RefreshTask>();

  constructor() {
    // Subscribe to file changes
    eventBus.on('file:changed', (event) => this.handleFileChange(event));
    eventBus.on('file:deleted', (event) => this.handleFileDelete(event));

    // Start refresh worker
    this.startRefreshWorker();
  }

  private handleFileChange(event: FileChangedEvent): void {
    const entityId = createEntityId('file', event.path);

    // Invalidate all knowledge for this entity
    for (const config of FRESHNESS_CONFIGS) {
      this.queueRefresh(entityId, config.domain, config.refreshPriority);
    }

    // Also invalidate parent entities
    const parentId = this.getParentEntity(entityId);
    if (parentId) {
      eventBus.emit({ type: 'entity:invalidated', entityId: parentId, reason: 'child_changed' });
    }
  }

  isStale(entityId: EntityId, domain: KnowledgeDomain): boolean {
    const lastRefresh = this.lastRefresh.get(entityId)?.get(domain);
    if (!lastRefresh) return true;

    const config = FRESHNESS_CONFIGS.find(c => c.domain === domain);
    if (!config) return true;

    return (now() - lastRefresh) > config.maxStalenessMs;
  }

  private async startRefreshWorker(): Promise<void> {
    while (true) {
      const task = await this.refreshQueue.dequeue();
      if (task) {
        await this.executeRefresh(task);
      }
      await sleep(10); // Small delay to prevent busy loop
    }
  }
}
```

### 12.3 Propagation Rules

```typescript
// When a file changes, what else needs updating?

const PROPAGATION_RULES: PropagationRule[] = [
  {
    trigger: 'file:changed',
    propagateTo: ['parent_directory', 'importing_files', 'co_changed_files'],
    invalidateDomains: ['relationships', 'risk'],
  },
  {
    trigger: 'file:deleted',
    propagateTo: ['parent_directory', 'importing_files'],
    invalidateDomains: ['relationships', 'risk', 'structure'],
  },
  {
    trigger: 'entity:invalidated',
    propagateTo: ['parent_entity'],
    invalidateDomains: ['aggregated_knowledge'],
  },
];
```

---

## 13. Knowledge Aggregation

### 13.1 Aggregating Child Knowledge to Parent

```typescript
// src/LiBrainian/knowledge/aggregator.ts

class KnowledgeAggregator {
  // When child knowledge changes, recompute parent
  async aggregateForEntity(entityId: EntityId): Promise<Result<AggregatedKnowledge, Error>> {
    const entity = await this.getEntity(entityId);
    if (!entity.ok) return entity;

    const children = await this.getChildren(entityId);
    if (!children.ok) return children;

    const childKnowledge = await Promise.all(
      children.value.map(c => this.getKnowledge(c.id))
    );

    return this.computeAggregates(entity.value, childKnowledge);
  }

  private computeAggregates(
    entity: EmergentEntity,
    childKnowledge: KnowledgeRecord[]
  ): AggregatedKnowledge {
    return {
      // Purpose: Synthesize from children
      purpose: this.synthesizePurpose(childKnowledge),

      // Risk: Max of children + coupling risk
      risk: this.aggregateRisk(childKnowledge, entity.boundaries),

      // Quality: Weighted average by size
      quality: this.weightedAverageQuality(childKnowledge),

      // Ownership: Most common owners
      ownership: this.aggregateOwnership(childKnowledge),

      // Test coverage: Aggregate coverage metrics
      testCoverage: this.aggregateTestCoverage(childKnowledge),

      // Complexity: Sum of children + integration complexity
      complexity: this.aggregateComplexity(childKnowledge, entity),

      // Patterns: Common patterns across children
      patterns: this.findCommonPatterns(childKnowledge),

      // Dependencies: Union of external dependencies
      externalDependencies: this.unionDependencies(childKnowledge),
    };
  }

  private aggregateRisk(children: KnowledgeRecord[], boundaries: Boundary): RiskScore {
    // Max risk from any child
    const maxChildRisk = Math.max(...children.map(c => c.data.risk?.overall ?? 0));

    // Additional coupling risk based on boundary violations
    const couplingRisk = this.computeCouplingRisk(children, boundaries);

    // Integration risk based on interface complexity
    const integrationRisk = this.computeIntegrationRisk(children);

    return {
      overall: Math.min(1, maxChildRisk + couplingRisk * 0.2 + integrationRisk * 0.1),
      breakdown: {
        childRisk: maxChildRisk,
        couplingRisk,
        integrationRisk,
      },
    };
  }
}
```

### 13.2 Aggregation Triggers

```typescript
// Aggregation happens when:
// 1. Child knowledge is extracted/updated
// 2. Child is added/removed from parent
// 3. Periodic refresh (for emergent entities)

eventBus.on('knowledge:extracted', async (event) => {
  const parentId = await getParentEntity(event.entityId);
  if (parentId) {
    await aggregator.queueAggregation(parentId);
  }
});
```

---

## 14. Multi-Agent Coordination

### 14.1 Agent Registration

```typescript
// src/LiBrainian/agents/agent_coordinator.ts

interface RegisteredAgent {
  id: string;
  type: AgentType;
  task: TaskDescription;
  registeredAt: Timestamp;
  workingFiles: Set<FilePath>;
  locks: Set<string>;
}

class AgentCoordinator {
  private agents = new Map<string, RegisteredAgent>();
  private fileLocks = new Map<FilePath, string>(); // file -> agentId

  async registerAgent(
    agentId: string,
    type: AgentType,
    task: TaskDescription
  ): Promise<Result<AgentRegistration, CoordinationError>> {
    // Check for conflicts
    const conflicts = await this.findConflicts(task);

    if (conflicts.length > 0) {
      return Err(new CoordinationError('conflict', conflicts));
    }

    // Acquire soft locks
    const locks = await this.acquireLocks(agentId, task.intendedFiles);

    this.agents.set(agentId, {
      id: agentId,
      type,
      task,
      registeredAt: now(),
      workingFiles: new Set(task.intendedFiles),
      locks,
    });

    return Ok({
      agentId,
      locks,
      warnings: await this.getWorkWarnings(task),
    });
  }

  async unregisterAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Release all locks
    for (const lock of agent.locks) {
      this.releaseLock(lock, agentId);
    }

    this.agents.delete(agentId);
  }

  private async findConflicts(task: TaskDescription): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    for (const file of task.intendedFiles) {
      const lockHolder = this.fileLocks.get(file);
      if (lockHolder) {
        const holder = this.agents.get(lockHolder);
        if (holder) {
          conflicts.push({
            file,
            heldBy: lockHolder,
            holderTask: holder.task.description,
          });
        }
      }
    }

    return conflicts;
  }
}
```

### 14.2 Knowledge Sharing Between Agents

```typescript
// Agents can share discoveries
interface AgentDiscovery {
  agentId: string;
  type: 'pattern' | 'constraint' | 'risk' | 'fix' | 'insight';
  content: unknown;
  confidence: number;
  relatedFiles: FilePath[];
}

class SharedKnowledgeStore {
  private discoveries: AgentDiscovery[] = [];

  add(discovery: AgentDiscovery): void {
    this.discoveries.push(discovery);

    // Notify other agents working on related files
    for (const [agentId, agent] of coordinator.agents) {
      if (agentId === discovery.agentId) continue;

      const overlap = discovery.relatedFiles.some(f => agent.workingFiles.has(f));
      if (overlap) {
        this.notifyAgent(agentId, discovery);
      }
    }
  }

  getRelevant(agentId: string): AgentDiscovery[] {
    const agent = coordinator.agents.get(agentId);
    if (!agent) return [];

    return this.discoveries.filter(d =>
      d.agentId !== agentId &&
      d.relatedFiles.some(f => agent.workingFiles.has(f))
    );
  }
}
```

### 14.3 Handoffs

```typescript
// When one agent needs to hand off to another

interface Handoff {
  fromAgent: string;
  toAgentType: AgentType;
  context: HandoffContext;
  package: HandoffPackage;
}

interface HandoffPackage {
  // Essential context (must fit in new agent's context)
  mustKnow: {
    task: string;
    completedSteps: string[];
    pendingSteps: string[];
    discoveredConstraints: Constraint[];
    warnings: string[];
  };

  // Can be re-derived if needed
  canDerive: {
    fileContents: string[];
    dependencyGraph: string;
  };

  // State to preserve
  state: {
    locks: string[];
    modifiedFiles: FilePath[];
    testResults: TestResult[];
  };
}
```

---

## 15. Agent Lifecycle & Context-Aware Knowledge

### 15.1 Phase-Aware Knowledge Delivery

```typescript
// Different phases need different knowledge

enum AgentPhase {
  PLANNING = 'planning',
  EXPLORING = 'exploring',
  IMPLEMENTING = 'implementing',
  TESTING = 'testing',
  REVIEWING = 'reviewing',
  COMPLETING = 'completing',
}

class PhaseAwareKnowledgeDelivery {
  async getKnowledgeForPhase(
    phase: AgentPhase,
    context: AgentContext
  ): Promise<PhaseKnowledge> {
    switch (phase) {
      case AgentPhase.PLANNING:
        return {
          // High-level, no code details
          summary: await this.getAreaSummaries(context.task.scope),
          architecture: await this.getRelevantArchitecture(context.task),
          constraints: await this.getGlobalConstraints(context.task.scope),
          similarTasks: await this.findSimilarCompletedTasks(context.task),
          estimatedComplexity: await this.estimateComplexity(context.task),
        };

      case AgentPhase.EXPLORING:
        return {
          // Breadth - help agent find the right places
          entryPoints: await this.findEntryPoints(context.task),
          relevantFiles: await this.rankFilesByRelevance(context.task),
          keyFunctions: await this.findKeyFunctions(context.task),
          // What NOT to look at (save time)
          irrelevantAreas: await this.identifyIrrelevantAreas(context.task),
        };

      case AgentPhase.IMPLEMENTING:
        return {
          // Deep, specific knowledge for active files
          fileContexts: await this.getDeepFileContexts(context.activeFiles),
          patterns: await this.getPatternsToFollow(context.activeFiles),
          examples: await this.findRelevantExamples(context.task),
          constraints: await this.getFileConstraints(context.activeFiles),
          coChangeFiles: await this.getCoChangedFiles(context.activeFiles),
        };

      case AgentPhase.TESTING:
        return {
          requiredTests: await this.getRequiredTests(context.activeFiles),
          testPatterns: await this.getTestPatterns(context.activeFiles),
          edgeCases: await this.suggestEdgeCases(context.task),
          existingCoverage: await this.getExistingCoverage(context.activeFiles),
        };

      case AgentPhase.REVIEWING:
        return {
          checklist: await this.getReviewChecklist(context.task),
          potentialIssues: await this.identifyPotentialIssues(context.changes),
          securityConcerns: await this.getSecurityConcerns(context.activeFiles),
          missedFiles: await this.identifyMissedFiles(context.task, context.activeFiles),
        };

      case AgentPhase.COMPLETING:
        return {
          docsToUpdate: await this.getDocsToUpdate(context.activeFiles),
          changelogEntry: await this.suggestChangelogEntry(context.task),
          reviewers: await this.getReviewers(context.activeFiles),
          relatedTasks: await this.getRelatedTasks(context.task),
        };
    }
  }
}
```

### 15.2 Context Window Optimization

```typescript
// Agents have limited context - deliver knowledge efficiently

interface ContextBudget {
  totalTokens: number;
  usedTokens: number;
  reservedForOutput: number;
}

class ContextOptimizedDelivery {
  async deliverWithinBudget(
    query: AgentQuery,
    budget: ContextBudget
  ): Promise<BudgetedResponse> {
    const availableTokens = budget.totalTokens - budget.usedTokens - budget.reservedForOutput;

    // Rank knowledge by importance
    const ranked = await this.rankByImportance(query);

    // Pack as much as fits
    const packed: KnowledgeItem[] = [];
    let usedTokens = 0;

    for (const item of ranked) {
      const itemTokens = this.estimateTokens(item);

      if (usedTokens + itemTokens <= availableTokens) {
        packed.push(item);
        usedTokens += itemTokens;
      } else if (item.canSummarize && item.priority === 'high') {
        // Summarize high-priority items that don't fit
        const summarized = await this.summarize(item, availableTokens - usedTokens);
        packed.push(summarized);
        usedTokens += this.estimateTokens(summarized);
      }
    }

    return {
      knowledge: packed,
      tokensUsed: usedTokens,
      omitted: ranked.length - packed.length,
      moreAvailable: ranked.length > packed.length,
    };
  }

  // Progressive disclosure - summary first, details on demand
  async getProgressiveKnowledge(query: AgentQuery): Promise<ProgressiveKnowledge> {
    return {
      tldr: await this.getTLDR(query),                    // ~50 tokens
      keyPoints: await this.getKeyPoints(query),          // ~500 tokens
      fullContext: () => this.getFullContext(query),      // ~2000 tokens (lazy)
      deepDive: (aspect) => this.getDeepDive(query, aspect), // On demand
    };
  }
}
```

---

## 16. Predictive Prefetching

### 16.1 Learning Agent Patterns

```typescript
// src/LiBrainian/prefetch/prefetcher.ts

class PredictivePrefetcher {
  private accessPatterns = new Map<string, AccessSequence[]>();

  // Learn from agent behavior
  observeAccess(agentId: string, access: KnowledgeAccess): void {
    const sequence = this.accessPatterns.get(agentId) || [];
    sequence.push({
      query: access.query,
      timestamp: now(),
      phase: access.phase,
    });
    this.accessPatterns.set(agentId, sequence.slice(-100)); // Keep last 100
  }

  // Predict next accesses
  async prefetch(agentId: string, context: AgentContext): Promise<void> {
    const predictions = this.predict(agentId, context);

    // Prefetch in background
    for (const pred of predictions) {
      if (pred.probability > 0.5) {
        this.cache.prefetch(pred.query);
      }
    }
  }

  private predict(agentId: string, context: AgentContext): Prediction[] {
    const history = this.accessPatterns.get(agentId) || [];

    // Pattern-based predictions
    const predictions: Prediction[] = [];

    // If agent opened a file, likely to need:
    if (context.lastAction === 'opened_file') {
      predictions.push(
        { query: { intent: 'find_dependencies_of', target: context.currentFile }, probability: 0.9 },
        { query: { intent: 'find_dependents_of', target: context.currentFile }, probability: 0.8 },
        { query: { intent: 'what_tests_cover', target: context.currentFile }, probability: 0.7 },
      );
    }

    // If agent is implementing, likely to need:
    if (context.phase === AgentPhase.IMPLEMENTING) {
      predictions.push(
        { query: { intent: 'find_similar_to', target: context.currentTask }, probability: 0.6 },
        { query: { intent: 'what_patterns_apply', target: context.currentFile }, probability: 0.7 },
      );
    }

    return predictions;
  }
}
```

---

## 17. Agent Failure Recovery

### 17.1 Recovery Guidance

```typescript
// src/LiBrainian/recovery/agent_recovery.ts

class AgentRecoverySupport {
  async handleAgentError(
    agentId: string,
    error: AgentError,
    context: ErrorContext
  ): Promise<RecoveryGuidance> {
    const analysis = await this.analyzeError(error, context);

    return {
      diagnosis: analysis.diagnosis,
      rootCause: analysis.rootCause,

      recoveryOptions: [
        {
          name: 'retry_with_fix',
          description: 'Apply suggested fix and retry',
          fix: analysis.suggestedFix,
          confidence: analysis.fixConfidence,
          steps: analysis.fixSteps,
        },
        {
          name: 'rollback',
          description: 'Undo changes and start fresh',
          rollbackSteps: await this.getRollbackSteps(context),
          confidence: 0.95,
        },
        {
          name: 'partial_rollback',
          description: 'Undo only the failing change',
          rollbackSteps: await this.getPartialRollback(context, error),
          confidence: 0.8,
        },
        {
          name: 'escalate',
          description: 'Ask human for help',
          context: await this.packageForHuman(error, context),
          confidence: 1.0,
        },
      ],

      prevention: {
        whatToCheck: analysis.preventionChecks,
        patternToAvoid: analysis.antiPattern,
        alternativeApproach: analysis.alternativeApproach,
      },
    };
  }

  async getRollbackSteps(context: ErrorContext): Promise<RollbackStep[]> {
    const changes = await this.getChangesSinceStart(context);

    return changes.reverse().map(change => ({
      change,
      command: this.getRollbackCommand(change),
      verification: this.getVerificationStep(change),
    }));
  }
}
```

---

## 18. Agent Learning Integration

### 18.1 Agents Teaching the LiBrainian

```typescript
// src/LiBrainian/learning/agent_learning.ts

interface AgentLearning {
  type: 'discovery' | 'correction' | 'pattern' | 'insight';
  agentId: string;
  content: unknown;
  confidence: number;
  evidence: string[];
}

class AgentLearningIntegration {
  async integrate(learning: AgentLearning): Promise<IntegrationResult> {
    // Validate learning (agents can make mistakes)
    const validation = await this.validateLearning(learning);

    if (!validation.isValid) {
      // Log for human review
      await this.flagForReview(learning, validation.issues);
      return { integrated: false, reason: 'failed_validation' };
    }

    // Check for conflicts with existing knowledge
    const conflicts = await this.findConflicts(learning);
    if (conflicts.length > 0) {
      // Resolve conflicts (prefer higher confidence, more evidence)
      const resolution = await this.resolveConflicts(learning, conflicts);
      if (!resolution.keepNew) {
        return { integrated: false, reason: 'conflict_resolution' };
      }
    }

    // Integrate into knowledge base
    await this.storeKnowledge(learning);

    // Update confidence in this area
    await this.updateAreaConfidence(learning.content, 'increase');

    // Notify other agents
    eventBus.emit({
      type: 'knowledge:learned',
      source: learning.agentId,
      content: learning,
    });

    return { integrated: true };
  }

  private async validateLearning(learning: AgentLearning): Promise<ValidationResult> {
    const checks: ValidationCheck[] = [];

    // Check evidence is real
    for (const evidence of learning.evidence) {
      const exists = await this.verifyEvidence(evidence);
      checks.push({ check: 'evidence_exists', passed: exists, evidence });
    }

    // Check content is plausible
    const plausibility = await this.checkPlausibility(learning.content);
    checks.push({ check: 'plausible', passed: plausibility > 0.7 });

    // Check confidence is calibrated
    const calibrated = this.checkConfidenceCalibration(learning);
    checks.push({ check: 'calibrated', passed: calibrated });

    return {
      isValid: checks.every(c => c.passed),
      issues: checks.filter(c => !c.passed),
    };
  }
}
```

---

## 19. Confidence Calibration for Autonomy

### 19.1 Calibrated Confidence Scores

```typescript
// src/LiBrainian/confidence/calibration.ts

interface CalibratedConfidence {
  // Knowledge quality
  knowledge: {
    coverage: number;      // What % of codebase indexed?
    freshness: number;     // How current?
    depth: number;         // How deep is understanding?
  };

  // Inference quality
  inference: {
    patternReliability: number;  // How well do patterns predict?
    riskAccuracy: number;        // How accurate are risk assessments?
    impactAccuracy: number;      // How accurate are impact predictions?
  };

  // Historical performance
  history: {
    predictionAccuracy: number;  // Past predictions vs outcomes
    falsePositiveRate: number;   // Over-caution rate
    falseNegativeRate: number;   // Under-caution rate
  };
}

class AutonomyDecider {
  private thresholds = {
    canModifyWithoutReview: 0.9,
    canAddTestsWithoutReview: 0.8,
    canRefactorWithoutReview: 0.85,
    canDeleteWithoutReview: 0.95,
  };

  decide(
    action: AgentAction,
    confidence: CalibratedConfidence
  ): AutonomyDecision {
    const threshold = this.thresholds[action.type] ?? 0.9;
    const actionConfidence = this.computeActionConfidence(action, confidence);

    if (actionConfidence >= threshold) {
      return {
        canProceed: true,
        requiresNotification: actionConfidence < threshold + 0.05,
        postActionValidation: this.getValidationSteps(action),
      };
    }

    return {
      canProceed: false,
      reason: this.explainLowConfidence(actionConfidence, threshold),
      suggestedAlternative: this.suggestSaferApproach(action),
      questionsToAsk: this.generateClarifyingQuestions(action),
    };
  }

  // Track prediction outcomes to improve calibration
  recordOutcome(prediction: Prediction, outcome: Outcome): void {
    this.history.push({ prediction, outcome, timestamp: now() });
    this.recalibrateThresholds();
  }
}
```

---

## 20. Edge Cases & Failure Handling

### 20.1 Codebase Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| Empty repository | `fs.readdirSync(root).length === 0` | Return minimal knowledge, suggest initialization |
| Single file repo | `globSync('**/*').length === 1` | Skip entity discovery, full file analysis |
| Massive monorepo | `fileCount > 100000` | Incremental indexing, sampling, lazy loading |
| Shallow clone | `git rev-parse --is-shallow-repository` | Warn about limited history, try unshallow |
| No git history | No `.git` directory | Skip co-change analysis, history knowledge unavailable |
| Binary files only | No parseable source files | Return `unsupported_codebase` error |
| Mixed languages | Multiple language patterns | Index each language with appropriate parser |
| Generated code | `**/generated/**`, `*.g.ts` patterns | Mark as generated, lower priority |
| Vendored deps | `vendor/`, `third_party/` | Exclude from primary analysis |

### 20.2 Git Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| Merge conflict in progress | `.git/MERGE_HEAD` exists | Warn, skip history analysis |
| Rebase in progress | `.git/rebase-merge` exists | Warn, skip history analysis |
| Detached HEAD | `git symbolic-ref HEAD` fails | Use commit hash, warn about branch |
| Uncommitted changes | `git status --porcelain` non-empty | Include in analysis, mark as uncommitted |
| Submodules | `.gitmodules` exists | Analyze separately or skip based on config |
| Worktrees | Multiple worktrees | Handle path resolution carefully |
| LFS files | `.gitattributes` with `lfs` | Skip content analysis, note LFS |

### 20.3 Provider Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| Both providers rate-limited | Both return 429 | Queue requests, exponential backoff |
| Provider returns garbage | Response validation fails | Retry with different model/provider |
| API key expired | 401 response | Clear circuit breaker, alert user |
| Network flaky | Intermittent failures | Retry with jitter, circuit breaker |
| Response truncated | `stop_reason: length` | Re-request with higher limit or chunk |
| Provider policy refusal | "I can't help with that" | Try alternate phrasing, fall back |

### 20.4 Storage Edge Cases

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| Database corrupted | `PRAGMA integrity_check` fails | Restore from backup, rebuild |
| Disk full | `SQLITE_FULL` error | Alert, cleanup old data, fail gracefully |
| Concurrent write conflict | `SQLITE_BUSY` after retries | Use longer timeout, queue writes |
| Schema mismatch | Version check fails | Run migrations or rebuild |
| Index fragmented | Query performance degraded | Schedule VACUUM |

---

## 21. Existing Test Coverage

### 21.1 Tests Already Written

These tests validate the local embedding infrastructure:

| Test File | What It Tests | Status |
|-----------|---------------|--------|
| `cross_encoder_reranker.test.ts` | Cross-encoder scoring, re-ranking, hybrid scores | ✅ Passing |
| `co_change_signals.test.ts` | Git history extraction, matrix building, clustering | ✅ Passing |
| `function_chunking.test.ts` | Function boundary detection, chunk generation | ✅ Passing |
| `unified_embedding_pipeline.test.ts` | End-to-end embedding, similarity search | ✅ Passing |

### 21.2 Tests to Add

| Test | Purpose | Priority |
|------|---------|----------|
| `provider_failover.test.ts` | Claude ↔ Codex switching | High |
| `freshness_manager.test.ts` | Staleness detection, refresh triggers | High |
| `entity_discovery.test.ts` | Emergent entity detection | High |
| `knowledge_aggregation.test.ts` | Parent-child knowledge rollup | Medium |
| `agent_coordination.test.ts` | Multi-agent locking, handoffs | Medium |
| `query_processor.test.ts` | Query parsing, retrieval, synthesis | High |
| `edge_cases.test.ts` | Empty repo, shallow clone, etc. | Medium |

---

## 22. Implicit, Modular & Adaptive Systems

> **Design Philosophy**: Anything that CAN be inferred SHOULD be inferred. Anything that CAN adapt SHOULD adapt. Anything that CAN be extended SHOULD be extensible.

### 22.1 What Should Be Implicit (Not Hard-Coded)

#### Knowledge Domain Discovery

**Problem**: The 12 knowledge domains are hard-coded with fixed freshness tolerances.

**Solution**: Domain discovery and adaptive freshness:

```typescript
// src/LiBrainian/knowledge/domain_registry.ts

interface DomainDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly extractors: ExtractorId[];
  readonly defaultStaleness: number;
  readonly priority: number;
}

class DomainRegistry {
  private domains = new Map<string, DomainDefinition>();
  private accessPatterns = new Map<string, number[]>(); // domain -> access timestamps
  private adaptiveStaleness = new Map<string, number>();

  // Built-in domains loaded from config, not code
  async loadBuiltInDomains(): Promise<void> {
    const config = await loadConfig('domains.yaml');
    for (const domain of config.domains) {
      this.register(domain);
    }
  }

  // Codebase can define custom domains
  async loadCodebaseDomains(repoRoot: string): Promise<void> {
    const customConfig = await loadOptionalConfig(
      path.join(repoRoot, '.LiBrainian/domains.yaml')
    );
    if (customConfig) {
      for (const domain of customConfig.domains) {
        this.register({ ...domain, isCustom: true });
      }
    }
  }

  // Discover domains from access patterns
  async inferNewDomains(): Promise<DomainDefinition[]> {
    // If agents repeatedly query for something not covered by existing domains,
    // suggest a new domain
    const uncoveredQueries = await this.getUncoveredQueryPatterns();
    return uncoveredQueries.map(pattern => ({
      id: `inferred:${pattern.key}`,
      name: pattern.suggestedName,
      description: `Auto-discovered from query pattern: ${pattern.description}`,
      extractors: [],
      defaultStaleness: 3600000, // 1 hour default
      priority: 50,
      isInferred: true,
    }));
  }

  // Adaptive staleness based on access patterns
  getEffectiveStaleness(domainId: string): number {
    const base = this.domains.get(domainId)?.defaultStaleness ?? 3600000;
    const accessTimes = this.accessPatterns.get(domainId) ?? [];

    // If accessed frequently recently, reduce staleness tolerance
    const recentAccesses = accessTimes.filter(t => Date.now() - t < 300000).length;
    if (recentAccesses > 10) {
      return Math.max(base / 4, 60000); // At least 1 minute
    }
    if (recentAccesses > 5) {
      return base / 2;
    }

    return base;
  }

  recordAccess(domainId: string): void {
    const times = this.accessPatterns.get(domainId) ?? [];
    times.push(Date.now());
    // Keep last 1000 access times
    this.accessPatterns.set(domainId, times.slice(-1000));
  }
}

export const domainRegistry = new DomainRegistry();
```

#### Entity Type Inference

**Problem**: `KnowledgeableEntity` is a fixed union type.

**Solution**: Extensible entity registry with pattern-based discovery:

```typescript
// src/LiBrainian/discovery/entity_registry.ts

interface EntityTypeDefinition {
  readonly id: string;
  readonly name: string;
  readonly parent?: string;
  readonly patterns: EntityPattern[];
  readonly isBuiltIn: boolean;
  readonly isDiscovered: boolean;
}

interface EntityPattern {
  type: 'directory' | 'naming' | 'import' | 'co-change' | 'semantic';
  pattern: string | RegExp | ((files: string[]) => boolean);
  confidence: number;
}

class EntityRegistry {
  private types = new Map<string, EntityTypeDefinition>();
  private discoveredEntities = new Map<string, Set<string>>(); // type -> entity IDs

  // Register built-in types
  registerBuiltIn(): void {
    // Explicit code entities
    this.register({ id: 'file', name: 'File', isBuiltIn: true, patterns: [] });
    this.register({ id: 'function', name: 'Function', isBuiltIn: true, patterns: [] });
    this.register({ id: 'class', name: 'Class', isBuiltIn: true, patterns: [] });
    // ... etc
  }

  // Codebase can define custom entity types
  async loadCodebaseEntityTypes(repoRoot: string): Promise<void> {
    const config = await loadOptionalConfig(
      path.join(repoRoot, '.LiBrainian/entities.yaml')
    );
    if (config?.entityTypes) {
      for (const type of config.entityTypes) {
        this.register({
          ...type,
          isBuiltIn: false,
          isDiscovered: false,
        });
      }
    }
  }

  // Discover new entity types from patterns in the codebase
  async discoverEntityTypes(files: FileInfo[]): Promise<EntityTypeDefinition[]> {
    const discovered: EntityTypeDefinition[] = [];

    // Look for consistent naming patterns that suggest entity types
    const namingPatterns = this.findNamingPatterns(files);
    for (const pattern of namingPatterns) {
      if (pattern.matches.length >= 3 && pattern.confidence > 0.8) {
        discovered.push({
          id: `discovered:${pattern.suffix}`,
          name: this.suffixToName(pattern.suffix),
          isBuiltIn: false,
          isDiscovered: true,
          patterns: [{
            type: 'naming',
            pattern: new RegExp(`\\.${pattern.suffix}\\.(ts|js|tsx|jsx)$`),
            confidence: pattern.confidence,
          }],
        });
      }
    }

    // Look for co-change clusters that might represent entity types
    const clusters = await this.findCoChangeClusters(files);
    for (const cluster of clusters) {
      if (cluster.files.length >= 5 && cluster.cohesion > 0.7) {
        discovered.push({
          id: `discovered:cluster:${cluster.id}`,
          name: cluster.suggestedName,
          isBuiltIn: false,
          isDiscovered: true,
          patterns: [{
            type: 'co-change',
            pattern: (f) => cluster.files.includes(f),
            confidence: cluster.cohesion,
          }],
        });
      }
    }

    return discovered;
  }

  private findNamingPatterns(files: FileInfo[]): NamingPattern[] {
    const suffixCounts = new Map<string, string[]>();

    for (const file of files) {
      const match = file.name.match(/\.([a-z]+)\.(ts|js|tsx|jsx)$/i);
      if (match) {
        const suffix = match[1].toLowerCase();
        const arr = suffixCounts.get(suffix) ?? [];
        arr.push(file.path);
        suffixCounts.set(suffix, arr);
      }
    }

    return Array.from(suffixCounts.entries())
      .filter(([_, files]) => files.length >= 3)
      .map(([suffix, matches]) => ({
        suffix,
        matches,
        confidence: Math.min(matches.length / 10, 1),
      }));
  }

  private suffixToName(suffix: string): string {
    return suffix.charAt(0).toUpperCase() + suffix.slice(1);
  }
}

export const entityRegistry = new EntityRegistry();
```

#### Provider Behavior Inference

**Problem**: Circuit breaker thresholds and rate limits are hard-coded.

**Solution**: Adaptive provider configuration:

```typescript
// src/LiBrainian/providers/adaptive_config.ts

interface ProviderMetrics {
  successCount: number;
  failureCount: number;
  latencies: number[];
  lastSuccess?: number;
  lastFailure?: number;
  recentErrors: Array<{ time: number; reason: string }>;
}

class AdaptiveProviderConfig {
  private metrics = new Map<string, ProviderMetrics>();
  private baseConfig = new Map<string, ProviderConfig>();

  // Learn optimal settings from observed behavior
  getAdaptedConfig(providerId: string): ProviderConfig {
    const base = this.baseConfig.get(providerId) ?? DEFAULT_PROVIDER_CONFIG;
    const metrics = this.metrics.get(providerId);

    if (!metrics || metrics.successCount + metrics.failureCount < 10) {
      return base; // Not enough data yet
    }

    // Adapt circuit breaker threshold based on observed reliability
    const failureRate = metrics.failureCount / (metrics.successCount + metrics.failureCount);
    let circuitBreakerThreshold = base.circuitBreaker.failureThreshold;

    if (failureRate > 0.3) {
      // High failure rate - be more aggressive with circuit breaker
      circuitBreakerThreshold = Math.max(3, circuitBreakerThreshold - 2);
    } else if (failureRate < 0.05) {
      // Very reliable - be more lenient
      circuitBreakerThreshold = Math.min(10, circuitBreakerThreshold + 2);
    }

    // Adapt timeout based on observed latencies
    const p95Latency = this.percentile(metrics.latencies, 95);
    const adaptedTimeout = Math.max(
      base.timeoutMs,
      p95Latency * 1.5
    );

    // Adapt rate limit based on recent errors
    const rateLimitErrors = metrics.recentErrors
      .filter(e => e.reason === 'rate_limit' && Date.now() - e.time < 300000)
      .length;

    let tokensPerSecond = base.rateLimit.tokensPerSecond;
    if (rateLimitErrors > 2) {
      tokensPerSecond = Math.max(1, tokensPerSecond * 0.7);
    }

    return {
      ...base,
      circuitBreaker: {
        ...base.circuitBreaker,
        failureThreshold: circuitBreakerThreshold,
      },
      timeoutMs: adaptedTimeout,
      rateLimit: {
        ...base.rateLimit,
        tokensPerSecond,
      },
    };
  }

  recordSuccess(providerId: string, latencyMs: number): void {
    const m = this.getOrCreate(providerId);
    m.successCount++;
    m.latencies.push(latencyMs);
    m.lastSuccess = Date.now();
    // Keep last 1000 latencies
    if (m.latencies.length > 1000) {
      m.latencies = m.latencies.slice(-1000);
    }
  }

  recordFailure(providerId: string, reason: string): void {
    const m = this.getOrCreate(providerId);
    m.failureCount++;
    m.lastFailure = Date.now();
    m.recentErrors.push({ time: Date.now(), reason });
    // Keep last 100 errors
    if (m.recentErrors.length > 100) {
      m.recentErrors = m.recentErrors.slice(-100);
    }
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor((p / 100) * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)];
  }

  private getOrCreate(providerId: string): ProviderMetrics {
    if (!this.metrics.has(providerId)) {
      this.metrics.set(providerId, {
        successCount: 0,
        failureCount: 0,
        latencies: [],
        recentErrors: [],
      });
    }
    return this.metrics.get(providerId)!;
  }
}

export const adaptiveProviderConfig = new AdaptiveProviderConfig();
```

### 22.2 What Should Be Modular (Plugin-Based)

#### Extensible Embedding Models

**Problem**: Embedding model is fixed to `all-MiniLM-L6-v2` with 384 dimensions.

**Solution**: Model registry with dynamic selection:

```typescript
// src/LiBrainian/api/embedding_providers/model_registry.ts

interface EmbeddingModelDefinition {
  readonly id: string;
  readonly xenovaId: string;
  readonly dimensions: number;
  readonly description: string;
  readonly useCases: string[];
  readonly avgLatencyMs: number;
  readonly qualityScore: number; // 0-1, higher = better quality
  readonly enabled: boolean;
}

class EmbeddingModelRegistry {
  private models = new Map<string, EmbeddingModelDefinition>();
  private loadedModels = new Map<string, LoadedModel>();
  private performanceMetrics = new Map<string, ModelPerformanceMetrics>();

  // Register built-in models
  registerBuiltIn(): void {
    this.register({
      id: 'all-MiniLM-L6-v2',
      xenovaId: 'Xenova/all-MiniLM-L6-v2',
      dimensions: 384,
      description: 'Fast, general-purpose embeddings',
      useCases: ['code', 'text', 'search'],
      avgLatencyMs: 15,
      qualityScore: 0.7,
      enabled: true,
    });

    this.register({
      id: 'all-MiniLM-L12-v2',
      xenovaId: 'Xenova/all-MiniLM-L12-v2',
      dimensions: 384,
      description: 'Higher quality, slower embeddings',
      useCases: ['code', 'text', 'search'],
      avgLatencyMs: 30,
      qualityScore: 0.85,
      enabled: true,
    });

    // Add more models as they become available
  }

  // Codebase can enable/disable models or add custom ones
  async loadCodebaseConfig(repoRoot: string): Promise<void> {
    const config = await loadOptionalConfig(
      path.join(repoRoot, '.LiBrainian/embeddings.yaml')
    );
    if (config?.models) {
      for (const model of config.models) {
        if (this.models.has(model.id)) {
          // Update existing model config
          const existing = this.models.get(model.id)!;
          this.models.set(model.id, { ...existing, ...model });
        } else {
          // Register custom model
          this.register(model);
        }
      }
    }
  }

  // Select best model for use case
  selectModel(useCase: string, constraints?: ModelConstraints): EmbeddingModelDefinition {
    const candidates = Array.from(this.models.values())
      .filter(m => m.enabled)
      .filter(m => m.useCases.includes(useCase))
      .filter(m => !constraints?.maxLatencyMs || m.avgLatencyMs <= constraints.maxLatencyMs)
      .filter(m => !constraints?.minQuality || m.qualityScore >= constraints.minQuality);

    if (candidates.length === 0) {
      // Fall back to default
      return this.models.get('all-MiniLM-L6-v2')!;
    }

    // Balance quality and latency based on constraints
    const latencyWeight = constraints?.preferSpeed ? 0.7 : 0.3;
    const qualityWeight = 1 - latencyWeight;

    return candidates.sort((a, b) => {
      const scoreA = qualityWeight * a.qualityScore - latencyWeight * (a.avgLatencyMs / 100);
      const scoreB = qualityWeight * b.qualityScore - latencyWeight * (b.avgLatencyMs / 100);
      return scoreB - scoreA;
    })[0];
  }

  // A/B testing support
  async runComparison(
    texts: string[],
    modelIds: string[]
  ): Promise<ModelComparisonResult> {
    const results: Record<string, { embeddings: Float32Array[]; latencyMs: number }> = {};

    for (const modelId of modelIds) {
      const model = await this.getLoadedModel(modelId);
      const start = performance.now();
      const embeddings = await Promise.all(texts.map(t => model.embed(t)));
      results[modelId] = {
        embeddings,
        latencyMs: performance.now() - start,
      };
    }

    return this.analyzeComparison(results);
  }
}

export const embeddingModelRegistry = new EmbeddingModelRegistry();
```

#### Extensible Query Intents

**Problem**: `AgentQueryIntent` is a fixed union type.

**Solution**: Intent registry with LLM-assisted classification:

```typescript
// src/LiBrainian/query/intent_registry.ts

interface QueryIntentDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly examples: string[];
  readonly handler: QueryIntentHandler;
  readonly requiredDomains: string[];
  readonly isBuiltIn: boolean;
}

interface QueryIntentHandler {
  (query: ParsedQuery, context: QueryContext): Promise<QueryResponse>;
}

class QueryIntentRegistry {
  private intents = new Map<string, QueryIntentDefinition>();
  private classificationCache = new LRUCache<string, string>(1000);

  registerBuiltIn(): void {
    // Understanding intents
    this.register({
      id: 'what_does_this_do',
      name: 'What Does This Do',
      description: 'Explain the purpose and behavior of code',
      examples: [
        'what does authenticateUser do',
        'explain this function',
        'what is the purpose of UserService',
      ],
      handler: this.handleWhatDoesThisDo.bind(this),
      requiredDomains: ['semantics', 'structure'],
      isBuiltIn: true,
    });

    // ... other built-in intents
  }

  // Codebase can add custom intents
  async loadCodebaseIntents(repoRoot: string): Promise<void> {
    const config = await loadOptionalConfig(
      path.join(repoRoot, '.LiBrainian/intents.yaml')
    );
    if (config?.intents) {
      for (const intent of config.intents) {
        this.register({
          ...intent,
          isBuiltIn: false,
          handler: this.createDynamicHandler(intent),
        });
      }
    }
  }

  // Classify query to intent using pattern matching + LLM fallback
  async classifyIntent(
    query: string,
    context?: QueryContext
  ): Promise<{ intentId: string; confidence: number }> {
    // Check cache
    const cacheKey = query.toLowerCase().trim();
    const cached = this.classificationCache.get(cacheKey);
    if (cached) {
      return { intentId: cached, confidence: 1.0 };
    }

    // Try pattern matching first (fast, deterministic)
    const patternMatch = this.matchByPatterns(query);
    if (patternMatch && patternMatch.confidence > 0.8) {
      this.classificationCache.set(cacheKey, patternMatch.intentId);
      return patternMatch;
    }

    // Try embedding similarity (medium speed)
    const embeddingMatch = await this.matchByEmbedding(query);
    if (embeddingMatch && embeddingMatch.confidence > 0.7) {
      this.classificationCache.set(cacheKey, embeddingMatch.intentId);
      return embeddingMatch;
    }

    // Fall back to LLM classification (slower, most accurate)
    const llmMatch = await this.classifyWithLLM(query, context);
    if (llmMatch) {
      this.classificationCache.set(cacheKey, llmMatch.intentId);
      return llmMatch;
    }

    // Unknown intent - could trigger intent discovery
    return { intentId: 'unknown', confidence: 0 };
  }

  // Discover new intents from unclassified queries
  async discoverIntents(): Promise<QueryIntentDefinition[]> {
    const unknownQueries = await this.getRecentUnknownQueries(100);

    // Cluster similar unknown queries
    const clusters = await this.clusterQueries(unknownQueries);

    // For each cluster with enough queries, suggest a new intent
    return clusters
      .filter(c => c.queries.length >= 5)
      .map(c => ({
        id: `discovered:${c.id}`,
        name: c.suggestedName,
        description: `Auto-discovered intent from ${c.queries.length} queries`,
        examples: c.queries.slice(0, 5),
        handler: this.createPlaceholderHandler(c),
        requiredDomains: c.inferredDomains,
        isBuiltIn: false,
        isDiscovered: true,
      }));
  }

  private matchByPatterns(query: string): { intentId: string; confidence: number } | null {
    const normalized = query.toLowerCase().trim();

    for (const [id, def] of this.intents) {
      for (const example of def.examples) {
        // Simple pattern matching - could be more sophisticated
        const exampleNorm = example.toLowerCase();
        if (normalized.includes(exampleNorm) || exampleNorm.includes(normalized)) {
          return { intentId: id, confidence: 0.9 };
        }
      }
    }

    // Keyword-based matching
    if (normalized.startsWith('what does') || normalized.includes('explain')) {
      return { intentId: 'what_does_this_do', confidence: 0.7 };
    }
    if (normalized.includes('find') || normalized.includes('search')) {
      return { intentId: 'find_similar_to', confidence: 0.6 };
    }

    return null;
  }
}

export const queryIntentRegistry = new QueryIntentRegistry();
```

### 22.3 What Should Be Adaptive (Self-Tuning)

#### Auto-Tuning Resource Limits

**Problem**: Resource limits are hard-coded constants.

**Solution**: System-aware auto-tuning:

```typescript
// src/LiBrainian/core/adaptive_resources.ts

interface SystemResources {
  availableMemoryMB: number;
  cpuCores: number;
  diskSpaceMB: number;
  currentLoad: number; // 0-1
}

class AdaptiveResourceManager {
  private baseLimits = {
    providerCalls: 10,
    dbWrites: 5,
    fileReads: 20,
    embeddings: 3,
    reranking: 2,
  };

  private queueDepths = new Map<string, number>();
  private throughputHistory = new Map<string, number[]>();

  async getAdaptedLimits(): Promise<Record<string, number>> {
    const resources = await this.measureSystemResources();
    const adapted: Record<string, number> = {};

    for (const [resource, baseLimit] of Object.entries(this.baseLimits)) {
      adapted[resource] = this.adaptLimit(resource, baseLimit, resources);
    }

    return adapted;
  }

  private adaptLimit(
    resource: string,
    baseLimit: number,
    system: SystemResources
  ): number {
    let multiplier = 1;

    // Adjust based on available memory
    if (system.availableMemoryMB > 4096) {
      multiplier *= 1.5;
    } else if (system.availableMemoryMB < 1024) {
      multiplier *= 0.5;
    }

    // Adjust based on CPU cores
    if (resource === 'embeddings' || resource === 'reranking') {
      multiplier *= Math.min(system.cpuCores / 4, 2);
    }

    // Adjust based on current load
    if (system.currentLoad > 0.8) {
      multiplier *= 0.7;
    } else if (system.currentLoad < 0.3) {
      multiplier *= 1.3;
    }

    // Adjust based on queue depth (backpressure)
    const queueDepth = this.queueDepths.get(resource) ?? 0;
    if (queueDepth > baseLimit * 2) {
      // Queue is building up - increase limit
      multiplier *= 1.2;
    }

    return Math.max(1, Math.round(baseLimit * multiplier));
  }

  private async measureSystemResources(): Promise<SystemResources> {
    const os = await import('os');

    const totalMemory = os.totalmem() / (1024 * 1024);
    const freeMemory = os.freemem() / (1024 * 1024);
    const cpuCores = os.cpus().length;

    // Measure CPU load
    const loadAvg = os.loadavg()[0]; // 1-minute average
    const currentLoad = Math.min(loadAvg / cpuCores, 1);

    return {
      availableMemoryMB: freeMemory,
      cpuCores,
      diskSpaceMB: await this.getFreeDiskSpace(),
      currentLoad,
    };
  }

  recordQueueDepth(resource: string, depth: number): void {
    this.queueDepths.set(resource, depth);
  }

  recordThroughput(resource: string, itemsPerSecond: number): void {
    const history = this.throughputHistory.get(resource) ?? [];
    history.push(itemsPerSecond);
    // Keep last 100 measurements
    this.throughputHistory.set(resource, history.slice(-100));
  }
}

export const adaptiveResourceManager = new AdaptiveResourceManager();
```

### 22.4 What Should Be Complex (Not Over-Simplified)

#### Multi-Signal Relevance Scoring

**Problem**: Single similarity score for ranking.

**Solution**: Multi-dimensional relevance with learned weights:

```typescript
// src/LiBrainian/query/multi_signal_scorer.ts

interface RelevanceSignals {
  // Semantic signals
  embeddingSimilarity: number;      // Bi-encoder
  crossEncoderScore: number;        // Cross-encoder
  bm25Score: number;                // Lexical

  // Structural signals
  directDependency: boolean;        // Is it a direct import?
  transitiveDistance: number;       // How many hops away?
  coChangeScore: number;            // From git history

  // Contextual signals
  recency: number;                  // How recently modified?
  authorOverlap: number;            // Same author as current file?
  ownershipMatch: number;           // Same team?

  // Task-specific signals
  intentAlignment: number;          // Matches query intent?
  constraintSatisfaction: number;   // Satisfies explicit constraints?
}

interface SignalWeights {
  [K in keyof RelevanceSignals]: number;
}

class MultiSignalScorer {
  private baseWeights: SignalWeights = {
    embeddingSimilarity: 0.25,
    crossEncoderScore: 0.20,
    bm25Score: 0.10,
    directDependency: 0.10,
    transitiveDistance: 0.05,
    coChangeScore: 0.10,
    recency: 0.05,
    authorOverlap: 0.03,
    ownershipMatch: 0.02,
    intentAlignment: 0.05,
    constraintSatisfaction: 0.05,
  };

  private learnedWeights?: SignalWeights;
  private feedbackHistory: Array<{
    signals: RelevanceSignals;
    wasRelevant: boolean;
  }> = [];

  computeScore(signals: RelevanceSignals): number {
    const weights = this.learnedWeights ?? this.baseWeights;
    let score = 0;

    for (const [key, value] of Object.entries(signals)) {
      const weight = weights[key as keyof SignalWeights];
      const normalizedValue = this.normalizeSignal(key, value);
      score += weight * normalizedValue;
    }

    return score;
  }

  private normalizeSignal(key: string, value: number | boolean): number {
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }

    // Different normalization for different signals
    switch (key) {
      case 'transitiveDistance':
        // Inverse - closer is better
        return Math.max(0, 1 - value / 10);
      case 'recency':
        // Decay function
        return Math.exp(-value / (7 * 24 * 60 * 60 * 1000)); // 7-day half-life
      default:
        return Math.min(1, Math.max(0, value));
    }
  }

  // Learn weights from feedback
  recordFeedback(signals: RelevanceSignals, wasRelevant: boolean): void {
    this.feedbackHistory.push({ signals, wasRelevant });

    // Trigger weight update if enough feedback
    if (this.feedbackHistory.length % 100 === 0) {
      this.updateWeights();
    }
  }

  private updateWeights(): void {
    if (this.feedbackHistory.length < 50) {
      return; // Not enough data
    }

    // Simple gradient descent on weights
    const learningRate = 0.01;
    const newWeights = { ...this.baseWeights };

    for (const feedback of this.feedbackHistory.slice(-500)) {
      const predicted = this.computeScoreWithWeights(feedback.signals, newWeights);
      const actual = feedback.wasRelevant ? 1 : 0;
      const error = actual - predicted;

      // Update each weight
      for (const key of Object.keys(newWeights) as Array<keyof SignalWeights>) {
        const signalValue = this.normalizeSignal(key, feedback.signals[key]);
        newWeights[key] += learningRate * error * signalValue;
        // Keep weights positive
        newWeights[key] = Math.max(0.01, newWeights[key]);
      }
    }

    // Normalize weights to sum to 1
    const sum = Object.values(newWeights).reduce((a, b) => a + b, 0);
    for (const key of Object.keys(newWeights) as Array<keyof SignalWeights>) {
      newWeights[key] /= sum;
    }

    this.learnedWeights = newWeights;
  }

  private computeScoreWithWeights(signals: RelevanceSignals, weights: SignalWeights): number {
    let score = 0;
    for (const [key, value] of Object.entries(signals)) {
      const weight = weights[key as keyof SignalWeights];
      const normalizedValue = this.normalizeSignal(key, value);
      score += weight * normalizedValue;
    }
    return score;
  }

  getLearnedWeights(): SignalWeights | null {
    return this.learnedWeights ?? null;
  }
}

export const multiSignalScorer = new MultiSignalScorer();
```

#### Hierarchical Knowledge Confidence

**Problem**: Flat confidence scores don't capture uncertainty propagation.

**Solution**: Hierarchical confidence with uncertainty composition:

```typescript
// src/LiBrainian/knowledge/confidence_hierarchy.ts

interface ConfidenceComponents {
  source: ConfidenceSource;
  value: number;        // 0-1
  uncertainty: number;  // Standard deviation
  freshness: number;    // 0-1, how recent
  coverage: number;     // 0-1, how complete
}

type ConfidenceSource =
  | 'ast'           // Parsed from code - high confidence
  | 'git'           // From git history - high confidence
  | 'embedding'     // Semantic inference - medium confidence
  | 'llm_single'    // Single LLM extraction - medium confidence
  | 'llm_consensus' // Multiple LLM agreement - higher confidence
  | 'user'          // User provided - high confidence
  | 'inferred'      // Rule-based inference - varies
  | 'aggregated';   // Composed from children

const SOURCE_BASE_CONFIDENCE: Record<ConfidenceSource, number> = {
  ast: 0.95,
  git: 0.90,
  user: 0.85,
  llm_consensus: 0.80,
  llm_single: 0.65,
  embedding: 0.60,
  inferred: 0.50,
  aggregated: 0.70,
};

class ConfidenceCalculator {
  // Compose confidence from multiple sources
  compose(components: ConfidenceComponents[]): ConfidenceComponents {
    if (components.length === 0) {
      return {
        source: 'inferred',
        value: 0,
        uncertainty: 1,
        freshness: 0,
        coverage: 0,
      };
    }

    if (components.length === 1) {
      return components[0];
    }

    // Weight by source reliability and freshness
    let weightedSum = 0;
    let weightSum = 0;
    let uncertainties: number[] = [];

    for (const c of components) {
      const weight = SOURCE_BASE_CONFIDENCE[c.source] * c.freshness;
      weightedSum += c.value * weight;
      weightSum += weight;
      uncertainties.push(c.uncertainty);
    }

    // Composed uncertainty (assuming independence)
    const composedUncertainty = Math.sqrt(
      uncertainties.reduce((sum, u) => sum + u * u, 0) / uncertainties.length
    );

    // If sources disagree significantly, increase uncertainty
    const values = components.map(c => c.value);
    const disagreement = this.computeDisagreement(values);
    const adjustedUncertainty = Math.min(1, composedUncertainty + disagreement);

    return {
      source: 'aggregated',
      value: weightSum > 0 ? weightedSum / weightSum : 0,
      uncertainty: adjustedUncertainty,
      freshness: Math.max(...components.map(c => c.freshness)),
      coverage: this.computeCoverage(components),
    };
  }

  // Propagate confidence up the hierarchy
  propagateToParent(
    childConfidences: ConfidenceComponents[],
    aggregationType: 'all' | 'any' | 'majority'
  ): ConfidenceComponents {
    switch (aggregationType) {
      case 'all':
        // Parent confidence is min of children
        return {
          source: 'aggregated',
          value: Math.min(...childConfidences.map(c => c.value)),
          uncertainty: Math.max(...childConfidences.map(c => c.uncertainty)),
          freshness: Math.min(...childConfidences.map(c => c.freshness)),
          coverage: childConfidences.reduce((sum, c) => sum + c.coverage, 0) / childConfidences.length,
        };

      case 'any':
        // Parent confidence is max of children
        return {
          source: 'aggregated',
          value: Math.max(...childConfidences.map(c => c.value)),
          uncertainty: Math.min(...childConfidences.map(c => c.uncertainty)),
          freshness: Math.max(...childConfidences.map(c => c.freshness)),
          coverage: Math.max(...childConfidences.map(c => c.coverage)),
        };

      case 'majority':
        // Parent confidence is median-weighted
        return this.compose(childConfidences);
    }
  }

  // Decay confidence over time
  applyDecay(
    confidence: ConfidenceComponents,
    ageMs: number,
    halfLifeMs: number
  ): ConfidenceComponents {
    const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);

    return {
      ...confidence,
      freshness: confidence.freshness * decayFactor,
      // Uncertainty increases as data gets stale
      uncertainty: Math.min(1, confidence.uncertainty + (1 - decayFactor) * 0.2),
    };
  }

  private computeDisagreement(values: number[]): number {
    if (values.length < 2) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private computeCoverage(components: ConfidenceComponents[]): number {
    // Average coverage, weighted by confidence
    const weighted = components.reduce(
      (sum, c) => sum + c.coverage * c.value,
      0
    );
    const weights = components.reduce((sum, c) => sum + c.value, 0);
    return weights > 0 ? weighted / weights : 0;
  }
}

export const confidenceCalculator = new ConfidenceCalculator();
```

### 22.5 Configuration Files

The system reads configuration from these files, making everything adaptable without code changes:

```yaml
# .LiBrainian/config.yaml - Main configuration
version: 1

# Override domain settings
domains:
  semantics:
    staleness: 7200000  # 2 hours instead of 1
    priority: high

  # Add custom domain
  compliance:
    name: "Compliance"
    description: "Regulatory compliance tracking"
    extractors: [compliance_extractor]
    staleness: 86400000  # 1 day
    priority: medium

# Override entity types
entityTypes:
  - id: microservice
    name: "Microservice"
    patterns:
      - type: directory
        pattern: "services/*"

# Embedding model preferences
embeddings:
  preferredModel: all-MiniLM-L12-v2
  enableABTesting: true
  models:
    all-MiniLM-L6-v2:
      enabled: true
    all-MiniLM-L12-v2:
      enabled: true

# Provider preferences
providers:
  preferenceOrder: [claude, codex]
  claude:
    enabled: true
    rateLimitPerSecond: 10
  codex:
    enabled: true
    rateLimitPerSecond: 5

# Query intent customization
intents:
  - id: find_compliance_issues
    name: "Find Compliance Issues"
    description: "Locate code that may have compliance concerns"
    examples:
      - "find PCI violations"
      - "show GDPR issues"
    domains: [compliance, security]
```

---

## 23. Bootstrap Integration Testing

### 23.1 Test Philosophy

Bootstrap tests validate the LiBrainian against REAL codebases, not mocks. They verify:

1. **Indexing Correctness** - Does it find all functions, classes, imports?
2. **Knowledge Quality** - Is extracted knowledge accurate and useful?
3. **Query Accuracy** - Do queries return relevant results?
4. **Performance** - Can it index codebases of various sizes in reasonable time?
5. **Resilience** - Does it handle edge cases gracefully?

### 23.2 Test Tiers

| Tier | Scope | Target | Duration |
|------|-------|--------|----------|
| **Tier 0** | Fixtures only | 10-50 files | < 5 seconds |
| **Tier 1** | LiBrainian self-index | ~100 files | < 30 seconds |
| **Tier 2** | Wave0 partial | ~500 files | < 2 minutes |
| **Tier 3** | Wave0 full | ~1500 files | < 10 minutes |

### 23.3 Bootstrap Test Implementation

```typescript
// src/LiBrainian/__tests__/bootstrap_integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { LiBrainian } from '../api/LiBrainian.js';
import { createSQLiteStorage } from '../storage/sqlite_storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const LIBRARIAN_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// TIER 1: LiBrainian SELF-INDEX (src/LiBrainian only)
// ============================================================================

describe('Bootstrap: LiBrainian Self-Index', () => {
  let LiBrainian: LiBrainian;
  let dbPath: string;
  let indexStats: IndexStats;

  beforeAll(async () => {
    console.log('\n' + '='.repeat(70));
    console.log('BOOTSTRAP TEST: LiBrainian SELF-INDEX');
    console.log('='.repeat(70) + '\n');

    // Create isolated test database
    dbPath = path.join(REPO_ROOT, '.LiBrainian-test', `bootstrap-${Date.now()}.db`);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = await createSQLiteStorage(dbPath);
    LiBrainian = new LiBrainian({ storage, repoRoot: LIBRARIAN_ROOT });

    // Run indexing
    console.log('Indexing src/LiBrainian...');
    const startTime = Date.now();
    indexStats = await LiBrainian.bootstrap({
      paths: [LIBRARIAN_ROOT],
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
    });
    console.log(`Indexing completed in ${Date.now() - startTime}ms\n`);
  }, 60000);

  afterAll(async () => {
    await LiBrainian?.close();
    // Cleanup test database
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('Indexing Completeness', () => {
    it('should index a reasonable number of files', () => {
      console.log(`Files indexed: ${indexStats.filesIndexed}`);
      // LiBrainian has ~50-100 TypeScript files
      expect(indexStats.filesIndexed).toBeGreaterThan(30);
      expect(indexStats.filesIndexed).toBeLessThan(200);
    });

    it('should extract functions from indexed files', () => {
      console.log(`Functions extracted: ${indexStats.functionsExtracted}`);
      // Should find many functions
      expect(indexStats.functionsExtracted).toBeGreaterThan(100);
    });

    it('should extract classes from indexed files', () => {
      console.log(`Classes extracted: ${indexStats.classesExtracted}`);
      // Should find some classes
      expect(indexStats.classesExtracted).toBeGreaterThan(10);
    });

    it('should build import graph', () => {
      console.log(`Import edges: ${indexStats.importEdges}`);
      // Should have many import relationships
      expect(indexStats.importEdges).toBeGreaterThan(50);
    });

    it('should generate embeddings', () => {
      console.log(`Embeddings generated: ${indexStats.embeddingsGenerated}`);
      // Should generate embeddings for most entities
      expect(indexStats.embeddingsGenerated).toBeGreaterThan(100);
    });
  });

  describe('Query Accuracy', () => {
    it('should find SQLite storage when querying for database', async () => {
      const results = await LiBrainian.query({
        intent: 'find_similar_to',
        target: { type: 'concept', identifier: 'database storage sqlite' },
        preferences: { maxResults: 5 },
      });

      console.log('\nQuery: "database storage sqlite"');
      console.log('Top results:');
      for (const r of results.sources.slice(0, 3)) {
        console.log(`  - ${r.location} (${r.relevance.toFixed(3)})`);
      }

      // Should find sqlite_storage.ts
      const hasSqlite = results.sources.some(s =>
        s.location.includes('sqlite') || s.location.includes('storage')
      );
      expect(hasSqlite).toBe(true);
    });

    it('should find embedding code when querying for vectors', async () => {
      const results = await LiBrainian.query({
        intent: 'find_similar_to',
        target: { type: 'concept', identifier: 'embedding vectors similarity' },
        preferences: { maxResults: 5 },
      });

      console.log('\nQuery: "embedding vectors similarity"');
      console.log('Top results:');
      for (const r of results.sources.slice(0, 3)) {
        console.log(`  - ${r.location} (${r.relevance.toFixed(3)})`);
      }

      // Should find embedding-related files
      const hasEmbedding = results.sources.some(s =>
        s.location.includes('embed') || s.location.includes('vector')
      );
      expect(hasEmbedding).toBe(true);
    });

    it('should find query processing code', async () => {
      const results = await LiBrainian.query({
        intent: 'what_does_this_do',
        target: { type: 'file', identifier: 'query.ts' },
      });

      expect(results.answer.summary).toBeTruthy();
      expect(results.answer.summary.length).toBeGreaterThan(20);
      console.log('\nQuery: "what does query.ts do?"');
      console.log(`Answer: ${results.answer.summary.slice(0, 200)}...`);
    });
  });

  describe('Knowledge Extraction', () => {
    it('should extract knowledge for key files', async () => {
      const knowledge = await LiBrainian.getKnowledge('file:src/LiBrainian/api/LiBrainian.ts');

      expect(knowledge).toBeDefined();
      expect(knowledge?.identity).toBeDefined();
      expect(knowledge?.identity.path).toContain('LiBrainian.ts');

      console.log('\nKnowledge for LiBrainian.ts:');
      console.log(`  Type: ${knowledge?.identity.type}`);
      console.log(`  Language: ${knowledge?.identity.language}`);
      console.log(`  Exports: ${knowledge?.structure.exports?.length ?? 0}`);
    });

    it('should compute relationships', async () => {
      const relationships = await LiBrainian.getRelationships('file:src/LiBrainian/api/LiBrainian.ts');

      expect(relationships.dependencies.length).toBeGreaterThan(0);
      console.log('\nRelationships for LiBrainian.ts:');
      console.log(`  Dependencies: ${relationships.dependencies.length}`);
      console.log(`  Dependents: ${relationships.dependents.length}`);
    });
  });
});

// ============================================================================
// TIER 2: WAVE0 PARTIAL INDEX (src/orchestrator + src/LiBrainian)
// ============================================================================

describe('Bootstrap: Wave0 Partial Index', () => {
  let LiBrainian: LiBrainian;
  let dbPath: string;
  let indexStats: IndexStats;

  const ORCHESTRATOR_ROOT = path.resolve(REPO_ROOT, 'src/orchestrator');

  beforeAll(async () => {
    console.log('\n' + '='.repeat(70));
    console.log('BOOTSTRAP TEST: WAVE0 PARTIAL (orchestrator + LiBrainian)');
    console.log('='.repeat(70) + '\n');

    dbPath = path.join(REPO_ROOT, '.LiBrainian-test', `bootstrap-partial-${Date.now()}.db`);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = await createSQLiteStorage(dbPath);
    LiBrainian = new LiBrainian({ storage, repoRoot: REPO_ROOT });

    console.log('Indexing src/orchestrator + src/LiBrainian...');
    const startTime = Date.now();
    indexStats = await LiBrainian.bootstrap({
      paths: [LIBRARIAN_ROOT, ORCHESTRATOR_ROOT],
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
    });
    console.log(`Indexing completed in ${Date.now() - startTime}ms\n`);
  }, 120000);

  afterAll(async () => {
    await LiBrainian?.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('Cross-Module Queries', () => {
    it('should find connections between orchestrator and LiBrainian', async () => {
      const results = await LiBrainian.query({
        intent: 'find_usages_of',
        target: { type: 'module', identifier: 'LiBrainian' },
        context: { scope: 'src/orchestrator' },
      });

      console.log('\nQuery: "find usages of LiBrainian in orchestrator"');
      console.log(`Found ${results.sources.length} usages`);

      // Orchestrator should use LiBrainian
      expect(results.sources.length).toBeGreaterThan(0);
    });

    it('should understand orchestrator-LiBrainian data flow', async () => {
      const results = await LiBrainian.query({
        intent: 'trace_data_flow',
        target: { type: 'concept', identifier: 'context assembly from LiBrainian to orchestrator' },
      });

      expect(results.answer.summary).toBeTruthy();
      console.log('\nQuery: "trace context assembly data flow"');
      console.log(`Answer: ${results.answer.summary.slice(0, 300)}...`);
    });
  });

  describe('Entity Discovery', () => {
    it('should discover subsystems', async () => {
      const subsystems = await LiBrainian.getDiscoveredEntities('subsystem');

      console.log('\nDiscovered subsystems:');
      for (const s of subsystems.slice(0, 5)) {
        console.log(`  - ${s.name}: ${s.files.length} files`);
      }

      // Should discover some subsystems
      expect(subsystems.length).toBeGreaterThan(0);
    });

    it('should discover components from naming patterns', async () => {
      const components = await LiBrainian.getDiscoveredEntities('component');

      console.log('\nDiscovered components:');
      for (const c of components.slice(0, 5)) {
        console.log(`  - ${c.name} (confidence: ${c.confidence.toFixed(2)})`);
      }
    });
  });

  describe('Co-Change Analysis', () => {
    it('should identify frequently co-changed file pairs', async () => {
      const coChangePairs = await LiBrainian.getCoChangePairs({ minCount: 3, limit: 10 });

      console.log('\nFrequently co-changed pairs:');
      for (const pair of coChangePairs.slice(0, 5)) {
        console.log(`  ${pair.fileA} <-> ${pair.fileB}: ${pair.count} commits`);
      }

      // Should find some co-change relationships
      expect(coChangePairs.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// TIER 3: WAVE0 FULL INDEX (entire src/)
// ============================================================================

describe.skip('Bootstrap: Wave0 Full Index', () => {
  // Skip by default - run with --run flag for full test
  let LiBrainian: LiBrainian;
  let dbPath: string;
  let indexStats: IndexStats;

  const SRC_ROOT = path.resolve(REPO_ROOT, 'src');

  beforeAll(async () => {
    console.log('\n' + '='.repeat(70));
    console.log('BOOTSTRAP TEST: WAVE0 FULL (entire src/)');
    console.log('='.repeat(70) + '\n');

    dbPath = path.join(REPO_ROOT, '.LiBrainian-test', `bootstrap-full-${Date.now()}.db`);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = await createSQLiteStorage(dbPath);
    LiBrainian = new LiBrainian({ storage, repoRoot: REPO_ROOT });

    console.log('Indexing entire src/...');
    const startTime = Date.now();
    indexStats = await LiBrainian.bootstrap({
      paths: [SRC_ROOT],
      includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
      excludePatterns: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
    });
    console.log(`Indexing completed in ${Date.now() - startTime}ms\n`);

    console.log('Index Stats:');
    console.log(`  Files: ${indexStats.filesIndexed}`);
    console.log(`  Functions: ${indexStats.functionsExtracted}`);
    console.log(`  Classes: ${indexStats.classesExtracted}`);
    console.log(`  Imports: ${indexStats.importEdges}`);
    console.log(`  Embeddings: ${indexStats.embeddingsGenerated}`);
  }, 600000); // 10 minute timeout

  afterAll(async () => {
    await LiBrainian?.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('Full Codebase Analysis', () => {
    it('should index all major modules', async () => {
      const modules = await LiBrainian.getModules();

      console.log('\nIndexed modules:');
      for (const m of modules) {
        console.log(`  - ${m.name}: ${m.fileCount} files`);
      }

      // Should find major modules
      const moduleNames = modules.map(m => m.name);
      expect(moduleNames).toContain('orchestrator');
      expect(moduleNames).toContain('LiBrainian');
      expect(moduleNames).toContain('soma');
    });

    it('should build complete dependency graph', async () => {
      const graph = await LiBrainian.getDependencyGraph();

      console.log(`\nDependency graph: ${graph.nodes} nodes, ${graph.edges} edges`);

      expect(graph.nodes).toBeGreaterThan(100);
      expect(graph.edges).toBeGreaterThan(200);
    });

    it('should identify architectural layers', async () => {
      const layers = await LiBrainian.getDiscoveredEntities('layer');

      console.log('\nDiscovered architectural layers:');
      for (const l of layers) {
        console.log(`  - ${l.name}: ${l.files.length} files`);
      }
    });
  });

  describe('Performance Benchmarks', () => {
    it('should answer queries within 500ms', async () => {
      const queries = [
        { intent: 'find_similar_to', target: { type: 'concept', identifier: 'error handling' } },
        { intent: 'what_does_this_do', target: { type: 'file', identifier: 'orchestrator.ts' } },
        { intent: 'find_dependencies_of', target: { type: 'module', identifier: 'LiBrainian' } },
      ];

      for (const query of queries) {
        const start = performance.now();
        await LiBrainian.query(query);
        const duration = performance.now() - start;

        console.log(`Query "${query.intent}": ${duration.toFixed(0)}ms`);
        expect(duration).toBeLessThan(500);
      }
    });
  });
});

// ============================================================================
// HELPERS
// ============================================================================

interface IndexStats {
  filesIndexed: number;
  functionsExtracted: number;
  classesExtracted: number;
  importEdges: number;
  embeddingsGenerated: number;
  duration: number;
}
```

### 23.4 Specific Validation Tests

```typescript
// src/LiBrainian/__tests__/bootstrap_validation.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LiBrainian } from '../api/LiBrainian.js';
import { createSQLiteStorage } from '../storage/sqlite_storage.js';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('Bootstrap Validation: Known Facts', () => {
  let LiBrainian: LiBrainian;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = path.join(REPO_ROOT, '.LiBrainian-test', `validation-${Date.now()}.db`);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = await createSQLiteStorage(dbPath);
    LiBrainian = new LiBrainian({ storage, repoRoot: REPO_ROOT });

    await LiBrainian.bootstrap({
      paths: [path.join(REPO_ROOT, 'src/LiBrainian')],
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts', '**/__tests__/**'],
    });
  }, 60000);

  afterAll(async () => {
    await LiBrainian?.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('Known Function Extraction', () => {
    it('should find createSQLiteStorage function', async () => {
      const fn = await LiBrainian.getEntity('function:createSQLiteStorage');
      expect(fn).toBeDefined();
      expect(fn?.identity.name).toBe('createSQLiteStorage');
    });

    it('should find rerank function from cross_encoder_reranker', async () => {
      const fn = await LiBrainian.getEntity('function:rerank');
      expect(fn).toBeDefined();
    });

    it('should find extractCommitHistory function from co_change_signals', async () => {
      const fn = await LiBrainian.getEntity('function:extractCommitHistory');
      expect(fn).toBeDefined();
    });
  });

  describe('Known Class Extraction', () => {
    it('should find SQLiteStorage class', async () => {
      const cls = await LiBrainian.getEntity('class:SQLiteStorage');
      expect(cls).toBeDefined();
    });
  });

  describe('Known Import Relationships', () => {
    it('should know that LiBrainian.ts imports sqlite_storage', async () => {
      const deps = await LiBrainian.getDependencies('file:src/LiBrainian/api/LiBrainian.ts');
      const importsSqlite = deps.some(d => d.includes('sqlite') || d.includes('storage'));
      expect(importsSqlite).toBe(true);
    });

    it('should know that embeddings.ts imports transformers', async () => {
      const deps = await LiBrainian.getDependencies('file:src/LiBrainian/api/embeddings.ts');
      // May import from embedding_providers
      expect(deps.length).toBeGreaterThan(0);
    });
  });

  describe('Known File Existence', () => {
    const knownFiles = [
      'src/LiBrainian/api/LiBrainian.ts',
      'src/LiBrainian/api/embeddings.ts',
      'src/LiBrainian/api/query.ts',
      'src/LiBrainian/storage/sqlite_storage.ts',
      'src/LiBrainian/types.ts',
    ];

    for (const file of knownFiles) {
      it(`should have indexed ${file}`, async () => {
        const entity = await LiBrainian.getEntity(`file:${file}`);
        expect(entity).toBeDefined();
      });
    }
  });
});

describe('Bootstrap Validation: Semantic Accuracy', () => {
  let LiBrainian: LiBrainian;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = path.join(REPO_ROOT, '.LiBrainian-test', `semantic-${Date.now()}.db`);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = await createSQLiteStorage(dbPath);
    LiBrainian = new LiBrainian({ storage, repoRoot: REPO_ROOT });

    await LiBrainian.bootstrap({
      paths: [path.join(REPO_ROOT, 'src/LiBrainian')],
      includePatterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts', '**/__tests__/**'],
    });
  }, 60000);

  afterAll(async () => {
    await LiBrainian?.close();
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('Embedding-Based Retrieval', () => {
    it('should rank sqlite_storage high for "database persistence" query', async () => {
      const results = await LiBrainian.query({
        intent: 'find_similar_to',
        target: { type: 'concept', identifier: 'database persistence storage' },
        preferences: { maxResults: 10 },
      });

      const top5Paths = results.sources.slice(0, 5).map(s => s.location);
      const hasSqlite = top5Paths.some(p => p.includes('sqlite') || p.includes('storage'));
      expect(hasSqlite).toBe(true);
    });

    it('should rank cross_encoder_reranker high for "reranking relevance" query', async () => {
      const results = await LiBrainian.query({
        intent: 'find_similar_to',
        target: { type: 'concept', identifier: 'reranking relevance scoring cross encoder' },
        preferences: { maxResults: 10 },
      });

      const top5Paths = results.sources.slice(0, 5).map(s => s.location);
      const hasReranker = top5Paths.some(p => p.includes('rerank') || p.includes('cross'));
      expect(hasReranker).toBe(true);
    });

    it('should rank co_change_signals high for "git history commit" query', async () => {
      const results = await LiBrainian.query({
        intent: 'find_similar_to',
        target: { type: 'concept', identifier: 'git history commit co-change' },
        preferences: { maxResults: 10 },
      });

      const top5Paths = results.sources.slice(0, 5).map(s => s.location);
      const hasCoChange = top5Paths.some(p => p.includes('co_change') || p.includes('commit'));
      expect(hasCoChange).toBe(true);
    });
  });

  describe('Cross-Encoder Re-Ranking', () => {
    it('should improve ordering for ambiguous queries', async () => {
      // Query that could match many files
      const results = await LiBrainian.query({
        intent: 'find_similar_to',
        target: { type: 'concept', identifier: 'type definitions interfaces' },
        preferences: { maxResults: 10, useReranking: true },
      });

      // types.ts should be in top results after re-ranking
      const top3Paths = results.sources.slice(0, 3).map(s => s.location);
      const hasTypes = top3Paths.some(p => p.includes('types'));
      expect(hasTypes).toBe(true);
    });
  });
});
```

### 23.5 Performance Benchmarks

```typescript
// src/LiBrainian/__tests__/bootstrap_benchmarks.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { LiBrainian } from '../api/LiBrainian.js';
import { createSQLiteStorage } from '../storage/sqlite_storage.js';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('Bootstrap Benchmarks', () => {
  const benchmarks: Record<string, number[]> = {};

  afterAll(() => {
    console.log('\n' + '='.repeat(70));
    console.log('BENCHMARK RESULTS');
    console.log('='.repeat(70));

    for (const [name, times] of Object.entries(benchmarks)) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);
      console.log(`${name}:`);
      console.log(`  avg: ${avg.toFixed(0)}ms, min: ${min.toFixed(0)}ms, max: ${max.toFixed(0)}ms`);
    }
  });

  describe('Indexing Speed', () => {
    it('should index 10 files in < 2s', async () => {
      const times: number[] = [];

      for (let i = 0; i < 3; i++) {
        const dbPath = path.join(REPO_ROOT, '.LiBrainian-test', `bench-10-${Date.now()}.db`);
        await fs.mkdir(path.dirname(dbPath), { recursive: true });

        const storage = await createSQLiteStorage(dbPath);
        const LiBrainian = new LiBrainian({ storage, repoRoot: REPO_ROOT });

        const start = performance.now();
        await LiBrainian.bootstrap({
          paths: [path.join(REPO_ROOT, 'src/LiBrainian/api')],
          includePatterns: ['*.ts'],
          excludePatterns: ['**/*.test.ts'],
          maxFiles: 10,
        });
        times.push(performance.now() - start);

        await LiBrainian.close();
        await fs.rm(dbPath, { force: true });
      }

      benchmarks['index_10_files'] = times;
      expect(Math.max(...times)).toBeLessThan(2000);
    }, 30000);

    it('should index 50 files in < 10s', async () => {
      const times: number[] = [];

      for (let i = 0; i < 2; i++) {
        const dbPath = path.join(REPO_ROOT, '.LiBrainian-test', `bench-50-${Date.now()}.db`);
        await fs.mkdir(path.dirname(dbPath), { recursive: true });

        const storage = await createSQLiteStorage(dbPath);
        const LiBrainian = new LiBrainian({ storage, repoRoot: REPO_ROOT });

        const start = performance.now();
        await LiBrainian.bootstrap({
          paths: [path.join(REPO_ROOT, 'src/LiBrainian')],
          includePatterns: ['**/*.ts'],
          excludePatterns: ['**/*.test.ts', '**/__tests__/**'],
          maxFiles: 50,
        });
        times.push(performance.now() - start);

        await LiBrainian.close();
        await fs.rm(dbPath, { force: true });
      }

      benchmarks['index_50_files'] = times;
      expect(Math.max(...times)).toBeLessThan(10000);
    }, 60000);
  });

  describe('Query Speed', () => {
    let LiBrainian: LiBrainian;
    let dbPath: string;

    beforeAll(async () => {
      dbPath = path.join(REPO_ROOT, '.LiBrainian-test', `query-bench-${Date.now()}.db`);
      await fs.mkdir(path.dirname(dbPath), { recursive: true });

      const storage = await createSQLiteStorage(dbPath);
      LiBrainian = new LiBrainian({ storage, repoRoot: REPO_ROOT });

      await LiBrainian.bootstrap({
        paths: [path.join(REPO_ROOT, 'src/LiBrainian')],
        includePatterns: ['**/*.ts'],
        excludePatterns: ['**/*.test.ts', '**/__tests__/**'],
      });
    }, 60000);

    afterAll(async () => {
      await LiBrainian?.close();
      await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
    });

    it('should execute semantic search in < 100ms', async () => {
      const times: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await LiBrainian.query({
          intent: 'find_similar_to',
          target: { type: 'concept', identifier: 'database storage' },
          preferences: { maxResults: 10 },
        });
        times.push(performance.now() - start);
      }

      benchmarks['semantic_search'] = times;
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avg).toBeLessThan(100);
    });

    it('should execute dependency lookup in < 50ms', async () => {
      const times: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await LiBrainian.getDependencies('file:src/LiBrainian/api/LiBrainian.ts');
        times.push(performance.now() - start);
      }

      benchmarks['dependency_lookup'] = times;
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avg).toBeLessThan(50);
    });

    it('should execute knowledge retrieval in < 50ms', async () => {
      const times: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await LiBrainian.getKnowledge('file:src/LiBrainian/api/LiBrainian.ts');
        times.push(performance.now() - start);
      }

      benchmarks['knowledge_retrieval'] = times;
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avg).toBeLessThan(50);
    });
  });
});
```

### 23.6 Test Matrix

| Test | Validates | Expected Outcome |
|------|-----------|------------------|
| `bootstrap_integration.test.ts` | Full indexing pipeline | Files, functions, classes indexed |
| `bootstrap_validation.test.ts` | Known facts about codebase | Specific entities found correctly |
| `bootstrap_benchmarks.test.ts` | Performance requirements | Operations within time budgets |

### 23.7 Running Bootstrap Tests

```bash
# Run Tier 1 (LiBrainian self-index) - fast
npm run test:LiBrainian:bootstrap

# Run Tier 2 (Wave0 partial) - medium
npm run test:LiBrainian:bootstrap:partial

# Run Tier 3 (Wave0 full) - slow
npm run test:LiBrainian:bootstrap:full

# Run with detailed output
npm run test:LiBrainian:bootstrap -- --reporter=verbose
```

---

## Summary

This plan transforms the LiBrainian into a world-class knowledge system by:

1. **Comprehensive Knowledge** - 12+ extensible domains, 150+ attributes, emergent entity discovery
2. **Resilient Architecture** - Result types, error hierarchy, circuit breakers, health checks
3. **Simple Failover** - Claude ↔ Codex automatic switching, full capabilities either way
4. **Clean Codebase** - Split monoliths, extract abstractions, remove dead code
5. **Integration Safety** - Contracts, schema versioning, event bus, transaction coordinator
6. **Agent Optimization** - Decision support, proactive guidance, confidence calibration
7. **Implicit Configuration** - Domains, entities, and freshness tolerances are discovered/inferred, not hard-coded
8. **Modular Architecture** - Embedding models, query intents, and extractors use registry patterns for extensibility
9. **Adaptive Systems** - Provider config, resource limits, and relevance weights self-tune from observed behavior
10. **Sophisticated Scoring** - Multi-signal relevance with learned weights, hierarchical confidence propagation

**Design Philosophy**: Anything that CAN be inferred SHOULD be inferred. Anything that CAN adapt SHOULD adapt. Anything that CAN be extended SHOULD be extensible.

The implementation is phased over 6 weeks with clear deliverables and testable milestones.
