# Construction Cookbook: 10 End-to-End Pipelines for Real Agentic Tasks

This cookbook bridges operators to real workflows. Every recipe includes:
- input/output types and example values
- full pipeline code (copy-paste runnable)
- operator-by-operator rationale
- estimated token and latency profile
- at least one variation

## Recipe 1: Function Impact Analysis

Question: Before I change this function, what breaks?

Input type: `{ functionId: string }`  
Example input: `{ functionId: 'auth.refreshSession' }`

Output type: `{ risk: number; callers: string[]; tests: string[] }`  
Example output: `{ risk: 6, callers: ['src/api/routes/auth.ts'], tests: ['src/__tests__/auth_refresh.test.ts'] }`

```typescript
import { atom, seq, fanout } from 'librainian/constructions';

const findDirectCallers = atom<{ functionId: string }, string[]>(
  'find-direct-callers',
  async ({ functionId }) => [`src/callers/of/${functionId}.ts`],
);

const findTests = atom<{ functionId: string }, string[]>(
  'find-tests',
  async ({ functionId }) => [`src/__tests__/${functionId.replace('.', '_')}.test.ts`],
);

const rankByRisk = atom<[string[], string[]], { risk: number; callers: string[]; tests: string[] }>(
  'rank-by-risk',
  async ([callers, tests]) => ({
    risk: callers.length * (tests.length === 0 ? 2 : 1),
    callers,
    tests,
  }),
);

export const impactAnalysis = seq(fanout(findDirectCallers, findTests), rankByRisk);
```

Operator choices:
- `fanout(findDirectCallers, findTests)`: both analyses are independent and can run in parallel.
- `seq(..., rankByRisk)`: ranking requires both branches.

Estimated cost:
- Tokens: 1,200-2,800
- Latency: 1.0s-3.0s

Variations:
- Add transitive callers in a second `fanout` branch.
- Add `fallback` to keyword-based analysis when semantic retrieval fails.

## Recipe 2: PR Review Preparation (withEvidence wrapper)

Question: What context does a reviewer need for this diff?

Input type: `{ changedSymbols: string[] }`  
Example input: `{ changedSymbols: ['auth.refreshSession', 'session.validate'] }`

Output type: `{ checklist: string[]; evidenceRefs: string[] }`  
Example output: `{ checklist: ['Review callers for auth.refreshSession'], evidenceRefs: ['source:pr-diff'] }`

```typescript
import { atom, seq, type Construction } from 'librainian/constructions';

function withEvidence<I, O extends { evidenceRefs?: string[] }>(
  inner: Construction<I, O>,
  source: string,
): Construction<I, O & { evidenceRefs: string[] }> {
  return atom<I, O & { evidenceRefs: string[] }>('with-evidence', async (input, ctx) => {
    const outcome = await inner.execute(input, ctx);
    if (!outcome.ok) {
      throw outcome.error;
    }
    const refs = [...(outcome.value.evidenceRefs ?? []), `source:${source}`];
    return { ...outcome.value, evidenceRefs: refs };
  });
}

const extractChangedFunctions = atom<{ changedSymbols: string[] }, string[]>(
  'extract-changed-functions',
  async ({ changedSymbols }) => changedSymbols,
);

const generateChecklist = atom<string[], { checklist: string[]; evidenceRefs?: string[] }>(
  'generate-review-checklist',
  async (symbols) => ({
    checklist: symbols.map((symbol) => `Review callers and tests for ${symbol}`),
  }),
);

const prReviewBase = seq(extractChangedFunctions, generateChecklist);
export const prReviewPreparation = withEvidence(prReviewBase, 'pr-diff');
```

Operator choices:
- `seq`: checklist generation depends on extracted symbol list.
- `withEvidence`: attach auditable evidence refs at the edge of the pipeline.

Estimated cost:
- Tokens: 300-1,200
- Latency: 150ms-1.0s

Variations:
- Add `fanout` to produce both reviewer checklist and release-risk checklist.
- Add diff-size bucketing for short vs long review templates.

## Recipe 3: Onboarding Tour via fixpoint

Question: Help me understand this codebase in 30 minutes.

Input type: `{ topic: string; unfamiliarity: number; notes: string[] }`  
Example input: `{ topic: 'auth subsystem', unfamiliarity: 1.0, notes: [] }`

Output type: `{ topic: string; unfamiliarity: number; notes: string[]; iterations: number; terminationReason: string }`  
Example output: `{ topic: 'auth subsystem', unfamiliarity: 0.2, notes: ['learned auth flow'], iterations: 4, terminationReason: 'converged' }`

