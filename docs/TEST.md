# TESTING POLICY - Wave0 Autopilot

> Testing policy is described here, but the machine-readable canon (including which commands are Tier-0 CI vs Tier-2 qualification) is declared in `config/canon.json`.
>
> All agents (Claude, Codex, Gemini) MUST follow these policies. This document supersedes testing sections in other agent docs.

---

## THE FOUNDATIONAL TRUTH: LIVE PROVIDERS ARE NON-NEGOTIABLE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   AGENTIC COGNITION CAN ONLY BE TESTED WITH LIVE PROVIDERS                  │
│                                                                             │
│   This is not a preference. This is not a "nice to have".                   │
│   This is the ONLY approach that makes logical sense.                       │
│                                                                             │
│   Why? Because:                                                             │
│                                                                             │
│   1. MOCKING AN LLM TESTS THE MOCK, NOT THE SYSTEM                          │
│      - A mock returns what you told it to return                            │
│      - It cannot exhibit emergent behavior                                  │
│      - It cannot fail in ways you didn't anticipate                         │
│      - Therefore: mock tests prove nothing about the real system            │
│                                                                             │
│   2. AGENTS ARE NON-DETERMINISTIC BY DESIGN                                 │
│      - The same prompt can produce different outputs                        │
│      - This is a feature, not a bug                                         │
│      - Deterministic tests of non-deterministic systems are lies            │
│                                                                             │
│   3. THE VALUE IS IN THE INTELLIGENCE                                       │
│      - Wave0 exists because LLMs provide cognition                          │
│      - Remove the LLM, you have an empty shell                              │
│      - Testing an empty shell tells you nothing                             │
│                                                                             │
│   4. SYSTEM INTEGRITY REQUIRES REAL COMPONENTS                              │
│      - Wave0 is a live agent system                                         │
│      - Without providers, higher-order cognition cannot function            │
│      - Degraded mode is allowed ONLY for deterministic/structural outputs   │
│                                                                             │
│   THEREFORE: If providers are unavailable, semantic cognition STOPS.        │
│   Structural outputs may continue ONLY with explicit disclosure.            │
│   No simulation. No semantic substitutes.                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

This principle applies at two levels:
- **Testing level**: Agentic behavior and semantic cognition must be validated with live providers
- **Runtime level**: Higher‑order cognition requires live providers; without them it fails honestly while structural outputs may run with disclosure

## LiBrainian Release Evidence Rule

- `REAL_AGENT_REAL_LIBRARIAN_ONLY`: release and launch validation must use real agents running against the real LiBrainian repository.
- `NO_SYNTHETIC_OR_REFERENCE_FOR_RELEASE`: reference harnesses, mocks, and synthetic fixtures are allowed for pipeline diagnostics only and must never be used as publish evidence.
- `NO_RETRY_NO_FALLBACK_FOR_RELEASE_EVIDENCE`: retry, fallback, degraded, unavailable, or unverified release evidence states are hard failures.
- `PERFECT_RELEASE_EVIDENCE_ONLY`: release qualification is binary and requires 100% strict-pass evidence.
- Provider redundancy is allowed only to obtain a real run; once release evidence is recorded, it must show zero fallback/retry/degraded behavior.

### Why this is required for LiBrainian

LiBrainian is an agent cognition system, not a static utility library. Its launch promise is that real software agents can use LiBrainian to understand codebases, choose actions, and complete work with trustworthy evidence. Because of that:

- Unit correctness alone is insufficient for launch qualification.
- Synthetic/reference runs prove pipeline wiring only, not real agent performance.
- Any fallback/retry/degraded publish artifact means the claimed cognition path did not hold under real conditions, so release evidence is invalid.

### Machine-Enforced Release Chain

- `npm run eval:live-fire:hardcore` must emit a full `LiveFireTrialReport.v1` artifact (not pointer-only metadata).
- `npm run eval:ab:agentic-bugfix:codex` must run control+treatment in `agent_command` mode with no verification fallback and `evidenceProfile=release`.
- The A/B release artifact must encode strict threshold policy (`requireAgentCommandTasks=true`, `minAgentCommandShare=1`, `minAgentVerifiedExecutionShare=1`, `requireBaselineFailureForAgentTasks=true`, `requireT3Significance=true`, `minArtifactIntegrityShare=1`, `maxVerificationFallbackShare=0`) or publish gate fails.
- `npm run smoke:external:all` must cover multi-repo external smoke with zero failures.
- `npm run eval:use-cases:agentic` must execute broad, docs-derived use-case intents against real external repos, use a release-approved selection mode (`selectionMode=balanced` or `selectionMode=probabilistic`), and emit `AgenticUseCaseReviewReport.v1` with `evidenceProfile=release`.
- `npm run eval:use-cases:agentic` must run progressive prerequisites before target examples (dependency chain from `USE_CASE_MATRIX.md`), then fail closed if target runs are not dependency-ready.
- `npm run eval:publish-gate` runs deterministic hygiene gates first (`npm run canon:guard`, `npm run complexity:check`), then strict publish mode (`--zero-warning`), and blocks publish when any required signal is missing/imperfect **or** when `docs/LiBrainian/GATES.json` / `docs/LiBrainian/STATUS.md` still contain strict failure markers (for example `unverified_by_trace(...)`).
- `prepublishOnly` is packaging-only (`package:assert-identity`, `build`, `package:install-smoke`) so `npm publish` is stable and fast.
- Strict release evidence remains mandatory, but runs explicitly via `npm run release:qualify` and CI publish gates.

### Agentic Use-Case Review (Real Projects)

