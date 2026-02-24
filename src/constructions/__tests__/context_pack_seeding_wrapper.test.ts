import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import { toEvidenceIds, type ConstructionResult } from '../base/construction_base.js';
import { withContextPackSeeding } from '../integration-wrappers.js';
import type { Context, Construction } from '../types.js';
import { ok } from '../types.js';

type SeederInput = {
  intentType: string;
  scope: string;
  query: string;
};

type SeederOutput = ConstructionResult & {
  summary: string;
  findings: string[];
  relatedFiles: string[];
};

function measured(value: number): ConfidenceValue {
  return {
    type: 'measured',
    value,
    measurement: {
      datasetId: 'context-pack-seeding-test',
      sampleSize: 20,
      accuracy: value,
      confidenceInterval: [Math.max(0, value - 0.05), Math.min(1, value + 0.05)] as const,
      measuredAt: new Date().toISOString(),
    },
  };
}

function makeExecutionContext(sessionId: string): Context {
  return {
    deps: {} as never,
    signal: new AbortController().signal,
    sessionId,
  };
}

describe('withContextPackSeeding', () => {
  let tempDir = '';
  let storage: LiBrainianStorage | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-context-pack-seeding-'));
    storage = createSqliteStorage(path.join(tempDir, 'librarian.sqlite'), tempDir);
    await storage.initialize();
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
      storage = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('seeds high-confidence packs and marks follow-up runs as fromContextPack', async () => {
    let executions = 0;
    const base: Construction<SeederInput, SeederOutput> = {
      id: 'seedable-construction',
      name: 'SeedableConstruction',
      async execute(input) {
        executions += 1;
        return ok({
          confidence: measured(0.85),
          evidenceRefs: toEvidenceIds([`ev:${input.intentType}:${input.scope}`]),
          analysisTimeMs: 5,
          summary: `Analysis for ${input.query}`,
          findings: ['fact:one', 'fact:two'],
          relatedFiles: ['src/auth/session.ts'],
        });
      },
    };

    const wrapped = withContextPackSeeding(base, storage!, {
      minConfidenceThreshold: 0.8,
      intentExtractor: (input) => input.intentType,
      scopeExtractor: (input) => input.scope,
      maxPacksPerSession: 5,
    });

    const first = await wrapped.execute(
      { intentType: 'query_relevance', scope: 'src/auth', query: 'auth session flow' },
      makeExecutionContext('session-a'),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw first.error;
    expect(first.value.packsSeeded.length).toBe(1);
    expect(first.value.fromContextPack).toBe(false);

    const byIntentScope = await storage!.findByIntentAndScope('query_relevance', 'src/auth');
    expect(byIntentScope).toHaveLength(1);
    expect(byIntentScope[0]?.provenance).toBe('seeded_from_construction');
    expect((byIntentScope[0]?.tokenEstimate ?? 0) > 0).toBe(true);

    const byProvenance = await storage!.findByProvenance('seeded_from_construction');
    expect(byProvenance.some((pack) => pack.intentType === 'query_relevance')).toBe(true);

    const second = await wrapped.execute(
      { intentType: 'query_relevance', scope: 'src/auth', query: 'auth session flow' },
      makeExecutionContext('session-a'),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw second.error;
    expect(second.value.packsSeeded).toHaveLength(0);
    expect(second.value.fromContextPack).toBe(true);
    expect(executions).toBe(2);
  });

  it('does not seed when confidence is below threshold', async () => {
    const base: Construction<SeederInput, SeederOutput> = {
      id: 'low-confidence-construction',
      name: 'LowConfidenceConstruction',
      async execute(input) {
        return ok({
          confidence: measured(0.75),
          evidenceRefs: toEvidenceIds([`ev:${input.intentType}:${input.scope}`]),
          analysisTimeMs: 3,
          summary: `Low-confidence analysis for ${input.query}`,
          findings: [],
          relatedFiles: ['src/low/confidence.ts'],
        });
      },
    };

    const wrapped = withContextPackSeeding(base, storage!, {
      minConfidenceThreshold: 0.8,
      intentExtractor: (input) => input.intentType,
      scopeExtractor: (input) => input.scope,
    });

    const result = await wrapped.execute(
      { intentType: 'query_relevance', scope: 'src/low', query: 'low confidence' },
      makeExecutionContext('session-b'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.packsSeeded).toHaveLength(0);

    const byIntentScope = await storage!.findByIntentAndScope('query_relevance', 'src/low');
    expect(byIntentScope).toHaveLength(0);
  });
});
