import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const pipelineMock = vi.fn();
const createPipelineMock = vi.fn(async () => pipelineMock);

vi.mock('@xenova/transformers', () => ({
  pipeline: createPipelineMock,
}));

describe('real embedding provider validation', () => {
  const tempArtifacts: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    pipelineMock.mockReset();
    createPipelineMock.mockClear();
    delete process.env.LIBRARIAN_ENABLE_MXBAI_EMBEDDING;
    delete process.env.LIBRARIAN_EMBEDDING_BENCHMARK_ARTIFACT;
  });

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

  it('rejects whitespace-only text before provider call', async () => {
    const { generateXenovaEmbedding } = await import('../real_embeddings.js');
    await expect(generateXenovaEmbedding('   \n\t')).rejects.toThrow('provider_invalid_output');
    expect(createPipelineMock).not.toHaveBeenCalled();
  });

  it('rejects zero-norm embeddings from xenova output', async () => {
    pipelineMock.mockResolvedValue({
      data: new Float32Array(384),
    });

    const { generateXenovaEmbedding } = await import('../real_embeddings.js');
    await expect(generateXenovaEmbedding('function example() {}')).rejects.toThrow('provider_invalid_output');
  });

  it('resolves default model from benchmark recommendation artifact', async () => {
    const artifactPath = path.join(os.tmpdir(), `real-embeddings-policy-${Date.now()}.json`);
    tempArtifacts.push(artifactPath);
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        kind: 'EmbeddingModelBenchmarkArtifact.v1',
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        benchmarkDataset: 'test',
        models: [],
        recommendation: {
          modelId: 'jina-embeddings-v2-base-en',
          rationale: 'test fixture',
          score: 1,
        },
      }),
      'utf8',
    );
    process.env.LIBRARIAN_EMBEDDING_BENCHMARK_ARTIFACT = artifactPath;

    const { DEFAULT_CODE_MODEL, getCurrentModel } = await import('../real_embeddings.js');
    expect(DEFAULT_CODE_MODEL).toBe('jina-embeddings-v2-base-en');
    expect(getCurrentModel()).toBe('jina-embeddings-v2-base-en');
  });
});
