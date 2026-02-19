# OpenClaw Integration

LiBrainian ships an official OpenClaw skill and installer flow.

## Install

```bash
npx librainian install-openclaw-skill
```

This command:
1. Installs `SKILL.md` into `~/.openclaw/skills/librainian/SKILL.md`.
2. Updates `~/.openclaw/openclaw.json` under `skills.entries.librainian`.
3. Verifies required LiBrainian MCP tools are available.
4. Prints a test invocation.

## Installed skill

The canonical skill source in this repository:

- `skills/openclaw/SKILL.md`

## Required MCP tools

- `get_context_pack`
- `invoke_construction`
- `find_callers`
- `find_callees`
- `estimate_budget`
- `get_session_briefing`

## Verify

After installation:

```bash
openclaw send "Use the librainian skill and start with get_context_pack for: investigate auth logout bug"
```

If OpenClaw or the LiBrainian MCP server is not configured yet, run:

```bash
librarian mcp --print-config --client claude
```
