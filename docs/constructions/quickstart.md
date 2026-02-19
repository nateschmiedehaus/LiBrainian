# Construction Quickstart (15 Minutes)

A Construction is a typed, lazy recipe for codebase intelligence.
You describe steps. LiBrainian executes them, preserves type seams, and keeps workflows composable.

If you want detailed operator tradeoffs while reading this page, keep `docs/constructions/operators.md` open in another tab.

## 0-3 min: Install and Import

```bash
npm install librainian
```

```typescript
import { atom, seq, fanout, fallback, fix, select, left, right } from 'librainian/constructions';
```

## 3-5 min: First Atom

Question this answers: "I need one focused transformation step."

```typescript
const normalizePath = atom<string, string>('normalize-path', async (input) =>
  input.replaceAll('\\', '/')
);

const first = await normalizePath.execute('src\\api\\index.ts');
console.log(first); // "src/api/index.ts"
```

Use `atom` when you want one focused step.
Output type: `Construction<string, string, ...>`.
Decision details: `docs/constructions/operators.md`.

## 5-8 min: Sequence (`>>>` = `seq`)

Question this answers: "Step B needs output from step A."

```typescript
const basename = atom<string, string>('basename', async (path) =>
  path.split('/').at(-1) ?? path
);

const normalizeThenBasename = seq(normalizePath, basename);
const output = await normalizeThenBasename.execute('src\\api\\index.ts');
console.log(output); // "index.ts"
```

Use `seq` when step B needs output from step A.
Output type: if `A: I -> X` and `B: X -> O`, then `seq(A, B): I -> O`.
Decision details: `docs/constructions/operators.md`.

## 8-10 min: Parallel (`&&&` = `fanout`)

Question this answers: "I need two independent analyses of the same input."

```typescript
const charCount = atom<string, number>('char-count', async (s) => s.length);
const upper = atom<string, string>('upper', async (s) => s.toUpperCase());

const analyzeInParallel = fanout(charCount, upper);
const [count, upperValue] = await analyzeInParallel.execute('librainian');
console.log({ count, upperValue }); // { count: 10, upperValue: "LIBRAINIAN" }
```

Use `fanout` when branches are independent and can run concurrently.
Output type: tuple `[AOutput, BOutput]`.
Decision details: `docs/constructions/operators.md`.

## 10-12 min: Fallback (`|||` = `fallback`)

Question this answers: "Try primary path, then backup only on failure."

```typescript
const fast = atom<string, string>('fast-parse', async (s) => {
  if (!s.startsWith('{')) throw new Error('not-json-like');
  return 'fast-path';
});

const safe = atom<string, string>('safe-parse', async () => 'safe-path');

const resilient = fallback(fast, safe);
console.log(await resilient.execute('not json')); // "safe-path"
```

Use `fallback` when you want a backup strategy on failure.
Output type: shared output type of primary and backup branches.
Decision details: `docs/constructions/operators.md`.

## 12-14 min: Conditional (`select`) and Iteration (`fix`)

Question this answers: "I need routing or bounded convergence."

```typescript
const route = atom<number, ReturnType<typeof left<number>> | ReturnType<typeof right<string>>>(
  'route',
  async (n) => (n < 10 ? left(n + 1) : right(`done:${n}`))
);
const finalize = atom<number, string>('finalize', async (n) => `left:${n}`);
const conditional = select(route, finalize);
console.log(await conditional.execute(3));  // "left:4"
console.log(await conditional.execute(12)); // "done:12"
```

```typescript
type Counter = { value: number };
const increment = atom<Counter, Counter>('increment', async (s) => ({ value: s.value + 1 }));

const untilFive = fix(increment, {
  stop: (s) => s.value >= 5,
  metric: { measure: (s) => s.value, capacity: 5 },
  maxIter: 10,
});

console.log(await untilFive.execute({ value: 0 }));
// { value: 5, iterations: 5, ...fixpoint metadata }
```

Use `select` for statically analyzable branching and `fix` for bounded convergence loops.
Output type:
- `select(route, onLeft)` returns the union routing output contract.
- `fix(body, ...)` returns body output plus fixpoint metadata.
Decision details: `docs/constructions/operators.md`.

## 14-15 min: Run Against Real LiBrainian Context

```typescript
import { initializeLibrarian } from 'librainian';
import { atom } from 'librainian/constructions';

const session = await initializeLibrarian(process.cwd());

const summarizeIntent = atom<string, string>(
  'summarize-intent',
  async (intent, ctx) => {
    const librarian = (ctx?.deps as { librarian: { queryOptional: Function } }).librarian;
    const response = await librarian.queryOptional({ intent, depth: 'L1' });
    return response?.summary ?? 'No summary';
  }
);

const result = await summarizeIntent.execute('How is auth wired?', {
  deps: { librarian: session.librarian },
  signal: new AbortController().signal,
  sessionId: 'quickstart',
});

console.log(result);
```

## Operator Cheat Sheet

- `atom`: one focused step
- `seq` (`>>>`): data-dependent pipeline
- `fanout` (`&&&`): parallel independent branches
- `fallback` (`|||`): backup path on failure
- `fix`: iterate until stop/metric boundary
- `select`: conditional routing with static path visibility

## What's Next

- Cookbook: `docs/constructions/cookbook.md`
- Operator decision guide: `docs/constructions/operators.md`
- Testing guide: `docs/constructions/testing.md`
- Migration guide: `docs/constructions/migration.md`
- FreeConstruction design track: GitHub issue `#330`
- CLI construction browser: `npx librainian constructions list`
- Existing patterns: `docs/construction-patterns.md`
