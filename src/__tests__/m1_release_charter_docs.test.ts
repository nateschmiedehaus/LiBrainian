import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('M1 release readiness charter docs', () => {
  it('publishes charter, versioning policy, and dry-run bundle artifacts', () => {
    const root = process.cwd();
    const charterPath = path.join(root, 'docs', 'archive', 'releases', 'm1-release-charter.md');
    const versioningPath = path.join(root, 'docs', 'archive', 'releases', 'versioning-policy.md');
    const dryRunPath = path.join(
      root,
      'docs',
      'archive',
      'releases',
      'dry-runs',
      'm1-release-dry-run-2026-02-26.md'
    );

    expect(fs.existsSync(charterPath)).toBe(true);
    expect(fs.existsSync(versioningPath)).toBe(true);
    expect(fs.existsSync(dryRunPath)).toBe(true);
  });

  it('documents concrete pass/fail gate table and milestone completion blocker', () => {
    const charterPath = path.join(
      process.cwd(),
      'docs',
      'archive',
      'releases',
      'm1-release-charter.md'
    );
    const charter = fs.readFileSync(charterPath, 'utf8');

    expect(charter).toContain('## M1 Exit Gates');
    expect(charter).toContain('| Gate ID |');
    expect(charter).toContain('Pass');
    expect(charter).toContain('Fail');
    expect(charter).toContain('## Freeze Policy');
    expect(charter).toContain('## Blocker Policy');
    expect(charter).toContain('## Rollback Policy');
    expect(charter).toContain('Milestone completion is blocked unless all M1 gates are green');
  });

  it('captures release command checklist and first-time agent onboarding requirements', () => {
    const charterPath = path.join(
      process.cwd(),
      'docs',
      'archive',
      'releases',
      'm1-release-charter.md'
    );
    const charter = fs.readFileSync(charterPath, 'utf8');

    expect(charter).toContain('npm run build');
    expect(charter).toContain('npm test -- --run');
    expect(charter).toContain('npm run test:agentic:strict');
    expect(charter).toContain('npx librainian');
    expect(charter).toContain('initializeLibrarian');
    expect(charter).toContain('Upgrading from prior versions');
  });

  it('declares core release scripts in package.json', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    // M1 ceremony scripts consolidated into test:agentic:strict and release:pack
    expect(scripts['test:agentic:strict']).toBeTypeOf('string');
    expect(scripts['release:pack']).toBeTypeOf('string');
  });
});
