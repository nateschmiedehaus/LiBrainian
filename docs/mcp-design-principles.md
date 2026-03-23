# MCP Design Principles

Last updated: 2026-03-23

This document defines the public MCP design rules for the LiBrainian release surface.

## Principle 1: Token-Optimized Responses

- Prefer concise summaries over raw dumps.
- Include only the minimum fields needed for action.
- Put large payloads behind explicit fetch steps.

Why: keeps agent context windows usable and lowers cost.

## Principle 2: Reference Over Value

- If output exceeds practical inline size, return a reference instead of full content.
- Prefer artifact or file-path handoff for large exports.

Why: avoids flooding context with low-signal bulk data.

## Principle 3: Small, Deterministic Blocks

- One tool should do one thing.
- Avoid hidden multi-phase behavior that mixes discovery, mutation, and reporting.
- Keep output shape stable and predictable.

Why: deterministic tools are easier for agents to chain and verify.

## Principle 4: Self-Healing Errors

- Errors must include:
  - what failed
  - current state when available
  - the next command to recover

Why: every failure should provide a direct recovery path.

## Principle 5: Explicit Safety Hints

- Every advertised tool must declare `annotations.readOnlyHint`.
- Mutating tools should also declare destructive/idempotent hints when they are ever exposed.

Why: lets clients safely plan tool calls.

## Principle 6: Public Surface First

- `tools/list` should advertise only the stable public golden path.
- Internal or maintainer-only tools may remain callable in controlled contexts but must stay out of the default advertised surface.
- Public docs must describe the advertised surface, not the internal inventory.

Why: the first-release agent experience should be small, legible, and trustworthy.

## Principle 7: Standard Golden-Path Envelope

- Golden-path tool responses should expose:
  - `summary`
  - `confidence`
  - `dataQuality`
  - `warnings`
  - `followUp`
  - raw `result`

Why: agents need a stable contract for fast judgment without losing access to the underlying payload.

## Public MCP Surface (2026-03-23)

LiBrainian's advertised public MCP surface is the 10-tool golden path defined in `src/mcp/types.ts`.
Internal tools are intentionally omitted from default `tools/list`.

| Tool | Use for |
|---|---|
| `query` | Cross-file architecture, behavior, and impact reasoning |
| `get_context_pack` | Task-shaped context before multi-file edits |
| `find_symbol` | Exact symbol lookup |
| `get_change_impact` | Blast radius and pre-edit impact estimation |
| `explain_function` | Function-level behavior explanation |
| `find_usages` | Exact caller and usage tracing |
| `get_repo_map` | Fast repository orientation |
| `describe_capabilities` | Discover the stable public tool contract |
| `run_health_check` | Diagnose index and environment readiness |
| `query_codebase` | Composition-backed codebase querying on the public surface |

## Public Surface Rules

- Public tool names should be descriptive and task-shaped.
- Legacy aliases may remain callable for compatibility but should stay hidden from `tools/list`.
- Public schemas should hide legacy snake_case-only query aliases and internal-only parameters such as `blast_radius`.
- Every advertised tool description should follow the 4-part template:
  - when to use it
  - what to provide
  - what it returns
  - what it is not for

## Release Checklist For MCP Changes

Every PR that adds or changes an advertised MCP tool must confirm:

1. Token-optimized response shape.
2. Reference-over-value behavior for large payloads.
3. Single-purpose deterministic behavior.
4. Error includes recovery guidance.
5. Safety annotations are present.
6. Public-surface filtering remains intentional.
7. Golden-path response envelope remains stable where applicable.
