# LiBrainian Implementation Plan: Fix Wiring + Reduce Redundancy

Status: active
Created: 2026-01-15
Updated: 2026-01-15 (Post-Codebase Review)
Owner: engineering
Priority: P0 (blocks reliable operation)

## Executive Summary

The LiBrainian has **broken wiring** and **redundant code paths**. This plan:

1. **FIXES the governor context chain** - tokens actually tracked
2. **WIRES the feedback loop** - existing code becomes functional
3. **CONSOLIDATES 3 LLM calls → 1** per entity - reduces token burn AND code
4. **DELETES dead code** - functions that only throw errors, unused exports

### What Gets Fixed (Incomplete Code)

| Component | Problem | Fix |
|-----------|---------|-----|
| `extractSemanticsWithLLM()` | No governor passed | Add governor param |
| `extractSecurityWithLLM()` | No governor passed | Add governor param |
| `extractRationaleWithLLM()` | No governor passed | Add governor param |
| `file_extractor.ts` | No LLM evidence | Add `buildLlmEvidence()` call |
| `directory_extractor.ts` | No LLM evidence | Add `buildLlmEvidence()` call |
| `processAgentFeedback()` | Zero callers | Wire to query flow |
| `generator.ts` | No governor in config | Add governor field |

### What Gets Deleted (Actually Dead Code)

| Code | Lines | Reason |
|------|-------|--------|
| `extractSemantics()` in semantics.ts | ~15 | Only throws error |
| `extractRationale()` in rationale_extractor.ts | ~10 | Only throws error |
| `PatternKnowledge.query()` deprecated path | ~20 | Marked deprecated, throws |
| Duplicate LLM call logic after consolidation | ~200 | Redundant with unified extractor |
| Unpersisted type fields in universal_types.ts | ~100 | Define fields that are never stored |

### What Gets Consolidated (Redundant Code)

3 separate LLM extractors each have:
- Their own prompt building
- Their own LLM call
- Their own response parsing
- Their own evidence recording

**After:** 1 unified extractor that:
- Builds ONE prompt for semantics + security + rationale
- Makes ONE LLM call
- Parses structured response
- Records unified evidence

**Net result:** ~400 fewer lines, 66% fewer LLM calls per entity

### What Stays (Good Code)

| Component | Lines | Reason |
|-----------|-------|--------|
| `extractSecurity()` static analysis | ~400 | CWE detection, threat modeling - no LLM needed |
| `extractRationaleSignals()` heuristics | ~300 | ADR/commit extraction - useful preprocessing |
| `extractQuality()` | ~200 | Complexity metrics - no LLM needed |
| `extractTesting()` | ~400 | Test coverage analysis - no LLM needed |
| All of `agent_feedback.ts` | 352 | Good code, just needs callers |

### Critical Issues

1. **Governor Context Never Passed** - All token tracking broken
2. **LLM Evidence Missing from File/Directory** - Violates mandate
3. **Feedback Loop Disconnected** - Types exist, zero callers
4. **Query Synthesis Ungoverned** - Main LLM calls untracked

**Root Cause:** Zero extractors pass `governorContext` to `LLMService.chat()`.

---

## Part 1: Verified Root Causes (From Code Review)

### 1.1 Token Consumption - Actual LLM Call Sites

| File | Function | Line | maxTokens | Evidence | Governor |
|------|----------|------|-----------|----------|----------|
| `semantics.ts` | `extractSemanticsWithLLM()` | 72 | 1500 | **YES** | **NO** |
| `security_extractor.ts` | `extractSecurityWithLLM()` | 919 | 1000 | **YES** | **NO** |
| `rationale_extractor.ts` | `extractRationaleWithLLM()` | 761 | 1000 | **YES** | **NO** |
| `file_extractor.ts` | `extractFileSemantics()` | 412 | 300 | **NO** | **NO** |
| `directory_extractor.ts` | `extractDirectorySemantics()` | 376 | 250 | **NO** | **NO** |
| `query_synthesis.ts` | `synthesizeQueryAnswer()` | 110 | 2000 | **NO** | **NO** |
| `query_synthesis.ts` | JSON repair call | 128 | 1200 | **NO** | **NO** |

**Critical Finding:** Governor context exists in bootstrap phases but is **NEVER PASSED** through the call chain:
```
runKnowledgeGeneration() → NO governor param
  → createKnowledgeGenerator() → NO governor in config
    → generateForFunction() → NO governor
      → extractSemanticsWithLLM() → NO governorContext to chat()
```

### 1.2 Verified Token Estimates (Per Full Bootstrap)

For a 1000-file project with ~500 functions:

| Phase | Operation | Tokens/Call | Calls | Total | Tracked? |
|-------|-----------|-------------|-------|-------|----------|
| structural_scan | File semantics | ~900 | 1000 | 900K | NO |
| structural_scan | Directory semantics | ~750 | 100 | 75K | NO |
| semantic_indexing | Embeddings | N/A | batched | ~50K | YES |
| knowledge_generation | Semantics | ~2300 | 500 | 1.15M | NO |
| knowledge_generation | Security | ~1600 | 500 | 800K | NO |
| knowledge_generation | Rationale | ~3000 | 300 | 900K | NO |
| context_pack_generation | Pack summaries | ~2000 | 500 | 1M | NO |
| query (per query) | Synthesis | ~3200 | per query | varies | NO |
| **TOTAL (Bootstrap)** | | | | **~4.9M** | **1% tracked** |

### 1.3 Root Cause Summary (Confirmed)

#### RC-1: Governor Context Not Propagated (CRITICAL)
**Verified Locations:**
- `bootstrap.ts:runKnowledgeGeneration()` (line 1341-1360) - NO governor param passed
- `generator.ts:KnowledgeGeneratorConfig` - NO governor field defined
- All 5 extractors - NO governorContext in chat() calls

**Impact:** Token budget limits are completely ineffective. Default config has all limits at 0 (unlimited), but even if set, they wouldn't trigger because tokens aren't recorded.

