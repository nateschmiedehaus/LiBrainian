# START IMPLEMENTATION

**Give this entire file to Codex to begin fully autonomous implementation.**

---

## Your Mission

Implement the complete LiBrainian spec system from current state to 100% completion.

**Repository**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian`

---

## Step 1: Read These Files (In Order)

```
1. AGENTS.md                  — Your permissions (FULL AUTONOMY)
2. CODEX_ORCHESTRATOR.md      — Work units and sub-agent architecture
3. CODEX_FULL_IMPLEMENTATION.md — Detailed implementation phases
4. docs/LiBrainian/STATUS.md   — Current progress state
5. docs/LiBrainian/GATES.json  — Gate status
```

---

## Step 2: Check Current State and Fix Any Failures

```bash
cd /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian
npm install    # Ensure dependencies
npm test -- --run   # Check baseline — MUST HAVE 0 FAILURES
npx tsc --noEmit    # Check types — MUST HAVE 0 ERRORS
```

**CRITICAL: If ANY tests fail, fix them BEFORE doing anything else.**

Check CODEX_ORCHESTRATOR.md for FAILING_TESTS in MASTER STATE. If non-empty:
1. Fix those tests first (WU-FIX-XXX work units)
2. Run full test suite again
3. Only proceed when all tests pass

---

## Step 3: Begin Orchestration Loop

1. **FIRST**: Verify all tests pass (`npm test -- --run` shows 0 failures)
2. Check CODEX_ORCHESTRATOR.md MASTER STATE for FAILING_TESTS
3. If FAILING_TESTS is non-empty: fix them first (Priority 0)
4. Identify the next incomplete work unit
5. If sub-agents available: spawn up to 3 concurrent sub-agents
6. If sequential: execute work units one by one
7. After each work unit:
   - Run FULL test suite (not just specific tests)
   - Verify: ALL tests pass, types compile
   - Update: STATUS.md, GATES.json, MASTER STATE
   - Continue: next work unit
8. **Do not stop until Full Build Charter is satisfied**

---

## Critical Rules

**NEVER:**
- Ask for permission or human input
- Stop on a blocker (see `docs/LiBrainian/specs/BLOCKER_RESOLUTION.md`)
- Wait between work units
- Summarize and ask "should I continue?"
- Proceed to new work when tests are failing
- Mark a work unit complete if full test suite doesn't pass

**ALWAYS:**
- Fix test failures FIRST (Priority 0)
- Run FULL test suite after every work unit
- Fix blockers immediately
- Continue to next work unit automatically
- Update tracking after every work unit
- Work until Full Build Charter is complete

---

## Full Build Charter (Definition of Done)

See `docs/LiBrainian/specs/README.md` for complete charter. Key gates:

- All Tier-0 tests pass
- TypeScript compiles
- UC-001...UC-310 map to ≤12 templates
- ≥30 scenario families
- Retrieval Recall >= 80%
- Hallucination Rate < 5%
- STATUS.md reflects verified reality

---

## Begin Now

Read the files listed above and start the orchestration loop.

**You have full autonomy. No permission needed. Continue until done.**
