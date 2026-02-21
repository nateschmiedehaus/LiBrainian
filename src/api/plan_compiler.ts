import type { LiBrainianStorage } from '../storage/types.js';
import type {
  TechniqueComposition,
  TechniqueCompositionGraphVersion,
  TechniqueOperator,
  TechniqueOperatorType,
  TechniquePrimitive,
  TechniqueRelationship,
} from '../strategic/techniques.js';
import { getOperatorSemantics, getRelationshipSemantics } from '../strategic/technique_semantics.js';
import type {
  AcceptanceCriterion,
  DependencyType,
  PriorityLevel,
  WorkHierarchy,
  WorkPrimitive,
  WorkPrimitiveType,
  WorkTemplate,
  WorkExecutionContext,
  WorkResourceEstimates,
  WorkDependencySummary,
  WorkFileReference,
  WorkEntityReference,
  WorkEpisodeReference,
  WorkToolSuggestion,
  WorkExternalDependency,
  SuggestedStep,
} from '../strategic/work_primitives.js';
import type { VerificationPlan } from '../strategic/verification_plan.js';
import type { ContextPack, ContextPackType, LiBrainianResponse } from '../types.js';
import { createVerificationPlan } from '../strategic/verification_plan.js';
import {
  DEFAULT_TECHNIQUE_COMPOSITIONS,
  assertCompositionReferences,
  ensureTechniqueCompositions,
  validateTechniqueComposition,
} from './technique_compositions.js';
import { ensureTechniquePrimitives } from './technique_library.js';
import { ClosedLoopLearner, type LearnedRecommendations } from './learning_loop.js';
import {
  SemanticCompositionSelector,
  buildLearningSignalMap,
  type CompositionSelectionMode,
  type CompositionSelectionOptions,
} from './composition_selector.js';
import { selectTechniqueCompositionsByKeyword } from './composition_keywords.js';
import { ProviderUnavailableError } from './provider_check.js';
import { runAdequacyScan, type AdequacyReport, type AdequacyRequirement } from './difficulty_detectors.js';

const SAFE_ID_PATTERN = /[^a-zA-Z0-9_-]/g;

// Sanitize identifiers for error messages only; do not use for lookups.
function sanitizeId(value: unknown): string {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  return value.replace(SAFE_ID_PATTERN, '_').slice(0, 120);
}

export interface PlanWorkOptions extends CompositionSelectionOptions {
  target?: string;
  taskType?: string;
  scope?: string;
  constraints?: string[];
  owner?: string;
  priority?: PriorityLevel;
  useLearning?: boolean;
  workspaceRoot?: string;
  adequacyReport?: AdequacyReport | null;
  enableAdequacyScan?: boolean;
  compositionId?: string;
}

export interface PlanWorkResult {
  composition: TechniqueComposition;
  workHierarchy: WorkHierarchy;
  verificationPlans: VerificationPlan[];
  missingPrimitiveIds: string[];
  adequacyReport?: AdequacyReport | null;
}

function resolveGraphVersion(composition: TechniqueComposition): TechniqueCompositionGraphVersion {
  return composition.graphVersion === 2 ? 2 : 1;
}

export function selectTechniqueCompositions(
  intent: string,
  compositions: TechniqueComposition[] = DEFAULT_TECHNIQUE_COMPOSITIONS
): TechniqueComposition[] {
  return selectTechniqueCompositionsByKeyword(intent, compositions);
}

export function selectMethods(
  intent: string,
  compositions: TechniqueComposition[] = DEFAULT_TECHNIQUE_COMPOSITIONS
): TechniqueComposition[] {
  return selectTechniqueCompositions(intent, compositions);
}

function logSelectionFallback(intent: string, reason: string): void {
  const safeIntent = intent.replace(/\s+/g, ' ').trim().slice(0, 200);
  console.warn(`[librainian] Composition selection fallback: ${reason}. intent="${safeIntent}"`);
}

function shouldFallbackToKeyword(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof ProviderUnavailableError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('unverified_by_trace(provider_unavailable)') ||
    message.includes('unverified_by_trace(embedding_request_failed)') ||
    message.includes('unverified_by_trace(embedding_redaction_blocked)')
  );
}

