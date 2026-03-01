import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('mcp server startup prewarm guardrails', () => {
  it('starts model prewarm in the background after MCP transport connect', () => {
    const serverPath = path.join(process.cwd(), 'src', 'mcp', 'server.ts');
    const serverSource = fs.readFileSync(serverPath, 'utf8');

    expect(serverSource).toContain("import { preloadEmbeddingModel } from '../api/embedding_providers/real_embeddings.js';");
    expect(serverSource).toContain("import { preloadReranker } from '../api/embedding_providers/cross_encoder_reranker.js';");
    expect(serverSource).toContain('private startupPrewarmPromise: Promise<void> | null = null;');
    expect(serverSource).toContain('private startModelPrewarm(): void');
    expect(serverSource).toContain('Promise.allSettled([');
    expect(serverSource).toContain('preloadEmbeddingModel()');
    expect(serverSource).toContain('preloadReranker()');
    expect(serverSource).toContain('void this.startModelPrewarm();');
    expect(serverSource).toContain('coldStartStructuralOnly: this.startupPrewarmPromise !== null,');
  });
});
