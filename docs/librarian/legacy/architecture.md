# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian Unified Architecture

> **FOR AGENTS**: This is the architectural foundation. Read this BEFORE implementing any subsystem.
> **Navigation**: [README.md](./README.md) | [scenarios.md](./scenarios.md) | [implementation-requirements.md](./implementation-requirements.md)

**Created**: 2025-12-30

---

> **IMPORTANT: ASPIRATIONAL vs. IMPLEMENTED**
>
> This document describes the **TARGET** unified architecture. Some sections are **aspirational**
> (showing planned design) while others reflect **current implementation**.
>
> **Current Implementation Locations** (actual files):
> - Types/Entities: `src/LiBrainian/types.ts` (not `src/LiBrainian/core/entity.ts`)
> - Events: `src/LiBrainian/events.ts` (not `src/LiBrainian/core/event.ts`)
> - Engines: `src/LiBrainian/engines/*_engine.ts` (relevance_engine.ts, constraint_engine.ts, meta_engine.ts)
> - Storage: `src/LiBrainian/storage/sqlite_storage.ts` (1,894 lines)
> - Knowledge: `src/LiBrainian/knowledge/` (architecture.ts, impact.ts, patterns.ts, etc.)
> - Integration: `src/LiBrainian/integration/wave0_integration.ts`
>
> **NOT YET IMPLEMENTED** (referenced as `src/LiBrainian/core/*` below):
> - Event Bus, Query Pipeline, Coordinator - design specs only
> - Subsystems in `src/LiBrainian/subsystems/*` - design specs only
>
> See the Implementation Checklist (Part 5) for status of each component.

---

## The Problem with Independent Subsystems

The [scenarios.md](./scenarios.md) document identified 6 subsystems needed to solve real-world problems:

1. Universal Adapter (language support)
2. Freshness Engine (staleness detection)
3. Learning Engine (outcome tracking)
4. Scale Engine (performance)
5. Coordination Engine (multi-agent)
6. Pattern Inference (consistency)

**But designing them independently creates problems:**

| Problem | Example | Consequence |
|---------|---------|-------------|
| Duplicated concepts | "Confidence" computed 3 different ways | Inconsistent signals |
| No shared event flow | Freshness doesn't know about Learning | Missed optimization opportunities |
| Ad-hoc integration | Each subsystem wires into storage differently | Brittle, hard to test |
| State fragmentation | Each subsystem tracks its own state | Race conditions, inconsistency |
| No composability | Can't combine subsystem capabilities | Monolithic, inflexible |

---

## The Solution: Unified Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LiBrainian UNIFIED ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         UNIFIED API LAYER                               │ │
│  │                                                                         │ │
│  │   LibrarianAgent.ask(question)    LibrarianAgent.trigger(action)       │ │
│  │                                                                         │ │
│  │   Single entry point. Routes to appropriate engine/subsystem.          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          QUERY PIPELINE                                 │ │
│  │                                                                         │ │
│  │   normalize → freshness → locks → execute → patterns → confidence      │ │
│  │                                                                         │ │
│  │   Every query flows through this pipeline. No shortcuts.               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                           ENGINE LAYER                                  │ │
│  │                                                                         │ │
│  │   ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐   │ │
│  │   │  RELEVANCE   │  │  CONSTRAINT  │  │      META-KNOWLEDGE        │   │ │
│  │   │   ENGINE     │  │    ENGINE    │  │         ENGINE             │   │ │
│  │   │              │  │              │  │                            │   │ │
│  │   │ "What do I   │  │ "What rules  │  │ "How confident should     │   │ │
│  │   │  need to     │  │  apply?"     │  │  I be?"                   │   │ │
│  │   │  know?"      │  │              │  │                            │   │ │
│  │   └──────────────┘  └──────────────┘  └────────────────────────────┘   │ │
│  │                                                                         │ │
│  │   Engines COMPOSE subsystem capabilities. They don't duplicate them.   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         SUBSYSTEM LAYER                                 │ │
│  │                                                                         │ │
│  │   ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────┐  │ │
│  │   │ FRESH-   │ │ LEARNING │ │  SCALE  │ │ COORD-  │ │    PATTERN    │  │ │
│  │   │  NESS    │ │          │ │         │ │ INATION │ │   INFERENCE   │  │ │
│  │   └──────────┘ └──────────┘ └─────────┘ └─────────┘ └───────────────┘  │ │
│  │        │            │            │           │              │          │ │
│  │        └────────────┴────────────┴───────────┴──────────────┘          │ │
│  │                                  │                                      │ │
│  │                          ┌───────▼───────┐                              │ │
│  │                          │   EVENT BUS   │  ← All subsystems            │ │
│  │                          │               │    publish & subscribe       │ │
│  │                          └───────────────┘                              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        SHARED PRIMITIVES                                │ │
│  │                                                                         │ │
│  │   Entity │ Scope │ Confidence │ Event │ Query │ Result                 │ │
│  │                                                                         │ │
│  │   Every subsystem uses these. No custom representations.               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         KNOWLEDGE LAYER                                 │ │
│  │                                                                         │ │
│  │   Architecture │ Impact │ ModuleGraph │ Quality │ Ownership            │ │
│  │                                                                         │ │
│  │   Domain-specific analysis. Built on shared primitives.                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          STORAGE LAYER                                  │ │
│  │                                                                         │ │
│  │   SQLite │ Write-Ahead Log │ Caching │ Transactions                    │ │
│  │                                                                         │ │
│  │   Single storage interface. All writes go through here.                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          ADAPTER LAYER                                  │ │
│  │                                                                         │ │
│  │   TypeScript │ Go │ Python │ Rust │ Java │ Generic                     │ │
│  │                                                                         │ │
│  │   Language-specific extraction. Common interface.                      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Shared Primitives

**Every subsystem MUST use these primitives. No custom representations.**

### 1.1 Entity

Everything LiBrainian tracks is an Entity.

