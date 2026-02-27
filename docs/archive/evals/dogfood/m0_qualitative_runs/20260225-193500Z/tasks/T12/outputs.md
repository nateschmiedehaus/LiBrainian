# T12 Outputs

## Diagnosis

- Strict qualification path includes publish-gate checks that depend on evidence-manifest freshness and reconciliation.
- Current status documents include repeated `unverified (evidence_manifest_missing)` markers.
- `state/audits/LiBrainian/manifest.json` is absent in this workspace snapshot, matching the failure mode.

## Root cause statement

Evidence pipeline inputs are missing/stale (manifest absent), causing strict evidence checks to fail closed.

## Reproducible remediation

1. `npm run evidence:manifest`
2. `npm run evidence:reconcile`
3. `npm run evidence:refresh`
4. Re-run strict gate (`npm run test:agentic:strict` or `npm run eval:publish-gate`)

If the manifest is regenerated, re-check `docs/librarian/STATUS.md` autogen/evidence sections and commit updated artifacts.
