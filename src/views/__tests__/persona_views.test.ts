import { describe, expect, it } from 'vitest';
import { createEmptyKnowledge } from '../../knowledge/universal_types.js';
import { projectForPersona } from '../persona_views.js';

function getMetricValue(
  metrics: Array<{ name: string; value: string | number }>,
  name: string
): string | number | undefined {
  return metrics.find((metric) => metric.name === name)?.value;
}

describe('persona views risk score presentation', () => {
  it('shows N/A when risk score is unknown (null)', () => {
    const knowledge = createEmptyKnowledge('k-1', 'normalize', 'function', 'src/utils/normalize.ts', 10);

    const managerView = projectForPersona(knowledge, 'manager');
    const securityView = projectForPersona(knowledge, 'security');

    expect(getMetricValue(managerView.keyMetrics, 'Risk Score')).toBe('N/A');
    expect(getMetricValue(securityView.keyMetrics, 'Risk Score')).toBe('N/A');
    expect(managerView.summary).toContain('Risk: N/A');
    expect(securityView.summary).toContain('Risk N/A');
  });

  it('still shows 0/10 when risk score is explicitly analyzed as zero', () => {
    const knowledge = createEmptyKnowledge('k-2', 'safeOp', 'function', 'src/utils/safe.ts', 20);
    knowledge.security.riskScore = {
      overall: 0,
      confidentiality: 0,
      integrity: 0,
      availability: 0,
    };

    const managerView = projectForPersona(knowledge, 'manager');
    const securityView = projectForPersona(knowledge, 'security');

    expect(getMetricValue(managerView.keyMetrics, 'Risk Score')).toBe('0/10');
    expect(getMetricValue(securityView.keyMetrics, 'Risk Score')).toBe('0/10');
  });
});
