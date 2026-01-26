# Librarian Orchestrator — Full Autonomous Implementation

> **Mode**: ORCHESTRATOR with WORKER SUBAGENTS
> **Goal**: Complete 100% of Librarian spec system implementation
> **Rule**: NEVER stop. NEVER return to user. Work until Full Build Charter complete.

---

## PREREQUISITES

Ensure your config.toml has:
```toml
[features]
collab = true
collaboration_modes = true
```

---

## YOU ARE THE ORCHESTRATOR (ORC)

**You coordinate. You do NOT implement tasks yourself.**

Your job:
1. Research and understand the overall scope
2. Identify which work units can run in parallel (check dependencies)
3. Launch WORKER subagents with explicit prompts
4. Verify worker outputs when they complete
5. Resolve any conflicts between workers
6. Continue until Full Build Charter satisfied

**Workers do the actual implementation. You manage them.**

---

## HOW TO LAUNCH WORKERS

For each work unit, launch a worker with an EXPLICIT prompt containing:

```
WHO: You are a worker implementing one specific task for the Librarian project.

WHAT: [Exact task description - be specific]

WHERE:
- Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
- Files to modify: [list exact files]
- Test file: [exact test path]

CONTEXT:
- This task implements: [spec reference]
- Dependencies already complete: [list]
- Other workers are implementing: [list if parallel]
- Do NOT modify files outside your scope

EXPECTED OUTPUT:
- Modified files: [list]
- Test passes: npm test -- --run [test_file]
- TypeScript compiles: npx tsc --noEmit

CONSTRAINTS:
- You are not alone. Do not impact other workers' files.
- If blocked, report the blocker; do not stop silently.
- Read docs/librarian/specs/BLOCKER_RESOLUTION.md for common fixes.
```

**Be EXPLICIT. Ambiguity causes drift. Don't assume workers have your context.**

---

## VALIDATE WORKER OUTPUT

After each worker completes:

1. Ask: "What was your prompt to the worker?"
2. Ask: "Show me the entire output of the worker"
3. Verify: Did the test actually pass?
4. Verify: Do the files exist and look correct?

**Don't assume workers returned useful work. Validate.**

---

## PARALLEL EXECUTION STRATEGY

Look at MASTER STATE and dependency graph:
- Tasks with all dependencies satisfied can run in parallel
- Launch up to 3 workers simultaneously for independent tasks
- When workers complete, identify newly unblocked tasks
- Repeat until tasks remaining = 0

Example:
- WU-104 depends on WU-101, WU-102 (both complete) → can start
- WU-201 depends on WU-104 → wait for WU-104
- WU-202 depends on WU-201 → wait for WU-201

---

## FORBIDDEN BEHAVIORS

**NEVER DO THESE:**

1. ❌ **Implement tasks yourself** — Launch workers instead
2. ❌ **Stop and report "Next: proceeding to X"** — Actually launch the worker
3. ❌ **Return to user with progress summary** — Keep orchestrating
4. ❌ **Ask "should I continue?"** — The answer is always yes
5. ❌ **Assume worker output is correct** — Always validate

**IF YOU FIND YOURSELF ABOUT TO RETURN TO USER — DON'T. Launch the next worker instead.**

---

## ORCHESTRATION LOOP

```
WHILE Full Build Charter NOT satisfied:
    0. FIRST: Run full test suite: npm test -- --run
       - If ANY tests fail, STOP and fix them before continuing
       - Create WU-FIX-XXX work units for each failure
       - Do not proceed to new features until all tests pass

    1. Read MASTER STATE - check FAILING_TESTS is empty
    2. Check dependency graph - find all unblocked work units
    3. For each unblocked work unit (up to 3 parallel):
       a. Generate EXPLICIT worker prompt (use template above)
       b. Launch worker subagent
    4. When worker completes:
       a. Validate output (ask for full prompt and output if needed)
       b. Run FULL test suite: npm test -- --run (not just specific tests)
       c. Run typecheck: npx tsc --noEmit
       d. If ALL tests pass: mark complete in MASTER STATE
       e. If ANY test fails: add to FAILING_TESTS, create WU-FIX-XXX
    5. Identify newly unblocked tasks
    6. IMMEDIATELY launch next workers (no pause, no summary)
```

