# Dependency Management Use Case Test Results

**Test Date:** 2026-01-31
**LiBrainian Version:** 0.2.0
**Test Type:** Dependency Management Queries

## Executive Summary

LiBrainian demonstrates **weak capability** for dependency management use cases. The tool focuses on **internal code dependencies** (imports between modules) rather than **external package dependencies** (npm packages, third-party libraries). This is a significant gap for developers needing to assess dependency health.

**Overall Assessment: PARTIAL COVERAGE with SIGNIFICANT GAPS**

---

## Test Queries and Results

### Query 1: "external dependencies and third party libraries"

**Latency:** 1.8s | **Confidence:** 0.802 | **Packs Found:** 1

**Results:**
- Only returned 1 pack: `resolveLibrarianProvider()` from `llm_env.ts`
- This function handles LLM provider configuration, not external dependency management

**Assessment:** POOR - Did not identify any actual external dependencies (better-sqlite3, chalk, zod, etc.)

---

### Query 2: "dependency injection patterns"

**Latency:** 990ms | **Confidence:** 0.526 | **Packs Found:** 8

**Results Returned:**
| File | Function | Relevance |
|------|----------|-----------|
| `pattern_catalog.ts` | `createCompositionPattern()` | 0.860 |
| `pattern_catalog.ts` | `freezeCatalog()` | 0.833 |
| `analyze_architecture.ts` | `detectLayerViolations()` | 0.820 |
| `architecture_validation_construction.ts` | `extractDependencies()` | 0.819 |
| `architecture_decisions_construction.ts` | `generatePatternRecommendations()` | 0.810 |
| `self_improvement_report.ts` | `getArchitectureActionAndHints()` | 0.752 |
| `relationships_extractor.ts` | `inferSimilarityReason()` | 0.812 |
| `semantics.ts` | `buildCodeContext()` | 0.752 |

**Assessment:** PARTIAL - Found architectural pattern code but not actual dependency injection implementations. The results relate to "patterns" broadly, not DI specifically.

---

### Query 3: "package versions and version constraints"

**Latency:** 1.2s | **Confidence:** 0.599 | **Packs Found:** 10

**Results Returned:**
| File | Function | Relevance |
|------|----------|-----------|
| `versioning.ts` | `isVersionCompatible()` | 0.846 |
| `versioning.ts` | `upgradeRequired()` | 0.877 |
| `versioning.ts` | `getCurrentVersion()` | 0.817 |
| `packs.ts` | `getCurrentVersion()` | 0.803 |
| `contracts.ts` | `wrapVersioned()` | 0.806 |
| `contracts.ts` | `getSchemaVersion()` | 0.770 |
| `bootstrap.ts` | `getTargetVersion()` | 0.752 |
| `continuous_improvement.ts` | `getLatestVersion()` | 0.752 |
| `technical_debt.ts` | `createOutdatedDependencyDetector()` | 0.785 |
| `architecture_decisions.ts` | `createTradeoffAnalysis()` | 0.830 |

**Assessment:** PARTIAL - Found internal versioning code but these are for LiBrainian's own version tracking, NOT npm package version constraints. However, `createOutdatedDependencyDetector()` is relevant.

---

### Query 4: "transitive dependencies and dependency tree"

**Note:** Initial query triggered exhaustive mode error. Reworded to "dependency tree structure".

**Latency:** 1.4s | **Confidence:** 0.562 | **Packs Found:** 10

**Results Returned:**
| File | Function | Relevance |
|------|----------|-----------|
| `plan_compiler.ts` | `buildHierarchy()` | 0.861 |
| `plan_compiler.ts` | `enrichWorkHierarchy()` | 0.863 |
| `plan_compiler.ts` | `applyTechniqueRelationships()` | 0.851 |
| `plan_compiler.ts` | `addDependency()` | 0.832 |
| `tree_sitter_parser.ts` | `extractClasses()` | 0.801 |
| `tree_sitter_parser.ts` | `extractFunctions()` | 0.793 |
| `tree_sitter_parser.ts` | `findFirstNamedChild()` | 0.752 |
| `architecture_advisor.ts` | `createCycleRecommendation()` | 0.752 |
| `architecture_decisions_construction.ts` | `generatePatternRecommendations()` | 0.810 |
| `t_patterns.ts` | `analyzeT04DependencyGraph()` | 0.801 |

**Assessment:** POOR - Results focus on work hierarchy planning and AST parsing, not npm dependency trees. The `analyzeT04DependencyGraph()` is for internal import graphs.

---

### Query 5: "deprecated dependencies or outdated packages"

