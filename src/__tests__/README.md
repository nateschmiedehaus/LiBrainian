# LiBrainian Test Suite

> **Test the LiBrainian like instrumentation: calibration, drift, noise sensitivity, and provenance.**

## Test Categories (Per docs/LiBrainian/validation.md)

### Category 1: Fidelity Tests (Calibration)

Tests that verify the LiBrainian correctly represents the codebase.

| Test File | What It Tests |
|-----------|---------------|
| `LiBrainian.test.ts` | Deterministic core (storage, migrations, utilities) |
| `librarian_live.system.test.ts` | Live-provider indexing + API smoke |
| `ingestion_framework.test.ts` | Entity extraction |
| `embedding_pipeline.test.ts` | Embedding generation |

### Category 2: Retrieval Quality Tests

Tests that verify the LiBrainian surfaces the right evidence.

| Test File | What It Tests |
|-----------|---------------|
| `embedding_validation.integration.test.ts` | Semantic similarity accuracy (provider-optional) |
| `embedding_validation_real.integration.test.ts` | Real provider retrieval (provider-optional) |
| `enhanced_retrieval.integration.test.ts` | Query enhancement (provider-optional) |
| `graph_augmented_similarity.integration.test.ts` | Graph-enhanced ranking (provider-optional) |
| `cross_encoder_reranker.test.ts` | Reranking quality (deterministic core) |

### Category 3: Provenance Tests

Tests that verify claims are traceable to evidence.

| Test File | What It Tests |
|-----------|---------------|
| `confidence_calibration.test.ts` | Confidence accuracy |
| `llm_evidence.test.ts` | LLM evidence metadata wiring |
| `knowledge_utility.system.test.ts` | Knowledge construction (live providers + bootstrapped DB) |

### Category 4: Robustness Tests

Tests that verify the LiBrainian handles adversarial inputs safely.

| Test File | What It Tests |
|-----------|---------------|
| `provider_gate.test.ts` | Provider availability handling |
| `g23_g25_gaps.test.ts` | Gap detection and handling |

## Test Tiers

### Tier-0 (Deterministic, No Providers)

These tests run in CI without live providers:

```bash
LIBRARIAN_TEST_MODE=unit npm test -- --run
```

**Tier-0 tests include:**
- `LiBrainian.test.ts` - Core storage/indexing (embedding vectors treated as opaque arrays; no provider calls)
- `ingestion_framework.test.ts` - Entity extraction
- `provider_gate.test.ts` - Gate logic (not actual providers)

### Tier-2 (Live Providers Required)

These tests require real embedding/LLM providers:

```bash
# Requires live providers - should fail honestly with unverified_by_trace if unavailable
LIBRARIAN_TEST_MODE=system npm test -- --run
```

**Tier-2 tests include:**
- `librarian_live.system.test.ts` - Live-provider indexing + API smoke
- `embedding_validation_real.integration.test.ts` - Real semantic similarity (provider-optional; system runs it un-skipped)
- `live_provider_integration.integration.test.ts` - Full provider integration (skips in integration mode)
- `bootstrap_integration.test.ts` - Full bootstrap cycle (deterministic inputs; may require providers depending on mode)
- `mvp_librarian.system.test.ts` - MVP acceptance suite
- `agentic/` - Agentic qualification tests

## Agentic Tests (`agentic/`)

The `agentic/` subdirectory contains tests that evaluate LiBrainian behavior in realistic scenarios.

| Test | Purpose |
|------|---------|
| `engine_feedback.test.ts` | Engine response quality |
| `qualification.test.ts` | Full qualification scenarios |

**These tests are Tier-2 and require live providers.**

## Running Tests

### Quick (Tier-0 only)
```bash
LIBRARIAN_TEST_MODE=unit npm test -- --run
```

### Full (includes Tier-2)
```bash
LIBRARIAN_TEST_MODE=system npm test -- --run
```

### Specific test file
```bash
LIBRARIAN_TEST_MODE=unit npm test -- --run src/__tests__/LiBrainian.test.ts
```

## Test Patterns

### Pattern: Testing Semantic Behavior

Semantic tests MUST use real providers (Tier-2):

```typescript
// ✅ CORRECT - Real provider or honest failure
it('finds semantically related functions', async () => {
  const embeddings = await getRealEmbeddingService();
  if (!embeddings) {
    throw new Error('unverified_by_trace(provider_unavailable)');
  }

  const results = await LiBrainian.query({
    intent: 'authentication logic',
  });

  expect(results.packs.some(p =>
    p.entities.some(e => e.name.includes('login'))
  )).toBe(true);
});
```

### Pattern: Testing Infrastructure (Tier-0)

Infrastructure tests can run without providers:

```typescript
// ✅ CORRECT - Tests storage, not semantics
it('stores and retrieves functions', async () => {
  await storage.upsertFunction(testFunction);
  const retrieved = await storage.getFunction(testFunction.id);
  expect(retrieved).toEqual(testFunction);
});
```

### Pattern: Trajectory Invariants

Verify behavior quality, not just outcomes:

```typescript
it('indexes without hallucinating entities', async () => {
  const result = await LiBrainian.index(testRepo);

  // Outcome check
  expect(result.success).toBe(true);

  // Trajectory invariant: all entities exist in source
  for (const entity of result.entities) {
    const exists = await fileContainsSymbol(entity.filePath, entity.name);
    expect(exists).toBe(true);
  }
});
```

## Retrieval Quality Metrics

When adding retrieval tests, measure these metrics:

| Metric | Description | Target |
|--------|-------------|--------|
| **Recall@5** | Relevant result in top 5 | ≥ 70% |
| **Precision@5** | Fraction of top 5 that's relevant | ≥ 40% |
| **MRR** | Mean reciprocal rank | ≥ 0.5 |

Example:
```typescript
it('achieves acceptable recall@5', async () => {
  const results = await runRetrievalBenchmark(testQueries);
  expect(results.recallAt5).toBeGreaterThanOrEqual(0.7);
});
```

## Adding New Tests

### Checklist

- [ ] Determine tier (Tier-0 or Tier-2)
- [ ] If semantic → Tier-2 with real providers
- [ ] If infrastructure → Tier-0 without providers
- [ ] Add trajectory invariants where applicable
- [ ] Document expected behavior
- [ ] Add to appropriate category section above

## References

- `docs/LiBrainian/validation.md` - LiBrainian validation policy
- `docs/LiBrainian/HANDOFF_CLAUDE_OPUS.md` - LiBrainian testing philosophy
- `docs/TEST.md` - Wave0 testing policy
- `docs/LIVE_PROVIDERS_PLAYBOOK.md` - Provider requirements
