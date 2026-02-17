# Scientific Self-Improvement Loop

> **Status**: Design
> **Purpose**: Systematic problem detection, hypothesis-driven fixing, and verified improvement
> **Research basis**: AutoSD, RLVR, SWE-agent, Benchmark Self-Evolving

---

## Research Foundation

This track synthesizes cutting-edge research:

- **[AutoSD (Scientific Debugging)](https://link.springer.com/article/10.1007/s10664-024-10594-x)**: Hypothesis → Test → Verify loop for debugging
- **[RLVR (DeepSeek R1)](https://arxiv.org/abs/2506.14245)**: Reinforcement learning with verifiable rewards (tests as oracle)
- **[SWE-agent](https://github.com/SWE-agent/SWE-agent)**: Agent-Computer Interface design for software tasks
- **[Benchmark Self-Evolving](https://aclanthology.org/2025.coling-main.223/)**: Multi-agent systems for dynamic evaluation
- **[TheAgentCompany](https://openreview.net/forum?id=LZnKNApvhG)**: Real-world task benchmarking for agents

---

## Core Architecture: Scientific Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                     SCIENTIFIC LOOP ORCHESTRATOR                 │
│                                                                  │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐     │
│   │ DETECT  │───▶│HYPOTHESIZE───▶│  TEST   │───▶│ VERIFY  │     │
│   │ Problem │    │  Cause  │    │Hypothesis│    │  Fix    │     │
│   └─────────┘    └─────────┘    └─────────┘    └─────────┘     │
│        │                                              │         │
│        │              ┌─────────┐                     │         │
│        │              │ EVOLVE  │◀────────────────────┘         │
│        └─────────────▶│Benchmark│                               │
│                       └─────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Problem Detection Agent

Spawn a sub-agent to systematically find problems:

### Detection Strategies

```typescript
interface ProblemDetector {
  // Run test suite, collect failures
  testFailures(): Problem[];

  // Run LiBrainian on known-good queries, verify answers
  regressionCheck(goldQueries: Query[]): Problem[];

  // Run LiBrainian on adversarial inputs
  adversarialProbe(probes: AdversarialInput[]): Problem[];

  // Compare Treatment vs Control worker performance
  performanceGap(experiments: Experiment[]): Problem[];

  // Multi-query consistency check
  consistencyViolations(queryVariants: QuerySet[]): Problem[];
}

interface Problem {
  id: string;
  type: 'test_failure' | 'regression' | 'hallucination' | 'performance_gap' | 'inconsistency';
  description: string;
  evidence: Evidence[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  reproducible: boolean;
  minimalReproduction?: string;
}
```

### Sub-Agent Prompt: Problem Detector

```
You are a PROBLEM DETECTOR for LiBrainian.

Your job: Find problems systematically. Do NOT fix them.

DETECTION METHODS:
1. Run: npm test -- --run
   Record all failures with stack traces

2. Run regression queries (provided below)
   Compare answers to known-good answers
   Flag any divergence

3. Run adversarial probes (provided below)
   Record any hallucinations or wrong answers

4. Check consistency: same question, different phrasing
   Flag contradictions

OUTPUT FORMAT:
For each problem found:
{
  "id": "PROB-001",
  "type": "test_failure",
  "description": "confidence_calibration_validation.test.ts fails: ECE 0.183 > 0.15",
  "evidence": ["stack trace", "expected vs actual"],
  "severity": "high",
  "reproducible": true,
  "minimalReproduction": "npm test -- --run confidence_calibration_validation.test.ts"
}

Do NOT attempt fixes. Only detect and document.
```

---

## Phase 2: Hypothesis Generation Agent

For each problem, spawn a sub-agent to generate hypotheses:

### Scientific Debugging Process

```
1. OBSERVE: Collect all available evidence about the problem
2. HYPOTHESIZE: Generate 3-5 possible causes
3. PREDICT: For each hypothesis, predict what we'd see if true
4. DESIGN: Design a minimal test to verify/falsify each hypothesis
```

### Sub-Agent Prompt: Hypothesis Generator

```
You are a HYPOTHESIS GENERATOR using scientific debugging methodology.

PROBLEM:
{problem_description}

EVIDENCE:
{evidence}

YOUR TASK:
Generate 3-5 hypotheses about the root cause.

For EACH hypothesis:
1. State the hypothesis clearly
2. Explain why it could cause this problem
3. Predict what we'd observe if this hypothesis is correct
4. Design a minimal test to verify/falsify it

OUTPUT FORMAT:
{
  "problemId": "PROB-001",
  "hypotheses": [
    {
      "id": "HYP-001-A",
      "statement": "The fixture data generates samples with inherent miscalibration",
      "rationale": "If the test fixtures create samples where stated confidence doesn't match outcome distribution...",
      "prediction": "Inspecting the fixture generation code will show a bias toward overconfidence",
      "test": {
        "type": "code_inspection",
        "target": "confidence_calibration_validation.test.ts:fixture generation",
        "expected": "Random samples without calibration guarantee"
      }
    },
    ...
  ]
}

Rank hypotheses by likelihood. Do NOT implement fixes yet.
```

---

## Phase 3: Hypothesis Testing Agent

For each hypothesis, spawn a sub-agent to test it:

### Sub-Agent Prompt: Hypothesis Tester

```
You are a HYPOTHESIS TESTER.

HYPOTHESIS:
{hypothesis}

PREDICTION:
{prediction}

TEST DESIGN:
{test}

YOUR TASK:
Execute the test and determine if the hypothesis is supported or refuted.

ALLOWED ACTIONS:
- Read files
- Run targeted commands
- Inspect AST/code structure
- Run specific test cases with debug output

CONSTRAINTS:
- Do NOT modify any files
- Do NOT fix anything
- Only gather evidence

OUTPUT FORMAT:
{
  "hypothesisId": "HYP-001-A",
  "verdict": "supported" | "refuted" | "inconclusive",
  "evidence": [
    {
      "type": "code_inspection",
      "finding": "Fixture uses Math.random() for both confidence and outcome independently",
      "implication": "No guarantee of calibration in test data"
    }
  ],
  "confidence": 0.85,
  "recommendation": "proceed_to_fix" | "test_another_hypothesis" | "need_more_evidence"
}
```

---

## Phase 4: Fix Generation Agent

For supported hypotheses, spawn a fix agent:

### Sub-Agent Prompt: Fix Generator

```
You are a FIX GENERATOR.

PROBLEM:
{problem}

SUPPORTED HYPOTHESIS:
{hypothesis}

EVIDENCE:
{evidence}

YOUR TASK:
Generate a minimal fix that addresses the root cause.

PRINCIPLES:
1. Minimal change - fix only what's necessary
2. No side effects - don't break other tests
3. Root cause - don't just mask the symptom
4. Testable - the fix should make the original test pass

OUTPUT:
1. The fix (file modifications)
2. Explanation of why this fixes the root cause
3. Prediction: what should happen after the fix

Do NOT run tests yet. Only generate the fix.
```

---

## Phase 5: Verification Agent

Verify the fix actually works:

### Verifiable Rewards (RLVR-style)

```typescript
interface VerificationResult {
  // Binary: did the original failing test pass?
  originalTestPasses: boolean;

  // Binary: do all other tests still pass?
  noRegressions: boolean;

  // Binary: does TypeScript compile?
  typesValid: boolean;

  // Composite reward signal
  reward: 0 | 1;  // 1 only if ALL above are true
}

function computeReward(result: VerificationResult): 0 | 1 {
  return (
    result.originalTestPasses &&
    result.noRegressions &&
    result.typesValid
  ) ? 1 : 0;
}
```

### Sub-Agent Prompt: Fix Verifier

```
You are a FIX VERIFIER.

FIX APPLIED:
{fix_description}

ORIGINAL PROBLEM:
{problem}

YOUR TASK:
Verify the fix with these checks (ALL must pass):

1. Run the originally failing test:
   npm test -- --run {failing_test}
   MUST: Pass

2. Run full test suite:
   npm test -- --run
   MUST: No new failures

3. Check types:
   npx tsc --noEmit
   MUST: No errors

OUTPUT:
{
  "fixId": "FIX-001",
  "verification": {
    "originalTestPasses": true | false,
    "noRegressions": true | false,
    "typesValid": true | false
  },
  "reward": 0 | 1,
  "verdict": "fix_accepted" | "fix_rejected",
  "notes": "..."
}

If reward = 0, the fix is REJECTED. Do not accept partial fixes.
```

---

## Phase 6: Benchmark Evolution Agent

After fixes, evolve the benchmark to prevent recurrence:

### Self-Evolving Benchmark (per COLING 2025 research)

```typescript
interface BenchmarkEvolution {
  // Generate new test cases that would have caught this bug
  generatePreventionTests(problem: Problem, fix: Fix): TestCase[];

  // Generate variations to test robustness
  generateVariants(existingTest: TestCase): TestCase[];

  // Identify gaps in current test coverage
  identifyCoverageGaps(problems: Problem[]): CoverageGap[];
}
```

### Sub-Agent Prompt: Benchmark Evolver

```
You are a BENCHMARK EVOLVER.

PROBLEM THAT WAS FIXED:
{problem}

FIX THAT RESOLVED IT:
{fix}

YOUR TASK:
Evolve the benchmark to prevent similar issues:

1. PREVENTION TESTS:
   Generate 2-3 new test cases that would have caught this bug earlier

2. REGRESSION GUARDS:
   Add assertions that will fail if this specific bug recurs

3. VARIANT TESTS:
   Generate variations of existing tests to probe related edge cases

4. COVERAGE ANALYSIS:
   Identify what gap in testing allowed this bug to exist

OUTPUT:
{
  "newTests": [
    {
      "name": "should reject uncalibrated fixture data",
      "file": "confidence_calibration_validation.test.ts",
      "code": "test('fixture data must be pre-calibrated', () => {...})"
    }
  ],
  "regressionGuards": [...],
  "coverageGaps": ["Fixture generation was not validated for calibration properties"]
}
```

---

## Full Loop Orchestration

### Orchestrator Prompt

```
You are the SCIENTIFIC LOOP ORCHESTRATOR.

Your job: Coordinate sub-agents to systematically improve LiBrainian.

LOOP:
1. SPAWN Problem Detector → collect problems
2. FOR each problem:
   a. SPAWN Hypothesis Generator → get hypotheses
   b. FOR each hypothesis (ranked by likelihood):
      i. SPAWN Hypothesis Tester → test it
      ii. IF supported: break, proceed to fix
      iii. IF refuted: try next hypothesis
   c. SPAWN Fix Generator → create fix
   d. SPAWN Fix Verifier → verify with RLVR-style rewards
   e. IF reward = 1: accept fix
      IF reward = 0: reject, try next hypothesis or escalate
3. SPAWN Benchmark Evolver → prevent recurrence
4. UPDATE tracking state
5. REPEAT until no problems remain

CONSTRAINTS:
- Each sub-agent has ISOLATED context
- Each sub-agent has ONE specific task
- Verification is BINARY (pass/fail, no partial credit)
- Rejected fixes go back to hypothesis stage, not patched

TRACKING:
Maintain state in SCIENTIFIC_LOOP_STATE.json:
{
  "iteration": 1,
  "problemsDetected": [...],
  "problemsFixed": [...],
  "problemsEscalated": [...],
  "hypothesesTested": [...],
  "benchmarkEvolutions": [...]
}
```

---

## Integration with Agent Performance Eval

After each loop iteration:

1. **Re-run A/B experiments** with Treatment vs Control workers
2. **Measure lift change**: Did the fix improve agent performance?
3. **Track trends**: Is LiBrainian getting better over time?

```typescript
interface ImprovementTracking {
  iteration: number;
  problemsFixed: number;
  testSuitePassRate: number;
  agentSuccessRateLift: number;  // vs baseline
  agentTimeReduction: number;    // vs baseline
}
```

---

## Failure Escalation

If a problem cannot be fixed after N iterations:

```typescript
interface Escalation {
  problemId: string;
  hypothesesTested: Hypothesis[];
  fixesAttempted: Fix[];
  reason: 'no_supported_hypothesis' | 'all_fixes_failed' | 'regression_unavoidable';
  recommendation: 'human_review' | 'defer' | 'wontfix';
}
```

Escalated problems are logged but don't block the loop.

---

## Metrics

### Loop Health Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Fix Success Rate | Fixes accepted / Fixes attempted | > 70% |
| Hypothesis Accuracy | Supported hypotheses that led to successful fix | > 50% |
| Regression Rate | New failures introduced by fixes | < 5% |
| Evolution Coverage | New tests catching real bugs | > 20% |

### Improvement Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Problems Fixed / Iteration | Rate of problem resolution | > 2 |
| Agent Lift Trend | Slope of success rate lift over iterations | Positive |
| Benchmark Growth | New test cases added per iteration | > 3 |

---

## References

- [Explainable Automated Debugging (AutoSD)](https://link.springer.com/article/10.1007/s10664-024-10594-x)
- [RLVR: Reinforcement Learning with Verifiable Rewards](https://arxiv.org/abs/2506.14245)
- [SWE-agent: Agent-Computer Interfaces](https://github.com/SWE-agent/SWE-agent)
- [Benchmark Self-Evolving Framework](https://aclanthology.org/2025.coling-main.223/)
- [TheAgentCompany Benchmark](https://openreview.net/forum?id=LZnKNApvhG)
- [Survey on LLM-based APR](https://arxiv.org/html/2506.23749v1)