```typescript
// src/LiBrainian/core/entity.ts

type EntityType =
  | 'module'        // A file/module
  | 'function'      // A function/method
  | 'class'         // A class/type
  | 'test'          // A test file/case
  | 'constraint'    // An architectural rule
  | 'pattern'       // A detected code pattern
  | 'context_pack'  // A bundled context for a task
  | 'outcome'       // A task result
  | 'commit';       // A git commit

interface Entity {
  // Identity
  id: string;                    // Stable, content-addressed
  type: EntityType;
  path: string;                  // File path or logical path

  // Quality signals (computed, not stored)
  confidence: Confidence;

  // Relationships (stored)
  relationships: Relationship[];

  // Arbitrary metadata (type-specific)
  metadata: EntityMetadata;

  // Provenance
  indexedAt: Date;
  indexedBy: string;             // Adapter that indexed this
  checksum?: string;             // Content hash for staleness
}

interface Relationship {
  type: RelationshipType;
  targetId: string;
  weight?: number;               // Strength of relationship
  metadata?: Record<string, unknown>;
}

type RelationshipType =
  | 'imports'       // Module imports another
  | 'exports'       // Module exports symbol
  | 'calls'         // Function calls another
  | 'tests'         // Test covers code
  | 'owns'          // Author owns code
  | 'constrains'    // Constraint applies to scope
  | 'exemplifies'   // Code exemplifies pattern
  | 'cochanges';    // Files change together

// Type-specific metadata
type EntityMetadata =
  | ModuleMetadata
  | FunctionMetadata
  | TestMetadata
  | ConstraintMetadata
  | PatternMetadata
  | OutcomeMetadata;

interface ModuleMetadata {
  type: 'module';
  purpose: string;
  exports: string[];
  language: string;
  lineCount: number;
}

interface FunctionMetadata {
  type: 'function';
  signature: string;
  complexity: number;
  isExported: boolean;
}

interface TestMetadata {
  type: 'test';
  testFramework: string;
  covers: string[];              // Entity IDs this test covers
}

interface ConstraintMetadata {
  type: 'constraint';
  rule: string;
  severity: 'error' | 'warning' | 'info';
  source: 'explicit' | 'inferred' | 'historical';
  evidence?: { conforming: number; violating: number };
}

interface PatternMetadata {
  type: 'pattern';
  category: string;              // 'async_handling', 'error_handling', etc.
  signature: string;             // Structural signature
  recommendation: 'preferred' | 'acceptable' | 'deprecated';
  usageCount: number;
}

interface OutcomeMetadata {
  type: 'outcome';
  taskId: string;
  success: boolean;
  reason?: string;
  contextUsed: string[];         // Entity IDs used as context
  filesModified: string[];
}
```

### 1.2 Confidence

Confidence is ALWAYS multi-dimensional. Never a single number without context.

```typescript
// src/LiBrainian/core/confidence.ts

interface Confidence {
  // Three orthogonal dimensions
  freshness: number;             // 0-1: How recent is the data?
  coverage: number;              // 0-1: How complete is our knowledge?
  reliability: number;           // 0-1: How often has this been correct?

  // Computed overall score
  overall: number;               // Weighted combination

  // Explanation
  signals: ConfidenceSignal[];   // What contributed to this score
  caveats: string[];             // Warnings about this confidence
}

interface ConfidenceSignal {
  source: string;                // 'freshness_engine', 'learning_engine', etc.
  dimension: 'freshness' | 'coverage' | 'reliability';
  value: number;
  weight: number;
  reason: string;
}

// Confidence computation is CENTRALIZED
function computeConfidence(signals: ConfidenceSignal[]): Confidence {
  const byDimension = groupBy(signals, s => s.dimension);

  const freshness = weightedAverage(byDimension.freshness || []);
  const coverage = weightedAverage(byDimension.coverage || []);
  const reliability = weightedAverage(byDimension.reliability || []);

  // Overall: geometric mean (one bad dimension tanks the whole thing)
  const overall = Math.pow(freshness * coverage * reliability, 1/3);

  return {
    freshness,
    coverage,
    reliability,
    overall,
    signals,
    caveats: generateCaveats(signals),
  };
}

function weightedAverage(signals: ConfidenceSignal[]): number {
  if (signals.length === 0) return 0.5;  // Uncertain

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = signals.reduce((sum, s) => sum + s.value * s.weight, 0);

  return weightedSum / totalWeight;
}

function generateCaveats(signals: ConfidenceSignal[]): string[] {
  const caveats: string[] = [];

  const lowFreshness = signals.filter(s => s.dimension === 'freshness' && s.value < 0.5);
  if (lowFreshness.length > 0) {
    caveats.push(`Staleness detected: ${lowFreshness.map(s => s.reason).join(', ')}`);
  }

  const lowReliability = signals.filter(s => s.dimension === 'reliability' && s.value < 0.5);
  if (lowReliability.length > 0) {
    caveats.push(`Low reliability: ${lowReliability.map(s => s.reason).join(', ')}`);
  }

  return caveats;
}
```

### 1.3 Scope

Scopes are first-class objects, not ad-hoc string arrays.

```typescript
// src/LiBrainian/core/scope.ts

interface Scope {
  // Definition (at least one required)
  paths?: string[];              // Explicit file paths
  patterns?: string[];           // Glob patterns
  entityIds?: string[];          // Specific entity IDs
  directories?: string[];        // Directory prefixes

  // Expansion
  expand(storage: Storage): Promise<string[]>;

  // Set operations
  intersect(other: Scope): Scope;
  union(other: Scope): Scope;
  subtract(other: Scope): Scope;

  // Queries
  contains(path: string): boolean;
  overlaps(other: Scope): boolean;
}

class ScopeImpl implements Scope {
  constructor(
    public paths?: string[],
    public patterns?: string[],
    public entityIds?: string[],
    public directories?: string[]
  ) {}

  async expand(storage: Storage): Promise<string[]> {
    const result = new Set<string>();

    // Direct paths
    if (this.paths) {
      for (const p of this.paths) result.add(p);
    }

    // Glob patterns
    if (this.patterns) {
      for (const pattern of this.patterns) {
        const matches = await glob(pattern);
        for (const m of matches) result.add(m);
      }
    }

    // Entity IDs → paths
    if (this.entityIds) {
      const entities = await storage.getEntities(this.entityIds);
      for (const e of entities) result.add(e.path);
    }

    // Directory prefixes
    if (this.directories) {
      const allPaths = await storage.getAllPaths();
      for (const p of allPaths) {
        if (this.directories.some(d => p.startsWith(d))) {
          result.add(p);
        }
      }
    }

    return [...result];
  }

  contains(path: string): boolean {
    if (this.paths?.includes(path)) return true;
    if (this.directories?.some(d => path.startsWith(d))) return true;
    if (this.patterns?.some(p => minimatch(path, p))) return true;
    return false;
  }

  overlaps(other: Scope): boolean {
    // Quick check without full expansion
    if (this.paths && other.paths) {
      if (this.paths.some(p => other.paths!.includes(p))) return true;
    }
    if (this.directories && other.directories) {
      if (this.directories.some(d1 =>
        other.directories!.some(d2 => d1.startsWith(d2) || d2.startsWith(d1))
      )) return true;
    }
    return false;
  }

  intersect(other: Scope): Scope {
    // Return scope that matches both
    return new ScopeImpl(
      this.paths?.filter(p => other.contains(p)),
      undefined,  // Can't intersect patterns easily
      this.entityIds?.filter(id => other.entityIds?.includes(id)),
      undefined
    );
  }

  union(other: Scope): Scope {
    return new ScopeImpl(
      [...(this.paths || []), ...(other.paths || [])],
      [...(this.patterns || []), ...(other.patterns || [])],
      [...(this.entityIds || []), ...(other.entityIds || [])],
      [...(this.directories || []), ...(other.directories || [])]
    );
  }

  subtract(other: Scope): Scope {
    return new ScopeImpl(
      this.paths?.filter(p => !other.contains(p)),
      this.patterns,  // Can't subtract patterns
      this.entityIds?.filter(id => !other.entityIds?.includes(id)),
      this.directories?.filter(d => !other.directories?.includes(d))
    );
  }
}

// Factory functions
function scope(paths: string[]): Scope {
  return new ScopeImpl(paths);
}

function scopeFromPattern(pattern: string): Scope {
  return new ScopeImpl(undefined, [pattern]);
}

function scopeFromDirectory(dir: string): Scope {
  return new ScopeImpl(undefined, undefined, undefined, [dir]);
}
```

