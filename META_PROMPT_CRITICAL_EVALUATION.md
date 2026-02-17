# Meta Prompt: LiBrainian Critical Evaluation Orchestrator

> **Purpose**: This meta prompt instructs an AI agent to orchestrate comprehensive, critical evaluation of LiBrainian's actual functionality and usability for AI agents across ALL use cases.
>
> **Key Proof**: Successful bootstrap and active indexing of LiBrainian ON ITSELF, with demonstrable utility during LiBrainian development.

---

## Orchestrator Mission Statement

You are the **LiBrainian Critical Evaluation Orchestrator**. Your mission is to ruthlessly and honestly evaluate whether LiBrainian actually helps AI agents perform software engineering tasks better than working without it.

**Core Hypothesis to Test**: "LiBrainian provides meaningful, measurable value to AI agents working on codebases."

**Falsification Mindset**: You MUST actively try to disprove this hypothesis. Document every failure, limitation, and disappointment. Success claims require extraordinary evidence.

---

## Phase 0: Self-Bootstrap Proof (BLOCKING)

**This phase MUST complete successfully before any other evaluation work.**

### Work Unit: WU-EVAL-001 — Bootstrap LiBrainian on LiBrainian

**Objective**: Prove LiBrainian can bootstrap its own codebase and provide useful context.

```bash
# Execute in LiBrainian workspace
cd /path/to/LiBrainian

# Clean slate (remove any existing index)
rm -rf .LiBrainian/ LiBrainian.db*

# Bootstrap with timing
time LiBrainian bootstrap --force

# Verify non-trivial indexing
LiBrainian status
LiBrainian health --completeness
```

**Success Criteria**:
- [ ] Bootstrap completes without error
- [ ] Files indexed > 100 (LiBrainian has ~200+ source files)
- [ ] Functions indexed > 500
- [ ] Context packs generated > 100
- [ ] Time to bootstrap < 5 minutes on standard hardware
- [ ] No embedding provider errors (or graceful offline fallback)

**Failure Actions**:
1. If bootstrap fails, document the EXACT error
2. Attempt `LiBrainian doctor` to diagnose
3. Try `LiBrainian bootstrap --offline` as fallback
4. If still failing, THIS IS A CRITICAL FINDING — document and abort further evaluation

### Work Unit: WU-EVAL-002 — Self-Query Validation

**Objective**: Query LiBrainian about itself and verify response quality.

**Test Queries**:
```bash
# Query 1: High-level architecture
LiBrainian query "What is the architecture of the query pipeline?"

# Query 2: Specific implementation detail
LiBrainian query "How does confidence scoring work?"

# Query 3: Cross-cutting concern
LiBrainian query "How does the bootstrap process interact with storage?"

# Query 4: Debugging scenario
LiBrainian query "I'm getting SQLITE_BUSY errors, what causes this?"

# Query 5: Feature location
LiBrainian query "Where is the embedding provider selection logic?"
```

**Evaluation Rubric for Each Query**:
| Criterion | Weight | Score (0-10) |
|-----------|--------|--------------|
| Response contains relevant file paths | 20% | |
| Response contains relevant function names | 20% | |
| Response provides actionable context | 25% | |
| Response is factually accurate (verify manually) | 25% | |
| Response includes confidence indicators | 10% | |

**Minimum Passing Score**: 6.0 average across all queries

---

## Phase 1: Sub-Agent Work Unit Decomposition

### Architecture: Parallel Evaluation Streams

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (Main Agent)                     │
│  - Spawns sub-agents for parallel evaluation                     │
│  - Aggregates findings into unified report                       │
│  - Maintains active index during entire evaluation               │
└─────────────────────────────────────────────────────────────────┘
           │           │           │           │
           ▼           ▼           ▼           ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Stream A │ │ Stream B │ │ Stream C │ │ Stream D │
    │ Bootstrap│ │ Query    │ │ Use Case │ │ Active   │
    │ Scenarios│ │ Quality  │ │ Coverage │ │ Indexing │
    └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

---

## Phase 2: Stream A — Bootstrap Scenario Evaluation

### WU-EVAL-A01: Fresh Repository Bootstrap

**Sub-Agent Prompt**:
```
You are evaluating LiBrainian's bootstrap behavior on a FRESH repository.

Tasks:
1. Create a minimal TypeScript project (5-10 files)
2. Run `LiBrainian bootstrap` and record:
   - Time to completion
   - Files indexed count
   - Functions indexed count
   - Any errors or warnings
3. Query the fresh index for basic information
4. Rate the experience 1-10 with detailed justification

CRITICAL: Document ANY friction, confusion, or failures honestly.
```

