# WU-801-REAL — Clone Real External Repos

**Queued after WU-1001-1003.** Continue current Phase 10 work first.

## Context

The `eval-corpus/repos/*` directories have no git remotes:
```bash
$ cd eval-corpus/repos/small-typescript && git remote -v
# (empty)
```

Phase 10 needs real external repos for valid evaluation data. Execute this work unit to provide them.

## Task

Clone 5+ real open-source repos from GitHub.

## Commands

```bash
# 1. Create directory
mkdir -p eval-corpus/external-repos
cd eval-corpus/external-repos

# 2. Find recent TypeScript repos
gh search repos --language=typescript --created=">2024-06-01" --stars="10..100" --limit=20

# 3. Clone 5+ repos (pick ones with actual code, not just configs)
git clone https://github.com/<owner>/<repo> repo-1
git clone https://github.com/<owner>/<repo> repo-2
git clone https://github.com/<owner>/<repo> repo-3
git clone https://github.com/<owner>/<repo> repo-4
git clone https://github.com/<owner>/<repo> repo-5

# 4. Verify each is real
for dir in */; do
  echo "=== $dir ==="
  (cd "$dir" && git remote -v && git log --oneline -3)
done

# 5. Create manifest
cat > manifest.json << 'MANIFEST'
{
  "repos": [
    {"localName": "repo-1", "sourceUrl": "https://github.com/...", "verified": true},
    {"localName": "repo-2", "sourceUrl": "https://github.com/...", "verified": true},
    {"localName": "repo-3", "sourceUrl": "https://github.com/...", "verified": true},
    {"localName": "repo-4", "sourceUrl": "https://github.com/...", "verified": true},
    {"localName": "repo-5", "sourceUrl": "https://github.com/...", "verified": true}
  ],
  "validationNote": "All repos cloned from GitHub with verified git history"
}
MANIFEST
```

## Requirements

- Each repo must have `git remote -v` showing real GitHub origin
- Each repo must have real commit history (`git log` shows actual commits)
- Prefer repos created after 2024-06 or with <100 stars (less likely in training data)
- Each repo should have >500 LOC of actual code

## Definition of Done

- [ ] `eval-corpus/external-repos/` exists with 5+ repos
- [ ] Each repo passes: `git remote -v` shows GitHub origin
- [ ] `manifest.json` documents all repos
- [ ] Continue to WU-1001 after completion

## Output

```json
{
  "wu_id": "WU-801-REAL",
  "status": "complete",
  "repos_cloned": ["repo-1", "repo-2", "repo-3", "repo-4", "repo-5"],
  "evidence": "5 repos cloned from GitHub, all verified with git remote -v"
}
```

**After completing this, proceed to WU-1001.**
