/**
 * @fileoverview Tests for Argument Edge Query Helpers
 *
 * Tests cover:
 * - getArgumentEdgesForEntity() - retrieve argument edges for an entity
 * - getSupportingEvidence() - get supporting edges for a decision
 * - getContradictions() - get conflict edges for an entity
 * - getDecisionChain() - traverse decision supersession/dependency chains
 * - filterEdgesByType() - filter edges by type
 * - validateQueryEdgeTypes() - validate edge types from queries
 * - expandGraphWithEdgeFilter() - graph expansion with edge filtering
 *
 * Based on Task #15 argument edge types and ARGUMENTATION-STRUCTURES-FOR-CODE-REASONING.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getArgumentEdgesForEntity,
  getSupportingEvidence,
  getContradictions,
  getDecisionChain,
  filterEdgesByType,
  filterSupportEdges,
  filterConflictEdges,
  filterDecisionChainEdges,
  validateQueryEdgeTypes,
  hasArgumentEdgeFilter,
  expandGraphWithEdgeFilter,
  extractEdgeInfoForResponse,
} from '../argument_edges.js';
import type { LiBrainianStorage, KnowledgeGraphEdge, ArgumentEdge } from '../../storage/types.js';
import { createArgumentEdge } from '../../storage/types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

function createMockStorage(
  fromEdges: KnowledgeGraphEdge[] = [],
  toEdges: KnowledgeGraphEdge[] = []
): LiBrainianStorage {
  return {
    getKnowledgeEdgesFrom: vi.fn().mockResolvedValue(fromEdges),
    getKnowledgeEdgesTo: vi.fn().mockResolvedValue(toEdges),
    getKnowledgeEdges: vi.fn().mockResolvedValue([...fromEdges, ...toEdges]),
  } as unknown as LiBrainianStorage;
}

function createKnowledgeEdge(
  id: string,
  sourceId: string,
  targetId: string,
  edgeType: string,
  weight: number = 1.0,
  confidence: number = 1.0
): KnowledgeGraphEdge {
  return {
    id,
    sourceId,
    targetId,
    sourceType: 'function',
    targetType: 'function',
    edgeType: edgeType as KnowledgeGraphEdge['edgeType'],
    weight,
    confidence,
    metadata: {},
    computedAt: new Date().toISOString(),
  };
}

// ============================================================================
// getArgumentEdgesForEntity Tests
// ============================================================================

describe('getArgumentEdgesForEntity', () => {
  it('should return argument edges for an entity', async () => {
    const fromEdges = [
      createKnowledgeEdge('e1', 'decision-1', 'alt-1', 'contradicts', 0.9, 0.95),
      createKnowledgeEdge('e2', 'decision-1', 'func-1', 'calls', 0.8, 0.9), // Not an argument edge
    ];
    const toEdges = [
      createKnowledgeEdge('e3', 'evidence-1', 'decision-1', 'supports', 0.85, 0.9),
    ];

    const storage = createMockStorage(fromEdges, toEdges);
    const result = await getArgumentEdgesForEntity(storage, 'decision-1');

    expect(result.edges).toHaveLength(2); // contradicts and supports
    expect(result.edges.map(e => e.type)).toContain('contradicts');
    expect(result.edges.map(e => e.type)).toContain('supports');
    expect(result.entityId).toBe('decision-1');
  });

  it('should filter by specific edge types', async () => {
    const fromEdges = [
      createKnowledgeEdge('e1', 'decision-1', 'alt-1', 'contradicts', 0.9, 0.95),
      createKnowledgeEdge('e2', 'decision-1', 'old-dec', 'supersedes', 0.8, 0.9),
    ];
    const toEdges = [
      createKnowledgeEdge('e3', 'evidence-1', 'decision-1', 'supports', 0.85, 0.9),
    ];

    const storage = createMockStorage(fromEdges, toEdges);
    const result = await getArgumentEdgesForEntity(storage, 'decision-1', {
      edgeTypes: ['supports'],
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].type).toBe('supports');
    expect(result.edgeTypesSearched).toEqual(['supports']);
  });

  it('should filter by minimum weight', async () => {
    const fromEdges = [
      createKnowledgeEdge('e1', 'decision-1', 'alt-1', 'contradicts', 0.9, 0.95),
      createKnowledgeEdge('e2', 'decision-1', 'alt-2', 'contradicts', 0.3, 0.9),
    ];

    const storage = createMockStorage(fromEdges, []);
    const result = await getArgumentEdgesForEntity(storage, 'decision-1', {
      minWeight: 0.5,
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].weight).toBeGreaterThanOrEqual(0.5);
  });

  it('should sort by weight descending by default', async () => {
    const fromEdges = [
      createKnowledgeEdge('e1', 'decision-1', 'alt-1', 'contradicts', 0.5, 0.95),
      createKnowledgeEdge('e2', 'decision-1', 'alt-2', 'contradicts', 0.9, 0.95),
      createKnowledgeEdge('e3', 'decision-1', 'alt-3', 'contradicts', 0.7, 0.95),
    ];

    const storage = createMockStorage(fromEdges, []);
    const result = await getArgumentEdgesForEntity(storage, 'decision-1');

    expect(result.edges[0].weight).toBe(0.9);
    expect(result.edges[1].weight).toBe(0.7);
    expect(result.edges[2].weight).toBe(0.5);
  });

  it('should respect limit option', async () => {
    const fromEdges = Array.from({ length: 10 }, (_, i) =>
      createKnowledgeEdge(`e${i}`, 'decision-1', `alt-${i}`, 'contradicts', 0.9, 0.95)
    );

    const storage = createMockStorage(fromEdges, []);
    const result = await getArgumentEdgesForEntity(storage, 'decision-1', {
      limit: 3,
    });

    expect(result.edges).toHaveLength(3);
    expect(result.totalCount).toBe(10);
  });
});

// ============================================================================
// getSupportingEvidence Tests
// ============================================================================

describe('getSupportingEvidence', () => {
  it('should return supporting and warrant edges', async () => {
    const toEdges = [
      createKnowledgeEdge('e1', 'evidence-1', 'decision-1', 'supports', 0.9, 0.95),
      createKnowledgeEdge('e2', 'principle-1', 'decision-1', 'warrants', 1.0, 1.0),
      createKnowledgeEdge('e3', 'alt-1', 'decision-1', 'contradicts', 0.8, 0.9), // Not support
    ];

    const storage = createMockStorage([], toEdges);
    const result = await getSupportingEvidence(storage, 'decision-1');

    expect(result.supports).toHaveLength(1);
    expect(result.warrants).toHaveLength(1);
    expect(result.decisionId).toBe('decision-1');
    expect(result.totalSupportStrength).toBeGreaterThan(0);
  });

  it('should calculate total support strength as average weight', async () => {
    const toEdges = [
      createKnowledgeEdge('e1', 'evidence-1', 'decision-1', 'supports', 0.8, 0.95),
      createKnowledgeEdge('e2', 'evidence-2', 'decision-1', 'supports', 0.6, 0.95),
    ];

    const storage = createMockStorage([], toEdges);
    const result = await getSupportingEvidence(storage, 'decision-1');

    expect(result.totalSupportStrength).toBeCloseTo(0.7, 1); // (0.8 + 0.6) / 2
  });

  it('should return zero support strength when no evidence', async () => {
    const storage = createMockStorage([], []);
    const result = await getSupportingEvidence(storage, 'decision-1');

    expect(result.supports).toHaveLength(0);
    expect(result.warrants).toHaveLength(0);
    expect(result.totalSupportStrength).toBe(0);
  });
});

// ============================================================================
// getContradictions Tests
// ============================================================================

describe('getContradictions', () => {
  it('should return all conflict edge types', async () => {
    const fromEdges = [
      createKnowledgeEdge('e1', 'entity-1', 'alt-1', 'contradicts', 0.9, 0.95),
    ];
    const toEdges = [
      createKnowledgeEdge('e2', 'attack-1', 'entity-1', 'undermines', 0.8, 0.9),
      createKnowledgeEdge('e3', 'risk-1', 'entity-1', 'rebuts', 0.7, 0.85),
    ];

    const storage = createMockStorage(fromEdges, toEdges);
    const result = await getContradictions(storage, 'entity-1');

    expect(result.contradictions).toHaveLength(1);
    expect(result.undermines).toHaveLength(1);
    expect(result.rebuttals).toHaveLength(1);
    expect(result.totalConflicts).toBe(3);
  });

  it('should assess severity as critical for strict rebuttals', async () => {
    const toEdges = [
      {
        ...createKnowledgeEdge('e1', 'risk-1', 'entity-1', 'rebuts', 0.9, 0.95),
        metadata: { ruleType: 'strict' },
      },
    ];

    const storage = createMockStorage([], toEdges);
    const result = await getContradictions(storage, 'entity-1');

    expect(result.severity).toBe('critical');
  });

  it('should assess severity as high for multiple conflicts', async () => {
    const toEdges = [
      createKnowledgeEdge('e1', 'attack-1', 'entity-1', 'contradicts', 0.8, 0.9),
      createKnowledgeEdge('e2', 'attack-2', 'entity-1', 'contradicts', 0.75, 0.9),
    ];

    const storage = createMockStorage([], toEdges);
    const result = await getContradictions(storage, 'entity-1');

    expect(result.severity).toBe('high');
  });

  it('should assess severity as low when no conflicts', async () => {
    const storage = createMockStorage([], []);
    const result = await getContradictions(storage, 'entity-1');

    expect(result.severity).toBe('low');
    expect(result.totalConflicts).toBe(0);
  });
});

// ============================================================================
// getDecisionChain Tests
// ============================================================================

describe('getDecisionChain', () => {
  it('should return supersession chain', async () => {
    const fromEdges = [
      createKnowledgeEdge('e1', 'decision-new', 'decision-old', 'supersedes', 1.0, 1.0),
    ];
    const toEdges = [
      createKnowledgeEdge('e2', 'decision-newer', 'decision-new', 'supersedes', 1.0, 1.0),
    ];

    const storage = createMockStorage(fromEdges, toEdges);
    const result = await getDecisionChain(storage, 'decision-new');

    expect(result.supersedes).toHaveLength(1);
    expect(result.supersedes[0].targetId).toBe('decision-old');
    expect(result.supersededBy).toHaveLength(1);
    expect(result.supersededBy[0].sourceId).toBe('decision-newer');
  });

  it('should return dependency chain', async () => {
    const fromEdges = [
      createKnowledgeEdge('e1', 'decision-1', 'decision-2', 'depends_on_decision', 0.8, 0.9),
    ];
    const toEdges = [
      createKnowledgeEdge('e2', 'decision-3', 'decision-1', 'depends_on_decision', 0.7, 0.85),
    ];

    const storage = createMockStorage(fromEdges, toEdges);
    const result = await getDecisionChain(storage, 'decision-1');

    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0].targetId).toBe('decision-2');
    expect(result.dependents).toHaveLength(1);
    expect(result.dependents[0].sourceId).toBe('decision-3');
  });

  it('should calculate chain depth', async () => {
    // Create a chain: decision-1 -> decision-2 -> decision-3
    const storage = {
      getKnowledgeEdgesFrom: vi.fn()
        .mockResolvedValueOnce([createKnowledgeEdge('e1', 'decision-1', 'decision-2', 'supersedes')])
        .mockResolvedValueOnce([createKnowledgeEdge('e2', 'decision-2', 'decision-3', 'supersedes')])
        .mockResolvedValueOnce([]), // No more edges from decision-3
      getKnowledgeEdgesTo: vi.fn().mockResolvedValue([]),
    } as unknown as LiBrainianStorage;

    const result = await getDecisionChain(storage, 'decision-1');

    expect(result.chainDepth).toBe(2); // Two levels of supersession
  });
});

// ============================================================================
// Filter Helper Tests
// ============================================================================

describe('filterEdgesByType', () => {
  it('should filter edges by type', () => {
    const edges = [
      { edgeType: 'supports', id: '1' },
      { edgeType: 'calls', id: '2' },
      { edgeType: 'warrants', id: '3' },
    ];

    const filtered = filterEdgesByType(edges, ['supports', 'warrants']);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(e => e.id)).toEqual(['1', '3']);
  });

  it('should return all edges when empty filter array', () => {
    const edges = [
      { edgeType: 'supports', id: '1' },
      { edgeType: 'calls', id: '2' },
    ];

    const filtered = filterEdgesByType(edges, []);

    expect(filtered).toHaveLength(2);
  });

  it('should handle edges with type instead of edgeType', () => {
    const edges = [
      { type: 'supports', id: '1' },
      { type: 'calls', id: '2' },
    ];

    const filtered = filterEdgesByType(edges, ['supports']);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
  });
});

describe('filterSupportEdges', () => {
  it('should return only support edges', () => {
    const edges: ArgumentEdge[] = [
      createArgumentEdge({ id: '1', sourceId: 'a', targetId: 'b', type: 'supports' }),
      createArgumentEdge({ id: '2', sourceId: 'a', targetId: 'b', type: 'warrants' }),
      createArgumentEdge({ id: '3', sourceId: 'a', targetId: 'b', type: 'contradicts' }),
    ];

    const filtered = filterSupportEdges(edges);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(e => e.type)).toContain('supports');
    expect(filtered.map(e => e.type)).toContain('warrants');
  });
});

describe('filterConflictEdges', () => {
  it('should return only conflict edges', () => {
    const edges: ArgumentEdge[] = [
      createArgumentEdge({ id: '1', sourceId: 'a', targetId: 'b', type: 'supports' }),
      createArgumentEdge({ id: '2', sourceId: 'a', targetId: 'b', type: 'contradicts' }),
      createArgumentEdge({ id: '3', sourceId: 'a', targetId: 'b', type: 'undermines' }),
      createArgumentEdge({ id: '4', sourceId: 'a', targetId: 'b', type: 'rebuts' }),
    ];

    const filtered = filterConflictEdges(edges);

    expect(filtered).toHaveLength(3);
    expect(filtered.map(e => e.type)).toContain('contradicts');
    expect(filtered.map(e => e.type)).toContain('undermines');
    expect(filtered.map(e => e.type)).toContain('rebuts');
  });
});

describe('filterDecisionChainEdges', () => {
  it('should return only decision chain edges', () => {
    const edges: ArgumentEdge[] = [
      createArgumentEdge({ id: '1', sourceId: 'a', targetId: 'b', type: 'supersedes' }),
      createArgumentEdge({ id: '2', sourceId: 'a', targetId: 'b', type: 'depends_on_decision' }),
      createArgumentEdge({ id: '3', sourceId: 'a', targetId: 'b', type: 'supports' }),
    ];

    const filtered = filterDecisionChainEdges(edges);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(e => e.type)).toContain('supersedes');
    expect(filtered.map(e => e.type)).toContain('depends_on_decision');
  });
});

// ============================================================================
// validateQueryEdgeTypes Tests
// ============================================================================

describe('validateQueryEdgeTypes', () => {
  it('should separate knowledge and argument edge types', () => {
    const result = validateQueryEdgeTypes(['supports', 'calls', 'warrants', 'imports']);

    expect(result.argumentEdgeTypes).toEqual(['supports', 'warrants']);
    expect(result.knowledgeEdgeTypes).toEqual(['calls', 'imports']);
    expect(result.allTypes).toHaveLength(4);
  });

  it('should return empty arrays for undefined input', () => {
    const result = validateQueryEdgeTypes(undefined);

    expect(result.argumentEdgeTypes).toHaveLength(0);
    expect(result.knowledgeEdgeTypes).toHaveLength(0);
    expect(result.allTypes).toHaveLength(0);
  });

  it('should ignore invalid edge types', () => {
    const result = validateQueryEdgeTypes(['supports', 'invalid_type', 'warrants']);

    expect(result.argumentEdgeTypes).toEqual(['supports', 'warrants']);
    expect(result.knowledgeEdgeTypes).toHaveLength(0);
  });
});

describe('hasArgumentEdgeFilter', () => {
  it('should return true when argument edge types present', () => {
    expect(hasArgumentEdgeFilter(['supports', 'calls'])).toBe(true);
    expect(hasArgumentEdgeFilter(['warrants'])).toBe(true);
  });

  it('should return false when only knowledge edge types', () => {
    expect(hasArgumentEdgeFilter(['calls', 'imports'])).toBe(false);
  });

  it('should return false for undefined or empty', () => {
    expect(hasArgumentEdgeFilter(undefined)).toBe(false);
    expect(hasArgumentEdgeFilter([])).toBe(false);
  });
});

// ============================================================================
// expandGraphWithEdgeFilter Tests
// ============================================================================

describe('expandGraphWithEdgeFilter', () => {
  it('should expand graph following filtered edge types', async () => {
    const storage = {
      getKnowledgeEdgesFrom: vi.fn()
        .mockResolvedValueOnce([
          createKnowledgeEdge('e1', 'root', 'node-1', 'supports'),
          createKnowledgeEdge('e2', 'root', 'node-2', 'calls'), // Will be filtered out
        ])
        .mockResolvedValueOnce([
          createKnowledgeEdge('e3', 'node-1', 'node-3', 'supports'),
        ])
        .mockResolvedValue([]),
      getKnowledgeEdgesTo: vi.fn().mockResolvedValue([]),
    } as unknown as LiBrainianStorage;

    const result = await expandGraphWithEdgeFilter(
      storage,
      ['root'],
      ['supports'],
      2
    );

    expect(result).toContain('root');
    expect(result).toContain('node-1');
    expect(result).toContain('node-3');
    expect(result).not.toContain('node-2'); // Filtered out
  });

  it('should respect maxDepth', async () => {
    const storage = {
      getKnowledgeEdgesFrom: vi.fn()
        .mockResolvedValueOnce([createKnowledgeEdge('e1', 'root', 'node-1', 'supports')])
        .mockResolvedValue([]), // Only one level of expansion
      getKnowledgeEdgesTo: vi.fn().mockResolvedValue([]),
    } as unknown as LiBrainianStorage;

    const result = await expandGraphWithEdgeFilter(
      storage,
      ['root'],
      ['supports'],
      1
    );

    expect(result.size).toBe(2); // root + node-1
  });

  it('should return all edges when no filter specified', async () => {
    const storage = {
      getKnowledgeEdgesFrom: vi.fn().mockResolvedValue([
        createKnowledgeEdge('e1', 'root', 'node-1', 'supports'),
        createKnowledgeEdge('e2', 'root', 'node-2', 'calls'),
      ]),
      getKnowledgeEdgesTo: vi.fn().mockResolvedValue([]),
    } as unknown as LiBrainianStorage;

    const result = await expandGraphWithEdgeFilter(
      storage,
      ['root'],
      [], // No filter
      1
    );

    expect(result).toContain('node-1');
    expect(result).toContain('node-2');
  });
});

// ============================================================================
// extractEdgeInfoForResponse Tests
// ============================================================================

describe('extractEdgeInfoForResponse', () => {
  it('should convert edges to simplified format', () => {
    const edges: KnowledgeGraphEdge[] = [
      createKnowledgeEdge('e1', 'source-1', 'target-1', 'supports', 0.9, 0.95),
      createKnowledgeEdge('e2', 'source-2', 'target-2', 'calls', 0.8, 0.9),
    ];

    const result = extractEdgeInfoForResponse(edges);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'supports',
      sourceId: 'source-1',
      targetId: 'target-1',
      weight: 0.9,
      isArgumentEdge: true,
    });
    expect(result[1].isArgumentEdge).toBe(false);
  });
});

// ============================================================================
// Integration-style Tests
// ============================================================================

describe('Real-world Scenario: ADR Evidence Query', () => {
  it('should answer "what supports ADR-001?" correctly', async () => {
    // Simulate an ADR with supporting evidence
    const toEdges = [
      createKnowledgeEdge('e1', 'benchmark-2024', 'ADR-001', 'supports', 0.9, 0.95),
      createKnowledgeEdge('e2', 'cap-theorem', 'ADR-001', 'warrants', 1.0, 1.0),
      createKnowledgeEdge('e3', 'latency-req', 'ADR-001', 'qualifies', 0.8, 0.85),
    ];

    const storage = createMockStorage([], toEdges);

    // Query for supporting evidence
    const result = await getSupportingEvidence(storage, 'ADR-001');

    expect(result.supports).toHaveLength(1);
    expect(result.supports[0].sourceId).toBe('benchmark-2024');
    expect(result.warrants).toHaveLength(1);
    expect(result.warrants[0].sourceId).toBe('cap-theorem');
    expect(result.totalSupportStrength).toBeGreaterThan(0.9);
  });

  it('should answer "what contradicts this approach?" correctly', async () => {
    const fromEdges = [
      createKnowledgeEdge('e1', 'decision-1', 'alternative-sql', 'contradicts', 1.0, 1.0),
    ];
    const toEdges = [
      createKnowledgeEdge('e2', 'security-concern', 'decision-1', 'undermines', 0.7, 0.8),
      createKnowledgeEdge('e3', 'compliance-req', 'decision-1', 'rebuts', 0.9, 0.95),
    ];

    const storage = createMockStorage(fromEdges, toEdges);

    const result = await getContradictions(storage, 'decision-1');

    expect(result.contradictions).toHaveLength(1);
    expect(result.undermines).toHaveLength(1);
    expect(result.rebuttals).toHaveLength(1);
    expect(result.totalConflicts).toBe(3);
    // Severity is 'critical' because there are 3+ conflicts with high avg weight >= 0.8
    expect(['high', 'critical']).toContain(result.severity);
  });

  it('should answer "show me the decision chain" correctly', async () => {
    // decision-v3 supersedes decision-v2 supersedes decision-v1
    const storage = {
      getKnowledgeEdgesFrom: vi.fn()
        .mockResolvedValueOnce([
          createKnowledgeEdge('e1', 'decision-v2', 'decision-v1', 'supersedes'),
          createKnowledgeEdge('e2', 'decision-v2', 'auth-decision', 'depends_on_decision'),
        ])
        .mockResolvedValueOnce([]) // decision-v1 has no supersedes
        .mockResolvedValue([]),
      getKnowledgeEdgesTo: vi.fn()
        .mockResolvedValueOnce([
          createKnowledgeEdge('e3', 'decision-v3', 'decision-v2', 'supersedes'),
        ])
        .mockResolvedValue([]),
    } as unknown as LiBrainianStorage;

    const result = await getDecisionChain(storage, 'decision-v2');

    expect(result.supersedes).toHaveLength(1);
    expect(result.supersedes[0].targetId).toBe('decision-v1');
    expect(result.supersededBy).toHaveLength(1);
    expect(result.supersededBy[0].sourceId).toBe('decision-v3');
    expect(result.dependencies).toHaveLength(1);
    expect(result.chainDepth).toBeGreaterThanOrEqual(1);
  });
});
