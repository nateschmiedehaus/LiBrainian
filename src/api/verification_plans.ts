import { randomUUID } from 'node:crypto';
import type { ContextPack, LiBrainianQuery, SynthesizedResponse } from '../types.js';
import type { VerificationPlan } from '../strategic/verification_plan.js';
import type { VerificationMethod } from '../strategic/work_primitives.js';
import { createVerificationPlan } from '../strategic/verification_plan.js';
import type { AdequacyReport } from './difficulty_detectors.js';

export interface QueryVerificationPlanInput {
  query: LiBrainianQuery;
  packs: ContextPack[];
  coverageGaps?: string[];
  synthesis?: SynthesizedResponse;
  adequacyReport?: AdequacyReport | null;
  planId?: string;
}

export function createQueryVerificationPlan(input: QueryVerificationPlanInput): VerificationPlan | null {
  const intent = (input.query.intent ?? '').trim();
  if (!intent) return null;

  const relatedFiles = new Set<string>();
  for (const file of input.query.affectedFiles ?? []) {
    if (file) relatedFiles.add(file);
  }
  for (const pack of input.packs) {
    for (const file of pack.relatedFiles ?? []) {
      if (file) relatedFiles.add(file);
    }
  }
  const sortedFiles = Array.from(relatedFiles).sort();

  const gaps = input.coverageGaps?.filter((gap) => typeof gap === 'string' && gap.trim()) ?? [];
  const uncertainties = input.synthesis?.uncertainties?.filter((u) => typeof u === 'string' && u.trim()) ?? [];
  const adequacyGaps = input.adequacyReport?.missingEvidence
    ?.map((req) => req.description)
    .filter((entry) => entry && entry.trim()) ?? [];

  const expectedObservations: string[] = [];
  if (sortedFiles.length > 0) {
    expectedObservations.push(`Review related files: ${sortedFiles.join(', ')}`);
  }
  if (gaps.length > 0) {
    expectedObservations.push(`Address coverage gaps: ${gaps.join('; ')}`);
  }
  if (uncertainties.length > 0) {
    expectedObservations.push(`Resolve uncertainties: ${uncertainties.join('; ')}`);
  }
  if (adequacyGaps.length > 0) {
    expectedObservations.push(`Address adequacy gaps: ${adequacyGaps.join('; ')}`);
  }

  if (expectedObservations.length === 0) {
    return null;
  }

  const methods: VerificationMethod[] = [];
  if (sortedFiles.length > 0) {
    methods.push({
      type: 'code_review',
      description: 'Review the cited files and confirm the behavior matches the answer.',
      automatable: false,
    });
  }

  const taskType = (input.query.taskType ?? '').toLowerCase();
  const wantsTests = /bug|fix|test|regress|incident/.test(taskType);
  if (wantsTests) {
    methods.push({
      type: 'automated_test',
      description: 'Run the relevant test suite for the affected surface area.',
      automatable: true,
    });
  }

  if (methods.length === 0) {
    methods.push({
      type: 'manual_test',
      description: 'Manually validate the answer against available evidence.',
      automatable: false,
    });
  }

  return createVerificationPlan({
    id: input.planId ?? `vp_${randomUUID()}`,
    target: intent,
    methods,
    expectedObservations,
    artifacts: sortedFiles.length ? sortedFiles : undefined,
  });
}
