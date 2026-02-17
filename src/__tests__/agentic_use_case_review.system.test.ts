import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { runProviderReadinessGate } from '../api/provider_gate.js';
import { runAgenticUseCaseReview } from '../evaluation/agentic_use_case_review.js';

const IS_UNIT_MODE = process.env.LIBRARIAN_TEST_MODE === 'unit' || (!process.env.LIBRARIAN_TEST_MODE && process.env.LIBRARIAN_TIER0 !== '1');
const EXTERNAL_REPOS_ROOT = path.join(process.cwd(), 'eval-corpus', 'external-repos');
const USE_CASE_MATRIX_PATH = path.join(process.cwd(), 'docs', 'librarian', 'USE_CASE_MATRIX.md');

describe('Agentic use-case review (system)', () => {
  it('runs a bounded real-project use-case review and emits report artifacts', async (ctx) => {
    if (IS_UNIT_MODE) {
      ctx.skip(true, 'unverified_by_trace(test_tier): Agentic use-case review requires system/integration mode');
    }

    try {
      await access(path.join(EXTERNAL_REPOS_ROOT, 'manifest.json'));
    } catch {
      ctx.skip(true, 'unverified_by_trace(test_fixture_missing): External repos manifest missing');
    }

    const providerStatus = await runProviderReadinessGate(process.cwd(), { emitReport: true });
    if (!providerStatus.llmReady || !providerStatus.embeddingReady) {
      ctx.skip(
        true,
        `unverified_by_trace(provider_unavailable): llmReady=${providerStatus.llmReady}; embeddingReady=${providerStatus.embeddingReady}`
      );
    }

    const report = await runAgenticUseCaseReview({
      reposRoot: EXTERNAL_REPOS_ROOT,
      matrixPath: USE_CASE_MATRIX_PATH,
      maxRepos: 2,
      maxUseCases: 12,
      selectionMode: 'balanced',
      progressivePrerequisites: true,
      artifactRoot: path.join(process.cwd(), 'state', 'eval', 'use-case-review'),
      runLabel: 'system-test',
      thresholds: {
        minPassRate: 0,
        minEvidenceRate: 0,
        minUsefulSummaryRate: 0,
        maxStrictFailureShare: 1,
        minPrerequisitePassRate: 0,
        minTargetPassRate: 0,
        minTargetDependencyReadyShare: 0,
      },
    });

    expect(report.schema).toBe('AgenticUseCaseReviewReport.v1');
    expect(report.selectedUseCases.length).toBeGreaterThan(0);
    expect(report.plannedUseCases.length).toBeGreaterThanOrEqual(report.selectedUseCases.length);
    expect(report.summary.totalRuns).toBeGreaterThan(0);
    expect(report.summary.progression.targetRuns).toBeGreaterThan(0);
    expect(report.summary.uniqueRepos).toBeGreaterThan(0);
    expect(report.summary.uniqueUseCases).toBeGreaterThan(0);
    expect(report.artifacts?.reportPath).toBeDefined();
    expect(Array.isArray(report.gate.reasons)).toBe(true);

    if (report.artifacts?.reportPath) {
      await access(report.artifacts.reportPath);
    }
  }, 300000);
});
