import { z } from 'zod';
import { deterministic } from '../../epistemics/confidence.js';
import { createConstruction } from '../factory.js';
import { atom, seq } from '../operators.js';
import { fail, ok } from '../types.js';

export interface SequentialPresetInput {
  task: string;
}

export interface SequentialPresetOutput {
  normalizedTask: string;
  steps: string[];
  confidence: {
    type: 'deterministic';
    value: number;
    reason: string;
  };
  evidenceRefs: string[];
  analysisTimeMs: number;
}

const normalizeTask = atom<SequentialPresetInput, { normalizedTask: string }>(
  '@librainian-community/template-sequential-normalize',
  (input) => ({
    normalizedTask: input.task.trim().toLowerCase(),
  }),
  'Template Normalize Task Step',
);

const buildPlan = atom<{ normalizedTask: string }, { normalizedTask: string; steps: string[] }>(
  '@librainian-community/template-sequential-plan',
  (input) => ({
    normalizedTask: input.normalizedTask,
    steps: [
      `Locate implementation for "${input.normalizedTask}"`,
      `Review call sites for "${input.normalizedTask}"`,
      `Draft patch and verification plan for "${input.normalizedTask}"`,
    ],
  }),
  'Template Build Plan Step',
);

const sequentialPipeline = seq(
  normalizeTask,
  buildPlan,
  '@librainian-community/template-sequential-pipeline',
  'Template Sequential Pipeline',
);

/**
 * Sequential preset template: compose two atoms with seq.
 */
export const sequentialPreset = createConstruction<
  SequentialPresetInput,
  SequentialPresetOutput
>({
  id: '@librainian-community/template-sequential-preset',
  name: 'Template Sequential Preset',
  description: 'Template showing step-by-step construction composition with seq.',
  inputSchema: z.object({
    task: z.string().min(1),
  }),
  outputSchema: z.object({
    normalizedTask: z.string(),
    steps: z.array(z.string()),
    confidence: z.object({
      type: z.literal('deterministic'),
      value: z.number(),
      reason: z.string(),
    }),
    evidenceRefs: z.array(z.string()),
    analysisTimeMs: z.number(),
  }),
  tags: ['template', 'sequential', 'construction'],
  agentDescription:
    'Use this template when your preset needs deterministic, ordered composition across multiple atoms.',
  execute: async (input, context) => {
    const outcome = await sequentialPipeline.execute(input, context);
    if (!outcome.ok) {
      return fail(outcome.error);
    }

    return ok({
      normalizedTask: outcome.value.normalizedTask,
      steps: outcome.value.steps,
      confidence: deterministic(true, 'Template sequential flow has deterministic logic'),
      evidenceRefs: [],
      analysisTimeMs: 0,
    });
  },
});
