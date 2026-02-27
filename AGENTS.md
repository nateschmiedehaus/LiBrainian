# Agent Instructions for LiBrainian Repository

> **Authority**: This file grants operational permissions to AI agents working on this repository.
> **Scope**: All agents (Codex, Claude, etc.) implementing the LiBrainian spec system.

---

## Using LiBrainian (READ THIS FIRST)

**LiBrainian is AUTOMATIC.** You do not need to configure anything. Just use it.

### Programmatic Usage (Recommended)

```typescript
import { initializeLibrarian } from 'librainian';

// All you need - LiBrainian handles everything else
const lib = await initializeLibrarian(workspace);
const context = await lib.query(intent);
```

That's it. LiBrainian automatically:
- **Auto-bootstraps** if the workspace hasn't been indexed yet
- **Auto-configures** with optimal settings for your codebase
- **Auto-selects quality tier** (always uses 'full' for best results)
- **Auto-enables constructables** (patterns, relationships, architectural context)
- **Provides documentation AND code context** in every response

### CLI Quick Reference

```bash
LiBrainian status          # Check if LiBrainian is ready for this workspace
LiBrainian query "intent"  # Get context for any coding intent/question
LiBrainian health          # Check system health and index status
```

### What You Get Back

When you call `lib.query(intent)`, you receive:
- **Relevant code snippets** with file paths and line numbers
- **Function signatures** and their relationships
- **Architectural context** explaining how components connect
- **Documentation excerpts** when available
- **Pattern matches** for common coding tasks

### Do NOT Worry About

- Configuration files - LiBrainian configures itself
- Index management - LiBrainian auto-indexes and watches for changes
- Quality tiers - LiBrainian always uses maximum quality
- Provider setup - LiBrainian handles embedding providers automatically
- Caching - LiBrainian caches intelligently without your intervention

**Just query. LiBrainian handles the rest.**

---

## Natural Usage Heuristics (Issue #833)

Dogfooding means agents choose LiBrainian because it is the fastest path to better decisions, not because a wrapper command forced it.

- Use LiBrainian when uncertainty is high: dependency ownership unclear, cross-file impact unknown, architecture intent ambiguous, or test impact uncertain.
- Skip LiBrainian for trivial deterministic edits: straightforward rename, obvious typo, single-line constant updates with no dependency risk.
- Prefer one direct query over repeated speculative queries; query again only when new uncertainty appears.
- Record per-task decision changes in `decision_trace.md` for release evidence runs.

### Natural-language intent examples

- Bug triage: `LiBrainian query "Users get logged out randomly after idle time"`  
- Feature location: `LiBrainian query "Where should I add retry budget enforcement for API calls?"`  
- Refactor safety: `LiBrainian query "What could break if I split query cache helpers from src/api/query.ts?"`  
- Test impact: `LiBrainian query "What tests should change if I modify bootstrap quality gate warnings?"`

For qualification evidence, pair these with the natural-usage matrix artifacts in:
- `docs/librarian/evals/dogfood/m0_qualitative_protocol.md`

---

## Launch-Critical Non-Negotiables (Override)

These rules override any softer guidance elsewhere in this file for qualification and publish work:

1. **REAL_AGENT_REAL_LIBRARIAN_ONLY**
   - Qualification and release evidence must come from real agent sessions operating on the real LiBrainian repository.
   - Synthetic fixtures, mocks, and reference harness workers are diagnostic-only and cannot satisfy release gates.
2. **NO_RETRY_NO_FALLBACK_NO_DEGRADED_FOR_RELEASE**
   - Any fallback, retry, degraded, unavailable, skipped, or `unverified_by_trace(...)` marker in release evidence is a failure.
   - There is no partial pass for release evidence; quality target is binary.
3. **100% PASS EXPECTATION FOR RELEASE EVIDENCE**
   - Release gate commands are expected to pass completely with zero strict-failure markers.
   - If strict markers appear, fix root cause; do not relabel as acceptable.
4. **AGENTIC QUALIFICATION IS REQUIRED**
   - `npm run test:agentic:strict` is the canonical qualification command.
   - This chain uses real agent-command tasks, progressive use-case review, live-fire runs, and strict publish-gate validation.
5. **CONVERSATION-INSIGHTS TRACKING IS REQUIRED**
   - `docs/LiBrainian/CONVERSATION_INSIGHTS.md` must be updated at planning checkpoints and before release-gate runs.
   - Strategy items must map to code/eval/docs/gate work, not passive notes.

---

## Troubleshooting

> Troubleshooting commands below are for diagnosis and local recovery only.
> They must never be used as publish evidence substitutes.

### 1. Zero-File Bootstrap

**Symptom**: Bootstrap completes but reports "0 files indexed" or empty database.

**Cause**: Working directory mismatch, `.gitignore` excluding all code, or no supported file types found.

