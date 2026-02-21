import { describe, it, expect, beforeEach } from 'vitest';
import {
  ensureTechniqueCompositions,
  DEFAULT_TECHNIQUE_COMPOSITIONS,
  validateTechniqueComposition,
  assertCompositionReferences,
} from '../technique_compositions.js';
import { DEFAULT_TECHNIQUE_PRIMITIVES } from '../technique_library.js';
import {
  listTechniqueCompositions,
  saveTechniqueComposition,
} from '../../state/technique_compositions.js';
import {
  createTechniqueComposition,
  createTechniquePrimitive,
  type TechniqueRelationship,
} from '../../strategic/techniques.js';
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

describe('technique composition seeding', () => {
  let storage: MockStorage;

  beforeEach(() => {
    storage = new MockStorage();
  });

  it('seeds defaults when store is empty', async () => {
    const seeded = await ensureTechniqueCompositions(storage as unknown as LiBrainianStorage);
    expect(seeded.length).toBe(DEFAULT_TECHNIQUE_COMPOSITIONS.length);
    expect(seeded.map((item) => item.id)).toEqual(
      expect.arrayContaining([DEFAULT_TECHNIQUE_COMPOSITIONS[0]!.id])
    );
  });

  it('adds missing defaults without overwriting existing compositions', async () => {
    const custom = createTechniqueComposition({
      id: 'tc-custom',
      name: 'Custom composition',
      description: 'Custom description',
      primitiveIds: ['tp_root_cause'],
    });
    await saveTechniqueComposition(storage as unknown as LiBrainianStorage, custom);

    const seeded = await ensureTechniqueCompositions(storage as unknown as LiBrainianStorage);
    const ids = seeded.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining(['tc-custom']));
    expect(seeded.length).toBe(DEFAULT_TECHNIQUE_COMPOSITIONS.length + 1);
  });

  it('overwrites with defaults when overwrite=true', async () => {
    const custom = createTechniqueComposition({
      id: 'tc-custom',
      name: 'Custom composition',
      description: 'Custom description',
      primitiveIds: ['tp_root_cause'],
    });
    await saveTechniqueComposition(storage as unknown as LiBrainianStorage, custom);

    const seeded = await ensureTechniqueCompositions(storage as unknown as LiBrainianStorage, { overwrite: true });
    const ids = seeded.map((item) => item.id);

    expect(ids).not.toContain('tc-custom');
    expect(seeded.length).toBe(DEFAULT_TECHNIQUE_COMPOSITIONS.length);
  });

  it('returns stored compositions when nothing changes', async () => {
    await ensureTechniqueCompositions(storage as unknown as LiBrainianStorage);
    const list = await listTechniqueCompositions(storage as unknown as LiBrainianStorage);
    const seeded = await ensureTechniqueCompositions(storage as unknown as LiBrainianStorage);
    expect(seeded).toEqual(list);
  });

  it('includes core composition presets', () => {
    const defaultIds = DEFAULT_TECHNIQUE_COMPOSITIONS.map((item) => item.id);
    expect(defaultIds).toEqual(expect.arrayContaining([
      'tc_agentic_review_v1',
      'tc_root_cause_recovery',
      'tc_release_readiness',
      'tc_repo_rehab_triage',
      'tc_performance_reliability',
      'tc_security_review',
      'tc_ux_discovery',
      'tc_scaling_readiness',
      'tc_social_platform',
      'tc_video_platform',
      'tc_industrial_backend',
      'tc_developer_tool',
      'tc_dashboard',
      'tc_landing_page',
      'tc_payment_system',
      'tc_e_commerce',
      'tc_search_system',
      'tc_notification',
    ]));
  });

  it('reports missing primitives for a composition', () => {
    const composition = createTechniqueComposition({
      id: 'tc-missing',
      name: 'Missing primitives',
      description: 'Uses primitives not in the library',
      primitiveIds: ['tp_missing_one', 'tp_existing'],
    });
    const primitives = [
      createTechniquePrimitive({
        id: 'tp_existing',
        name: 'Existing',
        intent: 'Present in library',
      }),
    ];

    const result = validateTechniqueComposition(composition, primitives);
    expect(result.valid).toBe(false);
    expect(result.missingPrimitiveIds).toEqual(['tp_missing_one']);
  });

  it('validates default compositions against the default primitive catalog', () => {
    for (const composition of DEFAULT_TECHNIQUE_COMPOSITIONS) {
      const validation = validateTechniqueComposition(composition, DEFAULT_TECHNIQUE_PRIMITIVES);
      expect(validation.valid).toBe(true);
      expect(validation.missingPrimitiveIds).toEqual([]);

      const nodeIds = new Set([
        ...composition.primitiveIds,
        ...(composition.operators ?? []).map((operator) => operator.id),
      ]);

      for (const operator of composition.operators ?? []) {
        for (const input of operator.inputs ?? []) {
          expect(nodeIds.has(input)).toBe(true);
        }
        for (const output of operator.outputs ?? []) {
          expect(nodeIds.has(output)).toBe(true);
        }
      }

      for (const relationship of composition.relationships ?? []) {
        expect(nodeIds.has(relationship.fromId)).toBe(true);
        expect(nodeIds.has(relationship.toId)).toBe(true);
      }
    }
  });

  it('defines building block compositions with sequential relationships', () => {
    const buildingBlocks = [
      'tc_multi_agent_coordination',
      'tc_architecture_assurance',
      'tc_external_project_intake',
    ];

    for (const id of buildingBlocks) {
      const composition = DEFAULT_TECHNIQUE_COMPOSITIONS.find((item) => item.id === id);
      expect(composition).toBeDefined();
      if (!composition) continue;

      const expectedPairs = composition.primitiveIds.slice(1).map((primitiveId, index) => ({
        fromId: composition.primitiveIds[index],
        toId: primitiveId,
      }));
      const actualPairs = (composition.relationships ?? []).map((relationship) => ({
        fromId: relationship.fromId,
        toId: relationship.toId,
      }));

      expect(actualPairs).toEqual(expectedPairs);
      expect(actualPairs.length).toBe(composition.primitiveIds.length - 1);
    }
  });

  it('asserts referential integrity for default compositions', () => {
    expect(() => assertCompositionReferences({
      compositions: DEFAULT_TECHNIQUE_COMPOSITIONS,
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).not.toThrow();
  });

  it('allows missing primitives when explicitly permitted', () => {
    const composition = createTechniqueComposition({
      id: 'tc-allow-missing',
      name: 'Allow missing primitives',
      description: 'Permissive validation for missing primitives',
      primitiveIds: ['tp_missing'],
    });
    expect(() => assertCompositionReferences(
      { compositions: [composition], primitives: DEFAULT_TECHNIQUE_PRIMITIVES },
      { allowMissingPrimitives: true }
    )).not.toThrow();
  });

  it('throws on invalid graph version', () => {
    const composition = createTechniqueComposition({
      id: 'tc-invalid-graph',
      name: 'Invalid graph version',
      description: 'Graph version must be 1 or 2',
      primitiveIds: ['tp_root_cause'],
      graphVersion: 2,
    });
    (composition as { graphVersion: number }).graphVersion = 3;
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_graph_version_invalid/);
  });

  it('permits legacy relationships to edge operators', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-legacy',
      name: 'Legacy edge operator relationships',
      description: 'Legacy graph allows relationships to edge operators',
      primitiveIds: ['tp_root_cause'],
      graphVersion: 1,
      operators: [
        {
          id: 'op_sequence',
          type: 'sequence',
          inputs: ['tp_root_cause'],
        },
      ],
      relationships: [
        {
          fromId: 'op_sequence',
          toId: 'tp_root_cause',
          type: 'depends_on',
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).not.toThrow();
  });

  it('rejects edge operator relationships in graph v2', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-v2',
      name: 'Edge operator relationships v2',
      description: 'Graph v2 disallows relationships to edge operators',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op_sequence',
          type: 'sequence',
          inputs: ['tp_root_cause'],
        },
      ],
      relationships: [
        {
          fromId: 'op_sequence',
          toId: 'tp_root_cause',
          type: 'depends_on',
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_relationship_edge_operator/);
  });

  it('throws when primitive references are missing', () => {
    const composition = createTechniqueComposition({
      id: 'tc-missing-primitive',
      name: 'Missing primitive',
      description: 'References a missing primitive',
      primitiveIds: ['tp_missing_primitive'],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_missing_primitives/);
  });

  it('throws when composition ids are invalid', () => {
    const composition = createTechniqueComposition({
      id: 'tc invalid',
      name: 'Invalid id',
      description: 'Invalid id format',
      primitiveIds: ['tp_root_cause'],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/invalid_composition_id/);
  });

  it('throws when primitive ids are invalid', () => {
    const composition = createTechniqueComposition({
      id: 'tc-invalid-primitive',
      name: 'Invalid primitive id',
      description: 'Invalid primitive id format',
      primitiveIds: ['tp_root_cause', 'tp bad'],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/invalid_primitive_id/);
  });

  it('throws when primitive ids are not an array', () => {
    const composition = createTechniqueComposition({
      id: 'tc-invalid-primitive-array',
      name: 'Invalid primitive list',
      description: 'Primitive list must be array',
      primitiveIds: ['tp_root_cause'],
    });
    (composition as unknown as { primitiveIds: string[] | undefined }).primitiveIds = undefined;
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_primitives_invalid/);
  });

  it('throws when operators are not arrays', () => {
    const composition = createTechniqueComposition({
      id: 'tc-invalid-operators-array',
      name: 'Invalid operators list',
      description: 'Operators must be array',
      primitiveIds: ['tp_root_cause'],
    });
    (composition as unknown as { operators?: unknown }).operators = {};
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_operators_invalid/);
  });

  it('throws when relationships are not arrays', () => {
    const composition = createTechniqueComposition({
      id: 'tc-invalid-relationships-array',
      name: 'Invalid relationships list',
      description: 'Relationships must be array',
      primitiveIds: ['tp_root_cause'],
    });
    (composition as unknown as { relationships?: unknown }).relationships = {};
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_relationships_invalid/);
  });

  it('throws when relationship type is missing', () => {
    const composition = createTechniqueComposition({
      id: 'tc-relationship-missing-type',
      name: 'Relationship missing type',
      description: 'Relationship must include a type',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      relationships: [
        {
          fromId: 'tp_root_cause',
          toId: 'tp_min_repro',
        } as unknown as TechniqueRelationship,
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/relationship_missing_type/);
  });

  it('throws when relationship endpoints are missing', () => {
    const composition = createTechniqueComposition({
      id: 'tc-relationship-missing-endpoints',
      name: 'Relationship missing endpoints',
      description: 'Relationship must include from/to identifiers',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      relationships: [
        {
          type: 'depends_on',
          toId: 'tp_min_repro',
        } as unknown as TechniqueRelationship,
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/relationship_missing_from/);
  });

  it('throws when relationship condition or weight is invalid', () => {
    const composition = createTechniqueComposition({
      id: 'tc-relationship-invalid-fields',
      name: 'Relationship invalid fields',
      description: 'Relationship condition and weight must be valid types',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      relationships: [
        {
          fromId: 'tp_root_cause',
          toId: 'tp_min_repro',
          type: 'depends_on',
          condition: 4 as unknown as string,
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/relationship_condition_invalid/);

    const emptyCondition = createTechniqueComposition({
      id: 'tc-relationship-empty-condition',
      name: 'Relationship empty condition',
      description: 'Relationship condition must be non-empty',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      relationships: [
        {
          fromId: 'tp_root_cause',
          toId: 'tp_min_repro',
          type: 'depends_on',
          condition: '',
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [emptyCondition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/relationship_condition_invalid/);

    const weighted = createTechniqueComposition({
      id: 'tc-relationship-invalid-weight',
      name: 'Relationship invalid weight',
      description: 'Relationship weight must be numeric',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      relationships: [
        {
          fromId: 'tp_root_cause',
          toId: 'tp_min_repro',
          type: 'depends_on',
          weight: 'high' as unknown as number,
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [weighted],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/relationship_weight_invalid/);
  });

  it('throws when relationship semantics are missing', () => {
    const composition = createTechniqueComposition({
      id: 'tc-relationship-semantics-missing',
      name: 'Relationship semantics missing',
      description: 'Custom relationship type missing semantics',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      relationships: [
        {
          fromId: 'tp_root_cause',
          toId: 'tp_min_repro',
          type: 'custom:unknown',
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/relationship_semantics_missing/);
  });

  it('throws when operator references are missing', () => {
    const composition = createTechniqueComposition({
      id: 'tc-missing-operator-ref',
      name: 'Missing operator ref',
      description: 'Operator references missing nodes',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-missing-ref',
          type: 'gate',
          inputs: ['tp_missing_node'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_missing_operator_refs/);
  });

  it('throws when operator input/output constraints are violated', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-constraints',
      name: 'Operator constraints',
      description: 'Operator violates constraints',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      operators: [
        {
          id: 'op-too-few-inputs',
          type: 'parallel',
          inputs: ['tp_root_cause'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_missing_inputs/);
  });

  it('throws when operator output constraints are violated', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-output-constraints',
      name: 'Operator output constraints',
      description: 'Operator violates output constraints',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      operators: [
        {
          id: 'op-missing-output',
          type: 'fanin',
          inputs: ['tp_root_cause', 'tp_min_repro'],
          outputs: [],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_missing_outputs/);
  });

  it('throws when operator has too many inputs', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-too-many-inputs',
      name: 'Operator too many inputs',
      description: 'Operator violates max input constraint',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      operators: [
        {
          id: 'op-fanout',
          type: 'fanout',
          inputs: ['tp_root_cause', 'tp_min_repro'],
          outputs: ['tp_root_cause'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_too_many_inputs/);
  });

  it('throws when operator has too many outputs', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-too-many-outputs',
      name: 'Operator too many outputs',
      description: 'Operator violates max output constraint',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      operators: [
        {
          id: 'op-merge',
          type: 'merge',
          inputs: ['tp_root_cause', 'tp_min_repro'],
          outputs: ['tp_root_cause', 'tp_min_repro'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_too_many_outputs/);
  });

  it('throws when operator conditions are required but missing', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-missing-conditions',
      name: 'Operator missing conditions',
      description: 'Conditional operator missing conditions',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-conditional',
          type: 'conditional',
          inputs: ['tp_root_cause'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_missing_conditions/);
  });

  it('throws when operator conditions are not arrays', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-conditions-invalid',
      name: 'Operator conditions invalid',
      description: 'Operator conditions must be arrays',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-conditional',
          type: 'conditional',
          inputs: ['tp_root_cause'],
          conditions: 'signal present' as unknown as string[],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_conditions_invalid/);
  });

  it('throws when operator conditions include empty values', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-conditions-empty',
      name: 'Operator conditions empty',
      description: 'Operator conditions must be non-empty strings',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-conditional',
          type: 'conditional',
          inputs: ['tp_root_cause'],
          conditions: ['has_signal', ''],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_conditions_invalid/);
  });

  it('throws when operator conditions exceed the limit', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-conditions-excessive',
      name: 'Operator conditions excessive',
      description: 'Operator conditions must be bounded',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-conditional',
          type: 'conditional',
          inputs: ['tp_root_cause'],
          conditions: Array.from({ length: 101 }, (_, index) => `cond-${index}`),
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_conditions_excessive/);
  });

  it('throws when operator parameters are not objects', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-parameters-invalid',
      name: 'Operator parameters invalid',
      description: 'Operator parameters must be objects',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-retry',
          type: 'retry',
          inputs: ['tp_root_cause'],
          conditions: ['needs retry'],
          parameters: ['not', 'object'] as unknown as Record<string, unknown>,
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_parameters_invalid/);
  });

  it('throws when required operator parameters are missing', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-parameters-missing',
      name: 'Operator parameters missing',
      description: 'Operator requires parameters but none provided',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-timebox',
          type: 'timebox',
          inputs: ['tp_root_cause'],
          conditions: ['deadline required'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_parameters_missing/);
  });

  it('throws when operator type is missing', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-missing-type',
      name: 'Operator missing type',
      description: 'Operator lacks a type',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-missing-type',
          type: undefined as unknown as 'gate',
          inputs: ['tp_root_cause'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_missing_type/);
  });

  it('throws when operator type is unknown', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-unknown-type',
      name: 'Operator unknown type',
      description: 'Operator uses an unknown type',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-unknown-type',
          type: 'tp_not_real' as unknown as 'gate',
          inputs: ['tp_root_cause'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_unknown_type/);
  });

  it('throws when operator inputs are not arrays', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-inputs-invalid',
      name: 'Operator inputs invalid',
      description: 'Operator inputs must be arrays',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-invalid-inputs',
          type: 'gate',
          inputs: 'tp_root_cause' as unknown as string[],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_inputs_invalid/);
  });

  it('throws when operator inputs contain non-string values', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-inputs-non-string',
      name: 'Operator inputs non-string',
      description: 'Operator inputs must be strings',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-inputs-non-string',
          type: 'gate',
          inputs: ['tp_root_cause', 123 as unknown as string],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_inputs_non_string/);
  });

  it('throws when operator inputs contain empty strings', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-inputs-empty',
      name: 'Operator inputs empty',
      description: 'Operator inputs cannot be empty',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-inputs-empty',
          type: 'gate',
          inputs: [''],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/operator_inputs_empty/);
  });

  it('throws when operator inputs have invalid id format', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-inputs-invalid-id',
      name: 'Operator inputs invalid id',
      description: 'Operator inputs must follow id format',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'op-inputs-invalid-id',
          type: 'gate',
          inputs: ['tp bad'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/invalid_operator_input_id/);
  });

  it('throws when operator ids collide with primitive ids', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-id-collision',
      name: 'Operator id collision',
      description: 'Operator id overlaps with a primitive id',
      primitiveIds: ['tp_root_cause'],
      operators: [
        {
          id: 'tp_root_cause',
          type: 'gate',
          inputs: ['tp_root_cause'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_operator_id_collision/);
  });

  it('throws when operator ids are duplicated', () => {
    const composition = createTechniqueComposition({
      id: 'tc-operator-id-duplicate',
      name: 'Operator id duplicate',
      description: 'Operator ids are not unique',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      operators: [
        {
          id: 'op-duplicate',
          type: 'gate',
          inputs: ['tp_root_cause'],
          outputs: ['tp_min_repro'],
        },
        {
          id: 'op-duplicate',
          type: 'gate',
          inputs: ['tp_root_cause'],
          outputs: ['tp_min_repro'],
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_duplicate_operator_ids/);
  });

  it('throws when relationships reference edge operators', () => {
    const composition = createTechniqueComposition({
      id: 'tc-edge-relationship',
      name: 'Edge operator relationship',
      description: 'Edge operator should not be referenced by relationships',
      primitiveIds: ['tp_root_cause', 'tp_min_repro'],
      operators: [
        {
          id: 'op-parallel',
          type: 'parallel',
          inputs: ['tp_root_cause', 'tp_min_repro'],
        },
      ],
      relationships: [
        {
          fromId: 'op-parallel',
          toId: 'tp_root_cause',
          type: 'depends_on',
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_relationship_edge_operator/);
  });

  it('throws when relationship references are missing', () => {
    const composition = createTechniqueComposition({
      id: 'tc-missing-relationship-ref',
      name: 'Missing relationship ref',
      description: 'Relationship references missing nodes',
      primitiveIds: ['tp_root_cause'],
      relationships: [
        {
          fromId: 'tp_root_cause',
          toId: 'tp_missing_node',
          type: 'depends_on',
        },
      ],
    });
    expect(() => assertCompositionReferences({
      compositions: [composition],
      primitives: DEFAULT_TECHNIQUE_PRIMITIVES,
    })).toThrow(/composition_missing_relationship_refs/);
  });
});
