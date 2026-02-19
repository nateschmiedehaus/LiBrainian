# Construction Operator Decision Guide

Choose operators by the question you are asking, not by memorizing names.

## Decision Tree

### "I need one transformation step."
Use `atom`.

```typescript
const trim = atom<string, string>('trim', async (s) => s.trim());
```

### "Step B needs output from step A."
Use `seq` (`>>>`).

```typescript
const pipeline = seq(parseInput, validateInput);
```

### "I need both branches and they are independent."
Use `fanout` (`&&&`).

```typescript
const both = fanout(findCallers, findCoverage); // output: [callers, coverage]
```

### "Try fast path, then backup on failure."
Use `fallback` (`|||`).

```typescript
const resilient = fallback(structuralAnalyzer, semanticAnalyzer);
```

### "I need a runtime branch based on a discriminator."
Use `select` (or `branch` for two explicit branches).

```typescript
const routed = select(classifyIntent, expensivePath);
const fullBranch = branch(classifyIntent, tsPath, pyPath);
```

### "I need iterative refinement until convergence."
Use `fix`.

```typescript
const iterative = fix(refineStep, {
  stop: (s) => s.done,
  metric: { measure: (s) => s.progress, capacity: 1 },
  maxIter: 8,
});
```

## Profunctor Boundary Operators

Use these when you need shape adaptation without creating extra wrapper atoms.

```typescript
const normalizedIn = contramap(core, normalizeInput);
const normalizedOut = map(core, summarizeOutput);
const bothSides = dimap(core, normalizeInput, summarizeOutput);
const mappedErrors = mapError(core, (e) => new Error(`wrapped: ${e.message}`));
```

- `contramap`: adapt input only.
- `map`: adapt output only.
- `dimap`: adapt input + output.
- `mapError`: normalize error channel.

## Wrong Operator Patterns

| Intended | Mistake | Consequence |
|---|---|---|
| `fanout(A, B)` | `seq(A, B)` when B does not use A output | unnecessary latency |
| `fallback(A, B)` | `fanout(A, B)` for "backup" behavior | both paths run, extra cost |
| `fix(body, metric)` | manually unrolled `seq(seq(...))` loop | brittle iteration bounds |
| boundary adaptation | wrapper atom everywhere | harder type seams and extra boilerplate |

## Example Using All Five

```typescript
import { atom, seq, fanout, fallback, select, fix, left, right } from 'librainian/constructions';

const normalize = atom<string, string>('normalize', async (s) => s.trim());
const classify = atom<string, ReturnType<typeof left<string>> | ReturnType<typeof right<string>>>(
  'classify',
  async (s) => (s.includes('critical') ? left(s) : right(`skip:${s}`))
);
const expensive = atom<string, string>('expensive', async (s) => `expensive:${s}`);
const cheap = atom<string, string>('cheap', async (s) => `cheap:${s}`);
const route = select(classify, expensive);
const resilientRoute = fallback(route, cheap);

type S = { value: string; passes: number };
const refine = atom<S, S>('refine', async (s) => ({ ...s, passes: s.passes + 1 }));
const loop = fix(refine, {
  stop: (s) => s.passes >= 2,
  metric: { measure: (s) => s.passes, capacity: 2 },
});

const pipeline = seq(
  normalize,
  seq(
    fanout(resilientRoute, atom('len', async (s: string) => s.length)),
    atom('to-state', async ([value, len]: [string, number]) => ({ value: `${value}:${len}`, passes: 0 }))
  )
);

const seeded = await pipeline.execute(' critical intent ');
const result = await loop.execute(seeded);
```

## Related Docs

- Quickstart: `docs/constructions/quickstart.md`
- Cookbook: `docs/constructions/cookbook.md`
- Testing: `docs/constructions/testing.md`
- Migration: `docs/constructions/migration.md`
