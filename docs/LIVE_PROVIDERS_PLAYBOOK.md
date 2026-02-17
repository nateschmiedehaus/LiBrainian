# Live Providers Playbook: The Epistemology of Agentic Testing

> **This document is LAW.** All agents (Codex, Claude, Gemini) MUST follow this playbook.
> Violations are grounds for immediate code rejection.

---

## Executive Summary

**Wave0 is an agentic system. Agentic cognition can ONLY be validated with live providers.**

Structural/deterministic outputs (AST maps, indices, counts) may run in degraded modes, but **semantic claims, reasoning, and synthesis are invalid without live LLMs** and must fail closed with explicit `unverified_by_trace(...)` disclosure.

This is not a preference. This is not a best practice. This is a logical necessity derived from first principles. This document explains WHY and provides the definitive playbook for correct testing.

---

## Part 1: The Fundamental Problem

### 1.1 What Wave0 Actually Is

Wave0 is a **semantic agentic system**. Its value propositions are:

1. **Semantic Understanding**: The LiBrainian understands what code MEANS, not just what it says
2. **Intelligent Reasoning**: Agents make decisions based on understanding, not pattern matching
3. **Emergent Behavior**: The system exhibits behaviors that emerge from intelligence, not scripted responses

### 1.2 The Testing Paradox

To test a system, you must observe its behavior. But:

- **Semantic understanding** requires a model that understands semantics
- **Intelligent reasoning** requires actual intelligence
- **Emergent behavior** requires the components that produce emergence

**You cannot observe what is not present.**

If you replace the intelligence with a hash function, you are not testing the intelligent system. You are testing a hash function. The test passes, but proves nothing about the original system.

### 1.3 The False Confidence Trap

This is the critical danger:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   FALSE CONFIDENCE IS WORSE THAN NO CONFIDENCE                              │
│                                                                             │
│   A test with fake embeddings:                                              │
│   - Passes consistently (because hashes are deterministic)                  │
│   - Produces green CI (because assertions match fake outputs)               │
│   - Creates the ILLUSION that the system works                              │
│   - Hides real bugs that would appear with real embeddings                  │
│   - Allows broken code to ship to production                                │
│                                                                             │
│   This is WORSE than having no test at all, because:                        │
│   - No test → You know you haven't validated the feature                    │
│   - Fake test → You THINK you've validated it, but you haven't              │
│                                                                             │
│   False confidence leads to production failures.                            │
│   Production failures destroy user trust.                                   │
│   Destroyed trust kills the product.                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 2: The Epistemological Argument

### 2.1 What Are Embeddings?

Embeddings are vector representations of meaning. A real embedding model:

- Maps "function" and "method" to nearby vectors (they mean similar things)
- Maps "bug" and "defect" to nearby vectors (synonyms)
- Maps "authentication" and "login" to nearby vectors (related concepts)
- Maps "car" far from "democracy" (unrelated concepts)

This is **semantic understanding** - the model has learned the relationships between concepts from training on human knowledge.

### 2.2 What Are Fake/Deterministic Embeddings?

A deterministic embedding (hash-based, one-hot, fixed) is a function that:

- Produces consistent outputs for the same inputs
- Has ZERO understanding of meaning
- Maps "function" and "method" to UNRELATED vectors (different strings → different hashes)
- Maps "bug" and "defect" to UNRELATED vectors
- Maps "car" and "automobile" to UNRELATED vectors

This is **syntactic hashing** - the function produces consistent garbage.

### 2.3 The Logical Proof

```
Premise 1: The LiBrainian's value is semantic retrieval
           (finding code that is MEANINGFULLY related to a query)

Premise 2: Semantic retrieval requires semantic understanding
           (you must understand meaning to find related meanings)

Premise 3: Fake embeddings have no semantic understanding
           (hash("function") and hash("method") are unrelated)

Premise 4: Tests with fake embeddings test fake semantic retrieval
           (the retrieval is based on hash collisions, not meaning)

Conclusion: Tests with fake embeddings DO NOT test the LiBrainian
            (they test a different system that happens to share some code)

Therefore:  Any claim that "the LiBrainian works" based on fake embedding
            tests is LOGICALLY INVALID
```

### 2.4 The Calculator Analogy

Imagine testing a calculator by replacing its arithmetic unit with this:

```javascript
function fakeAdd(a, b) {
  return 42; // Always returns 42
}
```

