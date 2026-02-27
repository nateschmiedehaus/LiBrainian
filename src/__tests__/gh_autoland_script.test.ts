import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('gh autoland automation', () => {
  it('keeps the gh:ship shortcut wired in package scripts', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    expect(scripts['gh:ship']).toContain('gh-autoland.mjs --preflight-npm-script validate:fast');
    expect(scripts['gh:ship']).toContain('gh-flow-policy-check.mjs --mode pull');
    expect(scripts['gh:ship']).toContain('gh-flow-policy-check.mjs --mode merge');
    expect(scripts['gh:ship']).toContain('git-hygiene-guard.mjs --mode enforce');
  });

  it('exposes issue-link and publish-dispatch flags in help output', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'gh-autoland.mjs');
    const result = spawnSync(process.execPath, [scriptPath, '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;
    expect(output).toContain('--issue N');
    expect(output).toContain('--dispatch-publish none|verify|publish');
    expect(output).toContain('--comment-issue-link');
  });
});
