import { describe, it, expect, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { installMissingGrammars } from '../grammar_support.js';

vi.mock('execa', () => ({
  execa: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

describe('installMissingGrammars', () => {
  it('installs into the grammar cache (not the workspace)', async () => {
    const cacheRoot = path.join(os.tmpdir(), `librarian-grammars-${Date.now()}`);
    process.env.LIBRARIAN_GRAMMAR_CACHE_DIR = cacheRoot;

    const result = await installMissingGrammars('/tmp/not-a-project', {
      workspace: '/tmp/not-a-project',
      languagesDetected: ['python'],
      languageCounts: { python: 1 },
      unknownExtensions: {},
      supportedByTsMorph: [],
      supportedByTreeSitter: [],
      missingLanguageConfigs: [],
      missingGrammarModules: ['tree-sitter-python'],
      missingTreeSitterCore: false,
      totalFiles: 1,
      truncated: false,
      errors: [],
    });

    expect(result.attempted).toBe(true);
    expect(fs.existsSync(cacheRoot)).toBe(true);
    expect(result.packageManager).toBe('npm');

    const { execa } = await import('execa');
    const calls = vi.mocked(execa).mock.calls;
    expect(calls.length).toBe(1);
    const [bin, args, opts] = calls[0]!;
    expect(bin).toBe('npm');
    expect(args).toContain('--prefix');
    expect(args).toContain(cacheRoot);
    expect(opts?.cwd).toBe(cacheRoot);
    expect(typeof opts?.env?.TMPDIR).toBe('string');
    expect(opts?.env?.TMPDIR).toContain(path.join(cacheRoot, '.tmp'));

    if (process.platform === 'darwin') {
      const commandLineToolsSdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
      const xcodeSdk = '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk';
      const expectedSdk = fs.existsSync(commandLineToolsSdk) ? commandLineToolsSdk : xcodeSdk;
      if (fs.existsSync(expectedSdk)) {
        expect(opts?.env?.SDKROOT).toBe(expectedSdk);
        expect(opts?.env?.CPLUS_INCLUDE_PATH).toContain(path.join(expectedSdk, 'usr', 'include', 'c++', 'v1'));
      }
    }
  });
});
