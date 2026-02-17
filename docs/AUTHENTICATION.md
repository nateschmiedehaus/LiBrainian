# 🔐 AUTHENTICATION GUIDE - Wave0 Autopilot

Canon declaration: key auth/tool-state policy and provider status are declared in `config/canon.json`.

## Policy (CLI-only)

- Authentication must use provider CLIs (no browser/cookie flows).
- Tool/provider state may exist locally (including under a workspace `.accounts/` directory), but it MUST NOT be tracked in git.
- Canon Guard fails if git tracks `.accounts/`, `.codex/`, `.claude/`, `dist/`, or `state/**` (except `state/audits/**`).

## Quick Start

```bash
# Claude Code CLI (subscription; no API keys)
claude --version
claude setup-token        # one-time (interactive)
claude --print "ok"       # quick sanity check (uses tokens)

# Codex CLI (subscription; no API keys)
codex --version
codex login
codex login status

npm run build
npm run start
```

## Environment Variables Used By Wave0

- `CODEX_HOME`: where Codex CLI auth/token cache lives (local-only; do not track).
- `CLAUDE_CONFIG_DIR`: where Claude CLI config lives (local-only; do not track).
- `LIBRARIAN_CLAUDE_FULL_PERMS=1`: opt-in “no prompts + widest access” mode for Wave0’s Claude Code invocations (uses `--dangerously-skip-permissions`; combine with `LIBRARIAN_CLAUDE_ADD_DIRS` as needed).
- `LIBRARIAN_CLAUDE_ADD_DIRS`: comma-separated extra directories to grant Claude tool access via repeated `--add-dir` (use sparingly; never point at credential directories).
- `LIBRARIAN_CLAUDE_SETTINGS`: optional Claude Code `--settings` value (path or JSON string) to control local session behavior.

## CLI Commands Reference

### Claude CLI

```bash
claude --version
claude setup-token
claude --print "Your prompt here"
```

When spawning Claude CLI from Node.js, close stdin immediately:

```ts
const proc = spawn('claude', ['--print', prompt], { stdio: ['pipe', 'pipe', 'pipe'] });
proc.stdin.end();
```

### Codex CLI

```bash
codex --version
codex login
codex login status
codex exec "Your prompt here" --skip-git-repo-check
```

## Troubleshooting

- Provider unavailable / rate limited during Tier-2 runs: fail honestly with `unverified_by_trace` (expected).
- Authentication expired: rerun `claude setup-token` (or re-auth via `claude`) / `codex login`.
