# TEAM/OWNERSHIP Use Case Test Results

**Date**: 2026-01-31
**Test Environment**: macOS Darwin 24.6.0
**LiBrainian Version**: Current main branch

## Summary

| Query | Found Ownership Info | Confidence | Semantic Match |
|-------|---------------------|------------|----------------|
| "code owners and maintainers" | PARTIAL | 0.757 | Yes |
| "who wrote this code and git blame" | YES | 0.807 | Yes |
| "team responsibilities" | NO | 0.529 | No (fallback) |
| "contributor guidelines" | NO | 0.529 | No (fallback) |
| "approval process" | NO | 0.529 | No (fallback) |

**Overall Assessment**: MIXED - LiBrainian performs well on code-level ownership (git blame, CODEOWNERS parsing) but fails to find process-level ownership documentation (CONTRIBUTING.md, team responsibilities).

---

## Detailed Results

### Query 1: "code owners and maintainers"

**Status**: PARTIAL SUCCESS

**Results**:
- Confidence: 0.757
- Packs Found: 3
- Latency: 1859ms

**Key Finding**: Found `buildOwnerMap` function in `team_indexer.ts`:
```
Function buildOwnerMap in team_indexer.ts
Signature: buildOwnerMap(entries: CodeownerEntry[]): Record<string, string[]>
Lines: 37-46
File: src/ingest/team_indexer.ts
```

**Analysis**:
- Found code that HANDLES ownership (the indexer), not actual ownership DATA
- Did not find the actual CODEOWNERS files in the repo
- Did not find CONTRIBUTING.md which has maintainer info
- The system found implementation code rather than ownership documentation

---

### Query 2: "who wrote this code and git blame"

**Status**: SUCCESS

**Results**:
- Confidence: 0.807 (highest)
- Packs Found: 10
- Latency: 2683ms

**Key Findings**:
1. `blameFile` function (0.852 confidence):
   ```
   Run git blame on a single file and parse the output.
   Signature: blameFile(workspace: string, filePath: string, timeoutMs: number = 30000): Promise<BlameChunk[]>
   File: src/ingest/blame_indexer.ts
   ```

2. `parseBlameLineHeader` function (0.859 confidence):
   ```
   Parse a single line of `git blame --line-porcelain` output.
   File: src/ingest/blame_indexer.ts
   ```

3. `getBlame` utility (0.767 confidence):
   ```
   Signature: getBlame(dir: string, filePath: string): Map<number, string>
   File: src/utils/git.ts
   ```

**Analysis**:
- Excellent coverage of git blame functionality
- Found both high-level API and low-level parsing functions
- Multiple related git utilities surfaced (getCurrentGitSha, hasUncommittedChanges, etc.)
- This query worked well because the codebase has explicit git/blame indexing code

---

### Query 3: "team responsibilities"

**Status**: FAILED

**Results**:
- Confidence: 0.529 (low)
- Packs Found: 6 (fallback packs)
- Latency: 1926ms
- **Coverage Gap**: "No semantic matches above similarity threshold (0.35)"

**Key Findings**:
- Fell back to general packs (unrelated functions like `buildQueryEpisode`, `setCachedQuery`)
- Did not find CONTRIBUTING.md which describes contributor responsibilities
- Did not find any team-related documentation

**Analysis**:
- The phrase "team responsibilities" has low semantic overlap with indexed content
- The system lacks knowledge of CONTRIBUTING.md content
- No team/organizational documentation appears to be indexed

---

### Query 4: "contributor guidelines"

**Status**: FAILED

**Results**:
- Confidence: 0.529 (low)
- Packs Found: 6 (fallback packs)
- Latency: 2629ms
- **Coverage Gap**: "No semantic matches above similarity threshold (0.35)"

**Key Findings**:
- Same fallback packs as "team responsibilities"
- CONTRIBUTING.md exists at `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/CONTRIBUTING.md`
- Contains 337 lines of detailed contributor guidelines
- **NOT INDEXED** despite being a key project file

**Analysis**:
- Critical documentation file (CONTRIBUTING.md) not found in semantic search
- Either not indexed or indexed with poor embeddings
- This is a significant gap for project onboarding queries

