# LiBrainian Schema Definitions

Status: authoritative
Scope: All typed artifacts and shared primitives used by LiBrainian.
Last Verified: 2026-01-26
Owner: librarianship
Version: 1.1.0

This document defines the canonical schemas for all LiBrainian artifacts, shared
primitives, and integration contracts. All implementations must conform to these
schemas. Schema changes require version bumps and migration paths.

## Schema Versioning Policy

1. **Version Format**: `{major}.{minor}.{patch}` (SemVer)
2. **Breaking Changes**: Increment major version; require migration
3. **Additive Changes**: Increment minor version; new optional fields only
4. **Bug Fixes**: Increment patch version; no schema changes
5. **Deprecation**: Mark fields as deprecated for 2 minor versions before removal

## Shared Primitives

### Entity
```typescript
interface Entity {
  id: string;           // UUID or content-hash
  kind: EntityKind;     // 'function' | 'module' | 'class' | 'file' | 'directory'
  name: string;         // Human-readable name
  qualifiedName: string; // Fully qualified path (e.g., "src/foo.ts:myFunction")
  location: EntityLocation;
}

interface EntityLocation {
  file: string;         // Absolute or workspace-relative path
  startLine: number;    // 1-indexed
  endLine?: number;     // 1-indexed, optional for single-line entities
  column?: number;      // 1-indexed column for precise location
}

type EntityKind = 'function' | 'module' | 'class' | 'interface' | 'type' |
                  'file' | 'directory' | 'variable' | 'constant';
```

### Relation
```typescript
interface Relation {
  id: string;           // UUID
  fromId: string;       // Source entity ID
  toId: string;         // Target entity ID
  kind: RelationKind;   // Type of relationship
  weight?: number;      // 0.0-1.0, strength of relationship
  evidence: Evidence;   // How this relation was discovered
}

type RelationKind = 'imports' | 'exports' | 'calls' | 'extends' | 'implements' |
                    'references' | 'tests' | 'co_changes' | 'depends_on' | 'owns';
```

### Evidence
```typescript
interface Evidence {
  sources: EvidenceSource[];  // Where the evidence came from
  method: ExtractionMethod;   // How it was extracted
  timestamp: string;          // ISO 8601 when evidence was collected
  confidence: number;         // 0.0-1.0
}

interface EvidenceSource {
  kind: 'ast' | 'git' | 'llm' | 'test' | 'user' | 'config' | 'runtime';
  path?: string;              // File path if applicable
  ref?: string;               // Git ref, test ID, or other reference
  citation?: string;          // Human-readable citation
}

type ExtractionMethod = 'ast_parsing' | 'type_inference' | 'dependency_graph' |
                        'git_history' | 'llm_synthesis' | 'embedding_similarity' |
                        'test_coverage' | 'runtime_trace' | 'user_annotation';
```

### Claim
```typescript
interface Claim {
  id: string;           // UUID
  entityId: string;     // Entity this claim is about
  category: ClaimCategory;
  statement: string;    // The claim itself
  confidence: Confidence;
  evidence: Evidence;
  defeaters: Defeater[];
  validUntil?: string;  // ISO 8601, when claim may become stale
}

type ClaimCategory = 'purpose' | 'behavior' | 'contract' | 'risk' |
                     'ownership' | 'quality' | 'security' | 'rationale';
```

### Confidence
```typescript
interface Confidence {
  overall: number;      // 0.0-1.0, geometric mean of dimensions
  byDimension: {
    freshness: number;  // 0.0-1.0, how recent is the evidence
    coverage: number;   // 0.0-1.0, how complete is the evidence
    reliability: number; // 0.0-1.0, how trustworthy is the source
  };
  bySection?: Record<string, number>; // Per-section confidence scores
  source: ConfidenceSource;
}

type ConfidenceSource = 'ast' | 'git_history' | 'user_provided' | 'llm_consensus' |
                        'single_llm' | 'embeddings' | 'inferred' | 'aggregated';

// Canonical computation
// overall = (freshness * coverage * reliability) ** (1/3)
// Defeaters are tracked separately and do not modify this score.
```

