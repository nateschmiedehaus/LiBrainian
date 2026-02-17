import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  selectTechniqueCompositions,
  selectTechniqueCompositionsFromStorage,
  compileTechniqueCompositionTemplate,
  compileTechniqueCompositionTemplateFromStorage,
  compileTechniqueCompositionTemplateWithGaps,
  compileTechniqueCompositionTemplateWithGapsFromStorage,
  compileTechniqueCompositionBundle,
  compileTechniqueCompositionBundleFromStorage,
  compileTechniqueBundlesFromIntent,
  compileTechniqueCompositionPrototype,
  planWorkFromComposition,
  planWorkFromCompositionWithContext,
  planWorkFromIntent,
  selectMethods,
} from '../plan_compiler.js';
import { ClosedLoopLearner } from '../learning_loop.js';
import { DEFAULT_TECHNIQUE_COMPOSITIONS } from '../technique_compositions.js';
import { SemanticCompositionSelector } from '../composition_selector.js';
import { ProviderUnavailableError } from '../provider_check.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type { ContextPack, LibrarianResponse, LibrarianVersion } from '../../types.js';
import type { AdequacyReport } from '../difficulty_detectors.js';
import { createTechniqueComposition, createTechniquePrimitive } from '../../strategic/techniques.js';
import { createEpisode } from '../../strategic/episodes.js';
import { saveTechniqueComposition } from '../../state/technique_compositions.js';

type StorageStub = Pick<LibrarianStorage, 'getState' | 'setState'>;

class MockStorage implements StorageStub {
  private state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
}

