# ImpactAwareTestSequencePlanner

`impact-aware-test-sequence-planner` builds a change-scoped and intent-aware test execution sequence.

## When to use

Use this construction when a change has non-trivial uncertainty and you want:

- a high-signal test order (`smoke` -> `targeted` -> `regression`),
- explicit per-test rationale (`why_this_test` style evidence),
- fallback escalation when confidence is low.

## Input

```json
{
  "intent": "Users get logged out randomly after idle time",
  "changedFiles": ["src/auth/session.ts"],
  "changedFunctions": ["src/auth/session.ts:refreshSession"],
  "diff": "optional unified diff",
  "maxInitialTests": 8,
  "includeFallbackSuite": true,
  "fallbackCommand": "npm test -- --run",
  "confidenceThresholdForFallback": 0.58
}
```

## Output

```json
{
  "groups": [
    {
      "stage": "smoke",
      "tests": ["tests/unit/session_refresh.test.ts"],
      "rationale": "Fast, high-signal smoke checks first to detect immediate breakage in impacted surfaces.",
      "confidence": 0.74
    },
    {
      "stage": "targeted",
      "tests": ["tests/integration/auth_logout.integration.test.ts"],
      "rationale": "Impact-matched tests for changed files, symbols, and intent-driven coverage.",
      "confidence": 0.74
    }
  ],
  "selectedTests": [
    {
      "testPath": "tests/unit/session_refresh.test.ts",
      "stage": "smoke",
      "score": 0.91,
      "reason": "matches impacted file stem: src/auth/session.ts; aligned with intent tokens: session"
    }
  ],
  "skippedTests": ["tests/unit/math_utils.test.ts"],
  "impactedFiles": ["src/auth/session.ts", "src/api/auth_controller.ts"],
  "impactedSymbols": ["refreshSession", "handleRefresh"],
  "confidence": 0.74,
  "escalationPolicy": {
    "enabled": true,
    "reason": "failure",
    "trigger": "run fallback suite if staged tests fail",
    "fallbackCommand": "npm test -- --run"
  }
}
```

## Notes

- If `changedFiles`/`changedFunctions`/`intent` are missing, the planner returns fallback-only guidance.
- If call-graph storage is available, transitive impact is incorporated into candidate ranking.
- Use `selectedTests`, `skippedTests`, and `escalationPolicy` for decision trace artifacts.
