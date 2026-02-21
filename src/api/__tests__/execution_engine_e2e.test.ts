import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianQuery } from '../../types.js';
import { createEvidenceLedger, createSessionId, resolveReplaySessionId } from '../../epistemics/evidence_ledger.js';
import { executeQueryPipeline } from '../execution_pipeline.js';
import { listExecutionTraces } from '../../state/execution_traces.js';
import type { PrimitiveExecutionHandler } from '../technique_execution.js';
import { createTechniqueComposition, createTechniquePrimitive } from '../../strategic/techniques.js';
import { saveTechniquePrimitive } from '../../state/technique_primitives.js';
import { saveTechniqueComposition } from '../../state/technique_compositions.js';

describe('execution pipeline e2e (tier-0)', () => {
  it('executes query → plan → composition deterministically without providers', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'librainian-e2e-'));
    const ledgerPath = path.join(workspaceRoot, 'evidence.sqlite');
    const ledger = createEvidenceLedger(ledgerPath);
    await ledger.initialize();
    const storage = createSqliteStorage(':memory:', workspaceRoot);
    await storage.initialize();

    try {
      await storage.upsertModule({
        id: 'mod_e2e',
        path: 'src/app.ts',
        purpose: 'E2E test module',
        exports: [],
        dependencies: [],
        confidence: 0.5,
      });

      const primitives = [
        createTechniquePrimitive({
          id: 'tp_e2e_alpha',
          name: 'Alpha',
          intent: 'Alpha input',
          inputsRequired: ['input_a'],
          outputs: ['output_a'],
        }),
        createTechniquePrimitive({
          id: 'tp_e2e_bravo',
          name: 'Bravo',
          intent: 'Bravo input',
          inputsRequired: ['input_b'],
          outputs: ['output_b'],
        }),
        createTechniquePrimitive({
          id: 'tp_e2e_charlie',
          name: 'Charlie',
          intent: 'Merge alpha + bravo',
          inputsRequired: ['output_a', 'output_b'],
          outputs: ['output_c'],
        }),
        createTechniquePrimitive({
          id: 'tp_e2e_delta',
          name: 'Delta',
          intent: 'Transform output_c',
          inputsRequired: ['output_c'],
          outputs: ['output_d'],
        }),
        createTechniquePrimitive({
          id: 'tp_e2e_echo',
          name: 'Echo',
          intent: 'Transform output_d',
          inputsRequired: ['output_d'],
          outputs: ['output_e'],
        }),
        createTechniquePrimitive({
          id: 'tp_e2e_foxtrot',
          name: 'Foxtrot',
          intent: 'Finalize output_e',
          inputsRequired: ['output_e'],
          outputs: ['output_f'],
        }),
      ];
      for (const primitive of primitives) {
        await saveTechniquePrimitive(storage, primitive);
      }

      const composition = createTechniqueComposition({
        id: 'tc_e2e_execution',
        name: 'E2E execution pipeline',
        description: 'Deterministic end-to-end execution for Critical A.',
        primitiveIds: primitives.map((primitive) => primitive.id),
        relationships: [
          { fromId: 'tp_e2e_charlie', toId: 'tp_e2e_delta', type: 'depends_on' },
          { fromId: 'tp_e2e_delta', toId: 'tp_e2e_echo', type: 'depends_on' },
          { fromId: 'tp_e2e_echo', toId: 'tp_e2e_foxtrot', type: 'depends_on' },
        ],
        operators: [
          {
            id: 'op_e2e_parallel',
            type: 'parallel',
            inputs: ['tp_e2e_alpha', 'tp_e2e_bravo'],
            outputs: ['tp_e2e_charlie'],
          },
        ],
      });
      await saveTechniqueComposition(storage, composition);

      const query: LiBrainianQuery = {
        intent: 'e2e execution',
        depth: 'L0',
        affectedFiles: ['src/app.ts'],
        llmRequirement: 'disabled',
        taskType: 'audit',
      };

      const handlers = new Map<string, PrimitiveExecutionHandler>([
        ['tp_e2e_alpha', async ({ input }) => ({ output: { output_a: input.input_a } })],
        ['tp_e2e_bravo', async ({ input }) => ({ output: { output_b: input.input_b } })],
        ['tp_e2e_charlie', async ({ input }) => ({
          output: { output_c: `${input.output_a}-${input.output_b}` },
        })],
        ['tp_e2e_delta', async ({ input }) => ({ output: { output_d: `${input.output_c}-d` } })],
        ['tp_e2e_echo', async ({ input }) => ({ output: { output_e: `${input.output_d}-e` } })],
        ['tp_e2e_foxtrot', async ({ input }) => ({ output: { output_f: `${input.output_e}-f` } })],
      ]);

      const executionInputs = {
        input_a: 'alpha',
        input_b: 'bravo',
      };

      const sessionId = createSessionId('sess_e2e');
      const result = await executeQueryPipeline(query, storage, {
        evidenceLedger: ledger,
        sessionId,
        planOptions: { compositionId: 'tc_e2e_execution' },
        executionInputs,
        handlers,
        executionOptions: { executionId: 'exec_e2e' },
      });

      expect(result.response.constructionPlan).toBeDefined();
      expect(result.response.verificationPlan).toBeDefined();
      expect(result.response.traceId).toBe(sessionId);
      expect(result.plan.composition.id).toBe('tc_e2e_execution');
      expect(result.steps.length).toBeGreaterThanOrEqual(5);
      expect(result.steps.every((step) => step.status === 'success')).toBe(true);
      expect(result.outcome).toBe('success');

      const traces = await listExecutionTraces(storage);
      expect(traces.some((trace) => trace.executionId === 'exec_e2e')).toBe(true);

      const resolved = resolveReplaySessionId(result.response.traceId);
      expect(resolved).toBe(sessionId);
      const entries = await ledger.query({ sessionId });
      const hasQueryStage = entries.some((entry) => (entry.payload as any)?.toolName === 'librainian_query_stage');
      const hasOperatorEvent = entries.some((entry) => (entry.payload as any)?.toolName === 'technique.operatorEvent');
      expect(hasQueryStage).toBe(true);
      expect(hasOperatorEvent).toBe(true);
    } finally {
      await storage.close();
      await ledger.close();
    }
  });
});
