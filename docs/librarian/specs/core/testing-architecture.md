# Testing Architecture Specification

> **Version**: 1.0.0
> **Status**: Canonical
> **Last Updated**: 2026-01-24

## Core Principle: Real Mode Guarantees World-Class Functionality

LiBrainian is an **agentic epistemological system**. Its value comes from producing meaningful understanding through LLM synthesis. Testing must verify this real behavior, not mocked approximations.

---

## Test Tier Hierarchy

### Tier-0: Deterministic Unit Tests
**Purpose**: Fast feedback on isolated logic
**Providers**: None (pure functions only)
**Mocks**: Allowed for external dependencies
**Runtime**: <1 second per test
**CI Gate**: Required to pass on every commit

```typescript
// TIER-0: Tests pure logic without providers
describe('confidence calculation', () => {
  it('clamps values to valid range', () => {
    expect(clampConfidence(1.5)).toBe(0.95);
    expect(clampConfidence(-0.1)).toBe(0.1);
  });
});
```

**What belongs in Tier-0**:
- Pure functions (math, string manipulation, data transformation)
- Type validation
- Configuration parsing
- Schema validation
- State machine transitions

**What does NOT belong in Tier-0**:
- Anything that calls LLM providers
- Anything that requires embeddings
- Anything that tests "understanding"

---

### Tier-1: Integration Tests (Provider-Optional)
**Purpose**: Verify component integration
**Providers**: Real when available, skip gracefully when not
**Mocks**: Minimal - only for isolation, not for provider simulation
**Runtime**: <30 seconds per test
**CI Gate**: Skip with warning if providers unavailable

```typescript
// TIER-1: Uses real providers, skips gracefully
describe('semantic search', () => {
  it('finds relevant context packs', async (ctx) => {
    const status = await checkAllProviders();
    ctx.skip(!status.embedding.available, 'unverified_by_trace(provider_unavailable): Embedding provider unavailable');

    const results = await semanticSearch('authentication flow');
    expect(results.length).toBeGreaterThan(0);
  });
});
```

---

### Tier-2: System Tests (Provider-Required)
**Purpose**: Verify end-to-end agentic behavior
**Providers**: Required - fail if unavailable
**Mocks**: Forbidden
**Runtime**: <5 minutes per test
**CI Gate**: Required for release, can be skipped in fast CI

```typescript
// TIER-2: Requires real providers, fails honestly
import { requireProviders } from '../api/provider_check.js';

describe('LIB-S1: High-level LiBrainian API', () => {
  it('should respond to queries within timeout', async () => {
    // Fail fast (and honestly) if providers are missing
    await requireProviders({ llm: true, embedding: true });

    const LiBrainian = new LiBrainian({ workspace });
    await LiBrainian.initialize();

    const response = await LiBrainian.query('explain auth module');

    expect(response.packs.length).toBeGreaterThan(0);
    expect(response.synthesizedResponse).toBeDefined();
  });
});
```

---

## Provider Dependency Rules

### The Golden Rule

> **Tier-0 tests do not use providers. Tier-1 tests use real providers or skip (as SKIPPED, not silently passed). Tier-2 tests require real providers and fail fast if unavailable.**

### Why This Matters

