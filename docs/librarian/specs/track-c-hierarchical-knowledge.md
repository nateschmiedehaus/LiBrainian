# Track C: Hierarchical Knowledge System

> **Extracted from**: `docs/librarian/THEORETICAL_CRITIQUE.md` (Part XVII.B)
> **Source**: Von Neumann's stored-program insight + Kay's abstraction principle
> **Status**: Specification complete, implementation pending
>
> **Librarian Story**: Chapter 5 (The Scaling) - Making Librarian work for ANY codebase size.
>
> **Related Specifications**:
> - [track-b-bootstrap.md](./track-b-bootstrap.md) - Zero-knowledge bootstrap that produces initial hierarchical knowledge
> - [track-c-extended.md](./track-c-extended.md) - Extended features including storage infrastructure
> - [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md) - Principled confidence system used throughout

---

## Executive Summary

Track C addresses the fundamental scaling problem of Librarian: **How does an intelligent system understand codebases larger than any context window?**

This specification covers:
- **Four-Level Hierarchy** - Structured knowledge from system overview to full source
- **Component Detection** - Automatic discovery of architectural boundaries
- **Hierarchical Bootstrap** - Bottom-up summarization pipeline
- **Query Strategy** - Efficient navigation from abstract to concrete
- **Incremental Updates** - Maintaining hierarchy as code changes

---

## 1. Problem Statement

### The Context Window Limit

Current LLMs have fundamental context window limits:
- Claude: ~200K tokens
- GPT-4: ~128K tokens
- Even future models will have practical limits

**A 1M LOC codebase at ~10 tokens/line = 10M tokens** - far exceeding any context window.

### The Flat Knowledge Anti-Pattern

Current retrieval systems return flat lists of entities:

```typescript
// Current approach: flat retrieval
const results = await librarian.query("How does authentication work?");
// Returns: [Function, Function, Function, Class, Function, ...]
// Problems:
// 1. No architectural context
// 2. No component boundaries
// 3. No understanding of hierarchy
// 4. Context budget exhausted on details
```

### What We Need

A hierarchical knowledge system that:
1. **Fits any codebase in bounded context** - System summary always fits
2. **Preserves architectural context** - Components before details
3. **Enables efficient navigation** - Drill down only where needed
4. **Updates incrementally** - Code changes don't require full rebuild

### Theoretical Foundation

**Von Neumann's Insight**: Knowledge should be hierarchical, like a stored program that can invoke sub-programs. The system summary "calls" component summaries which "call" entity summaries which "call" full source.

**Kay's Insight**: Each level should be complete at its own abstraction level. A system summary should answer system-level questions without drilling down.

---

## 2. Four-Level Hierarchy

### Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ LEVEL 0: System Summary (~500 tokens)                          │
│ "What is this codebase?"                                        │
│ Purpose, architecture, main components, entry points            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LEVEL 1: Component Summaries (~200 tokens each)                 │
│ "What does this module do?"                                     │
│ Purpose, public interface, internal structure, dependencies     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LEVEL 2: Entity Summaries (~50 tokens each)                     │
│ "What does this function/class do?"                             │
│ Purpose, signature, behavior, callers/callees                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LEVEL 3: Full Entities (variable size)                          │
│ "Show me the actual code"                                       │
│ Complete source with comments                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Token Budget Invariants

| Level | Per-Item Budget | Max Items | Total Budget |
|-------|-----------------|-----------|--------------|
| 0 | ~500 tokens | 1 | 500 tokens |
| 1 | ~200 tokens | 50 | 10,000 tokens |
| 2 | ~50 tokens | 500 | 25,000 tokens |
| 3 | variable | as needed | context-limited |

**Key Invariant**: Level 0 + Level 1 + top-50 Level 2 summaries fit in 40K tokens - leaving room for query results and reasoning.

### Level Definitions

#### Level 0: System Summary

```typescript
interface SystemSummary {
  /** One-paragraph description of codebase purpose */
  purpose: string;

  /** High-level architecture description */
  architecture: string;

  /** Main components (top-level modules) */
  mainComponents: ComponentId[];

  /** Primary entry points (main, CLI, API endpoints) */
  entryPoints: EntityId[];

  /** Top 5 patterns used (MVC, microservices, etc.) */
  keyPatterns: string[];

  /** Languages and their percentages */
  languageBreakdown: Map<string, number>;

  /** Summary statistics */
  stats: {
    totalFiles: number;
    totalEntities: number;
    totalComponents: number;
  };

  /** When this summary was generated */
  generatedAt: Date;

  /** Confidence in summary accuracy */
  confidence: ConfidenceValue;
}
```

