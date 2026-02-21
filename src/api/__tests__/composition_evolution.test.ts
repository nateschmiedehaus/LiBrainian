import crypto from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { CompositionEvolutionEngine } from '../composition_evolution.js';
import { recordExecutionTrace, type ExecutionTrace } from '../../state/execution_traces.js';
import { saveTechniquePrimitive } from '../../state/technique_primitives.js';
import { saveTechniqueComposition } from '../../state/technique_compositions.js';
import { DEFAULT_TECHNIQUE_PRIMITIVES } from '../technique_library.js';
import type { LiBrainianStorage } from '../../storage/types.js';

type StorageStub = Pick<LiBrainianStorage, 'getState' | 'setState'>;

class MockStorage implements StorageStub {
  private state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
}

const REQUIRED_PRIMITIVES = ['tp_hypothesis', 'tp_verify_plan', 'tp_change_impact'];

const baseTrace: ExecutionTrace = {
  executionId: 'exec_base',
  compositionId: 'tc_base',
  primitiveSequence: ['tp_hypothesis', 'tp_verify_plan'],
  operatorsUsed: [],
  intent: 'Verify auth flow',
  outcome: 'success',
  durationMs: 1200,
  timestamp: '2026-01-01T00:00:00.000Z',
};

async function seedPrimitives(storage: MockStorage): Promise<void> {
  const primitives = DEFAULT_TECHNIQUE_PRIMITIVES.filter((primitive) => REQUIRED_PRIMITIVES.includes(primitive.id));
  for (const primitive of primitives) {
    await saveTechniquePrimitive(storage as unknown as LiBrainianStorage, primitive);
  }
}

function buildTrace(overrides: Partial<ExecutionTrace>): ExecutionTrace {
  return { ...baseTrace, ...overrides };
}

