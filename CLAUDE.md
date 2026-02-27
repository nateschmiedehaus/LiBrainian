# Claude Agent Instructions for LiBrainian

This file is the Claude-specific entrypoint. It adopts all repository rules from `AGENTS.md` and adds a strict launch-quality override.

## Source of Truth

- Primary operational contract: `AGENTS.md`
- Canonical testing policy: `docs/TEST.md`
- Launch state and evidence: `docs/LiBrainian/STATUS.md`, `docs/LiBrainian/GATES.json`
- Strategy tracker: `docs/LiBrainian/CONVERSATION_INSIGHTS.md`

## Mandatory Launch-Quality Rules

1. `REAL_AGENT_REAL_LIBRARIAN_ONLY`
   - Qualification and publish evidence must come from real agents running on real LiBrainian repos/workspaces.
2. `NO_RETRY_NO_FALLBACK_NO_DEGRADED_FOR_RELEASE`
   - Retry/fallback/degraded/unavailable/unverified evidence states are failures, not warnings.
3. `100% STRICT PASS FOR RELEASE EVIDENCE`
   - Release evidence must pass with zero strict-failure markers.
4. `AGENTIC QUALIFICATION REQUIRED`
   - Run `npm run test:agentic:strict` for publish-grade qualification.
5. `CONVERSATION INTELLIGENCE REQUIRED`
   - Update `docs/LiBrainian/CONVERSATION_INSIGHTS.md` at major planning checkpoints and before release-gate runs.
6. `PROOF_ARTIFACT_GATE_REQUIRED`
   - Never declare a milestone passed without running `node scripts/proof-review-gate.mjs` on the proof artifact and including its full output in the evidence.
   - The gate must exit 0 (zero failures). Warnings are acceptable; failures are not.
   - If the gate fails, the milestone is NOT passed regardless of what `all_passed` says in the artifact.
   - Also run `node scripts/adversarial-proof-validator.mjs` on the proof test source to verify test rigor.

## Disallowed for Release Evidence

- Synthetic or mock-only provider runs
- Reference-harness-only success claims
- Manual fallback artifacts treated as launch proof
- “Pass with caveats” when strict markers exist
