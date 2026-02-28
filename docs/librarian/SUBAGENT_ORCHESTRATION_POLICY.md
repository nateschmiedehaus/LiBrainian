# Subagent Orchestration Policy

## Purpose
Define mandatory controls for multi-agent issue execution to keep delivery aligned with milestone and evidence policy.

## Mandatory Rules

### 1) Milestone order is mandatory (`M0 -> M1` first)
- Subagent work may execute only for M0 issues, then M1 issues.
- Do not schedule later milestones until M0 and M1 priorities are satisfied.

### 2) Frozen milestone block
- M2, M3, and M4 are frozen.
- No new execution tasks, planning tasks, or implementation tasks may target frozen milestones.
- Only explicit human unfreeze decision can lift this block.

### 3) No bootstrap in subagents
- Subagents must not run bootstrap/full-index/reindex flows.
- Parent orchestration must provide needed context without triggering shared bootstrap churn.

### 4) Timeout + heartbeat + fail-closed requirements
- Every subagent run must have a fixed timeout.
- Every run must emit periodic heartbeat updates.
- Missing heartbeat, timeout breach, or ambiguous completion must fail closed (status = failed, not partial success).

### 5) Required evidence block before closure
Before closing any M0/M1 issue, include all required evidence:
- Code merged to main
- T0 pass
- T0.5 reality smoke pass
- At least one reality artifact (patrol/manual CLI/T1 predetermined)

Closure without this evidence block is policy-noncompliant.
