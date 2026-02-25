import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unwrapConstructionExecutionResult, type Context } from '../../types.js';
import {
  createStaleDocumentationSensorConstruction,
  createStaleDocumentationLiveResult,
  type StaleDocumentationSensorOutput,
} from '../stale_documentation_sensor.js';

interface LedgerEntryLike {
  readonly payload: Record<string, unknown>;
}

class TestLedger {
  readonly entries: LedgerEntryLike[] = [];

  async append(entry: { payload: Record<string, unknown> }): Promise<{ id: string; timestamp: Date } & LedgerEntryLike> {
    const next = {
      id: `e-${this.entries.length + 1}`,
      timestamp: new Date(),
      payload: entry.payload,
    };
    this.entries.push(next);
    return next;
  }
}

async function withTempDir(fn: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'stale-doc-sensor-'));
  try {
    await fn(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function createContext(ledger: TestLedger): Context<{ evidenceLedger: TestLedger }> {
  return {
    deps: { evidenceLedger: ledger },
    signal: new AbortController().signal,
    sessionId: 'test-session',
  };
}

function timeoutAfter<T>(ms: number, reason: string): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    setTimeout(() => reject(new Error(reason)), ms);
  });
}

describe('createStaleDocumentationSensorConstruction', () => {
  it('reports behavior_changed with critical severity for stale automatic-refresh claims', async () => {
    await withTempDir(async (tmpDir) => {
      await writeFile(
        path.join(tmpDir, 'README.md'),
        'Authentication tokens refresh automatically 5 minutes before expiry.\n',
        'utf8',
      );
      await writeFile(
        path.join(tmpDir, 'auth.ts'),
        [
          'export function refreshToken(): string {',
          "  return 'ok';",
          '}',
        ].join('\n'),
        'utf8',
      );

      const construction = createStaleDocumentationSensorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ paths: [tmpDir], docTypes: ['readme', 'jsdoc'] }),
      );

      const match = output.staleEntries.find((entry) => entry.stalenessType === 'behavior_changed');
      expect(match).toBeDefined();
      expect(match?.severity).toBe('critical');
      expect(match?.suggestedUpdate?.toLowerCase()).toContain('refreshToken'.toLowerCase());
    });
  });

  it('reports api_changed when JSDoc return type diverges from implementation', async () => {
    await withTempDir(async (tmpDir) => {
      await writeFile(
        path.join(tmpDir, 'profile.ts'),
        [
          '/**',
          ' * @returns {string} The user full name.',
          ' */',
          'export function getUserName() {',
          "  return { firstName: 'A', lastName: 'B' };",
          '}',
        ].join('\n'),
        'utf8',
      );

      const construction = createStaleDocumentationSensorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ paths: [tmpDir], docTypes: ['jsdoc'] }),
      );

      expect(output.staleEntries.some((entry) => entry.stalenessType === 'api_changed')).toBe(true);
    });
  });

  it('returns no stale entries when documentation matches behavior', async () => {
    await withTempDir(async (tmpDir) => {
      await writeFile(
        path.join(tmpDir, 'README.md'),
        'Use refreshToken() explicitly when sessions expire.\n',
        'utf8',
      );
      await writeFile(
        path.join(tmpDir, 'auth.ts'),
        [
          'export function refreshToken(): string {',
          "  return 'ok';",
          '}',
          '',
          'export function handleSessionExpiry(): string {',
          '  return refreshToken();',
          '}',
        ].join('\n'),
        'utf8',
      );

      const construction = createStaleDocumentationSensorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ paths: [tmpDir], docTypes: ['readme', 'jsdoc'] }),
      );

      expect(output.staleEntries).toHaveLength(0);
      expect(output.ghostDocumentation).toHaveLength(0);
    });
  });

  it('detects ghost documentation for deleted or renamed functions', async () => {
    await withTempDir(async (tmpDir) => {
      await writeFile(path.join(tmpDir, 'README.md'), 'Call `legacyAuth()` before request dispatch.\n', 'utf8');
      await writeFile(
        path.join(tmpDir, 'auth.ts'),
        [
          'export function refreshToken(): string {',
          "  return 'ok';",
          '}',
        ].join('\n'),
        'utf8',
      );

      const construction = createStaleDocumentationSensorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ paths: [tmpDir], docTypes: ['readme'] }),
      );

      expect(output.ghostDocumentation.length).toBeGreaterThan(0);
      expect(output.ghostDocumentation.some((entry) => entry.documentedBehavior.includes('legacyAuth'))).toBe(true);
    });
  });

  it('produces concrete suggestedUpdate text rather than generic guidance', async () => {
    await withTempDir(async (tmpDir) => {
      await writeFile(
        path.join(tmpDir, 'README.md'),
        'Authentication tokens refresh automatically every 5 minutes.\n',
        'utf8',
      );
      await writeFile(
        path.join(tmpDir, 'auth.ts'),
        [
          'export function refreshToken(): string {',
          "  return 'ok';",
          '}',
        ].join('\n'),
        'utf8',
      );

      const construction = createStaleDocumentationSensorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ paths: [tmpDir], docTypes: ['readme'] }),
      );

      const suggestion = output.staleEntries[0]?.suggestedUpdate ?? '';
      expect(suggestion.length).toBeGreaterThan(12);
      expect(suggestion.toLowerCase()).not.toContain('update this');
      expect(suggestion).toMatch(/refreshToken\(\)|explicit/i);
    });
  });

  it('updates subscribed live results and marks stale evidence after source changes', async () => {
    await withTempDir(async (tmpDir) => {
      const readmePath = path.join(tmpDir, 'README.md');
      const authPath = path.join(tmpDir, 'auth.ts');

      await writeFile(readmePath, 'Use refreshToken() explicitly when sessions expire.\n', 'utf8');
      await writeFile(
        authPath,
        [
          'export function refreshToken(): string {',
          "  return 'ok';",
          '}',
          '',
          'export function handleSessionExpiry(): string {',
          '  return refreshToken();',
          '}',
        ].join('\n'),
        'utf8',
      );

      const ledger = new TestLedger();
      const live = await createStaleDocumentationLiveResult(
        { paths: [tmpDir], docTypes: ['readme', 'jsdoc'] },
        createContext(ledger),
        { pollIntervalMs: 100 },
      );

      const staleUpdate = Promise.race([
        new Promise<StaleDocumentationSensorOutput>((resolve) => {
          const unsubscribe = live.subscribe((value) => {
            if (value.staleEntries.length > 0) {
              unsubscribe();
              resolve(value);
            }
          });
        }),
        timeoutAfter<StaleDocumentationSensorOutput>(5000, 'timed out waiting for stale live update'),
      ]);

      await writeFile(readmePath, 'Authentication tokens refresh automatically every 5 minutes.\n', 'utf8');

      const updated = await staleUpdate;
      live.stop();

      expect(updated.staleEntries.length).toBeGreaterThan(0);
      expect(
        ledger.entries.some((entry) => {
          const result = typeof entry.payload.result === 'string' ? entry.payload.result : '';
          const details = typeof entry.payload.details === 'string' ? entry.payload.details : '';
          return result === 'refuted' && /stale=[1-9]/.test(details);
        }),
      ).toBe(true);
    });
  });
});
