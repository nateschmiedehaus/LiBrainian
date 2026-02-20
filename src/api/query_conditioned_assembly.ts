import type { ContextPack, ContextPackType } from '../types.js';

export type QueryAssemblyIntent =
  | 'bug_fix'
  | 'architecture'
  | 'feature_addition'
  | 'security_audit'
  | 'refactoring';

export type RetrievalSource =
  | 'call_graph_local'
  | 'call_graph_transitive'
  | 'semantic_similarity'
  | 'pyramid_module'
  | 'pyramid_layer'
  | 'data_flow'
  | 'test_coverage'
  | 'recent_changes'
  | 'contract_storage'
  | 'evidence_ledger';

export interface ContextTemplateStep {
  name: string;
  source: RetrievalSource;
  tokenBudget: number;
  required: boolean;
  packTypes: ContextPackType[];
}

export interface ContextTemplate {
  intent: QueryAssemblyIntent;
  description: string;
  totalTokenBudget: number;
  retrievalPlan: ContextTemplateStep[];
}

export interface IntentClassificationResult {
  primaryIntent: QueryAssemblyIntent;
  confidence: number;
  alternativeIntent?: QueryAssemblyIntent;
}

export interface SkippedStep {
  step: string;
  reason: 'budget_exhausted' | 'no_matches' | 'step_budget_exhausted' | 'relevance_filtered';
}

export interface IntentConditionedPackSelection {
  packs: ContextPack[];
  intent: QueryAssemblyIntent;
  confidence: number;
  tokensUsed: number;
  tokenBudget: number;
  template: ContextTemplate;
  skippedSteps: SkippedStep[];
}

const DEFAULT_TEMPLATE_TOKEN_BUDGET = 4000;
const DEFAULT_RELEVANCE_FLOOR = 0.3;

const TEMPLATE_REGISTRY = new Map<QueryAssemblyIntent, ContextTemplate>([
  ['bug_fix', {
    intent: 'bug_fix',
    description: 'Root-cause context with target implementation, callers, type contracts, and recent changes.',
    totalTokenBudget: DEFAULT_TEMPLATE_TOKEN_BUDGET,
    retrievalPlan: [
      {
        name: 'target_function',
        source: 'call_graph_local',
        tokenBudget: 1200,
        required: true,
        packTypes: ['function_context', 'symbol_definition'],
      },
      {
        name: 'direct_callers',
        source: 'call_graph_local',
        tokenBudget: 1000,
        required: true,
        packTypes: ['call_flow', 'module_context'],
      },
      {
        name: 'type_context',
        source: 'semantic_similarity',
        tokenBudget: 700,
        required: true,
        packTypes: ['symbol_definition', 'module_context'],
      },
      {
        name: 'recent_changes',
        source: 'recent_changes',
        tokenBudget: 700,
        required: false,
        packTypes: ['change_impact', 'git_history'],
      },
      {
        name: 'evidence_and_tests',
        source: 'test_coverage',
        tokenBudget: 400,
        required: false,
        packTypes: ['similar_tasks', 'pattern_context'],
      },
    ],
  }],
  ['architecture', {
    intent: 'architecture',
    description: 'System-level structure using layered/module summaries and cross-module flow.',
    totalTokenBudget: DEFAULT_TEMPLATE_TOKEN_BUDGET,
    retrievalPlan: [
      {
        name: 'layer_overview',
        source: 'pyramid_layer',
        tokenBudget: 900,
        required: true,
        packTypes: ['project_understanding', 'doc_context'],
      },
      {
        name: 'module_summaries',
        source: 'pyramid_module',
        tokenBudget: 1500,
        required: true,
        packTypes: ['module_context', 'doc_context'],
      },
      {
        name: 'data_flow',
        source: 'data_flow',
        tokenBudget: 900,
        required: true,
        packTypes: ['call_flow', 'module_context'],
      },
      {
        name: 'key_contracts',
        source: 'contract_storage',
        tokenBudget: 700,
        required: false,
        packTypes: ['symbol_definition', 'decision_context', 'doc_context'],
      },
    ],
  }],
  ['feature_addition', {
    intent: 'feature_addition',
    description: 'Pattern-first context with integration points and nearby implementation examples.',
    totalTokenBudget: DEFAULT_TEMPLATE_TOKEN_BUDGET,
    retrievalPlan: [
      {
        name: 'existing_patterns',
        source: 'semantic_similarity',
        tokenBudget: 1200,
        required: true,
        packTypes: ['pattern_context', 'decision_context'],
      },
      {
        name: 'integration_points',
        source: 'call_graph_local',
        tokenBudget: 1500,
        required: true,
        packTypes: ['module_context', 'function_context', 'call_flow'],
      },
      {
        name: 'similar_tasks',
        source: 'evidence_ledger',
        tokenBudget: 700,
        required: false,
        packTypes: ['similar_tasks'],
      },
      {
        name: 'recent_changes',
        source: 'recent_changes',
        tokenBudget: 600,
        required: false,
        packTypes: ['change_impact', 'git_history'],
      },
    ],
  }],
  ['security_audit', {
    intent: 'security_audit',
    description: 'Trust-boundary and sensitive-flow context with auth checks and sink paths.',
    totalTokenBudget: DEFAULT_TEMPLATE_TOKEN_BUDGET,
    retrievalPlan: [
      {
        name: 'data_flows',
        source: 'data_flow',
        tokenBudget: 1500,
        required: true,
        packTypes: ['call_flow', 'change_impact'],
      },
      {
        name: 'auth_checks',
        source: 'semantic_similarity',
        tokenBudget: 900,
        required: true,
        packTypes: ['function_context', 'symbol_definition'],
      },
      {
        name: 'trust_boundaries',
        source: 'pyramid_module',
        tokenBudget: 900,
        required: true,
        packTypes: ['doc_context', 'project_understanding', 'module_context'],
      },
      {
        name: 'recent_changes',
        source: 'recent_changes',
        tokenBudget: 700,
        required: false,
        packTypes: ['git_history', 'change_impact'],
      },
    ],
  }],
  ['refactoring', {
    intent: 'refactoring',
    description: 'Dependency blast-radius context with contracts, usage, and changes.',
    totalTokenBudget: DEFAULT_TEMPLATE_TOKEN_BUDGET,
    retrievalPlan: [
      {
        name: 'blast_radius',
        source: 'call_graph_transitive',
        tokenBudget: 1500,
        required: true,
        packTypes: ['call_flow', 'module_context', 'function_context'],
      },
      {
        name: 'contracts',
        source: 'contract_storage',
        tokenBudget: 1000,
        required: true,
        packTypes: ['symbol_definition', 'decision_context'],
      },
      {
        name: 'tests_and_patterns',
        source: 'test_coverage',
        tokenBudget: 700,
        required: true,
        packTypes: ['similar_tasks', 'pattern_context'],
      },
      {
        name: 'recent_changes',
        source: 'recent_changes',
        tokenBudget: 800,
        required: false,
        packTypes: ['change_impact', 'git_history'],
      },
    ],
  }],
]);

