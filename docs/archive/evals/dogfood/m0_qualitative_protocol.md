# M0 Qualitative Dogfood Protocol (Subjective + Objective)

Status: active protocol  
Owner: librarianship  
Issue: #821, #833  
Last Updated: 2026-02-25

## Purpose

Define a strict, reproducible dogfood evaluation that answers:
- Is LiBrainian meaningfully useful in real agent coding workflows?
- Is its context trustworthy enough to reduce risk and rework?
- Does it improve workflow quality under ambiguity and cross-file complexity?
- Do agents choose LiBrainian naturally when not explicitly told to use it?
- Do agents avoid unnecessary LiBrainian calls when it will not help?

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
4. Market benchmark review: `docs/librarian/evals/dogfood/github_agentic_tools_natural_usage_review_2026-02-25.md`
5. GH inbox failure review: `docs/librarian/evals/dogfood/gh_inbox_failure_review_2026-02-25.md`
6. Status checkpoint entry: `docs/librarian/STATUS.md`

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

## Natural-Usage Acceptance Matrix (Issue #833)

Use three objective signals as release criteria for natural dogfooding.

### Signal 1: Spontaneous Adoption

Required setup:
- Run T3+ tasks with L0 prompts (no LiBrainian mention).
- Keep model, budget, and task set fixed across control vs treatment.

Required metrics in `natural_usage_metrics.csv`:
- `used_librarian_rate`
- `time_to_first_librarian_query_s_p50`
- `queries_per_task_p50`

Acceptance thresholds:
- `used_librarian_rate >= 0.70`
- `time_to_first_librarian_query_s_p50 <= 180`
- `queries_per_task_p50 >= 1` and `queries_per_task_p50 <= 6`

### Signal 2: Causal Usefulness

Required setup:
- Add a per-task `decision_trace.md` describing exactly what changed because of LiBrainian output.
- Add `ablation_replay.csv` by replaying each task with LiBrainian disabled after the first plan step.

Required metrics:
- `success_lift_t3_plus`
- `time_reduction_t3_plus`
- `rework_reduction_t3_plus`
- `defect_reduction_t3_plus`

Acceptance thresholds:
- `success_lift_t3_plus >= 0.25`
- `time_reduction_t3_plus >= 0.20`
- `rework_reduction_t3_plus >= 0.20`
- `defect_reduction_t3_plus >= 0.20`

### Signal 3: Appropriate Restraint

Required setup:
- Include both task classes: `librarian_helpful` and `librarian_not_helpful`.
- For each task, label whether LiBrainian usage was appropriate.

Required metrics:
- `use_decision_precision`
- `use_decision_recall`
- `unnecessary_query_rate`

Acceptance thresholds:
- `use_decision_precision >= 0.80`
- `use_decision_recall >= 0.75`
- `unnecessary_query_rate <= 0.20`

### Matrix Hard-Fail Rules

Any single condition below fails the natural-usage gate:
- Missing `natural_usage_metrics.csv` or `ablation_replay.csv`.
- Missing `decision_trace.md` for any completed task.
- Any of the threshold metrics above is below target.

## Hard-fail criteria

Any single condition below fails the evaluation:
- Missing artifacts for any completed task.
- Fabricated citation accepted as pass.
- More than 2 tasks abandoned due to context unreliability.
- Aggregate rubric threshold miss.
- Natural-usage matrix hard-fail triggered.

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
5. Compute natural-usage matrix metrics in `natural_usage_metrics.csv`.
6. Run ablation replay and record in `ablation_replay.csv`.
7. Capture incidents in `incidents.md` with severity and remediation candidates.
8. Write go/no-go recommendation in run `decision.md`.
9. Update top-level summary file with links to all artifacts.
10. File top-3 follow-up issues for strongest weaknesses found.

## Required run directory structure

```text
docs/librarian/evals/dogfood/m0_qualitative_runs/<timestamp>/
  task_matrix.csv
  objective_metrics.csv
  natural_usage_metrics.csv
  ablation_replay.csv
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
      decision_trace.md
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

## External Inputs for 2026-02-25 Update

- GitHub agentic tool review for natural usage patterns:
  - `docs/librarian/evals/dogfood/github_agentic_tools_natural_usage_review_2026-02-25.md`
- GH inbox failure triage and process upgrades:
  - `docs/librarian/evals/dogfood/gh_inbox_failure_review_2026-02-25.md`
- Updated autonomous loop prompt aligned to natural dogfooding:
  - `docs/librarian/evals/dogfood/autonomous_agent_work_loop_prompt_v2.md`