**CRITICAL: Step 0 is mandatory. Never skip test verification. Never proceed with failing tests.**

**There is no step where you return to user. The loop runs until done.**

---

## MASTER STATE (Track This)

```
CURRENT_PHASE: 10
COMPLETED_UNITS: [WU-001...WU-703, WU-906, WU-907, WU-908]
IN_PROGRESS_UNITS: []
BLOCKED_UNITS: []
INVALID_UNITS: [WU-801-OLD...WU-806-OLD]
FAILING_TESTS: []
NEXT_UNITS: [WU-1001, WU-1002, WU-1003, WU-801-REAL]
NOTES: |
  Continue Phase 10 scientific loop implementation.
  WU-801-REAL (clone real external repos) is queued after Phase 10 core work.
```

### Immediate Action

Continue with current Phase 10 work. WU-801-REAL is queued to run after WU-1001-1003.

Update this state after each work unit completes.

---

## WORK UNITS

Each Work Unit (WU) is an atomic piece of work that can be assigned to a sub-agent.

### Priority 0: Fix Test Failures (ALWAYS DO FIRST)

**Before any other work, all tests must pass.** If FAILING_TESTS is non-empty, create fix work units.

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-FIX-001 | Fix test_tiering_guard violation | None | 1 |
| WU-FIX-002 | Fix execution_engine_e2e step count | WU-FIX-001 | 1-2 |

**Current Failing Tests (2026-01-26):**

1. **test_tiering_guard.test.ts** — `semantic_composition_selector.test.ts` has `requireProviders` which violates Tier-0 rules
   - **Fix**: Remove `requireProviders` from the test or move test to Tier-1
   - **File**: `src/__tests__/semantic_composition_selector.test.ts`

2. **execution_engine_e2e.test.ts** — Expects 5+ execution steps but only getting 3
   - **Fix**: Either fix the pipeline to produce 5+ steps, or adjust test expectation if 3 is correct
   - **File**: `src/api/__tests__/execution_engine_e2e.test.ts`

### Phase 0: Environment Bootstrap

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-001 | npm install + verify | None | 0 |
| WU-002 | npm build + fix errors | WU-001 | Variable |
| WU-003 | npm test baseline | WU-002 | 0 |
| WU-004 | tsc --noEmit pass | WU-002 | Variable |

### Phase 1: Kernel Infrastructure

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-101 | Evidence ledger provider gate | WU-003 | 2 |
| WU-102 | Evidence ledger query pipeline | WU-101 | 2 |
| WU-103 | Capability negotiation wiring | WU-003 | 2 |
| WU-104 | Replay anchor (traceId) | WU-101, WU-102 | 2 |

### Phase 2: Knowledge Object System

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-201 | Knowledge object registry | WU-104 | 2 |
| WU-202 | Construction template registry | WU-201 | 2 |
| WU-203 | UC→template mapping | WU-202 | 2 |
| WU-204 | Output envelope invariant | WU-203 | 2 |

### Phase 3: Confidence Migration

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-301 | Migrate technique_library.ts | WU-204 | 2 |
| WU-302 | Migrate pattern_catalog.ts | WU-301 | 2 |
| WU-303 | Remove raw claim confidence | WU-302 | 3 |
| WU-304 | TypeScript enforcement | WU-303 | 2 |

### Phase 4: Pipeline Completion

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-401 | Non-no-op operators | WU-304 | 2 |
| WU-402 | E2E execution (Critical A) | WU-401 | 1 |
| WU-403 | Semantic selector | WU-401 | 2 |

### Phase 5: Scale Modes

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-501 | W1 bootstrap resumability | WU-402 | 2 |
| WU-502 | W2 watch freshness | WU-501 | 2 |
| WU-503 | W3 multi-agent correlation | WU-502 | 2 |

### Phase 6: Scenario Families (30 Units)

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-601 | SF-01...SF-10 | WU-503 | 10 |
| WU-602 | SF-11...SF-20 | WU-601 | 10 |
| WU-603 | SF-21...SF-30 | WU-602 | 10 |