Your test suite:
```javascript
test('2 + 2 equals 42', () => {
  expect(fakeAdd(2, 2)).toBe(42); // PASSES!
});
```

The test passes consistently. CI is green. Ship it!

But you have not tested a calculator. You have tested a function that returns 42.

**This is exactly what fake embeddings do.** They return consistent garbage, and tests that expect consistent garbage pass.

---

## Part 3: The Forbidden Patterns

### 3.1 Pattern: Deterministic Embedding Service

```typescript
// ❌ FORBIDDEN - DELETE THIS CODE
function createDeterministicEmbeddingService(dimension: number = 768): EmbeddingService {
  const embedder = async (text: string): Promise<number[]> => {
    const hash = hashString(text);
    const embedding = new Float32Array(dimension);
    embedding[hash % dimension] = 1; // One-hot based on hash
    return Array.from(embedding);
  };
  return new EmbeddingService({
    provider: 'fake',
    modelId: 'deterministic',
    embeddingDimension: dimension,
    embedder,
  });
}
```

**Why it's forbidden**: This produces vectors where semantically identical concepts (e.g., "error" and "exception") map to completely unrelated positions. The LiBrainian cannot find related code because there is no "relatedness" in these vectors.

### 3.2 Pattern: Disabling Embeddings

```typescript
// ❌ FORBIDDEN - DO NOT DISABLE EMBEDDINGS
const LiBrainian = await createLibrarian({
  workspace,
  bootstrapConfig: {
    generateEmbeddings: false, // ← FORBIDDEN
  },
});

// ❌ FORBIDDEN - NULL EMBEDDING SERVICE
const indexer = createIndexLibrarian({
  embeddingService: null, // ← FORBIDDEN
});
```

**Why it's forbidden**: Without embeddings, the LiBrainian is reduced to keyword matching. It cannot understand that a query about "authentication" should return code about "login". You're testing a grep wrapper, not a semantic index.

### 3.3 Pattern: Bypassing Provider Gate

```typescript
// ❌ FORBIDDEN - DO NOT BYPASS PROVIDER REQUIREMENTS
await ensureLibrarianReady(workspace, {
  bypassProviderGate: true, // ← FORBIDDEN
});
```

**Why it's forbidden**: The provider gate exists to ensure real providers are available. Bypassing it allows the system to proceed without the intelligence that makes it valuable. You're removing the safety check that prevents meaningless tests.

### 3.4 Pattern: Mocking Embedding Services

```typescript
// ❌ FORBIDDEN - DO NOT MOCK
vi.mock('../api/embeddings', () => ({
  EmbeddingService: class {
    async generateEmbedding() {
      return { embedding: new Float32Array([1, 0, 0, ...]) };
    }
  },
}));
```

**Why it's forbidden**: Mocks return what you tell them to return. They cannot exhibit unexpected behavior, edge cases, or real-world failure modes. You're testing your assumptions about embeddings, not actual embeddings.

### 3.5 Pattern: Fixed Test Vectors

```typescript
// ❌ FORBIDDEN - FIXED VECTORS ARE MEANINGLESS
const testEmbeddings = {
  'function add': [1, 0, 0, 0, 0, 0, 0, 0],
  'function subtract': [0, 1, 0, 0, 0, 0, 0, 0],
  'add two numbers': [0.9, 0.1, 0, 0, 0, 0, 0, 0], // "close to add"
};
```

**Why it's forbidden**: You've manually constructed "relatedness" that doesn't exist in reality. Real embeddings might map "add" and "plus" as similar, but your fake vectors won't. You're testing against a fantasy world.

---

## Part 4: The Required Patterns

### 4.1 Pattern: Real Embedding Provider

```typescript
// ✅ CORRECT - Use provider gate to get available provider (CLI auth, NOT API keys)
// Authentication is via Claude Code (`claude setup-token` or run `claude`) and Codex CLI (`codex login`)
import { checkAllProviders } from '../LiBrainian/api/provider_check.js';

const status = await checkAllProviders({ workspaceRoot: process.cwd() });
if (!status.embedding.available) {
  throw new Error('unverified_by_trace(provider_unavailable)');
}

const embeddingService = new EmbeddingService({
  provider: status.embedding.provider,  // 'claude' | 'codex' | 'ollama'
  modelId: status.embedding.model,
  embeddingDimension: 768,
});

// OR with Ollama (local)
const embeddingService = new EmbeddingService({
  provider: 'ollama',
  modelId: 'nomic-embed-text',
  embeddingDimension: 768,
  baseUrl: 'http://localhost:11434',
});
```

