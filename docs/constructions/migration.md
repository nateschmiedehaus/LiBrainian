# Migration Guide: BaseConstruction -> atom/Operator Composition

This guide migrates class-style constructions to operator-first composition with `atom`, `seq`, `fanout`, `fallback`, `select`, and `fix`.

If you are new to the model first, read `docs/constructions/quickstart.md`.

## Step-by-Step Migration

## 1) Identify one class and its true units of work

Typical legacy shape:

```typescript
class MyConstruction extends BaseConstruction<Input, Output> {
  readonly CONSTRUCTION_ID = 'my-construction';
  async execute(input: Input): Promise<Output> {
    // query A
    // query B
    // merge
    // confidence/evidence assembly
  }
}
```

Extract each independent unit into an atom.

## 2) Convert units to atoms

```typescript
import { atom } from 'librainian/constructions';

const loadCallers = atom<string, Caller[]>('load-callers', async (fnId, ctx) => {
  const librarian = (ctx?.deps as { librarian: any }).librarian;
  const res = await librarian.queryOptional({ intent: `callers of ${fnId}`, depth: 'L1' });
  return res?.relatedFiles ?? [];
});

const loadCoverage = atom<string, Coverage[]>('load-coverage', async (fnId, ctx) => {
  const librarian = (ctx?.deps as { librarian: any }).librarian;
  const res = await librarian.queryOptional({ intent: `tests covering ${fnId}`, depth: 'L1' });
  return res?.packIds ?? [];
});
```

## 3) Compose with operators

```typescript
import { atom, fanout, seq } from 'librainian/constructions';

const rankRisk = atom<{ callers: Caller[]; coverage: Coverage[] }, { score: number }>(
  'rank-risk',
  async ({ callers, coverage }) => ({ score: callers.length * (coverage.length === 0 ? 2 : 1) })
);

export const impactAnalysis = seq(
  fanout(loadCallers, loadCoverage).map(([callers, coverage]) => ({ callers, coverage })),
  rankRisk
);
```

## 4) Update call sites

Before:

```typescript
const c = new ImpactAnalysis(librarian);
const out = await c.execute({ functionId });
```

After:

```typescript
const out = await impactAnalysis.execute(functionId, {
  deps: { librarian },
  signal: new AbortController().signal,
  sessionId: 'migration-session',
});
```

## Migration Decision Table

| Old Pattern | New Pattern | Notes |
|---|---|---|
| `class extends BaseConstruction` | `atom` + operators | preferred authoring path |
| `BaseConstruction.toConstruction()` adapter | keep temporarily | bridge while migrating callers |
| `composition.ts` class-style chains | `seq` / `fanout` / `fallback` | canonical operator set |
| `AssessmentConstruction` subclasses | `atom` + typed result object | retain explicit score fields |
| `ValidationConstruction` subclasses | `atom` + explicit error mapping (`mapError`) | keeps boundaries explicit |

## Common Pitfalls

### Sequential vs Parallel
- Pitfall: converting independent calls to `seq`.
- Fix: use `fanout` when neither branch needs the other's output.

### Evidence refs shape drift
- Pitfall: treating evidence refs as arbitrary strings.
- Fix: keep references stable and structured at operator boundaries; avoid ad-hoc concatenated strings.

### Throw-heavy control flow
- Pitfall: relying on implicit throw chains.
- Fix: use `fallback`, `mapError`, and `select` for explicit behavior.

### Merge shape mismatch after `fanout`
- Pitfall: expecting object merge directly.
- Fix: map tuple output with `.map(([a, b]) => ({ ...a, ...b }))` when needed.

## Codemod Starter (Find Candidates)

Use these searches to identify high-yield migration targets:

```bash
rg -n "extends BaseConstruction" src
rg -n "new [A-Za-z0-9_]+\\(.*librarian" src
rg -n "toConstruction\\(" src
```

Mechanical first pass:
1. Extract body blocks into `atom` functions.
2. Replace sequential independent awaits with `fanout`.
3. Normalize output seams with `map`/`dimap`.

## Compatibility and Sunset

- `BaseConstruction` remains available for compatibility today.
- New constructions should be authored with `atom` + operators.
- Existing class-based constructions should migrate incrementally per module.
- Adapter usage (`toConstruction`) should be treated as transitional, not the target end state.

Deprecation timeline (current plan):
- `0.3.x`: soft deprecation warnings in docs and review guidance.
- `0.4.x`: no new class-style constructions accepted for first-party modules.
- `0.5.x`: adapters retained for legacy runtime compatibility only; all first-party constructions use operator-first composition.
