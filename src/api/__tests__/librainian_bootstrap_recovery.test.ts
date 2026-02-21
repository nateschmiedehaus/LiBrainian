import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { INCLUDE_PATTERNS, EXCLUDE_PATTERNS } from '../../universal_patterns.js';
import { getCurrentVersion } from '../versioning.js';
import type { BootstrapReport } from '../../types.js';

const { mockBootstrapProject } = vi.hoisted(() => ({
  mockBootstrapProject: vi.fn(),
}));

vi.mock('../bootstrap.js', async () => {
  const actual = await vi.importActual<typeof import('../bootstrap.js')>('../bootstrap.js');
  return {
    ...actual,
    bootstrapProject: mockBootstrapProject,
    isBootstrapRequired: vi.fn(async () => ({ required: true, reason: 'test' })),
  };
});

describe('Librarian bootstrap auto-recovery', () => {
  let workspace: string;
  let previousSkipProvider: string | undefined;

  beforeEach(async () => {
    mockBootstrapProject.mockReset();
    previousSkipProvider = process.env.LIBRARIAN_SKIP_PROVIDER_CHECK;
    process.env.LIBRARIAN_SKIP_PROVIDER_CHECK = '1';
    workspace = await fs.mkdtemp(path.join(tmpdir(), 'librarian-auto-retry-'));
  });

  afterEach(async () => {
    if (previousSkipProvider === undefined) {
      delete process.env.LIBRARIAN_SKIP_PROVIDER_CHECK;
    } else {
      process.env.LIBRARIAN_SKIP_PROVIDER_CHECK = previousSkipProvider;
    }
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('retries bootstrap with default patterns after include mismatch', async () => {
    const version = getCurrentVersion();
    const makeReport = (success: boolean, error?: string): BootstrapReport => ({
      workspace,
      startedAt: new Date(),
      completedAt: new Date(),
      phases: [],
      totalFilesProcessed: 0,
      totalFunctionsIndexed: 0,
      totalContextPacksCreated: 0,
      version,
      success,
      error,
    });

    mockBootstrapProject
      .mockImplementationOnce(async () => makeReport(false, 'Include patterns matched no files in workspace.'))
      .mockImplementationOnce(async () => makeReport(true));

    const { createLibrarian } = await import('../librarian.js');

    const librarian = await createLibrarian({
      workspace,
      autoBootstrap: true,
      autoWatch: false,
      autoHealConfig: false,
      skipEmbeddings: true,
      bootstrapConfig: {
        include: ['nonexistent/**/*.ts'],
        exclude: ['**/*.spec.ts'],
      },
    });

    expect(mockBootstrapProject).toHaveBeenCalledTimes(2);
    const secondConfig = mockBootstrapProject.mock.calls[1]?.[0] as { include?: string[]; exclude?: string[] };
    expect(secondConfig?.include).toEqual([...INCLUDE_PATTERNS]);
    expect(secondConfig?.exclude).toEqual([...EXCLUDE_PATTERNS]);

    await librarian.shutdown();
  });
});
