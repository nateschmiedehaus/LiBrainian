# Mathematical Structures for Representing Logical/Argumentative Reasoning Chains in Codebases

**Research Document**
**Date**: 2026-01-30
**Context**: LiBrainian Knowledge Graph Enhancement
**Status**: Research Complete - Implementation Pending

---

## Executive Summary

This document analyzes formal mathematical structures suitable for representing the *rationale* behind code connections in LiBrainian's knowledge graph. While LiBrainian already captures *structural* relationships (calls, imports, extends, implements, co_changed, similar_to), we seek to add a layer that captures *argumentative* relationships - the reasoning and justification behind architectural decisions.

We evaluate three primary frameworks:
1. **Dung's Abstract Argumentation Framework (AAF)** - attack/support semantics
2. **ASPIC+** - structured argumentation with rules and preferences
3. **Toulmin Model** - claim-warrant-backing structure

We propose an `ArgumentEdge` taxonomy with 8 relationship types that maps naturally to LiBrainian's existing `KnowledgeGraphEdge` structure and `EntityRationale` types.

---

## 1. Research Question Context

### 1.1 Current State in LiBrainian

LiBrainian's knowledge graph currently supports these edge types (from `src/storage/types.ts`):

```typescript
export type KnowledgeEdgeType =
  | 'imports'           // A imports B
  | 'calls'             // A calls B
  | 'extends'           // A extends B
  | 'implements'        // A implements B
  | 'clone_of'          // A is clone of B
  | 'debt_related'      // A and B share debt
  | 'authored_by'       // Code authored by person
  | 'reviewed_by'       // Code reviewed by person
  | 'evolved_from'      // A evolved from B (refactoring)
  | 'co_changed'        // A and B frequently change together
  | 'tests'             // Test tests code
  | 'documents'         // Doc documents code
  | 'depends_on'        // Runtime dependency
  | 'similar_to'        // Semantic similarity
  | 'part_of';          // Hierarchical containment
```

The `EntityRationale` type (from `src/knowledge/universal_types.ts`) captures:
- `ArchitecturalDecision[]` - ADRs with id, title, status, context, decision, consequences
- `RationaleConstraint[]` - technical, business, regulatory, resource constraints
- `Tradeoff[]` - gained/sacrificed pairs with rationale
- `ConsideredAlternative[]` - rejected approaches with reasons
- `Assumption[]` - validated/unvalidated assumptions
- `AcceptedRisk[]` - risks with likelihood, impact, mitigation

The `rationale_extractor.ts` extracts these from ADRs, comments, and commits.

### 1.2 Gap Analysis

**Missing**: Explicit *argumentative edges* that connect decisions to their justifications, alternatives to their rejections, and constraints to the code they affect. Currently, rationale exists as node properties, not as first-class graph relationships.

---

## 2. Formal Argumentation Frameworks Analysis

### 2.1 Dung's Abstract Argumentation Framework (AAF)

**Source**: Dung, P.M. (1995). "On the acceptability of arguments and its fundamental role in nonmonotonic reasoning, logic programming and n-person games." *Artificial Intelligence*, 77(2), 321-357.

