# LiBrainian Ecosystem Upgrade: PR Slicing Plan

**Generated**: 2026-01-08
**Scope**: MCP server, AGENTS.md, Skills, evidence graphs, hybrid retrieval, evaluation harness, security hardening
**Total PRs**: 24 (organized in 6 waves)

---

## Dependency DAG Overview

```
Wave 1: Foundational Types (no dependencies)
├── PR#1: Evidence graph types
├── PR#2: MCP protocol types
└── PR#3: AGENTS.md/Skills types

Wave 2: Core Infrastructure (depends on Wave 1)
├── PR#4: Evidence graph storage
├── PR#5: Defeater calculus engine
├── PR#6: AGENTS.md parser
└── PR#7: Skills loader + validator

Wave 3: MCP Server Core (depends on Wave 2)
├── PR#8: MCP server skeleton + resources
├── PR#9: MCP tools (query, bootstrap, audit)
├── PR#10: MCP authorization + consent hooks
└── PR#11: MCP audit trail integration

Wave 4: Retrieval Upgrades (depends on Wave 2)
├── PR#12: Query router + intent classification
├── PR#13: Hybrid retrieval primitives
├── PR#14: GraphRAG integration
└── PR#15: Injection defense layer

Wave 5: Evaluation + Security (depends on Waves 3-4)
├── PR#16: Differential patch testing
├── PR#17: Calibration with Brier scoring
├── PR#18: Replayable cognition
├── PR#19: OWASP LLM Top 10 controls
└── PR#20: Supply chain hardening

Wave 6: Documentation + Polish (depends on Wave 5)
├── PR#21: Agent integration cookbook
├── PR#22: Trust + verification guide
├── PR#23: Security posture document
└── PR#24: Reference implementations + demos
```

---

## Wave 1: Foundational Types

### PR#1: Add Evidence Graph Types

- **Title**: Add evidence graph core types
- **Goal**: Define the argument/evidence graph schema with nodes, supports, opposes, assumptions, and defeater types. No runtime logic yet.
- **Files touched**:
  - ADD `src/LiBrainian/epistemics/types.ts`
  - ADD `src/LiBrainian/epistemics/index.ts`
  - MODIFY `src/LiBrainian/types.ts` (import/re-export)
- **Depends on**: (none)
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/epistemics`
- **Tier-0 tests added**:
  - `src/LiBrainian/epistemics/__tests__/types.test.ts` (type guards, serialization)
- **Tier-2 checks (optional)**: N/A (types only)
- **Stop conditions**:
  - Type definitions fail to compile
  - Circular dependency detected
- **Notes**: Schema versioning field required for forward compatibility.

---

### PR#2: Add MCP Protocol Types

- **Title**: Add MCP protocol type definitions
- **Goal**: Define typed interfaces for all MCP resources, tools, and roots that LiBrainian will expose. Strict separation from implementation.
- **Files touched**:
  - ADD `src/LiBrainian/mcp/types.ts`
  - ADD `src/LiBrainian/mcp/schema.ts` (JSON Schema for tool inputs)
  - ADD `src/LiBrainian/mcp/index.ts`
- **Depends on**: (none)
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/mcp`
- **Tier-0 tests added**:
  - `src/LiBrainian/mcp/__tests__/schema.test.ts` (schema validation tests)
- **Tier-2 checks (optional)**: N/A
- **Stop conditions**:
  - Schema fails JSON Schema Draft-07 validation
  - Types don't align with MCP SDK v1.20.0
- **Notes**: Must align with `@modelcontextprotocol/sdk` v1.20.0 interfaces.

---

### PR#3: Add AGENTS.md and Skills Types

- **Title**: Add AgentGuidancePack and Skills type definitions
- **Goal**: Define typed structures for parsed AGENTS.md content (AgentGuidancePack) and Skills (SKILL.md + resources). Includes precedence rules.
- **Files touched**:
  - ADD `src/LiBrainian/guidance/types.ts`
  - ADD `src/LiBrainian/guidance/precedence.ts`
  - ADD `src/LiBrainian/skills/types.ts`
  - ADD `src/LiBrainian/skills/index.ts`
