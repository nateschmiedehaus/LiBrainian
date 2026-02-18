# LiBrainian Repo Folder Review (2026-02-17)

This review covers both local `HEAD` and `origin/main` (top-level trees match).

## Top-Level Folder Assessment

| Folder | Current State | Verdict | Action |
| --- | --- | --- | --- |
| `src/` | Core product logic and tests are dense and actively used | Keep | Continue refactoring toward clearer module boundaries |
| `.github/` | CI + eval + publish workflows in place | Keep | Add additional quality gates only when they are stable |
| `scripts/` | Strong eval/publish utility set; growing quickly | Keep + tighten | Keep scripts, but prune one-offs and enforce ownership |
| `docs/` | Very large documentation surface with mixed freshness | Improve | Keep canonical docs current; archive stale planning docs aggressively |
| `eval-corpus/` | Has harness assets and manifests, but README still labels placeholder status | Improve | Keep, but continuously replace placeholder language with measured corpus reality |
| `examples/` | Previously underdeveloped (single example) | Improve (implemented) | Added curated multi-example set + `examples/README.md` |
| `test/` | Small tracked surface; most tests live in `src/__tests__` | Keep | Keep deterministic tests in `src/__tests__`; avoid duplicate test trees |
| `config/` | Present locally but not consistently tracked | Improve | Decide and codify which config files are source-controlled |
| `state/` | Runtime artifacts, not source | Keep runtime-only | Continue to treat as generated evidence output |

## Immediate Upgrades Implemented

1. Expanded `examples/` from one file into a practical mini-suite:
   - `examples/README.md`
   - `examples/quickstart_programmatic.ts`
   - `examples/agentic_task_loop.ts`
   - existing `examples/feedback_loop_example.ts`
2. Added a machine-readable repo maturity audit tool:
   - `scripts/repo-folder-audit.mjs`
   - `npm run repo:audit`
3. Linked examples directly in public docs (`README.md`) so onboarding is actionable.
4. Removed tracked `src/strategic/*.wip` files and enforced `*.wip` ignore.

## Borrowed Patterns from Benchmarks

### From `claude-code`

- Keep a curated examples catalog with runnable patterns (mirrored via `examples/README.md`).
- Document strict operation modes and policy presets clearly.
- Treat hooks and policy guidance as first-class DX docs, not hidden config.

### From `openclaw`

- Use explicit audit/guard scripts as release hygiene primitives.
- Keep CLI workflows predictable and operator-visible.
- Prefer discoverable docs organization by journey/use-case, not only by internal module.

## Next Cuts / Upgrades (Priority)

1. **Docs cleanup pass**: archive stale planning/spec drift docs into a clearly marked `archive/` path.
2. **Config tracking policy**: decide which files in local `config/` become canonical tracked assets.
3. **Examples hardening**: add one real external-repo walkthrough example with expected output artifacts.
4. **Script lifecycle policy**: classify scripts as `core`, `diagnostic`, or `temporary`, and fail CI on temporary drift.
5. **Public surface hygiene**: keep `eval-corpus/external-repos/*` untracked (manifest-only), and block new tracked `.wip` files.