### 4.2 Pattern: Honest Failure When Unavailable

```typescript
// ✅ CORRECT - Fail honestly when providers unavailable
async function testSemanticRetrieval() {
  const embeddingService = await createEmbeddingService();

  if (!embeddingService.isAvailable()) {
    throw new Error('unverified_by_trace(provider_unavailable): ' +
      'Semantic tests require live embedding providers. ' +
      'This test cannot validate semantic behavior without real embeddings.');
  }

  // Proceed with real test
  const results = await LiBrainian.query({
    intent: 'find authentication code',
    depth: 'L1',
  });

  // Real assertions about semantic relevance
  expect(results.packs.some(p =>
    p.summary.toLowerCase().includes('auth') ||
    p.summary.toLowerCase().includes('login')
  )).toBe(true);
}
```

### 4.3 Pattern: Tier Separation

```typescript
// ✅ CORRECT - Tier-0 tests non-semantic infrastructure
describe('Tier-0: Storage Infrastructure', () => {
  it('stores and retrieves functions by ID', async () => {
    // This does NOT test semantic understanding
    // It tests that SQLite works
    await storage.upsertFunction(testFunction);
    const retrieved = await storage.getFunction(testFunction.id);
    expect(retrieved).toEqual(testFunction);
  });
});

// ✅ CORRECT - Tier-2 tests semantic behavior with real providers
describe('Tier-2: Semantic Retrieval', () => {
  it('finds related code by meaning', async () => {
    // REQUIRES real embeddings
    const service = await getRealEmbeddingService();
    if (!service) {
      throw new Error('unverified_by_trace(provider_unavailable)');
    }

    // Index code about authentication
    await LiBrainian.index('src/auth/login.ts');

    // Query with related but different terms
    const results = await LiBrainian.query({
      intent: 'user credential verification',
    });

    // Should find auth code because embeddings understand the relationship
    expect(results.packs.length).toBeGreaterThan(0);
  });
});
```

### 4.4 Pattern: Provider Fallback Chain (Not Simulation)

```typescript
// ✅ CORRECT - Try multiple real providers, then fail honestly
async function getEmbeddingService(): Promise<EmbeddingService> {
  // Try OpenAI
  try {
    const openai = await createOpenAIEmbeddings();
    if (await openai.healthCheck()) return openai;
  } catch (e) {
    console.log('OpenAI unavailable, trying Ollama...');
  }

  // Try Ollama
  try {
    const ollama = await createOllamaEmbeddings();
    if (await ollama.healthCheck()) return ollama;
  } catch (e) {
    console.log('Ollama unavailable...');
  }

  // ❌ DO NOT: return fakeDeterministicService();
  // ✅ DO: Fail honestly
  throw new Error(
    'unverified_by_trace(provider_unavailable): ' +
    'No embedding providers available. Cannot test semantic behavior.'
  );
}
```

---

## Part 5: The Test Classification Guide

### 5.1 Decision Tree

```
Is this test about semantic/agentic behavior?
│
├─ NO → Does it test infrastructure only (storage, parsing, etc.)?
│       │
│       ├─ YES → Tier-0 OK (no providers needed)
│       │        Examples:
│       │        - SQLite storage CRUD
│       │        - AST parsing
│       │        - File system operations
│       │        - JSON serialization
│       │
│       └─ NO → Re-evaluate what you're testing
│
└─ YES → REQUIRES LIVE PROVIDERS (Tier-2)
         Examples:
         - "Finds related functions"
         - "Returns relevant context"
         - "Understands query intent"
         - "Semantic search works"
         - Anything with "meaning", "related", "relevant", "understand"
```

### 5.2 The Semantic Keyword Test

If your test description contains any of these words, it REQUIRES live providers:

- semantic
- meaning
- understand
- related
- relevant
- similar
- context (when referring to semantic context)
- intent
- find (when finding by meaning, not by ID)
- search (when semantic search)
- query (when natural language query)

### 5.3 Examples

| Test Description | Tier | Requires Providers? |
|-----------------|------|---------------------|
| "SQLite stores embeddings" | 0 | No (tests storage) |
| "Parser extracts functions" | 0 | No (tests parsing) |
| "Query finds related code" | 2 | **YES** (semantic) |
| "LiBrainian understands intent" | 2 | **YES** (semantic) |
| "Context assembly works" | 2 | **YES** (semantic context) |
| "File indexing completes" | 0 | No (tests mechanics) |
| "Returns semantically similar results" | 2 | **YES** (semantic) |

