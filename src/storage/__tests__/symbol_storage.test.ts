import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSymbolStorageWithPath } from '../symbol_storage.js';

describe('SymbolStorage recovery', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('recreates malformed symbol databases during initialize', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-symbol-storage-'));
    tempDirs.push(dir);

    const dbPath = path.join(dir, 'knowledge.db');
    await fs.writeFile(dbPath, 'not-a-sqlite-database', 'utf8');

    const storage = createSymbolStorageWithPath(dbPath);
    await storage.initialize();

    try {
      storage.upsertSymbols([
        {
          name: 'queryPipeline',
          kind: 'function',
          file: 'src/api/query.ts',
          line: 12,
          endLine: 18,
          exported: true,
          qualifiedName: 'src/api/query.ts:queryPipeline',
        },
      ]);

      const results = storage.findByExactName('queryPipeline');
      expect(results).toHaveLength(1);
      expect(results[0]?.file).toBe('src/api/query.ts');
    } finally {
      await storage.close();
    }
  });
});
