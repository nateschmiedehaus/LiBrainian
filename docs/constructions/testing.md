# Construction Testing Guide

Goal: deterministic tests with zero live provider dependency for operator behavior.

Use this stack from smallest scope to largest scope.

## Layer 1: Atom unit tests

Test one atom at a time with deterministic fixtures.

```typescript
import { atom } from 'librainian/constructions';

const trim = atom<string, string>('trim', async (s) => s.trim());
expect(await trim.execute('  hi  ')).toBe('hi');
```

What to assert:
- input/output transform
- deterministic edge cases
- typed output shape

## Layer 2: Composition behavior tests

Test operator semantics separately from domain logic.

```typescript
import { atom, seq, fanout } from 'librainian/constructions';

const add1 = atom<number, number>('add1', async (n) => n + 1);
const times2 = atom<number, number>('times2', async (n) => n * 2);
expect(await seq(add1, times2).execute(3)).toBe(8);

const metrics = fanout(
  atom<number, number>('double', async (n) => n * 2),
  atom<number, number>('square', async (n) => n * n),
);
expect(await metrics.execute(4)).toEqual([8, 16]);
```

What to assert:
- `seq` data dependency
- `fanout` tuple output order
- seam compatibility at composition boundaries

## Layer 3: Error-path tests

Force failures and verify fallback/recovery paths.

```typescript
import { atom, fallback } from 'librainian/constructions';

const fail = atom<string, string>('fail', async () => {
  throw new Error('boom');
});
const safe = atom<string, string>('safe', async () => 'ok');
expect(await fallback(fail, safe).execute('x')).toBe('ok');
```

What to assert:
- backup path triggers only when primary fails
- failure message shaping via `mapError` when used
- no hidden retries unless explicitly composed

## Layer 4: Control-flow tests (`select`, `fix`)

Validate route correctness and fixpoint termination behavior.

```typescript
import { atom, select, left, right, fix } from 'librainian/constructions';

const route = atom<number, ReturnType<typeof left<number>> | ReturnType<typeof right<string>>>(
  'route',
  async (n) => (n < 3 ? left(n + 1) : right(`done:${n}`)),
);
const onLeft = atom<number, string>('on-left', async (n) => `L:${n}`);
expect(await select(route, onLeft).execute(1)).toBe('L:2');

const inc = atom<{ n: number }, { n: number }>('inc', async (s) => ({ n: s.n + 1 }));
const loop = fix(inc, {
  stop: (s) => s.n >= 2,
  metric: { measure: (s) => s.n, capacity: 2 },
});
expect((await loop.execute({ n: 0 })).iterations).toBe(2);
```

What to assert:
- branch routing result
- fixpoint metadata (`iterations`, termination reason)
- monotonic metric behavior when strict mode is used

## Layer 5: Snapshot and docs regression tests

Use snapshots for stable structure, not volatile values.

- Snapshot `describe_construction` output for public constructions.
- Snapshot Mermaid/string diagrams when visualization output is introduced.
- Keep docs snippets synchronized with tested code snippets.

## Test Helpers (`librainian/testing`)

LiBrainian provides deterministic helper utilities for unit tests:

```typescript
import {
  mockLibrarianContext,
  mockLedger,
  mockCalibrationTracker,
  constructionFixture,
} from 'librainian/testing';

const ctx = mockLibrarianContext({ librarian: { query: async () => ({ summary: 'ok' }) } });
const ledger = mockLedger();
const calibration = mockCalibrationTracker();
const fixture = constructionFixture('find-callers', ['auth.ts', 'session.ts']);
```

Helper intent:
- `mockLibrarianContext(overrides?)`: build stable execution context
- `mockLedger()`: in-memory append/query ledger
- `mockCalibrationTracker()`: deterministic confidence path (`0.8`)
- `constructionFixture(id, result)`: shorthand for fixed construction outputs

## Integration Wrapper Mocks

When your construction wraps external systems (ledger, calibration, stale-state trackers), mock those dependencies at the boundary:

```typescript
const ledger = mockLedger();
await ledger.append({ claim: 'auth-route', confidence: 0.8 });
expect((await ledger.list()).length).toBe(1);
```

Boundary-mocking keeps tests fast and prevents live I/O in CI.

## CI Configuration (No LLM keys required)

```yaml
name: test
on: [push, pull_request]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test -- --run
```

CI rules:
- run only deterministic unit tiers in PR validation
- do not require provider credentials for operator tests
- fail fast on type errors and test regressions

## Coverage Expectations

Test:
- operator semantics (`seq`, `fanout`, `fallback`, `select`, `fix`)
- boundary adapters (`map`, `contramap`, `dimap`, `mapError`)
- failure/recovery behavior

Do not unit-test:
- provider internals owned by upstream SDKs
- network-dependent behavior in deterministic unit suites

Related:
- Quickstart: `docs/constructions/quickstart.md`
- Operator guide: `docs/constructions/operators.md`
- Migration guide: `docs/constructions/migration.md`