---

## Part 6: Enforcement

### 6.1 Code Review Checklist

When reviewing code, check for these violations:

```
[ ] Does the code contain `createDeterministicEmbeddingService`? → REJECT
[ ] Does the code contain `generateEmbeddings: false` in a semantic test? → REJECT
[ ] Does the code contain `bypassProviderGate: true`? → REJECT
[ ] Does the code contain `embeddingService: null` in a semantic test? → REJECT
[ ] Does the code mock embedding/LLM services? → REJECT
[ ] Does the test claim to validate semantic behavior without providers? → REJECT
[ ] Does the test use fixed/hardcoded embedding vectors? → REJECT
```

### 6.2 Automated Detection

Add to pre-commit hooks:

```bash
#!/bin/bash
# Detect forbidden patterns

FORBIDDEN_PATTERNS=(
  "createDeterministicEmbeddingService"
  "bypassProviderGate.*true"
  "generateEmbeddings.*false"
  "embeddingService.*null"
  "hashString.*embedding"
  "embedding\[.*%.*\].*="
)

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  if grep -rE "$pattern" src/ --include="*.ts" --include="*.test.ts"; then
    echo "ERROR: Forbidden pattern detected: $pattern"
    echo "See docs/LIVE_PROVIDERS_PLAYBOOK.md for why this is forbidden"
    exit 1
  fi
done
```

### 6.3 When You Encounter Violations

1. **Do not approve the PR** - Violations must be fixed before merge
2. **Explain the epistemology** - Link to this document
3. **Suggest the fix** - Either use real providers or reclassify as Tier-0
4. **If Tier-0 is appropriate** - Ensure the test makes no semantic claims

---

## Part 7: FAQ

### Q: But I need tests to pass in CI without providers!

**A**: Tier-0 tests run without providers and test non-semantic infrastructure. Tier-2 tests that require providers should either:
1. Be run separately with providers available
2. Exit with `unverified_by_trace(provider_unavailable)` when providers are missing

You cannot have "semantic tests that pass without semantics." That's a contradiction.

### Q: Fake embeddings let me test the query logic!

**A**: No. The query logic IS the embedding similarity calculation. With fake embeddings, you're testing that cosine similarity works on arbitrary vectors. You're not testing that queries return semantically relevant results.

### Q: Real embeddings are slow and cost money!

**A**: Yes. That's the cost of testing a real system. Fake tests are free because they test nothing. You get what you pay for.

If cost is a concern:
- Use local Ollama for embeddings (free, fast)
- Run semantic tests less frequently (nightly instead of per-commit)
- Have a smaller semantic test suite that covers critical paths

### Q: Can I use cached embeddings from previous runs?

**A**: Cached embeddings from REAL providers are acceptable for performance, as long as:
1. The cache was populated by real providers
2. The cache is invalidated when code changes
3. You're not "seeding" the cache with fake data

### Q: What if I'm testing embedding service error handling?

**A**: You can test error handling paths without fake embeddings:
1. Use a real provider and let it fail naturally (network down, etc.)
2. Use error injection at the network layer, not the embedding layer
3. Test that the system handles `provider_unavailable` errors correctly

---

## Part 8: Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   THE LIVE PROVIDERS COMMANDMENTS                                           │
│                                                                             │
│   1. Semantic behavior requires semantic understanding                      │
│   2. Semantic understanding requires real embedding models                  │
│   3. Fake embeddings have zero semantic understanding                       │
│   4. Tests with fake embeddings test nothing about semantic behavior        │
│   5. False confidence is worse than no confidence                           │
│   6. Tier-0 tests infrastructure; Tier-2 tests semantics                    │
│   7. When providers unavailable, fail honestly                              │
│   8. Never bypass provider gates                                            │
│   9. Never mock intelligence                                                │
│   10. Delete fake embedding code when you see it                            │
│                                                                             │
│   THE GOAL IS TRUTH, NOT GREEN CI                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 9: Distributional Evaluation (Agentic Testing Extension)

> **"It worked once" is anecdote, not evidence.**

Live provider tests are necessary but not sufficient. Agentic systems are non-deterministic, so single-run evidence is epistemologically incomplete.

### 9.1 Why Single Runs Are Insufficient

