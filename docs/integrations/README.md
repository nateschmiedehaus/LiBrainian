# Universal Integration Guide

This guide is the entry point for integrating LiBrainian from external runtimes and agent frameworks.

## Recommended paths

Start with the narrowest supported surface that solves your problem:

- First run, local debugging, CI, and shell automation: use the CLI
- Claude Code, Cursor, Windsurf, VS Code, or Gemini CLI: use MCP
- Node-based custom agent loops: use the TypeScript API from the main package

Preview adapters exist in the source tree for controlled integrations, but they are deferred from the first public release and are not the recommended path for new adopters.
OpenClaw-specific skills, memory bridges, and benchmark adapters remain source-checkout-only and are intentionally excluded from the published npm contract until they have release-grade proof.

## Integration status

| Surface | Status | Primary doc |
| --- | --- | --- |
| CLI | Stable | [`docs/integrations/cli.md`](./cli.md) |
| MCP | Stable | [`docs/integrations/mcp.md`](./mcp.md) |
| TypeScript package API | Beta | [`README.md`](../../README.md) |

## Decision Tree

Which environment are you integrating from?

- MCP-compatible IDE/client (Claude Code, Cursor, Windsurf, Cline, Gemini CLI)
  - Use [`docs/integrations/mcp.md`](./mcp.md)
- Shell scripts, CI jobs, or local automation
  - Use [`docs/integrations/cli.md`](./cli.md)
- Frameworks expecting OpenAPI, UTCP, A2A, or Python adapter docs
  - Deferred for the first public release; treat them as source-checkout notes rather than shipped package surfaces

## Related docs

- MCP deep setup: [`docs/mcp-setup.md`](../mcp-setup.md)
- Core first-run path: [`README.md`](../../README.md)
- Source-checkout references for maintainers remain on GitHub and are outside the first public release contract
