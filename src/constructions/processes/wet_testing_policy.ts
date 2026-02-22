import { createHash } from 'node:crypto';
import { z } from 'zod';

export const WET_TESTING_POLICY_KIND = 'WetTestingPolicyConfig.v1';
export const WET_TESTING_POLICY_DECISION_KIND = 'WetTestingPolicyDecision.v1';
export const WET_TESTING_POLICY_DECISION_ARTIFACT_KIND = 'WetTestingPolicyDecisionArtifact.v1';

const evidenceModeSchema = z.enum(['wet', 'dry', 'mixed']);
const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
const blastRadiusSchema = z.enum(['local', 'module', 'cross_module', 'repo']);
const noveltySchema = z.enum(['known', 'modified', 'novel']);
const providerDependenceSchema = z.enum(['none', 'embeddings', 'llm', 'mixed']);
const triggerSchema = z.enum(['manual', 'schedule', 'ci', 'release']);
const executionSurfaceSchema = z.enum(['unit', 'integration', 'patrol', 'dogfood', 'publish']);
const userImpactSchema = z.enum(['none', 'low', 'medium', 'high', 'blocker']);

const decisionTemplateSchema = z.object({
  requiredEvidenceMode: evidenceModeSchema,
  requireOperationalProofArtifacts: z.boolean(),
  failClosed: z.boolean(),
  reason: z.string().min(1),
}).strict();

const policyRuleConditionSchema = z.object({
  minRiskLevel: riskLevelSchema.optional(),
  minBlastRadius: blastRadiusSchema.optional(),
  minNovelty: noveltySchema.optional(),
  minUserImpact: userImpactSchema.optional(),
  providerDependenceIn: z.array(providerDependenceSchema).optional(),
  triggerIn: z.array(triggerSchema).optional(),
  executionSurfaceIn: z.array(executionSurfaceSchema).optional(),
  releaseCritical: z.boolean().optional(),
  requiresExternalRepo: z.boolean().optional(),
}).strict();

const policyRuleSchema = z.object({
  id: z.string().min(1),
  priority: z.number().int().min(0),
  when: policyRuleConditionSchema,
  decision: decisionTemplateSchema,
}).strict();

const wetTestingPolicyConfigSchema = z.object({
  kind: z.literal(WET_TESTING_POLICY_KIND),
  schemaVersion: z.literal(1),
  defaultDecision: decisionTemplateSchema,
  rules: z.array(policyRuleSchema),
}).strict();

const wetTestingPolicyContextSchema = z.object({
  riskLevel: riskLevelSchema,
  blastRadius: blastRadiusSchema,
  novelty: noveltySchema,
  providerDependence: providerDependenceSchema,
  trigger: triggerSchema,
  executionSurface: executionSurfaceSchema,
  userImpact: userImpactSchema,
  releaseCritical: z.boolean(),
  requiresExternalRepo: z.boolean(),
}).strict();

export type WetTestingPolicyConfig = z.infer<typeof wetTestingPolicyConfigSchema>;
export type WetTestingPolicyRuleCondition = z.infer<typeof policyRuleConditionSchema>;
export type WetTestingPolicyContext = z.infer<typeof wetTestingPolicyContextSchema>;
export type WetTestingEvidenceMode = z.infer<typeof evidenceModeSchema>;

export interface WetTestingPolicyDecision {
  kind: typeof WET_TESTING_POLICY_DECISION_KIND;
  schemaVersion: 1;
  policyKind: typeof WET_TESTING_POLICY_KIND;
  policySchemaVersion: 1;
  matchedRuleId: string | null;
  matchedRuleIds: string[];
  requiredEvidenceMode: WetTestingEvidenceMode;
  requireOperationalProofArtifacts: boolean;
  failClosed: boolean;
  failClosedReason?: string;
  reason: string;
  contextKey: string;
}

export interface WetTestingPolicyDecisionArtifact {
  kind: typeof WET_TESTING_POLICY_DECISION_ARTIFACT_KIND;
  schemaVersion: 1;
  generatedAt: string;
  policyDigest: string;
  decision: WetTestingPolicyDecision;
}

const riskRank: Record<z.infer<typeof riskLevelSchema>, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const blastRadiusRank: Record<z.infer<typeof blastRadiusSchema>, number> = {
  local: 0,
  module: 1,
  cross_module: 2,
  repo: 3,
};

const noveltyRank: Record<z.infer<typeof noveltySchema>, number> = {
  known: 0,
  modified: 1,
  novel: 2,
};