### WU-EVAL-A02: Large Repository Bootstrap

**Sub-Agent Prompt**:
```
You are evaluating LiBrainian's bootstrap on LARGE repositories.

Test repositories (pick 2):
- LiBrainian itself (~200 files)
- A cloned OSS repo with 500+ files

Measure:
1. Bootstrap time (wall clock)
2. Memory usage (if observable)
3. Error rate
4. Index completeness (files indexed / total files)
5. Query response time after bootstrap

CRITICAL: Find the breaking point. At what size does LiBrainian degrade?
```

### WU-EVAL-A03: Incremental Re-Index

**Sub-Agent Prompt**:
```
You are evaluating LiBrainian's incremental indexing capabilities.

Test scenario:
1. Bootstrap a project fully
2. Modify 3 files (add functions, change implementations)
3. Run `LiBrainian index --force <modified-files>`
4. Verify the index reflects changes
5. Measure incremental update time vs full re-bootstrap

Expected: Incremental << Full bootstrap time
Document: Actual ratio and any inconsistencies
```

### WU-EVAL-A04: Recovery from Corruption

**Sub-Agent Prompt**:
```
You are evaluating LiBrainian's robustness to index corruption.

Test scenarios:
1. Kill bootstrap mid-process → Can it resume?
2. Delete half of .LiBrainian/ → What happens?
3. Corrupt LiBrainian.db manually → Does `LiBrainian doctor` detect it?
4. Run concurrent bootstraps → Database locking behavior?

Document: Every failure mode and whether recovery is possible.
```

---

## Phase 3: Stream B — Query Quality Evaluation

### WU-EVAL-B01: Precision/Recall Measurement

**Sub-Agent Prompt**:
```
You are measuring LiBrainian's query precision and recall.

Methodology:
1. For 10 queries with KNOWN correct answers:
   - Record LiBrainian's returned files/functions
   - Compare against ground truth (manual inspection)
   - Calculate: Precision = correct_returned / total_returned
   - Calculate: Recall = correct_returned / total_correct

Query categories:
- Function lookup (3 queries)
- Cross-file dependency (2 queries)
- Pattern matching (2 queries)
- Error diagnosis (2 queries)
- Architecture understanding (1 query)

Target: Precision > 0.7, Recall > 0.5
```

### WU-EVAL-B02: Context Depth Levels

**Sub-Agent Prompt**:
```
You are evaluating LiBrainian's context depth levels (L0-L3).

For each depth level, run the SAME 5 queries and document:
- Response length (tokens)
- Relevant information included
- Irrelevant noise included
- Actionability score (1-10)

Test: Does higher depth actually provide more useful context?
Anti-test: Does higher depth just add noise?
```

### WU-EVAL-B03: Hallucination Detection

**Sub-Agent Prompt**:
```
You are hunting for hallucinations in LiBrainian's responses.

Method:
1. Query for non-existent functions/files
2. Query with intentionally wrong assumptions
3. Query edge cases (empty files, binary files, etc.)

Document:
- Does LiBrainian confidently return wrong information?
- Does it appropriately indicate uncertainty?
- Does it refuse to answer when it shouldn't know?

CRITICAL: Any hallucination is a serious finding.
```

### WU-EVAL-B04: Response Time Performance

**Sub-Agent Prompt**:
```
You are benchmarking LiBrainian query performance.

Test matrix:
| Query Complexity | Index Size | Expected Time | Actual Time |
|-----------------|------------|---------------|-------------|
| Simple lookup   | Small      | < 500ms       |             |
| Simple lookup   | Large      | < 1s          |             |
| Complex graph   | Small      | < 2s          |             |
| Complex graph   | Large      | < 5s          |             |

Document: Any queries that exceed 10 seconds.
```

---

## Phase 4: Stream C — Use Case Coverage Evaluation

### Master Use Case Matrix

Every use case must be evaluated with a Treatment (with LiBrainian) vs Control (without LiBrainian) comparison.

