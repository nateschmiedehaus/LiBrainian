# M1 Versioning and Release Policy

Status: active  
Last Updated: 2026-02-26

## Semver Rules

- `major`: breaking API/CLI/behavior changes.
- `minor`: backward-compatible feature additions.
- `patch`: backward-compatible bug fixes and reliability hardening.

## M1 Closeout Rule

- M1 closeout targets a stable release after at least one successful `-rc.N` rehearsal.
- Stable cut (`vX.Y.Z`) requires all gates in `m1-release-charter.md` to pass.

## Prerelease Train

- Format: `vX.Y.Z-rc.N`
- Promotion requires:
  - no open critical/ship-blocking M1 issues,
  - strict qualification pass (`npm run test:agentic:strict`),
  - publish gate pass (`npm run eval:publish-gate -- --json`).

## Compatibility and Deprecation

- CLI commands keep compatibility aliases where practical (`librarian`/`librainian`).
- Public API deprecations must include:
  - release note callout,
  - migration guidance,
  - minimum one minor-version overlap before removal unless security-critical.

## Tagging and Provenance

- Every publish uses a matching git tag: `v<package.json version>`.
- Release provenance checks must pass via:
  - `npm run package:assert-release-provenance`
  - `npm run package:assert-identity`

## Required Release Notes Sections

- What changed
- Why it changed
- Migration impact
- Known limitations
- Verification evidence summary

