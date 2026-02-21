# Medium Mixed Data Pipeline

## Overview
- TypeScript ingest parses CSV text, sanitizes lines, validates payload size,
  de-duplicates records, and batches them for export.
- Python transform normalizes fields, coerces primitive types, and computes a
  salted fingerprint for each record.
- Go exporter sends batches with retry/backoff behavior.
- Java validator enforces required fields, ranges, and enum values.
- Rust cache stores short-lived lookups with TTL eviction.

## Data Contracts
- src/shared/schema.json defines required fields and payload constraints for
  records before export.
