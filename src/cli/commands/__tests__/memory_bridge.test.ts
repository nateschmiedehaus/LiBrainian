import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MemoryBridgeDaemon } from '../../../memory_bridge/daemon.js';
import { memoryBridgeCommand } from '../memory_bridge.js';

describe('memoryBridgeCommand', () => {
  it('reports memory-bridge status from state file', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-memory-bridge-cli-'));
    const memoryFilePath = path.join(workspace, '.openclaw', 'memory', 'MEMORY.md');

    try {
      const bridge = new MemoryBridgeDaemon({ workspaceRoot: workspace });
      await bridge.harvestToMemory({
        memoryFilePath,
        source: 'harvest',
        claims: [
          {
            claimId: 'clm_1',
            claim: 'Auth middleware lives in app/middleware/auth.ts',
            workspace,
            sessionId: 'sess_cli',
            tags: ['auth'],
            evidence: [],
            confidence: 0.85,
            createdAt: new Date().toISOString(),
          },
        ],
      });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let capturedOutputs: string[] = [];
      try {
        await memoryBridgeCommand({
          workspace,
          args: ['status'],
          rawArgs: ['memory-bridge', 'status', '--memory-file', memoryFilePath, '--json'],
        });
        capturedOutputs = logSpy.mock.calls
          .map((call) => call.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' '));
      } finally {
        logSpy.mockRestore();
      }

      const jsonPayload = capturedOutputs.find((value) => value.includes('"memoryFilePath"'));
      if (jsonPayload) {
        const parsed = JSON.parse(jsonPayload);
        expect(parsed.totalEntries).toBeGreaterThanOrEqual(1);
        expect(parsed.activeEntries).toBeGreaterThanOrEqual(1);
        expect(parsed.memoryFilePath).toBe(memoryFilePath);
      } else {
        expect(capturedOutputs.some((value) => value.includes(`Memory file: ${memoryFilePath}`))).toBe(true);
        const totalLine = capturedOutputs.find((value) => value.startsWith('Total entries: '));
        const activeLine = capturedOutputs.find((value) => value.startsWith('Active entries: '));
        expect(totalLine).toBeTruthy();
        expect(activeLine).toBeTruthy();
        expect(Number(totalLine!.replace('Total entries: ', ''))).toBeGreaterThanOrEqual(1);
        expect(Number(activeLine!.replace('Active entries: ', ''))).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
