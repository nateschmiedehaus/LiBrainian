import type {
  CompositionSuggestion,
  ContextPack,
  LiBrainianQuery,
  LiBrainianResponse,
  LlmOptional,
  OperatorRecommendation,
} from '../types.js';
import { logWarning } from '../telemetry/logger.js';

export type { CompositionSuggestion, OperatorRecommendation };

export interface CodebaseFeature {
  id: string;
  name: string;
  description: string;
  confidence: number;
  evidence: string[];
  suggestedPatterns: string[];
}

export interface CodebaseAdvisorOptions {
  minConfidence?: number;
  maxSuggestions?: number;
  queryDepth?: LiBrainianQuery['depth'];
  queryTimeoutMs?: number;
}

/**
 * Narrow interface for dependency injection/testing. Only requires queryOptional.
 */
export interface CodebaseAdvisorClient {
  queryOptional(query: LiBrainianQuery): Promise<LlmOptional<LiBrainianResponse>>;
}

type DomainQuery = {
  domain: string;
  intent: string;
  patterns: string[];
};

const DEFAULT_QUERIES: DomainQuery[] = [
  { domain: 'auth', intent: 'authentication and authorization code', patterns: ['pattern_security_audit', 'pattern_change_verification'] },
  { domain: 'api', intent: 'API endpoints and routes', patterns: ['pattern_api_design', 'pattern_change_verification', 'pattern_release_verification'] },
  { domain: 'database', intent: 'database models and queries', patterns: ['pattern_refactoring', 'pattern_performance_investigation', 'pattern_dependency_update'] },
  { domain: 'ui', intent: 'user interface components', patterns: ['pattern_change_verification', 'pattern_test_generation'] },
  { domain: 'testing', intent: 'test files and test utilities', patterns: ['pattern_test_generation', 'pattern_bug_investigation', 'pattern_change_verification'] },
  { domain: 'config', intent: 'configuration and environment handling', patterns: ['pattern_dependency_update', 'pattern_security_audit', 'pattern_change_verification'] },
  { domain: 'observability', intent: 'error handling and logging', patterns: ['pattern_incident_response', 'pattern_performance_investigation', 'pattern_bug_investigation'] },
  { domain: 'integrations', intent: 'external service integrations', patterns: ['pattern_dependency_update', 'pattern_change_verification', 'pattern_release_verification'] },
  { domain: 'performance', intent: 'caching and performance optimization', patterns: ['pattern_performance_investigation', 'pattern_technical_debt'] },
  { domain: 'async', intent: 'background jobs and async processing', patterns: ['pattern_bug_investigation', 'pattern_performance_investigation', 'pattern_incident_response'] },
];

const DEFAULT_MIN_CONFIDENCE = 0.4;
const DEFAULT_QUERY_DEPTH: LiBrainianQuery['depth'] = 'L1';
const DEFAULT_QUERY_TIMEOUT_MS = 15_000;
const MAX_EVIDENCE_ITEMS = 3;
const MAX_DESCRIPTION_LENGTH = 500;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/g;

export class CodebaseCompositionAdvisor {
  private librainian: CodebaseAdvisorClient;
  private options: Required<CodebaseAdvisorOptions>;

  constructor(librainian: CodebaseAdvisorClient, options: CodebaseAdvisorOptions = {}) {
    this.librainian = librainian;
    this.options = {
      minConfidence: coerceMinConfidence(options.minConfidence),
      maxSuggestions: coerceMaxSuggestions(options.maxSuggestions),
      queryDepth: options.queryDepth ?? DEFAULT_QUERY_DEPTH,
      queryTimeoutMs: coerceTimeoutMs(options.queryTimeoutMs),
    };
  }

  async suggestCompositions(): Promise<CompositionSuggestion[]> {
    const features = await this.discoverFeatures();
    const suggestions = features.flatMap((feature) => this.suggestForFeature(feature));
    const prioritized = this.prioritizeSuggestions(suggestions);
    if (this.options.maxSuggestions === 0) return [];
    return prioritized.slice(0, this.options.maxSuggestions);
  }

  private async discoverFeatures(): Promise<CodebaseFeature[]> {
    const features: CodebaseFeature[] = [];
    const responses = await Promise.all(
      DEFAULT_QUERIES.map((query) => this.safeQuery(query.intent))
    );
    for (const [index, query] of DEFAULT_QUERIES.entries()) {
      const response = responses[index];
      if (!response || response.packs.length === 0) continue;
      const avgConfidence = averageConfidence(response.packs);
      if (avgConfidence < this.options.minConfidence) continue;
      features.push({
        id: `feature_${query.domain}`,
        name: query.domain,
        description: sanitizeDescription(response.synthesis?.answer || query.intent),
        confidence: avgConfidence,
        evidence: collectEvidence(response.packs),
        suggestedPatterns: query.patterns,
      });
    }
    return features;
  }

