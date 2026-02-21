import type { FileReadLogEntry } from '../integration/read_interceptor.js';
import type { KnowledgeGap } from '../api/context_assembly.js';
import { detectGuessViolations, type GuessViolation } from './guess_detector.js';

export interface TrajectoryAnalysisInput { taskId: string; outputText?: string; readLogs?: FileReadLogEntry[]; gaps?: KnowledgeGap[]; }
export interface TrajectoryAnalysisResult { taskId: string; violations: GuessViolation[]; recommendations: string[]; }

function buildRecommendations(violations: GuessViolation[]): string[] {
  const recs: string[] = [];
  if (violations.some((v) => v.type === 'uncited_claim')) recs.push('Cite librainian evidence for every code claim.');
  if (violations.some((v) => v.type === 'read_without_query')) recs.push('Query librainian before reading files outside the provided context.');
  if (violations.some((v) => v.type === 'ignored_gap')) recs.push('Acknowledge coverage gaps before proceeding.');
  if (violations.some((v) => v.type === 'assumption_cascade')) recs.push('Reduce chained assumptions; validate with evidence or direct reads.');
  return recs;
}

export function analyzeTrajectory(input: TrajectoryAnalysisInput): TrajectoryAnalysisResult {
  const violations = detectGuessViolations({ outputText: input.outputText, readLogs: input.readLogs, gaps: input.gaps });
  return { taskId: input.taskId, violations, recommendations: buildRecommendations(violations) };
}