#### Level 1: Component Summary

```typescript
interface ComponentSummary {
  id: ComponentId;

  /** Human-readable name */
  name: string;

  /** One-paragraph description */
  purpose: string;

  /** Public interface (exported functions/classes) */
  publicInterface: string[];

  /** Internal structure description */
  internalStructure: string;

  /** Components this depends on */
  dependencies: ComponentId[];

  /** Components that depend on this */
  dependents: ComponentId[];

  /** Top 10 most important entities */
  keyEntities: EntityId[];

  /** Files in this component */
  files: string[];

  /** Confidence in this summary */
  confidence: ConfidenceValue;
}
```

#### Level 2: Entity Summary

```typescript
interface EntitySummary {
  id: EntityId;

  /** Entity name */
  name: string;

  /** Entity type */
  kind: 'function' | 'class' | 'interface' | 'type' | 'constant' | 'module';

  /** One-sentence purpose */
  purpose: string;

  /** Signature (for functions/methods) */
  signature?: string;

  /** 2-3 sentence behavior description */
  behavior: string;

  /** Direct callers */
  callers: EntityId[];

  /** Direct callees */
  callees: EntityId[];

  /** Complexity assessment */
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex';

  /** Component this belongs to */
  componentId: ComponentId;

  /** File location */
  filePath: string;

  /** Line range */
  lines: { start: number; end: number };

  /** Confidence in this summary */
  confidence: ConfidenceValue;
}
```

#### Level 3: Full Entity

```typescript
interface FullEntity {
  id: EntityId;

  /** Complete source code */
  source: string;

  /** Full AST (for programmatic analysis) */
  ast?: ASTNode;

  /** All metadata from Level 2 */
  summary: EntitySummary;

  /** Line-by-line annotations (if available) */
  annotations?: Map<number, string>;

  /** Test files that cover this entity */
  testFiles?: string[];

  /** Confidence in extraction accuracy */
  confidence: ConfidenceValue;
}
```

---

## 3. Core Interfaces

### HierarchicalKnowledge

```typescript
/**
 * Complete hierarchical knowledge representation of a codebase.
 *
 * INVARIANT: systemSummary is always populated
 * INVARIANT: components.size <= 50 for bounded context
 * INVARIANT: entities.size <= 500 for bounded context
 * INVARIANT: fullEntities loaded on-demand
 */
interface HierarchicalKnowledge {
  /** Level 0: Single system summary */
  systemSummary: SystemSummary;

  /** Level 1: Component summaries indexed by ComponentId */
  components: Map<ComponentId, ComponentSummary>;

  /** Level 2: Entity summaries indexed by EntityId */
  entities: Map<EntityId, EntitySummary>;

  /** Level 3: Full entities (lazy-loaded) */
  fullEntities: Map<EntityId, FullEntity>;

  /** Metadata about the hierarchy */
  metadata: HierarchyMetadata;
}

interface HierarchyMetadata {
  /** When hierarchy was built */
  builtAt: Date;

  /** Git commit at build time */
  commitHash: string;

  /** Build duration */
  buildDurationMs: number;

  /** Confidence in overall hierarchy */
  confidence: ConfidenceValue;

  /** Component detection method used */
  componentDetectionMethod: 'louvain' | 'directory' | 'manual' | 'hybrid';
}
```

### HierarchicalKnowledgeNavigator

