import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('unit patrol CI integration', () => {
  it('defines npm test:unit-patrol script covering all unit patrol gates', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const script = packageJson.scripts?.['test:unit-patrol'];
    expect(typeof script).toBe('string');
    expect(script).toContain('src/constructions/processes/__tests__/unit_patrol.test.ts');
    expect(script).toContain('src/constructions/processes/__tests__/bootstrap_quality_gate.test.ts');
    expect(script).toContain('src/constructions/processes/__tests__/query_relevance_gate.test.ts');
    expect(script).toContain('src/constructions/processes/__tests__/context_pack_depth_gate.test.ts');
    expect(script).toContain('src/constructions/processes/__tests__/cli_output_sanity_gate.test.ts');
    expect(script).toContain('src/constructions/processes/__tests__/self_index_gate.test.ts');
  });

  it('defines required unit-patrol workflow for PR and main', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'unit-patrol.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('name: unit-patrol');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('push:');
    expect(workflow).toContain('- main');
    expect(workflow).toContain('timeout-minutes: 15');
    expect(workflow).toContain('LIBRARIAN_LLM_PROVIDER: disabled');
    expect(workflow).toContain('LIBRARIAN_EMBEDDING_PROVIDER: xenova');
    expect(workflow).toContain('npm run test:unit-patrol');
  });
});
