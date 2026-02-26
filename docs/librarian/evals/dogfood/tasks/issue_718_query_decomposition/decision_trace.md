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

---

## Slice: query scope/path helper extraction (`query_scope_utils.ts`)

- Task: extract the scope/path normalization helper cluster from `src/api/query.ts` into a dedicated module with no behavior change.
- Uncertainty assessment: high (needed confidence on lowest-risk extraction seam and exact affected helper boundaries).

### Natural Usage Decision

- Chose to use LiBrainian before editing.
- Commands run:
  - `npx librainian status`
  - `npx librainian query "Issue #718 query.ts decomposition: identify highest-duplication blocks still inside src/api/query.ts that can be extracted with lowest behavior risk, including exact line ranges and suggested helper boundaries."`

### Query Outcomes and Failures

- Query failed with `ENOINDEX` and reported lock-state recovery (`removed_lock`, `removed_wal`, `removed_shm`).
- Recovery attempts:
  - `npx librainian index --force --incremental` -> `ENOINDEX` (not bootstrapped)
  - `npx librainian bootstrap` (process stalled with no further output; manually terminated after prolonged idle)
- Result: no usable LiBrainian answer for this slice.

### Causal Decision Impact

- LiBrainian failure signals changed the implementation path:
  - moved to deterministic extraction strategy (module boundary chosen from contiguous helper cluster and existing tests),
  - added dedicated regression file `src/api/__tests__/query_scope_utils.test.ts`.
- Extraction completed as a pure refactor:
  - new module `src/api/query_scope_utils.ts`
  - `query.ts` now imports helpers; removed ~294 in-file helper lines.

### Restraint Decision

- Stopped query attempts after recovery path failed to produce a usable response.
- Avoided speculative repeated queries and proceeded with deterministic code/test evidence.

### Generalizable Improvement Request

- `librainian query` should emit a direct actionable remediation mode when index/bootstrap state is incomplete (for example: one-shot recover + retry), and bootstrap should fail fast with a clear timeout/error instead of silent stalls.