- **Depends on**: (none)
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/guidance src/LiBrainian/skills`
- **Tier-0 tests added**:
  - `src/LiBrainian/guidance/__tests__/precedence.test.ts` (directory precedence rules)
  - `src/LiBrainian/skills/__tests__/types.test.ts` (skill structure validation)
- **Tier-2 checks (optional)**: N/A
- **Stop conditions**:
  - Precedence logic ambiguous for nested monorepo cases
- **Notes**: Must handle AGENTS.md, CLAUDE.md, CODEX.md variants.

---

## Wave 2: Core Infrastructure

### PR#4: Implement Evidence Graph Storage

- **Title**: Add evidence graph storage layer
- **Goal**: Implement SQLite schema and CRUD operations for evidence nodes, edges, and defeaters. Support graph traversal queries.
- **Files touched**:
  - MODIFY `src/LiBrainian/storage/sqlite_storage.ts` (add evidence tables)
  - ADD `src/LiBrainian/migrations/002_evidence_graph.sql`
  - ADD `src/LiBrainian/epistemics/storage.ts`
- **Depends on**: PR#1
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/epistemics`
- **Tier-0 tests added**:
  - `src/LiBrainian/epistemics/__tests__/storage.test.ts` (CRUD, traversal, consistency)
- **Tier-2 checks (optional)**: `npm run test:integration -- evidence_graph`
- **Stop conditions**:
  - Migration breaks existing schema
  - Graph queries exceed 100ms for 10K nodes
- **Notes**: Must preserve backward compatibility with existing confidence fields.

---

### PR#5: Implement Defeater Calculus Engine

- **Title**: Upgrade defeater activation to full calculus
- **Goal**: Extend existing defeater system with typed defeaters (staleness, contradiction, coverage gaps, tool failure, sandbox mismatch, untrusted content influence). Contradictions remain visible.
- **Files touched**:
  - MODIFY `src/LiBrainian/knowledge/defeater_activation.ts` (add new types)
  - ADD `src/LiBrainian/epistemics/defeater_calculus.ts`
  - ADD `src/LiBrainian/epistemics/contradiction_tracker.ts`
- **Depends on**: PR#1, PR#4
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/epistemics`
- **Tier-0 tests added**:
  - `src/LiBrainian/epistemics/__tests__/defeater_calculus.test.ts`
  - `src/LiBrainian/epistemics/__tests__/contradiction_tracker.test.ts` (must include negative fixture: silent reconciliation = fail)
- **Tier-2 checks (optional)**: `npm run test:integration -- defeaters`
- **Stop conditions**:
  - Silent contradiction reconciliation detected
  - Defeater activation takes > 50ms per claim
- **Notes**: Critical invariant: contradictions MUST remain visible with explicit tradeoff documentation.

---

### PR#6: Implement AGENTS.md Parser

- **Title**: Add AGENTS.md parser with directory precedence
- **Goal**: Parse AGENTS.md (and variants) into typed AgentGuidancePack. Support nested discovery with deterministic precedence.
- **Files touched**:
  - ADD `src/LiBrainian/guidance/parser.ts`
  - ADD `src/LiBrainian/guidance/discovery.ts`
  - ADD `src/LiBrainian/guidance/validator.ts`
- **Depends on**: PR#3
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/guidance`
- **Tier-0 tests added**:
  - `src/LiBrainian/guidance/__tests__/parser.test.ts`
  - `src/LiBrainian/guidance/__tests__/discovery.test.ts` (monorepo fixtures)
  - `src/LiBrainian/guidance/__tests__/validator.test.ts`
- **Tier-2 checks (optional)**: Test against real wave0-autopilot AGENTS.md
- **Stop conditions**:
  - Parser fails on existing AGENTS.md in repo
  - Precedence order non-deterministic
- **Notes**: Must handle malformed markdown gracefully with explicit parse errors.

---

### PR#7: Implement Skills Loader and Validator

- **Title**: Add Skills loader with strict validation
- **Goal**: Load Skills folders (SKILL.md + scripts/resources), validate against schema, expose as Method Packs.
- **Files touched**:
  - ADD `src/LiBrainian/skills/loader.ts`
  - ADD `src/LiBrainian/skills/validator.ts`
  - ADD `src/LiBrainian/skills/method_pack_adapter.ts`
  - MODIFY `src/LiBrainian/methods/method_pack_service.ts` (integrate skills)
