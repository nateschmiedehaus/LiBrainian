# T08 Outputs

## Hot paths

- Primary query entrypoint: `queryLibrarian`.
- Explicit stage tracking for `semantic_retrieval` and `reranking`.
- Reranking includes cross-encoder path with additional validation/fallback branches.
- Additional async fanout and promise-settled work appears in rerank/diversification path.

## Likely bottlenecks under load

1. Cross-encoder rerank branch for top-N packs (high compute sensitivity).
2. Repeated candidate ranking/reranking passes in large-candidate scenarios.
3. Query-cache miss path falling through to full retrieval/reranking.

## Cache observations

- Query cache has explicit get/set/increment/eviction behavior in sqlite storage.
- Invalidation by file-path exists, but cache-hit quality still depends on stable query hashing and parameter normalization.

## Actionable recommendations

- Keep rerank candidate window bounded by task/depth policy.
- Emit stage-level percentile telemetry specifically for rerank path.
- Audit cache miss reasons and hash cardinality to reduce avoidable miss churn.