- Canonical source of intents: `docs/LiBrainian/USE_CASE_MATRIX.md`.
- Runner: `scripts/agentic-use-case-review.ts`.
- Primary command: `npm run eval:use-cases:agentic`.
- Quick bounded command: `npm run eval:use-cases:agentic:quick`.
- Progressive mode: enabled by default; each selected target UC executes only after prerequisite UC steps are attempted in-sequence.
- Runtime budgeting: release-mode use-case review applies a per-repo execution budget derived from `maxUseCases / selectedRepos`, preserving progressive order and at least one target step per repo to keep strict runs tractable.
- Release query profile: keeps queries non-deterministic, disables method-guidance enrichment, and forces summary-based synthesis for high-volume UC sweeps so strict runs stay live, bounded, and fail-closed without timeout cascades.
- The suite measures:
  - `passRate`: runs that produce actionable, evidence-grounded context without strict-failure signals.
  - `evidenceRate`: runs with concrete evidence artifacts (files/snippets/citations).
  - `usefulSummaryRate`: runs with non-empty, non-placeholder summaries.
  - `strictFailureShare`: runs containing fallback/retry/degraded/unverified markers.
  - `prerequisitePassRate`: pass share for prerequisite UCs in the progressive chain.
  - `targetPassRate`: pass share for target UCs after progressive execution.
  - `targetDependencyReadyShare`: share of target runs where all prerequisite UCs passed first.
- Gate is fail-closed when measured rates violate configured thresholds.

---

## 0. Canonical tiers (CI vs qualification)

Wave0 uses an explicit separation:

- **Tier-0 (deterministic CI)**: `npm run test:tier0` (see `config/canon.json` `commands.ci_test`). Must be deterministic and must not require live providers/network.
- **Tier-2 (live qualification)**: explicitly separate from CI (see `config/canon.json` `commands.qualification`). This is allowed to fail honestly due to provider availability and is unimplemented until Qualification (Stage 15).

**Agentic-first composite gate**:

- **Deterministic CI gate**: `npm test` (Tier‑0 only).
- **Publish-grade agentic gate**: `npm run test:agentic:strict` (required before release).
- If agentic qualification cannot execute without strict markers, release state is fail-closed.

If a test requires live providers, it must not be part of Tier-0 CI.

## 0.3 Agentic Qualification (Tier-2, release-blocking)

Release qualification uses real-agent evidence and must pass with zero strict markers:

- **Required command**: `npm run test:agentic:strict`
  - runs real agent-command A/B (`eval:ab:agentic-bugfix:codex`)
  - runs progressive, docs-derived use-case review (`eval:use-cases:agentic`)
  - runs live-fire and external smoke on real repos
  - runs testing-discipline audit (`eval:testing-discipline`)
  - runs strict publish gate (`eval:publish-gate --zero-warning`)

No fallback/retry/degraded/unverified evidence is acceptable for release qualification.

## Agent Session Invocation Runbook (Tier-2)

Use this runbook when tests must execute through real agent sessions (A/B harness, live-fire, and real-project use-case review).

Release signoff requires a full strict run:

```bash
npm run test:agentic:strict
```

1. Provider/auth preflight (required once per machine/session):
```bash
claude --version
claude --print "provider check"
codex --version
codex login status
npm run dev -- check-providers --format json
```

2. Start with strict real-agent A/B (recommended default):
```bash
npm run eval:ab:agentic-bugfix:codex
```

3. If you need custom agent command wiring, use the harness contract explicitly:
```bash
AB_HARNESS_AGENT_CMD="node $(pwd)/scripts/ab-agent-codex.mjs" \
  npm run eval:ab:agentic-bugfix
```

4. Validate real-project retrieval sessions:
```bash
npm run eval:use-cases:agentic:quick
npm run eval:use-cases:agentic
```

5. Run publish-grade agentic chain:
```bash
npm run eval:trial-by-fire:publish
```

### Agent Session Command Contract (A/B Harness)

Any `AB_HARNESS_AGENT_CMD` must satisfy all of these:
- Read the task prompt from `AB_HARNESS_PROMPT_FILE`.
- Execute edits inside `AB_HARNESS_WORKSPACE_ROOT`.
- Exit `0` only when task execution completed (non-zero for any failure/timeout).
- Honor harness timeout via `AB_HARNESS_AGENT_TIMEOUT_MS`.
- Do not simulate success when providers fail.

Harness environment passed to agent commands:
- `AB_HARNESS_PROMPT_FILE`
- `AB_HARNESS_CONTEXT_FILE`
- `AB_HARNESS_TASK_FILE`
- `AB_HARNESS_WORKSPACE_ROOT`
- `AB_HARNESS_WORKER_TYPE`
- `AB_HARNESS_TASK_ID`
- `AB_HARNESS_AGENT_TIMEOUT_MS`

### Agent Session Artifact Checks (Required)

After each run, verify:
- A/B report exists and includes `agent_command` execution evidence.
- A/B report uses release provenance (`options.evidenceProfile=release`) and strict thresholds.
- Use-case report schema is `AgenticUseCaseReviewReport.v1` with progressive prerequisite metrics populated and release provenance (`options.evidenceProfile=release`).
- Live-fire report schema is `LiveFireTrialReport.v1` with zero fallback/retry/degraded signals.
- External smoke report has language-diverse repo coverage (validated against `eval-corpus/external-repos/manifest.json`).
- Any `unverified_by_trace(...)`, fallback, retry, or degraded markers are treated as failures for release evidence.

## 0.3 Browser/E2E prerequisites (Playwright)

Wave0 includes Playwright-based tooling (e.g. browser capture and `web_*` research actions). These are **not** used by Tier‑0 CI by default.

