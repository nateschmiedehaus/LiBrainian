import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmbeddingModelSelectionBenchmarkConstruction,
  EMBEDDING_BENCHMARK_CANDIDATE_MODELS,
} from '../embedding_model_selection_benchmark.js';
import { unwrapConstructionExecutionResult } from '../../types.js';
import type { SupportedEmbeddingModelId } from '../../../api/embedding_providers/model_selection_policy.js';

const DIMENSIONS: Record<SupportedEmbeddingModelId, number> = {
  'all-MiniLM-L6-v2': 384,
  'jina-embeddings-v2-base-en': 768,
  'bge-small-en-v1.5': 384,
  'mxbai-embed-large-v1': 1024,
};

const QUERY_TOPIC_SHIFT: Record<SupportedEmbeddingModelId, number> = {
  'all-MiniLM-L6-v2': 1,
  'jina-embeddings-v2-base-en': 1,
  'bge-small-en-v1.5': 1,
  'mxbai-embed-large-v1': 0,
};

const tempPaths: string[] = [];

function inferTopic(text: string): number {
  const normalized = text.toLowerCase();
  if (normalized.includes('auth')) return 0;
  if (normalized.includes('dimension')) return 1;
  if (normalized.includes('cli')) return 2;
  if (normalized.includes('patrol')) return 3;
  if (normalized.includes('bootstrap')) return 4;
  if (normalized.includes('provider')) return 5;
  return 6;
}

function createDeterministicEmbedding(
  modelId: SupportedEmbeddingModelId,
  text: string,
): Float32Array {
  const dimension = DIMENSIONS[modelId];
  const isQuery = text.includes('?');
  const topic = inferTopic(text);
  const shiftedTopic = isQuery
    ? (topic + QUERY_TOPIC_SHIFT[modelId]) % 7
    : topic;
  const vector = new Float32Array(dimension);
  vector[shiftedTopic] = 1;
  vector[(shiftedTopic + 13) % dimension] = 0.1;
  vector[(shiftedTopic + 29) % dimension] = 0.05;
  return vector;
}

describe('Embedding Model Selection Benchmark Construction', () => {
  afterEach(() => {
    for (const tempPath of tempPaths) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // best effort cleanup
      }
    }
    tempPaths.length = 0;
  });

  it('emits deterministic benchmark artifact and recommendation across all candidate models', async () => {
    const outPath = path.join(os.tmpdir(), `embedding-model-benchmark-${Date.now()}.json`);
    tempPaths.push(outPath);
    const construction = createEmbeddingModelSelectionBenchmarkConstruction();
    const result = unwrapConstructionExecutionResult(
      await construction.execute({
        outputPath: outPath,
        embedText: async (modelId, text) => createDeterministicEmbedding(modelId, text),
      }),
    );

    expect(result.kind).toBe('EmbeddingModelBenchmarkArtifact.v1');
    expect(result.pass).toBe(true);
    expect(result.models).toHaveLength(EMBEDDING_BENCHMARK_CANDIDATE_MODELS.length);
    expect(result.models.every((model) => model.status === 'evaluated')).toBe(true);
    expect(result.models.some((model) => model.modelId === 'mxbai-embed-large-v1' && model.dimension === 1024)).toBe(true);
    expect(result.recommendation.modelId).toBe('mxbai-embed-large-v1');

    const persisted = JSON.parse(fs.readFileSync(outPath, 'utf8')) as { kind: string; recommendation?: { modelId?: string } };
    expect(persisted.kind).toBe('EmbeddingModelBenchmarkArtifact.v1');
    expect(persisted.recommendation?.modelId).toBe('mxbai-embed-large-v1');
  });
});
