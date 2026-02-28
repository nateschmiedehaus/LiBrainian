# M0 Demo Run Template (Issue Execution Evidence)

## Run Metadata
- Issue: `<#ID>`
- Milestone: `M0`
- Branch/Commit: `<branch>@<sha>`
- Operator: `<name>`
- Start (UTC): `<timestamp>`
- Timeout budget: `<minutes>`
- Heartbeat interval: `<seconds>`

## Preconditions
- [ ] Milestone verified as M0
- [ ] Task scope excludes bootstrap/full-index actions
- [ ] Required tests and evidence expectations acknowledged

## Execution Log
```text
[HH:MM:SS] run-start
[HH:MM:SS] heartbeat
[HH:MM:SS] change-applied
[HH:MM:SS] heartbeat
[HH:MM:SS] tests-start
[HH:MM:SS] tests-complete
[HH:MM:SS] run-complete
```

## Verification Evidence Block
- [ ] Code merged to main: `<PR/commit link>`
- [ ] T0 passes: `<CI link or output ref>`
- [ ] T0.5 passes: `<smoke evidence>`
- [ ] Reality evidence artifact (a/b/c): `<artifact link or pasted output>`

## Outcome
- Status: `pass | fail`
- Fail-closed reason (if fail): `<timeout | missed heartbeat | missing evidence | test failure>`
