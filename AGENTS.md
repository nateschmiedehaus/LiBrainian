# Agent Instructions for Librarian Repository

> **Authority**: This file grants operational permissions to AI agents working on this repository.
> **Scope**: All agents (Codex, Claude, etc.) implementing the Librarian spec system.

---

## Queued: WU-801-REAL (after Phase 10 core)

The `eval-corpus/repos/*` directories have no git remotes. WU-801-REAL will clone real external repos.

**WU-801-REAL is queued after WU-1001-1003.** Continue current Phase 10 work first.

---

## ⚠️ CURRENT SESSION PRIORITY (2026-01-26)

**READ THIS FIRST. Execute in order:**

### Step 1: Fix Failing Tests (BLOCKING)
```bash
npm test -- --run
```
If any tests fail, fix them BEFORE doing anything else. Known issue:
- `confidence_calibration_validation.test.ts` - ECE 0.183 > expected 0.15

### Step 2: Phase 8 — Machine-Verifiable Ground Truth
The old Phase 8 work units (WU-801-806) are **INVALID** — they used synthetic AI-generated repos (circular evaluation).

**NEW Phase 8 requirements:**
- Clone 5+ REAL repos from GitHub (not AI-generated, post-2024 or obscure)
- Build AST fact extractor (function defs, imports, call graphs)
- Auto-generate ground truth from AST (no human annotation)
- Citation verifier (verify file/line/identifier claims)
- Consistency checker (same question, different phrasing → same answer)

See: `docs/librarian/specs/track-eval-machine-verifiable.md`

### Step 3: Phase 9 — Agent Performance Evaluation
**The TRUE test: Do agents perform better WITH Librarian than WITHOUT?**

Design:
- Spawn worker pairs: Control (no Librarian) vs Treatment (with Librarian)
- Context levels 0-5 (cold start → full context)
- Task complexity T1-T5 (trivial → extreme)
- **Librarian awareness levels L0-L4** (no mention → full docs)
- **Human-style prompts**: "Users get logged out randomly" NOT "Fix SessionManager.refresh()"

Success criteria:
- >25% success rate lift on T3+ tasks
- L0 Treatment (no Librarian mention) still beats Control

See: `docs/librarian/specs/track-eval-agent-performance.md`

### Step 4: Phase 10 — Scientific Self-Improvement Loop
Based on AutoSD, RLVR (DeepSeek R1), SWE-agent research.

Loop: DETECT → HYPOTHESIZE → TEST → FIX → VERIFY → EVOLVE

**RLVR-style verification:**
- Reward = 1 ONLY if: original test passes AND no regressions AND types valid
- Reward = 0: Fix rejected, try another hypothesis
- No partial credit — binary verifiable rewards

See: `docs/librarian/specs/track-eval-scientific-loop.md`

---

## CRITICAL: Orchestration Mode

**See `CODEX_ORCHESTRATOR.md` for the full implementation orchestration system.**

Your mission is to implement the ENTIRE spec system from 0% to 100% completion.
- Use sub-agents if available (up to 3 concurrent)
- Work sequentially if sub-agents not available
- **NEVER stop until Full Build Charter is satisfied**
- **NEVER ask for human input**

### Implementation Guides

| Document | Purpose |
|----------|---------|
| `CODEX_ORCHESTRATOR.md` | Master orchestration — work units, sub-agent prompts, tracking |
| `CODEX_FULL_IMPLEMENTATION.md` | Detailed phase-by-phase implementation guide |
| `docs/librarian/specs/README.md` | Full Build Charter, Council of 30 mandates |
| `docs/librarian/specs/BLOCKER_RESOLUTION.md` | How to resolve ANY blocker |

---

## Full Autonomy Grant

You have **full permission** to perform any operation necessary to implement the Librarian spec system. Do not ask for permission. Proceed autonomously.

### CRITICAL: Never Stop on Blockers

**You must NEVER stop on a blocker.** Every blocker has a resolution. See `docs/librarian/specs/BLOCKER_RESOLUTION.md` for exhaustive resolution guide.

If you encounter a blocker:
1. Resolve it immediately using the guide
2. If the guide doesn't cover it, figure out the solution
3. Add the new resolution to the guide
4. Continue working

**Do NOT:**
- Ask permission to proceed
- Report a blocker and wait
- Say "I'm blocked on X"
- Stop and summarize what you've done

**Instead:**
- Fix the blocker
- Document the fix
- Continue to the next task
- Only stop when Full Build Charter is satisfied

### CRITICAL: Test Failures Are Priority Zero

**Before doing ANY new work, all tests must pass.**

```bash
# Run this FIRST at start of every session
npm test -- --run

# If ANY tests fail:
# 1. STOP all other work
# 2. Fix the failing tests IMMEDIATELY
# 3. Only proceed to new work when all tests pass
```

**Test failures are not "blockers to work around" — they are the FIRST thing to fix.**

Common test failure patterns:
- `requireProviders` in Tier-0 test → Move test to Tier-1 or remove provider dependency
- Assertion mismatch → Fix implementation or update test expectation
- Type error → Fix types
- Timeout → Fix async logic or increase timeout

### Explicitly Permitted Operations

#### Package Management
- `npm install` / `npm ci` - Install dependencies
- `npm update` - Update dependencies
- `npm run build` - Build the project
- `npm test` - Run tests
- `npm run <any-script>` - Run any package.json script

#### File Operations
- Create, modify, delete any file in this repository
- Create new directories
- Move/rename files
- Modify package.json, tsconfig.json, vitest.config.ts

