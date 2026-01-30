# Track I: Multi-Repository Analysis

> **Addresses**: UC20 from `docs/librarian/THEORETICAL_CRITIQUE.md` - Multi-Repository Analysis
> **Scenario**: "Analyze dependencies and patterns across our 50 microservices"
> **Current Maturity (subjective, not measured)**: very low (no multi-repo support, no cross-repo dependency analysis, no pattern consistency checking, no global view)
>
> **Librarian Story**: Chapter 9 (The Federation) - Making Librarian work across repository boundaries.
>
> **Related Specifications**:
> - [track-c-hierarchical-knowledge.md](./track-c-hierarchical-knowledge.md) - Hierarchy that can span repos
> - [track-b-bootstrap.md](./track-b-bootstrap.md) - Per-repo bootstrap feeding into federation
> - [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md) - Principled confidence system used throughout
>
> **Theory Reference**: All confidence values MUST use `ConfidenceValue` from Track D. See [GLOSSARY.md](./GLOSSARY.md).

---

## Executive Summary

Track I addresses the fundamental multi-repository problem: **How does an intelligent system understand software that spans multiple repositories while maintaining coherent knowledge and honest confidence?**

Modern software increasingly spans multiple repositories:
- Microservices architectures (50+ repos per product)
- Monorepo experience desired for polyrepo reality
- Cross-repo dependencies, APIs, shared types, versioning
- No unified authoritative view for system-wide understanding

This specification covers:
- **Multi-Repo Index** - Unified knowledge base linking multiple repositories
- **Cross-Repo Primitives** - Operations spanning repository boundaries
- **Cross-Repo Compositions** - Complex workflows across repositories
- **Federation Model** - How to index independently but query together
- **Global Views** - System-wide architecture and dependency visualization

---

## 1. Problem Statement

### The Multi-Repository Reality

Modern software development has fragmented into polyrepo architectures:

```
┌─────────────────────────────────────────────────────────────────┐
│                    TYPICAL MICROSERVICES ARCHITECTURE           │
│                                                                 │
│  repo: user-service          repo: order-service               │
│  ├── src/                    ├── src/                          │
│  │   ├── models/User.ts      │   ├── models/Order.ts           │
│  │   └── api/                │   │   └── imports User type     │
│  └── package.json            │   └── api/                      │
│                              └── package.json                   │
│                                                                 │
│  repo: shared-types          repo: api-gateway                  │
│  ├── src/                    ├── src/                          │
│  │   ├── User.ts             │   ├── routes/                   │
│  │   └── Order.ts            │   │   └── imports from all      │
│  └── package.json            └── package.json                   │
│                                                                 │
│  Questions that CANNOT be answered with single-repo analysis:   │
│  - "What breaks if I change User.ts?"                           │
│  - "Which services use v2.3.1 of shared-types?"                 │
│  - "Show me the global API surface"                             │
│  - "Are there type inconsistencies across repos?"               │
└─────────────────────────────────────────────────────────────────┘
```

### What Single-Repo Analysis Cannot Do

| Question | Single-Repo Answer | What's Actually Needed |
|----------|-------------------|------------------------|
| "What breaks if I change this type?" | Callers in THIS repo | Callers in ALL repos |
| "Who consumes this API?" | Internal callers | All external consumers |
| "Is this dependency safe to upgrade?" | Compatibility with THIS repo | Compatibility with ALL repos |
| "Show system architecture" | THIS repo's architecture | GLOBAL architecture |

### The Federation Challenge

Multiple repositories present unique challenges:

1. **Identity Resolution**: Same type defined in multiple repos (shared types)
2. **Version Skew**: Different repos using different versions
3. **Boundary Crossing**: Dependencies that span repo boundaries
4. **Permission Boundaries**: Not all agents should see all repos
5. **Staleness**: Repos update independently at different rates
6. **Scale**: N repos means O(N^2) potential relationships

### Theoretical Foundation

**McCarthy's Insight**: "Knowledge about a system cannot be complete if it excludes parts of the system. A multi-repo system requires multi-repo knowledge."

**Pearl's Insight**: "Causal relationships don't respect repository boundaries. To understand causation, you must model the complete causal graph."

---

## 2. Multi-Repo Index

### Core Interface

```typescript
/**
 * A federated index linking multiple repository knowledge bases.
 *
 * INVARIANT: Each repo maintains its own knowledge base
 * INVARIANT: Cross-repo links are bidirectional and versioned
 * INVARIANT: Identity resolution is explicit, not implicit
 */
interface MultiRepoIndex {
  /** Unique identifier for this federated index */
  id: FederationId;

  /** Human-readable name for the federation */
  name: string;

  /** Repositories in this federation */
  repos: Map<RepoId, FederatedRepo>;

  /** Cross-repo entity resolution table */
  entityResolution: CrossRepoEntityResolution;

  /** Global dependency graph (computed from repo-level graphs) */
  globalDependencyGraph: GlobalDependencyGraph;

  /** Shared type registry (types defined/used across repos) */
  sharedTypeRegistry: SharedTypeRegistry;

  /** API surface catalog (APIs exposed/consumed across repos) */
  apiCatalog: CrossRepoAPICatalog;

  /** Federation metadata */
  metadata: FederationMetadata;
}

type FederationId = string & { readonly __brand: 'FederationId' };
type RepoId = string & { readonly __brand: 'RepoId' };

interface FederatedRepo {
  id: RepoId;

  /** Human-readable name */
  name: string;

  /** Repository URL or path */
  location: string;

  /** Reference to repo's knowledge base */
  knowledgeBaseRef: KnowledgeBaseRef;

  /** When this repo was last indexed */
  lastIndexedAt: Date;

  /** Git commit at last index */
  lastIndexedCommit: string;

  /** Confidence in repo knowledge freshness */
  freshnessConfidence: ConfidenceValue;

  /** Repos this repo depends on */
  dependsOn: RepoId[];

  /** Repos that depend on this repo */
  dependedOnBy: RepoId[];

  /** Access policy for this repo */
  accessPolicy: RepoAccessPolicy;
}

interface FederationMetadata {
  /** When federation was created */
  createdAt: Date;

  /** When federation was last updated */
  lastUpdatedAt: Date;

  /** Total repos in federation */
  repoCount: number;

  /** Total cross-repo links */
  crossRepoLinkCount: number;

  /** Overall federation health confidence */
  healthConfidence: ConfidenceValue;
}
```

### Cross-Repo Entity Resolution

```typescript
/**
 * Resolves entities that appear in multiple repositories.
 *
 * CHALLENGE: Same type/interface may be:
 * - Defined in shared-types, imported elsewhere
 * - Duplicated across repos (copy-paste)
 * - Defined with same name but different structure
 */
interface CrossRepoEntityResolution {
  /** Canonical entities (the "source of truth" for each shared entity) */
  canonicalEntities: Map<GlobalEntityId, CanonicalEntity>;

  /** Entity aliases (non-canonical references to canonical entities) */
  aliases: Map<LocalEntityRef, GlobalEntityId>;

  /** Unresolved conflicts (same name, different definitions) */
  conflicts: EntityConflict[];

  /** Resolution confidence */
  confidence: ConfidenceValue;
}

type GlobalEntityId = string & { readonly __brand: 'GlobalEntityId' };

interface LocalEntityRef {
  repoId: RepoId;
  entityId: EntityId;
}

interface CanonicalEntity {
  id: GlobalEntityId;

  /** The repo where this entity is canonically defined */
  canonicalRepo: RepoId;

  /** The entity in the canonical repo */
  canonicalEntity: EntityId;

  /** All repos that reference this entity */
  referencedBy: LocalEntityRef[];

  /** Entity type (interface, type, class, function, etc.) */
  kind: EntityKind;

  /** Semantic signature for matching */
  signature: string;

  /** Confidence that resolution is correct */
  confidence: ConfidenceValue;
}

interface EntityConflict {
  /** The name that conflicts */
  name: string;

  /** Entities with this name across repos */
  entities: LocalEntityRef[];

  /** Why they conflict */
  conflictType: 'structural_mismatch' | 'semantic_mismatch' | 'version_skew';

  /** Suggested resolution */
  suggestedResolution?: string;

  /** Confidence in conflict detection */
  confidence: ConfidenceValue;
}
```

