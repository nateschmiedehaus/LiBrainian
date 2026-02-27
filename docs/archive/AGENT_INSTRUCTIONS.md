# LiBrainian: Agent Implementation Instructions

> **THIS IS THE AUTHORITATIVE FILE FOR IMPLEMENTATION WORK.**
> Do NOT read THEORETICAL_CRITIQUE.md for implementation guidance.
> That document is reference material only.

---

## Conceptual Foundation

**What LiBrainian Is**: An epistemological system that produces *understanding*, not search results. Every claim must be evidence-backed, confidence must be calibrated, and the system must fail honestly when it cannot function.

**Why This Structure**: Implementation follows a strict dependency order because:
1. **You cannot test what doesn't build** (Layer 0)
2. **You cannot claim independence without proving it** (Layer 1)
3. **Features without infrastructure are theater** (Layer 2 before Layer 3)
4. **Confidence without calibration is lying** (Quantification before advanced features)

**The LLM Requirement**: LiBrainian without LLM is not a degraded system - it's a non-functional system. Never implement fallbacks that simulate success.

---

## Dependency Graph

```
                    ┌─────────────────────────────────────────┐
                    │           LAYER 0: BUILD SYSTEM          │
                    │   typecheck → build → tier0-tests       │
                    └─────────────────┬───────────────────────┘
                                      │
                    ┌─────────────────▼───────────────────────┐
                    │         LAYER 1: EXTRACTION              │
                    │  no-wave0-imports ─┬─ no-direct-imports │
                    │                    └──► standalone-tests │
                    └─────────────────┬───────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
┌───────────────┐           ┌─────────────────┐           ┌─────────────────┐
│  LLM Adapter  │           │ Evidence Ledger │           │   Capability    │
│   (2.1)       │           │     (2.2)       │           │  Negotiation    │
└───────┬───────┘           └────────┬────────┘           │    (2.3)        │
        │                            │                    └────────┬────────┘
        │                            ▼                             │
        │                   ┌─────────────────┐                    │
        │                   │  Tool Adapter   │◄───────────────────┘
        │                   │     (2.4)       │
        │                   └────────┬────────┘
        │                            │
        └────────────────────────────┼────────────────────────────┐
                                     │                            │
        ┌────────────────────────────┼────────────────────────────┼──────────┐
        │                            │                            │          │
        ▼                            ▼                            ▼          │
┌───────────────┐           ┌─────────────────┐           ┌───────────────┐ │
│      P0       │           │   Q1-Q4         │           │     P1        │ │
│   Provider    │           │ Quantification  │           │   Operator    │ │
│   Discovery   │           │   Primitives    │           │   Execution   │ │
└───────┬───────┘           └────────┬────────┘           └───────┬───────┘ │
        │                            │                            │         │
   ┌────┴────┐              ┌────────┼────────┐                   │         │
   │         │              │        │        │                   │         │
   ▼         ▼              ▼        ▼        ▼                   ▼         │
┌─────┐   ┌─────┐      ┌─────┐  ┌─────┐  ┌─────┐            ┌─────────┐    │
│ P2  │   │ P3  │      │ Q5  │  │ Q6  │  │ Q7  │            │   P8    │    │
│Selec│   │ LCL │      │migr.│  │migr.│  │migr.│            │Zero-Know│    │
└──┬──┘   └──┬──┘      └─────┘  └─────┘  └─────┘            └────┬────┘    │
   │         │              │                                    │         │
   │    ┌────┴────┐         └────────────────┐                   ▼         │
   │    │         │                          │              ┌─────────┐    │
   │    ▼         ▼                          ▼              │   P9    │    │
   │ ┌─────┐   ┌─────┐                  ┌─────────┐         │Universal│    │
   │ │ P4  │   │ P5  │                  │   D1    │         └────┬────┘    │
   │ │Templ│   │Patt.│                  │ Domain  │              │         │
   │ └─────┘   └──┬──┘                  │Primitiv.│              ▼         │
   │              │                     └────┬────┘         ┌─────────┐    │
   │              ▼                          │              │  P10    │    │
   │         ┌─────────┐                     ▼              │Epistemic│    │
   │         │   P6    │                ┌─────────┐         └────┬────┘    │
   │         │Codebase │                │   D2    │              │         │
   │         │ Advisor │                │ 10 Comp.│              ▼         │
   │         └────┬────┘                └────┬────┘         ┌─────────┐    │
   │              │                          │              │P11-P18  │    │
   │              ▼                          ▼              │Extended │    │
   │         ┌─────────┐                ┌─────────┐         └─────────┘    │
   │         │   P7    │                │ D3, D4  │                        │
   │         │Evolut.  │                │Protocol │                        │
   │         └─────────┘                └─────────┘                        │
   │                                                                       │
   └───────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │     C1-C4: CALIBRATION              │
                    │  (ongoing, parallel to features)   │
                    └────────────────┬────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │       LAYER 4: VERIFICATION          │
                    └────────────────┬────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │       LAYER 5: REPO EXTRACTION       │
                    └─────────────────────────────────────┘
```