#### RC-2: No LLM Evidence in File/Directory Extractors (CRITICAL)
**Verified:**
- `file_extractor.ts` calls LLM (line 412) but never calls `buildLlmEvidence()`
- `directory_extractor.ts` calls LLM (line 376) but never calls `buildLlmEvidence()`
- Both return `{ purpose, summary, confidence: 0.85 }` with NO `llmEvidence` field

**Evidence Collector Behavior:**
- `semantics.ts` → evidence recorded (line 65)
- `security_extractor.ts` → evidence recorded (line 913)
- `rationale_extractor.ts` → evidence recorded (line 755)
- `file_extractor.ts` → NO evidence recorded
- `directory_extractor.ts` → NO evidence recorded

#### RC-3: Feedback Loop Disconnected (CRITICAL)
**Verified:**
- `processAgentFeedback()` exists in `agent_feedback.ts` (line 100-172)
- **ZERO callers** in entire codebase
- Query returns packs but no `queryId` propagated for feedback correlation
- `storage.recordContextPackAccess()` called without outcome parameter (line 299 in query.ts)

#### RC-4: Storage Schema Gaps
**Verified Missing from Persistence:**

| Field | Type Definition | DB Column | Status |
|-------|----------------|-----------|--------|
| `meta.llmEvidence` | universal_types.ts:1120 | NONE | **NOT PERSISTED** |
| `meta.defeaters[]` | universal_types.ts:1128 | NONE | **NOT PERSISTED** |
| `meta.generatedBy` | universal_types.ts:1117 | NONE | **NOT PERSISTED** |
| `meta.lastValidated` | universal_types.ts:1119 | NONE | **NOT PERSISTED** |
| `uncertainty.aleatoric` | universal_types.ts:1150 | NONE | **NOT PERSISTED** |
| `uncertainty.epistemic` | universal_types.ts:1151 | NONE | **NOT PERSISTED** |
| `rawConfidence` | types.ts:189 | NONE | **NOT PERSISTED** |
| `calibratedConfidence` | types.ts:190 | NONE | **NOT PERSISTED** |
| Evidence `type` | types.ts:EvidenceType | NONE | **NOT IN SCHEMA** |
| Evidence `source` | types.ts:Evidence | NONE | **NOT IN SCHEMA** |

#### RC-5: Resumability Gaps
**Verified Phase-Level Issues:**

| Phase | Resumability | Issue |
|-------|-------------|-------|
| structural_scan | POOR | No per-file checkpoint; restarts from scratch |
| semantic_indexing | PARTIAL | SwarmRunner checkpoint in-memory; lost on exit |
| relationship_mapping | NONE | Non-transactional writes; inconsistent on failure |
| context_pack_generation | NONE | All-or-nothing; no per-pack tracking |
| knowledge_generation | NONE | No entity-level state; full restart on resume |

---

## Part 2: Priority-Ordered Fixes

### P0-1: Wire Governor Context Through Entire Chain (CRITICAL)

**Goal:** Enable token tracking and budget enforcement

**Changes Required:**

1. **Add governor to KnowledgeGeneratorConfig:**
```typescript
// src/LiBrainian/knowledge/generator.ts
export interface KnowledgeGeneratorConfig {
  // ... existing fields ...
  governor?: GovernorContext;  // ADD THIS
}
```

2. **Pass governor from bootstrap to generator:**
```typescript
// src/LiBrainian/api/bootstrap.ts:runKnowledgeGeneration()
const generator = createKnowledgeGenerator({
  storage,
  workspace: phaseConfig.workspace,
  llmProvider: phaseConfig.llmProvider,
  llmModelId: phaseConfig.llmModelId,
  skipLlm: false,
  governor: governor,  // ADD THIS - get from runBootstrapPhase()
  onEvent: (event) => { void globalEventBus.emit(event); },
});
```

3. **Thread governor through generator to extractors:**
```typescript
// src/LiBrainian/knowledge/generator.ts:generateForFunction()
const semanticsResult = await extractSemanticsWithLLM(semanticsInput, {
  llmProvider: this.config.llmProvider,
  llmModelId: this.config.llmModelId,
  governor: this.config.governor,  // ADD THIS
});
```

4. **Add governor to extractor configs:**
```typescript
// src/LiBrainian/knowledge/extractors/semantics.ts
export interface LLMSemanticsConfig {
  llmProvider: 'claude' | 'codex';
  llmModelId?: string;
  governor?: GovernorContext;  // ADD THIS
}

// In extractSemanticsWithLLM():
const response = await llmService.chat({
  provider: config.llmProvider,
  modelId,
  messages,
  maxTokens: 1500,
  governorContext: config.governor,  // ADD THIS
});
```

5. **Repeat for security, rationale, file, directory extractors**

**Evidence Gate:** `governor.tokensUsed > 0` after knowledge_generation phase

---

### P0-2: Add LLM Evidence to File/Directory Extractors (CRITICAL)

**Goal:** Compliance with understanding mandate

**Changes Required:**

```typescript
// src/LiBrainian/knowledge/extractors/file_extractor.ts:extractFileSemantics()
import { buildLlmEvidence } from './llm_evidence.js';

// Before LLM call (line ~405):
const llmEvidence = await buildLlmEvidence({
  provider: config.llmProvider || 'claude',
  modelId,
  messages,
});

// After LLM call, in return (line ~430):
return {
  file: {
    purpose: parsed.purpose || `File: ${name}`,
    summary: parsed.summary || `Source file at ${relativePath}`,
  },
  confidence: 0.85,
  llmEvidence,  // ADD THIS
};
```

Same pattern for `directory_extractor.ts:extractDirectorySemantics()`

**Evidence Gate:** All file/directory records have `llmEvidence` field populated

---

### P0-3: Wire Feedback Loop (CRITICAL)

**Goal:** Enable learning from query outcomes

**Changes Required:**

1. **Add queryId to synthesis response:**
```typescript
// src/LiBrainian/api/query_synthesis.ts
export interface SynthesisResult {
  // ... existing fields ...
  queryId: string;  // ADD for feedback correlation
}
```

2. **Pass outcome to recordContextPackAccess:**
```typescript
// src/LiBrainian/api/query.ts (line 299)
// BEFORE:
await storage.recordContextPackAccess(pack.packId);
// AFTER:
// Don't record at query time; record when feedback received
```

