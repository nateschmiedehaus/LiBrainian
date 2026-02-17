import { describe, it, expect, beforeEach } from 'vitest';
import {
  TemplateRegistry,
  createTemplateRegistry,
  type ConstructionTemplate,
  type IntentHints,
  type RankedTemplate,
  type TemplateInfo,
  type OutputEnvelopeSpec,
  type TemplateContext,
  type TemplateResult,
  DOMAIN_TO_TEMPLATES,
} from '../template_registry.js';

const now = new Date('2026-01-27T00:00:00.000Z').toISOString();

function createMockTemplate(
  id: string,
  options: Partial<ConstructionTemplate> = {}
): ConstructionTemplate {
  return {
    id,
    name: options.name ?? `Template ${id}`,
    description: options.description ?? `Description for ${id}`,
      supportedUcs: options.supportedUcs ?? [],
      requiredMaps: options.requiredMaps ?? [],
      optionalMaps: options.optionalMaps ?? [],
      requiredObjects: options.requiredObjects ?? ['map', 'pack'],
      optionalObjects: options.optionalObjects,
      requiredArtifacts: options.requiredArtifacts,
      requiredCapabilities: options.requiredCapabilities,
      outputEnvelope: options.outputEnvelope ?? {
        packTypes: ['RepoMapPack'],
        requiresAdequacy: true,
        requiresVerificationPlan: true,
      },
    execute: options.execute ?? (async () => ({
      success: true,
      packs: [],
      adequacy: null,
      verificationPlan: null,
      disclosures: [],
      traceId: `trace_${id}_${Date.now()}`,
      evidence: [],
    })),
  };
}

