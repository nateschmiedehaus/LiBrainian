import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('github readiness docs', () => {
  it('includes required governance files', () => {
    const root = process.cwd();
    expect(fs.existsSync(path.join(root, 'CODE_OF_CONDUCT.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'SECURITY.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.github', 'CODEOWNERS'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.github', 'ISSUE_TEMPLATE', 'config.yml'))).toBe(true);
  });

  it('links governance docs from README', () => {
    const readmePath = path.join(process.cwd(), 'README.md');
    const readme = fs.readFileSync(readmePath, 'utf8');
    expect(readme).toContain('## Community Standards');
    expect(readme).toContain('[Code of Conduct](CODE_OF_CONDUCT.md)');
    expect(readme).toContain('[Security Policy](SECURITY.md)');
  });

  it('documents release-grade validation in contributing guide', () => {
    const contributingPath = path.join(process.cwd(), 'CONTRIBUTING.md');
    const contributing = fs.readFileSync(contributingPath, 'utf8');
    expect(contributing).toContain('### Release-Grade Validation (Required Before Merge)');
    expect(contributing).toContain('npm run package:assert-identity');
    expect(contributing).toContain('npm run package:install-smoke');
    expect(contributing).toContain('npm run eval:publish-gate -- --json');
  });
});
