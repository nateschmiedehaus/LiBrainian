import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSqliteStorage } from '../sqlite_storage.js';
import type { LibrarianStorage } from '../types.js';
import type { EvidenceEntry } from '../../api/evidence.js';

describe('Evidence verification', () => {
  let tempDir: string;
  let dbPath: string;
  let storage: LibrarianStorage;
  let sourceFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-evidence-'));
    dbPath = path.join(tempDir, 'librarian.sqlite');
    sourceFile = path.join(tempDir, 'src', 'auth.ts');
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    storage = createSqliteStorage(dbPath, tempDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function seedEvidence(snippet: string): Promise<void> {
    const entry: EvidenceEntry = {
      claimId: 'claim-auth-1',
      entityId: 'fn_authenticate',
      entityType: 'function',
      file: sourceFile,
      line: 2,
      endLine: 4,
      snippet,
      claim: 'Definition of authenticate',
      confidence: 'verified',
      createdAt: new Date().toISOString(),
    };
    await storage.setEvidence([entry]);
  }

  it('keeps moved exact snippets valid and updates line references', async () => {
    const originalSnippet = [
      'export function authenticate(token: string) {',
      '  const normalized = token.trim();',
      '  return normalized.length > 0;',
    ].join('\n');
    await fs.writeFile(sourceFile, [
      '// header',
      originalSnippet,
      '}',
      '',
    ].join('\n'), 'utf8');
    await seedEvidence(originalSnippet);

    await fs.writeFile(sourceFile, [
      '// moved down',
      '// still same implementation',
      '// metadata',
      originalSnippet,
      '}',
      '',
    ].join('\n'), 'utf8');

    const refs = await storage.getEvidenceForTarget('fn_authenticate', 'function');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.stale).toBe(false);
    expect(refs[0]?.line).toBe(4);
    expect(refs[0]?.endLine).toBe(6);
    expect(typeof refs[0]?.verifiedAt).toBe('string');
    expect(typeof refs[0]?.contentHash).toBe('string');
  });

  it('uses fuzzy verification for minor 3-line refactors', async () => {
    const snippet = [
      'export function authenticate(token: string) {',
      '  const normalized = token.trim();',
      '  return normalized.length > 0;',
    ].join('\n');
    await fs.writeFile(sourceFile, [
      '// header',
      snippet,
      '}',
      '',
    ].join('\n'), 'utf8');
    await seedEvidence(snippet);

    await fs.writeFile(sourceFile, [
      '// header',
      'export function authenticate(token: string) {',
      '  const normalized = token.trim();',
      '  return normalized.length >= 0;',
      '}',
      '',
    ].join('\n'), 'utf8');

    const refs = await storage.getEvidenceForTarget('fn_authenticate', 'function');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.stale).toBe(false);
    expect(refs[0]?.line).toBe(2);
    expect(refs[0]?.endLine).toBe(4);
  });

  it('marks deleted snippets stale and reflects that in summary/export', async () => {
    const snippet = [
      'export function authenticate(token: string) {',
      '  const normalized = token.trim();',
      '  return normalized.length > 0;',
    ].join('\n');
    await fs.writeFile(sourceFile, [
      '// header',
      snippet,
      '}',
      '',
    ].join('\n'), 'utf8');
    await seedEvidence(snippet);

    await fs.writeFile(sourceFile, [
      'export function loginWithMagicLink(email: string) {',
      '  return email.includes("@");',
      '}',
      '',
    ].join('\n'), 'utf8');

    const refs = await storage.getEvidenceForTarget('fn_authenticate', 'function');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.stale).toBe(true);

    const summaryProvider = storage as LibrarianStorage & {
      getEvidenceVerificationSummary?: (options?: { limit?: number; force?: boolean }) => Promise<{
        staleCount: number;
      }>;
      exportEvidenceMarkdown?: (outputPath?: string) => Promise<string>;
    };
    const summary = await summaryProvider.getEvidenceVerificationSummary?.({ force: true });
    expect(summary?.staleCount).toBe(1);

    const reportPath = path.join(tempDir, 'EVIDENCE.md');
    await summaryProvider.exportEvidenceMarkdown?.(reportPath);
    const report = await fs.readFile(reportPath, 'utf8');
    expect(report).toContain('STALE');
  });
});