**Fix**:
```bash
# Verify you're in the right directory
pwd
ls -la src/  # Check source files exist

# Check what files would be indexed
find . -name "*.ts" -o -name "*.js" | head -20

# Force bootstrap with explicit path
LiBrainian bootstrap --path $(pwd) --force

# If still 0, check .librarianignore or config excludes
cat .librarianignore 2>/dev/null
```

### 2. Bootstrap Fails or Hangs

**Symptom**: Bootstrap never completes, times out, or crashes with errors.

**Cause**: Embedding provider unavailable, database lock, or out of memory on large repos.

**Fix**:
```bash
# Kill any stuck processes
pkill -f LiBrainian

# Clear corrupted state
rm -rf .LiBrainian/  # Remove index directory
rm -f LiBrainian.db* # Remove database files

# Bootstrap in offline mode (no embeddings)
LiBrainian bootstrap --offline

# For large repos, use incremental mode
LiBrainian bootstrap --incremental --batch-size 50
```

### 3. Query Returns Empty

**Symptom**: `lib.query()` returns no results or empty context.

**Cause**: Index not built, query too specific, or embedding mismatch.

**Fix**:
```bash
# Check index status
LiBrainian status
LiBrainian health

# Verify files are indexed
LiBrainian stats  # Shows file count

# Try broader query
LiBrainian query "main entry point"  # Instead of specific function names

# Force re-index if stale
LiBrainian reindex --force
```

### 4. Database Locked

**Symptom**: `SQLITE_BUSY` or "database is locked" errors.

**Cause**: Multiple processes accessing the database, or crashed process left lock.

**Fix**:
```bash
# Find and kill processes holding the lock
lsof LiBrainian.db 2>/dev/null | awk 'NR>1 {print $2}' | xargs -r kill

# If no processes found, remove stale lock files
rm -f LiBrainian.db-wal LiBrainian.db-shm

# Retry operation
LiBrainian status
```

### 5. Provider Unavailable

**Symptom**: "Embedding provider not available" or API errors during bootstrap/query.

**Cause**: No API key configured, network issues, or provider rate-limited.

**Fix**:
```bash
# Check provider status
LiBrainian health --providers

# Use offline/degraded mode (keyword search only, diagnostics only)
LiBrainian bootstrap --offline
LiBrainian query "search term" --no-embeddings

# Switch to local provider if available
export LIBRARIAN_PROVIDER=local
LiBrainian bootstrap
```

### 6. Fallback Without LiBrainian

**Symptom**: LiBrainian completely broken and you need context NOW (diagnostics only).

**Cause**: Any unrecoverable LiBrainian failure.

**Fix** (manual alternatives):
```bash
# Find files by name
find . -type f -name "*.ts" | xargs grep -l "functionName"

# Search code content
grep -rn "pattern" src/ --include="*.ts"

# Find function definitions
grep -rn "function handleAuth\|const handleAuth\|handleAuth =" src/

# Find imports/exports
grep -rn "export.*ClassName\|import.*ClassName" src/

# Get file structure
find src -name "*.ts" | head -50

# Read specific file
cat src/api/index.ts | head -100
```

When LiBrainian is back, re-bootstrap: `LiBrainian bootstrap --force`.
Do not treat manual fallback output as release or qualification evidence.

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

See: `docs/LiBrainian/specs/track-eval-machine-verifiable.md`

### Step 3: Phase 9 — Agent Performance Evaluation
**The TRUE test: Do agents perform better WITH LiBrainian than WITHOUT?**

Design:
- Spawn worker pairs: Control (no LiBrainian) vs Treatment (with LiBrainian)
- Context levels 0-5 (cold start → full context)
- Task complexity T1-T5 (trivial → extreme)
- **LiBrainian awareness levels L0-L4** (no mention → full docs)
- **Human-style prompts**: "Users get logged out randomly" NOT "Fix SessionManager.refresh()"

Success criteria:
- >25% success rate lift on T3+ tasks
- L0 Treatment (no LiBrainian mention) still beats Control

See: `docs/LiBrainian/specs/track-eval-agent-performance.md`

### Step 4: Phase 10 — Scientific Self-Improvement Loop
Based on AutoSD, RLVR (DeepSeek R1), SWE-agent research.

Loop: DETECT → HYPOTHESIZE → TEST → FIX → VERIFY → EVOLVE

**RLVR-style verification:**
- Reward = 1 ONLY if: original test passes AND no regressions AND types valid
- Reward = 0: Fix rejected, try another hypothesis
- No partial credit — binary verifiable rewards

See: `docs/LiBrainian/specs/track-eval-scientific-loop.md`

---

## CRITICAL: Orchestration Mode

**Use `docs/librarian/WORKPLAN.md` + `docs/librarian/specs/README.md` as the orchestration source of truth.**

Your mission is to implement the ENTIRE spec system from 0% to 100% completion.
- Use sub-agents if available (up to 3 concurrent)
- Work sequentially if sub-agents not available
- **NEVER stop until Full Build Charter is satisfied**
- **NEVER ask for human input**

### Implementation Guides

