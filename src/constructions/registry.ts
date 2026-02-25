import {
  ConstructionCapabilityError,
  ConstructionError,
} from './base/construction_base.js';
import { listConstructableDefinitions } from './constructable_registry.js';
import type { Context } from './types.js';
import type { PatrolInput } from './processes/patrol_process.js';
import type { PresetProcessInput } from './processes/presets.js';
import type { StalenessInput } from './processes/stale_documentation_sensor.js';
import type { TestSlopInput } from './processes/test_slop_detector.js';
import type { DiffSummarizerInput } from './processes/diff_semantic_summarizer.js';
import type { IntentBehaviorCoherenceInput } from './processes/intent_behavior_coherence_checker.js';
import type { SemanticDuplicateDetectorInput } from './processes/semantic_duplicate_detector.js';
import type { APIDetectorInput } from './processes/hallucinated_api_detector.js';
import {
  LEGACY_CONSTRUCTION_ALIASES,
  type CapabilityId,
  type Construction,
  type ConstructionId,
  type ConstructionListFilter,
  type ConstructionManifest,
  type ConstructionSchema,
  fail,
  isConstructionOutcome,
  isConstructionId,
  ok,
  toCanonicalConstructionId,
} from './types.js';

const UNKNOWN_SCHEMA: ConstructionSchema = {
  type: 'object',
  additionalProperties: true,
};

function createUnavailableConstruction(
  id: ConstructionId,
  name: string,
): Construction<unknown, unknown, ConstructionError, unknown> {
  return {
    id,
    name,
    description: `${name} is registered for discovery but not executable in this runtime.`,
    async execute() {
      return fail<unknown, ConstructionError>(
        new ConstructionError(
          `Construction ${id} is not executable in this runtime`,
          id,
        ),
        undefined,
        id,
      );
    },
  };
}

function buildSchemaTypes(schema: ConstructionSchema | undefined): Set<string> {
  const types = new Set<string>();
  if (!schema) return types;
  if (schema.type && schema.type.trim().length > 0) {
    types.add(schema.type.trim());
  }
  for (const candidate of schema.oneOf ?? []) {
    for (const value of buildSchemaTypes(candidate)) {
      types.add(value);
    }
  }
  for (const candidate of schema.anyOf ?? []) {
    for (const value of buildSchemaTypes(candidate)) {
      types.add(value);
    }
  }
  for (const candidate of schema.allOf ?? []) {
    for (const value of buildSchemaTypes(candidate)) {
      types.add(value);
    }
  }
  if (schema.items && !Array.isArray(schema.items)) {
    for (const value of buildSchemaTypes(schema.items)) {
      types.add(value);
    }
  }
  return types;
}

function scoreObjectCompatibility(
  outputSchema: ConstructionSchema,
  inputSchema: ConstructionSchema,
): number {
  if (outputSchema.type !== 'object' || inputSchema.type !== 'object') {
    return 0;
  }
  const required = inputSchema.required ?? [];
  if (required.length === 0) {
    return 0.8;
  }
  const outputProps = new Set(Object.keys(outputSchema.properties ?? {}));
  const matches = required.filter((field) => outputProps.has(field)).length;
  return Math.max(0, Math.min(1, matches / required.length));
}

function scoreSchemaCompatibility(
  outputSchema: ConstructionSchema,
  inputSchema: ConstructionSchema,
): number {
  const outputTypes = buildSchemaTypes(outputSchema);
  const inputTypes = buildSchemaTypes(inputSchema);

  if (outputTypes.size > 0 && inputTypes.size > 0) {
    const overlap = Array.from(outputTypes).filter((type) => inputTypes.has(type));
    if (overlap.length > 0) {
      const denominator = Math.max(outputTypes.size, inputTypes.size);
      return Math.max(0, Math.min(1, overlap.length / denominator));
    }
  }

  return scoreObjectCompatibility(outputSchema, inputSchema);
}

function normalizeGeneratedConstructionId(id: string): ConstructionId | undefined {
  const canonical = toCanonicalConstructionId(id);
  if (canonical) {
    return canonical;
  }
  if (/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    const scoped = `@librainian-community/${id}` as ConstructionId;
    return isConstructionId(scoped) ? scoped : undefined;
  }
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length === 0) {
    return undefined;
  }
  const scoped = `@librainian-community/${slug}` as ConstructionId;
  return isConstructionId(scoped) ? scoped : undefined;
}

