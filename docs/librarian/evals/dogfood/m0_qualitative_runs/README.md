# M0 qualitative dogfood runs

Create one directory per run:

- `docs/librarian/evals/dogfood/m0_qualitative_runs/<timestamp>/`
- Suggested timestamp format: `YYYYMMDD-HHMMSSZ`

Minimum contents per run:

- `task_matrix.csv`
- `objective_metrics.csv`
- `subjective_scores.csv`
- `aggregate.md`
- `incidents.md`
- `decision.md`
- `tasks/T01..T12/{prompt.md,session.log,outputs.md,citations.md}`

Use `docs/librarian/evals/dogfood/m0_qualitative_protocol.md` as the canonical procedure and scoring policy.