| Problem | Symptom | Consequence |
|---------|---------|-------------|
| **Model variance** | Same prompt → different outputs | "It worked" becomes meaningless |
| **Retrieval variance** | Same query → different chunk ordering | Test results are unstable |
| **Tool timing** | Network latency varies | Timeouts are flaky |
| **Emergent behavior** | Complex interactions produce unexpected paths | Edge cases never hit |

### 9.2 Distributional Acceptance Criteria

For any agentic test claiming to validate behavior:

| Metric | Minimum Requirement |
|--------|---------------------|
| **Trials** | N ≥ 10 independent runs |
| **Pass Rate** | Report with 95% confidence interval |
| **Tail Risk** | Report P90/P99 time/cost |
| **Safety** | 0 policy violations across all trials |

### 9.3 The Distributional Testing Pattern

```typescript
// ✅ CORRECT - Distributional evaluation
describe('Semantic Retrieval (Distributional)', () => {
  const TRIALS = 10;
  const results: TrialResult[] = [];

  for (let i = 0; i < TRIALS; i++) {
    it(`trial ${i + 1}/${TRIALS}: finds related code`, async () => {
      const embeddingService = await getRealEmbeddingService();
      if (!embeddingService) {
        throw new Error('unverified_by_trace(provider_unavailable)');
      }

      const result = await runSemanticQuery({
        query: 'authentication logic',
        expectedFiles: ['src/auth/login.ts', 'src/auth/verify.ts'],
      });

      results.push(result);

      // Per-trial assertion
      expect(result.relevantFileFound).toBe(true);
    });
  }

  afterAll(() => {
    // Distributional analysis
    const passRate = results.filter(r => r.success).length / results.length;
    const ci95 = computeConfidenceInterval(passRate, results.length, 0.95);

    console.log(`Pass Rate: ${passRate * 100}% [${ci95.lower * 100}%, ${ci95.upper * 100}%]`);

    // Distributional gate
    expect(passRate).toBeGreaterThanOrEqual(0.8);
    expect(ci95.lower).toBeGreaterThanOrEqual(0.6);
  });
});
```

### 9.4 Trajectory Invariants (Beyond Pass/Fail)

Even when a run "passes," verify trajectory quality:

| Invariant | What It Checks | Violation Response |
|-----------|----------------|-------------------|
| `cited_sources` | Every claim has evidence | Mark as partial pass |
| `minimal_retrieval` | Didn't over-fetch context | Quality warning |
| `no_hallucination` | Didn't cite non-existent files | Critical failure |
| `calibrated_confidence` | Stated confidence ≈ empirical accuracy | Calibration warning |

### 9.5 The Record-and-Replay Pattern

Turn non-deterministic runs into deterministic regression tests:

```typescript
// ✅ CORRECT - Capture replay artifact for debugging
async function runWithReplay(fn: () => Promise<Result>): Promise<{ result: Result; replay: ReplayPack }> {
  const replay = new ReplayPack();

  // Intercept and record all non-deterministic inputs
  replay.startCapture();

  try {
    const result = await fn();
    replay.stopCapture();

    // Save replay artifact
    await replay.save(`state/audits/replay/${Date.now()}.json`);

    return { result, replay };
  } catch (error) {
    replay.stopCapture();
    await replay.save(`state/audits/replay/${Date.now()}-failed.json`);
    throw error;
  }
}
```

### 9.6 Summary: The Complete Evidence Standard

For world-class agentic testing, you need ALL of:

1. **Live providers** (this playbook) - Real intelligence, not mocks
2. **Distributional evaluation** - Pass rate over N trials, not single runs
3. **Trajectory invariants** - Quality of path, not just outcome
4. **Replay artifacts** - Turn failures into permanent regression tests
5. **Honest failure** - `unverified_by_trace` when prerequisites missing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   COMPLETE EVIDENCE STANDARD                                                │
│                                                                             │
│   Live Providers + Distributional + Trajectories + Replay = TRUTH           │
│                                                                             │
│   Missing any one → Epistemologically incomplete                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## References

- `docs/TEST.md` - Complete testing policy
- `docs/AGENTS.md` - Anti-slop checklist (Category 12: Fake Intelligence)
- `docs/WORLD_CLASS_ASSESSMENT.md` - Anti-Determinism Mandate
- `config/canon.json` - Tier definitions and canonical commands

---

**This document is canonical. When in doubt, follow this playbook.**