function inferScope(id: ConstructionId): ConstructionManifest['scope'] {
  if (id.startsWith('@librainian-community/')) {
    return '@librainian-community';
  }
  if (id.startsWith('@')) {
    const scope = id.split('/')[0];
    return scope as ConstructionManifest['scope'];
  }
  return '@librainian';
}

function humanizeSlug(id: string): string {
  return id
    .replace(/^librainian:/, '')
    .split(/[-_]/g)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

function scoreSimilarity(query: string, candidate: string): number {
  const normalizedQuery = query.toLowerCase();
  const normalizedCandidate = candidate.toLowerCase();
  if (normalizedQuery === normalizedCandidate) return 1;

  let score = 0;
  if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
    score += 0.55;
  }

  const queryTokens = normalizedQuery.split(/[^a-z0-9]+/g).filter(Boolean);
  const candidateTokens = normalizedCandidate.split(/[^a-z0-9]+/g).filter(Boolean);
  const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
  if (queryTokens.length > 0) {
    score += 0.35 * (overlap / queryTokens.length);
  }

  const distance = levenshteinDistance(normalizedQuery, normalizedCandidate);
  const maxLen = Math.max(normalizedQuery.length, normalizedCandidate.length);
  if (maxLen > 0) {
    score += 0.25 * (1 - distance / maxLen);
  }

  return Math.max(0, Math.min(1, score));
}

export class ConstructionRegistry {
  private readonly registry = new Map<ConstructionId, ConstructionManifest>();
  private readonly aliases = new Map<string, ConstructionId>();

  register(id: ConstructionId, manifest: ConstructionManifest): void {
    if (this.registry.has(id)) {
      throw new Error(`Construction ID '${id}' is already registered. IDs must be unique.`);
    }
    const normalized: ConstructionManifest = {
      ...manifest,
      id,
    };
    this.registry.set(id, normalized);
    this.aliases.set(id, id);
    for (const legacyId of normalized.legacyIds ?? []) {
      this.registerAlias(legacyId, id);
    }
  }

  replace(manifest: ConstructionManifest): void {
    if (!this.registry.has(manifest.id)) {
      throw new Error(`Construction ID '${manifest.id}' is not registered.`);
    }
    this.registry.set(manifest.id, manifest);
  }

  registerAlias(alias: string, targetId: ConstructionId): void {
    if (!this.registry.has(targetId)) {
      throw new Error(`Cannot alias '${alias}' to unknown construction '${targetId}'.`);
    }
    const existing = this.aliases.get(alias);
    if (existing && existing !== targetId) {
      throw new Error(
        `Construction alias '${alias}' is already mapped to '${existing}'.`,
      );
    }
    this.aliases.set(alias, targetId);
  }

  get(id: ConstructionId | string): ConstructionManifest | undefined {
    const resolved = this.resolveId(id);
    if (!resolved) {
      return undefined;
    }
    return this.registry.get(resolved);
  }

  has(id: ConstructionId | string): boolean {
    return this.get(id) !== undefined;
  }

  list(filter?: ConstructionListFilter): ConstructionManifest[] {
    let manifests = Array.from(this.registry.values());
    if (filter?.tags?.length) {
      manifests = manifests.filter((manifest) =>
        filter.tags?.some((tag) => manifest.tags.includes(tag)));
    }
    if (filter?.capabilities?.length) {
      manifests = manifests.filter((manifest) =>
        filter.capabilities?.every((capability) =>
          manifest.requiredCapabilities.includes(capability)));
    }
    if (filter?.trustTier) {
      manifests = manifests.filter((manifest) => manifest.trustTier === filter.trustTier);
    }
    if (filter?.availableOnly) {
      manifests = manifests.filter((manifest) => manifest.available !== false);
    }
    return manifests.sort((a, b) => a.id.localeCompare(b.id));
  }

  compatibilityScore(idA: ConstructionId | string, idB: ConstructionId | string): number {
    const a = this.get(idA);
    const b = this.get(idB);
    if (!a || !b) {
      return 0;
    }
    return scoreSchemaCompatibility(a.outputSchema, b.inputSchema);
  }