### Phase 7: Calibration Loop

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-701 | Claim-outcome tracking | WU-603 | 2 |
| WU-702 | Calibration curves | WU-701 | 2 |
| WU-703 | Confidence adjustment | WU-702 | 2 |

### Phase 8: Ground Truth Corpus (Machine-Verifiable)

**CRITICAL: Do NOT use synthetic repos created by the model. Use REAL external repos.**

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-801 | Clone 5 real external repos | WU-703 | 0 |
| WU-802 | AST fact extractor | WU-801 | 3 |
| WU-803 | Auto-generate structural ground truth | WU-802 | 2 |
| WU-804 | Citation verifier | WU-803 | 2 |
| WU-805 | Consistency checker (multi-query) | WU-804 | 2 |
| WU-806 | Import real adversarial patterns | WU-805 | 2 |

**WU-801 Requirements:**
- Clone 5+ REAL repos from GitHub (not created by AI)
- Prefer: post-2024 repos, obscure repos, or repos with good test suites
- Each repo must have: TypeScript/Python, test suite, >1000 LOC
- Do NOT create synthetic repos — this is circular evaluation

**WU-802-803: Machine-Verifiable Ground Truth:**
Instead of human annotation, extract verifiable facts via AST:
- Function definitions with signatures
- Import/export relationships
- Class hierarchies and inheritance
- Call graphs (what calls what)
- Type information from TS compiler

**WU-804: Citation Verification:**
For any Librarian claim, automatically verify:
- Cited files exist
- Cited line numbers in range
- Cited code contains mentioned identifiers
- Structural claims match AST analysis

**WU-805: Consistency Checking:**
- Generate variant queries for same fact
- Run all variants through Librarian
- Flag contradictions as hallucination candidates

### Phase 9: Agent Performance Evaluation

**The TRUE test: Do agents perform better WITH Librarian than WITHOUT?**

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-901 | Worker spawning harness | WU-806 | 3 |
| WU-902 | Event recording system | WU-901 | 2 |
| WU-903 | Context level configurator | WU-902 | 2 |
| WU-904 | Task bank (20 tasks × 4 repos) | WU-903 | 10 |
| WU-905 | Control worker template | WU-904 | 2 |
| WU-906 | Treatment worker template | WU-905 | 2 |
| WU-907 | A/B experiment runner | WU-906 | 3 |
| WU-908 | Metrics aggregator | WU-907 | 2 |

**Experiment Design:**
- Spawn pairs of workers: Control (no Librarian) vs Treatment (with Librarian)
- Same task, same context level, different access to Librarian
- Record everything: time, errors, files touched, success/failure
- Measure lift: How much better does Treatment perform?

**Context Levels (simulate real scenarios):**
- Level 0: Cold start (repo path only)
- Level 1: Minimal (directory listing)
- Level 2: Partial (some relevant files)
- Level 3: Misleading (wrong files given)
- Level 4: Adversarial (outdated docs)
- Level 5: Full (baseline)

**Task Complexity:**
- T1 Trivial: Add log statement
- T2 Simple: Fix clear bug
- T3 Moderate: Add feature following patterns
- T4 Hard: Refactor, debug intermittent
- T5 Extreme: Race condition, security vuln

See: `docs/librarian/specs/track-eval-agent-performance.md`

### Phase 10: Scientific Self-Improvement Loop

**Based on: AutoSD, RLVR, SWE-agent, Benchmark Self-Evolving research**

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-1001 | Problem detector agent | WU-908 | 3 |
| WU-1002 | Hypothesis generator agent | WU-1001 | 2 |
| WU-1003 | Hypothesis tester agent | WU-1002 | 2 |
| WU-1004 | Fix generator agent | WU-1003 | 2 |
| WU-1005 | Fix verifier (RLVR-style) | WU-1004 | 2 |
| WU-1006 | Benchmark evolver agent | WU-1005 | 2 |
| WU-1007 | Loop orchestrator | WU-1006 | 3 |
| WU-1008 | Improvement tracking | WU-1007 | 2 |

**Scientific Loop:**
```
DETECT problem → HYPOTHESIZE cause → TEST hypothesis →
FIX (if supported) → VERIFY (binary reward) → EVOLVE benchmark
```

