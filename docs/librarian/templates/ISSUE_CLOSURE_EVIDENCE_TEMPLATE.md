# Issue Closure Evidence Template

Use this block when closing any M0 or ship-blocking issue.

```md
Fixed in <commit-sha>.

**What changed:** <1-2 sentences describing the implementation>
**Tests added:** <test file path(s) and what each one covers>
**Verified by:** `npm run build && npm test`
```

If work is deferred to a baseline or out-of-scope track, do not close the issue. Keep it open and link the follow-up scope issue directly in a comment.
