# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian System Wiring & Feedback Loops

> **FOR AGENTS**: This doc maps ALL 45 technical wires and feedback loops in Wave0. Read this to understand data flow.
> **Navigation**: [README.md](./README.md) | [implementation-phases.md](./implementation-phases.md) | [fixes-critical.md](./fixes-critical.md)

---

## Quick Reference: What's In This Document

| Section | What It Contains | Jump Link |
|---------|------------------|-----------|
| Core Data Flow | Main orchestration loop diagram | [#core-data-flow-loop](#11-core-data-flow-loop) |
| Quality Feedback | Test results, metrics → confidence | [#quality-feedback-loops](#12-quality-feedback-loops) |
| Learning Feedback | Episodic memory, anti-patterns | [#learning-feedback-loops](#13-learning-feedback-loops) |
| LiBrainian Feedback | Knowledge updates, reindexing | [#LiBrainian-feedback-loops](#14-LiBrainian-feedback-loops) |
| All 45 Wires | Complete wire table | [#complete-wire-reference](#complete-wire-reference) |

---

## PART 1C: COMPLETE SYSTEM WIRING & FEEDBACK LOOPS

> **This section maps ALL major feedback loops in Wave0** — technical, conceptual, theoretical, and emergent. Understanding these is critical for building a Successful Complex Adaptive System (SCAS).

### 1. TECHNICAL FEEDBACK LOOPS (Runtime Wiring)

#### 1.1 Core Data Flow Loop

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              CORE ORCHESTRATION DATA FLOW                                    │
│                                                                                              │
│    EXTERNAL                    WAVE0 CORE                           CODEBASE                 │
│    ─────────                   ─────────                            ────────                 │
│                                                                                              │
│    ┌─────────┐                 ┌─────────────────────────────────┐  ┌──────────────────┐    │
│    │  User   │────Request────▶│       UNIFIED ORCHESTRATOR       │  │   External Repo   │    │
│    │ Intent  │                 │                                  │  │   (cloned work)   │    │
│    └─────────┘                 │  ┌──────────┐   ┌───────────┐   │  └──────────────────┘    │
│         ▲                      │  │ WORKGRAPH│──▶│ SCHEDULER │   │           │              │
│         │                      │  └──────────┘   └───────────┘   │           │              │
│         │                      │       │              │          │           │              │
│         │                      │       ▼              ▼          │           │              │
│         │                      │  ┌─────────────────────────┐    │           │              │
│    Result                      │  │    CONTEXT ASSEMBLER     │◀──┼───────────┘              │
│    Feedback                    │  │  (file knowledge, deps)  │   │     File reads           │
│         │                      │  └─────────────────────────┘    │                          │
│         │                      │       │                         │                          │
│         │                      │       ▼                         │                          │
│         │                      │  ┌─────────────────────────┐    │                          │
│         │                      │  │       LiBrainian         │    │                          │
│         │                      │  │  Semantic Knowledge DB   │    │                          │
│         │                      │  │  - File embeddings       │    │                          │
│         │                      │  │  - Call graphs          │    │                          │
│         │                      │  │  - Pattern memory       │    │                          │
│         │                      │  └─────────────────────────┘    │                          │
│         │                      │       │                         │                          │
│         │                      │       ▼                         │                          │
│         │                      │  ┌─────────────────────────┐    │  ┌──────────────────┐    │
│         │                      │  │      AGENT POOL         │───▶│──│  LLM PROVIDER    │    │
│         │                      │  │  (coder, tester, etc.)  │◀───│──│  (Claude/GPT)    │    │
│         │                      │  └─────────────────────────┘    │  └──────────────────┘    │
│         │                      │       │                         │                          │
│         │                      │       ▼                         │                          │
│         │                      │  ┌─────────────────────────┐    │                          │
│         │                      │  │   EXECUTION BACKENDS    │────┼───▶ Code changes        │
│         │                      │  │  (sandbox, docker)      │    │                          │
│         │                      │  └─────────────────────────┘    │                          │
│         │                      │       │                         │                          │
│         │                      │       ▼                         │                          │
│         │                      │  ┌─────────────────────────┐    │                          │
│         └──────────────────────┼──│   QUALITY GATES         │◀───┼─── Test results        │
│                                │  │  (slop, complexity)     │    │                          │
│                                │  └─────────────────────────┘    │                          │
│                                │                                  │                          │
│                                └─────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 1.2 All Technical Wire Connections

| # | Source Module | Target Module | Wire Type | Data Transferred | Frequency |
|---|---------------|---------------|-----------|------------------|-----------|
| 1 | CLI entry | `UnifiedOrchestrator` | Init | Config, workspace path | Once/run |
| 2 | `UnifiedOrchestrator` | `requireProviders()` | Check | Provider requirements | Once/startup |
| 3 | `requireProviders()` | LLM API | Healthcheck | Ping request | Once/startup |
| 4 | `UnifiedOrchestrator` | `preOrchestrationHook()` | Init | Workspace, timeout | Once/startup |
| 5 | `preOrchestrationHook()` | `LibrarianBootstrap` | Init | Workspace root | Once/startup |
| 6 | `LibrarianBootstrap` | File system | Scan | Directory traversal | Once/bootstrap |
| 7 | `LibrarianBootstrap` | Embedding API | Embed | File contents | Per file |
| 8 | `LibrarianBootstrap` | `SQLiteStorage` | Store | Embeddings, metadata | Per file |
| 9 | `WorkGraph` | Task source | Intake | New tasks | Per task |
| 10 | `WorkGraph` | `SemanticScheduler` | Schedule | Task list | Per batch |
| 11 | `SemanticScheduler` | `LiBrainian.getSemanticSimilarity()` | Query | File paths | Per task pair |
| 12 | `SemanticScheduler` | `AgentPool` | Assign | Scheduled tasks | Per task |
| 13 | `AgentPool` | `AgentRegistry` | Lookup | Capability query | Per assignment |
| 14 | `AgentRegistry` | Agent instance | Acquire | Agent lock | Per assignment |
| 15 | Agent instance | `ContextAssembler` | Request | Task + files | Per task |
| 16 | `ContextAssembler` | `LiBrainian.assembleContext()` | Query | File paths, task type | Per task |
| 17 | `LiBrainian` | `SQLiteStorage` | Query | Embedding lookup | Per query |
| 18 | `LiBrainian` | `SQLiteStorage` | Query | Call graph lookup | Per query |
| 19 | `ContextAssembler` | Agent instance | Response | Enriched context | Per task |
| 20 | Agent instance | LLM API | Inference | Prompt + context | Per action |
| 21 | LLM API | Agent instance | Response | Generated text | Per action |
| 22 | Agent instance | `PolicyEngine` | Check | Proposed action | Per action |
| 23 | `PolicyEngine` | Agent instance | Decision | Allow/deny | Per action |
| 24 | Agent instance | `ExecutionBackend` | Execute | Command | Per execution |
| 25 | `ExecutionBackend` | File system | I/O | File operations | Per execution |
| 26 | `ExecutionBackend` | Agent instance | Result | Exit code, stdout | Per execution |
| 27 | Agent instance | `CheckpointManager` | Save | State snapshot | Per phase |
| 28 | `CheckpointManager` | File system | Write | Checkpoint JSON | Per phase |
| 29 | Agent instance | `LiBrainian` | Report | Action trajectory | Per task |
| 30 | `LiBrainian` | `EpisodicMemory` | Store | Episode record | Per task |
| 31 | Agent instance | `QualityGate` | Submit | Patch/output | Per task |
| 32 | `QualityGate` | LLM API | Review | Code for slop check | Per submission |
| 33 | `QualityGate` | `DomainExpertRouter` | Route | Approval request | If needed |
| 34 | `DomainExpertRouter` | File system | Write | HITL request | Per request |
| 35 | File system | `DomainExpertRouter` | Read | HITL response | Polling |
| 36 | `QualityGate` | `WorkGraph` | Feedback | Pass/fail result | Per submission |
| 37 | `WorkGraph` | `EvolutionCoordinator` | Report | Task outcome | Per completion |
| 38 | `EvolutionCoordinator` | `PolicyOptimizer` | Update | Outcome metrics | Per completion |
| 39 | `PolicyOptimizer` | Policy weights | Adjust | Weight delta | Per update |
| 40 | `EvolutionCoordinator` | `GenePoolManager` | Update | Fitness score | Per completion |
| 41 | `GenePoolManager` | Agent genomes | Mutate | Selection/crossover | Per generation |
| 42 | `AgentPool` | `AgentRegistry` | Release | Agent + metrics | Per completion |
| 43 | `AgentRegistry` | Agent metrics | Update | Success rate, duration | Per completion |
| 44 | `UnifiedOrchestrator` | `WorkGraph` | Monitor | Status query | Continuous |
| 45 | `WorkGraph` | TUI | Emit | Progress updates | Continuous |

### 2. LEARNING FEEDBACK LOOPS (Improvement Wiring)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              LEARNING & ADAPTATION LOOPS                                     │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                          LOOP A: TASK-LEVEL LEARNING                                 │    │
│  │                                                                                      │    │
│  │   Task         ──▶ Agent        ──▶ Execution    ──▶ Outcome     ──▶ EpisodicMemory │    │
│  │   assigned         processes        succeeds/         recorded        stores         │    │
│  │       ▲                             fails                  │          episode         │    │
│  │       │                                                    │              │           │    │
│  │       └────────────────────────────────────────────────────┴──────────────┘           │    │
│  │                     Future similar tasks recall past episodes                         │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                          LOOP B: AGENT-LEVEL EVOLUTION                               │    │
│  │                                                                                      │    │
│  │   Agent         ──▶ Tasks        ──▶ Fitness     ──▶ Selection   ──▶ New agents     │    │
│  │   genome            completed        computed         pressure        evolved        │    │
│  │       ▲                                                   │              │           │    │
│  │       │                                                   │              │           │    │
│  │       └───────────────────────────────────────────────────┴──────────────┘           │    │
│  │                     High-fitness genes propagate to next generation                  │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                          LOOP C: POLICY OPTIMIZATION                                 │    │
│  │                                                                                      │    │
│  │   Policy         ──▶ Decisions   ──▶ Outcomes    ──▶ Gradient    ──▶ Policy update  │    │
│  │   weights            made             measured        computed        applied        │    │
│  │       ▲                                                   │              │           │    │
│  │       │                                                   │              │           │    │
│  │       └───────────────────────────────────────────────────┴──────────────┘           │    │
│  │                     Policies that lead to success get reinforced                     │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                          LOOP D: KNOWLEDGE ENRICHMENT                                │    │
│  │                                                                                      │    │
│  │   Code change   ──▶ LiBrainian   ──▶ Re-index    ──▶ New          ──▶ Better context │    │
│  │   committed         detects         affected        embeddings       for agents      │    │
│  │       ▲             change          files           stored              │            │    │
│  │       │                                                                 │            │    │
│  │       └─────────────────────────────────────────────────────────────────┘            │    │
│  │                     Knowledge grows with each change                                 │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                          LOOP E: ANTI-PATTERN LEARNING                               │    │
│  │                                                                                      │    │
│  │   Slop          ──▶ Pattern     ──▶ Anti-pattern ──▶ Future      ──▶ Preemptive    │    │
│  │   detected          extracted       registered       tasks           avoidance     │    │
│  │       ▲                                   │           query              │           │    │
│  │       │                                   │           before             │           │    │
│  │       │                                   │           action             │           │    │
│  │       └───────────────────────────────────┴──────────────────────────────┘           │    │
│  │                     Via negativa: learn what NOT to do                               │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3. QUALITY & SAFETY FEEDBACK LOOPS

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              QUALITY & SAFETY GATES                                          │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                          LOOP F: SLOP DETECTION                                      │    │
│  │                                                                                      │    │
│  │   Code output   ──▶ SlopReviewer ──▶ Violations  ──▶ Rejection   ──▶ Retry with    │    │
│  │                      analyzes         counted        if > 0          feedback       │    │
│  │       ▲                                                   │              │           │    │
│  │       │                                                   │              │           │    │
│  │       └───────────────────────────────────────────────────┴──────────────┘           │    │
│  │                     Slop never makes it to main branch                               │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                          LOOP G: COMPLEXITY BUDGET                                   │    │
│  │                                                                                      │    │
│  │   Proposed      ──▶ Complexity  ──▶ Budget      ──▶ Approval    ──▶ Allowed OR     │    │
│  │   change            measured        checked         decision        must simplify   │    │
│  │       ▲                                                   │              │           │    │
│  │       │                                                   │              │           │    │
│  │       └───────────────────────────────────────────────────┴──────────────┘           │    │
│  │                     Complexity cannot grow unbounded                                 │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                          LOOP H: SECURITY POLICY                                     │    │
│  │                                                                                      │    │
│  │   Any command   ──▶ PolicyEngine ──▶ Rule        ──▶ Block if    ──▶ Safe          │    │
│  │                      evaluates        match          dangerous       execution      │    │
│  │       ▲                                                   │              │           │    │
│  │       │                                                   │              │           │    │
│  │       │              Log & learn from blocked attempts    │              │           │    │
│  │       └───────────────────────────────────────────────────┴──────────────┘           │    │
│  │                     Dangerous commands never execute                                 │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                          LOOP I: HUMAN OVERSIGHT                                     │    │
│  │                                                                                      │    │
│  │   High-stakes   ──▶ HITL        ──▶ Human       ──▶ Decision    ──▶ Apply OR       │    │
│  │   decision          Router          reviews          made           reject          │    │
│  │       ▲                                                   │              │           │    │
│  │       │                                                   │              │           │    │
│  │       │              Timeout = auto-reject                │              │           │    │
│  │       └───────────────────────────────────────────────────┴──────────────┘           │    │
│  │                     Humans remain in control for critical decisions                  │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4. EMERGENT FEEDBACK LOOPS (System-Level)

These loops emerge from the interaction of components, not from explicit design:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              EMERGENT SYSTEM LOOPS                                           │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │  EMERGENT LOOP J: SPECIALIZATION PRESSURE                                           │    │
│  │                                                                                      │    │
│  │  Agents that succeed on specific file types → Get assigned more of those types →    │    │
│  │  Become increasingly specialized → System develops "expert" agents naturally        │    │
│  │                                                                                      │    │
│  │  [Agent metrics] ──▶ [Expertise matching] ──▶ [Task assignment] ──▶ [More success] │    │
│  │        ▲                                                                │            │    │
│  │        └────────────────────────────────────────────────────────────────┘            │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │  EMERGENT LOOP K: CODEBASE COHERENCE                                                │    │
│  │                                                                                      │    │
│  │  LiBrainian learns patterns → Agents follow learned patterns → New code matches →    │    │
│  │  Patterns reinforce → Codebase becomes increasingly consistent                      │    │
│  │                                                                                      │    │
│  │  [Pattern extraction] ──▶ [Context provision] ──▶ [Code generation] ──▶ [Learning] │    │
│  │        ▲                                                                    │        │    │
│  │        └────────────────────────────────────────────────────────────────────┘        │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │  EMERGENT LOOP L: COMPLEXITY EQUILIBRIUM                                            │    │
│  │                                                                                      │    │
│  │  Complexity budget enforced → Agents learn concise solutions → System complexity    │    │
│  │  stays bounded → Easier to understand → Better decisions → Lower complexity         │    │
│  │                                                                                      │    │
│  │  [Complexity gates] ──▶ [Rejection feedback] ──▶ [Simpler solutions] ──▶ [Success] │    │
│  │        ▲                                                                    │        │    │
│  │        └────────────────────────────────────────────────────────────────────┘        │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │  EMERGENT LOOP M: KNOWLEDGE DENSITY                                                 │    │
│  │                                                                                      │    │
│  │  More tasks completed → More episodes stored → Richer context for future tasks →    │    │
│  │  Better task completion → More knowledge → Compound returns on experience           │    │
│  │                                                                                      │    │
│  │  [Task outcomes] ──▶ [Episode storage] ──▶ [Context retrieval] ──▶ [Task success]  │    │
│  │        ▲                                                                  │          │    │
│  │        └──────────────────────────────────────────────────────────────────┘          │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │  EMERGENT LOOP N: TRUST CALIBRATION                                                 │    │
│  │                                                                                      │    │
│  │  Agent succeeds repeatedly → Confidence increases → Less oversight needed →         │    │
│  │  More autonomy granted → Faster execution → More success (or correction if wrong)   │    │
│  │                                                                                      │    │
│  │  [Success history] ──▶ [Trust score] ──▶ [Autonomy level] ──▶ [Outcome] ──▶ [Trust]│    │
│  │        ▲                                                                    │        │    │
│  │        └────────────────────────────────────────────────────────────────────┘        │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐    │
│  │  EMERGENT LOOP O: ANTI-FRAGILITY                                                    │    │
│  │                                                                                      │    │
│  │  Errors occur → Error patterns detected → Defensive code generated → Error class    │    │
│  │  prevented → System becomes more robust over time, not despite errors but because   │    │
│  │                                                                                      │    │
│  │  [Error occurrence] ──▶ [Pattern learning] ──▶ [Prevention code] ──▶ [Robustness]  │    │
│  │        ▲                                                                   │         │    │
│  │        └───────────────────────────────────────────────────────────────────┘         │    │
│  │                                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5. CONCEPTUAL & THEORETICAL LOOPS

These are the abstract relationships that govern Wave0's behavior:

#### 5.1 SCAS Principle Feedback Loops

| Principle | Loop Description | Reinforcement Mechanism |
|-----------|------------------|-------------------------|
| **P1: Diverse Agents** | Multiple agent types → Different approaches tried → Best approaches selected → Diversity maintained | Evolution keeps diversity via mutation |
| **P2: Self-Organization** | No central task assignment → Agents claim matching tasks → Natural specialization emerges | Expertise matching self-organizes |
| **P3: Adaptability** | Environment changes → Old patterns fail → New patterns tried → Successful patterns retained | Policy weights adapt continuously |
| **P4: Emergence** | Simple rules → Complex behavior → Unexpected capabilities | Agent interactions produce novel solutions |
| **P5: Feedback Loops** | All of the above | Meta-loop: loops themselves evolve |
| **P6: Edge of Chaos** | Too stable = no learning; Too chaotic = no progress | Evolution pressure calibrated |
| **P7: Path Dependence** | Past success/failure → Current behavior shaped → Future options constrained | Episodic memory encodes history |
| **P8: Learning** | Every outcome recorded → Patterns extracted → Future improved | Continuous gradient on all dimensions |
| **P9: Homeostasis** | System health monitored → Degradation detected → Self-repair triggered | Health checks + rollback |
| **P10: Via Negativa** | Failures recorded → Anti-patterns extracted → Future failures prevented | Slop/complexity gates |
| **P11: Fitness Landscape** | Current position → Neighbors evaluated → Better direction chosen | Evolution explores landscape |
| **P12: Multi-Level Intelligence** | File → Function → Module → System → Meta-system levels | Different agents for different levels |

#### 5.2 Information Theory Loops

```
INFORMATION FLOW:
  Raw code → Embeddings → Semantic clusters → Concepts → Patterns → Predictions → Actions

COMPRESSION:
  Episode details → Episode summary → Pattern → Rule → Heuristic → Instinct

EXPANSION:
  User intent → Task tree → Subtasks → Actions → Commands → Effects
```

#### 5.3 Economic Loops

| Resource | Feedback Type | Balance Mechanism |
|----------|---------------|-------------------|
| LLM tokens | Negative (cost) | Budget limits, caching, compression |
| Agent time | Negative (cost) | Parallelism, checkpointing |
| Knowledge | Positive (value) | More knowledge → better decisions → more knowledge |
| Trust | Positive/Negative | Success builds trust, failure erodes |
| Complexity | Negative (debt) | Complexity budget hard limits |

### 6. COMPLETE WIRING INVENTORY

Every connection in Wave0, organized by layer:

#### Layer 0: Infrastructure
| Wire ID | From | To | Purpose |
|---------|------|-----|---------|
| W001 | CLI | Config loader | Load configuration |
| W002 | Config loader | Environment | Read env vars |
| W003 | Logger | File system | Write logs |
| W004 | Logger | stdout/stderr | Console output |
| W005 | Process signals | Shutdown handler | Graceful termination |

#### Layer 1: Providers
| Wire ID | From | To | Purpose |
|---------|------|-----|---------|
| W010 | Provider check | Anthropic API | LLM health |
| W011 | Provider check | OpenAI API | LLM health |
| W012 | Provider check | Embedding API | Embedding health |
| W013 | Provider status | Orchestrator | Gate startup |

#### Layer 2: Knowledge
| Wire ID | From | To | Purpose |
|---------|------|-----|---------|
| W020 | Bootstrap | File scanner | Discover files |
| W021 | File scanner | Parser | Extract symbols |
| W022 | Parser | AST analyzer | Build call graph |
| W023 | AST analyzer | Embedding API | Generate embeddings |
| W024 | Embeddings | SQLite | Store vectors |
| W025 | SQLite | Query engine | Retrieve knowledge |
| W026 | Query engine | Context assembler | Provide context |
| W027 | File watcher | Re-indexer | Update on change |
| W028 | Episode recorder | SQLite | Store episodes |
| W029 | Episode retriever | SQLite | Recall episodes |

#### Layer 3: Orchestration
| Wire ID | From | To | Purpose |
|---------|------|-----|---------|
| W030 | Workgraph | Task queue | Manage tasks |
| W031 | Task queue | Scheduler | Order tasks |
| W032 | Scheduler | LiBrainian | Get similarity |
| W033 | Scheduler | Agent pool | Request agent |
| W034 | Agent pool | Agent registry | Find capable agent |
| W035 | Agent registry | Agent instance | Lock agent |
| W036 | Agent instance | Context assembler | Get context |
| W037 | Context assembler | Agent instance | Return context |
| W038 | Workgraph | TUI | Emit progress |
| W039 | Workgraph | Quality gates | Submit for review |

#### Layer 4: Execution
| Wire ID | From | To | Purpose |
|---------|------|-----|---------|
| W040 | Agent | LLM API | Inference request |
| W041 | LLM API | Agent | Inference response |
| W042 | Agent | Policy engine | Check action |
| W043 | Policy engine | Agent | Allow/deny |
| W044 | Agent | Backend selector | Choose backend |
| W045 | Backend selector | Local backend | Local execution |
| W046 | Backend selector | Docker backend | Sandboxed execution |
| W047 | Backend | File system | I/O operations |
| W048 | Backend | Agent | Execution result |
| W049 | Agent | Checkpoint manager | Save progress |
| W050 | Checkpoint manager | File system | Write checkpoint |

#### Layer 5: Quality
| Wire ID | From | To | Purpose |
|---------|------|-----|---------|
| W060 | Quality gate | Slop reviewer | Check slop |
| W061 | Slop reviewer | LLM API | Analyze code |
| W062 | Quality gate | Complexity checker | Check complexity |
| W063 | Complexity checker | File system | Measure files |
| W064 | Quality gate | Test runner | Run tests |
| W065 | Test runner | Backend | Execute tests |
| W066 | Quality gate | HITL router | Request approval |
| W067 | HITL router | File system | Write request |
| W068 | File system | HITL router | Read response |
| W069 | HITL router | Quality gate | Return decision |

#### Layer 6: Evolution
| Wire ID | From | To | Purpose |
|---------|------|-----|---------|
| W070 | Task completion | Evolution coordinator | Report outcome |
| W071 | Evolution coordinator | Policy optimizer | Update weights |
| W072 | Policy optimizer | Policy store | Persist weights |
| W073 | Evolution coordinator | Gene pool | Update fitness |
| W074 | Gene pool | Selection | Choose parents |
| W075 | Selection | Crossover | Breed agents |
| W076 | Crossover | Mutation | Vary offspring |
| W077 | Mutation | Gene pool | Add new genomes |
| W078 | Gene pool | Agent registry | Spawn new agents |
| W079 | Evolution | Artifact store | Emit reports |

#### Layer 7: Observability
| Wire ID | From | To | Purpose |
|---------|------|-----|---------|
| W080 | All components | Trace collector | Emit spans |
| W081 | Trace collector | Storage | Persist traces |
| W082 | All components | Metric emitter | Emit metrics |
| W083 | Metric emitter | Aggregator | Collect metrics |
| W084 | Aggregator | TUI | Display metrics |
| W085 | Aggregator | File system | Persist metrics |
| W086 | Error handler | Logger | Log errors |
| W087 | Error handler | Alert system | Critical alerts |

### 7. COMPLETE SUBSYSTEM MAP

Wave0 consists of the following subsystems, each with specific responsibilities:

#### 7.1 Subsystem Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      WAVE0 COMPLETE SUBSYSTEM MAP                                        │
│                                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                                   USER INTERFACE LAYER                                           │    │
│  │                                                                                                  │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │    │
│  │  │     TUI      │  │   Web UI     │  │   CLI        │  │   API        │  │   IDE Plugin │       │    │
│  │  │  (Ink.js)    │  │  (future)    │  │  (wave0-run) │  │  (REST/WS)   │  │   (future)   │       │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘       │    │
│  │         │                │                 │                 │                  │                │    │
│  └─────────┼────────────────┼─────────────────┼─────────────────┼──────────────────┼────────────────┘    │
│            └────────────────┴─────────────────┴─────────────────┴──────────────────┘                     │
│                                              │                                                            │
│                                              ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                                   ORCHESTRATION LAYER                                            │    │
│  │                                                                                                  │    │
│  │  ┌──────────────────────────────────────────────────────────────────────────────────────────┐   │    │
│  │  │                           UNIFIED ORCHESTRATOR                                            │   │    │
│  │  │  Entry point: src/orchestrator/unified_orchestrator.ts                                    │   │    │
│  │  │  Responsibilities: Startup sequence, main loop, shutdown                                  │   │    │
│  │  │  Dependencies: All subsystems                                                             │   │    │
│  │  └──────────────────────────────────────────────────────────────────────────────────────────┘   │    │
│  │       │                     │                     │                     │                        │    │
│  │       ▼                     ▼                     ▼                     ▼                        │    │
│  │  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                    │    │
│  │  │  WORKGRAPH  │────▶│  SCHEDULER  │────▶│ AGENT POOL  │────▶│QUALITY GATE │                    │    │
│  │  │             │     │             │     │             │     │             │                    │    │
│  │  │ runner.ts   │     │ scheduler.ts│     │ agent_pool. │     │live_quality_│                    │    │
│  │  │ bus.ts      │     │(semantic)   │     │    ts       │     │ review.ts   │                    │    │
│  │  │ validator.ts│     │             │     │             │     │             │                    │    │
│  │  └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘                    │    │
│  │                                                                                                  │    │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘    │
│                                              │                                                            │
│       ┌──────────────────────────────────────┼──────────────────────────────────────┐                    │
│       │                                      │                                       │                    │
│       ▼                                      ▼                                       ▼                    │
│  ┌─────────────────────┐  ┌─────────────────────────────────────────┐  ┌─────────────────────────────┐   │
│  │   KNOWLEDGE LAYER   │  │           AGENT LAYER                   │  │      EXECUTION LAYER        │   │
│  │                     │  │                                         │  │                             │   │
│  │  ┌───────────────┐  │  │  ┌─────────────────────────────────┐   │  │  ┌───────────────────────┐  │   │
│  │  │   LiBrainian   │  │  │  │        AGENT REGISTRY           │   │  │  │   EXECUTION BACKEND  │  │   │
│  │  │               │  │  │  │                                 │   │  │  │                      │  │   │
│  │  │ index.ts      │  │  │  │  agent_registry.ts              │   │  │  │  local_backend.ts    │  │   │
│  │  │ api/          │  │  │  │  - Register agents              │   │  │  │  docker_backend.ts   │  │   │
│  │  │ storage/      │  │  │  │  - Capability matching          │   │  │  │                      │  │   │
│  │  │ agents/       │  │  │  │  - Acquire/release              │   │  │  │  Responsibilities:   │  │   │
│  │  │               │  │  │  │  - Metrics tracking             │   │  │  │  - Sandboxed exec    │  │   │
│  │  │ Provides:     │  │  │  └─────────────────────────────────┘   │  │  │  - Resource limits   │  │   │
│  │  │ - Embeddings  │  │  │                   │                    │  │  │  - Timeout handling  │  │   │
│  │  │ - Call graphs │  │  │                   ▼                    │  │  └───────────────────────┘  │   │
│  │  │ - Patterns    │  │  │  ┌─────────────────────────────────┐   │  │             │               │   │
│  │  │ - Queries     │  │  │  │        AGENT INSTANCES          │   │  │             ▼               │   │
│  │  └───────────────┘  │  │  │                                 │   │  │  ┌───────────────────────┐  │   │
│  │         │           │  │  │  ┌───────┐ ┌───────┐ ┌───────┐  │   │  │  │   POLICY ENGINE      │  │   │
│  │         ▼           │  │  │  │ Coder │ │Tester │ │Review │  │   │  │  │                      │  │   │
│  │  ┌───────────────┐  │  │  │  └───────┘ └───────┘ └───────┘  │   │  │  │  policy_engine.ts    │  │   │
│  │  │EPISODIC MEMORY│  │  │  │                                 │   │  │  │  - Security rules    │  │   │
│  │  │               │  │  │  │  Each agent has:                │   │  │  │  - Approval gates    │  │   │
│  │  │episodic_memory│  │  │  │  - Genome (capabilities)        │   │  │  │  - Resource limits   │  │   │
│  │  │      .ts      │  │  │  │  - Metrics (success rate)       │   │  │  └───────────────────────┘  │   │
│  │  │               │  │  │  │  - Context (current task)       │   │  │             │               │   │
│  │  │ Stores:       │  │  │  │  - Tools (read, write, exec)    │   │  │             ▼               │   │
│  │  │ - Episodes    │  │  │  └─────────────────────────────────┘   │  │  ┌───────────────────────┐  │   │
│  │  │ - Lessons     │  │  │                                         │  │  │   HITL ROUTER        │  │   │
│  │  │ - Outcomes    │  │  │                                         │  │  │                      │  │   │
│  │  └───────────────┘  │  │                                         │  │  │  domain_expert_      │  │   │
│  │         │           │  │                                         │  │  │    router.ts         │  │   │
│  │         ▼           │  │                                         │  │  │  - Request reviews   │  │   │
│  │  ┌───────────────┐  │  │                                         │  │  │  - Wait for human    │  │   │
│  │  │CONTEXT ASSEMBL│  │  │                                         │  │  │  - Handle timeouts   │  │   │
│  │  │               │  │  │                                         │  │  └───────────────────────┘  │   │
│  │  │context_assembl│  │  │                                         │  │             │               │   │
│  │  │    er.ts      │  │  │                                         │  │             ▼               │   │
│  │  │               │  │  │                                         │  │  ┌───────────────────────┐  │   │
│  │  │ Builds:       │  │  │                                         │  │  │   CHECKPOINT MGR     │  │   │
│  │  │ - TaskContext │  │  │                                         │  │  │                      │  │   │
│  │  │ - Query iface │  │  │                                         │  │  │  checkpoint.ts       │  │   │
│  │  └───────────────┘  │  │                                         │  │  │  - Save state        │  │   │
│  │                     │  │                                         │  │  │  - Resume tasks      │  │   │
│  └─────────────────────┘  └─────────────────────────────────────────┘  └─────────────────────────────┘   │
│                                              │                                                            │
│                                              ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                                   EVOLUTION LAYER                                                │    │
│  │                                                                                                  │    │
│  │  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐                   │    │
│  │  │  EVOLUTION COORD     │  │   POLICY OPTIMIZER   │  │   GENE POOL MGR      │                   │    │
│  │  │                      │  │                      │  │                      │                   │    │
│  │  │  evolution_          │  │  policy_optimizer.ts │  │  gene_pool_manager.  │                   │    │
│  │  │   coordinator.ts     │  │                      │  │       ts             │                   │    │
│  │  │                      │  │  - Weight updates    │  │                      │                   │    │
│  │  │  - Record outcomes   │  │  - Gradient descent  │  │  - Fitness tracking  │                   │    │
│  │  │  - Trigger evolution │  │  - Policy versioning │  │  - Selection         │                   │    │
│  │  │  - Emit artifacts    │  │                      │  │  - Crossover/mutate  │                   │    │
│  │  └──────────────────────┘  └──────────────────────┘  └──────────────────────┘                   │    │
│  │                                                                                                  │    │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘    │
│                                              │                                                            │
│                                              ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                                   INFRASTRUCTURE LAYER                                           │    │
│  │                                                                                                  │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │    │
│  │  │  PROVIDERS  │  │   STORAGE   │  │   LOGGING   │  │   CONFIG    │  │  SECURITY   │            │    │
│  │  │             │  │             │  │             │  │             │  │             │            │    │
│  │  │provider_    │  │sqlite_      │  │logger.ts    │  │canon.json   │  │git_sanit.ts │            │    │
│  │  │ check.ts    │  │ storage.ts  │  │             │  │wave0.ts     │  │             │            │    │
│  │  │             │  │             │  │             │  │             │  │             │            │    │
│  │  │- LLM health │  │- .LiBrainian/│  │- Console    │  │- Settings   │  │- Input val  │            │    │
│  │  │- Embed API  │  │- state/     │  │- File logs  │  │- Env vars   │  │- Sandboxing │            │    │
│  │  │- Fallback   │  │- checkpts   │  │- Traces     │  │- Defaults   │  │- Policies   │            │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            │    │
│  │                                                                                                  │    │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 7.2 Subsystem Catalog

| # | Subsystem | Entry Point | Responsibility | P-Fixes | State Storage |
|---|-----------|-------------|----------------|---------|---------------|
| **S01** | **Unified Orchestrator** | `src/orchestrator/unified_orchestrator.ts` | Main entry, startup, shutdown, main loop | P2, P29-31 | In-memory |
| **S02** | **Workgraph** | `src/workgraph/runner.ts` | Task DAG, dependencies, status tracking | P4, P8 | `.wave0/workgraph.json` |
| **S03** | **Scheduler** | `src/workgraph/scheduler.ts` | Task ordering, semantic grouping | P6 | In-memory |
| **S04** | **Agent Pool** | `src/orchestrator/agent_pool.ts` | Agent lifecycle, acquire/release | P9, P27 | In-memory |
| **S05** | **Agent Registry** | `src/orchestrator/agent_registry.ts` | Agent catalog, capability matching | P13, P27 | In-memory |
| **S06** | **Context Assembler** | `src/orchestrator/context_assembler.ts` | Build TaskContext from LiBrainian | P5 | None |
| **S07** | **LiBrainian Core** | `src/LiBrainian/index.ts` | Knowledge backbone, embeddings | P1, P14, P15 | `.LiBrainian/` |
| **S08** | **LiBrainian Storage** | `src/LiBrainian/storage/sqlite_storage.ts` | SQLite + vector storage | P11 | `.LiBrainian/LiBrainian.sqlite` |
| **S09** | **LiBrainian Agents** | `src/LiBrainian/agents/` | AST indexer, semantic analyzer | P1 | `.LiBrainian/` |
| **S10** | **LiBrainian API** | `src/LiBrainian/api/` | Query, bootstrap, versioning, knowledge queries | P15 | None |
| **S11** | **Episodic Memory** | `src/memory/episodic_memory.ts` | Experience storage, recall | G2 | `.LiBrainian/episodes.sqlite` |
| **S12** | **Execution Backends** | `src/spine/execution_backends/` | Local, Docker execution | P24, P10 | None |
| **S13** | **Policy Engine** | `src/spine/policy_engine.ts` | Security rules, approval gates | P25 | `config/policies.json` |
| **S14** | **Git Sanitizer** | `src/spine/git_sanitizer.ts` | Input validation for git commands | P16 | None |
| **S15** | **HITL Router** | `src/orchestrator/hitl/domain_expert_router.ts` | Human review requests | P26 | `state/audits/hitl/` |
| **S16** | **Checkpoint Manager** | `src/workgraph/checkpoint.ts` | Task state persistence | P8 | `.wave0/checkpoints/` |
| **S17** | **Quality Gate** | `src/workgraph/live_quality_review.ts` | Slop/complexity checks | P4 | `state/audits/quality_review/` |
| **S18** | **Evolution Coordinator** | `src/self_evolution/evolution_coordinator.ts` | Outcome recording, evolution trigger | P28 | `state/evolution/` |
| **S19** | **Policy Optimizer** | `src/self_evolution/policy_optimizer.ts` | Weight updates, gradient descent | P28 | `state/policies/weights.json` |
| **S20** | **Gene Pool Manager** | `src/brain/evolution/gene_pool_manager.ts` | Agent genome evolution | P28 | `state/evolution/genomes.json` |
| **S21** | **Provider Check** | `src/LiBrainian/api/provider_check.ts` | LLM/embedding health | P7 | None |
| **S22** | **Config Loader** | `src/spine/evolvable_artifacts.ts` | Settings, environment | - | `config/` |
| **S23** | **Logger** | `src/telemetry/logger.ts` | Logging infrastructure | A6 | `logs/` |
| **S24** | **TUI** | `src/interface/tui/` | Terminal user interface | G8 | In-memory |
| **S25** | **Promote Operator** | `src/autopilot/promote_operator.ts` | Promotion phases | P29 | `state/promotions/` |

#### 7.3 Subsystem Dependencies Matrix

```
                    Depends On →
              S01 S02 S03 S04 S05 S06 S07 S08 S09 S10 S11 S12 S13 S14 S15 S16 S17 S18 S19 S20 S21 S22 S23 S24 S25
            ┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
       S01  │  -  ●   ●   ●   ●   ●   ●   -   -   -   -   ●   ●   -   ●   ●   ●   ●   -   -   ●   ●   ●   ●   ●  │
       S02  │  -   -  ●   ●   -   -   -   -   -   -   -   -   -   -   -   ●   ●   -   -   -   -   -   ●   ●   -  │
       S03  │  -   -   -  ●   -   -   ●   -   -   ●   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S04  │  -   -   -   -  ●   -   -   -   -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S05  │  -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S06  │  -   -   -   -   -   -  ●   -   -   ●   ●   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S07  │  -   -   -   -   -   -   -  ●   ●   ●   -   -   -   -   -   -   -   -   -   -   ●   ●   ●   -   -  │
Provides ↓  │                                                                                                   │
       S08  │  -   -   -   -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S09  │  -   -   -   -   -   -   -   ●  -   -   -   -   -   -   -   -   -   -   -   -   ●   -   ●   -   -  │
       S10  │  -   -   -   -   -   -   -   ●  -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S11  │  -   -   -   -   -   -   -   ●  -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S12  │  -   -   -   -   -   -   -   -  -   -   -   -  ●   -   -   -   -   -   -   -   -   ●   ●   -   -  │
       S13  │  -   -   -   -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   ●   ●   -   -  │
       S14  │  -   -   -   -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S15  │  -   -   -   -   -   -   -   -  -   -   -   -   ●   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S16  │  -   -   -   -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S17  │  -   -   -   -   -   -   -   -  -   -   -   -   -   -   ●   -   -   -   -   -   ●   -   ●   -   -  │
       S18  │  -   -   -   ●   -   -   ●   -  -   -   -   -   -   -   -   -   -   -  ●   ●   -   -   ●   -   -  │
       S19  │  -   -   -   -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S20  │  -   -   -   -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S21  │  -   -   -   -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   ●   ●   -   -  │
       S22  │  -   -   -   -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S23  │  -   -   -   -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   -   -   -   -  │
       S24  │  -   ●   -   -   -   -   -   -  -   -   -   -   -   -   -   -   -   -   -   -   -   -   ●   -   -  │
       S25  │  -   ●   -   ●   -   -   ●   -  -   -   -   ●   ●   -   ●   -   ●   ●   ●   ●   -   -   ●   -   -  │
            └───────────────────────────────────────────────────────────────────────────────────────────────────┘

● = Direct dependency
```

#### 7.4 Subsystem Data Flow Paths

| Path ID | Description | Subsystems Involved | Data Type | Critical? |
|---------|-------------|---------------------|-----------|-----------|
| **DP01** | Task intake → completion | S01 → S02 → S03 → S04 → S06 → S17 → S01 | Task lifecycle | YES |
| **DP02** | Context assembly | S06 → S07 → S08 → S10 → S11 → S06 | Knowledge context | YES |
| **DP03** | Agent execution | S04 → S05 → S12 → S13 → S14 → S12 | Command execution | YES |
| **DP04** | Quality review | S17 → S21 → LLM → S17 | Code review | YES |
| **DP05** | Human review | S17 → S15 → filesystem → S15 → S17 | Approval flow | YES |
| **DP06** | Checkpoint/resume | S16 → filesystem → S16 | State persistence | YES |
| **DP07** | Evolution feedback | S01 → S18 → S19 + S20 → S05 | Fitness updates | NO |
| **DP08** | LiBrainian bootstrap | S21 → S07 → S09 → S08 → S10 | Knowledge init | YES |
| **DP09** | Semantic scheduling | S03 → S10 → S08 → S03 | Similarity scores | NO |
| **DP10** | Policy enforcement | S12 → S13 → S12 | Allow/deny | YES |

#### 7.5 Subsystem State Locations

| Subsystem | Persistent State | Location | Format |
|-----------|-----------------|----------|--------|
| S02 Workgraph | Task DAG, status | `.wave0/workgraph.json` | JSON |
| S07 LiBrainian | Embeddings, call graphs | `.LiBrainian/LiBrainian.sqlite` | SQLite |
| S08 Storage | All LiBrainian data | `.LiBrainian/` | SQLite + files |
| S11 Episodic | Episode records | `.LiBrainian/episodes.sqlite` | SQLite |
| S13 Policy | Custom rules | `config/policies.json` | JSON |
| S15 HITL | Review requests/responses | `state/audits/hitl/*.json` | JSON |
| S16 Checkpoint | Task checkpoints | `.wave0/checkpoints/*.json` | JSON |
| S17 Quality | Review reports | `state/audits/quality_review/` | JSON |
| S18 Evolution | Evolution history | `state/evolution/` | JSON |
| S19 Policy Opt | Policy weights | `state/policies/weights.json` | JSON |
| S20 Gene Pool | Agent genomes | `state/evolution/genomes.json` | JSON |

#### 7.6 Subsystem Interfaces

Each subsystem exposes specific interfaces:

```typescript
// S01: Unified Orchestrator
interface OrchestratorInterface {
  initialize(config: OrchestratorConfig): Promise<void>;
  run(task: Task): Promise<TaskResult>;
  shutdown(): Promise<void>;
  getStatus(): OrchestratorStatus;
}

// S02: Workgraph
interface WorkgraphInterface {
  addTask(task: Task): Promise<void>;
  getNext(): Promise<Task | null>;
  markComplete(taskId: string, result: TaskResult): Promise<void>;
  getStatus(): WorkgraphStatus;
}

// S03: Scheduler
interface SchedulerInterface {
  schedule(tasks: Task[]): Promise<ScheduledTask[]>;
  groupBySimilarity(tasks: Task[]): Promise<TaskGroup[]>;
}

// S04: Agent Pool
interface AgentPoolInterface {
  acquire(task: Task, context: TaskContext): Promise<Agent>;
  release(agentId: string, result: TaskResult): void;
  getStats(): PoolStats;
}

// S05: Agent Registry
interface AgentRegistryInterface {
  register(agent: AgentConfig): void;
  findByCapability(cap: AgentCapability): RegisteredAgent[];
  acquire(agentId: string): boolean;
  release(agentId: string, result: TaskResult): void;
}

// S06: Context Assembler
interface ContextAssemblerInterface {
  assemble(task: Task): Promise<TaskContext>;
}

// S07: LiBrainian
interface LibrarianInterface {
  preOrchestrationHook(options: BootstrapOptions): Promise<BootstrapResult>;
  isReady(): boolean;
  assembleContext(request: ContextRequest): Promise<LibrarianContext>;
  getSemanticSimilarity(files1: string[], files2: string[]): Promise<number>;
  query(text: string): Promise<QueryResult>;
}

// S08: Storage
interface StorageInterface {
  open(): Promise<void>;
  close(): Promise<void>;
  insert(table: string, data: Record<string, unknown>): Promise<void>;
  query(table: string, where: WhereClause): Promise<unknown[]>;
  vectorSearch(table: string, embedding: number[], limit: number): Promise<unknown[]>;
}

// S12: Execution Backend
interface ExecutionBackendInterface {
  isAvailable(): Promise<boolean>;
  execute(command: string[], options: ExecOptions): Promise<ExecResult>;
}

// S13: Policy Engine
interface PolicyEngineInterface {
  evaluate(action: string, resource: string): PolicyDecision;
  addRule(rule: PolicyRule): void;
}

// S15: HITL Router
interface HITLRouterInterface {
  requestReview(request: ReviewRequest): Promise<ReviewResponse>;
}

// S16: Checkpoint Manager
interface CheckpointManagerInterface {
  save(taskId: string, state: CheckpointState): Promise<void>;
  resume(taskId: string): Promise<ResumeResult>;
  clear(taskId: string): Promise<void>;
}

// S17: Quality Gate
interface QualityGateInterface {
  review(submission: Submission): Promise<ReviewResult>;
}

// S18: Evolution Coordinator
interface EvolutionCoordinatorInterface {
  recordOutcome(agentId: string, task: Task, result: TaskResult): Promise<void>;
  evolveGeneration(): Promise<EvolutionResult>;
}
```

#### 7.7 Subsystem Startup Order

```
STARTUP SEQUENCE (strict order required):

1. S22 (Config)      → Load configuration
2. S23 (Logger)      → Initialize logging
3. S21 (Providers)   → Check LLM/embedding availability
4. S08 (Storage)     → Open database connections
5. S07 (LiBrainian)   → Bootstrap knowledge base
6. S10 (LiBrainian API) → Initialize query interfaces
7. S11 (Episodic)    → Load episode store
8. S13 (Policy)      → Load policy rules
9. S12 (Backends)    → Initialize execution backends
10. S05 (Registry)   → Register agent types
11. S04 (Pool)       → Initialize agent pool
12. S06 (Context)    → Initialize context assembler
13. S03 (Scheduler)  → Initialize scheduler
14. S02 (Workgraph)  → Load or create workgraph
15. S16 (Checkpoint) → Check for resume candidates
16. S17 (Quality)    → Initialize quality gates
17. S15 (HITL)       → Initialize HITL router
18. S18-20 (Evolution) → Initialize evolution subsystems
19. S24 (TUI)        → Start user interface
20. S01 (Orchestrator) → Start main loop
```

### 8. LOOP HEALTH MONITORING

For Wave0 to be a healthy SCAS, these loops must function:

| Loop | Health Indicator | Warning Sign | Failure Mode |
|------|------------------|--------------|--------------|
| Task-Level (A) | Episodes accumulating | No new episodes | Memory not writing |
| Agent Evolution (B) | Fitness variance | Fitness converged | Evolution stuck |
| Policy Optimization (C) | Weight changes | Weights static | No learning |
| Knowledge Enrichment (D) | Index growing | Index stale | Re-indexing broken |
| Anti-Pattern (E) | Slop rate decreasing | Slop rate steady | Not learning from mistakes |
| Slop Detection (F) | Rejections occurring | No rejections | Gate bypassed |
| Complexity Budget (G) | Budget enforced | Budget ignored | Gate disabled |
| Security Policy (H) | Blocks occurring | No blocks | Policy not checked |
| Human Oversight (I) | Reviews requested | No reviews | Router broken |
| Specialization (J) | Agent diversity | All same | Matching broken |
| Coherence (K) | Style consistency | Style divergence | Patterns not extracted |
| Complexity Equilibrium (L) | Complexity stable | Complexity growing | Budget too high |
| Knowledge Density (M) | Context quality | Context sparse | Retrieval broken |
| Trust Calibration (N) | Autonomy varying | Autonomy static | Trust not updating |
| Anti-Fragility (O) | Error rate decreasing | Error rate stable | Not learning from errors |

---


---

**Next**: [fixes-critical.md](./fixes-critical.md) - P1-P15 fix instructions
