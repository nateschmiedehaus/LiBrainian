# Librarian Orchestrator — Full Autonomous Implementation

> **Mode**: MASTER ORCHESTRATOR — coordinate sub-agents OR work sequentially
> **Goal**: Complete 100% of Librarian spec system implementation
> **Rule**: NEVER stop. NEVER ask permission. NEVER wait for human input.

---

## ORCHESTRATION MODEL

### If Sub-Agents Available

1. **You are the MAIN AGENT** — you coordinate, you delegate, you track
2. **Spawn up to 3 SUB-AGENTS at a time** — each with isolated context
3. **Each sub-agent gets a COMPLETE PROMPT** from the Sub-Agent Prompts section
4. **When sub-agent completes** — verify its work, update tracking, spawn next
5. **Continue until ALL work units complete**

### If Sub-Agents NOT Available

1. **Work sequentially through each work unit**
2. **Each work unit is self-contained** — treat it as if you're a fresh agent
3. **After completing a work unit** — update tracking, proceed to next
4. **Do not stop between work units** — continuous execution

---

## MASTER STATE (Track This)

```
CURRENT_PHASE: 1
COMPLETED_UNITS: [WU-001, WU-002, WU-003, WU-004, WU-101, WU-102, WU-103]
IN_PROGRESS_UNITS: []
BLOCKED_UNITS: []
NEXT_UNITS: [WU-104, WU-201, WU-202]
```

Update this state after each work unit completes.

---

## WORK UNITS

Each Work Unit (WU) is an atomic piece of work that can be assigned to a sub-agent.

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

### Phase 8: Ground Truth Corpus

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-801 | Eval corpus structure | WU-703 | 5 |
| WU-802 | Ground truth schema | WU-801 | 2 |
| WU-803 | Annotate small TypeScript repo | WU-802 | 3 |
| WU-804 | Annotate medium repos | WU-803 | 4 |
| WU-805 | Adversarial repo | WU-804 | 2 |
| WU-806 | 200+ query/answer pairs | WU-805 | 10+ |

### Phase 9: Automated Evaluation Harness

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-901 | Eval runner | WU-806 | 2 |
| WU-902 | Retrieval metrics | WU-901 | 2 |
| WU-903 | Synthesis metrics | WU-902 | 2 |
| WU-904 | Hallucination detection | WU-903 | 2 |
| WU-905 | Citation accuracy | WU-904 | 2 |
| WU-906 | Quality dashboard | WU-905 | 2 |
| WU-907 | CI integration | WU-906 | 2 |
| WU-908 | Regression detection | WU-907 | 2 |

### Phase 10: Outcome Collection & Calibration

| WU ID | Name | Dependencies | Est. Files |
|-------|------|--------------|------------|
| WU-1001 | Claim ID infrastructure | WU-908 | 2 |
| WU-1002 | Outcome collection API | WU-1001 | 2 |
| WU-1003 | Agent feedback integration | WU-1002 | 2 |
| WU-1004 | Human correction interface | WU-1003 | 2 |
| WU-1005 | Contradiction detector | WU-1004 | 2 |
| WU-1006 | ECE computation | WU-1005 | 2 |
| WU-1007 | Calibration curve computation | WU-1006 | 2 |
| WU-1008 | Confidence adjustment | WU-1007 | 2 |

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
# Run these after every work unit
npm test -- --run
npx tsc --noEmit
```

If either fails, FIX IT before moving on.

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

### Functional (Phases 0-7)
- [ ] All Tier-0 tests pass
- [ ] TypeScript compiles without errors
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
