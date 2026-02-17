import type { LibrarianStorage } from '../storage/types.js';
import {
  createTechniqueComposition,
  type TechniqueCompositionGraphVersion,
  type TechniqueComposition,
  type TechniquePrimitive,
  type TechniqueRelationship,
  isBuiltinOperatorType,
  isCustomOperatorType,
} from '../strategic/techniques.js';
import { getOperatorSemantics } from '../strategic/technique_semantics.js';
import { DEFAULT_TECHNIQUE_PRIMITIVES } from './technique_library.js';
import {
  listTechniqueCompositions,
  saveTechniqueComposition,
  deleteTechniqueComposition,
} from '../state/technique_compositions.js';
import { getRelationshipSemantics } from '../strategic/technique_semantics.js';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_OPERATOR_LINKS_TOTAL = 1000;
const MAX_OPERATOR_CONDITIONS = 100;

type SafeIdLabel =
  | 'composition_id'
  | 'primitive_id'
  | 'operator_id'
  | 'operator_input_id'
  | 'operator_output_id'
  | 'relationship_from_id'
  | 'relationship_to_id';

function assertSafeId(value: unknown, label: SafeIdLabel): string {
  if (typeof value !== 'string' || value.length === 0 || !SAFE_ID_PATTERN.test(value)) {
    throw new Error(`unverified_by_trace(invalid_${label})`);
  }
  return value;
}

function buildSequentialRelationships(primitiveIds: string[]): TechniqueRelationship[] {
  return primitiveIds.slice(1).map((id, index) => ({
    fromId: primitiveIds[index],
    toId: id,
    type: 'depends_on',
  }));
}

