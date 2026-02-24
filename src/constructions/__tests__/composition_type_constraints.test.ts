import { describe, expect, it } from 'vitest';
import { deterministic } from '../../epistemics/confidence.js';
import {
  sequence,
  type ComposableConstruction,
  type ConstructionResult,
} from '../composition.js';
import { toEvidenceIds } from '../base/construction_base.js';

type FeatureInput = { feature: string };
type RefactorPlan = ConstructionResult & { entityId: string; refactoringType: 'rename' };
type RefactorOutput = ConstructionResult & { safe: boolean };

function createFirst(): ComposableConstruction<FeatureInput, RefactorPlan> {
  return {
    id: 'first',
    name: 'first',
    async execute(input: FeatureInput): Promise<RefactorPlan> {
      return {
        entityId: input.feature,
        refactoringType: 'rename',
        confidence: deterministic(true, 'first'),
        evidenceRefs: toEvidenceIds(['first:executed']),
        analysisTimeMs: 1,
      };
    },
  };
}

function createSecond(): ComposableConstruction<RefactorPlan, RefactorOutput> {
  return {
    id: 'second',
    name: 'second',
    async execute(input: RefactorPlan): Promise<RefactorOutput> {
      return {
        safe: input.refactoringType === 'rename',
        confidence: deterministic(true, 'second'),
        evidenceRefs: toEvidenceIds(['second:executed']),
        analysisTimeMs: 1,
      };
    },
  };
}

function createBadSecond(): ComposableConstruction<number, RefactorOutput> {
  return {
    id: 'bad-second',
    name: 'bad-second',
    async execute(input: number): Promise<RefactorOutput> {
      return {
        safe: input > 0,
        confidence: deterministic(true, 'bad-second'),
        evidenceRefs: toEvidenceIds(['bad-second:executed']),
        analysisTimeMs: 1,
      };
    },
  };
}

describe('composition type constraints', () => {
  it('preserves intermediate seam types for sequence composition', async () => {
    const first = createFirst();
    const second = createSecond();
    const composed = sequence(first, second);
    const output = await composed.execute({ feature: 'auth/UserRepository.findByEmail' });
    expect(output.safe).toBe(true);
  });

  it('rejects mismatched intermediate sequence seams at compile-time', () => {
    const first = createFirst();
    const badSecond = createBadSecond();

    if (false) {
      // @ts-expect-error sequence should reject mismatched second input type
      sequence(first, badSecond);
    }

    expect(true).toBe(true);
  });
});