### 1.4 Event

Events are the integration mechanism. All subsystems communicate through events.

```typescript
// src/LiBrainian/core/event.ts

type EventType =
  // File system events
  | 'file:created'
  | 'file:modified'
  | 'file:deleted'
  | 'file:renamed'

  // Git events
  | 'git:commit'
  | 'git:branch_switch'
  | 'git:merge'

  // Task lifecycle events
  | 'task:received'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'

  // Query events
  | 'query:started'
  | 'query:completed'
  | 'query:cache_hit'

  // Index events
  | 'index:started'
  | 'index:progress'
  | 'index:completed'
  | 'index:entity_added'
  | 'index:entity_updated'

  // Learning events
  | 'learning:pattern_detected'
  | 'learning:outcome_recorded'
  | 'learning:confidence_updated'

  // Coordination events
  | 'coordination:lock_acquired'
  | 'coordination:lock_released'
  | 'coordination:conflict_detected';

interface LibrarianEvent<T = unknown> {
  type: EventType;
  timestamp: Date;
  scope: Scope;
  data: T;
  source: string;                // Which subsystem emitted this
  correlationId?: string;        // For tracing related events
}

// Type-safe event data
interface FileCreatedEvent {
  path: string;
  content?: string;
}

interface TaskCompletedEvent {
  taskId: string;
  success: boolean;
  reason?: string;
  contextUsed: string[];
  filesModified: string[];
  duration: number;
}

interface PatternDetectedEvent {
  patternId: string;
  category: string;
  files: string[];
  confidence: number;
}

// Event bus interface
interface EventBus {
  // Publishing
  emit<T>(event: LibrarianEvent<T>): void;

  // Subscribing
  on<T>(type: EventType, handler: (event: LibrarianEvent<T>) => void): Unsubscribe;
  on<T>(pattern: string, handler: (event: LibrarianEvent<T>) => void): Unsubscribe;

  // Async iteration
  events(filter?: EventType[]): AsyncIterable<LibrarianEvent>;
}

type Unsubscribe = () => void;

// Implementation
class EventBusImpl implements EventBus {
  private handlers = new Map<string, Set<Function>>();
  private buffer = new CircularBuffer<LibrarianEvent>(1000);

  emit<T>(event: LibrarianEvent<T>): void {
    // Store in buffer (for replay/debugging)
    this.buffer.push(event);

    // Notify exact type handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (e) {
          console.error(`Event handler error for ${event.type}:`, e);
        }
      }
    }

    // Notify wildcard handlers (e.g., 'file:*')
    const prefix = event.type.split(':')[0];
    const wildcardHandlers = this.handlers.get(`${prefix}:*`);
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event);
        } catch (e) {
          console.error(`Wildcard handler error for ${event.type}:`, e);
        }
      }
    }

    // Notify global handlers
    const globalHandlers = this.handlers.get('*');
    if (globalHandlers) {
      for (const handler of globalHandlers) {
        try {
          handler(event);
        } catch (e) {
          console.error(`Global handler error for ${event.type}:`, e);
        }
      }
    }
  }

  on<T>(typeOrPattern: EventType | string, handler: (event: LibrarianEvent<T>) => void): Unsubscribe {
    if (!this.handlers.has(typeOrPattern)) {
      this.handlers.set(typeOrPattern, new Set());
    }
    this.handlers.get(typeOrPattern)!.add(handler);

    return () => {
      this.handlers.get(typeOrPattern)?.delete(handler);
    };
  }

  async *events(filter?: EventType[]): AsyncIterable<LibrarianEvent> {
    // Return recent events from buffer
    for (const event of this.buffer) {
      if (!filter || filter.includes(event.type)) {
        yield event;
      }
    }
  }
}

// Singleton
export const eventBus = new EventBusImpl();
```

---

## Part 2: The Query Pipeline

**Every query flows through this pipeline. No shortcuts.**

