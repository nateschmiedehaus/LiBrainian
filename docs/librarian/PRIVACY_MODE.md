# Privacy Mode

LiBrainian supports strict privacy mode with:

- `LIBRARIAN_PRIVACY_MODE=strict`
- fail-closed remote LLM behavior
- append-only privacy audit log at `.librarian/audit/privacy.log`
- compliance summary command: `librarian privacy-report`

## Strict Mode Semantics

When `LIBRARIAN_PRIVACY_MODE=strict`:

- runtime is treated as local-only/offline for network controls
- remote LLM calls are blocked with a deterministic error
- provider checks are recorded in privacy audit log
- local embedding operations are recorded in privacy audit log

Blocked LLM error message:

`Privacy mode is enabled. Configure a local embedding model: LIBRARIAN_EMBEDDING_MODEL=onnx:all-MiniLM-L6-v2.`

## Audit Log Format

Each line in `.librarian/audit/privacy.log` is JSONL:

```json
{"ts":"2026-02-20T00:00:00.000Z","op":"embed","files":["src/auth.ts"],"model":"xenova/all-MiniLM-L6-v2","local":true,"contentSent":false,"status":"allowed"}
{"ts":"2026-02-20T00:01:00.000Z","op":"synthesize","files":[],"model":"claude-sonnet-4","local":false,"contentSent":false,"status":"blocked","note":"strict privacy mode blocks external LLM providers"}
```

## Compliance Report

Generate a compliance summary:

```bash
librarian privacy-report --since 2026-02-01T00:00:00Z
librarian privacy-report --json --out state/audits/privacy-report.json
```

Exit code behavior:

- `0` when `externalContentSentEvents === 0`
- `1` when external content transmission is detected
