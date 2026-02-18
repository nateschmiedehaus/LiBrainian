# MCP Design Principles

Last updated: 2026-02-18

This document defines the canonical design rules for LiBrainian MCP tools.

## Principle 1: Token-Optimized Responses

- Prefer concise summaries over raw dumps.
- Include only the minimum fields needed for action.
- Put large payloads behind explicit fetch steps.

Why: keeps agent context windows usable and lowers cost.

## Principle 2: Reference Over Value

- If output exceeds practical inline size, return a reference (file path, id, URI) instead of full content.
- Prefer `outputPath`/artifact patterns for large exports.

Why: avoids flooding context with low-signal bulk data.

## Principle 3: Small, Deterministic Blocks

- One tool should do one thing.
- Avoid hidden multi-phase behavior that mixes discovery, mutation, and reporting.
- Keep output shape stable and predictable.

Why: deterministic tools are easier for agents to chain and verify.

## Principle 4: Self-Healing Errors

- Errors must include:
  - what failed,
  - current state (when available),
  - the next command to recover.

Why: every failure should provide a direct recovery path.

## Principle 5: `readOnlyHint` On Every Tool

- Every tool must declare `annotations.readOnlyHint`.
- Mutating tools should also declare `destructiveHint` and `idempotentHint`.

Why: lets clients safely plan tool calls.

## Principle 6: Pagination For List-Style Tools

- Any tool that can return large lists should support bounded retrieval and predictable paging.
- Use limit/page-style controls and deterministic ordering.

Why: protects token budget and improves repeatability.

## Principle 7: Dual Format Responses

- Return machine-usable structured content and human-readable summaries.
- Keep schemas explicit and versionable.

Why: agents and humans both need first-class output modes.

## Current Audit (2026-02-18)

Tool inventory audited: 18 MCP tools in `src/mcp/server.ts`.

| Tool | P1 | P2 | P3 | P4 | P5 | P6 | P7 | Notes |
|---|---|---|---|---|---|---|---|---|
| `bootstrap` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Dual-format follow-up tracked in #63 |
| `status` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Dual-format follow-up tracked in #63 |
| `system_contract` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Dual-format follow-up tracked in #63 |
| `diagnose_self` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Dual-format follow-up tracked in #63 |
| `list_verification_plans` | Pass | Pass | Pass | Pass | Pass | Gap | Gap | Pagination follow-up tracked in #64 |
| `list_episodes` | Pass | Pass | Pass | Pass | Pass | Gap | Gap | Pagination follow-up tracked in #64 |
| `list_technique_primitives` | Pass | Pass | Pass | Pass | Pass | Gap | Gap | Pagination follow-up tracked in #64 |
| `list_technique_compositions` | Pass | Pass | Pass | Pass | Pass | Gap | Gap | Pagination follow-up tracked in #64 |
| `select_technique_compositions` | Pass | Pass | Pass | Pass | Pass | Gap | Gap | Pagination follow-up tracked in #64 |
| `compile_technique_composition` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Structured output follow-up tracked in #63 |
| `compile_intent_bundles` | Pass | Pass | Pass | Pass | Pass | Gap | Gap | Pagination follow-up tracked in #64 |
| `query` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Structured output follow-up tracked in #63 |
| `submit_feedback` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Structured output follow-up tracked in #63 |
| `verify_claim` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Structured output follow-up tracked in #63 |
| `run_audit` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Structured output follow-up tracked in #63 |
| `diff_runs` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Structured output follow-up tracked in #63 |
| `export_index` | Pass | Gap | Pass | Pass | Pass | N/A | Gap | Large-output reference/pagination follow-up tracked in #64 |
| `get_context_pack_bundle` | Pass | Pass | Pass | Pass | Pass | N/A | Gap | Structured output follow-up tracked in #63 |

## Violation Tracking

Active issues used as violation trackers:

- #63 Define typed `ConstructionResult` interface with Zod schemas
- #64 Add pagination and reference-over-value to all list-type MCP tools

No additional violation tracker issue was needed because current gaps map to existing open work.

## New Tool PR Checklist

Every PR that adds or changes an MCP tool must confirm:

1. Token-optimized response shape.
2. Reference-over-value handling for large payloads.
3. Single-purpose deterministic behavior.
4. Error includes fix command/state hint.
5. `annotations.readOnlyHint` set.
6. Pagination controls for list outputs.
7. Dual-format output strategy documented.
