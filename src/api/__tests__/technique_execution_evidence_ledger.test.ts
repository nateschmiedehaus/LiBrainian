import { describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createTechniquePrimitive, type TechniqueOperator } from '../../strategic/techniques.js';
import { TechniqueExecutionEngine, type PrimitiveExecutionHandler } from '../technique_execution.js';
import { createEvidenceLedger, createSessionId } from '../../epistemics/evidence_ledger.js';

vi.mock('../provider_check.js', () => ({
  requireProviders: vi.fn().mockResolvedValue(undefined),
}));

describe('technique execution: evidence ledger wiring', () => {
  it('records primitive execution tool_call evidence when a ledger is provided', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'librainian-ledger-primitive-'));
    const ledgerPath = path.join(tmpRoot, 'evidence.sqlite');
    const ledger = createEvidenceLedger(ledgerPath);
    await ledger.initialize();
    const sessionId = createSessionId('sess_primitive');

    const primitive = createTechniquePrimitive({
      id: 'tp_ev_primitive',
      name: 'Evidence primitive',
      intent: 'Produce output for evidence test.',
      inputsRequired: ['request'],
      outputs: ['result'],
    });

    const engine = new TechniqueExecutionEngine({
      handlers: new Map<string, PrimitiveExecutionHandler>([
        [primitive.id, async ({ input }) => ({ output: { result: `${input.request}-done` } })],
      ]),
    });

    const result = await engine.executePrimitive(
      primitive,
      { request: 'ping' },
      { evidenceLedger: ledger, sessionId }
    );
    expect(result.status).toBe('success');

    const entries = await ledger.query({ sessionId, kinds: ['tool_call'] });
    const matching = entries.filter((entry) => {
      const payload = entry.payload as any;
      return payload?.toolName === 'technique.executePrimitive' && payload?.arguments?.primitiveId === primitive.id;
    });
    expect(matching.length).toBeGreaterThan(0);
    await ledger.close();
  });

  it('records operator events as tool_call evidence during composition execution', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'librainian-ledger-operator-'));
    const ledgerPath = path.join(tmpRoot, 'evidence.sqlite');
    const ledger = createEvidenceLedger(ledgerPath);
    await ledger.initialize();
    const sessionId = createSessionId('sess_operator');

    const primitiveA = createTechniquePrimitive({
      id: 'tp_ev_parallel_a',
      name: 'Parallel A',
      intent: 'Parallel A',
      outputs: ['value'],
    });
    const primitiveB = createTechniquePrimitive({
      id: 'tp_ev_parallel_b',
      name: 'Parallel B',
      intent: 'Parallel B',
      outputs: ['value'],
    });
    const primitiveC = createTechniquePrimitive({
      id: 'tp_ev_parallel_c',
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
        id: 'op_ev_parallel',
        type: 'parallel',
        inputs: [primitiveA.id, primitiveB.id],
        outputs: [primitiveC.id],
      },
    ];
    const composition = {
      id: 'tc_ev_parallel',
      name: 'Evidence parallel composition',
      description: 'Parallel operator emits events',
      primitiveIds: [primitiveA.id, primitiveB.id, primitiveC.id],
      operators,
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    };

    const steps = [];
    for await (const step of engine.executeComposition(composition, {}, { evidenceLedger: ledger, sessionId })) {
      steps.push(step);
    }
    expect(steps.length).toBeGreaterThan(0);

    const entries = await ledger.query({ sessionId, kinds: ['tool_call'] });
    const operatorEvents = entries.filter((entry) => {
      const payload = entry.payload as any;
      return payload?.toolName === 'technique.operatorEvent';
    });
    expect(operatorEvents.length).toBeGreaterThan(0);
    await ledger.close();
  });
});
