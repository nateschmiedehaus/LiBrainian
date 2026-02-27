# Listing Use Case Test Results

**Date:** 2026-01-31
**Test Type:** LISTING queries with `--no-synthesis`

## Executive Summary

The LiBrainian's listing query capability shows **significant limitations** for exhaustive enumeration use cases. The system is optimized for semantic similarity search, not for complete enumeration of codebase artifacts.

| Query | Expected Items | Items Returned | Completeness | Grade |
|-------|---------------|----------------|--------------|-------|
| List all CLI commands | 23 commands | 4 functions | ~17% | FAIL |
| List all exported functions from api module | ~150+ exports | 10 functions | <7% | FAIL |
| List all test files | 417 test files | 10 functions | <2.4% | FAIL |
| List all TypeScript interfaces | Many hundreds | 7 functions | <1% | FAIL |
| List all configuration options | Unknown (many) | 9 functions | Incomplete | FAIL |

**Overall Assessment:** The LiBrainian does NOT provide complete lists for enumeration queries. Instead, it returns semantically related function contexts that may help *find* list-related functionality, but not the lists themselves.

---

## Detailed Results

### Query 1: "list all CLI commands"

**Ground Truth:**
- 23 CLI command files exist in `src/cli/commands/`:
  - `analyze_change.ts`, `analyze.ts`, `bootstrap.ts`, `check_providers.ts`, `compose.ts`
  - `confidence.ts`, `config_heal.ts`, `contract.ts`, `coverage.ts`, `debug.ts`
  - `diagnose.ts`, `eval.ts`, `evolve.ts`, `heal.ts`, `health.ts`
  - `index.ts`, `inspect.ts`, `query.ts`, `replay.ts`, `status.ts`
  - `validate.ts`, `visualize.ts`, `watch.ts`

**LiBrainian Response:**
- **Confidence:** 0.753
- **Packs Found:** 4
- **Results:**
  1. `showHelp` function in `help.ts` (signature: `showHelp(command?: string): void`)
  2. `runDebugCommand` function in `debug.ts`
  3. `getCommandRunner` function in `hypothesis_tester.ts`
  4. `getCommandRunner` function in `problem_detector.ts`

**Analysis:**
- The query returned functions *related to* commands, not the actual list of commands
- Only 1 of 4 results was directly in the CLI commands folder
- The system interpreted "CLI commands" semantically rather than as an enumeration request
- **Completeness: ~17%** (4 items vs 23 actual commands, and the 4 are helper functions, not the command list)

---

### Query 2: "list all exported functions from api module"

**Ground Truth:**
- The `src/api/index.ts` file exports ~150+ items including:
  - Functions: `createLibrarian`, `cosineSimilarity`, `redactText`, `compileLCL`, `queryLibrarian`, etc.
  - Classes: `LiBrainian`, `EmbeddingService`, `TechniqueExecutionEngine`, etc.
  - Types: 100+ type exports

**LiBrainian Response:**
- **Confidence:** 0.805
- **Packs Found:** 10
- **Results:**
  1. `buildModulePack` in `packs.ts` - creates module_context packs with exports
  2. `buildModuleSummaryInput` in `packs.ts` - formats module metadata
  3. `buildFunctionPack` in `packs.ts` - creates function_context packs
  4. `extractUsageContent` in `multi_vector_representations.ts`
  5. `getTechniquePackage` in `technique_packages.ts`
  6. `isOneStepAway` in `graph_augmented_similarity.ts`
  7. `extractModule` in `index_librarian.ts`
  8. `buildModuleEmbeddingInput` in `index_librarian.ts`
  9. `analyzeT13UsageAnalysis` in `t_patterns.ts`
  10. `exportJson` in `issue_registry.ts`

**Analysis:**
- None of the returned functions are actually the exported API functions
- Results are functions that *work with* exports/modules, not the exports themselves
- The system returned meta-functions about export handling rather than enumerating exports
- **Completeness: <7%** (0 actual API exports listed, only related helper functions)

---

### Query 3: "list all test files"

**Ground Truth:**
- **417 test files** exist in the codebase (files matching `*.test.ts`)

**LiBrainian Response:**
- **Confidence:** 0.525 (lowest of all queries)
- **Packs Found:** 10
- **Results:**
  1. `getFiles` in `bootstrap_tests.test.ts` - a test helper
  2. `getFileCategory` in `universal_patterns.ts` - categorizes files
  3. `findUntestedSourceFiles` in `t_patterns.ts` - finds untested sources
  4. `analyzeT17TestGaps` in `t_patterns.ts` - identifies test coverage gaps
  5. `findTestedFunctions` in `tdd_engine.ts` - finds tested functions
  6. `discoverTests` in `tdd_engine.ts` - discovers tests
  7. `analyzeTestConsistency` in `analyze_consistency.ts`
  8. `runCoverageAnalysis` in `self_improvement_report.ts`
  9. `propagateRisk` in `hybrid_analysis.ts`
  10. `analyzeDependents` in `architecture.ts`

