# MCP Integration

Status: available now.

## Prerequisites

- Node.js 18+
- `librainian` CLI installed (`npm i -g librainian`) or `npx -y librainian`
- Target workspace bootstrapped at least once

## Working example

```bash
# 1) Bootstrap workspace once
librainian bootstrap

# 2) Print client config snippets
librainian mcp --print-config --client claude --json

# 3) Run MCP stdio server
librainian mcp
```

Claude Code snippet shape:

```json
{
  "mcpServers": {
    "librarian": {
      "command": "librainian",
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

Public golden-path tools are intentionally narrow: `query`, `get_context_pack`, `find_symbol`,
`find_usages`, `get_change_impact`, `get_repo_map`, `explain_function`,
`describe_capabilities`, `run_health_check`, and `query_codebase`.
Experimental construction-management tools are source-checkout maintainer surfaces and are not advertised by default in `0.2.x`.

## Troubleshooting

1. `command not found: librarian`
   - Install globally or switch launcher to `npx` with `librainian mcp --print-config --launcher npx`.
2. Client connects but no useful context
   - Run `librainian bootstrap` in the workspace and retry.
3. Client fails after config edit
   - Validate JSON syntax and restart the MCP client process.

## Related tests

- `src/cli/commands/__tests__/mcp.test.ts`
- `src/mcp/__tests__/tool_registry_consistency.test.ts`
- `src/__tests__/integration_guide_docs.test.ts`

For full client setup matrix and troubleshooting depth, see `docs/mcp-setup.md`.
