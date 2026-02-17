import { describe, it, expect } from 'vitest';
import { AstIndexer } from '../ast_indexer.js';

describe('AstIndexer redaction behavior', () => {
  it('does not mark partiallyIndexed when LLM analysis is disabled', async () => {
    const indexer = new AstIndexer({
      // No LLM configuration → analysis disabled
      enableAnalysis: false,
      enableLlmFallback: false,
      enableEmbeddings: false,
    });

    const filePath = '/tmp/example.ts';
    const content = [
      "export function ok() { return 1; }",
      "const apiKey = \"aaaaaaaaaaaaaaaaaaaa\";", // triggers redactText() pattern
    ].join('\n');

    const result = await indexer.indexFile(filePath, content);
    expect(result.partiallyIndexed).toBe(false);
  });
});