---

## How This File Works

1. Complete tasks **in dependency order** - parallel execution allowed where deps are met
2. Each task has **acceptance criteria** - you're not done until they pass
3. **No escape hatches** - if blocked, fix the blocker, don't skip it
4. After completing a task, update `GATES.json` in this folder
5. **Autonomous orchestration**: Run `node scripts/librarian_autonomous_build.mjs`

---

## LAYER 0: BUILD SYSTEM

All gates must pass. See **[specs/core/testing-architecture.md](specs/core/testing-architecture.md)** for complete testing philosophy.

| Gate | Command | Acceptance | If Fails |
|------|---------|------------|----------|
| **0.1 Typecheck** | `cd packages/LiBrainian && npx tsc --noEmit` | Zero errors | Fix type errors |
| **0.2 Build** | `npm run build` | Exit 0, complexity OK | Fix errors or refactor |
| **0.3 Tier-0** | `LIBRARIAN_TEST_MODE=unit npm test -- --run` | All pass | Fix tests or code |
| **0.4 Tier-1** | `LIBRARIAN_TEST_MODE=integration npm test -- --run` | Pass or skip | Skip if providers unavailable |
| **0.5 Tier-2** | `LIBRARIAN_TEST_MODE=system npm test -- --run test/system/` | Pass | Requires live providers |

### Test Tier Philosophy

| Tier | Purpose | Providers | Mocks |
|------|---------|-----------|-------|
| **Tier-0** | Fast logic verification | None | Allowed |
| **Tier-1** | Component integration | Optional (skip if unavailable) | Minimal |
| **Tier-2** | Real agentic behavior | Required (fail if unavailable) | Forbidden |

**Critical Rule**: Tier-0/unit tests must not use providers; if provider gates are on the code path, mock the gate to **fail fast**, not to simulate success. Tier-1 uses real providers or **skips as SKIPPED** (use `ctx.skip`, not `return`). Tier-2 requires real providers and should fail fast with `unverified_by_trace(provider_unavailable)` if missing. Never mock LLM responses to simulate success.

---

## LAYER 1: EXTRACTION

Package must run without wave0. Gates 1.1 and 1.2 can run in parallel.

| Gate | Command | Acceptance |
|------|---------|------------|
| **1.1 No wave0 imports** | `rg "src/(wave0\|orchestrator)/" packages/LiBrainian/src` | Zero matches |
| **1.2 No direct imports** | `rg "from '\.\.\/LiBrainian/" src --glob '!src/LiBrainian/**'` | Zero matches |
| **1.3 Standalone tests** | `cd packages/LiBrainian && npm test` | Pass without wave0 |

---

## LAYER 2: INFRASTRUCTURE

These are the **foundations features depend on**. Tasks 2.1, 2.2, 2.3 can run in parallel. Task 2.4 depends on 2.2.

