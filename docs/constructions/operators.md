# Construction Operator Decision Guide

Choose operators by the question you are asking, not by memorizing names.

## Quick Link

- `atom`: one step
- `seq` (`>>>`): serial, dependent steps
- `fanout` (`&&&`): independent parallel branches
- `fallback` (`|||`): secondary path on typed failure
- `fix`: iterate toward convergence
- `select`: runtime branching based on previous output
- `map`, `dimap`, `contramap`, `mapError`: boundary adapters

## Decision Tree

### <a id="question-atom"></a>"I need one focused transformation."

Use `atom` when you have one unit of work and no inter-step semantics yet.

```typescript
import {
  atom,
  seq,
  fanout,
  fallback,
  select,
  fix,
  left,
  right,
  map,
  dimap,
  contramap,
  mapError,
} from 'librainian/constructions';

type RawIntent = {
  raw: string;
};

type CleanIntent = {
  raw: string;
  normalized: string;
};

const normalizeIntent = atom<RawIntent, CleanIntent>('normalize-intent', async (input) => ({
  ...input,
  normalized: input.raw.trim().toLowerCase(),
}));
```

### <a id="question-seq"></a>"Step B cannot start until it receives output from step A."

Use `seq` (`>>>`) when B depends on A's output.

```typescript
const stripNoise = atom<string, string>('strip-noise', async (text) =>
  text.replaceAll('\t', ' ').trim()
);

const splitWords = atom<string, string[]>('split-words', async (text) =>
  text.split(/\s+/)
);

const tokenize = seq(stripNoise, splitWords);
```

### <a id="question-fanout"></a>"I need two analyses of the same input, and they are independent."

Use `fanout` (`&&&`) for independent branches that share input.

```typescript
const countWords = atom<string, number>('count-words', async (text) => text.split(/\s+/).length);
const normalizeHash = atom<string, string>('normalize-hash', async (text) =>
  text.toLowerCase().replaceAll(/\s+/g, ' ')
);

const inspect = fanout(countWords, normalizeHash); // output: [words, signature]
```

### <a id="question-fallback"></a>"I want a fast path with reliable fallback on failure."

Use `fallback` (`|||`) when both constructions share the same input/output type.

```typescript
type Summary = { source: 'llm' | 'heuristic'; value: string };

const fastSummarizer = atom<string, Summary>('llm-summary', async (input) => {
  if (input.length > 3_000) {
    throw new Error('input too large');
  }
  return { source: 'llm', value: `llm:${input.slice(0, 24)}...` };
});

const safeSummarizer = atom<string, Summary>('heuristic-summary', async (input) => ({
  source: 'heuristic',
  value: `heuristic:${input.slice(0, 24)}...`,
}));

const robustSummary = fallback(fastSummarizer, safeSummarizer);
```

### <a id="question-select"></a>"I need runtime branching based on upstream output."

Use `select` when branching itself is important to type inference and path visibility.

```typescript
const classifyIntent = atom<string, ReturnType<typeof left> | ReturnType<typeof right>>(
  'classify-intent',
  async (text) =>
    text.includes('urgent')
      ? left({ path: 'escalate', normalized: text.trim() })
      : right({ path: 'standard', normalized: text.trim() }),
);

const escalatePath = atom<{ path: 'escalate'; normalized: string }, string>(
  'escalate',
  async (payload) => `Escalate: ${payload.normalized}`
);

const routeIntent = select(classifyIntent, escalatePath);
```

### <a id="question-fix"></a>"I need to iterate until measurable progress with explicit termination."

Use `fix` when iteration count is unknown up front.

```typescript
type ReviewState = {
  passes: number;
  candidate: string;
  confidence: number;
};

const refineCandidate = atom<ReviewState, ReviewState>('refine-candidate', async (state) => ({
  ...state,
  passes: state.passes + 1,
  confidence: Math.min(1, state.confidence + 0.12),
}));

const boundedRefinement = fix(refineCandidate, {
  stop: (state) => state.confidence >= 0.9,
  metric: { measure: (state) => state.confidence, capacity: 1 },
  maxIter: 8,
});
```

## Profunctor Boundary Operators

Use these when you need type boundary adaptation instead of wrapper atoms.

```typescript
const parseIssueText = atom<{ title: string; body: string }, { body: string }>(
  'parse-issue',
  async ({ body }) => ({ body })
);

const fromIssueShape = contramap(parseIssueText, (input: { id: string; title: string; body: string }) =>
  input
);

const normalizedOutput = map(fromIssueShape, ({ body }) => ({
  body,
  bodyPreview: body.slice(0, 32),
}));

const fullBoundary = dimap(
  parseIssueText,
  (input: { id: string; title: string; body: string }) => input.body,
  (value) => ({
    kind: 'issue',
    bodyPreview: value.body.slice(0, 32),
  })
);

const normalizedErrors = mapError(parseIssueText, (error) =>
  new Error(`parse failed: ${error.message}`)
);
```