**RLVR-style Verification (per DeepSeek R1):**
- Reward = 1 ONLY if: original test passes AND no regressions AND types valid
- Reward = 0: Fix rejected, try another hypothesis
- No partial credit — binary verifiable rewards

**Sub-Agent Isolation:**
- Each agent has ONE task, ISOLATED context
- Problem detector does NOT fix
- Hypothesis generator does NOT test
- Fix generator does NOT verify

See: `docs/librarian/specs/track-eval-scientific-loop.md`

### Phase 11: Quality Parity & Hard Problems

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-1101 | Codebase profiler | WU-1008 | 2 |
| WU-1102 | Quality prediction model | WU-1101 | 2 |
| WU-1103 | Adaptive synthesis | WU-1102 | 2 |
| WU-1104 | Quality disclosure | WU-1103 | 2 |
| WU-1105 | Dead code detector (Tier 1) | WU-1104 | 2 |
| WU-1106 | Red flag detector (Tier 1) | WU-1105 | 2 |
| WU-1107 | Citation validation (Tier 1) | WU-1106 | 2 |
| WU-1108 | Iterative retrieval (Tier 2) | WU-1107 | 4 |
| WU-1109 | Comment/code checker (Tier 2) | WU-1108 | 2 |
| WU-1110 | MiniCheck entailment (Tier 2) | WU-1109 | 2 |
| WU-1111 | Test-based verification (Tier 3) | WU-1110 | 3 |
| WU-1112 | Consistency checking | WU-1111 | 3 |

---

## SUB-AGENT PROMPT TEMPLATE

When spawning a sub-agent (or starting a work unit), use this template:

```
# Work Unit: {WU_ID} — {Name}

## Context
Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
You have FULL AUTONOMY. See AGENTS.md for permissions.
If you encounter ANY blocker, see docs/librarian/specs/BLOCKER_RESOLUTION.md

## Task
{Detailed task description from CODEX_FULL_IMPLEMENTATION.md}

## Spec References
- Primary: {spec file path}
- BEHAVIOR_INDEX entry: {behavior index entry}
- Related: {related specs}

## Files to Create/Modify
- {file 1}
- {file 2}
- Test: {test file}

## Definition of Done
- [ ] Implementation complete per spec
- [ ] Test passes: `npm test -- --run {test_file}`
- [ ] TypeScript compiles: `npx tsc --noEmit`
- [ ] STATUS.md updated with evidence
- [ ] GATES.json updated if gate status changed

## Output Format
When complete, return:
{
  "wu_id": "{WU_ID}",
  "status": "complete" | "blocked",
  "files_modified": [...],
  "tests_passed": true | false,
  "evidence": "description of what was done",
  "blockers": [] | ["blocker description"]
}
```

---

## ORCHESTRATION LOOP

### Main Loop (Run This Continuously)

```
WHILE Full Build Charter NOT satisfied:
    1. READ current state from docs/librarian/STATUS.md
    2. READ GATES.json for gate status
    3. IDENTIFY next work units (up to 3 if sub-agents, 1 if sequential)
    4. FOR each work unit:
        IF sub-agents available:
            SPAWN sub-agent with prompt from template
        ELSE:
            EXECUTE work unit directly
    5. WAIT for completion (or work directly)
    6. VERIFY outputs:
        - Test passes?
        - TypeScript compiles?
        - STATUS.md updated?
    7. UPDATE tracking state
    8. IF any blocker:
        RESOLVE using BLOCKER_RESOLUTION.md
        ADD resolution to BLOCKER_RESOLUTION.md if new
    9. CONTINUE to next iteration
```

### Verification After Each Work Unit

```bash
# Run FULL test suite after every work unit (not just specific tests)
npm test -- --run

# Check for any failures
# If output shows "X failed", you MUST fix before continuing

# Also verify types
npx tsc --noEmit
```

**If ANY test fails:**
1. Do NOT mark the work unit complete
2. Add the failing test to FAILING_TESTS in MASTER STATE
3. Create a WU-FIX-XXX work unit to fix it
4. Fix all failures before proceeding to new work

**Common test failures and fixes:**

