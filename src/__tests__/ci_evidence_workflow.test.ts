import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ci evidence workflow', () => {
  it('keeps evidence-heavy release qualification out of the public ci workflow', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('name: ci');
    expect(workflow).toContain('npm run validate:fast');
    expect(workflow).not.toContain('npm run evidence:sync');
    expect(workflow).not.toContain('npm run evidence:verify');
    expect(workflow).not.toContain('npm run evidence:freshness-check');
    expect(workflow).not.toContain('npm run evidence:assert-gates');
    expect(workflow).not.toContain('test:agentic:strict');
  });
});