**Analysis:**
- The system returned functions that *analyze* or *work with* test files
- No actual enumeration of the 417 test files was provided
- Notably, only 1 result was an actual test file, and it was a helper function within it
- **Completeness: <2.4%** (0 of 417 test files listed)

---

### Query 4: "list all TypeScript interfaces"

**Ground Truth:**
- The codebase contains hundreds of TypeScript interfaces across all modules
- Just `src/api/index.ts` exports 100+ type definitions

**LiBrainian Response:**
- **Confidence:** 0.563
- **Packs Found:** 7
- **Results:**
  1. `filterEdgesByType` in `argument_edges.ts`
  2. `get` in `operator_registry.ts` - retrieves operator by type
  3. `getAll` in `operator_registry.ts` - returns all operators
  4. `isExtendedAttitudeType` in `conative_attitudes.ts` - type guard
  5. `getArgumentEdges` in `types.ts` - filters argument edges
  6. `isArgumentEntityType` in `types.ts` - type guard
  7. `getOperatorSemantics` in `technique_semantics.ts`

**Analysis:**
- The system returned functions that work with *types* (type guards, type-related utilities)
- No actual TypeScript interface definitions were listed
- The semantic model associated "TypeScript interfaces" with type-related code, not interface definitions
- **Completeness: <1%** (0 interfaces listed)

---

### Query 5: "list all configuration options"

**Ground Truth:**
- Configuration options spread across multiple files:
  - `src/config/index.ts` - main config
  - Various `*Config` interfaces and types
  - Environment variables, preset configurations

**LiBrainian Response:**
- **Confidence:** 0.704
- **Packs Found:** 9
- **Results:**
  1. `getDefaultPresets` in `preset_storage.ts` - returns preset configurations
  2. `resolveConsolidationSettings` in `learning_loop.ts` - merges config options
  3. `getConfigId` in `developer_experience_construction.ts`
  4. `createRetryConfig` in `advanced_engineering.ts` - creates retry config
  5. `createDXConfig` in `developer_experience.ts` - creates DX config
  6. `createProfileConfig` in `advanced_engineering.ts`
  7. `createStarterConfig` in `building_blocks.ts`
  8. `calculateAntifragilityScore` in `antifragility.ts`
  9. `calculateReputationFromQuality` in `antifragility.ts`

**Analysis:**
- Results are functions that *create* or *work with* configurations
- No actual enumeration of configuration options was provided
- Some results (like antifragility score calculations) are not directly config-related
- **Completeness: Incomplete** (returned config-related functions, not config options)

---

## Root Cause Analysis

### Why Listing Queries Fail

1. **Semantic vs. Structural Mismatch**
   - The LiBrainian uses semantic embeddings optimized for "what code does this relate to?"
   - Listing queries require structural traversal: "enumerate all items of type X"

2. **Pack-Based Architecture**
   - Results are `function_context` packs describing individual functions
   - No `list_pack` or `enumeration_pack` type exists for aggregate results

3. **No Exhaustive Enumeration Mode**
   - The query system applies relevance scoring and returns top-K results
   - There's no mode for exhaustive enumeration of matching items

4. **Index Design**
   - The index stores function/module/file knowledge optimized for retrieval
   - No dedicated indexes for "all files of type X" or "all exports from module Y"

---

## Recommendations

### For Users

1. **Use CLI tools directly for enumeration:**
   ```bash
   # List all CLI commands
   ls src/cli/commands/*.ts

   # List all test files
   find src -name "*.test.ts"

   # List all TypeScript interfaces
   grep -r "^export interface" src/
   ```

2. **Rephrase queries for semantic search:**
   - Instead of: "list all CLI commands"
   - Use: "how does the CLI command system work?"

### For LiBrainian Development

1. **Add Intent Classification for Enumeration**
   - Detect "list all X" queries and route to exhaustive search
   - Use glob patterns or AST queries for structural enumeration

2. **Create Dedicated List Endpoints**
   - `LiBrainian list --type=commands`
   - `LiBrainian list --type=interfaces`
   - `LiBrainian list --type=tests`

3. **Enhance Response for List Queries**
   - When enumeration intent detected, warn that semantic search may not be exhaustive
   - Suggest CLI alternatives for complete lists

4. **Index Enhancement**
   - Build inverted indexes by entity type (interface, class, function, test, config)
   - Enable exhaustive queries: "give me ALL items of type X"

---

## Test Metrics Summary

| Metric | Value |
|--------|-------|
| Queries Executed | 5 |
| Queries Returning Complete Lists | 0 |
| Average Confidence | 0.670 |
| Average Latency | 1.8s |
| Overall Completeness | <10% |

**Conclusion:** The LiBrainian in its current form is **not suitable for exhaustive listing queries**. It excels at semantic similarity search but fails to provide complete enumerations. Users needing comprehensive lists should use traditional CLI tools or file system queries.
