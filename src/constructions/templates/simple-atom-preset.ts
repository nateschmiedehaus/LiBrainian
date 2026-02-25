import { z } from 'zod';
import { deterministic } from '../../epistemics/confidence.js';
import { createConstruction } from '../factory.js';
import { atom } from '../operators.js';
import { fail, ok } from '../types.js';

export interface SimpleAtomPresetInput {
  symbol: string;
  filePath: string;
}

export interface SimpleAtomPresetOutput {
  summary: string;
  confidence: {
    type: 'deterministic';
    value: number;
    reason: string;
  };
  evidenceRefs: string[];
  analysisTimeMs: number;
}

const summarizeSymbol = atom<SimpleAtomPresetInput, string>(
  '@librainian-community/template-simple-atom-step',
  (input) => `Symbol ${input.symbol} is referenced in ${input.filePath}.`,
  'Template Symbol Summary Step',
);

/**
 * Minimal preset template: one focused atom wrapped as a typed Construction.
 */
export const simpleAtomPreset = createConstruction<
  SimpleAtomPresetInput,
  SimpleAtomPresetOutput
>({
  id: '@librainian-community/template-simple-atom-preset',
  name: 'Template Simple Atom Preset',
  description: 'Minimal template showing a single-step construction preset.',
  inputSchema: z.object({
    symbol: z.string().min(1),
    filePath: z.string().min(1),
  }),
  outputSchema: z.object({
    summary: z.string(),
    confidence: z.object({
      type: z.literal('deterministic'),
      value: z.number(),
      reason: z.string(),
    }),
    evidenceRefs: z.array(z.string()),
    analysisTimeMs: z.number(),
  }),
  tags: ['template', 'atom', 'construction'],
  agentDescription:
    'Use this template to scaffold a single-step construction that returns deterministic fixture output.',
  execute: async (input, context) => {
    const step = await summarizeSymbol.execute(input, context);
    if (!step.ok) {
      return fail(step.error);
    }

    return ok({
      summary: step.value,
      confidence: deterministic(true, 'Template single-step atom is deterministic'),
      evidenceRefs: [],
      analysisTimeMs: 0,
    });
  },
});