**Latency:** 1.1s | **Confidence:** 0.621 | **Packs Found:** 3

**Results Returned:**
| File | Function | Relevance |
|------|----------|-----------|
| `technical_debt.ts` | `createOutdatedDependencyDetector()` | 0.785 |
| `workflow_validation_construction.ts` | `recordOutcome()` | 0.812 |
| `composition.ts` | `requireAny()` | 0.755 |

**Assessment:** POOR - Only 1 of 3 results is relevant. `createOutdatedDependencyDetector()` is the only meaningful result.

---

### Supplementary Query: "npm packages used in this project"

**Latency:** 1.1s | **Confidence:** 0.498 | **Packs Found:** 6

**Coherence Warning:** Results flagged as "scattered/incoherent" (40%)

**Key Results:**
- `detectPackageManager()` - detects npm/yarn/pnpm
- `generateSBOM()` - generates Software Bill of Materials
- `createOutdatedDependencyDetector()` - detects outdated deps

**Assessment:** PARTIAL - Found some supply chain tooling but did not return actual package usage.

---

### Supplementary Query: "imports from better-sqlite3 or xenova or ts-morph"

**Latency:** 1.1s | **Confidence:** 0.606 | **Packs Found:** 2

**Results:**
- `createSqliteStorage()` - uses better-sqlite3
- `upsertModule()` - sqlite storage function

**Assessment:** POOR - Only found 2 results when these libraries are imported in many files.

---

## Assessment Questions

### 1. Did it identify dependencies correctly?

**Answer: NO - Major Gap**

LiBrainian does NOT index or understand:
- `package.json` dependencies, devDependencies, peerDependencies
- npm/yarn/pnpm lock files
- Import statements from external packages
- Which files use which external dependencies

**What it found instead:**
- Internal code that happens to have "dependency" or "version" in function names
- LiBrainian's own internal versioning system
- Work hierarchy dependencies in the plan compiler

### 2. Could you assess dependency health?

**Answer: LIMITED**

**What LiBrainian CAN help with:**
- Internal module coupling via `analyzeT04DependencyGraph()`
- Architectural layer violations via `detectLayerViolations()`
- Supply chain awareness exists via `generateSBOM()` and `detectPackageManager()`
- Outdated dependency detection concept exists in `createOutdatedDependencyDetector()`

**What LiBrainian CANNOT do:**
- List actual npm dependencies and their versions
- Identify which external packages are imported where
- Detect deprecated npm packages
- Analyze dependency security vulnerabilities
- Show transitive dependency chains
- Compare installed vs. latest versions

### 3. What was missed?

**Critical Gaps:**

1. **package.json is not indexed** - The primary source of dependency information is ignored
2. **No npm registry awareness** - Cannot check for outdated/deprecated packages
3. **External imports not tracked** - `import X from 'better-sqlite3'` is not queryable
4. **Lock files ignored** - package-lock.json, yarn.lock, pnpm-lock.yaml not parsed
5. **No CVE/security database** - Cannot identify vulnerable dependencies
6. **Version constraint semantics** - Does not understand semver ranges (`^`, `~`, `>=`)

**Actual Project Dependencies Not Found:**

From `package.json`, LiBrainian failed to identify:
- `@xenova/transformers` - AI embeddings
- `better-sqlite3` - Database
- `chalk` - Terminal colors
- `commander` - CLI framework
- `ts-morph` - TypeScript AST
- `zod` - Schema validation
- And 15+ other dependencies

---

## Recommendations for Improvement

### High Priority

1. **Index package.json** - Parse dependencies, devDependencies, peerDependencies with version constraints
2. **Track external imports** - Record which files import from which npm packages
3. **Add npm registry queries** - Check for outdated/deprecated packages

### Medium Priority

4. **Parse lock files** - Understand actual installed versions vs. ranges
5. **Build dependency graph for externals** - Show which external packages depend on each other
6. **Security scanning** - Integrate with npm audit or Snyk data

### Lower Priority

7. **Semver analysis** - Understand version constraint compatibility
8. **SBOM generation** - Make the existing `generateSBOM()` actually work with real data
9. **Bundle size analysis** - Track dependency size impact

---

## Conclusion

LiBrainian is **not suitable** for dependency management use cases in its current form. It excels at understanding internal code structure but lacks any meaningful capability to:
- Identify what external packages a project uses
- Assess the health or currency of those dependencies
- Track where external packages are imported

**Score: 2/10** for Dependency Management capability

The presence of `supply_chain_template.ts` and `technical_debt.ts` suggest this was planned but never fully implemented with real npm ecosystem integration.
