# Machine-Verifiable Evaluation Track

> **Status**: Design
> **Purpose**: Ground truth without human annotation
> **Principle**: If a fact can be verified by a machine, use the machine as oracle

---

## Problem Statement

Human annotation is:
1. Expensive and slow
2. Not available for autonomous operation
3. Subject to human error

But many code understanding questions have **objectively verifiable answers** that can be checked by static analysis, compilers, or test execution.

---

## Core Insight

**Ground truth doesn't need to be human-generated if it can be machine-verified.**

| Claim Type | Verification Oracle |
|------------|---------------------|
| "Function X exists in file Y" | AST parser |
| "Module A imports module B" | Static import analysis |
| "Function X returns type T" | TypeScript compiler API |
| "Class A extends class B" | AST/reflection |
| "Commit X changed files [...]" | Git diff |
| "Test T passes" | Test runner |
| "File X contains string S" | grep/search |

---

## Verification Tiers

### Tier V1: Existence Verification
Can verify: Does the cited evidence exist?

```typescript
interface ExistenceCheck {
  fileExists(path: string): boolean;
  lineRangeValid(path: string, start: number, end: number): boolean;
  identifierExists(path: string, name: string): boolean;
}
```

**Pass criteria**: All cited files/lines/identifiers exist.

### Tier V2: Structural Verification
Can verify: Are structural claims correct?

```typescript
interface StructuralCheck {
  functionDefinedIn(funcName: string, filePath: string): boolean;
  moduleImports(importer: string, imported: string): boolean;
  classExtends(child: string, parent: string): boolean;
  functionCalls(caller: string, callee: string): boolean;
  typeOf(identifier: string): string;
}
```

**Oracle**: AST parser + TypeScript compiler API

### Tier V3: Behavioral Verification
Can verify: Do behavioral claims match execution?

```typescript
interface BehavioralCheck {
  testPasses(testPath: string): boolean;
  functionReturns(func: string, input: any, expected: any): boolean;
  codeThrows(code: string, errorType: string): boolean;
}
```

**Oracle**: Test runner + dynamic execution

### Tier V4: Consistency Verification
Can verify: Are answers internally consistent?

```typescript
interface ConsistencyCheck {
  answersConsistent(query1: string, answer1: string,
                    query2: string, answer2: string): boolean;
  noContradictions(claims: Claim[]): boolean;
}
```

**Method**: Ask same question multiple ways, check for contradictions.

---

## External Repo Requirements

**CRITICAL: Never evaluate on repos created by the model being evaluated.**

### Selection Criteria

1. **Real repos**: From GitHub, not AI-generated
2. **Recent**: Post-2024 preferred (less likely in training data)
3. **Obscure**: Low star count reduces training data likelihood
4. **Well-tested**: Repos with test suites provide behavioral ground truth
5. **Typed**: TypeScript repos provide type ground truth

### Recommended Sources

```bash
# Find recent, obscure TypeScript repos
gh search repos --language=typescript --created=">2024-06-01" --stars="10..100" --limit=20

# Find repos with good test coverage
gh search repos --language=typescript "test coverage" --stars="50..500"
```

### Verification of Non-Contamination

For each repo, check:
1. Created date vs model training cutoff
2. Star count (lower = less likely in training)
3. Fork status (original work vs fork)

---

## AST Fact Extractor

Automatically extract verifiable facts from any codebase:

```typescript
interface ExtractedFacts {
  // Structural facts
  files: string[];
  functions: { name: string; file: string; line: number; signature: string }[];
  classes: { name: string; file: string; extends?: string; implements?: string[] }[];
  imports: { from: string; to: string; symbols: string[] }[];
  exports: { file: string; symbols: string[] }[];

  // Call graph
  calls: { caller: string; callee: string; file: string; line: number }[];

  // Type information (TypeScript)
  types: { identifier: string; type: string; file: string }[];
}
```

### Query Generation from Facts

Automatically generate queries from extracted facts:

```typescript
function generateQueries(facts: ExtractedFacts): Query[] {
  const queries: Query[] = [];

  // Structural queries
  for (const func of facts.functions) {
    queries.push({
      query: `Where is the function ${func.name} defined?`,
      groundTruth: `${func.file}:${func.line}`,
      verification: 'structural',
    });
  }

  // Import queries
  for (const imp of facts.imports) {
    queries.push({
      query: `What does ${imp.from} import from ${imp.to}?`,
      groundTruth: imp.symbols,
      verification: 'structural',
    });
  }

  // Call graph queries
  for (const call of facts.calls) {
    queries.push({
      query: `Does ${call.caller} call ${call.callee}?`,
      groundTruth: true,
      verification: 'structural',
    });
  }

  return queries;
}
```

---

## Citation Verifier

For any LiBrainian response, verify citations:

```typescript
interface CitationVerification {
  verify(response: LibrarianResponse): VerificationResult;
}

interface VerificationResult {
  allFilesExist: boolean;
  allLinesValid: boolean;
  allIdentifiersFound: boolean;
  structuralClaimsCorrect: boolean;

  failures: {
    type: 'missing_file' | 'invalid_line' | 'missing_identifier' | 'wrong_structure';
    claim: string;
    evidence: string;
  }[];
}
```

---

## Consistency Checker

Generate query variants and check for contradictions:

```typescript
interface QueryVariant {
  original: string;
  variants: string[];
}

// Example variants for "Where is authentication handled?"
const authVariants: QueryVariant = {
  original: "Where is authentication handled?",
  variants: [
    "What file contains the login logic?",
    "Show me the auth middleware",
    "How does the app verify user identity?",
    "Where is the session validation code?",
  ],
};

function checkConsistency(answers: Map<string, string>): ConsistencyResult {
  // Extract file references from each answer
  // Check that all answers reference the same files
  // Flag contradictions
}
```

---

## Metrics

### Verification Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Citation Accuracy | % of citations that pass V1 verification | > 95% |
| Structural Accuracy | % of structural claims that pass V2 verification | > 90% |
| Consistency Rate | % of query variants with consistent answers | > 85% |
| Hallucination Rate | % of claims that fail verification | < 5% |

### Coverage Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Fact Coverage | % of extracted facts queryable | > 80% |
| Repo Coverage | # of external repos in corpus | >= 5 |
| Query Diversity | # of unique query patterns | >= 50 |

---

## Implementation Priority

1. **V1 (Existence)**: Implement first — cheap, catches obvious hallucinations
2. **V2 (Structural)**: Implement second — requires AST parser
3. **V4 (Consistency)**: Implement third — no oracle needed, just comparison
4. **V3 (Behavioral)**: Implement last — requires execution, more complex

---

## Non-Goals

This track does NOT attempt to verify:
- Subjective quality assessments ("Is this code well-written?")
- Intent/reasoning ("Why was this designed this way?")
- Recommendations ("Should I refactor this?")

These require human judgment. Focus on objective, verifiable facts.