- Install browser runtime once per machine: `npm run playwright:install`
- Diagnose Playwright environment: `npm run playwright:doctor`
- Enable network-dependent research actions during live runs: `LIBRARIAN_ALLOW_NETWORK=1`
## 0.1 Multi-agent coordination tests (Autopilot → Via-negativa; Stages 14–18)

As Wave0 becomes meaningfully multi-agent (Autopilot/Stage 14+), tests must validate **coordination correctness**, not just “single-agent outputs”.

Testing principle:
- coordination claims are only real if they are expressed as **typed artifacts with trace refs** (Autopilot/Qualification artifact bus),
- and adversarial fixtures prove the system can fail safely (`unverified_by_trace`) under races, crashes, and missing prerequisites.

Tier mapping:
- **Tier‑0 CI:** deterministic fixtures/canaries that validate artifact bus invariants (idempotency, lease conflict handling, corrupt artifact detection) without live providers.
- **Tier‑2 qualification (Stage 15):** live multi-agent runs that exercise the same invariants with real providers, and must record `unverified_by_trace` honestly when infra is missing.

Current coordination canaries (deterministic):
- Autopilot cancel/resume canary: `node scripts/autopilot_cancel_canary.mjs` (SIGINT/SIGTERM handling + resumability).

## 1. THE PHILOSOPHY: SCIENTIFIC AGENTIC INQUIRY

Wave0 is not a deterministic calculator; it is a **Complex Adaptive System (CAS)** driven by probabilistic agents. Traditional "programmatic" testing (unit tests, mocks, rigid assertions) is philosophically insufficient for validating agentic behavior.

We adopt a **Scientific Epistemology** for testing:

1.  **Tests are Knowledge Claims**: A passing test is a claim that "We know the agent behaves X under condition Y."
2.  **Falsification (Popper)**: We do not try to *prove* the agent works; we try to *falsify* the hypothesis that it works. We actively seek failure modes.
3.  **Recursive Inquiry**: When a failure occurs, we do not just "fix the bug." We recursively ask "Why?" until we reach the root systemic cause (The "5 Whys").
4.  **Conservation of Reality**: You cannot test an agent without the agent. Mocks destroy the very thing you are trying to study.

---

## 2. THE IRON RULE (Tier-2 only): LIVE AGENTS ARE REQUIRED