**Recent Work**: [Dung's Argumentation Framework: Unveiling the Expressive Power with Inconsistent Databases](https://arxiv.org/abs/2412.11617) (AAAI 2025)

#### 2.1.1 Core Structure

An Abstract Argumentation Framework is a pair `AF = (Args, Attacks)` where:
- `Args` is a set of arguments (abstract nodes)
- `Attacks` is a binary relation on Args (directed edges representing conflict)

Key semantics for determining acceptable argument sets:
- **Conflict-free**: No argument in set attacks another in set
- **Admissible**: Conflict-free + defends against all attackers
- **Preferred**: Maximal admissible set
- **Grounded**: Minimal complete extension (unique)
- **Stable**: Attacks all arguments outside the set

#### 2.1.2 Application to Code Reasoning

```
                    attacks
Decision A ──────────────────> Alternative B
    │                              │
    │ supports                     │ attacks
    ▼                              ▼
Constraint C                   Constraint D
```

**Pros**:
- Well-studied formal semantics with polynomial-time algorithms for grounded semantics
- Natural mapping to accept/reject decisions
- Extensible to weighted/probabilistic variants (2024-2025 research)
- Connection to database repair semantics (AAAI 2025) enables consistency checking

**Cons**:
- Binary attack relation too simplistic for software rationale
- Abstracts away argument content (no structure within arguments)
- No support for partial support/attack (all-or-nothing)
- Doesn't capture warrant/backing relationships

#### 2.1.3 Proposed Edge Types (AAF-based)

| Edge Type | Semantics | Example |
|-----------|-----------|---------|
| `attacks` | A defeats/contradicts B | "Microservices approach attacks Monolith approach" |
| `defends` | A protects B from attackers | "High availability requirement defends redundancy decision" |

### 2.2 ASPIC+ Framework

**Source**: Modgil, S., & Prakken, H. (2014). ["The ASPIC+ framework for structured argumentation: A tutorial"](https://www.tandfonline.com/doi/abs/10.1080/19462166.2013.869766). *Argument & Computation*, 5(1), 31-62.

#### 2.2.1 Core Structure

ASPIC+ generates abstract argumentation frameworks from:
- **Knowledge base** K (facts and ordinary premises)
- **Strict rules** Rs (deductive: premises guarantee conclusion)
- **Defeasible rules** Rd (presumptive: premises create presumption for conclusion)
- **Contrariness function** (what contradicts what)
- **Preference ordering** (which arguments/rules take precedence)

Arguments can be attacked in three ways:
1. **Undermining**: Attack on uncertain premises
2. **Rebutting**: Attack on defeasible conclusion
3. **Undercutting**: Attack on the inference step itself

#### 2.2.2 Application to Code Reasoning

```
Strict Rule:   security_critical(X) → requires_auth(X)
Defeasible:    internal_service(X) ⇒ ¬requires_auth(X)
               (internal services presumed safe)
Undercutter:   "PCI compliance invalidates internal-safe assumption"
```

**Pros**:
- Distinguishes certain vs defeasible knowledge (perfect for assumptions vs facts)
- Explicit inference rules enable reasoning chains
- Undercutting captures "this reasoning doesn't apply here" scenarios
- Preference ordering handles conflicting architectural principles

**Cons**:
- Complex to implement fully (requires rule engine)
- Overkill for simple support/contradict relationships
- Requires explicit formalization of inference rules
- Computational complexity for full semantics

#### 2.2.3 Proposed Edge Types (ASPIC+-based)

| Edge Type | Semantics | Example |
|-----------|-----------|---------|
| `strict_entails` | A logically necessitates B | "GDPR applies → Data deletion required" |
| `defeasibly_supports` | A provides presumptive support for B | "REST pattern suggests stateless design" |
| `undermines` | A attacks premise of B | "New security audit undermines 'no vulnerabilities' claim" |
| `rebuts` | A contradicts conclusion of B | "Performance test rebuts 'acceptable latency' claim" |
| `undercuts` | A invalidates inference in B | "Microservices context undercuts 'shared DB is fine' rule" |

### 2.3 Toulmin Model

**Source**: Toulmin, S.E. (1958, 2003). *The Uses of Argument*. Cambridge University Press.

**Application**: [Reasoning in BDI agents using Toulmin's argumentation model](https://www.sciencedirect.com/science/article/pii/S0304397519306553) (2020)

#### 2.3.1 Core Structure

An argument consists of six components:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  DATA ────────────────────────────────────────────> CLAIM       │
│   │              (so, qualifier)                      │         │
│   │                    │                              │         │
│   │                    ▼                              │         │
│   │              QUALIFIER                            │         │
│   │          (probably, likely)                       │         │
│   │                                                   │         │
│   └──────────> WARRANT <──────────────────────────────┘         │
│                   │                                             │
│                   ▼                                             │
│               BACKING                                           │
│          (authority, evidence)                                  │
│                                                                 │
│               REBUTTAL                                          │
│          (unless conditions)                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- **Claim**: The assertion being made
- **Data/Grounds**: Evidence supporting the claim
- **Warrant**: The reasoning principle connecting data to claim
- **Backing**: Authority or evidence supporting the warrant
- **Qualifier**: Degree of certainty (probably, likely, certainly)
- **Rebuttal**: Conditions that would defeat the claim

#### 2.3.2 Application to Code Reasoning

```
CLAIM:    "Use event-driven architecture"
DATA:     "System has 50+ microservices with complex interactions"
WARRANT:  "Decoupled systems scale better with async communication"
BACKING:  "Martin Fowler's Enterprise Integration Patterns"
QUALIFIER: "For this domain"
REBUTTAL: "Unless strict transaction consistency is required"
```

**Pros**:
- Rich structure for capturing *why* decisions were made
- Natural mapping to ADR structure (context, decision, consequences)
- Explicit warrants capture design principles and patterns
- Qualifiers enable confidence/uncertainty modeling (aligns with LiBrainian's Bayesian confidence)
- Rebuttals capture "unless" conditions and edge cases

**Cons**:
- More verbose than AAF (6 components vs 2)
- No formal semantics for argument evaluation
- Doesn't directly model attack/defeat relationships
- Originally designed for rhetorical analysis, not computational reasoning

#### 2.3.3 Proposed Edge Types (Toulmin-based)

| Edge Type | Semantics | Example |
|-----------|-----------|---------|
| `grounds` | A provides evidence for claim B | "Performance benchmark grounds 'needs caching' claim" |
| `warrants` | A justifies inference from data to claim | "CAP theorem warrants eventual consistency choice" |
| `backs` | A authorizes warrant B | "RFC 7231 backs 'HTTP status codes' warrant" |
| `qualifies` | A limits scope/certainty of B | "Only for read-heavy workloads" |
| `rebuts` | A provides defeating condition for B | "Unless ACID transactions required" |

---

## 3. IBIS and ADR Integration

### 3.1 IBIS (Issue-Based Information Systems)

**Source**: Kunz, W., & Rittel, H.W.J. (1970). "Issues as elements of information systems." Working Paper 131, Institute of Urban and Regional Development, UC Berkeley.

**Modern Implementation**: [gIBIS: A Hypertext Tool for Exploratory Policy Discussion](https://www.academia.edu/18225957/gIBIS)

#### 3.1.1 Core Structure

IBIS models deliberation as a directed graph with three node types:
- **Issue**: A question to be resolved ("How should we handle authentication?")
- **Position**: A possible answer ("Use OAuth2", "Use API keys")
- **Argument**: Support (pro) or objection (con) to a position

Relationships:
- `responds_to`: Position responds to Issue
- `supports`: Argument supports Position
- `objects_to`: Argument objects to Position
- `generalizes`: Issue generalizes another Issue
- `specializes`: Issue specializes another Issue
- `raises`: Argument raises new Issue

#### 3.1.2 Mapping to LiBrainian

IBIS aligns well with LiBrainian's existing `ArchitecturalDecision` type:

```typescript
interface ArchitecturalDecision {
  id: string;           // ADR-001
  title: string;        // The Issue
  status: DecisionStatus; // proposed | accepted | deprecated | superseded
  context: string;      // Background raising the Issue
  decision: string;     // The accepted Position
  consequences: string; // Arguments (pros/cons considered)
  supersededBy?: string; // Link to new decision
}
```

#### 3.1.3 Proposed Edge Types (IBIS-based)

| Edge Type | Semantics | Example |
|-----------|-----------|---------|
| `responds_to` | Position A responds to Issue B | "OAuth2 responds to 'How to authenticate?'" |
| `raises` | A raises new issue B | "OAuth2 raises 'How to manage tokens?'" |
| `supersedes` | Decision A supersedes Decision B | "ADR-005 supersedes ADR-002" |

### 3.2 ADR Chain Modeling

ADRs naturally form chains through several relationship types:

1. **Supersession**: ADR-005 supersedes ADR-002
2. **Dependency**: ADR-007 depends on ADR-003 (requires its decision)
3. **Constraint**: ADR-010 constrains options for future decisions
4. **Enablement**: ADR-004 enables new architectural options

```
ADR-001: Use Microservices
    │
    ├── enables ──> ADR-002: Use API Gateway
    │                   │
    │                   └── constrains ──> ADR-005: Rate Limiting Strategy
    │
    └── depends_on <── ADR-003: Container Orchestration
                           │
                           └── supersedes ──> ADR-008: New K8s Version
```

---

## 4. Proposed ArgumentEdge Taxonomy

Based on the analysis, we propose a hybrid taxonomy that combines the strengths of all three frameworks while remaining practical for implementation.

### 4.1 Primary Edge Types (8 Types)

```typescript
export type ArgumentEdgeType =
  // Toulmin-inspired (reasoning structure)
  | 'supports'          // A provides evidence/grounds for B
  | 'warrants'          // A provides reasoning principle justifying B
  | 'qualifies'         // A limits scope/confidence of B

  // AAF/ASPIC+-inspired (conflict resolution)
  | 'contradicts'       // A conflicts with B (mutual exclusion)
  | 'undermines'        // A weakens/attacks premise of B
  | 'rebuts'            // A provides defeating condition for B

  // ADR/IBIS-inspired (decision chains)
  | 'supersedes'        // A replaces B as the accepted decision
  | 'depends_on_decision'; // A requires decision B to be valid
```

### 4.2 Edge Type Definitions

#### `supports`
**Semantics**: A provides evidence, data, or grounds that strengthen belief in B.
**Weight**: 0.0 to 1.0 (strength of support)
**Example**: "Performance benchmark supports decision to use Redis caching"

```typescript
{
  sourceId: 'perf-benchmark-2024-01',
  targetId: 'adr-015-redis-cache',
  edgeType: 'supports',
  weight: 0.85,
  metadata: {
    evidenceType: 'test',
    capturedAt: '2024-01-15',
    source: 'benchmarks/cache_comparison.md'
  }
}
```

#### `warrants`
**Semantics**: A provides the reasoning principle or design pattern that justifies inference to B.
**Weight**: Always 1.0 (warrants are binary - they apply or don't)
**Example**: "CAP theorem warrants eventual consistency decision"

```typescript
{
  sourceId: 'principle:cap-theorem',
  targetId: 'adr-008-eventual-consistency',
  edgeType: 'warrants',
  weight: 1.0,
  metadata: {
    warrantType: 'theorem',
    domain: 'distributed_systems',
    source: 'Brewer, E. (2000). PODC Keynote'
  }
}
```

#### `qualifies`
**Semantics**: A specifies conditions, scope, or uncertainty that limits B.
**Weight**: 0.0 to 1.0 (degree of qualification)
**Example**: "Only for read-heavy workloads qualifies caching decision"

```typescript
{
  sourceId: 'assumption:read-heavy-workload',
  targetId: 'adr-015-redis-cache',
  edgeType: 'qualifies',
  weight: 0.7,
  metadata: {
    qualifierType: 'scope',
    condition: 'read:write ratio > 10:1',
    validated: true
  }
}
```

#### `contradicts`
**Semantics**: A and B are mutually exclusive - accepting one rejects the other.
**Weight**: Always 1.0 (contradictions are binary)
**Example**: "Monolith architecture contradicts microservices approach"

```typescript
{
  sourceId: 'alternative:monolith',
  targetId: 'adr-001-microservices',
  edgeType: 'contradicts',
  weight: 1.0,
  metadata: {
    contradictionType: 'mutual_exclusion',
    reason: 'Fundamentally different deployment models'
  }
}
```

#### `undermines`
**Semantics**: A weakens or attacks a premise or assumption underlying B.
**Weight**: 0.0 to 1.0 (degree of undermining)
**Example**: "Security audit finding undermines 'internal network is safe' assumption"

```typescript
{
  sourceId: 'finding:audit-2024-q1',
  targetId: 'assumption:internal-network-safe',
  edgeType: 'undermines',
  weight: 0.9,
  metadata: {
    findingId: 'SEC-2024-001',
    severity: 'high',
    remediation: 'Implement zero-trust'
  }
}
```

#### `rebuts`
**Semantics**: A provides a defeating condition or exception that blocks B.
**Weight**: Always 1.0 when active (rebuttals are binary activation)
**Example**: "ACID requirement rebuts eventual consistency decision"

```typescript
{
  sourceId: 'constraint:acid-transactions',
  targetId: 'adr-008-eventual-consistency',
  edgeType: 'rebuts',
  weight: 1.0,
  metadata: {
    rebuttalType: 'exception',
    activationCondition: 'financial transactions',
    scope: ['billing-service', 'payment-service']
  }
}
```

#### `supersedes`
**Semantics**: A replaces B as the accepted decision (B becomes deprecated).
**Weight**: Always 1.0 (supersession is binary)
**Example**: "ADR-015 (Redis) supersedes ADR-007 (Memcached)"

```typescript
{
  sourceId: 'adr-015-redis-cache',
  targetId: 'adr-007-memcached',
  edgeType: 'supersedes',
  weight: 1.0,
  metadata: {
    supersessionDate: '2024-06-01',
    reason: 'Redis provides persistence and data structures',
    migrationPath: 'docs/migrations/memcached-to-redis.md'
  }
}
```

#### `depends_on_decision`
**Semantics**: A's validity requires decision B to remain in effect.
**Weight**: 0.0 to 1.0 (strength of dependency)
**Example**: "API Gateway decision depends on Microservices decision"

```typescript
{
  sourceId: 'adr-002-api-gateway',
  targetId: 'adr-001-microservices',
  edgeType: 'depends_on_decision',
  weight: 1.0,
  metadata: {
    dependencyType: 'architectural',
    impact_if_revoked: 'Gateway becomes unnecessary'
  }
}
```

### 4.3 Comparison Matrix

| Edge Type | AAF | ASPIC+ | Toulmin | IBIS | LiBrainian Fit |
|-----------|-----|--------|---------|------|---------------|
| `supports` | - | Premise support | Grounds | Pro argument | EntityRationale.evidence |
| `warrants` | - | Defeasible rule | Warrant | - | Design patterns |
| `qualifies` | - | Preference | Qualifier | - | Assumption scope |
| `contradicts` | Attack | Contrary | - | Objects-to | Alternative rejection |
| `undermines` | - | Undermining | - | - | Defeater activation |
| `rebuts` | Attack | Rebutting | Rebuttal | Con argument | Exception handling |
| `supersedes` | - | - | - | Generalizes | ADR evolution |
| `depends_on_decision` | - | Rule chaining | - | Raises | ADR chains |

---

## 5. Storage Model Mapping

### 5.1 Extending KnowledgeGraphEdge

The proposed `ArgumentEdgeType` integrates with LiBrainian's existing `KnowledgeGraphEdge`:

```typescript
// Existing type from src/storage/types.ts
export interface KnowledgeGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType: 'function' | 'module' | 'file' | 'directory' | 'commit' | 'author';
  targetType: 'function' | 'module' | 'file' | 'directory' | 'commit' | 'author';
  edgeType: KnowledgeEdgeType;
  weight: number;
  confidence: number;
  metadata: Record<string, unknown>;
  computedAt: string;
  validUntil?: string;
}

// Proposed extension
export type ArgumentEdgeType =
  | 'supports'
  | 'warrants'
  | 'qualifies'
  | 'contradicts'
  | 'undermines'
  | 'rebuts'
  | 'supersedes'
  | 'depends_on_decision';

// Extended entity types for argument nodes
export type ArgumentEntityType =
  | 'decision'      // ADR or architectural decision
  | 'constraint'    // Technical/business constraint
  | 'assumption'    // Validated or unvalidated assumption
  | 'alternative'   // Considered but rejected approach
  | 'tradeoff'      // Gained/sacrificed pair
  | 'risk'          // Accepted risk
  | 'evidence'      // Supporting evidence
  | 'principle';    // Design principle or pattern

export interface ArgumentGraphEdge extends Omit<KnowledgeGraphEdge, 'edgeType' | 'sourceType' | 'targetType'> {
  edgeType: ArgumentEdgeType;
  sourceType: ArgumentEntityType | KnowledgeGraphEdge['sourceType'];
  targetType: ArgumentEntityType | KnowledgeGraphEdge['targetType'];

  // Argument-specific metadata
  argumentMetadata: {
    // Toulmin components
    warrantSource?: string;    // Authority/pattern backing the argument
    qualifier?: string;        // Scope limitation
    rebuttalCondition?: string; // When this doesn't apply

    // ASPIC+ components
    ruleType?: 'strict' | 'defeasible';
    preferenceLevel?: number;   // 0-1 priority in conflicts

    // Evidence linkage
    evidenceRefs?: string[];    // Links to EvidenceRef[]

    // Temporal validity
    validFrom?: string;         // When this argument became valid
    validUntil?: string;        // When this argument expires/was superseded
  };
}
```

### 5.2 Storage Schema Extension

```sql
-- Extension to knowledge_edges table for argument edges
ALTER TABLE knowledge_edges ADD COLUMN argument_metadata TEXT;

-- Index for efficient argument graph queries
CREATE INDEX idx_knowledge_edges_argument_type
ON knowledge_edges(edge_type)
WHERE edge_type IN ('supports', 'warrants', 'qualifies', 'contradicts',
                    'undermines', 'rebuts', 'supersedes', 'depends_on_decision');

-- Materialized view for decision chains
CREATE VIEW decision_chains AS
SELECT
  e1.source_id AS decision_id,
  e1.target_id AS depends_on_id,
  e2.target_id AS transitive_depends_on_id,
  e1.weight * e2.weight AS transitive_weight
FROM knowledge_edges e1
JOIN knowledge_edges e2 ON e1.target_id = e2.source_id
WHERE e1.edge_type = 'depends_on_decision'
  AND e2.edge_type = 'depends_on_decision';
```

### 5.3 Integration with Evidence System

The `evidence_system.ts` types align naturally:

```typescript
// From src/knowledge/evidence_system.ts
export interface EvidenceClaim {
  id: string;
  proposition: string;
  subject?: { id: string; type?: string; };
  polarity?: 'affirmative' | 'negative';
}

// Argument edges can reference evidence claims
interface ArgumentEdgeWithEvidence extends ArgumentGraphEdge {
  evidenceClaims: EvidenceClaim[];
  evidenceValidation: EvidenceValidation;
}
```

---

## 6. Example: Complete Argument Chain

### 6.1 Scenario: "Why does service X use Redis instead of a relational database?"

This query requires traversing an argument graph to explain the reasoning chain.

### 6.2 Nodes in the Argument Graph

```typescript
const nodes = [
  // Decisions
  { id: 'adr-015', type: 'decision', content: 'Use Redis for session storage' },
  { id: 'adr-001', type: 'decision', content: 'Adopt microservices architecture' },

  // Constraints
  { id: 'constraint-latency', type: 'constraint', content: 'P99 latency < 10ms' },
  { id: 'constraint-scale', type: 'constraint', content: 'Support 10K concurrent users' },

  // Evidence
  { id: 'benchmark-2024', type: 'evidence', content: 'Redis: 0.5ms avg, PostgreSQL: 15ms avg' },

  // Principles
  { id: 'principle-cap', type: 'principle', content: 'CAP theorem' },

  // Alternatives
  { id: 'alt-postgres', type: 'alternative', content: 'PostgreSQL with connection pooling' },
  { id: 'alt-memcached', type: 'alternative', content: 'Memcached' },

  // Assumptions
  { id: 'assume-read-heavy', type: 'assumption', content: 'Workload is 90% reads' },

  // Tradeoffs
  { id: 'tradeoff-durability', type: 'tradeoff', content: 'Sacrificed strong durability for speed' },

  // Risks
  { id: 'risk-data-loss', type: 'risk', content: 'Possible session loss on Redis crash' }
];
```

### 6.3 Edges in the Argument Graph

```typescript
const edges = [
  // Evidence supports decision
  {
    sourceId: 'benchmark-2024',
    targetId: 'adr-015',
    edgeType: 'supports',
    weight: 0.9,
    confidence: 0.95,
    metadata: { evidenceType: 'performance_test' }
  },

  // Constraint supports decision
  {
    sourceId: 'constraint-latency',
    targetId: 'adr-015',
    edgeType: 'supports',
    weight: 0.8,
    confidence: 0.9,
    metadata: { requirementId: 'REQ-PERF-001' }
  },

  // Principle warrants decision
  {
    sourceId: 'principle-cap',
    targetId: 'adr-015',
    edgeType: 'warrants',
    weight: 1.0,
    confidence: 1.0,
    metadata: {
      warrantType: 'theorem',
      reasoning: 'Trading consistency for availability/partition tolerance'
    }
  },

  // Assumption qualifies decision
  {
    sourceId: 'assume-read-heavy',
    targetId: 'adr-015',
    edgeType: 'qualifies',
    weight: 0.9,
    confidence: 0.85,
    metadata: { validated: true, validatedBy: 'traffic-analysis-2024' }
  },

  // Decision contradicts alternative
  {
    sourceId: 'adr-015',
    targetId: 'alt-postgres',
    edgeType: 'contradicts',
    weight: 1.0,
    confidence: 1.0,
    metadata: { reason: 'Latency requirements incompatible' }
  },

  // Evidence undermines alternative
  {
    sourceId: 'benchmark-2024',
    targetId: 'alt-postgres',
    edgeType: 'undermines',
    weight: 0.85,
    confidence: 0.9,
    metadata: { finding: 'PostgreSQL 30x slower for session lookups' }
  },

  // Decision supersedes old alternative
  {
    sourceId: 'adr-015',
    targetId: 'alt-memcached',
    edgeType: 'supersedes',
    weight: 1.0,
    confidence: 1.0,
    metadata: {
      supersessionDate: '2024-03-15',
      reason: 'Redis provides data structures and persistence'
    }
  },

  // Decision depends on microservices decision
  {
    sourceId: 'adr-015',
    targetId: 'adr-001',
    edgeType: 'depends_on_decision',
    weight: 0.7,
    confidence: 0.8,
    metadata: {
      dependencyType: 'architectural',
      reason: 'Distributed session storage needed for stateless services'
    }
  },

  // Tradeoff rebuts under certain conditions
  {
    sourceId: 'tradeoff-durability',
    targetId: 'adr-015',
    edgeType: 'rebuts',
    weight: 1.0,
    confidence: 0.9,
    metadata: {
      rebuttalCondition: 'If session data becomes critical/financial',
      activationThreshold: 'data_criticality > high'
    }
  }
];
```

### 6.4 Query: "Why Redis?"

```typescript
async function explainDecision(decisionId: string): Promise<ArgumentChainExplanation> {
  const edges = await storage.getKnowledgeEdgesTo(decisionId);

  return {
    decision: await storage.getDecision(decisionId),

    // Group by argument role
    supportingEvidence: edges
      .filter(e => e.edgeType === 'supports')
      .map(e => ({ ...e, strength: e.weight * e.confidence })),

    warrants: edges
      .filter(e => e.edgeType === 'warrants')
      .map(e => e.metadata.reasoning),

    qualifications: edges
      .filter(e => e.edgeType === 'qualifies')
      .map(e => ({
        condition: e.metadata.condition,
        validated: e.metadata.validated
      })),

    rejectedAlternatives: edges
      .filter(e => e.edgeType === 'contradicts' || e.edgeType === 'supersedes')
      .map(async e => ({
        alternative: await storage.getNode(e.sourceId),
        reason: e.metadata.reason
      })),

    dependencies: edges
      .filter(e => e.edgeType === 'depends_on_decision')
      .map(async e => await storage.getDecision(e.targetId)),

    activeRebuttals: edges
      .filter(e => e.edgeType === 'rebuts' && isActive(e.metadata.activationCondition))
  };
}
```

### 6.5 Natural Language Synthesis

Given the argument graph, an LLM can synthesize:

> **Why does the session service use Redis?**
>
> The decision to use Redis for session storage (ADR-015) is supported by:
>
> **Evidence**: Performance benchmarks show Redis averages 0.5ms response time compared to PostgreSQL's 15ms, meeting the P99 < 10ms latency constraint (REQ-PERF-001).
>
> **Warrant**: Per the CAP theorem, we trade strict consistency for availability and partition tolerance, which is acceptable for session data.
>
> **Qualification**: This decision is valid under the assumption that workloads are 90% reads (validated by traffic analysis).
>
> **Rejected alternatives**:
> - PostgreSQL: Benchmark evidence showed 30x higher latency
> - Memcached: Superseded because Redis provides data structures and optional persistence
>
> **Dependencies**: This decision depends on the microservices architecture (ADR-001), as distributed stateless services require shared session storage.
>
> **Risks**: Possible session loss on Redis failure (accepted risk with mitigation: Redis Sentinel for HA).

---

## 7. Recommendations

### 7.1 Framework Selection: Hybrid Toulmin-IBIS

We recommend a **hybrid approach** combining:

1. **Toulmin structure** for individual argument representation (claim-grounds-warrant-qualifier-rebuttal)
2. **IBIS semantics** for decision deliberation structure (issue-position-argument)
3. **Lightweight AAF** for conflict resolution (attack relationships)

This provides:
- Rich reasoning capture without ASPIC+ complexity
- Natural mapping to ADR format
- Tractable graph algorithms

### 7.2 Implementation Priority

| Priority | Edge Type | Rationale |
|----------|-----------|-----------|
| P0 | `supports` | Core evidence linkage |
| P0 | `contradicts` | Alternative rejection |
| P0 | `supersedes` | ADR evolution |
| P1 | `depends_on_decision` | Decision chains |
| P1 | `warrants` | Design principle linkage |
| P2 | `qualifies` | Assumption scope |
| P2 | `undermines` | Defeater integration |
| P2 | `rebuts` | Exception handling |

### 7.3 Integration with Existing LiBrainian Components

| Component | Integration Point |
|-----------|-------------------|
| `rationale_extractor.ts` | Extract argument edges from ADRs, comments |
| `evidence_system.ts` | Link `supports` edges to `EvidenceClaim` |
| `KnowledgeGraphEdge` | Extend type union with `ArgumentEdgeType` |
| `universal_types.ts` | Add `argumentGraph` section to `UniversalKnowledge` |
| Query synthesis | Use argument graph for "why" question answering |

---

## 8. Sources

### Academic Sources

- [Dung's Argumentation Framework: Unveiling the Expressive Power with Inconsistent Databases](https://arxiv.org/abs/2412.11617) - AAAI 2025
- [The ASPIC+ framework for structured argumentation: A tutorial](https://www.tandfonline.com/doi/abs/10.1080/19462166.2013.869766) - Modgil & Prakken, 2014
- [Toulmin Argument Model](https://owl.purdue.edu/owl/general_writing/academic_writing/historical_perspectives_on_argumentation/toulmin_argument.html) - Purdue OWL
- [Reasoning in BDI agents using Toulmin's argumentation model](https://www.sciencedirect.com/science/article/pii/S0304397519306553) - 2020
- [Argument Mining: A Survey](https://direct.mit.edu/coli/article/45/4/765/93362/Argument-Mining-A-Survey) - Computational Linguistics, 2019
- [Issue-based information system - Wikipedia](https://en.wikipedia.org/wiki/Issue-based_information_system)
- [Design rationale - Wikipedia](https://en.wikipedia.org/wiki/Design_rationale)

### Industry Sources

- [Architectural Decision Records (ADRs)](https://adr.github.io/)
- [Architecture Decision Record - Microsoft Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record)
- [ADR process - AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html)
- [gIBIS: A Hypertext Tool for Exploratory Policy Discussion](https://www.academia.edu/18225957/gIBIS)

### Knowledge Graph and Code Analysis

- [Enabling Analysis and Reasoning on Software Systems through Knowledge Graph Representation](https://ieeexplore.ieee.org/document/10174249/) - IEEE 2023
- [Application of knowledge graph in software engineering field](https://www.sciencedirect.com/science/article/abs/pii/S0950584923001829) - 2023
- [Design decisions and design rationale in software architecture](https://www.sciencedirect.com/science/article/abs/pii/S0164121209001241)
- [Design Pattern Rationale Graphs: Linking Design to Source](https://www.researchgate.net/publication/221554722_Design_Pattern_Rationale_Graphs_Linking_Design_to_Source)

---

## Appendix A: Full Type Definitions

```typescript
// Complete proposed type definitions for implementation

export type ArgumentEdgeType =
  | 'supports'
  | 'warrants'
  | 'qualifies'
  | 'contradicts'
  | 'undermines'
  | 'rebuts'
  | 'supersedes'
  | 'depends_on_decision';

export type ArgumentEntityType =
  | 'decision'
  | 'constraint'
  | 'assumption'
  | 'alternative'
  | 'tradeoff'
  | 'risk'
  | 'evidence'
  | 'principle';

export interface ArgumentNode {
  id: string;
  type: ArgumentEntityType;
  content: string;
  entityRef?: string;  // Link to code entity (function, module, file)
  adrRef?: string;     // Link to ADR if applicable
  confidence: number;
  createdAt: string;
  validUntil?: string;
}

export interface ArgumentEdge {
  id: string;
  sourceId: string;
  sourceType: ArgumentEntityType;
  targetId: string;
  targetType: ArgumentEntityType;
  edgeType: ArgumentEdgeType;
  weight: number;
  confidence: number;

  // Toulmin components
  warrantSource?: string;
  qualifier?: string;
  rebuttalCondition?: string;

  // ASPIC+ components
  ruleType?: 'strict' | 'defeasible';
  preferenceLevel?: number;

  // Evidence linkage
  evidenceRefs?: string[];

  // Temporal
  computedAt: string;
  validFrom?: string;
  validUntil?: string;

  // Provenance
  extractedFrom?: 'adr' | 'comment' | 'commit' | 'llm_inference' | 'manual';
}

export interface ArgumentGraph {
  nodes: ArgumentNode[];
  edges: ArgumentEdge[];
  rootDecisionId?: string;
  computedAt: string;
}

export interface ArgumentChainExplanation {
  decision: ArgumentNode;
  supportingEvidence: Array<{ node: ArgumentNode; edge: ArgumentEdge; strength: number }>;
  warrants: Array<{ principle: string; reasoning: string }>;
  qualifications: Array<{ condition: string; validated: boolean }>;
  rejectedAlternatives: Array<{ alternative: ArgumentNode; reason: string }>;
  dependencies: ArgumentNode[];
  activeRebuttals: Array<{ condition: string; impact: string }>;
  overallConfidence: number;
}
```

---

*Document generated by LiBrainian Research Module*
