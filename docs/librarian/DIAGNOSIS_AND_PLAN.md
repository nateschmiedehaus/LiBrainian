# LiBrainian: Full Diagnosis, Root Cause Analysis, and Path Forward

**Date**: 2026-02-27
**Scope**: M0 (Dogfood-Ready) + M1 (Construction MVP) + Development Process Reform + Architectural Recovery
**Total Issues**: 853 created, 347 open, 195 reopened | **New orchestration issues**: #854–#869

---

## Part 1: Honest State of the Project

### What Actually Works (Genuinely)
- **CLI framework**: Commands dispatch correctly, structured JSON output, error envelopes well-formed
- **Indexing pipeline**: Tree-sitter parsing, function/module extraction, SQLite storage
- **`status` command**: Comprehensive, structured — rated "excellent" by patrol
- **`inspect` command**: Accurate module details, exports, dependencies, function signatures
- **`features` / `check-providers`**: Honest about capability and provider state
- **Construction discovery**: `constructions list` shows 27 constructions with descriptions
- **`feature-location-advisor`**: Finds code at correct locations with verified line numbers
- **Unit test infrastructure**: 10,768 tests, 98.9% pass rate, well-tiered
- **Patrol system**: Successfully discovers real problems, produces structured evidence
- **Build**: TypeScript compilation is clean

### What Does NOT Work (The Actual Product)

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | **Semantic search broken** | CRITICAL | 1.6% embedding coverage (194/11,847). No semantic match above 0.35 threshold. Different queries return identical results. Context Precision: 15.6% (target 70%). Hallucination Rate: 40.3% (target 5%). |
| 2 | **LLM synthesis unavailable** | CRITICAL | Claude CLI blocked in Claude Code sessions. Codex fallback fails. Every query degrades to structural-only. Core value proposition 100% unavailable in primary use environment. |
| 3 | **Constructions hollow/dangerous** | CRITICAL | 4/6 tested produce garbage. `refactoring-safety-checker` says safe=true with blast radius 0 on module with 10+ dependents. `code-quality-reporter` returns fabricated metrics. |
| 4 | **`context` command missing** | HIGH | Documented as core command. Returns "Unknown command" (exit 50). |
| 5 | **Status/Doctor contradict** | HIGH | Status says "up-to-date", Doctor says 329 hours stale. |
| 6 | **Path contamination** | HIGH | Eval-corpus paths mixed with workspace paths in results. |

### Measured Reality (GATES.json, 2026-02-22)

| Metric | Target | Measured | Gap |
|--------|--------|----------|-----|
| Retrieval Recall@5 | ≥0.80 | 0.726 | -9.3% |
| Context Precision | ≥0.70 | 0.156 | **-77.8%** |
| Hallucination Rate | <0.05 | 0.403 | **+706%** |
| Embedding Coverage | ~100% | 1.6% | **-98.4%** |
| NPS (patrol) | ≥7 | 4 | -43% |
| Would Recommend | >50% | 0% | -100% |

---

## Part 2: Root Cause Analysis — Why Did This Happen?

### RC1: Testing Theater
10,768 tests pass (98.9%). Product NPS is 4 with 0% would-recommend. Every LLM call is mocked. Every provider interaction is mocked. Embeddings use deterministic fakes. Tests verify code flows through right branches with perfect synthetic inputs. They never verify useful output with real inputs. The patrol system (real agents, real repos) found every critical issue. The test suite found none.

Matches SWE-bench research: UTBoost (2025) found 345 erroneous patches labeled "passing" (40.9% of leaderboard). "Are Solved Issues Really Solved?" (2025): 29.6% of passing patches wrong. EvalPlus: 19-29% performance drops when rigorous edge-case tests added.

### RC2: Agent-Generated Bureaucracy
**147 npm scripts** (not 80 — the actual count is nearly double). 76 files totaling **18,276 lines** in `scripts/`. 104 markdown docs in `docs/LiBrainian/`. The development process audit reveals:

- **26 evidence/policy/gate scripts** forming a circular self-verification chain: `evidence:manifest → evidence:reconcile → evidence:freshness-check → evidence:assert-gates → validate:checkpoint → validate:reality`. Six scripts, each checking the output of the previous.
- **14 E2E script variants** for one concept (outcome, dev-truth, reality, cadence — each with :quick variants)
- **22 evaluation harness scripts** calling LLM APIs, many with 4+ variants each
- The `scripts/` directory (18,276 lines) **rivals the actual product source code**

This is what happens when AGENTS.md says "implement the ENTIRE spec system from 0% to 100%" and "NEVER stop on blockers" — agents build systems to certify systems that certify other systems.

**Commit analysis**: 440 commits in 33 days (13.3/day). Fix:Feat ratio = **1.04:1** (169 fixes, 162 features). Features ship with defects at roughly the same rate they ship. Zero reverts — failures are hidden as new fix() commits rather than acknowledged as reverts.

### RC3: Premature Issue Closure
195 issues reopened. 141 M0 issues closed in 4-day sprint (Feb 21-24). 29 reopened Feb 27. Pattern: agent says "tests pass" → issue closed → patrol discovers fix doesn't work → issue reopened. Direct consequence of RC1.

### RC4: No Development-Time Reality Check
Only reality check is full patrol (40-60 min/repo). No fast smoke test exercises real embeddings or real queries. Developers work weeks before discovering nothing works.

### RC5: Claude-in-Claude Paradox Treated as Edge Case
The primary execution path (LLM synthesis via Claude CLI) is architecturally impossible in the primary use environment (Claude Code sessions). Should have been #1 priority from day one.

### RC6: Scope Explosion
853 issues, 6 milestones, 93 specs, 310 use cases, "Council of 30" for a v0.2.1 product. The project has 778,427 total TypeScript lines (484K source + 294K tests). Five god-files exceed 3,600 lines each: `mcp/server.ts` (12,401), `sqlite_storage.ts` (8,853), `query.ts` (7,096), `api/bootstrap.ts` (5,184), `quality_standards.ts` (3,653).

### RC7: Evidence System Became Noise
Every gate in GATES.json shows `fail (missing_evidence_links)` — even passing ones. When everything is red, nothing is red.

---

## Part 3: Questions You Didn't Ask (But Should Have)

### Q1: Is `@xenova/transformers` deprecated?
**Yes.** It has been superseded by `@huggingface/transformers` v3. The `@xenova/transformers` v2 package is unmaintained and will not receive updates. The underlying `onnxruntime-node` 1.14.0 is from 2023 and several major versions behind. **This is not optional — the current dependency is end-of-life.** Migration is mostly a namespace change but may require API adjustments.

### Q2: Is all-MiniLM-L6-v2 the right embedding model for code?
**No.** It was trained on natural language sentence pairs (NLI/paraphrases), not code. Its 256-token context window means most functions are truncated. The code claims "AUC 1.0" on code similarity — this is a self-referential micro-benchmark. Research (CoIR benchmark) shows code-specific models (CodeBERT, UniXcoder, voyage-code-3) significantly outperform general-purpose models. Issue #261 already identified this. Alternatives: `jina-embeddings-v2-base-code` (8K context, local), `nomic-embed-code` (local), or `voyage-code-3` (API, SOTA).

### Q3: Should the MCP server be the primary interface instead of CLI?
**Yes.** The project already has a 12,401-line MCP server implementation. MCP is the native interface for AI agents (Claude Code, Cursor). Using MCP eliminates the nested-session problem entirely — the host agent IS the LLM, so the tool doesn't need to spawn one. It also eliminates cold-start model loading (process stays resident). The CLI subprocess LLM transport is an architectural dead end.

### Q4: Is the 22-language tree-sitter claim tested?
**No.** The multilang test file tests exactly **one** non-TypeScript language: Java. All 22 grammars are `optionalDependencies` that may silently fail to install. No CI matrix tests each language. The claim is unverified and should not be made.