---

### Query 5: "approval process"

**Status**: FAILED

**Results**:
- Confidence: 0.529 (low)
- Packs Found: 6 (fallback packs)
- Latency: 1037ms
- **Coverage Gap**: "No semantic matches above similarity threshold (0.35)"

**Key Findings**:
- Same fallback behavior
- CONTRIBUTING.md contains PR approval process information
- `.github/pull_request_template.md` exists but not found

**Analysis**:
- Process documentation not accessible via semantic search
- GitHub templates and workflows not surfaced

---

## Files That Should Have Been Found

The following files exist in the repository but were not returned for ownership queries:

| File | Content Type | Expected For Query |
|------|--------------|-------------------|
| `CONTRIBUTING.md` | Contributor guidelines, PR process | All queries |
| `.github/pull_request_template.md` | PR checklist, approval process | "approval process" |
| `.github/ISSUE_TEMPLATE/` | Issue guidelines | "contributor guidelines" |
| `test/fixtures/librarian_usecase/.github/CODEOWNERS` | Example CODEOWNERS | "code owners" |

---

## Root Cause Analysis

### Why Git Blame Queries Worked

1. The codebase has explicit `blame_indexer.ts` and `git.ts` files with:
   - Function names containing "blame" keywords
   - Detailed JSDoc comments describing git operations
   - Clear semantic meaning in function signatures

2. High token density around git/blame concepts made embedding matches strong

### Why Process/Documentation Queries Failed

1. **Documentation Not Indexed as First-Class Content**:
   - CONTRIBUTING.md and other markdown files may be excluded from indexing
   - Or indexed but embeddings don't capture "team" / "contributor" semantics well

2. **Semantic Gap**:
   - "team responsibilities" doesn't match any code constructs
   - No indexed knowledge relates organizational concepts to files

3. **No CODEOWNERS Parsing for Project**:
   - While `team_indexer.ts` exists to PARSE CODEOWNERS, the actual project lacks a root CODEOWNERS file
   - The indexer found its own code, not ownership data

---

## Recommendations

### High Priority

1. **Index Documentation Files**: Ensure markdown files (CONTRIBUTING.md, README.md) are indexed with proper semantic embeddings

2. **Create Project CODEOWNERS**: Add `.github/CODEOWNERS` to define actual code ownership

3. **Improve Domain Support for "Team/Ownership"**: Add specialized domain handlers that:
   - Recognize ownership-related queries
   - Look in standard locations (CONTRIBUTING.md, CODEOWNERS, MAINTAINERS)
   - Surface team/organizational documentation

### Medium Priority

4. **Add GitHub Metadata Indexing**: Index `.github/` directory contents for process queries

5. **Expand Query Synonyms**: Map "contributor guidelines" -> CONTRIBUTING.md, "code owners" -> CODEOWNERS

### Low Priority

6. **Add Ownership Knowledge Layer**: Create a dedicated ownership graph that tracks:
   - File -> Team mappings from CODEOWNERS
   - Contributor statistics from git history
   - Reviewer patterns from PR history

---

## Technical Notes

### Lock File Issues

Multiple queries failed due to storage lock contention (`ESTORAGE_LOCKED`). This suggests:
- Database lock timeout may be too aggressive
- Parallel queries not properly serialized
- Lock file cleanup on process crash may be incomplete

### Fallback Behavior

When semantic search fails (similarity < 0.35), the system falls back to "general packs" which are:
- High-confidence but unrelated functions
- Not useful for the actual query intent
- May confuse users expecting relevant results

A better fallback might be:
- Return empty with clear "no matches" message
- Suggest alternative queries
- Point to documentation locations

---

## Conclusion

LiBrainian's TEAM/OWNERSHIP use case support is **partially implemented**:

- **Code-level ownership**: Works well (git blame, CODEOWNERS parsing code)
- **Process-level ownership**: Not working (contributor guidelines, team responsibilities)

The gap is primarily due to documentation files not being semantically indexed or matched. This is fixable by:
1. Ensuring docs are indexed
2. Adding ownership-specific query handling
3. Expanding semantic matching for organizational concepts