### Global Dependency Graph

```typescript
/**
 * Dependency graph spanning all repositories.
 *
 * Built by merging repo-level dependency graphs and adding cross-repo edges.
 */
interface GlobalDependencyGraph {
  /** All nodes (entities across all repos) */
  nodes: Map<GlobalEntityId, GlobalDependencyNode>;

  /** Intra-repo edges (within same repo) */
  intraRepoEdges: DependencyEdge[];

  /** Cross-repo edges (spanning repo boundaries) */
  crossRepoEdges: CrossRepoDependencyEdge[];

  /** Graph statistics */
  stats: GlobalGraphStats;

  /** Confidence in graph completeness */
  confidence: ConfidenceValue;
}

interface GlobalDependencyNode {
  id: GlobalEntityId;
  repoId: RepoId;
  localEntityId: EntityId;
  name: string;
  kind: EntityKind;

  /** In-degree from all repos */
  globalInDegree: number;

  /** Out-degree to all repos */
  globalOutDegree: number;

  /** Repos that depend on this node */
  dependentRepos: RepoId[];

  /** Repos this node depends on */
  dependencyRepos: RepoId[];
}

interface CrossRepoDependencyEdge {
  /** Source entity (in source repo) */
  source: LocalEntityRef;

  /** Target entity (in target repo) */
  target: LocalEntityRef;

  /** Type of cross-repo dependency */
  dependencyType: CrossRepoDependencyType;

  /** Version constraint (if applicable) */
  versionConstraint?: string;

  /** Actual version resolved */
  resolvedVersion?: string;

  /** Confidence in edge detection */
  confidence: ConfidenceValue;
}

type CrossRepoDependencyType =
  | 'package_dependency'    // npm/maven/pip dependency
  | 'type_import'           // Shared type import
  | 'api_call'              // HTTP/gRPC API call
  | 'message_publish'       // Event/message publishing
  | 'message_subscribe'     // Event/message subscription
  | 'database_shared'       // Shared database access
  | 'config_reference';     // Configuration reference

interface GlobalGraphStats {
  totalNodes: number;
  totalIntraRepoEdges: number;
  totalCrossRepoEdges: number;
  avgCrossRepoDegree: number;
  mostConnectedRepos: RepoId[];
  isolatedRepos: RepoId[];
}
```

### Shared Type Registry

```typescript
/**
 * Registry of types that are shared across repositories.
 *
 * Critical for ensuring type consistency across microservices.
 */
interface SharedTypeRegistry {
  /** Shared types by global ID */
  types: Map<GlobalEntityId, SharedType>;

  /** Type usage matrix (which repos use which types) */
  usageMatrix: TypeUsageMatrix;

  /** Version compatibility matrix */
  versionCompatibility: VersionCompatibilityMatrix;

  /** Confidence in registry completeness */
  confidence: ConfidenceValue;
}

interface SharedType {
  id: GlobalEntityId;

  /** Type name */
  name: string;

  /** Canonical definition location */
  canonicalLocation: LocalEntityRef;

  /** All locations where this type is used */
  usages: SharedTypeUsage[];

  /** Type schema (for structural comparison) */
  schema: TypeSchema;

  /** Available versions */
  versions: SharedTypeVersion[];

  /** Confidence in type resolution */
  confidence: ConfidenceValue;
}

interface SharedTypeUsage {
  repoId: RepoId;
  entityId: EntityId;
  usageType: 'definition' | 'import' | 'extension' | 'implementation';
  version: string;
  confidence: ConfidenceValue;
}

interface SharedTypeVersion {
  version: string;
  schema: TypeSchema;
  reposUsing: RepoId[];
  compatibility: Map<string, VersionCompatibility>;
}

type VersionCompatibility = 'compatible' | 'breaking' | 'unknown';

interface TypeUsageMatrix {
  /** Rows: types, Columns: repos, Cells: usage type */
  matrix: Map<GlobalEntityId, Map<RepoId, SharedTypeUsage>>;

  /** Types used by most repos */
  mostSharedTypes: GlobalEntityId[];

  /** Repos with most shared type usage */
  highestSharingRepos: RepoId[];
}

interface VersionCompatibilityMatrix {
  /** For each type, compatibility between versions */
  typeVersions: Map<GlobalEntityId, Map<string, Map<string, VersionCompatibility>>>;

  /** Known breaking changes */
  breakingChanges: BreakingChange[];
}

interface BreakingChange {
  typeId: GlobalEntityId;
  fromVersion: string;
  toVersion: string;
  description: string;
  affectedRepos: RepoId[];
  confidence: ConfidenceValue;
}
```

---

## 3. Cross-Repo Primitives

### tp_cross_repo_search

```typescript
/**
 * Search across all indexed repositories.
 *
 * UNLIKE single-repo search, this must:
 * - Federate queries across repo knowledge bases
 * - Merge and rank results from multiple repos
 * - Handle permission boundaries
 * - Account for staleness differences
 */
export const tp_cross_repo_search: TechniquePrimitive = {
  id: 'tp_cross_repo_search',
  name: 'Cross-Repository Search',
  description: 'Search for entities, patterns, or content across all federated repositories',
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'query', type: 'string' },
    { name: 'searchType', type: 'SearchType' },  // 'entity' | 'pattern' | 'content'
    { name: 'repoFilter', type: 'RepoId[]', optional: true },
    { name: 'maxResultsPerRepo', type: 'number', optional: true },
  ],
  outputs: [
    { name: 'results', type: 'CrossRepoSearchResult[]' },
    { name: 'repoHits', type: 'Map<RepoId, number>' },
    { name: 'suggestedRefinements', type: 'string[]' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 3,  // Requires semantic understanding
};

interface CrossRepoSearchResult {
  /** Global entity ID (if entity search) */
  entityId?: GlobalEntityId;

  /** Local reference in source repo */
  localRef: LocalEntityRef;

  /** Relevance score */
  score: number;

  /** Snippet/context */
  snippet: string;

  /** Why this matched */
  matchReason: string;

  /** Freshness of this result */
  freshnessConfidence: ConfidenceValue;

  /** Result confidence */
  confidence: ConfidenceValue;
}
```

### tp_cross_repo_dependency

