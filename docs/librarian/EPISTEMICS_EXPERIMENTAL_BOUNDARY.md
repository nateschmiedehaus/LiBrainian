# Epistemics Experimental Boundary

Date: 2026-02-18
Status: Accepted

## Problem
Several epistemics modules were implemented but not part of active production query/runtime paths, while still appearing in the default epistemics surface and package payload.

## Decision
Use a fail-closed public surface:
- remove inactive modules from the default `src/epistemics/index.ts` exports
- keep explicit internal experimental namespace (`src/epistemics/experimental/index.ts`)
- exclude inactive module artifacts from the published package (`package.json` `files` exclusions)

## Affected Modules
- `belief_functions`
- `belief_revision`
- `calibration_laws`
- `causal_reasoning`
- `conative_attitudes`
- `credal_sets`
- `intuitive_grounding`

## Verification
- Stable surface regression: `src/epistemics/__tests__/experimental_surface.test.ts`
- Package payload check: `npm run public:pack`
