# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian Validation & Appendices

> **FOR AGENTS**: This doc contains validation checklists, test commands, and industry alignment. Use after implementing.
> **Navigation**: [README.md](./README.md) | [fixes-remaining.md](./fixes-remaining.md) | [implementation-requirements.md](./implementation-requirements.md)

---

## Quick Reference: What's In This Document

| Section | What It Contains | Jump Link |
|---------|------------------|-----------|
| Integration Points | How LiBrainian wires into Wave0 | [#part-3-LiBrainian-integration](#part-3-LiBrainian-integration) |
| Industry Alignment | Comparison to Kythe, Glean, etc. | [#part-4-industry-alignment](#part-4-industry-alignment) |
| Implementation Checklist | Per-phase verification | [#part-5-implementation-checklist](#part-5-implementation-checklist) |
| Validation Tests | Specific test commands | [#part-6-validation-tests](#part-6-validation-tests) |
| What Exists vs Needs Building | Current state audit | [#appendix-b-what-exists-vs-what-needs-building](#appendix-b-what-exists-vs-what-needs-building) |

---

This document contains:
- Part 3: LiBrainian Integration Points
- Part 4: Industry Alignment
- Part 5: Implementation Checklist
- Part 6: Validation Tests
- Appendix A: Complete Documentation Suite
- Appendix B: What Exists vs What Needs Building

---

## PART 3: LiBrainian INTEGRATION

With the above fixes in place, LiBrainian integrates naturally:

### Integration Points

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WAVE0 UNIFIED ORCHESTRATOR                    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    1. STARTUP                                │    │
│  │  preOrchestrationHook() ──▶ LiBrainian Bootstrap             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    2. TASK INTAKE                            │    │
│  │  WorkGraph ──▶ SemanticScheduler ──▶ LiBrainian Similarity   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    3. CONTEXT ASSEMBLY                       │    │
│  │  Task ──▶ ContextAssembler ──▶ LiBrainian Knowledge          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    4. AGENT EXECUTION                        │    │
│  │  Agent receives context + query tool ──▶ LiBrainian Queries  │    │
│  │  File reads intercepted ──▶ LiBrainian Policy                │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    5. OUTCOME FEEDBACK                       │    │
│  │  Result ──▶ Causal Attribution ──▶ LiBrainian Confidence     │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Quick Reference for Agents

```typescript
// What you get:
context.required.targetFiles[]    // Files with full semantic knowledge
context.required.callGraph[]      // What calls what
context.coverage.gaps[]           // What we DON'T know
context.query                     // Ask for more knowledge

// Rules:
// 1. Use context.required first, don't re-read files
// 2. Cite evidence: [file:line] for all claims
// 3. Acknowledge gaps in output
// 4. Use context.query when stuck
```

---

## PART 4: INDUSTRY ALIGNMENT

Based on research into leading systems ([OpenAI Codex](https://openai.com/index/introducing-codex/), [Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk), [Microsoft Magentic-One](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)):

### What World-Class Systems Have

| Feature | Codex | Claude SDK | Wave0 Target |
|---------|-------|------------|--------------|
| Sandboxed execution | Yes (isolated containers) | Yes (permission controls) | Fix P10 |
| Checkpoint/resume | Yes (automatic) | Yes (compact feature) | Fix P8 |
| Parallel multi-agent | Yes (cloud tasks) | Yes (subagents) | Fix P2, P9 |
| Knowledge grounding | Yes (codebase context) | Yes (CLAUDE.md) | LiBrainian |
| Observability | Yes (citations, logs) | Yes (OpenTelemetry) | Add tracing |
| Human oversight | Yes (PR review) | Yes (hooks) | Quality gates |

### Patterns to Implement

1. **Single Job Per Agent** (from Claude SDK):
   > "Give each subagent one job, and let an orchestrator coordinate."

   ```typescript
   // Wave0 implementation:
   const agents = {
     coder: new Agent({ role: 'write_code' }),
     reviewer: new Agent({ role: 'review_code' }),
     tester: new Agent({ role: 'write_tests' }),
     documenter: new Agent({ role: 'write_docs' })
   };
   ```

2. **AGENTS.md Convention** (from Codex):
   > "Instruct agents to adopt team-specific conventions."

   ```markdown
   # AGENTS.md
   - Use camelCase for functions
   - Tests must cover edge cases
   - No console.log in production code
   ```

3. **Hierarchical Memory** (from research):
   > "O(√t log t) complexity through multi-tier architecture."

   ```typescript
   class HierarchicalMemory {
     l1Cache: Map<string, Knowledge>;     // Hot: current task
     l2Cache: LRUCache<Knowledge>;        // Warm: recent tasks
     persistent: SQLiteStorage;           // Cold: all history
   }
   ```

4. **Permission Scoping** (from Claude SDK):
   > "Permission sprawl is the fastest path to unsafe autonomy."

   ```typescript
   const agentPermissions = {
     coder: ['read:src', 'write:src', 'exec:npm test'],
     reviewer: ['read:src', 'read:tests'],  // No write!
     tester: ['read:src', 'write:tests', 'exec:npm test']
   };
   ```

---

## PART 5: IMPLEMENTATION CHECKLIST

### Phase 0: Critical Fixes (Must Do First)

- [x] **P1**: Wire `preOrchestrationHook()` into startup
- [x] **P2**: Consolidate to single orchestrator
- [x] **P3**: Fix 20 highest-impact `any` types
- [x] **P4**: Make quality gates configurable
- [x] **P5**: Wire context assembly to LiBrainian

### Phase 1: Core Integration

- [x] Provider availability enforced at startup (P7)
- [x] LiBrainian hard-stops on failure (P17)
- [x] Mock orchestrator fallbacks removed (P18)
- [x] Execution backends in place (P24)
- [x] Policy engine enforced (P25)
- [x] Context assembly uses LiBrainian (P5 complete)
- [x] Scheduler uses semantic similarity (P6)
- [x] Agent pool is functional (P9)
- [x] Checkpoint system works (P8)

### Phase 2: Anti-Guessing

- [x] File read interception active
- [x] Evidence linking extracts line numbers
- [x] Trajectory analysis detects guessing
- [x] Gap acknowledgment enforced

### Phase 3: Production Hardening

- [x] Sandbox enabled by default (P10)
- [x] SQLite concurrent access safe (P11)
- [x] Provider availability enforced at startup (P7)
- [x] All tests enabled (P12)

### Phase 4: Excellence

- [x] OpenTelemetry tracing
- [x] Expertise matching
- [x] Hierarchical memory
- [x] Self-improving policies

---

## PART 6: VALIDATION

### Smoke Test (Run After Phase 0)

```typescript
describe('Wave0 Basic Functionality', () => {
  test('LiBrainian initializes at startup', async () => {
    const orchestrator = new UnifiedOrchestrator(config);
    await orchestrator.initialize();
    expect(isLibrarianReady()).toBe(true);
    expect(existsSync('.LiBrainian/LiBrainian.sqlite')).toBe(true);
  });

  test('context assembly includes knowledge', async () => {
    const context = await assembleTaskContext({
      id: 'test',
      type: 'bug_fix',
      targetFiles: ['src/LiBrainian/api/query.ts']
    });
    expect(context.required.targetFiles.length).toBeGreaterThan(0);
    expect(context.required.targetFiles[0].functions.length).toBeGreaterThan(0);
  });

  test('agent receives working query interface', async () => {
    const context = await assembleTaskContext(testTask);
    const result = await context.query.queryFile('src/LiBrainian/api/query.ts');
    expect(result.purpose).toBeDefined();
  });

  test('task executes end-to-end', async () => {
    const result = await orchestrator.run({
      id: 'e2e-test',
      type: 'investigation',
      description: 'What does the query function do?',
      targetFiles: ['src/LiBrainian/api/query.ts']
    });
    expect(result.success).toBe(true);
  });
});
```

### Integration Test (Run After Phase 1)

```typescript
describe('Wave0 + LiBrainian Integration', () => {
  test('semantic scheduling groups related tasks', async () => {
    const tasks = [
      { targetFiles: ['src/LiBrainian/api/query.ts'] },
      { targetFiles: ['src/LiBrainian/api/LiBrainian.ts'] },  // Similar
      { targetFiles: ['src/workgraph/runner.ts'] }       // Different
    ];
    const scheduled = await scheduler.schedule(tasks);
    // First two should be grouped
    expect(scheduled[0].group).toBe(scheduled[1].group);
    expect(scheduled[0].group).not.toBe(scheduled[2].group);
  });

  test('checkpoint enables resume', async () => {
    // Start task
    const task = createLongTask();
    const execution = orchestrator.run(task);

    // Simulate crash after 50%
    await waitForProgress(task.id, 0.5);
    await execution.abort();

    // Resume
    const resumed = await orchestrator.run(task);
    expect(resumed.resumedFrom).toBe(0.5);
    expect(resumed.success).toBe(true);
  });
});
```

---

## APPENDIX: Configuration

```typescript
// Programmatic configuration (no config/wave0.ts file).
import type { UnifiedOrchestratorConfig } from 'src/orchestrator/unified/orchestrator_types.js';
import { createBootstrapConfig } from 'src/LiBrainian/api/bootstrap.js';
import { INCLUDE_PATTERNS, EXCLUDE_PATTERNS } from 'src/LiBrainian/universal_patterns.js';

const orchestratorConfig: UnifiedOrchestratorConfig = {
  agentCount: 4,
  preferredOrchestrator: 'claude',
  workspaceRoot: process.cwd(),
  budgetTokensPerEpoch: 250_000,
  governanceStrict: true,
};

const librarianBootstrap = createBootstrapConfig(process.cwd(), {
  timeoutMs: 300_000,
  include: INCLUDE_PATTERNS,
  exclude: EXCLUDE_PATTERNS,
});
```

---

## Sources

- [Azure AI Agent Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [Claude Agent SDK Best Practices](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [OpenAI Codex Architecture](https://openai.com/index/introducing-codex/)
- [Multi-Agent Orchestration Patterns 2024](https://collabnix.com/multi-agent-orchestration-patterns-and-best-practices-for-2024/)
- [Building AI-Native Engineering Teams](https://developers.openai.com/codex/guides/build-ai-native-engineering-team/)

---

**Document Status**: Comprehensive diagnosis complete. P16 command-injection fix landed. P1-P5 implemented (startup hook, orchestrator entrypoint cleanup, configurable workgraph gates, LiBrainian-backed context assembly). P6 semantic scheduling, P8 checkpointing, P10 sandbox default, P11 SQLite locking, and P14 bootstrap recovery implemented. P7 provider gate, P17 hard-stop, P18 mock fallback removal, P24 execution backends, P25 policy engine, P9 agent pool, P13 expertise matching, P26 HITL routing, and P27 agent registry are implemented. P3 any sweep, P15 query API docs, P19 safe JSON.parse, P21 type-safe error handling, and P22 @ts-ignore removal complete. P20 TODO comment cleanup complete (remaining TODO strings are semantic signal tags/tests). P29 promote_operator split complete (phase modules + run_autopilot <400 lines). P28 evolution coordinator wired (policy optimization + gene pool updates + persisted artifacts). P12/P23 re-enable complete (0 disabled; `state/audits/disabled_tests.json` updated). P30 archived OrchestratorLoop + legacy workflow core (workflow_orchestrator now used by TaskExecutionRouter). P31 modularization expanded (init/start/agent spawn/entropy extracted; unified_orchestrator.ts reduced). Agent protocol compliance reports are now emitted (AgentComplianceReport.v1). Phase 9 progress: G1 HTN planner + formal planning integration, G2 episodic memory (SQLite + semantic recall), G3 bench harness + real scoreboard execution.

---

## APPENDIX A: COMPLETE DOCUMENTATION SUITE

### A.1 Document Relationship Map

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 WAVE0 DOCUMENTATION ECOSYSTEM                                            │
│                                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                                   THIS DOCUMENT                                                  │    │
│  │                          LiBrainian-wave0-integration.md                                          │    │
│  │                                                                                                  │    │
│  │  Contains:                                                                                       │    │
│  │  • P1-P31: All problems with detailed fix instructions                                           │    │
│  │  • PART 1B: Implementation order & wiring                                                        │    │
│  │  • PART 1C: Complete feedback loops & subsystem map                                              │    │
│  │  • Integration points & verification checklist                                                   │    │
│  │                                                                                                  │    │
│  └──────────────────────────────────────────────┬───────────────────────────────────────────────────┘    │
│                                                 │                                                        │
│                ┌────────────────────────────────┼────────────────────────────────┐                       │
│                │                                │                                │                       │
│                ▼                                ▼                                ▼                       │
│  ┌────────────────────────────┐  ┌────────────────────────────┐  ┌────────────────────────────┐         │
│  │  WORLD_CLASS_ASSESSMENT.md │  │ CODEX_WORLD_CLASS_         │  │ WORLD_CLASS_UI_            │         │
│  │                            │  │ IMPLEMENTATION_GUIDE.md    │  │ SPECIFICATION.md           │         │
│  │  Contains:                 │  │                            │  │                            │         │
│  │  • G1-G12: Capability gaps │  │  Contains:                 │  │  Contains:                 │         │
│  │  • A1-A10: Arch problems   │  │  • Phased implementation   │  │  • 14 view specifications  │         │
│  │  • Roadmap post-P31        │  │  • Code examples           │  │  • Interaction modes       │         │
│  │  • Honest metrics          │  │  • Verification steps      │  │  • Dogfooding protocol     │         │
│  │  • World-class comparison  │  │  • Benchmark integration   │  │  • Stakeholder features    │         │
│  │                            │  │                            │  │                            │         │
│  └────────────────────────────┘  └────────────────────────────┘  └────────────────────────────┘         │
│                │                                │                                │                       │
│                └────────────────────────────────┴────────────────────────────────┘                       │
│                                                 │                                                        │
│                                                 ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                                   SUPPORTING DOCUMENTS                                           │    │
│  │                                                                                                  │    │
│  │  docs/AGENTS.md         → Agent construction manual, anti-slop rules                            │    │
│  │  docs/SCAS.md           → 12 SCAS principles, agent commitments                                 │    │
│  │  docs/TEST.md           → Testing epistemology, live agent requirements                         │    │
│  │  docs/AUTHENTICATION.md → CLI-only auth, no browser flows                                       │    │
│  │  docs/CLAUDE.md         → Implementation specialist guide                                       │    │
│  │  config/canon.json      → Canonical commands, forbidden state                                   │    │
│  │                                                                                                  │    │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### A.2 What Each Document Covers

| Document | Primary Audience | Primary Purpose | When to Use |
|----------|------------------|-----------------|-------------|
| **This doc** (integration) | Implementers | HOW to fix P1-P31 | When implementing fixes |
| **WORLD_CLASS_ASSESSMENT** | Strategists | WHAT gaps remain after P1-P31 | When planning work beyond P31 |
| **CODEX_GUIDE** | Agents (Codex) | Phased execution of fixes | When working in phases |
| **UI_SPECIFICATION** | UI developers | UI/UX requirements | When building the TUI/Web UI |
| **AGENTS.md** | All agents | Construction rules | Always (foundation) |
| **SCAS.md** | All agents | Principles | Always (philosophy) |
| **TEST.md** | Testers | Testing rules | When writing tests |

### A.3 Gap Analysis: What's Missing?

| Gap | Description | Resolution |
|-----|-------------|------------|
| **G1-G12 implementation details** | Assessment lists gaps but not fix instructions | G1-G4 implemented (planner, memory, bench, calibration); G5-G12 pending |
| **A1-A10 fix instructions** | Assessment lists problems but not fixes | A1, A3, A5 addressed in CODEX_GUIDE Phase 1-3 |
| **Subsystem existence verification** | Some subsystems in map may not exist | Marked with P-fix that creates them |
| **Runtime health dashboards** | TUI dashboard/metrics implemented; web dashboard pending | Part of G8 (UI), G10 (Debugging) |

### A.4 Implementation Order (Complete)

```
LAYER 0: SECURITY BASELINE
└── P16: Command Injection Fix (MUST BE FIRST)

LAYER 1: P1-P31 (This Document)
├── Phase 0: P16 (security)
├── Phase 1: P7, P17, P18, P1, P24, P25 (infrastructure)
├── Phase 2: P2, P5, P6, P4 (orchestration)
├── Phase 3: P9, P27, P13 (agents)
├── Phase 4: P8, P10, P11, P14 (reliability)
├── Phase 5: P26 (human oversight)
├── Phase 6: P28 (evolution)
├── Phase 7: P3, P19, P21, P22 (type safety)
└── Phase 8: P12, P20, P23, P29, P30, P31 (cleanup)

LAYER 2: A1-A10 Architectural (Assessment + CODEX_GUIDE)
├── A1: SCAS Enforcement Layer
├── A3: Layering Enforcement
├── A5: Test Philosophy Resolution
└── A6-A10: As resources allow

LAYER 3: G1-G12 Capability Gaps (Assessment)
├── Phase A: G8, G9, G10 (UI/UX, DX, Debugging) - TABLE STAKES
├── Phase B: G3, G2, G1 (Benchmark, Memory, Planning) - COMPETITIVE
└── Phase C: G4, G5, G6, G7, G11, G12 (Advanced) - DIFFERENTIATION

LAYER 4: World-Class UI (UI_SPECIFICATION)
├── TUI Enhancement (14 views)
├── Web Dashboard
├── Live Chat with Orchestrator
└── Dogfooding Protocol
```

### A.5 Cross-Reference: Subsystem → Problem → Gap

| Subsystem | Created By | Gaps After Creation |
|-----------|------------|---------------------|
| S01 Orchestrator | P2, P29-31 | G1 (formal planning) |
| S02 Workgraph | P4, P8 | G6 (temporal) |
| S03 Scheduler | P6 | G1 (HTN planning) |
| S04 Agent Pool | P9, P27 | G2 (memory) |
| S05 Agent Registry | P13, P27 | A10 (evolution) |
| S06 Context Assembler | P5 | - |
| S07 LiBrainian | P1, P14, P15 | G2 (memory) |
| S08 Storage | P11 | - |
| S11 Episodic Memory | (exists, needs G2) | G2 (real memory) |
| S12 Backends | P24, P10 | - |
| S13 Policy Engine | P25 | A9 (adversarial) |
| S14 Git Sanitizer | P16 | - |
| S15 HITL Router | P26 | G12 (team) |
| S17 Quality Gate | P4 | G4 (uncertainty) |
| S18-20 Evolution | P28 | A10 (complete) |
| S21 Provider Check | P7 | A8 (resilience) |
| S24 TUI | (exists, needs G8) | G8 (world-class) |

### A.6 Verification: How to Know You're Done

| Milestone | Verification Command | Expected Output |
|-----------|---------------------|-----------------|
| P16 fixed | `npm run test:tier0 -- --grep git_sanitizer` | All tests pass |
| P1-P15 complete | `npm run test:tier0 && npm test` | All tests pass |
| P16-P31 complete | `npm run test:tier0 && npm test` | All pass |
| Layer 1 complete | `node scripts/dogfood_full_system_pack.mjs` | Evidence pack generated |
| A1-A5 complete | TBD - requires SCAS gate implementation | TBD |
| G8 complete | TUI has 14 views + Web dashboard exists | Manual verification |
| World-class | SWE-bench-lite > 50%, GAIA > 75% | Benchmark results |

---

## APPENDIX B: WHAT EXISTS VS WHAT NEEDS BUILDING

### B.1 Current State Inventory

| Component | Exists? | State | P-Fix to Complete |
|-----------|---------|-------|-------------------|
| UnifiedOrchestrator | ✓ Yes | Modularized (init/start/agent spawn/entropy extracted) | P31 complete |
| Workgraph | ✓ Yes | Functional | P4, P8 enhance |
| LiBrainian | ✓ Yes | 84 files, working | P1, P14, P15 integrate |
| Agent Pool | ✓ Yes | Queueing + execution bridge | P9 complete |
| Agent Registry | ✓ Yes | Capability matching | P27 complete |
| Context Assembler | ✗ Missing | Not called | P5 creates |
| Execution Backends | ✗ Missing | All execSync | P24 creates |
| Policy Engine | ✗ Stub | Not real | P25 creates |
| Git Sanitizer | ✗ Missing | Vulnerable | P16 creates |
| HITL Router | ✓ Yes | File-based HITL routing | P26 complete |
| Checkpoint Manager | ✓ Yes | Workgraph checkpoints + resume reset | P8 complete |
| Evolution Coordinator | ✗ Missing | Not wired | P28 creates |
| TUI | ✓ Yes | 11 tabs (dashboard/activity/diff/metrics/settings/logs) | G8: web dashboard + remaining views |
| Provider Check | ✓ Yes | Exists | P7 enforces |

### B.2 Files to Create (New)

| File | P-Fix | Purpose |
|------|-------|---------|
| `src/spine/git_sanitizer.ts` | P16 | Input validation |
| `src/spine/execution_backends/types.ts` | P24 | Backend interface |
| `src/spine/execution_backends/local_backend.ts` | P24 | Local execution |
| `src/spine/execution_backends/docker_backend.ts` | P24 | Sandboxed execution |
| `src/spine/policy_engine.ts` | P25 | Security rules |
| `src/workgraph/checkpoint.ts` | P8 | Workgraph checkpoints |
| `src/orchestrator/agent_registry.ts` | P27 | Agent catalog (created) |
| `src/orchestrator/expertise_matcher.ts` | P13 | Expertise matching (created) |
| `src/orchestrator/hitl/domain_expert_router.ts` | P26 | Human review routing (created) |
| `src/self_evolution/evolution_coordinator.ts` | P28 | Evolution wiring |
| `src/utils/safe_json.ts` | P19 | Safe JSON parsing |
| `src/utils/errors.ts` | P21 | Error utilities |

### B.3 Files to Modify (Existing)

| File | P-Fix | Change |
|------|-------|--------|
| `src/orchestrator/unified_orchestrator.ts` | P1, P2, P31 | Add LiBrainian init, split |
| `src/spine/external_project_operator.ts` | P16 | Use git_sanitizer |
| `src/LiBrainian/integration/wave0_integration.ts` | P17 | Hard fail on error |
| `src/workgraph/runner.ts` | P6, P8 | Add semantic scheduling + checkpointing |
| `src/orchestrator/context_assembler.ts` | P5 | Wire LiBrainian |
| All files with `any` | P3 | Add proper types |
| All files with `JSON.parse` | P19 | Use safeJsonParse |
| All catch blocks | P21 | Type-safe error handling |

---

**Document Status**: Comprehensive diagnosis complete. P16 command-injection fix landed. P1-P5 implemented (startup hook, orchestrator entrypoint cleanup, configurable workgraph gates, LiBrainian-backed context assembly). P6 semantic scheduling, P8 checkpointing, P10 sandbox default, P11 SQLite locking, and P14 bootstrap recovery implemented. P7 provider gate, P17 hard-stop, P18 mock fallback removal, P24 execution backends, P25 policy engine, P9 agent pool, P13 expertise matching, P26 HITL routing, and P27 agent registry are implemented. P3 any sweep, P15 query API docs, P19 safe JSON.parse, P21 type-safe error handling, and P22 @ts-ignore removal complete. P20 TODO comment cleanup complete (remaining TODO strings are semantic signal tags/tests). P29 promote_operator split complete (phase modules + run_autopilot <400 lines). P28 evolution coordinator wired (policy optimization + gene pool updates + persisted artifacts). P12/P23 re-enable complete (0 disabled; `state/audits/disabled_tests.json` updated). P30 archived OrchestratorLoop + legacy workflow core (workflow_orchestrator now used by TaskExecutionRouter). P31 modularization expanded (init/start/agent spawn/entropy extracted; unified_orchestrator.ts reduced).

---

> **AGENT INSTRUCTION**: After implementing fixes, update this document:
> 1. Mark completed problems with `[x]` in the Problem Matrix
> 2. Once P16 is verified fixed, delete the warning block at the top
> 3. Update the "Current State vs Target State" table with actual metrics
> 4. Add verification evidence (test output, trace refs) to each completed problem
> 5. Move completed items from "What Needs Building" to "What Exists"