3. **Create feedback endpoint:**
```typescript
// src/LiBrainian/api/feedback.ts (NEW FILE)
import { processAgentFeedback, createTaskOutcomeFeedback } from '../integration/agent_feedback.js';

export async function recordQueryFeedback(
  storage: LibrarianStorage,
  queryId: string,
  packIds: string[],
  outcome: 'success' | 'failure' | 'partial',
  agentId?: string
): Promise<void> {
  const feedback = createTaskOutcomeFeedback(queryId, packIds, outcome, agentId);
  await processAgentFeedback(feedback, storage);

  // Record access with outcome
  for (const packId of packIds) {
    await storage.recordContextPackAccess(packId, outcome);
  }
}
```

4. **Add CLI command for feedback:**
```typescript
// src/LiBrainian/cli/commands/feedback.ts
export async function feedbackCommand(args: FeedbackArgs): Promise<void> {
  await recordQueryFeedback(storage, args.queryId, args.packIds, args.outcome);
}
```

**Evidence Gate:** `processAgentFeedback()` has call sites; pack confidence changes over time

---

### P0-4: Consolidate Entity Extraction (3 LLM Calls → 1)

**Goal:** Keep static analysis, consolidate only the LLM calls

**What stays:**
- `extractSecurity()` - static CWE/OWASP detection (no LLM)
- `extractRationaleSignals()` - heuristic extraction from ADRs/commits (no LLM)
- All type definitions and interfaces

**What gets consolidated:**
- `extractSemanticsWithLLM()` - semantics via LLM
- `extractSecurityWithLLM()` - security enhancement via LLM
- `extractRationaleWithLLM()` - rationale via LLM

**Implementation:**
```typescript
// NEW: src/LiBrainian/knowledge/extractors/unified_extractor.ts
// ~250 lines, replaces ~600 lines of redundant LLM logic across 3 files

import { extractSecurity } from './security_extractor.js';
import { extractRationaleSignals } from './rationale_extractor.js';

export async function extractUnifiedKnowledge(
  input: CodeEntity,
  config: { llmProvider: string; llmModelId?: string; governor?: GovernorContext }
): Promise<UnifiedExtractionResult> {
  // 1. Run static analysis first (no LLM, keeps existing good code)
  const staticSecurity = extractSecurity(input);
  const heuristicRationale = await extractRationaleSignals(input);

  // 2. Build unified prompt with static results as context
  const prompt = buildUnifiedPrompt(input, staticSecurity, heuristicRationale);

  const llmEvidence = await buildLlmEvidence({
    provider: config.llmProvider,
    modelId: config.llmModelId || 'claude-haiku-4-5-20241022',
    messages: [{ role: 'user', content: prompt }],
  });

  // 3. ONE LLM call for all semantic understanding
  const response = await llmService.chat({
    provider: config.llmProvider,
    modelId: config.llmModelId,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2000,
    governorContext: config.governor,
  });

  // 4. Merge static analysis with LLM insights
  return parseAndMerge(response.content, staticSecurity, heuristicRationale, llmEvidence);
}
```

**Update generator.ts:**
```typescript
// src/LiBrainian/knowledge/generator.ts:generateForFunction()

// BEFORE: 3 separate LLM calls
const semantics = await extractSemanticsWithLLM(...);
const security = await extractSecurityWithLLM(...);  // calls static + LLM
const rationale = await extractRationaleWithLLM(...); // calls heuristic + LLM

// AFTER: 1 unified call (static/heuristic run inside)
const { semantics, security, rationale, llmEvidence } = await extractUnifiedKnowledge(entity, {
  llmProvider: this.config.llmProvider,
  llmModelId: this.config.llmModelId,
  governor: this.config.governor,
});
```

**Delete after consolidation:**
- `extractSemanticsWithLLM()` body → logic moves to unified
- `extractSecurityWithLLM()` body → logic moves to unified (keep `extractSecurity()`)
- `extractRationaleWithLLM()` body → logic moves to unified (keep `extractRationaleSignals()`)
- `extractSemantics()` → only throws error (dead code)
- `extractRationale()` → only throws error (dead code)

**Evidence Gate:**
- LLM call count reduced by 66% (3→1 per entity)
- Static analysis (`extractSecurity`, `extractRationaleSignals`) still runs
- Net code reduction: ~350 lines

---

### P0-5: Enable Strict Token Budget

**Goal:** Enforce limits; fail gracefully when exceeded

**Changes Required:**

1. **Set non-zero defaults:**
```typescript
// src/LiBrainian/api/governors.ts
export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  maxTokensPerFile: 5000,           // Was 0 (unlimited)
  maxTokensPerPhase: 500_000,       // Was 0 (unlimited)
  maxTokensPerRun: 2_000_000,       // Was 0 (unlimited)
  maxFilesPerPhase: 0,              // Keep unlimited
  maxWallTimeMs: 0,                 // Keep unlimited (timeout is separate)
  maxRetries: 3,                    // Was 0 (unlimited)
  maxConcurrentWorkers: 4,
  maxEmbeddingsPerBatch: 10,
};
```

2. **Check budget before each extraction:**
```typescript
// src/LiBrainian/knowledge/generator.ts:generateForFunction()
if (this.config.governor) {
  const check = this.config.governor.checkBudget();
  if (!check.allowed) {
    return { status: 'skipped', reason: 'budget_exhausted' };
  }
}
```

3. **Track partial results:**
```typescript
// When budget exhausted, return partial knowledge with unverified marker
const result: UniversalKnowledge = {
  ...partialKnowledge,
  meta: {
    ...meta,
    confidence: { overall: 0, bySection: {}, uncertainty: 1 },
    generatedBy: 'budget_exhausted_partial',
  },
};
```

**Evidence Gate:** Bootstrap stops cleanly when budget reached; partial results usable

---

### P1-1: Batch Processing (Built Into Unified Extractor)

**Goal:** Reduce API calls by batching entities

Instead of a separate file, add batching directly to `unified_extractor.ts`:

