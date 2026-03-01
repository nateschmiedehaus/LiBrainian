<!-- This file is auto-generated. Do not edit manually. Run: npm run status:generate -->
<!-- Last updated: 2026-02-27T00:00:00.000Z -->
<!-- Source files: docs/LiBrainian/GATES.json, state/e2e/reality-validation.json, state/patrol/ -->
<!-- EVIDENCE_AUTOGEN_START -->

# LiBrainian Status

**M0 (Dogfood-Ready): BLOCKED — do not use as launch-ready evidence.**

---

## Measured Reality (as of 2026-02-27)

Source: `state/e2e/reality-validation.json` (generated 2026-02-27T12:09:17.312Z)
Overall validation result: **FAILED**

| Metric | Target | Measured | Status |
|--------|--------|----------|--------|
| Retrieval Recall@5 | ≥0.80 | 0.726 | FAIL |
| Context Precision | ≥0.70 | 0.156 | FAIL |
| Hallucination Rate | <0.05 | 0.403 | FAIL |
| Embedding Coverage | ~100% | 1.6% (194/11,847) | FAIL |
| NPS (patrol) | ≥7 | 4 | FAIL |
| Would Recommend | >50% | 0% | FAIL |
| Query Latency p50/p99 | ≤500/2000ms | 824/2567ms | FAIL |

---

## Gate Status (GATES.json v2.2.0, last updated 2026-02-22)

All gates have status `fail (missing_evidence_links)` — evidence manifest is absent.
No gate is backed by evidence manifest paths.

| Gate | Status |
|------|--------|
| layer0.typecheck | fail (missing_evidence_links) |
| layer0.build | fail (missing_evidence_links) |
| layer0.tier0 | fail (missing_evidence_links) |
| layer0.tier1 | skip_when_unavailable |
| layer0.tier2 | requires_providers |
| layer1.noWave0Imports | fail (missing_evidence_links) |
| layer1.noDirectImports | fail (missing_evidence_links) |
| layer1.standaloneTests | fail (missing_evidence_links) |
| layer1.extractionPrereqs | fail (missing_evidence_links) |
| layer2.llmAdapter | fail (missing_evidence_links) |
| layer2.evidenceLedger | fail (missing_evidence_links) |
| layer2.capabilityNegotiation | fail (missing_evidence_links) |
| layer2.toolAdapter | fail (missing_evidence_links) |

---

## What Works (Verified by Patrol)

Source: `docs/LiBrainian/DIAGNOSIS_AND_PLAN.md` Part 1, confirmed by patrol observations.

- CLI framework: Commands dispatch correctly, structured JSON output, error envelopes well-formed.
- Indexing pipeline: Tree-sitter parsing, function/module extraction, SQLite storage.
- `status` command: Comprehensive, structured output.
- `inspect` command: Accurate module details, exports, dependencies, function signatures.
- `features` / `check-providers`: Honest about capability and provider state.
- Construction discovery: `constructions list` returns 27 constructions with descriptions.
- `feature-location-advisor`: Finds code at correct locations with verified line numbers.
- Unit test infrastructure: 10,768 tests, 98.9% pass rate.
- Patrol system: Successfully discovers real problems, produces structured evidence.
- Build: TypeScript compilation is clean.

---

## What Does NOT Work (Blocking M0)

Source: `docs/LiBrainian/DIAGNOSIS_AND_PLAN.md` Part 1, `state/e2e/reality-validation.json`.

| # | Issue | Severity |
|---|-------|----------|
| 1 | Semantic search broken: 1.6% embedding coverage (194/11,847 functions). No semantic match above 0.35 threshold. Different queries return identical results. Context Precision: 15.6% (target 70%). Hallucination Rate: 40.3% (target 5%). Root cause: #662 (256-token truncation). Issue #662 closed but problem confirmed regressed by patrol 2026-02-27. | CRITICAL |
| 2 | LLM synthesis unavailable: Claude CLI blocked in Claude Code sessions. Codex fallback active but unverified for synthesis quality. Every query degrades to structural-only. Core value proposition unavailable in primary use environment. | CRITICAL |
| 3 | Constructions hollow/dangerous: 4/6 tested produce garbage output. `refactoring-safety-checker` returns safe=true with blast radius 0 on modules with 10+ dependents. `code-quality-reporter` returns fabricated metrics. | CRITICAL |
| 4 | `context` command missing: Documented as core command. Returns "Unknown command" (exit 50). | HIGH |
| 5 | Status and Doctor contradict: `status` reports up-to-date; `doctor` reports stale. | HIGH |
| 6 | Path contamination: Eval-corpus paths mixed with workspace paths in results. | HIGH |

---

## Reality Validation Check Results (2026-02-27)

Source: `state/e2e/reality-validation.json`

- `status` command: exit code 1 (FAIL)
- `doctor` command: exit code 1, overallStatus=ERROR, 2 errors / 3 warnings / 15 ok
- `providers` command: exit code 0; claude=unavailable (nested session), codex=available; embedding=xenova/all-MiniLM-L6-v2
- smoke query: exit code 10, ENOINDEX — watch catch-up required before query
- evidence drift guard: exit code 0 (ok)
- patrol violation: closed issue #662 regressed — semantic retrieval degraded on all patrol queries

---

## M0 Blocking Issues

The following must be resolved before M0 can be claimed:

1. Embedding coverage ≥80% on LiBrainian's own codebase (currently 1.6%)
2. Different queries must return different results (T0.5 verified, #854)
3. LLM synthesis must work with ANTHROPIC_API_KEY in nested sessions (#855)
4. Patrol NPS ≥6, "would recommend" >0% (currently NPS=4, 0%)
5. No path contamination
6. `status` and `doctor` must agree (#856 dependency)
7. All 14 open M0 issues closed with patrol verification
8. T0.5 smoke test (#854) must pass on every commit
9. @xenova/transformers migrated to @huggingface/transformers v3 (#866)

---

## T0.5 Reality Smoke Test

Issue #854 defines the T0.5 smoke test as the authoritative fast-path reality check.
Until #854 lands and passes, there is no automated per-commit verification that the product works.
STATUS.md should reflect T0.5 results once that issue is implemented.

---

## Recovery Plan Reference

Full diagnosis and recovery plan: `docs/LiBrainian/DIAGNOSIS_AND_PLAN.md`
Active issues: #854–#869 on GitHub (nateschmiedehaus/LiBrainian)
Priority execution order: #860 → #854 → #855 → #866 → #856 → #857 → #858 → #859 → #861
Strategy tracker: `docs/librarian/CONVERSATION_INSIGHTS.md`
<!-- EVIDENCE_AUTOGEN_END -->
