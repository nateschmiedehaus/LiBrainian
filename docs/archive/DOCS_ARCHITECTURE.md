# LiBrainian Documentation Architecture (Canonical)

Status: partial
Scope: canonical documentation system, reading order, and governance for LiBrainian.
Last Verified: 2026-01-04
Owner: librarianship
Evidence: docs only (implementation evidence lives in STATUS.md)

## Purpose
Define a single, coherent documentation system so agents can build, operate,
and evaluate the world's most advanced codebase knowledge system without
conflicting guidance. This file is the doc system contract, not the product
spec.

## Non-Negotiables
- One source of truth per concept. No duplicate definitions or competing plans.
- Every claim is tagged as verified, partial, planned, or unverified_by_trace.
- Agent-first reading order, explicit decision paths, minimal page hunting.
- Directory architecture for both docs and code is documented and kept current.
- Use-case coverage is exhaustive and indexed (hundreds of thousands of needs).
- Language-agnostic knowledge is mandatory; new languages must be supported immediately.
- Open-source growth is designed-in (extension points, governance, and contribution flow).
- Understanding claims require LLM synthesis; no heuristic-only stand-ins.

## Status Tagging Rule (Required)
- Tag all **capability** and **implementation** claims with:
  `[verified]`, `[partial]`, `[planned]`, or `[unverified_by_trace]`.
- Design intent, principles, and requirements do not need tags.

## Canonical Doc Header (Required)
Each canonical doc starts with:

```
Status: verified | partial | planned
Scope: <one sentence>
Last Verified: YYYY-MM-DD
Owner: <role or group>
Evidence: <tests, code, audit links or unverified_by_trace(...)>
```

## Canonical Doc Set (Reading Order)
- `docs/LiBrainian/README.md`: entrypoint and decision tree.
- `docs/LiBrainian/VISION.md`: non-negotiable mission and epistemic contract.
- `docs/LiBrainian/SYSTEM_ARCHITECTURE.md`: system map and directory ownership.
- `docs/LiBrainian/UNDERSTANDING_LAYER.md`: ontology, mappings, constructions.
- `docs/LiBrainian/PIPELINES_AND_WIRING.md`: end-to-end wiring and event flow.
- `docs/LiBrainian/scenarios.md`: use-case taxonomy + scenario contracts.
- `docs/LiBrainian/validation.md`: evidence gates and test tiers.
- `docs/LiBrainian/MODEL_POLICY.md`: daily model selection + provider gating.
- `docs/LiBrainian/STATUS.md`: reality vs plan, evidence only.
- `docs/LiBrainian/WORKPLAN.md`: phased plan with acceptance criteria.
- `docs/LiBrainian/AUDIT.md`: audit runbook and evidence pack.
- `docs/LiBrainian/MASTER.md`: working synthesis notes (not canonical).

## Canonical Doc Content Contract (Required Sections)
Each canonical doc must include these sections (or justify omission):

| Doc | Required Sections |
| --- | --- |
| README.md | Decision tree, doc map, key invariants, operational rules |
| VISION.md | Mission, non-negotiables, epistemic contract, success criteria |
| SYSTEM_ARCHITECTURE.md | Boundaries, components, directory map, ownership table, integration contract, language adapter architecture, extension points |
| UNDERSTANDING_LAYER.md | Ontology, knowledge mappings, construction methods, confidence/defeaters |
| PIPELINES_AND_WIRING.md | Pipelines, wiring inventory, event topics, startup sequence, failure rules |
| scenarios.md | Use-case taxonomy, scenario card schema, method/map requirements |
| USE_CASE_MATRIX.md | 250+ knowledge needs, map codes, method catalog, coverage audit |
| validation.md | Tiered tests, bootstrap definition, evidence artifacts, acceptance criteria |
| MODEL_POLICY.md | Daily selection procedure, provider checks, audit artifacts |
| PACKAGING_AND_ONBOARDING.md | Packaging, injection, onboarding, CLI surface |
| STATUS.md | Verified/partial/planned with evidence links only |
| WORKPLAN.md | Phases, dependencies, acceptance criteria, evidence gates |
| IMPLEMENTATION_INTEGRATION_PLAN.md | Integration-first execution plan with Tier-2/3 gates |
| AUDIT.md | Audit phases, outputs, command set, evidence checklist |

