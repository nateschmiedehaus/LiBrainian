import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('librainian action dogfood workflow', () => {
  it('runs clean-clone self-hosting gate and uploads artifact', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'librainian-action-dogfood.yml');
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('name: librainian-action-dogfood');
    expect(workflow).toContain('LIBRAINIAN_ACTION_STALL_TIMEOUT_SECONDS: 300');
    expect(workflow).toContain('LIBRAINIAN_ACTION_HARD_TIMEOUT_SECONDS: 900');
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

  it('enforces timeout and stale-process diagnostics in the librainian action', () => {
    const actionPath = path.join(process.cwd(), '.github', 'actions', 'librainian', 'action.yml');
    const action = fs.readFileSync(actionPath, 'utf8');

    expect(action).toContain('LIBRAINIAN_ACTION_STALL_TIMEOUT_SECONDS');
    expect(action).toContain('LIBRAINIAN_ACTION_HARD_TIMEOUT_SECONDS');
    expect(action).toContain('LIBRAINIAN_ACTION_HARD_TIMEOUT_SECONDS:-900');
    expect(action).toContain('heartbeat elapsed=');
    expect(action).toContain('bootstrapIdle=');
    expect(action).toContain('stall_timeout');
    expect(action).toContain('bootstrap_stall_timeout');
    expect(action).toContain('hard_timeout');
    expect(action).toContain('cleanup_orphan_processes');
    expect(action).toContain('stage=');
    expect(action).toContain('last output (tail)');
  });

  it('emits bootstrap heartbeat logs for long-running bootstrap phases', () => {
    const bootstrapPath = path.join(process.cwd(), 'src', 'cli', 'commands', 'bootstrap.ts');
    const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

    expect(bootstrap).toContain('LIBRARIAN_BOOTSTRAP_HEARTBEAT_MS');
    expect(bootstrap).toContain('[bootstrap-heartbeat]');
    expect(bootstrap).toContain('phase=');
  });
});
