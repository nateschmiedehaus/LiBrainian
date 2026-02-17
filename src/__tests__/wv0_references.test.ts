import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function listFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

describe('wv0 reference cleanup', () => {
  it('contains no WVO-prefixed environment references', () => {
    const root = process.cwd();
    const files = listFiles(root).filter((filePath) => !filePath.endsWith('package-lock.json'));

    const offenders: string[] = [];
    for (const filePath of files) {
      const relPath = path.relative(root, filePath).split(path.sep).join('/');
      if (relPath.endsWith('src/__tests__/wv0_references.test.ts')) continue;
      if (!/\.(md|ts|tsx|js|mjs|json|yml|yaml)$/.test(relPath)) continue;
      let text = '';
      try {
        text = fs.readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      if (text.includes('WVO_')) {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