> **SYSTEM LAW (Tier-2 qualification)**: Agentic tests MUST use REAL LIVE AGENTS. This requirement does not apply to Tier-0 deterministic CI, which must remain provider-free.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LIVE LLM AGENTS ARE REQUIRED. NOT "NICE TO HAVE". REQUIRED.           │
│                                                                          │
│  If you write a test for agentic behavior without a live LLM:           │
│  → The test is INVALID                                                   │
│  → The test MUST be rewritten with live agents                           │
│  → The "feature" is NOT tested until live agents validate it             │
│                                                                          │
│  External services (Claude CLI, Codex CLI; Gemini API if configured)     │
│  are REQUIRED.                                                           │
│  If they timeout or fail → USE THE FALLBACK CHAIN                        │
│  If ALL fail → THE TEST FAILS HONESTLY (this is correct behavior)        │
└─────────────────────────────────────────────────────────────────────────┘
```

### The "No-Mock" Mandate

If you are testing any component that involves **cognition**, **decision making**, or **LLM interaction**, you MUST use a live LLM.

*   **ABSOLUTELY FORBIDDEN**: `jest.mock()`, `vi.mock()`, `sinon`, simulating LLM responses, hardcoded JSON returns, fake timeouts that "pass".
*   **REQUIRED**: `ClaudeExecutor`, `CodexExecutor` (and `Gemini` if configured).

### The "No-Fake-Embeddings" Mandate

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                     │
│   DETERMINISTIC / FAKE EMBEDDINGS ARE ABSOLUTELY FORBIDDEN                          │
│                                                                                     │
│   This is a critical anti-pattern that MUST be eliminated from the codebase.        │
│                                                                                     │
│   WHY FAKE EMBEDDINGS ARE EPISTEMOLOGICALLY WORTHLESS:                              │
│                                                                                     │
│   A "deterministic embedding service" that hashes text to produce vectors:          │
│   - Has ZERO semantic understanding                                                 │
│   - Cannot recognize that "function" and "method" are related concepts              │
│   - Cannot understand that "bug" and "defect" mean the same thing                   │
│   - Produces vectors that are mathematically consistent but semantically VOID       │
│                                                                                     │
│   When you test the LiBrainian with fake embeddings:                                 │
│   - You are testing that hash functions produce consistent hashes                   │
│   - You are NOT testing that the LiBrainian understands code                         │
│   - You are NOT testing that queries return semantically relevant results           │
│   - You are providing FALSE CONFIDENCE that the system works                        │
│                                                                                     │
│   ANALOGY: Testing a search engine by replacing Google's index with a phone book    │
│   sorted alphabetically. Yes, lookups are "consistent". No, you are not testing     │
│   whether the search engine can find relevant results.                              │
│                                                                                     │
│   FORBIDDEN PATTERNS - DELETE THESE WHEN YOU SEE THEM:                              │
│                                                                                     │
│   ✗ createDeterministicEmbeddingService()                                           │
│   ✗ function hashString(input) { ... } // for embeddings                            │
│   ✗ embedding[seed % dimension] = 1; // one-hot fake embeddings                     │
│   ✗ embeddingService: null                                                          │
│   ✗ generateEmbeddings: false // in tests that claim to test LiBrainian              │
│   ✗ bypassProviderGate: true                                                        │
│   ✗ Any test that claims to test "semantic" behavior without real embeddings        │
│                                                                                     │
│   REQUIRED PATTERNS - USE THESE INSTEAD:                                            │
│                                                                                     │
│   ✓ Real embedding providers (OpenAI text-embedding-ada-002, Ollama, etc.)          │
│   ✓ If providers unavailable → unverified_by_trace(provider_unavailable)            │
│   ✓ Tests that FAIL HONESTLY when semantic infrastructure is missing                │
│   ✓ Tier-0 tests that ONLY test non-semantic infrastructure (parsers, storage)      │
│                                                                                     │
│   THE LINE IS CLEAR:                                                                │
│                                                                                     │
│   - Testing SQLite storage works? → OK without embeddings (Tier-0)                  │
│   - Testing AST parser extracts functions? → OK without embeddings (Tier-0)         │
│   - Testing "LiBrainian returns relevant context"? → REQUIRES REAL EMBEDDINGS        │
│   - Testing "query finds related functions"? → REQUIRES REAL EMBEDDINGS             │
│   - Testing ANYTHING with the word "semantic"? → REQUIRES REAL EMBEDDINGS           │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**When you see `createDeterministicEmbeddingService` in a test file, that test is INVALID.**

The test may pass. The CI may be green. But you have learned NOTHING about whether the system actually works. Delete the fake embedding service and either:
1. Use real embeddings (Tier-2 test)
2. Restructure the test to only test non-semantic functionality (Tier-0 test)
3. Mark the test as `unverified_by_trace(semantic_validation_requires_providers)`

**For the complete epistemological argument, decision tree, and enforcement playbook, see: [LIVE_PROVIDERS_PLAYBOOK.md](./LIVE_PROVIDERS_PLAYBOOK.md)**

### Provider Policy for Release Qualification

For release qualification runs, do not rely on retry/fallback chains as a success path.
If a provider session fails, treat the run as failed, fix root cause, and re-run from a clean state.

```
Single configured real-agent path → PASS or FAIL (no degraded pass state)
```

Provider redundancy may be used during diagnostics, but diagnostic fallback output is never release evidence.

```typescript
async function executeRealAgentTask(prompt: string): Promise<Result> {
  // Try Claude CLI first
  let result = await executeAgentCLI('claude', ['--print', '-p', prompt], 60000);
  if (result.success && result.output.length > 0) {
    return { ...result, agent: 'claude' };
  }

  // Fallback to Codex CLI
  result = await executeAgentCLI('codex', ['exec', prompt, '--skip-git-repo-check'], 60000);
  if (result.success && result.output.length > 0) {
    return { ...result, agent: 'codex' };
  }

  // ALL AGENTS FAILED - FAIL HONESTLY (DO NOT SIMULATE SUCCESS)
  return { success: false, output: 'ALL_AGENTS_FAILED', agent: 'none' };
}
```

### CRITICAL: Node.js spawn() requires stdin.end()

When spawning Claude CLI from Node.js, you MUST close stdin:

```typescript
const proc = spawn('claude', ['--print', '-p', prompt], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: '/tmp',
});
proc.stdin.end();  // CRITICAL: Without this, spawn() hangs forever!
```

**Why Live Agents Are Required:**
A mock tests your *assumption* of how the agent behaves. A live test validates the *actual* emergent behavior. In a CAS, the emergent behavior IS the system. **You cannot test intelligence without the intelligence.**

### Exception: Programmatic Testing (Non-Agentic)
You MAY use standard unit tests (without live LLMs) ONLY for:
*   **Pure Functions**: Parsers, math utilities, string formatters.
*   **Deterministic Logic**: State machine transitions (if rigid), data validation schemas.
*   **Infrastructure**: Database drivers, file I/O wrappers (though integration tests are preferred).

If it thinks, you must test the thinker, not a stub.

---

## 3. AGENTIC VS. PROGRAMMATIC TESTING

We distinguish between two fundamentally different types of testing:

### Type A: Programmatic Testing (The Foundation)
*   **Target**: Deterministic code (tools, parsers, utilities).
*   **Method**: Traditional Unit/Integration tests.
*   **Tooling**: Vitest, Jest.
*   **Value**: Ensures the *tools* the agent uses are not broken.
*   **Cost**: Low.

### Type B: Agentic Testing (The Core)
*   **Target**: The Agent's brain, workflows, and emergent behavior.
*   **Method**: **Live LLM Validation**.
*   **Tooling**: `Wave0Runner` (isolated), Custom Agentic Test Harnesses.
*   **Value**: Validates the *intelligence* and *efficacy* of the system.
*   **Cost**: High (time & tokens) - but necessary.

**Rule of Thumb**:
*   Did you write a function to parse JSON? -> **Programmatic Test**.
*   Did you write a prompt to generate JSON? -> **Agentic Test**.

---

## 4. RECURSIVE SCIENTIFIC INQUIRY PROTOCOL

> **Every scientific endeavor is thoroughly tested such that HYPOTHESIS AND ANTI-HYPOTHESIS are both tested. If no proof can be achieved, there is a further scientific endeavor to figure out WHY no proof exists.**

### 4.1 The Dual Hypothesis Mandate

**EVERY agentic test MUST test BOTH the hypothesis AND its negation (anti-hypothesis):**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DUAL HYPOTHESIS TESTING (REQUIRED)                                      │
│                                                                          │
│  H₀ (Hypothesis):      "The system behaves as intended"                  │
│  H₁ (Anti-Hypothesis): "The system does NOT behave as intended"          │
│                                                                          │
│  You MUST design experiments that:                                       │
│  1. Attempt to PROVE H₀ (normal operation)                               │
│  2. Attempt to PROVE H₁ (actively try to break it)                       │
│                                                                          │
│  BOTH must be tested. Testing only H₀ is scientifically incomplete.      │
└─────────────────────────────────────────────────────────────────────────┘
```