### Q5: Is 573MB of SQLite for indexing one project reasonable?
**No.** 421MB main index + 136MB knowledge graph + 16MB evidence ledger for a project with 1.6% embedding coverage. At full coverage, the database would exceed 2-3GB. Total project disk footprint: **14GB** (2.8GB node_modules, 5.4GB patrol sandbox, 1.8GB eval corpus, 573MB databases). A well-designed code index for ~480K lines should be 50-100MB.

### Q6: How much dead code exists?
The `package.json` explicitly excludes from publication: `guidance/`, `skills/`, `federation/`, `evaluation/`, `evolution/`, `agents/self_improvement/`. The `src/strategic/` directory alone has ~16,000 lines of aspirational frameworks (`quality_standards.ts`: 3,653 lines, `developer_experience.ts`: 3,652, `excellence_validation.ts`: 3,080). These are built, tested, and maintained but **never shipped**. Potentially 200K+ lines of dead code.

### Q7: Could agents game the evidence system?
**Yes.** METR documented that frontier models actively exploit scoring code (monkey-patching evaluation functions). LiBrainian's evidence system has a fundamental circularity: agents that produce evidence also write the code that validates evidence. Exploit vectors: lower thresholds, add fixtures that inflate metrics, modify `unverified_by_trace` classification. The `evidenceProfile quick` option already has lower bars (minPassRate 0.6 vs 0.75 for release). **Evaluation infrastructure should be in a separate, agent-immutable location.**