```typescript
/**
 * Navigator for exploring hierarchical knowledge.
 * Implements efficient drill-down and context-aware retrieval.
 */
interface HierarchicalKnowledgeNavigator {
  /**
   * Query knowledge at a specific maximum level.
   *
   * @param query - Natural language query
   * @param maxLevel - Maximum level to drill down (0-3)
   * @returns Knowledge result with items at appropriate levels
   *
   * Example:
   *   queryAtLevel("What is this project?", 0) -> SystemSummary
   *   queryAtLevel("How does auth work?", 2) -> Component + relevant entities
   */
  queryAtLevel(query: string, maxLevel: HierarchyLevel): Promise<KnowledgeResult>;

  /**
   * Drill down from current level to more detail.
   *
   * @param entityId - Entity to drill down from
   * @param currentLevel - Current level of the entity
   * @returns Next level of detail for the entity
   */
  drillDown(entityId: EntityId, currentLevel: HierarchyLevel): Promise<KnowledgeResult>;

  /**
   * Summarize a component from its entities.
   * Used for both initial build and incremental updates.
   */
  summarizeComponent(componentId: ComponentId): Promise<ComponentSummary>;

  /**
   * Summarize the system from its components.
   * Used for both initial build and incremental updates.
   */
  summarizeSystem(): Promise<SystemSummary>;

  /**
   * Get context-optimal knowledge for a query.
   * Automatically determines appropriate levels.
   *
   * @param query - Natural language query
   * @param tokenBudget - Maximum tokens to return
   * @returns Hierarchical context fitting within budget
   */
  getOptimalContext(query: string, tokenBudget: number): Promise<HierarchicalContext>;

  /**
   * Find the path from system to a specific entity.
   * Useful for understanding entity in context.
   */
  getHierarchyPath(entityId: EntityId): Promise<HierarchyPath>;
}

type HierarchyLevel = 0 | 1 | 2 | 3;

interface KnowledgeResult {
  /** Items at level 0 (system summary) */
  system?: SystemSummary;

  /** Items at level 1 (component summaries) */
  components: ComponentSummary[];

  /** Items at level 2 (entity summaries) */
  entities: EntitySummary[];

  /** Items at level 3 (full entities) */
  fullEntities: FullEntity[];

  /** Total tokens in result */
  tokenCount: number;

  /** Query confidence */
  confidence: ConfidenceValue;
}

interface HierarchicalContext {
  /** System context (always included) */
  system: SystemSummary;

  /** Relevant components */
  components: ComponentSummary[];

  /** Relevant entities (summaries) */
  entitySummaries: EntitySummary[];

  /** Expanded entities (full source) */
  expandedEntities: FullEntity[];

  /** Navigation hints for follow-up queries */
  navigationHints: string[];

  /** Tokens used vs budget */
  tokenUsage: { used: number; budget: number };
}

interface HierarchyPath {
  /** System summary */
  system: SystemSummary;

  /** Component containing the entity */
  component: ComponentSummary;

  /** Entity summary */
  entity: EntitySummary;

  /** Full entity (if requested) */
  full?: FullEntity;
}
```

### HierarchicalKnowledgeBuilder

```typescript
/**
 * Builds hierarchical knowledge from a codebase.
 * Implements bottom-up summarization.
 */
interface HierarchicalKnowledgeBuilder {
  /**
   * Build complete hierarchy from scratch.
   *
   * @param workspacePath - Root of codebase
   * @param options - Build options
   * @returns Complete hierarchical knowledge
   */
  buildHierarchy(
    workspacePath: string,
    options?: HierarchyBuildOptions
  ): Promise<HierarchicalKnowledge>;

  /**
   * Update hierarchy incrementally from changes.
   *
   * @param existing - Existing hierarchy
   * @param changes - Changed files
   * @returns Updated hierarchy with affected summaries refreshed
   */
  updateHierarchy(
    existing: HierarchicalKnowledge,
    changes: FileChange[]
  ): Promise<HierarchicalKnowledge>;

  /**
   * Detect components using graph analysis.
   *
   * @param dependencyGraph - Graph of entity dependencies
   * @returns Detected components
   */
  detectComponents(
    dependencyGraph: DependencyGraph
  ): Promise<ComponentDetectionResult>;
}

interface HierarchyBuildOptions {
  /** Maximum components to detect (default: 50) */
  maxComponents?: number;

  /** Maximum entities per component (default: 100) */
  maxEntitiesPerComponent?: number;

  /** Component detection method */
  componentDetection?: 'louvain' | 'directory' | 'hybrid';

  /** LLM provider for summarization */
  llmProvider?: LLMProvider;

  /** Progress callback */
  onProgress?: (progress: BuildProgress) => void;
}

interface BuildProgress {
  phase: 'extracting' | 'detecting_components' | 'summarizing_entities' | 'summarizing_components' | 'summarizing_system';
  current: number;
  total: number;
  message: string;
}
```

---

## 4. Component Detection

### The Louvain Algorithm

Component detection uses the Louvain community detection algorithm on the dependency graph:

```typescript
/**
 * Detect components using Louvain community detection.
 *
 * The Louvain algorithm maximizes modularity:
 * Q = (1/2m) * Σ[Aij - (ki*kj)/(2m)] * δ(ci, cj)
 *
 * Where:
 * - Aij = edge weight between i and j
 * - ki, kj = sum of edge weights for nodes i, j
 * - m = total edge weight
 * - ci, cj = communities of i, j
 * - δ = 1 if same community, 0 otherwise
 */
interface LouvainComponentDetector {
  /**
   * Detect components from dependency graph.
   *
   * @param graph - Dependency graph with entities as nodes
   * @param options - Detection options
   * @returns Detected communities/components
   */
  detect(
    graph: DependencyGraph,
    options?: LouvainOptions
  ): Promise<ComponentDetectionResult>;
}

interface LouvainOptions {
  /** Target number of components (affects resolution) */
  targetComponents?: number;

  /** Minimum component size (entities) */
  minComponentSize?: number;

  /** Maximum iterations */
  maxIterations?: number;

  /** Resolution parameter (higher = more communities) */
  resolution?: number;
}

interface ComponentDetectionResult {
  /** Detected components with their entities */
  components: DetectedComponent[];

  /** Modularity score (quality of detection) */
  modularity: number;

  /** Confidence in detection */
  confidence: ConfidenceValue;

  /** Detection metadata */
  metadata: {
    algorithm: 'louvain';
    iterations: number;
    resolution: number;
  };
}

interface DetectedComponent {
  /** Temporary ID (becomes ComponentId after naming) */
  id: string;

  /** Entities in this component */
  entities: EntityId[];

  /** Internal edge count */
  internalEdges: number;

  /** External edge count */
  externalEdges: number;

  /** Primary directory (for naming hint) */
  primaryDirectory?: string;
}
```

### Component Naming

After detection, components need meaningful names:

```typescript
/**
 * Name detected components using LLM analysis.
 */
interface ComponentNamer {
  /**
   * Generate meaningful name for a component.
   *
   * @param component - Detected component
   * @param entitySummaries - Summaries of entities in component
   * @returns Named component
   */
  nameComponent(
    component: DetectedComponent,
    entitySummaries: EntitySummary[]
  ): Promise<NamedComponent>;
}

interface NamedComponent {
  id: ComponentId;
  name: string;
  suggestedPurpose: string;
  confidence: ConfidenceValue;
}
```

### Hybrid Detection

For codebases with clear directory structure, use hybrid detection:

```typescript
/**
 * Hybrid component detection combining structure and graph analysis.
 */
interface HybridComponentDetector {
  /**
   * Detect components using directory structure as hints.
   * Falls back to Louvain when structure is unclear.
   */
  detect(
    graph: DependencyGraph,
    directoryStructure: DirectoryTree,
    options?: HybridOptions
  ): Promise<ComponentDetectionResult>;
}

interface HybridOptions extends LouvainOptions {
  /** Trust directory structure when modularity is above this threshold */
  directoryTrustThreshold?: number;

  /** Depth at which to treat directories as components */
  componentDepth?: number;
}
```

---

## 5. Hierarchical Bootstrap

### Bottom-Up Summarization Pipeline

