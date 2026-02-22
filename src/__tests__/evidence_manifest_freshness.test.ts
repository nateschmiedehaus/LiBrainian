import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkEvidenceFreshness } from '../evidence/evidence_manifest_freshness.js';

describe('evidence manifest freshness', () => {
  it('fails when manifest is missing', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'evidence-freshness-'));
    try {
      const report = await checkEvidenceFreshness({
        manifestPath: join(workspace, 'state', 'audits', 'librarian', 'manifest.json'),
        watchedPaths: [],
      });
      expect(report.ok).toBe(false);
      expect(report.violations).toEqual([
        expect.objectContaining({ code: 'manifest_missing' }),
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('fails when a watched source is newer than the manifest', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'evidence-freshness-'));
    const manifestPath = join(workspace, 'state', 'audits', 'librarian', 'manifest.json');
    const watchedPath = join(workspace, 'src', 'evaluation', 'evidence_reconciliation.ts');
    try {
      await mkdir(join(workspace, 'state', 'audits', 'librarian'), { recursive: true });
      await mkdir(join(workspace, 'src', 'evaluation'), { recursive: true });
      await writeFile(manifestPath, '{}\n', 'utf8');
      await writeFile(watchedPath, 'export const marker = true;\n', 'utf8');
      await utimes(manifestPath, new Date('2026-02-01T00:00:00.000Z'), new Date('2026-02-01T00:00:00.000Z'));
      await utimes(watchedPath, new Date('2026-02-02T00:00:00.000Z'), new Date('2026-02-02T00:00:00.000Z'));

      const report = await checkEvidenceFreshness({
        manifestPath,
        watchedPaths: [watchedPath],
      });

      expect(report.ok).toBe(false);
      expect(report.violations).toEqual([
        expect.objectContaining({
          code: 'manifest_stale',
          path: watchedPath,
        }),
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('passes when manifest is as new as watched sources', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'evidence-freshness-'));
    const manifestPath = join(workspace, 'state', 'audits', 'librarian', 'manifest.json');
    const watchedPath = join(workspace, 'scripts', 'reconcile_evidence.mjs');
    try {
      await mkdir(join(workspace, 'state', 'audits', 'librarian'), { recursive: true });
      await mkdir(join(workspace, 'scripts'), { recursive: true });
      await writeFile(manifestPath, '{}\n', 'utf8');
      await writeFile(watchedPath, '#!/usr/bin/env node\n', 'utf8');
      await utimes(watchedPath, new Date('2026-02-01T00:00:00.000Z'), new Date('2026-02-01T00:00:00.000Z'));
      await utimes(manifestPath, new Date('2026-02-02T00:00:00.000Z'), new Date('2026-02-02T00:00:00.000Z'));

      const report = await checkEvidenceFreshness({
        manifestPath,
        watchedPaths: [watchedPath],
      });

      expect(report.ok).toBe(true);
      expect(report.violations).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
