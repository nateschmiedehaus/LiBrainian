import { describe, expect, it } from 'vitest';
import {
  classifyRunDiagnosticsScope,
  type RunDiagnosticsScopeInput,
} from '../run_diagnostics_scope.js';

describe('run diagnostics scope classifier', () => {
  it('classifies noisy stderr on passing runs as expected diagnostics', () => {
    const input: RunDiagnosticsScopeInput = {
      repositoryRole: 'core',
      commandResults: [
        {
          command: 'npm test -- --run src/cli/commands/__tests__/query.test.ts',
          exitCode: 0,
          stderr: [
            'stderr | src/cli/commands/__tests__/query.test.ts > query command > disables synthesis when no LLM config is available',
            'LLM not configured; running without synthesis. Provide --llm-provider/--llm-model or bootstrap with providers to enable.',
          ].join('\n'),
        },
      ],
    };

    const result = classifyRunDiagnosticsScope(input);
    expect(result.overallVerdict).toBe('expected_diagnostic');
    expect(result.mustFixNow.length).toBe(0);
    expect(result.expectedDiagnostics.length).toBeGreaterThan(0);
  });

  it('promotes command-not-found failures to must_fix_now with actionable queue items', () => {
    const input: RunDiagnosticsScopeInput = {
      repositoryRole: 'core',
      commandResults: [
        {
          command: 'git commit -m "test"',
          exitCode: 127,
          stderr: '/bin/bash: librainian-update: command not found',
        },
      ],
    };

    const result = classifyRunDiagnosticsScope(input);
    expect(result.overallVerdict).toBe('must_fix_now');
    expect(result.mustFixNow.length).toBe(1);
    expect(result.fixQueue[0]?.category).toBe('missing_command');
    expect(result.fixQueue[0]?.priority).toBe('critical');
  });

  it('defers known baseline failures when explicit issue mapping is provided', () => {
    const input: RunDiagnosticsScopeInput = {
      repositoryRole: 'client',
      baselineIssueRefs: [{ pattern: 'confidence_calibration_validation.test.ts', issue: '#701' }],
      commandResults: [
        {
          command: 'npm test -- --run',
          exitCode: 1,
          stderr: 'FAIL src/__tests__/confidence_calibration_validation.test.ts > ECE 0.183 > expected 0.15',
        },
      ],
    };

    const result = classifyRunDiagnosticsScope(input);
    expect(result.overallVerdict).toBe('defer_non_scope');
    expect(result.deferNonScope.length).toBe(1);
    expect(result.deferNonScope[0]?.linkedIssue).toBe('#701');
    expect(result.deferIssueQueue.length).toBe(1);
    expect(result.deferIssueQueue[0]?.action).toBe('link_existing_issue');
    expect(result.deferIssueQueue[0]?.issue).toBe('#701');
  });

  it('creates deferred issue candidates when baseline mappings do not include issue ids', () => {
    const input: RunDiagnosticsScopeInput = {
      repositoryRole: 'client',
      baselineIssueRefs: [{ pattern: 'confidence_calibration_validation.test.ts' }],
      commandResults: [
        {
          command: 'npm test -- --run',
          exitCode: 1,
          stderr: 'FAIL src/__tests__/confidence_calibration_validation.test.ts > ECE 0.183 > expected 0.15',
        },
      ],
    };

    const result = classifyRunDiagnosticsScope(input);
    expect(result.overallVerdict).toBe('defer_non_scope');
    expect(result.deferNonScope.length).toBe(1);
    expect(result.deferNonScope[0]?.linkedIssue).toBeUndefined();
    expect(result.deferIssueQueue.length).toBe(1);
    expect(result.deferIssueQueue[0]?.action).toBe('create_or_update_issue');
    expect(result.deferIssueQueue[0]?.labels).toContain('scope/baseline');
  });

  it('remains deterministic for identical inputs', () => {
    const input: RunDiagnosticsScopeInput = {
      repositoryRole: 'client',
      commandResults: [
        {
          command: 'npm run build',
          exitCode: 2,
          stderr: 'error TS2304: Cannot find name FooBar',
        },
      ],
    };

    const first = classifyRunDiagnosticsScope(input);
    const second = classifyRunDiagnosticsScope(input);
    expect(second).toEqual(first);
  });
});
