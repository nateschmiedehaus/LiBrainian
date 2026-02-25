import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateAmbientBriefing } from '../ambient_briefing.js';

async function withWorkspace(fn: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'librarian-ambient-briefing-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writeWorkspaceFile(workspaceRoot: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

describe('generateAmbientBriefing', () => {
  it('produces a standard briefing with required sections under 500 tokens', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeWorkspaceFile(
        workspaceRoot,
        'src/auth/jwt.ts',
        [
          "import { verify } from 'jsonwebtoken';",
          "import { AppAuthError } from '../errors/auth_error';",
          'export function validateJwt(token: string): boolean {',
          '  if (!token.trim()) throw new AppAuthError("missing token");',
          '  return verify(token, "secret") !== undefined;',
          '}',
        ].join('\n'),
      );
      await writeWorkspaceFile(
        workspaceRoot,
        'src/auth/middleware.ts',
        [
          "import { validateJwt } from './jwt';",
          'export async function authMiddleware(token: string): Promise<boolean> {',
          '  return validateJwt(token);',
          '}',
        ].join('\n'),
      );
      await writeWorkspaceFile(
        workspaceRoot,
        'src/auth/__tests__/jwt.test.ts',
        [
          "import { describe, it, expect } from 'vitest';",
          "import { validateJwt } from '../jwt';",
          "describe('validateJwt', () => {",
          "  it('returns false for invalid token', () => {",
          '    expect(validateJwt("bad")).toBe(false);',
          '  });',
          '});',
        ].join('\n'),
      );

      const briefing = await generateAmbientBriefing({
        workspaceRoot,
        scopePath: 'src/auth',
        tier: 'standard',
      });

      expect(briefing.tier).toBe('standard');
      expect(briefing.tokenCount).toBeLessThanOrEqual(500);
      expect(briefing.markdown).toContain('## Module purpose');
      expect(briefing.markdown).toContain('## Active conventions');
      expect(briefing.markdown).toContain('## Dependency context');
      expect(briefing.markdown).toContain('## Recent changes');
      expect(briefing.markdown).toContain('## Test coverage');
      expect(briefing.testCoverage.sourceFileCount).toBeGreaterThan(0);
    });
  });

  it('enforces micro/standard/deep token budgets', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeWorkspaceFile(
        workspaceRoot,
        'src/service.ts',
        [
          "import { readFile } from 'node:fs/promises';",
          'export async function loadConfig(pathValue: string): Promise<string> {',
          '  return readFile(pathValue, "utf8");',
          '}',
        ].join('\n'),
      );
      await writeWorkspaceFile(
        workspaceRoot,
        'src/service.test.ts',
        [
          "import { describe, it, expect } from 'vitest';",
          "import { loadConfig } from './service';",
          "describe('loadConfig', () => {",
          "  it('loads config', async () => {",
          '    await expect(loadConfig("missing")).rejects.toBeDefined();',
          '  });',
          '});',
        ].join('\n'),
      );

      const micro = await generateAmbientBriefing({
        workspaceRoot,
        scopePath: 'src/service.ts',
        tier: 'micro',
      });
      const standard = await generateAmbientBriefing({
        workspaceRoot,
        scopePath: 'src/service.ts',
        tier: 'standard',
      });
      const deep = await generateAmbientBriefing({
        workspaceRoot,
        scopePath: 'src/service.ts',
        tier: 'deep',
      });

      expect(micro.tokenCount).toBeLessThanOrEqual(200);
      expect(standard.tokenCount).toBeLessThanOrEqual(500);
      expect(deep.tokenCount).toBeLessThanOrEqual(2000);
      expect(deep.tokenCount).toBeGreaterThanOrEqual(micro.tokenCount);
    });
  });
});
