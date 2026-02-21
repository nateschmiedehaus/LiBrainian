# Data Flow Notes

1. Ingested CSV text is sanitized and parsed in `src/ts/ingest.ts`.
2. Records are normalized and fingerprinted in `src/py/transform.py`.
3. Validation occurs in `src/java/Validator.java` before export.
4. Batches are sent through `src/go/exporter.go` with retries.
5. The Rust TTL cache stores temporary lookups for quick dedupe checks.