```typescript
/**
 * Trace dependencies across repository boundaries.
 *
 * Answers: "What depends on X across all repos?"
 */
export const tp_cross_repo_dependency: TechniquePrimitive = {
  id: 'tp_cross_repo_dependency',
  name: 'Cross-Repository Dependency Tracing',
  description: 'Trace dependency relationships across repository boundaries',
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'entityRef', type: 'LocalEntityRef | GlobalEntityId' },
    { name: 'direction', type: 'DependencyDirection' },  // 'dependents' | 'dependencies' | 'both'
    { name: 'depth', type: 'number', optional: true },  // Max traversal depth
    { name: 'includeTransitive', type: 'boolean', optional: true },
  ],
  outputs: [
    { name: 'dependencyTree', type: 'CrossRepoDependencyTree' },
    { name: 'affectedRepos', type: 'RepoId[]' },
    { name: 'criticalPaths', type: 'DependencyPath[]' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 2,  // Graph traversal with cross-repo edges
};

interface CrossRepoDependencyTree {
  root: GlobalDependencyNode;
  children: CrossRepoDependencyTree[];
  depth: number;
  totalNodes: number;
  crossRepoEdgeCount: number;
  confidence: ConfidenceValue;
}

interface DependencyPath {
  nodes: GlobalDependencyNode[];
  edges: CrossRepoDependencyEdge[];
  totalLength: number;
  crossesRepos: RepoId[];
  pathConfidence: ConfidenceValue;
}
```

### tp_cross_repo_impact

```typescript
/**
 * Impact analysis for changes affecting multiple repositories.
 *
 * Answers: "If I change X in repo A, what breaks in repos B, C, D...?"
 */
export const tp_cross_repo_impact: TechniquePrimitive = {
  id: 'tp_cross_repo_impact',
  name: 'Cross-Repository Impact Analysis',
  description: 'Analyze the impact of a change across all federated repositories',
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'changeDescription', type: 'ChangeDescription' },
    { name: 'sourceRef', type: 'LocalEntityRef' },
    { name: 'changeType', type: 'ChangeType' },  // 'breaking' | 'additive' | 'modification'
  ],
  outputs: [
    { name: 'impactReport', type: 'CrossRepoImpactReport' },
    { name: 'affectedRepos', type: 'AffectedRepo[]' },
    { name: 'riskAssessment', type: 'RiskAssessment' },
    { name: 'mitigationSuggestions', type: 'string[]' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 3,  // Requires semantic understanding of changes
};

interface ChangeDescription {
  summary: string;
  beforeSignature?: string;
  afterSignature?: string;
  breakingChanges?: string[];
}

interface CrossRepoImpactReport {
  sourceRepo: RepoId;
  sourceEntity: EntityId;
  changeType: ChangeType;

  /** Direct impacts (first-order dependents) */
  directImpacts: ImpactedEntity[];

  /** Transitive impacts (N-th order dependents) */
  transitiveImpacts: ImpactedEntity[];

  /** Repos by impact severity */
  reposBySeverity: Map<ImpactSeverity, RepoId[]>;

  /** Total entities impacted */
  totalImpactedEntities: number;

  /** Overall confidence in impact analysis */
  confidence: ConfidenceValue;
}

interface ImpactedEntity {
  entityRef: LocalEntityRef;
  impactType: ImpactType;
  severity: ImpactSeverity;
  reason: string;
  confidence: ConfidenceValue;
}

type ImpactType = 'compile_error' | 'runtime_error' | 'behavior_change' | 'deprecation_warning';
type ImpactSeverity = 'critical' | 'high' | 'medium' | 'low';

interface AffectedRepo {
  repoId: RepoId;
  impactedEntityCount: number;
  highestSeverity: ImpactSeverity;
  requiresUpdate: boolean;
  estimatedEffort: string;  // 'trivial' | 'minor' | 'major' | 'breaking'
}

interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  riskFactors: string[];
  confidenceInAssessment: ConfidenceValue;
}
```

### tp_api_consumer_find

```typescript
/**
 * Find all consumers of an API across repositories.
 *
 * Answers: "Who calls this endpoint across all our services?"
 */
export const tp_api_consumer_find: TechniquePrimitive = {
  id: 'tp_api_consumer_find',
  name: 'Cross-Repository API Consumer Discovery',
  description: 'Find all consumers of an API endpoint or service across federated repositories',
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'apiIdentifier', type: 'APIIdentifier' },
    { name: 'apiType', type: 'APIType' },  // 'rest' | 'grpc' | 'graphql' | 'event'
  ],
  outputs: [
    { name: 'consumers', type: 'APIConsumer[]' },
    { name: 'consumersByRepo', type: 'Map<RepoId, APIConsumer[]>' },
    { name: 'usagePatterns', type: 'UsagePattern[]' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 3,  // Requires semantic understanding of API calls
};

interface APIIdentifier {
  /** Endpoint path or method name */
  identifier: string;

  /** Provider repo (where API is defined) */
  providerRepo?: RepoId;

  /** HTTP method (for REST) */
  method?: string;

  /** Service name (for gRPC) */
  serviceName?: string;

  /** Event topic (for events) */
  eventTopic?: string;
}

type APIType = 'rest' | 'grpc' | 'graphql' | 'event' | 'websocket';

interface APIConsumer {
  repoId: RepoId;
  entityRef: LocalEntityRef;
  callSite: CodeLocation;
  consumptionType: 'direct_call' | 'client_sdk' | 'generated_client' | 'event_subscription';
  frequency?: 'high' | 'medium' | 'low' | 'unknown';
  confidence: ConfidenceValue;
}

interface UsagePattern {
  pattern: string;
  description: string;
  repos: RepoId[];
  count: number;
}
```

### tp_shared_type_trace

```typescript
/**
 * Trace shared types through repositories.
 *
 * Answers: "Where is this type defined, imported, and used across repos?"
 */
export const tp_shared_type_trace: TechniquePrimitive = {
  id: 'tp_shared_type_trace',
  name: 'Shared Type Tracing',
  description: 'Trace the definition, import, and usage of shared types across repositories',
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'typeName', type: 'string' },
    { name: 'sourceRepo', type: 'RepoId', optional: true },
  ],
  outputs: [
    { name: 'typeTrace', type: 'SharedTypeTrace' },
    { name: 'versionMap', type: 'Map<RepoId, string>' },
    { name: 'inconsistencies', type: 'TypeInconsistency[]' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 2,  // Structural analysis across repos
};

interface SharedTypeTrace {
  /** Canonical definition */
  definition: SharedTypeDefinition;

  /** All imports of this type */
  imports: SharedTypeImport[];

  /** All usages (beyond imports) */
  usages: SharedTypeUsage[];

  /** Type flow diagram (definition -> imports -> usages) */
  flowDiagram: TypeFlowDiagram;

  /** Confidence in trace completeness */
  confidence: ConfidenceValue;
}

interface SharedTypeDefinition {
  repoId: RepoId;
  entityRef: LocalEntityRef;
  schema: TypeSchema;
  version: string;
  exportedAs: string[];
  confidence: ConfidenceValue;
}

interface SharedTypeImport {
  repoId: RepoId;
  entityRef: LocalEntityRef;
  importedFrom: string;  // Package name
  importedVersion: string;
  localAlias?: string;
  confidence: ConfidenceValue;
}

interface TypeInconsistency {
  type: 'version_mismatch' | 'schema_drift' | 'naming_conflict' | 'missing_import';
  description: string;
  affectedRepos: RepoId[];
  severity: 'error' | 'warning' | 'info';
  suggestedFix?: string;
  confidence: ConfidenceValue;
}
```

### tp_version_compatibility

