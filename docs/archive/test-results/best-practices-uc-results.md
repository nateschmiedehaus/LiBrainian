# Best Practices Use Case - Test Results

**Date**: 2026-01-31
**Purpose**: Evaluate LiBrainian's ability to identify project conventions and best practices

## Executive Summary

| Query | Identified Conventions? | Grade |
|-------|------------------------|-------|
| Coding conventions | No | F |
| Naming conventions | No | F |
| Error handling best practices | Partially | C |
| Testing patterns | Partially | C- |
| Project structure | No | F |

**Overall Assessment**: **POOR** - LiBrainian struggles significantly with best practices queries. It fails to surface documentation (AGENTS.md, README, etc.) and instead returns random function contexts unrelated to the actual conventions used in the project.

---

## Query 1: "coding conventions in this project"

### Results
- **Confidence**: 0.910
- **Latency**: 3389ms
- **Packs Found**: 6

### Analysis
**FAILED to identify coding conventions.**

The query returned generic function context packs that have no relation to coding conventions:
- `buildQueryEpisode` - query episode construction
- `setCachedQuery` - caching logic
- `createQueryInterface` - factory function
- `executeDeltaMap` - git diff execution
- `parseSynthesisResponse` - JSON parsing
- `parseYamlDocument` - YAML parsing

**Coverage Gaps**:
- "No semantic matches above similarity threshold (0.35)"
- "Fell back to general packs (semantic match unavailable)"

**What was expected**:
- AGENTS.md (contains explicit coding conventions)
- TypeScript configuration files (tsconfig.json)
- ESLint/Prettier configuration
- Documentation about strict mode, typing conventions, etc.

---

## Query 2: "naming conventions used"

### Results
- **Confidence**: 0.910
- **Latency**: 1508ms
- **Packs Found**: 6

### Analysis
**FAILED to identify naming conventions.**

Returned identical generic function contexts as Query 1:
- Same 6 unrelated function packs
- Same "Fell back to general packs" message

**What was expected**:
- Documentation showing camelCase for functions
- snake_case for file names
- TypeScript interface naming conventions (I-prefix or not)
- Constant naming patterns

---

## Query 3: "error handling best practices"

### Results
- **Confidence**: 0.675
- **Latency**: 1929ms
- **Packs Found**: 10

### Analysis
**PARTIALLY SUCCESSFUL** - Found relevant error handling code.

Relevant results returned:
1. `getError` (src/utils/safe_json.ts) - Result type error extraction
2. `wrapError` (src/utils/errors.ts) - Error wrapping utility
3. `formatLlmError` (src/api/technique_execution.ts) - LLM error formatting
4. `isErrorHandlingCall` (src/constructions/bug_investigation_assistant.ts) - Error call detection
5. `normalizeError` (src/security/error_boundary.ts) - Error normalization
6. `withErrorBoundarySync` (src/security/error_boundary.ts) - Sync error boundary
7. `withErrorBoundary` (src/security/error_boundary.ts) - Async error boundary
8. `safeAsync` (src/core/result.ts) - Safe async wrapper
9. `formatErrorWithHints` (src/cli/errors.ts) - Human-readable error formatting
10. `classifyError` (src/cli/errors.ts) - Error classification

**This is the best result** - it actually found error-handling related code that demonstrates the patterns used.

**Missing**:
- No high-level documentation explaining the error handling philosophy
- Didn't find AGENTS.md which may contain error handling guidance

---

## Query 4: "testing patterns"

### Results
- **Confidence**: 0.535
- **Latency**: 1825ms
- **Packs Found**: 6

### Analysis
**PARTIALLY SUCCESSFUL** - Found some test-related code, but not the actual testing patterns/conventions.

Results returned:
1. `parseBehaviorFromTestName` (testing_extractor.ts) - Extracts behavior from test names
2. `validateTestCommand` (repro_bisect_template.ts) - Validates shell test commands
3. `matchesPattern` (tdd_engine.ts) - Pattern matching for tests
4. `isNullError` (bug_investigation_assistant.ts) - Error checking (loosely related)
5. `getTestStrategiesForProblemType` (benchmark_evolver.ts) - Test strategy selection
6. `checkIfValidated` (rationale_extractor.ts) - Validation checking