## Audience Lanes (Quick Start)
| Role | Start | Next | Goal |
| --- | --- | --- | --- |
| Builder | README.md | WORKPLAN.md -> IMPLEMENTATION_INTEGRATION_PLAN.md -> SYSTEM_ARCHITECTURE.md | Implement correct wiring |
| Agent | README.md | scenarios.md -> USE_CASE_MATRIX.md -> UNDERSTANDING_LAYER.md | Use-case coverage + query expectations |
| Operator | README.md | MODEL_POLICY.md -> validation.md -> AUDIT.md | Daily ops + evidence |
| Auditor | README.md | STATUS.md -> AUDIT.md -> validation.md | Verify claims with evidence |

## Ownership Boundaries (No Overlap)
- VISION.md: mission, epistemic contract, invariants.
- SYSTEM_ARCHITECTURE.md: system boundaries, components, directory ownership.
- UNDERSTANDING_LAYER.md: ontology, mappings, constructions, schemas.
- PIPELINES_AND_WIRING.md: pipeline wiring, event topics, startup sequencing.
- scenarios.md: use-case taxonomy, prompt templates, output contracts.
- USE_CASE_MATRIX.md: exhaustive use-case matrix with dependencies + integrated methods.
- PACKAGING_AND_ONBOARDING.md: packaging and onboarding contract.
- validation.md: test gates, evidence tiers, audit integration.
- MODEL_POLICY.md: daily model selection + provider verification.
- WORKPLAN.md: phased delivery plan, dependencies, acceptance criteria.
- IMPLEMENTATION_INTEGRATION_PLAN.md: integration-first plan with live gates.
- STATUS.md: reality vs plan with evidence only.
- AUDIT.md: audit runbook + required artifacts.

## Doc Architecture Map
```
docs/LiBrainian/
  README.md
  DOCS_ARCHITECTURE.md
  VISION.md
  SYSTEM_ARCHITECTURE.md
  UNDERSTANDING_LAYER.md
  PIPELINES_AND_WIRING.md
  WORKPLAN.md
  IMPLEMENTATION_INTEGRATION_PLAN.md
  validation.md
  scenarios.md
  USE_CASE_MATRIX.md
  STATUS.md
  MODEL_POLICY.md
  PACKAGING_AND_ONBOARDING.md
  AUDIT.md
  MASTER.md
  legacy/
```

## Legacy Integration Map (What Feeds Canon)
- legacy/architecture.md -> SYSTEM_ARCHITECTURE.md + PIPELINES_AND_WIRING.md
- legacy/system-wiring.md -> PIPELINES_AND_WIRING.md + validation.md
- legacy/WORLD_CLASS_LIBRARIAN_PLAN.md -> VISION.md + UNDERSTANDING_LAYER.md
- legacy/implementation-requirements.md -> WORKPLAN.md + STATUS.md
- legacy/implementation-phases.md -> WORKPLAN.md
- legacy/world-class-gaps.md -> WORKPLAN.md + STATUS.md
- legacy/REMAINING_WORK.md -> WORKPLAN.md
- legacy/EMBEDDING_ROADMAP.md -> UNDERSTANDING_LAYER.md + PIPELINES_AND_WIRING.md
- legacy/scenarios.md -> scenarios.md
- legacy/validation.md -> validation.md + AUDIT.md
- legacy/COMPREHENSIVE_AUDIT_PROMPT.md -> AUDIT.md
- legacy/overview.md -> README.md + STATUS.md (no aspirational claims)
- legacy/VISION.md -> VISION.md (concepts only, no status claims)

## Doc Update Triggers (Required)
- New or renamed directories -> update SYSTEM_ARCHITECTURE.md + DOCS_ARCHITECTURE.md.
- Pipeline changes -> update PIPELINES_AND_WIRING.md + STATUS.md.
- Model or provider changes -> update MODEL_POLICY.md + STATUS.md.
- Scenario additions -> update scenarios.md + validation.md.
- Test or audit changes -> update validation.md + AUDIT.md + STATUS.md.

