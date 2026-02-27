# M1 Release Readiness Charter

Status: active  
Milestone: `M1: Construction MVP`  
Last Updated: 2026-02-26  
Owners: librarianship + release maintainers

## Purpose

This charter defines when M1 is truly release-ready for first-time agent users and existing users.  
Milestone completion is blocked unless all M1 gates are green.

## M1 Exit Gates

| Gate ID | Requirement | Local Command | CI Signal | Pass | Fail |
| --- | --- | --- | --- | --- | --- |
| M1-G1 | Build integrity | `npm run build` | `build` job | Build succeeds | Any compile/runtime build failure |
| M1-G2 | Core deterministic regression suite | `npm test -- --run` | `test` job | Full suite passes | Any failing test |
| M1-G3 | Real-agent strict qualification | `npm run test:agentic:strict` | strict qualification workflow | Zero strict-failure markers | Retry/fallback/degraded/unverified markers |
| M1-G4 | Publish-gate evidence integrity | `npm run eval:publish-gate -- --json` | publish gate report | All required evidence gates green | Any blocked gate |
| M1-G5 | Package identity + provenance | `npm run package:assert-identity && npm run package:assert-release-provenance` | release preflight | Semver/tag/provenance checks pass | Identity/provenance mismatch |
| M1-G6 | Public pack and install smoke | `npm run public:pack && npm run package:install-smoke` | pack/install smoke | Tarball validity and install checks pass | Missing/broken runtime artifacts |
| M1-G7 | Release docs quality gates | `npm test -- --run src/__tests__/github_readiness_docs.test.ts src/__tests__/package_release_scripts.test.ts src/__tests__/npm_publish_workflow.test.ts src/__tests__/m1_release_charter_docs.test.ts` | docs/tests CI stage | Required docs + scripts verified | Missing or inconsistent docs/scripts |
| M1-G8 | Dry-run bundle present and reviewed | `npm run release:m1:dry-run-bundle` | artifact publish in CI | Dry-run bundle exists at documented path | Missing dry-run artifact |

## Freeze Policy

- M1 freeze starts when all non-doc M1 implementation issues are closed or explicitly deferred.
- During freeze, only:
  - release blockers,
  - test regressions, and
  - charter/docs accuracy fixes  
  may merge.
- Any new feature work routes to M2+ unless explicitly approved as release-blocking.

## Blocker Policy

- A release blocker is any condition that fails M1-G1..M1-G8.
- Blockers must include:
  - reproducible command output,
  - root cause summary, and
  - explicit fix owner.
- Blocker resolution must link evidence artifacts, not narrative-only claims.

## Rollback Policy

- If post-release critical regression is detected:
  1. Pause automated release promotion.
  2. Publish rollback note with affected versions and user impact.
  3. Restore last known good tag/package.
  4. Open follow-up issue(s) with regression test requirements before next publish.

## Versioning and Release Train

- Canonical policy: [versioning-policy.md](./versioning-policy.md)
- Pre-release train:
  - `vX.Y.Z-rc.N` for M1 finalization rehearsals.
  - Promote to stable `vX.Y.Z` only after all M1 gates pass.
- Post-M1 patch policy:
  - Patch releases for backward-compatible fixes only.
  - Minor releases for additive, compatible capabilities.
  - Major releases for breaking API/behavioral changes.

## First-Time Agent Documentation Quality Set

Required docs and guidance:

- Install and first query path with `npx librainian ...`.
- Programmatic path with `initializeLibrarian(...)`.
- Upgrading from prior versions.
- Natural usage guidance:
  - Use LiBrainian when uncertainty is meaningful.
  - Skip LiBrainian for deterministic trivial edits.
  - Avoid ceremonial over-querying.

## M1 Goals to Evidence Mapping

| M1 Goal | Primary Issue(s) | Required Evidence |
| --- | --- | --- |
| Construction MVP is usable and composable | #355, #375, #706 | construction docs/tests, package/public validation |
| LiBrainian dogfoods itself with measurable value | #833, #842 | natural usage metrics, decision traces, strict gates |
| Change-scoped test strategy exists | #838 | planner construction tests + test-sequence artifacts |
| Release quality is explicit and enforceable | #841 | this charter, versioning policy, dry-run bundle, checklist scripts |

## Release Checklist Commands

```bash
npm run release:m1:dry-run-bundle
npm run release:m1:checklist
```

