import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectVerificationProvenance } from '../verification_provenance.js';

describe('collectVerificationProvenance', () => {
  it('reports unavailable when status/gates files are missing', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-prov-missing-'));
    try {
      const report = await collectVerificationProvenance(workspace);
      expect(report.status).toBe('unavailable');
      expect(report.evidencePrerequisitesSatisfied).toBe(false);
      expect(report.notes.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('reports unverified when strict markers exist', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-prov-unverified-'));
    const docsDir = path.join(workspace, 'docs', 'LiBrainian');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(
      path.join(docsDir, 'STATUS.md'),
      '# Status\nGenerated: 2026-02-18T00:13:37.000Z\nunverified (evidence_manifest_missing)\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(docsDir, 'GATES.json'),
      JSON.stringify({ tasks: { 'layer0.tier0': { status: 'unverified', verified: false } } }, null, 2),
      'utf8',
    );

    try {
      const report = await collectVerificationProvenance(workspace);
      expect(report.status).toBe('unverified');
      expect(report.evidenceGeneratedAt).toBe('2026-02-18T00:13:37.000Z');
      expect(report.statusUnverifiedMarkers).toBeGreaterThan(0);
      expect(report.gatesUnverifiedTasks).toBe(1);
      expect(report.gatesTotalTasks).toBe(1);
      expect(report.evidencePrerequisitesSatisfied).toBe(false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('reports verified when no unverified markers remain', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-prov-verified-'));
    const docsDir = path.join(workspace, 'docs', 'LiBrainian');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(
      path.join(docsDir, 'STATUS.md'),
      '# Status\nGenerated: 2026-02-18T00:13:37.000Z\nAll checks green.\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(docsDir, 'GATES.json'),
      JSON.stringify({ tasks: { 'layer0.tier0': { status: 'verified', verified: true } } }, null, 2),
      'utf8',
    );

    try {
      const report = await collectVerificationProvenance(workspace);
      expect(report.status).toBe('verified');
      expect(report.gatesUnverifiedTasks).toBe(0);
      expect(report.evidencePrerequisitesSatisfied).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
