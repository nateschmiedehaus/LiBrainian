import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('npm publish workflow', () => {
  it('defines a GitHub-driven publish workflow', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'publish-npm.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('name: npm-publish');
    expect(workflow).toContain('node-version: 24');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('allow_trusted_fallback:');
    expect(workflow).toContain('release:');
    expect(workflow).toContain('types:');
    expect(workflow).toContain('published');
    expect(workflow).toContain('packages: write');
    expect(workflow).toContain('npm run evidence:sync');
    expect(workflow).toContain('npm run evidence:drift-check');
    expect(workflow).toContain('Skipping evidence sync (missing eval-results/ab-results.json).');
    expect(workflow).toContain('Skipping evidence drift guard (missing state/evidence/evidence-manifest.json).');
    expect(workflow).toContain('npm run release:pack');
    expect(workflow).toContain('npm run test:e2e:reality:tarball');
    expect(workflow).toContain('npm run test:e2e:acceptance');
    expect(workflow).toContain('node scripts/assert-trusted-publish-runtime.mjs');
    expect(workflow).toContain('npm publish --provenance --access public');
    expect(workflow).toContain('No valid npm token detected. Refusing implicit fallback.');
    expect(workflow).toContain('Trusted publishing failed (likely npm trusted publisher not configured for this repo/workflow).');
    expect(workflow).toContain('npm run release:github-packages');
    expect(workflow).toContain('Enforce npm publish success');
    expect(workflow).toContain('https://npm.pkg.github.com');
  });
});
