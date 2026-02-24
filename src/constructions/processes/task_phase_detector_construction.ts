import { ok, type Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export enum AgentPhase {
  Orient = 'orient',
  Plan = 'plan',
  Implement = 'implement',
  Verify = 'verify',
  Reflect = 'reflect',
  Unknown = 'unknown',
}

export interface PhaseDetectionInput {
  intent: string;
  recentToolCalls?: string[];
  affectedFiles?: string[];
  previousPhase?: AgentPhase;
}

export interface PhaseDetectionResult {
  phase: AgentPhase;
  confidence: number;
  signals: string[];
  transitionedFrom?: AgentPhase;
}

export type PhaseProactiveIntelType =
  | 'ambient-briefing'
  | 'scope-analysis'
  | 'convention-alert'
  | 'completion-checklist'
  | 'outcome-prompt';

export interface PhaseProactiveIntel {
  type: PhaseProactiveIntelType;
  content: string;
}

export interface TaskPhaseDetectorOutput {
  kind: 'TaskPhaseDetectorResult.v1';
  detection: PhaseDetectionResult;
  proactiveIntel: PhaseProactiveIntel[];
}

const PLAN_TOOLS = new Set([
  'get_change_impact',
  'blast_radius',
  'synthesize_plan',
  'compile_technique_composition',
  'compile_intent_bundles',
]);

const IMPLEMENT_TOOLS = new Set([
  'list_constructions',
  'invoke_construction',
  'append_claim',
  'edit_file',
  'write_file',
]);

const VERIFY_TOOLS = new Set([
  'get_refactoring_safety',
  'pre_commit_check',
  'run_audit',
  'verify_claim',
]);

const REFLECT_TOOLS = new Set([
  'submit_feedback',
  'feedback_retrieval_result',
  'harvest_session_knowledge',
]);

function toLowerList(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function containsAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function classifyWithSignals(intent: string, recentToolCalls: readonly string[]): PhaseDetectionResult {
  const loweredIntent = intent.trim().toLowerCase();
  const loweredCalls = toLowerList(recentToolCalls);
  const signals: string[] = [];

  const hasReflectSignal =
    loweredCalls.some((tool) => REFLECT_TOOLS.has(tool)) ||
    containsAny(loweredIntent, ['reflect', 'retro', 'postmortem', 'outcome', 'feedback']);
  if (hasReflectSignal) {
    if (loweredCalls.some((tool) => REFLECT_TOOLS.has(tool))) {
      signals.push('tool:reflection');
    }
    if (containsAny(loweredIntent, ['reflect', 'retro', 'postmortem', 'outcome', 'feedback'])) {
      signals.push('intent:reflection');
    }
    return { phase: AgentPhase.Reflect, confidence: Math.min(0.6 + signals.length * 0.15, 0.95), signals };
  }

  const hasVerifySignal =
    loweredCalls.some((tool) => VERIFY_TOOLS.has(tool)) ||
    containsAny(loweredIntent, ['verify', 'validation', 'test', 'checklist', 'pre-commit']);
  if (hasVerifySignal) {
    if (loweredCalls.some((tool) => VERIFY_TOOLS.has(tool))) {
      signals.push('tool:verification');
    }
    if (containsAny(loweredIntent, ['verify', 'validation', 'test', 'checklist', 'pre-commit'])) {
      signals.push('intent:verification');
    }
    return { phase: AgentPhase.Verify, confidence: Math.min(0.6 + signals.length * 0.15, 0.95), signals };
  }

  const hasPlanSignal =
    loweredCalls.some((tool) => PLAN_TOOLS.has(tool)) ||
    containsAny(loweredIntent, ['plan', 'scope', 'design', 'strategy', 'approach']);
  if (hasPlanSignal) {
    if (loweredCalls.some((tool) => PLAN_TOOLS.has(tool))) {
      signals.push('tool:planning');
    }
    if (containsAny(loweredIntent, ['plan', 'scope', 'design', 'strategy', 'approach'])) {
      signals.push('intent:planning');
    }
    return { phase: AgentPhase.Plan, confidence: Math.min(0.6 + signals.length * 0.15, 0.95), signals };
  }

  const hasImplementSignal =
    loweredCalls.some((tool) => IMPLEMENT_TOOLS.has(tool)) ||
    containsAny(loweredIntent, ['implement', 'code', 'fix', 'refactor', 'patch']);
  if (hasImplementSignal) {
    if (loweredCalls.some((tool) => IMPLEMENT_TOOLS.has(tool))) {
      signals.push('tool:implementation');
    }
    if (containsAny(loweredIntent, ['implement', 'code', 'fix', 'refactor', 'patch'])) {
      signals.push('intent:implementation');
    }
    return { phase: AgentPhase.Implement, confidence: Math.min(0.6 + signals.length * 0.15, 0.95), signals };
  }

  if (loweredIntent.length === 0 && loweredCalls.length === 0) {
    return { phase: AgentPhase.Unknown, confidence: 0.2, signals: [] };
  }

  return {
    phase: AgentPhase.Orient,
    confidence: loweredCalls.length === 0 ? 0.72 : 0.6,
    signals: loweredCalls.length === 0 ? ['default:initial-query'] : ['fallback:orientation'],
  };
}

function shortScopeLabel(affectedFiles: readonly string[]): string {
  if (affectedFiles.length === 0) return 'the current task scope';
  if (affectedFiles.length === 1) return affectedFiles[0] ?? 'the current file';
  return `${affectedFiles.slice(0, 2).join(', ')} (+${affectedFiles.length - 2} more)`;
}

export function buildPhaseProactiveIntel(phase: AgentPhase, affectedFiles: readonly string[]): PhaseProactiveIntel[] {
  const scope = shortScopeLabel(affectedFiles);
  switch (phase) {
    case AgentPhase.Orient:
      return [
        { type: 'ambient-briefing', content: `Orient briefing: review recent churn, ownership, and risk hotspots for ${scope}.` },
      ];
    case AgentPhase.Plan:
      return [
        { type: 'scope-analysis', content: `Plan check: validate downstream impact and missing caller/dependency coverage for ${scope}.` },
      ];
    case AgentPhase.Implement:
      return [
        { type: 'convention-alert', content: `Implementation guidance: enforce local conventions and pattern parity while changing ${scope}.` },
      ];
    case AgentPhase.Verify:
      return [
        { type: 'completion-checklist', content: `Verify checklist: ensure required tests, docs, and integration artifacts are updated for ${scope}.` },
      ];
    case AgentPhase.Reflect:
      return [
        { type: 'outcome-prompt', content: `Reflect prompt: capture outcomes, failures, and durable learnings from changes in ${scope}.` },
      ];
    default:
      return [];
  }
}

export function detectTaskPhase(input: PhaseDetectionInput): TaskPhaseDetectorOutput {
  const detection = classifyWithSignals(input.intent, input.recentToolCalls ?? []);
  if (input.previousPhase !== undefined && input.previousPhase !== detection.phase) {
    detection.transitionedFrom = input.previousPhase;
  }
  const proactiveIntel = buildPhaseProactiveIntel(detection.phase, input.affectedFiles ?? []);
  return {
    kind: 'TaskPhaseDetectorResult.v1',
    detection,
    proactiveIntel,
  };
}

export function createTaskPhaseDetectorConstruction(): Construction<
  PhaseDetectionInput,
  TaskPhaseDetectorOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'task-phase-detector',
    name: 'Task Phase Detector',
    description: 'Classifies agent lifecycle phase and emits phase-appropriate proactive intelligence.',
    async execute(input: PhaseDetectionInput) {
      return ok<TaskPhaseDetectorOutput, ConstructionError>(detectTaskPhase(input));
    },
  };
}
