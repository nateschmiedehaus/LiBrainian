import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ci evidence workflow', () => {
  it('regenerates and validates evidence on full-tier0 runs', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('full-tier0:');
    expect(workflow).toContain('npm run evidence:sync');
    expect(workflow).toContain('npm run evidence:freshness-check');
    expect(workflow).toContain('npm run evidence:assert-gates');
  });
});
