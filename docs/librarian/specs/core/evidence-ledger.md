# Evidence Ledger Specification

> **Version**: 1.0.0
> **Status**: DRAFT
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: All confidence values MUST use `ConfidenceValue` from Track D. See [GLOSSARY.md](../GLOSSARY.md).

---

## Executive Summary

The Evidence Ledger is a **unified append-only log** that serves as the foundation for all epistemic operations in LiBrainian. Every claim, observation, retrieval, and synthesis event is recorded with full provenance, enabling:

- **Auditability**: Complete trace of how any conclusion was reached
- **Calibration**: Historical data for confidence calibration
- **Learning**: Feedback loops for improving retrieval and synthesis
- **Reproducibility**: Replay of reasoning chains

---

## 1. Core Interface

### 1.1 EvidenceEntry Type

```typescript
/**
 * An immutable entry in the evidence ledger.
 *
 * INVARIANT: Once created, an entry is never modified
 * INVARIANT: entry.id is globally unique within the ledger
 * INVARIANT: entry.timestamp reflects when the entry was created, not when the evidence was observed
 */
interface EvidenceEntry {
  /** Unique identifier for this entry */
  id: EvidenceId;

  /** When this entry was appended to the ledger */
  timestamp: Date;

  /** Type of evidence being recorded */
  kind: EvidenceKind;

  /** The actual evidence payload */
  payload: EvidencePayload;

  /** Provenance: where did this evidence come from? */
  provenance: EvidenceProvenance;

  /** Confidence in this evidence (if applicable) */
  confidence?: ConfidenceValue;

  /** Links to related entries */
  relatedEntries: EvidenceId[];

  /** Session/query context this belongs to */
  sessionId?: SessionId;
}

type EvidenceId = string & { readonly __brand: 'EvidenceId' };
type SessionId = string & { readonly __brand: 'SessionId' };
```

### 1.2 Evidence Kinds

```typescript
/**
 * Categories of evidence that can be recorded.
 */
type EvidenceKind =
  | 'extraction'      // AST/semantic extraction from source code
  | 'retrieval'       // Vector/semantic search results
  | 'synthesis'       // LLM-generated content
  | 'claim'           // Assertion about the codebase
  | 'verification'    // Verification of a claim
  | 'contradiction'   // Detected contradiction between claims
  | 'feedback'        // User or agent feedback
  | 'outcome'         // Observed outcome of a prediction
  | 'tool_call'       // MCP/tool invocation record
  | 'episode'         // Query episode record
  | 'calibration';    // Calibration measurement

/**
 * Payload types for each evidence kind.
 */
interface EvidencePayloadMap {
  extraction: ExtractionEvidence;
  retrieval: RetrievalEvidence;
  synthesis: SynthesisEvidence;
  claim: ClaimEvidence;
  verification: VerificationEvidence;
  contradiction: ContradictionEvidence;
  feedback: FeedbackEvidence;
  outcome: OutcomeEvidence;
  tool_call: ToolCallEvidence;
  episode: EpisodeEvidence;
  calibration: CalibrationEvidence;
}

type EvidencePayload = EvidencePayloadMap[EvidenceKind];
```

### 1.3 Provenance

```typescript
/**
 * Records the source and method of evidence collection.
 */
interface EvidenceProvenance {
  /** Source type */
  source: ProvenanceSource;

  /** Method used to collect/generate */
  method: string;

  /** Model/tool used (if applicable) */
  agent?: {
    type: 'llm' | 'embedding' | 'ast' | 'human' | 'tool';
    identifier: string;
    version?: string;
  };

  /** Input hash for reproducibility */
  inputHash?: string;

  /** Configuration used */
  config?: Record<string, unknown>;
}

type ProvenanceSource =
  | 'ast_parser'
  | 'llm_synthesis'
  | 'embedding_search'
  | 'user_input'
  | 'tool_output'
  | 'system_observation';
```

---

## 2. Ledger Interface

### 2.1 Core Operations