The hierarchy is built bottom-up: entities -> components -> system.

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: Extract Entities (Level 3)                            │
│ - Parse all files with tree-sitter                              │
│ - Extract functions, classes, interfaces, types                 │
│ - Store full source as Level 3                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: Build Dependency Graph                                 │
│ - Analyze imports/exports                                       │
│ - Build call graph                                              │
│ - Compute edge weights                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: Detect Components                                      │
│ - Run Louvain on dependency graph                               │
│ - Name components using LLM                                     │
│ - Assign entities to components                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: Summarize Entities (Level 3 -> Level 2)               │
│ - LLM summarizes each entity to ~50 tokens                      │
│ - Batch processing for efficiency                               │
│ - Store entity summaries as Level 2                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 5: Summarize Components (Level 2 -> Level 1)             │
│ - LLM summarizes each component from its entity summaries       │
│ - Include dependency information                                │
│ - Store component summaries as Level 1                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 6: Summarize System (Level 1 -> Level 0)                 │
│ - LLM synthesizes system summary from component summaries       │
│ - Identify architecture patterns                                │
│ - Store system summary as Level 0                               │
└─────────────────────────────────────────────────────────────────┘
```

### Entity Summarization Prompt

```typescript
const ENTITY_SUMMARIZATION_PROMPT = `
Summarize this code entity in exactly 50 tokens or less.

Entity: {entity_name}
Type: {entity_kind}
File: {file_path}

Source:
\`\`\`{language}
{source}
\`\`\`

Provide:
1. One-sentence purpose
2. Key behavior (2-3 sentences max)
3. Complexity: trivial/simple/moderate/complex

Format your response as JSON:
{
  "purpose": "...",
  "behavior": "...",
  "complexity": "..."
}
`;
```

### Component Summarization Prompt

```typescript
const COMPONENT_SUMMARIZATION_PROMPT = `
Summarize this code component in exactly 200 tokens or less.

Component: {component_name}
Files: {file_list}
Entity count: {entity_count}

Key entities:
{entity_summaries}

Dependencies: {dependencies}
Dependents: {dependents}

Provide:
1. One-paragraph purpose
2. Public interface summary
3. Internal structure description

Format your response as JSON:
{
  "purpose": "...",
  "publicInterface": ["..."],
  "internalStructure": "..."
}
`;
```

### System Summarization Prompt

```typescript
const SYSTEM_SUMMARIZATION_PROMPT = `
Summarize this codebase in exactly 500 tokens or less.

Components:
{component_summaries}

Language breakdown: {language_breakdown}
Total files: {total_files}
Total entities: {total_entities}

Provide:
1. One-paragraph purpose
2. Architecture description
3. Top 5 patterns used
4. Main entry points

Format your response as JSON:
{
  "purpose": "...",
  "architecture": "...",
  "keyPatterns": ["..."],
  "entryPoints": ["..."]
}
`;
```

---

## 6. Query Strategy

### Progressive Drill-Down Algorithm

```typescript
/**
 * Query strategy: start at system level, drill down as needed.
 *
 * Algorithm:
 * 1. Start with system summary in context
 * 2. Identify relevant components from query
 * 3. Add relevant component summaries
 * 4. Identify relevant entities within components
 * 5. Add entity summaries
 * 6. Expand most relevant entities to full source
 * 7. Stay within token budget at each step
 */
async function progressiveDrillDown(
  query: string,
  hierarchy: HierarchicalKnowledge,
  tokenBudget: number
): Promise<HierarchicalContext> {
  let usedTokens = 0;
  const context: HierarchicalContext = {
    system: hierarchy.systemSummary,
    components: [],
    entitySummaries: [],
    expandedEntities: [],
    navigationHints: [],
    tokenUsage: { used: 0, budget: tokenBudget }
  };

  // Always include system summary
  usedTokens += estimateTokens(context.system);

  // Step 1: Score components for relevance
  const componentScores = await scoreComponents(query, hierarchy.components);

  // Step 2: Add relevant component summaries (up to 5)
  for (const [compId, score] of componentScores.slice(0, 5)) {
    const comp = hierarchy.components.get(compId);
    const tokens = estimateTokens(comp);
    if (usedTokens + tokens < tokenBudget * 0.4) {
      context.components.push(comp);
      usedTokens += tokens;
    }
  }

  // Step 3: Score entities within relevant components
  const relevantEntities = await scoreEntities(
    query,
    context.components.flatMap(c => c.keyEntities),
    hierarchy.entities
  );

  // Step 4: Add entity summaries (up to 20)
  for (const [entityId, score] of relevantEntities.slice(0, 20)) {
    const entity = hierarchy.entities.get(entityId);
    const tokens = estimateTokens(entity);
    if (usedTokens + tokens < tokenBudget * 0.7) {
      context.entitySummaries.push(entity);
      usedTokens += tokens;
    }
  }

  // Step 5: Expand top entities to full source
  for (const [entityId, score] of relevantEntities.slice(0, 5)) {
    const full = await loadFullEntity(entityId);
    const tokens = estimateTokens(full);
    if (usedTokens + tokens < tokenBudget) {
      context.expandedEntities.push(full);
      usedTokens += tokens;
    }
  }

  context.tokenUsage.used = usedTokens;
  context.navigationHints = generateNavigationHints(context, hierarchy);

  return context;
}
```

### Navigation Hints

```typescript
/**
 * Generate hints for follow-up queries.
 */