describe('CompositionEvolutionEngine', () => {
  let storage: MockStorage;

  beforeEach(() => {
    storage = new MockStorage();
  });

  it('proposes compositions from frequent successful patterns', async () => {
    await seedPrimitives(storage);
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_1',
    }));
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_2',
      timestamp: '2026-01-02T00:00:00.000Z',
    }));

    const engine = new CompositionEvolutionEngine(storage as unknown as LiBrainianStorage, {
      minPatternFrequency: 2,
      minSuccessRate: 0.5,
      minPatternLength: 2,
      maxPatternLength: 2,
      maxProposals: 3,
    });
    const report = await engine.evolve();

    expect(report.discoveredPatterns.length).toBeGreaterThan(0);
    expect(report.proposedCompositions).toHaveLength(1);
    expect(report.proposedCompositions[0]?.primitiveIds).toEqual(['tp_hypothesis', 'tp_verify_plan']);
    expect(report.proposedCompositions[0]?.operators[0]?.type).toBe('loop');
  });

  it('suggests mutations and deprecations for failing compositions', async () => {
    const oldTimestamp = '2025-01-01T00:00:00.000Z';
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_bad_1',
      compositionId: 'tc_bad',
      primitiveSequence: ['tp_change_impact', 'tp_hypothesis', 'tp_verify_plan'],
      outcome: 'failure',
      timestamp: oldTimestamp,
    }));
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_bad_2',
      compositionId: 'tc_bad',
      primitiveSequence: ['tp_change_impact', 'tp_hypothesis', 'tp_verify_plan'],
      outcome: 'failure',
      timestamp: oldTimestamp,
    }));
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_bad_3',
      compositionId: 'tc_bad',
      primitiveSequence: ['tp_change_impact', 'tp_hypothesis', 'tp_verify_plan'],
      outcome: 'failure',
      timestamp: oldTimestamp,
    }));

    const engine = new CompositionEvolutionEngine(storage as unknown as LiBrainianStorage, {
      minMutationSamples: 3,
      maxMutationSuccessRate: 0.9,
      minDeprecationSamples: 3,
      maxDeprecationSuccessRate: 0.4,
      deprecationWindowDays: 1,
    });
    const report = await engine.evolve();

    expect(report.suggestedMutations.some((mutation) => mutation.compositionId === 'tc_bad')).toBe(true);
    expect(report.deprecationCandidates).toContain('tc_bad');
  });

  it('ignores empty primitive sequences and clamps extreme options', async () => {
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_empty',
      primitiveSequence: [],
      timestamp: '2026-01-03T00:00:00.000Z',
    }));
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_invalid',
      primitiveSequence: ['tp_hypothesis', ''],
      timestamp: '2026-01-03T01:00:00.000Z',
    }));

    const engine = new CompositionEvolutionEngine(storage as unknown as LiBrainianStorage, {
      deprecationWindowDays: Number.POSITIVE_INFINITY,
      maxProposals: 1,
    });
    const report = await engine.evolve();

    expect(report.discoveredPatterns).toEqual([]);
  });

  it('skips proposals for unknown primitives and generates unique ids', async () => {
    await seedPrimitives(storage);
    const collisionSequence = ['tp_hypothesis', 'tp_verify_plan'];
    const collisionId = `tc_evolved_${crypto.createHash('sha256').update(JSON.stringify(collisionSequence)).digest('hex').slice(0, 8)}`;
    await saveTechniqueComposition(storage as unknown as LiBrainianStorage, {
      id: collisionId,
      name: 'Existing composition',
      description: 'Existing composition to force id collision',
      primitiveIds: ['tp_change_impact'],
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_known_1',
      primitiveSequence: collisionSequence,
      timestamp: '2026-01-04T00:00:00.000Z',
    }));
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_known_2',
      primitiveSequence: ['tp_change_impact', 'tp_verify_plan'],
      timestamp: '2026-01-05T00:00:00.000Z',
    }));
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_unknown',
      primitiveSequence: ['tp_unknown', 'tp_verify_plan'],
      timestamp: '2026-01-06T00:00:00.000Z',
    }));

    const engine = new CompositionEvolutionEngine(storage as unknown as LiBrainianStorage, {
      minPatternFrequency: 1,
      minSuccessRate: 0.5,
      maxPatternLength: 2,
      maxProposals: 5,
    });
    const report = await engine.evolve();
    const ids = report.proposedCompositions.map((proposal) => proposal.id);
    const collisionProposal = report.proposedCompositions.find((proposal) =>
      proposal.primitiveIds.join('->') === collisionSequence.join('->'));

    expect(report.proposedCompositions.length).toBe(2);
    expect(new Set(ids).size).toBe(ids.length);
    expect(collisionProposal).toBeDefined();
    expect(collisionProposal?.id).not.toBe(collisionId);
    expect(collisionProposal?.id.startsWith(`${collisionId}_`)).toBe(true);
    expect(report.proposedCompositions.some((proposal) => proposal.primitiveIds.includes('tp_unknown'))).toBe(false);
  });

  it('normalizes intent strings and enforces length limits', async () => {
    const noisyIntent = `Line1\r\nDROP TABLE users; [] / \\\\ ! ? - 😈 -- ${'a'.repeat(300)}`;
    await recordExecutionTrace(storage as unknown as LiBrainianStorage, buildTrace({
      executionId: 'exec_intent',
      intent: noisyIntent,
      timestamp: '2026-01-07T00:00:00.000Z',
    }));

    const engine = new CompositionEvolutionEngine(storage as unknown as LiBrainianStorage, {
      minPatternFrequency: 1,
      minSuccessRate: 0.5,
      maxPatternLength: 2,
    });
    const report = await engine.evolve();
    const normalized = report.discoveredPatterns[0]?.commonIntents[0] ?? '';

    expect(normalized.length).toBeLessThanOrEqual(200);
    expect(normalized).toContain('DROP TABLE users; [] / \\ ! ? -');
    expect(normalized).toMatch(/^[A-Za-z0-9 _.,:;()'"\[\]\\\/!?-]*$/);
    expect(normalized).not.toContain('😈');
    expect(normalized).not.toMatch(/[\r\n\t]/);
  });
});