```typescript
/**
 * The Evidence Ledger - append-only storage for all epistemic events.
 *
 * INVARIANT: All append operations are atomic
 * INVARIANT: Query operations are eventually consistent
 * INVARIANT: No entry can be deleted or modified after append
 */
interface IEvidenceLedger {
  /**
   * Append a new entry to the ledger.
   *
   * @returns The created entry with assigned ID and timestamp
   */
  append(entry: Omit<EvidenceEntry, 'id' | 'timestamp'>): Promise<EvidenceEntry>;

  /**
   * Batch append multiple entries atomically.
   */
  appendBatch(entries: Omit<EvidenceEntry, 'id' | 'timestamp'>[]): Promise<EvidenceEntry[]>;

  /**
   * Query entries by various criteria.
   */
  query(criteria: EvidenceQuery): Promise<EvidenceEntry[]>;

  /**
   * Get a single entry by ID.
   */
  get(id: EvidenceId): Promise<EvidenceEntry | null>;

  /**
   * Get the full evidence chain for a claim.
   * Follows relatedEntries links to build the provenance graph.
   */
  getChain(claimId: EvidenceId): Promise<EvidenceChain>;

  /**
   * Get entries within a session.
   */
  getSessionEntries(sessionId: SessionId): Promise<EvidenceEntry[]>;

  /**
   * Subscribe to new entries (for real-time processing).
   */
  subscribe(filter: EvidenceFilter, callback: (entry: EvidenceEntry) => void): Unsubscribe;
}

type Unsubscribe = () => void;
```

### 2.2 Query Interface

```typescript
/**
 * Criteria for querying the ledger.
 */
interface EvidenceQuery {
  /** Filter by evidence kind(s) */
  kinds?: EvidenceKind[];

  /** Filter by time range */
  timeRange?: {
    from?: Date;
    to?: Date;
  };

  /** Filter by session */
  sessionId?: SessionId;

  /** Filter by provenance source */
  source?: ProvenanceSource;

  /** Full-text search in payloads */
  textSearch?: string;

  /** Limit results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Order by */
  orderBy?: 'timestamp' | 'confidence';
  orderDirection?: 'asc' | 'desc';
}

interface EvidenceFilter {
  kinds?: EvidenceKind[];
  sessionId?: SessionId;
}
```

### 2.3 Evidence Chain

```typescript
/**
 * A chain of evidence supporting a claim.
 */
interface EvidenceChain {
  /** The root entry (usually a claim) */
  root: EvidenceEntry;

  /** All supporting evidence, topologically sorted */
  evidence: EvidenceEntry[];

  /** The dependency graph */
  graph: Map<EvidenceId, EvidenceId[]>;

  /** Overall chain strength */
  chainConfidence: ConfidenceValue;

  /** Any contradictions found in the chain */
  contradictions: ContradictionEvidence[];
}
```

---

## 3. Evidence Payload Types

### 3.1 Extraction Evidence

```typescript
interface ExtractionEvidence {
  /** Source file path */
  filePath: string;

  /** What was extracted */
  extractionType: 'function' | 'class' | 'type' | 'import' | 'export' | 'pattern';

  /** The extracted entity */
  entity: {
    name: string;
    kind: string;
    signature?: string;
    location: CodeLocation;
  };

  /** Extraction quality */
  quality: 'ast_verified' | 'ast_inferred' | 'llm_synthesized';

  /** Raw AST node (for verification) */
  astNode?: unknown;
}
```

### 3.2 Retrieval Evidence

```typescript
interface RetrievalEvidence {
  /** The query that triggered retrieval */
  query: string;

  /** Retrieval method used */
  method: 'vector' | 'keyword' | 'graph' | 'hybrid';

  /** Results retrieved */
  results: {
    entityId: string;
    score: number;
    snippet: string;
  }[];

  /** Total candidates considered */
  candidatesConsidered: number;

  /** Retrieval latency (ms) */
  latencyMs: number;
}
```

### 3.3 Synthesis Evidence

```typescript
interface SynthesisEvidence {
  /** The synthesis prompt/request */
  request: string;

  /** The synthesized output */
  output: string;

  /** Model used */
  model: {
    provider: string;
    modelId: string;
    temperature?: number;
  };

  /** Token usage */
  tokens: {
    input: number;
    output: number;
  };

  /** Synthesis type */
  synthesisType: 'answer' | 'explanation' | 'code' | 'summary';
}
```

### 3.4 Claim Evidence

```typescript
interface ClaimEvidence {
  /** The claim being made */
  claim: string;

  /** Claim category */
  category: 'existence' | 'relationship' | 'behavior' | 'quality' | 'recommendation';

  /** Subject of the claim */
  subject: {
    type: 'file' | 'function' | 'class' | 'pattern' | 'system';
    identifier: string;
  };

  /** Supporting evidence IDs */
  supportingEvidence: EvidenceId[];

  /** Potential defeaters */
  knownDefeaters: EvidenceId[];

  /** Confidence in this claim */
  confidence: ConfidenceValue;
}
```

### 3.5 Outcome Evidence

