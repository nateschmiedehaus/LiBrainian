# T07 Outputs

## Pipeline map (call edges)

1. `processTask` iterates files and calls `indexFile`.
2. `indexFile` builds graph edges (including call and entanglement edges) and writes them inside transaction.
3. After file pass, `processTask` runs `resolveExternalCallEdges` (if enabled).
4. Resolved cross-file call edges are persisted via storage upsert.
5. Strategic contract materialization runs afterward to compute provider/consumer relationships from module dependencies.

## Mutation points

- In-memory call/entanglement edge construction in `indexFile`.
- Transactional persistence of graph edges.
- Second-phase mutation during external edge resolution (unknown target -> resolved target IDs).
- Separate strategic-contract materialization mutation into contract records.