```typescript
// src/LiBrainian/core/pipeline.ts

interface QueryRequest {
  type: QueryType;
  intent?: string;
  scope?: Scope;
  budget?: QueryBudget;
  urgency: 'blocking' | 'background';
  correlationId: string;
}

interface QueryBudget {
  maxFiles: number;
  maxTokens: number;
  maxLatency: number;
}

interface QueryResult {
  // Core result
  items: Entity[];
  summary?: string;

  // Quality signals
  confidence: Confidence;

  // Augmentations
  patterns?: Pattern[];
  constraints?: Constraint[];
  warnings?: string[];

  // Metadata
  timing: QueryTiming;
  fromCache: boolean;
}

interface QueryTiming {
  total: number;
  normalize: number;
  freshness: number;
  locks: number;
  execute: number;
  patterns: number;
  confidence: number;
}

// The pipeline
async function executeQuery(
  request: QueryRequest,
  context: PipelineContext
): Promise<QueryResult> {
  const timing: Partial<QueryTiming> = {};
  const start = Date.now();

  // Emit start event
  eventBus.emit({
    type: 'query:started',
    timestamp: new Date(),
    scope: request.scope || scope([]),
    data: { request },
    source: 'pipeline',
    correlationId: request.correlationId,
  });

  try {
    // STEP 1: Normalize scope
    const t1 = Date.now();
    const normalizedScope = await normalizeScope(request.scope, context.storage);
    timing.normalize = Date.now() - t1;

    // STEP 2: Check freshness
    const t2 = Date.now();
    const freshnessResult = await context.freshness.assess(normalizedScope);
    timing.freshness = Date.now() - t2;

    if (freshnessResult.recommendation.action === 'block') {
      return {
        items: [],
        confidence: { freshness: 0, coverage: 0, reliability: 0.5, overall: 0, signals: [], caveats: ['Index too stale'] },
        warnings: [freshnessResult.recommendation.reason],
        timing: timing as QueryTiming,
        fromCache: false,
      };
    }

    // STEP 3: Check coordination (locks, conflicts)
    const t3 = Date.now();
    const lockResult = await context.coordination.checkScope(normalizedScope, request.correlationId);
    timing.locks = Date.now() - t3;

    if (lockResult.conflicts.length > 0) {
      // Don't block, but warn
      // (Could also choose to wait for lock release)
    }

    // STEP 4: Check cache (Scale Engine)
    const cacheKey = context.scale.computeCacheKey(request);
    const cached = await context.scale.getFromCache(cacheKey);

    if (cached && freshnessResult.score > 0.8) {
      eventBus.emit({
        type: 'query:cache_hit',
        timestamp: new Date(),
        scope: normalizedScope,
        data: { cacheKey },
        source: 'pipeline',
        correlationId: request.correlationId,
      });

      return {
        ...cached,
        fromCache: true,
      };
    }

    // STEP 5: Execute query
    const t5 = Date.now();
    const rawResult = await executeQueryType(request, normalizedScope, context);
    timing.execute = Date.now() - t5;

    // STEP 6: Augment with patterns
    const t6 = Date.now();
    const patterns = await context.patterns.getRelevant(normalizedScope);
    timing.patterns = Date.now() - t6;

    // STEP 7: Compute final confidence
    const t7 = Date.now();
    const confidenceSignals: ConfidenceSignal[] = [
      ...freshnessResult.signals,
      ...await context.learning.getReliabilitySignals(normalizedScope),
      ...computeCoverageSignals(rawResult, normalizedScope),
    ];
    const confidence = computeConfidence(confidenceSignals);
    timing.confidence = Date.now() - t7;

    timing.total = Date.now() - start;

    const result: QueryResult = {
      items: rawResult.items,
      summary: rawResult.summary,
      confidence,
      patterns,
      constraints: await context.constraints.getApplicable(normalizedScope),
      warnings: [
        ...(freshnessResult.recommendation.warning ? [freshnessResult.recommendation.warning] : []),
        ...(lockResult.warnings || []),
      ],
      timing: timing as QueryTiming,
      fromCache: false,
    };

    // STEP 8: Cache result
    await context.scale.setCache(cacheKey, result);

    // STEP 9: Record for learning
    context.learning.recordQuery(request, result);

    // Emit completion event
    eventBus.emit({
      type: 'query:completed',
      timestamp: new Date(),
      scope: normalizedScope,
      data: { request, resultCount: result.items.length, confidence: confidence.overall },
      source: 'pipeline',
      correlationId: request.correlationId,
    });

    return result;

  } catch (error) {
    // Emit error (could be a specific event type)
    eventBus.emit({
      type: 'query:completed',
      timestamp: new Date(),
      scope: request.scope || scope([]),
      data: { request, error: error.message },
      source: 'pipeline',
      correlationId: request.correlationId,
    });

    throw error;
  }
}

async function normalizeScope(
  input: Scope | undefined,
  storage: Storage
): Promise<Scope> {
  if (!input) {
    // Default to entire workspace
    return scopeFromDirectory('.');
  }

  // Expand patterns, resolve entity IDs
  const expanded = await input.expand(storage);
  return scope(expanded);
}

function computeCoverageSignals(result: RawQueryResult, scope: Scope): ConfidenceSignal[] {
  const signals: ConfidenceSignal[] = [];

  // Check if we have knowledge for all files in scope
  const scopeSize = scope.paths?.length || 0;
  const resultSize = result.items.length;

  if (scopeSize > 0 && resultSize < scopeSize * 0.5) {
    signals.push({
      source: 'pipeline',
      dimension: 'coverage',
      value: resultSize / scopeSize,
      weight: 1.0,
      reason: `Only ${resultSize}/${scopeSize} files have indexed knowledge`,
    });
  }

  return signals;
}
```

---

## Part 3: Subsystem Integration

Each subsystem is a self-contained module that:
1. Subscribes to relevant events
2. Provides a typed interface for the pipeline
3. Emits events for other subsystems
4. Uses shared primitives (Entity, Scope, Confidence)

### 3.1 Subsystem Interface

```typescript
// src/LiBrainian/subsystems/base.ts

interface Subsystem {
  // Identity
  name: string;

  // Lifecycle
  initialize(context: LibrarianContext): Promise<void>;
  shutdown(): Promise<void>;

  // Event integration
  getSubscriptions(): EventSubscription[];

  // Health
  healthCheck(): Promise<HealthStatus>;
}

interface EventSubscription {
  pattern: string;
  handler: (event: LibrarianEvent) => void | Promise<void>;
}

interface HealthStatus {
  healthy: boolean;
  message?: string;
  metrics?: Record<string, number>;
}

// Base class with common functionality
abstract class BaseSubsystem implements Subsystem {
  abstract name: string;

  protected context!: LibrarianContext;
  protected subscriptions: Unsubscribe[] = [];

  async initialize(context: LibrarianContext): Promise<void> {
    this.context = context;

    // Set up event subscriptions
    for (const sub of this.getSubscriptions()) {
      const unsub = eventBus.on(sub.pattern, sub.handler.bind(this));
      this.subscriptions.push(unsub);
    }

    await this.onInitialize();
  }

  async shutdown(): Promise<void> {
    // Unsubscribe from events
    for (const unsub of this.subscriptions) {
      unsub();
    }
    this.subscriptions = [];

    await this.onShutdown();
  }

  abstract getSubscriptions(): EventSubscription[];
  abstract healthCheck(): Promise<HealthStatus>;

  protected async onInitialize(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}

  // Emit helper
  protected emit<T>(type: EventType, data: T, scope: Scope): void {
    eventBus.emit({
      type,
      timestamp: new Date(),
      scope,
      data,
      source: this.name,
    });
  }
}
```