```typescript
// In src/LiBrainian/knowledge/extractors/unified_extractor.ts

const BATCH_SIZE = 5;

export async function extractUnifiedBatch(
  entities: CodeEntity[],
  config: ExtractorConfig
): Promise<UnifiedExtractionResult[]> {
  // Run static analysis on all entities first (no LLM)
  const staticResults = entities.map(e => ({
    entity: e,
    security: extractSecurity(e),
    rationale: await extractRationaleSignals(e),
  }));

  // Batch LLM calls
  const batches = chunk(staticResults, BATCH_SIZE);
  const results: UnifiedExtractionResult[] = [];

  for (const batch of batches) {
    if (config.governor?.isBudgetExhausted()) {
      // Mark remaining as unverified (no new LLM call)
      results.push(...batch.map(b => createUnverifiedResult(b, 'budget_exhausted')));
      continue;
    }

    const batchPrompt = buildBatchPrompt(batch);
    const response = await llmService.chat({
      provider: config.llmProvider,
      modelId: config.llmModelId,
      messages: [{ role: 'user', content: batchPrompt }],
      maxTokens: 3000,
      governorContext: config.governor,
    });

    results.push(...parseBatchResponse(response.content, batch));
  }

  return results;
}
```

**No new file** - this is part of unified_extractor.ts

---

### P1-2: Priority-Based Processing (Enhance Generator)

**Goal:** Process important entities first when budget-constrained

Instead of a separate prioritizer file, add to generator.ts:

```typescript
// In src/LiBrainian/knowledge/generator.ts

function prioritizeEntities(
  entities: CodeEntity[],
  graphMetrics: GraphMetrics
): CodeEntity[] {
  return entities
    .map(entity => ({
      entity,
      score: (graphMetrics.pageRank[entity.id] ?? 0) * 0.4 +
             (entity.isExported ? 0.3 : 0) +
             (entity.name === 'index' || entity.name === 'main' ? 0.2 : 0) +
             (isRecentlyModified(entity) ? 0.1 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map(p => p.entity);
}

// In generateAll():
async generateAll(): Promise<GenerationResult> {
  const functions = await this.storage.getFunctions();
  const graphMetrics = await this.storage.getGraphMetrics();

  // Process high-priority first
  const prioritized = prioritizeEntities(functions, graphMetrics);

  for (const fn of prioritized) {
    if (this.config.governor?.isBudgetExhausted()) {
      // Stop processing, return partial results
      break;
    }
    await this.generateForFunction(fn);
  }
}
```

**No new file** - this is ~30 lines added to generator.ts

---

### P1-3: Persist LLM Evidence in Storage Schema

**Goal:** Store evidence for audit/reproducibility

```sql
-- NEW MIGRATION: src/LiBrainian/storage/migrations/002_llm_evidence.sql

ALTER TABLE librarian_universal_knowledge ADD COLUMN llm_evidence TEXT;
-- JSON: { semantics: {...}, security: {...}, rationale: {...} }

ALTER TABLE librarian_files ADD COLUMN llm_evidence TEXT;
ALTER TABLE librarian_directories ADD COLUMN llm_evidence TEXT;

CREATE INDEX idx_uk_llm_provider ON librarian_universal_knowledge(
  json_extract(llm_evidence, '$.semantics.provider')
);
```

**Update storage types:**
```typescript
// src/LiBrainian/storage/types.ts
export interface StoredUniversalKnowledge {
  // ... existing fields ...
  llm_evidence?: string;  // JSON serialized LLM evidence by section
}
```

**Evidence Gate:** `SELECT COUNT(*) FROM librarian_universal_knowledge WHERE llm_evidence IS NOT NULL` > 0

---

### P1-4: Fix Query Synthesis Token Tracking

**Goal:** Track query-time LLM consumption

```typescript
// src/LiBrainian/api/query.ts

// Pass governor to synthesis
const synthesis = await synthesizeQueryAnswer(
  query.intent,
  finalPacks,
  {
    llmProvider,
    llmModelId,
    governor: governorContext,  // ADD THIS
  }
);

// src/LiBrainian/api/query_synthesis.ts:synthesizeQueryAnswer()
export async function synthesizeQueryAnswer(
  intent: string,
  packs: ContextPack[],
  config: { llmProvider: string; llmModelId?: string; governor?: GovernorContext }
): Promise<SynthesisResult> {
  const response = await llmService.chat({
    provider: config.llmProvider,
    modelId: config.llmModelId,
    messages,
    maxTokens: 2000,
    governorContext: config.governor,  // ADD THIS
  });
  // ...
}
```

**Evidence Gate:** Query governor shows tokens used after synthesis

---

### P2-1: Per-File Checkpointing in structural_scan

**Goal:** Enable resume from mid-phase

```typescript
// src/LiBrainian/api/bootstrap.ts

interface FileCheckpoint {
  processedFiles: Map<string, string>;  // path → checksum
  lastFile: string;
  timestamp: string;
}

async function runFileKnowledgeWithCheckpoint(
  files: string[],
  config: BootstrapConfig,
  storage: LibrarianStorage
): Promise<void> {
  const checkpoint = await loadFileCheckpoint(config.workspace);
  const startIndex = checkpoint ? files.indexOf(checkpoint.lastFile) + 1 : 0;

  for (let i = startIndex; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);

    // Process batch...

    // Save checkpoint after each batch
    await saveFileCheckpoint(config.workspace, {
      processedFiles: new Map(batch.map(f => [f, getChecksum(f)])),
      lastFile: batch[batch.length - 1],
      timestamp: new Date().toISOString(),
    });
  }
}
```

**Evidence Gate:** Interrupted bootstrap resumes from last batch, not from start

---

### P2-2: Lazy Method Pack Loading

**Goal:** Don't preload at bootstrap; load on demand

```typescript
// src/LiBrainian/methods/method_pack_service.ts

export class LazyMethodPackService {
  private cache = new Map<string, MethodPack>();
  private loading = new Map<string, Promise<MethodPack>>();

  async getMethodPack(familyId: string): Promise<MethodPack | null> {
    // Check cache first
    if (this.cache.has(familyId)) {
      return this.cache.get(familyId)!;
    }

    // Check if already loading
    if (this.loading.has(familyId)) {
      return this.loading.get(familyId)!;
    }

    // Load on demand
    const promise = this.loadMethodPack(familyId);
    this.loading.set(familyId, promise);

    try {
      const pack = await promise;
      this.cache.set(familyId, pack);
      return pack;
    } finally {
      this.loading.delete(familyId);
    }
  }
}

// Remove preload from bootstrap
// src/LiBrainian/api/bootstrap.ts
// DELETE: await preloadMethodPacksForBootstrap();
```

