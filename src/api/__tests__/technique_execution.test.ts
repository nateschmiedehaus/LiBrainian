import { describe, it, expect, vi } from 'vitest';
import {
  createTechniquePrimitive,
  type TechniqueOperator,
  type TechniqueRelationship,
} from '../../strategic/techniques.js';
import {
  InMemoryExecutionCheckpointStore,
  TechniqueExecutionEngine,
  createLlmPrimitiveExecutor,
} from '../technique_execution.js';
import type { PrimitiveExecutionHandler } from '../technique_execution.js';
import type { LlmServiceAdapter } from '../../adapters/llm_service.js';

vi.mock('../provider_check.js', () => ({
  requireProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../llm_env.js', async () => {
  const actual = await vi.importActual<typeof import('../llm_env.js')>('../llm_env.js');
  return {
    ...actual,
    resolveLiBrainianModelConfigWithDiscovery: vi.fn().mockResolvedValue({
      provider: 'claude',
      modelId: 'test-model',
    }),
  };
});

describe('technique execution engine', () => {
  it('fails input validation and skips handlers', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_input',
      name: 'Exec input',
      intent: 'Execute input',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    let called = false;
    const handler = async () => {
      called = true;
      return { output: { result: 'ok' } };
    };
    const engine = new TechniqueExecutionEngine({
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, handler]]),
    });

    const result = await engine.executePrimitive(primitive, {}, {});
    expect(called).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'contract_input_missing_required')).toBe(true);
  });

  it('executes handlers and validates outputs', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_ok',
      name: 'Exec ok',
      intent: 'Execute ok',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const engine = new TechniqueExecutionEngine({
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async ({ input }) => ({
        output: { result: `${input.request}-done` },
      })]]),
    });

    const result = await engine.executePrimitive(primitive, { request: 'ping' }, {});
    expect(result.status).toBe('success');
    expect(result.output.result).toBe('ping-done');
  });

  it('executes compositions in dependency order', async () => {
    const primitiveA = createTechniquePrimitive({
      id: 'tp_exec_a',
      name: 'Exec A',
      intent: 'Execute A',
      inputsRequired: ['request'],
      outputs: ['token'],
    });
    const primitiveB = createTechniquePrimitive({
      id: 'tp_exec_b',
      name: 'Exec B',
      intent: 'Execute B',
      inputsRequired: ['token'],
      outputs: ['result'],
    });

    const primitives = new Map([
      [primitiveA.id, primitiveA],
      [primitiveB.id, primitiveB],
    ]);

    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => primitives.get(id),
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitiveA.id, async ({ input }) => ({ output: { token: `${input.request}-token` } })],
        [primitiveB.id, async ({ input }) => ({ output: { result: `${input.token}-done` } })],
      ]),
    });

    const composition = {
      id: 'tc_exec',
      name: 'Exec composition',
      description: 'Test composition order',
      primitiveIds: [primitiveB.id, primitiveA.id],
      relationships: [
        { fromId: primitiveA.id, toId: primitiveB.id, type: 'depends_on' } as TechniqueRelationship,
      ],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(composition, { request: 'hello' }, {})) {
      steps.push(step);
    }

    expect(steps.map((step) => step.primitiveId)).toEqual([primitiveA.id, primitiveB.id]);
    expect(steps[1]?.input.token).toBe('hello-token');
    expect(steps[1]?.output.result).toBe('hello-token-done');
  });

  it('executes parallel operators and merges outputs', async () => {
    const primitiveA = createTechniquePrimitive({
      id: 'tp_parallel_a',
      name: 'Parallel A',
      intent: 'Parallel A',
      outputs: ['value'],
    });
    const primitiveB = createTechniquePrimitive({
      id: 'tp_parallel_b',
      name: 'Parallel B',
      intent: 'Parallel B',
      outputs: ['value'],
    });
    const primitiveC = createTechniquePrimitive({
      id: 'tp_parallel_c',
      name: 'Parallel C',
      intent: 'Parallel C',
      inputsRequired: ['value', '__parallel_collisions', '__parallel_array_collisions'],
      outputs: ['result'],
    });

    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => [primitiveA, primitiveB, primitiveC].find((p) => p.id === id),
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitiveA.id, async () => ({ output: { value: 1 } })],
        [primitiveB.id, async () => ({ output: { value: 2 } })],
        [primitiveC.id, async ({ input }) => ({
          output: { result: Array.isArray(input.value) ? input.value.length : 0 },
        })],
      ]),
    });

    const operators: TechniqueOperator[] = [
      {
        id: 'op_parallel',
        type: 'parallel',
        inputs: [primitiveA.id, primitiveB.id],
        outputs: [primitiveC.id],
      },
    ];
    const composition = {
      id: 'tc_parallel',
      name: 'Parallel composition',
      description: 'Parallel operator merges outputs',
      primitiveIds: [primitiveA.id, primitiveB.id, primitiveC.id],
      operators,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(composition, {}, {})) {
      steps.push(step);
    }

    const finalStep = steps.find((step) => step.primitiveId === primitiveC.id);
    expect(finalStep?.input.value).toEqual([1, 2]);
    expect(finalStep?.input.__parallel_collisions).toEqual([
      { key: 'value', primitiveId: primitiveB.id },
    ]);
    expect(finalStep?.input.__parallel_array_collisions).toEqual(['value']);
    expect(finalStep?.output.result).toBe(2);
  });

  it('branches conditional operators to the matching primitive', async () => {
    const primitiveA = createTechniquePrimitive({
      id: 'tp_conditional_a',
      name: 'Conditional A',
      intent: 'Conditional A',
      outputs: ['choice'],
    });
    const primitiveB = createTechniquePrimitive({
      id: 'tp_conditional_b',
      name: 'Conditional B',
      intent: 'Conditional B',
      outputs: ['choice'],
    });
    const primitiveC = createTechniquePrimitive({
      id: 'tp_conditional_c',
      name: 'Conditional C',
      intent: 'Conditional C',
      inputsRequired: ['choice'],
      outputs: ['result'],
    });

    let ranA = 0;
    let ranB = 0;
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => [primitiveA, primitiveB, primitiveC].find((p) => p.id === id),
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitiveA.id, async () => {
          ranA += 1;
          return { output: { choice: 'a' } };
        }],
        [primitiveB.id, async () => {
          ranB += 1;
          return { output: { choice: 'b' } };
        }],
        [primitiveC.id, async ({ input }) => ({ output: { result: input.choice } })],
      ]),
    });

    const conditionalOperators: TechniqueOperator[] = [
      {
        id: 'op_conditional',
        type: 'conditional',
        inputs: [primitiveA.id, primitiveB.id],
        conditions: ['state.flag == true => tp_conditional_a'],
        parameters: { default: 'tp_conditional_b' },
      },
    ];
    const composition = {
      id: 'tc_conditional',
      name: 'Conditional composition',
      description: 'Conditional operator branches to matching primitive',
      primitiveIds: [primitiveA.id, primitiveB.id, primitiveC.id],
      operators: conditionalOperators,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(composition, { flag: true }, {})) {
      steps.push(step);
    }

    expect(ranA).toBe(1);
    expect(ranB).toBe(0);
    const finalStep = steps.find((step) => step.primitiveId === primitiveC.id);
    expect(finalStep?.output.result).toBe('a');
  });

  it('emits operator events for branching operators', async () => {
    const primitiveA = createTechniquePrimitive({
      id: 'tp_event_a',
      name: 'Event A',
      intent: 'Event A',
      outputs: ['choice'],
    });
    const primitiveB = createTechniquePrimitive({
      id: 'tp_event_b',
      name: 'Event B',
      intent: 'Event B',
      inputsRequired: ['choice'],
      outputs: ['result'],
    });
    const primitiveC = createTechniquePrimitive({
      id: 'tp_event_c',
      name: 'Event C',
      intent: 'Event C',
      outputs: ['result'],
    });

    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => [primitiveA, primitiveB, primitiveC].find((p) => p.id === id),
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitiveA.id, async () => ({ output: { choice: 'b' } })],
        [primitiveB.id, async ({ input }) => ({ output: { result: `picked-${input.choice}` } })],
        [primitiveC.id, async () => ({ output: { result: 'fallback' } })],
      ]),
    });

    const operators: TechniqueOperator[] = [
      {
        id: 'op_conditional_events',
        type: 'conditional',
        inputs: [primitiveB.id],
        outputs: [primitiveB.id, primitiveC.id],
        conditions: ['state.choice == "b" => tp_event_b'],
      },
    ];
    const composition = {
      id: 'tc_events',
      name: 'Event composition',
      description: 'Operator event emission',
      primitiveIds: [primitiveA.id, primitiveB.id, primitiveC.id],
      relationships: [
        { fromId: primitiveA.id, toId: primitiveB.id, type: 'depends_on' } as TechniqueRelationship,
        { fromId: primitiveA.id, toId: primitiveC.id, type: 'depends_on' } as TechniqueRelationship,
      ],
      operators,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const events: Array<{ type: string; detail?: Record<string, unknown> }> = [];
    for await (const _step of engine.executeComposition(
      composition,
      {},
      {},
      { onOperatorEvent: (event) => events.push(event) }
    )) {
      // drain
    }

    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain('operator_started');
    expect(eventTypes).toContain('operator_branch');
    expect(eventTypes).toContain('operator_completed');
    const branchEvent = events.find((event) => event.type === 'operator_branch');
    expect(branchEvent?.detail?.target).toBe(primitiveB.id);
  });

  it('does not emit coverage gap events for implemented operators', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_gap',
      name: 'Gap primitive',
      intent: 'Gap primitive',
      outputs: ['result'],
    });

    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitive.id, async () => ({ output: { result: 'ok' } })],
      ]),
    });

    const operators: TechniqueOperator[] = [
      {
        id: 'op_noop_gap',
        type: 'merge',
        inputs: [primitive.id],
        outputs: [primitive.id],
      },
    ];
    const composition = {
      id: 'tc_gap',
      name: 'Gap composition',
      description: 'Emit coverage gap for noop operators',
      primitiveIds: [primitive.id],
      operators,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const events: Array<{ type: string; detail?: Record<string, unknown> }> = [];
    for await (const _step of engine.executeComposition(
      composition,
      {},
      {},
      { onOperatorEvent: (event) => events.push(event) }
    )) {
      // drain
    }

    const gapEvent = events.find((event) => event.type === 'operator_coverage_gap');
    expect(gapEvent).toBeUndefined();
  });

  it('loops primitives until conditions are met', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_loop',
      name: 'Loop primitive',
      intent: 'Loop primitive',
      inputsRequired: ['count'],
      outputs: ['count'],
    });

    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitive.id, async ({ input }) => ({
          output: { count: (input.count as number) + 1 },
        })],
      ]),
    });

    const loopOperators: TechniqueOperator[] = [
      {
        id: 'op_loop',
        type: 'loop',
        inputs: [primitive.id],
        conditions: ['state.count >= 2'],
        parameters: { maxIterations: 5 },
      },
    ];
    const composition = {
      id: 'tc_loop',
      name: 'Loop composition',
      description: 'Loop until count threshold met',
      primitiveIds: [primitive.id],
      operators: loopOperators,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(composition, { count: 0 }, {})) {
      steps.push(step);
    }

    expect(steps.length).toBe(2);
    expect(steps[0]?.output.count).toBe(1);
    expect(steps[1]?.output.count).toBe(2);
  });

  it('rejects composition inputs with forbidden keys', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_input_guard',
      name: 'Exec input guard',
      intent: 'Execute input guard',
      inputsRequired: ['request'],
      outputs: ['result'],
    });

    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async ({ input }) => ({ output: { result: input.request } })]]),
    });

    const composition = {
      id: 'tc_input_guard',
      name: 'Input guard',
      description: 'Reject forbidden keys in inputs',
      primitiveIds: [primitive.id],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const inputs = Object.create(null) as Record<string, unknown>;
    inputs.request = 'hello';
    Object.defineProperty(inputs, '__proto__', { value: { polluted: true }, enumerable: true });

    const steps = [];
    for await (const step of engine.executeComposition(composition, inputs, {})) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('failed');
    expect(steps[0]?.issues.some((issue) => issue.code === 'composition_setup_failed')).toBe(true);
    expect(steps[0]?.issues[0]?.message).toMatch(/composition_input_forbidden_key/);
  });

  it('rejects composition inputs with accessor properties', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_accessor',
      name: 'Exec accessor',
      intent: 'Execute accessor',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async ({ input }) => ({ output: { result: input.request } })]]),
    });
    const composition = {
      id: 'tc_accessor',
      name: 'Accessor',
      description: 'Reject accessor inputs',
      primitiveIds: [primitive.id],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };
    const inputs: Record<string, unknown> = {};
    Object.defineProperty(inputs, 'request', { get: () => 'hello', enumerable: true });

    const steps = [];
    for await (const step of engine.executeComposition(composition, inputs, {})) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('failed');
    expect(steps[0]?.issues[0]?.message).toMatch(/composition_input_accessor/);
  });

  it('rejects composition inputs with symbol keys', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_symbol',
      name: 'Exec symbol',
      intent: 'Execute symbol',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async ({ input }) => ({ output: { result: input.request } })]]),
    });
    const composition = {
      id: 'tc_symbol',
      name: 'Symbol',
      description: 'Reject symbol inputs',
      primitiveIds: [primitive.id],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };
    const inputs: Record<string, unknown> = { request: 'hello' };
    const secret = Symbol('secret');
    (inputs as Record<symbol, unknown>)[secret] = 'nope';

    const steps = [];
    for await (const step of engine.executeComposition(composition, inputs, {})) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('failed');
    expect(steps[0]?.issues[0]?.message).toMatch(/composition_input_symbol_keys/);
  });

  it('rejects composition inputs with nested forbidden keys', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_nested_forbidden',
      name: 'Exec nested forbidden',
      intent: 'Execute nested forbidden',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async ({ input }) => ({ output: { result: input.request } })]]),
    });
    const composition = {
      id: 'tc_nested_forbidden',
      name: 'Nested forbidden',
      description: 'Reject nested forbidden keys',
      primitiveIds: [primitive.id],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };
    const nested: Record<string, unknown> = {};
    Object.defineProperty(nested, '__proto__', { value: { polluted: true }, enumerable: true });
    const inputs: Record<string, unknown> = { request: nested };

    const steps = [];
    for await (const step of engine.executeComposition(composition, inputs, {})) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('failed');
    expect(steps[0]?.issues[0]?.message).toMatch(/composition_input_forbidden_key/);
  });

  it('accepts null-prototype input values', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_null_proto',
      name: 'Exec null proto',
      intent: 'Execute null proto',
      inputsRequired: ['payload'],
      outputs: ['result'],
    });
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async ({ input }) => ({
        output: { result: (input.payload as { message?: string }).message ?? 'none' },
      })]]),
    });
    const composition = {
      id: 'tc_null_proto',
      name: 'Null proto',
      description: 'Allow null prototype inputs',
      primitiveIds: [primitive.id],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };
    const payload = Object.create(null) as Record<string, unknown>;
    payload.message = 'ok';
    const inputs: Record<string, unknown> = { payload };

    const steps = [];
    for await (const step of engine.executeComposition(composition, inputs, {})) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('success');
    expect(steps[0]?.output.result).toBe('ok');
  });

  it('reports handler exceptions', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_throw',
      name: 'Exec throw',
      intent: 'Execute throw',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const engine = new TechniqueExecutionEngine({
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async () => {
        throw new Error('boom');
      }]]),
    });

    const result = await engine.executePrimitive(primitive, { request: 'ping' }, {});
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'primitive_execution_failed')).toBe(true);
  });

  it('fails when no executor is registered', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_missing',
      name: 'Exec missing',
      intent: 'Execute missing',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const engine = new TechniqueExecutionEngine();

    const result = await engine.executePrimitive(primitive, { request: 'ping' }, {});
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'primitive_executor_missing')).toBe(true);
  });

  it('flags output schema mismatches', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_bad_output',
      name: 'Exec bad output',
      intent: 'Execute bad output',
      contract: {
        inputs: [{ name: 'request', required: true, type: 'string' }],
        outputs: [{ name: 'count', required: true, type: 'number' }],
      },
    });
    const engine = new TechniqueExecutionEngine({
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async () => ({ output: { count: 'nope' } })]]),
    });

    const result = await engine.executePrimitive(primitive, { request: 'ping' }, {});
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'contract_output_type_invalid')).toBe(true);
  });

  it('marks postcondition failures as partial', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_post',
      name: 'Exec post',
      intent: 'Execute post',
      contract: {
        inputs: [{ name: 'request', required: true, type: 'string' }],
        outputs: [{ name: 'result', required: true, type: 'string' }],
        postconditions: ['exists(output["proof"])'],
      },
    });
    const engine = new TechniqueExecutionEngine({
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async () => ({ output: { result: 'ok' } })]]),
    });

    const result = await engine.executePrimitive(primitive, { request: 'ping' }, {});
    expect(result.status).toBe('partial');
    expect(result.issues.some((issue) => issue.code === 'contract_postcondition_failed')).toBe(true);
  });

  it('rejects composition cycles', async () => {
    const primitiveA = createTechniquePrimitive({
      id: 'tp_exec_cycle_a',
      name: 'Exec cycle A',
      intent: 'Execute cycle A',
      inputsRequired: ['request'],
      outputs: ['token'],
    });
    const primitiveB = createTechniquePrimitive({
      id: 'tp_exec_cycle_b',
      name: 'Exec cycle B',
      intent: 'Execute cycle B',
      inputsRequired: ['token'],
      outputs: ['result'],
    });
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitiveA.id ? primitiveA : primitiveB),
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitiveA.id, async () => ({ output: { token: 't' } })],
        [primitiveB.id, async () => ({ output: { result: 'r' } })],
      ]),
    });
    const relationships: TechniqueRelationship[] = [
      { fromId: primitiveA.id, toId: primitiveB.id, type: 'depends_on' },
      { fromId: primitiveB.id, toId: primitiveA.id, type: 'depends_on' },
    ];
    const composition = {
      id: 'tc_cycle',
      name: 'Cycle',
      description: 'Cycle test',
      primitiveIds: [primitiveA.id, primitiveB.id],
      relationships,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(composition, { request: 'hello' }, {})) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('failed');
    expect(steps[0]?.issues.some((issue) => issue.code === 'composition_setup_failed')).toBe(true);
    expect(steps[0]?.issues[0]?.message).toMatch(/composition_cycle_detected/);
  });

  it('continues execution when continueOnFailure is true', async () => {
    const primitiveA = createTechniquePrimitive({
      id: 'tp_exec_continue_a',
      name: 'Exec continue A',
      intent: 'Execute continue A',
      inputsRequired: ['request'],
      outputs: ['token'],
    });
    const primitiveB = createTechniquePrimitive({
      id: 'tp_exec_continue_b',
      name: 'Exec continue B',
      intent: 'Execute continue B',
      inputsRequired: ['token'],
      outputs: ['result'],
    });
    const primitiveC = createTechniquePrimitive({
      id: 'tp_exec_continue_c',
      name: 'Exec continue C',
      intent: 'Execute continue C',
      inputsRequired: ['token'],
      outputs: ['final'],
    });
    const primitives = new Map([
      [primitiveA.id, primitiveA],
      [primitiveB.id, primitiveB],
      [primitiveC.id, primitiveC],
    ]);
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => primitives.get(id),
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitiveA.id, async () => ({ output: { token: 'tok' } })],
        [primitiveB.id, async () => { throw new Error('boom'); }],
        [primitiveC.id, async ({ input }) => ({ output: { final: `${input.token}-ok` } })],
      ]),
    });
    const relationships: TechniqueRelationship[] = [
      { fromId: primitiveA.id, toId: primitiveB.id, type: 'depends_on' },
      { fromId: primitiveB.id, toId: primitiveC.id, type: 'depends_on' },
    ];
    const composition = {
      id: 'tc_continue',
      name: 'Continue',
      description: 'Continue on failure',
      primitiveIds: [primitiveA.id, primitiveB.id, primitiveC.id],
      relationships,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(
      composition,
      { request: 'hi' },
      {},
      { continueOnFailure: true }
    )) {
      steps.push(step);
    }

    expect(steps.map((step) => step.primitiveId)).toEqual([primitiveA.id, primitiveB.id, primitiveC.id]);
    expect(steps[1]?.status).toBe('failed');
    expect(steps[2]?.input.token).toBe('tok');
    expect(steps[2]?.output.final).toBe('tok-ok');
  });

  it('fails fast on missing dependencies when continuing', async () => {
    const primitiveA = createTechniquePrimitive({
      id: 'tp_exec_missing_dep_a',
      name: 'Exec missing dep A',
      intent: 'Execute missing dep A',
      inputsRequired: ['request'],
      outputs: ['token'],
    });
    const primitiveB = createTechniquePrimitive({
      id: 'tp_exec_missing_dep_b',
      name: 'Exec missing dep B',
      intent: 'Execute missing dep B',
      inputsRequired: ['token'],
      outputs: ['result'],
    });
    const primitives = new Map([
      [primitiveA.id, primitiveA],
      [primitiveB.id, primitiveB],
    ]);
    let bCalled = false;
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => primitives.get(id),
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitiveA.id, async () => { throw new Error('boom'); }],
        [primitiveB.id, async () => {
          bCalled = true;
          return { output: { result: 'ok' } };
        }],
      ]),
    });
    const relationships: TechniqueRelationship[] = [
      { fromId: primitiveA.id, toId: primitiveB.id, type: 'depends_on' },
    ];
    const composition = {
      id: 'tc_missing_dep',
      name: 'Missing dependency',
      description: 'Stop on missing dependency',
      primitiveIds: [primitiveA.id, primitiveB.id],
      relationships,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(
      composition,
      { request: 'hello' },
      {},
      { continueOnFailure: true }
    )) {
      steps.push(step);
    }

    expect(bCalled).toBe(false);
    expect(steps).toHaveLength(2);
    expect(steps[1]?.status).toBe('failed');
    expect(steps[1]?.issues.some((issue) => issue.code === 'composition_missing_dependency')).toBe(true);
  });

  it('saves interval checkpoints and resumes from them', async () => {
    const primitiveA = createTechniquePrimitive({
      id: 'tp_exec_checkpoint_a',
      name: 'Exec checkpoint A',
      intent: 'Execute checkpoint A',
      inputsRequired: ['request'],
      outputs: ['token'],
    });
    const primitiveB = createTechniquePrimitive({
      id: 'tp_exec_checkpoint_b',
      name: 'Exec checkpoint B',
      intent: 'Execute checkpoint B',
      inputsRequired: ['token'],
      outputs: ['result'],
    });
    const primitives = new Map([
      [primitiveA.id, primitiveA],
      [primitiveB.id, primitiveB],
    ]);
    const store = new InMemoryExecutionCheckpointStore({
      maxCheckpointsPerExecution: 5,
      maxTotalCheckpoints: 10,
    });
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => primitives.get(id),
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitiveA.id, async ({ input }) => ({ output: { token: `${input.request}-t` } })],
        [primitiveB.id, async ({ input }) => ({ output: { result: `${input.token}-done` } })],
      ]),
      checkpointStore: store,
    });
    const relationships: TechniqueRelationship[] = [
      { fromId: primitiveA.id, toId: primitiveB.id, type: 'depends_on' },
    ];
    const composition = {
      id: 'tc_checkpoint',
      name: 'Checkpoint',
      description: 'Checkpoint resume',
      primitiveIds: [primitiveA.id, primitiveB.id],
      relationships,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(
      composition,
      { request: 'hi' },
      {},
      {
        executionId: 'exec_checkpoint_1',
        checkpointInterval: 1,
        checkpointStore: store,
        allowInsecureCheckpointStore: true,
      }
    )) {
      steps.push(step);
    }

    const checkpoints = await store.listCheckpoints('exec_checkpoint_1');
    expect(checkpoints.length).toBeGreaterThan(0);
    const resumeFrom = checkpoints[0];
    expect(resumeFrom?.nextIndex).toBe(1);

    const resumed = [];
    for await (const step of engine.resume(resumeFrom.id, {}, {
      checkpointStore: store,
      allowInsecureCheckpointStore: true,
    })) {
      resumed.push(step);
    }
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.primitiveId).toBe(primitiveB.id);
    expect(resumed[0]?.output.result).toBe('hi-t-done');
  });

  it('rejects insecure checkpoint stores without explicit opt-in', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_insecure_store',
      name: 'Exec insecure store',
      intent: 'Execute insecure store',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const store = new InMemoryExecutionCheckpointStore();
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async ({ input }) => ({ output: { result: input.request } })]]),
      checkpointStore: store,
    });
    const composition = {
      id: 'tc_insecure_store',
      name: 'Insecure store',
      description: 'Checkpoint store guard',
      primitiveIds: [primitive.id],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(
      composition,
      { request: 'ok' },
      {},
      { checkpointInterval: 1, checkpointStore: store }
    )) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('failed');
    expect(steps[0]?.issues[0]?.message).toMatch(/checkpoint_store_not_durable/);
  });

  it('fails when resume checkpoint composition mismatches', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_resume_mismatch',
      name: 'Exec resume mismatch',
      intent: 'Resume mismatch',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async ({ input }) => ({ output: { result: input.request } })]]),
    });
    const composition = {
      id: 'tc_resume_main',
      name: 'Resume main',
      description: 'Main composition',
      primitiveIds: [primitive.id],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };
    const otherComposition = {
      id: 'tc_resume_other',
      name: 'Resume other',
      description: 'Other composition',
      primitiveIds: [primitive.id],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };
    const resumeFrom = {
      id: 'checkpoint_mismatch',
      executionId: 'exec_mismatch',
      composition: otherComposition,
      order: [primitive.id],
      nextIndex: 0,
      state: { request: 'hello' },
      missingStateKeys: [],
      continueOnFailure: false,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      reason: 'manual' as const,
    };

    const steps = [];
    for await (const step of engine.executeComposition(composition, {}, {}, { resumeFrom })) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('failed');
    expect(steps[0]?.issues[0]?.message).toMatch(/composition_checkpoint_mismatch/);
  });

  it('fails when resume checkpoint has invalid next index', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_resume_index',
      name: 'Exec resume index',
      intent: 'Resume invalid index',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async ({ input }) => ({ output: { result: input.request } })]]),
    });
    const composition = {
      id: 'tc_resume_index',
      name: 'Resume index',
      description: 'Invalid resume index',
      primitiveIds: [primitive.id],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };
    const resumeFrom = {
      id: 'checkpoint_index',
      executionId: 'exec_index',
      composition,
      order: [primitive.id],
      nextIndex: 5,
      state: { request: 'hello' },
      missingStateKeys: [],
      continueOnFailure: false,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      reason: 'manual' as const,
    };

    const steps = [];
    for await (const step of engine.executeComposition(composition, {}, {}, { resumeFrom })) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('failed');
    expect(steps[0]?.issues[0]?.message).toMatch(/composition_checkpoint_invalid_index/);
  });

  it('reports checkpoint save failures without masking original errors', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_exec_checkpoint_error',
      name: 'Exec checkpoint error',
      intent: 'Checkpoint error',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const store = {
      isDurable: true,
      saveCheckpoint: vi.fn().mockRejectedValue(new Error('disk full')),
      getCheckpoint: vi.fn().mockResolvedValue(null),
      listCheckpoints: vi.fn().mockResolvedValue([]),
    };
    const onCheckpointError = vi.fn();
    const engine = new TechniqueExecutionEngine({
      resolvePrimitive: (id) => (id === primitive.id ? primitive : undefined),
      handlers: new Map<string, PrimitiveExecutionHandler>([[primitive.id, async () => { throw new Error('boom'); }]]),
      checkpointStore: store,
    });
    const composition = {
      id: 'tc_checkpoint_error',
      name: 'Checkpoint error',
      description: 'Checkpoint error handling',
      primitiveIds: [primitive.id],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(
      composition,
      { request: 'hello' },
      {},
      {
        checkpointOnFailure: true,
        checkpointStore: store,
        onCheckpointError,
      }
    )) {
      steps.push(step);
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]?.issues.some((issue) => issue.code === 'primitive_execution_failed')).toBe(true);
    expect(onCheckpointError).toHaveBeenCalledTimes(1);
    expect(String(onCheckpointError.mock.calls[0]?.[0]?.message)).toMatch(/checkpoint_save_failed/);
  });

  it('evicts old checkpoints per execution', async () => {
    const store = new InMemoryExecutionCheckpointStore({
      maxCheckpointsPerExecution: 1,
      maxTotalCheckpoints: 10,
    });
    const composition = {
      id: 'tc_store_per_exec',
      name: 'Store per exec',
      description: 'Per execution eviction',
      primitiveIds: [],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };
    const makeCheckpoint = (id: string, executionId: string) => ({
      id,
      executionId,
      composition,
      order: [],
      nextIndex: 0,
      state: {},
      missingStateKeys: [],
      continueOnFailure: false,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      reason: 'manual' as const,
    });

    await store.saveCheckpoint(makeCheckpoint('cp1', 'exec_a'));
    await store.saveCheckpoint(makeCheckpoint('cp2', 'exec_a'));

    const checkpoints = await store.listCheckpoints('exec_a');
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.id).toBe('cp2');
    expect(await store.getCheckpoint('cp1')).toBeNull();
  });

  it('evicts old checkpoints when total limit is exceeded', async () => {
    const store = new InMemoryExecutionCheckpointStore({
      maxCheckpointsPerExecution: 5,
      maxTotalCheckpoints: 2,
    });
    const composition = {
      id: 'tc_store_total',
      name: 'Store total',
      description: 'Total eviction',
      primitiveIds: [],
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };
    const makeCheckpoint = (id: string, executionId: string) => ({
      id,
      executionId,
      composition,
      order: [],
      nextIndex: 0,
      state: {},
      missingStateKeys: [],
      continueOnFailure: false,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      reason: 'manual' as const,
    });

    await store.saveCheckpoint(makeCheckpoint('cp1', 'exec_a'));
    await store.saveCheckpoint(makeCheckpoint('cp2', 'exec_a'));
    await store.saveCheckpoint(makeCheckpoint('cp3', 'exec_b'));

    expect(await store.getCheckpoint('cp1')).toBeNull();
    const execA = await store.listCheckpoints('exec_a');
    const execB = await store.listCheckpoints('exec_b');
    expect(execA.map((checkpoint) => checkpoint.id)).toEqual(['cp2']);
    expect(execB.map((checkpoint) => checkpoint.id)).toEqual(['cp3']);
  });
});