| Use Case ID | Description | Agent Task | Success Metric |
|-------------|-------------|------------|----------------|
| UC-001 | Code navigation | Find where X is defined | Time to locate |
| UC-002 | Bug diagnosis | Given error, find root cause | Accuracy |
| UC-003 | Feature addition | Add new functionality | Code quality |
| UC-004 | Refactoring | Rename/move with dependencies | Completeness |
| UC-005 | Test writing | Write tests for function X | Coverage achieved |
| UC-006 | Code review | Review PR for issues | Issues found |
| UC-007 | Documentation | Explain module purpose | Accuracy |
| UC-008 | Dependency analysis | What depends on X | Completeness |
| UC-009 | Security audit | Find vulnerabilities | Findings rate |
| UC-010 | Performance | Find bottlenecks | Actionable findings |
| UC-011 | Onboarding | Understand new codebase | Time to first PR |
| UC-012 | Architecture | Design new feature | Adherence to patterns |

### WU-EVAL-C01: Code Navigation (UC-001)

**Sub-Agent Prompt**:
```
You are evaluating LiBrainian's code navigation support.

Scenario: "Find where the bootstrapProject function is defined and all its callers"

WITH LiBrainian:
1. Run: LiBrainian query "Where is bootstrapProject defined and what calls it?"
2. Use the response to navigate to files
3. Record: Time taken, accuracy of response, missed callers

WITHOUT LiBrainian:
1. Use grep/ripgrep: rg "bootstrapProject" --type ts
2. Manually trace call graph
3. Record: Time taken, completeness

Compare: Which approach is faster AND more complete?
```

### WU-EVAL-C02: Bug Diagnosis (UC-002)

**Sub-Agent Prompt**:
```
You are evaluating LiBrainian's bug diagnosis support.

Scenario: "TypeError: Cannot read property 'embeddings' of undefined at line 234 in query.ts"

WITH LiBrainian:
1. Query: "What provides embeddings to the query pipeline and how can it be undefined?"
2. Use response to form hypothesis
3. Record: Time to hypothesis, accuracy

WITHOUT LiBrainian:
1. Read query.ts manually
2. Trace data flow
3. Record: Time to hypothesis, accuracy

Compare: Quality of diagnostic reasoning
```

### WU-EVAL-C03: Feature Addition (UC-003)

**Sub-Agent Prompt**:
```
You are evaluating LiBrainian's support for adding new features.

Scenario: "Add a new CLI command 'LiBrainian export' that exports the index to JSON"

WITH LiBrainian:
1. Query: "How are CLI commands structured? Show me examples."
2. Query: "What data is stored in the index that I need to export?"
3. Implement the feature
4. Record: Time, code quality, pattern adherence

WITHOUT LiBrainian:
1. Explore src/cli/ manually
2. Read existing commands
3. Implement the feature
4. Record: Time, code quality, pattern adherence

Compare: Did LiBrainian reduce time? Improve code quality?
```

### WU-EVAL-C04-C12: Remaining Use Cases

**Orchestrator Instruction**: Spawn parallel sub-agents for each remaining use case following the same Treatment/Control pattern.

---

## Phase 5: Stream D — Active Indexing Evaluation

### WU-EVAL-D01: Watch Mode Validation

**Sub-Agent Prompt**:
```
You are evaluating LiBrainian's file watching and auto-reindex.

Test:
1. Start `LiBrainian watch` in background
2. Create a new file with new functions
3. Modify an existing file
4. Delete a file
5. Query for the new/modified/deleted content

Verify:
- New content is discoverable within 30 seconds
- Modified content reflects changes
- Deleted content is no longer returned
- No stale data lingers

Document: Any synchronization failures or delays.
```

### WU-EVAL-D02: Concurrent Agent Workload

**Sub-Agent Prompt**:
```
You are evaluating LiBrainian under concurrent agent workload.

Simulate:
1. Agent A is querying continuously (1 query/second)
2. Agent B is modifying files (1 file/10 seconds)
3. Agent C is running bootstrap refresh (1/minute)

Run for 5 minutes, measure:
- Query success rate
- Query latency distribution
- Database lock errors
- Index consistency

Target: 99% query success, <2s latency p99
```

### WU-EVAL-D03: Self-Development Scenario

**Critical Proof Point**: Can LiBrainian help an agent work on LiBrainian itself?

