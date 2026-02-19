# UTCP Integration

Status: adapter contract (preview).

UTCP integration maps UTCP tool envelopes to LiBrainian's canonical query contract.

## Prerequisites

- A UTCP runtime that can dispatch JSON envelopes
- A translator layer from UTCP payloads to LiBrainian REST requests
- LiBrainian workspace path available to the adapter

## Working example

```typescript
// Minimal UTCP -> LiBrainian translator

type UtcpInvoke = {
  tool: 'librarian.query';
  input: { intent: string; workspace: string; depth?: 'L0' | 'L1' | 'L2' | 'L3' };
};

type LibrarianQueryRequest = {
  intent: string;
  workspace: string;
  depth: 'L0' | 'L1' | 'L2' | 'L3';
};

export function translateUtcpToQuery(req: UtcpInvoke): LibrarianQueryRequest {
  return {
    intent: req.input.intent,
    workspace: req.input.workspace,
    depth: req.input.depth ?? 'L2',
  };
}
```

## Real-world use case

Use UTCP when your orchestration layer already routes tools through a unified protocol bus and you want LiBrainian available as another tool target.

## Troubleshooting

1. UTCP invocation fails schema validation
   - Validate envelope keys and enum values before dispatch.
2. Adapter returns incomplete context
   - Ensure default depth is set (`L2` is typical for implementation context).
3. Workspace mismatch errors
   - Normalize absolute workspace paths in the translator before forwarding.

## Related tests

- `src/__tests__/integration_guide_docs.test.ts`
- `src/__tests__/capability_contracts.test.ts`