describe('llm primitive executor', () => {
  it('parses clean JSON output', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_llm_ok',
      name: 'LLM ok',
      intent: 'LLM ok',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const llmService = {
      chat: vi.fn().mockResolvedValue({ content: '{"result":"ok"}' }),
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    } satisfies LlmServiceAdapter;
    const executor = createLlmPrimitiveExecutor({
      provider: 'claude',
      modelId: 'test-model',
      llmService,
    });

    const result = await executor({ primitive, input: { request: 'ping' }, context: {} });
    expect(result.output).toEqual({ result: 'ok' });
  });

  it('parses JSON from wrapped output', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_llm_wrapped',
      name: 'LLM wrapped',
      intent: 'LLM wrapped',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const llmService = {
      chat: vi.fn().mockResolvedValue({ content: '```json\n{"result":"ok"}\n```' }),
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    } satisfies LlmServiceAdapter;
    const executor = createLlmPrimitiveExecutor({
      provider: 'claude',
      modelId: 'test-model',
      llmService,
    });

    const result = await executor({ primitive, input: { request: 'ping' }, context: {} });
    expect(result.output).toEqual({ result: 'ok' });
  });

  it('throws on invalid JSON output', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_llm_bad',
      name: 'LLM bad',
      intent: 'LLM bad',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const llmService = {
      chat: vi.fn().mockResolvedValue({ content: 'not json' }),
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    } satisfies LlmServiceAdapter;
    const executor = createLlmPrimitiveExecutor({
      provider: 'claude',
      modelId: 'test-model',
      llmService,
    });

    await expect(executor({ primitive, input: { request: 'ping' }, context: {} }))
      .rejects.toThrow(/execution_output_invalid/);
  });

  it('fails when LLM config is missing', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_llm_missing',
      name: 'LLM missing',
      intent: 'LLM missing',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const llmService = {
      chat: vi.fn().mockResolvedValue({ content: '{"result":"ok"}' }),
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    } satisfies LlmServiceAdapter;
    const previous = {
      LIBRARIAN_LLM_PROVIDER: process.env.LIBRARIAN_LLM_PROVIDER,
      WAVE0_LLM_PROVIDER: process.env.WAVE0_LLM_PROVIDER,
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      LIBRARIAN_LLM_MODEL: process.env.LIBRARIAN_LLM_MODEL,
      CLAUDE_MODEL: process.env.CLAUDE_MODEL,
      CODEX_MODEL: process.env.CODEX_MODEL,
      WAVE0_LLM_MODEL: process.env.WAVE0_LLM_MODEL,
    };
    delete process.env.LIBRARIAN_LLM_PROVIDER;
    delete process.env.WAVE0_LLM_PROVIDER;
    delete process.env.LLM_PROVIDER;
    delete process.env.LIBRARIAN_LLM_MODEL;
    delete process.env.CLAUDE_MODEL;
    delete process.env.CODEX_MODEL;
    delete process.env.WAVE0_LLM_MODEL;

    try {
      const { resolveLiBrainianModelConfigWithDiscovery } = await import('../llm_env.js');
      vi.mocked(resolveLiBrainianModelConfigWithDiscovery).mockRejectedValueOnce(
        new Error('unverified_by_trace(provider_unavailable): LLM config missing for execution')
      );
      const executor = createLlmPrimitiveExecutor({
        llmService,
      });
      await expect(executor({ primitive, input: { request: 'ping' }, context: {} }))
        .rejects.toThrow(/provider_unavailable/);
    } finally {
      process.env.LIBRARIAN_LLM_PROVIDER = previous.LIBRARIAN_LLM_PROVIDER;
      process.env.WAVE0_LLM_PROVIDER = previous.WAVE0_LLM_PROVIDER;
      process.env.LLM_PROVIDER = previous.LLM_PROVIDER;
      process.env.LIBRARIAN_LLM_MODEL = previous.LIBRARIAN_LLM_MODEL;
      process.env.CLAUDE_MODEL = previous.CLAUDE_MODEL;
      process.env.CODEX_MODEL = previous.CODEX_MODEL;
      process.env.WAVE0_LLM_MODEL = previous.WAVE0_LLM_MODEL;
    }
  });

  it('retries transient LLM errors before succeeding', async () => {
    const primitive = createTechniquePrimitive({
      id: 'tp_llm_retry',
      name: 'LLM retry',
      intent: 'LLM retry',
      inputsRequired: ['request'],
      outputs: ['result'],
    });
    const llmService = {
      chat: vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ content: '{"result":"ok"}' }),
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    } satisfies LlmServiceAdapter;
    const executor = createLlmPrimitiveExecutor({
      provider: 'claude',
      modelId: 'test-model',
      llmService,
      maxRetries: 1,
      retryDelayMs: 1,
      timeoutMs: 1000,
    });

    const result = await executor({ primitive, input: { request: 'ping' }, context: {} });
    expect(result.output).toEqual({ result: 'ok' });
    expect(llmService.chat).toHaveBeenCalledTimes(2);
  });
});
