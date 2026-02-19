import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LibrarianStorage } from '../../storage/types.js';
import { __testing, createBootstrapConfig } from '../bootstrap.js';

describe('bootstrap codebase briefing', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      })
    );
  });

  async function createWorkspace(): Promise<string> {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-briefing-'));
    tempDirs.push(workspace);
    return workspace;
  }

  async function writeFile(workspace: string, relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(workspace, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }

  it('persists structured CODEBASE_BRIEFING.md and summary state', async () => {
    const workspace = await createWorkspace();
    await writeFile(workspace, 'package.json', JSON.stringify({
      name: 'briefing-fixture',
      packageManager: 'pnpm@9.0.0',
      workspaces: ['apps/*', 'packages/*'],
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        express: '^5.0.0',
        fastify: '^5.0.0',
        '@nestjs/core': '^11.0.0',
        vue: '^3.5.0',
        vite: '^6.0.0',
        turbo: '^2.0.0',
        nx: '^20.0.0',
        lerna: '^8.0.0',
      },
      devDependencies: {
        vitest: '^2.0.0',
        jest: '^30.0.0',
        mocha: '^11.0.0',
      },
      main: 'src/main.tsx',
      bin: {
        brief: 'bin/brief.js',
      },
    }, null, 2));
    await writeFile(workspace, 'pnpm-workspace.yaml', 'packages:\n  - "apps/*"\n  - "packages/*"\n');
    await writeFile(workspace, 'next.config.js', 'module.exports = {};');
    await writeFile(workspace, 'vite.config.ts', 'export default {};');
    await writeFile(workspace, 'apps/web/package.json', '{"name":"web"}');
    await writeFile(workspace, 'packages/shared/package.json', '{"name":"shared"}');
    await writeFile(workspace, 'src/main.tsx', 'export const main = true;');
    await writeFile(workspace, 'src/router.ts', 'export const router = {};');
    await writeFile(workspace, 'src/controllers/user.controller.ts', 'export const controller = {};');
    await writeFile(workspace, 'src/services/user.service.ts', 'export const service = {};');
    await writeFile(workspace, 'src/models/user.model.ts', 'export const model = {};');
    await writeFile(workspace, 'src/utils/helpers.ts', 'export const helper = () => {};');
    await writeFile(workspace, 'src/__tests__/main.test.ts', 'it("works", () => {});');
    await writeFile(workspace, 'src/components/Nav.tsx', 'export const Nav = () => null;');
    await writeFile(workspace, 'app/home/page.tsx', 'export default function Page() { return null; }');
    await writeFile(workspace, 'bin/brief.js', '#!/usr/bin/env node\nconsole.log("brief");');

    const storage = {
      setState: vi.fn().mockResolvedValue(undefined),
    } as unknown as LibrarianStorage;
    const config = createBootstrapConfig(workspace, {
      include: ['**/*'],
      exclude: ['**/.git/**', '**/node_modules/**', '**/.librarian/**'],
    });

    const summary = await __testing.generateAndPersistCodebaseBriefing(config, storage);
    const briefingPath = __testing.codebaseBriefingPath(workspace);
    const briefing = await fs.readFile(briefingPath, 'utf8');

    expect(summary.path).toBe(briefingPath);
    expect(summary.frameworks).toEqual(expect.arrayContaining([
      'Next.js',
      'Express',
      'Fastify',
      'NestJS',
      'Vue',
      'Vite',
    ]));
    expect(summary.primaryLanguage).toBe('TypeScript');
    expect(summary.keyEntryPoints.length).toBeGreaterThanOrEqual(3);
    expect(summary.monorepoPackages).toEqual(expect.arrayContaining(['apps/web', 'packages/shared']));
    expect(summary.roleCounts.find((item) => item.role === 'router')?.count).toBeGreaterThan(0);
    expect(summary.roleCounts.find((item) => item.role === 'controller')?.count).toBeGreaterThan(0);
    expect(summary.roleCounts.find((item) => item.role === 'service')?.count).toBeGreaterThan(0);
    expect(summary.roleCounts.find((item) => item.role === 'model')?.count).toBeGreaterThan(0);
    expect(summary.roleCounts.find((item) => item.role === 'util')?.count).toBeGreaterThan(0);
    expect(summary.roleCounts.find((item) => item.role === 'test')?.count).toBeGreaterThan(0);

    expect(briefing).toContain('# Codebase Briefing');
    expect(briefing).toContain('## Framework Detection');
    expect(briefing).toContain('## Primary Language');
    expect(briefing).toContain('## Key Entry Points');
    expect(briefing).toContain('## Monorepo Packages');
    expect(briefing).toContain('## File Role Annotations');
    expect(briefing).toContain('| File | Role | Signal |');

    expect(vi.mocked(storage.setState)).toHaveBeenCalledTimes(1);
    const [stateKey, stateValue] = vi.mocked(storage.setState).mock.calls[0] ?? [];
    expect(stateKey).toBe('bootstrap.codebase_briefing.v1');
    expect(typeof stateValue).toBe('string');
    const parsedState = JSON.parse(String(stateValue)) as { path?: string; keyEntryPoints?: unknown[] };
    expect(parsedState.path).toBe(briefingPath);
    expect(Array.isArray(parsedState.keyEntryPoints)).toBe(true);
  });
});
