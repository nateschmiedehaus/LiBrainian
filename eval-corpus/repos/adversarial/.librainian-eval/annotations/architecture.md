# Adversarial Repo Architecture (Verified)

## Storage
- User and session state live in memory via Map-backed collections in src/storage/db.ts.
- No database client exists in the fixture.

## Audit Pipeline
- recordAudit delegates to a pluggable audit adapter chosen by config.auditAdapter.
- loadAuditAdapter falls back to a dynamic require when the adapter name is not in the static map.

## Known Mismatches
- README.md and docs/ARCHITECTURE.md describe a Postgres + worker architecture that is not present.
- Several comments claim stronger crypto or retention policies than implemented.
