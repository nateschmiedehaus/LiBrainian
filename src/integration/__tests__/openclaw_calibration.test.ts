import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  initStageCalibration,
  recordStagePrediction,
  getPendingOutcomeStats,
  resetStageCalibration,
} from '../../api/stage_calibration.js';
import {
  classifyOpenclawOutcomeSignal,
  registerOpenclawSessionPredictions,
  ingestOpenclawSessionEvent,
  clearOpenclawSessionPredictions,
  SharedCalibrationStore,
  persistCurrentCalibrationSnapshot,
} from '../openclaw_calibration.js';

describe('openclaw calibration bridge', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'librainian-openclaw-calibration-'));
    initStageCalibration();
    clearOpenclawSessionPredictions();
  });

  afterEach(async () => {
    clearOpenclawSessionPredictions();
    resetStageCalibration();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('classifies test execution and feedback signals', () => {
    expect(classifyOpenclawOutcomeSignal('Done: tests passed (47/47)').method).toBe('test_execution');
    expect(classifyOpenclawOutcomeSignal('Looks good, ship it').method).toBe('user_acceptance');
    expect(classifyOpenclawOutcomeSignal("that's not right, try again").method).toBe('user_correction');
  });

  it('records outcomes for registered session predictions', () => {
    const first = recordStagePrediction('openclaw-stage', 0.8, 'Prediction 1', { stageId: 'openclaw-stage' });
    const second = recordStagePrediction('openclaw-stage', 0.7, 'Prediction 2', { stageId: 'openclaw-stage' });
    expect(getPendingOutcomeStats().pendingCount).toBe(2);

    registerOpenclawSessionPredictions('sess-openclaw', [first.predictionId, second.predictionId]);
    const result = ingestOpenclawSessionEvent('sess-openclaw', 'Done: tests passed (47/47)');

    expect(result.recorded).toBe(2);
    expect(result.signal.method).toBe('test_execution');
    expect(getPendingOutcomeStats().pendingCount).toBe(0);
  });

  it('persists a workspace-scoped calibration snapshot', async () => {
    recordStagePrediction('snapshot-stage', 0.75, 'Prediction snapshot', { stageId: 'snapshot-stage' });

    const storePath = path.join(tempDir, 'workspace-a.json');
    const store = new SharedCalibrationStore('workspace-a', storePath);
    const snapshot = await persistCurrentCalibrationSnapshot('workspace-a', store);

    expect(snapshot.workspaceId).toBe('workspace-a');
    expect(snapshot.byStage['snapshot-stage']?.total).toBe(1);

    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as { workspaceId: string };
    expect(persisted.workspaceId).toBe('workspace-a');
  });
});
