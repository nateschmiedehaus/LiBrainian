# Issue 716 Research — Replace Invalid Eval Corpus

## Why automation failed
- The last eval-corpus workflow (2026-02-25) hard-stopped because required fixture files under `eval-corpus/repos/adversarial-circular-deps/.librarian-eval/manifest.json` were missing, so `npm run eval:ci` had no machine-verifiable artifacts to score. Source: `docs/archive/evals/dogfood/gh_inbox_failure_review_2026-02-25.md`.
- Agent orchestration keeps re-running against the same synthetic fixtures (`small-typescript`, `medium-python`, etc.) even though governance already flagged them as invalid because they have no git remote and can be (and were) authored by the same models we are evaluating. Source: `docs/archive/AGENTS_v1.md` and `docs/archive/specs/BLOCKER_RESOLUTION.md` (section "All eval repos are synthetic / created by model").
- Current constructions (for example `src/constructions/processes/bootstrap_quality_gate.ts:169`, `query_relevance_gate.ts:68`, `context_pack_depth_gate.ts:291`) still point at `eval-corpus/repos/*`. Nothing in those gates looks at the new external corpus, so even perfect external data would never be consumed.

## Evidence that real repos already exist
- `eval-corpus/external-repos/manifest.json` codifies 23 GitHub repos (TS, JS, Python, Go, Rust, Java, Kotlin, C#, PHP, Swift, Ruby, C, C++, Scala, Dart, Lua, Shell, SQL, HTML, CSS) with pinned commits, clone timestamps, and verification notes. The alias mapping is mirrored in `docs/archive/EXTERNAL_REPO_ALIAS_MAPPING.md` for reproducible folder names.
- `librarian external-repos sync` already knows how to clone from the manifest and create symlinks under `eval-corpus/external-repos/repos/<alias>`, but manifest rows are never marked "ready" because the downstream gates never ask for them (& there is no `.LiBrainian-eval` ground-truth alongside the clones).

## Diagnosis
1. **Fixture drift (structural)** — Automation keeps looking at `eval-corpus/repos`, so even when we add new external repos the gates do not touch them.
2. **Missing ground truth (data)** — The manifest lists real repos, but there is no scripted path to emit `.LiBrainian-eval/ground-truth.json` for each clone, so smoke/eval runners fail fast.
3. **Governance gap (process)** — Issue #716 previously had "replace invalid eval corpus" as a single bullet without explicit acceptance criteria, so agents tried to "fix everything" at once and exhausted retries.

## Selected managerial action
- **Scope split.** Requirements already exist (real repos, manifest, smoke harness). Non-convergence came from "do everything" scope; we will split implementation into three subtracks (sync, ground truth, gate migration) with independent exit checks before re-queueing #716 proper.
