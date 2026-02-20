import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('e2e cadence workflow', () => {
  it('defines scheduled and push-driven e2e cadence with npm freshness prerequisite', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'e2e-cadence.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('name: e2e-cadence');
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain("cron: '0 6 * * *'");
    expect(workflow).toContain('push:');
    expect(workflow).toContain('- main');
    expect(workflow).toContain('npm run policy:npm:fresh');
    expect(workflow).toContain('npm run test:e2e:reality');
    expect(workflow).toContain('npm run test:e2e:reality:tarball');
    expect(workflow).toContain('npm run test:e2e:acceptance');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('state/e2e/*.json');
  });
});