```typescript
/**
 * Check version compatibility across repositories.
 *
 * Answers: "Can repo A upgrade to v2.0.0 of shared-types without breaking repos B, C?"
 */
export const tp_version_compatibility: TechniquePrimitive = {
  id: 'tp_version_compatibility',
  name: 'Cross-Repository Version Compatibility Check',
  description: 'Check version compatibility of shared dependencies across repositories',
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'packageName', type: 'string' },
    { name: 'targetVersion', type: 'string' },
    { name: 'sourceRepo', type: 'RepoId' },
  ],
  outputs: [
    { name: 'compatibilityReport', type: 'VersionCompatibilityReport' },
    { name: 'upgradeOrder', type: 'RepoId[]' },
    { name: 'blockers', type: 'UpgradeBlocker[]' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 2,  // Semantic version analysis
};

interface VersionCompatibilityReport {
  packageName: string;
  currentVersions: Map<RepoId, string>;
  targetVersion: string;

  /** Repos that can upgrade directly */
  directlyCompatible: RepoId[];

  /** Repos that need code changes */
  requiresChanges: RepoWithChanges[];

  /** Repos blocked by other dependencies */
  blocked: BlockedRepo[];

  /** Overall upgrade feasibility */
  feasibility: 'easy' | 'moderate' | 'difficult' | 'blocked';

  /** Confidence in compatibility assessment */
  confidence: ConfidenceValue;
}

interface RepoWithChanges {
  repoId: RepoId;
  currentVersion: string;
  requiredChanges: RequiredChange[];
  estimatedEffort: string;
}

interface RequiredChange {
  entityRef: LocalEntityRef;
  changeType: 'signature_update' | 'api_migration' | 'behavior_adaptation';
  description: string;
  confidence: ConfidenceValue;
}

interface BlockedRepo {
  repoId: RepoId;
  blockedBy: string[];  // Package names blocking upgrade
  reason: string;
}

interface UpgradeBlocker {
  packageName: string;
  blockingRepos: RepoId[];
  reason: string;
  suggestedResolution?: string;
}
```

---

## 4. Cross-Repo Compositions

### tc_cross_repo_change_verify

```typescript
/**
 * Verify a change doesn't break other repositories.
 *
 * COMPOSITION: Combines impact analysis, type tracing, and version compatibility
 * to provide comprehensive change verification across the federation.
 */
export const tc_cross_repo_change_verify: TechniqueComposition = {
  id: 'tc_cross_repo_change_verify',
  name: 'Cross-Repository Change Verification',
  description: 'Verify that a proposed change in one repo does not break others',
  primitives: [
    'tp_cross_repo_impact',
    'tp_shared_type_trace',
    'tp_version_compatibility',
    'tp_api_consumer_find',
  ],
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'sourceRepo', type: 'RepoId' },
    { name: 'changeSet', type: 'ChangeSet' },
  ],
  outputs: [
    { name: 'verificationResult', type: 'CrossRepoVerificationResult' },
    { name: 'requiredCoordinatedChanges', type: 'CoordinatedChange[]' },
    { name: 'rolloutPlan', type: 'RolloutPlan' },
  ],
  operator: 'sequence',  // Run primitives in sequence, gate on failures
  confidence: { type: 'absent', reason: 'uncalibrated' },
};

interface ChangeSet {
  /** Files changed */
  files: FileChange[];

  /** Entities modified */
  entitiesModified: EntityId[];

  /** Change summary */
  summary: string;

  /** Is this a breaking change? */
  isBreaking: boolean;
}

interface CrossRepoVerificationResult {
  /** Overall verification status */
  status: 'safe' | 'requires_coordination' | 'blocked' | 'unknown';

  /** Repos affected by this change */
  affectedRepos: AffectedRepo[];

  /** Type inconsistencies introduced */
  typeIssues: TypeInconsistency[];

  /** API compatibility issues */
  apiIssues: APICompatibilityIssue[];

  /** Version conflicts introduced */
  versionConflicts: VersionConflict[];

  /** Verification confidence */
  confidence: ConfidenceValue;
}

interface CoordinatedChange {
  repoId: RepoId;
  requiredChanges: RequiredChange[];
  mustHappenBefore: boolean;  // True if this must be deployed before source change
  estimatedEffort: string;
}

interface RolloutPlan {
  /** Ordered phases for safe rollout */
  phases: RolloutPhase[];

  /** Total estimated duration */
  estimatedDuration: string;

  /** Rollback strategy */
  rollbackStrategy: string;

  /** Plan confidence */
  confidence: ConfidenceValue;
}

interface RolloutPhase {
  phaseNumber: number;
  repos: RepoId[];
  changes: CoordinatedChange[];
  verificationSteps: string[];
  rollbackSteps: string[];
}
```

### tc_api_evolution_plan

```typescript
/**
 * Plan API evolution across consumers.
 *
 * COMPOSITION: Discovers all API consumers, assesses compatibility,
 * and generates a migration plan for evolving an API safely.
 */
export const tc_api_evolution_plan: TechniqueComposition = {
  id: 'tc_api_evolution_plan',
  name: 'Cross-Repository API Evolution Planning',
  description: 'Plan the evolution of an API across all consumers',
  primitives: [
    'tp_api_consumer_find',
    'tp_cross_repo_impact',
    'tp_version_compatibility',
  ],
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'apiIdentifier', type: 'APIIdentifier' },
    { name: 'proposedChanges', type: 'APIChange[]' },
    { name: 'deprecationTimeline', type: 'DeprecationTimeline', optional: true },
  ],
  outputs: [
    { name: 'evolutionPlan', type: 'APIEvolutionPlan' },
    { name: 'migrationGuides', type: 'Map<RepoId, MigrationGuide>' },
    { name: 'timeline', type: 'EvolutionTimeline' },
  ],
  operator: 'sequence',
  confidence: { type: 'absent', reason: 'uncalibrated' },
};

interface APIChange {
  changeType: 'add_field' | 'remove_field' | 'rename_field' | 'change_type' | 'add_endpoint' | 'remove_endpoint';
  target: string;
  before?: string;
  after?: string;
  isBreaking: boolean;
}

interface DeprecationTimeline {
  announceDate: Date;
  softDeadline: Date;  // Warnings start
  hardDeadline: Date;  // Old API removed
}

interface APIEvolutionPlan {
  /** Current state of the API */
  currentState: APIState;

  /** Target state after evolution */
  targetState: APIState;

  /** Consumers that need migration */
  consumersNeedingMigration: APIConsumer[];

  /** Versioning strategy */
  versioningStrategy: 'semver' | 'date_based' | 'v1_v2_parallel';

  /** Backward compatibility approach */
  backwardCompatibility: 'full' | 'partial' | 'none';

  /** Plan confidence */
  confidence: ConfidenceValue;
}

interface MigrationGuide {
  repoId: RepoId;
  steps: MigrationStep[];
  estimatedEffort: string;
  testingRequirements: string[];
}

interface MigrationStep {
  order: number;
  description: string;
  codeChanges: CodeChange[];
  verificationCommand?: string;
}

interface EvolutionTimeline {
  phases: TimelinePhase[];
  totalDuration: string;
  criticalPath: string[];
}

interface TimelinePhase {
  name: string;
  startDate: Date;
  endDate: Date;
  repos: RepoId[];
  milestones: string[];
}
```

### tc_dependency_upgrade_multi

