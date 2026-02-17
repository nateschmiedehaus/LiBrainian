# LiBrainian: Final 10 Evidence-Gated Tasks

Scope: bring LiBrainian from “usable by claim” to “operational with evidence”, including superiority claims grounded in measurable wins.

Principle: every step has a runnable gate. If the gate fails, the step is not done.

## 1) Golden Path Onboarding Contract

Done when:
- `LiBrainian query "..."` on a fresh repo auto-bootstraps or fails closed with `unverified_by_trace(...)` and a recovery hint.
- No “indexed 0” states when indexable files exist.

Gates:
- `npm test -- --run src/api/__tests__/onboarding_baseline.test.ts`
- `npm test -- --run src/api/__tests__/onboarding_recovery.test.ts`
- `node dist/cli/index.js doctor --json`

## 2) Output Envelope and JSON Hygiene

Done when:
- `--json` commands emit JSON only on stdout (no progress/log noise).
- Warnings/errors go to stderr; logs are suppressible.

Gates:
- `npm test -- --run src/__tests__/output_envelope_invariant.test.ts`
- `npm test -- --run src/cli/commands/__tests__/query.test.ts`

## 3) Storage Self-Healing (Lock/WAL/Corruption Paths)

Done when:
- stale lock/WAL/shm states recover without manual intervention.
- recovery paths are deterministic and disclosed.

Gates:
- `npm test -- --run src/storage/__tests__/storage_recovery.test.ts`
- `npm test -- --run src/storage/__tests__/embedding_recovery.test.ts`

## 4) Polyglot Indexing Baseline (20+ Languages)

Done when:
- external corpus contains 20+ languages with pinned commits.
- smoke queries return useful context on all corpus repos in provider-minimal mode.

Gates:
- `node dist/cli/index.js smoke --repos-root eval-corpus/external-repos --json --repo typedriver-ts,srtd-ts,quickpickle-ts,aws-sdk-vitest-mock-ts,reccmp-py`
- `node dist/cli/index.js smoke --repos-root eval-corpus/external-repos --json --repo token-explorer-py,pytest-run-parallel-py,tlsproxy-go,cipherdrop-rs,velocityscoreboardapi-java`
- `node dist/cli/index.js smoke --repos-root eval-corpus/external-repos --json --repo openai-kotlin,smartdate-csharp,onetime-message-php,tuist-filesystem-swift,active-record-tracer-rb`
- `node dist/cli/index.js smoke --repos-root eval-corpus/external-repos --json --repo ptx-c,turbosqueeze-cpp,jing-scala,icarus-dart,binary-nvim-lua`
- `node dist/cli/index.js smoke --repos-root eval-corpus/external-repos --json --repo tailwindcss-preset-email-js,port-forwarding-sh,byte-by-byte-sql,cryptonize-html,zen-beautiful-blur-css`

## 5) Machine-Verifiable Ground Truth (Phase 8)

Done when:
- AST fact extractor emits verifiable facts (defs/imports/calls) with stable identifiers.
- Ground truth is generated from AST, not human or synthetic annotation.
- Citation verifier can verify file/line/identifier claims.

Gates:
- `npm test -- --run src/__tests__/ast_fact_extractor_multilang.test.ts`
- `npm test -- --run src/evaluation/__tests__/citation_verifier.test.ts`

## 6) Consistency Checks (Same Question, Different Phrasing)

Done when:
- equivalent query intents produce consistent packs/claims, within defined tolerance.
- drift is measured and reported, not hand-waved.

Gates:
- `npm test -- --run src/agents/self_improvement/__tests__/analyze_consistency.test.ts`

## 7) Constructables and Templates as a Typed, Composable System

Done when:
- each constructable declares: inputs, outputs, provider requirements, failure semantics, evidence obligations.
- selection is deterministic under deterministic mode.

Gates:
- `npm test -- --run src/api/__tests__/template_registry.test.ts`
- `npm test -- --run src/constructions/__tests__/constructable_registry.test.ts`

## 8) Agent Performance Evaluation (Phase 9)

Done when:
- control vs treatment harness exists (WITH LiBrainian vs WITHOUT).
- tasks span complexity tiers and context levels; results are reproducible.
- superiority is claimed only when the harness shows a statistically meaningful lift.

Gates:
- `npm test -- --run src/__tests__/ab_harness.test.ts`

## 9) Scientific Self-Improvement Loop (“Ralph Wiggum Loop”, Phase 10)

Definition:
- DETECT -> HYPOTHESIZE -> TEST -> FIX -> VERIFY -> EVOLVE
- Reward is binary: 1 only if gates pass, 0 otherwise.

Done when:
- the loop can run on a failing scenario, produce a patch, and prove the fix with gates.

Gates:
- `npm test -- --run src/agents/self_improvement/__tests__/meta_improvement_loop.test.ts`
- `npm test -- --run src/agents/self_improvement/compositions/__tests__/incremental_check.test.ts`

## 10) Operational Excellence: Telemetry, Budgets, and Truthful Health

Done when:
- health/doctor/status report reality (stale vs broken, providers, parser coverage).
- budgets prevent runaway loops, and failures are classified as `unverified_by_trace(...)`.

Gates:
- `node dist/cli/index.js doctor --json`
- `npm test -- --run src/measurement/__tests__/observability_health.test.ts`

