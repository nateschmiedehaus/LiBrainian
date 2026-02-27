# LiBrainian Self-Improvement Plan

## Using LiBrainian's Own Index to Improve LiBrainian

This document outlines how to use LiBrainian's bootstrap of itself to systematically improve its own capabilities.

## Current State Assessment (2026-01-16)

### Index Statistics
- **Files**: 322 TypeScript files in `src/LiBrainian/`
- **Functions**: 2,615 indexed with purpose descriptions
- **Context Packs**: 3,259 (function + module + change_impact)
- **Graph Edges**: 12,176 (10,537 calls + 1,639 imports)
- **Evidence Records**: 4,260 traceable provenance records
- **Embeddings**: 2,937 semantic vectors
- **Multi-Vector**: 322 module-level representations

### Quality Gaps Identified
1. **Flat Confidence**: All entities at 0.5
2. **Feedback Loop Disconnected**: 0 confidence events
3. **Test Mapping Empty**: 0 records
4. **File Knowledge Missing**: 0 file/directory records

---

## Improvement Phase 1: Fix Confidence Calculation

### Query to LiBrainian
```bash
npx tsx src/LiBrainian/cli/index.ts query "Where is function confidence calculated?"
```

### LiBrainian's Response (Verified)
Found relevant files:
- `api/query_synthesis.ts` - `estimateConfidence()` (lines 385-400)
- `api/confidence_calibration.ts` - `computeUncertaintyMetrics()` (lines 82-89)
- `knowledge/extractors/evidence_collector.ts` - confidence decay logic

### Fix Implementation
1. Read `agents/index_librarian.ts` lines 1060-1100 where edges are created
2. Current: hardcoded 0.5 for function confidence
3. Fix: Aggregate edge confidence (avg of incoming edges) into function confidence
4. Validation: Re-run bootstrap, verify confidence variance > 0.01

---

## Improvement Phase 2: Wire Feedback Loop

### Query to LiBrainian
```bash
npx tsx src/LiBrainian/cli/index.ts query "Where is processAgentFeedback and how is it called?"
```

### Expected Discovery
- Definition: `integration/agent_feedback.ts` (lines 100-172)
- Current calls: None (orphaned code)
- Missing: feedbackToken in query response

### Fix Implementation
1. Add `feedbackToken` to `LibrarianResponse` in `types.ts`
2. Generate token in `api/query.ts` at query completion
3. Store query→pack mapping for later attribution
4. Wire `integration/agent_protocol.ts` to call `processAgentFeedback()` after task completion
5. Validation: Query, submit feedback, verify confidence_events table populated

---

## Improvement Phase 3: Enable Test Mapping

### Query to LiBrainian
```bash
npx tsx src/LiBrainian/cli/index.ts query "Where is test mapping populated in bootstrap?"
```

### Expected Discovery
- Test indexer: `ingest/test_indexer.ts` (493 lines, comprehensive implementation)
- Bootstrap entry: `api/bootstrap.ts`
- Issue: Test indexer may not be called or globs may mismatch

### Fix Implementation
1. Verify `bootstrapProject()` calls test indexer
2. Check `DEFAULT_GLOBS` in test_indexer.ts match `**/*.test.ts` patterns
3. Verify storage upserts to `librarian_test_mapping`
4. Validation: Re-run bootstrap, check test_mapping count > 0

---

## Improvement Phase 4: Populate File/Directory Knowledge

### Query to LiBrainian
```bash
npx tsx src/LiBrainian/cli/index.ts query "Where are file and directory records stored?"
```

### Expected Discovery
- Extractors: `knowledge/extractors/file_extractor.ts`, `directory_extractor.ts`
- Storage: `storage/sqlite_storage.ts` tables `librarian_files`, `librarian_directories`
- Issue: Extractors may run but not persist

### Fix Implementation
1. Trace file_extractor output → storage call path
2. Verify `upsertFileKnowledge()` is called during bootstrap
3. Validation: Re-run bootstrap, check files/directories tables populated

---

## Validation Protocol

After each improvement phase:

```bash
# Run validation tests
npx vitest run src/LiBrainian/__tests__/understanding_validation.test.ts
npx vitest run src/LiBrainian/__tests__/confidence_calibration_validation.test.ts

# Check database metrics
sqlite3 ./state/LiBrainian.db "
  SELECT 'Functions' as type, COUNT(*) as count,
         ROUND(AVG(confidence), 2) as avg_conf,
         COUNT(DISTINCT ROUND(confidence, 1)) as distinct_conf
  FROM librarian_functions;

  SELECT 'Confidence Events' as type, COUNT(*) as count FROM librarian_confidence_events;
  SELECT 'Test Mappings' as type, COUNT(*) as count FROM librarian_test_mapping;
  SELECT 'Files' as type, COUNT(*) as count FROM librarian_files;
"
```

---

## Success Criteria

| Metric | Before | Target |
|--------|--------|--------|
| Confidence distinct values | 1 (0.5) | >5 |
| Confidence events | 0 | >0 after feedback |
| Test mappings | 0 | >30 |
| File records | 0 | >300 |
| Directory records | 0 | >30 |

---

## Meta: Self-Referential Improvement Loop

```
┌─────────────────────────────────────────────────────────────┐
│  1. Query LiBrainian for relevant code                       │
│     ↓                                                       │
│  2. LiBrainian returns context packs with line numbers       │
│     ↓                                                       │
│  3. Read identified files, understand implementation        │
│     ↓                                                       │
│  4. Make targeted fix based on LiBrainian's guidance         │
│     ↓                                                       │
│  5. Re-bootstrap LiBrainian on itself                        │
│     ↓                                                       │
│  6. Validate improvement via tests + DB queries             │
│     ↓                                                       │
│  7. Repeat for next gap                                     │
└─────────────────────────────────────────────────────────────┘
```

This is the essence of **self-improving AI assistance**: using the tool to improve itself.

---

## Next Steps

1. Start with Phase 1 (Confidence) - highest impact
2. After each phase, re-run validation suite
3. After all phases, bootstrap on full wave0-autopilot codebase
4. Run comprehensive SLO validation
5. Document improvements for future iterations
