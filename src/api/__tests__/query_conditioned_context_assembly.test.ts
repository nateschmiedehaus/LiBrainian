import { describe, it, expect } from 'vitest';
import type { ContextPack, LibrarianResponse, LibrarianVersion } from '../../types.js';
import { assembleContextFromResponse } from '../context_assembly.js';
import {
  assembleIntentConditionedPacks,
  classifyAssemblyIntent,
  listContextTemplates,
} from '../query_conditioned_assembly.js';

const VERSION: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'mvp',
  indexedAt: new Date('2026-02-01T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

function makePack(overrides: Partial<ContextPack>): ContextPack {
  return {
    packId: 'pack-default',
    packType: 'function_context',
    targetId: 'function:default',
    summary: 'default summary',
    keyFacts: ['fact'],
    codeSnippets: [],
    relatedFiles: ['src/default.ts'],
    confidence: 0.7,
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: VERSION,
    invalidationTriggers: [],
    ...overrides,
  };
}

function makeResponse(intent: string, packs: ContextPack[]): LibrarianResponse {
  return {
    query: { intent, depth: 'L1' },
    packs,
    disclosures: [],
    traceId: 'unverified_by_trace(replay_unavailable)',
    constructionPlan: {
      id: 'cp_test',
      templateId: 'T1',
      ucIds: [],
      intent,
      source: 'default',
      createdAt: '2026-02-01T00:00:00.000Z',
    },
    totalConfidence: 0.82,
    cacheHit: false,
    latencyMs: 20,
    version: VERSION,
    drillDownHints: [],
  };
}

describe('query-conditioned context assembly', () => {
  it('keeps bug-fix signals and excludes architecture-only packs for bug_fix intents', async () => {
    const response = makeResponse('Fix NullPointerException in UserAuthService.validateToken', [
      makePack({
        packId: 'p-function',
        packType: 'function_context',
        summary: 'validateToken function implementation',
        relatedFiles: ['src/auth/user_auth_service.ts'],
      }),
      makePack({
        packId: 'p-callers',
        packType: 'call_flow',
        summary: 'Callers of validateToken',
        relatedFiles: ['src/auth/auth_controller.ts'],
      }),
      makePack({
        packId: 'p-change',
        packType: 'change_impact',
        summary: 'Recent auth token validation changes',
        relatedFiles: ['src/auth/user_auth_service.ts'],
      }),
      makePack({
        packId: 'p-arch',
        packType: 'project_understanding',
        summary: 'High-level system architecture',
        relatedFiles: ['docs/architecture.md'],
      }),
    ]);

    const context = await assembleContextFromResponse(response, { level: 'L1' });
    const requiredFiles = context.required.targetFiles.map((file) => file.filePath);
    const provided = new Set(context.providedFiles);

    expect(requiredFiles).toContain('src/auth/user_auth_service.ts');
    expect(context.supplementary.recentChanges.map((entry) => entry.packId)).toContain('p-change');
    expect(provided.has('docs/architecture.md')).toBe(false);
  });

  it('assembles architecture context without pulling bug-fix recent changes', async () => {
    const response = makeResponse('Explain how authentication works in this system', [
      makePack({
        packId: 'p-arch',
        packType: 'project_understanding',
        summary: 'Authentication architecture overview',
        relatedFiles: ['docs/architecture/auth.md'],
      }),
      makePack({
        packId: 'p-module',
        packType: 'module_context',
        summary: 'Authentication module boundaries',
        relatedFiles: ['src/auth/module.ts'],
      }),
      makePack({
        packId: 'p-doc',
        packType: 'doc_context',
        summary: 'Auth subsystem docs',
        relatedFiles: ['docs/auth/overview.md'],
      }),
      makePack({
        packId: 'p-flow',
        packType: 'call_flow',
        summary: 'Request to session data flow',
        relatedFiles: ['src/auth/session_flow.ts'],
      }),
      makePack({
        packId: 'p-change',
        packType: 'change_impact',
        summary: 'Latest hotfix in auth module',
        relatedFiles: ['src/auth/hotfix.ts'],
      }),
    ]);

    const context = await assembleContextFromResponse(response, { level: 'L1' });
    const provided = new Set(context.providedFiles);

    expect(provided.has('docs/architecture/auth.md')).toBe(true);
    expect(provided.has('src/auth/module.ts')).toBe(true);
    expect(context.supplementary.recentChanges).toHaveLength(0);
    expect(provided.has('src/auth/hotfix.ts')).toBe(false);
  });

  it('skips optional retrieval steps when earlier steps consume budget', () => {
    const packs = [
      makePack({
        packId: 'p-pattern',
        packType: 'pattern_context',
        summary: 'x'.repeat(900),
        relatedFiles: ['src/patterns/auth_pattern.ts'],
      }),
      makePack({
        packId: 'p-integration',
        packType: 'module_context',
        summary: 'y'.repeat(900),
        relatedFiles: ['src/auth/integration.ts'],
      }),
      makePack({
        packId: 'p-optional-change',
        packType: 'change_impact',
        summary: 'tiny',
        relatedFiles: ['src/auth/recent_change.ts'],
      }),
    ];

    const assembled = assembleIntentConditionedPacks(packs, {
      queryIntent: 'Add a new feature for refresh token rotation',
      maxTokens: 620,
    });
    const selectedIds = assembled.packs.map((pack) => pack.packId);

    expect(selectedIds.some((id) => id === 'p-pattern' || id === 'p-integration')).toBe(true);
    expect(selectedIds).not.toContain('p-optional-change');
    expect(assembled.tokensUsed).toBeLessThanOrEqual(620);
    expect(assembled.skippedSteps.some((entry) => entry.step === 'recent_changes')).toBe(true);
  });

  it('defines all five core query-conditioned templates', () => {
    const templates = listContextTemplates();
    const intents = templates.map((template) => template.intent);

    expect(intents).toContain('bug_fix');
    expect(intents).toContain('architecture');
    expect(intents).toContain('feature_addition');
    expect(intents).toContain('security_audit');
    expect(intents).toContain('refactoring');
  });

  it('classifies bug-fix and architecture intents differently', () => {
    const bugFix = classifyAssemblyIntent('Fix null pointer in session validation');
    const architecture = classifyAssemblyIntent('How does authentication architecture work?');

    expect(bugFix.primaryIntent).toBe('bug_fix');
    expect(architecture.primaryIntent).toBe('architecture');
    expect(bugFix.primaryIntent).not.toBe(architecture.primaryIntent);
  });
});