export function assertCompositionReferences(
  input: {
    compositions: TechniqueComposition[];
    primitives: TechniquePrimitive[];
  },
  options?: {
    allowMissingPrimitives?: boolean;
  }
): void {
  const allowMissingPrimitives = options?.allowMissingPrimitives ?? false;
  const primitiveIds = new Set(input.primitives.map((primitive) => primitive.id));

  for (const composition of input.compositions) {
    const compositionId = assertSafeId(composition.id, 'composition_id');
    if (
      composition.graphVersion !== undefined &&
      composition.graphVersion !== 1 &&
      composition.graphVersion !== 2
    ) {
      throw new Error(`unverified_by_trace(composition_graph_version_invalid): ${compositionId}`);
    }
    const graphVersion: TechniqueCompositionGraphVersion = composition.graphVersion ?? 1;
    if (!Array.isArray(composition.primitiveIds)) {
      throw new Error(`unverified_by_trace(composition_primitives_invalid): ${compositionId}`);
    }
    for (const primitiveId of composition.primitiveIds) {
      assertSafeId(primitiveId, 'primitive_id');
    }
    if (composition.operators !== undefined && !Array.isArray(composition.operators)) {
      throw new Error(`unverified_by_trace(composition_operators_invalid): ${compositionId}`);
    }
    if (composition.relationships !== undefined && !Array.isArray(composition.relationships)) {
      throw new Error(`unverified_by_trace(composition_relationships_invalid): ${compositionId}`);
    }
    const missing = composition.primitiveIds.filter((id) => !primitiveIds.has(id));
    if (missing.length > 0 && !allowMissingPrimitives) {
      throw new Error(
        `unverified_by_trace(composition_missing_primitives): ${compositionId} missing=${missing.join(',')}`
      );
    }

    const compositionPrimitiveIds = new Set(composition.primitiveIds);
    const operatorIds = (composition.operators ?? []).map((operator) => operator.id);
    const operatorIdSet = new Set<string>();
    const duplicateOperatorIds = new Set<string>();
    const operatorIdCollisions = new Set<string>();
    const edgeOperatorIds = new Set<string>();
    const checkpointOperatorIds = new Set<string>();

    for (const operator of composition.operators ?? []) {
      if (!operator.type || typeof operator.type !== 'string') {
        throw new Error(
          `unverified_by_trace(operator_missing_type): ${compositionId}`
        );
      }
      const operatorType = String(operator.type);
      if (!isBuiltinOperatorType(operatorType) && !isCustomOperatorType(operatorType)) {
        const safeType = operatorType.slice(0, 100).replace(/[^a-zA-Z0-9_]/g, '_');
        throw new Error(
          `unverified_by_trace(operator_unknown_type): ${compositionId} type=${safeType}`
        );
      }
      if (!operator.id || typeof operator.id !== 'string') {
        throw new Error(
          `unverified_by_trace(operator_missing_id): ${compositionId}`
        );
      }
      const operatorId = assertSafeId(operator.id, 'operator_id');
      if (operatorIdSet.has(operatorId)) {
        duplicateOperatorIds.add(operatorId);
      }
      operatorIdSet.add(operatorId);
      if (compositionPrimitiveIds.has(operatorId)) {
        operatorIdCollisions.add(operatorId);
      }
      let semantics: ReturnType<typeof getOperatorSemantics>;
      try {
        semantics = getOperatorSemantics(operator.type);
      } catch (error) {
        const rawReason = error instanceof Error ? error.message : String(error);
        const reason = rawReason.replace(/[\r\n\t]/g, ' ').slice(0, 200);
        throw new Error(
          `unverified_by_trace(operator_semantics_missing): ${compositionId} operator=${operatorId} reason=${reason}`
        );
      }
      if (!Number.isFinite(semantics.minInputs) || !Number.isFinite(semantics.minOutputs)) {
        throw new Error(
          `unverified_by_trace(operator_semantics_invalid): ${compositionId} operator=${operatorId}`
        );
      }
      if (semantics.maxInputs !== undefined && !Number.isFinite(semantics.maxInputs)) {
        throw new Error(
          `unverified_by_trace(operator_semantics_invalid): ${compositionId} operator=${operatorId}`
        );
      }
      if (semantics.maxOutputs !== undefined && !Number.isFinite(semantics.maxOutputs)) {
        throw new Error(
          `unverified_by_trace(operator_semantics_invalid): ${compositionId} operator=${operatorId}`
        );
      }
      if (semantics.compile === 'edge') {
        edgeOperatorIds.add(operatorId);
      } else {
        checkpointOperatorIds.add(operatorId);
      }

      if (operator.inputs !== undefined && !Array.isArray(operator.inputs)) {
        throw new Error(
          `unverified_by_trace(operator_inputs_invalid): ${compositionId} operator=${operatorId}`
        );
      }
      if (operator.outputs !== undefined && !Array.isArray(operator.outputs)) {
        throw new Error(
          `unverified_by_trace(operator_outputs_invalid): ${compositionId} operator=${operatorId}`
        );
      }
      const inputs = operator.inputs ?? [];
      const outputs = operator.outputs ?? [];
      if (inputs.length + outputs.length > MAX_OPERATOR_LINKS_TOTAL) {
        throw new Error(
          `unverified_by_trace(operator_links_excessive): ${compositionId} operator=${operatorId}`
        );
      }
      for (const value of inputs) {
        if (typeof value !== 'string') {
          throw new Error(
            `unverified_by_trace(operator_inputs_non_string): ${compositionId} operator=${operatorId}`
          );
        }
        if (value.length === 0) {
          throw new Error(
            `unverified_by_trace(operator_inputs_empty): ${compositionId} operator=${operatorId}`
          );
        }
        assertSafeId(value, 'operator_input_id');
      }
      for (const value of outputs) {
        if (typeof value !== 'string') {
          throw new Error(
            `unverified_by_trace(operator_outputs_non_string): ${compositionId} operator=${operatorId}`
          );
        }
        if (value.length === 0) {
          throw new Error(
            `unverified_by_trace(operator_outputs_empty): ${compositionId} operator=${operatorId}`
          );
        }
        assertSafeId(value, 'operator_output_id');
      }
      if (inputs.length < semantics.minInputs) {
        throw new Error(
          `unverified_by_trace(operator_missing_inputs): ${compositionId} operator=${operatorId}`
        );
      }
      if (typeof semantics.maxInputs === 'number' && inputs.length > semantics.maxInputs) {
        throw new Error(
          `unverified_by_trace(operator_too_many_inputs): ${compositionId} operator=${operatorId}`
        );
      }
      if (outputs.length < semantics.minOutputs) {
        throw new Error(
          `unverified_by_trace(operator_missing_outputs): ${compositionId} operator=${operatorId}`
        );
      }
      if (typeof semantics.maxOutputs === 'number' && outputs.length > semantics.maxOutputs) {
        throw new Error(
          `unverified_by_trace(operator_too_many_outputs): ${compositionId} operator=${operatorId}`
        );
      }
      if (operator.conditions !== undefined && !Array.isArray(operator.conditions)) {
        throw new Error(
          `unverified_by_trace(operator_conditions_invalid): ${compositionId} operator=${operatorId}`
        );
      }
      if (operator.conditions) {
        if (operator.conditions.length > MAX_OPERATOR_CONDITIONS) {
          throw new Error(
            `unverified_by_trace(operator_conditions_excessive): ${compositionId} operator=${operatorId}`
          );
        }
        for (const condition of operator.conditions) {
          if (typeof condition !== 'string' || condition.length === 0) {
            throw new Error(
              `unverified_by_trace(operator_conditions_invalid): ${compositionId} operator=${operatorId}`
            );
          }
        }
      }
      const hasConditions = Array.isArray(operator.conditions) && operator.conditions.length > 0;
      if (semantics.requiresRuntimeCondition && !hasConditions) {
        throw new Error(
          `unverified_by_trace(operator_missing_conditions): ${compositionId} operator=${operatorId}`
        );
      }
      if (operator.parameters !== undefined) {
        if (!operator.parameters || typeof operator.parameters !== 'object' || Array.isArray(operator.parameters)) {
          throw new Error(
            `unverified_by_trace(operator_parameters_invalid): ${compositionId} operator=${operatorId}`
          );
        }
      }
      if (semantics.requiredParameters && semantics.requiredParameters.length > 0) {
        const params = operator.parameters as Record<string, unknown> | undefined;
        if (!params) {
          throw new Error(
            `unverified_by_trace(operator_parameters_missing): ${compositionId} operator=${operatorId}`
          );
        }
        const missingParams = semantics.requiredParameters.filter((key) => !(key in params));
        if (missingParams.length > 0) {
          throw new Error(
            `unverified_by_trace(operator_parameters_missing): ${compositionId} operator=${operatorId} missing=${missingParams.join(',')}`
          );
        }
      }
    }

    if (duplicateOperatorIds.size > 0) {
      throw new Error(
        `unverified_by_trace(composition_duplicate_operator_ids): ${compositionId} duplicates=${[...duplicateOperatorIds].join(',')}`
      );
    }

    if (operatorIdCollisions.size > 0) {
      throw new Error(
        `unverified_by_trace(composition_operator_id_collision): ${compositionId} collisions=${[...operatorIdCollisions].join(',')}`
      );
    }

    const nodeIds = new Set([
      ...composition.primitiveIds,
      ...(graphVersion === 1 ? operatorIds : [...checkpointOperatorIds]),
    ]);
    // Edge operators compile to dependencies only, so they do not become WorkPrimitives.
    // Operator inputs/outputs and relationships must target nodes that exist in the hierarchy.
    // knownIds keeps edge operators for typo detection before enforcing the relationship restriction.
    const knownIds = new Set([...composition.primitiveIds, ...operatorIdSet]);

    const missingOperatorRefs = new Map<string, number>();
    for (const operator of composition.operators ?? []) {
      for (const input of operator.inputs ?? []) {
        if (!nodeIds.has(input)) {
          missingOperatorRefs.set(input, (missingOperatorRefs.get(input) ?? 0) + 1);
        }
      }
      for (const output of operator.outputs ?? []) {
        if (!nodeIds.has(output)) {
          missingOperatorRefs.set(output, (missingOperatorRefs.get(output) ?? 0) + 1);
        }
      }
    }
    if (missingOperatorRefs.size > 0) {
      const uniqueMissing = [...missingOperatorRefs.keys()];
      const totalMissing = [...missingOperatorRefs.values()].reduce((sum, count) => sum + count, 0);
      throw new Error(
        `unverified_by_trace(composition_missing_operator_refs): ${compositionId} missing=${uniqueMissing.join(',')} total=${totalMissing}`
      );
    }

    const missingRelationshipRefs: string[] = [];
    const relationshipEdgeOperators = new Set<string>();
    for (const relationship of composition.relationships ?? []) {
      if (!relationship || typeof relationship !== 'object') {
        throw new Error(`unverified_by_trace(relationship_invalid): ${compositionId}`);
      }
      if (!relationship.type || typeof relationship.type !== 'string') {
        throw new Error(
          `unverified_by_trace(relationship_missing_type): ${compositionId}`
        );
      }
      try {
        getRelationshipSemantics(relationship.type);
      } catch (error) {
        const rawReason = error instanceof Error ? error.message : String(error);
        const reason = rawReason.replace(/[\r\n\t]/g, ' ').slice(0, 200);
        throw new Error(
          `unverified_by_trace(relationship_semantics_missing): ${compositionId} type=${relationship.type} reason=${reason}`
        );
      }
      if (!relationship.fromId || typeof relationship.fromId !== 'string') {
        throw new Error(`unverified_by_trace(relationship_missing_from): ${compositionId}`);
      }
      if (!relationship.toId || typeof relationship.toId !== 'string') {
        throw new Error(`unverified_by_trace(relationship_missing_to): ${compositionId}`);
      }
      assertSafeId(relationship.fromId, 'relationship_from_id');
      assertSafeId(relationship.toId, 'relationship_to_id');
      if (
        relationship.condition !== undefined &&
        (typeof relationship.condition !== 'string' || relationship.condition.length === 0)
      ) {
        throw new Error(`unverified_by_trace(relationship_condition_invalid): ${compositionId}`);
      }
      if (relationship.weight !== undefined && !Number.isFinite(relationship.weight)) {
        throw new Error(`unverified_by_trace(relationship_weight_invalid): ${compositionId}`);
      }
      if (!knownIds.has(relationship.fromId)) missingRelationshipRefs.push(relationship.fromId);
      if (!knownIds.has(relationship.toId)) missingRelationshipRefs.push(relationship.toId);
      if (edgeOperatorIds.has(relationship.fromId)) relationshipEdgeOperators.add(relationship.fromId);
      if (edgeOperatorIds.has(relationship.toId)) relationshipEdgeOperators.add(relationship.toId);
    }
    if (missingRelationshipRefs.length > 0) {
      throw new Error(
        `unverified_by_trace(composition_missing_relationship_refs): ${compositionId} missing=${missingRelationshipRefs.join(',')}`
      );
    }
    if (graphVersion === 2 && relationshipEdgeOperators.size > 0) {
      throw new Error(
        `unverified_by_trace(composition_relationship_edge_operator): ${compositionId} ids=${[...relationshipEdgeOperators].join(',')}`
      );
    }
  }
}

