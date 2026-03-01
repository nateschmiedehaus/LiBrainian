import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('query cold-start structural-first guardrails', () => {
  it('supports deferring semantic retrieval when cold-start structural-first is requested', () => {
    const queryPath = path.join(process.cwd(), 'src', 'api', 'query.ts');
    const querySource = fs.readFileSync(queryPath, 'utf8');

    expect(querySource).toContain('import { isModelLoaded, preloadEmbeddingModel } from');
    expect(querySource).toContain('if (query.coldStartStructuralOnly && !isModelLoaded())');
    expect(querySource).toContain('void preloadEmbeddingModel().catch(() => undefined);');
    expect(querySource).toContain('Returning structural retrieval results while embedding model prewarms.');
    expect(querySource).toContain("|| query.coldStartStructuralOnly === true;");
  });
});
