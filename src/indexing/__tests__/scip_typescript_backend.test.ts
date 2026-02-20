import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ScipTypescriptBackend,
  extractParserResultFromScipDocument,
  type DecodedScipDocument,
} from '../scip_typescript_backend.js';

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-scip-backend-'));
  tempDirs.push(workspace);
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'src', 'example.ts'), 'export function sum(a: number, b: number) { return a + b; }\n', 'utf8');
  return workspace;
}

function buildDecodedDoc(relativePath: string): DecodedScipDocument {
  return {
    relative_path: relativePath,
    symbols: [
      {
        symbol: 'scip npm demo 1.0.0 `src/example.ts`/sum().',
        kind: 17,
        display_name: 'sum',
        documentation: ['Adds two numbers'],
        signature_documentation: { text: 'function sum(a: number, b: number): number' },
      },
    ],
    occurrences: [
      {
        symbol: 'scip npm demo 1.0.0 `src/example.ts`/sum().',
        symbol_roles: 1,
        range: [4, 2, 4, 5],
      },
      {
        symbol: 'scip npm lodash 4.17.0 `index.d.ts`/chunk().',
        symbol_roles: 2,
        range: [1, 0, 1, 10],
      },
    ],
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

describe('extractParserResultFromScipDocument', () => {
  it('extracts function definitions and dependencies from a decoded SCIP document', () => {
    const result = extractParserResultFromScipDocument(buildDecodedDoc('src/example.ts'));
    expect(result.parser).toBe('scip-typescript');
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]).toMatchObject({
      name: 'sum',
      startLine: 5,
      endLine: 5,
    });
    expect(result.module.dependencies).toContain('lodash');
  });
});

describe('ScipTypescriptBackend', () => {
  it('runs the backend once and reuses cached parsed output', async () => {
    const workspace = await makeWorkspace();
    const commandRunner = vi.fn(async (input: { outputPath: string }) => {
      await fs.writeFile(input.outputPath, 'scip-index-bytes', 'utf8');
    });
    const decoder = vi.fn(async () => [buildDecodedDoc('src/example.ts')]);

    const backend = new ScipTypescriptBackend({
      workspaceRoot: workspace,
      enabled: true,
      cacheTtlMs: 60_000,
      commandRunner,
      decoder,
    });

    const filePath = path.join(workspace, 'src', 'example.ts');
    const first = await backend.parseFile(filePath);
    const second = await backend.parseFile(filePath);

    expect(first?.parser).toBe('scip-typescript');
    expect(first?.functions.some((fn) => fn.name === 'sum')).toBe(true);
    expect(second?.parser).toBe('scip-typescript');
    expect(commandRunner).toHaveBeenCalledTimes(1);
    expect(decoder).toHaveBeenCalledTimes(1);
  });

  it('returns null when backend is disabled', async () => {
    const workspace = await makeWorkspace();
    const backend = new ScipTypescriptBackend({ workspaceRoot: workspace, enabled: false });
    const parsed = await backend.parseFile(path.join(workspace, 'src', 'example.ts'));
    expect(parsed).toBeNull();
  });

  it('returns null when decoded index has no entry for the requested file', async () => {
    const workspace = await makeWorkspace();
    const backend = new ScipTypescriptBackend({
      workspaceRoot: workspace,
      enabled: true,
      commandRunner: async () => {},
      decoder: async () => [buildDecodedDoc('src/other.ts')],
    });

    const parsed = await backend.parseFile(path.join(workspace, 'src', 'example.ts'));
    expect(parsed).toBeNull();
  });
});
