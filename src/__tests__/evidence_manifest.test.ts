/**
 * @fileoverview Tests for evidence manifest generation (TDD).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { buildEvidenceManifest, writeEvidenceManifest } from '../evaluation/evidence_manifest.js';

const FIXED_TIME = new Date('2025-01-02T03:04:05.000Z');

async function writeFixtureFile(
  root: string,
  relativePath: string,
  content: string,
  timestamp: Date = FIXED_TIME,
): Promise<string> {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  await utimes(filePath, timestamp, timestamp);
  return filePath;
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('evidence manifest generation', () => {
  let workspaceRoot: string;
  const fixtureContents: Record<string, string> = {
    'eval-results/metrics-report.json': JSON.stringify({
      metrics: {
        retrieval_recall_at_5: { mean: 0.82, target: 0.8, met: true },
        context_precision: { mean: 0.74, target: 0.7, met: true },
        hallucination_rate: { mean: 0.03, target: 0.05, met: true },
        faithfulness: { mean: 0.87, target: 0.85, met: true },
        answer_relevancy: { mean: 0.79, target: 0.75, met: true },
      },
    }),
    'eval-results/ab-results.json': JSON.stringify({
      control: { n: 80 },
      treatment: { n: 72 },
      lift: { success_rate_lift: 0.2083333333 },
      statistics: { t_p_value: 0.0945, significant: false },
      targets_met: { lift_20_percent: true },
    }),
    'eval-results/final-verification.json': JSON.stringify({
      validation_results: {
        phase21: {
          p50LatencyMs: 633,
          p99LatencyMs: 1260,
          memoryPerKLOC: 222.78,
        },
      },
      targets: {
        phase21: {
          p50LatencyMs: 500,
          p99LatencyMs: 1000,
          memoryPerKLOC: 50,
        },
      },
    }),
    'scenario-report.json': JSON.stringify({
      summary: { total: 30, passing: 30, failing: 0 },
    }),
    'eval-results/extra-metrics.json': JSON.stringify({ note: 'extra' }),
    'state/audits/librarian/coverage/uc_method_scenario_matrix.json': JSON.stringify({
      version: 'UCMethodScenarioMatrix.v1',
      rows: 120,
    }),
    'state/audits/librarian/scenarios/scenario-report.v1.json': JSON.stringify({
      version: 'ScenarioReport.v1',
      families: 30,
    }),
  };
  const auditTimestamp = new Date('2025-01-02T05:06:07.000Z');

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'evidence-manifest-'));
    for (const [relativePath, content] of Object.entries(fixtureContents)) {
      const timestamp = relativePath.includes('state/audits/librarian/scenarios/')
        ? auditTimestamp
        : FIXED_TIME;
      await writeFixtureFile(workspaceRoot, relativePath, content, timestamp);
    }
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('buildEvidenceManifest captures deterministic metadata', async () => {
    const manifest = await buildEvidenceManifest({ workspaceRoot });

    expect(manifest.artifacts.map((artifact) => artifact.path)).toEqual([
      'eval-results/ab-results.json',
      'eval-results/extra-metrics.json',
      'eval-results/final-verification.json',
      'eval-results/metrics-report.json',
      'scenario-report.json',
      'state/audits/librarian/coverage/uc_method_scenario_matrix.json',
      'state/audits/librarian/scenarios/scenario-report.v1.json',
    ]);

    const metricsEntry = manifest.artifacts.find(
      (artifact) => artifact.path === 'eval-results/metrics-report.json'
    );
    expect(metricsEntry).toBeDefined();
    const metricsContent = fixtureContents['eval-results/metrics-report.json'];
    const metricsStats = await stat(join(workspaceRoot, 'eval-results/metrics-report.json'));

    expect(metricsEntry?.size).toBe(metricsStats.size);
    expect(metricsEntry?.sha256).toBe(sha256Hex(metricsContent));
    expect(metricsEntry?.timestamp).toBe(metricsStats.mtime.toISOString());
    expect(manifest.summary.generatedAt).toBe(auditTimestamp.toISOString());
    expect(manifest.summary.scenarios.total).toBe(30);
    expect(manifest.summary.metrics.retrievalRecallAt5.mean).toBe(0.82);
    expect(manifest.summary.ab.pValue).toBe(0.0945);
    expect(manifest.summary.ab.controlSampleSize).toBe(80);
    expect(manifest.summary.ab.treatmentSampleSize).toBe(72);
    expect(manifest.summary.ab.nPerArm).toBe(72);

    const auditEntry = manifest.artifacts.find(
      (artifact) =>
        artifact.path === 'state/audits/librarian/scenarios/scenario-report.v1.json'
    );
    expect(auditEntry).toBeDefined();
    const auditContent = fixtureContents['state/audits/librarian/scenarios/scenario-report.v1.json'];
    const auditStats = await stat(
      join(workspaceRoot, 'state/audits/librarian/scenarios/scenario-report.v1.json')
    );
    expect(auditEntry?.size).toBe(auditStats.size);
    expect(auditEntry?.sha256).toBe(sha256Hex(auditContent));
    expect(auditEntry?.timestamp).toBe(auditStats.mtime.toISOString());
  });

  it('writeEvidenceManifest writes manifest to the audit path', async () => {
    const { manifest, outputPath } = await writeEvidenceManifest({ workspaceRoot });
    const raw = await readFile(outputPath, 'utf8');
    const parsed = JSON.parse(raw) as typeof manifest;

    expect(parsed).toEqual(manifest);
    expect(outputPath).toBe(join(workspaceRoot, 'state', 'audits', 'librarian', 'manifest.json'));
  });

  it('is deterministic across repeated runs', async () => {
    const first = await buildEvidenceManifest({ workspaceRoot });
    const second = await buildEvidenceManifest({ workspaceRoot });

    expect(second).toEqual(first);
  });

  it('throws when required artifacts are missing', async () => {
    await rm(join(workspaceRoot, 'eval-results', 'final-verification.json'));

    await expect(
      buildEvidenceManifest({ workspaceRoot })
    ).rejects.toThrow(/final-verification\.json/);
  });

  it('fails when A/B sample-size metadata is missing', async () => {
    await writeFixtureFile(
      workspaceRoot,
      'eval-results/ab-results.json',
      JSON.stringify({
        lift: { success_rate_lift: 0.2083333333 },
        statistics: { t_p_value: 0.0945, significant: false },
      }),
      FIXED_TIME,
    );

    await expect(
      buildEvidenceManifest({ workspaceRoot })
    ).rejects.toThrow(/ab\.control\.n/);
  });
});
