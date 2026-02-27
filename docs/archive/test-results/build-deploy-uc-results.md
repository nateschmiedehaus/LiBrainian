# BUILD/DEPLOY Use Case Test Results

**Date:** 2026-01-31
**Test Type:** Query accuracy for build and deployment infrastructure discovery

## Summary

| Query | Packs Found | Confidence | Found Build/Deploy Infrastructure? |
|-------|-------------|------------|-----------------------------------|
| build scripts and build configuration | 8 | 0.779 | NO |
| CI/CD pipeline and GitHub actions | 7 | 0.782 | NO |
| deployment configuration and Docker | 6 | 0.910 | NO |
| npm scripts and package scripts | 10 | 0.534 | PARTIAL |
| release process and versioning | 3 | 0.593 | PARTIAL |

**Overall Assessment: POOR** - LiBrainian failed to surface actual build/deploy infrastructure files.

---

## Actual Build/Deploy Infrastructure in Repository

### 1. GitHub Actions Workflow
**File:** `.github/workflows/eval.yml`
- CI pipeline for evaluation corpus
- Runs on push and pull_request
- Uses Node.js 20, npm ci, runs `npm run eval:ci`

### 2. Package.json Scripts (Build/Deploy Related)
**File:** `package.json`
```json
{
  "scripts": {
    "build": "tsc && npm run copy-assets",
    "copy-assets": "mkdir -p dist/migrations && cp -r src/migrations/*.sql dist/migrations/",
    "build:watch": "tsc --watch",
    "clean": "rm -rf dist",
    "lint": "eslint src/ --ext .ts",
    "lint:fix": "eslint src/ --ext .ts --fix",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run clean && npm run build && npm test",
    "release": "npm run build && npm publish --access public"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  }
}
```

### 3. TypeScript Configuration
**File:** `tsconfig.json`
- Target: ES2022
- Module: NodeNext
- Output: `./dist`
- Strict mode enabled

### 4. Test Configuration
**File:** `vitest.config.ts`
- Test runner configuration

### 5. Build Scripts
**Directory:** `scripts/`
- `check-file-sizes.mjs` - File size linting
- `eval-corpus.ts` - Evaluation corpus runner
- `check_librarian_extraction_prereqs.mjs` - Prerequisites checker

---

## Query-by-Query Analysis

### Query 1: "build scripts and build configuration"

**Results Returned:**
1. `buildModule()` in engine_feedback.test.ts - TEST HELPER, NOT BUILD CONFIG
2. `buildContextPack()` in engine_feedback.test.ts - TEST HELPER, NOT BUILD CONFIG
3. `createStarterConfig()` in building_blocks.ts - APP CONFIG, NOT BUILD CONFIG
4. `buildModularizationPrompt()` in modularization_hooks.ts - PROMPT BUILDER, NOT BUILD
5. `createProfileConfig()` in advanced_engineering.ts - APP CONFIG, NOT BUILD
6. `getConfigId()` in developer_experience_construction.ts - APP CONFIG, NOT BUILD
7. `generateOnboardingChecklist()` in developer_experience.ts - UNRELATED
8. `getStandard()` in developer_experience_construction.ts - UNRELATED

**Expected Files NOT Found:**
- `package.json` (contains build scripts)
- `tsconfig.json` (TypeScript build configuration)
- `scripts/check-file-sizes.mjs` (build-related script)

**Assessment:** FAIL - Matched "build" keyword in function names but completely missed actual build infrastructure.

---

### Query 2: "CI/CD pipeline and GitHub actions"

**Results Returned:**
1. `initialize()` in unified_embedding_pipeline.ts - EMBEDDING PIPELINE, NOT CI/CD
2. `getCurrentGitSha()` in git.ts - GIT UTILITY, NOT CI/CD CONFIG
3. `normalizeRemoteUrl()` in registry.ts - FEDERATION CODE, NOT CI/CD
4. `getCurrentBranch()` in git.ts - GIT UTILITY, NOT CI/CD CONFIG
5. `isGitRepo()` in git.ts - GIT UTILITY, NOT CI/CD CONFIG
6. `showHelp()` in help.ts - COMPLETELY UNRELATED
7. `printPreflightReport()` in checks.ts - UNRELATED

**Expected Files NOT Found:**
- `.github/workflows/eval.yml` (THE ACTUAL CI/CD WORKFLOW)

**Assessment:** FAIL - Completely missed the GitHub Actions workflow file. Matched "pipeline" to embedding pipeline instead of CI pipeline.