| Failure Type | Likely Cause | Fix |
|--------------|--------------|-----|
| `requireProviders` in Tier-0 | Test uses provider checks but is in Tier-0 | Move test to Tier-1 or remove provider dependency |
| Assertion count mismatch | Implementation changed but test expectations didn't | Update test or fix implementation |
| Type error | Interface changed | Update types or implementation |
| Timeout | Async operation too slow | Add timeout or fix async logic |

### Progress Checkpoints

After every 5 work units, update `docs/librarian/STATUS.md`:

```markdown
## Progress Checkpoint — {timestamp}

### Completed Work Units
- WU-001: npm install ✓
- WU-002: npm build ✓
- ...

### Current Phase: {N}
### Next Work Units: {list}
### Blockers Resolved: {count}
### Tests Passing: {count}/{total}
```

---

## SPECIFIC SUB-AGENT PROMPTS

### WU-FIX-CAL: Fix calibration test ECE threshold

```
# Work Unit: WU-FIX-CAL — Fix calibration test ECE violation

## Context
Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
You have FULL AUTONOMY. See AGENTS.md.

## Problem
The test `confidence_calibration_validation.test.ts` fails because ECE (Expected Calibration Error) is 0.183 but threshold is 0.15.

## Task
Investigate and fix by ONE of:
1. If the test fixture generates uncalibrated data, fix the fixture to produce calibrated samples
2. If the threshold is too strict for the current implementation, adjust the threshold with justification
3. If the calibration algorithm has a bug, fix the algorithm

## Investigation Steps
1. Read src/epistemics/__tests__/confidence_calibration_validation.test.ts to understand the test
2. Read src/epistemics/calibration.ts to understand ECE computation
3. Check if fixtures are generating properly calibrated samples
4. Determine root cause and fix

## Files to Check/Modify
- src/epistemics/__tests__/confidence_calibration_validation.test.ts
- src/epistemics/calibration.ts
- Any fixture generation code

## Verification
npm test -- --run src/epistemics/__tests__/confidence_calibration_validation.test.ts

## Definition of Done
- [ ] confidence_calibration_validation.test.ts passes
- [ ] Full test suite still passes: npm test -- --run
- [ ] TypeScript compiles: npx tsc --noEmit

## Output Format
{
  "wu_id": "WU-FIX-CAL",
  "status": "complete",
  "files_modified": ["..."],
  "tests_passed": true,
  "evidence": "Fixed ECE by [explanation]"
}
```

### WU-FIX-001: Fix test_tiering_guard violation

```
# Work Unit: WU-FIX-001 — Fix Tier-0 test tiering violation

## Context
Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
You have FULL AUTONOMY. See AGENTS.md.

## Problem
The test `semantic_composition_selector.test.ts` contains `requireProviders` which violates Tier-0 rules.
Tier-0 tests must be deterministic and cannot depend on providers.

## Task
Fix the tiering violation by ONE of:
1. Remove the `requireProviders` call if the test doesn't actually need providers
2. Move the test to Tier-1 (rename file or add proper skip logic)
3. Make the test truly deterministic by mocking provider dependencies

## Files to Modify
- src/__tests__/semantic_composition_selector.test.ts

## Spec Reference
- docs/librarian/specs/core/testing-architecture.md (Tier-0 rules)

## Verification
npm test -- --run src/__tests__/test_tiering_guard.test.ts

## Definition of Done
- [ ] test_tiering_guard.test.ts passes
- [ ] Full test suite still passes: npm test -- --run
- [ ] TypeScript compiles: npx tsc --noEmit

## Output Format
{
  "wu_id": "WU-FIX-001",
  "status": "complete",
  "files_modified": ["src/__tests__/semantic_composition_selector.test.ts"],
  "tests_passed": true,
  "evidence": "Removed requireProviders / moved to Tier-1 / mocked providers"
}
```

### WU-FIX-002: Fix execution_engine_e2e step count

