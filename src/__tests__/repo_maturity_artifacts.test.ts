import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('repo maturity artifacts', () => {
  it('provides a curated examples folder with README and multiple runnable examples', () => {
    const root = process.cwd();
    const examplesDir = path.join(root, 'examples');
    const entries = fs.readdirSync(examplesDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const tsExamples = files.filter((name) => name.endsWith('.ts'));

    expect(files).toContain('README.md');
    expect(tsExamples.length).toBeGreaterThanOrEqual(3);
  });

  it('wires repo audit script into package scripts', () => {
    const root = process.cwd();
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['repo:audit']).toBe('node scripts/repo-folder-audit.mjs');
    expect(fs.existsSync(path.join(root, 'scripts', 'repo-folder-audit.mjs'))).toBe(true);
  });

  it('documents folder review with benchmark references', () => {
    const root = process.cwd();
    const reviewPath = path.join(root, 'docs', 'librarian', 'REPO_FOLDER_REVIEW.md');
    const review = fs.readFileSync(reviewPath, 'utf8');

    expect(review).toContain('claude-code');
    expect(review).toContain('openclaw');
    expect(review).toContain('examples/');
  });
});
