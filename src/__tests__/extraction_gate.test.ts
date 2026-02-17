import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { checkExtractionSnapshot } from '../api/extraction_gate.js';
import { SqliteEvidenceLedger, createSessionId } from '../epistemics/evidence_ledger.js';

async function withTempWorkspace<T>(fn: (workspaceRoot: string) => Promise<T>): Promise<T> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-extraction-gate-'));
  try {
    return await fn(workspaceRoot);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writeGateFile(workspaceRoot: string, payload: unknown): Promise<string> {
  const gatesPath = path.join(workspaceRoot, 'docs', 'librarian', 'GATES.json');
  await fs.mkdir(path.dirname(gatesPath), { recursive: true });
  await fs.writeFile(gatesPath, JSON.stringify(payload, null, 2), 'utf8');
  return gatesPath;
}

describe('checkExtractionSnapshot', () => {
  it('discloses when gate metadata is missing', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const snapshot = await checkExtractionSnapshot({ workspaceRoot });
      expect(snapshot.gatesPath).toBeNull();
      expect(snapshot.boundaryReady).toBe(false);
      expect(snapshot.disclosures.some((entry) => entry.includes('unverified_by_trace(extraction_missing)'))).toBe(true);
    });
  });

  it('can suppress missing-metadata disclosure for external repos', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const snapshot = await checkExtractionSnapshot({ workspaceRoot, discloseMissingMetadata: false });
      expect(snapshot.gatesPath).toBeNull();
      expect(snapshot.boundaryReady).toBe(false);
      expect(snapshot.disclosures).toEqual([]);
    });
  });

  it('reports boundary readiness and repo extraction status', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await writeGateFile(workspaceRoot, {
        version: '2.1.0',
        tasks: {
          'layer1.noWave0Imports': { status: 'pass' },
          'layer1.noDirectImports': { status: 'pass' },
          'layer1.standaloneTests': { status: 'pass' },
          'layer1.extractionPrereqs': { status: 'pass' },
          'layer1.repoExtraction': { status: 'not_started' },
        },
      });

      const snapshot = await checkExtractionSnapshot({ workspaceRoot });
      expect(snapshot.boundaryReady).toBe(true);
      expect(snapshot.repoExtractionComplete).toBe(false);
      expect(snapshot.disclosures.some((entry) => entry.includes('layer1.repoExtraction'))).toBe(true);
    });
  });

  it('records an evidence ledger entry when provided', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await writeGateFile(workspaceRoot, {
        version: '2.1.0',
        tasks: {
          'layer1.noWave0Imports': { status: 'pass' },
          'layer1.noDirectImports': { status: 'pass' },
          'layer1.standaloneTests': { status: 'pass' },
          'layer1.extractionPrereqs': { status: 'pass' },
          'layer1.repoExtraction': { status: 'not_started' },
        },
      });

      const ledger = new SqliteEvidenceLedger(':memory:');
      await ledger.initialize();
      const sessionId = createSessionId('sess_extraction_gate_test');

      await checkExtractionSnapshot({ workspaceRoot, ledger, sessionId });

      const entries = await ledger.query({ kinds: ['tool_call'], sessionId });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.payload).toMatchObject({
        toolName: 'extraction_gate',
      });

      await ledger.close();
    });
  });
});
