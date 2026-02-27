## Description

Brief description of the changes in this PR.

## User-Visible Flow Impact

What part of user experience gets better?
- [ ] GitHub landing / docs discoverability
- [ ] Install / quickstart
- [ ] Query and context quality
- [ ] Editing and contributor loop
- [ ] Publish / release confidence

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring (no functional changes)

## Related Issues

Closes #(issue number)

## How Has This Been Tested?

Describe the tests that you ran to verify your changes:

- [ ] Unit tests
- [ ] Integration tests
- [ ] Manual testing
- [ ] CLI quickstart manually verified (`npx librainian quickstart`)
- [ ] Query manually verified (`npx librainian query "..."`)

## Runtime Reality Evidence

Required for runtime-affecting changes (retrieval, provider/runtime, constructions, diagnostics).

- [ ] Patrol artifact link:
- [ ] Transcript excerpt:
- [ ] Post-fix comparison:

## Screenshots (if applicable)

Add screenshots for UI changes.

## Reality Verification (required for M0 issues)

See [REALITY_VERIFICATION.md](../docs/LiBrainian/REALITY_VERIFICATION.md) for the full protocol.

- [ ] Code merged to main: (this PR)
- [ ] T0 passes: `npm test` — link CI run or paste output
- [ ] T0.5 passes: T0.5 reality smoke test result — link or paste
- [ ] Reality evidence (check one):
  - [ ] **(a)** Patrol observation — link to `patrol-run-*.json` showing this feature tested
  - [ ] **(b)** Manual CLI test — paste command + actual output below
  - [ ] **(c)** T1 predetermined test — name the test that specifically covers the fix path

**Reality evidence artifact:**

```
(paste command + output, or link patrol report, or name T1 test)
```

> "Tests pass" alone does not satisfy closure. At least one reality evidence artifact is required.

---

## Checklist

- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review of my code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published
- [ ] `npm run package:assert-identity` passes
- [ ] `npm run package:install-smoke` passes
- [ ] `npm run eval:publish-gate -- --json` passes

## MCP Tool Checklist (required when adding/updating MCP tools)

- [ ] Token-optimized output (no unnecessary payload bloat)
- [ ] Reference-over-value path for large outputs
- [ ] Single-purpose deterministic behavior
- [ ] Error responses include actionable recovery guidance
- [ ] `annotations.readOnlyHint` set correctly
- [ ] Pagination controls for list-style outputs
- [ ] Dual-format output plan documented (structured + human-readable)

## Breaking Changes

If this is a breaking change, describe:
1. What breaks
2. Migration path for users