| Approach | What It Tests | Value |
|----------|---------------|-------|
| Mocked provider | Your assumptions about provider behavior | Low - proves nothing about real system |
| Skipped when unavailable | Nothing (but doesn't lie) | Honest - no false confidence |
| Real provider | Actual system behavior | High - proves the system works |

### Provider Mock Policy

**ALLOWED**: Mocking provider discovery/initialization to avoid timeouts in unit tests

```typescript
// ALLOWED: Mock to avoid timeout in unit test
vi.mock('../api/provider_check.js', () => ({
  requireProviders: vi.fn().mockRejectedValue(
    new ProviderUnavailableError({ message: 'unavailable', missing: ['LLM'], suggestion: '' })
  ),
}));
```

**FORBIDDEN**: Mocking provider responses to simulate successful LLM calls

```typescript
// FORBIDDEN: This tests your assumptions, not reality
vi.mock('../api/llm_service.js', () => ({
  synthesize: vi.fn().mockResolvedValue({
    answer: 'Mocked answer about authentication...',
    confidence: 0.9,
  }),
}));
```

**ALLOWED (Tier‑0 only, wiring/format tests)**: Stubbing the *LLM adapter surface* to validate deterministic mechanics

This is permitted when the test is **not** claiming semantic correctness (e.g., it asserts prompt formatting, JSON parsing, evidence/trace metadata, or “fail-closed” behavior).

Concrete example (adapter stub, not a “semantic success” claim):

```typescript
import { setDefaultLlmServiceFactory, clearDefaultLlmServiceFactory } from '../adapters/llm_service.js';

beforeEach(() => {
  setDefaultLlmServiceFactory(async () => ({
    chat: async ({ provider }) => ({ provider, content: JSON.stringify({ purpose: 'x', summary: 'y' }) }),
    checkClaudeHealth: async () => ({ provider: 'claude', available: true, authenticated: true, lastCheck: Date.now() }),
    checkCodexHealth: async () => ({ provider: 'codex', available: false, authenticated: false, lastCheck: Date.now() }),
  }));
});

afterEach(() => clearDefaultLlmServiceFactory());
```

---

## Global Test Configuration

### Skipping Must Be a Real Skip (Not a Silent Pass)

In Vitest, returning early from a test marks it as **passed**, not skipped. That is **theater** (it hides missing validation behind green tests).

Use `ctx.skip(...)` so reports and gates record a real skip reason:

```typescript
import { it } from 'vitest';
import { checkAllProviders } from '../api/provider_check.js';

it('semantic search uses real embeddings when available', async (ctx) => {
  const status = await checkAllProviders();
  ctx.skip(
    !status.embedding.available,
    `unverified_by_trace(provider_unavailable): Embedding: ${status.embedding.error ?? 'unavailable'}`
  );

  // ... real assertions that only run when providers are available ...
});
```

### Single Mock Setup (Not Scattered Mocks)

Provider mocks should be centralized in test setup, not scattered across files.

**File**: `packages/LiBrainian/vitest.setup.ts`

```typescript
import { vi } from 'vitest';

// Environment-based provider behavior
const LIBRARIAN_TEST_MODE = process.env.LIBRARIAN_TEST_MODE ?? 'unit';

if (LIBRARIAN_TEST_MODE === 'unit') {
  // Tier-0: Mock provider discovery to fail fast
  vi.mock('./src/api/provider_check.js', () => ({
    requireProviders: vi.fn().mockRejectedValue(
      new Error('unverified_by_trace(provider_unavailable): Test mode')
    ),
    checkAllProviders: vi.fn().mockResolvedValue({
      llm: { available: false, error: 'test_mode' },
      embedding: { available: false, error: 'test_mode' },
    }),
  }));
}
// Tier-1 and Tier-2: No mocks - use real providers
```

**File**: `packages/LiBrainian/vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: process.env.LIBRARIAN_TEST_MODE === 'system' ? 300000 : 5000,
  },
});
```

### Running Different Tiers

```bash
# Tier-0: Fast, no providers (CI default)
LIBRARIAN_TEST_MODE=unit npm --prefix packages/LiBrainian test -- --run

# Tier-1: With providers, skips if unavailable
LIBRARIAN_TEST_MODE=integration npm --prefix packages/LiBrainian test -- --run

# Tier-2: Requires providers, fails if unavailable
LIBRARIAN_TEST_MODE=system npm --prefix packages/LiBrainian test -- --run src/__tests__/mvp_librarian.system.test.ts
```

---

## Test File Organization

### Naming Conventions

| Pattern | Tier | Providers |
|---------|------|-----------|
| `*.test.ts` | 0 | None |
| `*.integration.test.ts` | 1 | Optional |
| `*.system.test.ts` | 2 | Required |
| `*.live.test.ts` | 2 | Required |

---

## Tier‑2 Scenario Families (Required for “full build” claims)

Tier‑2 is where LiBrainian proves it is a world-class knowledge tool under real conditions. “We have specs” or “Tier‑0 is green” is not sufficient.

**Non-negotiable requirement**:
- LiBrainian is not “full build” unless Tier‑2 includes **≥ 30 scenario families** that span:
  - repo profiles (R0–R4),
  - workloads (W0–W3),
  - dependency/storage modes (D0–D3 / S0–S2),
  - and relevant edge cases (E1–E8).

Canonical definition and the required SF‑01…SF‑30 set:
- `docs/LiBrainian/specs/README.md` (“Full Build Charter (Council of 30)” → “Tier‑2 scenario families”)

**Artifact requirement (no theater)**:
- Each scenario family run must emit audit artifacts (at minimum):
  - `AdequacyReport.v1.json`
  - `TraceReplayReport.v1.json`
  - `PerformanceReport.v1.json` (when performance-sensitive)
- Any “pass” claim without artifacts is forbidden.

Implementation guidance:
- Keep Tier‑2 suites end-to-end and provider-real. No mocks.
- Include negative controls (must-refuse / must-disclose / must-surface-conflict).
- If providers are unavailable, Tier‑2 must fail honestly with `unverified_by_trace(provider_unavailable)` (do not skip Tier‑2).

### Directory Structure

```
packages/LiBrainian/
├── src/
│   ├── __tests__/                 # Tiered tests by suffix
│   │   ├── *.test.ts              # Tier-0 (deterministic)
│   │   ├── *.integration.test.ts  # Tier-1 (provider-optional)
│   │   └── *.system.test.ts       # Tier-2 (provider-required)
│   ├── api/__tests__/             # Same naming rules under api
│   ├── epistemics/__tests__/      # Same naming rules under epistemics
│   └── ...
├── test/                          # Additional Tier-2+ tests (optional)
│   └── *.system.test.ts
└── vitest.setup.ts          # Global mock configuration
```

---

## Verification Protocol

### Before Release

1. **Tier-0 Gate** (Required, <2 minutes):
   ```bash
   LIBRARIAN_TEST_MODE=unit npm --prefix packages/LiBrainian test -- --run
   ```

2. **Tier-1 Gate** (Required if providers available, <10 minutes):
   ```bash
   LIBRARIAN_TEST_MODE=integration npm --prefix packages/LiBrainian test -- --run
   ```

3. **Tier-2 Gate** (Required for release, <30 minutes):
   ```bash
   LIBRARIAN_TEST_MODE=system npm --prefix packages/LiBrainian test -- --run test/system/
   ```

### Evidence Requirements

Every test run must produce:
- Pass/fail counts with tier breakdown
- Provider availability status
- Skip reasons for any skipped tests
- Trace refs for system tests

---

## Anti-Patterns

### Forbidden Patterns

| Pattern | Why It's Forbidden | Correct Approach |
|---------|-------------------|------------------|
| Mocking LLM responses | Tests assumptions, not reality | Use real provider or skip |
| Scattered provider mocks | Hard to maintain, inconsistent | Centralize in setup file |
| Tests that pass without providers | False confidence | Fail or skip honestly |
| "Degraded mode" fallbacks | Hides real failures | Throw ProviderUnavailableError |
| Timeouts masking provider issues | Silent failures | Fail fast with clear error |

### The Mock Smell Test

If you're writing a mock, ask:
1. **Am I mocking to avoid a timeout?** - OK, but centralize it
2. **Am I mocking to simulate success?** - NOT OK, use real provider
3. **Am I mocking to test error handling?** - OK if testing your code's response to errors
4. **Am I mocking because real tests are "too slow"?** - NOT OK, fix the slow test or move to higher tier

---

## Implementation Checklist

- [x] Create `vitest.setup.ts` with centralized provider mocks (2026-01-24)
- [x] Add `LIBRARIAN_TEST_MODE` environment variable support (2026-01-24)
- [x] Migrate scattered mocks to global setup (2026-01-24)
- [x] Add test tier naming conventions (2026-01-24)
- [ ] Create npm scripts for each tier
- [ ] Update CI to run tiers appropriately
- [ ] Add provider status to test output

---

## TDD Requirements

### Spec Test Design

Every component spec MUST include:

```markdown
## Testing Requirements

### Tier-0 Tests (Deterministic)
| Test | Input | Expected Output |
|------|-------|-----------------|
| ... | ... | ... |

### Tier-1 Tests (Integration)
| Test | Preconditions | Expected Behavior |
|------|---------------|-------------------|
| ... | ... | ... |

### Tier-2 Tests (System)
| Scenario | Provider Requirements | Success Criteria |
|----------|----------------------|------------------|
| ... | ... | ... |
```

### BDD Scenarios

```gherkin
Feature: Context Pack Retrieval

  @tier-0
  Scenario: Confidence clamping
    Given a raw confidence value of 1.5
    When the value is clamped
    Then the result should be 0.95

  @tier-1
  Scenario: Semantic search with real embeddings
    Given embedding provider is available
    And the workspace is bootstrapped
    When I search for "authentication"
    Then I should receive relevant context packs

  @tier-2
  Scenario: Full query pipeline
    Given LLM and embedding providers are available
    And the workspace is bootstrapped
    When I query "explain the auth module"
    Then I should receive a synthesized response
    And the response should cite evidence
```

---

## Tier-2 Provider Fail-Fast (Preferred)

Tier-2 tests should be **honest and fast** when providers are missing. Prefer an explicit fail-fast check:

```typescript
import { describe, it } from 'vitest';
import { requireProviders } from '../api/provider_check.js';

describe('Tier-2: end-to-end query', () => {
  it('fails fast if providers unavailable', async () => {
    await requireProviders({ llm: true, embedding: true });
    // ... then run the real end-to-end assertions ...
  });
});
```

---

## Summary

| Tier | Speed | Providers | Mocks | CI Requirement |
|------|-------|-----------|-------|----------------|
| 0 | <1s | None | Allowed | Always |
| 1 | <30s | Optional | Minimal | When available |
| 2 | <5min | Required | Forbidden | For release |

**The goal is world-class functionality in real mode, not impressive test counts with mocked behavior.**
