import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('query cold-start structural-first guardrails', () => {
  it('supports deferring semantic retrieval when cold-start structural-first is requested', () => {
    const queryPath = path.join(process.cwd(), 'src', 'api', 'query.ts');
    const querySource = fs.readFileSync(queryPath, 'utf8');
    const semanticStagePath = path.join(process.cwd(), 'src', 'api', 'query_pipeline_semantic_retrieval_stage.ts');
    const semanticStageSource = fs.readFileSync(semanticStagePath, 'utf8');

    expect(semanticStageSource).toContain('if (query.coldStartStructuralOnly && !isModelLoadedFn())');
    expect(semanticStageSource).toContain('void preloadEmbeddingModelFn().catch(() => undefined);');
    expect(semanticStageSource).toContain('Returning structural retrieval results while embedding model prewarms.');
    expect(querySource).toContain("|| query.coldStartStructuralOnly === true;");
    expect(querySource).toContain('Provider probes skipped and semantic retrieval deferred during model prewarm.');
  });
});