### Defeater
```typescript
interface Defeater {
  id: string;           // UUID
  kind: DefeaterKind;
  description: string;  // Human-readable explanation
  severity: 'low' | 'medium' | 'high' | 'critical';
  active: boolean;      // Is this defeater currently triggered?
  activatedAt?: string; // ISO 8601 when defeater became active
  evidence?: Evidence;  // Evidence that triggered the defeater
}

type DefeaterKind = 'stale_data' | 'file_changed' | 'test_failure' |
                    'dependency_conflict' | 'contradicting_evidence' |
                    'llm_disagreement' | 'user_override' | 'external_change';
```

### Trace
```typescript
interface Trace {
  id: string;           // UUID
  operation: string;    // What operation was performed
  timestamp: string;    // ISO 8601
  durationMs: number;   // How long it took
  provider?: ProviderTrace;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error?: TraceError;
}

interface ProviderTrace {
  provider: 'claude' | 'codex';
  modelId: string;
  promptDigest: string; // SHA-256 of prompt
  responseDigest: string; // SHA-256 of response
  tokenCount: { input: number; output: number };
}

interface TraceError {
  code: string;
  message: string;
  stack?: string;
}
```

### Scope
```typescript
interface Scope {
  kind: 'file' | 'directory' | 'module' | 'function' | 'workspace' | 'custom';
  paths: string[];      // Paths included in scope
  excludes?: string[];  // Paths excluded from scope
  depth?: number;       // Max depth for directory scopes
}
```

### Result/Error
```typescript
interface Result<T> {
  ok: true;
  value: T;
  warnings?: string[];
}

interface ResultError {
  ok: false;
  error: {
    code: string;       // Machine-readable error code
    message: string;    // Human-readable message
    details?: Record<string, unknown>;
    trace?: Trace;
  };
}

type ResultOrError<T> = Result<T> | ResultError;
```

## Evaluation Artifacts

### GroundTruthCorpus.v1
```typescript
interface GroundTruthCorpus {
  version: string;              // SemVer identifier for corpus content
  repos: RepoManifest[];
  queries: GroundTruthQuery[];
  notes?: string;
}

interface GroundTruthQuery {
  queryId: string;
  repoId: string;
  intent: string;               // Natural language query intent
  category: 'structural' | 'behavioral' | 'architectural' | 'impact' | 'security';
  difficulty: 'trivial' | 'moderate' | 'hard' | 'research';
  correctAnswer: CorrectAnswer;
  lastVerified: string;         // ISO date
  verifiedBy: string;
  verificationNotes?: string;
  tags?: string[];
}

interface CorrectAnswer {
  summary: string;
  mustIncludeFiles: string[];
  shouldIncludeFiles: string[];
  mustIncludeFacts: string[];
  mustNotClaim: string[];
  acceptableVariations: string[];
  evidenceRefs: EvidenceRef[];
  evidenceLinks?: EvidenceLink[];
}

interface EvidenceRef {
  refId: string;                // Unique within the query
  kind: 'file' | 'annotation' | 'doc' | 'test' | 'commit' | 'issue' | 'runtime' | 'external';
  label: string;                // Short human label
  path?: string;                // File path or repo-relative location
  uri?: string;                 // External URI if not local
  ref?: string;                 // Commit SHA, test ID, or external reference
  location?: EvidenceLocation;  // Optional line/column info
  excerpt?: string;             // Short evidence excerpt
  hash?: string;                // Content hash if applicable
  notes?: string;
  tags?: string[];
}

interface EvidenceLocation {
  startLine: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
}

interface EvidenceLink {
  kind?: 'summary' | 'fact' | 'file' | 'variation' | 'note';
  target: string;               // Fact or file path that the evidence supports
  refIds: string[];             // EvidenceRef.refId values
}
```

## Integration Artifacts

