# OpenAPI/REST Integration

Status: adapter contract (preview).

LiBrainian's protocol adapters normalize onto a canonical REST contract so frameworks can integrate through HTTP tooling.

## Prerequisites

- A running LiBrainian REST adapter endpoint
- `LIBRARIAN_API_BASE` set to the adapter base URL
- Optional bearer token if your deployment requires auth

## Working example

```bash
export LIBRARIAN_API_BASE="http://localhost:8787"
export LIBRARIAN_TOKEN=""

# discover schema
curl -sS "$LIBRARIAN_API_BASE/openapi.json" | jq '.info.title, .paths | keys'

# query context
curl -sS -X POST "$LIBRARIAN_API_BASE/v1/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LIBRARIAN_TOKEN" \
  -d '{"intent":"Trace authentication flow","workspace":"/workspace/app","depth":"L2"}' | jq
```

## Real-world use case

Use OpenAPI/REST when integrating LiBrainian with agent frameworks that already provide HTTP/OpenAPI tool wrappers (for example, LangChain toolkits or custom gateway layers).

## Troubleshooting

1. `404` on `/openapi.json`
   - Verify the REST adapter is running and routing docs endpoints.
2. `401` or `403` responses
   - Confirm bearer token policy and header wiring.
3. Schema mismatch in framework auto-tooling
   - Re-pull `openapi.json` and regenerate typed clients/tool definitions.

## Related tests

- `src/__tests__/integration_guide_docs.test.ts`
- `src/__tests__/docs_indexer.test.ts`
