# Decision Trace — Issue #848

Date: 2026-02-26
Issue: #848
Task: E2E patrol loop fail-useful/self-correcting output, agent routing/codex dispatch reliability

## Dogfood decision

- Uncertainty level: high
- Reason:
  - Needed exact ownership of patrol/e2e orchestration, failure artifact flow, and routing behavior.
  - Needed to verify whether current behavior was silent failure vs structured failure.
- Action:
  - Ran `npx librainian status`
  - Ran `npx librainian query "Issue #848: what files govern e2e patrol self-correcting output, provider probe freshness, and codex/agent dispatch routing?" --deterministic --no-synthesis --timeout 30000`

## Natural usage result

- LiBrainian was used spontaneously before coding because uncertainty was architectural/process-level.
- Query output quality was degraded (`Strategy: degraded (semantic_stage_degraded)`), and returned mostly low-relevance packs for this issue intent.
- Decision impact:
  - Did not trust query result ranking for file targeting.
  - Switched to deterministic code inspection and direct script/test verification.

## Causal usefulness

- Positive:
  - `status` output provided concrete system state used for triage context:
    - `Release Evidence Ready: false`
    - `Required (full): true`
    - `Stored LLM Defaults: None`
- Negative:
  - Query retrieval degradation did not provide actionable file targets for #848 and did not change implementation path.
- Net:
  - LiBrainian helped as health/signal telemetry but not as primary retrieval oracle for this specific issue run.

## Restraint signal

- Used one targeted query + one status check.
- Did not loop repeated speculative queries after degraded retrieval signal.
- Continued with deterministic validation (`patrol:full` bounded run + e2e chain artifacts).

## What would have changed the decision

- Better issue-intent routing from natural language bug text to orchestration scripts/tests (patrol/e2e paths).
- Stronger retrieval for process/evaluation intents when semantic stage is degraded.
- Automatic suggestion of exact artifact-producing verification commands when issue body contains acceptance criteria.

## Verification artifacts tied to this task

- Patrol run artifact:
  - `state/patrol/patrol-run-2026-02-26T22-48-00-714Z.json`
- Patrol summary artifact:
  - `state/patrol/patrol-summary.json`
  - `state/patrol/patrol-summary.md`
- Patrol transcript:
  - `state/patrol/transcripts/run-01-typedriver-ts-explore-1772146164456.json`
- E2E outcome/triage artifacts:
  - `state/e2e/outcome-report.json`
  - `state/e2e/outcome-triage.json`
  - `state/e2e/outcome-triage.md`
- Auto remediation plan artifacts:
  - `state/plans/agent-issue-fix-plan.json`
  - `state/plans/agent-issue-fix-plan.md`