### Task 2.1: LLM Adapter Complete

**Purpose**: All LLM calls go through a single adapter for evidence and policy.

**Verification**: `rg "new LLMService\(" packages/LiBrainian/src --glob '!**/adapters/**' --glob '!**/__tests__/**'`

**Acceptance**: Zero matches outside adapters/tests.

**Implementation**: Route all direct instantiations through `resolveLlmServiceAdapter()`.

### Task 2.2: Evidence Ledger Unified

**Purpose**: Single append-only log of all actions for replay and audit.

**Current implementation**: `packages/LiBrainian/src/epistemics/evidence_ledger.ts`

```typescript
interface IEvidenceLedger {
  append(entry: EvidenceEntry): EvidenceId;
  get(id: EvidenceId): EvidenceEntry | null;
  query(filter: EvidenceQuery): EvidenceEntry[];
}
```

**Wire**: MCP audit, episodes, query stages all emit to this ledger.

**Verification (no-theater)**:
- Ledger implementation tests pass (Tier-0).
- Wiring points have deterministic tests that assert entries are appended when a subsystem emits an event.

**Test**: `packages/LiBrainian/src/epistemics/__tests__/evidence_ledger.test.ts` must pass

### Task 2.3: Capability Negotiation

**Purpose**: Explicit declaration of what the system needs and what's available.

**Create**: `packages/LiBrainian/src/api/capability_contracts.ts`

```typescript
type Capability = 'llm:chat' | 'llm:embedding' | 'storage:sqlite' | 'storage:vector' | 'tool:filesystem' | 'tool:git' | 'tool:mcp';

interface CapabilityContract {
  required: Capability[];
  optional: Capability[];
  degradedMode: string;
}

function negotiateCapabilities(required: Capability[], available: Capability[]): {
  satisfied: boolean;
  missing: Capability[];
  degraded: string | null;
};
```

**Acceptance**:
- Missing required capability → fail-closed with `unverified_by_trace(capability_missing)`
- Missing optional capability → `degradedMode` is surfaced explicitly (never silent)

**Test**: `cd packages/LiBrainian && npx vitest run src/__tests__/capability_contracts.test.ts`

### Task 2.4: Tool/MCP Adapter

**Depends on**: 2.2 (needs evidence ledger to emit to)

**Purpose**: Unified interface for tool calls with evidence logging.

**Create**: `packages/LiBrainian/src/api/tool_adapter.ts`

**Verification (no-theater)**:
- Tier‑0 wiring test: `cd packages/LiBrainian && npx vitest run src/mcp/__tests__/tool_adapter_bridge.test.ts`
- Drift guard (single registry): `cd packages/LiBrainian && npx vitest run src/mcp/__tests__/tool_registry_consistency.test.ts`

---

## LAYER 3: FEATURES

**Prerequisite**: All Layer 2 tasks complete.

Features have complex dependencies (see graph above). The orchestrator handles this automatically. Manual execution should follow the dependency arrows.

### Detailed Specifications

For deep dives into any track, read the corresponding spec file in `specs/`:

#### Core Feature Tracks

| Track | Features | Detailed Spec |
|-------|----------|---------------|
| **Track A** | P0-P7 (Core Pipeline) | [`specs/track-a-core-pipeline.md`](./specs/track-a-core-pipeline.md) |
| **Track B** | P8-P10 (Bootstrap) | [`specs/track-b-bootstrap.md`](./specs/track-b-bootstrap.md) |
| **Track C** | P11-P18 (Extended) | [`specs/track-c-extended.md`](./specs/track-c-extended.md) |
| **Track D** | Q1-Q8 (Quantification) | [`specs/track-d-quantification.md`](./specs/track-d-quantification.md) |
| **Track E** | D1-D7 (Domain) | [`specs/track-e-domain.md`](./specs/track-e-domain.md) |
| **Track F** | C1-C4 (Calibration) | [`specs/track-f-calibration.md`](./specs/track-f-calibration.md) |
| **Layer 2** | Infrastructure | [`specs/layer2-infrastructure.md`](./specs/layer2-infrastructure.md) |