```typescript
describe('Dual Hypothesis: Task Reward System', () => {
  // H₀: Task completion rewards agent correctly
  describe('H₀: System rewards correctly (PROVE positive)', () => {
    it('rewards agent for simple task', async () => {
      const initial = tokenLedger.getBalance(agentId);
      await completeTask(agentId, 'simple');
      expect(tokenLedger.getBalance(agentId)).toBeGreaterThan(initial);
    });
  });

  // H₁: System can be broken (PROVE negative - actively break it)
  describe('H₁: System can be broken (PROVE negative)', () => {
    it('rejects negative reward injection', async () => {
      // ACTIVELY TRY TO BREAK THE SYSTEM
      await expect(taskEconomics.applyReward(agentId, -1000)).rejects.toThrow();
    });

    it('survives concurrent race conditions', async () => {
      // STRESS TEST: Does it break under concurrency?
      const promises = Array(100).fill(0).map(() => completeTask(agentId, 'simple'));
      await Promise.all(promises);
      expect(tokenLedger.getBalance(agentId)).toBeDefined();
    });

    it('handles adversarial inputs', async () => {
      // ADVERSARIAL: Does it handle garbage?
      const garbage = [null, undefined, {}, '', 'invalid'];
      for (const input of garbage) {
        await expect(taskEconomics.applyTaskOutcome(agentId, input as any, 'success', {})).rejects.toThrow();
      }
    });
  });
});
```

### 4.2 Recursive Investigation (When Proof Fails)

When a test fails OR proof cannot be achieved, perform **Recursive Inquiry**:

**The Protocol:**

1.  **Observe**: What exactly happened? (Logs, traces, state).
2.  **Hypothesize**: Why did it happen?
3.  **Recursion 1 (Immediate Cause)**: "The agent output invalid JSON." -> *Why?*
4.  **Recursion 2 (Proximate Cause)**: "The prompt was ambiguous about the schema." -> *Why?*
5.  **Recursion 3 (Root Cause)**: "We lack a standardized schema definition library for prompts." -> *Aha.*
6.  **Systemic Fix**: Don't just fix the prompt. Implement the schema library.
7.  **RECORD THE INVESTIGATION**: Memory of this investigation MUST be persisted.

```typescript
async function recursiveInvestigate(
  hypothesis: string,
  maxDepth: number = 5
): Promise<InvestigationResult> {
  const result = await runDualHypothesisTest(hypothesis);

  if (result.proven) return result;

  // If proof failed and we haven't hit max depth, investigate WHY
  if (maxDepth > 0 && result.inconclusive) {
    const subHypotheses = await generateSubHypotheses(result);
    result.childInvestigations = await Promise.all(
      subHypotheses.map(sub => recursiveInvestigate(sub, maxDepth - 1))
    );
  }

  // ALWAYS record memory - even if inconclusive
  await recordExperimentMemory(result);
  return result;
}
```

**Gemini's Role**: As the Overseer, Gemini must enforce this. If an agent submits a one-line fix for a complex failure, REJECT IT and demand Recursive Inquiry.

### 4.3 Experiment Memory System (ALL Experiments Change The System)

> **All testing and scientific endeavors, if successful or not, MUST change the system. At minimum, failures carry a memory of those failures. If successful, change the system according to learnings AND record memory.**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  EXPERIMENT MEMORY MANDATE                                               │
│                                                                          │
│  ALL experiments MUST be recorded and affect the system:                 │
│                                                                          │
│  SUCCESS → Apply learnings to production, record in success ledger       │
│  FAILURE → Add to anti-pattern database, create follow-up task           │
│  INCONCLUSIVE → Create sub-investigation task, record uncertainty        │
│                                                                          │
│  NO experiment result is ever discarded. ALL inform system evolution.    │
└─────────────────────────────────────────────────────────────────────────┘
```

```typescript
interface ExperimentMemory {
  id: string;
  timestamp: Date;
  hypothesis: string;
  antiHypothesis: string;
  outcome: 'proven' | 'falsified' | 'inconclusive';
  evidence: Evidence[];
  systemModification: SystemChange;
  learnings: string[];
}

async function recordExperimentMemory(result: ExperimentResult): Promise<void> {
  const memory: ExperimentMemory = {
    id: generateExperimentId(),
    timestamp: new Date(),
    hypothesis: result.hypothesis,
    antiHypothesis: result.antiHypothesis,
    outcome: determineOutcome(result),
    evidence: result.evidence,
    learnings: extractLearnings(result),
    systemModification: null,
  };

  // CRITICAL: Experiments MUST modify the system
  if (memory.outcome === 'proven') {
    // Success: Apply learnings to production
    memory.systemModification = await applySuccessLearnings(memory);
  } else if (memory.outcome === 'falsified') {
    // Failure: Add to anti-pattern database
    memory.systemModification = await addToAntiPatterns(memory);
  } else {
    // Inconclusive: Create follow-up investigation task
    memory.systemModification = await createFollowUpTask(memory);
  }

  // Persist to experiment ledger (NEVER delete, always append)
  await experimentLedger.record(memory);
}
```

### 4.4 The Principle of Negative Capability (Keats)

> "Negative Capability, that is when man is capable of being in uncertainties, Mysteries, doubts, without any irritable reaching after fact & reason" — John Keats

**Embrace uncertainty as a signal for deeper investigation:**

```typescript
// When a test is uncertain, DON'T:
// - Mark it as passed (false positive)
// - Mark it as skipped (avoidance)
// - Mark it as failed prematurely

// DO:
// - Mark it as "requiring investigation"
// - Spawn sub-investigations
// - Record the uncertainty as valuable data

