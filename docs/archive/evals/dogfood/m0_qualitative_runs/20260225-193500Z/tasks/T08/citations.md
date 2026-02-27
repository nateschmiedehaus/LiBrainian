# T08 Citations

- `src/api/query.ts:1611` and `src/api/query.ts:1623` (`queryLibrarian`)
- `src/api/query.ts:1516` (`semantic_retrieval` stage declaration)
- `src/api/query.ts:1546` (`reranking` stage declaration)
- `src/api/query.ts:5921` (`runRerankStage`)
- `src/api/query.ts:5956` to `src/api/query.ts:5996` (cross-encoder rerank validation/fallback)
- `src/api/query.ts:6148` (`Promise.allSettled` in rerank/diversification pipeline)
- `src/storage/sqlite_storage.ts:4211` (`getQueryCacheEntry`)
- `src/storage/sqlite_storage.ts:4246` (cache insert)
- `src/storage/sqlite_storage.ts:4267` (cache access counter update)
- `src/storage/sqlite_storage.ts:4274` to `src/storage/sqlite_storage.ts:4281` (cache cleanup/eviction)