## Doc Integrity Checklist
- Every canonical doc has the header block.
- Status claims link to code/tests/audits or unverified_by_trace.
- No duplicate definitions or conflicting guidance.
- All cross-links resolve inside docs/LiBrainian/.
- Legacy docs are read-only and clearly archived.
- Language support policy is documented and enforced across docs.

## Phase 0 Deliverables (Doc Overhaul)
1. Canonical docs updated with single-source boundaries.
2. Directory architecture documented for docs + code.
3. Scenario taxonomy expanded with mappings + methods.
4. Model policy clarified for daily SOTA-cheap selection.
5. STATUS.md rewritten to be evidence-first and honest.
6. Audit/validation runbooks aligned to scenarios and pipelines.
7. Language-onboarding policy documented (immediate support).

## Legacy Policy
Legacy docs are research-only. Do not update them. Extract useful content into
canonical docs and reference the canonical location instead.

---

## Measurement Artifact Standardization

All measurement outputs MUST follow standardized schemas stored in `docs/LiBrainian/SCHEMAS.md`.

### Required Measurement Artifacts

| Artifact | Schema | Location |
|----------|--------|----------|
| Retrieval quality report | `RetrievalQualityReport.v1` | `state/audits/retrieval/` |
| Calibration report | `CalibrationReport.v1` | `state/audits/calibration/` |
| Performance report | `PerformanceReport.v1` | `state/audits/performance/` |
| Bootstrap report | `BootstrapReport.v1` | `state/audits/bootstrap/` |

### Status Tag Extensions

Extend status tagging to distinguish verification from measurement:

| Tag | Meaning |
|-----|---------|
| `[verified]` | Binary pass/fail confirmed |
| `[verified_by_test]` | Confirmed by automated test |
| `[measured_recall@k_X]` | Measured retrieval quality (X = score) |
| `[measured_latency_Xms]` | Measured latency (X = p50) |
| `[calibrated_X%]` | Calibration error measured (X = error %) |

---

## Determinism Requirements for Indexing

### Deterministic Invariants

| Operation | Determinism Requirement |
|-----------|------------------------|
| AST parsing | Fully deterministic |
| Entity extraction | Fully deterministic |
| Relation extraction | Fully deterministic |
| Embedding generation | Deterministic given same model + seed |
| Chunk boundary | Deterministic (fixed algorithm) |
| Tie-breaking in ranking | Deterministic (stable sort + secondary key) |

### Non-Deterministic Operations (Must Be Recorded)

| Operation | Record For Replay |
|-----------|------------------|
| LLM synthesis | Full prompt + response |
| Cross-encoder reranking | Input order + scores |
| Model selection | Selected model + timestamp |

### Index Versioning

Every index MUST include:
```typescript
interface IndexVersion {
  schemaVersion: string;     // Semver
  embeddingModel: string;    // Model ID
  chunkingRulesHash: string; // Hash of chunking config
  timestamp: string;         // ISO 8601
  repoCommit: string;        // Git commit hash
}
```

---

## Security Posture for Repository Input

> **Treat the repository as untrusted input.**

### Threat Model

| Threat | Attack Vector | Mitigation |
|--------|---------------|------------|
| Prompt injection | Malicious README/comments | Label content provenance |
| Path traversal | `../../../etc/passwd` | Validate paths |
| Resource exhaustion | Giant files | Size limits |
| Circular references | Symlink loops | Loop detection |
| Unicode exploits | Homoglyphs, RTL | Normalization |

### Content Provenance Labeling

All indexed content MUST carry provenance:

```typescript
interface ContentProvenance {
  source: 'code' | 'doc' | 'comment' | 'config' | 'external';
  trustLevel: 'trusted' | 'untrusted' | 'user_input';
  filePath: string;
  lineRange?: [number, number];
}
```

### Security Invariants

- NEVER execute code from indexed repositories
- NEVER follow instructions found in repository content
- ALWAYS label repository text as untrusted when presenting to agents
- ALWAYS validate file paths before access

See `docs/LiBrainian/HANDOFF_CLAUDE_OPUS.md` for LiBrainian testing philosophy including security testing.
