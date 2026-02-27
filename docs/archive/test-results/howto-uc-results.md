# HOW-TO Query Use Case Test Results

**Test Date:** 2026-01-31
**Test Type:** HOW-TO / Procedural Guidance Queries
**Mode:** `--no-synthesis` (raw context pack retrieval)

---

## Summary

| Query | Packs Found | Confidence | Actionable? | Assessment |
|-------|-------------|------------|-------------|------------|
| How to add a new CLI command | 8 | 0.783 | Partial | Related functions found, but no step-by-step guidance |
| How to write tests | 10 | 0.559 | Partial | Testing-related code found, but no tutorial-style content |
| How to extend storage | 7 | 0.648 | Partial | Storage API functions found, no extension guide |
| How to add a knowledge extractor | 10 | 0.667 | Partial | Extractor code found, no creation walkthrough |
| How to contribute to this project | 6 | 0.529 | No | Unrelated functions returned, fell back to general packs |

**Overall Assessment:** The LiBrainian does NOT provide actionable how-to guidance. It returns semantically-related code fragments rather than procedural instructions.

---

## Detailed Results

### Query 1: "how to add a new CLI command"

**Latency:** 1349ms | **Confidence:** 0.783 | **Packs:** 8

**Context Packs Returned:**
1. `showHelp` in `help.ts` (lines 622-631) - Shows help for commands
2. `setupVerifiedCli` in test file - CLI setup for tests
3. `buildCliEnv` in `llm_provider_discovery.ts` - Environment for subprocess
4. `setCommandRunner` in `hypothesis_tester.ts` - Command runner injection
5. `setCommandRunner` in `fix_verifier.ts` - Command runner injection
6. `setCommandRunner` in `problem_detector.ts` - Command runner injection
7. `getCommandRunner` in `hypothesis_tester.ts` - Get command runner
8. `createFullModeConfig` in `full_mode.ts` - Bootstrap config creation

**Actionability Assessment:**
- **Missing:** No reference to the actual CLI command registration pattern
- **Missing:** No pointer to `src/cli/commands/` directory structure
- **Missing:** No example of how existing commands like `bootstrap.ts` or `query.ts` are structured
- **Verdict:** User would not know WHERE to create the file or WHAT pattern to follow

**Related Files Not Found:**
- `/src/cli/commands/bootstrap.ts` - Example CLI command
- `/src/cli/commands/query.ts` - Example CLI command
- `/src/cli/index.ts` - Command registration point

---

### Query 2: "how to write tests"

**Latency:** 6768ms | **Confidence:** 0.559 | **Packs:** 10

**Context Packs Returned:**
1. `testHypothesis` in `hypothesis_tester.ts` - Hypothesis testing agent
2. `determineVerdict` in `hypothesis_tester.ts` - Test result verdict logic
3. `extractTesting` in `testing_extractor.ts` - Testing knowledge extraction
4. `createTestingStrategyConstruction` - Testing strategy creation
5. `determineOriginalTestCommand` in `fix_verifier.ts` - Test command determination
6. `getTestStrategiesForProblemType` in `benchmark_evolver.ts` - Test strategies
7. `markTested` in `hypothesis_generator.ts` - Mark hypothesis as tested
8. `detectTestabilityIssues` in `code_quality_reporter.ts` - Code quality checks
9. `evaluateResult` in `probe_executor.ts` - Probe result evaluation
10. `computeGuidance` in `tdd_engine.ts` - TDD guidance computation

**Actionability Assessment:**
- **Missing:** No reference to test framework (Vitest/Jest) configuration
- **Missing:** No example test file structure
- **Missing:** No reference to `npm test` or test run command
- **Missing:** No pointer to `src/**/__tests__/` directory pattern
- **Verdict:** Returns INTERNAL test-related code, not GUIDANCE on writing tests

**Key Gap:** The results are about the LiBrainian's own testing infrastructure concepts, NOT about how a developer would write a new test file for this project.

---

### Query 3: "how to extend storage"

**Latency:** 1071ms (cache hit) | **Confidence:** 0.648 | **Packs:** 7

**Context Packs Returned:**
1. `createStorageFromBackend` in `sqlite_storage.ts` - Creates storage instance
2. `purgeOldData` in `versioning.ts` - Deletes old storage data
3. `setStorage` in `self_index_validator.ts` - Dependency injection for storage
4. `getStorageSlices` in `LiBrainian.ts` - Access storage facets
5. `getStorageCapabilities` in `LiBrainian.ts` - Get backend capabilities
6. `consolidate` in `learning_loop.ts` - Prune and promote storage data
7. `storeMultiVectorEmbedding` in `index_librarian.ts` - Store embeddings

