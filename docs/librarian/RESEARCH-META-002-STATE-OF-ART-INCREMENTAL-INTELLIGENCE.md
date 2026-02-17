# RESEARCH-META-002: State of the Art in Incremental Code Intelligence and Graph Maintenance

**Date**: 2026-01-30
**Type**: Research Analysis
**Status**: Complete

---

## Executive Summary

This research document surveys the state of the art in incremental code intelligence, examining how production systems handle the challenge of maintaining up-to-date indices and knowledge graphs as codebases evolve. The key finding is that **incremental computation is a well-solved problem at the framework level**, with mature solutions like Salsa, Differential Dataflow, and DICE providing robust foundations. The challenge lies in **choosing the right granularity of incrementality** for your specific use case and **avoiding over-engineering** when simpler solutions suffice.

**Key Takeaways for LiBrainian:**
1. Content-addressable storage (like Git blob IDs) provides natural deduplication and change detection
2. The "durability" concept from Salsa can dramatically reduce unnecessary recomputation
3. Differential dataflow patterns enable O(changes) rather than O(repository) updates
4. File-level incrementality is sufficient for most code intelligence use cases
5. The bootstrap problem is best solved with tiered approaches: fast approximate results first, precise results incrementally

---

## Table of Contents

1. [Production Code Intelligence Systems](#1-production-code-intelligence-systems)
2. [Build System Approaches](#2-build-system-approaches)
3. [Knowledge Graph Maintenance](#3-knowledge-graph-maintenance)
4. [Academic Research](#4-academic-research)
5. [Patterns and Anti-patterns](#5-patterns-and-anti-patterns)
6. [Comparison Matrix](#6-comparison-matrix)
7. [Recommendations for LiBrainian](#7-recommendations-for-LiBrainian)
8. [Implementation Complexity Estimates](#8-implementation-complexity-estimates)
9. [References](#9-references)

---

## 1. Production Code Intelligence Systems

### 1.1 LSP Servers: TypeScript and rust-analyzer

#### TypeScript Language Server (tsserver)

TypeScript's language server has evolved significantly, with TypeScript 7.0 representing a major architectural shift:

- **Incremental Compilation**: TypeScript's `--incremental` flag stores information from previous compilations to speed up subsequent builds. TypeScript 7.0 achieves near-instantaneous builds for small changes in large projects.
- **Standard LSP Protocol**: TypeScript 7.0 moved from a custom TSServer protocol to standard LSP, enabling better tooling integration.
- **Performance**: Native code performance combined with shared-memory parallelism enables multi-threaded builds on single projects and parallel builds across multiple projects.

**Key Insight**: TypeScript demonstrates that rewriting critical infrastructure in native code (their Go-based rewrite) can provide 10x speedups over interpreted implementations.

#### rust-analyzer and Salsa

rust-analyzer uses the [Salsa](https://github.com/salsa-rs/salsa) incremental computation framework, which represents the state of the art in demand-driven incremental computation:

**Core Concepts:**
- **Query-based Architecture**: Programs are defined as sets of queries (K -> V mappings)
- **Automatic Memoization**: Results are cached and intelligently invalidated
- **Demand-driven Evaluation**: Work is only done when results are requested
- **Red-Green Algorithm**: Efficiently determines what needs recomputation after changes

**The Red-Green Algorithm:**
```
1. When an input changes, mark dependent queries as "potentially stale" (red)
2. When a query is requested, check if inputs have actually changed
3. If unchanged, mark as "verified" (green) without recomputation
4. If changed, recompute and propagate changes upward
5. "Early cutoff": Stop propagation when a recomputed result matches the old result
```

**Durability System:**

A critical optimization in Salsa for rust-analyzer is the "durability" concept:
- Queries are classified by volatility (e.g., "standard library" vs "user code")
- Changes to user code don't trigger revalidation of standard library queries
- This reduces validation overhead from ~300ms to nearly instant for common edits

**Architecture Invariant**: "Typing inside a function's body never invalidates global derived data." This invariant enables efficient incremental updates.

### 1.2 Sourcegraph and GitHub Code Search

#### Sourcegraph Architecture

Sourcegraph provides code search at massive scale (54 billion+ lines indexed) using several key components:

**Zoekt Trigram Index:**
- Uses trigram (3-character sequences) indexing for fast substring matching
- Supports boolean operators and rich query language
- Ranks results using code-specific signals (symbol matches, etc.)

**Incremental Updates:**
- **gitserver**: Sharded service storing code as eventually-consistent cache
- **repo-updater**: Ensures code is up-to-date while respecting rate limits
- Trigram index is created for the default branch of every repository

**Precise Code Intelligence:**
- Uses SCIP (Sourcegraph Code Intelligence Protocol) for semantic analysis
- Falls back to search-based navigation when precise index unavailable
- Language-specific indexers compute index during build pipeline

#### GitHub Blackbird

GitHub built Blackbird, a Rust-based code search engine, from scratch:

**Key Design Decisions:**
- **Sharding by Git blob ID**: Provides natural deduplication and uniform load distribution
- **Dynamic gram sizes**: Rather than fixed trigrams, uses variable n-grams for efficiency
- **Kafka-based pipeline**: Repository changes flow through Kafka to indexing workers

**Performance:**
- 640 queries/second (vs 0.01 for ripgrep)
- ~120,000 documents/second indexing rate
- Sub-second queries for 95% of global searches

**Incremental Strategy:**
```
1. Repository change events published to Kafka
2. Ingest crawlers fetch blob content and extract tokens
3. Documents partitioned by blob object ID
4. Indexers insert into sharded inverted indices
5. Compaction runs on short intervals for deletions
```

### 1.3 IDE Indexers: IntelliJ Platform

The IntelliJ Platform uses a layered architecture for incremental indexing:

**Virtual File System (VFS):**
- Encapsulates file operations across different storage types
- Maintains persistent snapshot of accessed files
- Built incrementally by scanning from project root
- Native file watcher for real-time change detection (Windows, Mac, Linux)

**PSI (Program Structure Interface):**
- Hierarchical object model considering syntax and semantics
- Like DOM for code: mix of AST and parse tree
- Extends beyond file to represent project structure

**Indexing Architecture:**
- **File-based indexes**: Built directly over file content
- **Stub indexes**: Built over serialized stub trees (subset of PSI)
- Stubs contain only externally visible declarations in compact binary format

**Performance Optimizations:**
- Use lexer information instead of parsed trees when possible
- Light AST avoids memory-hungry node creation
- Background indexing with DumbService managing feature restrictions

**Threading Concerns:**
- Global lock protects indexes and VFS
- All data model changes must occur on main thread
- Index flush can freeze application without careful management

### 1.4 Meta's Glean

Glean represents Meta's production-scale solution for code indexing:

**Incremental Architecture:**
- **Stacked Immutable Databases**: Each layer can add or hide information non-destructively
- **Diff Sketches**: Mechanical summaries of changesets (new classes, removed methods, etc.)
- **O(changes) vs O(repository)**: Only process changes, not entire repository

**SCIP Integration:**
- 8x smaller than LSIF, 3x faster to process
- Protobuf-encoded and typed
- ~550 lines of code for Glean mapping (vs 1500 for LSIF)

**Key Innovation:**
```
Problem: Full reindexing can't keep up with change rate in monorepo
Solution: Stack immutable database layers
- Each commit creates a new layer
- Layer contains only changes from that commit
- Query traverses layers transparently
- Old layers can be compacted/merged
```

---

## 2. Build System Approaches

### 2.1 Bazel

Google's Bazel pioneered content-hash based caching:

**Key Concepts:**
- **Content-addressable caching**: Cache entries keyed by content hash
- **Shared cache across machines**: Reuse colleague's build results
- **Hermetic builds**: Reproducible outputs from same inputs

**Dependency Tracking:**
- Explicit dependency declarations in BUILD files
- Action graph construction from target graph
- Fine-grained invalidation based on input changes

**Limitations:**
- Steep learning curve
- Explicit configuration required for all dependencies
- Phase-based execution can limit parallelism

### 2.2 Buck2

Meta's Buck2 represents a significant evolution:

**Architectural Innovations:**
- **Single Incremental Dependency Graph**: No phases (unlike Bazel)
- **DICE Engine**: Incremental computation framework (similar to Salsa)
- **Fine-grained Caching**: Track changes very precisely

**Performance:**
- 2x faster than Buck1 for Meta's internal builds
- Millions of builds per day from thousands of developers
- Lower storage needs via better deduplication

**Key Design Decision:**
```
Buck1/Bazel: target graph phase -> action graph phase
Buck2: Single unified graph, all just dependencies in DICE

Benefits:
- Eliminates phase-boundary bugs
- Enables cross-phase parallelism
- More precise change tracking
```

### 2.3 Turborepo

Turborepo focuses on JavaScript/TypeScript monorepos:

**Content-Addressable Caching:**
- Hash actual content, not just file paths
- Reverting a file uses cached result from previous state
- Remote caching shares builds across machines

**Incremental Builds:**
- Only compile changed code
- Task graph determines minimal rebuild set
- Persistent caching avoids redundant work

**Simplicity Focus:**
- Configuration over convention
- Designed for JS/TS ecosystem specifically
- Lower complexity than general-purpose build systems

### 2.4 Build System Comparison

| Feature | Bazel | Buck2 | Turborepo |
|---------|-------|-------|-----------|
| Language Support | Polyglot | Polyglot | JS/TS focused |
| Caching Strategy | Content-hash | Content-hash + DICE | Content-addressable |
| Incrementality | Coarse-grained | Fine-grained | Task-level |
| Learning Curve | High | Medium | Low |
| Remote Caching | Yes | Yes | Yes |
| Phase Model | Multi-phase | Single graph | Task graph |

---

## 3. Knowledge Graph Maintenance

### 3.1 Differential Dataflow

Differential dataflow represents the cutting edge for incremental data-parallel computation:

**Core Concept:**
- Built on top of Timely Dataflow (distributed data-parallel runtime)
- Responds to input changes efficiently, even with joins and iterations
- Update cost: O(changes × log factors), not O(total data)

**Performance:**
```
Example: PageRank on 4.5 million edges
- Initial computation: ~15 seconds
- Incremental update: ~230 microseconds
- Speedup: ~100,000x for updates
```

**Implementation: Materialize:**
- Operational data store using Differential Dataflow
- Updates results incrementally on writes
- Sub-second results on complex queries

**Key Insight:**
The "difference" representation allows tracking positive and negative contributions to results, enabling efficient updates when inputs change without full recomputation.

### 3.2 Neo4j Graph Updates

Neo4j provides several mechanisms for incremental graph maintenance:

**Change Data Capture (CDC):**
- Tracks and streams database changes
- Emits events for node/relationship changes
- Integrates with Kafka for real-time updates

**Kafka Integration Pattern:**
```
1. Neo4j CDC emits change events
2. Kafka Connect streams to event backbone
3. Downstream systems receive updates
4. No custom ETL code required
```

**Algorithm Support:**
- Some algorithms support incremental calculation
- `seedProperty` parameter uses previous results
- Speeds up computation on modified graphs

**Self-Updating Knowledge Graphs:**
Pattern for maintaining knowledge graphs from changing sources:
```
1. Detect changed documents only
2. Extract entities/relations from changes
3. Upsert (merge) into Neo4j
4. Avoid full graph rebuilds
Result: 99% reduction in LLM costs for extraction
```

### 3.3 Stream Processing Approaches

Modern stream processing systems provide primitives for maintaining derived data:

**Key Systems:**
- **Materialize**: Differential dataflow for SQL
- **Feldera**: Built on DBSP (Database Stream Processing)
- **Flink**: Traditional stream processing (less incremental)

**DBSP (Database Stream Processing):**
- More structured than raw differential dataflow
- Easier-to-use incremental computation
- Efficient handling of recursive queries

**Comparison:**
```
Timely/Differential: Low-level, highly flexible
DBSP: More structured, easier to use
Both: Support iterative syntax, high consistency
Legacy (Flink): Less parallel, less consistent guarantees
```

---

## 4. Academic Research

### 4.1 Incremental Static Analysis

#### EvoTaint (2024)

Incremental taint analysis for evolving Android apps:

**Approach:**
- Narrow analysis scope to changed/impacted parts
- Exploit the evolving nature of app versions
- Avoid full re-analysis on each version

**Results:**
- 51.8-68.9% reduction in analysis time
- No compromise on accuracy
- Tested on 100 apps with multiple versions

#### PhD Research: Reified Computation (2024)

Optimization for incremental static program analysis:

**Key Insight:**
- Certain change patterns have predictable impact
- For these patterns, use domain-specific knowledge
- Avoid traditional incremental updates

**Results:**
- Significant time reduction for behavior-preserving changes
- Three identified change patterns with efficient updates

### 4.2 Change Impact Analysis

Change Impact Analysis (CIA) investigates consequences of code modifications:

**Static Methods:**
- Focus on program structure
- Dependency graph analysis
- Call graph traversal

**Dynamic Methods:**
- Runtime behavior observation
- Execution trace analysis
- Test impact analysis

**2024 Advances:**
- Combining transformers with program dependence graphs
- On-the-fly bidirectional Dyck reachability (POPL 2024)
- Enhanced code understanding for impact analysis (FSE 2024)

### 4.3 Self-Adaptive Systems

The MAPE-K loop provides a reference model for self-adaptive systems:

**MAPE-K Components:**
- **Monitor**: Observe system and environment
- **Analyze**: Determine if adaptation needed
- **Plan**: Create adaptation strategy
- **Execute**: Perform adaptations
- **Knowledge**: Shared information base

**Recent Research (2024):**
- Deep learning integration for variability management
- Guidelines for reactive vs proactive approaches
- Generative AI for self-adaptive systems

**Application to Code Intelligence:**
- Monitor: Watch for code changes, query patterns
- Analyze: Determine staleness, identify hot paths
- Plan: Decide what to reindex, when
- Execute: Perform incremental updates
- Knowledge: Index, dependency graph, usage statistics

### 4.4 Adapton and Self-Adjusting Computation

Adapton provides programming language abstractions for incremental computation:

**Core Ideas:**
- **Demand-driven evaluation**: Only recompute what's needed
- **Demanded computation graph**: Track hierarchical changes
- **Separation of concerns**: Inner computations vs outer observers

**Performance:**
- Dramatic speedups over from-scratch recomputation
- Reliable across wide range of benchmarks
- Outperforms naive incremental approaches

**Related Work:**
- **Jane Street Incremental**: Production OCaml library
- **miniAdapton**: Minimal Scheme implementation
- **Fungi**: Typed incremental computation with names

---

## 5. Patterns and Anti-patterns

### 5.1 Successful Patterns

#### Content-Addressable Storage
**Pattern**: Index by content hash rather than path
```
Benefits:
- Natural deduplication across repositories
- Uniform load distribution
- Easy change detection (hash comparison)
- Works with copy-on-write file systems

Example: GitHub Blackbird shards by Git blob ID
```

#### Durability Classification
**Pattern**: Classify data by change frequency
```
Categories:
- Immutable: Standard library, vendored dependencies
- Stable: Core application code, shared utilities
- Volatile: Active development files, config

Benefits:
- Skip validation of immutable/stable data
- Focus resources on volatile areas
- Dramatic reduction in revalidation cost
```

#### Tiered Precision
**Pattern**: Fast approximate results, then precise refinement
```
Tier 1: Syntactic (Tree-sitter parsing) - Instant
Tier 2: Local semantic (single-file analysis) - Fast
Tier 3: Cross-file semantic (full analysis) - Slower

Benefits:
- Immediate feedback for common operations
- Progressive enhancement as analysis completes
- Graceful degradation under load
```

#### Lazy Evaluation with Caching
**Pattern**: Compute on demand, cache results
```
Implementation:
- Don't pre-compute everything
- Compute when first requested
- Cache with invalidation metadata
- Expire on relevant changes only

Example: Salsa's demand-driven query evaluation
```

#### Differential Updates
**Pattern**: Process changes, not full data
```
Instead of: O(repository) per update
Achieve: O(changes) per update

Techniques:
- Maintain inverse indices for quick lookups
- Track deltas rather than snapshots
- Merge deltas periodically for efficiency
```

### 5.2 Anti-patterns

#### Eager Full Recomputation
**Anti-pattern**: Rebuild everything on any change
```
Problem:
- Doesn't scale with repository size
- Wastes resources on unchanged data
- Creates unnecessary latency

Example: Some early language servers would re-parse
entire workspace on any file change
```

#### Over-fine Granularity
**Anti-pattern**: Track dependencies at too fine a level
```
Problem:
- Metadata overhead exceeds computation savings
- Complex invalidation logic
- Memory pressure from dependency tracking

Example: Character-level dependency tracking
when function-level would suffice
```

#### Synchronous Updates
**Anti-pattern**: Block on index updates
```
Problem:
- User-facing latency on every change
- Can't batch related changes
- Prevents amortization

Better: Queue updates, process asynchronously,
serve slightly stale results with confidence scores
```

#### Global Locks
**Anti-pattern**: Single lock for all index operations
```
Problem:
- Serializes concurrent operations
- Can freeze UI during updates
- Limits scalability

Example: IntelliJ's global index lock
can freeze entire IDE during flush

Better: Shard locks, optimistic concurrency,
lock-free data structures where possible
```

#### Ignoring Locality
**Anti-pattern**: Treat all files equally
```
Problem:
- Hot files (frequently accessed) treated
  same as cold files (rarely accessed)
- No prioritization of user-visible areas
- Resources wasted on irrelevant data

Better: Prioritize open files, recently edited,
files in call chain of current context
```

### 5.3 Scaling Challenges

#### Challenge: Cold Start / Bootstrap
**Problem**: Initial indexing can take hours for large repositories

**Solutions:**
1. **Background indexing**: Let users work while indexing completes
2. **Priority ordering**: Index open files and dependencies first
3. **Incremental availability**: Make results available as computed
4. **Seeded indexes**: Ship pre-computed indexes for common dependencies
5. **Distributed computation**: Parallelize across machines

#### Challenge: Consistency vs Freshness
**Problem**: Ensuring queries see consistent state during updates

**Tradeoffs:**
```
Strong consistency: Queries always see latest state
- Higher latency, more locking

Eventual consistency: Queries may see stale state
- Lower latency, better throughput
- Need confidence scores for staleness

Snapshot consistency: Queries see consistent point-in-time
- Good compromise
- Need versioning support
```

#### Challenge: Memory Pressure
**Problem**: Index and cache growth

**Solutions:**
1. **LRU eviction**: Remove least-recently-used entries
2. **Tiered storage**: Hot data in memory, cold on disk
3. **Compression**: Trade CPU for memory
4. **Lazy loading**: Load index segments on demand
5. **Generational structure**: Young/old generation like GC

---

## 6. Comparison Matrix

### 6.1 Incremental Computation Frameworks

| Framework | Language | Granularity | Persistence | Use Case |
|-----------|----------|-------------|-------------|----------|
| Salsa | Rust | Query-level | Optional | Language servers |
| Differential Dataflow | Rust | Record-level | No | Streaming analytics |
| Adapton | OCaml/multi | Expression-level | No | Research/libraries |
| DICE (Buck2) | Rust | Action-level | Yes | Build systems |
| Incremental (Jane Street) | OCaml | Value-level | No | Financial systems |

### 6.2 Code Intelligence Systems

| System | Indexing | Incrementality | Cross-repo | Scale |
|--------|----------|----------------|------------|-------|
| rust-analyzer | On-demand | Query-level (Salsa) | No | Single workspace |
| TypeScript | Build-time | File-level | Project references | Multi-project |
| Sourcegraph | Background | Repository-level | Yes | 54B+ lines |
| GitHub Blackbird | Streaming | Blob-level | Yes | All of GitHub |
| IntelliJ | Background | File/stub-level | Project-level | Single workspace |
| Glean | Build + incremental | Diff-level | Yes | Meta monorepo |
| Kythe | Build-time | Compilation unit | Yes | Google monorepo |

### 6.3 Approaches by Complexity vs Benefit

```
High Benefit, Low Complexity (Do These):
├── Content-hash based caching
├── File-level change detection
├── Priority-based incremental indexing
└── Durability classification

High Benefit, Medium Complexity (Consider):
├── Query-level memoization (Salsa-style)
├── Stub-based indexing
├── Differential updates for hot paths
└── Stack graphs for navigation

High Benefit, High Complexity (For Large Scale):
├── Full differential dataflow
├── Distributed indexing
├── SCIP/LSIF semantic indexing
└── Cross-repository analysis

Low Benefit, High Complexity (Avoid):
├── Character-level dependency tracking
├── Real-time consistency guarantees
├── Custom incremental frameworks
└── Over-optimized data structures
```

---

## 7. Recommendations for LiBrainian

### 7.1 Recommended Architecture

Based on this research, LiBrainian should adopt a **tiered incremental approach**:

```
Tier 0: File Watcher (Immediate)
├── Detect file changes via native watcher
├── Invalidate affected cache entries
└── Queue for reprocessing

Tier 1: Syntactic Updates (Fast, <100ms)
├── Tree-sitter incremental parsing
├── Symbol extraction from changed files
├── Update inverted indices

Tier 2: Local Semantic (Medium, <1s)
├── Single-file type information
├── Import/export relationships
├── Update dependency edges

Tier 3: Cross-File Semantic (Background)
├── Full relationship analysis
├── Pattern detection updates
├── Knowledge graph refinement
```

### 7.2 Specific Techniques to Adopt

#### 1. Content-Hash Based Caching
```typescript
// Recommended approach for LiBrainian
interface ContentCache {
  // Key: SHA-256 of file content
  // Value: Analysis results
  get(contentHash: string): AnalysisResult | undefined;
  set(contentHash: string, result: AnalysisResult): void;
}

// Benefits:
// - Automatic deduplication
// - Works across workspaces
// - Survives file moves/renames
```

#### 2. Durability Classification
```typescript
enum FileDurability {
  IMMUTABLE,  // node_modules, vendored deps
  STABLE,     // src/ files not recently changed
  VOLATILE,   // Recently edited files
}

// Skip revalidation for IMMUTABLE
// Batch validate STABLE
// Prioritize VOLATILE
```

#### 3. Query-Level Memoization
```typescript
// Inspired by Salsa
class IncrementalQuery<K, V> {
  private cache: Map<K, { value: V; revision: number }>;
  private currentRevision: number;

  compute(key: K, dependencies: Dependency[]): V {
    const cached = this.cache.get(key);
    if (cached && !this.depsChanged(dependencies, cached.revision)) {
      return cached.value; // Early cutoff
    }
    const value = this.actualCompute(key);
    this.cache.set(key, { value, revision: this.currentRevision });
    return value;
  }
}
```

#### 4. Differential Index Updates
```typescript
// For relationship graph updates
interface GraphDelta {
  addedEdges: Edge[];
  removedEdges: Edge[];
  modifiedNodes: NodeUpdate[];
}

// Apply delta instead of full rebuild
function applyDelta(graph: Graph, delta: GraphDelta): void {
  for (const edge of delta.removedEdges) {
    graph.removeEdge(edge);
  }
  for (const edge of delta.addedEdges) {
    graph.addEdge(edge);
  }
  // Trigger downstream updates only for affected subgraph
}
```

### 7.3 Bootstrap Strategy

Address the cold-start problem with a tiered bootstrap:

```
Phase 1: Immediate (< 5 seconds)
├── Scan directory structure
├── Build file type classification
├── Create basic file index
└── Enable: File search, basic navigation

Phase 2: Fast (< 30 seconds)
├── Parse entry points and dependencies
├── Extract top-level symbols
├── Build import graph skeleton
└── Enable: Symbol search, go-to-definition for exports

Phase 3: Full (background, unbounded)
├── Deep analysis of all files
├── Full relationship extraction
├── Pattern and architecture analysis
└── Enable: All features at full fidelity
```

### 7.4 Freshness Metrics

Implement staleness detection and SLAs:

```typescript
interface FreshnessMetrics {
  // How old is the index for this file?
  fileAge(path: string): Duration;

  // What percentage of files are within SLA?
  slaAdherence(threshold: Duration): number;

  // Which files are stale?
  staleFiles(threshold: Duration): string[];
}

// Recommended SLAs:
// - Open files: < 1 second
// - Project files: < 5 minutes
// - Dependencies: < 1 hour (or on version change)
```

### 7.5 What NOT to Do

Based on anti-patterns identified:

1. **Don't build a custom incremental computation framework** - Use existing solutions (Salsa concepts, differential approaches)

2. **Don't track dependencies at too fine a granularity** - File-level or function-level is sufficient for most code intelligence

3. **Don't require consistency for all queries** - Accept slightly stale results with confidence scores

4. **Don't reindex everything on startup** - Use persistent indices with incremental validation

5. **Don't ignore the 80/20 rule** - Most value comes from simple techniques (caching, batching, prioritization)

---

## 8. Implementation Complexity Estimates

### 8.1 Low Complexity (Recommended First)

| Technique | Effort | Benefit | Risk |
|-----------|--------|---------|------|
| File watcher + invalidation | 1-2 days | High | Low |
| Content-hash caching | 2-3 days | High | Low |
| Priority-based reindexing | 2-3 days | High | Low |
| Durability classification | 1-2 days | Medium | Low |
| Staleness metrics | 1-2 days | Medium | Low |

**Total: ~1-2 weeks** for significant incremental improvements.

### 8.2 Medium Complexity

| Technique | Effort | Benefit | Risk |
|-----------|--------|---------|------|
| Query-level memoization | 1-2 weeks | High | Medium |
| Tree-sitter incremental parsing | 1 week | Medium | Low |
| Differential graph updates | 1-2 weeks | Medium | Medium |
| Tiered bootstrap | 1 week | High | Low |

**Total: ~4-6 weeks** for comprehensive incremental system.

### 8.3 High Complexity (Consider Carefully)

| Technique | Effort | Benefit | Risk |
|-----------|--------|---------|------|
| Full Salsa-style system | 2-3 months | High | High |
| SCIP semantic indexing | 1-2 months | Medium | Medium |
| Distributed indexing | 2-3 months | High (at scale) | High |
| Cross-repository analysis | 1-2 months | Medium | High |

**Recommendation**: Start with low-complexity techniques. They provide 80% of the benefit. Only invest in high-complexity approaches if scale demands it.

---

## 9. References

### Production Systems

1. [rust-analyzer Architecture](https://rust-analyzer.github.io/book/contributing/architecture.html)
2. [Salsa Incremental Computation](https://github.com/salsa-rs/salsa)
3. [Salsa Algorithm Explained](https://medium.com/@eliah.lakhin/salsa-algorithm-explained-c5d6df1dd291)
4. [rust-analyzer Durable Incrementality](https://rust-analyzer.github.io/blog/2023/07/24/durable-incrementality.html)
5. [TypeScript 7 Progress](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)
6. [The Technology Behind GitHub's Code Search](https://github.blog/engineering/architecture-optimization/the-technology-behind-githubs-new-code-search/)
7. [Indexing Code at Scale with Glean](https://engineering.fb.com/2024/12/19/developer-tools/glean-open-source-code-indexing/)
8. [Sourcegraph Zoekt](https://github.com/sourcegraph/zoekt)
9. [IntelliJ Platform Indexing](https://plugins.jetbrains.com/docs/intellij/indexing-and-psi-stubs.html)
10. [IntelliJ Virtual File System](https://plugins.jetbrains.com/docs/intellij/virtual-file-system.html)

### Build Systems

11. [Buck2 - Why Buck2](https://buck2.build/docs/about/why/)
12. [Buck2 Open Source](https://engineering.fb.com/2023/04/06/open-source/buck2-open-source-large-scale-build-system/)
13. [Tour of Buck2](https://www.tweag.io/blog/2023-07-06-buck2/)
14. [Turborepo](https://www.syntax-stories.com/2024/11/everything-you-need-to-know-about.html)

### Knowledge Graphs and Streaming

15. [Differential Dataflow](https://timelydataflow.github.io/differential-dataflow/)
16. [Building Differential Dataflow from Scratch](https://materialize.com/blog/differential-from-scratch/)
17. [Understanding Differential Dataflow](https://materialize.com/blog/life-in-differential-dataflow/)
18. [Incremental View Maintenance](https://materializedview.io/p/everything-to-know-incremental-view-maintenance)
19. [Neo4j CDC](https://neo4j.com/blog/graph-database/seamless-data-pipeline-neo4j-and-google-cloud-pub-sub/)
20. [Neo4j Graph Management](https://neo4j.com/docs/graph-data-science/current/management-ops/)

### Academic Research

21. [EvoTaint: Incremental Taint Analysis](https://dl.acm.org/doi/10.1145/3743132)
22. [Incremental Static Program Analysis PhD](https://soft.vub.ac.be/Publications/2024/vub-soft-phd-20241104-Jens%20Van%20der%20Plas.pdf)
23. [Adapton: Composable, Demand-Driven Incremental Computation](https://dl.acm.org/doi/10.1145/2594291.2594324)
24. [Rustc Incremental Compilation](https://rustc-dev-guide.rust-lang.org/queries/incremental-compilation.html)
25. [MAPE-K Guidelines 2024](https://link.springer.com/chapter/10.1007/978-3-031-66326-0_4)

### Code Navigation and Parsing

26. [Stack Graphs: Name Resolution at Scale](https://arxiv.org/abs/2211.01224)
27. [Introducing Stack Graphs](https://github.blog/open-source/introducing-stack-graphs/)
28. [Tree-sitter](https://github.com/tree-sitter/tree-sitter)
29. [Incremental Parsing Using Tree-sitter](https://tomassetti.me/incremental-parsing-using-tree-sitter/)
30. [SCIP vs LSIF](https://sourcegraph.com/blog/announcing-scip)
31. [Kythe Overview](https://kythe.io/docs/kythe-overview.html)

### Complexity and Architecture

32. [Understanding Code Complexity](https://www.qodo.ai/blog/code-complexity/)
33. [Simplifying System Design](https://medium.com/@punit_sharma/simplifying-system-design-avoiding-over-engineering-and-complexity-de1abf415918)
34. [Accidental vs Essential Complexity](https://www.iankduncan.com/engineering/2025-05-26-when-is-complexity-accidental)
35. [Freshness SLAs](https://medium.com/@bhagyarana80/top-7-freshness-slas-re-embed-vs-re-index-de6408a78a9f)
36. [Data Freshness vs Latency](https://tacnode.io/post/data-freshness-vs-latency)

---

## Appendix A: Glossary

- **Content-addressable**: Storage where data is keyed by hash of content
- **Demand-driven**: Computation performed only when results requested
- **DICE**: Dependency Injection and Caching Engine (Buck2's incremental framework)
- **Differential dataflow**: Framework for efficient incremental parallel computation
- **Durability**: Classification of data by expected change frequency
- **Early cutoff**: Stopping change propagation when recomputed result matches old
- **LSP**: Language Server Protocol
- **LSIF**: Language Server Index Format
- **MAPE-K**: Monitor-Analyze-Plan-Execute-Knowledge loop for adaptive systems
- **PSI**: Program Structure Interface (IntelliJ's code model)
- **Red-green algorithm**: Incremental validation technique from Roslyn/Salsa
- **Salsa**: Rust framework for incremental computation (used by rust-analyzer)
- **SCIP**: Sourcegraph Code Intelligence Protocol
- **Stack graphs**: Extension of scope graphs for incremental name resolution
- **Stub**: Compact representation of externally visible declarations
- **Trigram index**: Index using 3-character sequences for substring search
- **VFS**: Virtual File System (abstraction layer over actual files)

---

## Appendix B: Decision Framework

When deciding what level of incrementality to implement:

```
Q1: How large is the codebase?
├── < 10K files: File-level caching sufficient
├── 10K-100K files: Query-level memoization helpful
└── > 100K files: Consider distributed/advanced techniques

Q2: How frequently do users make changes?
├── Occasional: Batch updates acceptable
├── Continuous: Need real-time or near-real-time
└── High-frequency: Need optimistic updates

Q3: What's the tolerance for staleness?
├── High: Background updates, eventual consistency
├── Medium: Prioritized updates for visible content
└── Low: Synchronous updates (expensive)

Q4: What's the acceptable bootstrap time?
├── Minutes: Tiered bootstrap essential
├── Seconds: Pre-computed indices, incremental loads
└── Instant: Ship with pre-built indices

Q5: What resources are available?
├── Minimal: Focus on caching and prioritization
├── Moderate: Add query memoization, differential updates
└── Abundant: Full incremental computation framework
```

---

*This research document was prepared for the LiBrainian project to inform architecture decisions around incremental code intelligence and knowledge graph maintenance.*
