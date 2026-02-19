# MCP Integration

Status: available now.

## Prerequisites

- Node.js 18+
- `librainian` CLI installed (`npm i -g librainian`) or `npx -y librainian`
- Target workspace bootstrapped at least once

## Working example

```bash
# 1) Bootstrap workspace once
librarian bootstrap

# 2) Print client config snippets
librarian mcp --print-config --client claude --json

# 3) Run MCP stdio server
librarian mcp
```

Claude Code snippet shape:

```json
{
  "mcpServers": {
    "librarian": {
      "command": "librarian",
      "args": ["mcp", "--stdio"],
      "env": {
        "LIBRARIAN_WORKSPACE": "/absolute/path/to/workspace"
      }
    }
  }
}
```

## Real-world use case

Use MCP when your coding agent needs tool-style access to LiBrainian context during live coding sessions without adding custom HTTP plumbing.

## Troubleshooting

1. `command not found: librarian`
   - Install globally or switch launcher to `npx` with `librarian mcp --print-config --launcher npx`.
2. Client connects but no useful context
   - Run `librarian bootstrap` in the workspace and retry.
3. Client fails after config edit
   - Validate JSON syntax and restart the MCP client process.

## Related tests

- `src/cli/commands/__tests__/mcp.test.ts`
- `src/mcp/__tests__/tool_registry_consistency.test.ts`
- `src/__tests__/integration_guide_docs.test.ts`

For full client setup matrix and troubleshooting depth, see `docs/mcp-setup.md`.