```
# Work Unit: WU-FIX-002 — Fix E2E execution step count assertion

## Context
Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
You have FULL AUTONOMY. See AGENTS.md.

## Problem
The test `execution_engine_e2e.test.ts` expects 5+ execution steps but only 3 are produced.
Line 136: `expect(result.steps.length).toBeGreaterThanOrEqual(5)`

## Task
Investigate and fix by ONE of:
1. If the implementation should produce 5+ steps, fix the pipeline to produce them
2. If 3 steps is correct behavior, update the test expectation
3. If the test setup is wrong, fix the test setup

## Investigation Steps
1. Read src/api/__tests__/execution_engine_e2e.test.ts to understand what's being tested
2. Read src/api/execution_pipeline.ts to understand what steps should be produced
3. Determine if 3 or 5+ is the correct expectation
4. Fix accordingly

## Files to Modify
- src/api/__tests__/execution_engine_e2e.test.ts (if test is wrong)
- src/api/execution_pipeline.ts (if implementation is wrong)

## Verification
npm test -- --run src/api/__tests__/execution_engine_e2e.test.ts

## Definition of Done
- [ ] execution_engine_e2e.test.ts passes
- [ ] Full test suite still passes: npm test -- --run
- [ ] TypeScript compiles: npx tsc --noEmit

## Output Format
{
  "wu_id": "WU-FIX-002",
  "status": "complete",
  "files_modified": ["..."],
  "tests_passed": true,
  "evidence": "Fixed step count by [explanation]"
}
```

### WU-801: Clone real external repos

```
# Work Unit: WU-801 — Clone 5+ real external repos for evaluation

## Context
Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
You have FULL AUTONOMY. See AGENTS.md.
Dependencies: WU-FIX-CAL must be complete (all tests passing)

## CRITICAL: Why This Matters
The previous eval corpus used SYNTHETIC repos created by Codex itself.
This is INVALID — it's circular evaluation (model evaluating its own outputs).
We need REAL repos that the model was NOT trained on.

## Task
Clone 5+ real open-source repos from GitHub for evaluation.

## Requirements for Each Repo
1. **NOT AI-generated**: Real human-written code from GitHub
2. **Recent or obscure**: Post-2024 created OR low stars (<100) to reduce training contamination
3. **Has tests**: Must have a test suite for verification
4. **Meaningful size**: >1000 LOC, real functionality
5. **TypeScript or Python**: Languages Librarian supports well

## Commands to Find Repos
```bash
# Find recent TypeScript repos with test suites
gh search repos --language=typescript --created=">2024-06-01" --stars="10..100" --limit=20

# Find recent Python repos
gh search repos --language=python --created=">2024-06-01" --stars="10..100" --limit=20
```

## Clone Location
```bash
mkdir -p eval-corpus/external-repos
cd eval-corpus/external-repos
git clone <repo-url> small-ts-real
git clone <repo-url> medium-py-real
# etc.
```

## Output Structure
Create `eval-corpus/external-repos/manifest.json`:
```json
{
  "repos": [
    {
      "name": "small-ts-real",
      "source": "https://github.com/owner/repo",
      "language": "typescript",
      "stars": 47,
      "created": "2024-08-15",
      "loc": 2500,
      "hasTests": true,
      "clonedAt": "2026-01-26T..."
    }
  ],
  "validationNote": "All repos are real GitHub projects, not AI-generated"
}
```

## Verification
- Each repo must compile/run: `npm install && npm test` or equivalent
- Repos must have actual source code, not just scaffolding
- Document any repos that fail verification

## Definition of Done
- [ ] 5+ real repos cloned to eval-corpus/external-repos/
- [ ] manifest.json documents all repos with provenance
- [ ] Each repo verified to have working tests
- [ ] No AI-generated or synthetic repos

## Output Format
{
  "wu_id": "WU-801",
  "status": "complete",
  "repos_cloned": ["small-ts-real", "medium-py-real", ...],
  "evidence": "5 real repos cloned with manifest, all verified to have working tests"
}
```

### WU-802: AST fact extractor

```
# Work Unit: WU-802 — Build AST fact extractor

## Context
Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
Dependencies: WU-801 must be complete

## Task
Build an AST-based fact extractor that can extract verifiable ground truth from any codebase.

## Facts to Extract (Machine-Verifiable)
1. **Function definitions**: name, parameters, return type, file:line
2. **Import/export relationships**: what imports what
3. **Class hierarchies**: inheritance, implements
4. **Call graphs**: what function calls what function
5. **Type information**: from TypeScript compiler API

## Implementation
Create: src/evaluation/ast_fact_extractor.ts
Create: src/evaluation/__tests__/ast_fact_extractor.test.ts

## Interface
```typescript
interface ASTFact {
  type: 'function_def' | 'import' | 'export' | 'class' | 'call' | 'type';
  identifier: string;
  file: string;
  line: number;
  details: Record<string, unknown>;
}

