# Multi-Perspective Views Research

> **Research Document**: How to provide multi-perspective views of the same codebase for different audiences/purposes
>
> **Date**: 2026-01-30
>
> **Status**: Research Complete - Ready for Implementation Planning

---

## Executive Summary

This research investigates how LiBrainian can serve different perspectives on the same indexed codebase. The core insight is that **the same code entity has different relevance depending on who is asking and why**. A single function might be:
- A bug hotspot (for debugging agents)
- A security boundary (for security reviewers)
- A performance bottleneck (for optimization work)
- An API surface (for architects)
- A test target (for quality assurance)

The research concludes that perspectives should be implemented as **query-time filters with lightweight index-time annotations**, leveraging LiBrainian's existing T-pattern categories and query classification infrastructure.

---

## Part 1: Research Findings

### 1.1 Faceted Classification Systems

Faceted classification (pioneered by Ranganathan in 1933) provides the theoretical foundation for multi-perspective retrieval. Key principles from [faceted search research](https://en.wikipedia.org/wiki/Faceted_classification):

**Core Concepts:**
- **Facets**: Orthogonal dimensions for classification (e.g., entity type, concern, audience)
- **Navigation flexibility**: Users can explore any facet first, in any order
- **Dynamic organization**: Structure adapts to query context rather than forcing fixed taxonomy
- **Post-coordination**: Classifications are combined at query time, not pre-computed

**Application to Code:**
```
Entity: AuthenticationService.validateToken()

Facets:
  - EntityType: function
  - Concern: security, auth, input-validation
  - RiskProfile: high (handles credentials)
  - TestCoverage: 85%
  - Complexity: medium
  - Audience: [security-reviewer, bug-fixer, api-designer]
```

**Key insight**: Faceted search enables multiple valid "views" of the same item depending on which facets are emphasized during retrieval.

### 1.2 Architectural View Models

#### The 4+1 View Model (Kruchten, 1995)

From [IEEE Software](https://arxiv.org/pdf/2006.04975) and [Kruchten's original paper](https://www.cs.ubc.ca/~gregor/teaching/papers/4+1view-architecture.pdf):

| View | Stakeholder | Concerns | LiBrainian Equivalent |
|------|-------------|----------|---------------------|
| **Logical** | End users, analysts | Functionality, features | Module purpose, API surface |
| **Process** | System engineers | Concurrency, performance | Async patterns, data flow |
| **Development** | Developers | Code organization, builds | Dependencies, test mapping |
| **Physical** | Operations | Deployment, infrastructure | File structure, configs |
| **Scenarios (+1)** | All | Use cases drive validation | Query intent itself |

**Key insight**: "No single view adequately captures all stakeholder concerns" - this validates the need for perspective-aware retrieval.

#### The C4 Model (Simon Brown)

From [c4model.com](https://c4model.com/) and [Wikipedia](https://en.wikipedia.org/wiki/C4_model):

| Level | Abstraction | Audience |
|-------|-------------|----------|
| **Context** | System in environment | Non-technical stakeholders |
| **Container** | Applications, data stores | Architects, developers |
| **Component** | Modules, services | Developers |
| **Code** | Classes, functions | Developers |

**Key insight**: Different zoom levels serve different audiences - LiBrainian already has `L0-L3` depth levels that map to this.

#### ISO/IEC/IEEE 42010

From [iso-architecture.org](http://www.iso-architecture.org/ieee-1471/cm/):

> "An architecture description is inherently multi-view. A viewpoint identifies the set of concerns and the representations/modeling techniques used to describe the architecture."

**Key insight**: Views are *governed by viewpoints* - the perspective defines what representations are valid, not just what content is retrieved.

### 1.3 Personalization in Information Retrieval

From research on [adaptive personalized retrieval](https://arxiv.org/html/2508.08634):

**Key findings:**
1. **Not all queries require personalization** - some are objective, some are context-dependent
2. **Adaptive approach**: First classify query's personalization needs, then apply appropriate bias
3. **Multi-signal ranking**: Combine semantic similarity with context signals (user role, task type, history)

**Application to LiBrainian:**
- Query classification already exists (`classifyQueryIntent` in `src/api/query.ts`)
- Task type is already a query parameter
- Extension: Add `perspective` as a first-class query parameter

### 1.4 Existing LiBrainian Infrastructure

LiBrainian already has significant infrastructure that supports perspective-aware retrieval:

**T-Pattern Categories** (from `src/knowledge/t_patterns.ts`):
```typescript
type TPatternCategory =
  | 'navigation'       // T-01 to T-06
  | 'understanding'    // T-07 to T-12
  | 'modification'     // T-13 to T-18
  | 'bug_investigation'// T-19 to T-24
  | 'hard_scenarios';  // T-25 to T-30
```

**Query Classification** (from `src/api/query.ts`):
```typescript
interface QueryClassification {
  isMetaQuery: boolean;    // About documentation/concepts
  isCodeQuery: boolean;    // About implementation
  documentBias: number;    // 0-1, higher = prefer documents
  entityTypes: EmbeddableEntityType[];
}
```

**Analysis Task Types** (from `src/types.ts`):
```typescript
type AnalysisTaskType =
  | 'premortem'           // Anticipate failures
  | 'slop_detection'      // AI quality patterns
  | 'code_review'         // General quality
  | 'security_audit'      // Vulnerabilities
  | 'complexity_audit'    // Technical debt
  | 'debugging'           // Bug investigation
  | 'architecture_review' // Structure analysis
  | 'test_coverage'       // Testing gaps
  | 'integration_risk'    // Integration issues
  | 'performance_audit';  // Performance analysis
```

**Constructions** (task-specific compositions):
- `BugInvestigationAssistant` - debugging perspective
- `SecurityAuditHelper` - security perspective
- `CodeQualityReporter` - quality perspective
- `FeatureLocationAdvisor` - modification perspective

**Key insight**: The infrastructure exists, but perspectives are implicit rather than explicit.

---

## Part 2: Taxonomy of Useful Perspectives

### 2.1 Proposed Perspective Taxonomy (7 Perspectives)

Based on research findings and LiBrainian's existing categories:

| Perspective | Primary User | Key Questions | Priority Signals |
|-------------|--------------|---------------|------------------|
| **debugging** | Bug-fixing agent | "What calls this?", "Where do errors propagate?" | Call graph, error handling, stack traces, test failures |
| **security** | Security reviewer | "What touches user input?", "Where are auth boundaries?" | Input validation, auth flows, crypto usage, secrets |
| **performance** | Optimization agent | "What are hot paths?", "Where are I/O operations?" | Complexity, async patterns, allocations, caching |
| **architecture** | Human architect | "What are the boundaries?", "How coupled is this?" | Module dependencies, design patterns, technical debt |
| **modification** | Feature developer | "Where should I add this?", "What breaks if I change this?" | Similar patterns, test coverage, breaking changes |
| **testing** | QA engineer | "What's untested?", "What are the edge cases?" | Test mapping, coverage gaps, assertion patterns |
| **understanding** | Onboarding dev | "What does this do?", "How do these relate?" | Purpose summaries, documentation, call relationships |

### 2.2 Perspective Signal Mappings

Each perspective emphasizes different entity attributes:

```
DEBUGGING PERSPECTIVE
  High weight: error_handling (T-10, T-19, T-23), call_graph (T-03), test_mapping (T-06)
  Entity types: function > module > file
  Extra context: stack traces, recent failures, exception paths

SECURITY PERSPECTIVE
  High weight: security_extractor patterns, input_validation, auth_checks
  Entity types: function > module
  Extra context: CWE references, OWASP mappings, threat model

PERFORMANCE PERSPECTIVE
  High weight: async_patterns (T-21), complexity, side_effects (T-12)
  Entity types: function > module
  Extra context: hotspot analysis, I/O patterns, caching opportunities

ARCHITECTURE PERSPECTIVE
  High weight: dependency_graph (T-04), design_patterns (T-09), circular_deps (T-29)
  Entity types: module > directory > file
  Extra context: boundaries, coupling metrics, ADRs

MODIFICATION PERSPECTIVE
  High weight: usage_analysis (T-13), breaking_changes (T-14), feature_location (T-16)
  Entity types: function > module > file
  Extra context: similar patterns, affected tests, ownership

TESTING PERSPECTIVE
  High weight: test_gaps (T-17), test_mapping (T-06), coverage
  Entity types: function > file
  Extra context: assertion patterns, mock requirements, edge cases

UNDERSTANDING PERSPECTIVE
  High weight: function_purpose (T-07), module_architecture (T-08), documentation
  Entity types: document > module > function
  Extra context: relationships, data flow (T-11), entry points
```

---

## Part 3: Mapping to Existing LiBrainian Entities

### 3.1 Entity Type Relevance by Perspective

| Entity Type | debugging | security | performance | architecture | modification | testing | understanding |
|-------------|-----------|----------|-------------|--------------|--------------|---------|---------------|
| function | HIGH | HIGH | HIGH | medium | HIGH | HIGH | HIGH |
| module | medium | medium | medium | HIGH | HIGH | medium | HIGH |
| file | low | medium | low | medium | medium | HIGH | medium |
| directory | low | low | low | HIGH | medium | low | medium |
| document | low | low | low | medium | low | low | HIGH |

### 3.2 Existing Pattern/Extractor Mapping

| LiBrainian Component | Primary Perspectives |
|---------------------|---------------------|
| `SecurityExtractor` (CWE patterns) | security |
| `T-19 to T-24` (Bug Investigation) | debugging |
| `T-28` (Performance Anti-patterns) | performance |
| `T-29` (Circular Dependencies) | architecture |
| `T-13 to T-18` (Modification Support) | modification |
| `T-06, T-17` (Test Mapping, Test Gaps) | testing |
| `T-07, T-08` (Purpose, Architecture) | understanding |

### 3.3 Context Pack Type Relevance

| Pack Type | Relevant Perspectives |
|-----------|----------------------|
| `function_context` | all |
| `module_context` | architecture, understanding, modification |
| `pattern_context` | architecture, modification |
| `decision_context` | architecture, understanding |
| `change_impact` | modification, debugging |
| `similar_tasks` | modification, debugging |
| `doc_context` | understanding, security (compliance docs) |

---

## Part 4: Query Syntax Proposal

### 4.1 Explicit Perspective Parameter

Extend `LibrarianQuery` with perspective support:

```typescript
interface LibrarianQuery {
  intent: string;
  depth: 'L0' | 'L1' | 'L2' | 'L3';

  // NEW: Explicit perspective selection
  perspective?: Perspective;

  // Existing fields
  taskType?: string;
  affectedFiles?: string[];
  // ...
}

type Perspective =
  | 'debugging'
  | 'security'
  | 'performance'
  | 'architecture'
  | 'modification'
  | 'testing'
  | 'understanding';
```

### 4.2 Perspective Inference from Task Type

When perspective is not explicit, infer from taskType:

```typescript
const TASK_TYPE_TO_PERSPECTIVE: Record<string, Perspective> = {
  // Direct mappings
  'security_audit': 'security',
  'debugging': 'debugging',
  'performance_audit': 'performance',
  'architecture_review': 'architecture',
  'code_review': 'modification',
  'test_coverage': 'testing',

  // Analysis task mappings
  'premortem': 'architecture',
  'complexity_audit': 'architecture',
  'integration_risk': 'modification',
  'slop_detection': 'modification',
};
```

### 4.3 Perspective-Aware Query Examples

```typescript
// Explicit security perspective
await LiBrainian.query({
  intent: 'authentication flow',
  perspective: 'security',
  depth: 'L2',
});

// Inferred from taskType
await LiBrainian.query({
  intent: 'find memory leaks',
  taskType: 'performance_audit',  // implies performance perspective
  depth: 'L2',
});

// Multi-perspective (advanced)
await LiBrainian.query({
  intent: 'review payment processing',
  perspectives: ['security', 'architecture'],  // combined view
  depth: 'L3',
});
```

### 4.4 CLI Extension

```bash
# Explicit perspective
LiBrainian query "auth flow" --perspective=security

# Combined perspectives
LiBrainian query "payment module" --perspectives=security,architecture

# Perspective with task type
LiBrainian query "debug login failure" --task-type=debugging
```

---

## Part 5: Strategy for Multi-Perspective Response Synthesis

### 5.1 Single-Perspective Synthesis

When one perspective is requested, apply perspective-specific filtering and weighting:

```typescript
interface PerspectiveConfig {
  id: Perspective;

  // Retrieval phase
  entityTypeWeights: Record<EmbeddableEntityType, number>;
  patternCategories: TPatternCategory[];
  minConfidenceByEntity: Record<string, number>;

  // Scoring phase
  signalWeights: Record<string, number>;
  boostPatterns: RegExp[];  // Boost results matching these patterns
  penaltyPatterns: RegExp[];  // Penalize results matching these

  // Synthesis phase
  focusPrompt: string;  // Perspective-specific synthesis guidance
  requiredSections: string[];  // Sections to include in output
}

const SECURITY_PERSPECTIVE: PerspectiveConfig = {
  id: 'security',
  entityTypeWeights: { function: 1.0, module: 0.8, document: 0.6 },
  patternCategories: ['hard_scenarios'],  // T-27 specifically
  minConfidenceByEntity: { function: 0.4, module: 0.5 },
  signalWeights: {
    security_relevance: 0.4,
    semantic: 0.3,
    recency: 0.15,
    confidence: 0.15,
  },
  boostPatterns: [/auth|crypt|valid|saniti|secret|token|credential/i],
  penaltyPatterns: [/test|mock|stub|fixture/i],
  focusPrompt: 'Focus on security implications, attack vectors, and trust boundaries.',
  requiredSections: ['vulnerabilities', 'trust_boundaries', 'recommendations'],
};
```

### 5.2 Multi-Perspective Synthesis

When multiple perspectives are requested, synthesize with explicit acknowledgment of each viewpoint:

```typescript
interface MultiPerspectiveResponse {
  // Shared understanding
  summary: string;
  entities: RetrievedEntity[];

  // Per-perspective analysis
  perspectives: {
    [K in Perspective]?: {
      relevantFindings: string[];
      concerns: string[];
      recommendations: string[];
      confidence: number;
    };
  };

  // Cross-perspective synthesis
  conflicts: PerspectiveConflict[];
  synergies: PerspectiveSynergy[];
  overallRecommendation: string;
}

interface PerspectiveConflict {
  perspectives: [Perspective, Perspective];
  description: string;
  resolution: string;
}

interface PerspectiveSynergy {
  perspectives: Perspective[];
  insight: string;
}
```

### 5.3 Synthesis Prompt Template

```typescript
const MULTI_PERSPECTIVE_SYNTHESIS_PROMPT = `
You are analyzing code from multiple perspectives: {{perspectives}}.

## Retrieved Knowledge
{{knowledge}}

## Analysis Requirements

For each perspective, provide:
1. Key findings relevant to that perspective
2. Specific concerns or risks
3. Actionable recommendations

Then synthesize across perspectives:
- Note any conflicts between perspective recommendations
- Highlight synergies where recommendations align
- Provide an overall recommendation considering all perspectives

## Perspective-Specific Focus

{{#each perspectiveConfigs}}
### {{this.id}} Perspective
{{this.focusPrompt}}
Required sections: {{this.requiredSections}}
{{/each}}

## Output Format
Return a JSON object with the structure defined above.
`;
```

### 5.4 Confidence Across Perspectives

Different perspectives may have different confidence in the same entity:

```typescript
interface PerspectiveConfidence {
  entityId: string;
  confidenceByPerspective: Record<Perspective, number>;

  // Example:
  // AuthService might have:
  //   security: 0.9 (well-analyzed for vulnerabilities)
  //   performance: 0.4 (never profiled)
  //   understanding: 0.7 (has good documentation)
}
```

---

## Part 6: Implementation Strategy

### 6.1 Recommended Approach: Query-Time + Lightweight Annotations

Based on the research, the recommended approach is:

1. **Index-time**: Add lightweight perspective-relevance annotations to entities
   - Don't duplicate storage
   - Compute relevance scores for each perspective based on entity characteristics
   - Store as a compact bit vector or small JSON blob

2. **Query-time**: Apply perspective as a filter/boost layer
   - Perspective config defines signal weights
   - Existing retrieval pipeline handles the work
   - Perspective-aware re-ranking after initial retrieval

### 6.2 Implementation Phases

**Phase 1: Perspective-Aware Query Classification** (Low effort)
- Extend `classifyQueryIntent` to detect perspective hints
- Add `perspective` field to `LibrarianQuery`
- Map existing `taskType` values to perspectives

**Phase 2: Perspective Signal Weights** (Medium effort)
- Define `PerspectiveConfig` for each of 7 perspectives
- Integrate with existing `scoreCandidatesWithMultiSignals`
- Add perspective-specific boost/penalty patterns

**Phase 3: Index-Time Annotations** (Medium effort)
- Compute perspective relevance during indexing
- Add `perspectiveScores: Record<Perspective, number>` to entity storage
- Update incrementally on file changes

**Phase 4: Multi-Perspective Synthesis** (High effort)
- Extend synthesis prompts to be perspective-aware
- Implement `MultiPerspectiveResponse` format
- Add conflict/synergy detection

### 6.3 What NOT to Do

Based on the research:

1. **Don't create separate indices per perspective** - wasteful duplication
2. **Don't pre-compute all perspective combinations** - combinatorial explosion
3. **Don't make perspective mandatory** - should have sensible default
4. **Don't ignore existing infrastructure** - T-patterns and constructions already encode perspective knowledge

---

## Part 7: Deliverables Summary

### 7.1 Perspective Taxonomy (7 Perspectives)

| # | Perspective | Primary Signal Categories |
|---|-------------|--------------------------|
| 1 | debugging | error handling, call paths, test failures |
| 2 | security | auth flows, input validation, secrets |
| 3 | performance | complexity, async, I/O, caching |
| 4 | architecture | dependencies, patterns, coupling |
| 5 | modification | usage, breaking changes, similar patterns |
| 6 | testing | coverage, gaps, assertions |
| 7 | understanding | purpose, documentation, relationships |

### 7.2 Entity/Pattern Mappings

See Section 3 for detailed mappings of:
- Entity types to perspectives
- T-patterns to perspectives
- Context pack types to perspectives

### 7.3 Query Syntax Proposal

```typescript
interface LibrarianQuery {
  // Existing
  intent: string;
  depth: 'L0' | 'L1' | 'L2' | 'L3';
  taskType?: string;

  // New
  perspective?: Perspective;
  perspectives?: Perspective[];  // For multi-perspective
}
```

### 7.4 Multi-Perspective Synthesis Strategy

- Single perspective: Apply config-based filtering and synthesis focus
- Multi-perspective: Parallel analysis with cross-perspective conflict/synergy detection
- Confidence: Track per-perspective confidence for each entity

---

## References

### Faceted Classification
- [Faceted Search - Wikipedia](https://en.wikipedia.org/wiki/Faceted_search)
- [Faceted Classification - ScienceDirect](https://www.sciencedirect.com/topics/computer-science/faceted-classification)
- [Category Theory for Faceted Browsing - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5392185/)

### Architectural Views
- [4+1 Architectural View Model - Wikipedia](https://en.wikipedia.org/wiki/4+1_architectural_view_model)
- [Kruchten's Original Paper (PDF)](https://www.cs.ubc.ca/~gregor/teaching/papers/4+1view-architecture.pdf)
- [C4 Model](https://c4model.com/)
- [ISO/IEC/IEEE 42010](http://www.iso-architecture.org/ieee-1471/cm/)

### Personalized Retrieval
- [Adaptive Personalized Conversational IR](https://arxiv.org/html/2508.08634)
- [Personalization in Text IR Survey](https://asistdl.onlinelibrary.wiley.com/doi/10.1002/asi.24234)
- [Context-Adaptive Ranking Model](http://article.sapub.org/10.5923.j.ijis.20180801.01.html)

---

## Appendix: LiBrainian Code References

Key files for implementation:

| File | Relevance |
|------|-----------|
| `src/api/query.ts` | Query classification, routing |
| `src/knowledge/t_patterns.ts` | Pattern categories and detection |
| `src/types.ts` | `LibrarianQuery`, `AnalysisTaskType` |
| `src/query/multi_signal_scorer.ts` | Signal-based scoring |
| `src/constructions/` | Task-specific compositions |
| `src/knowledge/extractors/security_extractor.ts` | Security perspective patterns |
| `src/api/query_synthesis.ts` | Answer synthesis |
| `src/api/context_assembly.ts` | Context aggregation |
