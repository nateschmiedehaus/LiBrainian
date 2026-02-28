# Issue 892 Research

## Evidence Sources
- `state/issue-orchestration/milestone-summary.md`
- `docs/librarian/SCOPE_FREEZE.md`
- `AGENTS.md`
- `docs/TEST.md`
- `docs/librarian/REALITY_VERIFICATION.md`

## Open issue counts by milestone from state/issue-orchestration/milestone-summary.md
- M0 (Dogfood-Ready): 5 open
- M1 (Construction MVP): 51 open
- M2 (Agent Integration, FROZEN): 59 open
- M3 (Scale & Epistemics, FROZEN): 56 open
- M4 (World-Class, FROZEN): 158 open
- No Milestone: 7 open
- Total open issues analyzed: 336

## Freeze constraints from docs/librarian/SCOPE_FREEZE.md
- M2/M3/M4 are frozen (effective 2026-02-27); no new issues and no work starts there.
- All active execution focus is M0 then M1.
- Unfreeze requires human decision after M0 success metrics are met.
- Agents cannot unfreeze milestones unilaterally.

## Test/evidence constraints from AGENTS.md + docs/TEST.md + docs/librarian/REALITY_VERIFICATION.md
- Tier policy: T0 deterministic CI, T1 integration, T2 live agentic qualification.
- Release evidence must be real-agent/real-repo with zero fallback/retry/degraded/unverified markers.
- Publish-grade gate requires strict command chain (`npm run test:agentic:strict`).
- M0 closure requires all four: merged to main, T0 pass, T0.5 smoke pass, and at least one reality evidence artifact.
- Unit tests alone are not closure evidence.

## Failure modes observed in agent execution (long-running sessions, bootstrap/index coupling)
- Long-running sessions: orchestration jobs can stall without bounded runtime, leaving ambiguous completion state.
- Missing heartbeat: no periodic liveness signal makes hangs indistinguishable from slow progress.
- Bootstrap/index coupling: subagents that trigger bootstrap or full indexing can create heavy shared-state churn and cross-task interference.
- Non-fail-closed behavior risk: if timeout/health checks are absent, workflows can drift into implicit partial success.
