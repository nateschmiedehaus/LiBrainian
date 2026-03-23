# MCP Constructions Guide

This is a source-checkout maintainer guide for the deferred constructions MCP surface.
`list_constructions`, `invoke_construction`, and `describe_construction` are not part of the
default public 0.2.x MCP golden path. They are only exposed when maintainer mode is enabled.

Do not treat this page as current public package documentation. For the stable public MCP surface,
use the golden-path tools documented in [docs/integrations/mcp.md](/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian/docs/integrations/mcp.md).

## What You Get

- Discovery: `list_constructions` returns available construction manifests, tags, capabilities, trust tier, and schemas.
- Typed invocation: `invoke_construction` validates input against each construction manifest `inputSchema`.
- Structured outputs: construction results include confidence, evidence refs, analysis timing, and prediction metadata when available.
- Actionable errors: unknown IDs include similar-construction suggestions; schema failures include validation failures and schema reference.

## Typical Flow

1. Call `list_constructions` with optional filters (`tags`, `requires`, `language`, `trustTier`, `availableOnly`).
2. Pick `constructionId` from the result.
3. Call `invoke_construction` with:
   - `constructionId`
   - `input` matching that construction's `inputSchema`
   - optional `workspace`

## Claude Code Example

```json
{
  "tool": "list_constructions",
  "args": {
    "tags": ["security"],
    "language": "typescript",
    "availableOnly": true
  }
}
```

```json
{
  "tool": "invoke_construction",
  "args": {
    "constructionId": "librainian:security-audit-helper",
    "input": {
      "files": ["src/mcp/server.ts"],
      "checkTypes": ["injection", "authz"]
    }
  }
}
```

## Cursor MCP Example

```json
{
  "tool": "list_constructions",
  "args": {
    "requires": ["librarian"],
    "trustTier": "official",
    "availableOnly": true
  }
}
```

```json
{
  "tool": "invoke_construction",
  "args": {
    "constructionId": "librainian:refactoring-safety-checker",
    "workspace": "/path/to/workspace",
    "input": {
      "entityId": "src/api/query.ts",
      "refactoringType": "rename"
    }
  }
}
```

## Error Contract Highlights

- Unknown construction:
  - `error: "CONSTRUCTION_NOT_FOUND"`
  - `suggestions: ["..."]`
- Manifest input validation failure:
  - `error: "INPUT_VALIDATION_FAILED"`
  - `validationFailures: ["..."]`
  - `schemaRef: "construction:<id>:input"`
