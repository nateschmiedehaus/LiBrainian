import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('dogfood ci gate script', () => {
  it('auto-bootstraps fresh clones before enforcing health assertions', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'dogfood-ci-gate.mjs');
    const script = fs.readFileSync(scriptPath, 'utf8');

    expect(script).toContain('function ensureBootstrapped');
    expect(script).toContain("runCli(workspace, ['bootstrap', '--mode', 'fast', '--no-claude-md', '--force-resume']");
    expect(script).toContain('status-post-bootstrap');
  });
});