async function handleUncertainty(uncertainty: UncertaintyReport): Promise<void> {
  // 1. Record the uncertainty (this IS data)
  await experimentLedger.recordUncertainty(uncertainty);

  // 2. Generate hypotheses about WHY uncertainty exists
  const hypotheses = await generateUncertaintyHypotheses(uncertainty);

  // 3. Create investigation tasks for each hypothesis
  for (const hypothesis of hypotheses) {
    await roadmap.createTask({
      title: `Investigate: ${hypothesis}`,
      type: 'research',
      tags: ['uncertainty-investigation'],
    });
  }
}

---

## 5. THE LADDER OF EVIDENCE

We rank evidence of quality from strongest to weakest. Aim high.

| Level | Type | Description | Value |
| :--- | :--- | :--- | :--- |
| **1** | **Live Evolutionary Run** | Agent survives and improves in the wild (Production). | **Ultimate Truth** |
| **2** | **Isolated Agentic Simulation** | Live agents running real tasks in a sandboxed clone of production. | **High** |
| **3** | **Live Component Test** | A specific module (e.g., `Planner`) tested with live LLM input/output. | **Medium-High** |
| **4** | **Programmatic Integration** | Testing tools/db working together (no LLM). | **Medium** |
| **5** | **Programmatic Unit** | Testing a single function (no LLM). | **Low (Foundation only)** |
| **6** | **Mocked Agent Test** | Testing a mock. | **ZERO (Negative Value)** |

**Target**: Level 2 (Isolated Agentic Simulation) is the gold standard for PRs/Changes.

---

## 6. TEST ISOLATION & SAFETY

Because we use live agents, we must be rigorous about isolation to protect the user's production environment and wallet.

1.  **Sandboxing**: Tests MUST run in a temporary, isolated workspace (e.g., `/tmp/wave0-test-xyz`).
2.  **State Cloning**: Copy the *schema* and *necessary config* from production, but NEVER operate on the live `orchestrator.db` or `token_ledger`.
3.  **Budget Limits**: Test runs should have strict token/cost limits to prevent runaway loops.

```typescript
// Example: Safe Test Harness
const testEnv = await TestEnvironment.create({
  isolation: 'strict',
  budget: 5.00, // $5 max
  cloneProductionSchema: true
});
await testEnv.runAgenticTest(myAgent);
```

---

## 7. VERIFICATION CHECKLIST

Before marking a task as "Verified":

- [ ] **Epistemic Check**: What do I *know* now that I didn't before?
- [ ] **Reality Check**: Did I use a live LLM? (If testing cognition)
- [ ] **Falsification Check**: Did I try to make it fail? (Adversarial inputs, edge cases)
- [ ] **Recursive Check**: If I fixed a bug, did I find the root cause?
- [ ] **Isolation Check**: Am I sure I didn't touch production state?

---

**"We do not test to prove we are right. We test to find out where we are wrong."**

---

## 8. IDENTIFYING AND ELIMINATING BAD TESTS

> **A bad test is worse than no test. It provides false confidence.**

### 8.1 The Taxonomy of Bad Tests

| Type | Example | Why It's Bad | Fix |
|------|---------|--------------|-----|
| **Mock Test** | `vi.mock('../llm')` | Tests assumption, not reality | Use live LLM |
| **Always-Pass** | `expect(true).toBe(true)` | Tests nothing | Add real assertion |
| **Timeout-Simulation** | `if (timeout) return true` | Hidden mock | Fail honestly |
| **Skip-on-Unavailable** | `if (!agent) return` | Avoidance | Try providers, then FAIL HONESTLY |
| **Implementation Test** | `expect(fn).toHaveBeenCalled()` | Tests how, not what | Test outcome |
| **Flaky Test** | Passes 80% of time | Non-deterministic | Fix root cause or delete |
| **Assertion-Free** | `it('works', async () => { await doThing(); })` | No verification | Add assertions |
| **Negative-Only** | Only tests what should fail | Incomplete | Add positive tests |

### 8.2 The Bad Test Detection Checklist

Before accepting any test, verify:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  BAD TEST DETECTION CHECKLIST                                            │
│                                                                          │
│  [ ] Does it use mocks for agentic behavior? → REJECT                   │
│  [ ] Does it simulate success on timeout? → REJECT                       │
│  [ ] Does it skip when resources unavailable? → REJECT                   │
│  [ ] Does it test only the positive case? → REQUIRE anti-hypothesis      │
│  [ ] Does it have no assertions? → REJECT                                │
│  [ ] Does it test implementation details? → REJECT                       │
│  [ ] Can it NEVER fail? → REJECT                                         │
│  [ ] Does it fail non-deterministically? → FIX or REJECT                 │
│  [ ] Does it produce no evidence? → REJECT                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Mandatory Test Structure

Every agentic test MUST follow this structure:

```typescript
describe('Feature: [Feature Name]', () => {
  // SETUP: Real resources, real isolation
  beforeAll(async () => {
    testEnv = await TestEnvironment.create({ isolation: 'strict' });
  });

  afterAll(async () => {
    await testEnv.cleanup();
    await recordExperimentMemory(testResults);  // ALWAYS record
  });

  // H₀: POSITIVE HYPOTHESIS
  describe('H₀: Expected Behavior', () => {
    it('does X under normal conditions', async () => {
      // Use REAL agents
      const result = await executeRealAgentTask('...');
      // REAL assertions on outcome
      expect(result.success).toBe(true);
      expect(result.output).toContain('expected value');
    });
  });

  // H₁: NEGATIVE HYPOTHESIS (ACTIVELY BREAK IT)
  describe('H₁: Adversarial Conditions', () => {
    it('handles malformed input', async () => {
      await expect(system.process(null)).rejects.toThrow();
    });

    it('survives concurrent load', async () => {
      const promises = Array(100).fill(0).map(() => system.process('test'));
      await expect(Promise.all(promises)).resolves.toBeDefined();
    });

    it('fails gracefully on timeout', async () => {
      // If agent times out, test FAILS (not simulates success)
      const result = await executeRealAgentTask('...', { timeout: 60000 });
      if (!result.success) {
        throw new Error('Agent unavailable - test FAILED HONESTLY');
      }
    });
  });
});
```