- **Depends on**: PR#3
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/skills`
- **Tier-0 tests added**:
  - `src/LiBrainian/skills/__tests__/loader.test.ts`
  - `src/LiBrainian/skills/__tests__/validator.test.ts` (negative fixtures for invalid skills)
  - `src/LiBrainian/skills/__tests__/method_pack_adapter.test.ts`
- **Tier-2 checks (optional)**: Load skills from `.claude/skills/` if present
- **Stop conditions**:
  - Invalid skill passes validation
  - Skill loading takes > 200ms per skill
- **Notes**: Cache + invalidate based on repo drift and explicit TTLs.

---

## Wave 3: MCP Server Core

### PR#8: Implement MCP Server Skeleton with Resources

- **Title**: Add MCP server with resource exposure
- **Goal**: Create production-grade MCP server exposing: file tree, symbols, knowledge maps, method packs, audits, provenance, repo/revision identity as resources.
- **Files touched**:
  - ADD `src/LiBrainian/mcp/server.ts`
  - ADD `src/LiBrainian/mcp/resources/file_tree.ts`
  - ADD `src/LiBrainian/mcp/resources/symbols.ts`
  - ADD `src/LiBrainian/mcp/resources/knowledge_maps.ts`
  - ADD `src/LiBrainian/mcp/resources/method_packs.ts`
  - ADD `src/LiBrainian/mcp/resources/audits.ts`
  - ADD `src/LiBrainian/mcp/resources/provenance.ts`
  - ADD `src/LiBrainian/mcp/resources/identity.ts`
- **Depends on**: PR#2, PR#6, PR#7
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/mcp`
- **Tier-0 tests added**:
  - `src/LiBrainian/mcp/__tests__/server.test.ts`
  - `src/LiBrainian/mcp/__tests__/resources.test.ts`
- **Tier-2 checks (optional)**: `npm run test:mcp:client` (mock client integration)
- **Stop conditions**:
  - MCP SDK handshake fails
  - Resource responses exceed 5MB
- **Notes**: Multi-workspace support with explicit provenance boundaries required.

---

### PR#9: Implement MCP Tools

- **Title**: Add MCP tools for query, bootstrap, audit operations
- **Goal**: Expose tools: bootstrap/index/update, query (typed intent), get_context_pack_bundle, verify_claim, run_audit, diff_runs, export_index.
- **Files touched**:
  - ADD `src/LiBrainian/mcp/tools/bootstrap.ts`
  - ADD `src/LiBrainian/mcp/tools/query.ts`
  - ADD `src/LiBrainian/mcp/tools/context_pack.ts`
  - ADD `src/LiBrainian/mcp/tools/verify_claim.ts`
  - ADD `src/LiBrainian/mcp/tools/audit.ts`
  - ADD `src/LiBrainian/mcp/tools/diff_runs.ts`
  - ADD `src/LiBrainian/mcp/tools/export.ts`
  - MODIFY `src/LiBrainian/mcp/server.ts` (register tools)