```typescript
interface OutcomeEvidence {
  /** The prediction that was made */
  predictionId: EvidenceId;

  /** What was predicted */
  predicted: {
    claim: string;
    confidence: ConfidenceValue;
  };

  /** What actually happened */
  actual: {
    outcome: 'correct' | 'incorrect' | 'partial' | 'unknown';
    observation: string;
  };

  /** How was this outcome determined? */
  verificationMethod: 'user_feedback' | 'test_result' | 'system_observation';
}
```

---

## 4. Storage Implementation

### 4.1 SQLite Schema

```sql
CREATE TABLE evidence_entries (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON
  provenance TEXT NOT NULL,  -- JSON
  confidence TEXT,  -- JSON (ConfidenceValue)
  related_entries TEXT,  -- JSON array of IDs
  session_id TEXT,

  -- Indexes for common queries
  CONSTRAINT valid_kind CHECK (kind IN (
    'extraction', 'retrieval', 'synthesis', 'claim',
    'verification', 'contradiction', 'feedback',
    'outcome', 'tool_call', 'episode', 'calibration'
  ))
);

CREATE INDEX idx_evidence_timestamp ON evidence_entries(timestamp);
CREATE INDEX idx_evidence_kind ON evidence_entries(kind);
CREATE INDEX idx_evidence_session ON evidence_entries(session_id);
CREATE INDEX idx_evidence_kind_timestamp ON evidence_entries(kind, timestamp);
```

### 4.2 Implementation Contract

```typescript
/**
 * SQLite implementation of the evidence ledger.
 *
 * PRECONDITION: Database connection is open and writable
 * POSTCONDITION: All appends are durable (fsync)
 * INVARIANT: No data loss on crash (WAL mode)
 */
class SqliteEvidenceLedger implements IEvidenceLedger {
  // Implementation details...
}
```

---

## 5. TDD Test Specifications

### 5.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `append_creates_entry` | Valid entry payload | Entry with generated ID and timestamp |
| `append_batch_atomic` | 3 entries | All 3 created or none (on error) |
| `get_returns_entry` | Valid ID | Matching entry |
| `get_returns_null_for_unknown` | Unknown ID | `null` |
| `query_by_kind` | `kinds: ['claim']` | Only claim entries |
| `query_by_time_range` | `from: yesterday, to: now` | Entries in range |
| `query_with_limit` | `limit: 10` | At most 10 entries |
| `getChain_returns_dependencies` | Claim ID with deps | Chain with all deps |
| `entries_are_immutable` | Attempt to modify | Error thrown |

### 5.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `ledger_survives_restart` | Append, restart, query | All entries present |
| `concurrent_appends` | 100 parallel appends | All entries created, no duplicates |
| `subscription_receives_new` | Subscribe, append | Callback invoked with new entry |
| `large_payload_handling` | 1MB payload | Stored and retrieved correctly |

### 5.3 BDD Scenarios

```gherkin
Feature: Evidence Ledger
  As a LiBrainian system
  I want to record all epistemic events
  So that I can audit, calibrate, and improve

  Scenario: Recording a claim with supporting evidence
    Given I have extracted function "calculateTotal"
    And I have retrieved related functions via vector search
    When I synthesize a claim "calculateTotal handles edge cases"
    Then the claim entry references the extraction and retrieval entries
    And the chain confidence is derived from supporting evidence

  Scenario: Detecting contradictions
    Given I have a claim "functionA calls functionB"
    And I have a newer extraction showing no call relationship
    When I query for contradictions
    Then I receive a contradiction entry linking both claims

  Scenario: Calibration feedback loop
    Given I made a prediction with 0.8 confidence
    And the outcome was incorrect
    When I record the outcome
    Then the calibration evidence is created
    And future confidence derivations can use this data
```

---

## 6. Confidence Derivation

All evidence entries that carry confidence MUST derive it according to Track D principles:

```typescript
function deriveEvidenceConfidence(entry: Omit<EvidenceEntry, 'confidence'>): ConfidenceValue {
  switch (entry.kind) {
    case 'extraction':
      return deriveExtractionConfidence(entry.payload as ExtractionEvidence);
    case 'retrieval':
      return deriveRetrievalConfidence(entry.payload as RetrievalEvidence);
    case 'synthesis':
      return deriveSynthesisConfidence(entry.payload as SynthesisEvidence);
    case 'claim':
      return deriveClaimConfidence(entry.payload as ClaimEvidence);
    default:
      return { type: 'absent', reason: 'no_derivation_defined' };
  }
}
```

---

## 7. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| Bootstrap | Records extraction evidence | Writes to ledger |
| Query Engine | Records retrieval evidence | Writes to ledger |
| Synthesis | Records synthesis evidence | Writes to ledger |
| MCP Tools | Records tool_call evidence | Writes to ledger |
| Calibration | Reads outcomes, writes calibration | Reads and writes |
| Learning Loop | Reads feedback and outcomes | Reads from ledger |

