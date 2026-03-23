# LiBrainian MCP Setup

Validated against the current CLI surface on 2026-03-20.

This guide is the fastest path to a working MCP connection for LiBrainian.

## Requirements and expectations

- Node.js `18+`
- A repo that has already passed `quickstart` or `bootstrap`
- Provider keys are optional:
  - without them, MCP still supports structural retrieval and diagnostics
  - with them, queries can use richer synthesis and provider-backed ranking

Healthy MCP setup means all three are true:
- `query` returns useful files and summary text
- `status` is healthy for the target workspace
- `doctor` reports no blocking issue for bootstrap or storage

## 1) Install

```bash
npm install -g librainian
# or use on-demand:
# npx -y librainian
```

Primary command:
- `librainian`

Compatibility alias:
- `librarian`

## 2) Prepare index once

```bash
npx librainian quickstart
npx librainian query "health check"
npx librainian status --json
npx librainian doctor --json
```

If those complete without a blocking `doctor` issue, your workspace is ready for MCP.

## 3) Print client config snippets

```bash
npx librainian mcp --print-config
# machine-readable:
npx librainian mcp --print-config --json
```

## 4) Start MCP server

```bash
npx librainian mcp
```

The server runs over stdio (for MCP clients). Keep this process managed by the client.

## Client JSON snippets

All snippets assume installed CLI (`command: "librainian"`).
Use `npx librainian mcp --print-config --launcher npx` for `npx`-based snippets.

### Claude Code (`~/.claude/settings.json`)

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

### Cursor (`~/.cursor/mcp.json`)

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

### VS Code Copilot (`~/.config/Code/User/settings.json`)

```json
{
  "mcp": {
    "servers": {
      "librarian": {
        "command": "librainian",
        "args": ["mcp", "--stdio"],
        "env": {
          "LIBRARIAN_WORKSPACE": "/absolute/path/to/workspace"
        }
      }
    }
  }
}
```

### Windsurf (`~/.windsurf/mcp.json`)

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

### Gemini CLI (`~/.gemini/settings.json`)

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

## Tool capability hints

LiBrainian MCP tool metadata now includes:

- `annotations.readOnlyHint`
- `_meta.requiresIndex`
- `_meta.requiresEmbeddings`
- `_meta.estimatedTokens`

Clients can use these hints for planning and risk control.

## Troubleshooting (Top 10)

1. `command not found: librainian`
   Install globally (`npm i -g librainian`) or use `npx -y librainian`.
2. Client says server failed to start immediately  
   Verify JSON syntax and restart the client.
3. `workspace not bootstrapped` or empty query results  
   Run `npx librainian quickstart` or `npx librainian bootstrap --force --mode fast` in the target repo.
4. `LLM provider unavailable` warnings  
   Run `npx librainian check-providers` and configure provider auth.
5. MCP server appears connected but tools missing  
   Check the generated config from `npx librainian mcp --print-config --json`; the public setup should include `enabled_tools` and `serverInstructions`.
6. Client hangs on startup  
   Remove extra stdout logging; only the MCP protocol should use stdio.
7. `database is locked`  
   Run `npx librainian doctor --heal` and retry.
8. Stale index / odd retrieval quality  
   Run `npx librainian bootstrap --force --mode fast`.
9. Path issues in monorepo  
   Set `LIBRARIAN_WORKSPACE` to the intended repo root.
10. Need reproducible diagnostics  
    Capture `npx librainian status --json` and `npx librainian doctor --json`.

## Validation matrix

- Claude Code: verified 2026-02-18
- Cursor: verified 2026-02-18
- VS Code Copilot: config snippet validated against schema shape 2026-02-18
- Windsurf: config snippet validated against schema shape 2026-02-18
- Gemini CLI: config snippet validated against schema shape 2026-02-18
