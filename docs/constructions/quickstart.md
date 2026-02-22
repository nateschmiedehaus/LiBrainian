# Construction Quickstart (15 Minutes)

A Construction is a **typed, lazy recipe** for codebase intelligence.
Think of it as a meal plan: each `atom` is one reliable step, and operators
sequence, branch, and retry those steps predictably.

If you want operator tradeoffs at any point, keep
[`docs/constructions/operators.md`](./operators.md) open in another tab.

## 0-3 min: Install and import the essentials

```bash
npm install librainian
```

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
} from 'librainian/constructions';
```

## 3-5 min: First atom

Question this answers: "I need one focused transformation step."

```typescript
import { atom } from 'librainian/constructions';

const normalizePath = atom<string, string>('normalize-path', async (input) =>
  input.replaceAll('\\', '/').trim()
);

const result = await normalizePath.execute('src\\api\\index.ts');
console.log(result); // src/api/index.ts
```

- Output type: `Construction<string, string>`
- Decision details: [Construction Operator Decision Guide](./operators.md#question-atom).

## 5-8 min: Sequence (`>>>` = `seq`)

Question this answers: "Step B needs output from step A."

```typescript
import { atom, seq } from 'librainian/constructions';

const normalizePath = atom<string, string>('normalize-path', async (input) =>
  input.replaceAll('\\', '/').trim()
);

const basename = atom<string, string>('basename', async (path) =>
  path.split('/').at(-1) ?? path
);

const normalizeThenBasename = seq(normalizePath, basename);
const output = await normalizeThenBasename.execute('src\\api\\index.ts');
console.log(output); // index.ts
```

- Output type: if `A: I -> X` and `B: X -> O`, then `seq(A, B): I -> O`
- Decision details: [Construction Operator Decision Guide](./operators.md#question-seq).

## 8-10 min: Parallel (`&&&` = `fanout`)

Question this answers: "I need two independent analyses of the same input."

```typescript
import { atom, fanout } from 'librainian/constructions';

const charCount = atom<string, number>('char-count', async (s) => s.length);
const upper = atom<string, string>('upper', async (s) => s.toUpperCase());

const analyzeInParallel = fanout(charCount, upper);
const [count, upperValue] = await analyzeInParallel.execute('librainian');
console.log({ count, upperValue }); // { count: 10, upperValue: "LIBRAINIAN" }
```

- Output type: `Construction<I, [AOutput, BOutput]>`
- Decision details: [Construction Operator Decision Guide](./operators.md#question-fanout).

## 10-12 min: Fallback (`|||` = `fallback`)

Question this answers: "Try primary path, then backup only on failure."

```typescript
import { atom, fallback } from 'librainian/constructions';

const fastParse = atom<string, string>('fast-parse', async (s) => {
  if (!s.startsWith('{')) {
    throw new Error('not-json-like');
  }
  return 'fast-path';
});

const safeParse = atom<string, string>('safe-parse', async () => 'safe-path');
const resilient = fallback(fastParse, safeParse);

console.log(await resilient.execute('{ "ok": true }')); // fast-path
console.log(await resilient.execute('not json')); // safe-path
```

- Output type: `Construction<I, O>` (same input/output as both branches)
- Decision details: [Construction Operator Decision Guide](./operators.md#question-fallback).

## 12-14 min: Conditional (`select`) and iteration (`fix`)

Question this answers: "I need routing or bounded convergence."

```typescript
import { atom, left, right, select, fix } from 'librainian/constructions';

type Decision =
  | { tag: 'left'; value: number }
  | { tag: 'right'; value: string };

const route = atom<number, Decision>('route', async (n) => {
  const next = n + 1;
  return n < 10 ? { tag: 'left', value: next } : { tag: 'right', value: `done:${n}` };
});

const finalize = atom<number, string>('finalize', async (n) => `left:${n}`);
const conditional = select(route, finalize);

console.log(await conditional.execute(3));  // left:4
console.log(await conditional.execute(12)); // done:12

type Counter = { value: number };
const increment = atom<Counter, Counter>('increment', async (s) => ({ value: s.value + 1 }));

const boundedRefinement = fix(increment, {
  stop: (s) => s.value >= 5,
  metric: { measure: (s) => s.value, capacity: 5 },
  maxIter: 10,
});

console.log(await boundedRefinement.execute({ value: 0 }));
// { value: 5, iterations: 5, finalMeasure: 5, monotoneViolations: 0, cycleDetected: false, terminationReason: 'converged' }
```

- select output type: `Construction<I, B>` (B is the right branch output type)
- fix output type: `Construction<I, I & FixpointMetadata>`
- Decision details: [Construction Operator Decision Guide](./operators.md#question-select), [Fix loop guidance](./operators.md#question-fix).

## 14-15 min: Run against a real LiBrainian context

```typescript
import { initializeLibrarian } from 'librainian';
import { atom, select, left, right, fallback } from 'librainian/constructions';

type RuntimeIntent = { intent: string };
type Summary = { text: string; confidence: number };

const session = await initializeLibrarian(process.cwd());

const classify = atom<string, ReturnType<typeof left<RuntimeIntent>> | ReturnType<typeof right<Summary>>>(
  'classify-intent',
  async (input) => {
  return input.includes('security')
      ? left({ intent: input })
      : right({ text: `No-LLM path for "${input}"`, confidence: 0.42 });
  }
);

const summarize = atom<RuntimeIntent, Summary>('summarize-security', async (payload, ctx) => {
  const librarian = (ctx?.deps as { librarian: { queryOptional: (input: { intent: string; depth?: string }) => Promise<{ summary?: string } | null> } } | undefined)?.librarian;
  if (!librarian) {
    return { text: `no-librarian:${payload.intent}`, confidence: 0.4 };
  }

  const response = await librarian.queryOptional({ intent: payload.intent, depth: 'L1' });
  return {
    text: response?.summary ?? 'No summary',
    confidence: Number(response?.answerConfidence ?? 0.7),
  };
});

const routeSummary = select(classify, summarize);
const safeSummary = atom<string, Summary>('backup-summary', async (raw) => ({
  text: `safe fallback for: ${raw}`,
  confidence: 0.2,
}));
const realRun = fallback(routeSummary, safeSummary);

const final = await realRun.execute('How is auth wired?', {
  deps: { librarian: session.librarian },
  signal: new AbortController().signal,
  sessionId: 'quickstart',
});

console.log(final);
```

## Operator Cheat Sheet

- `atom`: one focused step
- `seq` (`>>>`): run B after A when B needs A's output
- `fanout` (`&&&`): run independent analyses together
- `fallback` (`|||`): backup path on typed failure
- `select`: static routing with visible branches
- `fix`: bounded iteration toward a stopping condition

## What's Next

- Cookbook: [docs/constructions/cookbook.md](./cookbook.md)
- Operator decision guide: [docs/constructions/operators.md](./operators.md)
- Testing guide: [docs/constructions/testing.md](./testing.md)
- Migration guide: [docs/constructions/migration.md](./migration.md)
- FreeConstruction design track: [GitHub issue #330](https://github.com/nateschmiedehaus/LiBrainian/issues/330)
- CLI construction browser: `npx librainian constructions list`
- Existing patterns: [docs/construction-patterns.md](../construction-patterns.md)