### EvidencePack.v1
```typescript
interface EvidencePack {
  kind: 'EvidencePack.v1';
  schemaVersion: 1;

  // Provenance
  provider: 'claude' | 'codex';
  modelId: string;
  timestamp: string;    // ISO 8601

  // Evidence
  citations: Citation[];
  traceIds: string[];   // References to full traces
  extractionMethods: ExtractionMethod[];

  // Verification
  promptDigest: string; // SHA-256 of prompt sent to LLM
  responseDigest: string; // SHA-256 of LLM response

  // Versioning
  version: string;      // SemVer of the extraction logic
}

interface Citation {
  source: string;       // File path or external reference
  line?: number;        // Line number if applicable
  text: string;         // The cited text
  relevance: number;    // 0.0-1.0
}
```

### ContextPackBundle.v1
```typescript
interface ContextPackBundle {
  kind: 'ContextPackBundle.v1';
  schemaVersion: 1;

  // Identity
  id: string;           // UUID
  targetId: string;     // Entity this pack is for
  packType: string;     // 'function_context' | 'module_context' | etc.

  // Content
  summary: string;      // LLM-generated summary
  relatedFiles: string[];
  highlights: string[]; // Key points for agent consumption

  // Confidence
  confidence: {
    overall: number;
    bySection: Record<string, number>;
  };

  // Defeaters
  defeaters: Defeater[];

  // Evidence
  evidence: EvidencePack;

  // Metadata
  createdAt: string;    // ISO 8601
  expiresAt?: string;   // ISO 8601, when pack should be refreshed
  accessCount: number;  // Times this pack was used
  lastAccessed?: string; // ISO 8601
}
```

### GapReport.v1
```typescript
interface GapReport {
  kind: 'GapReport.v1';
  schemaVersion: 1;

  // Scope
  scope: Scope;
  generatedAt: string;  // ISO 8601

  // Gaps
  gaps: Gap[];

  // Summary
  summary: {
    totalGaps: number;
    bySeverity: Record<'low' | 'medium' | 'high' | 'critical', number>;
    byCategory: Record<string, number>;
  };

  // Recommendations
  recommendations: GapRecommendation[];
}

interface Gap {
  id: string;           // UUID
  category: GapCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedEntities: string[]; // Entity IDs
  missingData: string[];      // What data is missing
  suggestedAction: string;
}

type GapCategory = 'missing_knowledge' | 'stale_knowledge' | 'low_confidence' |
                   'missing_tests' | 'missing_docs' | 'unverified_claim' |
                   'missing_method_coverage' | 'missing_uc_coverage';

interface GapRecommendation {
  priority: number;     // 1 = highest
  action: string;       // What to do
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  gaps: string[];       // Gap IDs this addresses
}
```

### UCRequirementSet.v1
```typescript
interface UCRequirementSet {
  kind: 'UCRequirementSet.v1';
  schemaVersion: 1;

  // Identity
  queryId: string;      // Query this set was generated for
  generatedAt: string;  // ISO 8601

  // Requirements
  ucIds: string[];      // e.g., ['UC-001', 'UC-042', 'UC-135']
  methodFamilies: string[]; // e.g., ['MF-01', 'MF-03']
  methods: string[];    // e.g., ['M-001', 'M-015', 'M-042']

  // Mapping
  ucToMethods: Record<string, string[]>; // UC ID -> Method IDs
  methodToUcs: Record<string, string[]>; // Method ID -> UC IDs

  // Confidence
  confidence: number;   // 0.0-1.0
  reasoning: string;    // Why these UCs/methods were selected
}
```

### WorkflowRunRecord.v1
```typescript
interface WorkflowRunRecord {
  kind: 'WorkflowRunRecord.v1';
  schemaVersion: 1;

  // Identity
  id: string;           // UUID
  workflowId: string;   // Template ID
  startedAt: string;    // ISO 8601
  completedAt?: string; // ISO 8601

  // Status
  status: 'running' | 'completed' | 'failed' | 'cancelled';

  // Steps
  steps: WorkflowStepRecord[];

  // Outcomes
  outcome?: {
    success: boolean;
    artifacts: string[]; // Paths to output artifacts
    errors: TraceError[];
  };

  // Traces
  traceIds: string[];
}

interface WorkflowStepRecord {
  stepId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: TraceError;
}
```

