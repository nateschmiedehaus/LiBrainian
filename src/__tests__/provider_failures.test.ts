import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  classifyProviderFailure,
  getActiveProviderFailures,
  recordProviderFailure,
} from '../utils/provider_failures.js';

describe('provider_failures', () => {
  it('downgrades incoherent sticky failures to unknown', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'librarian-provider-failures-'));
    try {
      await recordProviderFailure(workspaceRoot, {
        provider: 'codex',
        reason: 'rate_limit',
        message: 'You are Librarian. Build a method pack for an agent.',
        ttlMs: 15 * 60 * 1000,
        at: new Date().toISOString(),
      });

      const failures = await getActiveProviderFailures(workspaceRoot);
      expect(failures.codex?.reason).toBe('unknown');
      expect(failures.codex?.message).toContain('You are Librarian');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('self-heals mismatched persisted failure records when reading', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'librarian-provider-failure-heal-'));
    try {
      const targetPath = path.join(
        workspaceRoot,
        'state',
        'audits',
        'librarian',
        'provider',
        'provider_failures.json'
      );
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, JSON.stringify({
        kind: 'ProviderFailureState.v1',
        schema_version: 1,
        updated_at: new Date().toISOString(),
        failures: {
          codex: {
            provider: 'codex',
            reason: 'rate_limit',
            message: 'You are Librarian. Build a method pack for an agent.',
            ttlMs: 900000,
            at: new Date().toISOString(),
          },
        },
      }, null, 2), 'utf8');

      const failures = await getActiveProviderFailures(workspaceRoot);
      expect(failures.codex?.reason).toBe('unknown');

      const rewritten = JSON.parse(await readFile(targetPath, 'utf8')) as {
        failures?: { codex?: { reason?: string } };
      };
      expect(rewritten.failures?.codex?.reason).toBe('unknown');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('keeps coherent rate-limit failures unchanged', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'librarian-provider-failure-keep-'));
    try {
      await recordProviderFailure(workspaceRoot, {
        provider: 'codex',
        reason: 'rate_limit',
        message: 'Error: rate_limit exceeded for current account',
        ttlMs: 15 * 60 * 1000,
        at: new Date().toISOString(),
      });

      const failures = await getActiveProviderFailures(workspaceRoot);
      expect(failures.codex?.reason).toBe('rate_limit');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('does not classify generic exceeded wording as quota errors', () => {
    const result = classifyProviderFailure('operation exceeded execution deadline');
    expect(result.reason).toBe('unknown');
  });
});