  findSimilar(id: string, limit = 3): ConstructionManifest[] {
    const target = id.trim();
    if (!target) {
      return [];
    }
    return Array.from(this.registry.values())
      .map((manifest) => ({
        manifest,
        score: Math.max(
          scoreSimilarity(target, manifest.id),
          ...(manifest.legacyIds ?? []).map((legacyId) => scoreSimilarity(target, legacyId)),
        ),
      }))
      .filter((entry) => entry.score >= 0.28)
      .sort((a, b) => b.score - a.score || a.manifest.id.localeCompare(b.manifest.id))
      .slice(0, Math.max(1, limit))
      .map((entry) => entry.manifest);
  }

  async invoke(
    id: ConstructionId | string,
    input: unknown,
    context?: Context<unknown>,
  ): Promise<unknown> {
    const manifest = this.get(id);
    if (!manifest) {
      throw new ConstructionError(
        `Unknown construction ID: ${String(id)}. Use list_constructions to discover available IDs.`,
        String(id),
      );
    }
    if (manifest.available === false) {
      throw new ConstructionError(
        `Construction ${manifest.id} is registered but not executable in this runtime.`,
        manifest.id,
      );
    }
    return manifest.construction.execute(input, context);
  }

  private resolveId(id: ConstructionId | string): ConstructionId | undefined {
    const directAlias = this.aliases.get(id);
    if (directAlias) {
      return directAlias;
    }

    const canonical = toCanonicalConstructionId(id);
    if (!canonical) {
      return undefined;
    }

    return this.aliases.get(canonical) ?? (this.registry.has(canonical) ? canonical : undefined);
  }
}

export const CONSTRUCTION_REGISTRY = new ConstructionRegistry();

function ensureLibrarianContext(
  context: Context<unknown> | undefined,
  constructionId: ConstructionId,
): { librarian: { [key: string]: unknown } } {
  const deps = context?.deps as Record<string, unknown> | undefined;
  const librarian = deps?.librarian as { [key: string]: unknown } | undefined;
  if (!librarian) {
    throw new ConstructionCapabilityError('librarian', constructionId);
  }
  return { librarian };
}

function seedRegistryWithDefaults(): void {
  const definitions = listConstructableDefinitions();
  for (const definition of definitions) {
    const canonicalId = `librainian:${definition.id}` as ConstructionId;
    const manifest: ConstructionManifest = {
      id: canonicalId,
      name: humanizeSlug(definition.id),
      scope: '@librainian',
      version: '1.0.0',
      description: definition.description,
      agentDescription:
        `${definition.description}. Use this when task intent aligns with tags: ${definition.tags?.join(', ') ?? 'general'}.`,
      inputSchema: UNKNOWN_SCHEMA,
      outputSchema: UNKNOWN_SCHEMA,
      requiredCapabilities: [],
      tags: definition.tags ?? [],
      languages: definition.languages,
      frameworks: definition.frameworks,
      trustTier: 'official',
      examples: [
        {
          description: `Run ${definition.id} for a relevant intent`,
          input: {},
          expectedOutputSummary: 'Returns construction-specific analysis output',
        },
      ],
      construction: createUnavailableConstruction(canonicalId, humanizeSlug(definition.id)),
      available: false,
      legacyIds: [definition.id],
    };
    CONSTRUCTION_REGISTRY.register(canonicalId, manifest);
  }

  for (const [legacyId, canonicalId] of Object.entries(LEGACY_CONSTRUCTION_ALIASES)) {
    if (canonicalId && CONSTRUCTION_REGISTRY.has(canonicalId)) {
      CONSTRUCTION_REGISTRY.registerAlias(legacyId, canonicalId);
    }
  }
}

