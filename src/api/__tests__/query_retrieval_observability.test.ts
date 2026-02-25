import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { LibrarianStorage } from '../../storage/types.js';
import {
  DEFAULT_MAX_ESCALATION_DEPTH,
  logRetrievalConfidenceObservation,
  logRetrievalEscalationEvent,
  resolveMaxEscalationDepth,
  resolveWorkspaceRoot,
} from '../query_retrieval_observability.js';

function createStorage(overrides: Partial<LibrarianStorage> = {}): LibrarianStorage {
  return {
    getMetadata: async () => null,
    appendRetrievalConfidenceLog: async () => {},
    ...overrides,
  } as unknown as LibrarianStorage;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true });
  }));
  tempDirs.length = 0;
});

describe('query retrieval observability helpers', () => {
  it('prefers metadata workspace when resolving workspace root', async () => {
    const storage = createStorage({
      getMetadata: async () => ({ workspace: '/tmp/workspace' } as Awaited<ReturnType<LibrarianStorage['getMetadata']>>),
    });

    await expect(resolveWorkspaceRoot(storage)).resolves.toBe('/tmp/workspace');
  });

  it('falls back to cwd when metadata lookup fails', async () => {
    const storage = createStorage({
      getMetadata: async () => {
        throw new Error('metadata unavailable');
      },
    });

    await expect(resolveWorkspaceRoot(storage)).resolves.toBe(process.cwd());
  });

  it('normalizes override max escalation depth', async () => {
    await expect(resolveMaxEscalationDepth('/unused', 9)).resolves.toBe(8);
    await expect(resolveMaxEscalationDepth('/unused', -3)).resolves.toBe(0);
    await expect(resolveMaxEscalationDepth('/unused', 2.9)).resolves.toBe(2);
  });

  it('reads max escalation depth from config files', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-escalation-'));
    tempDirs.push(workspace);
    await fs.writeFile(
      path.join(workspace, 'librainian.config.json'),
      JSON.stringify({ retrieval: { max_escalation_depth: 5 } }),
      'utf8',
    );

    await expect(resolveMaxEscalationDepth(workspace)).resolves.toBe(5);
  });

  it('uses default escalation depth when no config or override is available', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-escalation-default-'));
    tempDirs.push(workspace);

    await expect(resolveMaxEscalationDepth(workspace)).resolves.toBe(DEFAULT_MAX_ESCALATION_DEPTH);
  });

  it('records confidence observations to storage and jsonl log', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-observation-'));
    tempDirs.push(workspace);
    const appendRetrievalConfidenceLog = vi.fn(async () => undefined);
    const storage = createStorage({ appendRetrievalConfidenceLog });

    await logRetrievalConfidenceObservation(storage, workspace, {
      queryHash: 'q-1',
      intent: 'find auth flow',
      confidenceScore: 0.91234,
      retrievalEntropy: 1.6789,
      returnedPackIds: ['pack-1', 'pack-2'],
      timestamp: '2026-01-01T00:00:00.000Z',
      routedStrategy: 'semantic-first',
    });

    expect(appendRetrievalConfidenceLog).toHaveBeenCalledTimes(1);
    const payload = appendRetrievalConfidenceLog.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.confidenceScore).toBe(0.9123);
    expect(payload.retrievalEntropy).toBe(1.6789);

    const logPath = path.join(workspace, '.librarian', 'retrieval_confidence_log.jsonl');
    const raw = await fs.readFile(logPath, 'utf8');
    const record = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(record.query_hash).toBe('q-1');
    expect(record.routed_strategy).toBe('semantic-first');
  });

  it('records escalation event through confidence observation pathway', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-escalation-log-'));
    tempDirs.push(workspace);
    const appendRetrievalConfidenceLog = vi.fn(async () => undefined);
    const storage = createStorage({ appendRetrievalConfidenceLog });

    await logRetrievalEscalationEvent(storage, workspace, {
      queryHash: 'q-2',
      intent: 'trace checkout bug',
      fromDepth: 'L1',
      toDepth: 'L2',
      totalConfidence: 0.25,
      retrievalEntropy: 2.1,
      reasons: ['confidence_below_0_4_and_entropy_above_1_5'],
      attempt: 1,
      maxEscalationDepth: 2,
      returnedPackIds: ['pack-3'],
    });

    expect(appendRetrievalConfidenceLog).toHaveBeenCalledTimes(1);
    const payload = appendRetrievalConfidenceLog.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.escalationReason).toBe('confidence_below_0_4_and_entropy_above_1_5');
    expect(payload.fromDepth).toBe('L1');
    expect(payload.toDepth).toBe('L2');
  });

  it('never throws when storage/file logging fails', async () => {
    const workspace = path.join('/nonexistent-root', `librainian-${Date.now()}`);
    const storage = createStorage({
      appendRetrievalConfidenceLog: async () => {
        throw new Error('storage write failed');
      },
    });

    await expect(logRetrievalConfidenceObservation(storage, workspace, {
      queryHash: 'q-3',
      confidenceScore: 0.5,
      retrievalEntropy: 1,
      returnedPackIds: [],
      timestamp: '2026-01-01T00:00:00.000Z',
    })).resolves.toBeUndefined();
  });
});
