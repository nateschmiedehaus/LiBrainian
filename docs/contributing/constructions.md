# Contributing Constructions

This guide explains how to write, test, and publish a LiBrainian construction preset that other agents can run safely.

The target audience is contributors who can already run the repository, but are new to the construction model. If you only remember one thing from this document, remember this: a construction is a typed contract first and an execution strategy second. If your preset keeps a clean contract, the rest of the system can compose, inspect, and evaluate it.

## 1. What is a Construction?

A construction is a typed, composable operation that maps input `I` to output `O` through a structured execution contract.

In LiBrainian, constructions are used for:

- single-step analyses (`atom`)
- multi-step pipelines (`seq`)
- parallel branches (`fanout`)
- fallback branches (`fallback`)
- fixed-point refinement (`fix`)

A construction is not just a function. It carries metadata needed for:

- registry discovery
- machine-readable manifest generation
- MCP exposure
- deterministic testing
- confidence and evidence handling

That metadata is what lets other agents use your preset without reading your source code first.

## 2. Construction interface fundamentals

The core interface is `Construction<I, O, E, R>`:

- `I`: input shape
- `O`: output shape
- `E`: typed error channel (usually extends `ConstructionError`)
- `R`: context dependency requirements

At runtime, execution returns `ConstructionOutcome<O, E>` rather than throwing.

```typescript
type ConstructionOutcome<O, E> =
  | { ok: true; value: O }
  | { ok: false; error: E };
```

This matters for reliability. Compositions can branch and recover from failures because failure is explicit in the type.

### Minimal authoring pattern

Use `createConstruction(...)` with Zod schemas so your preset is self-validating and self-describing:

```typescript
import { z } from 'zod';
import { createConstruction } from 'librainian/constructions';
import { ok } from 'librainian/constructions';

const inputSchema = z.object({ target: z.string().min(1) });
const outputSchema = z.object({
  summary: z.string(),
  confidence: z.object({
    type: z.literal('deterministic'),
    value: z.number(),
    reason: z.string(),
  }),
  evidenceRefs: z.array(z.string()),
  analysisTimeMs: z.number(),
});

export const MyPreset = createConstruction({
  id: '@librainian-community/my-preset',
  name: 'My Preset',
  inputSchema,
  outputSchema,
  execute: async (input, _context) =>
    ok({
      summary: `Analyzed ${input.target}`,
      confidence: { type: 'deterministic', value: 1, reason: 'rule-based' },
      evidenceRefs: [],
      analysisTimeMs: 0,
    }),
});
```

## 3. Base operators with worked patterns

Constructions become useful when composed. Start with the three high-value operators:

- `atom`: one focused step
- `seq`: output of step A feeds step B
- `fanout`: same input to parallel branches, then merge

### `atom`: isolate a unit of logic

Use `atom` when you want a small, testable step with a stable ID.

```typescript
const normalize = atom('normalize-target', (input: { target: string }) => ({
  target: input.target.trim().toLowerCase(),
}));
```

### `seq`: deterministic pipeline shape

Use `seq` for explicit stage ordering:

```typescript
const pipeline = seq(normalize, analyze, 'seq:normalize>analyze', 'Normalize + Analyze');
```

Benefits:

- predictable handoff between stages
- easier trace debugging
- easier unit testing of stage boundaries

### `fanout`: branch independent analyses

Use `fanout` when branches do not depend on each other:

```typescript
const branches = fanout(riskBranch, effortBranch, 'fanout:risk+effort', 'Risk + Effort');
```

Benefits:

- independent branch testing
- explicit merge boundaries
- lower coupling between analyses

### `fallback` and `fix`

- `fallback` is for backup strategy if primary branch fails.
- `fix` is for iterative refinement until convergence or budget cutoff.

Use both sparingly in first versions. Most presets should start as `atom`, `seq`, or `fanout`.

## 4. Integration wrappers and composition boundaries

Integration wrappers attach runtime concerns without changing the core logic. The design space includes:

- evidence-aware wrapping
- staleness detection
- calibration enforcement
- MCP projection

Current stable wrappers are exposed from `librainian/constructions` where available. Some wrappers in the design tracks are still under active implementation. When a wrapper is not yet shipped, keep the composition seam explicit so you can apply it later without rewriting the core preset.

Practical pattern:

1. write the pure construction logic first
2. isolate wrapper application in one composition module
3. test the pure path and wrapped path separately

