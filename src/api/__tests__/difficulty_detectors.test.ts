import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildAdequacySpec,
  evaluateAdequacy,
  mergeSignals,
  runDifficultyDetectors,
  scanRepositorySignals,
} from '../difficulty_detectors.js';

describe('difficulty detectors', () => {
  it('builds adequacy specs for model validity', () => {
    const signals = mergeSignals({ hasModelCode: true });
    const spec = buildAdequacySpec('train model', 'model_validity', signals);
    const reqIds = spec.requirements.map((req) => req.id);
    expect(reqIds).toEqual(expect.arrayContaining(['datasets', 'eval_harness', 'tests']));
  });

  it('flags missing rollback evidence for releases', () => {
    const signals = mergeSignals({ hasTests: true, hasRollbackPlan: false, hasObservability: false });
    const spec = buildAdequacySpec('release deployment', 'release', signals);
    const report = evaluateAdequacy(spec, signals);
    expect(report.blocking).toBe(true);
    expect(report.missingEvidence.map((req) => req.id)).toEqual(expect.arrayContaining(['rollback_plan']));
  });

  it('treats schema discovery intents as general adequacy', () => {
    const signals = mergeSignals({
      hasTests: true,
      hasRollbackPlan: false,
      hasObservability: false,
      hasIntegrationTests: false,
    });
    const spec = buildAdequacySpec('identify data stores and schema locations', 'orientation', signals);
    expect(spec.taskIntent).toBe('general');
    expect(spec.requirements.map((req) => req.id)).toEqual(['tests']);
  });

  it('keeps schema migration intents on migration adequacy', () => {
    const signals = mergeSignals({ hasTests: true, hasRollbackPlan: false, hasObservability: false });
    const spec = buildAdequacySpec('plan schema migration rollout', 'migration', signals);
    expect(spec.taskIntent).toBe('migration');
    expect(spec.requirements.map((req) => req.id)).toEqual(
      expect.arrayContaining(['tests', 'rollback_plan', 'observability', 'integration_tests'])
    );
  });

  it('detects missing datasets when model code exists', () => {
    const signals = mergeSignals({ hasModelCode: true, hasDatasetFiles: false });
    const findings = runDifficultyDetectors({ intent: 'train model', signals });
    const ids = findings.map((finding) => finding.detectorId);
    expect(ids).toContain('dd_missing_datasets');
  });

  it('scans repository signals from filesystem markers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'librarian-detectors-'));
    fs.mkdirSync(path.join(tmpDir, 'tests'));
    fs.mkdirSync(path.join(tmpDir, '.github', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'rollback.md'), 'rollback');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { '@opentelemetry/api': '1.0.0' } })
    );

    const signals = scanRepositorySignals(tmpDir);

    expect(signals.hasTests).toBe(true);
    expect(signals.hasCi).toBe(true);
    expect(signals.hasRollbackPlan).toBe(true);
    expect(signals.hasObservability).toBe(true);
  });
});
