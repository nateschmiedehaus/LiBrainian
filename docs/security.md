# Security Threat Model

This document explains what data leaves the machine, what is stored locally, and how to run LiBrainian in strict local mode.

## Scope

- Applies to the OSS `librainian` package and CLI.
- Covers production code paths (not tests).
- Focuses on code indexing, retrieval, MCP tooling, and optional external integrations.

## Data Flows

### Source Code to Local Index

- Input: workspace source files.
- Storage:
  - SQLite index at `<workspace>/.librarian/librarian.sqlite`.
  - Additional local state under `<workspace>/.librarian/` and local `state/` artifacts when commands request reports.
- Format: structured metadata and embeddings for retrieval.
- Encryption at rest: not enabled by LiBrainian itself. Use OS/disk/workspace encryption if required by policy.

### Source Code / Queries to LLM Providers

- LLM interaction is adapter-driven (CLI provider tools).
- When enabled, prompts and selected retrieved context can be sent to configured provider CLIs.
- Disable with:
  - `--offline`, or
  - `--local-only`, or
  - `LIBRARIAN_OFFLINE=1`.

### Telemetry

- Default telemetry is local stderr logging only.
- No built-in remote telemetry exporter is enabled in production paths.
- Disable local telemetry output with:
  - `--no-telemetry`, or
  - `LIBRARIAN_NO_TELEMETRY=1`.

### MCP Tool Calls

- Default MCP mode is stdio (local process boundary).
- Query/context tool outputs include retrieved snippets, identifiers, and metadata needed for the request.
- No network listener is opened by default in stdio mode.

## External Network Calls

All known outbound HTTP endpoints in production code are listed below.

| Surface | Endpoint | Purpose | Trigger | Disable |
| --- | --- | --- | --- | --- |
| GitHub issues integration | `https://api.github.com/...` | Pull issues + PR file metadata | `loadGitHubIssues` when token/repo configured | `--offline` or `--local-only` |
| Jira integration | `<JIRA_BASE_URL>/rest/api/3/search` | Pull issue snapshots | `loadJiraIssues` when Jira env configured | `--offline` or `--local-only` |
| PagerDuty integration | `https://api.pagerduty.com/incidents` | Pull incident snapshots | `loadPagerDutyIncidents` when token configured | `--offline` or `--local-only` |
| Package verification (npm) | `https://registry.npmjs.org/...` | Validate cited package existence | `createPackageVerifier().checkPackage` | `--offline` or `--local-only` |
| Package verification (PyPI) | `https://pypi.org/pypi/.../json` | Validate cited package existence | `createPackageVerifier().checkPackage` | `--offline` or `--local-only` |
| Package verification (crates.io) | `https://crates.io/api/v1/crates/...` | Validate cited package existence | `createPackageVerifier().checkPackage` | `--offline` or `--local-only` |

## Attack Surfaces

## Prompt Injection via Code Comments

### Malicious Codebase Content (Prompt Injection via Comments/Strings)

Risk:
- Source comments/strings can contain adversarial instructions.

Current behavior:
- LiBrainian treats repository text as data for indexing/retrieval.
- Retrieved content may be passed to synthesis layers if LLM paths are enabled.

Mitigations:
- Prefer deterministic/offline retrieval for sensitive workflows (`--offline` or `--local-only`).
- Require human review for high-impact actions.
- Keep prompt templates explicit that repository content is untrusted input.
- Use `librarian scan --secrets` before sharing context externally.

### MCP Exposure

Risk:
- If deployed with a network transport outside stdio, unauthorized clients could invoke tools.

Current behavior:
- Default entrypoint uses stdio local transport.

Mitigations:
- Keep MCP local/stdio for untrusted environments.
- If wrapping with network transport, add auth + network boundary controls externally.

### Index Tampering

Risk:
- Local index files could be modified by a malicious local actor/process.

Mitigations:
- Treat `.librarian` as sensitive local state.
- Protect workspace permissions.
- Re-bootstrap/reindex when tampering is suspected.
- Prefer ephemeral workspaces in high-trust workflows.

## Required Runtime Modes

### `--offline`

- Guarantees:
  - Remote LLM provider checks/calls are bypassed.
  - External integrations and registry HTTP lookups are skipped.
  - Local embedding/index behavior remains available.
- Equivalent env:
  - `LIBRARIAN_OFFLINE=1`

### `--no-telemetry`

- Guarantees:
  - Local telemetry logger output is suppressed.
- Equivalent env:
  - `LIBRARIAN_NO_TELEMETRY=1`

### `--local-only`

- Guarantees:
  - Forces fully local runtime mode.
  - Implies offline network disabling behavior.
- Equivalent env:
  - `LIBRARIAN_LOCAL_ONLY=1`

## npm Package Audit (Unexpected Network Calls)

Use the network call audit to detect newly introduced outbound HTTP surfaces:

```bash
npm run security:audit-network
```

This verifies fetch-call allowlists and fails on unapproved production network call sites.

## Security Contact

- Preferred: GitHub private advisories from the repository Security tab.
- Email: `security@librainian.dev`.
