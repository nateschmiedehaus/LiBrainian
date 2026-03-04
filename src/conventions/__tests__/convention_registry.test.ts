import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { LibrarianStorage, ConventionRecord } from '../../storage/types.js';
import { rebuildConventionRegistry } from '../convention_registry.js';

describe('rebuildConventionRegistry', () => {
  it('discovers conventions from workspace files', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-conv-'));
    await fs.mkdir(path.join(workspace, 'src/api'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'src/storage'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'src/constructions/processes'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'src/__tests__'), { recursive: true });

    await fs.writeFile(path.join(workspace, 'src/storage/index.ts'), 'export const storage = 1;');
    await fs.writeFile(
      path.join(workspace, 'src/api/example.ts'),
      "import '../storage/index.ts';\nexport function handler() { return storage; }\n"
    );
    await fs.writeFile(path.join(workspace, 'src/constructions/processes/sample_process.ts'), 'export const proc = 1;');
    await fs.writeFile(path.join(workspace, 'src/__tests__/sample.test.ts'), 'import { handler } from "../api/example";');
    await fs.writeFile(path.join(workspace, 'AGENTS.md'), '- Always import through storage index.');

    const recorded: ConventionRecord[] = [];
    const storage = {
      deleteConventionsBySource: vi.fn(async () => 0),
      upsertConventions: vi.fn(async (records: ConventionRecord[]) => {
        recorded.push(...records);
      }),
      getConventions: vi.fn(async () => recorded),
    } as unknown as LibrarianStorage;

    try {
      const report = await rebuildConventionRegistry({ workspace, storage });
      expect(report.total).toBeGreaterThan(0);
      expect(storage.deleteConventionsBySource).toHaveBeenCalledWith('mined');
      expect(storage.deleteConventionsBySource).toHaveBeenCalledWith('agents_md');
      expect(recorded.length).toBe(report.total);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
