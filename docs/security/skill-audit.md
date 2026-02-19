# Skill Audit Security Model

`librarian audit-skill` evaluates `SKILL.md` content for high-risk behavior before installation.

## Detection categories

- `url-exfiltration`
- `permission-escalation`
- `prompt-injection`
- `obfuscation`
- `known-hash`
- `intent-behavior-incoherence`

## Risk scoring

- Severity weights: `low=10`, `medium=25`, `high=45`, `critical=70`
- Total risk score is capped at `100`
- Verdict thresholds:
1. `0-29`: `safe`
2. `30-69`: `suspicious`
3. `70-100`: `malicious`

## Known malicious patterns

Known indicators live in:

- `data/malicious-pattern-hashes.json`

Each indicator includes a SHA-256 hash and a typed pattern classification.

## CLI

```bash
librarian audit-skill ./path/to/SKILL.md
librarian audit-skill ./path/to/SKILL.md --json
```

## API helper

For registry-style pre-submission checks:

- `src/api/clawhub_webhook.ts`
- `auditClawhubSkillSubmission({ skillContent, submitterGithubHandle })`
