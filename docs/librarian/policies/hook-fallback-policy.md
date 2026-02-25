# Hook Fallback Policy (`--no-verify`)

Use `git commit --no-verify` or `git push --no-verify` only as a temporary escape hatch when hooks are failing or timing out for infrastructure/runtime reasons.

## Allowed cases

- Hook wrapper reports non-blocking timeout/failure with remediation, and work is blocked.
- Environment/provider/bootstrap prerequisites are unavailable in the current runtime.

## Required follow-up

1. Capture the hook output and command context.
2. File/update a bug issue with logs and reproduction details.
3. Use the smallest possible scope (single commit/push), then return to verified hook flow.

## Not allowed

- Repeated bypasses without an issue and diagnostic evidence.
- Using bypass to skip known functional failures in changed code.

Current tracking issue for hook reliability hardening: #832.
