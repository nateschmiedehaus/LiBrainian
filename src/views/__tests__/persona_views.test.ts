import { describe, expect, it } from 'vitest';
import { createEmptyKnowledge } from '../../knowledge/universal_types.js';
import { getPersonaSummary, projectForPersona } from '../persona_views.js';

describe('persona risk score presentation', () => {
  it('renders null risk score as not analyzed for manager and security personas', () => {
    const knowledge = createEmptyKnowledge(
      'k-risk',
      'riskyFunction',
      'function',
      '/tmp/risky.ts',
      12,
    );
    knowledge.security.riskScore = null;

    const managerView = projectForPersona(knowledge, 'manager');
    const securityView = projectForPersona(knowledge, 'security');

    const managerRiskMetric = managerView.keyMetrics.find((metric) => metric.name === 'Risk Score');
    const securityRiskMetric = securityView.keyMetrics.find((metric) => metric.name === 'Risk Score');

    expect(managerRiskMetric?.value).toBe('not analyzed');
    expect(securityRiskMetric?.value).toBe('not analyzed');
    expect(getPersonaSummary(knowledge, 'manager')).toContain('Risk: not analyzed');
    expect(getPersonaSummary(knowledge, 'security')).toContain('Risk not analyzed');
  });
});