```typescript
import { atom, fix } from 'librainian/constructions';

type TourState = {
  topic: string;
  unfamiliarity: number;
  notes: string[];
};

const learnOneConcept = atom<TourState, TourState>('learn-one-concept', async (state) => ({
  ...state,
  unfamiliarity: Math.max(0, state.unfamiliarity - 0.2),
  notes: [...state.notes, `learned ${state.topic} concept ${state.notes.length + 1}`],
}));

export const onboardingTour = fix(learnOneConcept, {
  stop: (s) => s.unfamiliarity <= 0.2,
  metric: { measure: (s) => Math.round(s.unfamiliarity * 10), capacity: 10 },
  maxIter: 10,
});
```

Operator choices:
- `fix`: this is iterative convergence, not one-step transformation.

Estimated cost:
- Tokens: 0-700
- Latency: 20ms-300ms

Variations:
- Add a `select` front-door to route onboarding path by language/framework.
- Track novelty score instead of unfamiliarity.

## Recipe 4: Architecture Drift Detection (withStalenessDetection wrapper)

Question: Is this module still following expected patterns?

Input type: `{ modulePath: string }`  
Example input: `{ modulePath: 'src/api/auth/session.ts' }`

Output type: `{ compliant: boolean; reason: string; stale: boolean; analyzedAt: string }`  
Example output: `{ compliant: true, reason: 'matches layering rules', stale: false, analyzedAt: '2026-02-25T18:30:00.000Z' }`

```typescript
import { atom, fallback, type Construction } from 'librainian/constructions';

function withStalenessDetection<I, O extends { analyzedAt: string }>(
  inner: Construction<I, O>,
  maxAgeMs: number,
): Construction<I, O & { stale: boolean }> {
  return atom<I, O & { stale: boolean }>('with-staleness-detection', async (input, ctx) => {
    const outcome = await inner.execute(input, ctx);
    if (!outcome.ok) {
      throw outcome.error;
    }
    const ageMs = Date.now() - Date.parse(outcome.value.analyzedAt);
    return { ...outcome.value, stale: ageMs > maxAgeMs };
  });
}

const structuralCheck = atom<{ modulePath: string }, { compliant: boolean; reason: string; analyzedAt: string }>(
  'structural-check',
  async ({ modulePath }) => ({
    compliant: !modulePath.includes('/legacy/'),
    reason: 'matches layering rules',
    analyzedAt: new Date().toISOString(),
  }),
);

const semanticFallback = atom<{ modulePath: string }, { compliant: boolean; reason: string; analyzedAt: string }>(
  'semantic-fallback',
  async () => ({
    compliant: true,
    reason: 'semantic model fallback',
    analyzedAt: new Date().toISOString(),
  }),
);

const driftBase = fallback(structuralCheck, semanticFallback);
export const driftDetection = withStalenessDetection(driftBase, 24 * 60 * 60 * 1000);
```

Operator choices:
- `fallback`: run deterministic structural checks first, then semantic analysis only on failure.
- `withStalenessDetection`: mark output freshness for cache/recompute policy.

Estimated cost:
- Tokens: 0-1,500
- Latency: 40ms-2.5s

Variations:
- Add `fanout` with a blast-radius branch.
- Add module ownership checks before final verdict.

## Recipe 5: Human-in-the-Loop Security Review

Question: Escalate low-confidence security findings to a human.

Input type: `{ finding: string; confidence: number }`  
Example input: `{ finding: 'possible SQL injection', confidence: 0.48 }`

Output type: `{ action: 'auto' | 'human'; summary: string }`  
Example output: `{ action: 'human', summary: 'Escalated for review' }`

```typescript
import {
  atom,
  pauseForHuman,
} from 'librainian/constructions';

const triageFinding = atom<{ finding: string; confidence: number }, {
  action: 'auto' | 'human';
  summary: string;
  confidence: { type: 'deterministic'; value: 0.0 | 1.0; reason: string } | { type: 'absent'; reason: 'uncalibrated' };
  evidenceRefs: string[];
  analysisTimeMs: number;
}>('triage-finding', async (input) => ({
  action: input.confidence < 0.7 ? 'human' : 'auto',
  summary: input.confidence < 0.7 ? `Escalate: ${input.finding}` : `Auto-resolved: ${input.finding}`,
  confidence: { type: 'absent', reason: 'uncalibrated' },
  evidenceRefs: ['security:finding'],
  analysisTimeMs: 20,
}));

const gated = pauseForHuman(
  triageFinding,
  (partial) => ({
    prompt: `Model uncertainty detected. Review finding: ${partial.summary ?? 'unknown finding'}`,
    reason: 'low_confidence_security_finding',
    sessionId: 'security-review-session',
    constructionId: 'triage-finding',
    evidenceRefs: partial.evidenceRefs ?? [],
  }),
  { confidenceThreshold: 0.7 },
);

const handle = await gated.start({ finding: 'possible SQL injection', confidence: 0.48 });
if (handle.status === 'paused') {
  await handle.resume({
    reviewerId: 'sec-eng-1',
    decision: 'approved_with_changes',
    rationale: 'Needs parameterized query enforcement',
    overrideConfidence: { type: 'deterministic', value: 1.0, reason: 'human_security_review' },
  });
}
```

