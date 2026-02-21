import { describe, it, expect } from 'vitest';
import type { ContextPack, LiBrainianQuery, SynthesizedResponse } from '../../types.js';
import { createQueryVerificationPlan } from '../verification_plans.js';
import type { AdequacyReport } from '../difficulty_detectors.js';

const baseVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'mvp' as const,
  indexedAt: new Date('2026-01-19T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

const createPack = (overrides: Partial<ContextPack>): ContextPack => ({
  packId: 'pack-1',
  packType: 'module_context',
  targetId: 'module-1',
  summary: 'Summary',
  keyFacts: [],
  codeSnippets: [],
  relatedFiles: ['src/auth.ts'],
  confidence: 0.6,
  createdAt: new Date('2026-01-19T00:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: 0,
  failureCount: 0,
  version: baseVersion,
  invalidationTriggers: [],
  ...overrides,
});

describe('createQueryVerificationPlan', () => {
  it('builds a plan from packs, gaps, and uncertainties', () => {
    const query: LiBrainianQuery = {
      intent: 'How does auth flow work?',
      depth: 'L1',
      taskType: 'bugfix',
      affectedFiles: ['src/auth.ts'],
    };
    const packs = [createPack({ relatedFiles: ['src/auth.ts'] })];
    const synthesis: SynthesizedResponse = {
      answer: 'Answer',
      confidence: 0.4,
      citations: [],
      keyInsights: [],
      uncertainties: ['Missing tests'],
    };

    const plan = createQueryVerificationPlan({
      query,
      packs,
      coverageGaps: ['No semantic matches'],
      synthesis,
      planId: 'vp-test',
    });

    expect(plan).not.toBeNull();
    expect(plan?.id).toBe('vp-test');
    expect(plan?.target).toBe(query.intent);
    expect(plan?.methods.map((m) => m.type)).toEqual(
      expect.arrayContaining(['code_review', 'automated_test'])
    );
    expect(plan?.expectedObservations).toEqual([
      'Review related files: src/auth.ts',
      'Address coverage gaps: No semantic matches',
      'Resolve uncertainties: Missing tests',
    ]);
    expect(plan?.artifacts).toEqual(['src/auth.ts']);
  });

  it('returns null when there is nothing to verify', () => {
    const query: LiBrainianQuery = { intent: 'Empty query', depth: 'L0' };
    const plan = createQueryVerificationPlan({ query, packs: [] });
    expect(plan).toBeNull();
  });

  it('falls back to manual validation without files', () => {
    const query: LiBrainianQuery = { intent: 'Spec check', depth: 'L1' };
    const synthesis: SynthesizedResponse = {
      answer: 'Answer',
      confidence: 0.2,
      citations: [],
      keyInsights: [],
      uncertainties: ['Needs confirmation'],
    };
    const plan = createQueryVerificationPlan({
      query,
      packs: [],
      synthesis,
      planId: 'vp-manual',
    });

    expect(plan).not.toBeNull();
    expect(plan?.methods.map((m) => m.type)).toEqual(['manual_test']);
    expect(plan?.expectedObservations).toEqual([
      'Resolve uncertainties: Needs confirmation',
    ]);
  });

  it('adds adequacy gaps to expected observations', () => {
    const query: LiBrainianQuery = { intent: 'Release plan', depth: 'L1' };
    const adequacyReport: AdequacyReport = {
      spec: {
        id: 'adequacy_release',
        taskIntent: 'release',
        claimBoundaries: [],
        requirements: [],
        degradedMode: 'degraded',
      },
      missingEvidence: [
        {
          id: 'rollback_plan',
          description: 'Document and rehearse rollback plan.',
          signalId: 'hasRollbackPlan',
          severity: 'critical',
          evidenceSources: ['local'],
          evidenceCommands: ['rg -n \"rollback\" docs || true'],
        },
      ],
      satisfiedEvidence: [],
      blocking: true,
      degradedMode: 'degraded',
      evidenceCommands: ['rg -n \"rollback\" docs || true'],
      signals: {
        hasTests: false,
        hasIntegrationTests: false,
        hasLoadTests: false,
        hasCi: false,
        hasObservability: false,
        hasRollbackPlan: false,
        hasMigrations: false,
        hasApiContracts: false,
        hasAuthz: false,
        hasDatasetFiles: false,
        hasEvalHarness: false,
        hasModelCode: false,
        hasMetrics: false,
        hasDocs: false,
        hasI18n: false,
        hasAccessibilityTests: false,
        hasSecretsScanning: false,
        hasReleaseAutomation: false,
      },
      difficulties: [],
    };

    const plan = createQueryVerificationPlan({
      query,
      packs: [],
      adequacyReport,
      planId: 'vp-adequacy',
    });

    expect(plan?.expectedObservations).toEqual([
      'Address adequacy gaps: Document and rehearse rollback plan.',
    ]);
  });
});