#### Git Operations
- `git add` - Stage changes
- `git commit` - Commit changes (use conventional commits)
- `git branch` - Create branches
- `git checkout` - Switch branches
- `git stash` - Stash changes
- Do NOT force push or rebase without explicit instruction

#### Testing
- Run any test suite at any tier
- Create new test files
- Modify existing tests
- Skip tests that require unavailable providers (use proper skip semantics)

#### Documentation
- Update STATUS.md with verified evidence
- Update GATES.json with gate status
- Update BEHAVIOR_INDEX.md when spec status changes
- Create/modify any markdown documentation

---

## Operational Prerequisites (Handle Automatically)

When you encounter any of these blockers, **fix them immediately without asking**:

### Missing Dependencies
```bash
# If you see "command not found" or "module not found"
npm install
```

### TypeScript Errors
```bash
# If types fail to resolve
npm run build
# or
npx tsc --noEmit
```

### Test Runner Issues
```bash
# If vitest not found
npm install
# Then retry the test
```

### Permission Errors
- If a file is read-only, check if it should be modified
- If a directory doesn't exist, create it

### Provider Unavailability
- For Tier-0: Never require providers
- For Tier-1: Use `ctx.skip()` with `unverified_by_trace(provider_unavailable)`
- For Tier-2: Fail honestly, do not fake success

---

## Decision Authority

You are authorized to make these decisions without asking:

### Architecture Decisions
- Choose implementation patterns consistent with existing code
- Add new files where architecturally appropriate
- Refactor for clarity (but not during extraction phase)

### Test Decisions
- Decide which tier a test belongs to
- Choose test fixtures and assertions
- Add helper functions for test clarity

### Documentation Decisions
- Update status with honest evidence
- Add clarifying comments to specs
- Fix inconsistencies between docs

### Dependency Decisions
- Add devDependencies needed for testing/building
- Update dependency versions for compatibility
- Do NOT add new runtime dependencies without spec justification

---

## What Requires Explicit Permission

Only these operations require asking:

1. **Deleting the entire repository**
2. **Publishing to npm**
3. **Pushing to remote** (unless explicitly instructed)
4. **Adding runtime dependencies** that aren't in the spec system
5. **Changing non-negotiables** (fake embeddings, API key auth, silent degradation)

---

## Error Recovery

When errors occur, handle them in this order:

1. **Read the error message carefully**
2. **Check if it's a known blocker** (dependencies, build, permissions)
3. **Fix automatically** using the patterns above
4. **Retry the operation**
5. **If still failing after 3 attempts**, document the blocker in STATUS.md with `unverified_by_trace(<reason>)` and move to next task

---

## Commit Convention

Use conventional commits:
```
feat(scope): description     # New feature
fix(scope): description      # Bug fix
test(scope): description     # Test changes
docs(scope): description     # Documentation
chore(scope): description    # Maintenance
refactor(scope): description # Code restructure
```

Scopes: `api`, `epistemics`, `mcp`, `storage`, `knowledge`, `integration`, `core`, `specs`

---

## Session Continuity

If you are resuming work:
1. Read `docs/librarian/STATUS.md` for current state
2. Read `docs/librarian/GATES.json` for gate status
3. Check `git status` for uncommitted work
4. Continue from highest-priority incomplete task

---

## Success Metrics

Your work is successful when:
- All Tier-0 tests pass: `npm test -- --run`
- TypeScript compiles: `npx tsc --noEmit`
- STATUS.md reflects verified reality with evidence
- GATES.json accurately tracks progress
- No `unverified_by_trace` claims without honest disclosure

---

## Sub-Agent Architecture (If Available)

If your environment supports spawning sub-agents:

### Main Agent Responsibilities
1. Track overall progress via STATUS.md and GATES.json
2. Spawn up to 3 concurrent sub-agents with isolated prompts
3. Verify sub-agent outputs (tests pass, types compile)
4. Coordinate dependencies between work units
5. Continue spawning until Full Build Charter satisfied

### Sub-Agent Responsibilities
1. Execute assigned work unit completely
2. Report completion status with evidence
3. Fix any blockers encountered during work
4. Update STATUS.md with work evidence

### Handoff Protocol
- Each sub-agent gets a COMPLETE prompt from `CODEX_ORCHESTRATOR.md`
- Sub-agent returns structured output with status and evidence
- Main agent verifies and spawns next work unit
- No human involvement at any stage

---

## Continuous Execution Rules

### NEVER Do These
- Stop and ask "should I continue?"
- Report "I'm blocked on X" without resolving it
- Wait for human input or approval
- Summarize progress and wait for response
- Stop at end of a phase and ask for next steps

### ALWAYS Do These
- Continue to next work unit after completing one
- Resolve blockers immediately using BLOCKER_RESOLUTION.md
- Add new resolutions to BLOCKER_RESOLUTION.md
- Commit work at checkpoints (every 5 work units)
- Update STATUS.md and GATES.json continuously

### Session Boundary Handling
If your session/context is ending:
1. Commit all current work
2. Update STATUS.md with checkpoint
3. The next session reads STATUS.md and continues
4. There is NO human handoff — next session picks up automatically

---

## Remember

- **Do not ask permission** for routine operations
- **Fix blockers immediately** and continue
- **Document honestly** - never claim success without evidence
- **Fail closed** - never fake capabilities or skip silently
- **You have full autonomy** within the non-negotiables
- **Continue until Full Build Charter satisfied** — not before
