# Migration Guide: BaseConstruction -> createConstruction()/atom Composition

This guide migrates class-style constructions to operator-first composition with `atom`, `seq`, `fanout`, `fallback`, `select`, and `fix`, then wraps the result with `createConstruction()`.

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

## 4) Wrap with `createConstruction()`

```typescript
import { createConstruction } from 'librainian/constructions';
import { z } from 'zod';

const ImpactInputSchema = z.object({
  functionId: z.string().min(1),
});
const ImpactResultSchema = z.object({
  score: z.number(),
});

export const ImpactAnalysis = createConstruction({
  id: 'impact-analysis',
  name: 'Impact Analysis',
  description: 'Analyze transitive risk before editing a function.',
  inputSchema: ImpactInputSchema,
  outputSchema: ImpactResultSchema,
  construction: impactAnalysis,
});
```

## 5) Update call sites

Before:

```typescript
const c = new ImpactAnalysis(librarian);
const out = await c.execute({ functionId });
```

After:

```typescript
const out = await ImpactAnalysis.execute({ functionId }, {
  deps: { librarian },
  signal: new AbortController().signal,
  sessionId: 'migration-session',
});
```

## Migration Decision Table

| Old Pattern | New Pattern | Notes |
|---|---|---|
| `class extends BaseConstruction` | `atom` + operators + `createConstruction` | preferred authoring path |
| `BaseConstruction.toConstruction()` adapter | keep temporarily | bridge while migrating callers |
| `ComposableConstruction` in `composition.ts` | `seq` / `fanout` / `fallback` | canonical operator set |
| `ComposableConstruction` in `lego_pipeline.ts` | `seq` / `fanout` / `fallback` | same migration target; remove parallel abstraction drift |
| `AssessmentConstruction` subclasses | `atom` + typed result object | retain explicit score fields |
| `ValidationConstruction` subclasses | `atom` + explicit error mapping (`mapError`) | keeps boundaries explicit |

## Common Pitfalls

### Sequential -> Parallel conversion
- Pitfall: converting independent calls to `seq` instead of parallel composition.
- Fix: use `fanout` when neither branch needs the other's output.

### String -> typed evidence references
- Pitfall: treating evidence refs as arbitrary strings.
- Fix: prefer typed references at operator boundaries and keep schema-level evidence types explicit.

### Throw -> typed error channel
- Pitfall: relying on implicit throw chains and `try/catch` at call sites.
- Fix: use explicit construction outcomes and `fallback`/`mapError`/`select` for deterministic failure behavior.

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
4. Wrap the migrated graph with `createConstruction(...)`.

## Compatibility and Sunset

- `BaseConstruction` remains available for compatibility today.
- New constructions should be authored with `atom` + operators + `createConstruction`.
- Existing class-based constructions should migrate incrementally per module.
- Adapter usage (`toConstruction`) should be treated as transitional, not the target end state.

Deprecation timeline (current plan):
- `0.3.x`: soft deprecation warnings in docs and review guidance.
- `0.4.x`: no new class-style constructions accepted for first-party modules.
- `0.5.x`: adapters retained for legacy runtime compatibility only; all first-party constructions use operator-first composition.
