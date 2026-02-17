import { describe, expect, it } from 'vitest';
import { DEFAULT_TECHNIQUE_COMPOSITIONS } from '../technique_compositions.js';
import {
  rankTechniqueCompositionsByKeyword,
  selectTechniqueCompositionsByKeyword,
} from '../composition_keywords.js';

describe('composition keyword ranking', () => {
  it('ranks specific cross-repo contract drift composition at top', () => {
    const ranked = rankTechniqueCompositionsByKeyword(
      'cross repo api contract drift before release',
      DEFAULT_TECHNIQUE_COMPOSITIONS
    );

    expect(ranked[0]?.id).toBe('tc_cross_repo_contract_drift');
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it('keeps expected security composition within top-3', () => {
    const ranked = rankTechniqueCompositionsByKeyword(
      'security threat audit for new API',
      DEFAULT_TECHNIQUE_COMPOSITIONS
    );

    const top3 = ranked.slice(0, 3).map((item) => item.id);
    expect(top3).toContain('tc_security_review');
  });

  it('select helper returns ranked composition order', () => {
    const ranked = rankTechniqueCompositionsByKeyword(
      'find root cause for regression and failure',
      DEFAULT_TECHNIQUE_COMPOSITIONS
    );
    const selected = selectTechniqueCompositionsByKeyword(
      'find root cause for regression and failure',
      DEFAULT_TECHNIQUE_COMPOSITIONS
    );

    expect(selected[0]?.id).toBe(ranked[0]?.id);
    expect(selected[0]?.id).toBe('tc_root_cause_recovery');
  });
});