```typescript
/**
 * Coordinate dependency upgrade across repositories.
 *
 * COMPOSITION: Analyzes version compatibility, determines upgrade order,
 * and coordinates the upgrade across all affected repos.
 */
export const tc_dependency_upgrade_multi: TechniqueComposition = {
  id: 'tc_dependency_upgrade_multi',
  name: 'Multi-Repository Dependency Upgrade',
  description: 'Coordinate a dependency upgrade across multiple repositories',
  primitives: [
    'tp_version_compatibility',
    'tp_cross_repo_dependency',
    'tp_cross_repo_impact',
  ],
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'packageName', type: 'string' },
    { name: 'targetVersion', type: 'string' },
    { name: 'upgradeStrategy', type: 'UpgradeStrategy' },
  ],
  outputs: [
    { name: 'upgradePlan', type: 'MultiRepoUpgradePlan' },
    { name: 'executionOrder', type: 'RepoId[]' },
    { name: 'riskAssessment', type: 'RiskAssessment' },
  ],
  operator: 'sequence',
  confidence: { type: 'absent', reason: 'uncalibrated' },
};

type UpgradeStrategy = 'big_bang' | 'rolling' | 'canary' | 'feature_flag';

interface MultiRepoUpgradePlan {
  packageName: string;
  currentVersions: Map<RepoId, string>;
  targetVersion: string;

  /** Repos in upgrade order */
  upgradeOrder: UpgradeStep[];

  /** Repos that cannot upgrade */
  excluded: ExcludedRepo[];

  /** Total estimated effort */
  totalEffort: string;

  /** Plan confidence */
  confidence: ConfidenceValue;
}

interface UpgradeStep {
  order: number;
  repoId: RepoId;
  fromVersion: string;
  toVersion: string;
  requiredChanges: RequiredChange[];
  verificationSteps: string[];
  canParallelizeWith: RepoId[];  // Other repos that can upgrade simultaneously
}

interface ExcludedRepo {
  repoId: RepoId;
  reason: string;
  blockers: string[];
}
```

### tc_global_architecture_review

```typescript
/**
 * Review architecture spanning repositories.
 *
 * COMPOSITION: Combines dependency analysis, type tracing, and API discovery
 * to provide a comprehensive architectural review of the entire federation.
 */
export const tc_global_architecture_review: TechniqueComposition = {
  id: 'tc_global_architecture_review',
  name: 'Global Architecture Review',
  description: 'Comprehensive architectural review across all federated repositories',
  primitives: [
    'tp_cross_repo_dependency',
    'tp_shared_type_trace',
    'tp_api_consumer_find',
    'tp_cross_repo_search',
  ],
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'focusAreas', type: 'ArchitectureFocusArea[]', optional: true },
  ],
  outputs: [
    { name: 'architectureReport', type: 'GlobalArchitectureReport' },
    { name: 'concerns', type: 'ArchitectureConcern[]' },
    { name: 'recommendations', type: 'ArchitectureRecommendation[]' },
  ],
  operator: 'parallel_all',  // Run all primitives in parallel, merge results
  confidence: { type: 'absent', reason: 'uncalibrated' },
};

type ArchitectureFocusArea =
  | 'coupling'
  | 'cohesion'
  | 'api_surface'
  | 'shared_types'
  | 'dependency_health'
  | 'circular_dependencies';

interface GlobalArchitectureReport {
  /** Federation overview */
  overview: FederationOverview;

  /** Dependency analysis */
  dependencies: GlobalDependencyAnalysis;

  /** API surface analysis */
  apiSurface: GlobalAPISurfaceAnalysis;

  /** Shared types analysis */
  sharedTypes: SharedTypesAnalysis;

  /** Architectural patterns detected */
  patterns: DetectedPattern[];

  /** Report confidence */
  confidence: ConfidenceValue;
}

interface FederationOverview {
  totalRepos: number;
  totalEntities: number;
  totalCrossRepoLinks: number;
  languageDistribution: Map<string, number>;
  reposBySize: Map<RepoId, number>;
}

interface GlobalDependencyAnalysis {
  /** Dependency graph metrics */
  metrics: {
    avgDependencies: number;
    maxDependencies: number;
    avgDependents: number;
    maxDependents: number;
  };

  /** Central repos (high in-degree) */
  centralRepos: RepoId[];

  /** Peripheral repos (low in-degree, high out-degree) */
  peripheralRepos: RepoId[];

  /** Circular dependencies detected */
  circularDependencies: CircularDependency[];

  /** Analysis confidence */
  confidence: ConfidenceValue;
}

interface CircularDependency {
  repos: RepoId[];
  path: string;
  severity: 'warning' | 'error';
}

interface GlobalAPISurfaceAnalysis {
  /** Total APIs exposed */
  totalAPIs: number;

  /** APIs by type */
  apisByType: Map<APIType, number>;

  /** Most consumed APIs */
  mostConsumedAPIs: APIUsageStats[];

  /** Undocumented APIs */
  undocumentedAPIs: APIIdentifier[];

  /** Analysis confidence */
  confidence: ConfidenceValue;
}

interface APIUsageStats {
  api: APIIdentifier;
  consumerCount: number;
  consumerRepos: RepoId[];
}

interface SharedTypesAnalysis {
  /** Total shared types */
  totalSharedTypes: number;

  /** Types with version skew */
  typesWithVersionSkew: GlobalEntityId[];

  /** Types with inconsistencies */
  typesWithInconsistencies: TypeInconsistency[];

  /** Most shared types */
  mostSharedTypes: SharedType[];

  /** Analysis confidence */
  confidence: ConfidenceValue;
}

interface DetectedPattern {
  patternType: string;  // 'microservices' | 'monolith' | 'hybrid' | 'layered'
  description: string;
  evidence: string[];
  confidence: ConfidenceValue;
}

interface ArchitectureConcern {
  category: 'coupling' | 'cohesion' | 'complexity' | 'consistency' | 'maintainability';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedRepos: RepoId[];
  evidence: string[];
  confidence: ConfidenceValue;
}

interface ArchitectureRecommendation {
  category: string;
  recommendation: string;
  expectedBenefit: string;
  estimatedEffort: string;
  priority: 'low' | 'medium' | 'high';
  confidence: ConfidenceValue;
}
```

---

## 5. Federation Model

### Independent Indexing, Unified Querying

```typescript
/**
 * Federation architecture: repos indexed independently, queried together.
 *
 * KEY INSIGHT: Each repo maintains its own knowledge base.
 * The federation layer provides unified querying without centralizing storage.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      FEDERATION LAYER                           │
 * │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
 * │  │ Query   │  │ Entity  │  │ Global  │  │ Access  │           │
 * │  │ Router  │  │ Resolver│  │ Graph   │  │ Control │           │
 * │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘           │
 * └───────┼───────────┼───────────┼───────────┼───────────────────┘
 *         │           │           │           │
 *    ┌────┴────┬──────┴───┬──────┴───┬──────┴────┐
 *    ▼         ▼          ▼          ▼           ▼
 * ┌──────┐ ┌──────┐  ┌──────┐  ┌──────┐    ┌──────┐
 * │Repo A│ │Repo B│  │Repo C│  │Repo D│ ...│Repo N│
 * │  KB  │ │  KB  │  │  KB  │  │  KB  │    │  KB  │
 * └──────┘ └──────┘  └──────┘  └──────┘    └──────┘
 */

interface FederationQueryRouter {
  /**
   * Route a query to relevant repos based on query analysis.
   */
  routeQuery(
    query: FederatedQuery,
    federation: MultiRepoIndex
  ): Promise<QueryRoutingPlan>;
}

interface QueryRoutingPlan {
  /** Repos to query */
  targetRepos: RepoId[];

  /** Query to send to each repo */
  repoQueries: Map<RepoId, LocalQuery>;

  /** How to merge results */
  mergeStrategy: MergeStrategy;

  /** Estimated latency */
  estimatedLatencyMs: number;

  /** Routing confidence */
  confidence: ConfidenceValue;
}

type MergeStrategy = 'union' | 'intersection' | 'ranked_fusion' | 'weighted_average';

interface FederatedQuery {
  queryType: 'search' | 'dependency' | 'impact' | 'type_trace';
  parameters: Record<string, unknown>;
  repoFilter?: RepoId[];
  maxResults?: number;
}
```

### Incremental Updates