function activateCoreConstructions(): void {
  const PRESET_PROCESS_INPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      dryRun: { type: 'boolean' },
      command: { type: 'string' },
      args: { type: 'array', items: { type: 'string' } },
      cwd: { type: 'string' },
      env: { type: 'object', additionalProperties: true },
      timeoutMs: { type: 'number' },
      budget: {
        type: 'object',
        properties: {
          maxDurationMs: { type: 'number' },
          maxTokenBudget: { type: 'number' },
          maxUsd: { type: 'number' },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: true,
  };

  const PRESET_PROCESS_OUTPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      preset: { type: 'string' },
      pattern: { type: 'string' },
      stages: { type: 'array' },
      costEstimateUsd: { type: 'string' },
      executed: { type: 'boolean' },
      execution: { type: 'object' },
      budget: { type: 'object' },
    },
    required: ['preset', 'pattern', 'stages', 'costEstimateUsd', 'executed'],
    additionalProperties: true,
  };

  const STALE_DOCUMENTATION_SENSOR_INPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' } },
      docTypes: { type: 'array', items: { type: 'string' } },
      changedInLastDays: { type: 'number' },
      stalenessThreshold: { type: 'number' },
    },
    required: ['paths'],
    additionalProperties: false,
  };

  const STALE_DOCUMENTATION_SENSOR_OUTPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      staleEntries: { type: 'array' },
      ghostDocumentation: { type: 'array' },
      undocumentedFunctions: { type: 'array' },
      agentSummary: { type: 'string' },
      documentationHealthScore: { type: 'number' },
    },
    required: ['staleEntries', 'ghostDocumentation', 'agentSummary', 'documentationHealthScore'],
    additionalProperties: true,
  };

  const TEST_SLOP_DETECTOR_INPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      testPaths: { type: 'array', items: { type: 'string' } },
      sourcePaths: { type: 'array', items: { type: 'string' } },
      checks: { type: 'array', items: { type: 'string' } },
    },
    required: ['testPaths'],
    additionalProperties: false,
  };

  const TEST_SLOP_DETECTOR_OUTPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      violations: { type: 'array' },
      critical: { type: 'array' },
      warnings: { type: 'array' },
      effectivelyUntested: { type: 'array' },
      agentSummary: { type: 'string' },
      effectiveCoverageEstimate: { type: 'number' },
    },
    required: ['violations', 'critical', 'warnings', 'effectivelyUntested', 'agentSummary', 'effectiveCoverageEstimate'],
    additionalProperties: true,
  };

  const DIFF_SEMANTIC_SUMMARIZER_INPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      diff: { type: 'string' },
      baseSha: { type: 'string' },
      headSha: { type: 'string' },
      focusAreas: { type: 'array', items: { type: 'string' } },
      workspaceRoot: { type: 'string' },
    },
    additionalProperties: false,
  };

  const DIFF_SEMANTIC_SUMMARIZER_OUTPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      deltas: { type: 'array' },
      blastRadius: { type: 'object' },
      criticalChanges: { type: 'array' },
      newCoverageGaps: { type: 'array' },
      agentBriefing: { type: 'string' },
      reviewerSummary: { type: 'string' },
    },
    required: ['deltas', 'blastRadius', 'criticalChanges', 'newCoverageGaps', 'agentBriefing', 'reviewerSummary'],
    additionalProperties: true,
  };

  const INTENT_BEHAVIOR_COHERENCE_CHECKER_INPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      targets: { type: 'array', items: { type: 'string' } },
      fromEntrypoints: { type: 'array', items: { type: 'string' } },
      divergenceThreshold: { type: 'number' },
      prioritizeByCriticality: { type: 'boolean' },
      workspaceRoot: { type: 'string' },
    },
    additionalProperties: false,
  };

  const INTENT_BEHAVIOR_COHERENCE_CHECKER_OUTPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      violations: { type: 'array' },
      criticalViolations: { type: 'array' },
      agentSummary: { type: 'string' },
    },
    required: ['violations', 'criticalViolations', 'agentSummary'],
    additionalProperties: true,
  };

  const SEMANTIC_DUPLICATE_DETECTOR_INPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      intendedDescription: { type: 'string' },
      targetModule: { type: 'string' },
      anticipatedCallers: { type: 'array', items: { type: 'string' } },
      threshold: { type: 'number' },
      maxResults: { type: 'number' },
    },
    required: ['intendedDescription'],
    additionalProperties: false,
  };

  const SEMANTIC_DUPLICATE_DETECTOR_OUTPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      matches: { type: 'array' },
      hasDuplicates: { type: 'boolean' },
      topMatch: { type: 'object' },
      agentSummary: { type: 'string' },
    },
    required: ['matches', 'hasDuplicates', 'topMatch', 'agentSummary'],
    additionalProperties: true,
  };

  const HALLUCINATED_API_DETECTOR_INPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      generatedCode: { type: 'string' },
      projectRoot: { type: 'string' },
      packagesToCheck: { type: 'array', items: { type: 'string' } },
    },
    required: ['generatedCode', 'projectRoot'],
    additionalProperties: false,
  };

  const HALLUCINATED_API_DETECTOR_OUTPUT_SCHEMA: ConstructionSchema = {
    type: 'object',
    properties: {
      calls: { type: 'array' },
      hallucinatedCount: { type: 'number' },
      unverifiableCount: { type: 'number' },
      agentSummary: { type: 'string' },
      hasBlockingIssues: { type: 'boolean' },
    },
    required: ['calls', 'hallucinatedCount', 'unverifiableCount', 'agentSummary', 'hasBlockingIssues'],
    additionalProperties: true,
  };

  const core: Array<{
    id: ConstructionId;
    inputSchema: ConstructionSchema;
    outputSchema: ConstructionSchema;
    requiredCapabilities: CapabilityId[];
    execute: (input: unknown, context?: Context<unknown>) => Promise<unknown>;
  }> = [
    {
      id: 'librainian:refactoring-safety-checker',
      inputSchema: {
        type: 'object',
        properties: {
          entityId: { type: 'string' },
          refactoringType: { type: 'string' },
        },
        required: ['entityId', 'refactoringType'],
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        properties: {
          safe: { type: 'boolean' },
          riskScore: { type: 'number' },
          confidence: { type: 'object' },
        },
        required: ['safe', 'riskScore', 'confidence'],
        additionalProperties: true,
      },
      requiredCapabilities: ['librarian', 'impact-analysis'],
      execute: async (input, context) => {
        const { librarian } = ensureLibrarianContext(context, 'librainian:refactoring-safety-checker');
        const { createRefactoringSafetyChecker } = await import('./refactoring_safety_checker.js');
        return createRefactoringSafetyChecker(librarian as any).check(input as any);
      },
    },
    {
      id: 'librainian:bug-investigation-assistant',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          errorMessage: { type: 'string' },
          stackTrace: { type: 'string' },
        },
        required: ['description', 'errorMessage'],
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        properties: {
          hypotheses: { type: 'array' },
          confidence: { type: 'object' },
        },
        required: ['hypotheses', 'confidence'],
        additionalProperties: true,
      },
      requiredCapabilities: ['librarian', 'debug-analysis'],
      execute: async (input, context) => {
        const { librarian } = ensureLibrarianContext(context, 'librainian:bug-investigation-assistant');
        const { createBugInvestigationAssistant } = await import('./bug_investigation_assistant.js');
        return createBugInvestigationAssistant(librarian as any).investigate(input as any);
      },
    },
    {
      id: 'librainian:feature-location-advisor',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          affectedAreas: { type: 'array', items: { type: 'string' } },
        },
        required: ['description'],
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        properties: {
          locations: { type: 'array' },
          confidence: { type: 'object' },
        },
        required: ['locations', 'confidence'],
        additionalProperties: true,
      },
      requiredCapabilities: ['librarian', 'symbol-search'],
      execute: async (input, context) => {
        const { librarian } = ensureLibrarianContext(context, 'librainian:feature-location-advisor');
        const { createFeatureLocationAdvisor } = await import('./feature_location_advisor.js');
        return createFeatureLocationAdvisor(librarian as any).locate(input as any);
      },
    },
    {
      id: 'librainian:code-quality-reporter',
      inputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          aspects: { type: 'array', items: { type: 'string' } },
        },
        required: ['files', 'aspects'],
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        properties: {
          issues: { type: 'array' },
          metrics: { type: 'object' },
          confidence: { type: 'object' },
        },
        required: ['issues', 'metrics', 'confidence'],
        additionalProperties: true,
      },
      requiredCapabilities: ['librarian', 'quality-analysis'],
      execute: async (input, context) => {
        const { librarian } = ensureLibrarianContext(context, 'librainian:code-quality-reporter');
        const { createCodeQualityReporter } = await import('./code_quality_reporter.js');
        return createCodeQualityReporter(librarian as any).analyze(input as any);
      },
    },
    {
      id: 'librainian:architecture-verifier',
      inputSchema: {
        type: 'object',
        properties: {
          layers: { type: 'array' },
          boundaries: { type: 'array' },
          rules: { type: 'array' },
        },
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        properties: {
          violations: { type: 'array' },
          confidence: { type: 'object' },
        },
        required: ['violations', 'confidence'],
        additionalProperties: true,
      },
      requiredCapabilities: ['librarian', 'architecture-analysis'],
      execute: async (input, context) => {
        const { librarian } = ensureLibrarianContext(context, 'librainian:architecture-verifier');
        const { createArchitectureVerifier } = await import('./architecture_verifier.js');
        return createArchitectureVerifier(librarian as any).verify(input as any);
      },
    },
    {
      id: 'librainian:security-audit-helper',
      inputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          checkTypes: { type: 'array', items: { type: 'string' } },
          workspace: { type: 'string' },
        },
        required: ['files', 'checkTypes'],
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        properties: {
          findings: { type: 'array' },
          confidence: { type: 'object' },
        },
        required: ['findings', 'confidence'],
        additionalProperties: true,
      },
      requiredCapabilities: ['librarian', 'security-analysis'],
      execute: async (input, context) => {
        const { librarian } = ensureLibrarianContext(context, 'librainian:security-audit-helper');
        const { createSecurityAuditHelper } = await import('./security_audit_helper.js');
        return createSecurityAuditHelper(librarian as any).audit(input as any);
      },
    },
    {
      id: 'librainian:skill-audit-construction',
      inputSchema: {
        type: 'object',
        properties: {
          skillContent: { type: 'string' },
          skillPath: { type: 'string' },
          workdir: { type: 'string' },
        },
        required: ['skillContent'],
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        properties: {
          riskScore: { type: 'number' },
          verdict: { type: 'string' },
          maliciousPatterns: { type: 'array' },
          evidence: { type: 'array' },
          recommendation: { type: 'string' },
        },
        required: ['riskScore', 'verdict', 'maliciousPatterns', 'evidence', 'recommendation'],
        additionalProperties: true,
      },
      requiredCapabilities: ['security-analysis'],
      execute: async (input) => {
        const { createSkillAuditConstruction } = await import('./skill_audit.js');
        return createSkillAuditConstruction().audit(input as any);
      },
    },
    {
      id: 'librainian:comprehensive-quality-construction',
      inputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          architectureSpec: { type: 'object' },
          securityScope: { type: 'object' },
        },
        required: ['files', 'architectureSpec', 'securityScope'],
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        properties: {
          overallScore: { type: 'number' },
          confidence: { type: 'object' },
          issues: { type: 'array' },
        },
        required: ['overallScore', 'confidence', 'issues'],
        additionalProperties: true,
      },
      requiredCapabilities: ['librarian', 'quality-analysis', 'security-analysis', 'architecture-analysis'],
      execute: async (input, context) => {
        const { librarian } = ensureLibrarianContext(context, 'librainian:comprehensive-quality-construction');
        const { createComprehensiveQualityConstruction } = await import('./comprehensive_quality_construction.js');
        return createComprehensiveQualityConstruction(librarian as any).assess(input as any);
      },
    },
    {
      id: 'librainian:patrol-process',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string' },
          mode: { type: 'string' },
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          cwd: { type: 'string' },
          env: { type: 'object', additionalProperties: true },
          dryRun: { type: 'boolean' },
          keepSandbox: { type: 'boolean' },
          policyTrigger: { type: 'string' },
          policyConfig: { type: 'object', additionalProperties: true },
          policyDecisionOutputPath: { type: 'string' },
          observationProtocol: {
            type: 'object',
            properties: {
              incrementalPrefix: { type: 'string' },
              blockStart: { type: 'string' },
              blockEnd: { type: 'string' },
            },
            additionalProperties: false,
          },
          budget: {
            type: 'object',
            properties: {
              maxDurationMs: { type: 'number' },
              maxTokenBudget: { type: 'number' },
              maxUsd: { type: 'number' },
            },
            additionalProperties: false,
          },
          timeoutMs: { type: 'number' },
        },
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        properties: {
          report: { type: 'object' },
          findings: { type: 'array' },
          implicitSignals: { type: 'object' },
          aggregate: { type: 'object' },
          policyEnforcement: { type: 'object' },
          exitReason: { type: 'string' },
          events: { type: 'array' },
          costSummary: { type: 'object' },
          observations: { type: 'object' },
        },
        required: ['report', 'findings', 'implicitSignals', 'aggregate', 'policyEnforcement', 'exitReason', 'events'],
        additionalProperties: true,
      },
      requiredCapabilities: [],
      execute: async (input) => {
        const { createPatrolProcessConstruction } = await import('./processes/patrol_process.js');
        return createPatrolProcessConstruction().execute(input as PatrolInput);
      },
    },
    {
      id: 'librainian:code-review-pipeline',
      inputSchema: PRESET_PROCESS_INPUT_SCHEMA,
      outputSchema: PRESET_PROCESS_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input) => {
        const { createCodeReviewPipelineConstruction } = await import('./processes/presets.js');
        return createCodeReviewPipelineConstruction().execute(input as PresetProcessInput);
      },
    },
    {
      id: 'librainian:migration-assistant',
      inputSchema: PRESET_PROCESS_INPUT_SCHEMA,
      outputSchema: PRESET_PROCESS_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input) => {
        const { createMigrationAssistantConstruction } = await import('./processes/presets.js');
        return createMigrationAssistantConstruction().execute(input as PresetProcessInput);
      },
    },
    {
      id: 'librainian:documentation-generator',
      inputSchema: PRESET_PROCESS_INPUT_SCHEMA,
      outputSchema: PRESET_PROCESS_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input) => {
        const { createDocumentationGeneratorConstruction } = await import('./processes/presets.js');
        return createDocumentationGeneratorConstruction().execute(input as PresetProcessInput);
      },
    },
    {
      id: 'librainian:stale-documentation-sensor',
      inputSchema: STALE_DOCUMENTATION_SENSOR_INPUT_SCHEMA,
      outputSchema: STALE_DOCUMENTATION_SENSOR_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input, context) => {
        const { createStaleDocumentationSensorConstruction } = await import('./processes/stale_documentation_sensor.js');
        return createStaleDocumentationSensorConstruction().execute(input as StalenessInput, context);
      },
    },
    {
      id: 'librainian:test-slop-detector',
      inputSchema: TEST_SLOP_DETECTOR_INPUT_SCHEMA,
      outputSchema: TEST_SLOP_DETECTOR_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input, context) => {
        const { createTestSlopDetectorConstruction } = await import('./processes/test_slop_detector.js');
        return createTestSlopDetectorConstruction().execute(input as TestSlopInput, context);
      },
    },
    {
      id: 'librainian:diff-semantic-summarizer',
      inputSchema: DIFF_SEMANTIC_SUMMARIZER_INPUT_SCHEMA,
      outputSchema: DIFF_SEMANTIC_SUMMARIZER_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input, context) => {
        const { createDiffSemanticSummarizerConstruction } = await import('./processes/diff_semantic_summarizer.js');
        return createDiffSemanticSummarizerConstruction().execute(input as DiffSummarizerInput, context);
      },
    },
    {
      id: 'librainian:intent-behavior-coherence-checker',
      inputSchema: INTENT_BEHAVIOR_COHERENCE_CHECKER_INPUT_SCHEMA,
      outputSchema: INTENT_BEHAVIOR_COHERENCE_CHECKER_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input, context) => {
        const { createIntentBehaviorCoherenceCheckerConstruction } = await import('./processes/intent_behavior_coherence_checker.js');
        return createIntentBehaviorCoherenceCheckerConstruction().execute(input as IntentBehaviorCoherenceInput, context);
      },
    },
    {
      id: 'librainian:semantic-duplicate-detector',
      inputSchema: SEMANTIC_DUPLICATE_DETECTOR_INPUT_SCHEMA,
      outputSchema: SEMANTIC_DUPLICATE_DETECTOR_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input, context) => {
        const { createSemanticDuplicateDetectorConstruction } = await import('./processes/semantic_duplicate_detector.js');
        return createSemanticDuplicateDetectorConstruction().execute(input as SemanticDuplicateDetectorInput, context);
      },
    },
    {
      id: 'librainian:hallucinated-api-detector',
      inputSchema: HALLUCINATED_API_DETECTOR_INPUT_SCHEMA,
      outputSchema: HALLUCINATED_API_DETECTOR_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input, context) => {
        const { createHallucinatedApiDetectorConstruction } = await import('./processes/hallucinated_api_detector.js');
        return createHallucinatedApiDetectorConstruction().execute(input as APIDetectorInput, context);
      },
    },
    {
      id: 'librainian:regression-detector',
      inputSchema: PRESET_PROCESS_INPUT_SCHEMA,
      outputSchema: PRESET_PROCESS_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input) => {
        const { createRegressionDetectorConstruction } = await import('./processes/presets.js');
        return createRegressionDetectorConstruction().execute(input as PresetProcessInput);
      },
    },
    {
      id: 'librainian:onboarding-assistant',
      inputSchema: PRESET_PROCESS_INPUT_SCHEMA,
      outputSchema: PRESET_PROCESS_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input) => {
        const { createOnboardingAssistantConstruction } = await import('./processes/presets.js');
        return createOnboardingAssistantConstruction().execute(input as PresetProcessInput);
      },
    },
    {
      id: 'librainian:release-qualification',
      inputSchema: PRESET_PROCESS_INPUT_SCHEMA,
      outputSchema: PRESET_PROCESS_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input) => {
        const { createReleaseQualificationConstruction } = await import('./processes/presets.js');
        return createReleaseQualificationConstruction().execute(input as PresetProcessInput);
      },
    },
    {
      id: 'librainian:dependency-auditor',
      inputSchema: PRESET_PROCESS_INPUT_SCHEMA,
      outputSchema: PRESET_PROCESS_OUTPUT_SCHEMA,
      requiredCapabilities: [],
      execute: async (input) => {
        const { createDependencyAuditorConstruction } = await import('./processes/presets.js');
        return createDependencyAuditorConstruction().execute(input as PresetProcessInput);
      },
    },
  ];

  for (const runtimeEntry of core) {
    const existing = CONSTRUCTION_REGISTRY.get(runtimeEntry.id);
    if (!existing) {
      continue;
    }
    const upgraded: ConstructionManifest = {
      ...existing,
      available: true,
      inputSchema: runtimeEntry.inputSchema,
      outputSchema: runtimeEntry.outputSchema,
      requiredCapabilities: runtimeEntry.requiredCapabilities,
      construction: {
        id: existing.id,
        name: existing.name,
        description: existing.description,
        execute: async (input, context) => {
          try {
            const execution = await runtimeEntry.execute(input, context);
            return isConstructionOutcome(execution)
              ? execution
              : ok(execution);
          } catch (error) {
            const normalized = error instanceof ConstructionError
              ? error
              : error instanceof Error
                ? new ConstructionError(error.message, existing.id, error)
                : new ConstructionError(`Non-error failure: ${String(error)}`, existing.id);
            return fail(normalized, undefined, existing.id);
          }
        },
      },
      examples: [
        ...existing.examples,
        {
          description: `Invoke ${existing.id} through registry routing`,
          input: {},
          expectedOutputSummary: 'Returns typed construction result payload',
        },
      ],
    };
    CONSTRUCTION_REGISTRY.replace(upgraded);
  }
}