**Evidence Gate:** Bootstrap completes without method pack LLM calls

---

## Part 3: Storage Schema Fixes

### Required Schema Changes

```sql
-- Migration: 002_evidence_and_calibration.sql

-- 1. Add LLM evidence columns
ALTER TABLE librarian_universal_knowledge ADD COLUMN llm_evidence TEXT;
ALTER TABLE librarian_files ADD COLUMN llm_evidence TEXT;
ALTER TABLE librarian_directories ADD COLUMN llm_evidence TEXT;

-- 2. Add uncertainty tracking
ALTER TABLE librarian_context_packs ADD COLUMN raw_confidence REAL;
ALTER TABLE librarian_context_packs ADD COLUMN calibrated_confidence REAL;
ALTER TABLE librarian_context_packs ADD COLUMN uncertainty REAL;

-- 3. Add calibration tracking table
CREATE TABLE IF NOT EXISTS librarian_calibration_samples (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  predicted_confidence REAL NOT NULL,
  actual_outcome TEXT NOT NULL,  -- 'success' | 'failure' | 'partial'
  recorded_at TEXT NOT NULL,
  agent_id TEXT
);

CREATE INDEX idx_calibration_query ON librarian_calibration_samples(query_id);
CREATE INDEX idx_calibration_outcome ON librarian_calibration_samples(actual_outcome);

-- 4. Fix evidence table
ALTER TABLE librarian_evidence ADD COLUMN evidence_type TEXT;
ALTER TABLE librarian_evidence ADD COLUMN source TEXT;
ALTER TABLE librarian_evidence ADD COLUMN description TEXT;

-- 5. Add defeaters tracking
CREATE TABLE IF NOT EXISTS librarian_defeaters (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  defeater_kind TEXT NOT NULL,  -- 'stale_data' | 'contradiction' | 'coverage_gap' | 'failure_attribution'
  severity TEXT NOT NULL,       -- 'critical' | 'high' | 'medium' | 'low'
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX idx_defeaters_entity ON librarian_defeaters(entity_id, entity_type);
CREATE INDEX idx_defeaters_active ON librarian_defeaters(active) WHERE active = 1;
```

---

## Part 4: Agent Skills and Documentation

### 4.1 Required Agent Documentation

Create `src/LiBrainian/AGENTS.md`:

```markdown
# LiBrainian Agent Protocol

## Overview
LiBrainian provides semantic codebase understanding for AI agents. This document
defines the protocol for efficient, token-aware interaction.

## Critical: Token Awareness

Bootstrap consumes significant tokens. Before bootstrapping:
1. Check quota: `LiBrainian status --check-quota`
2. Use fast mode for initial bootstrap: `--mode fast`
3. Full mode only when quota available: `--mode full`

## Query Protocol

### Optimal Usage
1. Specify clear intent: "How does authentication work?" not "auth"
2. Start with L1 depth (default)
3. Escalate to L2/L3 only if L1 insufficient
4. Always provide feedback after using results

### Depth Levels
- L0: File list only (~100 tokens)
- L1: Summaries + signatures (~500 tokens)
- L2: L1 + relationships (~1500 tokens)
- L3: Full context + evidence (~5000 tokens)

### Feedback Requirement
After every query:
```bash
LiBrainian feedback --query-id <id> --outcome success|failure|partial
```

This enables:
- Confidence calibration
- Retrieval improvement
- Reduced future token cost via caching

## MCP Integration

```json
{
  "mcpServers": {
    "LiBrainian": {
      "command": "npm",
      "args": ["run", "LiBrainian:mcp"],
      "env": {}
    }
  }
}
```

## Anti-Patterns
- Never query before bootstrap completes
- Never ignore confidence < 0.5 results
- Never skip feedback after task completion
- Never use L3 for simple lookups
```

### 4.2 Skills (Create SKILL.md files)

**src/LiBrainian/skills/LiBrainian-bootstrap/SKILL.md**
**src/LiBrainian/skills/LiBrainian-query/SKILL.md**
**src/LiBrainian/skills/LiBrainian-feedback/SKILL.md**

(Content as specified in original plan)

---

## Part 5: Implementation Roadmap (Updated)

### Phase 1: Critical Wiring (3-5 days)
1. P0-1: Wire governor context through entire chain
2. P0-2: Add LLM evidence to file/directory extractors
3. P0-3: Wire feedback loop with actual callers
4. P0-4: Implement consolidated entity extraction

**Gate:** `governorContext.tokensUsed > 0` after bootstrap; feedback callable

### Phase 2: Budget Enforcement (2-3 days)
1. P0-5: Enable strict token budget
2. P1-1: Add batch processing
3. P1-2: Priority-based entity processing

**Gate:** Bootstrap stops at budget; high-priority entities always processed

### Phase 3: Storage & Persistence (2-3 days)
1. P1-3: Persist LLM evidence in storage schema
2. P1-4: Fix query synthesis token tracking
3. Schema migration for calibration + defeaters

**Gate:** Evidence queryable from DB; calibration samples recorded

### Phase 4: Resumability (2-3 days)
1. P2-1: Per-file checkpointing in structural_scan
2. P2-2: Lazy method pack loading
3. SwarmRunner checkpoint persistence

**Gate:** Interrupted bootstrap resumes correctly

### Phase 5: Agent Integration (1-2 days)
1. Create AGENTS.md
2. Create skill SKILL.md files
3. Add feedback CLI command
4. Document MCP usage

**Gate:** Skills discoverable; agents can follow protocol

---

## Appendix A: Complete File Change Summary

### New Files (~350 lines total)
- `src/LiBrainian/knowledge/extractors/unified_extractor.ts` (~300 lines) - consolidates 3 LLM paths + batching
- `src/LiBrainian/api/feedback.ts` (~50 lines) - wires existing feedback code

