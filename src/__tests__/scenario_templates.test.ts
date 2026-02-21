import { describe, it, expect } from 'vitest';
import { resolveScenarioGuidance } from '../integration/scenario_templates.js';
import { formatLiBrainianContext, type LiBrainianContext } from '../integration/wave0_integration.js';

describe('Scenario templates', () => {
  it('classifies security review intents', () => {
    const guidance = resolveScenarioGuidance({
      intent: 'Map the attack surface for auth and secrets',
      taskType: 'review',
    });

    expect(guidance.kind).toBe('security_review');
    expect(guidance.checklist.length).toBeGreaterThan(0);
  });

  it('formats scenario playbook into librainian context', () => {
    const guidance = resolveScenarioGuidance({
      intent: 'Investigate login latency regression',
      taskType: 'review',
      relatedFiles: ['src/auth/login.ts'],
      coverageGaps: ['No profiling data available'],
    });

    const context: LiBrainianContext = {
      intent: 'Investigate login latency regression',
      taskType: 'review',
      summary: 'Login flow shows elevated latency.',
      keyFacts: ['Latency spike after commit abc123'],
      snippets: [],
      relatedFiles: ['src/auth/login.ts'],
      patterns: [],
      gotchas: [],
      confidence: 0.72,
      drillDownHints: ['Capture trace spans for login flow'],
      methodHints: [],
      packIds: ['pack-1'],
      scenario: guidance,
    };

    const formatted = formatLiBrainianContext(context);
    expect(formatted).toContain('Scenario Playbook');
    expect(formatted).toContain(guidance.label);
    expect(formatted).toContain('Evidence Focus:');
  });
});
