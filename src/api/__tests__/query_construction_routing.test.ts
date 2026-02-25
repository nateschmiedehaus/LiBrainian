import { describe, expect, it } from 'vitest';
import {
  CONSTRUCTION_TO_CLASSIFICATION_MAP,
  getConstructionIdFromClassification,
  isConstructionEnabled,
} from '../query_construction_routing.js';

describe('query_construction_routing', () => {
  it('enables all constructions when filter is undefined', () => {
    expect(isConstructionEnabled('refactoring-safety-checker', undefined)).toBe(true);
  });

  it('enables only selected constructions when filter is provided', () => {
    expect(isConstructionEnabled('refactoring-safety-checker', ['refactoring-safety-checker'])).toBe(true);
    expect(isConstructionEnabled('bug-investigation-assistant', ['refactoring-safety-checker'])).toBe(false);
  });

  it('resolves construction id from classification map', () => {
    const map = {
      'refactoring-safety-checker': 'isRefactoringSafetyQuery',
      'bug-investigation-assistant': 'isBugInvestigationQuery',
    } as const;
    expect(getConstructionIdFromClassification('isRefactoringSafetyQuery', map)).toBe('refactoring-safety-checker');
  });

  it('returns undefined when classification is not in the map', () => {
    const map: Record<string, string> = {
      'refactoring-safety-checker': 'isRefactoringSafetyQuery',
    };
    expect(getConstructionIdFromClassification('isCodeQuery', map)).toBeUndefined();
  });

  it('exports non-empty default constructable classification map', () => {
    expect(Object.keys(CONSTRUCTION_TO_CLASSIFICATION_MAP).length).toBeGreaterThan(0);
  });
});