const BUG_FIX_PATTERNS = [
  /\bfix\b/i,
  /\bbug\b/i,
  /\berror\b/i,
  /\bexception\b/i,
  /\bregression\b/i,
  /\bfailing\b/i,
  /\bnullpointer\b/i,
  /\bnpe\b/i,
];

const ARCHITECTURE_PATTERNS = [
  /\barchitecture\b/i,
  /\boverview\b/i,
  /\bhigh[- ]?level\b/i,
  /\bhow\s+does\b/i,
  /\bflow\b/i,
  /\bsystem\b/i,
  /\bdesign\b/i,
  /\bmodule\b/i,
];

const FEATURE_ADDITION_PATTERNS = [
  /\badd\b/i,
  /\bimplement\b/i,
  /\bnew feature\b/i,
  /\bintroduce\b/i,
  /\bsupport\b/i,
  /\benhance\b/i,
  /\bextend\b/i,
];

const SECURITY_AUDIT_PATTERNS = [
  /\bsecurity\b/i,
  /\baudit\b/i,
  /\bvulnerab/i,
  /\battack\b/i,
  /\bpermission\b/i,
  /\bauthorization\b/i,
  /\bauthentication\b/i,
  /\btrust boundary\b/i,
];

const REFACTORING_PATTERNS = [
  /\brefactor\b/i,
  /\brename\b/i,
  /\bextract\b/i,
  /\bmove\b/i,
  /\brestructure\b/i,
  /\bcleanup\b/i,
  /\btechnical debt\b/i,
];

const PATTERN_BY_INTENT: Record<QueryAssemblyIntent, RegExp[]> = {
  bug_fix: BUG_FIX_PATTERNS,
  architecture: ARCHITECTURE_PATTERNS,
  feature_addition: FEATURE_ADDITION_PATTERNS,
  security_audit: SECURITY_AUDIT_PATTERNS,
  refactoring: REFACTORING_PATTERNS,
};

function scoreIntent(queryIntent: string, patterns: RegExp[]): number {
  let score = 0;
  for (const pattern of patterns) {
    if (pattern.test(queryIntent)) score += 1;
  }
  return score;
}

function estimatePackTokenCost(pack: ContextPack): number {
  const snippetChars = pack.codeSnippets.reduce((sum, snippet) => {
    return sum + snippet.content.length + snippet.filePath.length + 20;
  }, 0);
  const factsChars = pack.keyFacts.reduce((sum, fact) => sum + fact.length, 0);
  const fileChars = pack.relatedFiles.reduce((sum, file) => sum + file.length, 0);
  const baseChars = pack.summary.length + pack.targetId.length + pack.packType.length + pack.packId.length;
  const totalChars = baseChars + snippetChars + factsChars + fileChars + 240;
  return Math.max(1, Math.ceil(totalChars / 4));
}

