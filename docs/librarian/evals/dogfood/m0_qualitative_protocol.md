# M0 Qualitative Dogfood Protocol (Subjective + Objective)

Status: active protocol  
Owner: librarianship  
Issue: #821  
Last Updated: 2026-02-25

## Purpose

Define a strict, reproducible dogfood evaluation that answers:
- Is LiBrainian meaningfully useful in real agent coding workflows?
- Is its context trustworthy enough to reduce risk and rework?
- Does it improve workflow quality under ambiguity and cross-file complexity?

This protocol is M0 release-gating evidence for dogfood readiness.

## Scope and evidence constraints

- Real-agent sessions on real repositories/workspaces only.
- No synthetic fixtures as qualifying evidence.
- Every claimed result must map to saved artifacts in `m0_qualitative_runs/<timestamp>/`.
- Missing artifacts means the task is unscored and counts as failed evidence hygiene.

## Deliverables

1. Protocol file: `docs/librarian/evals/dogfood/m0_qualitative_protocol.md`
2. Run artifacts: `docs/librarian/evals/dogfood/m0_qualitative_runs/<timestamp>/`
3. Summary and decision: `docs/librarian/evals/dogfood/m0_qualitative_summary.md`
4. Status checkpoint entry: `docs/librarian/STATUS.md`

## Required task matrix (minimum 12 tasks)

- 3 tasks: bug triage/fix
- 3 tasks: feature extension
- 3 tasks: architecture/navigation/context assembly
- 3 tasks: test-failure diagnosis

Additional constraints:
- At least 4 tasks in unfamiliar areas.
- At least 4 intentionally underspecified prompts.
- At least 4 tasks requiring cross-file reasoning.

Use this matrix file per run:
- `task_matrix.csv` with columns:
  - `task_id,category,repo,workspace,unfamiliar,underspecified,cross_file,prompt,expected_outcome`

## Subjective rubric (1-5 per task)

Score each task on:
- Context relevance
- Citation trustworthiness
- Cognitive load reduction
- Decision confidence support
- Workflow fluidity

Rubric anchors:
- `1`: actively harmful / high-friction / misleading
- `2`: weak / incomplete / frequent manual correction
- `3`: usable but inconsistent
- `4`: strong and reliable with minor gaps
- `5`: excellent, low-friction, high-confidence

Save per-task scoring in:
- `subjective_scores.csv`
  - `task_id,relevance,trustworthiness,cognitive_load,decision_confidence,workflow_fluidity,notes`

## Objective companion metrics (required per task)

Record:
- Time-to-first-useful-context (seconds)
- Time-to-actionable-plan (seconds)
- Time-to-correct-outcome (seconds; or `null` if failed)
- Rework loops count
- Hallucinated/invalid reference count
- Outcome (`success|partial|failed|abandoned`)

Save in:
- `objective_metrics.csv`
  - `task_id,ttfuc_s,ttap_s,ttco_s,rework_loops,invalid_refs,outcome,notes`

## Hard-fail criteria

Any single condition below fails the evaluation:
- Missing artifacts for any completed task.
- Fabricated citation accepted as pass.
- More than 2 tasks abandoned due to context unreliability.
- Aggregate rubric threshold miss.

## Aggregate pass thresholds

- Mean subjective score overall >= 4.0.
- No rubric category mean below 3.5.
- No unresolved critical trustworthiness incidents.

## Execution procedure

1. Create run directory:
   - `docs/librarian/evals/dogfood/m0_qualitative_runs/<timestamp>/`
2. Define 12-task matrix in `task_matrix.csv` satisfying all constraints.
3. For each task:
   - Save raw prompt in `tasks/<task_id>/prompt.md`.
   - Save full transcript/log in `tasks/<task_id>/session.log`.
   - Save changed-file summary in `tasks/<task_id>/outputs.md`.
   - Save cited references in `tasks/<task_id>/citations.md`.
   - Fill objective and subjective rows.
4. Compute aggregate metrics and threshold checks in `aggregate.md`.
5. Capture incidents in `incidents.md` with severity and remediation candidates.
6. Write go/no-go recommendation in run `decision.md`.
7. Update top-level summary file with links to all artifacts.
8. File top-3 follow-up issues for strongest weaknesses found.

## Required run directory structure

```text
docs/librarian/evals/dogfood/m0_qualitative_runs/<timestamp>/
  task_matrix.csv
  objective_metrics.csv
  subjective_scores.csv
  aggregate.md
  incidents.md
  decision.md
  tasks/
    T01/
      prompt.md
      session.log
      outputs.md
      citations.md
    ...
    T12/
      ...
```

## Decision output format

`decision.md` must contain:
- `result: GO | NO_GO`
- `thresholds_passed: true|false`
- `hard_fail_triggered: true|false`
- `primary_strengths: ...`
- `primary_weaknesses: ...`
- `required_followups: #<issue>, #<issue>, #<issue>`

## Anti-theater checks

- No hand-wavy claims without artifact links.
- No replacing failed tasks with easier substitutes.
- No excluding bad runs from aggregate without explicit justification.
- Any missing evidence is treated as failure, not warning.
