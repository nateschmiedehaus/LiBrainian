# T10 Outputs

## Diagnosis

Bootstrap quality gate intentionally emits explicit semantic-indexing warnings for fixture portions where parser coverage produces zero indexed functions, while still validating the full gate pipeline.

## Minimal fix path

1. Validate parser support for affected language/file type.
2. Confirm include/exclude and parser wiring in bootstrap/indexer config.
3. Re-run bootstrap quality gate and ensure warning path clears for intended fixture coverage.
