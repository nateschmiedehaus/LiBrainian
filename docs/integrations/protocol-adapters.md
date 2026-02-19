# Protocol Adapters Reference

This reference describes how integration surfaces map to LiBrainian's canonical interface.

## Canonical interface

- Canonical request/response shape: OpenAPI/REST contract
- Canonical operation family: query, status, health, feedback
- Canonical evidence fields: summary, related files, citations, confidence metadata

## Adapter model

| Surface | Adapter role | Notes |
| --- | --- | --- |
| CLI | Native command transport | Available now |
| MCP | Native tool transport | Available now |
| OpenAPI/REST | Canonical interface | Preview adapter contract |
| UTCP | Envelope translator to canonical REST | Preview adapter contract |
| A2A | Task translator to canonical REST | Preview adapter contract |
| Python SDK | Typed client over canonical REST | Preview adapter contract |

## Compatibility requirements

Every adapter should preserve these invariants:

1. Preserve request intent text without lossy rewriting.
2. Preserve workspace identity and path boundaries.
3. Preserve confidence and citation fields from upstream responses.
4. Surface errors with stable machine-readable codes.

## Building a new adapter

1. Map inbound protocol payloads to the canonical request schema.
2. Forward to canonical operations (`query`, `status`, `health`, `feedback`).
3. Map canonical responses back to the protocol without dropping evidence fields.
4. Add integration tests for translation correctness and error handling.

## Related tests

- `src/__tests__/integration_guide_docs.test.ts`
- `src/__tests__/capability_contracts.test.ts`
