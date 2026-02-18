# LiBrainian MCP Setup

Last tested: 2026-02-18

This guide is the fastest path to a working MCP connection for LiBrainian.

## 1) Install

```bash
npm install -g librainian
# or use on-demand:
# npx -y librainian
```

## 2) Prepare index once

```bash
librarian bootstrap
librarian query "health check"
```

If bootstrap succeeds and query returns packs, your workspace is ready.

## 3) Print client config snippets

```bash
librarian mcp --print-config
# machine-readable:
librarian mcp --print-config --json
```

## 4) Start MCP server

```bash
librarian mcp
```

The server runs over stdio (for MCP clients). Keep this process managed by the client.

## Client JSON snippets

All snippets assume installed CLI (`command: "librarian"`).  
Use `librarian mcp --print-config --launcher npx` for `npx`-based snippets.

### Claude Code (`~/.claude/settings.json`)

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

### Cursor (`~/.cursor/mcp.json`)

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

### VS Code Copilot (`~/.config/Code/User/settings.json`)

```json
{
  "mcp": {
    "servers": {
      "librarian": {
        "command": "librarian",
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
      "command": "librarian",
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
      "command": "librarian",
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

1. `command not found: librarian`  
   Install globally (`npm i -g librainian`) or use `npx -y librainian`.
2. Client says server failed to start immediately  
   Verify JSON syntax and restart the client.
3. `workspace not bootstrapped` or empty query results  
   Run `librarian bootstrap` in the target repo.
4. `LLM provider unavailable` warnings  
   Run `librarian check-providers` and configure provider auth.
5. MCP server appears connected but tools missing  
   Check scope settings; server defaults to `read` + `write`.
6. Client hangs on startup  
   Remove extra stdout logging; only the MCP protocol should use stdio.
7. `database is locked`  
   Run `librarian doctor --heal` and retry.
8. Stale index / odd retrieval quality  
   Run `librarian bootstrap --force`.
9. Path issues in monorepo  
   Set `LIBRARIAN_WORKSPACE` to the intended repo root.
10. Need reproducible diagnostics  
    Capture `librarian status --format json` and `librarian doctor --json`.

## Validation matrix

- Claude Code: verified 2026-02-18
- Cursor: verified 2026-02-18
- VS Code Copilot: config snippet validated against schema shape 2026-02-18
- Windsurf: config snippet validated against schema shape 2026-02-18
- Gemini CLI: config snippet validated against schema shape 2026-02-18
