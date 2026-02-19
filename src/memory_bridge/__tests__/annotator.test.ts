import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendAnnotatedClaims,
  markEvidenceEntriesStale,
} from '../annotator.js';

describe('memory bridge annotator', () => {
  let root: string;
  let memoryFilePath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-memory-bridge-'));
    memoryFilePath = path.join(root, 'MEMORY.md');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes annotated claims and returns line ranges', async () => {
    const result = await appendAnnotatedClaims(memoryFilePath, [
      { claim: 'UserRepository uses CockroachDB', evidenceId: 'ev_mem_1', confidence: 0.88 },
      { claim: 'Auth middleware lives in app/middleware/auth.ts', evidenceId: 'ev_mem_2', confidence: 0.82 },
    ]);

    expect(result.written).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.lineRanges.ev_mem_1).toBeTruthy();
    expect(result.lineRanges.ev_mem_2).toBeTruthy();

    const content = await fs.readFile(memoryFilePath, 'utf8');
    expect(content).toContain('<!-- librainian:ev_mem_1:confidence=0.88 -->');
    expect(content).toContain('<!-- librainian:ev_mem_2:confidence=0.82 -->');
  });

  it('marks existing annotations as stale and appends replacement facts', async () => {
    await appendAnnotatedClaims(memoryFilePath, [
      { claim: 'UserRepository uses PostgreSQL', evidenceId: 'ev_mem_old', confidence: 0.95 },
    ]);

    const staleResult = await markEvidenceEntriesStale(memoryFilePath, [
      {
        evidenceId: 'ev_mem_old',
        reason: 'schema migration detected: CockroachDB',
        replacement: {
          claim: 'UserRepository uses CockroachDB',
          evidenceId: 'ev_mem_new',
          confidence: 0.89,
        },
      },
    ]);

    expect(staleResult.updated).toBe(1);
    expect(staleResult.replacementsWritten).toBe(1);

    const content = await fs.readFile(memoryFilePath, 'utf8');
    expect(content).toContain('<!-- STALE:ev_mem_old reason="schema migration detected: CockroachDB"');
    expect(content).toContain('<!-- librainian:ev_mem_new:confidence=0.89 -->');
  });
});