---

### Query 3: "deployment configuration and Docker"

**Results Returned:**
1. `buildQueryEpisode()` in query_episodes.ts - UNRELATED
2. `setCachedQuery()` in query.ts - UNRELATED
3. `createQueryInterface()` in query_interface.ts - UNRELATED
4. `executeDeltaMap()` in delta_map_template.ts - UNRELATED
5. `parseSynthesisResponse()` in query_synthesis.ts - UNRELATED
6. `parseYamlDocument()` in infra_map_template.ts - PARTIALLY RELATED (YAML parsing)

**Note:** Query fell back to general packs - "No semantic matches above similarity threshold (0.35)"

**Expected Files NOT Found:**
- No Dockerfile exists in this repo (correctly nothing to find)
- However, `package.json` publish config is deployment-related

**Assessment:** FAIL - Fell back to completely unrelated general packs.

---

### Query 4: "npm scripts and package scripts"

**Results Returned:**
1. `detectPackageManager()` in supply_chain_template.ts - RELEVANT (detects npm/yarn/pnpm)
2. `buildImpactSummaryInput()` in packs.ts - UNRELATED
3. `buildModuleSummaryInput()` in packs.ts - UNRELATED
4. `generateSBOM()` in supply_chain_template.ts - PARTIALLY RELEVANT (npm dependencies)
5. `buildCliEnv()` in llm_provider_discovery.ts - MARGINALLY RELEVANT (CLI env)
6. `customizePrediction()` in fix_generator.ts - UNRELATED
7. `createOutdatedDependencyDetector()` in technical_debt.ts - RELEVANT (npm dependencies)
8. `classifyFileType()` in staleness.ts - UNRELATED
9. `detectScriptType()` in loader.ts - MARGINALLY RELEVANT (script detection)
10. `createSandboxedContext()` in probe_executor.ts - UNRELATED

**Expected Files NOT Found:**
- `package.json` (THE PRIMARY SOURCE of npm scripts!)

**Assessment:** PARTIAL - Found some npm-related utilities but missed package.json itself.

---

### Query 5: "release process and versioning"

**Results Returned:**
1. `isVersionCompatible()` in versioning.ts - RELEVANT (version checking)
2. `validateQualityGatesPreset()` in work_presets.ts - MARGINALLY RELEVANT
3. `computeSmoothECE()` in calibration.ts - UNRELATED

**Expected Files NOT Found:**
- `package.json` (contains "release" script and version number)
- `.github/workflows/eval.yml` (part of release quality gates)

**Assessment:** PARTIAL - Found versioning utility but missed release configuration.

---

## Root Cause Analysis

### 1. Configuration Files Not Indexed
The LiBrainian appears to not index or properly weight:
- `package.json`
- `tsconfig.json`
- `.yml`/`.yaml` files (GitHub Actions)
- Root-level configuration files

### 2. Keyword Matching Issues
- "build" matched function names containing "build" rather than build infrastructure
- "pipeline" matched "embedding pipeline" instead of "CI pipeline"
- "configuration" matched internal app config, not build/deploy config

### 3. Missing Domain Knowledge
The LiBrainian lacks understanding that:
- Build/deploy queries should prioritize root config files
- `package.json` is the primary source for npm scripts
- `.github/workflows/` contains CI/CD definitions

### 4. File Type Awareness
No apparent weighting for:
- Configuration file extensions (`.json`, `.yml`, `.yaml`)
- Standard infrastructure locations (`.github/`, root configs)

---

## Recommendations

### High Priority
1. **Index configuration files** - Ensure `package.json`, `tsconfig.json`, and YAML files are indexed
2. **Add domain-specific file patterns** - When query mentions "CI/CD", prioritize `.github/workflows/`
3. **Improve keyword disambiguation** - "build scripts" should favor `package.json` over functions with "build" in the name

### Medium Priority
4. **Add file path relevance signals** - Root-level configs should score higher for infrastructure queries
5. **Create build/deploy domain pack** - Pre-built pack for common infrastructure discovery

### Low Priority
6. **Consider static config file indexing** - Special handling for known config file types

---

## Test Execution Notes

- Several queries encountered lock file contention due to concurrent processes
- Exit codes 1, 13, and 144 observed due to storage locks
- Average query latency: ~1.5 seconds when successful
- Query "deployment configuration and Docker" fell back to general packs due to no semantic matches