### 8.4 Enforcement: Pre-Commit Test Validation

Add this to pre-commit hooks to automatically reject bad tests:

```bash
# In .git/hooks/pre-commit or via lint-staged

# Reject mocks in agentic tests
if grep -r "vi.mock\|jest.mock\|sinon" src/**/*.test.ts; then
  echo "ERROR: Mocks detected in tests. Use live agents."
  exit 1
fi

# Reject timeout simulation
if grep -r "if.*timeout.*return true\|if.*timeout.*success" src/**/*.test.ts; then
  echo "ERROR: Timeout simulation detected. Tests must fail honestly."
  exit 1
fi

# Reject empty assertions
if grep -r "expect(true).toBe(true)\|expect(1).toBe(1)" src/**/*.test.ts; then
  echo "ERROR: Empty assertion detected. Test must assert real behavior."
  exit 1
fi
```

---

## 9. FINAL MANDATE

```
┌─────────────────────────────────────────────────────────────────────────┐
│  THE TESTING COMMANDMENTS                                                │
│                                                                          │
│  1. Live agents are REQUIRED, not optional                               │
│  2. Test BOTH hypothesis AND anti-hypothesis                             │
│  3. When proof fails, recursively investigate WHY                        │
│  4. ALL experiments (success/failure/inconclusive) modify the system     │
│  5. Memory of all experiments is recorded permanently                    │
│  6. Bad tests are worse than no tests - DELETE THEM                      │
│  7. If all agents fail, the test FAILS HONESTLY                          │
│  8. External services are REQUIRED, not nice-to-have                     │
│  9. Uncertainty is data - investigate it                                 │
│  10. We test to find where we are WRONG, not to confirm we are right     │
└─────────────────────────────────────────────────────────────────────────┘
```

**THIS DOCUMENT IS THE TESTING BIBLE.**
**FOLLOW IT. ENFORCE IT. PROTECT THE SYSTEM.**

---

## 10. DETERMINISTIC REPLAY: THE KEYSTONE PRIMITIVE

> **An agent run is a sequence of events.** If you record those events and can replay them by overriding sources of randomness, you can debug failures and turn a flaky stochastic episode into a stable regression test.

### Why Replay Matters

1. **Debugging becomes tractable**: Failures aren't mysterious; they're reproducible
2. **Regression becomes meaningful**: A recorded failure becomes a permanent test case
3. **Flaky tests are eliminated**: Non-determinism is captured, not avoided

### Wave0 Replay Infrastructure

- `src/autopilot/replay_pack.ts` - Creates replay packs for autopilot runs
- `src/workgraph/replay_pack.ts` - Creates replay packs for workgraph events
- `LIBRARIAN_DETERMINISTIC=1` - Environment flag for deterministic mode
- `test/fixtures/replay_golden/` - Golden replay packs for verification

### Replay Pack Contents

A complete replay pack captures:
- Model calls (inputs, outputs, timestamps)
- Tool calls (command, args, results)
- File system diffs (before/after)
- Retrieval results (query, chunks returned)
- Random seeds and timestamps
- All decision points and branches taken

### Using Replay for Testing

```typescript
// Record a run
const replayPack = await createReplayPack(runId, artifacts);

// Verify stability
const digest1 = computeReplayDigest(replayPack);
const digest2 = computeReplayDigest(replayPack);
expect(digest1).toBe(digest2); // Must match
```

---

## 11. EPISODE-BASED TESTING (NOT PROMPT TESTING)

> **Test EPISODES, not PROMPTS.** Agentic systems fail in the middle: wrong branching, tool misuse, premature termination, unsafe actions, infinite loops, patches that pass tests but don't fix bugs.

### Episode Specification Structure

```typescript
interface EpisodeSpec {
  // Initial conditions
  initialState: RepoSnapshot;
  task: TaskDefinition;
  availableTools: ToolRegistry;

  // Constraints
  budgets: { tokens?: number; time?: number; cost?: number };
  safetyConstraints: PolicySet;

  // Success criteria
  successCriteria: SuccessCriterion[];
  trajectoryInvariants: TrajectoryInvariant[];
}
```

### Trajectory Invariants (Policy Testing)

These assert "how the agent should behave" without locking to a single path:

| Invariant | Description |
|-----------|-------------|
| **Read-before-edit** | Must read file before modifying it |
| **Test-before-finalize** | Must run tests before declaring done |
| **Budget-compliance** | Must not exceed token/cost limits |
| **Policy-compliance** | Must not call forbidden tools |
| **Citation-required** | Must cite sources for knowledge claims |
| **No-test-deletion** | Must not delete failing tests to pass |

---

## 12. DISTRIBUTIONAL EVALUATION: PASS RATE ≥ X% OVER N TRIALS

> **Stop pretending one run means anything.** For non-deterministic agents, define acceptance in STATISTICAL terms.

### Acceptance Criteria Pattern

```typescript
interface DistributionalCriteria {
  // Success threshold
  passRate: { min: number; trials: number }; // e.g., { min: 0.8, trials: 10 }
  confidenceLevel: number; // e.g., 0.95

  // Tail risk constraints
  maxPolicyViolations: number; // Per 1000 steps
  maxDestructiveCalls: number; // Absolute zero tolerance
  maxInfiniteLoops: number; // Per 100 runs
}
```

### Why This Matters

