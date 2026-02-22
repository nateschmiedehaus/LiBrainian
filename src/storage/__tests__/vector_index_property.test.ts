import { describe, expect, it, vi } from 'vitest';
import { HNSWIndex } from '../vector_index.js';

const RUN_PROPERTY = process.env.LIBRARIAN_RUN_PROPERTY_TESTS === '1';
const propertyIt: typeof it = RUN_PROPERTY ? it : it.skip;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCentroid(dimensions: number, axis: number): Float32Array {
  const vector = new Float32Array(dimensions);
  vector[axis] = 1;
  return vector;
}

function normalize(vector: Float32Array): Float32Array {
  let normSquared = 0;
  for (let i = 0; i < vector.length; i++) {
    normSquared += vector[i]! * vector[i]!;
  }
  const norm = Math.sqrt(normSquared);
  if (norm === 0) {
    return vector;
  }
  for (let i = 0; i < vector.length; i++) {
    vector[i] = vector[i]! / norm;
  }
  return vector;
}

function jitterVector(base: Float32Array, rng: () => number, noiseScale: number): Float32Array {
  const result = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const noise = (rng() * 2 - 1) * noiseScale;
    result[i] = base[i]! + noise;
  }
  return normalize(result);
}

interface TrialSummary {
  filteredCount: number;
  unfilteredDistanceCalls: number;
  filteredDistanceCalls: number;
  filteredOnlyFunctions: boolean;
}

function runFilterPrefetchTrial(seed: number): TrialSummary {
  const rng = mulberry32(seed);
  const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => rng());
  try {
    const index = new HNSWIndex({ efSearch: 80 });
    const dimensions = 64;
    const functionCentroid = makeCentroid(dimensions, 0);
    const moduleCentroid = makeCentroid(dimensions, 1);

    for (let i = 0; i < 240; i++) {
      index.insert(`module_${seed}_${i}`, jitterVector(moduleCentroid, rng, 0.08), 'module');
    }
    for (let i = 0; i < 24; i++) {
      index.insert(`function_${seed}_${i}`, jitterVector(functionCentroid, rng, 0.08), 'function');
    }

    const query = jitterVector(functionCentroid, rng, 0.04);
    const cosineSpy = vi.spyOn(
      index as unknown as { cosineDistance: (a: Float32Array, b: Float32Array) => number },
      'cosineDistance',
    );

    index.search(query, 10);
    const unfilteredDistanceCalls = cosineSpy.mock.calls.length;
    cosineSpy.mockClear();

    const filtered = index.search(query, 10, ['function']);
    const filteredDistanceCalls = cosineSpy.mock.calls.length;
    cosineSpy.mockRestore();

    return {
      filteredCount: filtered.length,
      unfilteredDistanceCalls,
      filteredDistanceCalls,
      filteredOnlyFunctions: filtered.every((item) => item.entityType === 'function'),
    };
  } finally {
    randomSpy.mockRestore();
  }
}

describe('HNSW entity-type filter seeded property checks (non-gating)', () => {
  propertyIt('keeps filtered traversal cheaper than unfiltered traversal across seeded trials', () => {
    const seeds = Array.from({ length: 32 }, (_, i) => i + 1);
    const failures: number[] = [];

    for (const seed of seeds) {
      const summary = runFilterPrefetchTrial(seed);
      const pass =
        summary.filteredCount > 0
        && summary.filteredOnlyFunctions
        && summary.filteredDistanceCalls < summary.unfilteredDistanceCalls;
      if (!pass) {
        failures.push(seed);
      }
    }

    expect(failures).toEqual([]);
  });
});
