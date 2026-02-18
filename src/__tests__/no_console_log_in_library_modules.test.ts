import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const GUARDED_DIRS = ['api', 'agents', 'storage', 'knowledge', 'epistemics', 'mcp'] as const;
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const RUNTIME_CONSOLE_LOG_PATTERN = /^[ \t]*console\.log\(/gm;

async function collectSourceFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        continue;
      }
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name);
    if (!CODE_EXTENSIONS.has(ext)) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

describe('library stdout hygiene', () => {
  it('has no runtime console.log calls in core library modules', async () => {
    const projectRoot = process.cwd();
    const violations: string[] = [];

    for (const relativeDir of GUARDED_DIRS) {
      const dirPath = path.join(projectRoot, 'src', relativeDir);
      const files = await collectSourceFiles(dirPath);

      for (const filePath of files) {
        const contents = await fs.readFile(filePath, 'utf8');
        RUNTIME_CONSOLE_LOG_PATTERN.lastIndex = 0;

        let match: RegExpExecArray | null = RUNTIME_CONSOLE_LOG_PATTERN.exec(contents);
        while (match) {
          const line = contents.slice(0, match.index).split('\n').length;
          violations.push(`${path.relative(projectRoot, filePath)}:${line}`);
          match = RUNTIME_CONSOLE_LOG_PATTERN.exec(contents);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