#### Cross-Cutting Concerns

| Document | Content | Source |
|----------|---------|--------|
| [`specs/critical-usability.md`](./specs/critical-usability.md) | **Critical Problems A-E** - Execution, Learning, Checkpointing, Context | Part VII |
| [`specs/use-case-targets.md`](./specs/use-case-targets.md) | **20 Use Case Target Interfaces** - What "10/10" looks like | Part VI |
| [`specs/subsystem-problems.md`](./specs/subsystem-problems.md) | **Subsystem Problems 26-57** - Storage, Bootstrap, Embedding, Epistemology | Part IX |
| [`specs/EXTRACTION_GAP_REPORT.md`](./specs/EXTRACTION_GAP_REPORT.md) | Gap analysis and extraction completeness audit | Meta |
| [`specs/COHERENCE_ANALYSIS.md`](./specs/COHERENCE_ANALYSIS.md) | **Coherence review** - 7 dimensions of spec coherence | Meta |
| [`specs/GLOSSARY.md`](./specs/GLOSSARY.md) | **Canonical definitions** - All terms used across specs | Meta |
| [`specs/IMPLEMENTATION_STATUS.md`](./specs/IMPLEMENTATION_STATUS.md) | **Prior implementation issues** - What exists, what's broken, what's missing | Meta |

### The LiBrainian Story (Why These Tracks Exist)

> **Read this first to understand HOW the tracks fit together.**

**Chapter 1: The Problem** - Agents need to *understand* code, not just search it. Understanding requires evidence-backed claims with calibrated confidence. Without this, agent actions are guesswork.

**Chapter 2: The Foundation** - We build infrastructure (Layer 2) that captures evidence and negotiates capabilities. Without this, nothing else is trustworthy. Every operation logs to the evidence ledger; every capability is negotiated.

**Chapter 3: The Pipeline** - We build composition-based retrieval (Track A: P0-P7) that produces knowledge claims, not search results. Each claim has evidence refs and confidence values.

**Chapter 4: The Bootstrap** - We solve the cold-start problem (Track B: P8-P10) by building knowledge progressively from certainty (AST) to inference (LLM).

**Chapter 5: The Honesty** - We enforce epistemic honesty (Track D: Q1-Q8) by requiring all confidence values to be derived/measured/bounded/deterministic - or honestly absent. No arbitrary numbers allowed. Then we calibrate them (Track F: C1-C4) from real outcomes.

**Chapter 6: The Universality** - We extend to all domains (Track E: D1-D7) through aspect-based decomposition, without losing epistemic rigor.

**Chapter 7: The Completion** - We add advanced features (Track C: P11-P18) that build on the honest, calibrated, universal foundation.

---

### Conceptual Unification: Search vs Epistemology

Two metaphors appear throughout the specs. **They are not in conflict - they are layers.**

| Layer | Metaphor | What It Describes | Example Terms |
|-------|----------|-------------------|---------------|
| **Surface** | Search/Retrieval | How LiBrainian finds information | query, retrieval, similarity, embedding |
| **Core** | Epistemology | How LiBrainian produces understanding | claim, evidence, confidence, knowledge |

**The relationship**:

```
SEARCH (Surface)                    EPISTEMOLOGY (Core)
┌─────────────────────┐             ┌─────────────────────┐
│ Query: "auth flow"  │ ────────►   │ Claim: "Auth uses   │
│                     │             │   JWT in auth.ts"   │
│ Results: 5 files    │             │ Evidence: AST parse │
│   with matches      │             │ Confidence: 1.0     │
└─────────────────────┘             │   (deterministic)   │
                                    └─────────────────────┘
```

**Search is the mechanism; epistemology is the goal.**