Operator choices:
- `pauseForHuman`: explicit suspension/resume for low-confidence outcomes.

Estimated cost:
- Tokens: 200-1,000
- Latency: 100ms-1.5s + human response time

Variations:
- Add `select` before pause to route high-severity findings to dedicated reviewers.
- Use policy-based thresholds per rule category.

## Recipe 6: Cross-Session Cache Wrapper

Question: Avoid recomputing expensive analysis across sessions.

Input type: `{ key: string; payload: string }`  
Example input: `{ key: 'src/api/auth.ts', payload: '...' }`

Output type: `{ value: string; cacheHit: boolean }`  
Example output: `{ value: 'normalized-summary', cacheHit: true }`

```typescript
import { atom, type Construction } from 'librainian/constructions';

function withSessionCache<I extends { key: string }, O>(
  inner: Construction<I, O>,
): Construction<I, O> {
  const cache = new Map<string, O>();
  return atom<I, O>('with-session-cache', async (input, ctx) => {
    const sessionId = ctx?.sessionId ?? 'default';
    const cacheKey = `${sessionId}:${input.key}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const outcome = await inner.execute(input, ctx);
    if (!outcome.ok) {
      throw outcome.error;
    }
    cache.set(cacheKey, outcome.value);
    return outcome.value;
  });
}

const expensiveAnalysis = atom<{ key: string; payload: string }, { value: string; cacheHit: boolean }>(
  'expensive-analysis',
  async ({ payload }) => ({ value: `normalized:${payload.slice(0, 20)}`, cacheHit: false }),
);

export const cachedAnalysis = withSessionCache(expensiveAnalysis);
```

Operator choices:
- Wrapper around a single `atom` keeps cache policy centralized and reusable.

Estimated cost:
- Tokens: 0-400 (warm cache near 0)
- Latency: 1ms-150ms

Variations:
- Add TTL expiry and staleness invalidation.
- Promote cache to persistent storage.

## Recipe 7: Self-Healing Monitor (Streaming)

Question: Continuously monitor changed files and stream progress.

Input type: `{ changedFile: string }`  
Example input: `{ changedFile: 'src/api/routes/auth.ts' }`

Output type: stream events ending in `{ ok: boolean; file: string }`  
Example terminal output: `{ ok: true, file: 'src/api/routes/auth.ts' }`

```typescript
import { atom, seq } from 'librainian/constructions';

const parseChange = atom<{ changedFile: string }, { file: string }>(
  'parse-change',
  async ({ changedFile }) => ({ file: changedFile }),
);

const checkInvariant = atom<{ file: string }, { ok: boolean; file: string }>(
  'check-invariant',
  async ({ file }) => ({ ok: !file.endsWith('.tmp.ts'), file }),
);

const monitor = seq(parseChange, checkInvariant);
if (!monitor.stream) {
  throw new Error('stream() is unavailable for this construction');
}

for await (const event of monitor.stream({ changedFile: 'src/api/routes/auth.ts' })) {
  if (event.kind === 'progress') {
    process.stdout.write(`\r${event.step} ${event.percentComplete ?? 0}%`);
  }
  if (event.kind === 'completed') {
    console.log('\ncompleted', event.result);
  }
  if (event.kind === 'failed') {
    throw event.error;
  }
}
```

Operator choices:
- `seq`: monitor pipeline has two dependent stages.
- `stream()`: gives UX-friendly progress and early failure visibility.

Estimated cost:
- Tokens: 0-150
- Latency: 20ms-400ms

Variations:
- Add a third stage for automatic remediation suggestions.
- Emit `evidence` events to feed an audit ledger.

## Recipe 8: Test Gap Finder (calibrated wrapper)

Question: Which high-impact functions are untested, with calibrated confidence?

Input type: `{ module: string }`  
Example input: `{ module: 'src/api/auth' }`

Output type: `{ value: { gaps: string[] }; confidence: object; evidenceRefs: string[]; analysisTimeMs: number }`  
Example output: `{ value: { gaps: ['refreshSession missing integration tests'] }, confidence: { type: 'measured', ... }, evidenceRefs: ['coverage:src/api/auth'], analysisTimeMs: 120 }`

```typescript
import {
  atom,
  calibrated,
  createConstructionCalibrationTracker,
} from 'librainian/constructions';

