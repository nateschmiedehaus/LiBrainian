import { createTechniqueComposition, type TechniqueComposition, type TechniqueOperator } from '../strategic/techniques.js';
import { requireProviders } from './provider_check.js';
import { resolveLiBrainianModelConfigWithDiscovery, type LiBrainianLlmProvider } from './llm_env.js';
import { resolveLlmServiceAdapter, type LlmServiceAdapter } from '../adapters/llm_service.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { withTimeout } from '../utils/async.js';

export type FundamentalAspect =
  | 'data'
  | 'state'
  | 'time'
  | 'space'
  | 'logic'
  | 'structure'
  | 'value'
  | 'agency'
  | 'media';

export interface DomainDescription {
  id: string;
  name: string;
  description?: string;
  aspects?: Partial<Record<FundamentalAspect, boolean>>;
  tags?: string[];
  signals?: string[];
}

export interface DomainAspectDecomposition {
  aspects: FundamentalAspect[];
  method: 'heuristic' | 'llm';
  evidence: string[];
}

export interface DomainSupportPlan {
  domainId: string;
  aspects: FundamentalAspect[];
  primitives: string[];
  operators: TechniqueOperator[];
  recommendedPatterns: string[];
  composition: TechniqueComposition;
  evidence: string[];
}

export interface DomainCompositionValidation {
  valid: boolean;
  missingAspects: FundamentalAspect[];
  missingPrimitives: string[];
  unknownPrimitives: string[];
}

export interface DomainLlmDecompositionOptions {
  workspaceRoot?: string;
  provider?: LiBrainianLlmProvider;
  modelId?: string;
  llmService?: LlmServiceAdapter;
  timeoutMs?: number;
  maxTokens?: number;
}

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const FALLBACK_ASPECTS: FundamentalAspect[] = ['data', 'state', 'structure'];

export const ASPECT_TO_PRIMITIVES: Record<FundamentalAspect, string[]> = {
  data: ['tp_data_lineage', 'tp_artifact_trace'],
  state: ['tp_state_trace'],
  time: ['tp_timing_bound', 'tp_realtime_flow'],
  space: ['tp_platform_map', 'tp_distribution_map'],
  logic: ['tp_policy_verify', 'tp_algorithm_trace'],
  structure: ['tp_component_graph', 'tp_scale_pattern'],
  value: ['tp_metric_trace'],
  agency: ['tp_tool_orchestration'],
  media: ['tp_media_pipeline'],
};

const ASPECT_KEYWORDS: Record<FundamentalAspect, string[]> = {
  data: ['data', 'pipeline', 'ingest', 'warehouse', 'etl', 'lineage', 'schema'],
  state: ['state', 'transaction', 'workflow', 'lifecycle', 'idempotency'],
  time: ['latency', 'timeout', 'realtime', 'stream', 'event', 'schedule'],
  space: ['edge', 'region', 'zone', 'cdn', 'distribution', 'platform'],
  logic: ['policy', 'compliance', 'rule', 'algorithm', 'ranking'],
  structure: ['component', 'architecture', 'module', 'dependency', 'graph'],
  value: ['metric', 'conversion', 'revenue', 'engagement', 'kpi'],
  agency: ['tool', 'automation', 'agent', 'workflow', 'orchestration'],
  media: ['video', 'image', 'audio', 'asset', 'transcode', 'render'],
};

const PATTERN_HINTS: Array<{ keywords: string[]; patterns: string[] }> = [
  { keywords: ['performance', 'latency', 'throughput', 'scale'], patterns: ['pattern_performance_investigation'] },
  { keywords: ['bug', 'incident', 'failure', 'regression'], patterns: ['pattern_bug_investigation'] },
  { keywords: ['security', 'compliance', 'policy', 'risk'], patterns: ['pattern_change_verification'] },
  { keywords: ['feature', 'build', 'launch'], patterns: ['pattern_feature_construction'] },
];

function normalizeDomainId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'domain_unknown';
  if (SAFE_ID_PATTERN.test(trimmed)) return trimmed;
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeAspectList(values: FundamentalAspect[]): FundamentalAspect[] {
  const seen = new Set<FundamentalAspect>();
  const out: FundamentalAspect[] = [];
  for (const aspect of values) {
    if (seen.has(aspect)) continue;
    seen.add(aspect);
    out.push(aspect);
  }
  return out;
}

