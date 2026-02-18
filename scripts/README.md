# Scripts

LiBrainian scripts are grouped by function:

- **Release integrity**
  - `assert-package-identity.mjs`
  - `package-install-smoke.mjs`
  - `refresh-final-verification.mjs`
- **Evaluation orchestration**
  - `ab-harness.ts`
  - `agentic-use-case-review.ts`
  - `external-repo-smoke.ts`
  - `external-ground-truth.ts`
  - `eval-testing-discipline.ts`
  - `eval-testing-tracker.ts`
- **Operational guards**
  - `canon_guard.mjs`
  - `complexity_check.mjs`
  - `check-file-sizes.mjs`
  - `repo-folder-audit.mjs`
- **GitHub automation**
  - `gh-autoland.mjs` (push current branch, create/reuse PR, enable squash auto-merge, watch checks)

## Conventions

- Keep scripts deterministic and machine-readable where possible.
- Prefer JSON artifact output for anything consumed by gates/CI.
- Temporary one-off scripts should not remain in this directory.