LiBrainian uses search techniques (embeddings, similarity, retrieval) to gather information. But the OUTPUT is not search results - it's **knowledge claims with evidence and confidence**.

**Critical distinction**:
- A search system returns: "Here are files containing 'auth'"
- An epistemological system returns: "Here's what I KNOW about auth, with evidence for each claim and honest confidence about how certain I am"

All specs should be read with this understanding: search terms describe implementation mechanisms, epistemology terms describe the system's purpose.

---

### Critical Problem → Track Mapping

Every Critical Problem from Part VII maps to specific tracks. **Implement the track; you solve the problem.**

| Critical Problem | What's Broken | Solved By | Primary Track |
|------------------|---------------|-----------|---------------|
| **A: Execution** | Plans aren't executable end-to-end | P1 (Operator Execution) + Layer 2.2 (Ledger) | Track A |
| **B: Learning Loop** | Episodes recorded but not used | P13 (Prediction-Oriented Memory) | Track C |
| **B.1: Memory** | Retrieval not prediction-weighted | P13 (same) | Track C |
| **C: Customization** | Can't customize compositions | P7 (Evolution Engine) | Track A |
| **D: Checkpointing** | Can't resume partial execution | P1 (has checkpoint support) | Track A |
| **E: Context Assembly** | Context doesn't accumulate | Layer 2.2 (Evidence Ledger) + P15 | Layer 2 + Track C |

---

### Use Case → Feature Mapping (Top 10)

Which features enable which use cases? Implement the features; you improve the rating.

| Use Case | Current → Target | Enabled By |
|----------|------------------|------------|
| **UC 1: Bug Fix Context** | 6→10 | P5 (Patterns) + P13 (Learning) |
| **UC 2: Feature Planning** | 4→10 | P2 (Selector) + P7 (Evolution) |
| **UC 3: Codebase Exploration** | 5→10 | P6 (Advisor) + D3 (Construction) |
| **UC 4: Debugging** | 3→10 | P1 (Execution) + P16 (Causal) |
| **UC 5: Change Verification** | 2→10 | P1 (Execution) + C1-C4 (Calibration) |
| **UC 6: Code Review** | 3→10 | P5 (Patterns) + P15 (Proof-Carrying) |
| **UC 7: Refactoring** | 4→10 | P7 (Evolution) + P8 (Bootstrap) |
| **UC 8: Security Audit** | 3→10 | D1 (Domain) + P10 (Epistemic) |
| **UC 14: Onboarding** | 3→10 | P8 (Bootstrap) + P6 (Advisor) |
| **UC 16: Incidents** | 2→10 | P16 (Causal) + P17 (Bi-Temporal) |

---

### Known Implementation Issues (From Prior Attempts)

Prior implementation attempts (by Codex) created code that exists but has issues. **Before implementing new features, check these.**

| Issue | Severity | Chapter | What's Wrong |
|-------|----------|---------|--------------|
| **Provider bypass** | HIGH | 2 | `query_synthesis.ts` instantiates `LLMService` directly, bypassing discovery |
| **Fragmented evidence** | HIGH | 2 | Three separate logs (MCP, episodes, query) don't connect |
| **No-op operators** | CRITICAL | 3 | Many operator interpreters are explicit no-ops |
| **Claim confidence drift** | HIGH | 5 | Code emits raw numeric “confidence” in claim-like outputs; Track D requires `ConfidenceValue` for epistemic claim confidence (ranking scores must not masquerade as calibrated confidence) |
| **Episodes not used** | HIGH | 7 | Learning records outcomes but doesn't act on them |
| **Missing exports** | BLOCKER | - | Build fails: `telemetry/logger.js`, `utils/safe_json.js`, `GraphEdge` |

**Full details**: See [`IMPLEMENTATION_STATUS.md`](./specs/IMPLEMENTATION_STATUS.md)