function generateNavigationHints(
  context: HierarchicalContext,
  hierarchy: HierarchicalKnowledge
): string[] {
  const hints: string[] = [];

  // Suggest unexplored components
  const exploredCompIds = new Set(context.components.map(c => c.id));
  const unexplored = [...hierarchy.components.values()]
    .filter(c => !exploredCompIds.has(c.id))
    .slice(0, 3);

  for (const comp of unexplored) {
    hints.push(`For ${comp.name}: "Tell me about the ${comp.name} component"`);
  }

  // Suggest drilling down on partially explored entities
  for (const summary of context.entitySummaries.slice(0, 3)) {
    if (!context.expandedEntities.find(e => e.id === summary.id)) {
      hints.push(`To see source: "Show me the code for ${summary.name}"`);
    }
  }

  return hints;
}
```

---

## 7. Incremental Updates

### Change Detection

```typescript
interface FileChange {
  path: string;
  type: 'added' | 'modified' | 'deleted';
  affectedEntities: EntityId[];
}

/**
 * Determine what needs updating after code changes.
 */
interface ChangeImpactAnalyzer {
  /**
   * Analyze impact of file changes on hierarchy.
   */
  analyzeImpact(
    changes: FileChange[],
    hierarchy: HierarchicalKnowledge
  ): Promise<HierarchyUpdatePlan>;
}

interface HierarchyUpdatePlan {
  /** Entities that need re-summarization */
  entitiesToUpdate: EntityId[];

  /** Components that need re-summarization */
  componentsToUpdate: ComponentId[];

  /** Whether system summary needs update */
  updateSystemSummary: boolean;

  /** Estimated work */
  estimatedLLMCalls: number;

  /** Confidence in impact analysis */
  confidence: ConfidenceValue;
}
```

### Incremental Update Algorithm

```typescript
/**
 * Update hierarchy incrementally.
 *
 * Strategy:
 * 1. Re-extract changed entities (Level 3)
 * 2. Re-summarize changed entities (Level 2)
 * 3. Re-summarize affected components (Level 1)
 * 4. Re-summarize system if significant changes (Level 0)
 */
async function updateHierarchy(
  existing: HierarchicalKnowledge,
  changes: FileChange[]
): Promise<HierarchicalKnowledge> {
  const plan = await analyzeImpact(changes, existing);

  // Phase 1: Update entities
  for (const entityId of plan.entitiesToUpdate) {
    const newSource = await extractEntity(entityId);
    const newSummary = await summarizeEntity(newSource);
    existing.fullEntities.set(entityId, newSource);
    existing.entities.set(entityId, newSummary);
  }

  // Phase 2: Update components
  for (const compId of plan.componentsToUpdate) {
    const entitySummaries = getComponentEntities(compId, existing.entities);
    const newSummary = await summarizeComponent(compId, entitySummaries);
    existing.components.set(compId, newSummary);
  }

  // Phase 3: Update system if needed
  if (plan.updateSystemSummary) {
    existing.systemSummary = await summarizeSystem(existing.components);
  }

  return existing;
}
```

### Staleness Detection

```typescript
interface StalenessChecker {
  /**
   * Check if hierarchy is stale relative to codebase.
   */
  checkStaleness(
    hierarchy: HierarchicalKnowledge,
    workspacePath: string
  ): Promise<StalenessReport>;
}

interface StalenessReport {
  /** Is hierarchy stale? */
  isStale: boolean;

  /** Files changed since last build */
  changedFiles: string[];

  /** Estimated update cost */
  estimatedUpdateCost: {
    llmCalls: number;
    estimatedTokens: number;
    estimatedTimeMs: number;
  };

  /** Recommendation */
  recommendation: 'rebuild' | 'incremental_update' | 'no_action';

  /** Confidence in staleness assessment */
  confidence: ConfidenceValue;
}
```

---

## 8. Token Budget Management

### Budget Allocation Strategy

```typescript
interface TokenBudgetManager {
  /**
   * Allocate token budget across hierarchy levels.
   */
  allocateBudget(
    totalBudget: number,
    queryType: QueryType
  ): BudgetAllocation;
}

type QueryType =
  | 'overview'      // System-level questions
  | 'component'     // Component-level questions
  | 'implementation'// Code-level questions
  | 'mixed';        // Questions spanning levels

interface BudgetAllocation {
  /** Tokens for system summary */
  level0: number;

  /** Tokens for component summaries */
  level1: number;

  /** Tokens for entity summaries */
  level2: number;

  /** Tokens for full entities */
  level3: number;

  /** Reserve for query and response */
  reserve: number;
}