**Actionability Assessment:**
- **Partial:** Shows storage API surface area
- **Missing:** No storage interface definition (`LibrarianStorage` type)
- **Missing:** No implementation pattern for new storage backends
- **Missing:** No extension points documented
- **Verdict:** Shows USAGE of storage, not HOW TO EXTEND it

---

### Query 4: "how to add a new knowledge extractor"

**Latency:** 1590ms | **Confidence:** 0.667 | **Packs:** 10

**Context Packs Returned:**
1. `addDefeater` in `evidence_collector.ts` - Add defeater to knowledge
2. `findAlternativeAnalysisMethods` in `zero_knowledge_bootstrap.ts` - Analysis methods
3. `createLearningSystem` in `knowledge_management.ts` - Learning system creation
4. `createKnowledgeManagementConstruction` - Knowledge management construction
5. `extractSubgraph` in `knowledge_graph.ts` - Extract graph subgraph
6. `inferenceLevel` in `zero_knowledge_bootstrap.ts` - Map source to level
7. `extractSemantics` in `semantics.ts` - Extract semantic info
8. `triggerDefeater` in `evidence_collector.ts` - Mark defeaters
9. `suggestNextSteps` in `zero_knowledge_bootstrap.ts` - Analysis suggestions
10. `mergeKnowledge` in `zero_knowledge_bootstrap.ts` - Merge knowledge states

**Actionability Assessment:**
- **Partial:** Shows existing extractor pattern (`extractSemantics`)
- **Missing:** No reference to `/src/knowledge/extractors/` directory
- **Missing:** No extractor interface or base class
- **Missing:** No registration mechanism for new extractors
- **Verdict:** Shows scattered extractor-adjacent code, not creation pattern

**Key Files Not Found:**
- `/src/knowledge/extractors/index.ts` - Extractor registration
- Example extractors showing the pattern

---

### Query 5: "how to contribute to this project"

**Latency:** 1936ms | **Confidence:** 0.529 | **Packs:** 6

**Context Packs Returned:**
1. `buildQueryEpisode` in `query_episodes.ts` - Query context capture
2. `setCachedQuery` in `query.ts` - Cache tier storage
3. `createQueryInterface` in `query_interface.ts` - Query interface factory
4. `executeDeltaMap` in `delta_map_template.ts` - Git diff template execution
5. `parseSynthesisResponse` in `query_synthesis.ts` - LLM response parsing
6. `parseYamlDocument` in `infra_map_template.ts` - YAML parsing

**Actionability Assessment:**
- **Failure:** Completely unrelated results
- **Note:** "Fell back to general packs (semantic match unavailable)"
- **Missing:** No CONTRIBUTING.md or contributor guidelines
- **Missing:** No development setup instructions
- **Missing:** No PR/issue workflow guidance
- **Verdict:** TOTAL FAILURE for this use case

**Root Cause:** No contribution-related documentation or patterns indexed.

---

## Analysis

### Why HOW-TO Queries Fail

1. **Code-Centric Indexing:** The LiBrainian indexes code entities (functions, modules) but lacks:
   - Procedural documentation
   - Tutorial content
   - Step-by-step guides
   - README/CONTRIBUTING files

2. **Semantic Similarity Gap:** "How to add X" queries match code that DOES X, not code that EXPLAINS how to add X.

3. **No Pattern Recognition:** The system doesn't identify:
   - Directory structure patterns (`src/cli/commands/*.ts`)
   - Registration patterns (how commands/extractors/etc. are wired up)
   - Example file templates

4. **Missing Meta-Knowledge:** The LiBrainian lacks:
   - Project structure documentation
   - Development workflow documentation
   - Extension point documentation

### Recommendations

1. **Index Documentation Files:** Ingest README.md, CONTRIBUTING.md, and markdown docs as first-class entities.

2. **Pattern Documentation Packs:** Create special packs for:
   - "How to add a CLI command" -> point to existing command files + registration
   - "How to add an extractor" -> point to extractor directory + interface

3. **Directory Structure Awareness:** Surface project structure for meta-queries about adding new components.

4. **Fallback to LLM Synthesis:** For HOW-TO queries, the LLM synthesis mode should:
   - Recognize the procedural intent
   - Locate example files
   - Generate step-by-step instructions

5. **Query Intent Classification:** Detect "how to" prefix and route to a different retrieval strategy that prioritizes:
   - Documentation over code
   - Examples over implementations
   - Patterns over instances

---

## Conclusion

The LiBrainian currently performs poorly on HOW-TO queries. It treats procedural guidance questions as semantic search for related code, returning implementation details rather than actionable instructions.

**Key Metric:** 0/5 queries returned actionable how-to guidance.

**Partial Credit:** 4/5 queries returned at least some topically relevant code (excludes "how to contribute" which failed completely).

**Required Improvements:**
- Documentation indexing
- Pattern-based retrieval for meta-queries
- Directory structure awareness
- LLM synthesis for procedural query types
