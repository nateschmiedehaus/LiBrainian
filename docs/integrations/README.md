# Universal Integration Guide

This guide is the entry point for integrating LiBrainian from external runtimes and agent frameworks.

## Integration status

| Surface | Status | Primary doc |
| --- | --- | --- |
| MCP | Available now | [`docs/integrations/mcp.md`](./mcp.md) |
| CLI | Available now | [`docs/integrations/cli.md`](./cli.md) |
| OpenAPI/REST adapter | Adapter contract (preview) | [`docs/integrations/rest-api.md`](./rest-api.md) |
| UTCP adapter | Adapter contract (preview) | [`docs/integrations/utcp.md`](./utcp.md) |
| A2A adapter | Adapter contract (preview) | [`docs/integrations/a2a.md`](./a2a.md) |
| Python SDK | SDK-style bridge (preview) | [`docs/integrations/python-sdk.md`](./python-sdk.md) |

## Decision Tree

Which environment are you integrating from?

- MCP-compatible IDE/client (Claude Code, Cursor, Windsurf, Cline, Gemini CLI)
  - Use [`docs/integrations/mcp.md`](./mcp.md)
- Shell scripts, CI jobs, or local automation
  - Use [`docs/integrations/cli.md`](./cli.md)
- Frameworks expecting OpenAPI or direct HTTP tools
  - Use [`docs/integrations/rest-api.md`](./rest-api.md)
- Tool routing through UTCP envelopes
  - Use [`docs/integrations/utcp.md`](./utcp.md)
- Agent-to-agent orchestration (A2A task envelopes)
  - Use [`docs/integrations/a2a.md`](./a2a.md)
- Python scripts or notebooks
  - Use [`docs/integrations/python-sdk.md`](./python-sdk.md)

## Protocol adapter architecture

LiBrainian keeps one canonical contract and maps protocols to it through adapters.

- Canonical contract: OpenAPI/REST request and response schema
- Native surfaces now: CLI and MCP
- Adapter surfaces: UTCP, A2A, Python SDK

Use [`docs/integrations/protocol-adapters.md`](./protocol-adapters.md) for adapter design and compatibility rules.

## Related docs

- OpenClaw integration: [`docs/integrations/openclaw.md`](./openclaw.md)
- MCP deep setup: [`docs/mcp-setup.md`](../mcp-setup.md)
- Core agent integration patterns: [`docs/librarian/AGENT_INTEGRATION.md`](../librarian/AGENT_INTEGRATION.md)
