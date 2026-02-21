# Dogfooding Blind Spots

This document scopes what self-hosting (LiBrainian on LiBrainian) validates and what it does not.
It is the required companion to M0/M1 dogfood claims.

## Why This Exists

Self-hosting proves baseline reliability and regression resistance on a TypeScript-heavy monorepo.
It does not prove broad real-world performance across language, domain, scale, cross-repo, and newcomer-usage variance.

## Blind Spot Inventory

| Blind Spot ID | Description | Supplementary Coverage |
| --- | --- | --- |
| `domain-diversity` | Domain-specific reasoning (infra, blockchain, ML, etc.) | `domain-terraform-iac`, `domain-solidity`, `medium-python` |
| `language-diversity` | Non-TypeScript language behavior | `medium-python`, `domain-solidity`, `external-reccmp-py` |
| `non-code-entities` | IaC/config/operational topology artifacts | `domain-terraform-iac` |
| `broken-legacy-code` | Low quality, contradictory, debt-heavy code | `adversarial` |
| `multi-repo-cross-boundary` | Service contract intelligence across repo boundaries | `federation-user-service`, `federation-billing-service` |
| `scale` | Large corpus behavior and indexing pressure | `large-monorepo`, `external-reccmp-py` |
| `adversarial-obfuscated-input` | Misleading or hard-to-read code patterns | `adversarial`, `domain-solidity` |
| `multi-team-convention-conflicts` | Competing conventions and style drift | `adversarial`, `large-monorepo` |
| `stale-index-scenarios` | Divergence between code and index freshness | `large-monorepo` (long-running stale-index simulations) |
| `naive-first-run-experience` | First-time user onboarding and misunderstanding risk | `medium-python`, `domain-terraform-iac`, `external-reccmp-py` |

## Corpus Source of Truth

- Catalog: `eval-corpus/supplementary-corpora.json`
- External corpus manifest: `eval-corpus/external-repos/manifest.json`
- Strict coverage validator: `npm run eval:dogfood:blind-spots`

## Release Claim Rules

1. Every release-gate quality claim must include `validatedBy` or `requiresSupplementaryCorpus` in `docs/librarian/GATES.json`.
2. `npm run test:agentic:strict` must include external-corpus execution (`eval:use-cases:agentic` and `smoke:external:all`).
3. Blind-spot coverage dashboard artifacts must be generated for release evidence:
   - `state/eval/dogfood/blind-spot-coverage.json`
   - `state/eval/dogfood/blind-spot-coverage.md`

## Maintenance

When adding new capabilities, update all of the following in the same PR:

1. `eval-corpus/supplementary-corpora.json` (new or remapped corpus coverage)
2. `docs/librarian/DOGFOODING_BLIND_SPOTS.md` (human-readable rationale)
3. `docs/librarian/GATES.json` claim annotations (`validatedBy` / `requiresSupplementaryCorpus`)
4. Validator evidence by running `npm run eval:dogfood:blind-spots`