const userImpactRank: Record<z.infer<typeof userImpactSchema>, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  blocker: 4,
};

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashStable(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function rankAtLeast<T extends string>(
  values: Record<T, number>,
  actual: T,
  minimum: T | undefined,
): boolean {
  if (!minimum) return true;
  return values[actual] >= values[minimum];
}

function listContains<T extends string>(actual: T, allowed: readonly T[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(actual);
}

function normalizeRuleCondition(condition: WetTestingPolicyRuleCondition): WetTestingPolicyRuleCondition {
  const normalize = <T extends string>(values: readonly T[] | undefined): T[] | undefined => {
    if (!values || values.length === 0) return undefined;
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  };

  return {
    ...condition,
    providerDependenceIn: normalize(condition.providerDependenceIn),
    triggerIn: normalize(condition.triggerIn),
    executionSurfaceIn: normalize(condition.executionSurfaceIn),
  };
}

function matchesCondition(
  context: WetTestingPolicyContext,
  condition: WetTestingPolicyRuleCondition,
): boolean {
  return rankAtLeast(riskRank, context.riskLevel, condition.minRiskLevel)
    && rankAtLeast(blastRadiusRank, context.blastRadius, condition.minBlastRadius)
    && rankAtLeast(noveltyRank, context.novelty, condition.minNovelty)
    && rankAtLeast(userImpactRank, context.userImpact, condition.minUserImpact)
    && listContains(context.providerDependence, condition.providerDependenceIn)
    && listContains(context.trigger, condition.triggerIn)
    && listContains(context.executionSurface, condition.executionSurfaceIn)
    && (condition.releaseCritical === undefined || condition.releaseCritical === context.releaseCritical)
    && (
      condition.requiresExternalRepo === undefined
      || condition.requiresExternalRepo === context.requiresExternalRepo
    );
}

function deterministicRules(config: WetTestingPolicyConfig): WetTestingPolicyConfig['rules'] {
  return [...config.rules]
    .map((rule) => ({
      ...rule,
      when: normalizeRuleCondition(rule.when),
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.id.localeCompare(b.id);
    });
}

function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
    .join('; ');
}

export function parseWetTestingPolicyConfig(input: unknown): WetTestingPolicyConfig {
  const parsed = wetTestingPolicyConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`invalid_wet_testing_policy_config:${formatValidationIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function parseWetTestingPolicyContext(input: unknown): WetTestingPolicyContext {
  const parsed = wetTestingPolicyContextSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`invalid_wet_testing_policy_context:${formatValidationIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function evaluateWetTestingPolicy(
  policyInput: WetTestingPolicyConfig,
  contextInput: WetTestingPolicyContext,
): WetTestingPolicyDecision {
  const policy = parseWetTestingPolicyConfig(policyInput);
  const context = parseWetTestingPolicyContext(contextInput);
  const rules = deterministicRules(policy);
  const matchingRules = rules.filter((rule) => matchesCondition(context, rule.when));
  const selected = matchingRules[0] ?? null;
  const selectedDecision = selected?.decision ?? policy.defaultDecision;
  const contextKey = hashStable(context);

  return {
    kind: WET_TESTING_POLICY_DECISION_KIND,
    schemaVersion: 1,
    policyKind: WET_TESTING_POLICY_KIND,
    policySchemaVersion: 1,
    matchedRuleId: selected?.id ?? null,
    matchedRuleIds: matchingRules.map((rule) => rule.id),
    requiredEvidenceMode: selectedDecision.requiredEvidenceMode,
    requireOperationalProofArtifacts: selectedDecision.requireOperationalProofArtifacts,
    failClosed: selectedDecision.failClosed,
    failClosedReason: selectedDecision.failClosed ? selectedDecision.reason : undefined,
    reason: selectedDecision.reason,
    contextKey,
  };
}

export function createWetTestingPolicyDecisionArtifact(
  decision: WetTestingPolicyDecision,
  policy: WetTestingPolicyConfig,
  generatedAt: string = new Date().toISOString(),
): WetTestingPolicyDecisionArtifact {
  return {
    kind: WET_TESTING_POLICY_DECISION_ARTIFACT_KIND,
    schemaVersion: 1,
    generatedAt,
    policyDigest: hashStable({
      ...policy,
      rules: deterministicRules(policy),
    }),
    decision,
  };
}

export const DEFAULT_WET_TESTING_POLICY_CONFIG: WetTestingPolicyConfig = {
  kind: WET_TESTING_POLICY_KIND,
  schemaVersion: 1,
  defaultDecision: {
    requiredEvidenceMode: 'dry',
    requireOperationalProofArtifacts: false,
    failClosed: false,
    reason: 'Default to dry evidence when no higher-risk rule matches.',
  },
  rules: [
    {
      id: 'critical-release-wet',
      priority: 100,
      when: {
        minRiskLevel: 'high',
        releaseCritical: true,
        triggerIn: ['ci', 'release'],
      },
      decision: {
        requiredEvidenceMode: 'wet',
        requireOperationalProofArtifacts: true,
        failClosed: true,
        reason: 'Ship-blocking high-risk paths must provide wet operational proof artifacts.',
      },
    },
    {
      id: 'high-impact-patrol-mixed',
      priority: 70,
      when: {
        minUserImpact: 'high',
        executionSurfaceIn: ['patrol', 'dogfood', 'publish'],
      },
      decision: {
        requiredEvidenceMode: 'mixed',
        requireOperationalProofArtifacts: true,
        failClosed: true,
        reason: 'High-impact patrol and dogfood runs require mixed evidence with concrete artifacts.',
      },
    },
    {
      id: 'provider-dependent-mixed',
      priority: 50,
      when: {
        providerDependenceIn: ['llm', 'mixed'],
        minRiskLevel: 'medium',
      },
      decision: {
        requiredEvidenceMode: 'mixed',
        requireOperationalProofArtifacts: true,
        failClosed: true,
        reason: 'Provider-dependent medium+ risk paths require mixed evidence and fail closed.',
      },
    },
  ],
};
