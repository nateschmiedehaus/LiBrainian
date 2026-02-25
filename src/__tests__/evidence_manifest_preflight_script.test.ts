import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function createNpmStub() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-preflight-test-'));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const npmPath = path.join(binDir, 'npm');
  fs.writeFileSync(
    npmPath,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
if (process.env.STUB_CREATE_MANIFEST_PATH) {
  const manifestPath = process.env.STUB_CREATE_MANIFEST_PATH;
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, '{"kind":"EvidenceManifest.v1","generatedAt":"2026-02-25T00:00:00.000Z","workspaceRoot":".","entries":[]}', 'utf8');
}
if (process.env.STUB_NPM_STDOUT) process.stdout.write(process.env.STUB_NPM_STDOUT);
if (process.env.STUB_NPM_STDERR) process.stderr.write(process.env.STUB_NPM_STDERR);
process.exit(Number(process.env.STUB_NPM_EXIT_CODE ?? '0'));
`,
    'utf8',
  );
  fs.chmodSync(npmPath, 0o755);
  return { root, binDir };
}

function runPreflight(args: string[], extraEnv: Record<string, string> = {}) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'evidence-manifest-preflight.mjs');
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
    },
    timeout: 15_000,
  });
}

describe('evidence-manifest-preflight script', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with remediation block when manifest is missing', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-preflight-workspace-'));
    cleanupDirs.push(workspace);
    const manifestPath = path.join(workspace, 'state', 'audits', 'librarian', 'manifest.json');

    const result = runPreflight(['--root', workspace, '--manifest', manifestPath]);

    expect(result.status).toBe(1);
    const stderr = String(result.stderr ?? '');
    expect(stderr).toContain('failed (evidence_manifest_missing)');
    expect(stderr).toContain('npm run evidence:manifest');
    expect(stderr).toContain('npm run evidence:reconcile');
    expect(stderr).toContain('npm run evidence:refresh');
  });

  it('supports guarded local auto-recovery for missing manifests', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-preflight-workspace-'));
    cleanupDirs.push(workspace);
    const manifestPath = path.join(workspace, 'state', 'audits', 'librarian', 'manifest.json');
    const { root, binDir } = createNpmStub();
    cleanupDirs.push(root);

    const result = runPreflight(['--root', workspace, '--manifest', manifestPath, '--auto-recover'], {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      STUB_CREATE_MANIFEST_PATH: manifestPath,
    });

    expect(result.status).toBe(0);
    expect(String(result.stdout ?? '')).toContain('auto-recovered via evidence:refresh');
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it('keeps auto-recovery disabled in CI for deterministic strict behavior', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-preflight-workspace-'));
    cleanupDirs.push(workspace);
    const manifestPath = path.join(workspace, 'state', 'audits', 'librarian', 'manifest.json');

    const result = runPreflight(['--root', workspace, '--manifest', manifestPath, '--auto-recover'], {
      CI: 'true',
    });

    expect(result.status).toBe(1);
    expect(String(result.stderr ?? '')).toContain('failed (auto_recover_disabled_in_ci)');
  });
});
