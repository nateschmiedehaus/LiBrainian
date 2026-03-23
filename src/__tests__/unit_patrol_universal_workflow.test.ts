import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('unit patrol universal adaptation/proof workflow', () => {
  it('defines universal unit-patrol demonstration script in package scripts', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const script = packageJson.scripts?.['eval:unit-patrol:universal'];
    expect(typeof script).toBe('string');
    expect(script).toContain('scripts/unit-patrol-universal-construction.ts');
    expect(script).toContain('unit-patrol-universal-proof.json');
  });

  it('keeps universal demos available as maintainer scripts instead of public github workflows', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    expect(workflow).not.toContain('eval:unit-patrol:universal');
    expect(workflow).not.toContain('unit-patrol-universal-proof.json');
  });

  it('documents onboarding path for adding new domain/task mappings', () => {
    const docsPath = path.join(process.cwd(), 'docs', 'archive', 'validation.md');
    const docs = fs.readFileSync(docsPath, 'utf8');
    expect(docs).toContain('Unit Patrol universal adaptation/proof onboarding');
    expect(docs).toContain('src/constructions/processes/unit_patrol_selector.ts');
    expect(docs).toContain('eval:unit-patrol:universal');
  });
});