### SlopReviewReport.v1
```typescript
interface SlopReviewReport {
  kind: 'SlopReviewReport.v1';
  schemaVersion: 1;

  // Metadata
  createdAt: string;    // ISO 8601

  // Inputs
  inputs: {
    mode: 'diff' | 'full';
    staged: boolean;
    files: string[];
    diffSha256?: string;
  };

  // Results
  result: {
    summary: {
      blockers: number;
      warnings: number;
      notes: string[];
    };
    findings: SlopFinding[];
  };

  // Outcome
  outcome: {
    status: 'passed' | 'failed';
    reason?: string;
  };
}

interface SlopFinding {
  severity: 'blocker' | 'warning' | 'info';
  category: string;     // 'fail_open' | 'theater' | 'unsafe_ops' | etc.
  filePath: string;
  symbol?: string;
  evidence: string;     // Code snippet or diff
  recommendation: string;
  confidence: 'high' | 'medium' | 'low';
}
```

### GroundTruthCorpus.v1
```typescript
interface GroundTruthCorpus {
  kind: 'GroundTruthCorpus.v1';
  schemaVersion: 1;
  version: string;
  repos: RepoManifest[];
  queries: GroundTruthQuery[];
}

interface RepoManifest {
  repoId: string;
  name: string;
  languages: string[];
  fileCount: number;
  annotationLevel: 'full' | 'partial' | 'sparse';
  characteristics: {
    documentationDensity: 'high' | 'medium' | 'low';
    testCoverage: 'high' | 'medium' | 'low';
    architecturalClarity: 'clear' | 'moderate' | 'complex';
    codeQuality: 'clean' | 'average' | 'legacy';
  };
}

interface GroundTruthQuery {
  queryId: string;
  repoId: string;
  intent: string;
  category: 'structural' | 'behavioral' | 'architectural' | 'impact' | 'security';
  difficulty: 'trivial' | 'moderate' | 'hard' | 'research';
  correctAnswer: {
    summary: string;
    mustIncludeFiles: string[];
    shouldIncludeFiles: string[];
    mustIncludeFacts: string[];
    mustNotClaim: string[];
    acceptableVariations: string[];
  };
  lastVerified: string;       // ISO date
  verifiedBy: string;
  verificationNotes?: string;
}
```

## Vector Storage Schema

### Vector Index (SQLite + sqlite-vss)
```sql
-- Multi-vector embeddings for entities
CREATE TABLE librarian_multi_vectors (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,  -- 'module' | 'function' | 'file'

  -- Vector payloads (JSON-serialized)
  semantic_vector BLOB,       -- 384-dim Float32Array
  structural_vector BLOB,     -- 384-dim Float32Array
  dependency_vector BLOB,     -- 384-dim Float32Array
  usage_vector BLOB,          -- 384-dim Float32Array

  -- Input texts for reproducibility
  semantic_input TEXT,
  structural_input TEXT,
  dependency_input TEXT,
  usage_input TEXT,

  -- Metadata
  model_id TEXT NOT NULL,     -- 'all-MiniLM-L6-v2' | 'jina-embeddings-v2-base-en' | 'bge-small-en-v1.5'
  llm_purpose TEXT,           -- LLM-extracted purpose summary
  generated_at TEXT NOT NULL, -- ISO 8601
  token_count INTEGER,

  FOREIGN KEY (entity_id) REFERENCES librarian_modules(id)
);

-- Indexes for efficient retrieval
CREATE INDEX idx_multi_vectors_entity ON librarian_multi_vectors(entity_id, entity_type);
CREATE INDEX idx_multi_vectors_model ON librarian_multi_vectors(model_id);
```

### Available Embedding Models
| Model ID | Dimension | Context Window | Use Case |
|----------|-----------|----------------|----------|
| all-MiniLM-L6-v2 | 384 | 256 tokens | Default, validated AUC 1.0 |
| jina-embeddings-v2-base-en | 768 | 8192 tokens | Long documents |
| bge-small-en-v1.5 | 384 | 512 tokens | Balanced |