This keeps upgrades low-risk when new wrappers become available.

## 5. ConstructionManifest essentials

Every publishable preset must have a machine-readable manifest contract (`construction.manifest.json`). The manifest is what allows registry tooling to validate and surface your preset.

Required fields include:

- `id`
- `name`
- `version`
- `scope`
- `description`
- `agentDescription`
- `inputSchema`
- `outputSchema`
- `requiredCapabilities`
- `tags`
- `trustTier`
- `examples`

Authoring rules that prevent downstream breakage:

- `id` must be stable once published
- input/output schemas must match runtime behavior exactly
- `agentDescription` should be directive, not marketing text
- examples should show realistic input/output, not placeholders

Quick validation loop:

```bash
librarian constructions validate ./construction.manifest.json
```

Submit loop:

```bash
librarian constructions submit ./construction.manifest.json
```

## 6. Testing a Construction preset

Use `librainian/testing` for deterministic construction tests with no provider dependency.

Available helpers include:

- `mockLibrarianContext(...)`
- `mockLedger(...)`
- `mockCalibrationTracker(...)`
- `constructionFixture(...)`
- `testConstruction(...)`

### Fixture-oriented test with `testConstruction(...)`

```typescript
import { describe, expect, it } from 'vitest';
import { testConstruction } from 'librainian/testing';
import { MyPreset } from '../my-preset';

describe('MyPreset', () => {
  it('returns expected output on fixture', async () => {
    const result = await testConstruction(MyPreset, {
      fixture: 'tests/fixtures/sample-ts-project',
      input: { target: 'src/auth/validator.ts' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.output).toMatchSnapshot();
    }
  });
});
```

### Confidence assertion patterns

Use confidence assertions that reflect your confidence type:

- deterministic: expect exact value (often `1`)
- bounded: assert lower bound and range sanity
- measured/derived: assert minimum threshold and reason tags

Avoid brittle tests that lock every output field unless that field is contract-critical.

### Error-path tests

Every non-trivial preset should include at least one failure-path test:

- invalid input schema
- missing capability
- fallback activation

Failing paths are part of the API, not edge trivia.

## 7. CI expectations (no provider keys required)

Construction unit tests should run without external LLM credentials.

For PR checks, keep tests in deterministic mode:

```bash
npm test -- --run src/testing/__tests__/helpers.test.ts
npm run build
```

When your preset includes provider-backed behavior, split tests by tier and gate provider-dependent tests separately. Do not make basic construction correctness depend on live provider availability.

## 8. End-to-end: write, test, publish

This is the recommended contributor flow for a new preset.

1. scaffold from template
2. implement minimal `createConstruction(...)` contract
3. write fixture test with `testConstruction(...)`
4. run build + tests
5. author `construction.manifest.json`
6. validate + submit manifest
7. publish package

Example command sequence:

```bash
# 1) create preset file from template
cp src/constructions/templates/simple-atom-preset.ts src/constructions/my-preset.ts

# 2) add tests
npm test -- --run src/testing/__tests__/helpers.test.ts

# 3) verify package compiles
npm run build

# 4) validate manifest
librarian constructions validate ./construction.manifest.json

# 5) submit manifest
librarian constructions submit ./construction.manifest.json

# 6) publish package (community scope example)
npm publish --access public
```

If you use an organization scope like `@librainian-community`, ensure you are authenticated for that scope before publishing.

## 9. Template starting points

See `src/constructions/templates/` for baseline examples:

- `simple-atom-preset.ts` (single-step)
- `sequential-preset.ts` (ordered pipeline)
- `fanout-preset.ts` (parallel branches)

Use these as scaffolds, not as final production logic.

## 10. The pit of success with `createConstruction(spec)`

The highest-leverage choice you can make is to author presets through `createConstruction(spec)` and strict schemas from day one.

Why:

- input validation is automatic
- capability checks are explicit
- registry metadata is generated consistently
- output shape is enforceable in tests
- downstream agents get reliable manifest contracts

The anti-pattern is writing an ad hoc function first and trying to retrofit type and manifest guarantees later. That almost always creates contract drift.

Use this checklist before opening a PR:

- preset has stable `id`, `name`, `agentDescription`
- schemas match runtime outputs
- deterministic tests pass without provider keys
- at least one failure-path test exists
- manifest validates cleanly
- guide/docs updated if behavior is non-obvious

If all six are true, your construction is likely ready for community consumption.