**Priority order for fixes**:
1. Fix build blockers (missing exports)
2. Fix provider bypass (Chapter 2 integrity)
3. Establish the Confidence Boundary (Chapter 5 honesty): stop emitting raw claim confidence; migrate claim surfaces to `ConfidenceValue`
4. Implement real operator interpreters (Chapter 3 execution)
5. Wire learning loop to selector (Chapter 7 completion)

---

### Corrected Dependency Flow

```
Layer 0 (Build)
    ↓
Layer 1 (Extraction)
    ↓
Layer 2 (Infrastructure: 2.1 LLM Adapter, 2.2 Evidence Ledger, 2.3 Capability, 2.4 Tools)
    ↓
    ├── Track D (Q1-Q4) ──────────────────┐
    │       ↓                             │
    │   Track A (P0-P7) ←─────────────────┤ (P0 = Layer 2.1)
    │       ↓                             │
    │   Track B (P8-P10)                  │
    │       ↓                             │
    │   Track E (D1-D7) ←─────────────────┘ (depends on Q1-Q4)
    │       ↓
    │   Track F (C1-C4) ←── depends on Q2
    │       ↓
    └── Track C (P11-P18) ←── depends on calibrated confidence
```

**Key**: P0 (LLM Provider Discovery) IS Layer 2.1 (LLM Adapter). They are the same thing.

---

### How Specs Relate (Structural View)