**Sub-Agent Prompt**:
```
You are an AI agent tasked with improving LiBrainian, using LiBrainian.

Task: "Add better error messages to the bootstrap command"

Workflow:
1. Bootstrap LiBrainian on itself (if not done)
2. Query: "Where is error handling in bootstrap? Show me current error messages."
3. Identify improvement opportunities
4. Make changes to error messages
5. Run `LiBrainian index --force <modified-files>` to update index
6. Query again to verify changes are reflected
7. Run tests to ensure no regression

Document:
- Did LiBrainian help you find the right files faster?
- Did the index update correctly after your changes?
- Rate the dogfooding experience 1-10
```

---

## Phase 6: Synthesis and Reporting

### WU-EVAL-SYNTHESIS: Aggregate Findings

**Orchestrator Task**: Aggregate all sub-agent findings into unified report.

```markdown
# LiBrainian Critical Evaluation Report

## Executive Summary
- Overall Utility Score: X/10
- Recommendation: [USE / USE WITH CAVEATS / DO NOT USE]
- Key Strengths: [List]
- Critical Weaknesses: [List]

## Phase Results

### Phase 0: Self-Bootstrap
- Status: [PASS/FAIL]
- Evidence: [Link to logs]

### Stream A: Bootstrap Scenarios
- Fresh repo: [Score]
- Large repo: [Score]
- Incremental: [Score]
- Recovery: [Score]

### Stream B: Query Quality
- Precision: [X%]
- Recall: [X%]
- Hallucination rate: [X%]
- Avg response time: [Xms]

### Stream C: Use Case Coverage
| Use Case | Treatment Score | Control Score | Delta |
|----------|-----------------|---------------|-------|
| UC-001   |                 |               |       |
...

### Stream D: Active Indexing
- Watch mode: [WORKS/BROKEN]
- Concurrent load: [STABLE/DEGRADES]
- Self-development: [USEFUL/NOT USEFUL]

## Detailed Findings
[All sub-agent reports appended here]

## Recommendations
1. [Specific improvement]
2. [Specific improvement]
...
```

---

## Orchestrator Execution Rules

### Rule 1: Never Stop on Blockers
If any evaluation work unit encounters a blocker:
1. Document the blocker as a FINDING
2. Attempt workaround
3. Continue to next work unit
4. Include blocker in final report

### Rule 2: Parallel Execution
Launch sub-agents for independent work units in parallel:
- Stream A, B, C, D can run concurrently
- Within each stream, work units with dependencies must be sequential

### Rule 3: Evidence Requirements
Every claim must have evidence:
- "Bootstrap works" → Show timing logs
- "Query is accurate" → Show query/response/verification
- "Performance is good" → Show latency measurements

### Rule 4: Active Indexing Maintenance
Throughout evaluation, keep LiBrainian's index of itself updated:
```bash
# Run in background during all evaluation
LiBrainian watch &

# Or manually after any code changes
LiBrainian index --force <changed-files>
```

### Rule 5: Falsification Priority
Actively seek disconfirming evidence:
- If something works, try to break it
- If performance is good, find the edge case where it degrades
- If accuracy is high, find the query type where it fails

---

## Sub-Agent Spawning Protocol

When spawning sub-agents, use this template:

```typescript
// Orchestrator spawns sub-agent with:
const subAgentPrompt = {
  workUnitId: 'WU-EVAL-XXX',
  objective: 'Specific objective from work unit',
  inputs: {
    workspace: '/path/to/LiBrainian',
    librarianAvailable: true, // false for Control group
    timeLimit: '30 minutes',
  },
  outputs: {
    required: ['score', 'evidence', 'findings'],
    format: 'markdown',
  },
  constraints: [
    'Document all commands executed',
    'Record all errors encountered',
    'Be honest about failures',
  ],
};
```

---

## Continuous Improvement Loop

After completing evaluation:

1. **Feed Findings Back**:
   - Create GitHub issues for each critical finding
   - Update AGENTS.md with discovered limitations

2. **Re-Evaluate After Fixes**:
   - When fixes are merged, re-run affected work units
   - Track improvement over time

3. **Expand Use Cases**:
   - Add new use cases as agents discover new patterns
   - Remove use cases that become obsolete

---

## Final Instruction to Orchestrator

**BEGIN EVALUATION NOW.**

Start with Phase 0 (Self-Bootstrap Proof). If it passes, spawn sub-agents for Phases 2-5 in parallel. Synthesize results into the final report.

Your evaluation is only valuable if it is HONEST. A report that says "LiBrainian is perfect" is useless. A report that documents specific failures and suggests specific improvements is invaluable.

**Execute with extreme prejudice against false positives.**
