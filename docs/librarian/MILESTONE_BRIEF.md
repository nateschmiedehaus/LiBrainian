# Public Roadmap Snapshot

Last updated: 2026-03-24

This file is the public roadmap summary for the first real LiBrainian release.
For current issue state and detailed execution tracking, use GitHub issues and milestones.

## Current release target

Ship LiBrainian as a trustworthy first public version for coding agents and developers.

That means:
- the default CLI and MCP flows are useful on real repositories
- `query`, `status`, and `doctor` tell the truth
- onboarding and docs are clear enough for first-time users
- construction and evaluation surfaces no longer produce hollow success signals

## Release phases

### M0: Dogfood-ready foundation

Goal:
- LiBrainian is genuinely useful for building LiBrainian and other real repos

Required outcome:
- retrieval is good enough to guide real implementation work
- freshness and diagnostics are honest
- MCP discovery and default tool behavior are usable in real agent sessions
- evidence and evaluation use real repositories instead of circular local-only claims

Current active source issues:
- `#888` freshness and incremental re-index trust
- `#908` path-like query routing
- `#910` actionability and confidence guardrails
- `#912` architecture vs symbol routing
- `#716` real external-repo qualification and release evidence
- `#850` provider/runtime truthfulness in agent environments
- `#914` and `#917` as the minimal public MCP contract still required for trust

What is explicitly not M0 anymore:
- synthetic `meta: manage issue #...` wrappers
- MCP naming/description polish fragments that do not change trust or usability
- construction backlog or research backlog

### M1: First real public version

Goal:
- LiBrainian is coherent enough to present publicly as a serious open source tool

Required outcome:
- construction/runtime smoke signals are truthful
- the query pipeline is decomposed enough to maintain safely
- docs, onboarding, and help output present a clear stable path
- public package and CLI behavior match what the README promises

Current active source issues:
- `#718` query pipeline decomposition
- `#745` construction smoke truthfulness
- `#666` API surface index / hallucinated-method prevention
- `#890` external proof that LiBrainian materially improves real tasks over baseline tools

Missing release blockers identified by external-repo testing:
- impact analysis is still not decision-grade on smaller or graph-thin repos
- LiBrainian still overclaims when it marks some changes as safe to act on without quick direct verification
- nested-session/provider truthfulness still leaks into user trust

What is explicitly not M1 anymore:
- frozen research items
- post-ship construction catalogs
- patrol/process meta umbrellas
- transport expansion work that is not required for the first supported public path

### M2 and beyond

Frozen until the first public version is stable.

Future phases will cover:
- broader protocol adapters and agent integrations
- large-scale evaluation and calibration work
- longer-horizon research and advanced capability tracks

## What "ready" means now

LiBrainian is ready for its first public release only when all of these are true:

- a new user can install it, run `quickstart`, run `query`, and understand success or failure quickly
- an agent can use LiBrainian first for real refactor and debugging tasks and get a clear net benefit
- the public docs distinguish stable paths from preview or maintainer-only surfaces
- the package version, CLI version, and visible documentation agree
- release evidence comes from real agent workflows on real repositories
