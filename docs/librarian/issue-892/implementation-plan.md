# Implementation Plan

## P0 (immediate)
Goal: establish enforceable orchestration policy and run template for M0/M1 work only.

Checklist:
- [ ] Create and publish orchestration policy doc.
- [ ] Add issue-892 research, verdict, and demo-run template.
- [ ] Use timeout + heartbeat + fail-closed defaults for all subagent executions.
- [ ] Block any bootstrap/reindex action in subagent task prompts.
- [ ] Require evidence block before closure.

Commands:
```bash
mkdir -p state/issue-892 docs/librarian
# Create policy and issue-892 state documents
git status --short
```

Execution checklist for each issue run:
- [ ] Confirm issue milestone is M0 or M1.
- [ ] Confirm task does not call bootstrap/full index.
- [ ] Set execution timeout and heartbeat interval.
- [ ] Abort and mark failed if heartbeat missing or timeout exceeded.
- [ ] Collect closure evidence block before marking complete.

## P1 (next)
Goal: operationalize policy checks in repeatable issue orchestration runs.

Checklist:
- [ ] Add pre-run milestone gate check to orchestration workflow.
- [ ] Add runtime monitor for timeout + heartbeat enforcement.
- [ ] Add standardized evidence block emitter for closure comments.
- [ ] Run one M0 demonstration execution and archive artifacts.

Commands:
```bash
# Pre-run validation
LiBrainian query "Confirm milestone and closure requirements for issue <ID>"

# Post-run verification
npm test
# Run T0.5 smoke as defined for current branch/repo workflow
```
