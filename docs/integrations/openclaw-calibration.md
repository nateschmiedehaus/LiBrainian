# OpenClaw Calibration Feedback Bridge

LiBrainian includes an OpenClaw outcome bridge that maps coding-agent session signals to calibration outcomes.

## Signals mapped

1. Test execution events (`tests passed` / `tests failed`) -> `test_result`
2. User acceptance messages (`lgtm`, `looks good`, `ship it`) -> `user_feedback` success
3. User correction messages (`not right`, `try again`, `breaks`) -> `user_feedback` failure

## Core API

- `classifyOpenclawOutcomeSignal(text)`
- `registerOpenclawSessionPredictions(sessionId, predictionIds)`
- `ingestOpenclawSessionEvent(sessionId, text)`

## Workspace persistence

`SharedCalibrationStore` persists per-workspace calibration snapshots:

- default path: `~/.librainian/calibration/<workspaceId>.json`
- helper: `persistCurrentCalibrationSnapshot(workspaceId)`
