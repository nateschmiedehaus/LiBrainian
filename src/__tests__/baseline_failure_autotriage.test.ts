import { describe, expect, it } from 'vitest';
import {
  buildBaselineFailureTriage,
  buildDeferredIssueCandidate,
  type BaselineFailureSignal,
} from '../evaluation/baseline_failure_autotriage.js';

describe('baseline failure autotriage', () => {
  it('classifies out-of-scope failures as defer_non_scope and keeps diagnostics separate', () => {
    const log = [
      'stderr | src/cli/commands/__tests__/query.test.ts > queryCommand LLM resolution > disables synthesis when no LLM config is available',
      'LLM not configured; running without synthesis. Provide --llm-provider/--llm-model or bootstrap with providers to enable.',
      ' FAIL  src/mcp/__tests__/schema.test.ts > schema coverage > exports all tools',
      'AssertionError: expected 3 to be 4',
    ].join('\n');

    const triage = buildBaselineFailureTriage(log, {
      scopePaths: ['src/api/change_plan_validator.ts'],
    });

    expect(triage.summary.mustFixNow).toBe(0);
    expect(triage.summary.deferNonScope).toBe(1);
    expect(triage.summary.expectedDiagnostic).toBeGreaterThan(0);
    expect(triage.deferNonScope[0]?.filePath).toBe('src/mcp/__tests__/schema.test.ts');
  });

  it('classifies in-scope failures as must_fix_now', () => {
    const log = [
      ' FAIL  src/mcp/__tests__/schema.test.ts > schema coverage > exports all tools',
      'AssertionError: expected 3 to be 4',
    ].join('\n');

    const triage = buildBaselineFailureTriage(log, {
      scopePaths: ['src/mcp/__tests__/schema.test.ts'],
    });

    expect(triage.summary.mustFixNow).toBe(1);
    expect(triage.summary.deferNonScope).toBe(0);
    expect(triage.mustFixNow[0]?.filePath).toBe('src/mcp/__tests__/schema.test.ts');
  });

  it('classifies TypeScript errors outside scope as defer_non_scope', () => {
    const log = 'src/mcp/server.ts(42,5): error TS2304: Cannot find name \'foo\'.';
    const triage = buildBaselineFailureTriage(log, {
      scopePaths: ['src/api/query.ts'],
    });

    expect(triage.summary.deferNonScope).toBe(1);
    expect(triage.deferNonScope[0]?.sourceKind).toBe('build_error');
    expect(triage.deferNonScope[0]?.filePath).toBe('src/mcp/server.ts');
  });

  it('builds deferred issue candidate with stable marker and follow-up actions', () => {
    const signal: BaselineFailureSignal = {
      key: 'build-error-src-mcp-server-ts',
      verdict: 'defer_non_scope',
      sourceKind: 'build_error',
      severity: 'high',
      summary: 'TypeScript error outside active scope',
      detail: 'src/mcp/server.ts(42,5): error TS2304: Cannot find name \'foo\'.',
      filePath: 'src/mcp/server.ts',
      evidenceLines: ['src/mcp/server.ts(42,5): error TS2304: Cannot find name \'foo\'.'],
      suggestedCommands: ['npm run build'],
    };

    const candidate = buildDeferredIssueCandidate(signal, {
      scopePaths: ['src/api/query.ts'],
      sourceLogPath: 'state/logs/build.log',
      issueMilestone: 'M0: Dogfood-Ready',
    });

    expect(candidate.marker).toBe('[baseline-failure:build-error-src-mcp-server-ts]');
    expect(candidate.title).toContain('TypeScript error outside active scope');
    expect(candidate.body).toContain('Immediate Follow-Up');
    expect(candidate.body).toContain('state/logs/build.log');
    expect(candidate.labels).toContain('priority: high');
  });
});
