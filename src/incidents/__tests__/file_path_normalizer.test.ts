import { describe, expect, it } from 'vitest';
import { normalizeIncidentFilePath } from '../file_path_normalizer.js';

describe('file_path_normalizer', () => {
  const workspaceRoot = '/repo';

  it('resolves relative paths against workspace root', () => {
    expect(normalizeIncidentFilePath('src/a.ts', workspaceRoot)).toBe('/repo/src/a.ts');
  });

  it('preserves normalized absolute paths', () => {
    expect(normalizeIncidentFilePath('/repo/src/../src/a.ts', workspaceRoot)).toBe('/repo/src/a.ts');
  });

  it('normalizes file:// urls', () => {
    expect(normalizeIncidentFilePath('file:///repo/src/a.ts', workspaceRoot)).toBe('/repo/src/a.ts');
  });

  it('strips wrapping quotes', () => {
    expect(normalizeIncidentFilePath('"src/a.ts"', workspaceRoot)).toBe('/repo/src/a.ts');
  });

  it('filters non-local runtime and network paths', () => {
    expect(normalizeIncidentFilePath('node:internal/process/task_queues', workspaceRoot)).toBeNull();
    expect(normalizeIncidentFilePath('https://example.com/app.ts', workspaceRoot)).toBeNull();
  });
});