seedRegistryWithDefaults();
activateCoreConstructions();

export function listConstructions(
  filter?: ConstructionListFilter,
): ConstructionManifest[] {
  return CONSTRUCTION_REGISTRY.list(filter);
}

export function getConstructionManifest(
  id: ConstructionId | string,
): ConstructionManifest | undefined {
  return CONSTRUCTION_REGISTRY.get(id);
}

export async function invokeConstruction(
  id: ConstructionId | string,
  input: unknown,
  context?: Context<unknown>,
): Promise<unknown> {
  return CONSTRUCTION_REGISTRY.invoke(id, input, context);
}

export function findSimilarConstructions(
  id: string,
  limit = 3,
): ConstructionManifest[] {
  return CONSTRUCTION_REGISTRY.findSimilar(id, limit);
}

export function registerGeneratedConstruction(
  construction: Construction<unknown, unknown, ConstructionError, unknown>,
): ConstructionId | undefined {
  const normalizedId = normalizeGeneratedConstructionId(construction.id);
  if (!normalizedId || CONSTRUCTION_REGISTRY.has(normalizedId)) {
    return normalizedId;
  }

  CONSTRUCTION_REGISTRY.register(normalizedId, {
    id: normalizedId,
    name: construction.name || humanizeSlug(construction.id),
    scope: inferScope(normalizedId),
    version: '0.0.0-runtime',
    description: construction.description ?? 'Runtime-generated construction',
    agentDescription:
      'Runtime-generated construction registered automatically via createConstruction().',
    inputSchema: UNKNOWN_SCHEMA,
    outputSchema: UNKNOWN_SCHEMA,
    requiredCapabilities: [],
    tags: ['runtime', 'generated'],
    trustTier: normalizedId.startsWith('@librainian-community/')
      ? 'community'
      : 'official',
    examples: [
      {
        description: 'Execute generated runtime construction',
        input: {},
        expectedOutputSummary: 'Returns generated construction output',
      },
    ],
    construction,
    available: true,
  });

  return normalizedId;
}
