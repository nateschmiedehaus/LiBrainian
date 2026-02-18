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
  - `hook-update-index.mjs` (best-effort staged index refresh for pre-commit flows)
- **GitHub automation**
  - `gh-autoland.mjs` (push current branch, create/reuse PR, enable squash auto-merge, watch checks)
    - Supports `--issue <N>` to auto-link `Fixes #N` in PR body
    - Supports `--dispatch-publish verify|publish` after merge to main (workflow dispatch)
    - Falls back to push-only mode when `gh auth` is unavailable, printing a direct PR URL
  - `gh-branch-hygiene.mjs` (delete stale `codex/*` branches with merged PRs; dry-run supported)

## Fast Paths

- `npm run gh:ship`
  - Runs `validate:fast`, then autolands current branch.
- `npm run gh:autoland -- --issue 299`
  - Opens/reuses PR linked to issue #299 and comments the issue with the PR URL.
- `npm run gh:branches:dry-run`
  - Preview which stale `codex/*` branches are safe to remove.
- `npm run gh:branches:cleanup`
  - Remove stale `codex/*` branches with merged PRs from origin and local repo.
- `npm run librainian:update:staged`
  - Runs hook-friendly staged-file incremental index refresh (`librainian update --staged`).

## Conventions

- Keep scripts deterministic and machine-readable where possible.
- Prefer JSON artifact output for anything consumed by gates/CI.
- Temporary one-off scripts should not remain in this directory.
