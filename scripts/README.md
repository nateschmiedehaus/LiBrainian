# Scripts

LiBrainian scripts are grouped by function:

- **Release integrity**
  - `assert-package-identity.mjs`
  - `publish-github-package.mjs`
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
    - Supports `--issue <N>` to auto-link `Fixes #N` in PR body
    - Supports `--dispatch-publish verify|publish` after merge to main (workflow dispatch)

## Fast Paths

- `npm run gh:ship`
  - Runs `validate:fast`, then autolands current branch.
- `npm run gh:autoland -- --issue 299`
  - Opens/reuses PR linked to issue #299 and comments the issue with the PR URL.

## Conventions

- Keep scripts deterministic and machine-readable where possible.
- Prefer JSON artifact output for anything consumed by gates/CI.
- Temporary one-off scripts should not remain in this directory.