### Distance Metric
- Cosine similarity for all vector comparisons
- Score normalization: `(1 + cosineSimilarity) / 2` for 0-1 range

## Engine Interface Contracts

### RelevanceEngine
```typescript
interface RelevanceEngine {
  /**
   * Query for relevant files given an intent.
   * @returns Files ranked by weighted multi-vector similarity
   */
  query(options: {
    intent: string;
    hints?: string[];           // File paths to prioritize
    budget: {
      maxFiles: number;
      maxTokens: number;
      maxDepth: number;
    };
    urgency: 'blocking' | 'background';
  }): Promise<RelevanceResult>;
}

interface RelevanceResult {
  files: Array<{
    path: string;
    score: number;              // 0.0-1.0
    matchedAspects: string[];   // 'semantic' | 'structural' | 'dependency' | 'usage'
  }>;
  tokenEstimate: number;
  truncated: boolean;
}
```

### ConstraintEngine
```typescript
interface ConstraintEngine {
  /**
   * Get constraints applicable to given paths.
   */
  getApplicableConstraints(paths: string[]): Promise<Constraint[]>;

  /**
   * Validate a code change against constraints.
   */
  validateChange(
    path: string,
    before: string,
    after: string
  ): Promise<ConstraintValidation>;
}

interface Constraint {
  id: string;
  name: string;
  scope: Scope;
  severity: 'error' | 'warning' | 'info';
  rule: string;                 // Human-readable rule
  checkFn?: string;             // Path to validation function
}

interface ConstraintValidation {
  valid: boolean;
  violations: ConstraintViolation[];
  warnings: ConstraintViolation[];
}

interface ConstraintViolation {
  constraint: Constraint;
  message: string;
  location?: EntityLocation;
  suggestion?: string;
}
```

### MetaKnowledgeEngine
```typescript
interface MetaKnowledgeEngine {
  /**
   * Get confidence level for knowledge about given paths.
   */
  getConfidence(paths: string[]): Promise<number>;

  /**
   * Decide if agent should proceed based on knowledge quality.
   */
  shouldProceed(paths: string[]): Promise<ProceedDecision>;

  /**
   * Get blast radius for potential changes.
   */
  getBlastRadius(paths: string[]): Promise<BlastRadiusResult>;
}

interface ProceedDecision {
  proceed: boolean;
  confidence: number;
  reason: string;
  suggestions?: string[];
}

interface BlastRadiusResult {
  directlyAffected: string[];
  transitivelyAffected: string[];
  testImpact: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}
```

## Measurement Artifacts

### RetrievalQualityReport.v1
```typescript
interface RetrievalQualityReport {
  kind: 'RetrievalQualityReport.v1';
  schemaVersion: 1;

  // Metadata
  generatedAt: string;        // ISO 8601
  scope: Scope;
  queryCorpusSize: number;
  documentCorpusSize: number;

  // Core Metrics
  metrics: {
    recallAt5: number;        // Target: ≥ 0.70
    recallAt10: number;       // Target: ≥ 0.80
    precisionAt5: number;     // Target: ≥ 0.40
    nDCG: number;             // Target: ≥ 0.60
    mrr: number;              // Mean Reciprocal Rank
  };

  // Per-Category Metrics
  byCategory: Record<string, {
    recallAt5: number;
    precisionAt5: number;
    sampleSize: number;
  }>;

  // Sample Failures (for debugging)
  failures: Array<{
    queryId: string;
    query: string;
    expectedDocIds: string[];
    retrievedDocIds: string[];
    recallAchieved: number;
  }>;

  // Comparison (optional)
  baseline?: {
    reportId: string;
    delta: Record<string, number>;  // metric name -> change
  };
}
```

### CalibrationReport.v1
```typescript
interface CalibrationReport {
  kind: 'CalibrationReport.v1';
  schemaVersion: 1;

  // Metadata
  generatedAt: string;        // ISO 8601
  scope: Scope;
  sampleSize: number;

  // Overall Calibration
  overallCalibrationError: number;  // Target: ≤ 0.10

  // Per-Bucket Analysis
  buckets: Array<{
    confidenceRange: [number, number];
    statedMean: number;
    empiricalAccuracy: number;
    sampleSize: number;
    calibrationError: number;
  }>;

  // Problem Areas
  overconfidentBuckets: string[];   // Ranges where stated > empirical
  underconfidentBuckets: string[];  // Ranges where stated < empirical

  // Trend
  trend?: {
    previousError: number;
    direction: 'improving' | 'degrading' | 'stable';
  };
}
```

