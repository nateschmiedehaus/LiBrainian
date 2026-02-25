import { describe, expect, it } from 'vitest';
import {
  applyIntentTypeRoutingOverrides,
  type IntentRoutingClassification,
} from '../query_intent_routing_overrides.js';

function baseClassification(): IntentRoutingClassification {
  return {
    isMetaQuery: false,
    isCodeQuery: true,
    isTestQuery: false,
    isProjectUnderstandingQuery: false,
    isRefactoringSafetyQuery: false,
    isBugInvestigationQuery: false,
    isSecurityAuditQuery: false,
    documentBias: 0.2,
    entityTypes: ['function', 'module'],
    refactoringTarget: undefined,
    bugContext: undefined,
    securityCheckTypes: undefined,
  };
}

describe('query_intent_routing_overrides', () => {
  it('applies document routing override with docs-first ordering', () => {
    const routed = applyIntentTypeRoutingOverrides(baseClassification(), 'document');
    expect(routed.isMetaQuery).toBe(true);
    expect(routed.isCodeQuery).toBe(false);
    expect(routed.documentBias).toBe(0.9);
    expect(routed.entityTypes).toEqual(['document', 'module', 'function']);
  });

  it('derives refactor target from affected files for impact/refactor intents', () => {
    const impact = applyIntentTypeRoutingOverrides(baseClassification(), 'impact', ['src/api/query.ts']);
    expect(impact.isRefactoringSafetyQuery).toBe(true);
    expect(impact.refactoringTarget).toBe('query');

    const refactor = applyIntentTypeRoutingOverrides(baseClassification(), 'refactor', ['src/core/engine.ts']);
    expect(refactor.isRefactoringSafetyQuery).toBe(true);
    expect(refactor.refactoringTarget).toBe('engine');
  });

  it('applies security and test overrides deterministically', () => {
    const security = applyIntentTypeRoutingOverrides(baseClassification(), 'security');
    expect(security.isSecurityAuditQuery).toBe(true);
    expect(security.securityCheckTypes).toEqual(['all']);
    expect(security.entityTypes).toEqual(['function', 'module', 'document']);

    const test = applyIntentTypeRoutingOverrides(baseClassification(), 'test');
    expect(test.isTestQuery).toBe(true);
    expect(test.isCodeQuery).toBe(true);
    expect(test.isMetaQuery).toBe(false);
    expect(test.documentBias).toBe(0.15);
  });
});
