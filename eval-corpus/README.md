# LiBrainian Evaluation Corpus

This folder holds the diagnostic-only ground-truth evaluation corpus used by
the evaluation harness. It is intentionally scaffolded first so future work can
populate real repositories, annotations, and query/answer pairs without making
placeholder lexical evaluation look like release evidence.

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
  Alias mapping for GitHub lookup:
  `docs/librarian/EXTERNAL_REPO_ALIAS_MAPPING.md`
  Note: AST ground-truth generation is TypeScript-first today; non-TS repos may
  produce zero queries and will be flagged in the script output.

## Current Status

This corpus contains active external-repo manifests (`external-repos/manifest.json`)
used by diagnostic refresh runs and internal gating.

The current external evaluation lane is fail-closed and not release-qualified:
placeholder lexical evaluation is still in use until the real product-path
evaluator replaces it.

Some query sets remain sparse or intentionally narrow and should continue to be
expanded with machine-verifiable fixtures as evaluation coverage grows.