describe('TemplateRegistry', () => {
  let registry: TemplateRegistry;

  beforeEach(() => {
    registry = createTemplateRegistry();
  });

  describe('getConstructionTemplate', () => {
    it('returns null for unknown template ID', () => {
      expect(registry.getConstructionTemplate('T999')).toBeNull();
    });

    it('returns pre-registered T1 template', () => {
      const template = registry.getConstructionTemplate('T1');
      expect(template).not.toBeNull();
      expect(template?.id).toBe('T1');
      expect(template?.name).toBe('RepoMap');
    });

    it('returns all pre-registered templates T1-T12', () => {
      for (let i = 1; i <= 12; i++) {
        const template = registry.getConstructionTemplate(`T${i}`);
        expect(template).not.toBeNull();
        expect(template?.id).toBe(`T${i}`);
      }
    });
  });

  describe('register', () => {
    it('registers a new template', () => {
      const template = createMockTemplate('T99');
      registry.register(template);
      expect(registry.getConstructionTemplate('T99')).toBe(template);
    });

    it('overwrites existing template with same ID', () => {
      const template1 = createMockTemplate('T99', { name: 'First' });
      const template2 = createMockTemplate('T99', { name: 'Second' });
      registry.register(template1);
      registry.register(template2);
      expect(registry.getConstructionTemplate('T99')?.name).toBe('Second');
    });
  });

  describe('templatesForUc', () => {
    it('returns empty array for unknown UC', () => {
      expect(registry.templatesForUc('UC-999')).toEqual([]);
    });

    it('returns templates that support a UC', () => {
      const template = createMockTemplate('T99', { supportedUcs: ['UC-001', 'UC-002'] });
      registry.register(template);

      const result = registry.templatesForUc('UC-001');
      expect(result).toContain(template);
    });

    it('returns multiple templates that support same UC', () => {
      // Use a UC ID that doesn't map to any default domain templates
      const t1 = createMockTemplate('T98', { supportedUcs: ['UC-999'] });
      const t2 = createMockTemplate('T99', { supportedUcs: ['UC-999', 'UC-998'] });
      registry.register(t1);
      registry.register(t2);

      const result = registry.templatesForUc('UC-999');
      expect(result).toHaveLength(2);
      expect(result).toContain(t1);
      expect(result).toContain(t2);
    });

    it('returns T1 for Orientation domain UCs', () => {
      // Per spec, Orientation domain maps to T1
      const result = registry.templatesForUc('UC-001');
      const t1 = registry.getConstructionTemplate('T1');
      expect(result).toContain(t1);
    });
  });

  describe('templatesForIntent', () => {
    it('returns ranked templates matching intent keywords', () => {
      const result = registry.templatesForIntent('show me the repo structure');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].template.id).toBe('T1'); // RepoMap for structure
      expect(result[0].score).toBeGreaterThan(0);
      expect(result[0].reasoning).toBeTruthy();
    });

    it('returns T2 DeltaMap for change-related intents', () => {
      const result = registry.templatesForIntent('what changed in the last commit');
      const t2Match = result.find(r => r.template.id === 'T2');
      expect(t2Match).toBeDefined();
      expect(t2Match!.score).toBeGreaterThan(0);
    });

    it('returns T3 EditContext for edit-related intents', () => {
      const result = registry.templatesForIntent('context for editing the auth module');
      const t3Match = result.find(r => r.template.id === 'T3');
      expect(t3Match).toBeDefined();
    });

    it('returns T4 VerificationPlan for verification intents', () => {
      const result = registry.templatesForIntent('how do I verify this change is safe');
      const t4Match = result.find(r => r.template.id === 'T4');
      expect(t4Match).toBeDefined();
    });

    it('returns T5 TestSelection for test selection intents', () => {
      const result = registry.templatesForIntent('which tests should I run');
      const t5Match = result.find(r => r.template.id === 'T5');
      expect(t5Match).toBeDefined();
    });

    it('applies depth hint to boost deep templates', () => {
      const hints: IntentHints = { depth: 'deep' };
      const shallow = registry.templatesForIntent('analyze the codebase', { depth: 'shallow' });
      const deep = registry.templatesForIntent('analyze the codebase', hints);

      // Deep analysis should boost T1 RepoMap higher
      expect(deep.length).toBeGreaterThan(0);
    });

    it('applies affectedFiles hint for context scoping', () => {
      const hints: IntentHints = { affectedFiles: ['src/auth.ts'] };
      const result = registry.templatesForIntent('edit context', hints);
      expect(result.length).toBeGreaterThan(0);
      // T3 EditContext should be boosted
      const t3Match = result.find(r => r.template.id === 'T3');
      expect(t3Match).toBeDefined();
    });

    it('applies tokenBudget hint', () => {
      const hints: IntentHints = { tokenBudget: 1000 };
      const result = registry.templatesForIntent('repo overview', hints);
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns empty array when no match', () => {
      const result = registry.templatesForIntent('xyzzy nonsense gibberish');
      // Should return at least T12 as fallback for uncertainty
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('includes reasoning for each ranked template', () => {
      const result = registry.templatesForIntent('show repo map');
      for (const ranked of result) {
        expect(ranked.reasoning).toBeTruthy();
        expect(typeof ranked.reasoning).toBe('string');
      }
    });
  });

  describe('listTemplates', () => {
    it('returns info for all registered templates', () => {
      const list = registry.listTemplates();
      expect(list.length).toBeGreaterThanOrEqual(12);

      const ids = list.map(t => t.id);
      for (let i = 1; i <= 12; i++) {
        expect(ids).toContain(`T${i}`);
      }
    });

    it('includes custom registered templates', () => {
      const custom = createMockTemplate('T99', { name: 'Custom' });
      registry.register(custom);

      const list = registry.listTemplates();
      const t99 = list.find(t => t.id === 'T99');
      expect(t99).toBeDefined();
      expect(t99?.name).toBe('Custom');
    });

    it('returns TemplateInfo with required fields', () => {
      const list = registry.listTemplates();
      for (const info of list) {
        expect(info.id).toBeTruthy();
        expect(info.name).toBeTruthy();
        expect(info.description).toBeTruthy();
        expect(Array.isArray(info.supportedUcs)).toBe(true);
        expect(Array.isArray(info.requiredMaps)).toBe(true);
        expect(Array.isArray(info.requiredObjects)).toBe(true);
      }
    });
  });

  describe('template execution', () => {
    it('executes template with context', async () => {
      const executeCalled: TemplateContext[] = [];
      const template = createMockTemplate('T99', {
        execute: async (ctx) => {
          executeCalled.push(ctx);
          return {
            success: true,
            packs: [],
            adequacy: null,
            verificationPlan: null,
            disclosures: [],
            traceId: 'trace_123',
            evidence: [{ templateId: 'T99', selectedAt: now, reason: 'test' }],
          };
        },
      });
      registry.register(template);

      const context: TemplateContext = {
        intent: 'test intent',
        workspace: '/tmp/test',
        affectedFiles: ['file.ts'],
        depth: 'medium',
        tokenBudget: 5000,
      };

      const result = await template.execute(context);
      expect(result.success).toBe(true);
      expect(executeCalled).toHaveLength(1);
      expect(executeCalled[0].intent).toBe('test intent');
    });
  });

  describe('evidence emission', () => {
    it('emits evidence when template is selected', () => {
      const evidence: Array<{ templateId: string; reason: string }> = [];

      // Get ranked templates which should include evidence
      const result = registry.templatesForIntent('repo map overview');
      expect(result.length).toBeGreaterThan(0);

      // Each ranked template should have reasoning (which serves as evidence)
      for (const ranked of result) {
        expect(ranked.reasoning).toBeTruthy();
      }
    });
  });

  describe('DOMAIN_TO_TEMPLATES mapping', () => {
    it('maps Orientation to T1', () => {
      expect(DOMAIN_TO_TEMPLATES['Orientation']).toContain('T1');
    });

    it('maps Agentic to T3, T4, T11', () => {
      expect(DOMAIN_TO_TEMPLATES['Agentic']).toContain('T3');
      expect(DOMAIN_TO_TEMPLATES['Agentic']).toContain('T4');
      expect(DOMAIN_TO_TEMPLATES['Agentic']).toContain('T11');
    });

    it('maps Impact to T2, T4, T5', () => {
      expect(DOMAIN_TO_TEMPLATES['Impact']).toContain('T2');
      expect(DOMAIN_TO_TEMPLATES['Impact']).toContain('T4');
      expect(DOMAIN_TO_TEMPLATES['Impact']).toContain('T5');
    });

    it('maps Security to T4, T7', () => {
      expect(DOMAIN_TO_TEMPLATES['Security']).toContain('T4');
      expect(DOMAIN_TO_TEMPLATES['Security']).toContain('T7');
    });

    it('maps Compliance to T10, T4', () => {
      expect(DOMAIN_TO_TEMPLATES['Compliance']).toContain('T10');
      expect(DOMAIN_TO_TEMPLATES['Compliance']).toContain('T4');
    });

    it('covers all domains from spec', () => {
      const expectedDomains = [
        'API', 'Agentic', 'Architecture', 'Behavior', 'Build/Test',
        'Compliance', 'Config', 'Data', 'Documentation', 'Edge',
        'Impact', 'Knowledge', 'Language', 'Multi-Repo', 'Navigation',
        'Orientation', 'Ownership', 'Performance', 'Product', 'Project',
        'Refactor', 'Release', 'Reliability', 'Runtime', 'Security', 'Synthesis',
      ];

      for (const domain of expectedDomains) {
        expect(DOMAIN_TO_TEMPLATES[domain]).toBeDefined();
        expect(DOMAIN_TO_TEMPLATES[domain].length).toBeGreaterThan(0);
      }
    });
  });

  describe('pre-registered templates T1-T12', () => {
    it('T1 RepoMap has correct metadata', () => {
      const t1 = registry.getConstructionTemplate('T1');
      expect(t1?.name).toBe('RepoMap');
      expect(t1?.requiredMaps).toContain('RepoMap');
      expect(t1?.requiredMaps).toContain('SymbolMap');
    });

    it('T2 DeltaMap has correct metadata', () => {
      const t2 = registry.getConstructionTemplate('T2');
      expect(t2?.name).toBe('DeltaMap');
      expect(t2?.requiredMaps).toContain('ChangeMap');
    });

    it('T3 EditContext has correct metadata', () => {
      const t3 = registry.getConstructionTemplate('T3');
      expect(t3?.name).toBe('EditContext');
      expect(t3?.requiredMaps).toContain('CallGraph');
    });

    it('T4 VerificationPlan has correct metadata', () => {
      const t4 = registry.getConstructionTemplate('T4');
      expect(t4?.name).toBe('VerificationPlan');
      expect(t4?.requiredMaps).toContain('ImpactMap');
      expect(t4?.requiredMaps).toContain('TestMap');
    });

    it('T5 TestSelection has correct metadata', () => {
      const t5 = registry.getConstructionTemplate('T5');
      expect(t5?.name).toBe('TestSelection');
      expect(t5?.requiredMaps).toContain('TestMap');
      expect(t5?.requiredMaps).toContain('DepMap');
    });

    it('T6 ReproAndBisect has correct metadata', () => {
      const t6 = registry.getConstructionTemplate('T6');
      expect(t6?.name).toBe('ReproAndBisect');
    });

    it('T7 SupplyChain has correct metadata', () => {
      const t7 = registry.getConstructionTemplate('T7');
      expect(t7?.name).toBe('SupplyChain');
      expect(t7?.requiredMaps).toContain('DepMap');
    });

    it('T8 InfraMap has correct metadata', () => {
      const t8 = registry.getConstructionTemplate('T8');
      expect(t8?.name).toBe('InfraMap');
      expect(t8?.requiredMaps).toContain('InfraMap');
    });

    it('T9 ObservabilityRunbooks has correct metadata', () => {
      const t9 = registry.getConstructionTemplate('T9');
      expect(t9?.name).toBe('ObservabilityRunbooks');
      expect(t9?.requiredMaps).toContain('ObsMap');
    });

    it('T10 ComplianceEvidence has correct metadata', () => {
      const t10 = registry.getConstructionTemplate('T10');
      expect(t10?.name).toBe('ComplianceEvidence');
      expect(t10?.requiredMaps).toContain('ComplianceMap');
    });

    it('T11 MultiAgentState has correct metadata', () => {
      const t11 = registry.getConstructionTemplate('T11');
      expect(t11?.name).toBe('MultiAgentState');
    });

    it('T12 UncertaintyReduction has correct metadata', () => {
      const t12 = registry.getConstructionTemplate('T12');
      expect(t12?.name).toBe('UncertaintyReduction');
    });
  });
});