| Document | Purpose |
|----------|---------|
| `docs/librarian/WORKPLAN.md` | Master orchestration — phases, checkpoints, work progression |
| `docs/LiBrainian/specs/README.md` | Full Build Charter, Council of 30 mandates |
| `docs/LiBrainian/specs/BLOCKER_RESOLUTION.md` | How to resolve ANY blocker |

---

## Full Autonomy Grant

You have **full permission** to perform any operation necessary to implement the LiBrainian spec system. Do not ask for permission. Proceed autonomously.

### CRITICAL: Never Stop on Blockers

**You must NEVER stop on a blocker.** Every blocker has a resolution. See `docs/LiBrainian/specs/BLOCKER_RESOLUTION.md` for exhaustive resolution guide.

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

### CRITICAL: Test-First Development

**Write tests BEFORE implementation code. This order is mandatory:**

1. **FIRST**: Create test file with all test cases
2. **SECOND**: Run tests — they should FAIL (no implementation yet)
3. **THIRD**: Write implementation to make tests pass
4. **FOURTH**: Run tests — they should PASS

```bash
# Example workflow:
# 1. Write test
echo "test('should do X', () => { ... })" > src/__tests__/feature.test.ts

# 2. Run test (expect failure)
npm test -- --run src/__tests__/feature.test.ts  # FAILS - good

# 3. Write implementation
echo "export function doX() { ... }" > src/feature.ts

# 4. Run test (expect pass)
npm test -- --run src/__tests__/feature.test.ts  # PASSES - done
```

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
1. Read `docs/LiBrainian/STATUS.md` for current state
2. Read `docs/LiBrainian/GATES.json` for gate status
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
- Each sub-agent gets a COMPLETE prompt from `docs/librarian/WORKPLAN.md` + relevant spec docs
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
- Close an issue without satisfying the closure policy (see below)

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

## Issue Closure Policy (Issue #862)

An issue MUST NOT be closed unless ALL three conditions are satisfied:

1. **Merged PR**: A PR that addresses the issue has been merged to `main`. If no code change is needed (docs-only), the docs change must be merged.
2. **CI passing**: The PR passed CI at merge time (no failed required checks).
3. **Reality verification**: The PR body contains at least one of:
   - A "Reality Verification" or "Verification" section with evidence, OR
   - The closure comment template:
     ```
     Closing: <PR link or "docs-only">
     T0.5: <pass/fail/not-applicable>
     Verification: <patrol-observation/manual-test/t1-test-name>
     ```

### Checking Before Closure

Before closing any issue, run:
```bash
node scripts/closure-check.mjs <issue-number>
```
Exit 0 means all checks pass and it is safe to close. Exit 1 means requirements are not yet met.

### Enforcement

- The `closure-policy` CI workflow comments a warning on PRs that close issues without reality verification evidence.
- Patrol agents are expected to flag recently closed issues that lack verification comments.
- Premature closures must be reopened. "Tests pass" alone is not sufficient.

See: `docs/LiBrainian/E2E_REALITY_POLICY.md`

---

## Remember

- **Do not ask permission** for routine operations
- **Fix blockers immediately** and continue
- **Document honestly** - never claim success without evidence
- **Fail closed** - never fake capabilities or skip silently
- **You have full autonomy** within the non-negotiables
- **Continue until Full Build Charter satisfied** — not before

---

<!-- LIBRARIAN_DOCS_START -->
## LiBrainian: Codebase Knowledge System
> Auto-generated by LiBrainian bootstrap. Do not edit manually.
### What is LiBrainian?
LiBrainian is the **codebase knowledge backbone** for AI coding agents. It provides:
- **Semantic search**: Find code by meaning, not just keywords
- **Context packs**: Pre-computed context for common tasks
- **Function knowledge**: Purpose, signatures, and relationships
- **Graph analysis**: Call graphs, import graphs, and metrics
### How to Use LiBrainian
```typescript
// 1. Get the LiBrainian instance
import { getLibrarian } from 'librainian';
const LiBrainian = await getLibrarian(workspaceRoot);
// 2. Query for context
const context = await LiBrainian.query('How does authentication work?');
// 3. Use in prompts
const prompt = `Given this context:\n${context}\nImplement...`;
```
### Current Capabilities
**Available**: semantic search, llm enrichment, function data, structural data, relationship graph, context packs
### Index Statistics
- **Last indexed**: 2026-02-02T19:14:22.953Z
- **Files processed**: 1448
- **Functions indexed**: 9266
- **Context packs**: 3327
### Key Documentation
- **Entry point**: `docs/LiBrainian/README.md`
- **API reference**: `src/LiBrainian/api/README.md`
- **Query guide**: `docs/LiBrainian/query-guide.md`
### When to Re-index
LiBrainian auto-watches for changes. Manual reindex needed when:
- Major refactoring (>50 files changed)
- After git operations that bypass file watchers
- When embeddings seem stale
```bash
# Trigger manual reindex
npx librainian reindex --force
```
<!-- LIBRARIAN_DOCS_END -->
