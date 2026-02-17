# LiBrainian Audit

Status: partial
Scope: full system audit for truthfulness, wiring, and evidence.
Last Verified: 2026-01-04
Owner: librarianship
Evidence: docs only (implementation evidence lives in STATUS.md)

## Audit Goals
- Confirm system behavior matches architecture.
- Verify evidence-backed knowledge construction.
- Detect gaps between documentation and reality.
- Produce a reproducible evidence pack.

## Audit Preconditions
- Providers authenticated via CLI.
- Daily model selection executed and logged.
- Workspace clean with audited branch checked out.

## Audit Phases

### Phase 1: Documentation Integrity
- Check canonical docs align (no contradictions).
- Ensure each claim links to evidence.
- Verify STATUS is evidence-only.
- Verify `docs/LiBrainian/hazard_register.md` is updated for any new features.

### Phase 2: Implementation Mapping
- Map each subsystem to code locations.
- Verify wiring through query pipeline and event bus.
- Audit exports in `src/LiBrainian/index.ts` for real callers.

### Phase 3: Storage + Pipeline Validity
- Validate migrations and storage schema.
- Verify ingest -> storage -> query pipeline wiring.
- Confirm understanding records and maps are persisted.

### Phase 4: Knowledge Validity
- Sample entities and verify understanding records.
- Confirm traces point to real evidence.
- Check confidence calibration and defeaters.

### Phase 5: Scenario Execution
- Run representative scenarios from `docs/LiBrainian/scenarios.md`.
- Record outputs, confidence, and traces.
- Include language onboarding scenarios (S-LANG-001/002).

### Phase 6: Provider + Model Checks
- Run provider checks and log results.
- Verify model policy selection for the day.

### Phase 7: Gap + Dead-Code Analysis
- Map G1-G25 and R0-R10 to evidence.
- Identify exported-but-uncalled modules and isolated files.

## Required Outputs
- Summary report with verified/partial/planned outcomes.
- Evidence links to code, tests, and audit artifacts.
- Model selection record for the run date.

## Evidence Checklist
- Source code references
- Tests and assertions
- Audit logs in `state/audits/`
- Provider availability traces
- Model selection record
- Language adapter detection logs (or explicit gaps)

## Audit Commands (Minimum)
- `npm run test:tier0`
- `npm test`
- `npm run evidence:manifest`
- `npm run evidence:reconcile`

## Output Artifacts
- Summary report
- Gap list with severity
- Recommendations with evidence
- Raw provider doc snapshots

## Legacy Material
Use `docs/LiBrainian/legacy/COMPREHENSIVE_AUDIT_PROMPT.md` as a deep appendix.
