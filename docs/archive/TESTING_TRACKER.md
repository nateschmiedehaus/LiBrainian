# Testing Tracker

Generated: 2026-02-18T00:11:25.624Z

## Summary

- Publish-ready: **yes**
- Fixed: 9
- Open: 0
- Unknown: 0

## Artifacts

| Artifact | Present | Parse Error |
| --- | --- | --- |
| ab | yes |  |
| useCase | yes |  |
| liveFire | yes |  |
| smoke | yes |  |
| testingDiscipline | yes |  |
| publishGate | yes |  |

## Flaws

| Status | Flaw | Evidence |
| --- | --- | --- |
| ✅ fixed | A/B fallback control | verificationFallbackShare=0.000 |
| ✅ fixed | A/B artifact integrity | artifactIntegrityShare=1.000 |
| ✅ fixed | A/B verified execution share | agentVerifiedExecutionShare=1.000 |
| ✅ fixed | A/B timeout fragility | agent_command_timeout_count=0 |
| ✅ fixed | A/B superiority signal | ceiling_mode=true, effectiveTimeReduction=0.426, sampleSizeAdequate=true |
| ✅ fixed | Use-case strict marker control | strictFailureShare=0.000 |
| ✅ fixed | Live-fire gate | gates.passed=true |
| ✅ fixed | External smoke reliability | summary.failures=0 |
| ✅ fixed | Testing discipline gate | passed=true, failedBlockingChecks=0.000 |
