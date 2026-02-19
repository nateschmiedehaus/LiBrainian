# Construction Cookbook: 10 End-to-End Pipelines

Each recipe includes:
- input/output shape
- full pipeline
- why each operator was chosen
- estimated token/latency profile
- variations

Common import set:

```typescript
import {
  atom,
  seq,
  fanout,
  fallback,
  fix,
  select,
  left,
  right,
  type Construction,
} from 'librainian/constructions';
```

Optional wrapper helpers used in some recipes:

```typescript
function withEvidence<I, O extends object>(
  inner: Construction<I, O>,
  source: string,
): Construction<I, O & { evidenceRefs: string[] }> {
  return atom<I, O & { evidenceRefs: string[] }>('with-evidence', async (input, ctx) => {
    const out = await inner.execute(input, ctx);
    return { ...out, evidenceRefs: [`source:${source}`] };
  });
}

function withStalenessDetection<I, O extends object>(
  inner: Construction<I, O>,
  maxAgeMs: number,
): Construction<I, O & { stale: boolean }> {
  const createdAt = Date.now();
  return atom<I, O & { stale: boolean }>('with-staleness', async (input, ctx) => {
    const out = await inner.execute(input, ctx);
    return { ...out, stale: Date.now() - createdAt > maxAgeMs };
  });
}
```

## Recipe 1: Function Impact Analysis

Input: `{ functionId: string }`  
Output: `{ risk: number; callers: string[]; tests: string[] }`

```typescript
const findDirectCallers = atom<{ functionId: string }, string[]>(
  'find-direct-callers',
  async ({ functionId }, ctx) => {
    const librarian = (ctx?.deps as { librarian: { query: Function } }).librarian;
    const q = await librarian.query({ intent: `direct callers of ${functionId}`, depth: 'L1' });
    return q.relatedFiles ?? [];
  },
);

const findTests = atom<{ functionId: string }, string[]>(
  'find-tests',
  async ({ functionId }, ctx) => {
    const librarian = (ctx?.deps as { librarian: { query: Function } }).librarian;
    const q = await librarian.query({ intent: `tests for ${functionId}`, depth: 'L1' });
    return q.relatedFiles ?? [];
  },
);

const rankRisk = atom<[string[], string[]], { risk: number; callers: string[]; tests: string[] }>(
  'rank-risk',
  async ([callers, tests]) => ({
    callers,
    tests,
    risk: callers.length * (tests.length === 0 ? 2 : 1),
  }),
);

export const impactAnalysis = seq(fanout(findDirectCallers, findTests), rankRisk);
```

Operator choices:
- `fanout`: callers/tests are independent.
- `seq`: ranking needs both outputs.

Estimated cost:
- Tokens: 1,500-3,000
- Latency: 1.5s-4s

Variation:
- Add `fallback` from semantic-query to keyword-query when provider is down.

## Recipe 2: PR Review Prep

Input: `{ diffSummary: string }`  
Output: `{ checklist: string[]; evidenceRefs: string[] }`

```typescript
const extractChangedSymbols = atom<{ diffSummary: string }, string[]>(
  'extract-changed-symbols',
  async ({ diffSummary }) => diffSummary.split('\n').filter(Boolean),
);

const buildChecklist = atom<string[], { checklist: string[] }>(
  'build-checklist',
  async (symbols) => ({
    checklist: symbols.map((s) => `Review callers and tests for: ${s}`),
  }),
);

export const prReviewPreparation = withEvidence(
  seq(extractChangedSymbols, buildChecklist),
  'pr-diff',
);
```

Operator choices:
- `seq`: second stage depends on extracted symbols.

Estimated cost:
- Tokens: 300-1,000
- Latency: 150ms-900ms

Variation:
- `fanout` reviewer checklist generation with a separate docs-impact checklist.

## Recipe 3: Onboarding Tour

Input: `{ topic: string; unfamiliarity: number }`  
Output: `{ topic: string; unfamiliarity: number; notes: string[]; iterations: number }`

