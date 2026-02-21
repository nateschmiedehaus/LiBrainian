import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { EMBEDDING_MODELS } from '../embedding_providers/real_embeddings.js';
import { DEFAULT_EMBEDDING_CONFIGS } from '../embeddings.js';

const ROOT = process.cwd();
const REAL_EMBEDDINGS_PATH = path.join(ROOT, 'src/api/embedding_providers/real_embeddings.ts');
const EMBEDDINGS_PATH = path.join(ROOT, 'src/api/embeddings.ts');

const STALE_QUALITY_PATTERNS = [
  /AUC\s*1\.0/i,
  /perfect\s+AUC/i,
  /100%\s+accuracy/i,
  /perfect\s+accuracy/i,
];

describe('embedding quality claim hygiene', () => {
  it('rejects stale perfect-quality claims in embedding source files', () => {
    const realEmbeddingsSource = fs.readFileSync(REAL_EMBEDDINGS_PATH, 'utf8');
    const embeddingsSource = fs.readFileSync(EMBEDDINGS_PATH, 'utf8');

    for (const pattern of STALE_QUALITY_PATTERNS) {
      expect(realEmbeddingsSource).not.toMatch(pattern);
      expect(embeddingsSource).not.toMatch(pattern);
    }
  });

  it('keeps all-MiniLM description aligned between provider metadata and API config aliases', () => {
    const canonicalDescription = EMBEDDING_MODELS['all-MiniLM-L6-v2'].description;

    expect(DEFAULT_EMBEDDING_CONFIGS['xenova:all-MiniLM-L6-v2'].description).toBe(canonicalDescription);
    expect(DEFAULT_EMBEDDING_CONFIGS['all-MiniLM-L6-v2'].description).toBe(canonicalDescription);
    expect(canonicalDescription).toContain('AUC > 0.6');
    expect(canonicalDescription).toContain('accuracy > 0.5');
    expect(canonicalDescription).toContain('embedding_validation_real.integration.test.ts');
  });
});