**What was expected**:
- Actual test files showing patterns (e.g., `src/__tests__/*.test.ts`)
- Vitest configuration
- Test utilities and helpers
- Documentation on test organization (unit vs integration)

---

## Query 5: "recommended project structure"

### Results
- **Confidence**: 0.529
- **Latency**: 1269ms
- **Packs Found**: 6

### Analysis
**FAILED to identify project structure conventions.**

Returned same generic function contexts as Query 1:
- `buildQueryEpisode`, `setCachedQuery`, `createQueryInterface`, etc.
- Same fallback message

**What was expected**:
- Directory structure documentation
- Module organization (api/, cli/, storage/, etc.)
- Entry points (index.ts files)
- Configuration file locations

---

## Root Cause Analysis

### Why Best Practices Queries Fail

1. **No Documentation Pack Type**: The system doesn't have a dedicated pack type for conventions/documentation. All packs are `function_context` type.

2. **Semantic Matching Threshold Too High**: The similarity threshold of 0.35 is too restrictive for meta-queries about patterns/conventions. These queries don't match function signatures well.

3. **No AGENTS.md Indexing**: The project has an AGENTS.md file with explicit conventions, but it wasn't surfaced in any query.

4. **Fallback Strategy is Poor**: When semantic matching fails, the fallback returns arbitrary high-confidence function packs that are completely irrelevant to the query intent.

5. **No Meta-Query Detection for Conventions**: While the system detected "Meta-query" for the error handling query, it only "boosted documentation in ranking" - but there's no documentation to boost.

### Technical Issues Observed

- **Lock File Contention**: Multiple queries hit `ESTORAGE_LOCKED` errors requiring manual lock cleanup
- **Exit Code 144**: Several queries were interrupted (SIGINT)
- **Inconsistent Timeouts**: Some queries hung indefinitely

---

## Recommendations

### High Priority

1. **Index Documentation Files**: Create packs from:
   - AGENTS.md
   - README.md
   - docs/ directory
   - JSDoc comments describing patterns

2. **Add "convention" Pack Type**: Dedicated pack type for project conventions with higher base priority for meta-queries.

3. **Lower Semantic Threshold for Meta-Queries**: When query intent is about "conventions", "patterns", "best practices", use a lower threshold (0.15-0.20).

4. **Improve Fallback Strategy**: When no semantic matches found, return "No conventions documented" rather than random function packs.

### Medium Priority

5. **Directory Structure Analysis**: Index the project structure itself as a queryable entity.

6. **Cross-Reference Configuration**: Parse tsconfig.json, .eslintrc, vitest.config.ts to extract conventions.

7. **Example-Based Learning**: Identify exemplary files that demonstrate patterns.

### Low Priority

8. **Convention Inference**: Analyze function naming patterns across codebase to infer conventions.

---

## Metrics Summary

| Metric | Query 1 | Query 2 | Query 3 | Query 4 | Query 5 |
|--------|---------|---------|---------|---------|---------|
| Confidence | 0.910 | 0.910 | 0.675 | 0.535 | 0.529 |
| Latency (ms) | 3389 | 1508 | 1929 | 1825 | 1269 |
| Packs Found | 6 | 6 | 10 | 6 | 6 |
| Entropy | 0.436 | 0.436 | 0.910 | 0.997 | 0.998 |
| Variance | 0.082 | 0.082 | 0.220 | 0.249 | 0.249 |
| Semantic Match | No | No | Yes | Yes | No |

**Observation**: Higher confidence (0.91) correlates with WORSE results (fallback packs). Lower confidence (0.53-0.68) correlates with better relevance when semantic matching actually works.

---

## Conclusion

LiBrainian is fundamentally unsuited for "best practices" queries in its current state. The tool excels at finding specific functions or code entities but fails at meta-level questions about conventions, patterns, and project organization.

**Critical Gap**: The system has no way to index or retrieve human-written documentation that describes conventions. All knowledge is derived from code structure, not documentation.

**Recommendation**: Before using LiBrainian for best practices queries, implement documentation indexing and convention pack types. Current workaround: directly read AGENTS.md and README.md files for conventions.
