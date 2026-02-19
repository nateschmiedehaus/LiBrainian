# OpenClaw Integration Benchmark Results

This benchmark suite is produced by:

```bash
librarian test-integration --suite openclaw --json
```

Fixture root: `test/fixtures/openclaw`

## Latest Fixture Baseline

| Scenario | Threshold | Measured | Status |
|---|---:|---:|---|
| Cold start context efficiency | integration tokens <= 4000 | 3200 | PASS |
| Memory staleness detection | marker detected within 60s | 34s | PASS |
| Semantic navigation accuracy | librarian accuracy >= 0.90 | 0.90 | PASS |
| Context exhaustion prevention | warning rate = 1.0 | 1.0 | PASS |
| Malicious skill detection | >=4/5 malicious; 0/5 false positives | 4/5, 0/5 | PASS |
| Calibration convergence | ece10 < initial, ece20 < ece10, ece30 < 0.05 | 0.25, 0.05, ~0.00 | PASS |

## Notes

- Scenario 5 executes the real `SkillAuditConstruction` against the fixture corpus.
- Scenario 6 computes ECE with the real calibration pipeline (`computeCalibrationReport`).
- Use `--strict` to make failing scenarios return non-zero exit status for CI gates.