### Modified Files (Fix Wiring - ~100 lines added)
- `src/LiBrainian/knowledge/generator.ts` - Add governor field, priority sorting, use unified extraction (+60 lines)
- `src/LiBrainian/api/bootstrap.ts` - Pass governor to knowledge generation phase (+10 lines)
- `src/LiBrainian/api/governors.ts` - Set non-zero budget defaults (+5 lines)
- `src/LiBrainian/knowledge/extractors/file_extractor.ts` - Add `buildLlmEvidence()` call (+10 lines)
- `src/LiBrainian/knowledge/extractors/directory_extractor.ts` - Add `buildLlmEvidence()` call (+10 lines)
- `src/LiBrainian/api/query.ts` - Pass governor to synthesis (+5 lines)
- `src/LiBrainian/api/query_synthesis.ts` - Accept governor, return queryId (+5 lines)
- `src/LiBrainian/storage/sqlite_storage.ts` - Persist LLM evidence columns (+20 lines)

### Modified Files (Consolidation - Lines Removed)
- `src/LiBrainian/knowledge/extractors/semantics.ts` - Delete `extractSemantics()` (throws), delete `extractSemanticsWithLLM()` body (~-180 lines, keep types/imports)
- `src/LiBrainian/knowledge/extractors/security_extractor.ts` - Delete `extractSecurityWithLLM()` body (~-200 lines, keep `extractSecurity()` static)
- `src/LiBrainian/knowledge/extractors/rationale_extractor.ts` - Delete `extractRationale()` (throws), delete `extractRationaleWithLLM()` body (~-250 lines, keep `extractRationaleSignals()`)
- `src/LiBrainian/knowledge/extractors/index.ts` - Remove LLM function exports (~-10 lines)

### Code Delta Summary
| Category | Lines Added | Lines Removed | Net |
|----------|-------------|---------------|-----|
| New files (unified + feedback) | +350 | 0 | +350 |
| Wiring fixes across files | +125 | 0 | +125 |
| Consolidation (remove LLM funcs) | 0 | -640 | -640 |
| Dead code (throws-only funcs) | 0 | -25 | -25 |
| **Total** | **+475** | **-665** | **-190** |

### What Stays Unchanged
- `src/LiBrainian/knowledge/extractors/security_extractor.ts:extractSecurity()` (~400 lines) - static CWE analysis
- `src/LiBrainian/knowledge/extractors/rationale_extractor.ts:extractRationaleSignals()` (~300 lines) - heuristic ADR/commit extraction
- `src/LiBrainian/knowledge/extractors/quality_extractor.ts` (all) - complexity metrics
- `src/LiBrainian/knowledge/extractors/testing_extractor.ts` (all) - test coverage
- `src/LiBrainian/integration/agent_feedback.ts` (all 352 lines) - just gets callers now
- All other extractors (history, identity, relationships, etc.)

---

## Appendix B: Test Design (Run During + After Implementation)

These tests are designed to verify real behavior, not mocks. They must pass before each phase is considered complete.

### Test Suite 1: Governor Wiring Verification

**File:** `src/LiBrainian/__tests__/governor_wiring.test.ts`

```typescript
describe('Governor Context Propagation', () => {
  it('tracks tokens through knowledge generation', async () => {
    const governor = new GovernorContext({
      phase: 'knowledge_generation',
      config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 1_000_000 },
    });

    // Before: tokens should be 0
    expect(governor.getTokensUsed()).toBe(0);

    // Run knowledge generation on a small fixture
    const generator = createKnowledgeGenerator({
      storage,
      workspace: FIXTURE_PATH,
      governor,  // THIS IS WHAT WE'RE TESTING
    });
    await generator.generateForFunction(testFunction);

    // After: tokens MUST be > 0
    const tokensUsed = governor.getTokensUsed();
    expect(tokensUsed).toBeGreaterThan(0);
    expect(tokensUsed).toBeLessThan(10000);  // Sanity check

    // Verify token recording was called (not just estimated)
    expect(governor.getTokenRecordCount()).toBeGreaterThanOrEqual(1);
  });

  it('enforces budget limits by stopping extraction', async () => {
    const governor = new GovernorContext({
      phase: 'knowledge_generation',
      config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 100 },  // Very low
    });

    const generator = createKnowledgeGenerator({
      storage,
      workspace: FIXTURE_PATH,
      governor,
    });

    // Should throw or return partial when budget exceeded
    const result = await generator.generateAll();

    expect(result.status).toBe('budget_exhausted');
    expect(result.processedCount).toBeLessThan(result.totalCount);
    expect(governor.getTokensUsed()).toBeLessThanOrEqual(200);  // Some overshoot OK
  });

  it('propagates governor from bootstrap to extractors', async () => {
    // Spy on LLMService.chat to verify governorContext is passed
    const chatSpy = vi.spyOn(LLMService.prototype, 'chat');

    await bootstrapProject({
      workspace: FIXTURE_PATH,
      bootstrapMode: 'full',
      llmProvider: 'claude',
    });

    // Every chat call should have governorContext
    for (const call of chatSpy.mock.calls) {
      expect(call[0]).toHaveProperty('governorContext');
      expect(call[0].governorContext).not.toBeUndefined();
    }
  });
});
```

### Test Suite 2: LLM Evidence Storage

**File:** `src/LiBrainian/__tests__/llm_evidence_storage.test.ts`