- **Depends on**: PR#8, PR#4, PR#5
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/mcp/tools`
- **Tier-0 tests added**:
  - `src/LiBrainian/mcp/tools/__tests__/*.test.ts` (one per tool)
- **Tier-2 checks (optional)**: End-to-end MCP client test with real LiBrainian instance
- **Stop conditions**:
  - Tool input validation fails to reject malformed inputs
  - Any tool execution exceeds 30s without streaming
- **Notes**: All tools must produce traceable audit artifacts.

---

### PR#10: Implement MCP Authorization and Consent Hooks

- **Title**: Add strict authorization model to MCP server
- **Goal**: Implement authorization checks. Add user-consent hooks for code execution, file writes, and external network access. Treat tool descriptions as untrusted.
- **Files touched**:
  - ADD `src/LiBrainian/mcp/auth/authorization.ts`
  - ADD `src/LiBrainian/mcp/auth/consent_hooks.ts`
  - ADD `src/LiBrainian/mcp/auth/untrusted_filter.ts`
  - MODIFY `src/LiBrainian/mcp/server.ts` (integrate auth)
- **Depends on**: PR#8, PR#9
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/mcp/auth`
- **Tier-0 tests added**:
  - `src/LiBrainian/mcp/auth/__tests__/authorization.test.ts`
  - `src/LiBrainian/mcp/auth/__tests__/consent_hooks.test.ts` (negative: unauthorized action must fail)
  - `src/LiBrainian/mcp/auth/__tests__/untrusted_filter.test.ts` (injection patterns)
- **Tier-2 checks (optional)**: Adversarial tool description injection test
- **Stop conditions**:
  - Unauthorized action succeeds
  - Consent bypass possible
- **Notes**: Critical security boundary. Fail closed on any ambiguity.

---

### PR#11: Implement MCP Audit Trail Integration

- **Title**: Add comprehensive audit trail for MCP interactions
- **Goal**: All MCP interactions produce traceable audit artifacts with timestamps, request/response hashes, and provenance.
- **Files touched**:
  - ADD `src/LiBrainian/mcp/audit/trail.ts`
  - ADD `src/LiBrainian/mcp/audit/artifact_writer.ts`
  - MODIFY `src/LiBrainian/mcp/server.ts` (wrap all handlers)
- **Depends on**: PR#10
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/mcp/audit`
- **Tier-0 tests added**:
  - `src/LiBrainian/mcp/audit/__tests__/trail.test.ts`
  - `src/LiBrainian/mcp/audit/__tests__/artifact_writer.test.ts`
- **Tier-2 checks (optional)**: Verify audit artifacts are valid JSON and parseable
- **Stop conditions**:
  - MCP interaction missing audit artifact
  - Audit artifact missing required fields
- **Notes**: Artifacts stored in `state/audits/mcp/`.

---

## Wave 4: Retrieval Upgrades

### PR#12: Implement Query Router with Intent Classification

- **Title**: Add query router with intent-based strategy selection
- **Goal**: Route queries to appropriate retrieval strategy based on intent (understand/debug/refactor/impact/security). Classification must be explainable.
- **Files touched**:
  - ADD `src/LiBrainian/query/router.ts`
  - ADD `src/LiBrainian/query/intent_classifier.ts`
  - ADD `src/LiBrainian/query/strategy_selector.ts`
  - MODIFY `src/LiBrainian/api/query.ts` (integrate router)
- **Depends on**: PR#4
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/query`
- **Tier-0 tests added**:
  - `src/LiBrainian/query/__tests__/router.test.ts`
  - `src/LiBrainian/query/__tests__/intent_classifier.test.ts` (fixture per intent type)
- **Tier-2 checks (optional)**: LLM-backed classification accuracy test
- **Stop conditions**:
  - Intent classification accuracy < 80% on test set
  - Router decision not explainable
- **Notes**: All routing decisions logged as evidence.

---

### PR#13: Implement Hybrid Retrieval Primitives

- **Title**: Add BM25, dense, late-interaction, and cross-encoder retrieval
- **Goal**: Implement retrieval primitives: sparse lexical (BM25), dense semantic, late-interaction multi-vector, and cross-encoder reranking. All measurable.
- **Files touched**:
  - ADD `src/LiBrainian/retrieval/bm25.ts`
  - ADD `src/LiBrainian/retrieval/dense.ts`
  - ADD `src/LiBrainian/retrieval/late_interaction.ts`
  - MODIFY `src/LiBrainian/api/embedding_providers/cross_encoder_reranker.ts` (enhance)
  - ADD `src/LiBrainian/retrieval/fusion.ts`
- **Depends on**: PR#12
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/retrieval`
- **Tier-0 tests added**:
  - `src/LiBrainian/retrieval/__tests__/bm25.test.ts`
  - `src/LiBrainian/retrieval/__tests__/dense.test.ts`
  - `src/LiBrainian/retrieval/__tests__/fusion.test.ts` (ranking quality metrics)
- **Tier-2 checks (optional)**: Retrieval quality benchmark (MRR, NDCG)
- **Stop conditions**:
  - BM25 fails on exact keyword match
  - Fusion degrades single-method performance
- **Notes**: Each primitive must report retrieval confidence.

---

### PR#14: Implement GraphRAG Integration

- **Title**: Add graph-based retrieval and summarization
- **Goal**: Build knowledge graphs with controlled schemas. Use graph retrieval for large corpora. Measure benefit vs baseline.
- **Files touched**:
  - ADD `src/LiBrainian/retrieval/graph_rag.ts`
  - ADD `src/LiBrainian/retrieval/graph_schema.ts`
  - ADD `src/LiBrainian/retrieval/graph_summarization.ts`
  - MODIFY `src/LiBrainian/query/router.ts` (add graph strategy)
- **Depends on**: PR#12, PR#13, PR#4
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/retrieval`
- **Tier-0 tests added**:
  - `src/LiBrainian/retrieval/__tests__/graph_rag.test.ts`
  - `src/LiBrainian/retrieval/__tests__/graph_summarization.test.ts`
- **Tier-2 checks (optional)**: A/B comparison vs non-graph retrieval
- **Stop conditions**:
  - GraphRAG performs worse than baseline (abort, don't cargo-cult)
  - Graph construction exceeds 2x indexing time
- **Notes**: If no measurable benefit, this PR documents the negative result and disables by default.

---

### PR#15: Implement Injection Defense Layer

- **Title**: Add multi-layer defense against retrieval corruption
- **Goal**: Treat repository content as untrusted. Detect instruction patterns. Implement isolate-then-aggregate for high-risk queries. Adversarial test suite.
- **Files touched**:
  - ADD `src/LiBrainian/security/injection_detector.ts`
  - ADD `src/LiBrainian/security/isolated_aggregator.ts`
  - ADD `src/LiBrainian/security/adversarial_fixtures.ts`
  - MODIFY `src/LiBrainian/api/query.ts` (integrate defense)
- **Depends on**: PR#12
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/security`
- **Tier-0 tests added**:
  - `src/LiBrainian/security/__tests__/injection_detector.test.ts` (50+ injection patterns)
  - `src/LiBrainian/security/__tests__/isolated_aggregator.test.ts`
  - `src/LiBrainian/security/__tests__/adversarial.test.ts` (must pass all)
- **Tier-2 checks (optional)**: Red team injection test suite
- **Stop conditions**:
  - Any adversarial fixture bypasses detection
  - False positive rate > 5%
- **Notes**: Critical security boundary. Fail closed on detected injection.

---

## Wave 5: Evaluation + Security

### PR#16: Implement Differential Patch Testing

- **Title**: Add behavioral patch comparison in evaluation harness
- **Goal**: Compare behavioral consequences of patches (candidate vs baseline). Detect test suite insufficiency. Emit structured reports.
- **Files touched**:
  - ADD `src/LiBrainian/evaluation/differential.ts`
  - ADD `src/LiBrainian/evaluation/patch_analyzer.ts`
  - ADD `src/LiBrainian/evaluation/insufficiency_detector.ts`
  - ADD `src/LiBrainian/evaluation/report_generator.ts`
- **Depends on**: PR#4, PR#5
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/evaluation`
- **Tier-0 tests added**:
  - `src/LiBrainian/evaluation/__tests__/differential.test.ts`
  - `src/LiBrainian/evaluation/__tests__/insufficiency_detector.test.ts` (green-but-wrong fixtures)
- **Tier-2 checks (optional)**: Run against known SWE-bench patches
- **Stop conditions**:
  - "Green but wrong" patch passes undetected
  - Report missing required fields
- **Notes**: Core anti-hallucination defense.

---

### PR#17: Implement Empirical Calibration with Brier Scoring

- **Title**: Upgrade calibration to empirical process with Brier scores
- **Goal**: Decompose confidence (retrieval, structural, semantic, test/exec, recency). Learn calibration per repo/language/task. Report drift.
- **Files touched**:
  - MODIFY `src/LiBrainian/api/confidence_calibration.ts` (add Brier scoring)
  - ADD `src/LiBrainian/measurement/calibration_learner.ts`
  - ADD `src/LiBrainian/measurement/confidence_decomposition.ts`
  - ADD `src/LiBrainian/measurement/drift_reporter.ts`
- **Depends on**: PR#4, PR#5
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/measurement`
- **Tier-0 tests added**:
  - `src/LiBrainian/measurement/__tests__/calibration_learner.test.ts`
  - `src/LiBrainian/measurement/__tests__/confidence_decomposition.test.ts`
  - `src/LiBrainian/measurement/__tests__/drift_reporter.test.ts`
- **Tier-2 checks (optional)**: Calibration accuracy on historical data
- **Stop conditions**:
  - Brier score calculation incorrect (verified against reference)
  - Drift detection misses known distribution shift
- **Notes**: Store reliability curves for audit.

---

### PR#18: Implement Replayable Cognition

- **Title**: Add deterministic replay and diff tooling
- **Goal**: Every run reproducible via deterministic replay. Same inputs + traces = same outputs (minus time). Provide replay/diff commands.
- **Files touched**:
  - ADD `src/LiBrainian/replay/recorder.ts`
  - ADD `src/LiBrainian/replay/player.ts`
  - ADD `src/LiBrainian/replay/differ.ts`
  - ADD `src/LiBrainian/cli/commands/replay.ts`
  - ADD `src/LiBrainian/cli/commands/diff_run.ts`
  - MODIFY `src/LiBrainian/mcp/tools/diff_runs.ts` (integrate)
- **Depends on**: PR#11
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/replay`
- **Tier-0 tests added**:
  - `src/LiBrainian/replay/__tests__/recorder.test.ts`
  - `src/LiBrainian/replay/__tests__/player.test.ts` (determinism check)
  - `src/LiBrainian/replay/__tests__/differ.test.ts`
- **Tier-2 checks (optional)**: Replay real bootstrap run and verify identical output
- **Stop conditions**:
  - Non-determinism in replay (output differs)
  - Trace format not forward-compatible
- **Notes**: Critical for debugging and audit.

---

### PR#19: Implement OWASP LLM Top 10 Controls

- **Title**: Add explicit OWASP LLM Top 10 controls and tests
- **Goal**: Implement and test controls for: prompt injection, insecure output handling, excessive agency, supply chain vulnerabilities, sensitive info disclosure, unbounded consumption.
- **Files touched**:
  - ADD `src/LiBrainian/security/owasp/index.ts`
  - ADD `src/LiBrainian/security/owasp/prompt_injection.ts`
  - ADD `src/LiBrainian/security/owasp/output_handling.ts`
  - ADD `src/LiBrainian/security/owasp/excessive_agency.ts`
  - ADD `src/LiBrainian/security/owasp/supply_chain.ts`
  - ADD `src/LiBrainian/security/owasp/info_disclosure.ts`
  - ADD `src/LiBrainian/security/owasp/consumption_limits.ts`
- **Depends on**: PR#15, PR#10
- **Tier-0 gate**: `npm run typecheck && npm run test:unit -- src/LiBrainian/security/owasp`
- **Tier-0 tests added**:
  - `src/LiBrainian/security/owasp/__tests__/*.test.ts` (one per control, with negative fixtures)
- **Tier-2 checks (optional)**: Full OWASP control validation
- **Stop conditions**:
  - Any control missing test coverage
  - Known attack pattern bypasses control
- **Notes**: Generates security posture document.

---

### PR#20: Implement Supply Chain Hardening

- **Title**: Add provenance, SLSA, signatures, and OpenSSF checks
- **Goal**: npm trusted publishing, SLSA build provenance, release signing, verification instructions, OpenSSF Scorecard integration.
- **Files touched**:
  - ADD `.github/workflows/release.yml` (SLSA + signing)
  - ADD `scripts/verify_release.ts`
  - ADD `docs/SECURITY_VERIFICATION.md`
  - MODIFY `package.json` (publishConfig)
  - ADD `.github/workflows/scorecard.yml`
- **Depends on**: PR#19
- **Tier-0 gate**: `npm run typecheck && npm run build`
- **Tier-0 tests added**:
  - `scripts/__tests__/verify_release.test.ts`
- **Tier-2 checks (optional)**: Dry-run release with attestation
- **Stop conditions**:
  - Release workflow fails attestation
  - OpenSSF score < 7.0
- **Notes**: Score tracked as KPI in CI.

---

## Wave 6: Documentation + Polish

### PR#21: Create Agent Integration Cookbook

- **Title**: Add comprehensive agent integration documentation
- **Goal**: Document MCP, AGENTS.md, Skills integration with examples for multiple agent frameworks.
- **Files touched**:
  - ADD `docs/LiBrainian/AGENT_COOKBOOK.md`
  - ADD `docs/LiBrainian/examples/mcp_client.ts`
  - ADD `docs/LiBrainian/examples/skills_usage.ts`
  - ADD `docs/LiBrainian/examples/agents_md_integration.ts`
- **Depends on**: PR#8, PR#9, PR#6, PR#7
- **Tier-0 gate**: `npm run typecheck -- docs/LiBrainian/examples`
- **Tier-0 tests added**:
  - Example files must compile
- **Tier-2 checks (optional)**: Examples run successfully against live LiBrainian
- **Stop conditions**:
  - Example code doesn't compile
  - Missing coverage for major use case
- **Notes**: Must be good enough that engineers adopt without a meeting.

---

### PR#22: Create Trust and Verification Guide

- **Title**: Add guide for validating claims and replaying runs
- **Goal**: Document how to validate claims, replay runs, verify provenance, interpret defeaters.
- **Files touched**:
  - ADD `docs/LiBrainian/TRUST_VERIFICATION.md`
  - ADD `docs/LiBrainian/EPISTEMIC_MODEL.md`
  - MODIFY `docs/LiBrainian/README.md` (link)
- **Depends on**: PR#18, PR#5
- **Tier-0 gate**: Markdown lint passes
- **Tier-0 tests added**: N/A (docs)
- **Tier-2 checks (optional)**: Technical review by second maintainer
- **Stop conditions**:
  - Broken internal links
  - Missing section from spec
- **Notes**: Includes threat model and epistemic model narratives.

---

### PR#23: Create Security Posture Document

- **Title**: Add security posture document with OWASP alignment
- **Goal**: Document threats, mitigations, residual risks, and test evidence. Aligned to OWASP LLM Top 10.
- **Files touched**:
  - ADD `docs/LiBrainian/SECURITY_POSTURE.md`
  - ADD `docs/LiBrainian/THREAT_MODEL.md`
  - MODIFY `SECURITY.md` (disclosure path)
- **Depends on**: PR#19, PR#20
- **Tier-0 gate**: Markdown lint passes
- **Tier-0 tests added**: N/A (docs)
- **Tier-2 checks (optional)**: Security review
- **Stop conditions**:
  - Missing threat from OWASP Top 10
  - Residual risk undocumented
- **Notes**: Links to test evidence for each control.

---

### PR#24: Create Reference Implementations and Demos

- **Title**: Add MCP client example, demo repo, and scripted scenarios
- **Goal**: Minimal MCP client, MCP server deployment example, demo repo with impressive verifiable outputs.
- **Files touched**:
  - ADD `examples/mcp_client/`
  - ADD `examples/mcp_server_deploy/`
  - ADD `examples/demo_repo/`
  - ADD `examples/scenarios/`
  - ADD `CONTRIBUTING.md`
  - ADD `CODE_OF_CONDUCT.md`
  - MODIFY `docs/LiBrainian/ROADMAP.md`
- **Depends on**: PR#21, PR#22, PR#23
- **Tier-0 gate**: Examples compile and run
- **Tier-0 tests added**:
  - `examples/__tests__/mcp_client.test.ts`
  - `examples/__tests__/scenarios.test.ts`
- **Tier-2 checks (optional)**: Full scenario run produces expected artifacts
- **Stop conditions**:
  - Example fails to demonstrate claimed capability
  - Missing governance file
- **Notes**: Final PR. Project release-ready after this.

---

## Summary

| Wave | PRs | Focus | Risk Level |
|------|-----|-------|------------|
| 1 | #1-3 | Types (foundation) | Low |
| 2 | #4-7 | Core infrastructure | Medium |
| 3 | #8-11 | MCP server | High (security) |
| 4 | #12-15 | Retrieval upgrades | Medium |
| 5 | #16-20 | Evaluation + security | High |
| 6 | #21-24 | Documentation + polish | Low |

**Critical path**: PR#1 → PR#4 → PR#5 → PR#8 → PR#10 → PR#19 → PR#20

**Estimated total test files added**: 40+
**Estimated total new source files**: 60+
**Estimated LOC**: 15,000-20,000

---

## Invariants (enforced across all PRs)

1. **No silent reconciliation**: Contradictions must remain visible
2. **Fail closed**: Ambiguous security situations fail closed
3. **Evidence required**: All claims backed by evidence graph nodes
4. **Audit trail**: All MCP interactions produce artifacts
5. **Provider mandate**: Real embeddings, real LLMs, no mocks
6. **Determinism**: Replay produces identical output