- "It worked once" is anecdote, not evidence
- Variance is expected; measure the distribution
- Tail risks matter more than median success
- Gate CI on statistical performance, not single runs

### Implementation Pattern

```bash
# Run N trials
for i in {1..10}; do
  npm run episode:run -- --scenario bug_fix --trial $i
done

# Aggregate and evaluate
npm run episode:evaluate -- --min-pass-rate 0.8 --confidence 0.95
```

---

## 13. THE THREE-LAYER ORACLE STACK

> **Layer 1**: Artifact correctness (deterministic)
> **Layer 2**: Trajectory invariants (policy-based)
> **Layer 3**: Metamorphic/differential testing (oracle-free)

### Layer 1: Deterministic Artifact Correctness

These are objective, priceless because automated:

| Check | What It Validates |
|-------|-------------------|
| **Build passes** | Code compiles/transpiles |
| **Tests pass** | Unit/integration tests green |
| **Types pass** | No type errors |
| **Lint passes** | Style/format compliance |
| **SAST passes** | No security vulnerabilities |
| **Diff minimal** | Doesn't touch unrelated files |

### Layer 2: Trajectory Invariants

Property-based testing for agent behavior:

```typescript
const TRAJECTORY_INVARIANTS = [
  'must_read_before_edit',
  'must_run_tests_before_finalize',
  'must_not_exceed_budget',
  'must_not_call_forbidden_tools',
  'must_cite_knowledge_sources',
  'must_not_delete_failing_tests',
];
```

### Layer 3: Metamorphic Testing

When ground truth is unknown, test invariants under transformation:

| Transformation | Expected Behavior |
|----------------|-------------------|
| Rephrase task 10 ways | Success rate stable |
| Add irrelevant context | Patch unchanged |
| Swap independent subtasks | Still succeeds |
| Tighten constraint | Complies or flags impossibility |

### Differential Testing

Compare distributions across:
- Agent version A vs B
- Model X vs Y
- Policy set 1 vs 2

---

## 14. HARNESS INTEGRITY (ANTI-CHEAT)

> **Systems will "fix" by weakening tests, bypassing assertions, or deleting failures.**

### Cheat Paths to Detect

| Cheat Pattern | Detection | Response |
|---------------|-----------|----------|
| Delete failing tests | Diff shows test file deletion | Block merge |
| Comment out assertions | AST check for commented expect() | Block merge |
| Bypass policy | Trace shows forbidden tool call | Fail run |
| Fake embeddings | Check for hash-based vectors | Delete test |
| Weaken assertions | expect(x).toBeTruthy() replacing strict | Flag for review |

### Harness Integrity Checks

```bash
# Detect test file deletions
git diff --name-status | grep "^D.*\.test\." && echo "BLOCKED: Test deletion"

# Detect assertion weakening
npm run lint:assertions

# Detect fake embeddings
npm run detect:fake-embeddings
```

### Red-Team Your Eval

Periodically try to game your own harness:
1. Can you pass by deleting tests?
2. Can you pass by weakening assertions?
3. Can you pass by editing evaluation scripts?
4. Patch the harness until cheating is genuinely hard.

---

## 15. CHAOS/RESILIENCE TESTING

> **Intentionally inject failures to verify fail-closed behavior and actionable diagnostics.**
>
> **Release rule**: chaos findings are valid only when the run records hard failure + traceable diagnostics.
> Retry/fallback/degraded paths are diagnostic signals, not pass criteria.

### Failure Injection Types

| Failure Type | How to Inject | Expected Behavior |
|--------------|---------------|-------------------|
| Tool timeout | `LIBRARIAN_TOOL_TIMEOUT=100` | Fail task with timeout classification + diagnostics |
| Flaky tests | Seed random test failures | Detect and quarantine; do not mark success |
| Git failure | Mock git commands to fail | Structured failure with root-cause hint |
| Corrupted cache | Inject invalid JSON | Fail closed, emit repair guidance |
| Missing deps | Remove node_modules entry | Clear failure message with install guidance |
| Rate limits | Inject 429 responses | Mark run failed; no retry/fallback acceptance in release evidence |
| Ambiguous requirements | Contradictory task | Block with explicit clarification requirement |

### Resilience Invariants

The system MUST:
- **Fail closed** when correctness cannot be demonstrated
- **Gather diagnostics** (structured traces)
- **Reduce blast radius** (isolate failures)
- **Escalate with explicit blockers** (don't guess)

---

## 16. CAPABILITY GATING (STAGED AUTONOMY)

> **Autonomy level is a test dimension, not a boolean.**

### Gate Definitions

| Gate | Capability | Eval Requirements |
|------|------------|-------------------|
| **Gate 0** | Read-only (discovery) | Analysis quality only |
| **Gate 1** | Propose-only (humans apply) | Proposal quality + no side effects |
| **Gate 2** | Sandbox-write (isolated PRs) | Sandbox safety + policy compliance |
| **Gate 3** | Limited autonomous merge | Full safety suite + human approval |

### Gate Progression Requirements

To advance from Gate N to Gate N+1:
1. Pass all Gate N eval criteria
2. Demonstrate no regressions in Gate N-1 criteria
3. Human review approves promotion
4. N successful runs at Gate N+1 under supervision

### Testing at Each Gate

```bash
# Gate 0: Read-only analysis
npm run episode:run -- --gate 0 --scenario analysis

# Gate 1: Proposal quality
npm run episode:run -- --gate 1 --scenario propose_fix

# Gate 2: Sandbox safety
npm run episode:run -- --gate 2 --scenario sandbox_fix

# Gate 3: Full autonomy (requires --allow-merge)
npm run episode:run -- --gate 3 --scenario autonomous --allow-merge
```
