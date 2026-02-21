import { describe, expect, it } from 'vitest';
import { createRunDiagnosticsScopeConstruction } from '../run_diagnostics_scope_construction.js';

describe('run diagnostics scope construction', () => {
  it('emits a prioritized minimal fix queue with client-repo context', async () => {
    const construction = createRunDiagnosticsScopeConstruction();
    const result = await construction.execute({
      repositoryRole: 'client',
      baselineIssueRefs: [{ pattern: 'known flaky', issue: '#999' }],
      commandResults: [
        {
          command: 'npm test -- --run',
          exitCode: 1,
          stderr: '/bin/bash: librainian-update: command not found\nFAIL src/foo.test.ts',
        },
      ],
    });

    expect(result.kind).toBe('RunDiagnosticsScopeResult.v1');
    expect(result.report.overallVerdict).toBe('must_fix_now');
    expect(result.report.fixQueue[0]?.priority).toBe('critical');
    expect(result.report.fixQueue[0]?.category).toBe('missing_command');
    expect(result.report.repositoryRole).toBe('client');
  });
});