```typescript
/**
 * Incremental update strategy: update repos independently,
 * refresh cross-repo links incrementally.
 */
interface FederationUpdater {
  /**
   * Update a single repo's knowledge base.
   * Triggers cross-repo link refresh for affected entities.
   */
  updateRepo(
    federation: MultiRepoIndex,
    repoId: RepoId,
    changes: RepoChanges
  ): Promise<FederationUpdateResult>;

  /**
   * Refresh cross-repo links affected by repo update.
   */
  refreshCrossRepoLinks(
    federation: MultiRepoIndex,
    affectedEntities: GlobalEntityId[]
  ): Promise<LinkRefreshResult>;

  /**
   * Full federation rebuild (expensive, for recovery).
   */
  rebuildFederation(
    federation: MultiRepoIndex
  ): Promise<FederationBuildResult>;
}

interface RepoChanges {
  repoId: RepoId;
  addedEntities: EntityId[];
  modifiedEntities: EntityId[];
  removedEntities: EntityId[];
  newCommitHash: string;
}

interface FederationUpdateResult {
  repoId: RepoId;
  entitiesUpdated: number;
  crossRepoLinksRefreshed: number;
  newConflicts: EntityConflict[];
  resolvedConflicts: EntityConflict[];
  updateDurationMs: number;
  confidence: ConfidenceValue;
}

interface LinkRefreshResult {
  linksRefreshed: number;
  linksAdded: number;
  linksRemoved: number;
  newInconsistencies: TypeInconsistency[];
  refreshDurationMs: number;
  confidence: ConfidenceValue;
}
```

### Permission Model

```typescript
/**
 * Permission model: which agents can see which repos.
 *
 * PRINCIPLE: Least privilege. Agents only see repos they need.
 */
interface RepoAccessPolicy {
  /** Repo this policy applies to */
  repoId: RepoId;

  /** Default access level */
  defaultAccess: AccessLevel;

  /** Agent-specific overrides */
  agentOverrides: Map<AgentId, AccessLevel>;

  /** Team-based access */
  teamAccess: Map<TeamId, AccessLevel>;

  /** Sensitive paths (always restricted) */
  sensitivePaths: string[];
}

type AccessLevel = 'none' | 'metadata_only' | 'read' | 'read_write' | 'admin';
type AgentId = string & { readonly __brand: 'AgentId' };
type TeamId = string & { readonly __brand: 'TeamId' };

interface FederationAccessController {
  /**
   * Check if agent can access repo.
   */
  canAccess(
    agentId: AgentId,
    repoId: RepoId,
    operation: Operation
  ): boolean;

  /**
   * Filter query results based on agent permissions.
   */
  filterResults<T>(
    agentId: AgentId,
    results: T[],
    getRepoId: (item: T) => RepoId
  ): T[];

  /**
   * Get repos visible to agent.
   */
  getVisibleRepos(
    agentId: AgentId,
    federation: MultiRepoIndex
  ): RepoId[];
}

type Operation = 'read' | 'write' | 'delete' | 'admin';
```

### Staleness Management

```typescript
/**
 * Staleness management: track freshness across repo boundaries.
 *
 * CHALLENGE: Repo A was indexed 1 hour ago, Repo B 1 week ago.
 * Cross-repo queries must account for this.
 */
interface StalenessTracker {
  /**
   * Get staleness status for a repo.
   */
  getRepoStaleness(
    repoId: RepoId,
    federation: MultiRepoIndex
  ): StalenessStatus;

  /**
   * Get staleness status for a cross-repo query result.
   */
  getResultStaleness(
    results: CrossRepoSearchResult[],
    federation: MultiRepoIndex
  ): AggregatedStaleness;

  /**
   * Recommend repos that need re-indexing.
   */
  getStaleRepos(
    federation: MultiRepoIndex,
    maxAgeMs: number
  ): StaleRepoRecommendation[];
}

interface StalenessStatus {
  repoId: RepoId;
  lastIndexedAt: Date;
  ageMs: number;

  /** How much has changed since last index */
  changesSinceIndex: number;

  /** Staleness classification */
  classification: 'fresh' | 'stale' | 'very_stale' | 'unknown';

  /** Confidence in staleness assessment */
  confidence: ConfidenceValue;
}

interface AggregatedStaleness {
  /** Freshest result age */
  minAgeMs: number;

  /** Most stale result age */
  maxAgeMs: number;

  /** Average result age */
  avgAgeMs: number;

  /** Repos by staleness */
  repoStaleness: Map<RepoId, StalenessStatus>;

  /** Overall query freshness confidence */
  freshnessConfidence: ConfidenceValue;
}

interface StaleRepoRecommendation {
  repoId: RepoId;
  staleness: StalenessStatus;
  impactOnFederation: 'high' | 'medium' | 'low';
  recommendedAction: 'reindex' | 'incremental_update' | 'no_action';
}
```

---

## 6. Global Views

### System-Wide Architecture Diagram

```typescript
/**
 * Generate system-wide architecture diagram spanning all repos.
 */
interface GlobalArchitectureDiagramGenerator {
  /**
   * Generate architecture diagram.
   */
  generateDiagram(
    federation: MultiRepoIndex,
    options?: DiagramOptions
  ): Promise<ArchitectureDiagram>;
}

interface DiagramOptions {
  /** Diagram format */
  format: 'mermaid' | 'dot' | 'plantuml' | 'json';

  /** Detail level */
  detailLevel: 'high_level' | 'component' | 'detailed';

  /** Focus repos (highlight these) */
  focusRepos?: RepoId[];

  /** Show cross-repo edges */
  showCrossRepoEdges: boolean;

  /** Group by (how to organize nodes) */
  groupBy?: 'repo' | 'domain' | 'team';
}

interface ArchitectureDiagram {
  /** Diagram source code */
  source: string;

  /** Format of the diagram */
  format: string;

  /** Nodes in the diagram */
  nodes: DiagramNode[];

  /** Edges in the diagram */
  edges: DiagramEdge[];

  /** Legend */
  legend: string;

  /** Generation confidence */
  confidence: ConfidenceValue;
}

interface DiagramNode {
  id: string;
  label: string;
  type: 'repo' | 'component' | 'service' | 'database' | 'external';
  metadata: Record<string, unknown>;
}

interface DiagramEdge {
  source: string;
  target: string;
  label?: string;
  edgeType: 'dependency' | 'api_call' | 'data_flow' | 'event';
  crossesRepoBoundary: boolean;
}
```

### Global Dependency Graph Visualization

```typescript
/**
 * Visualize the global dependency graph.
 */
interface GlobalDependencyVisualizer {
  /**
   * Generate interactive dependency visualization.
   */
  visualize(
    graph: GlobalDependencyGraph,
    options?: VisualizationOptions
  ): Promise<DependencyVisualization>;

  /**
   * Generate dependency matrix (repos x repos).
   */
  generateDependencyMatrix(
    graph: GlobalDependencyGraph
  ): Promise<DependencyMatrix>;
}

interface VisualizationOptions {
  /** Layout algorithm */
  layout: 'force_directed' | 'hierarchical' | 'circular';

  /** Node coloring strategy */
  colorBy: 'repo' | 'type' | 'criticality';

  /** Edge filtering */
  edgeFilter?: {
    minWeight?: number;
    types?: CrossRepoDependencyType[];
  };

  /** Highlight paths to/from specific entity */
  highlightEntity?: GlobalEntityId;
}

interface DependencyVisualization {
  /** Visualization data (e.g., D3.js compatible) */
  data: unknown;

  /** Visualization type */
  type: string;

  /** Interactive features available */
  interactiveFeatures: string[];

  /** Generation confidence */
  confidence: ConfidenceValue;
}

interface DependencyMatrix {
  /** Repos in order */
  repos: RepoId[];

  /** Matrix[i][j] = dependency count from repos[i] to repos[j] */
  matrix: number[][];

  /** Cells with circular dependencies */
  circularCells: Array<[number, number]>;

  /** Matrix generation confidence */
  confidence: ConfidenceValue;
}
```

