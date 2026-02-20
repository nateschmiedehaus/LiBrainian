import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generatePromptDocs } from '../generate_docs_content.js';

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-generate-docs-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, 'src', 'api'), { recursive: true });
  await fs.mkdir(path.join(dir, 'src', 'cli'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src', 'index.ts'), 'export const boot = true;\n', 'utf8');
  await fs.writeFile(path.join(dir, 'src', 'api', 'server.ts'), 'export function start() { return true; }\n', 'utf8');
  await fs.writeFile(path.join(dir, 'src', 'cli', 'index.ts'), 'export const cli = 1;\n', 'utf8');
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'tmp', version: '0.0.0', main: 'src/index.ts' }, null, 2),
    'utf8'
  );
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('generatePromptDocs', () => {
  it('writes tools/context/rules docs with bounded token estimates', async () => {
    const workspace = await createWorkspace();

    const result = await generatePromptDocs({
      workspace,
      maxTokensPerFile: 1800,
    });

    expect(result.include).toEqual(['tools', 'context', 'rules']);
    expect(result.filesWritten.length).toBe(3);

    const toolsPath = path.join(workspace, 'LIBRAINIAN_TOOLS.md');
    const contextPath = path.join(workspace, 'LIBRAINIAN_CONTEXT.md');
    const rulesPath = path.join(workspace, 'LIBRAINIAN_RULES.md');

    const [tools, context, rules] = await Promise.all([
      fs.readFile(toolsPath, 'utf8'),
      fs.readFile(contextPath, 'utf8'),
      fs.readFile(rulesPath, 'utf8'),
    ]);

    expect(tools).toContain('# LiBrainian Tools');
    expect(tools).toContain('### `query`');
    expect(context).toContain('# LiBrainian Context');
    expect(context).toContain('## Entry Points');
    expect(rules).toContain('# LiBrainian Rules');
    expect(rules).toContain('## Retrieval Discipline');

    expect(result.tokenEstimates['LIBRAINIAN_TOOLS.md']).toBeLessThanOrEqual(1800);
    expect(result.tokenEstimates['LIBRAINIAN_CONTEXT.md']).toBeLessThanOrEqual(1800);
    expect(result.tokenEstimates['LIBRAINIAN_RULES.md']).toBeLessThanOrEqual(1800);
  });

  it('respects config-based opt-out for individual files', async () => {
    const workspace = await createWorkspace();
    await fs.writeFile(
      path.join(workspace, 'librainian.config.json'),
      JSON.stringify({ promptDocs: { rules: false } }, null, 2),
      'utf8'
    );

    const result = await generatePromptDocs({ workspace });

    expect(result.include).toEqual(['tools', 'context']);
    expect(await fs.stat(path.join(workspace, 'LIBRAINIAN_TOOLS.md'))).toBeTruthy();
    expect(await fs.stat(path.join(workspace, 'LIBRAINIAN_CONTEXT.md'))).toBeTruthy();
    await expect(fs.stat(path.join(workspace, 'LIBRAINIAN_RULES.md'))).rejects.toThrow();
  });
});
