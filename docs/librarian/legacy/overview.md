# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian Overview

> **FOR AGENTS**: Start here for the big picture. See [README.md](./README.md) for navigation.
> **Navigation**: [README.md](./README.md) | [architecture.md](./architecture.md) | [implementation-requirements.md](./implementation-requirements.md) | [scenarios.md](./scenarios.md) | [Back to docs](../)

**Goal**: Make wave0 the world's best autonomous multi-agent orchestration and software development tool, with LiBrainian as its knowledge backbone.

---

## ✅ AUTH WIRING VERIFIED

LiBrainian now uses Wave0's CLI-only auth checks (AuthChecker + LLMService health probes).
See [REMAINING_WORK.md#r0](./REMAINING_WORK.md#r0-fix-provider-auth-wiring) for verification steps.

---

## 🚨 CURRENT STATUS (2025-12-30)

**Overall**: ~85% complete with real implementations (not stubs).

| Aspect | Status |
|--------|--------|
| Core algorithms | ✅ Complete (Tarjan's SCC, PageRank, SBFL, DOA) |
| Storage layer | ✅ Complete (SQLite with WAL, 1,826 lines) |
| Wave0 integration | ✅ 5 integration points wired |
| Engine toolkit | ✅ Relevance, Constraint, Meta-Knowledge engines implemented |
| Test coverage | ⚠️ 94/109 passing (15 skip due to auth bug) |
| Auth wiring | ✅ **WIRED** — provider gate uses Wave0 CLI auth |

---

## Quick Reference: What's In This Document

| Section | Jump Link |
|---------|-----------|
| Current vs Target State | [#current-state-vs-target-state](#current-state-vs-target-state) |
| Problem Matrix (P1-P31) | [#problem-matrix](#problem-matrix) |
| Phase 9 Gaps (G1-G12) | [#phase-9-gaps-g1-g12---original](#phase-9-gaps-g1-g12---original) |
| Phase 10 Gaps (G13-G25) | [#phase-10-gaps-g13-g25---world-class-knowledge](#phase-10-gaps-g13-g25---world-class-knowledge) |
| Engine Toolkit Summary | [#LiBrainian-engine-toolkit](#LiBrainian-engine-toolkit) |
| Next Steps | [#next-steps](#next-steps) |

---

**Related Documents**:
- [architecture.md](./architecture.md) - **Unified architecture** with shared primitives (Entity, Confidence, Scope), EventBus, Query Pipeline
- [scenarios.md](./scenarios.md) - **30 real-world scenarios** showing actual vs ideal behavior, with elegant solutions
- [implementation-phases.md](./implementation-phases.md) - Dependency graph and implementation order
- [system-wiring.md](./system-wiring.md) - All 45 technical wires and feedback loops
- [fixes-critical.md](./fixes-critical.md) - P1-P15 fix instructions
- [fixes-remaining.md](./fixes-remaining.md) - P16-P31 fix instructions
- [validation.md](./validation.md) - Verification checklists

**External References**:
- [../CODEX_WORLD_CLASS_IMPLEMENTATION_GUIDE.md](../CODEX_WORLD_CLASS_IMPLEMENTATION_GUIDE.md) - Phased implementation with code examples
- [../librarian_personas.md](../librarian_personas.md) - Task taxonomy and context levels (L0-L3)

Status: **All P1-P31 Resolved**
Updated: 2025-12-30

---

## EXECUTIVE SUMMARY

Wave0 is a world-class autonomous software engineering system with LiBrainian as its knowledge backbone. This document series:

1. **Diagnoses all problems** (31 issues across P1-P31) - All resolved
2. **Provides fix instructions** for each problem with code examples
3. **Integrates LiBrainian naturally** as the knowledge layer
4. **Aligns with industry best practices** from leading systems
5. **Defines verification checklists** for each phase

## Current State vs Target State

| Aspect | Current State | Target State |
|--------|---------------|--------------|
| Orchestrator | 13 orchestrator classes (specialized handlers) | Single unified orchestrator with specialized handlers |
| LiBrainian | AST+LLM indexing wired; universal file coverage | Knowledge backbone for all agent decisions |
| Type Safety | **0 `any` in src** | Zero `any`, full type inference |
| Security | Git command injection mitigated (P16 fixed) | Zero-trust, input validation, sandboxed |
| Agent Execution | Working execution backends | Sandboxed parallel execution with checkpoints |
| Quality Gates | Configurable | Configurable, evidence-based |
| Task Scheduling | Semantic similarity | Semantic similarity + expertise matching |
| Memory | Episodic SQLite memory + semantic recall | Hierarchical memory with agent-specific caching |
| Test Coverage | **0 disabled test files** | 100% enabled, Tier-0 green |

---

## PROBLEM MATRIX

All problems are marked **[x] Resolved**:

| ID | Problem | Severity | Status |
|----|---------|----------|--------|
| **P16** | Command injection (security) | P0 CRITICAL | Resolved |
| P1 | LiBrainian initialized at startup | CRITICAL | Resolved |
| P2 | UnifiedOrchestrator canonical entrypoint | HIGH | Resolved |
| P3 | `any` sweep complete (zero `any` in src) | CRITICAL | Resolved |
| P4 | Workgraph quality gates configurable | CRITICAL | Resolved |
| P5 | Context assembly uses LiBrainian knowledge | CRITICAL | Resolved |
| P6 | Workgraph uses LiBrainian signals | CRITICAL | Resolved |
| P7 | Provider availability enforced at startup | HIGH | Resolved |
| P8 | Checkpoint/resume for long tasks | HIGH | Resolved |
| P9 | Agent pool implementation | HIGH | Resolved |
| P10 | Sandbox enabled by default | HIGH | Resolved |
| P11 | SQLite concurrent access controlled | MEDIUM | Resolved |
| P12 | Disabled tests re-enabled | MEDIUM | Resolved |
| P13 | Expertise matching via LiBrainian | MEDIUM | Resolved |
| P14 | Bootstrap timeout recovery | MEDIUM | Resolved |
| P15 | Query API documented | MEDIUM | Resolved |
| P17 | LiBrainian failure hard-stops | CRITICAL | Resolved |
| P18 | Mock orchestrator fallbacks removed | CRITICAL | Resolved |
| P19 | Safe JSON.parse wrappers complete | HIGH | Resolved |
| P20 | TODO/FIXME/HACK debt cleared | HIGH | Resolved |
| P21 | Type-safe error handling | HIGH | Resolved |
| P22 | @ts-ignore removed | MEDIUM | Resolved |
| P23 | Disabled tests re-enabled | HIGH | Resolved |
| **P24** | Execution backends implemented | CRITICAL | Resolved |
| **P25** | Policy engine enforced | CRITICAL | Resolved |
| P26 | Domain expert routing | HIGH | Resolved |
| P27 | Agent registry + capability matching | HIGH | Resolved |
| P28 | Evolution coordinator wired | HIGH | Resolved |
| P29 | promote_operator split | MEDIUM | Resolved |
| P30 | Legacy orchestrator archived | LOW | Resolved |
| P31 | UnifiedOrchestrator modularized | MEDIUM | Resolved |

---

## PHASE 9 GAPS (G1-G12) - Original

After P1-P31, these world-class capabilities remain:

| Gap | Status | Description |
|-----|--------|-------------|
| G1 | Done | HTN Planner (`src/planner/htn_*`) |
| G2 | Done | Episodic Memory (`src/memory/episodic_memory.ts`) |
| G3 | Done | Bench Harness (`src/qualification/bench_operator.ts`) |
| G4 | Done | Uncertainty calibration (calibrated confidence + entropy metrics) |
| G5 | **Pending** | Multimodal/vision |
| G6 | **Pending** | Temporal reasoning |
| G7 | **Pending** | Compositional reasoning |
| G8 | **In Progress** | World-class UI/UX (P32 TUI enhancements landed; web dashboard pending) |
| G9 | **Pending** | Developer experience |
| G10 | **Pending** | Unified debugging/tracing |
| G11 | **Pending** | Ecosystem integration |
| G12 | **Pending** | Multi-user/team support |

---

## PHASE 10 GAPS (G13-G25) - World-Class Knowledge

**Focus**: Real-world usage scenarios, integration points, and testing strategies.
See [world-class-gaps.md](./world-class-gaps.md) for detailed integration points and test plans.
See [implementation-requirements.md](./implementation-requirements.md) for **AUDIT RESULTS** showing actual implementation state.

### Audit Summary (2025-12-30)

| Gap | Claimed | **Actual** | Work Needed |
|-----|---------|------------|-------------|
| G13 | 40% | **85%** | Minor wiring |
| G14 | 0% | **Module-level done** | Optional fine-grained |
| G15 | 100% | **Implemented** | Test mappings persisted + context wiring |
| G16 | 100% | **Implemented** | Checksums + dependency invalidation + watcher debounce |
| G17 | 100% | **Implemented** | Commit indexer + recent changes context |
| G18 | 90% | **Implemented** | Ownership matrix from git history; blame optional |
| G21 | 100% | **Implemented** | SBFL attribution + suspicious pack scoring |

### P0: Critical

| Gap | Status | Real Process |
|-----|--------|--------------|
| G13 | **85% Done** | Query implementations - architecture.ts and impact.ts have real code |
| G16 | **Implemented** | File checksums + dependency invalidation + debounced watcher |

### P1: High Impact

| Gap | Status | Real Process |
|-----|--------|--------------|
| G14 | **Module-Level Done** | Graph edges persisted; fine-grained optional |
| G15 | **Implemented** | Test mappings ingested + surfaced in context |
| G21 | **Implemented** | SBFL attribution + suspicious pack scoring |

### P2: Medium Impact

| Gap | Status | Real Process |
|-----|--------|--------------|
| G17 | **Implemented** | Commit indexer + semantic summaries |
| G20 | **Mostly Done** | Refactoring context - impact.ts has blast radius |
| G22 | **Implemented** | Semantic task batching via LiBrainian embeddings |

### P3: Team Features

| Gap | Status | Real Process |
|-----|--------|--------------|
| G18 | **Implemented** | Ownership matrix - commit history mapping |
| G19 | **Implemented** | ADR system - markdown indexing |
| G23 | **Implemented** | Expertise matching via ownership ingestion + agent registry |

### P4: Performance

| Gap | Status | Real Process |
|-----|--------|--------------|
| G24 | **Implemented** | Persistent query cache (SQLite) + TTL |
| G25 | **Implemented** | Batch embeddings with concurrency + retry |

---

## LiBrainian ENGINE TOOLKIT

The LiBrainian provides three core engines that transform it from a knowledge store into a reasoning system:

| Engine | Question Answered | Agent Use |
|--------|-------------------|-----------|
| **Relevance Engine** | "What do I need to know for this task?" | Context gathering, pattern finding, blast radius |
| **Constraint Engine** | "What rules apply and am I breaking them?" | Validation, boundary checking, exception handling |
| **Meta-Knowledge Engine** | "How confident should I be?" | Confidence scoring, staleness detection, failure attribution |

**Key Design Principle**: Engines support both **event-driven** (automatic) and **agent-initiated** (active query) modes.

See [implementation-requirements.md#LiBrainian-engine-toolkit](./implementation-requirements.md#LiBrainian-engine-toolkit) for:
- Complete TypeScript interfaces
- Trigger matrices (when engines fire)
- Agent query examples
- Failure modes and recovery
- Agentic testing specifications

---

## NEXT STEPS

1. **For implementation order**: See [implementation-phases.md](./implementation-phases.md)
2. **For understanding data flow**: See [system-wiring.md](./system-wiring.md)
3. **For specific fixes**: See [fixes-critical.md](./fixes-critical.md) or [fixes-remaining.md](./fixes-remaining.md)
4. **For verification**: See [validation.md](./validation.md)
5. **For Wave0 integration**: See [Wave0-LiBrainian Integration Contract](./implementation-requirements.md#wave0-LiBrainian-integration-contract) - **CRITICAL**: defines what Wave0 must delegate to LiBrainian
6. **For engine toolkit**: See [LiBrainian Engine Toolkit](./implementation-requirements.md#LiBrainian-engine-toolkit) - **NEW**: Relevance, Constraint, and Meta-Knowledge engines
