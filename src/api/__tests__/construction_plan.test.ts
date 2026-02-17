import { describe, it, expect } from 'vitest';
import { buildConstructionPlan } from '../construction_plan.js';

describe('buildConstructionPlan', () => {
  it('selects template based on UC mapping', async () => {
    const query = {
      intent: 'overview',
      depth: 'L1' as const,
      ucRequirements: { ucIds: ['UC-001'] },
    };

    const { plan, disclosures } = await buildConstructionPlan(query, process.cwd());
    expect(plan.source).toBe('uc');
    expect(plan.templateId).toBe('T1');
    expect(disclosures.some((d) => d.includes('uc_domain_missing'))).toBe(false);
  });

  it('selects template based on intent when no UC provided', async () => {
    const query = {
      intent: 'what changed in the last commit',
      depth: 'L1' as const,
    };

    const { plan } = await buildConstructionPlan(query, process.cwd());
    expect(plan.source).toBe('intent');
    expect(plan.templateId).toBe('T2');
    expect(plan.requiredMaps).toEqual(expect.arrayContaining(['ChangeMap', 'FreshnessCursor']));
    expect(plan.requiredCapabilities).toEqual(expect.arrayContaining(['tool:git']));
    expect(plan.rankedCandidates?.length).toBeGreaterThan(0);
    expect(plan.rankedCandidates?.[0]?.templateId).toBe('T2');
    expect(plan.selectionReason).toContain('T2');
  });

  it('discloses mismatched UC domains', async () => {
    const query = {
      intent: 'mixed request',
      depth: 'L1' as const,
      ucRequirements: { ucIds: ['UC-001', 'UC-151'] },
    };

    const { disclosures } = await buildConstructionPlan(query, process.cwd());
    expect(disclosures.some((d) => d.includes('uc_domain_mismatch'))).toBe(true);
  });

  it('records ranked UC candidates and selected requirements', async () => {
    const query = {
      intent: 'stabilize and verify release',
      depth: 'L1' as const,
      ucRequirements: { ucIds: ['UC-151', 'UC-161'] },
    };

    const { plan } = await buildConstructionPlan(query, process.cwd());
    expect(plan.source).toBe('uc');
    expect(plan.rankedCandidates?.length).toBeGreaterThan(0);
    expect(plan.rankedCandidates?.[0]?.templateId).toBe(plan.templateId);
    expect(plan.selectionReason).toContain(plan.templateId);
    expect(plan.requiredMaps).toBeDefined();
    expect(plan.requiredObjects).toBeDefined();
  });
});
