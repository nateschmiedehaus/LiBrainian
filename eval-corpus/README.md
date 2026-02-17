# LiBrainian Evaluation Corpus

This folder holds the ground-truth evaluation corpus used by the evaluation
harness. It is intentionally scaffolded first so future work can populate real
repositories, annotations, and query/answer pairs.

## Structure

- `schema/ground_truth.schema.json`: JSON Schema for corpus-level ground truth
  (versioned; required fields only).
- `repos/`: Annotated repositories. Each repo contains a `.LiBrainian-eval/`
  folder with `manifest.json` and `ground-truth.json`.
- `queries/`: Shared query sets by category (structural, behavioral, etc.).
- `external-repos/`: Real GitHub repos + `manifest.json` for machine-verifiable
  ground truth. Generate `.LiBrainian-eval/` data with
  `npm run ground-truth:external` (also creates `external-repos/repos` symlinks
  for eval runner compatibility).
  Note: AST ground-truth generation is TypeScript-first today; non-TS repos may
  produce zero queries and will be flagged in the script output.
- `ab-harness/tasks.json`: Deterministic baseline A/B tasks.
- `ab-harness/tasks.agentic.json`: Agent-command taskpack for autonomous
  treatment/control benchmarking with strict gate support.

## Current Status

This corpus contains active harness assets (`ab-harness/*.json`) and external
repo manifests (`external-repos/manifest.json`) used by live evaluation runs.

Some query sets remain sparse or intentionally narrow and should continue to be
expanded with machine-verifiable fixtures as evaluation coverage grows.