function normalizeAspectInput(value: unknown): FundamentalAspect | null {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!candidate) return null;
  const aspects = new Set<FundamentalAspect>([
    'data',
    'state',
    'time',
    'space',
    'logic',
    'structure',
    'value',
    'agency',
    'media',
  ]);
  if (aspects.has(candidate as FundamentalAspect)) {
    return candidate as FundamentalAspect;
  }
  return null;
}

function buildAspectEvidence(aspect: FundamentalAspect, matches: string[]): string {
  const cues = matches.slice(0, 4).join(', ');
  return cues ? `${aspect}: ${cues}` : `${aspect}: inferred`;
}

function extractKeywordMatches(text: string, keywords: string[]): string[] {
  const matches: string[] = [];
  for (const keyword of keywords) {
    if (text.includes(keyword)) matches.push(keyword);
  }
  return matches;
}

export function decomposeToAspects(domain: DomainDescription): DomainAspectDecomposition {
  if (domain.aspects) {
    const aspects = Object.entries(domain.aspects)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([aspect]) => normalizeAspectInput(aspect))
      .filter((aspect): aspect is FundamentalAspect => Boolean(aspect));
    return {
      aspects: aspects.length ? normalizeAspectList(aspects) : [...FALLBACK_ASPECTS],
      method: 'heuristic',
      evidence: aspects.length ? ['explicit_aspects'] : ['fallback_aspects'],
    };
  }

  const text = [
    domain.name,
    domain.description ?? '',
    ...(domain.tags ?? []),
    ...(domain.signals ?? []),
  ]
    .join(' ')
    .toLowerCase();

  const detected: FundamentalAspect[] = [];
  const evidence: string[] = [];
  for (const [aspect, keywords] of Object.entries(ASPECT_KEYWORDS) as Array<[FundamentalAspect, string[]]>) {
    const matches = extractKeywordMatches(text, keywords);
    if (matches.length > 0) {
      detected.push(aspect);
      evidence.push(buildAspectEvidence(aspect, matches));
    }
  }
  const aspects = detected.length ? normalizeAspectList(detected) : [...FALLBACK_ASPECTS];
  if (detected.length === 0) {
    evidence.push('fallback_aspects');
  }
  return { aspects, method: 'heuristic', evidence };
}