export async function selectTechniqueCompositionsFromStorage(
  storage: LiBrainianStorage,
  intent: string,
  options: CompositionSelectionOptions & { useLearning?: boolean } = {}
): Promise<TechniqueComposition[]> {
  const compositions = await ensureTechniqueCompositions(storage);
  const selectionMode: CompositionSelectionMode = options.selectionMode ?? 'semantic';
  const allowKeywordFallback = options.allowKeywordFallback ?? true;
  let selections: TechniqueComposition[] = [];
  let recommendations: LearnedRecommendations | null = null;
  if (options.useLearning !== false) {
    try {
      const learner = new ClosedLoopLearner(storage);
      recommendations = await learner.getRecommendations(intent, {
        fallbackToGlobal: true,
      });
    } catch {
      recommendations = null;
    }
  }
  const learningSignals = options.useLearning === false
    ? undefined
    : (options.learningSignals ?? (recommendations ? buildLearningSignalMap(recommendations) : undefined));
  if (selectionMode !== 'keyword') {
    try {
      const selector = new SemanticCompositionSelector({
        compositions,
        providerCheck: options.providerCheck,
      });
      const matches = await selector.select(intent, {
        ...options,
        learningSignals,
      });
      selections = matches.map((match) => match.composition);
    } catch (error) {
      if (!allowKeywordFallback || !shouldFallbackToKeyword(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      logSelectionFallback(intent, `semantic selection failed: ${message}`);
    }
  }
  if (
    selectionMode === 'keyword' ||
    (selectionMode === 'semantic' && selections.length === 0 && allowKeywordFallback)
  ) {
    if (selectionMode === 'semantic') {
      logSelectionFallback(intent, 'no semantic matches above threshold');
    }
    selections = selectTechniqueCompositions(intent, compositions);
  }
  if (selectionMode === 'hybrid') {
    const keywordSelections = selectTechniqueCompositions(intent, compositions);
    const selectionIds = new Set(selections.map((composition) => composition.id));
    for (const keywordMatch of keywordSelections) {
      if (!selectionIds.has(keywordMatch.id)) {
        selections.push(keywordMatch);
        selectionIds.add(keywordMatch.id);
      }
    }
  }
  if (options.maxResults && options.maxResults > 0) {
    selections = selections.slice(0, options.maxResults);
  }
  if (options.useLearning === false) {
    return selections;
  }
  return rankCompositionsWithLearning(selections, compositions, recommendations);
}

function rankCompositionsWithLearning(
  selections: TechniqueComposition[],
  compositions: TechniqueComposition[],
  recommendations: LearnedRecommendations | null
): TechniqueComposition[] {
  if (!recommendations || recommendations.suggestedCompositions.length === 0) {
    return selections;
  }
  const compositionById = new Map(compositions.map((composition) => [composition.id, composition]));
  const recommendedIds = recommendations.suggestedCompositions
    .map((suggestion) => suggestion.compositionId)
    .filter((id) => compositionById.has(id));
  if (recommendedIds.length === 0) {
    return selections;
  }
  const selectionIds = new Set(selections.map((composition) => composition.id));
  const prioritized: TechniqueComposition[] = [];
  const seen = new Set<string>();
  for (const id of recommendedIds) {
    if (!selectionIds.has(id)) continue;
    const composition = compositionById.get(id);
    if (composition) {
      prioritized.push(composition);
      seen.add(id);
    }
  }
  const remainder = selections.filter((composition) => !seen.has(composition.id));
  const extras = recommendedIds
    .filter((id) => !selectionIds.has(id) && !seen.has(id))
    .map((id) => {
      seen.add(id);
      return compositionById.get(id);
    })
    .filter((value): value is TechniqueComposition => Boolean(value));
  if (selections.length === 0) {
    return [...prioritized, ...extras];
  }
  return [...prioritized, ...remainder, ...extras];
}

export function compileTechniqueCompositionTemplate(
  composition: TechniqueComposition,
  primitives: TechniquePrimitive[]
): WorkTemplate {
  const now = new Date().toISOString();
  const primitiveById = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const acceptanceCriteria = [
    'All technique primitives executed and verified',
    ...composition.primitiveIds.map((primitiveId) => {
      const primitive = primitiveById.get(primitiveId);
      return `Complete: ${primitive?.name ?? primitiveId}`;
    }),
  ];
  const suggestedSteps: SuggestedStep[] = composition.primitiveIds.map((primitiveId) => {
    const primitive = primitiveById.get(primitiveId);
    return {
      title: primitive?.name ?? primitiveId,
      type: 'task',
      description: primitive?.intent,
      optional: false,
    };
  });

  return {
    id: `wt_${composition.id}`,
    name: composition.name,
    description: composition.description,
    type: 'task',
    category: 'composition',
    titlePattern: `${composition.name}: {target}`,
    descriptionTemplate: composition.description,
    defaultAcceptanceCriteria: acceptanceCriteria,
    suggestedSteps,
    defaultTags: ['technique-composition', composition.id],
    defaultLabels: [],
    defaultPriority: 'medium',
    defaultEffort: 'moderate',
    createdAt: now,
    createdBy: 'librainian',
    usageCount: 0,
  };
}

export function compileTechniqueCompositionTemplateWithGaps(
  composition: TechniqueComposition,
  primitives: TechniquePrimitive[]
): { template: WorkTemplate; missingPrimitiveIds: string[] } {
  const validation = validateTechniqueComposition(composition, primitives);
  return {
    template: compileTechniqueCompositionTemplate(composition, primitives),
    missingPrimitiveIds: validation.missingPrimitiveIds,
  };
}

export function compileTechniqueCompositionPrototype(
  composition: TechniqueComposition,
  primitives: TechniquePrimitive[]
): { template: WorkTemplate; verificationPlans: VerificationPlan[] } {
  const now = new Date().toISOString();
  const verificationPlans = createPrototypeVerificationPlans(composition.id, composition.name, now);
  return {
    template: compileTechniqueCompositionTemplate(composition, primitives),
    verificationPlans,
  };
}

export function compileTechniqueCompositionBundle(
  composition: TechniqueComposition,
  primitives: TechniquePrimitive[]
): { template: WorkTemplate; primitives: TechniquePrimitive[]; missingPrimitiveIds: string[] } {
  const primitiveById = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const selectedPrimitives = composition.primitiveIds
    .map((id) => primitiveById.get(id))
    .filter((primitive): primitive is TechniquePrimitive => Boolean(primitive));
  const validation = validateTechniqueComposition(composition, primitives);

  return {
    template: compileTechniqueCompositionTemplate(composition, primitives),
    primitives: selectedPrimitives,
    missingPrimitiveIds: validation.missingPrimitiveIds,
  };
}

export async function compileTechniqueCompositionTemplateFromStorage(
  storage: LiBrainianStorage,
  compositionId: string
): Promise<WorkTemplate | null> {
  const compositions = await ensureTechniqueCompositions(storage);
  const composition = compositions.find((item) => item.id === compositionId);
  if (!composition) {
    return null;
  }
  const primitives = await ensureTechniquePrimitives(storage);
  return compileTechniqueCompositionTemplate(composition, primitives);
}

export async function compileTechniqueCompositionTemplateWithGapsFromStorage(
  storage: LiBrainianStorage,
  compositionId: string
): Promise<{ template: WorkTemplate | null; missingPrimitiveIds: string[] }> {
  const compositions = await ensureTechniqueCompositions(storage);
  const composition = compositions.find((item) => item.id === compositionId);
  if (!composition) {
    return { template: null, missingPrimitiveIds: [] };
  }
  const primitives = await ensureTechniquePrimitives(storage);
  return compileTechniqueCompositionTemplateWithGaps(composition, primitives);
}

export async function compileTechniqueCompositionBundleFromStorage(
  storage: LiBrainianStorage,
  compositionId: string
): Promise<{ template: WorkTemplate | null; primitives: TechniquePrimitive[]; missingPrimitiveIds: string[] }> {
  const compositions = await ensureTechniqueCompositions(storage);
  const composition = compositions.find((item) => item.id === compositionId);
  if (!composition) {
    return { template: null, primitives: [], missingPrimitiveIds: [] };
  }
  const primitives = await ensureTechniquePrimitives(storage);
  return compileTechniqueCompositionBundle(composition, primitives);
}

export async function compileTechniqueBundlesFromIntent(
  storage: LiBrainianStorage,
  intent: string,
  options?: { limit?: number; useLearning?: boolean } & CompositionSelectionOptions
): Promise<Array<{ template: WorkTemplate; primitives: TechniquePrimitive[]; missingPrimitiveIds: string[] }>> {
  const selections = await selectTechniqueCompositionsFromStorage(storage, intent, {
    useLearning: options?.useLearning,
    selectionMode: options?.selectionMode,
    maxResults: options?.maxResults,
    minConfidence: options?.minConfidence,
    includeAlternatives: options?.includeAlternatives,
    alternativesLimit: options?.alternativesLimit,
    includeIntentEmbedding: options?.includeIntentEmbedding,
    allowKeywordFallback: options?.allowKeywordFallback,
    providerCheck: options?.providerCheck,
  });
  const limited = options?.limit && options.limit > 0
    ? selections.slice(0, options.limit)
    : selections;
  const primitives = await ensureTechniquePrimitives(storage);
  return limited.map((composition) => compileTechniqueCompositionBundle(composition, primitives));
}

export function planWorkFromComposition(
  composition: TechniqueComposition,
  primitives: TechniquePrimitive[],
  options: PlanWorkOptions = {}
): PlanWorkResult {
  const now = new Date().toISOString();
  const graphVersion = resolveGraphVersion(composition);
  const templateResult = compileTechniqueCompositionTemplateWithGaps(composition, primitives);
  const prototype = compileTechniqueCompositionPrototype(composition, primitives);
  const target = options.target ?? composition.name;
  const title = templateResult.template.titlePattern.replace('{target}', target);

  assertCompositionReferences(
    { compositions: [composition], primitives },
    { allowMissingPrimitives: true }
  );
  const root = createWorkPrimitive({
    id: `wp_${composition.id}_${now.replace(/[:.]/g, '-')}`,
    type: templateResult.template.type,
    title,
    description: templateResult.template.descriptionTemplate,
    acceptanceCriteria: templateResult.template.defaultAcceptanceCriteria,
    tags: templateResult.template.defaultTags,
    labels: templateResult.template.defaultLabels,
    assignee: options.owner,
    priorityLevel: options.priority,
    metadata: {
      compositionId: composition.id,
      compositionName: composition.name,
      primitiveIds: composition.primitiveIds,
      operators: composition.operators ?? [],
      relationships: composition.relationships ?? [],
      graphVersion,
      target,
      scope: options.scope,
      constraints: options.constraints ?? [],
    },
    now,
  });

  const stepNodes = templateResult.template.suggestedSteps.map((step, index) => {
    const stepTitle = step.title;
    return createWorkPrimitive({
      id: `wp_${composition.id}_step_${index + 1}`,
      type: step.type,
      title: stepTitle,
      description: step.description ?? '',
      acceptanceCriteria: [`Complete: ${stepTitle}`],
      tags: [...templateResult.template.defaultTags, 'step'],
      labels: templateResult.template.defaultLabels,
      metadata: {
        compositionId: composition.id,
        primitiveId: composition.primitiveIds[index],
        optional: step.optional,
      },
      now,
    });
  });

  const operatorNodes = compileOperatorNodes(
    composition.operators ?? [],
    templateResult.template.defaultTags,
    templateResult.template.defaultLabels,
    now,
    graphVersion
  );

  const checkpointNodes = prototype.verificationPlans.map((plan, index) => {
    return createWorkPrimitive({
      id: `wp_${composition.id}_checkpoint_${index + 1}`,
      type: 'checkpoint',
      title: `Verify: ${plan.target}`,
      description: plan.expectedObservations.join('\n'),
      acceptanceCriteria: plan.expectedObservations.length > 0 ? plan.expectedObservations : ['Verification complete'],
      tags: [...templateResult.template.defaultTags, 'verification'],
      labels: templateResult.template.defaultLabels,
      metadata: {
        compositionId: composition.id,
        verificationPlanId: plan.id,
      },
      now,
    });
  });

  const adequacyReport = resolveAdequacyReport(options, target);
  const adequacyGateNodes = adequacyReport?.missingEvidence.length
    ? buildAdequacyGateNodes({
        composition,
        requirements: adequacyReport.missingEvidence,
        tags: templateResult.template.defaultTags,
        labels: templateResult.template.defaultLabels,
        now,
        adequacySpecId: adequacyReport.spec.id,
      })
    : [];

  const nodeIndex = buildWorkNodeIndex(stepNodes, operatorNodes, checkpointNodes);
  const dependencyCounter = { value: 0 };
  applyOperatorEdges(composition.operators ?? [], nodeIndex, dependencyCounter, now, graphVersion);
  applyTechniqueRelationships(composition.relationships ?? [], nodeIndex, dependencyCounter, now, graphVersion);
  if (adequacyGateNodes.length > 0) {
    attachAdequacyDependencies(
      [...stepNodes, ...operatorNodes, ...checkpointNodes],
      adequacyGateNodes,
      dependencyCounter,
      now
    );
  }
  const children = [...adequacyGateNodes, ...stepNodes, ...operatorNodes, ...checkpointNodes]
    .map((node) => buildHierarchy(node, []));
  const workHierarchy = buildHierarchy(root, children);
  return {
    composition,
    workHierarchy,
    verificationPlans: prototype.verificationPlans,
    missingPrimitiveIds: templateResult.missingPrimitiveIds,
    adequacyReport,
  };
}

export function planWorkFromCompositionWithContext(
  composition: TechniqueComposition,
  primitives: TechniquePrimitive[],
  context: LiBrainianResponse,
  options: PlanWorkOptions = {}
): PlanWorkResult {
  const base = planWorkFromComposition(composition, primitives, {
    ...options,
    adequacyReport: options.adequacyReport ?? context.adequacy ?? null,
  });
  const primitiveById = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const enrichedHierarchy = enrichWorkHierarchy(base.workHierarchy, context, primitiveById);
  return { ...base, workHierarchy: enrichedHierarchy };
}

export async function planWorkFromIntent(
  storage: LiBrainianStorage,
  intent: string,
  options: PlanWorkOptions = {}
): Promise<PlanWorkResult[]> {
  const compositions = await resolveCompositionsForPlan(storage, intent, options);
  const primitives = await ensureTechniquePrimitives(storage);
  const target = options.target ?? intent;
  return compositions.map((composition) => planWorkFromComposition(composition, primitives, {
    ...options,
    target,
  }));
}

export async function planWorkFromIntentWithContext(
  storage: LiBrainianStorage,
  intent: string,
  context: LiBrainianResponse,
  options: PlanWorkOptions = {}
): Promise<PlanWorkResult[]> {
  const compositions = await resolveCompositionsForPlan(storage, intent, options);
  const primitives = await ensureTechniquePrimitives(storage);
  const target = options.target ?? intent;
  return compositions.map((composition) =>
    planWorkFromCompositionWithContext(composition, primitives, context, {
      ...options,
      target,
    })
  );
}

async function resolveCompositionsForPlan(
  storage: LiBrainianStorage,
  intent: string,
  options: PlanWorkOptions
): Promise<TechniqueComposition[]> {
  if (options.compositionId) {
    const compositions = await ensureTechniqueCompositions(storage);
    const match = compositions.find((composition) => composition.id === options.compositionId);
    if (!match) {
      const safeId = sanitizeId(options.compositionId);
      throw new Error(`unverified_by_trace(composition_missing): ${safeId}`);
    }
    return [match];
  }

  return selectTechniqueCompositionsFromStorage(storage, intent, {
    useLearning: options.useLearning,
    selectionMode: options.selectionMode,
    maxResults: options.maxResults,
    minConfidence: options.minConfidence,
    includeAlternatives: options.includeAlternatives,
    alternativesLimit: options.alternativesLimit,
    includeIntentEmbedding: options.includeIntentEmbedding,
    allowKeywordFallback: options.allowKeywordFallback,
    providerCheck: options.providerCheck,
  });
}

function createPrototypeVerificationPlans(
  compositionId: string,
  compositionName: string,
  timestamp: string
): VerificationPlan[] {
  switch (compositionId) {
    case 'tc_agentic_review_v1':
      return [
        createVerificationPlan({
          id: 'vp_tc_agentic_review_v1',
          target: compositionName,
          methods: [
            {
              type: 'code_review',
              description: 'Review diffs, risks, and evidence coverage.',
              automatable: false,
            },
          ],
          expectedObservations: [
            'Review notes recorded with risks and mitigations.',
            'Verification plan linked to changes.',
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      ];
    case 'tc_root_cause_recovery':
      return [
        createVerificationPlan({
          id: 'vp_tc_root_cause_recovery',
          target: compositionName,
          methods: [
            {
              type: 'manual_test',
              description: 'Reproduce failure and confirm fix.',
              automatable: false,
            },
          ],
          expectedObservations: [
            'Failure reproduction documented.',
            'Root cause evidence linked to fix.',
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      ];
    case 'tc_release_readiness':
      return [
        createVerificationPlan({
          id: 'vp_tc_release_readiness',
          target: compositionName,
          methods: [
            {
              type: 'deployment',
              description: 'Run release checklist and rollout verification.',
              automatable: false,
            },
          ],
          expectedObservations: [
            'Release checklist completed.',
            'Rollback criteria documented.',
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      ];
    default:
      return [];
  }
}

const LEGACY_OPERATOR_WORK_TYPE: Record<TechniqueOperatorType, WorkPrimitiveType> = {
  sequence: 'task',
  parallel: 'task',
  conditional: 'task',
  loop: 'task',
  gate: 'checkpoint',
  fallback: 'task',
  merge: 'task',
  fanout: 'task',
  fanin: 'task',
  retry: 'task',
  escalate: 'checkpoint',
  checkpoint: 'checkpoint',
  interrupt: 'checkpoint',
  timebox: 'checkpoint',
  budget_cap: 'checkpoint',
  throttle: 'task',
  quorum: 'checkpoint',
  consensus: 'checkpoint',
  backoff: 'task',
  circuit_breaker: 'checkpoint',
  monitor: 'checkpoint',
  persist: 'task',
  replay: 'task',
  cache: 'task',
  reduce: 'task',
};


function compileOperatorNodes(
  operators: TechniqueOperator[],
  tags: string[],
  labels: Array<{ key: string; value: string; color?: string; description?: string }>,
  now: string,
  graphVersion: TechniqueCompositionGraphVersion
): WorkPrimitive[] {
  if (graphVersion === 1) {
    return operators.map((operator, index) => {
      const title = operator.label ?? `Operator: ${operator.type}`;
      const descriptionLines = [
        operator.label ? `Operator: ${operator.label}` : null,
        operator.conditions && operator.conditions.length > 0 ? `Conditions: ${operator.conditions.join('; ')}` : null,
        operator.inputs && operator.inputs.length > 0 ? `Inputs: ${operator.inputs.join(', ')}` : null,
        operator.outputs && operator.outputs.length > 0 ? `Outputs: ${operator.outputs.join(', ')}` : null,
      ].filter(Boolean);

      const type = LEGACY_OPERATOR_WORK_TYPE[operator.type];
      const operatorTags = [
        ...tags,
        'operator',
        `operator:${operator.type}`,
        type === 'checkpoint' ? 'verification-gate' : 'execution-step',
      ];
      return createWorkPrimitive({
        id: `wp_operator_${operator.id}_${index + 1}`,
        type,
        title,
        description: descriptionLines.join('\n'),
        acceptanceCriteria: buildOperatorAcceptanceCriteria(operator),
        tags: operatorTags,
        labels,
        metadata: {
          operatorId: operator.id,
          operatorType: operator.type,
          operatorInputs: operator.inputs ?? [],
          operatorOutputs: operator.outputs ?? [],
          operatorConditions: operator.conditions ?? [],
          operatorParameters: operator.parameters ?? {},
        },
        now,
      });
    });
  }

  const nodes: WorkPrimitive[] = [];
  for (const operator of operators) {
    const semantics = getOperatorSemantics(operator.type);
    if (semantics.compile !== 'checkpoint') {
      // Edge operators compile into dependencies only and do not create WorkPrimitive nodes.
      continue;
    }
    const title = operator.label ?? `Operator: ${operator.type}`;
    const descriptionLines = [
      operator.label ? `Operator: ${operator.label}` : null,
      operator.conditions && operator.conditions.length > 0 ? `Conditions: ${operator.conditions.join('; ')}` : null,
      operator.inputs && operator.inputs.length > 0 ? `Inputs: ${operator.inputs.join(', ')}` : null,
      operator.outputs && operator.outputs.length > 0 ? `Outputs: ${operator.outputs.join(', ')}` : null,
    ].filter(Boolean);

    const operatorTags = [
      ...tags,
      'operator',
      `operator:${operator.type}`,
      `operator_role:${semantics.role}`,
      'verification-gate',
    ];
    nodes.push(createWorkPrimitive({
      id: `wp_operator_${operator.id}`,
      type: 'checkpoint',
      title,
      description: descriptionLines.join('\n'),
      acceptanceCriteria: buildOperatorAcceptanceCriteria(operator),
      tags: operatorTags,
      labels,
      metadata: {
        operatorId: operator.id,
        operatorType: operator.type,
        operatorInputs: operator.inputs ?? [],
        operatorOutputs: operator.outputs ?? [],
        operatorConditions: operator.conditions ?? [],
        operatorParameters: operator.parameters ?? {},
      },
      now,
    }));
  }
  return nodes;
}

function buildOperatorAcceptanceCriteria(operator: TechniqueOperator): string[] {
  switch (operator.type) {
    case 'timebox':
      return ['Timebox elapsed or completed within bounds', 'Scope adjusted if timebox exceeded'];
    case 'budget_cap':
      return ['Budget usage recorded', 'Budget cap enforced or escalated'];
    case 'throttle':
      return ['Throttle limits applied', 'Throughput within safe bounds'];
    case 'quorum':
      return ['Quorum achieved', 'Dissent recorded when quorum fails'];
    case 'consensus':
      return ['Consensus decision recorded', 'Minority position captured'];
    case 'backoff':
      return ['Backoff schedule applied', 'Retries bounded'];
    case 'circuit_breaker':
      return ['Breaker state evaluated', 'Fail-closed or recovery path recorded'];
    case 'monitor':
      return ['Monitoring evidence captured', 'Anomalies recorded or cleared'];
    case 'persist':
      return ['State persisted with provenance', 'Recovery instructions recorded'];
    case 'replay':
      return ['Replay executed deterministically', 'Replay outcome captured'];
    case 'cache':
      return ['Cache policy recorded', 'Cache invalidation rules captured'];
    case 'reduce':
      return ['Reduction policy applied', 'Aggregated result recorded'];
    case 'gate':
    case 'checkpoint':
      return ['Gate criteria satisfied', 'Evidence attached to gate decision'];
    case 'escalate':
      return ['Escalation triggered with reason codes', 'Owner notified'];
    case 'interrupt':
      return ['Interrupt condition recorded', 'Safe stop confirmed'];
    default:
      return [`Operator ${operator.type} satisfied`];
  }
}

function buildWorkNodeIndex(
  stepNodes: WorkPrimitive[],
  operatorNodes: WorkPrimitive[],
  checkpointNodes: WorkPrimitive[]
): Map<string, WorkPrimitive> {
  const index = new Map<string, WorkPrimitive>();
  stepNodes.forEach((node) => {
    const primitiveId = node.metadata?.primitiveId as string | undefined;
    if (primitiveId) {
      index.set(primitiveId, node);
    }
  });
  operatorNodes.forEach((node) => {
    const operatorId = node.metadata?.operatorId as string | undefined;
    if (operatorId) {
      index.set(operatorId, node);
    }
  });
  checkpointNodes.forEach((node) => {
    const verificationPlanId = node.metadata?.verificationPlanId as string | undefined;
    if (verificationPlanId) {
      index.set(verificationPlanId, node);
    }
  });
  return index;
}

type DependencyCounter = { value: number };

function resolveAdequacyReport(options: PlanWorkOptions, intent: string): AdequacyReport | null {
  if (options.adequacyReport) {
    return options.adequacyReport;
  }
  if (options.enableAdequacyScan === false) {
    return null;
  }
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  return runAdequacyScan({
    intent,
    taskType: options.taskType,
    workspaceRoot,
  });
}

function buildAdequacyGateNodes(options: {
  composition: TechniqueComposition;
  requirements: AdequacyRequirement[];
  tags: string[];
  labels: Array<{ key: string; value: string; color?: string; description?: string }>;
  now: string;
  adequacySpecId: string;
}): WorkPrimitive[] {
  const { composition, requirements, tags, labels, now, adequacySpecId } = options;
  return requirements.map((req, index) =>
    createWorkPrimitive({
      id: `wp_${composition.id}_adequacy_${index + 1}`,
      type: 'checkpoint',
      title: `Adequacy gate: ${req.id}`,
      description: req.description,
      acceptanceCriteria: req.evidenceCommands.length > 0
        ? req.evidenceCommands
        : [`Evidence required: ${req.description}`],
      tags: [...tags, 'adequacy', 'verification-gate', `adequacy:${req.id}`],
      labels,
      metadata: {
        compositionId: composition.id,
        adequacySpecId,
        adequacyRequirementId: req.id,
        adequacySeverity: req.severity,
      },
      now,
    })
  );
}

function attachAdequacyDependencies(
  nodes: WorkPrimitive[],
  gateNodes: WorkPrimitive[],
  counter: DependencyCounter,
  now: string
): void {
  for (const gate of gateNodes) {
    for (const node of nodes) {
      addDependency(node, gate, 'blocked_by', `adequacy_gate:${gate.id}`, counter, now);
    }
  }
}

function applyTechniqueRelationships(
  relationships: TechniqueRelationship[],
  nodeIndex: Map<string, WorkPrimitive>,
  counter: DependencyCounter,
  now: string,
  graphVersion: TechniqueCompositionGraphVersion
): void {
  for (const relationship of relationships) {
    const fromNode = nodeIndex.get(relationship.fromId);
    const toNode = nodeIndex.get(relationship.toId);
    if (!fromNode || !toNode) {
      if (graphVersion === 1) {
        continue;
      }
      throw new Error(
        `unverified_by_trace(relationship_missing_nodes): ${relationship.type} from=${relationship.fromId} to=${relationship.toId}`
      );
    }
    let semantics: ReturnType<typeof getRelationshipSemantics>;
    try {
      semantics = getRelationshipSemantics(relationship.type);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      throw new Error(
        `unverified_by_trace(relationship_semantics_missing): ${relationship.type} reason=${reason}`
      );
    }
    const description = relationship.notes ?? `relationship:${relationship.type}`;
    switch (semantics.direction) {
      case 'from_to':
        addDependency(fromNode, toNode, semantics.dependencyType, description, counter, now);
        break;
      case 'to_from':
        addDependency(toNode, fromNode, semantics.dependencyType, description, counter, now);
        break;
      case 'bidirectional':
        addDependency(fromNode, toNode, semantics.dependencyType, description, counter, now);
        addDependency(toNode, fromNode, semantics.dependencyType, description, counter, now);
        break;
      default:
        throw new Error(`unverified_by_trace(relationship_direction_unknown): ${relationship.type}`);
    }
  }
}

function applyOperatorEdges(
  operators: TechniqueOperator[],
  nodeIndex: Map<string, WorkPrimitive>,
  counter: DependencyCounter,
  now: string,
  graphVersion: TechniqueCompositionGraphVersion
): void {
  if (graphVersion === 1) {
    for (const operator of operators) {
      const operatorNode = nodeIndex.get(operator.id);
      if (!operatorNode) {
        throw new Error(`unverified_by_trace(operator_missing_node): ${operator.id}`);
      }
      const missingInputs = (operator.inputs ?? []).filter((id) => !nodeIndex.has(id));
      const missingOutputs = (operator.outputs ?? []).filter((id) => !nodeIndex.has(id));
      if (missingInputs.length > 0 || missingOutputs.length > 0) {
        const inputs = missingInputs.length > 0 ? missingInputs.join(',') : 'none';
        const outputs = missingOutputs.length > 0 ? missingOutputs.join(',') : 'none';
        throw new Error(
          `unverified_by_trace(operator_missing_targets): ${operator.id} inputs=${inputs} outputs=${outputs}`
        );
      }
      for (const inputId of operator.inputs ?? []) {
        const inputNode = nodeIndex.get(inputId);
        if (!inputNode) continue;
        addDependency(
          operatorNode,
          inputNode,
          'blocked_by',
          `operator_input:${operator.id}`,
          counter,
          now
        );
      }
      for (const outputId of operator.outputs ?? []) {
        const outputNode = nodeIndex.get(outputId);
        if (!outputNode) continue;
        addDependency(
          outputNode,
          operatorNode,
          'blocked_by',
          `operator_output:${operator.id}`,
          counter,
          now
        );
      }
    }
    return;
  }
  for (const operator of operators) {
    const semantics = getOperatorSemantics(operator.type);
    const inputs = operator.inputs ?? [];
    const outputs = operator.outputs ?? [];
    const safeOperatorId = sanitizeId(operator.id);

    if (semantics.compile === 'edge') {
      if (semantics.edgeStyle === 'fanout' && inputs.length !== 1) {
        throw new Error(`unverified_by_trace(operator_fanout_inputs): ${safeOperatorId}`);
      }
      if ((semantics.edgeStyle === 'fanin' || semantics.edgeStyle === 'reduce') && outputs.length === 0) {
        throw new Error(`unverified_by_trace(operator_missing_outputs): ${safeOperatorId}`);
      }
    }

    const missingInputs = inputs.filter((id) => !nodeIndex.has(id));
    const missingOutputs = outputs.filter((id) => !nodeIndex.has(id));
    if (missingInputs.length > 0 || missingOutputs.length > 0) {
      const missingInputList = missingInputs.length > 0 ? missingInputs.map(sanitizeId).join(',') : 'none';
      const missingOutputList = missingOutputs.length > 0 ? missingOutputs.map(sanitizeId).join(',') : 'none';
      throw new Error(
        `unverified_by_trace(operator_missing_targets): ${safeOperatorId} inputs=${missingInputList} outputs=${missingOutputList}`
      );
    }

    if (semantics.compile === 'checkpoint') {
      const operatorNode = nodeIndex.get(operator.id);
      if (!operatorNode) {
        throw new Error(`unverified_by_trace(operator_missing_node): ${safeOperatorId}`);
      }
      for (const inputId of operator.inputs ?? []) {
        const inputNode = nodeIndex.get(inputId);
        if (!inputNode) continue;
        addDependency(
          operatorNode,
          inputNode,
          'blocked_by',
          `operator_input:${operator.id}`,
          counter,
          now
        );
      }
      for (const outputId of operator.outputs ?? []) {
        const outputNode = nodeIndex.get(outputId);
        if (!outputNode) continue;
        addDependency(
          outputNode,
          operatorNode,
          'blocked_by',
          `operator_output:${operator.id}`,
          counter,
          now
        );
      }
      continue;
    }

    const edgeStyle = semantics.edgeStyle;
    switch (edgeStyle) {
      case 'sequence': {
        for (let i = 1; i < inputs.length; i += 1) {
          const fromNode = nodeIndex.get(inputs[i]);
          const toNode = nodeIndex.get(inputs[i - 1]);
          if (!fromNode || !toNode) continue;
          addDependency(fromNode, toNode, 'blocked_by', `operator_sequence:${operator.id}`, counter, now);
        }
        if (inputs.length > 0 && outputs.length > 0) {
          const tailNode = nodeIndex.get(inputs[inputs.length - 1]);
          if (tailNode) {
            for (const outputId of outputs) {
              const outputNode = nodeIndex.get(outputId);
              if (!outputNode) continue;
              addDependency(outputNode, tailNode, 'blocked_by', `operator_output:${operator.id}`, counter, now);
            }
          }
        }
        break;
      }
      case 'parallel': {
        if (outputs.length > 0) {
          for (const outputId of outputs) {
            const outputNode = nodeIndex.get(outputId);
            if (!outputNode) continue;
            for (const inputId of inputs) {
              const inputNode = nodeIndex.get(inputId);
              if (!inputNode) continue;
              addDependency(outputNode, inputNode, 'blocked_by', `operator_parallel:${operator.id}`, counter, now);
            }
          }
        }
        break;
      }
      case 'fanout': {
        const inputNode = nodeIndex.get(inputs[0]);
        if (inputNode) {
          for (const outputId of outputs) {
            const outputNode = nodeIndex.get(outputId);
            if (!outputNode) continue;
            addDependency(outputNode, inputNode, 'blocked_by', `operator_fanout:${operator.id}`, counter, now);
          }
        }
        break;
      }
      case 'fanin':
      case 'reduce': {
        for (const outputId of outputs) {
          const outputNode = nodeIndex.get(outputId);
          if (!outputNode) continue;
          for (const inputId of inputs) {
            const inputNode = nodeIndex.get(inputId);
            if (!inputNode) continue;
            addDependency(outputNode, inputNode, 'blocked_by', `operator_${edgeStyle}:${operator.id}`, counter, now);
          }
        }
        break;
      }
      default: {
        const exhaustive: never = edgeStyle;
        void exhaustive;
        throw new Error(`unverified_by_trace(operator_edge_style_unknown): ${safeOperatorId}`);
      }
    }
  }
}

function addDependency(
  fromNode: WorkPrimitive,
  toNode: WorkPrimitive,
  dependencyType: DependencyType,
  description: string,
  counter: DependencyCounter,
  now: string
): void {
  const hasDependency = fromNode.dependencies.some(
    (dep) => dep.targetId === toNode.id && dep.type === dependencyType
  );
  if (hasDependency) {
    return;
  }
  fromNode.dependencies.push(
    createWorkDependency({
      id: `wd_${counter.value++}`,
      targetId: toNode.id,
      type: dependencyType,
      description,
      now,
    })
  );
}

function createWorkDependency(input: {
  id: string;
  targetId: string;
  type: DependencyType;
  description: string;
  now: string;
}): {
  id: string;
  targetId: string;
  type: DependencyType;
  status: 'pending';
  description: string;
  addedAt: string;
  addedBy: string;
} {
  return {
    id: input.id,
    targetId: input.targetId,
    type: input.type,
    status: 'pending',
    description: input.description,
    addedAt: input.now,
    addedBy: 'librainian',
  };
}

function buildHierarchy(root: WorkPrimitive, children: WorkHierarchy[]): WorkHierarchy {
  children.forEach((child, index) => {
    child.root.parentId = root.id;
    child.root.siblingOrder = index;
  });
  root.childIds = children.map((child) => child.root.id);
  const descendantCounts = children.reduce(
    (acc, child) => {
      const completed = child.root.status === 'done' ? 1 : 0;
      const blocked = child.root.status === 'blocked' ? 1 : 0;
      return {
        total: acc.total + 1 + child.totalDescendants,
        completed: acc.completed + completed + child.completedDescendants,
        blocked: acc.blocked + blocked + child.blockedDescendants,
      };
    },
    { total: 0, completed: 0, blocked: 0 }
  );
  const depth = children.length > 0 ? 1 + Math.max(...children.map((child) => child.depth)) : 0;
  return {
    root,
    children,
    depth,
    totalDescendants: descendantCounts.total,
    completedDescendants: descendantCounts.completed,
    blockedDescendants: descendantCounts.blocked,
  };
}

function createAcceptanceCriteria(
  criteria: string[],
  now: string
): AcceptanceCriterion[] {
  return criteria.map((description, index) => ({
    id: `ac_${index + 1}_${now.replace(/[:.]/g, '-')}`,
    description,
    type: 'custom',
    verification: {
      type: 'other',
      description: 'Manual verification required.',
      automatable: false,
    },
    status: 'pending',
  }));
}

function createWorkPrimitive(input: {
  id: string;
  type: WorkPrimitiveType;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  tags: string[];
  labels: Array<{ key: string; value: string; color?: string; description?: string }>;
  metadata: Record<string, unknown>;
  now: string;
  assignee?: string;
  priorityLevel?: PriorityLevel;
}): WorkPrimitive {
  const now = input.now;
  const priorityLevel = input.priorityLevel ?? 'medium';
  return {
    id: input.id,
    type: input.type,
    version: 1,
    title: input.title,
    description: input.description,
    acceptanceCriteria: createAcceptanceCriteria(input.acceptanceCriteria, now),
    notes: [],
    parentId: null,
    childIds: [],
    siblingOrder: 0,
    dependencies: [],
    traceability: {
      affectedFiles: [],
      affectedContexts: [],
      linkedDecisions: [],
      linkedRequirements: [],
      linkedResearch: [],
      externalRefs: [],
      linkedCommits: [],
      linkedTests: [],
    },
    priority: {
      level: priorityLevel,
      score: 50,
      factors: [],
      computedAt: now,
      explanation: 'Default priority for compiled plan.',
    },
    impact: {
      userImpact: 'low',
      technicalImpact: 'low',
      businessImpact: 'low',
      riskLevel: 'low',
      affectedUserCount: 'unknown',
      affectedUserSegments: [],
      reversibility: 'moderate',
      cascadeEffects: [],
      confidence: 0.3,
      assessmentMethod: 'automated',
      assessedAt: now,
      assessedBy: 'librainian',
    },
    effort: {
      complexity: 'moderate',
      size: 'm',
      confidenceLevel: 0.4,
      uncertaintyFactors: ['unspecified'],
      estimatedAt: now,
      estimatedBy: 'librainian',
    },
    status: 'draft',
    statusHistory: [],
    assignee: input.assignee,
    reviewers: [],
    watchers: [],
    timing: {},
    evidence: [],
    tags: input.tags,
    labels: input.labels,
    metadata: input.metadata,
    confidence: {
      level: 'speculative',
      score: 0.3,
      factors: [],
      lastAssessed: now,
      assessedBy: 'system',
    },
    createdAt: now,
    createdBy: 'librainian',
    updatedAt: now,
    updatedBy: 'librainian',
    changeHistory: [],
  };
}

const PACK_TYPE_TO_ENTITY_TYPE: Record<ContextPackType, WorkEntityReference['type']> = {
  function_context: 'function',
  module_context: 'module',
  pattern_context: 'pattern',
  decision_context: 'decision',
  change_impact: 'change',
  similar_tasks: 'similar_task',
  doc_context: 'module', // Documentation treated as module-level for work entities
  project_understanding: 'module', // Project-level understanding treated as module-level
  symbol_definition: 'function', // Symbol definitions map to function (most common case)
  enumeration_result: 'module', // Enumeration results are module-level entity lists
  git_history: 'change', // Git history maps to change type for work entities
  call_flow: 'function', // Call flow traces map to function type
};

const TOOL_SUGGESTION_RULES: Array<{
  id: string;
  description: string;
  patterns: RegExp[];
}> = [
  {
    id: 'tests',
    description: 'Run targeted tests and verification checks.',
    patterns: [/test/, /verify/, /validation/, /quality/, /review/],
  },
  {
    id: 'profiling',
    description: 'Use profiling or benchmarking tools to validate performance.',
    patterns: [/performance/, /latency/, /throughput/, /profile/],
  },
  {
    id: 'security',
    description: 'Run security review steps and threat checks.',
    patterns: [/security/, /threat/, /vulnerability/, /abuse/],
  },
  {
    id: 'release',
    description: 'Use rollout checklists and deployment tooling.',
    patterns: [/release/, /deploy/, /rollout/, /migration/],
  },
  {
    id: 'incident',
    description: 'Capture timelines and postmortem evidence for incidents.',
    patterns: [/incident/, /root cause/, /recovery/, /failure/],
  },
];

function collectRelevantFiles(packs: ContextPack[]): WorkFileReference[] {
  const seen = new Set<string>();
  const files: WorkFileReference[] = [];
  for (const pack of packs) {
    for (const file of pack.relatedFiles ?? []) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push({ path: file, source: 'related_files', packId: pack.packId });
    }
    for (const snippet of pack.codeSnippets ?? []) {
      if (seen.has(snippet.filePath)) continue;
      seen.add(snippet.filePath);
      files.push({ path: snippet.filePath, source: 'snippet', packId: pack.packId });
    }
  }
  return files;
}

function collectRelevantEntities(packs: ContextPack[]): WorkEntityReference[] {
  const seen = new Set<string>();
  const entities: WorkEntityReference[] = [];
  for (const pack of packs) {
    const type = PACK_TYPE_TO_ENTITY_TYPE[pack.packType] ?? 'unknown';
    const key = `${type}:${pack.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push({ id: pack.targetId, type, packId: pack.packId });
  }
  return entities;
}

function collectPriorExamples(packs: ContextPack[]): WorkEpisodeReference[] {
  return packs
    .filter((pack) => pack.packType === 'similar_tasks')
    .map((pack) => ({
      id: pack.packId,
      summary: pack.summary,
    }));
}

function buildBaseExecutionContext(context: LiBrainianResponse): Omit<WorkExecutionContext, 'suggestedTools'> {
  return {
    relevantFiles: collectRelevantFiles(context.packs),
    relevantEntities: collectRelevantEntities(context.packs),
    priorExamples: collectPriorExamples(context.packs),
  };
}

function deriveToolSuggestions(primitive: TechniquePrimitive | undefined, node: WorkPrimitive): WorkToolSuggestion[] {
  const rawText = [
    primitive?.id,
    primitive?.name,
    primitive?.intent,
    node.title,
    node.description,
    ...node.tags,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
  const suggestions = new Map<string, WorkToolSuggestion>();
  for (const rule of TOOL_SUGGESTION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(rawText))) {
      suggestions.set(rule.id, { id: rule.id, description: rule.description });
    }
  }
  return Array.from(suggestions.values());
}

function estimateWorkResources(
  context: LiBrainianResponse,
  node: WorkPrimitive,
  totalNodes: number,
  depth: number
): WorkResourceEstimates {
  const packCount = context.packs.length;
  const confidence = Math.min(0.9, Math.max(0.1, context.coverage?.coverageConfidence ?? 0.3));
  let complexity: WorkResourceEstimates['complexity'] = 'unknown';
  if (packCount > 0) {
    if (packCount <= 2) complexity = 'trivial';
    else if (packCount <= 4) complexity = 'simple';
    else if (packCount <= 8) complexity = 'moderate';
    else complexity = 'complex';
  }

  if (context.query.depth === 'L3' && complexity !== 'unknown') {
    complexity = complexity === 'trivial' ? 'simple' : complexity === 'simple' ? 'moderate' : 'complex';
  }

  const baseMin = packCount === 0 ? 128 : 256 + packCount * 64;
  const baseMax = packCount === 0 ? 512 : 1024 + packCount * 160;
  const baseSteps = Math.max(1, Math.min(10, Math.ceil(packCount / 2)));
  const isAggregate = node.parentId === null || node.childIds.length > 0;
  const minSteps = isAggregate ? Math.max(1, Math.min(baseSteps, totalNodes)) : 1;
  const maxSteps = isAggregate ? Math.max(minSteps, Math.min(baseSteps + totalNodes, 20)) : Math.max(1, Math.min(3, baseSteps));

  return {
    tokenBudget: { min: baseMin, max: baseMax, confidence },
    stepCount: { min: minSteps, max: maxSteps },
    complexity: depth > 2 && complexity === 'simple' ? 'moderate' : complexity,
  };
}

function summarizeDependencies(node: WorkPrimitive): WorkDependencySummary {
  const blockedBy: string[] = [];
  const enables: string[] = [];
  const external: WorkExternalDependency[] = [];
  for (const dep of node.dependencies) {
    if (dep.type === 'blocked_by') {
      blockedBy.push(dep.targetId);
    }
    if (dep.type === 'blocks') {
      enables.push(dep.targetId);
    }
    if (dep.type.startsWith('requires_')) {
      external.push({ type: dep.type as DependencyType, targetId: dep.targetId, description: dep.description });
    }
  }
  return { blockedBy, enables, external };
}

function resolvePrimitiveForNode(node: WorkPrimitive, primitiveById: Map<string, TechniquePrimitive>): TechniquePrimitive | undefined {
  const primitiveId = node.metadata?.primitiveId;
  return typeof primitiveId === 'string' ? primitiveById.get(primitiveId) : undefined;
}

function enrichWorkHierarchy(
  hierarchy: WorkHierarchy,
  context: LiBrainianResponse,
  primitiveById: Map<string, TechniquePrimitive>
): WorkHierarchy {
  const baseContext = buildBaseExecutionContext(context);
  const totalNodes = Math.max(1, hierarchy.totalDescendants + 1);

  const enrichNode = (node: WorkPrimitive, depth: number): WorkPrimitive => {
    const primitive = resolvePrimitiveForNode(node, primitiveById);
    const suggestedTools = deriveToolSuggestions(primitive, node);
    const executionContext: WorkExecutionContext = {
      ...baseContext,
      suggestedTools,
    };
    return {
      ...node,
      executionContext,
      estimates: estimateWorkResources(context, node, totalNodes, depth),
      dependencySummary: summarizeDependencies(node),
    };
  };

  const walk = (node: WorkHierarchy, depth: number): WorkHierarchy => {
    const nextRoot = enrichNode(node.root, depth);
    const nextChildren = node.children.map((child) => walk(child, depth + 1));
    return { ...node, root: nextRoot, children: nextChildren };
  };

  return walk(hierarchy, 0);
}
