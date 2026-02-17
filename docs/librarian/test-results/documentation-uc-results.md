# Documentation Use Case Test Results

**Test Date:** 2026-01-31
**LiBrainian Version:** Current (main branch)
**Test Mode:** `--no-synthesis` (LLM disabled)

## Executive Summary

| Query | Found Documentation? | Packs Found | Confidence | Assessment |
|-------|---------------------|-------------|------------|------------|
| API documentation and JSDoc comments | NO | 8 | 0.793 | FAIL |
| README files and getting started guides | NO | 1 | 0.843 | FAIL |
| Code examples and usage examples | NO | 2 | 0.666 | FAIL |
| Changelog and release notes | NO | 4 | 0.637 | FAIL |
| Architecture documentation and design docs | PARTIAL | 10 | 0.567 | PARTIAL |

**Overall Assessment: POOR** - The LiBrainian consistently fails to surface actual documentation files. Instead, it returns function contexts from source code that are tangentially related to the query terms.

---

## Detailed Results

### Query 1: "API documentation and JSDoc comments"

**Result:** FAIL - No actual documentation found

**Latency:** 1519ms | **Packs Found:** 8 | **Confidence:** 0.793

**What was returned:**
- `parseJsonFromLlm` - JSON parsing function (technique_execution.ts)
- `getToolJsonSchema` - Tool schema getter (mcp/schema.ts)
- `runDocTests` - Documentation testing function (developer_experience.ts)
- `getDescriptionForPattern` - Pattern description helper (security_audit_helper.ts)
- `tokenize` - Code tokenization function (code_clone_analysis.ts)
- `getRemediationForPattern` - Pattern remediation helper (security_audit_helper.ts)
- `parseSemanticResponse` - Semantic parsing function (semantics.ts)
- `buildSemanticPrompt` - Prompt building function (semantics.ts)

**Assessment:**
- None of these results are actual API documentation or JSDoc comments
- The system returned functions that have "JSON", "doc", or "schema" in their names
- This is a **semantic mismatch** - the query asked for documentation *about* APIs, not functions that *use* JSON
- `runDocTests` is the closest match conceptually but is still code, not documentation

**Expected Results:**
- README.md files
- JSDoc comments from source files
- API reference documentation
- Type definition documentation

---

### Query 2: "README files and getting started guides"

**Result:** FAIL - No README or guides found

**Latency:** 3045ms | **Packs Found:** 1 | **Confidence:** 0.843

**What was returned:**
- `createWorldClassDocsConfig` - Configuration creation function (developer_experience.ts)

**Assessment:**
- Returned a single function that creates documentation config
- **No actual README files** were surfaced
- **No getting started guides** were found
- The repository likely has README.md files that were not indexed or not prioritized

**Expected Results:**
- README.md
- CONTRIBUTING.md
- docs/getting-started.md or similar
- Installation/setup guides

---

### Query 3: "Code examples and usage examples"

**Result:** FAIL - No examples found

**Latency:** 1186ms | **Packs Found:** 2 | **Confidence:** 0.666

**What was returned:**
- `getDescriptionForPattern` - Pattern description helper (security_audit_helper.ts)
- `getRemediationForPattern` - Pattern remediation helper (security_audit_helper.ts)

**Assessment:**
- Neither result is an example
- Both are helper functions for security audit patterns
- The `examples/` directory exists (per git status) but was not surfaced
- **Very low relevance** to the query

**Expected Results:**
- Files from examples/ directory
- Code snippets showing API usage
- Test files demonstrating usage patterns

---

### Query 4: "Changelog and release notes"

**Result:** FAIL - No changelogs found

**Latency:** 3354ms | **Packs Found:** 4 | **Confidence:** 0.637

**What was returned:**
- `releaseStaleClaimsInternal` - Issue registry function (issue_registry.ts)
- `updateIntentionStatus` - Status update function (conative_attitudes.ts)
- `validateQualityGatesPreset` - Validation function (work_presets.ts)
- `computeSmoothECE` - Calibration computation (calibration.ts)

