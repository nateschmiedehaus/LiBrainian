# LiBrainian Master Notes (Working)

This document captures distilled notes while auditing LiBrainian docs. It is
not canonical and must not override `STATUS.md` or `WORKPLAN.md`.

## DOCS_ARCHITECTURE.md
- Canonical doc set and reading order defined with ownership boundaries.
- Legacy integration map and doc update triggers established.
- Doc integrity checklist emphasizes evidence-first claims.
- LLM synthesis is mandatory for understanding claims.

## README.md
- Clear entrypoint + decision tree for agents and builders.
- States non-negotiables: no fake embeddings, provider gates, daily models.

## VISION.md
- Mission and epistemic contract for world-class understanding.
- SCAS principles and emergent knowledge targets included.
- LLM understanding and breadth of knowledge needs emphasized.

## SYSTEM_ARCHITECTURE.md
- Layered system model with unified pipeline + event bus.
- Directory architecture for `src/LiBrainian` and docs/LiBrainian.
- Knowledge domain modules listed; wiring status deferred to STATUS.md.
- Language onboarding architecture and open-source extension points added.
- Resilient core contracts documented (result/error/health).
- Engine toolkit + Wave0 integration contract summarized.
- Adaptive system requirements documented (implicit/modular/adaptive).

## UNDERSTANDING_LAYER.md
- Knowledge primitives, ontology domains, mappings, constructions.
- Map registry expanded (security, compliance, quality, evolution, rationale).
- Coverage matrix and autonomy gating defined.
- Universal knowledge schema and retrieval method stack documented.
- Language-agnostic knowledge requirements and bootstrapping rules added.
- Understanding mandate requires LLM synthesis for semantic claims.

## PIPELINES_AND_WIRING.md
- Bootstrap/incremental flows, core pipelines, wiring inventory.
- Startup sequence requires provider checks + daily model selection.
- Full Wave0 + LiBrainian wiring inventory documented.
- Language onboarding pipeline and events added.
- Understanding pipeline forbids non-LLM semantic shortcuts.
- Method pack caching and hint injection called out in pipelines.

## WORKPLAN.md
- Five phases defined: Doc Canon, Model Policy, Pipelines, Integration,
  Knowledge + Scenarios, Validation + Ops.
- Legacy gap IDs mapped to phases.
- Open-source governance deliverable added to Phase 5.
- Failure mode and usability risk register added for phase targeting.

## STATUS.md
- Evidence-first status tracking; verified claims only when tested.
- Partial claims labeled unverified_by_trace with code references.
- Language onboarding and open-source documentation verified (docs-only).

## MODEL_POLICY.md
- Daily model selection with provider doc fetch and audit logs.
- Haiku-class default for LiBrainian unless proven insufficient.
- Date fetch + provider snapshot requirements clarified.

## validation.md
- Tiered gates with full bootstrap and live provider requirement.
- LiBrainian directory bootstrap explicitly required.
- Language onboarding validation added.
- LLM understanding validation added.

## scenarios.md
- Scenario catalog with combinatorial generation axes.
- Scenario card schema requires maps, methods, freshness, outputs, validation.
- Language onboarding scenarios added.
- LLM mandate for understanding scenarios added.

## USE_CASE_MATRIX.md
- 310 use-case rows with dependencies, process, and architecture citations.
- Explicit mapping to architecture references and planned capabilities.
- Layered knowledge dependencies called out per use case.
- Integrated problem-solving method catalog (220 methods).
- Added map codes, domain defaults, and coverage audit checklist.

## IMPLEMENTATION_INTEGRATION_PLAN.md
- Integration-first execution plan with Wave0 and external project support.
- Tier-2/3 live-provider gates embedded per phase.
- Output comparison and stress testing loops defined.

## PACKAGING_AND_ONBOARDING.md
- Packaging and injection guidance for any repo or agentic system.
- CLI and onboarding flow documented.
- OSS-grade packaging standards and plugin surface documented.

## AUDIT.md
- Audit runbook expanded to cover pipeline validity and gap analysis.
- Language onboarding audit checks added.

## Legacy Integration Notes
- system-wiring -> pipeline wiring inventory
- architecture -> unified pipeline and shared primitives
- WORLD_CLASS_LIBRARIAN_PLAN -> ontology + resilient core intent
- validation + audit prompts -> validation tiers + audit phases

---

## Measurement vs Verification Boundary

> **Verification** asks: "Did it pass?"
> **Measurement** asks: "How well did it perform?"

### Verification (Binary)
- Build passes: yes/no
- Tests pass: yes/no
- Provider available: yes/no

### Measurement (Continuous)
- Retrieval quality: recall@k, precision@k, nDCG
- Confidence calibration: stated vs empirical accuracy
- Latency: p50, p99 distribution
- Coverage: % of entities indexed

### Key Metrics Reference

| Metric | What It Measures | Target |
|--------|------------------|--------|
| **Fix-localization Recall@5** | Bug-relevant file in top 5 | ≥ 70% |
| **Change-impact Recall@10** | Affected call sites in top 10 | ≥ 60% |
| **Convention Recall@5** | Project ADRs/style guides retrieved | ≥ 50% |
| **Precision@5** | Relevant fraction of top 5 | ≥ 40% |
| **nDCG** | Ranking quality | ≥ 0.6 |
| **Calibration error** | |Stated confidence - empirical accuracy| | ≤ 10% |

### Performance SLO Summary

| SLO | Target | Measurement |
|-----|--------|-------------|
| Bootstrap latency (10k files) | < 5 minutes | Timer |
| Query latency p50 | < 500ms | Histogram |
| Query latency p99 | < 2s | Histogram |
| Index freshness | < 5 minutes after commit | Staleness |
| Cache hit rate | > 60% | Counter |

See `docs/LiBrainian/validation.md` for full SLO definitions and `docs/LiBrainian/CONTROL_LOOP.md` for measurement infrastructure.
