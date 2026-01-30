# EMBEDDING IMPLEMENTATION RULES - READ BEFORE WRITING ANY EMBEDDING CODE

> **THIS FILE IS LAW. VIOLATION = IMMEDIATE CODE REJECTION.**

## AUTHENTICATION: CLI-ONLY (NO API KEYS)

Wave0 uses **CLI-based authentication with monthly subscriptions**, NOT API keys.

```bash
# Claude Code CLI (subscription; no API keys)
claude --version
claude setup-token
claude --print "ok"   # quick sanity check (uses tokens)

# Codex CLI (subscription; no API keys)
codex --version
codex login
codex login status

# The CLI tools handle authentication - you don't need API keys
```

**NEVER** check for `process.env.ANTHROPIC_API_KEY`, `process.env.OPENAI_API_KEY`, etc.
**ALWAYS** use `checkAllProviders()` from `librarian/api`

```typescript
// ✅ CORRECT - Use provider gate (CLI auth)
import { checkAllProviders } from 'librarian/api';
const status = await checkAllProviders();
if (status.embedding.available) { /* use it */ }

// ❌ FORBIDDEN - Never check for API keys
if (process.env.ANTHROPIC_API_KEY) { /* NO! */ }
```

## FORBIDDEN PATTERNS - DO NOT IMPLEMENT

If you are about to write code that does ANY of the following, **STOP IMMEDIATELY**:

```typescript
// ❌ FORBIDDEN - Hash-based embeddings
const hash = crypto.createHash('sha256').update(text).digest();
embedding[i] = hash[i] / 255;  // NO!

// ❌ FORBIDDEN - One-hot embeddings
embedding[hashCode % dimension] = 1;  // NO!

// ❌ FORBIDDEN - Length-based fake embeddings
return Array.from({ length: dim }, (_, i) => text.length + i);  // NO!

// ❌ FORBIDDEN - Any function named "deterministic" + "embedding"
function createDeterministicEmbeddingService() { ... }  // DELETE THIS

// ❌ FORBIDDEN - Bypassing provider requirements
bypassProviderGate: true  // NO!
generateEmbeddings: false  // Only OK for Tier-0 parsing tests
embeddingService: null  // NO!
```

## WHY THIS IS FORBIDDEN

Hash-based embeddings have **ZERO semantic understanding**:
- `hash("function")` and `hash("method")` produce UNRELATED vectors
- `hash("bug")` and `hash("defect")` produce UNRELATED vectors
- You are testing hash consistency, NOT semantic retrieval

**False confidence is WORSE than no confidence.** A green CI with fake embeddings proves NOTHING.

## REQUIRED PATTERN - USE REAL PROVIDERS

```typescript
// ✅ CORRECT - Wrap real embedding service
import { EmbeddingService, requireProviders } from 'librarian/api';

class MyEmbeddingWrapper {
  private service: EmbeddingService;

  async initialize(): Promise<void> {
    // REQUIRE real providers - fail if unavailable
    await requireProviders({ embedding: true });
  }

  async embed(text: string): Promise<Float32Array> {
    // Use REAL embeddings from live provider
    return this.service.generateEmbedding({ text, kind: 'code' });
  }
}
```

## IF PROVIDERS ARE UNAVAILABLE

```typescript
// ✅ CORRECT - Fail honestly
if (!providerAvailable) {
  throw new Error('unverified_by_trace(provider_unavailable): ' +
    'Live embedding provider required. Cannot test semantic behavior.');
}
```

**DO NOT** create a fallback fake service. **DO NOT** return dummy vectors.

## REFERENCE

- `docs/LIVE_PROVIDERS_PLAYBOOK.md` - Full epistemological argument
- `docs/TEST.md` - Testing policy
- `AGENTS.md` - Root agent rules

---
**When in doubt: USE REAL PROVIDERS or FAIL HONESTLY. Never fake it.**
