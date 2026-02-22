import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('librainian action dogfood workflow', () => {
  it('runs clean-clone self-hosting gate and uploads artifact', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'librainian-action-dogfood.yml');
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('name: librainian-action-dogfood');
    expect(workflow).toContain('node scripts/dogfood-ci-gate.mjs --artifact state/dogfood/clean-clone-self-hosting.json');
    expect(workflow).toContain('name: Upload clean-clone self-hosting artifact');
    expect(workflow).toContain('name: clean-clone-self-hosting');
    expect(workflow).toContain('retention-days: 30');
    expect(workflow).toContain('path: state/dogfood/clean-clone-self-hosting.json');
    expect(workflow).toContain('LIBRAINIAN_EMBEDDING_PROVIDER: xenova');
    expect(workflow).toContain('LIBRAINIAN_EMBEDDING_MODEL: all-MiniLM-L6-v2');
  });

  it('defines clean-clone harness artifact contract', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'dogfood-ci-gate.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');

    expect(script).toContain('CleanCloneSelfHostingArtifact.v1');
    expect(script).toContain("'clone', '--depth', '1', '--no-local'");
    expect(script).toContain("'librainian.bootstrap'");
    expect(script).toContain("'librainian.update'");
    expect(script).toContain("'librainian.status'");
    expect(script).toContain('lockSignals');
    expect(script).toContain('dogfood-retention-audit.json');
    expect(script).toContain('artifact.retention');
  });
});
