import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CliLlmService } from '../cli_llm_service.js';
import { resolvePrivacyAuditLogPath } from '../../security/privacy_audit.js';

describe('CliLlmService privacy mode', () => {
  const originalPrivacyMode = process.env.LIBRARIAN_PRIVACY_MODE;
  const originalWorkspaceRoot = process.env.LIBRARIAN_WORKSPACE_ROOT;

  afterEach(() => {
    if (typeof originalPrivacyMode === 'string') process.env.LIBRARIAN_PRIVACY_MODE = originalPrivacyMode;
    else delete process.env.LIBRARIAN_PRIVACY_MODE;
    if (typeof originalWorkspaceRoot === 'string') process.env.LIBRARIAN_WORKSPACE_ROOT = originalWorkspaceRoot;
    else delete process.env.LIBRARIAN_WORKSPACE_ROOT;
  });

  it('blocks remote LLM calls when strict privacy mode is enabled and writes an audit event', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-privacy-llm-'));
    process.env.LIBRARIAN_PRIVACY_MODE = 'strict';
    process.env.LIBRARIAN_WORKSPACE_ROOT = workspace;
    const service = new CliLlmService();

    try {
      await expect(
        service.chat({
          provider: 'claude',
          modelId: 'claude-sonnet-4',
          messages: [{ role: 'user', content: 'summarize this code' }],
        }),
      ).rejects.toThrow(
        'Privacy mode is enabled. Configure a local embedding model: `LIBRARIAN_EMBEDDING_MODEL=onnx:all-MiniLM-L6-v2`.',
      );

      const logPath = resolvePrivacyAuditLogPath(workspace);
      const raw = await fs.readFile(logPath, 'utf8');
      const lines = raw.trim().split(/\r?\n/);
      expect(lines.length).toBeGreaterThan(0);
      const latest = JSON.parse(lines[lines.length - 1] ?? '{}') as {
        op?: string;
        status?: string;
        contentSent?: boolean;
      };
      expect(latest.op).toBe('synthesize');
      expect(latest.status).toBe('blocked');
      expect(latest.contentSent).toBe(false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
