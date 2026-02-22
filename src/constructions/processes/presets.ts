import { ok, unwrapConstructionExecutionResult, type Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';
import { createAgentDispatchConstruction } from './agent_dispatch_construction.js';
import { createObservationExtractionConstruction } from './observation_extraction_construction.js';
import { createCostControlConstruction } from './cost_control_construction.js';

export interface PresetProcessInput {
  dryRun?: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  budget?: {
    maxDurationMs?: number;
    maxTokenBudget?: number;
    maxUsd?: number;
  };
}

export interface PresetProcessOutput {
  preset: string;
  pattern: string;
  stages: string[];
  costEstimateUsd: string;
  executed: boolean;
  execution?: {
    commandLine: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    observationCount: number;
  };
  budget?: {
    allowed: boolean;
    breaches: string[];
  };
}

function createPresetConstruction(definition: {
  id: string;
  name: string;
  description: string;
  pattern: string;
  stages: string[];
  costEstimateUsd: string;
}): Construction<PresetProcessInput, PresetProcessOutput, ConstructionError, unknown> {
  const dispatchConstruction = createAgentDispatchConstruction();
  const extractionConstruction = createObservationExtractionConstruction();
  const costControlConstruction = createCostControlConstruction();

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    async execute(input: PresetProcessInput) {
      const dryRun = input.dryRun !== false;
      if (dryRun || !input.command) {
        return ok<PresetProcessOutput, ConstructionError>({
          preset: definition.id,
          pattern: definition.pattern,
          stages: definition.stages,
          costEstimateUsd: definition.costEstimateUsd,
          executed: false,
        });
      }

      const dispatch = unwrapConstructionExecutionResult(await dispatchConstruction.execute({
        command: input.command,
        args: input.args ?? [],
        cwd: input.cwd,
        env: input.env,
        timeoutMs: input.timeoutMs,
      }));
      const extraction = unwrapConstructionExecutionResult(
        await extractionConstruction.execute({ output: dispatch.stdout }),
      );
      const budget = unwrapConstructionExecutionResult(await costControlConstruction.execute({
        budget: {
          maxDurationMs: input.budget?.maxDurationMs,
          maxTokens: input.budget?.maxTokenBudget,
          maxUsd: input.budget?.maxUsd,
        },
        usage: {
          durationMs: dispatch.durationMs,
        },
      }));

      return ok<PresetProcessOutput, ConstructionError>({
        preset: definition.id,
        pattern: definition.pattern,
        stages: definition.stages,
        costEstimateUsd: definition.costEstimateUsd,
        executed: true,
        execution: {
          commandLine: dispatch.commandLine,
          exitCode: dispatch.exitCode,
          timedOut: dispatch.timedOut,
          durationMs: dispatch.durationMs,
          observationCount: extraction.incrementalObservations.length,
        },
        budget: {
          allowed: budget.allowed,
          breaches: budget.breaches,
        },
      });
    },
  };
}

export function createCodeReviewPipelineConstruction(): Construction<PresetProcessInput, PresetProcessOutput, ConstructionError, unknown> {
  return createPresetConstruction({
    id: 'code-review-pipeline',
    name: 'Code Review Pipeline',
    description: 'Parallel security + quality + performance review process template.',
    pattern: 'parallel_fanout_then_merge',
    stages: ['security-review', 'quality-review', 'performance-review', 'merge-findings'],
    costEstimateUsd: 'low-to-medium',
  });
}

export function createMigrationAssistantConstruction(): Construction<PresetProcessInput, PresetProcessOutput, ConstructionError, unknown> {
  return createPresetConstruction({
    id: 'migration-assistant',
    name: 'Migration Assistant',
    description: 'Analyze -> Plan -> Execute -> Verify migration pipeline template.',
    pattern: 'sequential_pipeline',
    stages: ['analyze', 'plan', 'execute', 'verify'],
    costEstimateUsd: 'medium',
  });
}

export function createDocumentationGeneratorConstruction(): Construction<PresetProcessInput, PresetProcessOutput, ConstructionError, unknown> {
  return createPresetConstruction({
    id: 'documentation-generator',
    name: 'Documentation Generator',
    description: 'Single-agent exploration and documentation synthesis template.',
    pattern: 'single_agent',
    stages: ['explore', 'draft', 'validate'],
    costEstimateUsd: 'low',
  });
}

export function createRegressionDetectorConstruction(): Construction<PresetProcessInput, PresetProcessOutput, ConstructionError, unknown> {
  return createPresetConstruction({
    id: 'regression-detector',
    name: 'Regression Detector',
    description: 'Before/after comparative patrol template for regression analysis.',
    pattern: 'dual_run_compare',
    stages: ['baseline-run', 'candidate-run', 'diff-analysis'],
    costEstimateUsd: 'medium',
  });
}

export function createOnboardingAssistantConstruction(): Construction<PresetProcessInput, PresetProcessOutput, ConstructionError, unknown> {
  return createPresetConstruction({
    id: 'onboarding-assistant',
    name: 'Onboarding Assistant',
    description: 'Bootstrap and explain codebase workflow for new contributors.',
    pattern: 'guided_single_agent',
    stages: ['bootstrap', 'map', 'summarize', 'guide'],
    costEstimateUsd: 'low',
  });
}

export function createReleaseQualificationConstruction(): Construction<PresetProcessInput, PresetProcessOutput, ConstructionError, unknown> {
  return createPresetConstruction({
    id: 'release-qualification',
    name: 'Release Qualification',
    description: 'Quality gate + evidence synthesis release-readiness template.',
    pattern: 'multi_gate_validation',
    stages: ['gates', 'evidence', 'report'],
    costEstimateUsd: 'medium-to-high',
  });
}

export function createDependencyAuditorConstruction(): Construction<PresetProcessInput, PresetProcessOutput, ConstructionError, unknown> {
  return createPresetConstruction({
    id: 'dependency-auditor',
    name: 'Dependency Auditor',
    description: 'Dependency risk scanning and remediation proposal template.',
    pattern: 'scan_analyze_recommend',
    stages: ['scan', 'classify', 'recommend', 'verify'],
    costEstimateUsd: 'low',
  });
}