### Cross-Repo Ownership Mapping

```typescript
/**
 * Map ownership across repositories.
 */
interface CrossRepoOwnershipMapper {
  /**
   * Build ownership map for the federation.
   */
  buildOwnershipMap(
    federation: MultiRepoIndex
  ): Promise<GlobalOwnershipMap>;

  /**
   * Find owners for a cross-repo path.
   */
  findPathOwners(
    path: DependencyPath
  ): Promise<PathOwnership>;
}

interface GlobalOwnershipMap {
  /** Repos by owner */
  reposByOwner: Map<OwnerId, RepoId[]>;

  /** Entities by owner */
  entitiesByOwner: Map<OwnerId, GlobalEntityId[]>;

  /** Shared ownership (multiple owners) */
  sharedOwnership: SharedOwnershipArea[];

  /** Unowned areas */
  unownedAreas: UnownedArea[];

  /** Mapping confidence */
  confidence: ConfidenceValue;
}

type OwnerId = string & { readonly __brand: 'OwnerId' };

interface SharedOwnershipArea {
  description: string;
  owners: OwnerId[];
  repos: RepoId[];
  entities: GlobalEntityId[];
}

interface UnownedArea {
  description: string;
  repos: RepoId[];
  entities: GlobalEntityId[];
  suggestedOwner?: OwnerId;
}

interface PathOwnership {
  path: DependencyPath;
  ownersBySegment: Map<number, OwnerId[]>;
  primaryOwner?: OwnerId;
  ownershipClarity: 'clear' | 'shared' | 'unclear' | 'unowned';
  confidence: ConfidenceValue;
}
```

### Cross-Repo API Documentation

```typescript
/**
 * Generate API documentation spanning repositories.
 */
interface CrossRepoAPIDocGenerator {
  /**
   * Generate unified API documentation.
   */
  generateAPIDocs(
    federation: MultiRepoIndex,
    options?: APIDocOptions
  ): Promise<UnifiedAPIDocs>;
}

interface APIDocOptions {
  /** Output format */
  format: 'openapi' | 'graphql_schema' | 'markdown' | 'html';

  /** Include internal APIs */
  includeInternal: boolean;

  /** Group by (organization) */
  groupBy: 'repo' | 'domain' | 'version';

  /** Include deprecation info */
  includeDeprecation: boolean;
}

interface UnifiedAPIDocs {
  /** All APIs documented */
  apis: APIDocumentation[];

  /** Index/table of contents */
  index: APIIndex;

  /** Cross-references between APIs */
  crossReferences: APICrossReference[];

  /** Generation metadata */
  generatedAt: Date;

  /** Documentation confidence */
  confidence: ConfidenceValue;
}

interface APIDocumentation {
  api: APIIdentifier;
  providerRepo: RepoId;
  description: string;
  endpoints: EndpointDoc[];
  types: TypeDoc[];
  examples: APIExample[];
  deprecationInfo?: DeprecationInfo;
}

interface APICrossReference {
  sourceAPI: APIIdentifier;
  targetAPI: APIIdentifier;
  referenceType: 'calls' | 'extends' | 'implements' | 'related';
}
```

---

## 7. Integration Points

### Integration with Track C: Hierarchical Knowledge

```typescript
/**
 * Hierarchy spans repos: system summary covers entire federation.
 *
 * INTEGRATION: Track C's HierarchicalKnowledge extends to multi-repo.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ LEVEL 0: Federation Summary (~1000 tokens)                      │
 * │ "What is this microservices system?"                            │
 * │ All repos, global architecture, cross-cutting concerns          │
 * └─────────────────────────────────────────────────────────────────┘
 *                               │
 *                               ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ LEVEL 0.5: Repo Summaries (~500 tokens each)                    │
 * │ "What does this repo do in the system?"                         │
 * │ Per-repo purpose, public interface, integration points          │
 * └─────────────────────────────────────────────────────────────────┘
 *                               │
 *                               ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ LEVEL 1+: Standard Track C hierarchy within each repo           │
 * │ Component -> Entity -> Full Source                              │
 * └─────────────────────────────────────────────────────────────────┘
 */

interface FederatedHierarchicalKnowledge extends HierarchicalKnowledge {
  /** Federation-level summary (above system summary) */
  federationSummary: FederationSummary;

  /** Per-repo summaries */
  repoSummaries: Map<RepoId, RepoSummary>;

  /** Cross-repo component relationships */
  crossRepoComponentLinks: CrossRepoComponentLink[];
}

interface FederationSummary {
  /** One-paragraph description of the entire system */
  purpose: string;

  /** High-level architecture (microservices, monolith, hybrid) */
  architecture: string;

  /** Main repos and their roles */
  mainRepos: Array<{ repoId: RepoId; role: string }>;

  /** Cross-cutting concerns (auth, logging, etc.) */
  crossCuttingConcerns: string[];

  /** Key integration patterns */
  integrationPatterns: string[];

  /** Summary statistics */
  stats: {
    totalRepos: number;
    totalServices: number;
    totalAPIs: number;
    totalSharedTypes: number;
  };

  /** Summary confidence */
  confidence: ConfidenceValue;
}

interface RepoSummary {
  repoId: RepoId;

  /** Repo's role in the federation */
  federationRole: string;

  /** Public interfaces this repo exposes */
  exposedInterfaces: string[];

  /** Interfaces this repo consumes */
  consumedInterfaces: string[];

  /** Integration points (APIs, events, shared DBs) */
  integrationPoints: IntegrationPoint[];

  /** Summary confidence */
  confidence: ConfidenceValue;
}

interface IntegrationPoint {
  type: 'api_provider' | 'api_consumer' | 'event_publisher' | 'event_subscriber' | 'shared_db';
  description: string;
  counterpartyRepos: RepoId[];
}

interface CrossRepoComponentLink {
  sourceComponent: { repoId: RepoId; componentId: ComponentId };
  targetComponent: { repoId: RepoId; componentId: ComponentId };
  linkType: 'depends_on' | 'provides_to' | 'shares_type_with' | 'calls_api_of';
  confidence: ConfidenceValue;
}
```

### Integration with Track B: Bootstrap

```typescript
/**
 * Per-repo bootstrap feeding into federation.
 *
 * INTEGRATION: Each repo bootstraps independently,
 * then federation layer links them together.
 */

interface FederatedBootstrap {
  /**
   * Bootstrap a new repo and add to federation.
   */
  bootstrapAndFederate(
    federation: MultiRepoIndex,
    repoPath: string,
    options?: FederatedBootstrapOptions
  ): Promise<FederatedBootstrapResult>;

  /**
   * Re-bootstrap a repo and update federation links.
   */
  rebootstrapRepo(
    federation: MultiRepoIndex,
    repoId: RepoId
  ): Promise<FederatedBootstrapResult>;
}

interface FederatedBootstrapOptions {
  /** Standard bootstrap options */
  bootstrapOptions?: BootstrapOptions;

  /** Auto-detect cross-repo links */
  autoDetectLinks: boolean;

  /** Link detection strategies */
  linkDetectionStrategies: LinkDetectionStrategy[];
}

type LinkDetectionStrategy =
  | 'package_json_dependencies'
  | 'import_statements'
  | 'api_client_detection'
  | 'event_schema_matching'
  | 'shared_type_matching';

interface FederatedBootstrapResult {
  /** Bootstrap result for the repo */
  repoBootstrap: BootstrapResult;

  /** Cross-repo links detected */
  detectedLinks: CrossRepoDependencyEdge[];

  /** Entity resolutions added */
  entityResolutions: CanonicalEntity[];

  /** Conflicts discovered */
  conflicts: EntityConflict[];

  /** Bootstrap confidence */
  confidence: ConfidenceValue;
}
```