### 3.2 Freshness Subsystem

```typescript
// src/LiBrainian/subsystems/freshness.ts

interface FreshnessSubsystem extends Subsystem {
  assess(scope: Scope): Promise<FreshnessAssessment>;
  markStale(paths: string[]): void;
  getIndexState(): IndexState;
}

interface FreshnessAssessment {
  score: number;
  signals: ConfidenceSignal[];
  staleFiles: string[];
  missingFiles: string[];
  recommendation: FreshnessRecommendation;
}

class FreshnessSubsystemImpl extends BaseSubsystem implements FreshnessSubsystem {
  name = 'freshness';

  private indexState: IndexState = { phase: 'uninitialized' };
  private staleSet = new Set<string>();
  private checksumCache = new Map<string, { checksum: string; mtime: number }>();

  getSubscriptions(): EventSubscription[] {
    return [
      { pattern: 'file:*', handler: this.handleFileEvent },
      { pattern: 'git:*', handler: this.handleGitEvent },
      { pattern: 'index:*', handler: this.handleIndexEvent },
    ];
  }

  private async handleFileEvent(event: LibrarianEvent<FileCreatedEvent>): void {
    const path = event.data.path;

    switch (event.type) {
      case 'file:modified':
      case 'file:created':
        this.staleSet.add(path);
        break;
      case 'file:deleted':
        this.staleSet.add(path);
        break;
      case 'file:renamed':
        // Both old and new paths are affected
        this.staleSet.add((event.data as any).oldPath);
        this.staleSet.add(path);
        break;
    }
  }

  private async handleGitEvent(event: LibrarianEvent): void {
    if (event.type === 'git:branch_switch') {
      // Mark everything as potentially stale
      this.emit('index:invalidated', { reason: 'branch_switch' }, scopeFromDirectory('.'));
    }
  }

  private async handleIndexEvent(event: LibrarianEvent): void {
    if (event.type === 'index:completed') {
      this.indexState = { phase: 'ready', lastFullIndex: new Date() };
      this.staleSet.clear();
    } else if (event.type === 'index:entity_updated') {
      const path = (event.data as any).path;
      this.staleSet.delete(path);
    }
  }

  async assess(scope: Scope): Promise<FreshnessAssessment> {
    const signals: ConfidenceSignal[] = [];
    const staleFiles: string[] = [];
    const missingFiles: string[] = [];

    // Index state signal
    if (this.indexState.phase !== 'ready') {
      signals.push({
        source: 'freshness',
        dimension: 'freshness',
        value: this.indexState.phase === 'indexing' ? 0.3 : 0,
        weight: 2.0,
        reason: `Index is ${this.indexState.phase}`,
      });
    }

    // Age signal
    if (this.indexState.lastFullIndex) {
      const daysSince = (Date.now() - this.indexState.lastFullIndex.getTime()) / (1000 * 60 * 60 * 24);
      const ageScore = Math.exp(-daysSince / 7 * Math.LN2);  // Half-life 7 days

      signals.push({
        source: 'freshness',
        dimension: 'freshness',
        value: ageScore,
        weight: 1.0,
        reason: `Index is ${Math.round(daysSince)} days old`,
      });
    }

    // Check specific files in scope
    const paths = await scope.expand(this.context.storage);

    for (const path of paths) {
      if (this.staleSet.has(path)) {
        staleFiles.push(path);
        continue;
      }

      // Check file mtime vs cached checksum
      const cached = this.checksumCache.get(path);
      if (cached) {
        try {
          const stat = await fs.stat(path);
          if (stat.mtimeMs > cached.mtime) {
            staleFiles.push(path);
            this.staleSet.add(path);
          }
        } catch {
          missingFiles.push(path);
        }
      }
    }

    // Staleness signal
    const staleRatio = staleFiles.length / Math.max(paths.length, 1);
    signals.push({
      source: 'freshness',
      dimension: 'freshness',
      value: 1 - staleRatio,
      weight: 1.5,
      reason: `${staleFiles.length}/${paths.length} files are stale`,
    });

    const score = weightedAverage(signals);

    // Generate recommendation
    let recommendation: FreshnessRecommendation;
    if (score > 0.8) {
      recommendation = { action: 'proceed' };
    } else if (score > 0.5) {
      recommendation = {
        action: 'proceed',
        warning: `${staleFiles.length} stale files in scope`,
      };
      // Trigger background reindex
      this.emit('index:requested', { paths: staleFiles, priority: 'background' }, scope);
    } else if (score > 0.3) {
      recommendation = {
        action: 'incremental_reindex',
        files: staleFiles,
      };
    } else {
      recommendation = {
        action: 'block',
        reason: 'Index too stale to provide reliable context',
      };
    }

    return { score, signals, staleFiles, missingFiles, recommendation };
  }

  markStale(paths: string[]): void {
    for (const path of paths) {
      this.staleSet.add(path);
    }
  }

  getIndexState(): IndexState {
    return this.indexState;
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: this.indexState.phase === 'ready',
      message: `Index phase: ${this.indexState.phase}`,
      metrics: {
        staleCount: this.staleSet.size,
        checksumCacheSize: this.checksumCache.size,
      },
    };
  }
}
```

### 3.3 Learning Subsystem

