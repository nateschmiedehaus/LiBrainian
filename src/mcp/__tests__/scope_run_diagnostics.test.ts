import { describe, expect, it } from 'vitest';
import { createLiBrainianMCPServer } from '../server.js';

describe('MCP scope_run_diagnostics tool', () => {
  it('classifies mixed output and returns structured remediation summary', async () => {
    const server = await createLiBrainianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const result = await (server as any).callTool('scope_run_diagnostics', {
      repositoryRole: 'client',
      commandResults: [
        {
          command: 'npm test -- --run',
          exitCode: 0,
          stderr: 'LLM not configured; running without synthesis.',
        },
        {
          command: 'git commit -m "test"',
          exitCode: 127,
          stderr: '/bin/bash: librainian-update: command not found',
        },
      ],
    });

    const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
    expect(payload.success).toBe(true);
    expect(payload.report.overallVerdict).toBe('must_fix_now');
    expect(Array.isArray(payload.report.fixQueue)).toBe(true);
    expect(payload.report.fixQueue[0]?.category).toBe('missing_command');
  });

  it('emits deferred issue candidates when baseline mappings omit issue ids', async () => {
    const server = await createLiBrainianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const result = await (server as any).callTool('scope_run_diagnostics', {
      repositoryRole: 'client',
      baselineIssueRefs: [{ pattern: 'confidence_calibration_validation.test.ts' }],
      commandResults: [
        {
          command: 'npm test -- --run',
          exitCode: 1,
          stderr: 'FAIL src/__tests__/confidence_calibration_validation.test.ts > ECE 0.183 > expected 0.15',
        },
      ],
    });

    const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
    expect(payload.success).toBe(true);
    expect(payload.report.overallVerdict).toBe('defer_non_scope');
    expect(payload.report.deferIssueQueue[0]?.action).toBe('create_or_update_issue');
  });
});
