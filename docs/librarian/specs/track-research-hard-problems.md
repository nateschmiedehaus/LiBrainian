# Research Track: Hard Problems

> **Version**: 1.0.0
> **Status**: Research
> **Created**: 2026-01-25
> **Nature**: These are research-grade problems. Implement what's achievable; document limitations honestly.

## Purpose

Address the genuinely hard problems that prevent LiBrainian from being reliable:
- Semantic correctness verification
- Cross-file reasoning at scale
- Adversarial robustness
- Consistency and contradiction detection

These require research investment, not just engineering.

---

## H1: Semantic Verification

### Problem

LLM says "function X does Y" but it's wrong. No automated way to verify behavioral claims.

### Research Context

Current approaches from 2025 research:

| Approach | Method | Limitation |
|----------|--------|------------|
| **Test-based** | Generate test, run it | Only pure functions, test generation can be wrong |
| **Entailment checking** | NLI model checks if evidence supports claim | Requires good evidence retrieval |
| **Multi-query consistency** | Ask same thing multiple ways | Expensive, doesn't guarantee correctness |
| **MiniCheck-style** | Trained model checks grounding | Needs training data, may miss subtle errors |

**Source**: [MiniCheck: Efficient Fact-Checking of LLMs](https://arxiv.org/abs/2404.10774)

### Specification

#### H1.1: Test-Based Verification for Pure Functions

```typescript
interface TestBasedVerifier {
  // Identify if function is pure and testable
  canVerify(functionPath: string): VerifiabilityAssessment;

  // Generate test case from behavioral claim
  generateTest(claim: string, functionCode: string): GeneratedTest | null;

  // Run test and report result
  runVerification(test: GeneratedTest): VerificationResult;
}

interface VerifiabilityAssessment {
  canVerify: boolean;
  reason: string;
  confidence: number;
  limitations: string[];
}

interface GeneratedTest {
  testCode: string;
  claim: string;
  expectedBehavior: string;
  testType: 'unit' | 'property' | 'example';
}

interface VerificationResult {
  status: 'supported' | 'refuted' | 'inconclusive';
  evidence: string;
  testOutput?: string;
  confidence: number;
}
```

**Scope Limitations** (be honest):
- Only works for pure functions with observable I/O
- Cannot verify complex behavioral descriptions ("handles edge cases well")
- Test generation itself uses LLM and can be wrong
- Does not prove correctness, only provides supporting evidence

#### H1.2: Entailment-Based Grounding Check

Based on MiniCheck approach:

```typescript
interface EntailmentChecker {
  // Check if claim is entailed by evidence
  checkEntailment(claim: string, evidence: string[]): EntailmentResult;

  // Batch check for efficiency
  batchCheck(claims: ClaimEvidencePair[]): EntailmentResult[];
}

interface EntailmentResult {
  entailed: boolean;
  confidence: number;
  supportingPassages: string[];
  contradictingPassages: string[];
  neutralPassages: string[];
}
```

**Implementation Options**:
1. **MiniCheck-style small model**: Train on synthetic data, 400x cheaper than GPT-4
2. **LLM-as-judge**: Use capable LLM with structured prompt (expensive)
3. **Hybrid**: Small model for screening, LLM for uncertain cases

#### H1.3: Citation Verification

Based on LLM-Cite and SourceCheckup research:

```typescript
interface CitationVerifier {
  // Verify that citation actually supports claim
  verifyCitation(claim: string, citation: Citation): CitationVerification;

  // Check if cited code exists and is correctly referenced
  validateCitationTarget(citation: Citation): TargetValidation;
}

interface Citation {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  quotedCode?: string;
}

interface CitationVerification {
  supports: boolean;
  relevance: number;
  accuracy: number;        // Does quoted code match actual file?
  interpretation: string;  // How citation relates to claim
}
```

**Known Issues** (from SourceCheckup research):
- 50-90% of LLM responses not fully supported by cited sources
- Citations sometimes contradict claims
- Need human oversight for high-stakes decisions

---

## H2: Cross-File Reasoning

### Problem

Understanding requires reasoning across many files, but LLMs have context limits. Retrieval might miss relevant files.

### Research Context

State-of-the-art approaches from 2025:

| Approach | Description | Trade-off |
|----------|-------------|-----------|
| **Hierarchical summarization** | Summarize files → dirs → components | Information loss at each level |
| **Iterative retrieval** | Retrieve → analyze → retrieve more | Expensive, can loop forever |
| **Graph-based reasoning** | Traverse dependency/call graphs | Graph construction is hard |
| **Agentic search** | Model composes retrieval queries | Unpredictable, expensive |

**Source**: [Retrieval-Augmented Code Generation Survey](https://arxiv.org/abs/2510.04905)

Key insight from research: "Not all retrieved information is equally helpful. While contextual code from the current file and relevant API documentation significantly boosts performance, retrieving 'similar code' from other parts of the repository can introduce noise."

### Specification

#### H2.1: Hierarchical Summarization Index

```typescript
interface HierarchicalIndex {
  // Build hierarchical summary structure
  build(workspace: string): Promise<HierarchyNode>;

  // Query at appropriate level
  query(intent: string, tokenBudget: number): HierarchyQueryResult;
}

interface HierarchyNode {
  type: 'file' | 'directory' | 'component' | 'repo';
  path: string;
  summary: string;                    // Natural language summary
  keyEntities: string[];              // Functions, classes, exports
  children?: HierarchyNode[];
  tokenCount: number;                 // Cost to include full content
}

interface HierarchyQueryResult {
  selectedNodes: HierarchyNode[];
  totalTokens: number;
  coverage: number;                   // Estimated coverage of relevant info
  informationLoss: string[];          // What was summarized/omitted
}
```

**Trade-offs**:
- Each summarization level loses detail
- Summary quality depends on summarizer quality
- Must disclose information loss

#### H2.2: Iterative Retrieval with Convergence

```typescript
interface IterativeRetriever {
  // Retrieve with iterative refinement
  retrieve(intent: string, options: IterativeOptions): AsyncIterable<RetrievalStep>;
}

interface IterativeOptions {
  maxIterations: number;          // Prevent infinite loops (default: 5)
  maxTokens: number;              // Total token budget
  convergenceThreshold: number;   // Stop when new info < threshold
  allowedTools: string[];         // What retrieval methods to use
}

interface RetrievalStep {
  iteration: number;
  action: string;                 // "Searching for X" / "Reading Y"
  filesRetrieved: string[];
  gapsIdentified: string[];       // "Need to see implementation of Z"
  converged: boolean;
  reason: string;
}
```

**Convergence Detection**:
```typescript
interface ConvergenceDetector {
  // Check if retrieval has converged
  hasConverged(
    previousContext: string[],
    newContext: string[],
    gapsIdentified: string[]
  ): ConvergenceResult;
}

interface ConvergenceResult {
  converged: boolean;
  reason:
    | 'no_new_gaps'           // No more unknown references
    | 'gaps_resolved'         // All gaps filled
    | 'circular_reference'    // Would re-retrieve same files
    | 'budget_exhausted'      // Hit token/iteration limit
    | 'diminishing_returns';  // New info < threshold
  confidence: number;
}
```

#### H2.3: Graph-Based Retrieval

Based on GraphCoder and GRACE research:

```typescript
interface CodeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphNode {
  id: string;
  type: 'file' | 'function' | 'class' | 'variable' | 'import';
  path: string;
  name: string;
  summary?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  type:
    | 'imports'
    | 'calls'
    | 'extends'
    | 'implements'
    | 'uses'
    | 'defines'
    | 'dataflow';
  weight?: number;
}

interface GraphRetriever {
  // Build graph from codebase
  buildGraph(workspace: string): Promise<CodeGraph>;

  // Query using graph traversal
  queryGraph(
    startNodes: string[],       // Entry points
    relationTypes: string[],    // Which edges to follow
    maxDepth: number,
    maxNodes: number
  ): GraphQueryResult;

  // Find relevant subgraph for intent
  findRelevantSubgraph(intent: string): GraphQueryResult;
}

interface GraphQueryResult {
  nodes: GraphNode[];
  paths: GraphPath[];           // How nodes connect
  coverage: number;
  missedConnections: string[];  // Edges we couldn't build (unsupported language, etc.)
}
```

---

## H3: Adversarial Robustness

### Problem

Code can be misleading — wrong comments, dead code, obfuscation. LLM trusts comments and can be deceived.

### Research Context

This is understudied in code understanding literature. Applying general adversarial robustness research:

- Comments are untrusted input that can manipulate model behavior
- Dead code can distract from actual behavior
- Naming can mislead (security-relevant: `isAdmin()` that always returns true)

### Specification

#### H3.1: Comment/Code Disagreement Detection

```typescript
interface CommentCodeChecker {
  // Check if comment accurately describes code
  checkAgreement(code: string, comment: string): AgreementResult;

  // Find all disagreements in a file
  findDisagreements(filePath: string): DisagreementReport;
}

interface AgreementResult {
  agrees: boolean;
  confidence: number;
  disagreementType?:
    | 'factual_error'       // Comment states wrong behavior
    | 'outdated'            // Comment describes old behavior
    | 'incomplete'          // Comment omits important behavior
    | 'misleading'          // Comment could be misinterpreted
    | 'contradictory';      // Comment directly contradicts code
  evidence: string;
}

interface DisagreementReport {
  filePath: string;
  disagreements: Array<{
    location: { line: number; column: number };
    comment: string;
    code: string;
    issue: AgreementResult;
    severity: 'critical' | 'warning' | 'info';
  }>;
}
```

**Implementation Approach**:
1. Extract comment + associated code block
2. Generate behavioral description from code (ignoring comment)
3. Compare comment claims to generated description
4. Flag disagreements

#### H3.2: Dead Code Filtering

```typescript
interface DeadCodeDetector {
  // Find unreachable code
  findDeadCode(workspace: string): DeadCodeReport;

  // Check if specific code is reachable
  isReachable(filePath: string, lineRange: [number, number]): ReachabilityResult;
}

interface DeadCodeReport {
  unreachableFiles: string[];           // Entire files never imported
  unreachableFunctions: FunctionRef[];  // Functions never called
  unreachableBlocks: CodeBlockRef[];    // Code after unconditional return
  confidence: number;                   // Static analysis confidence
  limitations: string[];                // What we couldn't analyze
}

interface ReachabilityResult {
  reachable: boolean;
  confidence: number;
  paths?: string[];           // Call paths that reach this code
  reason?: string;            // Why unreachable
}
```

**Use in Synthesis**:
- Filter dead code from retrieval results
- Lower confidence for claims about code with reachability warnings
- Disclose when analyzing potentially dead code

#### H3.3: Red Flag Detection

```typescript
interface RedFlagDetector {
  // Detect signals that should reduce confidence
  detectRedFlags(filePath: string): RedFlagReport;
}

interface RedFlagReport {
  flags: Array<{
    type: RedFlagType;
    location: { line: number };
    description: string;
    confidenceImpact: number;   // Multiply confidence by this (0-1)
  }>;
  overallConfidenceMultiplier: number;
}

type RedFlagType =
  | 'todo_fixme_hack'           // TODO/FIXME/HACK comments
  | 'commented_out_code'        // Large blocks of commented code
  | 'unusual_naming'            // Single-letter vars, misleading names
  | 'conflicting_implementations' // Multiple versions of same thing
  | 'very_old_with_recent_changes' // Stale code being patched
  | 'unused_imports'            // Imports never referenced
  | 'magic_numbers'             // Unexplained numeric constants
  | 'deeply_nested'             // Excessive nesting (complexity)
  | 'very_long_function'        // Functions > 200 lines
  | 'no_tests';                 // Code with no test coverage
```

---

## H4: Consistency Checking

### Problem

LiBrainian might give different answers to semantically equivalent questions, or contradict itself across queries.

### Specification

#### H4.1: Multi-Query Consistency

```typescript
interface ConsistencyChecker {
  // Generate variant queries
  generateVariants(intent: string): string[];

  // Check consistency across variants
  checkConsistency(intent: string): ConsistencyReport;

  // Check if two responses are consistent
  compareResponses(response1: QueryResponse, response2: QueryResponse): ConsistencyResult;
}

interface ConsistencyReport {
  originalIntent: string;
  variants: string[];
  responses: QueryResponse[];
  overallConsistency: number;   // 0-1
  contradictions: Array<{
    claim1: string;
    claim2: string;
    type: 'direct_contradiction' | 'implicit_contradiction' | 'omission';
  }>;
  recommendation: string;       // Which response to trust, or "low confidence"
}
```

**Variant Generation Strategies**:
- Rephrase: "How does auth work?" → "Explain the authentication system"
- Inverse: "What calls X?" ↔ "What does X call?" (should be consistent)
- Specific → General: "What does loginUser do?" → "How does login work?"
- Part → Whole: Claims about function should be consistent with claims about module

#### H4.2: Temporal Consistency

```typescript
interface TemporalConsistencyTracker {
  // Track claims over time
  recordClaim(claim: Claim): void;

  // Check if new claim contradicts historical claims
  checkTemporalConsistency(newClaim: Claim): TemporalConsistencyResult;

  // Find all contradictions in claim history
  findContradictions(): ContradictionReport;
}

interface TemporalConsistencyResult {
  consistent: boolean;
  relatedHistoricalClaims: Array<{
    claim: Claim;
    timestamp: string;
    relationship: 'supports' | 'contradicts' | 'supersedes' | 'unrelated';
  }>;
  recommendation:
    | 'accept'              // Consistent with history
    | 'update_history'      // New claim supersedes old
    | 'flag_contradiction'  // Genuine contradiction, investigate
    | 'low_confidence';     // History is noisy, can't determine
}
```

#### H4.3: Cross-Reference Validation

```typescript
interface CrossReferenceValidator {
  // Validate bidirectional relationships
  validateCrossReferences(claims: Claim[]): CrossReferenceReport;
}

// Example validations:
// - If "A calls B", then "B's callers" should include A
// - If "A imports B", then "B's importers" should include A
// - If "A is the auth module", then questions about auth should mention A

interface CrossReferenceReport {
  validatedRelationships: number;
  brokenRelationships: Array<{
    claim1: Claim;
    claim2: Claim;
    expectedRelationship: string;
    actualRelationship: string;
  }>;
  integrityScore: number;
}
```

---

## Implementation Priorities

### Achievable Now (Engineering)
1. **Dead code detection** — Static analysis, well-understood
2. **Red flag detection** — Pattern matching + heuristics
3. **Citation validation** — Check if cited code exists
4. **Basic consistency checking** — Compare responses to variant queries

### Achievable with Effort (Applied Research)
5. **Comment/code disagreement** — LLM-based comparison
6. **Iterative retrieval** — Engineering + tuning
7. **Entailment checking** — Fine-tune small model or use LLM-as-judge
8. **Graph-based retrieval** — Build on existing dependency analysis

### Long-Term Research
9. **Test-based verification** — Reliable test generation is hard
10. **Hierarchical summarization** — Minimizing information loss
11. **Temporal consistency** — Requires claim history infrastructure
12. **Full calibration** — Requires substantial outcome data

---

## Gates

Add to `GATES.json`:

```json
{
  "layer6.deadCodeDetection": {
    "name": "Dead Code Detection",
    "layer": 6,
    "status": "not_started",
    "target": "Filter dead code from retrieval",
    "spec": "specs/track-research-hard-problems.md#h3.2"
  },
  "layer6.redFlagDetection": {
    "name": "Red Flag Detection",
    "layer": 6,
    "status": "not_started",
    "target": "Confidence adjustment for red flags",
    "spec": "specs/track-research-hard-problems.md#h3.3"
  },
  "layer6.citationValidation": {
    "name": "Citation Validation",
    "layer": 6,
    "status": "not_started",
    "target": "Verify cited code exists and supports claim",
    "spec": "specs/track-research-hard-problems.md#h1.3"
  },
  "layer6.iterativeRetrieval": {
    "name": "Iterative Retrieval",
    "layer": 6,
    "status": "not_started",
    "target": "Multi-step retrieval with convergence",
    "spec": "specs/track-research-hard-problems.md#h2.2"
  },
  "layer6.commentCodeChecker": {
    "name": "Comment/Code Disagreement",
    "layer": 6,
    "status": "not_started",
    "target": "Detect misleading comments",
    "spec": "specs/track-research-hard-problems.md#h3.1"
  },
  "layer6.consistencyChecker": {
    "name": "Multi-Query Consistency",
    "layer": 6,
    "status": "not_started",
    "target": "Check consistency across variant queries",
    "spec": "specs/track-research-hard-problems.md#h4.1"
  }
}
```

---

## Honest Assessment

### What Will Work
- Dead code filtering: Standard static analysis
- Red flag detection: Pattern matching
- Citation validation: File system checks
- Basic graph retrieval: Extend existing dependency analysis

### What Might Work
- Comment/code checking: Depends on LLM quality
- Iterative retrieval: Needs careful tuning to avoid loops
- Entailment checking: Small models promising but need training data

### What Probably Won't Work (Yet)
- Reliable test generation for arbitrary claims
- Perfect hierarchical summarization without information loss
- Full temporal consistency across all historical claims

### What We Don't Know
- How much these improvements actually matter for end-user outcomes
- Whether the engineering effort is worth the quality gain
- Which problems are fundamental vs. solvable with better models

**Recommendation**: Implement achievable items first, measure impact, then decide on research investments.

---

## References

- [MiniCheck](https://arxiv.org/abs/2404.10774) — Efficient grounding verification
- [LLM-Cite](https://openreview.net/forum?id=qb2QRoE4W3) — URL-based attribution
- [SourceCheckup](https://www.nature.com/articles/s41467-025-58551-6) — Citation evaluation
- [GraphCoder](https://www.semanticscholar.org/paper/GraphCoder) — Graph-based code retrieval
- [GRACE](https://arxiv.org/abs/2510.04905) — Multi-semantic code graphs
- [DependEval](https://aclanthology.org/2025.findings-acl.373.pdf) — Cross-file understanding
- [ReDeEP](https://openreview.net/forum?id=ztzZDzgfrh) — Mechanistic interpretability for hallucination
