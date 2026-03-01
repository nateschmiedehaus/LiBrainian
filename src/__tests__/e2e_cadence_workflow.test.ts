import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('e2e cadence workflow', () => {
  it('defines nightly e2e cadence with dev-truth priority and mainline safeguards', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'e2e-cadence.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('name: e2e-cadence');
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain("cron: '0 6 * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('npm run policy:e2e:mainline');
    expect(workflow).toContain('External natural-usage E2E gate (primary, quick)');
    expect(workflow).toContain('npm run eval:use-cases:agentic:quick');
    expect(workflow).toContain('npm run test:e2e:outcome');
    expect(workflow).toContain('npm run test:e2e:triage');
    expect(workflow).toContain('--create-gh-issues');
    expect(workflow).toContain('Enforce E2E gate outcomes');
    expect(workflow).toContain('continue-on-error: true');
    expect(workflow).toContain('npm run test:e2e:dev-truth');
    expect(workflow).toContain('npm run test:e2e:reality');
    expect(workflow).toContain('development cadence keeps focus on dev-truth lane');
    expect(workflow).toContain('npm run test:e2e:acceptance');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('state/e2e/*.json');
  });
});