### Integration with Evidence Ledger

```typescript
/**
 * Cross-repo evidence correlation.
 *
 * INTEGRATION: Evidence from one repo can support claims in another.
 */

interface CrossRepoEvidenceCorrelator {
  /**
   * Find corroborating evidence across repos.
   */
  findCorroboratingEvidence(
    claim: Claim,
    sourceRepo: RepoId,
    federation: MultiRepoIndex
  ): Promise<CrossRepoEvidence[]>;

  /**
   * Track evidence chains across repo boundaries.
   */
  traceEvidenceChain(
    startingEvidence: Evidence,
    federation: MultiRepoIndex
  ): Promise<EvidenceChain>;
}

interface CrossRepoEvidence {
  /** Source repo of evidence */
  repoId: RepoId;

  /** The evidence */
  evidence: Evidence;

  /** How it relates to the claim */
  relationToClaim: 'supports' | 'contradicts' | 'neutral';

  /** Strength of correlation */
  correlationStrength: ConfidenceValue;
}

interface EvidenceChain {
  /** Ordered evidence across repos */
  links: EvidenceChainLink[];

  /** Repos traversed */
  reposTraversed: RepoId[];

  /** Chain strength (combined confidence) */
  chainConfidence: ConfidenceValue;
}

interface EvidenceChainLink {
  repoId: RepoId;
  evidence: Evidence;
  linkToNext?: {
    type: 'implies' | 'corroborates' | 'extends';
    confidence: ConfidenceValue;
  };
}
```

---

## 8. Implementation Roadmap

### Phase 1: Core Types and Multi-Repo Index (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/multi_repo_index.ts (types)
// - src/librarian/storage/federation_storage.ts (persistence)

// Deliverables:
// - All type definitions from this spec
// - MultiRepoIndex interface implementation
// - Federation storage adapter
// - Basic serialization/deserialization
```

**Estimated effort**: 2 days

### Phase 2: Entity Resolution (~150 LOC)

```typescript
// Files to create:
// - src/librarian/api/cross_repo_entity_resolution.ts

// Deliverables:
// - CrossRepoEntityResolution implementation
// - Canonical entity detection
// - Conflict detection and reporting
// - Signature-based matching
```

**Estimated effort**: 2 days

### Phase 3: Global Dependency Graph (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/global_dependency_graph.ts

// Deliverables:
// - GlobalDependencyGraph construction
// - Cross-repo edge detection
// - Graph traversal utilities
// - Circular dependency detection
```

**Estimated effort**: 2 days

### Phase 4: Cross-Repo Primitives (~300 LOC)

```typescript
// Files to create:
// - src/librarian/api/cross_repo_primitives.ts

// Deliverables:
// - tp_cross_repo_search implementation
// - tp_cross_repo_dependency implementation
// - tp_cross_repo_impact implementation
// - tp_api_consumer_find implementation
// - tp_shared_type_trace implementation
// - tp_version_compatibility implementation
```

**Estimated effort**: 3 days

### Phase 5: Cross-Repo Compositions (~250 LOC)

```typescript
// Files to create:
// - src/librarian/api/cross_repo_compositions.ts

// Deliverables:
// - tc_cross_repo_change_verify implementation
// - tc_api_evolution_plan implementation
// - tc_dependency_upgrade_multi implementation
// - tc_global_architecture_review implementation
```

**Estimated effort**: 3 days

### Phase 6: Federation Layer (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/federation_layer.ts

// Deliverables:
// - FederationQueryRouter implementation
// - FederationUpdater implementation
// - FederationAccessController implementation
// - StalenessTracker implementation
```

**Estimated effort**: 2 days

### Phase 7: Global Views (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/global_views.ts

// Deliverables:
// - GlobalArchitectureDiagramGenerator implementation
// - GlobalDependencyVisualizer implementation
// - CrossRepoOwnershipMapper implementation
// - CrossRepoAPIDocGenerator implementation
```

**Estimated effort**: 2 days

### Phase 8: Integration & Testing (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/__tests__/multi_repo.test.ts
// - src/librarian/api/__tests__/cross_repo_primitives.test.ts

// Deliverables:
// - Track C hierarchical knowledge integration
// - Track B bootstrap integration
// - Evidence ledger integration
// - Comprehensive tests
// - Documentation
```

**Estimated effort**: 3 days

### Total Estimate

| Phase | LOC | Days |
|-------|-----|------|
| Core Types | 200 | 2 |
| Entity Resolution | 150 | 2 |
| Global Dependency Graph | 200 | 2 |
| Cross-Repo Primitives | 300 | 3 |
| Cross-Repo Compositions | 250 | 3 |
| Federation Layer | 200 | 2 |
| Global Views | 200 | 2 |
| Integration & Testing | 200 | 3 |
| **Total** | **~1,700** | **~19** |

---

## Acceptance Criteria

### Multi-Repo Index

- [ ] Federation can be created with multiple repos
- [ ] Repos can be added/removed from federation
- [ ] Cross-repo links are bidirectional
- [ ] Entity resolution correctly identifies shared types
- [ ] Conflicts are detected and reported

### Cross-Repo Primitives

- [ ] `tp_cross_repo_search` returns results from all repos
- [ ] `tp_cross_repo_dependency` traces across repo boundaries
- [ ] `tp_cross_repo_impact` identifies all affected repos
- [ ] `tp_api_consumer_find` finds all API consumers
- [ ] `tp_shared_type_trace` traces type usage across repos
- [ ] `tp_version_compatibility` detects version conflicts

### Cross-Repo Compositions

- [ ] `tc_cross_repo_change_verify` produces rollout plan
- [ ] `tc_api_evolution_plan` produces migration guides
- [ ] `tc_dependency_upgrade_multi` determines upgrade order
- [ ] `tc_global_architecture_review` produces comprehensive report

### Federation Layer

- [ ] Queries are routed to relevant repos
- [ ] Results are merged correctly
- [ ] Permissions are enforced
- [ ] Staleness is tracked and reported
- [ ] Incremental updates work correctly

### Confidence

- [ ] All confidence values use `ConfidenceValue` type
- [ ] Cross-repo operations use `absent` confidence until calibrated
- [ ] Staleness affects confidence reporting
- [ ] No raw numeric confidence values

---

## Evidence Commands

```bash
# Run multi-repo tests
cd packages/librarian && npx vitest run src/api/__tests__/multi_repo.test.ts

# Run cross-repo primitive tests
cd packages/librarian && npx vitest run src/api/__tests__/cross_repo_primitives.test.ts

# Verify exports
node -e "import('librarian').then(m => console.log(Object.keys(m).filter(k => k.includes('MultiRepo') || k.includes('CrossRepo'))))"

# Build federation for multiple repos (when implemented)
cd packages/librarian && npx tsx src/cli/index.ts build-federation /path/to/repo1 /path/to/repo2 ...

# Check implementation status
ls -la packages/librarian/src/api/multi_repo_index.ts
ls -la packages/librarian/src/api/cross_repo_primitives.ts
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification for UC20: Multi-Repository Analysis |