```typescript
// src/LiBrainian/subsystems/learning.ts

interface LearningSubsystem extends Subsystem {
  recordQuery(request: QueryRequest, result: QueryResult): void;
  recordOutcome(outcome: TaskOutcome): void;
  getReliabilitySignals(scope: Scope): Promise<ConfidenceSignal[]>;
  getFailurePatterns(): FailurePattern[];
  getSuggestions(intent: string): Promise<LearnedSuggestion[]>;
}

interface TaskOutcome {
  taskId: string;
  success: boolean;
  reason?: string;
  contextPackIds: string[];
  filesModified: string[];
  duration: number;
}

interface LearnedSuggestion {
  type: 'include_file' | 'exclude_file' | 'use_pattern' | 'avoid_pattern';
  target: string;
  confidence: number;
  evidence: string;
}

class LearningSubsystemImpl extends BaseSubsystem implements LearningSubsystem {
  name = 'learning';

  // Outcome history (circular buffer)
  private outcomes = new CircularBuffer<OutcomeRecord>(10000);

  // Per-entity statistics
  private entityStats = new Map<string, EntityStats>();

  // Detected patterns
  private failurePatterns: FailurePattern[] = [];

  // Query→outcome correlation
  private pendingQueries = new Map<string, { request: QueryRequest; result: QueryResult; timestamp: Date }>();

  getSubscriptions(): EventSubscription[] {
    return [
      { pattern: 'task:completed', handler: this.handleTaskCompleted },
      { pattern: 'task:failed', handler: this.handleTaskFailed },
      { pattern: 'query:completed', handler: this.handleQueryCompleted },
    ];
  }

  private async handleTaskCompleted(event: LibrarianEvent<TaskCompletedEvent>): void {
    await this.recordOutcome({
      taskId: event.data.taskId,
      success: event.data.success,
      reason: event.data.reason,
      contextPackIds: event.data.contextUsed,
      filesModified: event.data.filesModified,
      duration: event.data.duration,
    });
  }

  private async handleTaskFailed(event: LibrarianEvent<TaskCompletedEvent>): void {
    await this.handleTaskCompleted(event);  // Same recording logic

    // Additionally, trigger pattern detection
    await this.detectFailurePatterns();
  }

  private async handleQueryCompleted(event: LibrarianEvent): void {
    // Track for correlation
    const data = event.data as { request: QueryRequest; resultCount: number };
    this.pendingQueries.set(event.correlationId!, {
      request: data.request,
      result: { items: [], confidence: { overall: 0 } as Confidence } as QueryResult,
      timestamp: new Date(),
    });

    // Clean up old pending queries
    const cutoff = Date.now() - 30 * 60 * 1000;  // 30 minutes
    for (const [id, q] of this.pendingQueries) {
      if (q.timestamp.getTime() < cutoff) {
        this.pendingQueries.delete(id);
      }
    }
  }

  recordQuery(request: QueryRequest, result: QueryResult): void {
    // Store for later correlation with outcomes
    this.pendingQueries.set(request.correlationId, {
      request,
      result,
      timestamp: new Date(),
    });
  }

  async recordOutcome(outcome: TaskOutcome): Promise<void> {
    // Store outcome
    this.outcomes.push({
      ...outcome,
      timestamp: new Date(),
    });

    // Update entity statistics
    for (const packId of outcome.contextPackIds) {
      const stats = this.entityStats.get(packId) || {
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        recentOutcomes: [],
      };

      stats.usageCount++;
      if (outcome.success) {
        stats.successCount++;
      } else {
        stats.failureCount++;
      }
      stats.recentOutcomes.push({ success: outcome.success, timestamp: new Date() });

      // Keep only recent outcomes
      if (stats.recentOutcomes.length > 20) {
        stats.recentOutcomes.shift();
      }

      this.entityStats.set(packId, stats);
    }

    // Correlate with query that produced this context
    const queryCorrelation = await this.findCorrelatedQuery(outcome);
    if (queryCorrelation) {
      await this.learnFromCorrelation(queryCorrelation, outcome);
    }

    // Emit event
    this.emit('learning:outcome_recorded', outcome, scope(outcome.filesModified));
  }

  async getReliabilitySignals(scope: Scope): Promise<ConfidenceSignal[]> {
    const signals: ConfidenceSignal[] = [];
    const paths = await scope.expand(this.context.storage);

    // Aggregate reliability for entities in scope
    let totalUsage = 0;
    let totalSuccess = 0;

    for (const path of paths) {
      const entityId = await this.context.storage.getEntityIdForPath(path);
      if (!entityId) continue;

      const stats = this.entityStats.get(entityId);
      if (stats && stats.usageCount >= 3) {
        totalUsage += stats.usageCount;
        totalSuccess += stats.successCount;
      }
    }

    if (totalUsage >= 5) {
      const successRate = totalSuccess / totalUsage;
      signals.push({
        source: 'learning',
        dimension: 'reliability',
        value: successRate,
        weight: Math.min(totalUsage / 20, 1.0),  // Weight by sample size
        reason: `${Math.round(successRate * 100)}% success rate over ${totalUsage} uses`,
      });
    }

    // Check for active failure patterns
    for (const pattern of this.failurePatterns) {
      if (pattern.status === 'active' && scope.overlaps(pattern.scope)) {
        signals.push({
          source: 'learning',
          dimension: 'reliability',
          value: 0.3,
          weight: 1.5,
          reason: `Active failure pattern: ${pattern.description}`,
        });
      }
    }

    return signals;
  }

  getFailurePatterns(): FailurePattern[] {
    return this.failurePatterns.filter(p => p.status === 'active');
  }

  async getSuggestions(intent: string): Promise<LearnedSuggestion[]> {
    const suggestions: LearnedSuggestion[] = [];

    // Find similar past successful outcomes
    const similarOutcomes = this.findSimilarOutcomes(intent)
      .filter(o => o.success);

    // Files that were used in successful similar tasks
    const usefulFiles = new Map<string, number>();
    for (const outcome of similarOutcomes) {
      for (const file of outcome.filesModified) {
        usefulFiles.set(file, (usefulFiles.get(file) || 0) + 1);
      }
    }

    for (const [file, count] of usefulFiles) {
      if (count >= 2) {
        suggestions.push({
          type: 'include_file',
          target: file,
          confidence: Math.min(count / 5, 0.9),
          evidence: `Used in ${count} similar successful tasks`,
        });
      }
    }

    // Files that were in context but ignored (negative signal)
    // ... similar logic for exclude_file

    return suggestions;
  }

  private async detectFailurePatterns(): Promise<void> {
    const recent = this.outcomes.filter(o =>
      !o.success && o.timestamp.getTime() > Date.now() - 24 * 60 * 60 * 1000
    );

    // Group by context pack
    const byPack = groupBy(recent, o => o.contextPackIds.join(','));

    for (const [packKey, failures] of Object.entries(byPack)) {
      if (failures.length >= 3) {
        const existingPattern = this.failurePatterns.find(p =>
          p.contextPackKey === packKey && p.status === 'active'
        );

        if (!existingPattern) {
          const pattern: FailurePattern = {
            id: `fp-${Date.now()}`,
            contextPackKey: packKey,
            scope: scope(failures.flatMap(f => f.filesModified)),
            failureCount: failures.length,
            description: `${failures.length} failures with same context`,
            status: 'active',
            detectedAt: new Date(),
          };

          this.failurePatterns.push(pattern);
          this.emit('learning:pattern_detected', pattern, pattern.scope);
        }
      }
    }
  }

  private findSimilarOutcomes(intent: string): OutcomeRecord[] {
    // Simple keyword matching for now
    // Could be replaced with embedding similarity
    const keywords = intent.toLowerCase().split(/\s+/);

    return [...this.outcomes].filter(o => {
      const outcomeText = o.filesModified.join(' ').toLowerCase();
      return keywords.some(k => outcomeText.includes(k));
    });
  }

  private async findCorrelatedQuery(outcome: TaskOutcome): Promise<QueryCorrelation | null> {
    // Find query with matching context packs
    for (const [id, query] of this.pendingQueries) {
      const queryEntityIds = query.result.items.map(i => i.id);
      const overlap = outcome.contextPackIds.filter(id => queryEntityIds.includes(id));

      if (overlap.length > 0) {
        this.pendingQueries.delete(id);
        return { query, outcome, overlap };
      }
    }
    return null;
  }

  private async learnFromCorrelation(correlation: QueryCorrelation, outcome: TaskOutcome): Promise<void> {
    // What was provided vs what was used
    const provided = new Set(correlation.query.result.items.map(i => i.path));
    const modified = new Set(outcome.filesModified);

    // Files that were modified but weren't in context (should have been provided)
    const shouldHaveProvided = [...modified].filter(f => !provided.has(f));

    // Files that were provided but not used (probably irrelevant)
    const probablyIrrelevant = [...provided].filter(f => !modified.has(f));

    // Store these learnings
    // ... implementation
  }

  async healthCheck(): Promise<HealthStatus> {
    const activePatterns = this.failurePatterns.filter(p => p.status === 'active').length;

    return {
      healthy: activePatterns < 5,
      message: `${activePatterns} active failure patterns`,
      metrics: {
        outcomesRecorded: this.outcomes.length,
        entitiesTracked: this.entityStats.size,
        activeFailurePatterns: activePatterns,
      },
    };
  }
}
```