```
┌─────────────────────────────────────────────────────────────────┐
│                    THEORETICAL FOUNDATION                        │
│  Parts I-IV: Why these problems matter (epistemology, compute)  │
└────────────────────────────┬────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  CRITICAL       │ │   USE CASES     │ │   SUBSYSTEM     │
│  PROBLEMS A-E   │ │   (20 targets)  │ │   PROBLEMS      │
│  (Part VII)     │ │   (Part VI)     │ │   (Part IX)     │
│                 │ │                 │ │                 │
│  What's broken  │ │  What "good"    │ │  Per-component  │
│  and how to fix │ │  looks like     │ │  issues         │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         │    ┌──────────────┴──────────────┐    │
         │    │   COHERENCE ANALYSIS        │    │
         │    │   (specs/COHERENCE_ANALYSIS)│    │
         │    │   + GLOSSARY                │    │
         │    └──────────────┬──────────────┘    │
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  TRACK A-C      │ │  TRACK D-F      │ │   LAYER 2       │
│  Core Features  │ │  Foundations    │ │  Infrastructure │
│  P0-P18         │ │  Q, D, C tracks │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

**Key Insight**: The feature tracks (P0-P18, Q1-Q8, etc.) are the "what to build." The Critical Problems, Use Cases, and Subsystem Problems provide the "why" and "what good looks like." The GLOSSARY provides canonical terminology. The COHERENCE_ANALYSIS ensures everything fits together. Don't implement features without understanding their theoretical grounding.

### Track A: Core Pipeline (P0 → P7)

These form the main retrieval/synthesis pipeline.

| ID | Feature | Depends On | Test |
|----|---------|------------|------|
| P0 | LLM Provider Discovery | Layer 2 | `packages/LiBrainian/src/api/__tests__/llm_provider_discovery.test.ts` |
| P1 | Operator Execution | P0 | `packages/LiBrainian/src/api/__tests__/operator_interpreters.test.ts` |
| P2 | Semantic Selector | P0 | `packages/LiBrainian/src/api/__tests__/librarian_select_compositions.test.ts` |
| P3 | LCL Core | P0, P1 | `packages/LiBrainian/src/api/__tests__/lcl.test.ts` |
| P4 | Structure Templates | P3 | `packages/LiBrainian/src/api/__tests__/structure_templates.test.ts` |
| P5 | Pattern Catalog | P3 | `packages/LiBrainian/src/api/__tests__/pattern_catalog.test.ts` |
| P6 | Codebase Advisor | P5 | `packages/LiBrainian/src/api/__tests__/codebase_advisor.test.ts` |
| P7 | Evolution Engine | P6 | `packages/LiBrainian/src/api/__tests__/composition_evolution.test.ts` |

### Track B: Bootstrap Pipeline (P1 → P10)

These enable cold-start and universal applicability.

| ID | Feature | Depends On | Test |
|----|---------|------------|------|
| P8 | Zero-Knowledge Bootstrap | P1 | `packages/LiBrainian/src/api/__tests__/zero_knowledge_bootstrap.test.ts` |
| P9 | Universal Applicability | P8 | `packages/LiBrainian/src/api/__tests__/universal_applicability.test.ts` |
| P10 | Epistemic Policy | P9 | `packages/LiBrainian/src/api/__tests__/epistemic_policy.test.ts` |

### Track C: Extended Features (P11 → P18)

Advanced capabilities that build on the core.

| ID | Feature | Depends On | Test |
|----|---------|------------|------|
| P11 | Storage Interface Split | P10 | `packages/LiBrainian/src/api/__tests__/librarian_storage_slices.test.ts` |
| P12 | Transaction Boundaries | P11 | `packages/LiBrainian/src/storage/__tests__/transactions.test.ts` |
| P13 | Prediction-Oriented Memory | P12 | `packages/LiBrainian/src/api/__tests__/learning_loop.test.ts` |
| P14 | Self-Aware Oracle | P13 | `packages/LiBrainian/src/api/__tests__/self_aware_oracle.test.ts` |
| P15 | Proof-Carrying Context | P14 | `packages/LiBrainian/src/api/__tests__/proof_carrying_context.test.ts` |
| P16 | Causal Discovery | P15 | `packages/LiBrainian/src/api/__tests__/causal_discovery.test.ts` |
| P17 | Bi-Temporal Knowledge | P16 | `packages/LiBrainian/src/api/__tests__/bi_temporal_knowledge.test.ts` |
| P18 | Metacognitive Architecture | P17 | `packages/LiBrainian/src/api/__tests__/metacognitive_architecture.test.ts` |

### Track D: Principled Confidence (Q1 → Q8)

**Critical**: No arbitrary **claim confidence** values. `placeholder()` is DEPRECATED for claim confidence — ranking/heuristic scores must not masquerade as calibrated confidence.

See [CONFIDENCE_REDESIGN.md](./specs/CONFIDENCE_REDESIGN.md) for full rationale.

| ID | Feature | Depends On | Test/Verification |
|----|---------|------------|-------------------|
| Q1 | ConfidenceValue Type | Layer 2 | `packages/LiBrainian/src/epistemics/__tests__/computed_confidence.test.ts` |
| Q2 | Derivation Rules | Q1 | `packages/LiBrainian/src/epistemics/__tests__/computed_confidence.test.ts` |
| Q3 | Degradation Handlers | Q1 | `packages/LiBrainian/src/epistemics/__tests__/computed_confidence.test.ts` |
| Q4 | Migration Script | Q1-Q3 | `unverified_by_trace(not_implemented)` |
| Q5 | Migrate claim confidence surfaces | Q4 | `unverified_by_trace(migration_pending)` |
| Q6 | Rename heuristic “confidence” fields | Q5 | `unverified_by_trace(migration_pending)` |
| Q7 | Reduce legacy placeholder usage | Q5 | `unverified_by_trace(migration_pending)` |
| Q8 | TypeScript enforcement | Q1 | Enforce `ConfidenceValue` at claim boundaries |

**Verification**:
```bash
# Migration audit (expected non-zero until Track D migration completes)
rg "confidence:\\s*0\\.\\d" packages/LiBrainian/src --glob '*.ts'
rg "placeholder\\(" packages/LiBrainian/src --glob '*.ts'
```

### Track E: Universal Domain (D1 → D4)

| ID | Feature | Depends On | Test |
|----|---------|------------|------|
| D1 | 7 Domain Primitives | Q1-Q3 | `packages/LiBrainian/src/api/__tests__/domain_support.test.ts` |
| D2 | 10 World-Class Compositions | D1 | `unverified_by_trace(spec_only)` |
| D3 | Domain Construction Protocol | D2 | `unverified_by_trace(spec_only)` |
| D4 | Aspect Decomposer | D3 | `unverified_by_trace(spec_only)` |

### Track F: Calibration Infrastructure (C1 → C4)

Can run in parallel with feature tracks once Q2 is complete.

| ID | Feature | Depends On | Test |
|----|---------|------------|------|
| C1 | Claim-Outcome Tracking | Q2 | `packages/LiBrainian/src/api/__tests__/feedback_loop.test.ts` |
| C2 | Calibration Curves | C1 | `packages/LiBrainian/src/__tests__/confidence_calibration.test.ts` |
| C3 | Confidence Adjustment | C2 | `packages/LiBrainian/src/api/confidence_calibration.ts` |
| C4 | Calibration Dashboard | C2 | `unverified_by_trace(spec_only)` |

---

## LAYER 4: VERIFICATION

Run all verification. Everything must pass.

```bash
cd packages/LiBrainian && npx tsc --noEmit        # Typecheck
npm run build                                     # Build
npm run test:tier0                                # Tier-0
npm test                                          # Full suite
node scripts/canon_guard.mjs                      # Doc coherence
rg "src/(wave0|orchestrator)/" packages/LiBrainian/src  # Extraction (must be empty)
```

---

## LAYER 5: REPOSITORY EXTRACTION

**Prerequisite**: Layers 0-4 verified green.

### Options

| Option | Command | When |
|--------|---------|------|
| Git subtree | `git subtree split --prefix=packages/LiBrainian` | Preserve history |
| Copy | New repo, copy files | Clean start |
| npm publish | `npm publish` | Public release |

### Steps

1. Verify Layer 4 green
2. Create new repository
3. Move/split package contents
4. Update wave0's package.json to use the external package
5. Verify wave0 still works
6. Delete packages/LiBrainian from wave0
7. Update GATES.json

---

## Autonomous Execution

Run the orchestrator to execute this plan automatically:

```bash
# Full autonomous build (sequential)
node scripts/librarian_autonomous_build.mjs --provider claude

