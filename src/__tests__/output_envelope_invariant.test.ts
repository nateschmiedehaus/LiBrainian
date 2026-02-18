import { describe, it, expect } from 'vitest';
import { getCurrentVersion } from '../api/versioning.js';
import { createVerificationPlan } from '../strategic/verification_plan.js';
import type { AdequacyReport, RepositorySignals } from '../api/difficulty_detectors.js';
import type { ConstructionPlan, LibrarianQuery, LibrarianResponse } from '../types.js';
import { ensureOutputEnvelope } from '../types.js';

function createBaseResponse(overrides: Partial<LibrarianResponse> = {}): LibrarianResponse {
  const query: LibrarianQuery = {
    intent: 'output envelope',
    depth: 'L0',
    llmRequirement: 'disabled',
  };
  return {
    query,
    packs: [],
    disclosures: [],
    traceId: 'trace-1',
    totalConfidence: 0,
    cacheHit: false,
    latencyMs: 1,
    version: getCurrentVersion(),
    drillDownHints: [],
    ...overrides,
  };
}

function createAdequacyReport(): AdequacyReport {
  const signals: RepositorySignals = {
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
  };
  return {
    spec: {
      id: 'adequacy-test',
      taskIntent: 'test',
      claimBoundaries: [],
      requirements: [],
      degradedMode: 'none',
    },
    missingEvidence: [],
    satisfiedEvidence: [],
    blocking: false,
    degradedMode: 'none',
    evidenceCommands: [],
    signals,
    difficulties: [],
  };
}

describe('Output envelope invariant', () => {
  it('fills missing envelope fields with disclosures', () => {
    const response = createBaseResponse();
    const normalized = ensureOutputEnvelope(response);

    expect(normalized.constructionPlan).toBeDefined();
    expect(normalized.adequacy).toBeUndefined();
    expect(normalized.verificationPlan).toBeUndefined();
    expect(normalized.disclosures).toContain('Construction plan missing; generated default plan.');
    expect(normalized.disclosures).toContain('Adequacy report missing; verification completeness is unknown.');
    expect(normalized.disclosures).toContain('Verification plan missing; follow-up checks may be incomplete.');
    expect(normalized.disclosures.join(' ')).not.toContain('unverified_by_trace');
    expect(normalized.epistemicsDebug).toEqual(
      expect.arrayContaining([
        'unverified_by_trace(construction_plan_missing)',
        'unverified_by_trace(adequacy_missing)',
        'unverified_by_trace(verification_plan_missing)',
      ])
    );
  });

  it('preserves provided envelope fields', () => {
    const constructionPlan: ConstructionPlan = {
      id: 'cp-test',
      templateId: 'T1',
      ucIds: ['UC-001'],
      intent: 'test',
      source: 'uc',
      createdAt: new Date('2026-01-25T00:00:00.000Z').toISOString(),
    };
    const adequacy = createAdequacyReport();
    const verificationPlan = createVerificationPlan({
      id: 'vp-test',
      target: 'test-target',
      methods: [{ type: 'manual_test', description: 'Manual check', automatable: false }],
      expectedObservations: [],
    });

    const response = createBaseResponse({
      constructionPlan,
      adequacy,
      verificationPlan,
      disclosures: [],
    });

    const normalized = ensureOutputEnvelope(response);
    expect(normalized.constructionPlan).toEqual(constructionPlan);
    expect(normalized.adequacy).toEqual(adequacy);
    expect(normalized.verificationPlan).toEqual(verificationPlan);
    expect(normalized.disclosures).toEqual([]);
  });
});