  private async safeQuery(intent: string): Promise<LlmOptional<LiBrainianResponse> | null> {
    try {
      const response = await withTimeout(
        this.librainian.queryOptional({
          intent,
          depth: this.options.queryDepth,
          minConfidence: this.options.minConfidence,
          llmRequirement: 'optional',
        }),
        this.options.queryTimeoutMs
      );
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning('Codebase advisor query failed', { intent, error: sanitizeLogMessage(message) });
      return null;
    }
  }

  private suggestForFeature(feature: CodebaseFeature): CompositionSuggestion[] {
    const suggestions: CompositionSuggestion[] = [];
    const evidenceCount = feature.evidence.length;
    if (feature.id === 'feature_auth') {
      suggestions.push(buildSuggestion({
        id: 'tc_auth_security_review',
        name: 'Auth Security Review',
        reason: `Auth code detected (${evidenceCount} signals). Validate threats and secrets.`,
        primitives: ['tp_threat_model', 'tp_security_abuse_cases', 'tp_secret_scan', 'tp_change_impact', 'tp_verify_plan'],
        operators: [
          { type: 'parallel', purpose: 'Run security checks concurrently', placement: 'middle' },
          { type: 'gate', purpose: 'Block on security issues', placement: 'late' },
        ],
        priority: 'high',
        estimatedValue: 'Prevents authentication vulnerabilities',
        featureId: feature.id,
      }));
    }
    if (feature.id === 'feature_api') {
      suggestions.push(buildSuggestion({
        id: 'tc_api_change_review',
        name: 'API Change Review',
        reason: 'API endpoints detected. Check for breaking changes.',
        primitives: ['tp_change_impact', 'tp_dependency_map', 'tp_test_gap_analysis', 'tp_verify_plan'],
        operators: [{ type: 'gate', purpose: 'Block on breaking changes', placement: 'late' }],
        priority: 'high',
        estimatedValue: 'Protects API compatibility',
        featureId: feature.id,
      }));
    }
    if (feature.id === 'feature_database') {
      suggestions.push(buildSuggestion({
        id: 'tc_migration_review',
        name: 'Database Migration Review',
        reason: 'Database models detected. Validate migration safety.',
        primitives: ['tp_change_impact', 'tp_risk_scan', 'tp_verify_plan'],
        operators: [{ type: 'gate', purpose: 'Block on unsafe migrations', placement: 'late' }],
        priority: 'medium',
        estimatedValue: 'Reduces data loss risk',
        featureId: feature.id,
      }));
    }
    if (feature.id === 'feature_ui') {
      suggestions.push(buildSuggestion({
        id: 'tc_ui_accessibility_review',
        name: 'UI Accessibility Review',
        reason: 'UI components detected. Validate accessibility.',
        primitives: ['tp_accessibility_review', 'tp_change_impact', 'tp_test_gap_analysis', 'tp_verify_plan'],
        operators: [],
        priority: 'medium',
        estimatedValue: 'Improves UI accessibility',
        featureId: feature.id,
      }));
    }
    if (feature.id === 'feature_testing') {
      suggestions.push(buildSuggestion({
        id: 'tc_test_gap_review',
        name: 'Test Gap Review',
        reason: 'Test utilities detected. Close coverage gaps.',
        primitives: ['tp_test_gap_analysis', 'tp_change_impact', 'tp_verify_plan'],
        operators: [],
        priority: 'medium',
        estimatedValue: 'Targets missing test coverage',
        featureId: feature.id,
      }));
    }
    if (feature.id === 'feature_config') {
      suggestions.push(buildSuggestion({
        id: 'tc_config_change_review',
        name: 'Configuration Change Review',
        reason: 'Configuration handling detected. Validate changes and risks.',
        primitives: ['tp_change_impact', 'tp_risk_scan', 'tp_verify_plan'],
        operators: [{ type: 'gate', purpose: 'Block on unsafe config changes', placement: 'late' }],
        priority: 'medium',
        estimatedValue: 'Reduces config regression risk',
        featureId: feature.id,
      }));
    }
    if (feature.id === 'feature_observability') {
      suggestions.push(buildSuggestion({
        id: 'tc_observability_review',
        name: 'Observability Review',
        reason: 'Logging and error handling detected. Harden observability.',
        primitives: ['tp_instrument', 'tp_change_impact', 'tp_verify_plan'],
        operators: [],
        priority: 'medium',
        estimatedValue: 'Improves monitoring readiness',
        featureId: feature.id,
      }));
    }
    if (feature.id === 'feature_integrations') {
      suggestions.push(buildSuggestion({
        id: 'tc_integration_change_review',
        name: 'Integration Change Review',
        reason: 'External integrations detected. Verify compatibility.',
        primitives: ['tp_change_impact', 'tp_dependency_map', 'tp_verify_plan'],
        operators: [{ type: 'gate', purpose: 'Block on incompatible changes', placement: 'late' }],
        priority: 'high',
        estimatedValue: 'Avoids integration breakage',
        featureId: feature.id,
      }));
    }
    if (feature.id === 'feature_performance' || feature.id === 'feature_async') {
      suggestions.push(buildSuggestion({
        id: 'tc_performance_regression',
        name: 'Performance Regression Check',
        reason: 'Performance-sensitive code detected. Profile regressions.',
        primitives: ['tp_instrument', 'tp_change_impact', 'tp_verify_plan'],
        operators: [{ type: 'loop', purpose: 'Profile before/after', placement: 'wrapper' }],
        priority: 'medium',
        estimatedValue: 'Catches performance regressions early',
        featureId: feature.id,
      }));
    }
    return suggestions;
  }

