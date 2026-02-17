import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AstIndexer } from '../ast_indexer.js';

describe('AstIndexer parser_unavailable degradation', () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('indexes a module even when no parser is available (no LLM configured)', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-ast-indexer-no-parser-'));
    const filePath = path.join(tmpDir, 'deploy.sh');
    await fs.writeFile(filePath, '#!/usr/bin/env bash\necho \"hello\"\n', 'utf8');

    const registryStub = {
      parseFile() {
        throw new Error('unverified_by_trace(parser_unavailable): test');
      },
    };

    const indexer = new AstIndexer({
      enableAnalysis: false,
      enableEmbeddings: false,
      registry: registryStub as any,
      workspaceRoot: tmpDir,
    });

    const result = await indexer.indexFile(filePath);

    expect(result.parser).toContain('parser_unavailable');
    expect(result.partiallyIndexed).toBe(true);
    expect(result.functions).toHaveLength(0);
    expect(result.module).not.toBeNull();
    expect(result.module!.path).toBe(filePath);
  });
});
