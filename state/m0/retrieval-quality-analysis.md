# M0 Retrieval Quality Root Cause Analysis

**Date**: 2026-02-27
**Status**: Retrieval quality is POOR. M0 proof artifact was false-positive due to loose test criteria.

## Executive Summary

Two files -- `work_presets_construction.ts` and `result_coherence.ts` -- appear in ALL THREE query result sets regardless of query intent. The M0 proof test passed with `all_passed: true` because its relevance checks used broad substring matching (e.g., `"query"` matched `computeQueryAlignment` in `result_coherence.ts`). True retrieval quality is significantly below the bar for M0.

## Root Cause Analysis

### Root Cause 1: Meta-Query Classification Casts Too Wide a Net

**Location**: `src/api/query_intent_patterns.ts` lines 5-21, `src/api/query.ts` lines 599-669

All three proof queries match `META_QUERY_PATTERNS`:
- "how does the query pipeline work" matches `/\bhow\s+(should|do|does|can|to)\b/i` and `/\bhow\s+.*\s+(use|integrate|work|configure)\b/i`
- "how does bootstrap indexing work" matches the same patterns
- "how does embedding and vector search work" matches the same patterns

When classified as meta-queries:
1. `entityTypes` includes `'document'` in the similarity search, broadening the candidate pool
2. The similarity threshold is lowered: `minSimilarity * 0.9`
3. The ranking task type is set to `'guidance'`

These are actually **implementation questions** (how does code X work?), not meta/documentation questions (how do I use X?). The pattern `/\bhow\s+(should|do|does|can|to)\b/i` is far too broad.

### Root Cause 2: Guidance Task Type Massively Boosts Documentation Packs

**Location**: `src/api/packs.ts` lines 63-76

The `guidance` task type applies these pack weights:
```
function_context: 0.4   (60% penalty)
module_context:   0.6   (40% penalty)
doc_context:      2.0   (100% boost)
project_understanding: 2.5 (150% boost)
```

This means that for any meta-classified query, a mediocre `doc_context` or `module_context` pack with broad keywords will rank ABOVE a highly-relevant `function_context` pack for `src/api/query.ts`.

### Root Cause 3: Generic Content in Over-Ranked Files Creates Broad Embedding Matches

**File**: `src/constructions/strategic/work_presets_construction.ts`

This file is a quality-gate assessment construction. Its indexed content includes broad, generic terms:
- "quality", "assessment", "confidence", "analysis", "work", "testing", "coverage", "gates"
- Its function `computeConfidence` uses a name that semantically overlaps with many query domains
- Its `buildContent()` representation includes: purpose ("assess work quality"), signature, exports -- all generic enough to have moderate cosine similarity with almost any code-related query

**File**: `src/epistemics/result_coherence.ts`

This file is specifically about query result coherence analysis. Its content includes:
- "query", "alignment", "coherence", "results", "confidence", "retrieval", "embedding", "similarity"
- Its function `computeQueryAlignment` contains the word "query" which false-matched the old test
- It is semantically related to ALL queries because it literally talks about query result quality

Both files have a very high term overlap with the vocabulary used in "how does X work" queries about a code intelligence system, because they are meta-level modules that describe the system's own quality assessment and retrieval quality.

### Root Cause 4: Hotspot and Domain Signals Favor Recently-Changed, Broadly-Connected Files

**Location**: `src/query/multi_signal_scorer.ts` lines 571-657

The `hotspot` signal (weight 0.08) favors files with high churn and complexity. Both files were recently added/modified as part of the epistemics and constructions systems, giving them elevated churn scores.

The `domain` signal (weight 0.06) uses indexed `mainConcepts` from file knowledge. Files whose concepts are "query", "confidence", "coherence", "analysis" will match the domain terms extracted from queries about how the system works.

### Root Cause 5: No Redundancy/Dominance Guard in Pack Selection

**Location**: `src/api/query.ts` lines 1694-1708, `src/api/packs.ts` lines 261-295

The `rankContextPacks` function deduplicates by `packId` but has no mechanism to detect when the same file appears across multiple queries. There is no per-file dominance cap or diversity enforcement that would prevent a single broadly-matching file from appearing in every query.

### Root Cause 6: False Pass in Test Due to Loose Substring Matching

**Location**: `src/__tests__/m0_self_development_proof.test.ts` lines 40-56, 192-194

The proof queries used these `expectFiles`:
- `['query.ts', 'query']` -- "query" matches `result_coherence.ts:computeQueryAlignment` (false positive)
- `['bootstrap.ts', 'bootstrap']` -- worked correctly (bootstrap.ts was returned)
- `['embedding', 'vector', 'hnsw']` -- "vector" matched `doctor.ts:checkVectorIndex` (false positive)

The test's relevance check `files.some(f => f.toLowerCase().includes(expected.toLowerCase()))` is too loose.

## Evidence Summary

| Query | Expected Top Files | Actually Returned | Correct? |
|-------|-------------------|-------------------|----------|
| "how does the query pipeline work" | `src/api/query.ts`, `src/cli/commands/query.ts` | `work_presets_construction.ts`, `evidence_adapters.ts`, `result_coherence.ts`, `real_embeddings.ts`, `code_patterns.ts` | NO |
| "how does bootstrap indexing work" | `src/api/bootstrap.ts` | `work_presets_construction.ts`, `bootstrap.ts`, `result_coherence.ts` | PARTIAL (bootstrap.ts present but not top-ranked) |
| "how does embedding and vector search work" | `real_embeddings.ts`, `unified_embedding_pipeline.ts`, `vector_index.ts` | `work_presets_construction.ts`, `doctor.ts:checkVectorIndex`, `result_coherence.ts` | NO |

## What Would Need to Change in the Pipeline

### Short-Term Fixes (to pass honest M0)

1. **Narrow meta-query classification**: "how does X work" where X is a code concept should be classified as a CODE query, not a META query. Only "how do I use X" or "what is X for" should be meta.

2. **Add a dominance guard**: If a file appears in more than N% of recent queries, decay its score. This prevents files with generic embeddings from dominating all results.

3. **Keyword boost should be stronger**: When the query says "query pipeline" and a file is literally named `query.ts`, the keyword filename-exact boost (1.5x via `computeKeywordBoost`) is insufficient to overcome the guidance task type's 0.4x penalty on `function_context` packs.

### Medium-Term Fixes (to reach good retrieval quality)

4. **Intent-aware entity type routing**: "how does the query pipeline work" should route primarily to `function` and `module` entities in `src/api/query.ts` and `src/query/`, not to documentation or constructions.

5. **MMR (Maximal Marginal Relevance) diversity**: Apply post-retrieval diversification to ensure result sets don't cluster on the same files. The `applyMmrDiversification` function exists in `src/api/query_mmr_utils.ts` but may not be active in all code paths.

6. **Per-file deduplication in pack collection**: `collectCandidatePacks` should enforce a maximum number of packs from the same source file (e.g., max 2 packs from the same `.ts` file across all candidates).

7. **Embedding re-indexing**: Re-index with a model that better distinguishes between "code that does X" and "code that talks about X" (e.g., fine-tuned code retrieval model vs. general sentence transformer).
