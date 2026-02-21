# Autonomous Fix Scoping Policy

## Purpose
Define a deterministic policy for classifying run output in autonomous loops so agents can separate:
- `must_fix_now`: real regressions/blockers that must be fixed before issue closure.
- `expected_diagnostic`: known stderr/noise emitted by intentional negative-path tests or instrumentation.
- `defer_non_scope`: failures explicitly mapped to known baseline issues outside the current issue scope.

This policy applies to both:
- LiBrainian core repository workflows.
- Client repositories where LiBrainian is used for diagnosis/planning/remediation.

## Canonical Classifier
Use the API classifier from:
- `src/api/run_diagnostics_scope.ts`

Primary entrypoint:
- `classifyRunDiagnosticsScope(input)`

Input contract:
- `repositoryRole`: `core | client`
- `commandResults[]`: command, exit code, stdout/stderr, timeout metadata
- `baselineIssueRefs[]`: optional known baseline mapping `{pattern, issue?}` (`issue` optional)

Output contract:
- `RunDiagnosticsScopeReport.v1`
- grouped findings (`mustFixNow`, `expectedDiagnostics`, `deferNonScope`)
- deterministic `overallVerdict`
- prioritized minimal `fixQueue`
- deterministic `deferIssueQueue` for deferred follow-up actions:
  - `link_existing_issue` when mapped issue exists
  - `create_or_update_issue` when no issue id is provided

## Construction-Level Helper
For orchestration pipelines, use:
- `createRunDiagnosticsScopeConstruction()` in `src/constructions/processes/run_diagnostics_scope_construction.ts`

Output envelope:
- `RunDiagnosticsScopeResult.v1`

## MCP Surface
MCP tool:
- `scope_run_diagnostics`

Tool goal:
- return a machine-readable remediation summary for autonomous agents before closure decisions.

## CLI Surface
CLI command path:
- `LiBrainian diagnose --run-output-file <path> [--repository-role core|client]`

Expected behavior:
- includes `diagnosticsScope` in JSON output.
- includes verdict/count summary in text mode.

## Issue Closure Policy
An issue is closure-eligible when all are true:
1. Scope report `overallVerdict` is not `must_fix_now`.
2. Any `defer_non_scope` item is represented in `deferIssueQueue` (`link_existing_issue` or `create_or_update_issue`).
3. Closure comment includes:
   - commands run
   - scope verdict
   - tests added/updated
   - baseline deferrals and corresponding deferred issue actions

If `must_fix_now` exists, do not close; execute queue items first.

## Client Repository Applicability
For client repos (`repositoryRole=client`):
- keep same classification semantics.
- preserve deferral mapping to client-tracker issues.
- mark shared infra failures (e.g., missing commands/config hooks) as `appliesTo: shared` in fix queue.

This keeps autonomous behavior consistent across core and downstream usage.