### 3.4 Subsystem Coordination

```typescript
// src/LiBrainian/core/coordinator.ts

interface LibrarianContext {
  storage: Storage;
  freshness: FreshnessSubsystem;
  learning: LearningSubsystem;
  scale: ScaleSubsystem;
  coordination: CoordinationSubsystem;
  patterns: PatternSubsystem;
  constraints: ConstraintSubsystem;
}

class LibrarianCoordinator {
  private subsystems: Subsystem[] = [];
  private context!: LibrarianContext;

  async initialize(config: LibrarianConfig): Promise<void> {
    // Initialize storage first
    const storage = await createStorage(config.storagePath);

    // Create subsystem instances
    const freshness = new FreshnessSubsystemImpl();
    const learning = new LearningSubsystemImpl();
    const scale = new ScaleSubsystemImpl();
    const coordination = new CoordinationSubsystemImpl();
    const patterns = new PatternSubsystemImpl();
    const constraints = new ConstraintSubsystemImpl();

    this.context = {
      storage,
      freshness,
      learning,
      scale,
      coordination,
      patterns,
      constraints,
    };

    this.subsystems = [freshness, learning, scale, coordination, patterns, constraints];

    // Initialize all subsystems
    for (const subsystem of this.subsystems) {
      await subsystem.initialize(this.context);
      console.log(`Initialized subsystem: ${subsystem.name}`);
    }
  }

  async shutdown(): Promise<void> {
    // Shutdown in reverse order
    for (const subsystem of [...this.subsystems].reverse()) {
      await subsystem.shutdown();
      console.log(`Shutdown subsystem: ${subsystem.name}`);
    }
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    return executeQuery(request, this.context);
  }

  async healthCheck(): Promise<Map<string, HealthStatus>> {
    const results = new Map<string, HealthStatus>();

    for (const subsystem of this.subsystems) {
      results.set(subsystem.name, await subsystem.healthCheck());
    }

    return results;
  }

  getContext(): LibrarianContext {
    return this.context;
  }
}

// Singleton
let coordinator: LibrarianCoordinator | null = null;

export async function initializeLibrarian(config: LibrarianConfig): Promise<LibrarianCoordinator> {
  if (coordinator) {
    throw new Error('LiBrainian already initialized');
  }

  coordinator = new LibrarianCoordinator();
  await coordinator.initialize(config);

  return coordinator;
}

export function getLibrarian(): LibrarianCoordinator {
  if (!coordinator) {
    throw new Error('LiBrainian not initialized');
  }
  return coordinator;
}
```

---

## Part 4: How Engines Compose Subsystems

Engines (Relevance, Constraint, Meta-Knowledge) don't implement their own logic - they **compose** subsystem capabilities.

```typescript
// src/LiBrainian/engines/relevance.ts

class RelevanceEngine {
  constructor(private context: LibrarianContext) {}

  async query(request: RelevanceRequest): Promise<RelevanceResult> {
    const scope = request.scope || scopeFromIntent(request.intent);

    // Compose subsystem capabilities
    const [
      freshnessResult,
      patterns,
      suggestions,
      constraints,
    ] = await Promise.all([
      this.context.freshness.assess(scope),
      this.context.patterns.getRelevant(scope),
      this.context.learning.getSuggestions(request.intent),
      this.context.constraints.getApplicable(scope),
    ]);

    // Query knowledge layer
    const items = await queryKnowledge(this.context.storage, request);

    // Apply learned suggestions
    const augmentedItems = this.applyLearnedSuggestions(items, suggestions);

    // Tier items by relevance
    const tiers = this.tierByRelevance(augmentedItems, request);

    // Detect blind spots
    const blindSpots = await this.detectBlindSpots(scope, items);

    // Compute confidence
    const confidenceSignals = [
      ...freshnessResult.signals,
      ...await this.context.learning.getReliabilitySignals(scope),
    ];

    return {
      tiers,
      patterns,
      constraints,
      blindSpots,
      confidence: computeConfidence(confidenceSignals),
      warnings: freshnessResult.recommendation.warning
        ? [freshnessResult.recommendation.warning]
        : [],
    };
  }

  private applyLearnedSuggestions(
    items: Entity[],
    suggestions: LearnedSuggestion[]
  ): Entity[] {
    const result = [...items];

    for (const suggestion of suggestions) {
      if (suggestion.type === 'include_file') {
        // Check if file is already in results
        if (!result.find(i => i.path === suggestion.target)) {
          // Add with learned-boost metadata
          const entity = this.context.storage.getEntityByPath(suggestion.target);
          if (entity) {
            result.push({
              ...entity,
              metadata: {
                ...entity.metadata,
                learnedBoost: suggestion.confidence,
                learnedReason: suggestion.evidence,
              },
            });
          }
        }
      } else if (suggestion.type === 'exclude_file') {
        // Lower relevance score but don't remove
        const idx = result.findIndex(i => i.path === suggestion.target);
        if (idx >= 0) {
          result[idx] = {
            ...result[idx],
            metadata: {
              ...result[idx].metadata,
              learnedPenalty: suggestion.confidence,
            },
          };
        }
      }
    }

    return result;
  }

  private tierByRelevance(items: Entity[], request: RelevanceRequest): RelevanceTiers {
    // Sort by combined signals
    const scored = items.map(item => ({
      item,
      score: this.computeRelevanceScore(item, request),
    })).sort((a, b) => b.score - a.score);

    const budget = request.budget || { maxFiles: 20, maxTokens: 50000 };

    return {
      essential: scored.slice(0, 5).map(s => s.item),
      contextual: scored.slice(5, 15).map(s => s.item),
      reference: scored.slice(15, budget.maxFiles).map(s => s.item),
    };
  }

  private computeRelevanceScore(item: Entity, request: RelevanceRequest): number {
    let score = 0;

    // Embedding similarity (if available)
    if (item.metadata.embeddingScore) {
      score += item.metadata.embeddingScore * 0.4;
    }

    // Learned boost/penalty
    if (item.metadata.learnedBoost) {
      score += item.metadata.learnedBoost * 0.3;
    }
    if (item.metadata.learnedPenalty) {
      score -= item.metadata.learnedPenalty * 0.2;
    }

    // Recency (prefer recently modified)
    // ... more signals

    return score;
  }

  private async detectBlindSpots(scope: Scope, items: Entity[]): Promise<BlindSpot[]> {
    const blindSpots: BlindSpot[] = [];

    // Directories with no indexed files
    const coveredDirs = new Set(items.map(i => path.dirname(i.path)));
    const allDirs = await this.context.storage.getAllDirectories();

    for (const dir of allDirs) {
      if (scope.contains(dir) && !coveredDirs.has(dir)) {
        blindSpots.push({
          area: dir,
          reason: 'No indexed knowledge in this directory',
          risk: 'medium',
          suggestion: `Consider reading files in ${dir}`,
        });
      }
    }

    return blindSpots;
  }
}
```

