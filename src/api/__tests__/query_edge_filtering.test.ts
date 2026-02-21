/**
 * @fileoverview Tests for Query Edge Filtering Feature
 *
 * Tests the edgeTypes filter in LiBrainianQuery which enables:
 * - "Show me what supports this decision" → filter to 'supports' edges
 * - "Show me contradicting alternatives" → filter to 'contradicts' edges
 * - "Show me the decision chain" → filter to 'supersedes', 'depends_on_decision'
 *
 * Based on Task #15 argument edge types.
 */

import { describe, it, expect } from 'vitest';
import { validateQueryEdgeTypes, hasArgumentEdgeFilter } from '../argument_edges.js';
import type { LiBrainianQuery, EdgeQueryResult, EdgeInfo } from '../../types.js';

describe('Query Edge Filtering', () => {
  describe('LiBrainianQuery.edgeTypes', () => {
    it('should accept argument edge types', () => {
      const query: LiBrainianQuery = {
        intent: 'What supports ADR-001?',
        depth: 'L2',
        edgeTypes: ['supports', 'warrants'],
      };

      expect(query.edgeTypes).toHaveLength(2);
      expect(query.edgeTypes).toContain('supports');
      expect(query.edgeTypes).toContain('warrants');
    });

    it('should accept knowledge edge types', () => {
      const query: LiBrainianQuery = {
        intent: 'What imports this module?',
        depth: 'L2',
        edgeTypes: ['imports', 'calls'],
      };

      expect(query.edgeTypes).toHaveLength(2);
      expect(query.edgeTypes).toContain('imports');
      expect(query.edgeTypes).toContain('calls');
    });

    it('should accept mixed edge types', () => {
      const query: LiBrainianQuery = {
        intent: 'Show relationships for this entity',
        depth: 'L2',
        edgeTypes: ['supports', 'calls', 'contradicts', 'imports'],
      };

      expect(query.edgeTypes).toHaveLength(4);

      const validated = validateQueryEdgeTypes(query.edgeTypes);
      expect(validated.argumentEdgeTypes).toEqual(['supports', 'contradicts']);
      expect(validated.knowledgeEdgeTypes).toEqual(['calls', 'imports']);
    });
  });

  describe('Edge Type Validation', () => {
    it('should correctly categorize all 8 argument edge types', () => {
      const allArgumentTypes = [
        'supports',
        'warrants',
        'qualifies',
        'contradicts',
        'undermines',
        'rebuts',
        'supersedes',
        'depends_on_decision',
      ];

      const validated = validateQueryEdgeTypes(allArgumentTypes);

      expect(validated.argumentEdgeTypes).toHaveLength(8);
      expect(validated.knowledgeEdgeTypes).toHaveLength(0);
    });

    it('should correctly categorize knowledge edge types', () => {
      const knowledgeTypes = [
        'imports',
        'calls',
        'extends',
        'implements',
        'clone_of',
        'co_changed',
      ];

      const validated = validateQueryEdgeTypes(knowledgeTypes);

      expect(validated.knowledgeEdgeTypes).toHaveLength(6);
      expect(validated.argumentEdgeTypes).toHaveLength(0);
    });

    it('should filter out invalid edge types', () => {
      const mixedTypes = ['supports', 'invalid_type', 'calls', 'fake_edge'];

      const validated = validateQueryEdgeTypes(mixedTypes);

      expect(validated.argumentEdgeTypes).toEqual(['supports']);
      expect(validated.knowledgeEdgeTypes).toEqual(['calls']);
      expect(validated.allTypes).toHaveLength(2);
    });

    it('should handle empty or undefined edge types', () => {
      expect(validateQueryEdgeTypes(undefined).allTypes).toHaveLength(0);
      expect(validateQueryEdgeTypes([]).allTypes).toHaveLength(0);
    });
  });

  describe('Argument Edge Filter Detection', () => {
    it('should detect when argument edge types are present', () => {
      expect(hasArgumentEdgeFilter(['supports', 'calls'])).toBe(true);
      expect(hasArgumentEdgeFilter(['warrants'])).toBe(true);
      expect(hasArgumentEdgeFilter(['supersedes', 'depends_on_decision'])).toBe(true);
    });

    it('should return false when only knowledge edge types', () => {
      expect(hasArgumentEdgeFilter(['calls', 'imports'])).toBe(false);
      expect(hasArgumentEdgeFilter(['extends', 'implements'])).toBe(false);
    });

    it('should return false for undefined or empty', () => {
      expect(hasArgumentEdgeFilter(undefined)).toBe(false);
      expect(hasArgumentEdgeFilter([])).toBe(false);
    });
  });

  describe('EdgeQueryResult Structure', () => {
    it('should have correct structure', () => {
      const result: EdgeQueryResult = {
        edges: [
          {
            type: 'supports',
            sourceId: 'evidence-1',
            targetId: 'decision-1',
            weight: 0.9,
            confidence: 0.95,
            isArgumentEdge: true,
          },
          {
            type: 'calls',
            sourceId: 'func-1',
            targetId: 'func-2',
            weight: 1.0,
            confidence: 1.0,
            isArgumentEdge: false,
          },
        ],
        edgeTypesSearched: ['supports', 'calls'],
        totalCount: 2,
      };

      expect(result.edges).toHaveLength(2);
      expect(result.edgeTypesSearched).toHaveLength(2);
      expect(result.totalCount).toBe(2);

      const supportEdge = result.edges.find(e => e.type === 'supports');
      expect(supportEdge?.isArgumentEdge).toBe(true);

      const callEdge = result.edges.find(e => e.type === 'calls');
      expect(callEdge?.isArgumentEdge).toBe(false);
    });
  });

  describe('Use Case Queries', () => {
    describe('"What supports this decision?" query', () => {
      it('should use supports and warrants edge types', () => {
        const query: LiBrainianQuery = {
          intent: 'What supports ADR-001?',
          depth: 'L2',
          edgeTypes: ['supports', 'warrants'],
        };

        const validated = validateQueryEdgeTypes(query.edgeTypes);
        expect(validated.argumentEdgeTypes).toEqual(['supports', 'warrants']);
        expect(hasArgumentEdgeFilter(query.edgeTypes)).toBe(true);
      });
    });

    describe('"What contradicts this approach?" query', () => {
      it('should use conflict edge types', () => {
        const query: LiBrainianQuery = {
          intent: 'What contradicts this approach?',
          depth: 'L2',
          edgeTypes: ['contradicts', 'undermines', 'rebuts'],
        };

        const validated = validateQueryEdgeTypes(query.edgeTypes);
        expect(validated.argumentEdgeTypes).toHaveLength(3);
        expect(validated.argumentEdgeTypes).toContain('contradicts');
        expect(validated.argumentEdgeTypes).toContain('undermines');
        expect(validated.argumentEdgeTypes).toContain('rebuts');
      });
    });

    describe('"Show me the decision chain" query', () => {
      it('should use decision chain edge types', () => {
        const query: LiBrainianQuery = {
          intent: 'Show me the decision chain for ADR-015',
          depth: 'L2',
          edgeTypes: ['supersedes', 'depends_on_decision'],
        };

        const validated = validateQueryEdgeTypes(query.edgeTypes);
        expect(validated.argumentEdgeTypes).toEqual(['supersedes', 'depends_on_decision']);
      });
    });

    describe('"What imports this module?" query', () => {
      it('should use imports knowledge edge type', () => {
        const query: LiBrainianQuery = {
          intent: 'What imports utils.ts?',
          depth: 'L2',
          edgeTypes: ['imports'],
        };

        const validated = validateQueryEdgeTypes(query.edgeTypes);
        expect(validated.knowledgeEdgeTypes).toEqual(['imports']);
        expect(validated.argumentEdgeTypes).toHaveLength(0);
        expect(hasArgumentEdgeFilter(query.edgeTypes)).toBe(false);
      });
    });
  });
});