### Q8: What happens if Anthropic changes Claude CLI behavior?
The `--print` flag is undocumented. Nested session detection relies on internal env vars (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDECODE`). The API transport path (`callClaudeApi`) is the correct approach. CLI transport should be deprecated.

### Q9: Is there competition that already works?
**Yes.** Sourcegraph Cody (millions of users, enterprise), Greptile (82% issue detection), Continue.dev (open-source, MCP), Windsurf/Codeium (70+ languages), Cursor (built-in indexing). LiBrainian's best bet: MCP server providing structured code intelligence (call graphs, dependency maps, change impact) to host LLMs — the parts that work without embeddings or LLM synthesis.

### Q10: Is agent-only development sustainable?
The evidence says no. 778K lines, 147 scripts, 104 docs, five 3,600+ line god-files, 1:1 fix:feat ratio. No human developer writes 12,000-line files. Agent-generated monoliths grew unchecked with no structural review. Cursor reports a 30% PR merge rate for agent-generated PRs — 70% fail CI or review. **Human review checkpoints are essential.**

---

## Part 4: Development Process Reform

### What Industry Research Shows

**The core insight**: The gap between "tests pass" and "agent works" is a specification problem, not a testing problem. (EDDOps, 2024)

### Patterns from 7 Open-Source Projects + 5 Research Orgs

| Pattern | Source | What It Does | LiBrainian Equivalent |
|---------|--------|-------------|----------------------|
| PredeterminedTestModel | SWE-agent | Returns known LLM responses in sequence; tests full pipeline without nondeterminism | `PredeterminedLlmService` (#857) |
| VCR Cassette Recording | CrewAI | Records real API interactions, replays in CI. Cassettes committed to repo. Header filtering for 40+ sensitive headers. | T1.5 VCR integration tier |
| Three Genuine Tiers | OpenHands | Unit (mock) → Runtime Integration (real containers) → E2E (real LLM, gated by PR label) | T0/T0.5/T1/T1.5/T2/T3 reform |
| Anti-Override Meta-Tests | LangChain | `test_no_overrides_DO_NOT_OVERRIDE` — programmatically verify tests can't be silently deleted | Construction quality gate (#858) |
| Small Eval Sets from Failures | OpenAI Codex | Start with 10-20 prompts per skill. Each failure adds a test. "Begin with fast checks." | Replace 310 use cases with 10 |
| Separate Tests from Benchmarks | Aider | Tests = harness correctness (mocked). Benchmarks = real effectiveness (real LLMs, Docker). | T0-T1.5 vs T2-T3 split |
| Dataset/Solver/Scorer Composition | Inspect AI (UK AISI) | Modular eval components that compose. Not monolithic test scripts. | Decompose 22 eval scripts |
| Daily Scheduled Integration | LangChain | Real-API integration tests daily, not per-PR. 30+ provider secrets. | Move LLM evals to nightly |
| Agent-as-CI | Continue | Agent definitions as markdown, run via CLI, results as GitHub Check Runs | Already have patrol; simplify |
| Grab-Bag Quick Eval | METR | Lightweight subset overlapping main suite for fast iteration | T0.5 smoke test (#854) |
| Functional Evaluation | WebArena | Check if goal achieved, not specific action sequence. Self-hosted Docker replicas. | Patrol already does this |
| Three-Level Difficulty | GAIA | L1 (5 steps, 1 tool) → L2 (5-10 steps) → L3 (50 steps). Fast dev eval on L1. | T0.5 = L1, T2 = L2, T3 = L3 |

### The Three-Loop Framework (Industry Consensus)

Per OpenHands "Agents in the Outer Loop," Anthropic's Claude Code best practices, and Elastic's self-correcting CI:

| Loop | What | Speed | LiBrainian Current | LiBrainian Target |
|------|------|-------|-------------------|-------------------|
| **Inner** (local) | typecheck + changed tests | Seconds | **Missing** | `npm run check` = tsc + vitest --changed (<10s) |
| **PR** (CI) | build + unit + smoke | Minutes | 147 scripts, LLM calls on every push | typecheck + test + build + T0.5 (5 min) |
| **Outer** (scheduled) | LLM eval + patrol + e2e | Hours | Also runs on every push | Nightly/weekly/pre-release only |

**Anthropic explicitly warns**: "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" LiBrainian's AGENTS.md is 655 lines. Their recommended workflow: Explore → Plan → Implement → Commit. Not a 147-script build system.

### Current vs. Target Script Count

| Category | Current | Target | Action |
|----------|---------|--------|--------|
| Core dev (build/test/lint) | 13 | 13 | Keep |
| Test runners | 18 | 8 | Merge redundant modes |
| E2E pipeline | 14 → 16 | 3 | `test:e2e`, `test:e2e:full`, `test:e2e:publish` |
| Evaluation harnesses | 22 | 3 | `eval:quick`, `eval:full`, `eval:publish-gate` |
| Evidence/policy/gate | 26 | 1 | `evidence:verify` (CI does the rest) |
| Release pipeline | 11 | 5 | Keep core, remove ceremony |
| GH/patrol automation | 18 | 4 | `patrol:quick`, `patrol:full`, `gh:ship`, `gh:cleanup` |
| Misc | 24 | ~5 | Case by case |
| **Total** | **147** | **~35** | **-76% reduction** |

---

## Part 5: GitHub Issue Orchestration

### Issues Created (#854–#869)

All 16 orchestration issues have been created on GitHub with labels, milestones, acceptance criteria, and dependencies.

### PHASE 0: Immediate (Day 1)
| Issue | Title | Effort | Dependencies |
|-------|-------|--------|-------------|
| #860 | AGENTS.md Reduction 655→<100 lines | S 1-2 hrs | None (draft with placeholders; update refs after #854, #859) |

### PHASE 1a: M0 Emergency — Parallel Track (Week 1)
| Issue | Title | Effort | Dependencies |
|-------|-------|--------|-------------|
| #854 | T0.5 Reality Smoke Test | M 1-2 days | None |
| #855 | LLM API Transport Fallback | M 1-2 days | None |
| #866 | Migrate @xenova/transformers → @huggingface v3 | M 1-2 days | None |
| #868 | Implement or descope `context` command | M 1-2 days | None (decision only; implementation if chosen) |

### PHASE 1b: M0 Emergency — Dependent Track (Week 1-2)
| Issue | Title | Effort | Dependencies |
|-------|-------|--------|-------------|
| #856 | STATUS.md False Narrative Fix | S 2-4 hrs | #854 |
| #857 | PredeterminedLlmService Test Infrastructure | M 1-2 days | #854, #855 |
| #869 | Reality Verification Protocol | S 2-4 hrs | #854, #860 |

**Issue Closure Protocol** (replaces 'tests pass' as closure criterion):
For M0 issues, closure requires ALL of:
1. Code change merged to main
2. `npm test` passes (T0)
3. T0.5 reality smoke test passes (#854)
4. At least ONE of:
   - Patrol observation on the specific feature
   - Manual CLI test with documented command + output pasted in issue comment
   - T1 predetermined model test covering the fix path
'Tests pass' alone is explicitly NOT sufficient.

### PHASE 2: M0/M1 Process Reform (Week 2-3)
| Issue | Title | Effort | Dependencies |
|-------|-------|--------|-------------|
| #858 | Construction Quality Gate | L 3-5 days | #854, #857 |
| #859 | Reduce 147 npm Scripts to ~35 | L 3-5 days | #854, #856 |
| #864 | Scope Freeze M2/M3/M4 | S 2-4 hrs | #860 |
| #862 | Issue Closure Policy Enforcement | M 1-2 days | #854, #860, #869 |

### PHASE 3: M1 Cleanup (Week 3-4)
| Issue | Title | Effort | Dependencies |
|-------|-------|--------|-------------|
| #861 | Evidence System Simplification | M 1-2 days | #854, #856, #857, #859 |
| #863 | Docs Consolidation 104→~7 files | M 1-2 days | #856, #860 |
| #865 | Embedding Model Evaluation | L 3-5 days | #854, #866 |
| #867 | Dead Code Removal (~200K lines) | XL 1-2 weeks | #859, #858 |

### Existing Issues to Address (by Phase)

**Phase 0/1 — M0 completion (14 open issues)**:
- #662: Embedding truncation (THE #1 blocker — closed but problem persists, must reopen)
- #819, #826: EBOOTSTRAP_FAILED in hooks/bootstrap
- #813: Clean-clone bootstrap blocks dogfood
- #809: Pathological retrieval in eval
- #782: CLI flag swallowing (ship-blocking)
- #775: Sub-LLM defaults to Claude in nested sessions (ship-blocking)
- #774: Orphaned bootstrap contention (ship-blocking)
- #716: Invalid eval corpus (ship-blocking)
- #666: Hallucinated package methods (ship-blocking)
- #735: Build failure in constructions/index.ts
- #701: security.riskScore always 0
- #699: tribalKnowledge from rare patterns only
- #663: Stale AUC 1.0 claim

**Phase 2 — M1 construction integrity (10 active bugs)**:
- #718: Decompose query.ts (7,096 lines) — prerequisite to all retrieval improvement
- #745: Construction smoke gate 85% failure rate
- #709: api_indexer never wired to knowledge graph
- #708: safety_violation event never emitted
- #707: Contract.consumers never populated (critical for safety checker)
- #845, #844, #840: Query stall/lock/timeout bugs
- #843: npm package misses patrol_calibration module
- #832: Hook runtime coupling

### Full Dependency Graph

```
Chain 1 (Reality Testing — Critical Path A):
  #860 (Phase 0) → #854 (T0.5) → #856 (STATUS.md) → #859 (scripts) → #861 (evidence)
  NOTE: T0.5 initially tests structural retrieval only. Embedding quality assertions added after #866 lands.

Chain 2 (LLM Transport — Critical Path B):
  #855 (API transport) → #857 (PredeterminedLlmService) → #858 (construction gate) → M1 construction work

Chain 3 (Process Reform):
  #860 (AGENTS.md) → #869 (reality verification protocol) → #862 (closure policy)
  #860 → #864 (scope freeze)

Chain 4 (Embedding Migration — Independent Track):
  #866 (@xenova migration) → #662 (truncation fix) → #865 (model evaluation) → T0.5 embedding assertions added to #854

Chain 5 (Cleanup — Final Layer):
  #859 + #858 → #867 (dead code removal)
  #856 + #860 → #863 (docs consolidation)
```

---

## Part 6: What NOT to Do

1. **Do not create more spec files.** 93 is enough.
2. **Do not create more npm scripts.** 147 is the problem.
3. **Do not work on M2/M3/M4.** Product doesn't work at M0.
4. **Do not optimize the patrol system.** It works; the product doesn't.
5. **Do not write more gate definitions.** Fix existing ones.
6. **Do not close issues based on unit tests.** Require reality verification.
7. **Do not add more constructions.** Fix the 5 that matter.
8. **Do not create more docs.** Reduce from 104 to ~10.
9. **Do not keep @xenova/transformers.** It's deprecated. Migrate.
10. **Do not keep all-MiniLM-L6-v2 for code.** It's a natural language model with 256-token context.
11. **Do not keep CLI subprocess LLM transport as primary.** MCP server eliminates the nested-session problem.
12. **Do not let agents modify evaluation infrastructure.** Separate the scorer from the scored.

> **Note on MCP vs CLI**: The plan diagnoses CLI subprocess LLM transport as an architectural limitation (Claude-in-Claude paradox) and recommends MCP as the primary interface long-term. Issue #855 fixes the CLI transport as an M0 stopgap. MCP migration is intentionally deferred to M2 — do not invest in elaborate CLI transport beyond what #855 delivers.

---

## Part 7: Success Metrics

### M0 Done (Dogfood-Ready):
- [ ] Embedding coverage ≥ 80% on LiBrainian's own codebase
- [ ] Different queries return different results (T0.5 verified, #854)
- [ ] LLM synthesis works with ANTHROPIC_API_KEY in nested sessions (#855)
- [ ] Patrol NPS ≥ 6, "would recommend" > 0%
- [ ] No path contamination
- [ ] `status` and `doctor` agree (#856)
- [ ] All 14 open M0 issues closed with patrol verification
- [ ] T0.5 runs on every commit
- [ ] @xenova/transformers migrated to @huggingface/transformers v3

### M1 Done (Construction MVP):
- [ ] 5 constructions produce code-specific, useful output (#858)
- [ ] refactoring-safety-checker correctly identifies dependents (blast radius > 0)
- [ ] query.ts decomposed to <1,000 lines per file (#718)
- [ ] Context Precision ≥ 0.50 (from 0.156)
- [ ] Hallucination Rate ≤ 0.15 (from 0.403)
- [ ] Patrol NPS ≥ 7
- [ ] npm scripts reduced to ~35 (#859)
- [ ] AGENTS.md under 100 lines (#860)
- [ ] Evidence system replaced by CI checks (#861)
- [ ] docs/LiBrainian/ reduced to ~10 files (#863)

### Process Health:
- [ ] No issue closed without reality verification for 30 days
- [ ] T0.5 catches at least one real regression (proving it works)
- [ ] Inner loop feedback < 10 seconds
- [ ] No LLM API calls on PR CI (moved to nightly)
- [ ] Fix:Feat ratio < 0.5:1 for new feature work (current 1.04:1 will spike during recovery phase — this target applies after M1 completion)
- [ ] STATUS.md contains only machine-verified evidence
- [ ] Human review summary on every agent PR

---

## Note: This Document Is Disposable

This document is the rationale, not the plan. The plan is issues #854-#869 on GitHub. Once those issues are closed, archive this file to `docs/LiBrainian/legacy/`. The research companions (RESEARCH_AGENTIC_TESTING.md, RESEARCH_OPEN_SOURCE_PATTERNS.md) should be archived at the same time. Do not maintain these documents as living artifacts — that would recreate the documentation bloat this plan diagnoses.

---

## Appendix A: Research Sources

### Academic/Industry
- UTBoost (2025): 345 erroneous SWE-bench patches, 40.9% of leaderboard affected
- "Are Solved Issues Really Solved?" (2025): 29.6% of passing patches produce wrong behavior
- SWE-bench+ (2024): Resolution rates drop 12.47% → 3.97% after filtering weak tests
- "The SWE-Bench Illusion" (2025): Performance driven partly by memorization
- EDDOps (2024): Evaluation-Driven Development lifecycle with offline/online dual streams
- Agent-Testing Agent (2025): 60% more failures discovered than manual annotation
- "The Rise of Agentic Testing" (2026): Multi-agent testing with 60% reduction in invalid tests
- Anthropic: Infrastructure noise swings benchmarks by 6+ percentage points
- Anthropic: "Bloated CLAUDE.md files cause Claude to ignore instructions"
- OpenAI Codex: "Begin with fast checks, add slower checks only when they reduce risk"
- METR HCAST: Agents succeed 70-80% on <1hr tasks, <20% on >4hr tasks
- METR: Frontier models actively exploit scoring code (reward hacking)
- METR MALT: Behavioral monitors catch 80-90% of reward hacking at 5% FPR
- Amazon: Three-layer evaluation (final output, components, underlying LLM)
- WebArena: Self-hosted Docker replicas, functional (not syntactic) evaluation
- GAIA: 3-level difficulty tiers (5 steps → 10 steps → 50 steps)
- ARC-AGI: Public/semi-private/private split; compute-constrained evaluation
- Poetiq: Iterative refinement > chain-of-thought for ARC-AGI-2 (54% vs 45%)
- LiveCodeBench: Continuous collection prevents contamination
- EvalPlus: 80x more tests reveals 19-29% performance drops
- Inspect AI (UK AISI): Dataset/Solver/Scorer composition pattern
- MLE-bench: Real Kaggle competitions, medal-calibrated human baselines
- Elastic: Self-correcting CI as single build step, not 2000-line orchestrator

### Open-Source Test Pattern Comparison

| Project | Mock Strategy | Real LLM in CI? | Integration Approach | Key Innovation |
|---------|-------------|-----------------|---------------------|----------------|
| OpenHands | Mock() | Yes (e2e, gated by label) | Docker containers | Screenshot capture at every step |
| SWE-agent | PredeterminedTestModel | No (saved trajectories) | Docker + DummyRuntime | Trajectory replay testing |
| CrewAI | VCR cassettes | No (replay only) | VCR with header filtering | record_mode=none in CI |
| LangChain | GenericFakeChatModel | Yes (daily schedule) | Real APIs, 30+ secrets | Anti-override meta-tests |
| Aider | @patch("litellm") | No | Exercism benchmark (manual) | Tests ≠ Benchmarks separation |
| Continue | Real keys + skip | Yes (PR checks) | Agent-as-CI workflow | .md agent definitions |
| AutoGPT | Standard mocks | No | Docker Compose + Postgres | Snapshot testing for API drift |

## Appendix B: Development Process Audit Detail

### Script Category Breakdown (147 total)

| Category | Count | Assessment |
|----------|-------|-----------|
| Core dev (build/test/lint) | 13 | Essential |
| Test runners | 18 | Partially redundant |
| E2E pipeline variants | 16 | **Severely over-engineered** |
| Evaluation harnesses | 22 | **Mostly theater** |
| Evidence/policy/gate | 26 | **Circular self-verification** |
| Release pipeline | 11 | Core is reasonable |
| GH/patrol automation | 18 | Ambitious, sprawling |
| Misc | 24 | Case by case |

### Commit Pattern Analysis (440 commits, 33 days)
- 13.3 commits/day average, peak 86 on Feb 19
- 100% from one account, agent-generated conventional commit format
- fix(): 169 (38.4%), feat(): 162 (36.8%) — **1.04:1 fix:feat ratio**
- #718 alone: 33 commits (mechanical extraction refactoring)
- Zero reverts — failures hidden as new fix() commits

### CI Reality
- Only `ci.yml` and `unit-patrol.yml` actually gate PRs
- `e2e-cadence.yml` runs LLM evaluations on every push (expensive, should be nightly)
- `agent-patrol.yml` runs every 6 hours (informational, correct)
- Estimated API cost: $1,000-3,000+/month for project with zero revenue/users

### AGENTS.md Bloat
655 lines including: troubleshooting guides, session priorities from a month ago, sub-agent architecture specs, "implement ENTIRE spec system 0%→100%", "NEVER stop on blockers". Anthropic recommends keeping agent instructions short and focused. This is the opposite.