```typescript
type TourState = { topic: string; unfamiliarity: number; notes: string[] };

const learnOneStep = atom<TourState, TourState>(
  'learn-one-step',
  async (state) => ({
    ...state,
    unfamiliarity: Math.max(0, state.unfamiliarity - 0.2),
    notes: [...state.notes, `Learned one concept for ${state.topic}`],
  }),
);

export const onboardingTour = fix(learnOneStep, {
  stop: (s) => s.unfamiliarity <= 0.2,
  metric: { measure: (s) => Math.round(s.unfamiliarity * 10), capacity: 10 },
  maxIter: 10,
});
```

Operator choices:
- `fix`: iterate until comprehension threshold.

Estimated cost:
- Tokens: 0-600
- Latency: 10ms-200ms

Variation:
- Route to language-specific tour modules with `select` before `fix`.

## Recipe 4: Architecture Drift Detection

Input: `{ modulePath: string }`  
Output: `{ compliant: boolean; reason: string }`

```typescript
const structuralCheck = atom<{ modulePath: string }, { compliant: boolean; reason: string }>(
  'structural-check',
  async ({ modulePath }) => ({ compliant: !modulePath.includes('/legacy/'), reason: 'structural-rule' }),
);

const semanticCheck = atom<{ modulePath: string }, { compliant: boolean; reason: string }>(
  'semantic-check',
  async ({ modulePath }) => ({ compliant: !modulePath.includes('/temp/'), reason: 'semantic-rule' }),
);

export const driftDetection = withStalenessDetection(
  fallback(structuralCheck, semanticCheck),
  24 * 60 * 60 * 1000,
);
```

Operator choices:
- `fallback`: fast path first, semantic fallback on failure.

Estimated cost:
- Tokens: 0-1,200
- Latency: 20ms-2s

Variation:
- Add `fanout` to compute both drift score and blast radius together.

## Recipe 5: Human-in-the-Loop Security Review

Input: `{ finding: string; confidence: number }`  
Output: `{ action: 'auto' | 'human'; summary: string }`

```typescript
const routeByConfidence = atom<
  { finding: string; confidence: number },
  ReturnType<typeof left<{ finding: string; confidence: number }>> | ReturnType<typeof right<{ finding: string; confidence: number }>>
>(
  'route-by-confidence',
  async (x) => (x.confidence < 0.7 ? left(x) : right(x)),
);

const requestHuman = atom<{ finding: string; confidence: number }, { action: 'human'; summary: string }>(
  'request-human',
  async (x) => ({ action: 'human', summary: `Escalate: ${x.finding}` }),
);

const autoResolve = atom<{ finding: string; confidence: number }, { action: 'auto'; summary: string }>(
  'auto-resolve',
  async (x) => ({ action: 'auto', summary: `Proceed: ${x.finding}` }),
);

const onLeft = seq(requestHuman, atom('identity-human', async (x: { action: 'human'; summary: string }) => x));
const onRight = autoResolve;

export const securityReview = seq(
  routeByConfidence,
  atom('collapse-either', async (v) => ('left' in v ? onLeft.execute(v.left) : onRight.execute(v.right))),
);
```

Operator choices:
- `select`-style routing (via explicit route + collapse) for confidence-based escalation.

Estimated cost:
- Tokens: 200-900
- Latency: 100ms-1.5s

Variation:
- Use `fallback(autoResolve, requestHuman)` if escalation should trigger only on explicit analysis failure.

## Recipe 6: Cross-Session Cached Analysis

Input: `{ key: string; payload: string }`  
Output: `{ value: string; cacheHit: boolean }`

```typescript
const cache = new Map<string, string>();

const expensiveAnalysis = atom<{ key: string; payload: string }, { value: string; cacheHit: boolean }>(
  'expensive-analysis',
  async ({ key, payload }) => {
    if (cache.has(key)) return { value: cache.get(key)!, cacheHit: true };
    const value = `analyzed:${payload}`;
    cache.set(key, value);
    return { value, cacheHit: false };
  },
);

export const cachedAnalysis = expensiveAnalysis;
```

Operator choices:
- single `atom`: caching handled internally for deterministic behavior.

Estimated cost:
- Tokens: 0-300
- Latency: 1ms-120ms

Variation:
- Combine with `fanout` to cache both structural and semantic analyses independently.

## Recipe 7: Self-Healing Monitor (Streaming)

Input: `{ changedFile: string }`  
Output: stream of progress events + final result