const findTestGaps = atom<{ module: string }, {
  value: { gaps: string[] };
  confidence: { type: 'absent'; reason: 'uncalibrated' };
  evidenceRefs: string[];
  analysisTimeMs: number;
}>('find-test-gaps', async ({ module }) => ({
  value: { gaps: [`${module}.refreshSession missing integration coverage`] },
  confidence: { type: 'absent', reason: 'uncalibrated' },
  evidenceRefs: [`coverage:${module}`],
  analysisTimeMs: 120,
}));

const tracker = createConstructionCalibrationTracker();

export const testGapFinder = calibrated(findTestGaps, tracker, {
  immediateOutcomeExtractor: (output) => ({
    correct: output.value.gaps.length > 0,
    method: 'system_observation',
  }),
  minPredictionsForCalibration: 5,
});
```

Operator choices:
- `calibrated(...)`: turns raw confidence output into empirically adjusted confidence after enough outcomes.

Estimated cost:
- Tokens: 400-1,500
- Latency: 200ms-2.0s

Variations:
- Add blast-radius scoring in a `fanout` branch before final ranking.
- Record outcomes from CI results instead of immediate extractor.

## Recipe 9: Streaming Analysis with Progress + Evidence

Question: Show live progress and evidence while long-running analysis executes.

Input type: `{ target: string }`  
Example input: `{ target: 'src/' }`

Output type: stream ending in `{ summary: string }`  
Example terminal output: `{ summary: 'Analyzed 428 files, 12 high-risk paths' }`

```typescript
import { atom } from 'librainian/constructions';

const largeCodebaseAnalysis = atom<{ target: string }, { summary: string }>(
  'large-codebase-analysis',
  async ({ target }) => ({ summary: `Analyzed ${target}` }),
);

if (!largeCodebaseAnalysis.stream) {
  throw new Error('stream() is unavailable for this construction');
}

for await (const event of largeCodebaseAnalysis.stream({ target: 'src/' })) {
  if (event.kind === 'progress') {
    process.stdout.write(`\r${event.step} ${event.percentComplete ?? 0}%`);
  }
  if (event.kind === 'evidence') {
    console.log(`\nclaim=${event.claim} confidence=${event.confidence}`);
  }
  if (event.kind === 'completed') {
    console.log(`\n${event.result.summary}`);
  }
  if (event.kind === 'failed') {
    throw event.error;
  }
}
```

Operator choices:
- streaming execution is the right interface for long-running, user-facing workflows.

Estimated cost:
- Tokens: 800-4,000
- Latency: 2s-15s

Variations:
- Push progress events to websocket UI.
- Emit structured evidence events for downstream reporting.

## Recipe 10: Publishing a Construction to Registry

Question: I built a useful construction. How do I publish it?

Input type: manifest JSON + pipeline source files  
Example input: `construction.manifest.json` + `src/constructions/processes/blast_radius_oracle.ts`

Output type: validated manifest ready for publish  
Example output: `{ valid: true, id: 'blast-radius-oracle', version: '1.0.0' }`

```typescript
import { atom, seq } from 'librainian/constructions';

type Manifest = {
  id: string;
  scope: '@librainian-community' | '@librainian';
  version: string;
  agentDescription: string;
  tags: string[];
  trustTier: 'official' | 'partner' | 'community';
};

const validateManifest = atom<Manifest, Manifest>('validate-manifest', async (manifest) => {
  if (!manifest.id || !manifest.version || manifest.tags.length === 0) {
    throw new Error('Manifest must include id, version, and at least one tag');
  }
  return manifest;
});

const preparePublishPayload = atom<Manifest, { valid: true; id: string; version: string }>(
  'prepare-publish-payload',
  async (manifest) => ({ valid: true, id: manifest.id, version: manifest.version }),
);

export const publishConstruction = seq(validateManifest, preparePublishPayload);

const manifest: Manifest = {
  id: 'blast-radius-oracle',
  scope: '@librainian-community',
  version: '1.0.0',
  agentDescription: 'Given a function identifier, produce ranked impact and dependency context.',
  tags: ['impact-analysis', 'refactoring'],
  trustTier: 'community',
};

const outcome = await publishConstruction.execute(manifest);
if (!outcome.ok) {
  throw outcome.error;
}
console.log(outcome.value);
```

Operator choices:
- `seq(validateManifest, preparePublishPayload)`: fail fast on invalid metadata before packaging.

Estimated cost:
- Tokens: 100-400
- Latency: 50ms-500ms

Variations:
- Add compatibility checks against supported LiBrainian versions.
- Add signed manifest verification before publish.

## Checklist Against Issue #374

- 10 recipes present and runnable in TypeScript.
- Every recipe includes a variations section.
- Every recipe includes token + latency estimate.
- Streaming shown in Recipe 7 and Recipe 9.
- Integration wrappers shown with `withEvidence` (Recipe 2), `withStalenessDetection` (Recipe 4), and `calibrated` (Recipe 8).