  private prioritizeSuggestions(suggestions: CompositionSuggestion[]): CompositionSuggestion[] {
    const byId = new Map<string, CompositionSuggestion>();
    for (const suggestion of suggestions) {
      const existing = byId.get(suggestion.suggestedCompositionId);
      if (!existing || comparePriority(suggestion.priority, existing.priority) > 0) {
        byId.set(suggestion.suggestedCompositionId, suggestion);
      }
    }
    return Array.from(byId.values()).sort((a, b) => comparePriority(b.priority, a.priority));
  }
}

function comparePriority(a: CompositionSuggestion['priority'], b: CompositionSuggestion['priority']): number {
  const order = { high: 3, medium: 2, low: 1 };
  return (order[a] ?? 0) - (order[b] ?? 0);
}

function buildSuggestion(input: {
  id: string;
  name: string;
  reason: string;
  primitives: string[];
  operators: OperatorRecommendation[];
  priority: CompositionSuggestion['priority'];
  estimatedValue: string;
  featureId: string;
}): CompositionSuggestion {
  return {
    suggestedCompositionId: input.id,
    suggestedName: input.name,
    reason: input.reason,
    basedOnFeatures: [input.featureId],
    suggestedPrimitives: input.primitives,
    suggestedOperators: input.operators,
    priority: input.priority,
    estimatedValue: input.estimatedValue,
  };
}

function averageConfidence(packs: ContextPack[]): number {
  if (packs.length === 0) return 0;
  const total = packs.reduce((sum, pack) => sum + pack.confidence, 0);
  return total / packs.length;
}

function collectEvidence(packs: ContextPack[]): string[] {
  const evidence = new Set<string>();
  for (const pack of packs) {
    for (const file of pack.relatedFiles ?? []) {
      if (file) evidence.add(file);
      if (evidence.size >= MAX_EVIDENCE_ITEMS) break;
    }
    if (evidence.size >= MAX_EVIDENCE_ITEMS) break;
    if (pack.targetId) {
      evidence.add(pack.targetId);
    }
    if (evidence.size >= MAX_EVIDENCE_ITEMS) break;
  }
  return Array.from(evidence);
}

function sanitizeDescription(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const clamped = trimmed.length > MAX_DESCRIPTION_LENGTH
    ? trimmed.slice(0, MAX_DESCRIPTION_LENGTH)
    : trimmed;
  return clamped.replace(CONTROL_CHAR_PATTERN, ' ');
}

function sanitizeLogMessage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'unknown_error';
  const normalized = trimmed.replace(CONTROL_CHAR_PATTERN, ' ');
  return normalized.length > 200 ? normalized.slice(0, 200) : normalized;
}

function coerceMinConfidence(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MIN_CONFIDENCE;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('minConfidence must be a finite number between 0 and 1');
  }
  return value;
}

function coerceMaxSuggestions(value: number | undefined): number {
  if (value === undefined) return 5;
  if (!Number.isFinite(value)) {
    throw new Error('maxSuggestions must be a finite number');
  }
  if (value < 0) {
    throw new Error('maxSuggestions must be >= 0');
  }
  return Math.floor(value);
}

function coerceTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_QUERY_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('queryTimeoutMs must be a non-negative finite number');
  }
  return Math.floor(value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`query_timeout:${timeoutMs}`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export const __testing = {
  sanitizeDescription,
  withTimeout,
};
