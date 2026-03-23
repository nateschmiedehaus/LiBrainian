import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ci validation strategy', () => {
  it('keeps the public github workflow surface focused on reviewer-facing checks', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);

    const workflow = fs.readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('name: ci');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('validate:');
    expect(workflow).toContain('npm run validate:fast');
    expect(workflow).toContain('npm run test:e2e:acceptance');
    expect(workflow).toContain('npm run package:assert-identity');
    expect(workflow).toContain('npm run public:pack');
    expect(workflow).not.toContain('test:agentic:strict');
    expect(workflow).not.toContain('eval:unit-patrol:universal');
  });
});
