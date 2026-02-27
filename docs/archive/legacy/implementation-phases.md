# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian Implementation Phases

> **FOR AGENTS**: This doc defines the CORRECT ORDER of implementation. Violating this order causes integration failures.
> **Navigation**: [README.md](./README.md) | [overview.md](./overview.md) | [system-wiring.md](./system-wiring.md)

---

## Quick Reference: What's In This Document

| Section | What It Contains | Jump Link |
|---------|------------------|-----------|
| Dependency Graph | Visual dependency tree | [#implementation-dependency-graph](#implementation-dependency-graph) |
| Phase 0 | Security (P16) - MUST BE FIRST | [#phase-0-blocking---must-be-first](#phase-0-blocking---must-be-first) |
| Phase 1 | Core Infrastructure (P7, P17, P1, P24, P25) | [#phase-1-core-infrastructure](#phase-1-core-infrastructure-in-order) |
| Phase 2 | Orchestration Layer (P2, P5, P6) | [#phase-2-orchestration-layer](#phase-2-orchestration-layer-in-order) |
| Phase 3 | Quality & Safety (P4, P10, P26, P27) | [#phase-3-quality--safety](#phase-3-quality--safety) |
| Phase 4 | Cleanup (P3, P19-P23, P28-P31) | [#phase-4-cleanup](#phase-4-cleanup) |

---

## IMPLEMENTATION ORDER & WIRING

> **CRITICAL**: This section defines the correct order of implementation and how components connect. Violating this order will cause integration failures.

### Implementation Dependency Graph

```
PHASE 0 (BLOCKING - MUST BE FIRST)
├── P16: Command Injection Fix
│   └── Required before ANY other work (security baseline)

PHASE 1: CORE INFRASTRUCTURE (in order)
├── P7: Provider Check at Startup
│   ├── Required by: P1, P17
│   └── Creates: requireProviders() utility

├── P17: LiBrainian Hard-Stop
│   ├── Depends on: P7 (needs provider check)
│   └── Modifies: preOrchestrationHook()

├── P18: No Mock Fallbacks (parallel with P17)
│   └── Code review task, no dependencies

├── P1: LiBrainian Initialization
│   ├── Depends on: P7, P17
│   ├── Required by: P5, P6, P13
│   └── Creates: LiBrainian bootstrap in orchestrator startup

├── P24: Execution Backends
│   ├── Required by: P10, P25
│   └── Creates: LocalBackend, DockerBackend

├── P25: Policy Engine
│   ├── Depends on: P24 (uses backends for sandboxing)
│   ├── Required by: P10, P26
│   └── Creates: PolicyEngine, globalPolicyEngine

PHASE 2: ORCHESTRATION LAYER (in order)
├── P2: Orchestrator Consolidation
│   ├── Required by: P29, P30, P31
│   └── Establishes: UnifiedOrchestrator as canonical

├── P5: Context Assembly + LiBrainian
│   ├── Depends on: P1
│   ├── Required by: P6, P9
│   └── Creates: assembleTaskContext() with LiBrainian knowledge

├── P6: Workgraph + LiBrainian
│   ├── Depends on: P1, P5
│   ├── Required by: P13
│   └── Creates: SemanticScheduler with similarity grouping

├── P4: Quality Gates Configurable
│   └── Parallel with P5, P6

PHASE 3: AGENT INFRASTRUCTURE (in order)
├── P9: Agent Pool Implementation
│   ├── Depends on: P5
│   ├── Required by: P13, P27
│   └── Creates: AgentPool with acquire/release

├── P27: Agent Registry
│   ├── Depends on: P9
│   └── Creates: AgentRegistry with capability matching

├── P13: Expertise Matching
│   ├── Depends on: P6, P9
│   └── Enhances: Agent assignment with LiBrainian knowledge

PHASE 4: RELIABILITY (parallel group)
├── P8: Checkpoint/Resume
├── P10: Sandbox Default On (depends on P24)
├── P11: SQLite Concurrent Access
├── P14: Bootstrap Timeout Recovery

PHASE 5: HUMAN-IN-THE-LOOP
├── P26: Domain Expert Router
│   ├── Depends on: P25 (uses policy for approval routing)
│   └── Creates: HumanReviewRequest/Response flow

PHASE 6: SELF-EVOLUTION
├── P28: Evolution Coordinator
│   ├── Depends on: P9, P27 (needs agent registry)
│   └── Creates: EvolutionCoordinator connecting GenePoolManager

PHASE 7: TYPE SAFETY (can be parallel throughout)
├── P3: Fix 893 `any` types
├── P19: Safe JSON.parse
├── P21: Type-safe error handling
├── P22: Remove @ts-ignore

PHASE 8: CLEANUP (after all else)
├── P12/P23: Re-enable disabled tests
├── P20: Resolve TODOs
├── P29: Split promote_operator.ts
├── P30: Archive legacy code
├── P31: Split UnifiedOrchestrator

PHASE 9: WORLD-CLASS GAPS (after P1-P31)
├── G1-G7: Core capability gaps
├── G8-G12: UI/UX, DX, Debugging gaps
└── A1-A10: Architectural problems
```

---

## Phase 9 Progress (G1-G12)

| Gap | Status | Implementation Notes |
|-----|--------|----------------------|
| G1 | ✅ | Deterministic HTN planner + domain loader + planner engine integration + tests (`src/planner/htn_*`) — chosen over LLM-only task_decomposer for constraint guarantees |
| G2 | ✅ | Episodic memory store with SQLite + semantic recall + orchestration wiring (`src/memory/episodic_memory.ts`) |
| G3 | ✅ | Bench harness + scoreboard runs real fixtures (`src/qualification/bench_operator.ts`, `scoreboard_operator.ts`) |
| G4 | ✅ | Uncertainty calibration (confidence calibration + entropy/variance metrics) |
| G5 | ☐ | Multimodal/vision (pending) |
| G6 | ☐ | Temporal reasoning (pending) |
| G7 | ☐ | Compositional reasoning (pending) |
| G8 | ◐ | World-class UI/UX (P32 TUI enhancements in place; web dashboard pending) |
| G9 | ☐ | Developer experience improvements (pending) |
| G10 | ☐ | Unified debugging/tracing (pending) |
| G11 | ☐ | Ecosystem integration (pending) |
| G12 | ☐ | Multi-user/team support (pending) |

---

## Component Wiring Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WAVE0 RUNTIME                                      │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         STARTUP SEQUENCE                              │   │
│  │                                                                       │   │
│  │  1. requireProviders() ──────────────────────────────────────────────┼───┼──▶ HARD STOP if missing
│  │        ↓                                                              │   │
│  │  2. preOrchestrationHook() ──────────────────────────────────────────┼───┼──▶ HARD STOP if fails
│  │        ↓                                                              │   │
│  │  3. UnifiedOrchestrator.initialize() ────────────────────────────────┼───┼──▶ Starts main loop
│  │                                                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                  │                                           │
│                                  ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        ORCHESTRATION LOOP                             │   │
│  │                                                                       │   │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐               │   │
│  │  │  WORKGRAPH  │───▶│  SCHEDULER  │───▶│ AGENT POOL  │               │   │
│  │  │   (P6)      │    │   (P6)      │    │  (P9/P27)   │               │   │
│  │  └─────────────┘    └─────────────┘    └─────────────┘               │   │
│  │        │                  │                  │                        │   │
│  │        └──────────────────┼──────────────────┘                        │   │
│  │                           ▼                                           │   │
│  │               ┌───────────────────────┐                               │   │
│  │               │   CONTEXT ASSEMBLER   │◀──────┐                       │   │
│  │               │        (P5)           │       │                       │   │
│  │               └───────────────────────┘       │                       │   │
│  │                           │                   │                       │   │
│  │                           ▼                   │                       │   │
│  │               ┌───────────────────────┐       │                       │   │
│  │               │      LiBrainian        │───────┘                       │   │
│  │               │   (P1, Knowledge)     │◀──── EpisodicMemory           │   │
│  │               └───────────────────────┘      (G2 future)              │   │
│  │                           │                                           │   │
│  └───────────────────────────┼───────────────────────────────────────────┘   │
│                              ▼                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        EXECUTION LAYER                                │   │
│  │                                                                       │   │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐               │   │
│  │  │   POLICY    │───▶│  EXECUTION  │───▶│ CHECKPOINT  │               │   │
│  │  │   ENGINE    │    │  BACKENDS   │    │   MANAGER   │               │   │
│  │  │   (P25)     │    │ (P24: Local/│    │    (P8)     │               │   │
│  │  └─────────────┘    │   Docker)   │    └─────────────┘               │   │
│  │        │            └─────────────┘           │                       │   │
│  │        ▼                  │                   ▼                       │   │
│  │  ┌─────────────┐          │           ┌─────────────┐                │   │
│  │  │    HITL     │          │           │  EVOLUTION  │                │   │
│  │  │   ROUTER    │◀─────────┘           │ COORDINATOR │                │   │
│  │  │   (P26)     │                      │    (P28)    │                │   │
│  │  └─────────────┘                      └─────────────┘                │   │
│  │                                              │                        │   │
│  │                                              ▼                        │   │
│  │                                       ┌─────────────┐                │   │
│  │                                       │ GENE POOL   │                │   │
│  │                                       │  MANAGER    │                │   │
│  │                                       └─────────────┘                │   │
│  │                                                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  SECURITY BOUNDARY ─────────────────────────────────────────────────────    │
│  P16 (git sanitizer), P10 (sandbox), P25 (policy) create defense layers     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cross-Document Reference Map

| This Document | CODEX Guide | Assessment | UI Spec | Purpose |
|---------------|-------------|------------|---------|---------|
| P1-P15 | Phase 4 | - | - | LiBrainian integration |
| P16 | Phase 0 | - | - | Security baseline |
| P17-P18 | Phase 2 | A1 (SCAS enforcement) | - | Truthfulness |
| P19-P23 | Phase 3 | - | - | Type safety |
| P24-P25 | Phase 1 | A1, A4 | - | Infrastructure |
| P26 | Phase 6 | G12 | 1.3 (Live Chat) | Human review |
| P27-P28 | Phase 5, 7 | A10 | - | Agent evolution |
| P29-P31 | Phase 8 | A2, A3 | - | Cleanup |
| - | Phase 9 | G1-G7 | - | Core capabilities |
| - | - | G8-G12 | 1.1-1.7 | UI/UX gaps |
| - | - | A1-A10 | - | Architectural |

---

## Integration Verification Checklist

After implementing each phase, verify integration:

```bash
# PHASE 0 GATE (must pass before proceeding)
npm run test:tier0 -- --grep "git_sanitizer"
# Verify: All injection tests pass

# PHASE 1 GATE
node -e "require('./dist/LiBrainian/api/provider_check.js').requireProviders({llm:true,embedding:true})"
# Verify: No throw OR clear ProviderUnavailableError

node -e "require('./dist/LiBrainian/index.js').preOrchestrationHook({workspaceRoot:'.'}).then(console.log)"
# Verify: { success: true } OR throws (no degraded mode)

# PHASE 2 GATE
node -e "require('./dist/orchestrator/context_assembler.js').assembleTaskContext({id:'test',targetFiles:['src/LiBrainian/index.ts']}).then(c => console.log('coverage:', c.coverage.percentage))"
# Verify: Coverage > 0%, targetFiles enriched

# PHASE 3 GATE
node -e "const r = require('./dist/orchestrator/agent_registry.js').globalAgentRegistry; console.log('agents:', r.findByCapability({domain:'code'}).length)"
# Verify: At least 1 coder agent registered

# PHASE 5 GATE
ls -la state/audits/hitl/
# Verify: Directory exists for HITL requests

# PHASE 6 GATE
node -e "require('./dist/self_evolution/evolution_coordinator.js').EvolutionCoordinator"
# Verify: No import errors

# FULL INTEGRATION GATE
npm run test:tier0 && npm test
# Verify: All tests pass
```

---

## Critical Integration Points

These connections MUST work for Wave0 to function:

| Connection | Source | Target | Data Flow | Failure Mode |
|------------|--------|--------|-----------|--------------|
| Provider → Startup | `provider_check.ts` | `unified_orchestrator.ts` | API keys validated | HARD STOP |
| LiBrainian → Startup | `preOrchestrationHook()` | `startOrchestrator()` | Bootstrap result | HARD STOP |
| LiBrainian → Context | `assembleContext()` | `assembleTaskContext()` | Enriched files | Empty context |
| Context → Agent | `TaskContext` | Agent execution | Knowledge + query | Blind agent |
| Scheduler → LiBrainian | `SemanticScheduler` | `getSemanticSimilarity()` | File similarity | FIFO fallback |
| Agent → Registry | Task request | `AgentRegistry.acquire()` | Agent assignment | Queue stall |
| Execution → Policy | Command | `PolicyEngine.evaluate()` | Allow/deny | Unsafe execution |
| Execution → Backend | Command | `ExecutionBackend.execute()` | Sandboxed result | Local fallback |
| Result → Evolution | Task outcome | `EvolutionCoordinator.recordOutcome()` | Fitness update | No learning |

---

**Next**: [system-wiring.md](./system-wiring.md) - Complete 45-wire technical diagram and feedback loops
