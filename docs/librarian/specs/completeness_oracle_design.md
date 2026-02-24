# Completeness Oracle Design (`#682`)

## Scope and Differentiation

The Completeness Oracle targets **missing co-artifacts after implementation** by inferring conventions statistically from the existing indexed codebase.

This explicitly differs from adjacent systems:

- `#667` Convention Enforcement: explicit style/rule validation.
- `#669` Change Plan Validator: pre-implementation plan completeness.
- `#345` RegressionFence: changed-behavior/regression detection.
- `#678` Refactoring Loop Gate: quality thresholding.

Completeness Oracle asks: "Given what similar elements in this codebase usually include, what likely-required artifact is missing in the current change?"

## Core Algorithm

1. Build element clusters from indexed entities (for now: `crud_function`, `api_endpoint`, `service_module`, `env_var_read`, `config_value`).
2. For each cluster, infer co-artifact prevalence from observed file/function topology.
3. Build convention templates:
   - `support`: number of observed examples in cluster.
   - `prevalence`: fraction of examples containing the artifact.
4. Evaluate changed/new implementation elements against templates.
5. Emit:
   - enforced gaps when `support >= threshold`.
   - informational suggestions when `support < threshold`.
6. Apply counterevidence to reduce confidence/suppress likely false positives.

## Confidence and Enforcement

- Base confidence: `prevalence * support_weight`.
- `support_weight = min(1, support / 12)`.
- Counterevidence reduces confidence multiplicatively.
- Gaps with strong counterevidence are suppressed.

## Counterevidence

Counterevidence sources:

- Explicit request payload entries.
- Workspace config file: `.librarian/completeness_exceptions.json`.

Each counterevidence entry supports:

- `artifact` (required)
- `pattern` (optional)
- `filePattern` regex (optional)
- `reason` (required)
- `weight` in `[0,1]` (optional)

## MCP and CLI Delivery

- MCP tool: `librarian_completeness_check`
- CLI entrypoint: `librarian check completeness`

Both return structured output including templates, enforced gaps, suggestions, confidence, support, and 2-3 evidence example files per gap.

## Automatic Invocation

When `append_claim` receives a completion signal (`done`, `completed`, or equivalent tags), MCP automatically runs completeness check and attaches the report to the response.

## Graceful Degradation

- Below support threshold, oracle never emits enforced findings.
- Small codebases get informational guidance only.

## Verification

Implemented tests cover:

- Template building and prevalence/support output.
- Support threshold informational mode.
- Confidence reduction and suppression via counterevidence.
- MCP tool end-to-end invocation and structured gap output.
