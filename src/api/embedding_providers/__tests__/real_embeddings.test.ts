import { beforeEach, describe, expect, it, vi } from 'vitest';

const pipelineMock = vi.fn();
const createPipelineMock = vi.fn(async () => pipelineMock);

vi.mock('@xenova/transformers', () => ({
  pipeline: createPipelineMock,
}));

describe('real embedding provider validation', () => {
  beforeEach(() => {
    vi.resetModules();
    pipelineMock.mockReset();
    createPipelineMock.mockClear();
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
});