export function classifyAssemblyIntent(queryIntent: string): IntentClassificationResult {
  const normalized = queryIntent.toLowerCase().trim();
  const scores = (Object.keys(PATTERN_BY_INTENT) as QueryAssemblyIntent[])
    .map((intent) => ({ intent, score: scoreIntent(normalized, PATTERN_BY_INTENT[intent]) }))
    .sort((a, b) => b.score - a.score);
  const top = scores[0] ?? { intent: 'architecture' as const, score: 0 };
  const second = scores[1];

  if (top.score === 0) {
    return {
      primaryIntent: 'architecture',
      confidence: 0.35,
    };
  }

  const confidenceBase = Math.min(0.95, 0.5 + (top.score * 0.12));
  const confidence = second && second.score === top.score ? confidenceBase * 0.82 : confidenceBase;

  return {
    primaryIntent: top.intent,
    confidence,
    alternativeIntent: second && second.score > 0 ? second.intent : undefined,
  };
}

export function registerContextTemplate(template: ContextTemplate): void {
  TEMPLATE_REGISTRY.set(template.intent, {
    intent: template.intent,
    description: template.description,
    totalTokenBudget: template.totalTokenBudget,
    retrievalPlan: template.retrievalPlan.map((step) => ({
      ...step,
      packTypes: [...step.packTypes],
    })),
  });
}

export function getContextTemplate(intent: QueryAssemblyIntent): ContextTemplate {
  const template = TEMPLATE_REGISTRY.get(intent);
  if (!template) {
    throw new Error(`Template not found for intent: ${intent}`);
  }
  return {
    intent: template.intent,
    description: template.description,
    totalTokenBudget: template.totalTokenBudget,
    retrievalPlan: template.retrievalPlan.map((step) => ({
      ...step,
      packTypes: [...step.packTypes],
    })),
  };
}

export function listContextTemplates(): ContextTemplate[] {
  return (Object.keys(PATTERN_BY_INTENT) as QueryAssemblyIntent[]).map((intent) => getContextTemplate(intent));
}

export function assembleIntentConditionedPacks(
  packs: ContextPack[],
  options: {
    queryIntent: string;
    maxTokens?: number;
    templateOverride?: ContextTemplate;
    minConfidenceFloor?: number;
  }
): IntentConditionedPackSelection {
  const classification = classifyAssemblyIntent(options.queryIntent);
  const template = options.templateOverride ?? getContextTemplate(classification.primaryIntent);
  const tokenBudget = Math.max(
    0,
    Math.min(
      options.maxTokens ?? template.totalTokenBudget,
      template.totalTokenBudget
    )
  );

  const selected: ContextPack[] = [];
  const usedPackIds = new Set<string>();
  const skippedSteps: SkippedStep[] = [];
  let remaining = tokenBudget;

  for (const step of template.retrievalPlan) {
    if (remaining <= 0) {
      if (!step.required) {
        skippedSteps.push({ step: step.name, reason: 'budget_exhausted' });
      }
      continue;
    }

    const stepBudget = Math.min(step.tokenBudget, remaining);
    const candidates = packs
      .filter((pack) => step.packTypes.includes(pack.packType) && !usedPackIds.has(pack.packId))
      .sort((a, b) => b.confidence - a.confidence);

    if (!candidates.length) {
      skippedSteps.push({ step: step.name, reason: 'no_matches' });
      continue;
    }

    let stepConsumed = 0;
    let stepAdded = false;
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const packCost = estimatePackTokenCost(candidate);
      const fitsStepBudget = stepConsumed + packCost <= stepBudget;
      const fitsRemaining = packCost <= remaining;
      const allowRequiredOversize = step.required && !stepAdded && stepConsumed === 0 && fitsRemaining;

      if (!fitsStepBudget && !allowRequiredOversize) {
        continue;
      }

      selected.push(candidate);
      usedPackIds.add(candidate.packId);
      stepAdded = true;
      stepConsumed += packCost;
      remaining -= packCost;

      if (stepConsumed >= stepBudget) break;
    }

    if (!stepAdded) {
      skippedSteps.push({ step: step.name, reason: 'step_budget_exhausted' });
    }
  }

  const relevanceFloor = Math.max(0, Math.min(1, options.minConfidenceFloor ?? DEFAULT_RELEVANCE_FLOOR));
  const relevanceFiltered = selected.filter((pack) => pack.confidence >= relevanceFloor);
  if (relevanceFiltered.length < selected.length) {
    skippedSteps.push({ step: 'relevance_floor', reason: 'relevance_filtered' });
  }

  const attentionOrdered = optimizeLostInMiddleOrdering(relevanceFiltered);
  const tokensUsed = attentionOrdered.reduce((sum, pack) => sum + estimatePackTokenCost(pack), 0);
  return {
    packs: attentionOrdered,
    intent: classification.primaryIntent,
    confidence: classification.confidence,
    tokensUsed,
    tokenBudget,
    template,
    skippedSteps,
  };
}

function optimizeLostInMiddleOrdering(packs: ContextPack[]): ContextPack[] {
  if (packs.length <= 2) return packs;
  const sorted = [...packs].sort((left, right) => right.confidence - left.confidence);
  const first = sorted[0];
  const second = sorted[1];
  const middle = sorted.slice(2);
  return [first, ...middle, second];
}

export const __testing = {
  estimatePackTokenCost,
};