**Assessment:**
- No CHANGELOG.md or release notes found
- Results are completely irrelevant to the query
- `releaseStaleClaimsInternal` was matched due to "release" keyword - semantic mismatch
- The system clearly lacks understanding of documentation artifacts

**Expected Results:**
- CHANGELOG.md
- RELEASES.md
- Git tags/release documentation
- Version history files

---

### Query 5: "Architecture documentation and design docs"

**Result:** PARTIAL - Architecture-related code found, but not documentation

**Latency:** 3114ms | **Packs Found:** 10 | **Confidence:** 0.567

**What was returned:**
- `templatesForUc` - Template registry function
- `getConstructionTemplate` - Template getter
- `createArchitectureValidationConstruction` - Architecture validation constructor
- `createArchitectureDecisionsConstruction` - Architecture decisions constructor
- `generatePatternRecommendations` - Pattern recommendation generator
- `getStandard` - Default constraints getter
- `createConstructionTemplateRegistry` - Registry factory
- `cloneRelationship` - Relationship cloning utility
- `createDXConfig` - DX configuration creator
- `requireAll` - Parallel builder method

**Assessment:**
- **Best result of the five queries** - found architecture-related code
- Several functions deal with architecture concepts (validation, decisions, constraints)
- However, still **no actual documentation files**
- The `docs/` directory contains architecture documentation that wasn't surfaced
- Meta-query detection worked: "boosted documentation in ranking"

**Expected Results:**
- docs/architecture*.md files
- ARCHITECTURE.md
- Design decision records (ADRs)
- System design documentation

---

## Analysis

### Root Causes

1. **Documentation Files Not Indexed**
   - The system appears to primarily index function contexts from source code
   - Markdown files (*.md) may not be properly indexed or weighted
   - The `docs/` directory content is not being surfaced

2. **Semantic Mismatch**
   - Queries about documentation are being matched to code containing similar keywords
   - "API documentation" matches functions that use "JSON" or "doc" in names
   - "release notes" matches `releaseStaleClaimsInternal` due to "release" keyword

3. **Missing Document Type Understanding**
   - The system doesn't distinguish between "documentation about X" and "code that does X"
   - No special handling for documentation-specific queries

4. **Index Content Bias**
   - 474 specialized domains defined, but documentation-specific domains may be missing
   - Function contexts dominate results even for documentation queries

### Recommendations

1. **Add Document Type Indexing**
   - Index markdown files with higher priority for documentation queries
   - Create specific document types: README, CHANGELOG, ARCHITECTURE, EXAMPLES

2. **Improve Query Intent Detection**
   - Detect when users are asking for documentation vs. code
   - The "Meta-query detected: boosted documentation in ranking" shows intent detection exists but isn't effective

3. **Index the docs/ and examples/ Directories**
   - Ensure markdown files in docs/ are indexed
   - Index example files from examples/ directory

4. **Add Documentation-Specific Domains**
   - Create domains for: API_DOCS, README, CHANGELOG, EXAMPLES, ARCHITECTURE_DOCS
   - Weight these domains higher for documentation-related queries

5. **Semantic Understanding Improvement**
   - "API documentation" should not match "parseJsonFromLlm"
   - Need better understanding of documentation artifacts vs. code artifacts

---

## Test Environment

```
Platform: darwin (Darwin 24.6.0)
Working Directory: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian
Git Branch: main
Embedding Model: all-MiniLM-L6-v2
Domains Defined: 474
```

## Files in Repository That Should Have Been Found

Per git status, the repository contains:
- `docs/USABILITY_ANALYSIS.md`
- `docs/construction-patterns.md`
- `docs/LiBrainian/` (multiple .md files)
- `docs/research/` directory
- `examples/` directory
- `AGENTS.md`

None of these were surfaced in any of the documentation queries.