---

## Part 5: Implementation Checklist

> **STATUS KEY**: ✅ = Implemented, ⏳ = In Progress, ☐ = Not Started
>
> **NOTE**: The original design called for `src/LiBrainian/core/*` files. The current implementation
> uses different file locations as noted below. This checklist tracks both the original design
> intent and the actual implementation status.

### Phase 1: Foundation (Do First)

```markdown
✅ Implement shared primitives
  ✅ src/LiBrainian/types.ts (replaces planned core/entity.ts, confidence.ts, scope.ts)
  ✅ src/LiBrainian/events.ts (replaces planned core/event.ts)

☐ Implement event bus (PLANNED - not yet implemented)
  ☐ src/LiBrainian/core/event_bus.ts
  ☐ Tests for pub/sub, wildcards, correlation IDs

☐ Implement query pipeline (PLANNED - current impl in api/query.ts)
  ⏳ src/LiBrainian/api/query.ts (partial implementation)
  ☐ Integration tests for full pipeline flow
```

### Phase 2: Subsystems

```markdown
⏳ Freshness Subsystem
  ✅ src/LiBrainian/integration/file_watcher.ts (partial - file watching implemented)
  ☐ Event handlers: file:*, git:*, index:* (planned)
  ⏳ Tests: staleness detection (basic), branch awareness (planned)

⏳ Learning Subsystem
  ✅ src/LiBrainian/engines/meta_engine.ts (outcome tracking implemented)
  ✅ src/LiBrainian/integration/wave0_integration.ts (recordTaskOutcome)
  ⏳ Tests: outcome recording (partial), pattern detection (planned)

⏳ Scale Subsystem
  ✅ src/LiBrainian/memory/hierarchical_memory.ts (L1/L2/L3 caching)
  ✅ src/LiBrainian/api/governors.ts (budget management)
  ⏳ Tests: cache hit/miss (partial), large codebases (planned)

✅ Coordination Subsystem
  ✅ src/LiBrainian/integration/file_lock_manager.ts (file locking)
  ✅ src/LiBrainian/integration/workspace_lock.ts (workspace locking)
  ⏳ Tests: concurrent access (partial), deadlock prevention (planned)

✅ Pattern Subsystem
  ✅ src/LiBrainian/knowledge/patterns.ts (pattern inference)
  ✅ src/LiBrainian/knowledge/pattern_behavior.ts (behavior patterns)
  ⏳ Tests: pattern detection (partial), recommendations (planned)

✅ Constraint Subsystem
  ✅ src/LiBrainian/engines/constraint_engine.ts (fully implemented)
  ✅ Wired into engine layer and Wave0 integration
```

### Phase 3: Integration

```markdown
⏳ Coordinator (partial - using api/bootstrap.ts instead of dedicated coordinator)
  ✅ src/LiBrainian/api/bootstrap.ts (bootstrap lifecycle management)
  ✅ src/LiBrainian/api/governors.ts (health checks via governor budgets)
  ☐ Dedicated coordinator abstraction (planned)

✅ Engine refactoring
  ✅ src/LiBrainian/engines/relevance_engine.ts (composes knowledge layer)
  ✅ src/LiBrainian/engines/constraint_engine.ts (composes pattern/knowledge layer)
  ✅ src/LiBrainian/engines/meta_engine.ts (composes learning/outcome tracking)
  ✅ Engines use shared types from types.ts

⏳ Integration tests
  ✅ src/LiBrainian/__tests__/LiBrainian.test.ts (47/49 passing)
  ✅ src/LiBrainian/__tests__/agentic/*.test.ts (agentic tests)
  ⏳ Full scenario tests (see scenarios.md) - partial coverage
  ☐ Performance benchmarks (planned)
```

---

## Key Principles Summary

| Principle | Implementation |
|-----------|----------------|
| **Single source of truth** | Entity, Confidence, Scope are THE representations |
| **Event-driven integration** | All subsystems communicate via EventBus |
| **Composition over duplication** | Engines compose subsystems, don't reimplement |
| **Confidence is multi-dimensional** | Never return a single number without signals |
| **Pipeline enforces consistency** | All queries flow through the same pipeline |
| **Subsystems are self-contained** | Each can be tested independently |
| **Health is observable** | Every subsystem exposes health metrics |

---

**Navigation**: [README.md](./README.md) | [scenarios.md](./scenarios.md) | [implementation-requirements.md](./implementation-requirements.md)
