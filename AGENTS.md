# Agent Instructions for LiBrainian

LiBrainian is a codebase knowledge system for AI coding agents. It indexes
source code and provides semantic search, context packs, and relationship
graphs so agents can make better decisions without reading every file.

## Key Directories

- `src/api/` — query pipeline, intent classification, synthesis
- `src/adapters/` — LLM and embedding provider adapters
- `src/constructions/` — constructable context patterns (registry, processes)
- `src/storage/` — SQLite storage, migrations, recovery
- `src/cli/` — CLI commands (bootstrap, query, status, doctor)
- `src/epistemics/` — evidence ledger

## Build and Test Commands

```bash
npm run build          # compile TypeScript → dist/
npm test               # T0 unit tests (no live providers required)
npm run test:tier0     # same as npm test --run (CI gate)
npm run test:integration   # T1 integration tests (providers optional)
npx tsc --noEmit       # type-check only
npm run lint           # ESLint
```

For publish-grade qualification:
```bash
npm run test:agentic:strict   # T2 full agentic qualification (live providers required)
```

## Testing Tiers

- **T0** — pure unit tests, no providers; must always pass
- **T1** — integration tests; skip provider-dependent assertions when unavailable
- **T2** — full agentic/e2e qualification with live providers; required for release

## Release Non-Negotiables

1. `REAL_AGENT_REAL_LIBRARIAN_ONLY` — release evidence must come from real agents on real repos
2. `NO_RETRY_NO_FALLBACK` — any fallback/degraded/unverified marker in release evidence is a hard failure
3. `100%` strict pass required — no "pass with caveats"
4. Run `test:agentic:strict` for publish-grade qualification
5. Update `docs/LiBrainian/CONVERSATION_INSIGHTS.md` before release-gate runs

## PR Rules

Use conventional commits (`feat/fix/test/docs/refactor/chore`). Do not force-push or rebase without explicit instruction.

## What NOT to Do

- Do not write `docs/LiBrainian/STATUS.md` manually — evidence must come from real runs
- Do not skip smoke tests and claim success
- Do not treat fallback/degraded mode output as release evidence
- Do not add runtime dependencies not justified by a spec
- Do not publish to npm without explicit instruction

## Using LiBrainian in This Repo

```typescript
import { initializeLibrarian } from 'librainian';
const lib = await initializeLibrarian(workspace);
const context = await lib.query(intent);
```

CLI: `LiBrainian status | query "<intent>" | health | doctor`

If something is broken, run `LiBrainian doctor` before investigating manually.

## Natural Usage Heuristics (Issue #833)

Use LiBrainian when uncertainty is high: ownership unclear, cross-file impact
unknown, architecture intent ambiguous, or test impact uncertain.

Skip LiBrainian for trivial deterministic edits (rename, typo, single-line
constant with no dependency risk). Prefer one direct query over repeated
speculative queries.

### Natural-language intent examples

- Bug triage: `LiBrainian query "Users get logged out randomly after idle time"`
- Feature location: `LiBrainian query "Where should I add retry budget enforcement?"`
- Refactor safety: `LiBrainian query "What could break if I split query.ts helpers?"`
- Test impact: `LiBrainian query "What tests change if I modify bootstrap quality gate warnings?"`

---

## Do Not
1. Create more spec files, npm scripts, or docs — reduce, don't add
2. Work on M2/M3/M4 — the product doesn't work at M0
3. Close issues based on unit tests alone — require reality verification per `docs/LiBrainian/REALITY_VERIFICATION.md`
4. Mock LLM/embedding calls in integration tests — use `PredeterminedLlmService` or real providers
5. Modify evaluation infrastructure — keep scorer separate from scored

See `docs/archive/AGENTS_v1.md` for the full historical version of this file.