const DEFAULT_ALLOCATIONS: Record<QueryType, BudgetAllocation> = {
  overview: {
    level0: 500,
    level1: 5000,
    level2: 2000,
    level3: 0,
    reserve: 2500
  },
  component: {
    level0: 500,
    level1: 2000,
    level2: 4000,
    level3: 1000,
    reserve: 2500
  },
  implementation: {
    level0: 500,
    level1: 1000,
    level2: 2000,
    level3: 4000,
    reserve: 2500
  },
  mixed: {
    level0: 500,
    level1: 2000,
    level2: 3000,
    level3: 2000,
    reserve: 2500
  }
};
```

### Token Estimation

```typescript
/**
 * Estimate tokens for different content types.
 *
 * Rough heuristics (calibrated for code):
 * - Average word: 1.3 tokens
 * - Code character: 0.25 tokens
 * - Identifier: 2-4 tokens (camelCase splits)
 */
function estimateTokens(content: unknown): number {
  if (typeof content === 'string') {
    // Code heuristic
    return Math.ceil(content.length * 0.25);
  }

  // JSON stringify for objects
  const json = JSON.stringify(content);
  return Math.ceil(json.length * 0.25);
}
```

---

## 9. Integration Points

### Integration with Track B: Bootstrap

The hierarchical knowledge system integrates with the zero-knowledge bootstrap pipeline:

```typescript
// From track-b-bootstrap.md

/**
 * Bootstrap Phase 5 (Semantic Extraction) produces hierarchical knowledge.
 */
const BOOTSTRAP_PHASE_5: BootstrapPhase = {
  name: 'semantic_extraction',
  goal: 'Extract meaning using LLM reasoning',
  expectedConfidenceType: 'absent',  // LLM synthesis needs calibration
  steps: [
    'Build hierarchical knowledge structure',  // <-- Integration point
    'Summarize entities (Level 3 -> Level 2)',
    'Detect and summarize components (Level 2 -> Level 1)',
    'Synthesize system summary (Level 1 -> Level 0)',
  ],
  outputs: ['hierarchical_knowledge', 'system_summary', 'component_summaries'],
  failureMode: 'If LLM unavailable, stop at structural understanding',
};
```

### Integration with Storage

```typescript
// From track-c-extended.md storage interfaces

interface KnowledgeStorage {
  // Level 0
  getSystemSummary(): Promise<SystemSummary | null>;
  upsertSystemSummary(summary: SystemSummary): Promise<void>;

  // Level 1
  getComponentSummary(id: ComponentId): Promise<ComponentSummary | null>;
  upsertComponentSummary(summary: ComponentSummary): Promise<void>;
  listComponents(): Promise<ComponentSummary[]>;

  // Level 2
  getEntitySummary(id: EntityId): Promise<EntitySummary | null>;
  upsertEntitySummary(summary: EntitySummary): Promise<void>;
  getEntitiesInComponent(compId: ComponentId): Promise<EntitySummary[]>;

  // Level 3 (existing)
  getFunction(id: string): Promise<FunctionKnowledge | null>;
  upsertFunction(fn: FunctionKnowledge): Promise<void>;
}
```

### Integration with Query Pipeline

```typescript
// From api/query.ts

interface EnhancedQueryPipeline {
  /**
   * Query with hierarchical context awareness.
   */
  queryWithHierarchy(
    query: string,
    options?: HierarchicalQueryOptions
  ): Promise<HierarchicalQueryResult>;
}

interface HierarchicalQueryOptions {
  /** Maximum level to drill to */
  maxLevel?: HierarchyLevel;

  /** Token budget for context */
  tokenBudget?: number;

  /** Prefer breadth (more components) or depth (more entities) */
  strategy?: 'breadth' | 'depth' | 'balanced';
}

interface HierarchicalQueryResult {
  /** Standard query results */
  entities: Entity[];

  /** Hierarchical context */
  context: HierarchicalContext;

  /** Confidence in results */
  confidence: ConfidenceValue;
}
```

---

## 10. Implementation Roadmap

### Phase 1: Core Types and Storage (~150 LOC)

```typescript
// Files to create:
// - src/librarian/api/hierarchical_knowledge.ts (types)
// - src/librarian/storage/hierarchy_storage.ts (persistence)

