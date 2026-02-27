# Decision Trace: Issue #842 (Dogfood AutoLearner)

- Task: implement `librainian:dogfood-autolearner` with ranked interventions, restraint handling, and evidence-path integration.
- Uncertainty assessment: high (cross-file construction registration, schema contract, artifact parsing, and failure-taxonomy mapping).

## Natural Usage Decision

- Chose to use LiBrainian before coding because mapping and registration surfaces were uncertain.
- Commands run:
  - `npx librainian status`
  - `npx librainian query "Implement issue #842 dogfood-autolearner: what files govern construction registration, output schema, and dogfood evidence artifact flow?"`

## Query Outcomes and Failures

- First query failed hard with `ENOINDEX` (watch catch-up required).
- Recovery path required:
  - `npx librainian index --force --incremental`
  - `npx librainian bootstrap`
  - `npx librainian doctor --heal`
- During recovery, lock-contention and long-running indexing behavior appeared (`storage_locked:indexing in progress`).
- Successful query eventually returned with:
  - warning: `Model policy provider not registered; using fallback model selection`
  - high latency (~158s)
  - low relevance for this intent.

## Causal Decision Impact

- Direct coding decision changed:
  - Added an explicit autolearner intervention class for model-policy fallback signals (`register-model-policy-provider`), not just lock/timeout classes.
  - Updated docs and tests so fallback policy mode is surfaced as a dogfood-quality failure signal.
- Restraint decision:
  - After one successful query with low relevance, stopped additional speculative queries and switched to deterministic code inspection.

## Generalizable Improvement Request

- For release/dogfood workflows, query should fail closed (or strongly gate) when model-policy provider is unregistered instead of silently entering fallback policy mode with degraded evidence quality.