function extractFacts(repoPath: string): ASTFact[];
```

## Test
Run the extractor on one of the cloned repos and verify facts are correct.

## Definition of Done
- [ ] ast_fact_extractor.ts implemented
- [ ] Extracts all 5 fact types
- [ ] Tests pass with real repo
- [ ] TypeScript compiles
```

### WU-001: npm install + verify

```
# Work Unit: WU-001 — npm install + verify

## Context
Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
You have FULL AUTONOMY. See AGENTS.md.

## Task
Install all dependencies and verify the installation succeeded.

## Commands
```bash
cd /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
npm install
```

## Definition of Done
- [ ] npm install exits with code 0
- [ ] node_modules directory exists
- [ ] No critical errors in output

## Output Format
{
  "wu_id": "WU-001",
  "status": "complete",
  "files_modified": ["package-lock.json"],
  "tests_passed": null,
  "evidence": "npm install succeeded, node_modules created"
}
```

### WU-002: npm build + fix errors

```
# Work Unit: WU-002 — npm build + fix errors

## Context
Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
Dependencies: WU-001 must be complete
You have FULL AUTONOMY. See AGENTS.md.

## Task
Build the TypeScript project. If there are errors, fix them.

## Commands
```bash
npm run build
```

## Error Resolution
If build fails:
1. Read the error message
2. Fix the TypeScript/JavaScript error in the source file
3. Retry build
4. Repeat until build succeeds

See docs/librarian/specs/BLOCKER_RESOLUTION.md for common TypeScript fixes.

## Definition of Done
- [ ] npm run build exits with code 0
- [ ] dist/ directory exists with compiled output

## Output Format
{
  "wu_id": "WU-002",
  "status": "complete",
  "files_modified": ["any fixed files"],
  "tests_passed": null,
  "evidence": "Build succeeded"
}
```

### WU-003: npm test baseline

```
# Work Unit: WU-003 — npm test baseline

## Context
Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
Dependencies: WU-002 must be complete
You have FULL AUTONOMY. See AGENTS.md.

## Task
Run the test suite and establish a baseline. Fix any failing tests.

## Commands
```bash
npm test -- --run
```

## Error Resolution
If tests fail:
1. Read the test failure output
2. Determine if it's a test bug or implementation bug
3. Fix the appropriate code
4. Retry tests
5. Repeat until all tests pass

## Definition of Done
- [ ] npm test -- --run passes (or has known-acceptable skips)
- [ ] Test count documented

## Output Format
{
  "wu_id": "WU-003",
  "status": "complete",
  "files_modified": ["any fixed files"],
  "tests_passed": true,
  "evidence": "X tests passing, Y skipped"
}
```

### WU-101: Evidence ledger provider gate