describe('plan compiler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selects agentic review composition', () => {
    const selections = selectTechniqueCompositions('Please review this change set');
    expect(selections.map((item) => item.id)).toContain('tc_agentic_review_v1');
  });

  it('selects root cause recovery composition', () => {
    const selections = selectTechniqueCompositions('Find the root cause of this failure');
    expect(selections.map((item) => item.id)).toContain('tc_root_cause_recovery');
  });

  it('selects release readiness composition', () => {
    const selections = selectTechniqueCompositions('Prepare a release plan for rollout');
    expect(selections.map((item) => item.id)).toContain('tc_release_readiness');
  });

  it('selects repo rehab triage composition', () => {
    const selections = selectTechniqueCompositions('Repo is legacy debt, need rehab triage');
    expect(selections.map((item) => item.id)).toContain('tc_repo_rehab_triage');
  });

  it('selects performance reliability composition', () => {
    const selections = selectTechniqueCompositions('Performance regression and latency spike');
    expect(selections.map((item) => item.id)).toContain('tc_performance_reliability');
  });

  it('selects security review composition', () => {
    const selections = selectTechniqueCompositions('Security audit of new API surface');
    expect(selections.map((item) => item.id)).toContain('tc_security_review');
  });

  it('selects ux discovery composition', () => {
    const selections = selectTechniqueCompositions('UX discovery for onboarding flow');
    expect(selections.map((item) => item.id)).toContain('tc_ux_discovery');
  });

  it('selects scaling readiness composition', () => {
    const selections = selectTechniqueCompositions('Scaling readiness for throughput and capacity');
    expect(selections.map((item) => item.id)).toContain('tc_scaling_readiness');
  });

  it('selects cross-repo contract drift composition', () => {
    const selections = selectTechniqueCompositions('Cross repo API contract drift before release');
    expect(selections.map((item) => item.id)).toContain('tc_cross_repo_contract_drift');
  });

  it('selects migration safety rollout composition', () => {
    const selections = selectTechniqueCompositions('Risky schema migration rollout with rollback verification');
    expect(selections.map((item) => item.id)).toContain('tc_migration_safety_rollout');
  });

  it('selects incident hotfix governed composition', () => {
    const selections = selectTechniqueCompositions('Incident hotfix with audit trail and minimal blast radius');
    expect(selections.map((item) => item.id)).toContain('tc_incident_hotfix_governed');
  });

  it('returns empty when no keywords match', () => {
    const selections = selectTechniqueCompositions('Draft a friendly status update');
    expect(selections).toHaveLength(0);
  });

  it('uses semantic selection when requested', async () => {
    const storage = new MockStorage();
    const composition = DEFAULT_TECHNIQUE_COMPOSITIONS.find((item) => item.id === 'tc_release_readiness')!;
    vi.spyOn(SemanticCompositionSelector.prototype, 'select').mockResolvedValue([{
      composition,
      matchReason: { type: 'semantic', similarity: 0.9 },
      confidence: 0.9,
      alternatives: [],
    }]);

    const selections = await selectTechniqueCompositionsFromStorage(
      storage as unknown as LibrarianStorage,
      'release prep',
      { selectionMode: 'semantic', useLearning: false }
    );
    expect(selections.map((item) => item.id)).toContain(composition.id);
  });

  it('passes learning signals into semantic selection', async () => {
    const storage = new MockStorage();
    const composition = DEFAULT_TECHNIQUE_COMPOSITIONS.find((item) => item.id === 'tc_release_readiness')!;
    const learningSignals = {
      [composition.id]: { score: 0.8, successRate: 0.9, examples: 12 },
    };
    const selectSpy = vi.spyOn(SemanticCompositionSelector.prototype, 'select').mockResolvedValue([{
      composition,
      matchReason: { type: 'semantic', similarity: 0.9 },
      confidence: 0.9,
      alternatives: [],
    }]);

    await selectTechniqueCompositionsFromStorage(
      storage as unknown as LibrarianStorage,
      'release prep',
      { selectionMode: 'semantic', learningSignals }
    );

    const callOptions = selectSpy.mock.calls[0]?.[1];
    expect(callOptions.learningSignals).toEqual(learningSignals);
  });

  it('merges keyword matches in hybrid mode', async () => {
    const storage = new MockStorage();
    const semanticComposition = DEFAULT_TECHNIQUE_COMPOSITIONS.find((item) => item.id === 'tc_security_review')!;
    vi.spyOn(SemanticCompositionSelector.prototype, 'select').mockResolvedValue([{
      composition: semanticComposition,
      matchReason: { type: 'semantic', similarity: 0.7 },
      confidence: 0.7,
      alternatives: [],
    }]);

    const selections = await selectTechniqueCompositionsFromStorage(
      storage as unknown as LibrarianStorage,
      'Prepare a release plan',
      { selectionMode: 'hybrid', useLearning: false }
    );
    const ids = selections.map((item) => item.id);
    expect(ids).toContain('tc_release_readiness');
    expect(ids).toContain(semanticComposition.id);
  });

  it('falls back to keyword when provider unavailable and fallback enabled', async () => {
    const storage = new MockStorage();
    vi.spyOn(SemanticCompositionSelector.prototype, 'select').mockRejectedValue(
      new ProviderUnavailableError({
        message: 'unverified_by_trace(provider_unavailable): Embedding provider missing',
        missing: ['Embedding: unavailable'],
        suggestion: 'Install embeddings',
      })
    );

    const selections = await selectTechniqueCompositionsFromStorage(
      storage as unknown as LibrarianStorage,
      'release prep',
      { selectionMode: 'semantic', allowKeywordFallback: true, useLearning: false }
    );
    expect(selections.map((item) => item.id)).toContain('tc_release_readiness');
  });

  it('falls back to keyword when semantic returns empty and fallback enabled', async () => {
    const storage = new MockStorage();
    vi.spyOn(SemanticCompositionSelector.prototype, 'select').mockResolvedValue([]);

    const selections = await selectTechniqueCompositionsFromStorage(
      storage as unknown as LibrarianStorage,
      'Prepare a release plan',
      { selectionMode: 'semantic', allowKeywordFallback: true, useLearning: false }
    );
    expect(selections.map((item) => item.id)).toContain('tc_release_readiness');
  });

  it('selects compositions from storage defaults', async () => {
    const storage = new MockStorage();
    const selections = await selectTechniqueCompositionsFromStorage(
      storage as unknown as LibrarianStorage,
      'Prepare a release plan',
      { selectionMode: 'keyword' }
    );
    expect(selections.map((item) => item.id)).toContain('tc_release_readiness');
  });

  it('surfaces learned compositions without keyword matches', async () => {
    const storage = new MockStorage();
    const composition = createTechniqueComposition({
      id: 'tc_custom_compliance',
      name: 'Compliance custom',
      description: 'Custom compliance plan',
      primitiveIds: ['tp_custom_one'],
    });
    await saveTechniqueComposition(storage as unknown as LibrarianStorage, composition);
    const learner = new ClosedLoopLearner(storage as unknown as LibrarianStorage);
    const episode = createEpisode({
      id: 'ep_custom_1',
      type: 'learning',
      context: {
        environment: 'librarian.test',
        state: { intent: 'compliance checks' },
      },
      outcome: {
        success: true,
        duration: 1200,
      },
      metadata: {},
    });
    await learner.recordOutcome(episode, {
      success: true,
      intent: 'compliance checks',
      compositionId: composition.id,
    });

    const selections = await selectTechniqueCompositionsFromStorage(
      storage as unknown as LibrarianStorage,
      'compliance checks',
      { selectionMode: 'keyword' }
    );
    expect(selections.map((item) => item.id)).toContain(composition.id);
  });

  it('compiles a composition into a work template', () => {
    const composition = createTechniqueComposition({
      id: 'tc-review',
      name: 'Review plan',
      description: 'Review changes with verification.',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan'],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
    ];

    const template = compileTechniqueCompositionTemplate(composition, primitives);
    expect(template.id).toBe('wt_tc-review');
    expect(template.suggestedSteps.map((step) => step.title)).toEqual([
      'Root cause analysis',
      'Create verification plan',
    ]);
    expect(template.defaultAcceptanceCriteria).toEqual([
      'All technique primitives executed and verified',
      'Complete: Root cause analysis',
      'Complete: Create verification plan',
    ]);
  });

  it('compiles a stored composition into a work template', async () => {
    const storage = new MockStorage();
    const template = await compileTechniqueCompositionTemplateFromStorage(
      storage as unknown as LibrarianStorage,
      'tc_release_readiness'
    );
    expect(template?.id).toBe('wt_tc_release_readiness');
  });

  it('reports missing primitives when compiling a template', () => {
    const composition = createTechniqueComposition({
      id: 'tc-missing',
      name: 'Missing primitives',
      description: 'Uses missing primitive IDs',
      primitiveIds: ['tp_missing', 'tp_root_cause'],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
    ];

    const result = compileTechniqueCompositionTemplateWithGaps(composition, primitives);
    expect(result.missingPrimitiveIds).toEqual(['tp_missing']);
    expect(result.template.id).toBe('wt_tc-missing');
  });

  it('reports missing primitives when compiling from storage', async () => {
    const storage = new MockStorage();
    await saveTechniqueComposition(storage as unknown as LibrarianStorage, createTechniqueComposition({
      id: 'tc-missing',
      name: 'Missing primitives',
      description: 'Uses missing primitive IDs',
      primitiveIds: ['tp_missing', 'tp_root_cause'],
    }));

    const result = await compileTechniqueCompositionTemplateWithGapsFromStorage(
      storage as unknown as LibrarianStorage,
      'tc-missing'
    );
    expect(result.missingPrimitiveIds).toEqual(['tp_missing']);
    expect(result.template?.id).toBe('wt_tc-missing');
  });

  it('bundles template with primitive definitions', () => {
    const composition = createTechniqueComposition({
      id: 'tc-bundle',
      name: 'Bundle',
      description: 'Bundle template with primitives.',
      primitiveIds: ['tp_root_cause', 'tp_missing'],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
    ];

    const bundle = compileTechniqueCompositionBundle(composition, primitives);
    expect(bundle.template.id).toBe('wt_tc-bundle');
    expect(bundle.primitives.map((item) => item.id)).toEqual(['tp_root_cause']);
    expect(bundle.missingPrimitiveIds).toEqual(['tp_missing']);
  });

  it('bundles stored composition with primitives', async () => {
    const storage = new MockStorage();
    await saveTechniqueComposition(storage as unknown as LibrarianStorage, createTechniqueComposition({
      id: 'tc-bundle',
      name: 'Bundle',
      description: 'Bundle template with primitives.',
      primitiveIds: ['tp_root_cause', 'tp_missing'],
    }));

    const bundle = await compileTechniqueCompositionBundleFromStorage(
      storage as unknown as LibrarianStorage,
      'tc-bundle'
    );
    expect(bundle.template?.id).toBe('wt_tc-bundle');
    expect(bundle.primitives.map((item) => item.id)).toEqual(['tp_root_cause']);
    expect(bundle.missingPrimitiveIds).toEqual(['tp_missing']);
  });

  it('compiles bundles from intent', async () => {
    const storage = new MockStorage();
    const bundles = await compileTechniqueBundlesFromIntent(
      storage as unknown as LibrarianStorage,
      'Prepare a release plan',
      { selectionMode: 'keyword' }
    );
    expect(bundles.map((bundle) => bundle.template?.id)).toEqual(
      expect.arrayContaining(['wt_tc_release_readiness'])
    );
  });

  it('compiles verification plan prototypes for core compositions', () => {
    const composition = createTechniqueComposition({
      id: 'tc_root_cause_recovery',
      name: 'Root cause recovery',
      description: 'Isolate, explain, and verify a failure cause.',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan'],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
    ];

    const prototype = compileTechniqueCompositionPrototype(composition, primitives);
    expect(prototype.verificationPlans.map((plan) => plan.id)).toContain('vp_tc_root_cause_recovery');
  });

  it('selects methods for review intent', () => {
    const selections = selectMethods('Please review this change set');
    expect(selections.map((item) => item.id)).toContain('tc_agentic_review_v1');
  });

  it('plans work from a composition with verification checkpoints', () => {
    const composition = createTechniqueComposition({
      id: 'tc_root_cause_recovery',
      name: 'Root cause recovery',
      description: 'Isolate, explain, and verify a failure cause.',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan'],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'failed job' });
    expect(plan.verificationPlans.map((item) => item.id)).toContain('vp_tc_root_cause_recovery');
    expect(plan.workHierarchy.children.some((child) => child.root.type === 'checkpoint')).toBe(true);
  });

  it('prepends adequacy gates when evidence is missing', () => {
    const composition = createTechniqueComposition({
      id: 'tc_release_readiness',
      name: 'Release readiness',
      description: 'Prepare release',
      primitiveIds: ['tp_release_plan'],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_release_plan',
        name: 'Release plan',
        intent: 'Plan release steps',
      }),
    ];
    const adequacyReport: AdequacyReport = {
      spec: {
        id: 'adequacy_release',
        taskIntent: 'release',
        claimBoundaries: [],
        requirements: [],
        degradedMode: 'degraded',
      },
      missingEvidence: [
        {
          id: 'rollback_plan',
          description: 'Document and rehearse rollback plan.',
          signalId: 'hasRollbackPlan',
          severity: 'critical',
          evidenceSources: ['local'],
          evidenceCommands: ['rg -n \"rollback\" docs || true'],
        },
      ],
      satisfiedEvidence: [],
      blocking: true,
      degradedMode: 'degraded',
      evidenceCommands: ['rg -n \"rollback\" docs || true'],
      signals: {
        hasTests: false,
        hasIntegrationTests: false,
        hasLoadTests: false,
        hasCi: false,
        hasObservability: false,
        hasRollbackPlan: false,
        hasMigrations: false,
        hasApiContracts: false,
        hasAuthz: false,
        hasDatasetFiles: false,
        hasEvalHarness: false,
        hasModelCode: false,
        hasMetrics: false,
        hasDocs: false,
        hasI18n: false,
        hasAccessibilityTests: false,
        hasSecretsScanning: false,
        hasReleaseAutomation: false,
      },
      difficulties: [],
    };

    const plan = planWorkFromComposition(composition, primitives, {
      target: 'Release',
      adequacyReport,
    });
    const nodes = plan.workHierarchy.children.map((child) => child.root);
    const gate = nodes.find((node) => node.metadata?.adequacyRequirementId === 'rollback_plan');
    const step = nodes.find((node) => node.metadata?.primitiveId === 'tp_release_plan');

    expect(gate?.type).toBe('checkpoint');
    expect(step?.dependencies.some((dep) => dep.targetId === gate?.id)).toBe(true);
  });

  it('compiles operators into deterministic gates with relationships', () => {
    const composition = createTechniqueComposition({
      id: 'tc-ops',
      name: 'Operator plan',
      description: 'Plan with operator gates.',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op_gate',
          type: 'gate',
          label: 'Quality gate',
          inputs: ['tp_root_cause'],
        },
      ],
      relationships: [
        {
          fromId: 'op_gate',
          toId: 'tp_root_cause',
          type: 'depends_on',
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const operatorNode = nodes.find((node) => node.metadata.operatorId === 'op_gate');
    expect(operatorNode?.type).toBe('checkpoint');
    expect(operatorNode?.tags).toContain('verification-gate');
    expect(operatorNode?.dependencies.map((dep) => dep.targetId)).toContain(
      nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause')?.id
    );
  });

  it('links operator inputs and outputs into dependencies', () => {
    const composition = createTechniqueComposition({
      id: 'tc-ops-io',
      name: 'Operator I/O plan',
      description: 'Plan with operator inputs and outputs.',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan'],
      operators: [
        {
          id: 'op_gate',
          type: 'gate',
          label: 'Quality gate',
          inputs: ['tp_root_cause'],
          outputs: ['tp_verify_plan'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const operatorNode = nodes.find((node) => node.metadata.operatorId === 'op_gate');
    const inputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');
    const outputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');

    expect(operatorNode).toBeDefined();
    expect(inputNode).toBeDefined();
    expect(outputNode).toBeDefined();

    const inputDep = operatorNode!.dependencies.find((dep) => dep.targetId === inputNode!.id);
    const outputDep = outputNode!.dependencies.find((dep) => dep.targetId === operatorNode!.id);

    expect(inputDep?.type).toBe('blocked_by');
    expect(inputDep?.description).toBe('operator_input:op_gate');
    expect(outputDep?.type).toBe('blocked_by');
    expect(outputDep?.description).toBe('operator_output:op_gate');
  });

  it('compiles conditional operators as checkpoint gates', () => {
    const composition = createTechniqueComposition({
      id: 'tc-ops-conditional',
      name: 'Conditional operator plan',
      description: 'Plan with conditional operator.',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan'],
      operators: [
        {
          id: 'op_conditional',
          type: 'conditional',
          label: 'Conditional gate',
          inputs: ['tp_root_cause'],
          outputs: ['tp_verify_plan'],
          conditions: ['signal unstable'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const operatorNode = nodes.find((node) => node.metadata.operatorId === 'op_conditional');
    const inputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');
    const outputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');

    expect(operatorNode).toBeDefined();
    expect(inputNode).toBeDefined();
    expect(outputNode).toBeDefined();
    expect(operatorNode!.type).toBe('checkpoint');
    expect(operatorNode!.metadata.operatorConditions).toEqual(['signal unstable']);
    expect(operatorNode!.dependencies.map((dep) => dep.targetId)).toContain(inputNode!.id);
    expect(outputNode!.dependencies.map((dep) => dep.targetId)).toContain(operatorNode!.id);
  });

  it('compiles loop operators as checkpoint gates', () => {
    const composition = createTechniqueComposition({
      id: 'tc-ops-loop',
      name: 'Loop operator plan',
      description: 'Plan with loop operator.',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan'],
      operators: [
        {
          id: 'op_loop',
          type: 'loop',
          label: 'Loop gate',
          inputs: ['tp_root_cause'],
          outputs: ['tp_verify_plan'],
          conditions: ['hypothesis unresolved'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const operatorNode = nodes.find((node) => node.metadata.operatorId === 'op_loop');
    const inputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');
    const outputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');

    expect(operatorNode).toBeDefined();
    expect(inputNode).toBeDefined();
    expect(outputNode).toBeDefined();
    expect(operatorNode!.type).toBe('checkpoint');
    expect(operatorNode!.metadata.operatorConditions).toEqual(['hypothesis unresolved']);
    expect(operatorNode!.dependencies.map((dep) => dep.targetId)).toContain(inputNode!.id);
    expect(outputNode!.dependencies.map((dep) => dep.targetId)).toContain(operatorNode!.id);
  });

  it('compiles edge operators into dependencies without operator nodes', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-sequence',
      name: 'Edge sequence',
      description: 'Sequence ordering without operator node',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan'],
      operators: [
        {
          id: 'op_sequence',
          type: 'sequence',
          inputs: ['tp_root_cause', 'tp_verify_plan'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const operatorNode = nodes.find((node) => node.metadata.operatorId === 'op_sequence');
    const firstNode = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');
    const secondNode = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');

    expect(operatorNode).toBeUndefined();
    expect(firstNode).toBeDefined();
    expect(secondNode).toBeDefined();
    const dep = secondNode!.dependencies.find((dependency) => dependency.targetId === firstNode!.id);
    expect(dep?.description).toBe('operator_sequence:op_sequence');
  });

  it('uses legacy graph version to keep edge operators as nodes', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-legacy',
      name: 'Legacy edge operator',
      description: 'Legacy graph retains operator nodes.',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan', 'tp_decision_review'],
      graphVersion: 1,
      operators: [
        {
          id: 'op_sequence',
          type: 'sequence',
          inputs: ['tp_root_cause', 'tp_decision_review'],
          outputs: ['tp_verify_plan'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
      createTechniquePrimitive({
        id: 'tp_decision_review',
        name: 'Decision review',
        intent: 'Review decisions',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const operatorNode = nodes.find((node) => node.metadata.operatorId === 'op_sequence');
    const inputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');
    const outputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');

    expect(operatorNode).toBeDefined();
    expect(operatorNode?.dependencies.map((dep) => dep.targetId)).toContain(inputNode?.id);
    expect(outputNode?.dependencies.map((dep) => dep.targetId)).toContain(operatorNode?.id);
  });

  it('wires sequence outputs to the final input', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-sequence-output',
      name: 'Edge sequence outputs',
      description: 'Sequence wiring to outputs',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan', 'tp_decision_review'],
      operators: [
        {
          id: 'op_sequence',
          type: 'sequence',
          inputs: ['tp_root_cause', 'tp_verify_plan'],
          outputs: ['tp_decision_review'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
      createTechniquePrimitive({
        id: 'tp_decision_review',
        name: 'Decision review',
        intent: 'Review decisions',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const tailNode = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');
    const outputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_decision_review');

    expect(tailNode).toBeDefined();
    expect(outputNode).toBeDefined();
    const dep = outputNode!.dependencies.find((dependency) => dependency.targetId === tailNode!.id);
    expect(dep?.description).toBe('operator_output:op_sequence');
  });

  it('compiles parallel edge operators to gate outputs on inputs', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-parallel',
      name: 'Edge parallel',
      description: 'Parallel inputs with output join',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan', 'tp_decision_review'],
      operators: [
        {
          id: 'op_parallel',
          type: 'parallel',
          inputs: ['tp_root_cause', 'tp_verify_plan'],
          outputs: ['tp_decision_review'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
      createTechniquePrimitive({
        id: 'tp_decision_review',
        name: 'Decision review',
        intent: 'Review decisions',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const outputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_decision_review');
    const inputRoot = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');
    const inputVerify = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');

    expect(outputNode).toBeDefined();
    const dependencies = outputNode!.dependencies.map((dependency) => dependency.targetId);
    expect(dependencies).toContain(inputRoot?.id);
    expect(dependencies).toContain(inputVerify?.id);
  });

  it('compiles fanout operators into output dependencies', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-fanout',
      name: 'Edge fanout',
      description: 'Fanout distributes outputs',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan', 'tp_decision_review'],
      operators: [
        {
          id: 'op_fanout',
          type: 'fanout',
          inputs: ['tp_root_cause'],
          outputs: ['tp_verify_plan', 'tp_decision_review'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
      createTechniquePrimitive({
        id: 'tp_decision_review',
        name: 'Decision review',
        intent: 'Review decisions',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const inputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');
    const outputA = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');
    const outputB = nodes.find((node) => node.metadata.primitiveId === 'tp_decision_review');

    expect(inputNode).toBeDefined();
    expect(outputA).toBeDefined();
    expect(outputB).toBeDefined();
    expect(outputA!.dependencies.map((dep) => dep.targetId)).toContain(inputNode!.id);
    expect(outputB!.dependencies.map((dep) => dep.targetId)).toContain(inputNode!.id);
  });

  it('compiles fanin operators into output dependencies', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-fanin',
      name: 'Edge fanin',
      description: 'Fanin aggregates inputs',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan', 'tp_decision_review'],
      operators: [
        {
          id: 'op_fanin',
          type: 'fanin',
          inputs: ['tp_root_cause', 'tp_verify_plan'],
          outputs: ['tp_decision_review'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
      createTechniquePrimitive({
        id: 'tp_decision_review',
        name: 'Decision review',
        intent: 'Review decisions',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const outputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_decision_review');
    const inputRoot = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');
    const inputVerify = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');

    expect(outputNode).toBeDefined();
    expect(outputNode!.dependencies.map((dep) => dep.targetId)).toContain(inputRoot?.id);
    expect(outputNode!.dependencies.map((dep) => dep.targetId)).toContain(inputVerify?.id);
  });

  it('compiles multiple edge operators in a single composition', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-multi',
      name: 'Edge multi operator',
      description: 'Multiple edge operators in one graph',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan', 'tp_decision_review', 'tp_release_plan'],
      operators: [
        {
          id: 'op_sequence',
          type: 'sequence',
          inputs: ['tp_root_cause', 'tp_verify_plan'],
        },
        {
          id: 'op_parallel',
          type: 'parallel',
          inputs: ['tp_verify_plan', 'tp_decision_review'],
          outputs: ['tp_release_plan'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
      createTechniquePrimitive({
        id: 'tp_decision_review',
        name: 'Decision review',
        intent: 'Review decisions',
      }),
      createTechniquePrimitive({
        id: 'tp_release_plan',
        name: 'Release plan',
        intent: 'Define release plan',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const stepVerify = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');
    const stepRoot = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');
    const stepDecision = nodes.find((node) => node.metadata.primitiveId === 'tp_decision_review');
    const stepRelease = nodes.find((node) => node.metadata.primitiveId === 'tp_release_plan');

    expect(stepVerify).toBeDefined();
    expect(stepRoot).toBeDefined();
    expect(stepDecision).toBeDefined();
    expect(stepRelease).toBeDefined();
    expect(stepVerify!.dependencies.map((dep) => dep.targetId)).toContain(stepRoot!.id);
    expect(stepRelease!.dependencies.map((dep) => dep.targetId)).toContain(stepVerify!.id);
    expect(stepRelease!.dependencies.map((dep) => dep.targetId)).toContain(stepDecision!.id);
  });

  it('deduplicates dependencies between edge operators and relationships', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-dedupe',
      name: 'Edge operator dedupe',
      description: 'Deduplicate edge dependencies with relationships.',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan'],
      operators: [
        {
          id: 'op_sequence',
          type: 'sequence',
          inputs: ['tp_root_cause', 'tp_verify_plan'],
        },
      ],
      relationships: [
        {
          fromId: 'tp_verify_plan',
          toId: 'tp_root_cause',
          type: 'depends_on',
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const outputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_verify_plan');
    const inputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');

    expect(outputNode).toBeDefined();
    expect(inputNode).toBeDefined();

    const deps = outputNode!.dependencies.filter((dep) => dep.targetId === inputNode!.id);
    expect(deps).toHaveLength(1);
  });

  it('throws when fanout operators have invalid inputs', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-fanout-invalid',
      name: 'Edge fanout invalid',
      description: 'Fanout requires exactly one input',
      primitiveIds: ['tp_root_cause', 'tp_verify_plan', 'tp_decision_review'],
      operators: [
        {
          id: 'op_fanout',
          type: 'fanout',
          inputs: ['tp_root_cause', 'tp_verify_plan'],
          outputs: ['tp_decision_review'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_verify_plan',
        name: 'Create verification plan',
        intent: 'Define proof obligations',
      }),
      createTechniquePrimitive({
        id: 'tp_decision_review',
        name: 'Decision review',
        intent: 'Review decisions',
      }),
    ];

    expect(() => planWorkFromComposition(composition, primitives, { target: 'incident' }))
      .toThrow(/operator_too_many_inputs/);
  });

  it('throws when reduce operators have no outputs', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-reduce-missing',
      name: 'Edge reduce missing outputs',
      description: 'Reduce requires outputs',
      primitiveIds: ['tp_root_cause', 'tp_secondary_input'],
      operators: [
        {
          id: 'op_reduce',
          type: 'reduce',
          inputs: ['tp_root_cause', 'tp_secondary_input'],
          outputs: [],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
      createTechniquePrimitive({
        id: 'tp_secondary_input',
        name: 'Secondary input',
        intent: 'Provide additional context',
      }),
    ];

    expect(() => planWorkFromComposition(composition, primitives, { target: 'incident' }))
      .toThrow(/operator_missing_outputs/);
  });

  it('deduplicates dependencies when edges overlap', () => {
    const composition = createTechniqueComposition({
      id: 'tc-ops-dedupe',
      name: 'Operator dedupe plan',
      description: 'Plan with overlapping operator and relationship edges.',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op_gate',
          type: 'gate',
          inputs: ['tp_root_cause'],
        },
      ],
      relationships: [
        {
          fromId: 'op_gate',
          toId: 'tp_root_cause',
          type: 'depends_on',
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
    ];

    const plan = planWorkFromComposition(composition, primitives, { target: 'incident' });
    const nodes = [plan.workHierarchy.root, ...plan.workHierarchy.children.map((child) => child.root)];
    const operatorNode = nodes.find((node) => node.metadata.operatorId === 'op_gate');
    const inputNode = nodes.find((node) => node.metadata.primitiveId === 'tp_root_cause');

    expect(operatorNode).toBeDefined();
    expect(inputNode).toBeDefined();

    const deps = operatorNode!.dependencies.filter((dep) => dep.targetId === inputNode!.id);
    expect(deps).toHaveLength(1);
  });

  it('throws when operators reference missing nodes', () => {
    const composition = createTechniqueComposition({
      id: 'tc-ops-missing',
      name: 'Operator missing inputs',
      description: 'Plan with missing operator references.',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op_gate',
          type: 'gate',
          inputs: ['tp_missing'],
        },
      ],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_root_cause',
        name: 'Root cause analysis',
        intent: 'Find the root cause',
      }),
    ];

    expect(() => planWorkFromComposition(composition, primitives, { target: 'incident' }))
      .toThrow(/composition_missing_operator_refs/);
  });

  it('plans work from intent using storage defaults', async () => {
    const storage = new MockStorage();
    const plans = await planWorkFromIntent(
      storage as unknown as LibrarianStorage,
      'Prepare a release plan',
      { selectionMode: 'keyword' }
    );
    expect(plans.map((plan) => plan.composition.id)).toContain('tc_release_readiness');
  });

  it('enriches work plans with execution context and estimates', () => {
    const composition = createTechniqueComposition({
      id: 'tc_context_plan',
      name: 'Contextual plan',
      description: 'Plan with context enrichment.',
      primitiveIds: ['tp_review_tests'],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_review_tests',
        name: 'Review tests and coverage',
        intent: 'Use tests to bound behavior and detect gaps.',
        inputsRequired: ['test list'],
        outputs: ['coverage assessment'],
      }),
    ];
    const version: LibrarianVersion = {
      major: 0,
      minor: 0,
      patch: 0,
      string: '0.0.0-test',
      qualityTier: 'mvp',
      indexedAt: new Date(),
      indexerVersion: 'test',
      features: [],
    };
    const pack: ContextPack = {
      packId: 'pack_1',
      packType: 'function_context',
      targetId: 'fn_review_tests',
      summary: 'Test summary',
      keyFacts: [],
      codeSnippets: [
        {
          filePath: 'src/review/tests.ts',
          startLine: 1,
          endLine: 2,
          content: 'export const review = true;',
          language: 'ts',
        },
      ],
      relatedFiles: ['src/review/tests.ts'],
      confidence: 0.6,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version,
      invalidationTriggers: [],
    };
    const context: LibrarianResponse = {
      query: { intent: 'review tests', depth: 'L1' },
      packs: [pack],
      disclosures: [],
      traceId: 'unverified_by_trace(replay_unavailable)',
      constructionPlan: {
        id: 'cp_plan_compiler',
        templateId: 'T1',
        ucIds: [],
        intent: 'review tests',
        source: 'default',
        createdAt: new Date().toISOString(),
      },
      totalConfidence: 0.6,
      cacheHit: false,
      latencyMs: 10,
      version,
      drillDownHints: [],
    };

    const plan = planWorkFromCompositionWithContext(composition, primitives, context, { target: 'Release' });
    const root = plan.workHierarchy.root;
    const step = plan.workHierarchy.children
      .map((child) => child.root)
      .find((node) => node.metadata?.primitiveId === 'tp_review_tests');

    expect(root.executionContext?.relevantFiles.some((file) => file.path === 'src/review/tests.ts')).toBe(true);
    expect(root.estimates?.tokenBudget.min).toBeGreaterThan(0);
    expect(step?.executionContext?.suggestedTools.some((tool) => tool.id === 'tests')).toBe(true);
  });
});