```typescript
describe('LLM Evidence Persistence', () => {
  it('stores LLM evidence for file extraction', async () => {
    const result = await extractFileKnowledge({
      filePath: TEST_FILE,
      content: TEST_CONTENT,
      llmProvider: 'claude',
    });

    // Evidence must exist
    expect(result.llmEvidence).toBeDefined();
    expect(result.llmEvidence.provider).toBe('claude');
    expect(result.llmEvidence.modelId).toMatch(/claude-/);
    expect(result.llmEvidence.promptDigest).toHaveLength(16);
    expect(result.llmEvidence.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('stores LLM evidence for directory extraction', async () => {
    const result = await extractDirectoryKnowledge({
      path: TEST_DIR,
      files: TEST_FILES,
      llmProvider: 'claude',
    });

    expect(result.llmEvidence).toBeDefined();
    expect(result.llmEvidence.provider).toBe('claude');
  });

  it('persists evidence to database', async () => {
    await bootstrapProject({ workspace: FIXTURE_PATH, bootstrapMode: 'full' });

    // Query database directly
    const files = await storage.db.all(
      'SELECT llm_evidence FROM librarian_files WHERE llm_evidence IS NOT NULL'
    );

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const evidence = JSON.parse(file.llm_evidence);
      expect(evidence).toHaveProperty('provider');
      expect(evidence).toHaveProperty('modelId');
      expect(evidence).toHaveProperty('promptDigest');
    }
  });

  it('records evidence for unified extraction', async () => {
    const result = await extractUnifiedKnowledge(testEntity, {
      llmProvider: 'claude',
      governor: mockGovernor,
    });

    // Single call should produce evidence covering all sections
    expect(result.llmEvidence).toBeDefined();
    expect(result.semantics).toBeDefined();
    expect(result.security).toBeDefined();
    expect(result.rationale).toBeDefined();

    // Evidence should reference the unified prompt
    expect(result.llmEvidence.promptDigest).toBeDefined();
  });
});
```

### Test Suite 3: Feedback Loop Integration

**File:** `src/LiBrainian/__tests__/feedback_loop.test.ts`

```typescript
describe('Feedback Loop Wiring', () => {
  it('processAgentFeedback is callable from query flow', async () => {
    // Run a query
    const queryResult = await queryLibrarian({
      intent: 'test query',
      workspace: FIXTURE_PATH,
    });

    expect(queryResult.queryId).toBeDefined();
    expect(queryResult.packs.length).toBeGreaterThan(0);

    const packId = queryResult.packs[0].packId;
    const initialConfidence = queryResult.packs[0].confidence;

    // Provide negative feedback
    await recordQueryFeedback(storage, queryResult.queryId, [packId], 'failure');

    // Query again and check confidence decreased
    const pack = await storage.getContextPack(packId);
    expect(pack.confidence).toBeLessThan(initialConfidence);
  });

  it('positive feedback increases confidence', async () => {
    const packId = 'test-pack-id';
    const initialPack = await storage.getContextPack(packId);
    const initialConfidence = initialPack.confidence;

    await recordQueryFeedback(storage, 'query-1', [packId], 'success');

    const updatedPack = await storage.getContextPack(packId);
    expect(updatedPack.confidence).toBeGreaterThan(initialConfidence);
  });

  it('records calibration samples', async () => {
    const queryId = 'calibration-test-query';

    await recordQueryFeedback(storage, queryId, ['pack-1', 'pack-2'], 'success');

    const samples = await storage.db.all(
      'SELECT * FROM librarian_calibration_samples WHERE query_id = ?',
      [queryId]
    );

    expect(samples.length).toBe(2);
    expect(samples[0].actual_outcome).toBe('success');
  });

  it('feedback CLI command works', async () => {
    const result = await runCli([
      'feedback',
      '--query-id', 'test-query',
      '--pack-ids', 'pack-1,pack-2',
      '--outcome', 'success',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Feedback recorded');
  });
});
```

### Test Suite 4: Unified Extraction Quality

**File:** `src/LiBrainian/__tests__/unified_extraction.test.ts`

```typescript
describe('Unified Extraction', () => {
  it('produces semantics equivalent to separate extraction', async () => {
    // Extract with unified
    const unified = await extractUnifiedKnowledge(testEntity, config);

    // Compare to what separate extraction would produce
    // (We keep this test even after removing separate functions)
    expect(unified.semantics).toHaveProperty('purpose');
    expect(unified.semantics).toHaveProperty('domain');
    expect(unified.semantics).toHaveProperty('mechanism');
    expect(unified.semantics.purpose.length).toBeGreaterThan(10);
  });

  it('includes static security analysis', async () => {
    const entity = createEntityWithVulnerability('SQL injection');
    const result = await extractUnifiedKnowledge(entity, config);

    // Should include CWE from static analysis
    expect(result.security.cwe).toContain('CWE-89');
    expect(result.security.vulnerabilities.length).toBeGreaterThan(0);
  });

  it('includes heuristic rationale signals', async () => {
    const entity = createEntityWithADR();
    const result = await extractUnifiedKnowledge(entity, config);

    // Should include decisions from ADR parsing
    expect(result.rationale.decisions.length).toBeGreaterThan(0);
  });

  it('makes exactly 1 LLM call per entity', async () => {
    const chatSpy = vi.spyOn(LLMService.prototype, 'chat');
    chatSpy.mockClear();

    await extractUnifiedKnowledge(testEntity, config);

    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it('batching reduces LLM calls', async () => {
    const chatSpy = vi.spyOn(LLMService.prototype, 'chat');
    chatSpy.mockClear();

    const entities = createTestEntities(10);
    await extractUnifiedBatch(entities, { ...config, batchSize: 5 });

    // 10 entities with batch size 5 = 2 LLM calls
    expect(chatSpy).toHaveBeenCalledTimes(2);
  });
});
```

### Test Suite 5: Budget Enforcement

**File:** `src/LiBrainian/__tests__/budget_enforcement.test.ts`

```typescript
describe('Budget Enforcement', () => {
  it('DEFAULT_GOVERNOR_CONFIG has non-zero limits', () => {
    expect(DEFAULT_GOVERNOR_CONFIG.maxTokensPerRun).toBeGreaterThan(0);
    expect(DEFAULT_GOVERNOR_CONFIG.maxTokensPerPhase).toBeGreaterThan(0);
    expect(DEFAULT_GOVERNOR_CONFIG.maxRetries).toBeGreaterThan(0);
  });

  it('checkBudget throws when tokens exceeded', () => {
    const governor = new GovernorContext({
      phase: 'test',
      config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 100 },
    });

    governor.recordTokens(150);

    expect(() => governor.checkBudget()).toThrow('budget_exhausted');
  });

  it('bootstrap stops at budget with partial results', async () => {
    const result = await bootstrapProject({
      workspace: LARGE_FIXTURE_PATH,  // Has many files
      bootstrapMode: 'full',
      governorConfig: { maxTokensPerRun: 10000 },  // Low budget
    });

    expect(result.status).toBe('partial');
    expect(result.report.tokensUsed).toBeLessThanOrEqual(12000);  // Some overshoot OK
    expect(result.report.filesProcessed).toBeLessThan(result.report.totalFiles);
  });

  it('partial results are usable for queries', async () => {
    // Bootstrap with low budget (partial)
    await bootstrapProject({
      workspace: FIXTURE_PATH,
      governorConfig: { maxTokensPerRun: 5000 },
    });

    // Query should still work
    const result = await queryLibrarian({ intent: 'test', workspace: FIXTURE_PATH });

    expect(result.packs.length).toBeGreaterThan(0);
    // Some packs may have low confidence due to partial processing
  });
});
```

