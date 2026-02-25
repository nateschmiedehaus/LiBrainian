import { z } from 'zod';
import { deterministic } from '../../epistemics/confidence.js';
import { createConstruction } from '../factory.js';
import { atom, fanout } from '../operators.js';
import { fail, ok } from '../types.js';

export interface FanoutPresetInput {
  diffSummary: string;
}

export interface FanoutPresetOutput {
  riskAssessment: string;
  effortAssessment: string;
  recommendation: string;
  confidence: {
    type: 'deterministic';
    value: number;
    reason: string;
  };
  evidenceRefs: string[];
  analysisTimeMs: number;
}

const estimateRisk = atom<FanoutPresetInput, string>(
  '@librainian-community/template-fanout-risk',
  (input) => {
    if (input.diffSummary.length > 240) {
      return 'high';
    }
    return 'medium';
  },
  'Template Risk Estimation Step',
);

const estimateEffort = atom<FanoutPresetInput, string>(
  '@librainian-community/template-fanout-effort',
  (input) => {
    const lineCount = input.diffSummary.split('\n').length;
    if (lineCount > 20) {
      return 'large';
    }
    if (lineCount > 8) {
      return 'moderate';
    }
    return 'small';
  },
  'Template Effort Estimation Step',
);

const fanoutPipeline = fanout(
  estimateRisk,
  estimateEffort,
  '@librainian-community/template-fanout-pipeline',
  'Template Fanout Pipeline',
);

/**
 * Fanout preset template: run independent analyses in parallel and merge output.
 */
export const fanoutPreset = createConstruction<
  FanoutPresetInput,
  FanoutPresetOutput
>({
  id: '@librainian-community/template-fanout-preset',
  name: 'Template Fanout Preset',
  description: 'Template showing parallel branch composition with fanout.',
  inputSchema: z.object({
    diffSummary: z.string().min(1),
  }),
  outputSchema: z.object({
    riskAssessment: z.string(),
    effortAssessment: z.string(),
    recommendation: z.string(),
    confidence: z.object({
      type: z.literal('deterministic'),
      value: z.number(),
      reason: z.string(),
    }),
    evidenceRefs: z.array(z.string()),
    analysisTimeMs: z.number(),
  }),
  tags: ['template', 'fanout', 'construction'],
  agentDescription:
    'Use this template when your preset can evaluate independent dimensions in parallel and combine them.',
  execute: async (input, context) => {
    const branched = await fanoutPipeline.execute(input, context);
    if (!branched.ok) {
      return fail(branched.error);
    }

    const [riskAssessment, effortAssessment] = branched.value;
    const recommendation = `risk=${riskAssessment}, effort=${effortAssessment}; prioritize accordingly.`;

    return ok({
      riskAssessment,
      effortAssessment,
      recommendation,
      confidence: deterministic(true, 'Template fanout pipeline is deterministic'),
      evidenceRefs: [],
      analysisTimeMs: 0,
    });
  },
});
