# GitHub Merge/Pull/Publish Policy

This policy is active for current issue-resolution waves and is intended to keep branch work, `main`, and npm publication cadence tightly synchronized.

## Goals

- Prevent feature branches from drifting too far from `origin/main`.
- Prevent merge throughput from outrunning package publication.
- Make pull/rebase behavior explicit and repeatable for all lanes.

## Required Commands

- Pull policy check: `npm run policy:pull`
- Merge policy check: `npm run policy:merge`
- Publish policy check: `npm run policy:publish`

## Pull Policy (Before Starting/Resuming Any Branch)

1. Branch must have an upstream configured.
2. Branch must not be behind its upstream.
3. Branch must not be more than `LIBRARIAN_MAX_MAIN_BEHIND_PULL` commits behind `origin/main`.
4. If any check fails, run:
   - `git fetch origin main`
   - `git pull --ff-only`
   - `git rebase origin/main` (when needed)

Default threshold:
- `LIBRARIAN_MAX_MAIN_BEHIND_PULL=20`

## Merge Policy (Before Creating/Updating PRs for Merge Queue)

1. Branch must be fully rebased on latest `origin/main` (0 commits behind).
2. Main-to-npm drift is limited:
   - `origin/main` cannot exceed `LIBRARIAN_MAX_COMMITS_AHEAD_OF_NPM` commits past the latest published npm tag.
3. If drift threshold is exceeded, release before merging additional feature PRs.

Default threshold:
- `LIBRARIAN_MAX_COMMITS_AHEAD_OF_NPM=40`

## Publish Policy (Before Any `npm publish`)

1. Publish is allowed only from `main`.
2. Working tree must be clean.
3. Local `main` must match `origin/main` exactly.
4. `package.json` version must be greater than the currently published npm version.

## 4-Lane Issue Handling Rules

1. Run up to 4 parallel issue lanes in isolated branches/worktrees.
2. One issue per branch and one PR per issue.
3. Primary file ownership per lane; adjacent edits only when required for compile/test integrity.
4. Order work by dependency and developmental impact (low-level prerequisites first).
5. Every lane must produce:
   - targeted tests passing
   - `npm run typecheck` passing
   - explicit validation commands in PR body

## Suggested Routine

1. `npm run policy:pull`
2. Implement issue slice + tests
3. `npm run policy:merge`
4. Push branch + open PR
5. Periodically evaluate npm drift; when near threshold, release via:
   - `npm run policy:publish`
   - `npm run release`
