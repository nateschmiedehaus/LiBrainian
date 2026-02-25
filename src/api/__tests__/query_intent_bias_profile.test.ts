import { describe, expect, it } from 'vitest';
import { buildQueryIntentBiasProfile } from '../query_intent_bias_profile.js';

describe('query_intent_bias_profile', () => {
  it('prioritizes documentation and rationale for WHY queries', () => {
    const profile = buildQueryIntentBiasProfile({
      metaMatches: 0,
      definitionMatches: 0,
      entryPointMatches: 0,
      projectUnderstandingMatches: 0,
      whyMatches: 2,
      architectureOverviewMatches: 0,
      isMetaQuery: false,
      isCodeQuery: false,
      isDefinitionQuery: false,
      isTestQuery: false,
      isEntryPointQuery: false,
      isProjectUnderstandingQuery: false,
      isWhyQuery: true,
      isArchitectureOverviewQuery: false,
    });
    expect(profile.documentBias).toBe(0.9);
    expect(profile.rationaleBias).toBeCloseTo(0.9, 10);
    expect(profile.entityTypes).toEqual(['document', 'function', 'module']);
  });

  it('caps meta-query document bias and preserves docs-first routing', () => {
    const profile = buildQueryIntentBiasProfile({
      metaMatches: 20,
      definitionMatches: 0,
      entryPointMatches: 0,
      projectUnderstandingMatches: 0,
      whyMatches: 0,
      architectureOverviewMatches: 0,
      isMetaQuery: true,
      isCodeQuery: false,
      isDefinitionQuery: false,
      isTestQuery: false,
      isEntryPointQuery: false,
      isProjectUnderstandingQuery: false,
      isWhyQuery: false,
      isArchitectureOverviewQuery: false,
    });
    expect(profile.documentBias).toBe(1);
    expect(profile.entityTypes).toEqual(['document', 'function', 'module']);
  });

  it('boosts architecture overview bias and minimum document bias floor', () => {
    const profile = buildQueryIntentBiasProfile({
      metaMatches: 0,
      definitionMatches: 0,
      entryPointMatches: 0,
      projectUnderstandingMatches: 0,
      whyMatches: 0,
      architectureOverviewMatches: 3,
      isMetaQuery: false,
      isCodeQuery: true,
      isDefinitionQuery: false,
      isTestQuery: false,
      isEntryPointQuery: false,
      isProjectUnderstandingQuery: false,
      isWhyQuery: false,
      isArchitectureOverviewQuery: true,
    });
    expect(profile.architectureOverviewBias).toBe(0.9);
    expect(profile.documentBias).toBe(0.8);
    expect(profile.entityTypes).toEqual(['module', 'document']);
  });

  it('returns code-first routing for test and code queries', () => {
    const testProfile = buildQueryIntentBiasProfile({
      metaMatches: 0,
      definitionMatches: 0,
      entryPointMatches: 0,
      projectUnderstandingMatches: 0,
      whyMatches: 0,
      architectureOverviewMatches: 0,
      isMetaQuery: false,
      isCodeQuery: true,
      isDefinitionQuery: false,
      isTestQuery: true,
      isEntryPointQuery: false,
      isProjectUnderstandingQuery: false,
      isWhyQuery: false,
      isArchitectureOverviewQuery: false,
    });
    expect(testProfile.documentBias).toBe(0.1);
    expect(testProfile.entityTypes).toEqual(['function', 'module']);

    const codeProfile = buildQueryIntentBiasProfile({
      metaMatches: 0,
      definitionMatches: 0,
      entryPointMatches: 0,
      projectUnderstandingMatches: 0,
      whyMatches: 0,
      architectureOverviewMatches: 0,
      isMetaQuery: false,
      isCodeQuery: true,
      isDefinitionQuery: false,
      isTestQuery: false,
      isEntryPointQuery: false,
      isProjectUnderstandingQuery: false,
      isWhyQuery: false,
      isArchitectureOverviewQuery: false,
    });
    expect(codeProfile.documentBias).toBe(0.1);
    expect(codeProfile.entityTypes).toEqual(['function', 'module']);
  });

  it('computes definition and entry-point biases with caps', () => {
    const profile = buildQueryIntentBiasProfile({
      metaMatches: 0,
      definitionMatches: 10,
      entryPointMatches: 10,
      projectUnderstandingMatches: 0,
      whyMatches: 0,
      architectureOverviewMatches: 0,
      isMetaQuery: false,
      isCodeQuery: false,
      isDefinitionQuery: true,
      isTestQuery: false,
      isEntryPointQuery: true,
      isProjectUnderstandingQuery: false,
      isWhyQuery: false,
      isArchitectureOverviewQuery: false,
    });
    expect(profile.definitionBias).toBe(1);
    expect(profile.entryPointBias).toBe(1);
  });
});
