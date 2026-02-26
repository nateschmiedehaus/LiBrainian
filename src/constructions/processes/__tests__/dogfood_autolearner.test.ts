import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unwrapConstructionExecutionResult } from '../../types.js';
import { createDogfoodAutoLearnerConstruction } from '../dogfood_autolearner.js';

async function withTempDir(fn: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dogfood-autolearner-'));
  try {
    await fn(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function writeFileUtf8(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

describe('createDogfoodAutoLearnerConstruction', () => {
  it('ranks lock/timeout failure classes and emits top-3 interventions with causal rationale', async () => {
    await withTempDir(async (tmpDir) => {
      const runDir = path.join(tmpDir, 'dogfood-run');
      await mkdir(path.join(runDir, 'tasks', 'T01'), { recursive: true });

      await writeFileUtf8(
        path.join(runDir, 'natural_usage_metrics.csv'),
        [
          'metric,value,threshold,passes,source,notes',
          'used_librarian_rate,0.52,>=0.70,false,eval,low adoption',
          'success_lift_t3_plus,0.10,>=0.25,false,eval,weak causal lift',
          'use_decision_precision,0.71,>=0.80,false,eval,overuse risk',
          'unnecessary_query_rate,0.41,<=0.20,false,eval,too many low-value queries',
        ].join('\n'),
      );

      await writeFileUtf8(
        path.join(runDir, 'ablation_replay.csv'),
        [
          'task_id,complexity_class,task_class,treatment_used_librarian,treatment_outcome,control_outcome,treatment_time_s,control_time_s,treatment_rework_loops,control_rework_loops,treatment_defects,control_defects,decision_changed,notes',
          'AGGREGATE,T3+,mixed,yes,partial,partial,1200,1400,2,3,1,2,yes,poor lift',
        ].join('\n'),
      );

      await writeFileUtf8(
        path.join(runDir, 'error_taxonomy.csv'),
        [
          'error_class,count,severity,example',
          'storage_locked,7,high,ESTORAGE_LOCKED during query',
          'query_timeout_no_output,5,high,query stalls >60s',
          'model_policy_provider_not_registered,2,high,fallback model selection warning',
        ].join('\n'),
      );

      await writeFileUtf8(
        path.join(runDir, 'tasks', 'T01', 'decision_trace.md'),
        [
          '# Decision Trace — T01',
          '- used_librarian: yes',
          '- output_quality: not_helpful',
          '- natural_failure: yes',
          '- failure_description: low relevance + timeout',
        ].join('\n'),
      );

      const construction = createDogfoodAutoLearnerConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ runDir }),
      );

      expect(output.kind).toBe('DogfoodAutoLearnerResult.v1');
      expect(output.topInterventions.length).toBeGreaterThanOrEqual(3);
      expect(output.topInterventions[0]?.recommendation).toBe('apply_now');
      expect(output.topInterventions.some((item) => item.id.includes('lock'))).toBe(true);
      expect(output.topInterventions.some((item) => item.id.includes('timeout'))).toBe(true);
      expect(output.topInterventions.some((item) => item.id.includes('model-policy'))).toBe(true);
      expect(output.topInterventions.every((item) => item.causalRationale.length > 0)).toBe(true);
      expect(output.markdownPlan).toContain('apply_now');
      expect(output.topInterventions.some((item) => item.recommendation === 'apply_now')).toBe(true);
    });
  });

  it('emits no-op guidance when metrics are in healthy bands', async () => {
    await withTempDir(async (tmpDir) => {
      const runDir = path.join(tmpDir, 'dogfood-run');

      await writeFileUtf8(
        path.join(runDir, 'natural_usage_metrics.csv'),
        [
          'metric,value,threshold,passes,source,notes',
          'used_librarian_rate,0.81,>=0.70,true,eval,healthy adoption',
          'success_lift_t3_plus,0.32,>=0.25,true,eval,healthy lift',
          'use_decision_precision,0.91,>=0.80,true,eval,healthy restraint',
          'unnecessary_query_rate,0.05,<=0.20,true,eval,low unnecessary usage',
        ].join('\n'),
      );

      await writeFileUtf8(
        path.join(runDir, 'ablation_replay.csv'),
        [
          'task_id,complexity_class,task_class,treatment_used_librarian,treatment_outcome,control_outcome,treatment_time_s,control_time_s,treatment_rework_loops,control_rework_loops,treatment_defects,control_defects,decision_changed,notes',
          'AGGREGATE,T3+,mixed,yes,success,success,900,1100,1,1,0,0,yes,healthy',
        ].join('\n'),
      );

      await writeFileUtf8(
        path.join(runDir, 'error_taxonomy.csv'),
        [
          'error_class,count,severity,example',
          'storage_locked,0,low,none',
          'query_timeout_no_output,0,low,none',
        ].join('\n'),
      );

      const construction = createDogfoodAutoLearnerConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ runDir }),
      );

      expect(output.healthBand).toBe('healthy');
      expect(output.noOpReason).toBeTruthy();
      expect(output.topInterventions.some((item) => item.recommendation === 'no_op')).toBe(true);
      expect(output.applyNow).toHaveLength(0);
      expect(output.markdownPlan).toContain('no_op');
    });
  });

  it('produces stable schema and deterministic ranking order for identical inputs', async () => {
    await withTempDir(async (tmpDir) => {
      const runDir = path.join(tmpDir, 'dogfood-run');
      await writeFileUtf8(
        path.join(runDir, 'natural_usage_metrics.csv'),
        [
          'metric,value,threshold,passes,source,notes',
          'used_librarian_rate,0.60,>=0.70,false,eval,low adoption',
          'success_lift_t3_plus,0.18,>=0.25,false,eval,low lift',
          'use_decision_precision,0.88,>=0.80,true,eval,good precision',
          'unnecessary_query_rate,0.08,<=0.20,true,eval,good restraint',
        ].join('\n'),
      );
      await writeFileUtf8(
        path.join(runDir, 'ablation_replay.csv'),
        [
          'task_id,complexity_class,task_class,treatment_used_librarian,treatment_outcome,control_outcome,treatment_time_s,control_time_s,treatment_rework_loops,control_rework_loops,treatment_defects,control_defects,decision_changed,notes',
          'AGGREGATE,T3+,mixed,yes,success,partial,960,1240,1,2,0,1,yes,medium',
        ].join('\n'),
      );
      await writeFileUtf8(
        path.join(runDir, 'error_taxonomy.csv'),
        [
          'error_class,count,severity,example',
          'query_timeout_no_output,2,medium,slow',
        ].join('\n'),
      );

      const construction = createDogfoodAutoLearnerConstruction();
      const first = unwrapConstructionExecutionResult(await construction.execute({ runDir }));
      const second = unwrapConstructionExecutionResult(await construction.execute({ runDir }));

      const summarize = (value: typeof first) => ({
        healthBand: value.healthBand,
        top: value.topInterventions.map((item) => ({ id: item.id, recommendation: item.recommendation })),
        apply: value.applyNow.map((item) => item.id),
        observe: value.observeOnly.map((item) => item.id),
      });

      expect(summarize(first)).toEqual(summarize(second));
      expect(first).toHaveProperty('kind');
      expect(first).toHaveProperty('topInterventions');
      expect(first).toHaveProperty('markdownPlan');
    });
  });
});
