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

## OpenClaw daemon bridge

```bash
librarian openclaw-daemon start
```

This command:
1. Registers a `librainian` service in `~/.openclaw/config.yaml` under `backgroundServices`.
2. Persists daemon lifecycle state to `~/.librainian/openclaw-daemon/state.json`.
3. Supports `status` and `stop` actions for deterministic local lifecycle control.

## Quantitative integration suite

```bash
librarian test-integration --suite openclaw --strict
```

The suite evaluates six scenarios with threshold-based pass/fail outputs:

1. Cold start context efficiency
2. Memory staleness detection
3. Semantic navigation accuracy
4. Context exhaustion prevention
5. Malicious skill detection
6. Calibration convergence

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

## Security gate before publishing/installing third-party skills

```bash
librarian audit-skill ./SKILL.md
```

Use `--json` for machine-readable verdicts in CI or pre-submission workflows.

For calibration feedback loop wiring, see `docs/integrations/openclaw-calibration.md`.
For quantitative integration suite results, see `docs/integrations/openclaw-benchmark-results.md`.
For MEMORY.md sync and stale-marking behavior, see `docs/integrations/openclaw-memory-bridge.md`.
