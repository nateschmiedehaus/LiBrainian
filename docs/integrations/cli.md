# CLI Integration

Status: available now.

## Prerequisites

- Node.js 18+
- `librainian` installed locally in your project or callable with `npx`
- A workspace with readable source files

## Working example

```bash
# Fast setup + self-heal
npx librainian quickstart --ci --json

# Query from scripts/CI
npx librainian query "Where is auth enforced?" --json --out state/librarian/query.json

# Health and status checks
npx librainian status --format json
npx librainian health --format json
```

## Real-world use case

Use CLI integration for CI pipelines, release checks, and shell-based automation where deterministic command output is required.

## Troubleshooting

1. Query returns empty or weak context
   - Run `npx librainian bootstrap --force` and retry.
2. Non-interactive runners hang on prompts
   - Add `--ci` and machine-readable flags (`--json` or `--format json`).
3. SQLite lock errors in shared runners
   - Run `npx librainian doctor --heal` before retries.

## Related tests

- `src/cli/commands/__tests__/quickstart.test.ts`
- `src/cli/commands/__tests__/doctor.test.ts`
- `src/__tests__/integration_guide_docs.test.ts`
