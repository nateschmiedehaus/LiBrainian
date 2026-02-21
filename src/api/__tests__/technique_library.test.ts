import { describe, it, expect, beforeEach } from 'vitest';
import {
  ensureTechniquePrimitives,
  DEFAULT_TECHNIQUE_PRIMITIVES,
} from '../technique_library.js';
import {
  listTechniquePrimitives,
  saveTechniquePrimitive,
} from '../../state/technique_primitives.js';
import { createTechniquePrimitive } from '../../strategic/techniques.js';
import type { LiBrainianStorage } from '../../storage/types.js';

type StorageStub = Pick<LiBrainianStorage, 'getState' | 'setState'>;

class MockStorage implements StorageStub {
  private state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
}

describe('technique library seeding', () => {
  let storage: MockStorage;

  beforeEach(() => {
    storage = new MockStorage();
  });

  it('seeds defaults when store is empty', async () => {
    const seeded = await ensureTechniquePrimitives(storage as unknown as LiBrainianStorage);
    expect(seeded.length).toBe(DEFAULT_TECHNIQUE_PRIMITIVES.length);
    expect(seeded.map((item) => item.id)).toEqual(
      expect.arrayContaining([DEFAULT_TECHNIQUE_PRIMITIVES[0]!.id])
    );
  });

  it('adds missing defaults without overwriting existing primitives', async () => {
    const custom = createTechniquePrimitive({
      id: 'tp-custom',
      name: 'Custom technique',
      intent: 'Custom intent',
    });
    await saveTechniquePrimitive(storage as unknown as LiBrainianStorage, custom);

    const seeded = await ensureTechniquePrimitives(storage as unknown as LiBrainianStorage);
    const ids = seeded.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining(['tp-custom']));
    expect(seeded.length).toBe(DEFAULT_TECHNIQUE_PRIMITIVES.length + 1);
  });

  it('overwrites with defaults when overwrite=true', async () => {
    const custom = createTechniquePrimitive({
      id: 'tp-custom',
      name: 'Custom technique',
      intent: 'Custom intent',
    });
    await saveTechniquePrimitive(storage as unknown as LiBrainianStorage, custom);

    const seeded = await ensureTechniquePrimitives(storage as unknown as LiBrainianStorage, { overwrite: true });
    const ids = seeded.map((item) => item.id);

    expect(ids).not.toContain('tp-custom');
    expect(seeded.length).toBe(DEFAULT_TECHNIQUE_PRIMITIVES.length);
  });

  it('returns stored primitives when nothing changes', async () => {
    await ensureTechniquePrimitives(storage as unknown as LiBrainianStorage);
    const list = await listTechniquePrimitives(storage as unknown as LiBrainianStorage);
    const seeded = await ensureTechniquePrimitives(storage as unknown as LiBrainianStorage);
    expect(seeded).toEqual(list);
  });

  it('includes baseline techniques for core workflows', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_root_cause',
      'tp_arch_mapping',
      'tp_interface_contract',
      'tp_threat_model',
      'tp_performance_profile',
      'tp_refactor_safe',
      'tp_ux_journey',
      'tp_research_synthesis',
    ]));
  });

  it('includes analysis and safety techniques', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_data_invariants',
      'tp_failure_mode_analysis',
      'tp_api_surface_audit',
      'tp_dependency_map',
      'tp_incident_timeline',
      'tp_math_proof',
      'tp_creative_variation',
      'tp_experiment_design',
    ]));
  });

  it('includes strategic planning techniques', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_assumption_audit',
      'tp_first_principles',
      'tp_backcasting',
      'tp_decision_matrix',
      'tp_scenario_planning',
      'tp_security_abuse_cases',
      'tp_user_feedback_loop',
      'tp_release_plan',
    ]));
  });

  it('includes assurance and quality techniques', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_assurance_case',
      'tp_requirement_traceability',
      'tp_change_impact',
      'tp_edge_case_catalog',
      'tp_test_gap_analysis',
      'tp_scaling_bottleneck',
      'tp_data_quality_audit',
      'tp_accessibility_review',
    ]));
  });

  it('includes meta-cognition and coordination techniques', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_calibration_check',
      'tp_bias_check',
      'tp_red_team_prompt',
      'tp_decision_review',
      'tp_stop_escalate',
      'tp_ownership_matrix',
      'tp_communication_cadence',
      'tp_integration_checkpoint',
    ]));
  });

  it('includes evidence and compliance techniques', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_evidence_pack',
      'tp_artifact_envelope',
      'tp_artifact_versioning',
      'tp_stage_compliance',
      'tp_gating_rules',
      'tp_provider_probe',
    ]));
  });

  it('includes multi-agent coordination techniques', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_blackboard_coordination',
      'tp_contract_net_leasing',
      'tp_arbitration',
      'tp_worktree_isolation',
      'tp_ote_rubric_planning',
    ]));
  });

  it('includes universal domain primitives', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_algorithm_trace',
      'tp_component_graph',
      'tp_scale_pattern',
      'tp_realtime_flow',
      'tp_media_pipeline',
      'tp_tool_orchestration',
      'tp_distribution_map',
    ]));
  });

  it('includes execution governance techniques', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_evolvable_artifacts',
      'tp_durable_execution',
      'tp_run_event_log',
      'tp_policy_enforcement',
      'tp_principles_injection',
      'tp_external_project_protocol',
      'tp_safe_code_search',
      'tp_replay_pack',
    ]));
  });

  it('includes resilience and SLO techniques', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_self_healing',
      'tp_resilience_engine',
      'tp_graceful_degradation',
      'tp_slo_definition',
      'tp_slo_monitoring',
    ]));
  });

  it('captures required fields for resilience primitives', () => {
    const ids = [
      'tp_self_healing',
      'tp_resilience_engine',
      'tp_graceful_degradation',
      'tp_slo_definition',
      'tp_slo_monitoring',
    ];
    for (const id of ids) {
      const primitive = DEFAULT_TECHNIQUE_PRIMITIVES.find((item) => item.id === id);
      expect(primitive).toBeDefined();
      expect(primitive?.category).toBeTruthy();
      expect(primitive?.semanticProfileId).toBeTruthy();
      expect(primitive?.inputsRequired.length).toBeGreaterThan(0);
      expect(primitive?.actions.length).toBeGreaterThan(0);
      expect(primitive?.failureModes.length).toBeGreaterThan(0);
      expect(primitive?.outputs.length).toBeGreaterThan(0);
    }
  });

  it('includes self-improvement primitives with expected metadata', () => {
    const bootstrap = DEFAULT_TECHNIQUE_PRIMITIVES.find((item) => item.id === 'tp_self_bootstrap');
    const architecture = DEFAULT_TECHNIQUE_PRIMITIVES.find((item) => item.id === 'tp_analyze_architecture');

    expect(bootstrap).toBeDefined();
    expect(architecture).toBeDefined();

    expect(bootstrap?.category).toBe('meta');
    expect(bootstrap?.semanticProfileId).toBe('meta');
    expect(bootstrap?.failureModes).toEqual(expect.arrayContaining(['Source path missing', 'Partial index']));

    expect(architecture?.category).toBe('meta');
    expect(architecture?.semanticProfileId).toBe('meta');
    expect(architecture?.failureModes).toEqual(expect.arrayContaining(['Missing index']));
  });

  it('includes SCAS core primitives', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_semantic_dedup',
      'tp_hebbian_learning',
      'tp_unified_field_signal',
      'tp_homeostasis_loop',
      'tp_thermodynamic_pressure',
      'tp_adaptive_complexity',
    ]));
  });

  it('captures required fields for SCAS core primitives', () => {
    const ids = [
      'tp_semantic_dedup',
      'tp_hebbian_learning',
      'tp_unified_field_signal',
      'tp_homeostasis_loop',
      'tp_thermodynamic_pressure',
      'tp_adaptive_complexity',
    ];
    for (const id of ids) {
      const primitive = DEFAULT_TECHNIQUE_PRIMITIVES.find((item) => item.id === id);
      expect(primitive).toBeDefined();
      expect(primitive?.category).toBeTruthy();
      expect(primitive?.semanticProfileId).toBeTruthy();
      expect(primitive?.inputsRequired.length).toBeGreaterThan(0);
      expect(primitive?.actions.length).toBeGreaterThan(0);
      expect(primitive?.failureModes.length).toBeGreaterThan(0);
      expect(primitive?.outputs.length).toBeGreaterThan(0);
    }
  });

  it('includes economics primitives', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_task_economics',
      'tp_token_ledger',
      'tp_reputation_update',
      'tp_cost_estimation',
      'tp_vcg_auction',
    ]));
  });

  it('captures required fields for economics primitives', () => {
    const ids = [
      'tp_task_economics',
      'tp_token_ledger',
      'tp_reputation_update',
      'tp_cost_estimation',
      'tp_vcg_auction',
    ];
    for (const id of ids) {
      const primitive = DEFAULT_TECHNIQUE_PRIMITIVES.find((item) => item.id === id);
      expect(primitive).toBeDefined();
      expect(primitive?.category).toBeTruthy();
      expect(primitive?.semanticProfileId).toBeTruthy();
      expect(primitive?.inputsRequired.length).toBeGreaterThan(0);
      expect(primitive?.actions.length).toBeGreaterThan(0);
      expect(primitive?.failureModes.length).toBeGreaterThan(0);
      expect(primitive?.outputs.length).toBeGreaterThan(0);
    }
  });

  it('includes evolution and knowledge graph primitives', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_novelty_search',
      'tp_evolution_tournament',
      'tp_diversity_enforcer',
      'tp_fitness_gap_proposer',
      'tp_knowledge_graph',
    ]));
  });

  it('captures required fields for evolution primitives', () => {
    const ids = [
      'tp_novelty_search',
      'tp_evolution_tournament',
      'tp_diversity_enforcer',
      'tp_fitness_gap_proposer',
      'tp_knowledge_graph',
    ];
    for (const id of ids) {
      const primitive = DEFAULT_TECHNIQUE_PRIMITIVES.find((item) => item.id === id);
      expect(primitive).toBeDefined();
      expect(primitive?.category).toBeTruthy();
      expect(primitive?.semanticProfileId).toBeTruthy();
      expect(primitive?.inputsRequired.length).toBeGreaterThan(0);
      expect(primitive?.actions.length).toBeGreaterThan(0);
      expect(primitive?.failureModes.length).toBeGreaterThan(0);
      expect(primitive?.outputs.length).toBeGreaterThan(0);
    }
  });

  it('includes advanced coordination and defense primitives', () => {
    const defaultIds = DEFAULT_TECHNIQUE_PRIMITIVES.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tp_real_world_grounding',
      'tp_adversarial_immune',
      'tp_federated_learning',
      'tp_agent_ecosystem',
    ]));
  });

  it('captures required fields for advanced primitives', () => {
    const ids = [
      'tp_real_world_grounding',
      'tp_adversarial_immune',
      'tp_federated_learning',
      'tp_agent_ecosystem',
    ];
    for (const id of ids) {
      const primitive = DEFAULT_TECHNIQUE_PRIMITIVES.find((item) => item.id === id);
      expect(primitive).toBeDefined();
      expect(primitive?.category).toBeTruthy();
      expect(primitive?.semanticProfileId).toBeTruthy();
      expect(primitive?.inputsRequired.length).toBeGreaterThan(0);
      expect(primitive?.actions.length).toBeGreaterThan(0);
      expect(primitive?.failureModes.length).toBeGreaterThan(0);
      expect(primitive?.outputs.length).toBeGreaterThan(0);
    }
  });
});