```typescript
type StreamEvent<T> =
  | { kind: 'progress'; percent: number }
  | { kind: 'completed'; result: T };

async function* streamConstruction<I, O>(
  construction: Construction<I, O>,
  input: I,
  ctx?: Parameters<Construction<I, O>['execute']>[1],
): AsyncGenerator<StreamEvent<O>> {
  yield { kind: 'progress', percent: 25 };
  yield { kind: 'progress', percent: 60 };
  const result = await construction.execute(input, ctx);
  yield { kind: 'completed', result };
}

const checkInvariant = atom<{ changedFile: string }, { ok: boolean; file: string }>(
  'check-invariant',
  async ({ changedFile }) => ({ ok: !changedFile.endsWith('.tmp.ts'), file: changedFile }),
);

for await (const event of streamConstruction(checkInvariant, { changedFile: 'src/api/index.ts' })) {
  if (event.kind === 'progress') console.log(`progress ${event.percent}%`);
  if (event.kind === 'completed') console.log(event.result);
}
```

Operator choices:
- atomic invariant check plus streaming wrapper for UI responsiveness.

Estimated cost:
- Tokens: 0-100
- Latency: 20ms-300ms

Variation:
- stream a `seq` pipeline and emit one progress event per stage completion.

## Recipe 8: Test Gap Finder with Calibration Wrapper

Input: `{ module: string }`  
Output: `{ gaps: string[]; confidence: number }`

```typescript
function calibrated<I, O extends object>(
  inner: Construction<I, O>,
  confidence = 0.8,
): Construction<I, O & { confidence: number }> {
  return atom<I, O & { confidence: number }>('calibrated-wrapper', async (input, ctx) => {
    const out = await inner.execute(input, ctx);
    return { ...out, confidence };
  });
}

const findGaps = atom<{ module: string }, { gaps: string[] }>(
  'find-gaps',
  async ({ module }) => ({ gaps: [`${module}:missing-test-path-A`] }),
);

export const testGapFinder = calibrated(findGaps, 0.82);
```

Operator choices:
- wrapper-based post-processing for confidence annotation.

Estimated cost:
- Tokens: 100-500
- Latency: 40ms-700ms

Variation:
- compute gaps and blast radius with `fanout`, then calibrate combined result.

## Recipe 9: Long Analysis Progress Stream

Input: `{ module: string }`  
Output: streamed progress with final ranked result

```typescript
const collectSignals = atom<{ module: string }, string[]>(
  'collect-signals',
  async ({ module }) => [`complexity:${module}`, `coverage:${module}`],
);

const rankSignals = atom<string[], { ranked: string[] }>(
  'rank-signals',
  async (signals) => ({ ranked: [...signals].sort() }),
);

const longAnalysis = seq(collectSignals, rankSignals);

for await (const event of streamConstruction(longAnalysis, { module: 'src/auth' })) {
  if (event.kind === 'progress') console.log(event.percent);
  if (event.kind === 'completed') console.log(event.result.ranked);
}
```

Operator choices:
- `seq` for deterministic two-stage ranking.
- streaming wrapper keeps interactive clients informed.

Estimated cost:
- Tokens: 200-900
- Latency: 120ms-1.2s

Variation:
- add `fallback` to recover from unavailable coverage data.

## Recipe 10: Package-Ready Construction Metadata

Input: manifest metadata + construction pipeline  
Output: publish-ready package contents

```json
{
  "id": "blast-radius-oracle",
  "scope": "@librainian-community",
  "version": "1.0.0",
  "agentDescription": "Given a symbol, return affected modules ranked by transitive impact and test coverage.",
  "inputSchema": {
    "type": "object",
    "properties": { "symbol": { "type": "string" } },
    "required": ["symbol"]
  },
  "outputSchema": {
    "type": "object",
    "properties": { "ranked": { "type": "array", "items": { "type": "string" } } },
    "required": ["ranked"]
  },
  "tags": ["impact-analysis", "refactoring"],
  "trustTier": "community"
}
```

Operator choices:
- package contract is independent from composition choice.

Estimated cost:
- Tokens: 0 (metadata only)
- Latency: N/A

Variation:
- publish official/partner/community variants with different trust tiers.

## Related

- Quickstart: `docs/constructions/quickstart.md`
- Operator guide: `docs/constructions/operators.md`
- Testing guide: `docs/constructions/testing.md`
- Migration guide: `docs/constructions/migration.md`