# Dry run to see what would happen
node scripts/librarian_autonomous_build.mjs --dry-run

# Start from specific layer
node scripts/librarian_autonomous_build.mjs --layer 2

# Parallel execution where deps allow
node scripts/librarian_autonomous_build.mjs --parallel
```

The orchestrator:
1. Reads GATES.json for current state
2. Finds next task(s) with satisfied dependencies
3. Spawns fresh Opus 4.5 agent with focused prompt
4. Verifies completion via acceptance test
5. Updates GATES.json
6. Loops until complete

---

## FORBIDDEN ACTIONS

1. **DO NOT** implement Layer 3 features while Layer 0-2 gates are red
2. **DO NOT** add "starter slices" or partial implementations
3. **DO NOT** skip failing tests
4. **DO NOT** update THEORETICAL_CRITIQUE.md while gates are red
5. **DO NOT** create new priorities (P19+, Q9+, etc.)
6. **DO NOT** use escape hatches like "use best judgment to skip"

---

## IF BLOCKED

1. **Build fails**: Read error, fix error, repeat
2. **Test fails**: Read assertion, understand expected vs actual, fix
3. **Can't find code**: `rg -n "pattern" packages/LiBrainian/src`
4. **Don't understand requirement**: Read relevant Part in THEORETICAL_CRITIQUE.md
5. **Genuinely blocked**: Document blocker (file, line, error) and STOP

---

## Machine-Readable Status

After completing any task, update `docs/LiBrainian/GATES.json`:

```json
{
  "tasks": {
    "layer0.tier0Tests": {
      "status": "pass",
      "lastRun": "2026-01-22T12:00:00Z",
      "evidence": "All 47 tests passed"
    }
  }
}
```

Status values: `pass` | `fail` | `pending`
