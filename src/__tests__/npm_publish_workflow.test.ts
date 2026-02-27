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
    expect(workflow).toContain('npm run evidence:verify');
    expect(workflow).toContain('npm run release:pack');
    expect(workflow).toContain('npm run test:e2e:outcome');
    expect(workflow).toContain('npm run test:e2e:triage');
    expect(workflow).toContain('Enforce E2E gate outcomes');
    expect(workflow).toContain('continue-on-error: true');
    expect(workflow).toContain('npm run test:e2e:dev-truth');
    expect(workflow).toContain('External natural-usage E2E gate (primary, release)');
    expect(workflow).toContain('npm run eval:use-cases:agentic');
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