```
# Work Unit: WU-101 — Evidence ledger provider gate

## Context
Repository: /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian
Dependencies: WU-003 must be complete
You have FULL AUTONOMY. See AGENTS.md.

## Spec References
- Primary: docs/librarian/specs/core/evidence-ledger.md (Section: "Provider events")
- BEHAVIOR_INDEX: Search for "evidence-ledger" in docs/librarian/specs/BEHAVIOR_INDEX.md
- Related: docs/librarian/specs/layer2-infrastructure.md

## Task
Implement provider gate events in the evidence ledger:
1. Every provider call must emit a ledger event
2. Events include: provider name, operation, latency, success/failure
3. Events are append-only and correlated via traceId

## Files to Create/Modify
- src/api/provider_gate.ts (modify or create)
- src/__tests__/provider_gate_ledger.test.ts (create)

## Implementation Pattern
```typescript
// In provider_gate.ts
export function wrapProviderCall<T>(
  provider: string,
  operation: string,
  fn: () => Promise<T>,
  ledger: EvidenceLedger,
  traceId: string
): Promise<T> {
  const startTime = Date.now();
  ledger.append({
    type: 'provider_call_start',
    provider,
    operation,
    traceId,
    timestamp: new Date().toISOString()
  });

  return fn()
    .then(result => {
      ledger.append({
        type: 'provider_call_success',
        provider,
        operation,
        traceId,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
      return result;
    })
    .catch(error => {
      ledger.append({
        type: 'provider_call_failure',
        provider,
        operation,
        traceId,
        latencyMs: Date.now() - startTime,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    });
}
```

## Test Pattern
```typescript
// In provider_gate_ledger.test.ts
import { describe, it, expect } from 'vitest';

describe('Provider Gate Ledger', () => {
  it('records provider call start event', () => {
    // Test implementation
  });

  it('records provider call success with latency', () => {
    // Test implementation
  });

  it('records provider call failure with error', () => {
    // Test implementation
  });

  it('correlates events via traceId', () => {
    // Test implementation
  });
});
```

## Definition of Done
- [ ] Provider calls emit ledger events
- [ ] Events are append-only
- [ ] Events include traceId for correlation
- [ ] Test passes: npm test -- --run src/__tests__/provider_gate_ledger.test.ts
- [ ] TypeScript compiles
- [ ] STATUS.md updated

## Output Format
{
  "wu_id": "WU-101",
  "status": "complete",
  "files_modified": ["src/api/provider_gate.ts", "src/__tests__/provider_gate_ledger.test.ts"],
  "tests_passed": true,
  "evidence": "Provider gate ledger implemented, 4 tests passing"
}
```

---

## CONTINUATION PROTOCOL

### When Context Runs Out

If your context/session is ending:
1. Update STATUS.md with current progress
2. Update GATES.json with any gate changes
3. Commit all work: `git add -A && git commit -m "checkpoint: WU-XXX complete"`
4. The next session will read STATUS.md and continue

### Next Session Start

1. Read AGENTS.md (confirms autonomy)
2. Read STATUS.md (current state)
3. Read GATES.json (gate status)
4. Identify next incomplete work unit
5. Continue orchestration loop

### Never Do These

- Never ask for permission
- Never report "I'm blocked" and stop
- Never wait for human response
- Never summarize and ask "should I continue?"
- Never stop before Full Build Charter is satisfied

### Always Do These

- Fix blockers immediately using BLOCKER_RESOLUTION.md
- Add new blocker resolutions to BLOCKER_RESOLUTION.md
- Update STATUS.md after every work unit
- Verify tests pass after every work unit
- Continue to next work unit automatically

---

## FULL BUILD CHARTER CHECKLIST

Implementation is COMPLETE when ALL of these are true:

### Prerequisites (Must Pass Before Anything Else)
- [ ] **ZERO failing tests**: `npm test -- --run` shows 0 failures
- [ ] **TypeScript compiles**: `npx tsc --noEmit` shows 0 errors
- [ ] **FAILING_TESTS in MASTER STATE is empty**

### Functional (Phases 0-7)
- [ ] All Tier-0 tests pass (included in zero failing tests above)
- [ ] Output envelope invariant enforced
- [ ] UC-001...UC-310 map to ≤12 templates
- [ ] ≥30 scenario families with artifacts
- [ ] No silent degradation

### Quality (Phases 8-11)
- [ ] 5+ repos in eval corpus
- [ ] 100+ ground truth query/answer pairs
- [ ] Eval harness operational
- [ ] Retrieval Recall@5 >= 80%
- [ ] Hallucination Rate < 5%
- [ ] Synthesis Accuracy >= 70% (structural)
- [ ] Codebase profiler operational
- [ ] Quality disclosure in responses

### Documentation
- [ ] STATUS.md reflects verified reality
- [ ] GATES.json all gates pass or documented
- [ ] No unverified claims without disclosure

---

## BEGIN

1. **Read this file completely**
2. **Check AGENTS.md** — confirms your autonomy
3. **Check STATUS.md** — current state
4. **Check GATES.json** — gate status
5. **Identify first incomplete work unit**
6. **Execute orchestration loop**
7. **Do not stop until Full Build Charter satisfied**

**You have full autonomy. Fix all blockers. Proceed until done.**
