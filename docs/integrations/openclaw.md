# OpenClaw Integration

This is a source-checkout maintainer note for deferred OpenClaw work.
The OpenClaw flows described here are intentionally excluded from the first
public release surface and are not part of the supported npm package contract
for `0.2.x`.

Do not treat this page as current public product documentation. The flows below
are design notes for deferred work and are not wired into the current public
CLI release surface.

## Deferred Install Wiring

The deferred installer wires the OpenClaw skill into a local source checkout.
It:
1. Installs `SKILL.md` into `~/.openclaw/skills/librainian/SKILL.md`.
2. Updates `~/.openclaw/openclaw.json` under `skills.entries.librainian`.
3. Verifies required LiBrainian MCP tools are available.
4. Prints a test invocation.

## Deferred Daemon Bridge

The deferred daemon bridge registers a local OpenClaw service in a source
checkout. It:
1. Registers a `librainian` service in `~/.openclaw/config.yaml` under `backgroundServices`.
2. Persists daemon lifecycle state to `~/.librainian/openclaw-daemon/state.json`.
3. Supports `status` and `stop` actions for deterministic local lifecycle control.

## Deferred Quantitative Integration Suite

The deferred OpenClaw integration suite evaluates six scenarios with
threshold-based pass/fail outputs:

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

After installation from a source checkout:

```bash
openclaw send "Use the librainian skill and start with get_context_pack for: investigate auth logout bug"
```

## Security gate before publishing/installing third-party skills

Use the maintained `audit-skill` command from a source checkout. Pass `--json`
for machine-readable verdicts in CI or pre-submission workflows.

For calibration feedback loop wiring, see `docs/integrations/openclaw-calibration.md`.
For quantitative integration suite results, see `docs/integrations/openclaw-benchmark-results.md`.
For MEMORY.md sync and stale-marking behavior, see `docs/integrations/openclaw-memory-bridge.md`.
