# Decision Trace: Issue #718 (query.ts decomposition slice)

- Task: extract a low-risk helper boundary for repeated early short-circuit paths in `src/api/query.ts` (symbol/git/enumeration/call-flow/comparison).
- Uncertainty assessment: high (needed to confirm repeated behavior blocks and safest extraction seam).

## Natural Usage Decision

- Chose to use LiBrainian before editing.
- Commands run:
  - `npx librainian status`
  - `npx librainian query "Issue #718: in src/api/query.ts, find repeated logic around symbol/git/enumeration/call-flow/comparison paths and recommend the safest helper extraction boundary with minimal behavior risk, including file/line evidence."`

## Query Outcomes and Failures

- First query attempt failed with `ENOINDEX` (watch catch-up required).
- Recovery path required:
  - `npx librainian index --force --incremental` (reported not bootstrapped)
  - `npx librainian bootstrap` (initial timeout)
  - `npx librainian doctor --heal`
  - subsequent successful `npx librainian query`
- Successful query returned context packs but did not directly identify the repeated block boundary.

## Causal Decision Impact

- Query confirmed stage-level `query.ts` context and that decomposition should target narrow seams.
- Final extraction decision came from deterministic code inspection after one low-yield query:
  - exact repeated finalize block consolidated via local `finalizeEarlyShortCircuit(...)` helper.

## Restraint Decision

- Stopped after a single successful but low-relevance query result.
- Continued with deterministic code inspection instead of issuing repeated speculative queries.

## Generalizable Improvement Request

- For natural dogfooding reliability, `query` should provide stronger direct-code targeting for "repeated block extraction" intents (or an explicit "insufficient specificity" response) after index recovery events.
