# Publishing Constructions

LiBrainian constructions are published with a `construction.manifest.json` contract.
This contract is machine-readable and is used for agent routing, validation, and composition compatibility.

## Manifest Contract

Each package must include a `construction.manifest.json` file at package root.

Required fields:

- `id`: Stable machine identifier (`librainian:<slug>` or `@scope/name`)
- `scope`: Package scope (`@librainian`, `@librainian-community`, or custom)
- `version`: Semver version of the construction contract
- `author`, `license`, `description`
- `agentDescription`: LLM-focused routing guidance
- `inputSchema`, `outputSchema`: JSON Schema contracts
- `requiredCapabilities`, `optionalCapabilities`
- `engines.librainian`: Supported runtime range
- `tags`, `trustTier`, `testedOn`, `examples`, `changelog`

## Trust Tier Model

- `official`: Maintained by LiBrainian core with release-gate evidence.
- `partner`: Maintained by an approved partner with reviewed manifests.
- `community`: Community-owned; validated contract, no core SLA.

Trust tier affects ranking and execution policy in registry tooling.

## Agent Description Quality Rules

`agentDescription` is required and linted structurally:

- Minimum 100 characters.
- Must include a clear **when-to-use** sentence.
- Must include at least one explicit **limitation** sentence.

This is enforced by `validateManifest(...)` in `src/constructions/manifest.ts`.

## CLI Workflow

Validate a manifest:

```bash
librarian constructions validate ./construction.manifest.json
```

Submit (registry staging path under `.librainian/registry-submissions/`):

```bash
librarian constructions submit ./construction.manifest.json
```

Use `--dry-run` to validate submission without writing staged artifacts.

## Community Example Manifest

```json
{
  "id": "@acme/contract-drift-scout",
  "scope": "@acme/community",
  "version": "1.0.0",
  "author": "Acme Engineering",
  "license": "MIT",
  "description": "Detect contract drift across service boundaries.",
  "agentDescription": "Use this construction when an agent is preparing a backend change that may impact downstream consumers and needs contract drift evidence before merge. It returns likely producer-consumer mismatches and suggested validation paths. It cannot prove runtime compatibility without executing integration tests and does not infer undocumented contracts.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "targetModule": { "type": "string" }
    },
    "required": ["targetModule"],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "driftFindings": { "type": "array" }
    },
    "required": ["driftFindings"],
    "additionalProperties": true
  },
  "requiredCapabilities": ["call-graph"],
  "optionalCapabilities": ["vector-search"],
  "engines": {
    "librainian": ">=0.8.0"
  },
  "tags": ["contracts", "api", "safety"],
  "trustTier": "community",
  "testedOn": ["typescript-monorepo"],
  "examples": [
    {
      "title": "Service boundary drift",
      "input": { "targetModule": "src/orders/service.ts" },
      "output": { "driftFindings": [] },
      "description": "Detects likely schema and call-shape drift."
    }
  ],
  "changelog": [
    {
      "version": "1.0.0",
      "date": "2026-02-25",
      "summary": "Initial release."
    }
  ]
}
```
