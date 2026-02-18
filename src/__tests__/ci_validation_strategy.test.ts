import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ci validation strategy', () => {
  it('runs fast validation on PRs and full deterministic tests on main', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);

    const workflow = fs.readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('validate-fast');
    expect(workflow).toContain("if: github.event_name == 'pull_request'");
    expect(workflow).toContain('npm run validate:fast');
    expect(workflow).toContain('full-tier0');
    expect(workflow).toContain("if: github.event_name != 'pull_request'");
    expect(workflow).toContain('npm test -- --run');
  });
});
