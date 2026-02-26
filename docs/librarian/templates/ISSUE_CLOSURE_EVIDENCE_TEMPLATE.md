# Issue Closure Evidence Template

Use this block when closing any M0 or ship-blocking issue.

```md
Fixed in <commit-sha>.

**What changed:** <1-2 sentences describing the implementation>
**Tests added:** <test file path(s) and what each one covers>
**Verified by:** `npm run build && npm test`
**Natural usage evidence:** <link to natural_usage_metrics.csv rows or run artifacts>
**Causal usefulness evidence:** <link to ablation_replay.csv + decision_trace.md>
**Restraint evidence:** <link to use-vs-skip precision/recall and unnecessary-query metrics>
**Patrol/CI signal review:** <link to latest relevant workflow runs and diagnosis summary>
```

If work is deferred to a baseline or out-of-scope track, do not close the issue. Keep it open and link the follow-up scope issue directly in a comment.