// Deliverables:
// - All type definitions from this spec
// - Storage interface additions
// - Basic serialization/deserialization
```

**Estimated effort**: 1 day

### Phase 2: Component Detection (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/component_detection.ts

// Deliverables:
// - Louvain algorithm implementation
// - Directory-based fallback
// - Hybrid detection
// - Component naming with LLM
```

**Estimated effort**: 2 days

### Phase 3: Entity Summarization (~150 LOC)

```typescript
// Files to create:
// - src/librarian/api/entity_summarizer.ts

// Deliverables:
// - Entity summarization prompts
// - Batch processing for efficiency
// - Token budget enforcement
// - Summary quality validation
```

**Estimated effort**: 1 day

### Phase 4: Component & System Summarization (~150 LOC)

```typescript
// Files to create:
// - src/librarian/api/component_summarizer.ts
// - src/librarian/api/system_summarizer.ts

// Deliverables:
// - Component summarization from entity summaries
// - System summarization from component summaries
// - Dependency graph inclusion
// - Architecture pattern detection
```

**Estimated effort**: 1 day

### Phase 5: Navigator Implementation (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/hierarchy_navigator.ts

// Deliverables:
// - HierarchicalKnowledgeNavigator implementation
// - Progressive drill-down algorithm
// - Token budget management
// - Navigation hint generation
```

**Estimated effort**: 2 days

### Phase 6: Incremental Updates (~100 LOC)

```typescript
// Files to create:
// - src/librarian/api/hierarchy_updater.ts

// Deliverables:
// - Change impact analysis
// - Incremental update algorithm
// - Staleness detection
// - Smart rebuild decisions
```

**Estimated effort**: 1 day

### Phase 7: Integration & Testing (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/__tests__/hierarchical_knowledge.test.ts
// - src/librarian/api/__tests__/component_detection.test.ts

// Deliverables:
// - Bootstrap integration
// - Query pipeline integration
// - Comprehensive tests
// - Documentation
```

**Estimated effort**: 2 days

### Total Estimate

| Phase | LOC | Days |
|-------|-----|------|
| Core Types | 150 | 1 |
| Component Detection | 200 | 2 |
| Entity Summarization | 150 | 1 |
| Component/System Summarization | 150 | 1 |
| Navigator | 200 | 2 |
| Incremental Updates | 100 | 1 |
| Integration & Testing | 200 | 2 |
| **Total** | **~1,150** | **~10** |

---

## Acceptance Criteria

### Core Functionality

- [ ] System summary fits in 500 tokens and is always available
- [ ] Component summaries fit in 200 tokens each, max 50 components
- [ ] Entity summaries fit in 50 tokens each, max 500 per component
- [ ] Full entities load on-demand only
- [ ] Token budget is respected at all times

### Component Detection

- [ ] Louvain algorithm correctly identifies communities
- [ ] Modularity score > 0.3 for well-structured codebases
- [ ] Hybrid detection uses directory hints when modularity is low
- [ ] Components are named meaningfully by LLM

### Query Strategy

- [ ] `queryAtLevel(query, 0)` returns only system summary
- [ ] `queryAtLevel(query, 3)` includes relevant full entities
- [ ] `getOptimalContext()` stays within token budget
- [ ] Navigation hints are actionable and relevant

### Incremental Updates

- [ ] Changes to single entity don't trigger full rebuild
- [ ] Component re-summarization only when needed
- [ ] System re-summarization only for significant changes
- [ ] Staleness detection is accurate

### Confidence

- [ ] All confidence values use `ConfidenceValue` type
- [ ] LLM-generated summaries use `absent` confidence until calibrated
- [ ] Detection confidence reflects modularity score
- [ ] No raw numeric confidence values

---

## Evidence Commands

```bash
# Run hierarchical knowledge tests
cd packages/librarian && npx vitest run src/api/__tests__/hierarchical_knowledge.test.ts

# Run component detection tests
cd packages/librarian && npx vitest run src/api/__tests__/component_detection.test.ts

# Verify exports
node -e "import('librarian').then(m => console.log(Object.keys(m).filter(k => k.includes('Hierarchy'))))"

# Build hierarchy for a real codebase (when implemented)
cd packages/librarian && npx tsx src/cli/index.ts build-hierarchy /path/to/codebase

# Check implementation status
ls -la packages/librarian/src/api/hierarchical_knowledge.ts
ls -la packages/librarian/src/api/component_detection.ts
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification extracted from THEORETICAL_CRITIQUE.md Part XVII.B |
