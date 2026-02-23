import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const workflowPath = path.resolve(process.cwd(), '.github/workflows/librainian-action-dogfood.yml');

describe('librainian-action-dogfood workflow contract', () => {
  test('configures bootstrap timeout and stall timeout for dogfood gate', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('name: Dogfood gate (status + index + query suite)');
    expect(workflow).toContain('timeout-minutes: 30');
    expect(workflow).toContain('DOGFOOD_CI_BOOTSTRAP_TIMEOUT_MS: 1500000');
    expect(workflow).toContain('DOGFOOD_CI_BOOTSTRAP_STALL_TIMEOUT_MS: 0');
    expect(workflow).toContain('name: Upload clean-clone dogfood artifact');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('name: librainian-clean-clone-self-hosting');
    expect(workflow).toContain('path: state/dogfood/clean-clone-self-hosting.json');
  });
});
