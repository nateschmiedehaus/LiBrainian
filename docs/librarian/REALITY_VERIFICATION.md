# Reality Verification Protocol

**Applies to**: All M0 (Dogfood-Ready) issues. Recommended for M1+.

---

## The Problem

"Tests pass" is necessary but not sufficient for issue closure. Unit tests can be green while the CLI is broken, a command does not exist, output is garbage, or a feature silently degrades. Reality verification means confirming that *user-visible behavior actually works*, not just that the test harness is green.

---

## Required Criteria for M0 Issue Closure

All four of the following must be satisfied:

### 1. Code change merged to main
The PR must be merged. Draft PRs, open PRs, and local branches do not count.

### 2. T0 passes
`npm test` passes on the merged commit. Necessary but not sufficient.

### 3. T0.5 reality smoke test passes
The T0.5 reality smoke test (#854) must pass. This validates that the CLI starts, commands are registered, and basic end-to-end flows work.

### 4. At least ONE reality evidence artifact

| Type | Description | Example |
|------|-------------|---------|
| **(a) Patrol observation** | Agent Patrol run exercising the specific feature | `patrol-run-YYYY-MM-DD.json` showing feature tested |
| **(b) Manual CLI test** | Command + actual output pasted in closing comment | `$ librainian query "error handling"` + full output |
| **(c) T1 predetermined test** | Predetermined-model test covering the fixed behavior path | `query_pipeline.test.ts::should return results for known topic` |

---

## Closure Comment Template

Every M0 issue closing comment must include:

```markdown
## Closure verification

- [ ] Code merged to main: <PR link>
- [ ] T0 passes: <CI link or `npm test` output>
- [ ] T0.5 passes: <evidence>
- [ ] Reality evidence: <type (a/b/c)> — <artifact link or pasted output>
```

---

## What Does NOT Count

- "Tests pass" alone
- Mock-only or synthetic test results
- "Works on my machine" without documented output
- Agent self-report without artifacts
- PR merged (merge does not equal verification)
- CI green badge without a linked run
- "Looks good to me" without running the feature

---

## Why This Protocol Exists

195 issues were reopened because "tests pass" was treated as sufficient closure evidence. This protocol breaks the premature-closure loop. Closed means actually done, with proof.
