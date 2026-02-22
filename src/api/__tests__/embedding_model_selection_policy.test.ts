import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EMBEDDING_BENCHMARK_ARTIFACT_KIND,
  getSupportedEmbeddingModelIds,
  resolveRecommendedEmbeddingModel,
  type EmbeddingModelBenchmarkArtifact,
} from '../embedding_providers/model_selection_policy.js';

const tempArtifacts: string[] = [];

function writeArtifact(recommendedModelId: 'all-MiniLM-L6-v2' | 'mxbai-embed-large-v1'): string {
  const artifactPath = path.join(os.tmpdir(), `embedding-policy-${Date.now()}-${Math.random()}.json`);
  const artifact: EmbeddingModelBenchmarkArtifact = {
    kind: EMBEDDING_BENCHMARK_ARTIFACT_KIND,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    benchmarkDataset: 'test-fixture',
    models: [],
    recommendation: {
      modelId: recommendedModelId,
      rationale: 'test artifact',
      score: 1,
    },
  };
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  tempArtifacts.push(artifactPath);
  return artifactPath;
}

describe('embedding model selection policy', () => {
  afterEach(() => {
    for (const file of tempArtifacts) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // best effort cleanup
      }
    }
    tempArtifacts.length = 0;
  });

  it('keeps mxbai excluded from supported model list when feature flag is disabled', () => {
    const models = getSupportedEmbeddingModelIds({
      LIBRARIAN_ENABLE_MXBAI_EMBEDDING: '0',
    } as NodeJS.ProcessEnv);
    expect(models.includes('mxbai-embed-large-v1')).toBe(false);
  });

  it('includes mxbai in supported model list when feature flag is enabled', () => {
    const models = getSupportedEmbeddingModelIds({
      LIBRARIAN_ENABLE_MXBAI_EMBEDDING: '1',
    } as NodeJS.ProcessEnv);
    expect(models.includes('mxbai-embed-large-v1')).toBe(true);
  });

  it('uses benchmark recommendation when artifact exists and feature flag allows it', () => {
    const artifactPath = writeArtifact('mxbai-embed-large-v1');
    const model = resolveRecommendedEmbeddingModel({
      artifactPath,
      env: {
        LIBRARIAN_ENABLE_MXBAI_EMBEDDING: '1',
      } as NodeJS.ProcessEnv,
    });
    expect(model).toBe('mxbai-embed-large-v1');
  });

  it('falls back when benchmark recommends feature-flagged model without enablement', () => {
    const artifactPath = writeArtifact('mxbai-embed-large-v1');
    const model = resolveRecommendedEmbeddingModel({
      artifactPath,
      fallbackModelId: 'all-MiniLM-L6-v2',
      env: {
        LIBRARIAN_ENABLE_MXBAI_EMBEDDING: '0',
      } as NodeJS.ProcessEnv,
    });
    expect(model).toBe('all-MiniLM-L6-v2');
  });
});