---

## 8. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Implementation complete
- [ ] Gate passed

---

## 9. Epistemological Model

This section documents the philosophical foundations of LiBrainian's epistemic system, which differ fundamentally from classical approaches.

### 9.1 Temporal Paraconsistent Epistemology

LiBrainian implements **temporal paraconsistent epistemology**, NOT classical AGM belief revision. This distinction is critical:

| Aspect | AGM Belief Revision | LiBrainian's Approach |
|--------|---------------------|---------------------|
| Contradictions | Immediately resolved via contraction | Kept visible indefinitely |
| Belief sets | Always consistent | Can contain contradictions |
| Revision | Binary: accept or reject | Graduated via confidence degradation |
| Time | Atemporal | Time is a first-class dimension |
| Closed-world | Yes (completeness assumed) | Open-world (incompleteness explicit) |

**Why Paraconsistency?**

In real codebases, contradictions are common and often meaningful:
- Documentation may contradict implementation
- Different versions of code have different behaviors
- Human understanding evolves over time
- LLM synthesis may produce inconsistent claims

Rather than forcing premature resolution (which loses information), LiBrainian preserves contradictions and uses them to:
1. Surface areas needing human attention
2. Track uncertainty in specific code regions
3. Improve calibration by observing which claims survive

### 9.2 Contradictions: Visibility Over Resolution

**Core Invariant**: Contradictions are NEVER silently reconciled.

When two claims contradict:
1. Both claims are marked with `status: 'contradicted'`
2. A `Contradiction` record is created linking both claims
3. Both claims remain queryable and visible
4. Chain confidence is reduced (see propagation rules)

This visibility serves several purposes:
- **Auditability**: Users can always see where knowledge is uncertain
- **Learning**: Feedback on contradictions improves future synthesis
- **Safety**: No silent information loss from automated resolution

**Resolution requires explicit action**:
```typescript
interface ContradictionResolution {
  method: 'prefer_a' | 'prefer_b' | 'merge' | 'both_valid' | 'neither_valid' | 'context_dependent';
  explanation: string;
  resolver: string;  // Who/what made the decision
  tradeoff: string;  // Explicit documentation of what was lost
}
```

### 9.3 Soft Revision via Confidence Degradation

Instead of binary belief acceptance/rejection, LiBrainian uses **soft revision** through graduated confidence degradation:

**Confidence Propagation Rules** (configurable):

| Rule | Formula | Use Case |
|------|---------|----------|
| `min` | min(confidences) | Conservative; single weak link breaks chain |
| `max` | max(confidences) | Optimistic; any strong evidence sufficient |
| `product` | conf1 * conf2 * ... | Independent probabilities |
| `weighted_average` | sum(wi * ci) / sum(wi) | Weighted by evidence quality |
| `noisy_or` | 1 - prod(1 - ci) | Multiple independent causes |

**Contradiction Penalties** (applied automatically):

| Contradiction Severity | Effect |
|----------------------|--------|
| `blocking` | Chain confidence = 0 |
| `significant` | Confidence *= 0.5 per contradiction |
| `minor` | Confidence *= 0.9 per contradiction |

**Defeater Effects**:
- Defeaters reduce confidence but don't immediately delete claims
- Claims with low confidence are marked `stale` rather than removed
- Historical claims remain in the ledger for calibration

### 9.4 Time as a First-Class Dimension

Every entry has an immutable timestamp, enabling:
- **Temporal queries**: "What did we believe at time T?"
- **Drift detection**: "Has this claim's support changed?"
- **Staleness**: Claims decay in confidence over time
- **Replay**: Reconstruct reasoning chains as they existed

This contrasts with atemporal AGM where beliefs exist in a timeless set.

### 9.5 Open-World Assumption

LiBrainian operates under an **open-world assumption**:
- Absence of a claim does not imply its negation
- `AbsentConfidence` explicitly represents "we don't know"
- Queries can return "insufficient evidence" rather than false

This prevents false negatives when knowledge is simply missing.

---

## 10. Implementation Notes

### 10.1 Performance Considerations

- Use WAL mode for SQLite (concurrent reads during writes)
- Batch appends for high-throughput scenarios
- Index on `(kind, timestamp)` for common queries
- Consider time-based partitioning for very large ledgers

### 10.2 Migration Path

Existing systems that will wire into the ledger:
1. MCP audit events → `tool_call` entries
2. Episode records → `episode` entries
3. Query stage logs → `retrieval` entries
4. Bootstrap extraction → `extraction` entries

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