export const DEFAULT_TECHNIQUE_COMPOSITIONS: TechniqueComposition[] = [
  createTechniqueComposition({
    id: 'tc_agentic_review_v1',
    name: 'Agentic review (v1)',
    description: 'Evidence-led review with explicit verification and stop gates.',
    primitiveIds: [
      'tp_assumption_audit',
      'tp_change_impact',
      'tp_test_gap_analysis',
      'tp_edge_case_catalog',
      'tp_verify_plan',
      'tp_stop_escalate',
      'tp_decision_review',
    ],
    operators: [
      {
        id: 'op_review_parallel_sweeps',
        type: 'parallel',
        label: 'Parallel evidence sweeps',
        inputs: ['tp_change_impact', 'tp_test_gap_analysis', 'tp_edge_case_catalog'],
      },
      {
        id: 'op_review_stop_gate',
        type: 'gate',
        label: 'Stop and escalate when evidence is missing',
        inputs: ['tp_verify_plan'],
        outputs: ['tp_stop_escalate'],
        conditions: ['missing evidence', 'risk too high'],
      },
    ],
    relationships: buildSequentialRelationships([
      'tp_assumption_audit',
      'tp_change_impact',
      'tp_test_gap_analysis',
      'tp_edge_case_catalog',
      'tp_verify_plan',
      'tp_stop_escalate',
      'tp_decision_review',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_root_cause_recovery',
    name: 'Root cause recovery',
    description: 'Isolate, explain, and verify a failure cause.',
    primitiveIds: [
      'tp_root_cause',
      'tp_min_repro',
      'tp_bisect',
      'tp_instrument',
      'tp_failure_mode_analysis',
      'tp_verify_plan',
    ],
    operators: [
      {
        id: 'op_root_cause_loop',
        type: 'loop',
        label: 'Iterate until the signal is stable',
        inputs: ['tp_min_repro', 'tp_bisect', 'tp_instrument'],
        conditions: ['signal unstable', 'hypothesis unresolved'],
      },
    ],
    relationships: buildSequentialRelationships([
      'tp_root_cause',
      'tp_min_repro',
      'tp_bisect',
      'tp_instrument',
      'tp_failure_mode_analysis',
      'tp_verify_plan',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_release_readiness',
    name: 'Release readiness',
    description: 'Prepare a high-risk change for safe release.',
    primitiveIds: [
      'tp_release_plan',
      'tp_risk_scan',
      'tp_dependency_map',
      'tp_accessibility_review',
      'tp_test_gap_analysis',
      'tp_verify_plan',
    ],
    operators: [
      {
        id: 'op_release_gate',
        type: 'gate',
        label: 'Release only when verification passes',
        inputs: ['tp_verify_plan'],
        conditions: ['verification incomplete', 'rollback plan missing'],
      },
    ],
    relationships: buildSequentialRelationships([
      'tp_release_plan',
      'tp_risk_scan',
      'tp_dependency_map',
      'tp_accessibility_review',
      'tp_test_gap_analysis',
      'tp_verify_plan',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_repo_rehab_triage',
    name: 'Repo rehab triage',
    description: 'Diagnose and stabilize a degraded codebase before overhaul.',
    primitiveIds: [
      'tp_arch_mapping',
      'tp_dependency_map',
      'tp_assumption_audit',
      'tp_change_impact',
      'tp_test_gap_analysis',
      'tp_risk_scan',
      'tp_verify_plan',
    ],
  }),
  createTechniqueComposition({
    id: 'tc_performance_reliability',
    name: 'Performance and reliability',
    description: 'Profile, diagnose, and validate performance bottlenecks.',
    primitiveIds: [
      'tp_performance_profile',
      'tp_scaling_bottleneck',
      'tp_failure_mode_analysis',
      'tp_instrument',
      'tp_experiment_design',
      'tp_verify_plan',
    ],
  }),
  createTechniqueComposition({
    id: 'tc_security_review',
    name: 'Security review',
    description: 'Assess security risks and verify mitigations.',
    primitiveIds: [
      'tp_threat_model',
      'tp_security_abuse_cases',
      'tp_api_surface_audit',
      'tp_test_gap_analysis',
      'tp_verify_plan',
      'tp_stop_escalate',
    ],
  }),
  createTechniqueComposition({
    id: 'tc_ux_discovery',
    name: 'UX discovery',
    description: 'Discover user needs and validate experience improvements.',
    primitiveIds: [
      'tp_ux_journey',
      'tp_user_feedback_loop',
      'tp_research_synthesis',
      'tp_creative_variation',
      'tp_accessibility_review',
      'tp_verify_plan',
    ],
  }),
  createTechniqueComposition({
    id: 'tc_scaling_readiness',
    name: 'Scaling readiness',
    description: 'Prepare systems for scaling with validation checkpoints.',
    primitiveIds: [
      'tp_scaling_bottleneck',
      'tp_dependency_map',
      'tp_performance_profile',
      'tp_failure_mode_analysis',
      'tp_experiment_design',
      'tp_verify_plan',
    ],
  }),
  createTechniqueComposition({
    id: 'tc_cross_repo_contract_drift',
    name: 'Cross-repo contract drift',
    description: 'Detect and resolve cross-repo API/schema drift before integration or release.',
    primitiveIds: [
      'tp_interface_contract',
      'tp_dependency_map',
      'tp_requirement_traceability',
      'tp_change_impact',
      'tp_verify_plan',
      'tp_stop_escalate',
    ],
    operators: [
      {
        id: 'op_contract_drift_gate',
        type: 'gate',
        label: 'Block release on unresolved cross-repo contract drift',
        inputs: ['tp_interface_contract', 'tp_change_impact', 'tp_verify_plan'],
        outputs: ['tp_stop_escalate'],
        conditions: ['contract mismatch', 'schema drift', 'missing dependent remediation'],
      },
    ],
    relationships: buildSequentialRelationships([
      'tp_interface_contract',
      'tp_dependency_map',
      'tp_requirement_traceability',
      'tp_change_impact',
      'tp_verify_plan',
      'tp_stop_escalate',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_migration_safety_rollout',
    name: 'Migration safety rollout',
    description: 'Plan and verify risky data/schema migrations with rollback and safety evidence.',
    primitiveIds: [
      'tp_release_plan',
      'tp_data_invariants',
      'tp_failure_mode_analysis',
      'tp_test_gap_analysis',
      'tp_assurance_case',
      'tp_verify_plan',
      'tp_stop_escalate',
    ],
    operators: [
      {
        id: 'op_migration_gate',
        type: 'gate',
        label: 'Require migration safety proof before rollout',
        inputs: ['tp_data_invariants', 'tp_failure_mode_analysis', 'tp_verify_plan'],
        outputs: ['tp_stop_escalate'],
        conditions: ['rollback unverified', 'data invariant risk', 'migration test gaps'],
      },
    ],
    relationships: buildSequentialRelationships([
      'tp_release_plan',
      'tp_data_invariants',
      'tp_failure_mode_analysis',
      'tp_test_gap_analysis',
      'tp_assurance_case',
      'tp_verify_plan',
      'tp_stop_escalate',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_incident_hotfix_governed',
    name: 'Incident hotfix governed',
    description: 'Execute urgent hotfixes with minimal blast radius and explicit audit evidence.',
    primitiveIds: [
      'tp_incident_timeline',
      'tp_root_cause',
      'tp_min_repro',
      'tp_change_impact',
      'tp_risk_scan',
      'tp_verify_plan',
      'tp_evidence_pack',
      'tp_artifact_envelope',
    ],
    operators: [
      {
        id: 'op_hotfix_risk_gate',
        type: 'gate',
        label: 'Gate deployment on blast-radius and verification risk',
        inputs: ['tp_change_impact', 'tp_risk_scan', 'tp_verify_plan'],
        conditions: ['blast radius unknown', 'verification incomplete', 'critical risk open'],
      },
      {
        id: 'op_hotfix_audit_checkpoint',
        type: 'checkpoint',
        label: 'Capture auditable evidence before completion',
        inputs: ['tp_evidence_pack'],
        outputs: ['tp_artifact_envelope'],
      },
    ],
    relationships: buildSequentialRelationships([
      'tp_incident_timeline',
      'tp_root_cause',
      'tp_min_repro',
      'tp_change_impact',
      'tp_risk_scan',
      'tp_verify_plan',
      'tp_evidence_pack',
      'tp_artifact_envelope',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_evidence_pack_pipeline',
    name: 'Evidence pack pipeline',
    description: 'Collect, validate, and package evidence with provenance.',
    primitiveIds: [
      'tp_source_extraction',
      'tp_research_evidence_pack',
      'tp_evidence_pack',
      'tp_artifact_envelope',
      'tp_artifact_versioning',
      'tp_replay_pack',
    ],
    operators: [
      {
        id: 'op_evidence_gate',
        type: 'gate',
        label: 'Evidence completeness gate',
        inputs: [
          'tp_source_extraction',
          'tp_research_evidence_pack',
          'tp_evidence_pack',
          'tp_artifact_envelope',
          'tp_artifact_versioning',
        ],
        outputs: ['tp_replay_pack'],
        conditions: ['missing evidence', 'invalid envelope'],
      },
    ],
    relationships: buildSequentialRelationships([
      'tp_source_extraction',
      'tp_research_evidence_pack',
      'tp_evidence_pack',
      'tp_artifact_envelope',
      'tp_artifact_versioning',
      'tp_replay_pack',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_security_safety_core',
    name: 'Security and safety core',
    description: 'Baseline safety checks and policy enforcement for execution.',
    primitiveIds: [
      'tp_provider_probe',
      'tp_capability_probe',
      'tp_prompt_injection_scan',
      'tp_secret_scan',
      'tp_path_containment',
      'tp_git_sanitization',
      'tp_policy_enforcement',
    ],
    operators: [
      {
        id: 'op_security_gate',
        type: 'gate',
        label: 'Safety gate',
        inputs: [
          'tp_provider_probe',
          'tp_capability_probe',
          'tp_prompt_injection_scan',
          'tp_secret_scan',
          'tp_path_containment',
          'tp_git_sanitization',
        ],
        outputs: ['tp_policy_enforcement'],
        conditions: ['unsafe findings', 'policy violations'],
      },
    ],
    relationships: buildSequentialRelationships([
      'tp_provider_probe',
      'tp_capability_probe',
      'tp_prompt_injection_scan',
      'tp_secret_scan',
      'tp_path_containment',
      'tp_git_sanitization',
      'tp_policy_enforcement',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_governance_durability',
    name: 'Governance and durability',
    description: 'Budgeted execution with durable checkpoints and compliance gates.',
    primitiveIds: [
      'tp_execution_budgeting',
      'tp_durable_execution',
      'tp_run_event_log',
      'tp_stage_compliance',
      'tp_gating_rules',
      'tp_replay_pack',
    ],
    operators: [
      {
        id: 'op_governance_gate',
        type: 'gate',
        label: 'Governance gate',
        inputs: [
          'tp_execution_budgeting',
          'tp_durable_execution',
          'tp_run_event_log',
          'tp_stage_compliance',
          'tp_gating_rules',
        ],
        outputs: ['tp_replay_pack'],
        conditions: ['missing gates', 'compliance failures'],
      },
    ],
    relationships: buildSequentialRelationships([
      'tp_execution_budgeting',
      'tp_durable_execution',
      'tp_run_event_log',
      'tp_stage_compliance',
      'tp_gating_rules',
      'tp_replay_pack',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_multi_agent_coordination',
    name: 'Multi-agent coordination',
    description: 'Coordinate multi-agent work with shared state, leases, and arbitration.',
    primitiveIds: [
      'tp_ote_rubric_planning',
      'tp_blackboard_coordination',
      'tp_contract_net_leasing',
      'tp_worktree_isolation',
      'tp_arbitration',
      'tp_byzantine_consensus',
    ],
    relationships: buildSequentialRelationships([
      'tp_ote_rubric_planning',
      'tp_blackboard_coordination',
      'tp_contract_net_leasing',
      'tp_worktree_isolation',
      'tp_arbitration',
      'tp_byzantine_consensus',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_architecture_assurance',
    name: 'Architecture assurance',
    description: 'Map architecture, validate invariants, and track impact.',
    primitiveIds: [
      'tp_repo_map',
      'tp_arch_mapping',
      'tp_dependency_map',
      'tp_arch_invariant_scan',
      'tp_data_invariants',
      'tp_ownership_hints',
      'tp_change_impact',
    ],
    relationships: buildSequentialRelationships([
      'tp_repo_map',
      'tp_arch_mapping',
      'tp_dependency_map',
      'tp_arch_invariant_scan',
      'tp_data_invariants',
      'tp_ownership_hints',
      'tp_change_impact',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_external_project_intake',
    name: 'External project intake',
    description: 'Validate external inputs and capture compliance evidence.',
    primitiveIds: [
      'tp_provider_probe',
      'tp_capability_probe',
      'tp_git_sanitization',
      'tp_path_containment',
      'tp_external_project_protocol',
      'tp_stage_compliance',
      'tp_gating_rules',
      'tp_evidence_pack',
    ],
    relationships: buildSequentialRelationships([
      'tp_provider_probe',
      'tp_capability_probe',
      'tp_git_sanitization',
      'tp_path_containment',
      'tp_external_project_protocol',
      'tp_stage_compliance',
      'tp_gating_rules',
      'tp_evidence_pack',
    ]),
  }),
  createTechniqueComposition({
    id: 'tc_social_platform',
    name: 'Social platform analysis',
    description: 'Understand and modify social platform codebases.',
    primitiveIds: [
      'tp_algorithm_trace',
      'tp_policy_verify',
      'tp_metric_trace',
      'tp_realtime_flow',
      'tp_state_trace',
      'tp_data_lineage',
    ],
    operators: [
      {
        id: 'op_social_parallel_algo_policy',
        type: 'parallel',
        label: 'Parallel ranking + policy analysis',
        inputs: ['tp_algorithm_trace', 'tp_policy_verify'],
      },
      {
        id: 'op_social_sequence_metric_realtime',
        type: 'sequence',
        label: 'Trace metrics before realtime flows',
        inputs: ['tp_metric_trace', 'tp_realtime_flow'],
      },
    ],
  }),
  createTechniqueComposition({
    id: 'tc_video_platform',
    name: 'Video platform analysis',
    description: 'Understand and modify video platform codebases.',
    primitiveIds: [
      'tp_media_pipeline',
      'tp_algorithm_trace',
      'tp_distribution_map',
      'tp_metric_trace',
      'tp_data_lineage',
      'tp_timing_bound',
    ],
    operators: [
      {
        id: 'op_video_sequence_media_distribution',
        type: 'sequence',
        label: 'Sequence media processing into distribution',
        inputs: ['tp_media_pipeline', 'tp_distribution_map'],
      },
      {
        id: 'op_video_parallel_algo_metric',
        type: 'parallel',
        label: 'Parallel ranking + metric analysis',
        inputs: ['tp_algorithm_trace', 'tp_metric_trace'],
      },
    ],
  }),
  createTechniqueComposition({
    id: 'tc_industrial_backend',
    name: 'Industrial backend analysis',
    description: 'Understand and modify high-scale backend systems.',
    primitiveIds: [
      'tp_scale_pattern',
      'tp_distribution_map',
      'tp_timing_bound',
      'tp_state_trace',
      'tp_realtime_flow',
      'tp_data_lineage',
    ],
    operators: [
      {
        id: 'op_industrial_parallel_scale_distribution',
        type: 'parallel',
        label: 'Parallel scale + distribution analysis',
        inputs: ['tp_scale_pattern', 'tp_distribution_map'],
      },
      {
        id: 'op_industrial_gate_latency_state',
        type: 'gate',
        label: 'Gate on latency + state integrity',
        inputs: ['tp_timing_bound', 'tp_state_trace'],
        conditions: ['latency budget breach', 'state inconsistency'],
      },
    ],
  }),
  createTechniqueComposition({
    id: 'tc_developer_tool',
    name: 'Developer tool analysis',
    description: 'Understand and modify developer tools and AI assistants.',
    primitiveIds: [
      'tp_tool_orchestration',
      'tp_data_lineage',
      'tp_algorithm_trace',
      'tp_state_trace',
      'tp_timing_bound',
      'tp_component_graph',
    ],
    operators: [
      {
        id: 'op_dev_sequence_tool_lineage',
        type: 'sequence',
        label: 'Sequence orchestration into lineage',
        inputs: ['tp_tool_orchestration', 'tp_data_lineage'],
      },
      {
        id: 'op_dev_parallel_algo_state',
        type: 'parallel',
        label: 'Parallel algorithm + state analysis',
        inputs: ['tp_algorithm_trace', 'tp_state_trace'],
      },
    ],
  }),
  createTechniqueComposition({
    id: 'tc_dashboard',
    name: 'Dashboard analysis',
    description: 'Understand and modify dashboard applications.',
    primitiveIds: [
      'tp_component_graph',
      'tp_data_lineage',
      'tp_realtime_flow',
      'tp_policy_verify',
      'tp_metric_trace',
    ],
    operators: [
      {
        id: 'op_dashboard_sequence_lineage_component',
        type: 'sequence',
        label: 'Sequence data lineage into components',
        inputs: ['tp_data_lineage', 'tp_component_graph'],
      },
      {
        id: 'op_dashboard_parallel_realtime_policy',
        type: 'parallel',
        label: 'Parallel realtime + policy checks',
        inputs: ['tp_realtime_flow', 'tp_policy_verify'],
      },
    ],
  }),
  createTechniqueComposition({
    id: 'tc_landing_page',
    name: 'Landing page analysis',
    description: 'Understand and optimize marketing/landing pages.',
    primitiveIds: [
      'tp_component_graph',
      'tp_metric_trace',
      'tp_artifact_trace',
      'tp_timing_bound',
      'tp_data_lineage',
    ],
    operators: [
      {
        id: 'op_landing_parallel_component_artifact',
        type: 'parallel',
        label: 'Parallel component + artifact tracing',
        inputs: ['tp_component_graph', 'tp_artifact_trace'],
      },
      {
        id: 'op_landing_sequence_metric_timing',
        type: 'sequence',
        label: 'Sequence metric tracing into timing bounds',
        inputs: ['tp_metric_trace', 'tp_timing_bound'],
      },
    ],
  }),
  createTechniqueComposition({
    id: 'tc_payment_system',
    name: 'Payment system analysis',
    description: 'Understand and modify payment/transaction systems.',
    primitiveIds: [
      'tp_state_trace',
      'tp_policy_verify',
      'tp_data_lineage',
      'tp_timing_bound',
      'tp_scale_pattern',
    ],
    operators: [
      {
        id: 'op_payment_sequence_state_policy',
        type: 'sequence',
        label: 'Sequence state tracing into policy verification',
        inputs: ['tp_state_trace', 'tp_policy_verify'],
      },
      {
        id: 'op_payment_audit_gate',
        type: 'gate',
        label: 'Audit gate on transaction lineage',
        inputs: ['tp_data_lineage'],
        outputs: ['tp_timing_bound'],
        conditions: ['missing audit trail', 'policy violations'],
        parameters: { requiresAudit: true },
      },
    ],
  }),
  createTechniqueComposition({
    id: 'tc_e_commerce',
    name: 'E-commerce analysis',
    description: 'Understand and optimize commerce flows and conversion.',
    primitiveIds: [
      'tp_metric_trace',
      'tp_state_trace',
      'tp_data_lineage',
      'tp_policy_verify',
      'tp_realtime_flow',
    ],
    operators: [
      {
        id: 'op_ecom_parallel_metric_policy',
        type: 'parallel',
        label: 'Parallel conversion metrics + policy checks',
        inputs: ['tp_metric_trace', 'tp_policy_verify'],
      },
      {
        id: 'op_ecom_sequence_state_realtime',
        type: 'sequence',
        label: 'Sequence state tracing into realtime flows',
        inputs: ['tp_state_trace', 'tp_realtime_flow'],
      },
    ],
  }),
  createTechniqueComposition({
    id: 'tc_search_system',
    name: 'Search system analysis',
    description: 'Understand ranking, indexing, and query performance.',
    primitiveIds: [
      'tp_algorithm_trace',
      'tp_data_lineage',
      'tp_timing_bound',
      'tp_distribution_map',
    ],
    operators: [
      {
        id: 'op_search_sequence_lineage_algo',
        type: 'sequence',
        label: 'Sequence lineage into algorithm tracing',
        inputs: ['tp_data_lineage', 'tp_algorithm_trace'],
      },
      {
        id: 'op_search_parallel_algo_timing',
        type: 'parallel',
        label: 'Parallel algorithm + timing analysis',
        inputs: ['tp_algorithm_trace', 'tp_timing_bound'],
      },
    ],
  }),
  createTechniqueComposition({
    id: 'tc_notification',
    name: 'Notification system analysis',
    description: 'Understand notification triggers and delivery paths.',
    primitiveIds: [
      'tp_realtime_flow',
      'tp_state_trace',
      'tp_distribution_map',
      'tp_data_lineage',
    ],
    operators: [
      {
        id: 'op_notification_sequence_realtime_state',
        type: 'sequence',
        label: 'Sequence realtime flow into state tracing',
        inputs: ['tp_realtime_flow', 'tp_state_trace'],
      },
      {
        id: 'op_notification_parallel_realtime_distribution',
        type: 'parallel',
        label: 'Parallel realtime + distribution mapping',
        inputs: ['tp_realtime_flow', 'tp_distribution_map'],
      },
    ],
  }),
];

export const DEFAULT_TECHNIQUE_COMPOSITIONS_BY_ID = new Map(
  DEFAULT_TECHNIQUE_COMPOSITIONS.map((item) => [item.id, item])
);

export async function ensureTechniqueCompositions(
  storage: LibrarianStorage,
  options?: { overwrite?: boolean }
): Promise<TechniqueComposition[]> {
  assertCompositionReferences({
    compositions: DEFAULT_TECHNIQUE_COMPOSITIONS,
    primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
  });
  const existing = await listTechniqueCompositions(storage);
  const defaultsById = DEFAULT_TECHNIQUE_COMPOSITIONS_BY_ID;

  if (options?.overwrite) {
    for (const composition of existing) {
      if (!defaultsById.has(composition.id)) {
        await deleteTechniqueComposition(storage, composition.id);
      }
    }
    for (const composition of DEFAULT_TECHNIQUE_COMPOSITIONS) {
      await saveTechniqueComposition(storage, composition);
    }
    return listTechniqueCompositions(storage);
  }

  if (existing.length === 0) {
    for (const composition of DEFAULT_TECHNIQUE_COMPOSITIONS) {
      await saveTechniqueComposition(storage, composition);
    }
    return listTechniqueCompositions(storage);
  }

  const existingIds = new Set(existing.map((item) => item.id));
  let added = false;
  for (const composition of DEFAULT_TECHNIQUE_COMPOSITIONS) {
    if (!existingIds.has(composition.id)) {
      await saveTechniqueComposition(storage, composition);
      added = true;
    }
  }
  return added ? listTechniqueCompositions(storage) : existing;
}

export function validateTechniqueComposition(
  composition: TechniqueComposition,
  primitives: TechniquePrimitive[]
): { valid: boolean; missingPrimitiveIds: string[] } {
  const primitiveIds = new Set(primitives.map((primitive) => primitive.id));
  const missingPrimitiveIds = composition.primitiveIds.filter((id) => !primitiveIds.has(id));
  return {
    valid: missingPrimitiveIds.length === 0,
    missingPrimitiveIds,
  };
}
