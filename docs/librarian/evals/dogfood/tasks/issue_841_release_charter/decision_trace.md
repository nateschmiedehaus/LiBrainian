# Decision Trace: Issue #841 (M1 Release Readiness Charter)

- Task: add enforceable M1 release charter, versioning policy, and dry-run bundle workflow.
- LiBrainian status check: healthy but index freshness reported new unindexed files.
- LiBrainian query result:
  - latency: ~88s,
  - confidence: 0.478,
  - coherence warning: 38%,
  - useful hint extracted: map charter gates to existing strict publish and evidence commands.
- Decision impact:
  - Used query hints to anchor charter gates to existing `test:agentic:strict` and `eval:publish-gate` flows.
  - Ignored low-coherence pack suggestions unrelated to release docs.
- Restraint:
  - Stopped after one query due low coherence and moved to deterministic repository inspection.
- Improvement request:
  - For release-readiness intents, prioritize docs/scripts/package surfaces over unrelated function-context packs.

## 2026-02-26 Continuation (stability triage while #841 remains open)

- Intent: investigate full-suite failure and decide whether it is product regression or load-sensitive test flake.
- LiBrainian usage:
  - `npx librainian status` returned successfully and showed stale/unindexed workspace drift.
  - First `npx librainian query "<intent>"` attempt hung with no output while stale lock state existed (`.librarian/librarian.db.lock` with non-live PID), requiring manual process cleanup.
  - Second query run (`--no-synthesis --strategy heuristic`) completed and produced actionable fallback context.
- Decision impact:
  - Treated the no-output/hanging query as a natural-use failure signal (availability/health issue).
  - Switched to deterministic code-path diagnosis for lock + flaky-threshold behavior.
  - Implemented load/memory-aware thresholding in `hallucinated_api_detector` perf test to remove CI/full-suite false negatives while preserving strict bounds in normal conditions.
- Restraint:
  - Stopped at one successful query after the failed/hung attempt and did not force repeated retries.
- Improvement request:
  - Query command should fail fast with actionable lock-holder diagnostics when lock state is stale/contended instead of producing prolonged no-output sessions.
