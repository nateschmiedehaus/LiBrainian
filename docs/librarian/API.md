# Librarian API Reference

> **Comprehensive guide for agents to use the Librarian API**
>
> The Librarian provides epistemological infrastructure for agentic code understanding.
> This document covers all API methods, data structures, and usage patterns.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Initialization](#initialization)
3. [Query API](#query-api)
4. [Knowledge Assembly](#knowledge-assembly)
5. [Bootstrap API](#bootstrap-api)
6. [Context Packs](#context-packs)
7. [Feedback and Learning](#feedback-and-learning)
8. [File Watching and Re-indexing](#file-watching-and-re-indexing)
9. [Visualization](#visualization)
10. [Advanced Usage Patterns](#advanced-usage-patterns)
11. [Technique Catalog and Planning](#technique-catalog-and-planning)
12. [Data Structures Reference](#data-structures-reference)
13. [Error Handling](#error-handling)
14. [Epistemics API](#epistemics-api)
15. [Resource Management API](#resource-management-api)

---

## Quick Start

```typescript
import { Librarian } from 'librarian';

// Initialize the librarian
const librarian = new Librarian({
  workspace: '/path/to/codebase',
  autoBootstrap: true,
  llmProvider: 'claude',
  llmModelId: 'claude-opus-4-5-20251101'
});

await librarian.initialize();

// Query for understanding
const response = await librarian.query({
  intent: "How does the authentication module work?",
  depth: 'L2'
});

console.log(response.synthesis?.answer);
console.log(response.packs.map(p => p.summary));
```

---

## Initialization

### Constructor Options

```typescript
interface LibrarianOptions {
  workspace: string;              // Path to codebase root
  autoBootstrap?: boolean;        // Auto-run bootstrap if needed (default: true)
  autoWatch?: boolean;            // Auto-watch for file changes (default: false)
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
  embeddingProvider?: 'xenova' | 'sentence-transformers';
  bootstrapMode?: 'fast' | 'full';
  governorConfig?: GovernorConfig;
  onProgress?: (phase: string, progress: number, message?: string) => void;
}
```

### Initialization Methods

```typescript
// Full initialization (runs bootstrap if needed)
await librarian.initialize();

// Check if ready
if (librarian.isReady()) {
  // Librarian is bootstrapped and ready for queries
}

// Get detailed status
const status = librarian.getStatus();
// Returns: { initialized, bootstrapped, version, stats, watching, errors }
```

### Status Structure

```typescript
interface LibrarianStatus {
  initialized: boolean;
  bootstrapped: boolean;
  version: LibrarianVersion;
  stats: {
    totalFiles: number;
    totalFunctions: number;
    totalModules: number;
    totalContextPacks: number;
    totalEmbeddings: number;
  };
  watching: boolean;
  errors: string[];
}
```

---

## Query API

### Primary Query Method

```typescript
const response = await librarian.query(query: LibrarianQuery): Promise<LibrarianResponse>;
```

### Query Structure

```typescript
interface LibrarianQuery {
  intent: string;                   // Natural language question or goal
  affectedFiles?: string[];         // Files to focus on
  depth?: 'L0' | 'L1' | 'L2' | 'L3';
  taskType?: 'understand' | 'refactor' | 'debug' | 'optimize' | 'review';
  minConfidence?: number;           // Filter packs below threshold (0-1)
  includeEngines?: boolean;         // Include constraint/relevance engines
  excludePackTypes?: ContextPackType[];
}
```

### Query Depth Levels

| Depth | Scope | Performance | Use Case |
|-------|-------|-------------|----------|
| **L0** | Direct target only | Fast | Quick lookup, cached results |
| **L1** | Target + semantic neighbors | Standard | Most common use case |
| **L2** | L1 + graph expansion, co-change | Moderate | Impact analysis, refactoring |
| **L3** | L2 + communities, cross-module | Comprehensive | Architecture review |

### Response Structure

```typescript
interface LibrarianResponse {
  packs: ContextPack[];              // Pre-computed knowledge packs
  totalConfidence: number;           // Geometric mean of pack confidences
  synthesis?: SynthesizedResponse;   // LLM-generated understanding
  drillDownHints: string[];          // Suggested follow-up queries
  methodHints?: string[];            // Methodology guidance
  calibration?: ConfidenceCalibrationSummary;
  uncertainty?: UncertaintyMetrics;
  engines?: LibrarianEngineResults;
  feedbackToken?: string;            // Token for recording outcomes
}
```

### Query Helpers

```typescript
// Pre-built query creators
import { createFunctionQuery, createFileQuery, createRelatedQuery } from 'librarian';

// Query about a specific function
const response = await librarian.query(
  createFunctionQuery('validateEmail', 'src/utils/validators.ts')
);

// Query about a file
const response = await librarian.query(
  createFileQuery('src/auth/authenticate.ts')
);

// Query with related context
const response = await librarian.query(
  createRelatedQuery('authentication flow', ['src/auth/', 'src/user/'])
);
```

---

## Knowledge Assembly

### Assemble Raw Context

For agents that need raw knowledge graphs before synthesis:

```typescript
const context = await librarian.assembleContext(
  query: LibrarianQuery,
  options?: { level?: DepthLevel; workspace?: string }
): Promise<AgentKnowledgeContext>;
```

### Knowledge Context Structure

```typescript
interface AgentKnowledgeContext {
  required: {
    targetFiles: FileKnowledge[];
    callGraph: CallGraphData;
    importGraph: ImportGraphData;
    testMapping: TestMappingData;
    ownerMapping: OwnerMappingData;
  };
  supplementary: {
    relatedFiles: FileReference[];
    recentChanges: ChangeRecord[];
    patterns: PatternMatch[];
    antiPatterns: AntiPatternMatch[];
    similarTasks: TaskRecord[];
    knowledgeSources: KnowledgeSource[];
  };
  coverage: {
    percentage: number;
    gaps: CoverageGap[];
    lowConfidence: LowConfidenceArea[];
  };
  query: QueryInterface;  // For drill-down queries
}
```

### Query Interface Methods

```typescript
// Available on context.query
context.query.queryIntent(intent: string): Promise<LibrarianResponse>;
context.query.queryFile(path: string): Promise<LibrarianResponse>;
context.query.queryFunction(name: string, file: string): Promise<LibrarianResponse>;
context.query.querySimilar(snippet: string, limit?: number): Promise<SimilarMatch[]>;
context.query.search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
```

### Direct Knowledge Query

```typescript
const knowledge = await librarian.queryKnowledge({
  entityId: string;
  kind: 'function' | 'module' | 'file' | 'directory';
}): Promise<EntityKnowledge>;
```

---

## Bootstrap API

### Check Bootstrap Status

```typescript
import { isBootstrapRequired } from 'librarian';

const { required, reason } = await isBootstrapRequired(
  workspace: string,
  storage: LibrarianStorage,
  options?: { targetQualityTier?: 'mvp' | 'full' }
);
```

### Bootstrap Configuration

```typescript
interface BootstrapConfig {
  workspace: string;
  bootstrapMode?: 'fast' | 'full';
  include?: string[];               // Glob patterns to include
  exclude?: string[];               // Glob patterns to exclude
  maxFileSizeBytes?: number;        // Skip files larger than this
  llmProvider: 'claude' | 'codex';
  llmModelId: string;
  timeoutMs?: number;               // 0 = no timeout
  progressCallback?: (phase: BootstrapPhase, progress: number) => void;
  skipProviderProbe?: boolean;      // Skip slow provider check
}
```

### Bootstrap Modes

| Mode | LLM Usage | Duration | Best For |
|------|-----------|----------|----------|
| **fast** | Minimal (fallback only) | 5-15 min | Quick indexing, development |
| **full** | Per-entity analysis | 30-60 min | Production, comprehensive docs |

### Bootstrap Phases

```typescript
const BOOTSTRAP_PHASES = [
  { name: 'structural_scan',        weight: 15 },  // File discovery, ingestion
  { name: 'semantic_indexing',      weight: 50 },  // AST parsing, embeddings
  { name: 'relationship_mapping',   weight: 15 },  // Call/import graphs
  { name: 'context_pack_generation', weight: 15 }, // Pre-compute context packs
  { name: 'knowledge_generation',   weight: 5 },   // Universal knowledge (full only)
];
```

### Bootstrap Report

```typescript
interface BootstrapReport {
  workspace: string;
  startedAt: Date;
  completedAt: Date | null;
  phases: BootstrapPhaseResult[];
  totalFilesProcessed: number;
  totalFunctionsIndexed: number;
  totalContextPacksCreated: number;
  version: LibrarianVersion;
  success: boolean;
  error?: string;
  capabilities?: BootstrapCapabilities;
  statusSummary?: string;
  nextSteps?: string[];
  warnings?: string[];
}
```

### Manual Bootstrap

```typescript
import { bootstrapProject } from 'librarian';

const report = await bootstrapProject(config, storage);

if (report.success) {
  console.log(`Indexed ${report.totalFunctionsIndexed} functions`);
} else {
  console.error(`Bootstrap failed: ${report.error}`);
}
```

---

## Context Packs

### Context Pack Types

```typescript
type ContextPackType =
  | 'function_context'   // Single function's purpose, implementation, callers
  | 'module_context'     // Module's exports, dependencies, cohesion
  | 'pattern_context'    // Design patterns, coding conventions
  | 'decision_context'   // ADRs, architectural decisions
  | 'change_impact'      // What changes when this entity changes
  | 'similar_tasks'      // Historical tasks affecting similar code
  | 'test_context'       // Test coverage, test patterns
  | 'security_context';  // Security considerations, vulnerabilities
```

### Context Pack Structure

```typescript
interface ContextPack {
  packId: string;                 // Unique ID for feedback
  packType: ContextPackType;
  summary: string;                // LLM-generated summary
  keyFacts: string[];             // Critical facts
  codeSnippets: CodeSnippet[];    // Inline code with line numbers
  relatedFiles: string[];         // Related files
  confidence: number;             // 0-1, Bayesian-updated
  targetId: string;               // Entity this pack explains
  createdAt: Date;
  version: LibrarianVersion;
  evidence?: EvidenceEntry[];     // Sources backing claims
}

interface CodeSnippet {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  purpose?: string;
}
```

### Fetch Specific Pack

```typescript
const pack = await librarian.getContextPack(
  entityId: string,
  packType: ContextPackType
): Promise<ContextPack | null>;
```

### Search Packs

```typescript
const packs = await librarian.searchPacks({
  query?: string;
  packTypes?: ContextPackType[];
  minConfidence?: number;
  limit?: number;
  offset?: number;
}): Promise<ContextPack[]>;
```

---

## Feedback and Learning

### Record Query Outcome

The Librarian learns from agent feedback using Bayesian confidence updates.

```typescript
// After using a pack, report the outcome
await librarian.recordOutcome(
  packId: string,
  outcome: 'success' | 'failure'
);
```

### Confidence Updates

| Outcome | Update | Bounds |
|---------|--------|--------|
| Success | +0.1 | Max 0.95 |
| Failure | -0.2 | Min 0.10 |

### Feedback Token Flow

```typescript
// 1. Make a query
const response = await librarian.query({ intent: "..." });

// 2. Use the response in your task
const result = await performTask(response);

// 3. Record outcome with token
await librarian.recordOutcome(response.feedbackToken, result.success ? 'success' : 'failure');
```

### Query Staleness Validation

```typescript
// Check if knowledge is still valid
const validation = await librarian.validateKnowledge(entityId: string);

// Returns:
// - activeDefeaters: number of triggered invalidations
// - knowledgeValid: boolean
// - confidenceAdjustment: number
```

---

## File Watching and Re-indexing

### Start/Stop Watching

```typescript
// Start watching for changes
librarian.startWatching();

// Stop watching
librarian.stopWatching();

// Check status
const isWatching = librarian.isWatching();
```

### Manual Re-indexing

```typescript
// Re-index specific files
await librarian.reindexFiles([
  'src/modified_file.ts',
  'src/affected_module.ts'
]);
```

### Incremental Update

```typescript
// Update after git pull or branch switch
await librarian.incrementalUpdate({
  changedFiles: ['src/a.ts', 'src/b.ts'],
  deletedFiles: ['src/old.ts'],
  newFiles: ['src/new.ts']
});
```

---

## Visualization

### Mermaid Diagrams

```typescript
const diagram = await librarian.visualize({
  type: 'call_graph' | 'import_graph' | 'architecture';
  focusPath?: string;
  depth?: number;
  includeExternal?: boolean;
}): Promise<{ markdown: string; title: string }>;
```

### ASCII Visualization

```typescript
const ascii = await librarian.visualizeASCII(
  type: 'tree' | 'health_summary' | 'dependency_matrix',
  focusPath?: string
): Promise<string>;
```

### Example Diagrams

```typescript
// Call graph for a function
const callGraph = await librarian.visualize({
  type: 'call_graph',
  focusPath: 'src/auth/authenticate.ts',
  depth: 2
});

// Import graph for a module
const imports = await librarian.visualize({
  type: 'import_graph',
  focusPath: 'src/utils/',
  depth: 3
});
```

---

## Advanced Usage Patterns

### Pattern 1: Understand Before Modifying

```typescript
async function understandBeforeModify(filePath: string) {
  // 1. Get comprehensive context
  const context = await librarian.assembleContext({
    intent: `Understand ${filePath} before modification`,
    affectedFiles: [filePath],
    depth: 'L2'
  });

  // 2. Check test coverage
  const testMapping = context.required.testMapping;
  console.log(`Test coverage: ${testMapping.coverage}%`);

  // 3. Check callers/dependents
  const callers = context.required.callGraph.getCallersOf(filePath);
  console.log(`Files that depend on this: ${callers.length}`);

  // 4. Check recent changes
  const changes = context.supplementary.recentChanges;
  console.log(`Recent changes: ${changes.length} in last 30 days`);

  return context;
}
```

### Pattern 2: Safe Refactoring

```typescript
async function planRefactor(target: string, change: string) {
  // 1. Deep context for impact analysis
  const response = await librarian.query({
    intent: `Plan refactoring: ${change}`,
    affectedFiles: [target],
    taskType: 'refactor',
    depth: 'L3'
  });

  // 2. Get impact assessment
  const impactPacks = response.packs.filter(p => p.packType === 'change_impact');

  // 3. Get test context
  const testPacks = response.packs.filter(p => p.packType === 'test_context');

  return {
    impactedFiles: impactPacks.flatMap(p => p.relatedFiles),
    testsToRun: testPacks.flatMap(p => p.codeSnippets),
    confidence: response.totalConfidence,
    risks: response.synthesis?.uncertainties
  };
}
```

### Pattern 3: Debug Investigation

```typescript
async function investigateBug(errorLocation: string, errorMessage: string) {
  // 1. Query with debug context
  const response = await librarian.query({
    intent: `Why might "${errorMessage}" occur at ${errorLocation}?`,
    affectedFiles: [errorLocation],
    taskType: 'debug',
    depth: 'L2'
  });

  // 2. Find similar past issues
  const similarTasks = await librarian.searchPacks({
    query: errorMessage,
    packTypes: ['similar_tasks']
  });

  // 3. Check recent changes in area
  const context = await librarian.assembleContext({
    intent: 'Recent changes near error',
    affectedFiles: [errorLocation],
    depth: 'L1'
  });

  return {
    possibleCauses: response.synthesis?.keyInsights,
    similarIssues: similarTasks,
    recentChanges: context.supplementary.recentChanges,
    relatedCode: response.packs
  };
}
```

### Pattern 4: Code Review Assistant

```typescript
async function reviewChanges(changedFiles: string[]) {
  const reviews = await Promise.all(
    changedFiles.map(async (file) => {
      const response = await librarian.query({
        intent: `Review changes to ${file}`,
        affectedFiles: [file],
        taskType: 'review',
        depth: 'L2',
        includeEngines: true
      });

      return {
        file,
        patterns: response.packs.filter(p => p.packType === 'pattern_context'),
        antiPatterns: response.engines?.relevance?.antiPatterns,
        testGaps: response.packs
          .filter(p => p.packType === 'test_context')
          .flatMap(p => p.keyFacts.filter(f => f.includes('missing'))),
        confidence: response.totalConfidence
      };
    })
  );

  return reviews;
}
```

### Pattern 5: Architecture Discovery

```typescript
async function discoverArchitecture() {
  // 1. Get high-level overview
  const diagram = await librarian.visualize({
    type: 'architecture',
    depth: 1
  });

  // 2. Identify key modules
  const response = await librarian.query({
    intent: 'What are the main architectural components and their responsibilities?',
    depth: 'L3'
  });

  // 3. Get decision history
  const decisions = await librarian.searchPacks({
    packTypes: ['decision_context'],
    limit: 20
  });

  return {
    diagram: diagram.markdown,
    components: response.synthesis?.answer,
    decisions: decisions.map(d => d.summary),
    patterns: response.packs.filter(p => p.packType === 'pattern_context')
  };
}
```

### Pattern 6: Semantic Code Search

```typescript
async function findSimilarCode(codeSnippet: string) {
  // 1. Generate embedding for the snippet
  const embedding = await librarian.embedIntent(codeSnippet);

  // 2. Find semantically similar code
  const context = await librarian.assembleContext({
    intent: codeSnippet,
    depth: 'L1'
  });

  const similar = await context.query.querySimilar(codeSnippet, 10);

  return similar.map(match => ({
    file: match.filePath,
    function: match.functionName,
    similarity: match.score,
    snippet: match.content
  }));
}
```

### Pattern 7: Chained Queries for Deep Understanding

```typescript
async function deepUnderstanding(topic: string) {
  // 1. Initial broad query
  const initial = await librarian.query({
    intent: topic,
    depth: 'L1'
  });

  // 2. Follow drill-down hints
  const drillDownResults = await Promise.all(
    initial.drillDownHints.slice(0, 3).map(hint =>
      librarian.query({ intent: hint, depth: 'L1' })
    )
  );

  // 3. Deep dive on most relevant
  const mostRelevant = drillDownResults
    .sort((a, b) => b.totalConfidence - a.totalConfidence)[0];

  const deepDive = await librarian.query({
    intent: `Explain in detail: ${mostRelevant?.synthesis?.answer?.slice(0, 100)}`,
    affectedFiles: mostRelevant?.packs.flatMap(p => p.relatedFiles).slice(0, 5),
    depth: 'L3'
  });

  return {
    overview: initial.synthesis,
    related: drillDownResults.map(r => r.synthesis?.answer),
    detailed: deepDive.synthesis
  };
}
```

---

## Technique Catalog and Planning

The technique catalog models primitives (atomic actions), operator graphs (control/data flow), and
relationship semantics (dependencies and evidence links). These compile deterministically into
WorkHierarchy plans with verification gates.

### Listing Primitives, Compositions, and Packages

```typescript
import {
  DEFAULT_TECHNIQUE_PRIMITIVES,
  DEFAULT_TECHNIQUE_COMPOSITIONS,
  listTechniquePackages,
  compileTechniquePackageBundleById,
} from 'librarian';

const primitives = DEFAULT_TECHNIQUE_PRIMITIVES;
const compositions = DEFAULT_TECHNIQUE_COMPOSITIONS;
const packages = listTechniquePackages();

const bundle = compileTechniquePackageBundleById('tpkg_quality_safety');
```

### Semantic Profiles, Operators, and Relationships

```typescript
import {
  TECHNIQUE_SEMANTIC_PROFILE_IDS,
  getTechniqueSemanticProfile,
  TECHNIQUE_OPERATOR_TYPES,
  TECHNIQUE_RELATIONSHIP_TYPES,
  getOperatorSemantics,
  getRelationshipSemantics,
  registerOperatorSemantics,
  lockTechniqueSemanticsRegistry,
} from 'librarian';

const profile = getTechniqueSemanticProfile('verification');
const operatorSemantics = getOperatorSemantics('gate');
const relationshipSemantics = getRelationshipSemantics('depends_on');

// Custom operators use the custom: prefix and should be registered at startup.
registerOperatorSemantics('custom:batch', {
  role: 'control',
  description: 'Batch inputs before processing.',
  compile: 'checkpoint',
  minInputs: 1,
  minOutputs: 0,
  requiredParameters: ['batchSize'],
});
lockTechniqueSemanticsRegistry();
```

### Plan Compilation

```typescript
const plans = await librarian.planWork('prepare a release readiness assessment');
const plan = plans[0];
console.log(plan.workHierarchy.root.title);
```

Package IDs use the `tpkg_` prefix and lowercase/underscore naming. Technique operator and
relationship IDs are validated and compiled into deterministic dependency graphs.

---

## Data Structures Reference

### Synthesized Response

```typescript
interface SynthesizedResponse {
  answer: string;                    // Main response text
  confidence: number;                // 0-1
  citations: Citation[];             // Sources for claims
  keyInsights: string[];             // Bullet-point insights
  uncertainties: string[];           // Known gaps/limitations
  suggestedActions: string[];        // Recommended next steps
}
```

### Call Graph Data

```typescript
interface CallGraphData {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];

  getCallersOf(entityId: string): CallGraphNode[];
  getCalleesOf(entityId: string): CallGraphNode[];
  getCallChain(from: string, to: string): CallGraphPath[];
}
```

### Import Graph Data

```typescript
interface ImportGraphData {
  nodes: ImportGraphNode[];
  edges: ImportGraphEdge[];

  getDependenciesOf(filePath: string): string[];
  getDependentsOf(filePath: string): string[];
  getCycles(): string[][];
}
```

### Test Mapping Data

```typescript
interface TestMappingData {
  mappings: TestMapping[];
  coverage: number;

  getTestsFor(filePath: string): TestFile[];
  getCoverageFor(functionName: string): number;
}
```

### Engine Results

```typescript
interface LibrarianEngineResults {
  constraint: {
    violations: ConstraintViolation[];
    warnings: ConstraintWarning[];
  };
  relevance: {
    scores: Map<string, number>;
    reasoning: string[];
    antiPatterns: AntiPatternMatch[];
  };
  meta: {
    confidence: number;
    calibration: CalibrationMetrics;
    sources: DataSource[];
  };
}
```

---

## Error Handling

### Common Errors

```typescript
// Bootstrap required
try {
  await librarian.query({ intent: "..." });
} catch (error) {
  if (error.message.includes('not bootstrapped')) {
    await librarian.initialize();
    // Retry query
  }
}

// Provider unavailable
try {
  await librarian.query({ intent: "..." });
} catch (error) {
  if (error.message.includes('ProviderUnavailableError')) {
    // LLM provider is down - synthesis unavailable
    // Packs may still be available from cache
  }
}

// Low confidence
const response = await librarian.query({ intent: "...", minConfidence: 0.7 });
if (response.packs.length === 0) {
  // No packs meet confidence threshold
  // Try with lower threshold or deeper query
}
```

### Error Types

```typescript
// Unrecoverable errors
class BootstrapRequiredError extends Error {}
class ProviderUnavailableError extends Error {}
class StorageError extends Error {}

// Recoverable errors (retry may help)
class TimeoutError extends Error {}
class RateLimitError extends Error {}
class EmbeddingError extends Error {}
```

---

## Performance Tips

1. **Use appropriate depth**: Start with L1, only go deeper if needed
2. **Filter by pack type**: Exclude unnecessary pack types
3. **Set minConfidence**: Skip low-confidence packs
4. **Batch queries**: Use `assembleContext` for multiple related queries
5. **Cache responses**: Response objects are serializable
6. **Use feedback**: Recording outcomes improves future query quality

---

## Version Compatibility

```typescript
interface LibrarianVersion {
  major: number;
  minor: number;
  patch: number;
  qualityTier: 'mvp' | 'full';
  string: string;  // e.g., "1.2.3-full"
}

// Check version
const status = librarian.getStatus();
console.log(`Version: ${status.version.string}`);
```

---

## Methodologies by Project Scale

### Small Projects (< 50 files)

For small projects, use lightweight queries with minimal depth:

```typescript
async function smallProjectWorkflow(task: string) {
  // Simple L1 queries are sufficient
  const response = await librarian.query({
    intent: task,
    depth: 'L1'  // Don't over-query small codebases
  });

  // Direct file access is often faster
  if (response.packs.length < 3) {
    // Fall back to direct file reading
    const files = response.packs.flatMap(p => p.relatedFiles);
    return { packs: response.packs, directFiles: files };
  }

  return response;
}
```

### Medium Codebases (50-500 files)

Standard workflow with balanced depth:

```typescript
async function mediumProjectWorkflow(task: string, focusArea?: string) {
  // L2 depth captures most dependencies
  const response = await librarian.query({
    intent: task,
    affectedFiles: focusArea ? [focusArea] : undefined,
    depth: 'L2',
    taskType: inferTaskType(task)
  });

  // Use test mapping for confidence
  const context = await librarian.assembleContext({
    intent: task,
    depth: 'L1'
  });

  return {
    understanding: response.synthesis,
    impactRadius: context.required.callGraph,
    testCoverage: context.required.testMapping.coverage
  };
}
```

### Large Codebases (500-5000 files)

Focused queries with strategic depth escalation:

```typescript
async function largeProjectWorkflow(task: string, knownScope?: string[]) {
  // Start narrow, expand only if needed
  let response = await librarian.query({
    intent: task,
    affectedFiles: knownScope,
    depth: 'L1',
    minConfidence: 0.6  // Filter noise in large codebases
  });

  // Check if we need deeper analysis
  if (response.totalConfidence < 0.7 || response.packs.length < 2) {
    response = await librarian.query({
      intent: task,
      affectedFiles: knownScope,
      depth: 'L2',
      minConfidence: 0.5
    });
  }

  // For cross-cutting concerns, go L3
  if (task.includes('architecture') || task.includes('refactor')) {
    const deepContext = await librarian.assembleContext({
      intent: task,
      depth: 'L3'
    });
    return { response, deepContext };
  }

  return { response };
}
```

### Monorepos and Multi-Package

Handle package boundaries explicitly:

```typescript
async function monorepoWorkflow(task: string, packages: string[]) {
  // Query each package separately first
  const packageResults = await Promise.all(
    packages.map(pkg => librarian.query({
      intent: task,
      affectedFiles: [`${pkg}/`],
      depth: 'L2'
    }))
  );

  // Find cross-package dependencies
  const crossPackageContext = await librarian.assembleContext({
    intent: `Cross-package dependencies for: ${task}`,
    affectedFiles: packages.map(p => `${p}/`),
    depth: 'L3'
  });

  // Identify shared code
  const sharedDeps = crossPackageContext.required.importGraph
    .edges.filter(e =>
      packages.some(p1 => e.from.startsWith(p1)) &&
      packages.some(p2 => e.to.startsWith(p2) && p2 !== p1)
    );

  return {
    byPackage: Object.fromEntries(
      packages.map((pkg, i) => [pkg, packageResults[i]])
    ),
    crossPackageDeps: sharedDeps,
    sharedPatterns: crossPackageContext.supplementary.patterns
  };
}
```

### Microservices Architecture

Query service boundaries and contracts:

```typescript
async function microservicesWorkflow(task: string, services: string[]) {
  // Map service to directory
  const serviceQueries = services.map(async (service) => {
    const response = await librarian.query({
      intent: `${task} in ${service} service`,
      affectedFiles: [`services/${service}/`],
      depth: 'L2'
    });

    // Get API contracts
    const apiPacks = await librarian.searchPacks({
      query: `${service} API contract interface`,
      packTypes: ['pattern_context', 'module_context']
    });

    return { service, response, apiPacks };
  });

  const results = await Promise.all(serviceQueries);

  // Find inter-service communication
  const interServiceContext = await librarian.query({
    intent: 'Inter-service communication patterns and dependencies',
    depth: 'L3'
  });

  return {
    services: results,
    communication: interServiceContext.synthesis,
    contracts: results.flatMap(r => r.apiPacks)
  };
}
```

---

## Methodologies by Development Phase

### Greenfield Development

When starting fresh, discover patterns and establish conventions:

```typescript
async function greenfieldSetup(projectDescription: string) {
  // Analyze similar existing patterns
  const patterns = await librarian.query({
    intent: `Best patterns for: ${projectDescription}`,
    depth: 'L2'
  });

  // Get architectural templates
  const architecture = await librarian.searchPacks({
    packTypes: ['pattern_context', 'decision_context'],
    limit: 20
  });

  // Identify reusable utilities
  const utilities = await librarian.query({
    intent: 'Reusable utilities and shared code',
    depth: 'L1'
  });

  return {
    recommendedPatterns: patterns.synthesis?.keyInsights,
    architecturalDecisions: architecture.map(p => p.summary),
    reusableCode: utilities.packs.map(p => ({
      name: p.targetId,
      purpose: p.summary,
      location: p.relatedFiles[0]
    }))
  };
}
```

### Maintenance Mode

Focus on stability and understanding existing behavior:

```typescript
async function maintenanceWorkflow(bugReport: string, affectedArea: string) {
  // 1. Understand current behavior
  const currentBehavior = await librarian.query({
    intent: `How does ${affectedArea} currently work?`,
    affectedFiles: [affectedArea],
    depth: 'L2'
  });

  // 2. Find related bugs and fixes
  const similarIssues = await librarian.searchPacks({
    query: bugReport,
    packTypes: ['similar_tasks'],
    limit: 10
  });

  // 3. Identify regression risks
  const regressionRisks = await librarian.query({
    intent: `What could break if ${affectedArea} is modified?`,
    affectedFiles: [affectedArea],
    taskType: 'refactor',
    depth: 'L3'
  });

  // 4. Get test requirements
  const testContext = await librarian.assembleContext({
    intent: bugReport,
    affectedFiles: [affectedArea],
    depth: 'L1'
  });

  return {
    currentBehavior: currentBehavior.synthesis,
    similarIssues: similarIssues.map(p => p.summary),
    regressionRisks: regressionRisks.packs.filter(p =>
      p.packType === 'change_impact'
    ),
    requiredTests: testContext.required.testMapping.getTestsFor(affectedArea)
  };
}
```

### Legacy Modernization

Understand and safely transform legacy code:

```typescript
async function legacyModernizationWorkflow(legacyModule: string) {
  // 1. Deep understanding of legacy code
  const legacyUnderstanding = await librarian.assembleContext({
    intent: `Comprehensive understanding of ${legacyModule}`,
    affectedFiles: [legacyModule],
    depth: 'L3'
  });

  // 2. Identify all dependencies (incoming and outgoing)
  const dependencyAnalysis = {
    dependsOn: legacyUnderstanding.required.importGraph.getDependenciesOf(legacyModule),
    dependedOnBy: legacyUnderstanding.required.importGraph.getDependentsOf(legacyModule),
    callsTo: legacyUnderstanding.required.callGraph.getCalleesOf(legacyModule),
    calledBy: legacyUnderstanding.required.callGraph.getCallersOf(legacyModule)
  };

  // 3. Find anti-patterns and technical debt
  const techDebt = await librarian.query({
    intent: `Technical debt and anti-patterns in ${legacyModule}`,
    affectedFiles: [legacyModule],
    includeEngines: true,
    depth: 'L2'
  });

  // 4. Plan incremental migration
  const migrationPlan = await librarian.query({
    intent: `How to safely modernize ${legacyModule} incrementally?`,
    affectedFiles: [legacyModule, ...dependencyAnalysis.dependedOnBy.slice(0, 5)],
    taskType: 'refactor',
    depth: 'L3'
  });

  // 5. Identify strangler fig boundaries
  const boundaries = legacyUnderstanding.required.callGraph.edges
    .filter(e => e.from.includes(legacyModule) || e.to.includes(legacyModule))
    .map(e => ({ from: e.from, to: e.to, canBeIsolated: e.callCount < 5 }));

  return {
    understanding: legacyUnderstanding,
    dependencies: dependencyAnalysis,
    techDebt: techDebt.engines?.relevance?.antiPatterns,
    migrationPlan: migrationPlan.synthesis,
    isolationBoundaries: boundaries.filter(b => b.canBeIsolated)
  };
}
```

---

## Task-Specific Workflows

### Feature Development

Complete workflow from planning to implementation:

```typescript
async function featureDevelopmentWorkflow(featureSpec: string) {
  // Phase 1: Discovery
  const discovery = await librarian.query({
    intent: `Where and how to implement: ${featureSpec}`,
    depth: 'L2'
  });

  // Phase 2: Find similar implementations
  const similar = await librarian.searchPacks({
    query: featureSpec,
    packTypes: ['similar_tasks', 'pattern_context'],
    limit: 10
  });

  // Phase 3: Identify integration points
  const integrationPoints = discovery.packs
    .filter(p => p.packType === 'module_context')
    .flatMap(p => p.relatedFiles);

  // Phase 4: Get patterns to follow
  const patterns = await librarian.query({
    intent: `Patterns and conventions to follow for: ${featureSpec}`,
    affectedFiles: integrationPoints.slice(0, 5),
    depth: 'L1'
  });

  // Phase 5: Impact analysis
  const impact = await librarian.assembleContext({
    intent: featureSpec,
    affectedFiles: integrationPoints,
    depth: 'L2'
  });

  // Phase 6: Test strategy
  const testStrategy = await librarian.query({
    intent: `Test strategy for: ${featureSpec}`,
    affectedFiles: integrationPoints,
    taskType: 'review',
    depth: 'L1'
  });

  return {
    whereToImplement: discovery.synthesis?.suggestedActions,
    examples: similar.map(p => ({ file: p.relatedFiles[0], summary: p.summary })),
    patternsToFollow: patterns.packs.filter(p => p.packType === 'pattern_context'),
    filesToModify: integrationPoints,
    testPlan: testStrategy.synthesis?.keyInsights,
    impactedAreas: impact.coverage.gaps
  };
}
```

### Bug Investigation

Systematic debugging workflow:

```typescript
async function bugInvestigationWorkflow(
  errorMessage: string,
  stackTrace?: string,
  reproSteps?: string
) {
  // Step 1: Parse error location from stack trace
  const errorLocations = stackTrace
    ? parseStackTrace(stackTrace)
    : [];

  // Step 2: Understand error context
  const errorContext = await librarian.query({
    intent: `Why might this error occur: ${errorMessage}`,
    affectedFiles: errorLocations,
    taskType: 'debug',
    depth: 'L2'
  });

  // Step 3: Find similar past bugs
  const pastBugs = await librarian.searchPacks({
    query: errorMessage,
    packTypes: ['similar_tasks'],
    limit: 15
  });

  // Step 4: Trace data flow
  const dataFlow = await librarian.assembleContext({
    intent: `Data flow leading to: ${errorMessage}`,
    affectedFiles: errorLocations,
    depth: 'L3'
  });

  // Step 5: Check recent changes
  const recentChanges = dataFlow.supplementary.recentChanges
    .filter(c => errorLocations.some(loc => c.files.includes(loc)));

  // Step 6: Find edge cases
  const edgeCases = await librarian.query({
    intent: `Edge cases and boundary conditions for ${errorLocations[0]}`,
    affectedFiles: errorLocations,
    depth: 'L1'
  });

  // Step 7: Generate hypotheses
  const hypotheses = [
    ...errorContext.synthesis?.keyInsights || [],
    ...pastBugs.slice(0, 3).map(p => `Similar issue: ${p.summary}`),
    ...recentChanges.slice(0, 3).map(c => `Recent change: ${c.message}`)
  ];

  return {
    likelyCause: errorContext.synthesis?.answer,
    hypotheses,
    pastSimilarBugs: pastBugs.map(p => p.summary),
    suspiciousRecentChanges: recentChanges,
    edgeCasesToCheck: edgeCases.synthesis?.keyInsights,
    callChain: dataFlow.required.callGraph.getCallChain(
      errorLocations[errorLocations.length - 1],
      errorLocations[0]
    )
  };
}

function parseStackTrace(trace: string): string[] {
  return trace.match(/at\s+.*?\s+\((.+?):\d+:\d+\)/g)
    ?.map(m => m.match(/\((.+?):\d+:\d+\)/)?.[1])
    .filter((f): f is string => !!f) || [];
}
```

### Performance Optimization

Identify and fix performance issues:

```typescript
async function performanceOptimizationWorkflow(
  slowArea: string,
  metrics?: { p50?: number; p99?: number; throughput?: number }
) {
  // Step 1: Understand the hot path
  const hotPath = await librarian.assembleContext({
    intent: `Performance critical path in ${slowArea}`,
    affectedFiles: [slowArea],
    depth: 'L3'
  });

  // Step 2: Find computational complexity
  const complexity = await librarian.query({
    intent: `Algorithmic complexity and expensive operations in ${slowArea}`,
    affectedFiles: [slowArea],
    taskType: 'optimize',
    depth: 'L2'
  });

  // Step 3: Identify I/O and external calls
  const ioOperations = hotPath.required.callGraph.edges
    .filter(e =>
      e.to.includes('fetch') ||
      e.to.includes('database') ||
      e.to.includes('fs.') ||
      e.to.includes('http')
    );

  // Step 4: Find caching opportunities
  const cachingOpportunities = await librarian.query({
    intent: `Where can caching improve performance in ${slowArea}?`,
    affectedFiles: [slowArea],
    depth: 'L2'
  });

  // Step 5: Check for known anti-patterns
  const antiPatterns = await librarian.searchPacks({
    query: 'performance anti-pattern N+1 memory leak blocking',
    packTypes: ['pattern_context'],
    limit: 10
  });

  // Step 6: Find similar optimizations in codebase
  const similarOptimizations = await librarian.searchPacks({
    query: 'performance optimization cache memoize batch',
    packTypes: ['similar_tasks'],
    limit: 10
  });

  return {
    hotPathAnalysis: hotPath.required.callGraph,
    complexityIssues: complexity.synthesis?.keyInsights,
    ioBottlenecks: ioOperations,
    cachingOpportunities: cachingOpportunities.synthesis?.suggestedActions,
    antiPatternsFound: antiPatterns.filter(p =>
      p.relatedFiles.some(f => f.includes(slowArea))
    ),
    optimizationExamples: similarOptimizations.map(p => ({
      description: p.summary,
      location: p.relatedFiles[0]
    }))
  };
}
```

### Security Audit

Comprehensive security analysis:

```typescript
async function securityAuditWorkflow(scope?: string[]) {
  // Step 1: Find all security-sensitive areas
  const securityAreas = await librarian.searchPacks({
    query: 'authentication authorization encryption password secret token',
    packTypes: ['security_context', 'function_context'],
    limit: 50
  });

  // Step 2: Check input validation
  const inputHandling = await librarian.query({
    intent: 'Input validation, sanitization, and injection prevention',
    affectedFiles: scope,
    depth: 'L2',
    includeEngines: true
  });

  // Step 3: Analyze authentication flow
  const authFlow = await librarian.assembleContext({
    intent: 'Authentication and authorization flow',
    affectedFiles: scope?.filter(f => f.includes('auth')) || ['src/auth/'],
    depth: 'L3'
  });

  // Step 4: Find sensitive data handling
  const sensitiveData = await librarian.query({
    intent: 'How is sensitive data (PII, credentials, tokens) handled?',
    depth: 'L2'
  });

  // Step 5: Check cryptography usage
  const crypto = await librarian.query({
    intent: 'Cryptography, hashing, and encryption implementations',
    depth: 'L2'
  });

  // Step 6: Find exposed APIs and endpoints
  const apis = await librarian.searchPacks({
    query: 'API endpoint route handler controller',
    packTypes: ['module_context', 'function_context'],
    limit: 30
  });

  // Step 7: Check dependencies for known vulnerabilities
  const deps = await librarian.query({
    intent: 'External dependencies and their security implications',
    depth: 'L1'
  });

  return {
    securitySensitiveAreas: securityAreas.map(p => ({
      area: p.targetId,
      concerns: p.keyFacts
    })),
    inputValidationStatus: inputHandling.engines?.relevance?.antiPatterns,
    authenticationAnalysis: authFlow,
    sensitiveDataHandling: sensitiveData.synthesis,
    cryptographyUsage: crypto.synthesis?.keyInsights,
    exposedEndpoints: apis.map(p => p.targetId),
    dependencyRisks: deps.synthesis?.uncertainties
  };
}
```

### Accessibility Audit

Check accessibility compliance:

```typescript
async function accessibilityAuditWorkflow(uiScope?: string[]) {
  // Step 1: Find all UI components
  const uiComponents = await librarian.searchPacks({
    query: 'component button form input modal dialog',
    packTypes: ['function_context', 'module_context'],
    limit: 50
  });

  // Step 2: Check ARIA usage
  const ariaUsage = await librarian.query({
    intent: 'ARIA attributes, roles, and accessibility labels',
    affectedFiles: uiScope || uiComponents.map(p => p.relatedFiles[0]).filter(Boolean),
    depth: 'L1'
  });

  // Step 3: Find keyboard navigation
  const keyboardNav = await librarian.query({
    intent: 'Keyboard navigation, focus management, and tab order',
    affectedFiles: uiScope,
    depth: 'L2'
  });

  // Step 4: Color and contrast handling
  const visualA11y = await librarian.query({
    intent: 'Color contrast, visual indicators, and non-color-dependent cues',
    depth: 'L1'
  });

  // Step 5: Screen reader support
  const screenReader = await librarian.query({
    intent: 'Screen reader support, live regions, and announcements',
    depth: 'L1'
  });

  return {
    components: uiComponents.map(p => p.targetId),
    ariaStatus: ariaUsage.synthesis?.keyInsights,
    keyboardNavigationStatus: keyboardNav.synthesis,
    visualAccessibility: visualA11y.synthesis,
    screenReaderSupport: screenReader.synthesis?.keyInsights,
    recommendations: [
      ...ariaUsage.synthesis?.suggestedActions || [],
      ...keyboardNav.synthesis?.suggestedActions || []
    ]
  };
}
```

---

## Team Collaboration Patterns

### Developer Onboarding

Help new team members understand the codebase:

```typescript
async function developerOnboardingWorkflow(focusAreas?: string[]) {
  // Step 1: Architecture overview
  const architecture = await librarian.visualize({
    type: 'architecture',
    depth: 2
  });

  // Step 2: Key modules and their purposes
  const keyModules = await librarian.query({
    intent: 'Main modules, their responsibilities, and how they interact',
    depth: 'L2'
  });

  // Step 3: Entry points
  const entryPoints = await librarian.query({
    intent: 'Application entry points, main flows, and bootstrapping',
    depth: 'L1'
  });

  // Step 4: Coding conventions and patterns
  const conventions = await librarian.searchPacks({
    packTypes: ['pattern_context', 'decision_context'],
    limit: 20
  });

  // Step 5: Common pitfalls
  const pitfalls = await librarian.query({
    intent: 'Common mistakes, gotchas, and things to avoid',
    depth: 'L1',
    includeEngines: true
  });

  // Step 6: Focus area deep dive (if specified)
  const focusAreaDives = focusAreas
    ? await Promise.all(focusAreas.map(area =>
        librarian.query({
          intent: `Deep understanding of ${area}`,
          affectedFiles: [area],
          depth: 'L2'
        })
      ))
    : [];

  return {
    architectureDiagram: architecture.markdown,
    keyModules: keyModules.synthesis?.keyInsights,
    entryPoints: entryPoints.packs.map(p => ({
      name: p.targetId,
      purpose: p.summary
    })),
    codingConventions: conventions.map(p => p.summary),
    commonPitfalls: pitfalls.engines?.relevance?.antiPatterns,
    focusAreaGuides: focusAreaDives.map((r, i) => ({
      area: focusAreas?.[i],
      guide: r.synthesis
    }))
  };
}
```

### Knowledge Transfer

Transfer expertise between team members:

```typescript
async function knowledgeTransferWorkflow(
  expertiseArea: string,
  detailLevel: 'overview' | 'detailed' | 'comprehensive'
) {
  const depths: Record<string, 'L1' | 'L2' | 'L3'> = {
    overview: 'L1',
    detailed: 'L2',
    comprehensive: 'L3'
  };

  // Step 1: Core concepts
  const concepts = await librarian.query({
    intent: `Core concepts and mental model for ${expertiseArea}`,
    affectedFiles: [expertiseArea],
    depth: depths[detailLevel]
  });

  // Step 2: Historical context
  const history = await librarian.searchPacks({
    query: `${expertiseArea} decision history rationale`,
    packTypes: ['decision_context'],
    limit: 15
  });

  // Step 3: Dependencies and relationships
  const dependencies = await librarian.assembleContext({
    intent: `Dependencies and relationships for ${expertiseArea}`,
    affectedFiles: [expertiseArea],
    depth: 'L2'
  });

  // Step 4: Common operations
  const operations = await librarian.query({
    intent: `Common operations and workflows in ${expertiseArea}`,
    affectedFiles: [expertiseArea],
    depth: 'L1'
  });

  // Step 5: Troubleshooting guide
  const troubleshooting = await librarian.searchPacks({
    query: `${expertiseArea} error fix debug troubleshoot`,
    packTypes: ['similar_tasks'],
    limit: 10
  });

  // Step 6: Future considerations
  const future = await librarian.query({
    intent: `Known limitations and future improvements for ${expertiseArea}`,
    affectedFiles: [expertiseArea],
    depth: 'L1'
  });

  return {
    coreConcepts: concepts.synthesis,
    designDecisions: history.map(p => p.summary),
    dependencyMap: {
      imports: dependencies.required.importGraph.getDependenciesOf(expertiseArea),
      dependents: dependencies.required.importGraph.getDependentsOf(expertiseArea)
    },
    commonOperations: operations.synthesis?.keyInsights,
    troubleshootingGuide: troubleshooting.map(p => ({
      issue: p.summary,
      resolution: p.keyFacts
    })),
    limitations: future.synthesis?.uncertainties
  };
}
```

### Code Review Assistance

Comprehensive code review support:

```typescript
async function codeReviewWorkflow(
  changedFiles: string[],
  prDescription?: string
) {
  // Step 1: Understand the change intent
  const changeIntent = await librarian.query({
    intent: prDescription || `Understanding changes to: ${changedFiles.join(', ')}`,
    affectedFiles: changedFiles,
    taskType: 'review',
    depth: 'L2'
  });

  // Step 2: Check each file for issues
  const fileReviews = await Promise.all(
    changedFiles.map(async (file) => {
      const review = await librarian.query({
        intent: `Review ${file} for issues, patterns, and improvements`,
        affectedFiles: [file],
        taskType: 'review',
        depth: 'L2',
        includeEngines: true
      });

      return {
        file,
        patterns: review.packs.filter(p => p.packType === 'pattern_context'),
        antiPatterns: review.engines?.relevance?.antiPatterns || [],
        suggestions: review.synthesis?.suggestedActions || []
      };
    })
  );

  // Step 3: Impact analysis
  const impactAnalysis = await librarian.assembleContext({
    intent: 'Impact of these changes',
    affectedFiles: changedFiles,
    depth: 'L3'
  });

  // Step 4: Test coverage check
  const testCoverage = await Promise.all(
    changedFiles.map(async (file) => ({
      file,
      tests: impactAnalysis.required.testMapping.getTestsFor(file),
      coverage: impactAnalysis.required.testMapping.getCoverageFor(file)
    }))
  );

  // Step 5: Security implications
  const securityCheck = await librarian.query({
    intent: 'Security implications of these changes',
    affectedFiles: changedFiles,
    depth: 'L2'
  });

  // Step 6: Breaking change detection
  const breakingChanges = await librarian.query({
    intent: 'Potential breaking changes and backwards compatibility',
    affectedFiles: changedFiles,
    depth: 'L2'
  });

  return {
    summary: changeIntent.synthesis?.answer,
    fileReviews,
    impactRadius: impactAnalysis.required.callGraph
      .getCallersOf(changedFiles[0])
      .length,
    testCoverage,
    securityConcerns: securityCheck.synthesis?.uncertainties,
    breakingChangeRisk: breakingChanges.synthesis?.keyInsights,
    overallConfidence: changeIntent.totalConfidence,
    suggestedTests: testCoverage
      .filter(t => t.coverage < 80)
      .map(t => `Need more tests for ${t.file}`)
  };
}
```

---

## CI/CD Integration Patterns

### Pre-Commit Validation

Run before commits to catch issues early:

```typescript
async function preCommitValidation(stagedFiles: string[]) {
  // Quick checks only - must be fast
  const quickCheck = await librarian.query({
    intent: 'Quick validation of staged changes',
    affectedFiles: stagedFiles,
    depth: 'L0',  // Fastest possible
    minConfidence: 0.8
  });

  // Check for obvious anti-patterns
  const antiPatterns = quickCheck.packs
    .filter(p => p.packType === 'pattern_context')
    .flatMap(p => p.keyFacts)
    .filter(f => f.toLowerCase().includes('avoid') || f.toLowerCase().includes("don't"));

  return {
    pass: antiPatterns.length === 0,
    warnings: antiPatterns,
    confidence: quickCheck.totalConfidence
  };
}
```

### PR Analysis

Automated PR analysis for CI:

```typescript
async function prAnalysis(
  baseBranch: string,
  headBranch: string,
  changedFiles: string[]
) {
  // Full analysis - can take longer
  const analysis = await librarian.assembleContext({
    intent: 'PR impact analysis',
    affectedFiles: changedFiles,
    depth: 'L3'
  });

  // Generate PR summary
  const summary = await librarian.query({
    intent: `Summarize changes in ${changedFiles.length} files`,
    affectedFiles: changedFiles,
    depth: 'L1'
  });

  // Risk assessment
  const riskFactors = {
    highImpactFiles: analysis.required.callGraph
      .nodes.filter(n => changedFiles.includes(n.id) && n.callerCount > 10)
      .length,
    lowTestCoverage: analysis.required.testMapping
      .mappings.filter(m => m.coverage < 50).length,
    securitySensitive: analysis.supplementary.patterns
      .filter(p => p.category === 'security').length > 0,
    largeChange: changedFiles.length > 20
  };

  const riskScore = Object.values(riskFactors).filter(Boolean).length;

  return {
    summary: summary.synthesis?.answer,
    impactedModules: [...new Set(
      analysis.required.callGraph.getCallersOf(changedFiles[0])
        .map(n => n.id.split('/')[1])
    )],
    riskAssessment: {
      score: riskScore,
      level: riskScore > 2 ? 'high' : riskScore > 0 ? 'medium' : 'low',
      factors: riskFactors
    },
    suggestedReviewers: analysis.required.ownerMapping
      .getOwnersOf(changedFiles)
      .slice(0, 3),
    testsToRun: analysis.required.testMapping
      .mappings.filter(m => changedFiles.includes(m.sourceFile))
      .flatMap(m => m.testFiles)
  };
}
```

### Post-Deployment Validation

Validate after deployment:

```typescript
async function postDeploymentValidation(deployedChanges: string[]) {
  // Check for known issues patterns
  const knownIssues = await librarian.searchPacks({
    query: 'deployment issue rollback hotfix',
    packTypes: ['similar_tasks'],
    limit: 10
  });

  // Get monitoring recommendations
  const monitoring = await librarian.query({
    intent: `What to monitor after deploying changes to: ${deployedChanges.join(', ')}`,
    affectedFiles: deployedChanges,
    depth: 'L1'
  });

  // Identify rollback strategy
  const rollback = await librarian.query({
    intent: 'Rollback strategy and dependencies',
    affectedFiles: deployedChanges,
    depth: 'L2'
  });

  return {
    knownSimilarIssues: knownIssues.map(p => p.summary),
    monitoringRecommendations: monitoring.synthesis?.suggestedActions,
    rollbackConsiderations: rollback.synthesis?.keyInsights,
    criticalPaths: rollback.packs
      .filter(p => p.packType === 'change_impact')
      .flatMap(p => p.relatedFiles)
  };
}
```

---

## Incident Response Patterns

### Emergency Debugging

Fast incident response:

```typescript
async function emergencyDebugWorkflow(
  incidentDescription: string,
  errorLogs?: string,
  affectedService?: string
) {
  // FAST - prioritize speed over completeness

  // Step 1: Quick context (L0 only)
  const quickContext = await librarian.query({
    intent: incidentDescription,
    affectedFiles: affectedService ? [affectedService] : undefined,
    depth: 'L0',  // Fastest
    taskType: 'debug'
  });

  // Step 2: Search for similar incidents
  const pastIncidents = await librarian.searchPacks({
    query: incidentDescription,
    packTypes: ['similar_tasks'],
    limit: 5
  });

  // Step 3: Get rollback info immediately
  const rollbackInfo = affectedService
    ? await librarian.query({
        intent: `How to rollback ${affectedService}`,
        affectedFiles: [affectedService],
        depth: 'L0'
      })
    : null;

  return {
    immediateContext: quickContext.synthesis?.answer,
    pastSimilarIncidents: pastIncidents.map(p => ({
      description: p.summary,
      resolution: p.keyFacts.find(f =>
        f.toLowerCase().includes('fix') ||
        f.toLowerCase().includes('resolved')
      )
    })),
    rollbackInstructions: rollbackInfo?.synthesis?.suggestedActions,
    escalationHints: quickContext.drillDownHints
  };
}
```

### Post-Mortem Analysis

Thorough analysis after incident resolution:

```typescript
async function postMortemAnalysis(
  incidentTimeline: { time: string; event: string }[],
  affectedSystems: string[],
  rootCause?: string
) {
  // Step 1: Full system context
  const systemContext = await librarian.assembleContext({
    intent: 'Full system understanding for post-mortem',
    affectedFiles: affectedSystems,
    depth: 'L3'
  });

  // Step 2: Historical patterns
  const historicalPatterns = await librarian.searchPacks({
    query: rootCause || 'incident failure error',
    packTypes: ['similar_tasks', 'pattern_context'],
    limit: 20
  });

  // Step 3: Architectural weaknesses
  const weaknesses = await librarian.query({
    intent: 'Architectural weaknesses and single points of failure',
    affectedFiles: affectedSystems,
    depth: 'L3',
    includeEngines: true
  });

  // Step 4: Test coverage gaps
  const testGaps = systemContext.coverage.gaps.filter(g =>
    affectedSystems.some(s => g.area.includes(s))
  );

  // Step 5: Dependency risks
  const dependencyRisks = systemContext.required.importGraph
    .getCycles()
    .filter(cycle =>
      cycle.some(node => affectedSystems.some(s => node.includes(s)))
    );

  // Step 6: Prevention recommendations
  const prevention = await librarian.query({
    intent: `How to prevent similar incidents in ${affectedSystems.join(', ')}`,
    affectedFiles: affectedSystems,
    depth: 'L2'
  });

  return {
    systemOverview: systemContext,
    similarPastIncidents: historicalPatterns
      .filter(p => p.packType === 'similar_tasks')
      .map(p => p.summary),
    architecturalWeaknesses: weaknesses.synthesis?.uncertainties,
    testCoverageGaps: testGaps,
    circularDependencyRisks: dependencyRisks,
    preventionRecommendations: prevention.synthesis?.suggestedActions,
    actionItems: [
      ...testGaps.map(g => `Add tests for ${g.area}`),
      ...dependencyRisks.map(c => `Break circular dependency: ${c.join(' -> ')}`),
      ...(prevention.synthesis?.suggestedActions || [])
    ]
  };
}
```

---

## Advanced Composition Patterns

### Multi-Step Reasoning

Chain queries for complex understanding:

```typescript
async function multiStepReasoning(complexQuestion: string) {
  // Step 1: Break down the question
  const breakdown = await librarian.query({
    intent: `Break down this question into sub-questions: ${complexQuestion}`,
    depth: 'L1'
  });

  const subQuestions = breakdown.drillDownHints;

  // Step 2: Answer each sub-question
  const subAnswers = await Promise.all(
    subQuestions.map(q => librarian.query({
      intent: q,
      depth: 'L2'
    }))
  );

  // Step 3: Synthesize final answer
  const synthesis = await librarian.query({
    intent: `Synthesize answer to: ${complexQuestion}. Sub-answers: ${
      subAnswers.map((a, i) => `${subQuestions[i]}: ${a.synthesis?.answer}`).join('; ')
    }`,
    depth: 'L1'
  });

  return {
    question: complexQuestion,
    reasoning: subQuestions.map((q, i) => ({
      subQuestion: q,
      answer: subAnswers[i].synthesis?.answer,
      confidence: subAnswers[i].totalConfidence
    })),
    finalAnswer: synthesis.synthesis?.answer,
    overallConfidence: synthesis.totalConfidence
  };
}
```

### Parallel Investigation

Investigate multiple hypotheses simultaneously:

```typescript
async function parallelInvestigation(hypotheses: string[], context?: string[]) {
  // Run all investigations in parallel
  const investigations = await Promise.all(
    hypotheses.map(async (hypothesis) => {
      const result = await librarian.query({
        intent: `Investigate: ${hypothesis}`,
        affectedFiles: context,
        depth: 'L2'
      });

      return {
        hypothesis,
        evidence: result.packs,
        confidence: result.totalConfidence,
        supporting: result.synthesis?.keyInsights?.filter(i =>
          !i.toLowerCase().includes('unlikely') &&
          !i.toLowerCase().includes('not ')
        ),
        contradicting: result.synthesis?.uncertainties
      };
    })
  );

  // Rank by evidence strength
  const ranked = investigations.sort((a, b) => {
    const aScore = a.confidence * (a.supporting?.length || 0);
    const bScore = b.confidence * (b.supporting?.length || 0);
    return bScore - aScore;
  });

  return {
    mostLikely: ranked[0],
    allHypotheses: ranked,
    conclusive: ranked[0].confidence > 0.8 &&
                (ranked[0].contradicting?.length || 0) === 0
  };
}
```

### Iterative Refinement

Progressively refine understanding:

```typescript
async function iterativeRefinement(
  initialQuery: string,
  maxIterations: number = 5,
  targetConfidence: number = 0.9
) {
  let currentQuery = initialQuery;
  let iteration = 0;
  let bestResult = await librarian.query({
    intent: currentQuery,
    depth: 'L1'
  });

  const history: Array<{
    query: string;
    confidence: number;
    gaps: string[];
  }> = [];

  while (
    iteration < maxIterations &&
    bestResult.totalConfidence < targetConfidence
  ) {
    history.push({
      query: currentQuery,
      confidence: bestResult.totalConfidence,
      gaps: bestResult.synthesis?.uncertainties || []
    });

    // Identify gaps
    const gaps = bestResult.synthesis?.uncertainties || [];

    if (gaps.length === 0) break;

    // Refine query to address gaps
    currentQuery = `${initialQuery}. Also address: ${gaps[0]}`;

    // Deepen search
    const refinedResult = await librarian.query({
      intent: currentQuery,
      depth: iteration < 2 ? 'L2' : 'L3',
      affectedFiles: bestResult.packs.flatMap(p => p.relatedFiles).slice(0, 10)
    });

    if (refinedResult.totalConfidence > bestResult.totalConfidence) {
      bestResult = refinedResult;
    }

    iteration++;
  }

  return {
    finalResult: bestResult,
    iterations: iteration,
    history,
    targetReached: bestResult.totalConfidence >= targetConfidence
  };
}
```

---

## Rare Use Cases

### Compliance Audit

Audit code for regulatory compliance:

```typescript
async function complianceAuditWorkflow(
  regulations: string[],  // e.g., ['GDPR', 'HIPAA', 'SOC2']
  scope?: string[]
) {
  const audits = await Promise.all(
    regulations.map(async (regulation) => {
      // Find relevant code
      const relevantCode = await librarian.searchPacks({
        query: `${regulation} compliance data privacy security`,
        packTypes: ['security_context', 'function_context'],
        limit: 30
      });

      // Deep analysis
      const analysis = await librarian.query({
        intent: `${regulation} compliance analysis`,
        affectedFiles: scope,
        depth: 'L3'
      });

      return {
        regulation,
        relevantAreas: relevantCode.map(p => p.targetId),
        compliance: analysis.synthesis,
        gaps: analysis.synthesis?.uncertainties,
        recommendations: analysis.synthesis?.suggestedActions
      };
    })
  );

  return {
    audits,
    overallStatus: audits.every(a => (a.gaps?.length || 0) === 0)
      ? 'compliant'
      : 'gaps_found',
    prioritizedActions: audits
      .flatMap(a => a.recommendations || [])
      .slice(0, 10)
  };
}
```

### Technical Debt Assessment

Quantify and prioritize technical debt:

```typescript
async function technicalDebtAssessment() {
  // Find all anti-patterns
  const antiPatterns = await librarian.query({
    intent: 'All technical debt, anti-patterns, and code smells',
    depth: 'L3',
    includeEngines: true
  });

  // Get complexity hotspots
  const complexity = await librarian.searchPacks({
    query: 'complex complicated large function module',
    packTypes: ['function_context', 'module_context'],
    minConfidence: 0.3,  // Include low-confidence = potentially problematic
    limit: 50
  });

  // Find outdated patterns
  const outdated = await librarian.query({
    intent: 'Outdated patterns, deprecated APIs, legacy code',
    depth: 'L2'
  });

  // Calculate debt by area
  const debtByArea = new Map<string, number>();
  for (const pack of complexity) {
    const area = pack.relatedFiles[0]?.split('/').slice(0, 2).join('/') || 'unknown';
    debtByArea.set(area, (debtByArea.get(area) || 0) + (1 - pack.confidence));
  }

  return {
    antiPatterns: antiPatterns.engines?.relevance?.antiPatterns,
    complexityHotspots: complexity
      .filter(p => p.confidence < 0.5)
      .map(p => ({ target: p.targetId, issues: p.keyFacts })),
    outdatedCode: outdated.synthesis?.keyInsights,
    debtByArea: Object.fromEntries(debtByArea),
    prioritizedRefactoring: complexity
      .sort((a, b) => a.confidence - b.confidence)
      .slice(0, 10)
      .map(p => p.targetId)
  };
}
```

### API Documentation Generation

Generate API documentation from code:

```typescript
async function generateApiDocumentation(apiPaths: string[]) {
  const endpoints = await Promise.all(
    apiPaths.map(async (path) => {
      const context = await librarian.assembleContext({
        intent: `API documentation for ${path}`,
        affectedFiles: [path],
        depth: 'L2'
      });

      const pack = await librarian.getContextPack(path, 'function_context');

      return {
        path,
        summary: pack?.summary,
        parameters: extractParameters(pack?.codeSnippets || []),
        responses: extractResponses(pack?.codeSnippets || []),
        examples: context.supplementary.similarTasks
          .filter(t => t.files.includes(path))
          .map(t => t.description),
        relatedEndpoints: context.required.callGraph
          .getCalleesOf(path)
          .filter(n => n.id.includes('handler') || n.id.includes('controller'))
          .map(n => n.id)
      };
    })
  );

  return {
    endpoints,
    generatedAt: new Date().toISOString(),
    version: (await librarian.getStatus()).version.string
  };
}

function extractParameters(snippets: CodeSnippet[]): string[] {
  // Extract parameter info from code snippets
  return snippets
    .flatMap(s => s.content.match(/(?:params|body|query)\.\w+/g) || []);
}

function extractResponses(snippets: CodeSnippet[]): string[] {
  // Extract response patterns
  return snippets
    .flatMap(s => s.content.match(/res\.(json|send|status)\([^)]+\)/g) || []);
}
```

---

## Pre-Mortem Analysis

Pre-mortem analysis anticipates failures *before* they occur. Use this when planning changes to identify what could go wrong.

### Pre-Mortem Query API

```typescript
import type { PreMortemRequest, PreMortemResult, PreMortemCategory } from 'librarian';

// Basic pre-mortem for a set of files
const premortem = await librarian.query({
  intent: `Pre-mortem analysis: What could cause changes to ${files.join(', ')} to fail?`,
  taskType: 'premortem',
  depth: 'L2',
  affectedFiles: files
});

// The synthesis will contain structured failure analysis
console.log(premortem.synthesis?.answer);
console.log(premortem.synthesis?.uncertainties); // Identified risks
```

### Comprehensive Pre-Mortem

```typescript
async function runPreMortem(
  affectedFiles: string[],
  changeDescription: string
): Promise<PreMortemResult> {
  // Run parallel analysis for each failure category
  const analyses = await Promise.all([
    // Data flow: null propagation, type coercion
    librarian.query({
      intent: `Data flow analysis for ${changeDescription}:
        - Where can data be null/undefined?
        - What type coercions occur?
        - What assumptions about data shape exist?`,
      taskType: 'premortem',
      depth: 'L2',
      affectedFiles
    }),

    // State: consistency, atomicity
    librarian.query({
      intent: `State analysis for ${changeDescription}:
        - What state mutations occur?
        - Are updates atomic?
        - Can state become inconsistent?`,
      taskType: 'premortem',
      depth: 'L2',
      affectedFiles
    }),

    // Concurrency: race conditions, deadlocks
    librarian.query({
      intent: `Concurrency analysis for ${changeDescription}:
        - Check-then-act patterns?
        - Shared state without locks?
        - Async operations without synchronization?`,
      taskType: 'premortem',
      depth: 'L2',
      affectedFiles
    }),

    // Resources: leaks, exhaustion
    librarian.query({
      intent: `Resource analysis for ${changeDescription}:
        - Acquired resources without cleanup?
        - Unbounded growth (caches, queues)?
        - Missing timeouts?`,
      taskType: 'premortem',
      depth: 'L2',
      affectedFiles
    }),

    // Error handling: unhandled cases
    librarian.query({
      intent: `Error handling analysis for ${changeDescription}:
        - Empty catch blocks?
        - Missing error propagation?
        - Unhandled rejection paths?`,
      taskType: 'premortem',
      depth: 'L2',
      affectedFiles
    })
  ]);

  // Synthesize results
  return synthesizePreMortemResults(analyses);
}

function synthesizePreMortemResults(analyses: LibrarianResponse[]): PreMortemResult {
  const failureModes: FailureMode[] = [];
  const mitigations: Mitigation[] = [];

  for (const analysis of analyses) {
    // Extract failure modes from each analysis
    for (const uncertainty of analysis.synthesis?.uncertainties || []) {
      failureModes.push({
        category: inferCategory(analysis.query.intent),
        description: uncertainty,
        likelihood: 'medium',
        impact: 'medium',
        affectedCode: analysis.packs.flatMap(p =>
          p.relatedFiles.map(f => ({ file: f }))
        ),
        evidence: analysis.synthesis?.citations.map(c => c.content) || []
      });
    }
  }

  const overallRisk = failureModes.length > 5 ? 0.8 :
                      failureModes.length > 2 ? 0.5 : 0.2;

  return {
    failureModes,
    overallRisk,
    mitigations,
    checklist: generatePreMortemChecklist(failureModes)
  };
}
```

### Pre-Mortem Checklist Template

```typescript
const PRE_MORTEM_CHECKLIST: Record<PreMortemCategory, ChecklistItem[]> = {
  data_flow: [
    { category: 'data_flow', item: 'Validated all input boundaries', checked: false },
    { category: 'data_flow', item: 'Checked null/undefined propagation paths', checked: false },
    { category: 'data_flow', item: 'Verified type coercions are safe', checked: false },
    { category: 'data_flow', item: 'Confirmed array bounds are checked', checked: false }
  ],
  state: [
    { category: 'state', item: 'Identified all state mutation points', checked: false },
    { category: 'state', item: 'Verified atomic operations where needed', checked: false },
    { category: 'state', item: 'Checked for partial update scenarios', checked: false },
    { category: 'state', item: 'Confirmed rollback paths exist', checked: false }
  ],
  concurrency: [
    { category: 'concurrency', item: 'No check-then-act race conditions', checked: false },
    { category: 'concurrency', item: 'Shared state properly synchronized', checked: false },
    { category: 'concurrency', item: 'Lock ordering consistent', checked: false },
    { category: 'concurrency', item: 'No deadlock potential', checked: false }
  ],
  resources: [
    { category: 'resources', item: 'All acquired resources are released', checked: false },
    { category: 'resources', item: 'Cleanup runs even on error paths', checked: false },
    { category: 'resources', item: 'Timeouts exist for blocking operations', checked: false },
    { category: 'resources', item: 'Memory growth is bounded', checked: false }
  ],
  error_handling: [
    { category: 'error_handling', item: 'Every async operation has error handling', checked: false },
    { category: 'error_handling', item: 'Errors preserve stack traces', checked: false },
    { category: 'error_handling', item: 'Errors are classified appropriately', checked: false },
    { category: 'error_handling', item: 'Recovery paths are tested', checked: false }
  ],
  dependencies: [
    { category: 'dependencies', item: 'Network calls have timeouts', checked: false },
    { category: 'dependencies', item: 'Retries have exponential backoff', checked: false },
    { category: 'dependencies', item: 'Circuit breakers for unstable services', checked: false },
    { category: 'dependencies', item: 'Fallbacks for critical paths', checked: false }
  ],
  schema: [
    { category: 'schema', item: 'Schema changes are backward compatible', checked: false },
    { category: 'schema', item: 'Migrations are reversible', checked: false },
    { category: 'schema', item: 'Default values for new fields', checked: false }
  ],
  security: [
    { category: 'security', item: 'No new injection vectors', checked: false },
    { category: 'security', item: 'Auth checks on new paths', checked: false },
    { category: 'security', item: 'Sensitive data not logged', checked: false }
  ]
};
```

---

## AI Slop Detection

"AI Slop" refers to low-quality AI-generated code patterns. Use these queries to detect and fix slop.

### Slop Detection Query API

```typescript
import type { SlopDetectionRequest, SlopDetectionResult, SlopPattern } from 'librarian';

// Basic slop detection
const slopAnalysis = await librarian.query({
  intent: `Detect AI slop patterns in ${files.join(', ')}:
    - Cargo cult code
    - Over-abstraction
    - Optimistic error handling
    - Type assertion abuse
    - Boolean blindness
    - Dead code`,
  taskType: 'slop_detection',
  depth: 'L2',
  affectedFiles: files
});
```

### Comprehensive Slop Detection

```typescript
async function detectSlop(files: string[]): Promise<SlopDetectionResult> {
  const instances: SlopInstance[] = [];

  // Run pattern-specific queries in parallel
  const [structural, logic, integration] = await Promise.all([
    // Structural slop
    librarian.query({
      intent: `Structural slop detection in ${files.join(', ')}:
        1. Cargo cult: patterns copied without understanding (unused params, redundant code)
        2. Over-abstraction: interfaces with single implementations, factories for single types
        3. Premature optimization: caching without access metrics, pooling without benchmarks
        4. Comment noise: comments that restate the code
        5. Type assertion abuse: excessive 'as' casts bypassing type safety`,
      taskType: 'slop_detection',
      depth: 'L2',
      affectedFiles: files
    }),

    // Logic slop
    librarian.query({
      intent: `Logic slop detection in ${files.join(', ')}:
        1. Optimistic happy path: try/catch that swallows errors, missing failure cases
        2. Boolean blindness: functions returning only boolean without error context
        3. Stringly typed: string comparisons that should be enums
        4. Magic numbers: numeric literals not assigned to named constants
        5. Zombie code: unreachable code, unused exports kept "just in case"`,
      taskType: 'slop_detection',
      depth: 'L2',
      affectedFiles: files
    }),

    // Integration slop
    librarian.query({
      intent: `Integration slop detection in ${files.join(', ')}:
        1. Leaky abstraction: internal implementation types in public API
        2. Circular dependency: import cycles between modules
        3. God object: classes with >20 methods or >500 lines
        4. Feature envy: functions using other module's data more than their own`,
      taskType: 'slop_detection',
      depth: 'L2',
      affectedFiles: files
    })
  ]);

  // Parse and aggregate results
  const allResponses = [structural, logic, integration];
  for (const response of allResponses) {
    const parsed = parseSlopsFromSynthesis(response.synthesis);
    instances.push(...parsed);
  }

  // Calculate slop score (0-1, lower is better)
  const weights = { high: 3, medium: 2, low: 1 };
  const totalWeight = instances.reduce((sum, i) => sum + weights[i.severity], 0);
  const maxPossible = instances.length * 3;
  const slopScore = maxPossible > 0 ? totalWeight / maxPossible : 0;

  return {
    instances,
    summary: countByPattern(instances),
    slopScore,
    recommendations: generateSlopRecommendations(instances)
  };
}
```

### Slop Pattern Detection Queries

```typescript
// Specific pattern detection queries for common slop types

// 1. Empty catch blocks (optimistic_happy_path)
const emptyCatches = await librarian.query({
  intent: 'Find empty catch blocks or catch blocks that only log without rethrowing',
  taskType: 'slop_detection',
  depth: 'L2',
  affectedFiles: files
});

// 2. Type assertion abuse
const unsafeCasts = await librarian.query({
  intent: 'Find "as X" type assertions without runtime validation nearby',
  taskType: 'slop_detection',
  depth: 'L2',
  affectedFiles: files
});

// 3. Over-defensive code
const overDefensive = await librarian.query({
  intent: 'Find checks for impossible conditions (e.g., checking if typed array is null)',
  taskType: 'slop_detection',
  depth: 'L2',
  affectedFiles: files
});

// 4. Unused abstractions
const unusedAbstractions = await librarian.query({
  intent: 'Find interfaces with only one implementation, or factories that create only one type',
  taskType: 'slop_detection',
  depth: 'L2',
  affectedFiles: files
});

// 5. Fire-and-forget promises
const unawaitedPromises = await librarian.query({
  intent: 'Find async function calls without await that could silently fail',
  taskType: 'slop_detection',
  depth: 'L2',
  affectedFiles: files
});
```

### Slop Prevention Guidelines

```typescript
// Use this query before committing AI-generated code
async function validateNoSlop(changedFiles: string[]): Promise<{
  clean: boolean;
  issues: SlopInstance[];
}> {
  const result = await detectSlop(changedFiles);

  // Consider any high-severity slop as blocking
  const blocking = result.instances.filter(i => i.severity === 'high');

  if (blocking.length > 0) {
    console.warn('Slop detected - fix before committing:');
    for (const issue of blocking) {
      console.warn(`  ${issue.file}:${issue.line} - ${issue.pattern}: ${issue.description}`);
      console.warn(`    Fix: ${issue.suggestion}`);
    }
  }

  return {
    clean: blocking.length === 0,
    issues: result.instances
  };
}
```

---

## Problem Detection

Comprehensive codebase health analysis for detecting bugs, anti-patterns, and quality issues.

### Problem Detection Query API

```typescript
import type {
  ProblemDetectionRequest,
  ProblemDetectionResult,
  ProblemCategory,
  DetectedProblem
} from 'librarian';

// Quick health check
const health = await librarian.query({
  intent: 'Comprehensive codebase health check: bugs, anti-patterns, complexity debt',
  taskType: 'code_review',
  depth: 'L3'
});

// Targeted analysis
const issues = await librarian.query({
  intent: `Problem detection for ${files.join(', ')}:
    - Logic errors (off-by-one, null chains, race conditions)
    - Architectural issues (god modules, circular deps)
    - Security vulnerabilities
    - Testing blind spots`,
  taskType: 'code_review',
  depth: 'L2',
  affectedFiles: files
});
```

### Full Problem Detection Suite

```typescript
async function detectProblems(
  request: ProblemDetectionRequest
): Promise<ProblemDetectionResult> {
  const files = request.files || [];
  const categories = request.categories || [
    'logic_errors', 'architectural', 'complexity',
    'security', 'testing', 'integration', 'runtime'
  ];

  const problems: DetectedProblem[] = [];

  // Run category-specific analyses
  const analyses = await Promise.all(
    categories.map(async (category) => {
      const query = buildCategoryQuery(category, files);
      const response = await librarian.query(query);
      return { category, response };
    })
  );

  // Parse problems from each analysis
  for (const { category, response } of analyses) {
    const parsed = parseProblemsFromResponse(response, category);
    problems.push(...parsed);
  }

  // Calculate health score
  const severityWeights = { critical: 25, high: 10, medium: 3, low: 1, info: 0 };
  const totalPenalty = problems.reduce((sum, p) => sum + severityWeights[p.severity], 0);
  const healthScore = Math.max(0, 100 - totalPenalty);

  // Generate summary
  const summary = {} as Record<ProblemCategory, CategorySummary>;
  for (const cat of categories) {
    const catProblems = problems.filter(p => p.category === cat);
    summary[cat] = {
      total: catProblems.length,
      critical: catProblems.filter(p => p.severity === 'critical').length,
      high: catProblems.filter(p => p.severity === 'high').length,
      medium: catProblems.filter(p => p.severity === 'medium').length,
      low: catProblems.filter(p => p.severity === 'low').length,
      info: catProblems.filter(p => p.severity === 'info').length
    };
  }

  return {
    problems,
    healthScore,
    summary,
    actionItems: prioritizeActions(problems)
  };
}

function buildCategoryQuery(
  category: ProblemCategory,
  files: string[]
): LibrarianQuery {
  const queries: Record<ProblemCategory, string> = {
    logic_errors: `Logic error detection:
      - Off-by-one errors in loops and array access
      - Null/undefined reference chains without guards
      - Check-then-act race conditions
      - Floating point comparison issues
      - Integer overflow potential`,

    architectural: `Architectural anti-pattern detection:
      - God modules (>20 exports, >1000 LOC)
      - Circular import dependencies
      - Leaky abstractions (internal types exported)
      - High coupling (modules with >50 imports)
      - Feature envy (functions using other module's data)`,

    complexity: `Complexity analysis:
      - Functions >100 lines
      - Cyclomatic complexity >10
      - Nesting depth >4 levels
      - Functions with >5 parameters
      - Files with >500 lines`,

    security: `Security vulnerability scan:
      - SQL/command injection risks
      - XSS vectors (innerHTML with user data)
      - Hardcoded credentials
      - Missing input validation
      - Insecure deserialization`,

    testing: `Testing blind spot analysis:
      - Public functions without tests
      - Error paths without coverage
      - Missing edge case tests
      - Tests without assertions
      - Flaky test patterns`,

    integration: `Integration risk analysis:
      - API contracts without validation
      - N+1 query patterns
      - Missing transaction boundaries
      - Connection/resource leaks
      - Timeout handling gaps`,

    runtime: `Runtime failure analysis:
      - Memory leak patterns (listeners, closures)
      - Unbounded growth (caches, queues)
      - Resource exhaustion risks
      - Deadlock potential
      - Error swallowing`,

    documentation: `Documentation gap analysis:
      - Complex functions without docs (>50 lines, no JSDoc)
      - Public APIs without examples
      - Missing parameter descriptions
      - Outdated comments (TODO/FIXME)`
  };

  return {
    intent: queries[category] + (files.length ? ` in: ${files.join(', ')}` : ''),
    taskType: 'code_review',
    depth: 'L2',
    affectedFiles: files.length ? files : undefined
  };
}
```

### Quick Reference Queries

```typescript
// One-liner problem detection queries

// Memory issues
await librarian.query({
  intent: 'Find closures capturing large objects or arrays',
  taskType: 'debugging', depth: 'L2'
});
await librarian.query({
  intent: 'Find event listeners without removeEventListener',
  taskType: 'debugging', depth: 'L2'
});
await librarian.query({
  intent: 'Find setInterval without clearInterval',
  taskType: 'debugging', depth: 'L2'
});

// Logic issues
await librarian.query({
  intent: 'Find == comparisons that should be ===',
  taskType: 'code_review', depth: 'L2'
});
await librarian.query({
  intent: 'Find array index access without bounds check',
  taskType: 'code_review', depth: 'L2'
});
await librarian.query({
  intent: 'Find await inside forEach (should use for...of)',
  taskType: 'code_review', depth: 'L2'
});

// Security issues
await librarian.query({
  intent: 'Find eval() or Function() constructor usage',
  taskType: 'security_audit', depth: 'L2'
});
await librarian.query({
  intent: 'Find innerHTML assignments with user data',
  taskType: 'security_audit', depth: 'L2'
});
await librarian.query({
  intent: 'Find password or secret in variable names',
  taskType: 'security_audit', depth: 'L2'
});

// Quality issues
await librarian.query({
  intent: 'Find functions with more than 5 parameters',
  taskType: 'complexity_audit', depth: 'L2'
});
await librarian.query({
  intent: 'Find nested callbacks deeper than 3 levels',
  taskType: 'complexity_audit', depth: 'L2'
});
await librarian.query({
  intent: 'Find switch statements without default case',
  taskType: 'code_review', depth: 'L2'
});
```

---

## Agent Self-Check Protocol

Before completing any task, agents should run this self-check:

```typescript
async function agentSelfCheck(changedFiles: string[]): Promise<{
  passed: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  const checks = await Promise.all([
    // 1. Did I introduce obvious bugs?
    librarian.query({
      intent: 'Check for null reference, off-by-one, and type errors',
      taskType: 'debugging',
      depth: 'L2',
      affectedFiles: changedFiles
    }),

    // 2. Did I handle errors properly?
    librarian.query({
      intent: 'Verify all async operations have error handling',
      taskType: 'code_review',
      depth: 'L2',
      affectedFiles: changedFiles
    }),

    // 3. Did I introduce slop patterns?
    librarian.query({
      intent: 'Check for AI slop: empty catches, type assertion abuse, over-abstraction',
      taskType: 'slop_detection',
      depth: 'L2',
      affectedFiles: changedFiles
    }),

    // 4. Did I break existing contracts?
    librarian.query({
      intent: 'Verify public API contracts are preserved',
      taskType: 'code_review',
      depth: 'L2',
      affectedFiles: changedFiles
    }),

    // 5. Did I add proper tests?
    librarian.query({
      intent: 'Check test coverage for new/modified functions',
      taskType: 'test_coverage',
      depth: 'L2',
      affectedFiles: changedFiles
    })
  ]);

  // Analyze results
  for (const response of checks) {
    const uncertainties = response.synthesis?.uncertainties || [];
    issues.push(...uncertainties);
  }

  return {
    passed: issues.length === 0,
    issues
  };
}
```

### Pre-Commit Hook Integration

```typescript
// Use in pre-commit hook or CI
async function preCommitCheck(): Promise<void> {
  // Get changed files
  const changedFiles = await getGitStagedFiles();

  // Run self-check
  const result = await agentSelfCheck(changedFiles);

  if (!result.passed) {
    console.error('Pre-commit check failed:');
    for (const issue of result.issues) {
      console.error(`  - ${issue}`);
    }
    process.exit(1);
  }

  console.log('Pre-commit check passed');
}
```

---

## Recovery Strategies

When problems are detected, use these strategies to recover:

```typescript
import type { RecoveryStrategy, ProblemCategory } from 'librarian';

const RECOVERY_STRATEGIES: Record<string, RecoveryStrategy> = {
  memory_leak: {
    problemCategory: 'runtime',
    severity: 'critical',
    immediate: [
      'Add memory profiling to CI',
      'Implement bounded caches with LRU eviction',
      'Add cleanup handlers to all listeners'
    ],
    shortTerm: [
      'Audit all event subscriptions',
      'Add memory usage metrics',
      'Review closure captures'
    ],
    longTerm: [
      'Consider WeakMap/WeakRef for caches',
      'Implement resource pooling',
      'Add memory leak detection to tests'
    ]
  },

  race_condition: {
    problemCategory: 'logic_errors',
    severity: 'high',
    immediate: [
      'Add mutex/lock around affected code',
      'Convert check-then-act to atomic operation'
    ],
    shortTerm: [
      'Add race condition tests with delays',
      'Review all shared state access'
    ],
    longTerm: [
      'Consider immutable data structures',
      'Implement state machines for complex flows'
    ]
  },

  god_module: {
    problemCategory: 'architectural',
    severity: 'medium',
    immediate: [
      'Identify distinct responsibilities',
      'Create extraction plan'
    ],
    shortTerm: [
      'Extract first cohesive group of functions',
      'Update imports in dependent files'
    ],
    longTerm: [
      'Complete decomposition',
      'Add architecture tests to prevent recurrence'
    ]
  }
};

async function getRecoveryPlan(problemType: string): Promise<RecoveryStrategy | null> {
  // Check predefined strategies
  if (RECOVERY_STRATEGIES[problemType]) {
    return RECOVERY_STRATEGIES[problemType];
  }

  // Generate custom recovery plan via LLM
  const response = await librarian.query({
    intent: `Recovery plan for problem: ${problemType}
      1. What is the root cause?
      2. What files need to change?
      3. What is the safest fix approach?
      4. What tests should be added?
      5. How can we prevent recurrence?`,
    taskType: 'debugging',
    depth: 'L3'
  });

  if (response.synthesis) {
    return parseRecoveryPlan(response.synthesis);
  }

  return null;
}
```

---

## Epistemics API

The Epistemics module provides principled confidence handling, evidence tracking, and reasoning validation. For comprehensive documentation, see [EPISTEMICS.md](./EPISTEMICS.md).

### Quick Reference

```typescript
import {
  // Confidence types
  deterministic,
  bounded,
  absent,
  getNumericValue,
  meetsThreshold,
  sequenceConfidence,
  parallelAllConfidence,

  // Evidence tracking
  createEvidenceLedger,
  exportToPROVJSON,

  // Defeaters
  detectDefeaters,
  applyDefeaters,

  // Calibration
  ClaimOutcomeTracker,
  computeCalibrationCurve,
  adjustConfidenceScore,

  // Conative attitudes
  createIntention,
  createGoal,
  createPreference,
  createBDIAgentState,

  // Temporal grounding
  constructTemporalGrounding,
  isGroundingValid,
  detectStaleGroundings,

  // Inference auditing
  auditInference,
  auditChain,
  detectFallacy,

  // Quality gates
  createQualityGate,
  evaluateGate,
  getStandardGates,
} from 'librarian/epistemics';
```

### Confidence System

```typescript
// Create typed confidence values
const certain = deterministic(0.95);        // Known exactly
const uncertain = bounded(0.6, 0.8);        // Interval [0.6, 0.8]
const unknown = absent('data_unavailable'); // Unknown with reason

// Combine confidences
const sequential = sequenceConfidence([c1, c2]); // min semantics
const parallel = parallelAllConfidence([c1, c2]); // all must succeed

// Check thresholds
if (meetsThreshold(result.confidence, 0.8)) {
  // High confidence - proceed autonomously
} else {
  // Low confidence - request review
}
```

### Evidence Ledger

```typescript
const ledger = await createEvidenceLedger('./librarian.db');

// Track evidence
await ledger.append({
  id: createEvidenceId(),
  sessionId,
  timestamp: new Date(),
  kind: 'claim',
  provenance: { source: 'analysis', agentId: 'librarian' },
  payload: { /* ... */ },
});

// Export to W3C PROV format
const prov = await exportToPROVJSON(entries);
```

### Quality Gates

```typescript
// Standard quality gate chain
const gates = createGateChain([
  getStandardGates().minConfidence(0.7),
  getStandardGates().noUnresolvedDefeaters(),
  getStandardGates().temporalValidity(),
]);

const result = await gates.evaluate(context);
if (!result.allPassed) {
  for (const failure of result.failures) {
    console.log(`Failed: ${failure.gateName}`);
    console.log(`Fix: ${failure.recommendations.join(', ')}`);
  }
}
```

### Temporal Grounding

```typescript
import { constructTemporalGrounding, TEMPORAL_PRESETS } from 'librarian/epistemics';

// Create grounding with preset
const grounding = constructTemporalGrounding({
  groundingId: 'g-001',
  originalStrength: 0.9,
  preset: 'medium_term', // 7 days validity with exponential decay
});

// Check validity
if (!isGroundingValid(grounding)) {
  console.log('Knowledge is stale - needs refresh');
}
```

### Inference Auditing

```typescript
// Audit reasoning chain
const audit = auditChain(inferenceSteps);

for (const fallacy of audit.fallacies) {
  console.log(`Fallacy: ${fallacy.type} (${fallacy.severity})`);
  console.log(`Fix: ${suggestFix(fallacy)}`);
}
```

For complete API documentation and examples, see [EPISTEMICS.md](./EPISTEMICS.md).

---

## Resource Management API

Librarian includes resource monitoring and adaptive pool management for production deployments.

### Resource Monitor

```typescript
import { createResourceMonitor, ResourceMonitor } from 'librarian/api';

const monitor = createResourceMonitor({
  checkIntervalMs: 1000,
  memoryWarningThreshold: 0.7,   // 70% of heap
  memoryCriticalThreshold: 0.9, // 90% of heap
  onWarning: (metrics) => console.log('Memory warning:', metrics),
  onCritical: (metrics) => console.log('Memory critical:', metrics),
});

// Start monitoring
monitor.start();

// Get current metrics
const metrics = monitor.getMetrics();
console.log(`Heap used: ${metrics.heapUsedMB}MB / ${metrics.heapTotalMB}MB`);
console.log(`External: ${metrics.externalMB}MB`);

// Check thresholds
if (monitor.isMemoryPressure()) {
  // Reduce concurrent operations
}

// Stop monitoring
monitor.stop();
```

### Adaptive Pool

```typescript
import { createAdaptivePool } from 'librarian/api';

const pool = createAdaptivePool({
  minSize: 2,
  maxSize: 10,
  targetUtilization: 0.7,
  scaleUpThreshold: 0.85,
  scaleDownThreshold: 0.3,
  cooldownMs: 5000,
});

// Acquire resource
const resource = await pool.acquire();
try {
  // Use resource
  await doWork(resource);
} finally {
  // Release back to pool
  pool.release(resource);
}

// Get pool stats
const stats = pool.getStats();
console.log(`Pool size: ${stats.currentSize}`);
console.log(`In use: ${stats.inUse}`);
console.log(`Utilization: ${stats.utilization}`);
```

### Governor Integration

Resource management integrates with the Governor system for backpressure:

```typescript
const governor = createGovernor({
  resourceMonitor: monitor,
  backpressure: {
    enabled: true,
    warningDelayMs: 100,
    criticalDelayMs: 500,
    criticalRejectRate: 0.5,
  },
});

// Governor automatically throttles under memory pressure
const result = await governor.execute(task);
```

---

## Related Documentation

- [VISION.md](./VISION.md) - Architectural vision and principles
- [SCHEMAS.md](./SCHEMAS.md) - Detailed data schemas
- [AGENT_INTEGRATION.md](./AGENT_INTEGRATION.md) - Integration patterns
- [CONFIDENCE_DECAY.md](./CONFIDENCE_DECAY.md) - Confidence model details
- [MCP_SERVER.md](./MCP_SERVER.md) - MCP server integration
- [AGENTIC_PROBLEM_DETECTION.md](./AGENTIC_PROBLEM_DETECTION.md) - Full problem detection guide
- [EPISTEMICS.md](./EPISTEMICS.md) - Full epistemics framework documentation