- `contramap`: adapt only input.
- `map`: adapt only output.
- `dimap`: adapt both input and output.
- `mapError`: transform error channel consistently.

## Wrong Operator Patterns

| Intended | Mistake | Consequence |
|---|---|---|
| `fanout(A, B)` for independent analyses | `seq(A, B)` where `B` ignores output from `A` | unnecessary sequential latency |
| `fallback(A, B)` recovery | `fanout(A, B)` for backup behavior | both branches run and cost doubles |
| iterative behavior | manual `seq` loop like `seq(seq(...), ...)` | hidden termination behavior, harder auditing |
| typed branching | `select` modeled as plain `if` inside one atom | branches are invisible to path planning and budget estimation |
| boundary adaptation | wrapping in many atoms for shape fixes | brittle seam glue and weaker composition intent |

## One Realistic Pipeline Using All Five Operators

```typescript
import { atom, seq, fanout, fallback, select, fix, left, right } from 'librainian/constructions';

type RawTicket = {
  title: string;
  body: string;
  urgency: 'low' | 'high';
};

type EnrichedTicket = RawTicket & {
  normalized: string;
};

type Route = ReturnType<typeof left<{ priority: 'high'; title: string }>> | ReturnType<typeof right<ReviewState>>;
type ReviewState = { candidate: string; confidence: number; stable: boolean };

const normalize = atom<RawTicket, EnrichedTicket>('normalize', async (ticket) => ({
  ...ticket,
  normalized: ticket.body.trim().replaceAll(/\s+/g, ' '),
}));

const riskEstimate = atom<EnrichedTicket, number>('risk-estimate', async (ticket) =>
  Math.min(1, ticket.normalized.length / 200)
);
const localeCheck = atom<EnrichedTicket, { locale: string }>('locale-check', async (ticket) => ({
  locale: ticket.title.includes('ts') ? 'ts' : 'generic',
}));

const routeIntent = atom<EnrichedTicket, Route>('route-intent', async (ticket) => {
  return ticket.urgency === 'high'
    ? left({ priority: 'high', title: ticket.title })
    : right({
        candidate: `auto:${ticket.title}`,
        confidence: 0.68,
        stable: false,
      });
});

const escalate = atom<{ priority: 'high'; title: string }, ReviewState>('escalate', async (plan) => ({
  candidate: `escalate:${plan.title}`,
  confidence: 0.95,
  stable: false,
}));

const fallbackRoute = atom<EnrichedTicket, ReviewState>('fallback-route', async (ticket) => ({
  candidate: `fallback:${ticket.normalized.slice(0, 16)}`,
  confidence: 0.61,
  stable: false,
}));

const routed = select(routeIntent, escalate);
const robustRoute = fallback(routed, fallbackRoute);

const routeAndSignals = fanout(robustRoute, fanout(riskEstimate, localeCheck));
const mergedSignals = atom<
  [ReviewState, [number, { locale: string }]],
  ReviewState
>('merged-signals', async ([state, [risk, locale]) => ({
  ...state,
  candidate: `${state.candidate}|${locale.locale}|risk=${risk.toFixed(2)}`,
  confidence: Math.min(1, state.confidence + risk * 0.2),
  stable: risk < 1.4,
}));

const refine = atom<ReviewState, ReviewState>('refine', async (state) => ({
  ...state,
  candidate: `${state.candidate}:v1`,
  confidence: Math.min(1, state.confidence + 0.04),
}));

const stabilize = fix(refine, {
  stop: (state) => state.confidence >= 0.9 || state.stable,
  metric: { measure: (state) => state.confidence, capacity: 1 },
  maxIter: 4,
});

const summarize = atom<ReviewState, string>('summarize', async (state) => {
  return `${state.candidate} | confidence=${state.confidence.toFixed(2)} stable=${state.stable}`;
});

const pipeline = seq(
  normalize,
  seq(routeAndSignals, seq(mergedSignals, seq(stabilize, summarize)))
);

// note: this section demonstrates all five operators in context; adapt to your domain types before running.
```

## Related Docs

- Quickstart: [docs/constructions/quickstart.md](./quickstart.md)
- Cookbook: [docs/constructions/cookbook.md](./cookbook.md)
- Testing: [docs/constructions/testing.md](./testing.md)
- Migration: [docs/constructions/migration.md](./migration.md)
