# Worktree Hygiene Runbook

Last updated: 2026-02-21

## Purpose

Keep autonomous issue execution deterministic by preventing mixed diffs, stale worktree folders, and generated backup artifact buildup.

## Non-negotiable policy

1. `main` must stay clean.
2. Only one dirty non-`main` issue worktree may be active at a time.
3. Every `issue-*` folder under `.../librarian-worktrees` must be a registered git worktree.
4. Generated backup directories (`.librarian.backup.v0.*`, `.librainian.backup.v0.*`) must be removed before continuing issue work.

## Commands

```bash
# Audit hygiene (warn mode)
npm run hygiene:worktrees

# Enforce hygiene in automation/CI
npm run hygiene:worktrees:enforce

# Full existing hygiene policy + worktree hygiene
npm run policy:hygiene
npm run policy:hygiene:enforce
```

## Recovery playbook

```bash
# 1) List current worktrees
git worktree list

# 2) Quarantine dirty main safely
git -C /path/to/librarian stash push -u -m "hygiene-quarantine-main-<timestamp>"

# 3) Remove stale clean worktree
git worktree remove /path/to/librarian-worktrees/issue-<n>

# 4) Remove unmanaged issue folders (not in `git worktree list`)
rm -rf /path/to/librarian-worktrees/issue-<n>

# 5) Delete generated backup artifacts
find /path/to/librarian -maxdepth 1 -type d -name '.librarian.backup.v0.*' -exec rm -rf {} +
find /path/to/librarian-worktrees/issue-<n> -maxdepth 1 -type d -name '.librainian.backup.v0.*' -exec rm -rf {} +
```

## 2026-02-21 hygiene reset evidence

- Created tracking issue: `#711` (M0 critical worktree/branch hygiene reset).
- Removed stale worktree: `issue-502`.
- Removed unmanaged folder: `issue-701`.
- Purged generated backup artifact folders from `main` and `issue-710`.
- Quarantined dirty `main` WIP with stash:
  - `stash@{0}: On main: hygiene-quarantine-main-20260221-133832`
- Post-reset registered worktrees:
  - `main` (clean)
  - `codex/m0-710-librainian-consolidation` (active rename work)
  - `codex/m0-711-worktree-hygiene` (hygiene hardening)
