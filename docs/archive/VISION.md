# LiBrainian Vision

Status: partial
Scope: non-negotiable purpose, values, and success criteria.
Last Verified: 2026-01-04
Owner: librarianship
Evidence: docs only (operational evidence lives in STATUS.md)

## Mission
Create the most advanced knowledge and understanding system for any codebase,
providing agents and humans with evidence-backed, calibrated, actionable insight.

## What "World-Class" Means Here
- Accurate understanding, not just similarity search.
- Explicit evidence and trace for every claim.
- Confidence that is calibrated, defeatable, and visible.
- Coverage of real engineering work, not toy examples.

## Epistemic Contract (Hard)
- Every claim includes evidence, confidence, and defeaters.
- Unknowns are explicit with next actions to resolve them.
- No degraded "MVP" knowledge path in production runs.

## Non-Negotiable Principles
1) Evidence-first knowledge: no untraced claims.
2) No fake embeddings or provider bypass.
3) One unified ingest + query pipeline.
4) Confidence must be visible and defensible.
5) Usable by agents and humans equally.
6) Language-agnostic by default; new languages onboard immediately.
7) Open-source growth is designed into architecture and governance.
8) Understanding requires LLM synthesis; no non-LLM shortcuts for semantic claims.

## Use-Case Completeness Contract
- LiBrainian must handle hundreds of thousands of knowledge needs via a
  combinatorial scenario taxonomy.
- Coverage must generalize to any codebase, language mix, and repo scale.
- Every use case must map to explicit knowledge primitives and evidence.
- The catalog must include any knowledge a programmer or agent could need,
  including analysis, risks, rationale, and operational guidance.

## SCAS Principles (Successful Complex Adaptive System)
LiBrainian supports a SCAS by enabling:
- Diverse agents with specialized roles and shared knowledge.
- Feedback loops that improve knowledge from outcomes.
- Emergent intelligence from shared primitives and evidence.
- Homeostasis via quality gates and defeaters.
- Multi-level intelligence (agent, team, system).

## Understanding as the Core
Understanding is not retrieval. It is:
- Purpose: why this exists.
- Mechanism: how it works.
- Contract: inputs/outputs/invariants.
- Dependencies: what it relies on and provides.
- Consequences: what breaks when it changes.

## Universal Knowledge Domains
LiBrainian models domains present in every codebase:
identity, semantics, structure, relationships, history, ownership, risk,
testing, security, rationale, tribal knowledge, and quality.

## Language-Agnostic Mandate
LiBrainian must provide knowledge for any codebase, regardless of language or
framework. When a new language is encountered, LiBrainian must:
- Detect and classify it.
- Onboard parsing/analysis immediately (fallback + queued adapter).
- Produce evidence-backed understanding with explicit gaps.

## Complexity-Science Alignment
LiBrainian is a complex adaptive system:
- Feedback loops continually update confidence and priorities.
- Emergent structures are discovered, not hard-coded.
- Adaptation is a core requirement, not a future enhancement.

## THE CONTROL THEORY MODEL

> **LiBrainian = Perception + State Estimation**
> **DevTool = Controller + Actuator**

### The Coupled System

LiBrainian and the agent orchestrator form a cybernetic loop:

```
┌─────────────────────────────────────────────────────────────────┐
│                        THE WORLD (Codebase)                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓ observations
┌─────────────────────────────────────────────────────────────────┐
│                     LiBrainian (Perception)                      │
│  • AST parsing → structural truth                               │
│  • Embedding search → semantic similarity                       │
│  • Graph analysis → dependency understanding                    │
│  • Provenance tracking → claim justification                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓ state estimate
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT (Controller)                          │
│  • Planning → what to do next                                   │
│  • Reasoning → how to do it                                     │
│  • Decision → which action to take                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓ commands
┌─────────────────────────────────────────────────────────────────┐
│                     TOOLS (Actuators)                           │
│  • File edits → patch application                               │
│  • Command execution → build/test/deploy                        │
│  • Git operations → commit/push/PR                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓ effects
                        [Back to THE WORLD]
```

### Failure Mode Analysis by Component

| Component | Failure Mode | Symptom | Mitigation |
|-----------|--------------|---------|------------|
| **Perception (LiBrainian)** | Wrong state estimate | Agent operates on false information | Retrieval quality metrics, ablation tests |
| **Controller (Agent)** | Bad planning | Correct state, wrong action chosen | Trajectory invariants, policy constraints |
| **Actuator (Tools)** | Unsafe execution | Good plan, destructive outcome | Sandbox isolation, permission gates |
| **Feedback Loop** | Stale/missing updates | Drift between model and reality | Freshness SLOs, staleness detection |

### Implications for Testing

If LiBrainian's perception is wrong, the agent operates on false information:
- Test the **perception accuracy** independently
- Test the **closed loop** as one organism
- Use **ablation tests** to prove LiBrainian adds value
- Use **counterfactual retrieval** to test robustness

### SLO-Oriented Framing

LiBrainian is instrumentation. Instrumentation has SLOs:

| SLO Category | Metric | Target |
|--------------|--------|--------|
| **Latency** | Query p50/p99 | < 500ms / < 2s |
| **Freshness** | Index update lag | < 5 minutes after commit |
| **Staleness** | Max age before warning | 1 hour (active repo) |
| **Accuracy** | Fix-localization Recall@5 | ≥ 70% |

## Emergent Knowledge Targets
Beyond explicit entities, LiBrainian must discover:
- Subsystems and boundaries
- Data flows and workflows
- Implicit contracts and invariants
- Patterns and conventions

## Agent-Optimized Outputs
Responses include:
- Direct answer
- Evidence traces
- Confidence and caveats
- Next actions and tests

## Operational Invariants
- Providers must be live and verified at runtime; failure is explicit.
- Daily model selection chooses the cheapest models that are still SOTA.
- CLI-based auth only; no API keys in env.

## Success Criteria
- Any engineer can onboard using LiBrainian alone.
- Change impact and risk analysis are reliable.
- Knowledge stays fresh under active development.
- Agent workflows are faster and safer with LiBrainian.
- Model choices and provider health are auditable daily.
- New languages are supported immediately with evidence-backed outputs.

## Open-Source Growth Strategy
LiBrainian must be open-source with:
- A stable plugin surface (adapters, knowledge modules, query intents).
- Contribution protocols tied to evidence + validation gates.
- Publicly documented governance and extension standards.

## Philosophical Commitment
Code is human knowledge. LiBrainian preserves, clarifies, and evolves that
knowledge with the rigor of science and the utility of engineering.
