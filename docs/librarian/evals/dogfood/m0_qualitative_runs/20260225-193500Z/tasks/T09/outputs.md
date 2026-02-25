# T09 Outputs

## Current relationship

- Strategic contracts are materialized during indexing and persisted in sqlite.
- Context packs are generated as a separate indexing/query product.
- MCP surface appears heavily context-pack oriented; no direct strategic-contract retrieval tool was identified in this pass.

## Architectural implication

- Strategic contract data is available at storage/indexing layer but not yet first-class in MCP query ergonomics.
- This is a potential follow-up: expose strategic contracts through MCP tooling and/or include them in context-pack assembly when relevant.