### Test Suite 6: Priority Ordering

**File:** `src/LiBrainian/__tests__/priority_ordering.test.ts`

```typescript
describe('Entity Prioritization', () => {
  it('prioritizes by PageRank', () => {
    const entities = [
      { id: 'low', name: 'helper' },
      { id: 'high', name: 'main' },
    ];
    const graphMetrics = {
      pageRank: { 'low': 0.01, 'high': 0.5 },
    };

    const prioritized = prioritizeEntities(entities, graphMetrics);

    expect(prioritized[0].id).toBe('high');
    expect(prioritized[1].id).toBe('low');
  });

  it('prioritizes exported over internal', () => {
    const entities = [
      { id: 'internal', isExported: false },
      { id: 'exported', isExported: true },
    ];

    const prioritized = prioritizeEntities(entities, { pageRank: {} });

    expect(prioritized[0].id).toBe('exported');
  });

  it('high-priority entities processed first under budget pressure', async () => {
    const processOrder: string[] = [];
    const mockGenerate = vi.fn().mockImplementation(async (entity) => {
      processOrder.push(entity.id);
    });

    const generator = createKnowledgeGenerator({
      storage: storageWithPrioritizedEntities,
      governor: new GovernorContext({ config: { maxTokensPerRun: 5000 } }),
    });
    generator.generateForFunction = mockGenerate;

    await generator.generateAll();

    // First entity processed should be highest priority
    expect(processOrder[0]).toBe('highest-priority-entity');

    // If budget ran out, low-priority should not be processed
    expect(processOrder).not.toContain('lowest-priority-entity');
  });
});
```

### Test Suite 7: Integration (End-to-End)

**File:** `src/LiBrainian/__tests__/integration_e2e.test.ts`

```typescript
describe('End-to-End Integration', () => {
  it('full bootstrap produces queryable knowledge', async () => {
    const bootstrapResult = await bootstrapProject({
      workspace: FIXTURE_PATH,
      bootstrapMode: 'full',
    });

    expect(bootstrapResult.status).toBe('success');
    expect(bootstrapResult.report.tokensUsed).toBeGreaterThan(0);

    // Query should return relevant results
    const queryResult = await queryLibrarian({
      intent: 'How does authentication work?',
      workspace: FIXTURE_PATH,
    });

    expect(queryResult.packs.length).toBeGreaterThan(0);
    expect(queryResult.packs[0].confidence).toBeGreaterThan(0.5);
  });

  it('fast bootstrap + query + feedback cycle works', async () => {
    // 1. Fast bootstrap
    await bootstrapProject({ workspace: FIXTURE_PATH, bootstrapMode: 'fast' });

    // 2. Query
    const result = await queryLibrarian({ intent: 'test', workspace: FIXTURE_PATH });
    const queryId = result.queryId;
    const packId = result.packs[0].packId;

    // 3. Feedback
    await recordQueryFeedback(storage, queryId, [packId], 'success');

    // 4. Verify confidence updated
    const pack = await storage.getContextPack(packId);
    expect(pack.confidence).toBeGreaterThan(result.packs[0].confidence);
  });

  it('tokens are tracked throughout entire flow', async () => {
    const governor = new GovernorContext({ phase: 'full_bootstrap' });

    await bootstrapProject({
      workspace: FIXTURE_PATH,
      bootstrapMode: 'full',
      governor,
    });

    const bootstrapTokens = governor.getTokensUsed();
    expect(bootstrapTokens).toBeGreaterThan(0);

    await queryLibrarian({
      intent: 'test query',
      workspace: FIXTURE_PATH,
      governor,
    });

    const totalTokens = governor.getTokensUsed();
    expect(totalTokens).toBeGreaterThan(bootstrapTokens);
  });
});
```

### Test Execution Phases

**During Implementation (after each fix):**
```bash
# After P0-1 (governor wiring):
npm test -- --grep "Governor Context Propagation"

# After P0-2 (LLM evidence):
npm test -- --grep "LLM Evidence"

# After P0-3 (feedback loop):
npm test -- --grep "Feedback Loop"

# After P0-4 (unified extraction):
npm test -- --grep "Unified Extraction"

# After P0-5 (budget enforcement):
npm test -- --grep "Budget Enforcement"
```

**After All Implementation:**
```bash
# Full test suite
npm run test:LiBrainian

# Integration tests require live providers
npm run test:LiBrainian:live
```

---

## Appendix B: Verification Commands

```bash
# Verify governor wiring
npm run test -- --grep "governor context"

# Verify LLM evidence
npm run LiBrainian -- bootstrap --scope LiBrainian --mode fast
sqlite3 .LiBrainian/LiBrainian.db "SELECT COUNT(*) FROM librarian_files WHERE llm_evidence IS NOT NULL"

# Verify feedback loop
npm run LiBrainian -- query "test query"
npm run LiBrainian -- feedback --query-id <id> --outcome success
sqlite3 .LiBrainian/LiBrainian.db "SELECT * FROM librarian_calibration_samples"

# Verify budget enforcement
LIBRARIAN_MAX_TOKENS=100000 npm run LiBrainian -- bootstrap --mode full
# Should fail with budget_exhausted before completion

# Verify priority ordering
npm run LiBrainian -- bootstrap --mode full --verbose 2>&1 | grep "priority:"
# Should show high-PageRank entities first
```