### DeterminismProvenance.v1
```typescript
interface DeterminismProvenance {
  kind: 'DeterminismProvenance.v1';
  schemaVersion: 1;

  // Identity
  entityId: string;
  operationType: 'index' | 'embed' | 'extract' | 'synthesize';

  // Input Fingerprints
  inputs: {
    sourceContentHash: string;      // SHA-256 of source file(s)
    configHash: string;             // SHA-256 of chunking/extraction config
    modelId: string;                // Embedding or LLM model
    seed?: number;                  // Random seed if applicable
  };

  // Output Fingerprints
  outputs: {
    entityHash: string;             // SHA-256 of extracted entity
    embeddingHash?: string;         // SHA-256 of embedding vector
    relationsHash?: string;         // SHA-256 of extracted relations
  };

  // Non-Deterministic Components (must be recorded)
  nonDeterministic?: {
    llmPrompt: string;              // Full prompt sent
    llmResponse: string;            // Full response received
    llmModelId: string;             // Exact model used
    timestamp: string;              // ISO 8601
  };

  // Verification
  replayable: boolean;              // Can this be exactly reproduced?
  replayInstructions?: string;      // How to reproduce if not automatic
}
```

### PerformanceReport.v1
```typescript
interface PerformanceReport {
  kind: 'PerformanceReport.v1';
  schemaVersion: 1;

  // Metadata
  generatedAt: string;        // ISO 8601
  scope: Scope;
  sampleSize: number;

  // Latency Metrics
  latency: {
    queryP50Ms: number;       // Target: < 500ms
    queryP99Ms: number;       // Target: < 2000ms
    bootstrapMinutes: number; // For 10k files: < 5 minutes
    indexFreshnessMinutes: number; // Target: < 5 minutes
  };

  // Throughput
  throughput: {
    queriesPerSecond: number;
    indexedFilesPerMinute: number;
    cacheHitRate: number;     // Target: > 0.60
  };

  // Resource Usage
  resources: {
    peakMemoryMb: number;
    avgCpuPercent: number;
    diskUsageMb: number;
  };

  // SLO Compliance
  sloCompliance: {
    latencyP50: boolean;      // < 500ms
    latencyP99: boolean;      // < 2s
    indexFreshness: boolean;  // < 5 minutes
    availability: number;     // Target: > 0.995
  };
}
```

### BootstrapReport.v1
```typescript
interface BootstrapReport {
  kind: 'BootstrapReport.v1';
  schemaVersion: 1;

  // Metadata
  generatedAt: string;        // ISO 8601
  workspacePath: string;

  // Scope
  scope: {
    totalFiles: number;
    indexedFiles: number;
    skippedFiles: number;
    languages: string[];
  };

  // Timing
  timing: {
    totalDurationMs: number;
    phases: Record<string, number>;  // phase name -> duration ms
  };

  // Entity Counts
  entities: {
    functions: number;
    classes: number;
    modules: number;
    files: number;
    relations: number;
  };

  // Quality Metrics
  quality: {
    coverageRatio: number;    // indexed / total
    averageConfidence: number;
    defeaterCount: number;
    orphanEntities: number;   // Entities with no relations
  };

  // Errors
  errors: Array<{
    phase: string;
    file?: string;
    error: TraceError;
  }>;

  // Determinism
  provenance: DeterminismProvenance[];
}
```

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-08 | 1.1.0 | Added measurement artifacts: RetrievalQualityReport, CalibrationReport, DeterminismProvenance, PerformanceReport, BootstrapReport |
| 2026-01-04 | 1.0.0 | Initial schema definitions created |

---

*This document is authoritative for all LiBrainian type definitions.*