export async function decomposeDomainWithLlm(
  domain: DomainDescription,
  options: DomainLlmDecompositionOptions = {}
): Promise<DomainAspectDecomposition> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  await requireProviders({ llm: true, embedding: false }, { workspaceRoot });
  const llmConfig = await resolveLiBrainianModelConfigWithDiscovery();
  const llmService = resolveLlmServiceAdapter(options.llmService ?? null);
  const prompt = [
    'You are classifying software domains into fundamental aspects.',
    'Return JSON with fields: aspects (array) and rationale (array of short strings).',
    'Valid aspects: data, state, time, space, logic, structure, value, agency, media.',
    `Domain: ${domain.name}`,
    domain.description ? `Description: ${domain.description}` : '',
    domain.tags?.length ? `Tags: ${domain.tags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await withTimeout(
    llmService.chat({
      provider: options.provider ?? llmConfig.provider,
      modelId: options.modelId ?? llmConfig.modelId,
      messages: [
        { role: 'system', content: 'Respond ONLY with JSON.' },
        { role: 'user', content: prompt },
      ],
      maxTokens: options.maxTokens ?? 600,
      temperature: 0,
      disableTools: true,
    }),
    options.timeoutMs ?? 45_000,
    { context: 'unverified_by_trace(domain_decomposition_timeout)' }
  );

  const parsed = safeJsonParse<{ aspects?: unknown; rationale?: unknown }>(response.content);
  if (!parsed.ok) {
    throw new Error('unverified_by_trace(domain_decomposition_failed): invalid JSON');
  }
  const aspects = Array.isArray(parsed.value.aspects)
    ? parsed.value.aspects
        .map((entry) => normalizeAspectInput(entry))
        .filter((entry): entry is FundamentalAspect => Boolean(entry))
    : [];
  const evidence = Array.isArray(parsed.value.rationale)
    ? parsed.value.rationale.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    aspects: aspects.length ? normalizeAspectList(aspects) : [...FALLBACK_ASPECTS],
    method: 'llm',
    evidence: evidence.length ? evidence : ['fallback_aspects'],
  };
}

export function resolveDomainPrimitives(aspects: FundamentalAspect[]): string[] {
  const primitives: string[] = [];
  for (const aspect of aspects) {
    for (const primitive of ASPECT_TO_PRIMITIVES[aspect] ?? []) {
      if (!primitives.includes(primitive)) primitives.push(primitive);
    }
  }
  return primitives;
}

function selectPatternsForDomain(
  domain: DomainDescription,
  primitives: string[]
): string[] {
  const text = [domain.name, domain.description ?? '', ...(domain.tags ?? [])]
    .join(' ')
    .toLowerCase();
  const patterns = new Set<string>();
  for (const hint of PATTERN_HINTS) {
    if (hint.keywords.some((keyword) => text.includes(keyword))) {
      hint.patterns.forEach((pattern) => patterns.add(pattern));
    }
  }
  if (primitives.includes('tp_policy_verify')) {
    patterns.add('pattern_change_verification');
  }
  if (primitives.includes('tp_timing_bound')) {
    patterns.add('pattern_performance_investigation');
  }
  return Array.from(patterns.values());
}

function inferOperatorsForDomain(
  domainId: string,
  primitives: string[]
): TechniqueOperator[] {
  const operators: TechniqueOperator[] = [];
  const addOperator = (
    type: TechniqueOperator['type'],
    inputs: string[],
    label: string,
    parameters?: Record<string, unknown>
  ): void => {
    operators.push({
      id: `op_${domainId}_${operators.length + 1}`,
      type,
      label,
      inputs,
      parameters,
    });
  };

  if (primitives.includes('tp_algorithm_trace') && primitives.includes('tp_policy_verify')) {
    addOperator('parallel', ['tp_algorithm_trace', 'tp_policy_verify'], 'Parallel logic + policy analysis');
  }
  if (primitives.includes('tp_metric_trace') && primitives.includes('tp_realtime_flow')) {
    addOperator('sequence', ['tp_metric_trace', 'tp_realtime_flow'], 'Metrics before realtime flows');
  }
  if (primitives.includes('tp_scale_pattern') && primitives.includes('tp_distribution_map')) {
    addOperator('parallel', ['tp_scale_pattern', 'tp_distribution_map'], 'Scale + distribution mapping');
  }
  if (primitives.includes('tp_media_pipeline') && primitives.includes('tp_distribution_map')) {
    addOperator('sequence', ['tp_media_pipeline', 'tp_distribution_map'], 'Media flow into distribution');
  }
  if (primitives.includes('tp_tool_orchestration') && primitives.includes('tp_data_lineage')) {
    addOperator('sequence', ['tp_tool_orchestration', 'tp_data_lineage'], 'Orchestration before lineage');
  }
  if (primitives.includes('tp_component_graph') && primitives.includes('tp_artifact_trace')) {
    addOperator('parallel', ['tp_component_graph', 'tp_artifact_trace'], 'Components + artifact tracing');
  }
  if (primitives.includes('tp_metric_trace') && primitives.includes('tp_timing_bound')) {
    addOperator('sequence', ['tp_metric_trace', 'tp_timing_bound'], 'Metrics before timing bounds');
  }

  return operators;
}

export function constructDomainSupport(domain: DomainDescription): DomainSupportPlan {
  const decomposition = decomposeToAspects(domain);
  const domainId = normalizeDomainId(domain.id);
  const primitives = resolveDomainPrimitives(decomposition.aspects);
  const operators = inferOperatorsForDomain(domainId, primitives);
  const recommendedPatterns = selectPatternsForDomain(domain, primitives);
  const name = `${domain.name} Analysis`;
  const description = `Understand and modify ${domain.name} codebases.`;

  const composition = createTechniqueComposition({
    id: `tc_${domainId}`,
    name,
    description,
    primitiveIds: primitives,
    operators,
  });

  return {
    domainId,
    aspects: decomposition.aspects,
    primitives,
    operators,
    recommendedPatterns,
    composition,
    evidence: decomposition.evidence,
  };
}

export function validateDomainComposition(
  domain: DomainDescription,
  composition: TechniqueComposition,
  availablePrimitives: string[]
): DomainCompositionValidation {
  const decomposition = decomposeToAspects(domain);
  const expectedPrimitives = resolveDomainPrimitives(decomposition.aspects);
  const missingPrimitives = expectedPrimitives.filter((id) => !composition.primitiveIds.includes(id));
  const unknownPrimitives = composition.primitiveIds.filter((id) => !availablePrimitives.includes(id));
  const missingAspects = decomposition.aspects.filter((aspect) => {
    const required = ASPECT_TO_PRIMITIVES[aspect] ?? [];
    return !required.some((id) => composition.primitiveIds.includes(id));
  });
  return {
    valid: missingPrimitives.length === 0 && unknownPrimitives.length === 0 && missingAspects.length === 0,
    missingAspects,
    missingPrimitives,
    unknownPrimitives,
  };
}
