/**
 * @fileoverview Constructable registry
 *
 * Central definitions for constructables so auto-selection, routing,
 * and validation stay consistent.
 */

import type {
  ConstructableId,
  Language,
  Framework,
  ProjectPattern,
  ProjectType,
  ConstructableClassificationFlag,
  ConstructableAvailability,
} from './constructable_types.js';

export interface ConstructableDefinition {
  id: ConstructableId;
  /** Languages this constructable supports */
  languages?: Language[];
  /** Frameworks this constructable supports */
  frameworks?: Framework[];
  /** Patterns this constructable supports */
  patterns?: ProjectPattern[];
  /** Project types this constructable supports */
  projectTypes?: ProjectType[];
  /** Base priority (can be boosted by matches) */
  basePriority: number;
  /** Whether this is a core constructable (always considered) */
  isCore: boolean;
  /** Description */
  description: string;
  /** Goal this constructable serves (why) */
  motivation?: string;
  /** Process-evolution hints for orchestration and alternative discovery */
  evolution?: {
    /** Whether this constructable can execute without human review */
    automatable?: boolean;
    /** Known alternatives serving similar motivations */
    alternatives?: ConstructableId[];
    /** Composition guidance (pairings/conflicts) */
    compositionHints?: ConstructableId[];
  };
  /** Query classification flag for routing */
  classificationFlag?: ConstructableClassificationFlag;
  /** Availability level */
  availability?: ConstructableAvailability;
  /** Constructables required before this can run */
  requiresConstructables?: ConstructableId[];
  /** Constructables that conflict with this one */
  conflictsWith?: ConstructableId[];
  /** Tags for selection and reporting */
  tags?: string[];
}

export interface MotivationSimilarityMatch {
  constructable: ConstructableDefinition;
  similarity: number;
}

export interface MotivationSimilarityQuery {
  minSimilarity?: number;
  topK?: number;
}

export interface MotivationIndex {
  findBySimilarMotivation(
    motivation: string,
    options?: MotivationSimilarityQuery
  ): MotivationSimilarityMatch[];
}

const READY: ConstructableAvailability = 'ready';
const EXPERIMENTAL: ConstructableAvailability = 'experimental';
const MIN_MOTIVATION_LENGTH = 20;
const DEFAULT_MOTIVATION_MIN_SIMILARITY = 0.2;
const DEFAULT_MOTIVATION_TOP_K = 5;
const MOTIVATION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is',
  'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with',
]);

export const DEFAULT_CONSTRUCTABLE_DEFINITIONS: ConstructableDefinition[] = [
  // Core Constructions - always evaluated
  {
    id: 'refactoring-safety-checker',
    basePriority: 90,
    isCore: true,
    availability: READY,
    classificationFlag: 'isRefactoringSafetyQuery',
    description: 'Ensures refactoring operations are safe across all languages',
    motivation: 'Prevent regressions by proving refactors preserve caller-visible behavior.',
    tags: ['core', 'refactor'],
  },
  {
    id: 'bug-investigation-assistant',
    basePriority: 85,
    isCore: true,
    availability: READY,
    classificationFlag: 'isBugInvestigationQuery',
    description: 'Assists with bug investigation using code analysis',
    motivation: 'Diagnose and localize root causes of production bugs quickly and defensibly.',
    tags: ['core', 'debug'],
  },
  {
    id: 'feature-location-advisor',
    basePriority: 80,
    isCore: true,
    availability: READY,
    classificationFlag: 'isFeatureLocationQuery',
    description: 'Helps locate features in the codebase',
    motivation: 'Find where a user-described capability is implemented with minimal search time.',
    tags: ['core', 'navigation'],
  },
  {
    id: 'code-quality-reporter',
    basePriority: 75,
    isCore: true,
    availability: READY,
    classificationFlag: 'isCodeQualityQuery',
    description: 'Reports on code quality metrics',
    motivation: 'Reveal maintainability and correctness risks before they become incidents.',
    tags: ['core', 'quality'],
  },
  {
    id: 'architecture-verifier',
    basePriority: 70,
    isCore: true,
    availability: READY,
    classificationFlag: 'isArchitectureVerificationQuery',
    description: 'Verifies architecture rules and boundaries',
    motivation: 'Ensure changes remain within intended architectural boundaries and contracts.',
    tags: ['core', 'architecture'],
  },
  {
    id: 'security-audit-helper',
    basePriority: 85,
    isCore: true,
    availability: READY,
    classificationFlag: 'isSecurityAuditQuery',
    description: 'Assists with security audits and vulnerability detection',
    motivation: 'Detect exploitable security weaknesses before code reaches production.',
    tags: ['core', 'security'],
  },
  {
    id: 'skill-audit-construction',
    basePriority: 88,
    isCore: true,
    availability: READY,
    classificationFlag: 'isSecurityAuditQuery',
    description: 'Audits SKILL.md content for malicious or suspicious behavior',
    motivation: 'Protect agent workflows from unsafe or malicious skill instructions.',
    tags: ['core', 'security', 'skills'],
  },
  {
    id: 'comprehensive-quality-construction',
    basePriority: 65,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Comprehensive code quality assessment',
    motivation: 'Produce a broad quality baseline to prioritize engineering improvements.',
    tags: ['quality'],
  },
  {
    id: 'preflight-checker',
    basePriority: 78,
    isCore: true,
    availability: READY,
    description: 'Runs bootstrap pre-flight checks and summarizes blocking and warning findings',
    motivation: 'Catch blocking environment and bootstrap failures before expensive workflows run.',
    tags: ['core', 'preflight', 'bootstrap'],
  },
  {
    id: 'patrol-process',
    basePriority: 82,
    isCore: true,
    availability: READY,
    description: 'Runs the typed patrol process pipeline for agent observation, signal extraction, and report generation',
    motivation: 'Continuously surface high-signal reliability and quality regressions during dogfooding.',
    tags: ['core', 'process', 'patrol', 'agentic'],
  },
  {
    id: 'code-review-pipeline',
    basePriority: 80,
    isCore: true,
    availability: READY,
    description: 'Parallel security, quality, and performance review preset pipeline',
    motivation: 'Evaluate code changes for correctness, risk, and merge readiness before landing.',
    tags: ['core', 'process', 'preset', 'review'],
  },
  {
    id: 'migration-assistant',
    basePriority: 78,
    isCore: true,
    availability: READY,
    description: 'Analyze, plan, execute, and verify migration preset pipeline',
    motivation: 'Plan and execute safe incremental migrations with measurable rollback safety.',
    tags: ['core', 'process', 'preset', 'migration'],
  },
  {
    id: 'documentation-generator',
    basePriority: 74,
    isCore: true,
    availability: READY,
    description: 'Single-agent documentation exploration and synthesis preset',
    motivation: 'Generate accurate and current documentation from real code behavior and structure.',
    tags: ['core', 'process', 'preset', 'documentation'],
  },
  {
    id: 'stale-documentation-sensor',
    basePriority: 79,
    isCore: true,
    availability: READY,
    description: 'Detects documentation claims that diverged from current implementation behavior',
    motivation: 'Prevent agent and human workflows from relying on stale documentation as authoritative truth.',
    tags: ['core', 'process', 'preset', 'documentation', 'quality'],
  },
  {
    id: 'regression-detector',
    basePriority: 76,
    isCore: true,
    availability: READY,
    description: 'Comparative baseline/candidate regression detection preset',
    motivation: 'Detect functional or performance regressions between baseline and candidate states.',
    tags: ['core', 'process', 'preset', 'regression'],
  },
  {
    id: 'onboarding-assistant',
    basePriority: 72,
    isCore: true,
    availability: READY,
    description: 'Guided onboarding preset for codebase orientation and handoff',
    motivation: 'Accelerate onboarding with focused orientation, context, and actionable next steps.',
    tags: ['core', 'process', 'preset', 'onboarding'],
  },
  {
    id: 'release-qualification',
    basePriority: 81,
    isCore: true,
    availability: READY,
    description: 'Release qualification preset for quality gate and evidence synthesis',
    motivation: 'Verify release readiness with strict gates and traceable evidence.',
    tags: ['core', 'process', 'preset', 'release'],
  },
  {
    id: 'dependency-auditor',
    basePriority: 73,
    isCore: true,
    availability: READY,
    description: 'Dependency risk scanning and remediation recommendation preset',
    motivation: 'Identify dependency vulnerabilities and upgrade risks before user impact.',
    tags: ['core', 'process', 'preset', 'dependencies'],
  },

  // Strategic Constructions
  {
    id: 'quality-standards',
    basePriority: 60,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Validates against quality standards',
    motivation: 'Assess work output against explicit quality standards and acceptance bars.',
    tags: ['strategic', 'quality'],
  },
  {
    id: 'work-presets',
    basePriority: 55,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Work preset validation',
    motivation: 'Ensure workflows follow preset gates for consistent engineering quality.',
    tags: ['strategic', 'workflow'],
  },
  {
    id: 'architecture-decisions',
    basePriority: 60,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Architecture decision tracking',
    motivation: 'Preserve architecture rationale so future changes remain coherent and auditable.',
    tags: ['strategic', 'architecture'],
  },
  {
    id: 'testing-strategy',
    basePriority: 65,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Testing strategy assessment',
    motivation: 'Confirm testing strategy covers risk-critical paths with pragmatic depth.',
    tags: ['strategic', 'testing'],
  },
  {
    id: 'operational-excellence',
    basePriority: 50,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Operational excellence assessment',
    motivation: 'Measure operational readiness, resilience, and incident response fitness.',
    tags: ['strategic', 'operations'],
  },
  {
    id: 'developer-experience',
    basePriority: 55,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Developer experience assessment',
    motivation: 'Improve developer throughput by identifying workflow and tooling friction.',
    tags: ['strategic', 'dx'],
  },
  {
    id: 'technical-debt',
    basePriority: 60,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Technical debt tracking',
    motivation: 'Quantify and prioritize debt by risk, cost, and remediation value.',
    tags: ['strategic', 'quality'],
  },
  {
    id: 'knowledge-management',
    basePriority: 50,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Knowledge management assessment',
    motivation: 'Keep institutional knowledge current, discoverable, and actionable for agents.',
    tags: ['strategic', 'knowledge'],
  },

  // Language-specific
  {
    id: 'typescript-patterns',
    languages: ['typescript', 'javascript'],
    basePriority: 70,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'TypeScript/JavaScript patterns and best practices',
    tags: ['language', 'typescript', 'javascript'],
  },
  {
    id: 'python-patterns',
    languages: ['python'],
    basePriority: 70,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Python-specific patterns and best practices',
    tags: ['language', 'python'],
  },
  {
    id: 'rust-patterns',
    languages: ['rust'],
    basePriority: 70,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Rust-specific patterns and best practices',
    tags: ['language', 'rust'],
  },
  {
    id: 'go-patterns',
    languages: ['go'],
    basePriority: 70,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Go-specific patterns and best practices',
    tags: ['language', 'go'],
  },

  // Framework-specific
  {
    id: 'react-components',
    frameworks: ['react', 'next', 'remix', 'gatsby'],
    basePriority: 75,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'React component patterns and hooks',
    tags: ['framework', 'react'],
  },
  {
    id: 'vue-components',
    frameworks: ['vue', 'nuxt'],
    basePriority: 75,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Vue component patterns and composition API',
    tags: ['framework', 'vue'],
  },
  {
    id: 'angular-modules',
    frameworks: ['angular'],
    basePriority: 75,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Angular module and service patterns',
    tags: ['framework', 'angular'],
  },
  {
    id: 'express-routes',
    frameworks: ['express'],
    basePriority: 70,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Express.js routing and middleware patterns',
    tags: ['framework', 'express'],
  },
  {
    id: 'django-views',
    frameworks: ['django'],
    basePriority: 70,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Django views and model patterns',
    tags: ['framework', 'django'],
  },
  {
    id: 'fastapi-endpoints',
    frameworks: ['fastapi'],
    basePriority: 70,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'FastAPI endpoint patterns',
    tags: ['framework', 'fastapi'],
  },

  // Testing-specific
  {
    id: 'jest-testing',
    frameworks: ['jest'],
    basePriority: 70,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Jest testing patterns and mocking',
    tags: ['testing', 'jest'],
  },
  {
    id: 'vitest-testing',
    frameworks: ['vitest'],
    basePriority: 70,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Vitest testing patterns',
    tags: ['testing', 'vitest'],
  },
  {
    id: 'pytest-testing',
    frameworks: ['pytest'],
    basePriority: 70,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Pytest testing patterns and fixtures',
    tags: ['testing', 'pytest'],
  },
  {
    id: 'cypress-e2e',
    frameworks: ['cypress'],
    basePriority: 65,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Cypress end-to-end testing patterns',
    tags: ['testing', 'cypress'],
  },
  {
    id: 'playwright-e2e',
    frameworks: ['playwright'],
    basePriority: 65,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Playwright end-to-end testing patterns',
    tags: ['testing', 'playwright'],
  },
  {
    id: 'patrol-dogfood',
    basePriority: 45,
    isCore: false,
    availability: EXPERIMENTAL,
    description: 'Agent patrol preset for self-dogfooding quality validation',
    tags: ['meta', 'quality', 'dogfood', 'e2e'],
  },
];

export function listConstructableDefinitions(): ConstructableDefinition[] {
  return DEFAULT_CONSTRUCTABLE_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function getConstructableDefinition(id: ConstructableId): ConstructableDefinition | undefined {
  return DEFAULT_CONSTRUCTABLE_DEFINITIONS.find((definition) => definition.id === id);
}

export function getConstructableClassificationMap(): Record<string, ConstructableClassificationFlag> {
  const mapping: Record<string, ConstructableClassificationFlag> = {};
  for (const definition of DEFAULT_CONSTRUCTABLE_DEFINITIONS) {
    if (definition.classificationFlag) {
      mapping[definition.id] = definition.classificationFlag;
    }
  }
  return mapping;
}

export function validateConstructableDefinitions(
  definitions: ConstructableDefinition[] = DEFAULT_CONSTRUCTABLE_DEFINITIONS
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();

  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      errors.push(`duplicate_constructable_id:${definition.id}`);
    }
    ids.add(definition.id);
    if (!definition.description || definition.description.trim().length === 0) {
      warnings.push(`missing_description:${definition.id}`);
    }
    if (definition.isCore) {
      const motivation = definition.motivation?.trim() ?? '';
      if (motivation.length === 0) {
        warnings.push(`missing_motivation:${definition.id}`);
      } else if (motivation.length < MIN_MOTIVATION_LENGTH) {
        warnings.push(`motivation_too_short:${definition.id}`);
      }
    }
    if (!Number.isFinite(definition.basePriority) || definition.basePriority < 0 || definition.basePriority > 100) {
      warnings.push(`priority_out_of_range:${definition.id}`);
    }
    if (definition.availability === 'experimental') {
      warnings.push(`experimental_constructable:${definition.id}`);
    }
    if (definition.availability === 'stub') {
      warnings.push(`stub_constructable:${definition.id}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

type MotivationVector = Map<string, number>;

function tokenizeMotivation(text: string): string[] {
  const normalized = text.toLowerCase().trim();
  if (normalized.length === 0) return [];
  return normalized
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2 && !MOTIVATION_STOP_WORDS.has(token));
}

function toMotivationVector(text: string): MotivationVector {
  const vector: MotivationVector = new Map();
  for (const token of tokenizeMotivation(text)) {
    vector.set(token, (vector.get(token) ?? 0) + 1);
  }
  return vector;
}

function cosineSimilarity(left: MotivationVector, right: MotivationVector): number {
  if (left.size === 0 || right.size === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const value of left.values()) {
    leftNorm += value * value;
  }
  for (const value of right.values()) {
    rightNorm += value * value;
  }
  for (const [token, leftValue] of left.entries()) {
    const rightValue = right.get(token);
    if (rightValue !== undefined) {
      dot += leftValue * rightValue;
    }
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

interface MotivationEntry {
  definition: ConstructableDefinition;
  vector: MotivationVector;
}

class StaticMotivationIndex implements MotivationIndex {
  private readonly entries: MotivationEntry[];

  constructor(definitions: ConstructableDefinition[]) {
    this.entries = definitions
      .filter((definition) => (definition.motivation?.trim().length ?? 0) > 0)
      .map((definition) => ({
        definition: { ...definition },
        vector: toMotivationVector(definition.motivation ?? ''),
      }));
  }

  findBySimilarMotivation(
    motivation: string,
    options: MotivationSimilarityQuery = {}
  ): MotivationSimilarityMatch[] {
    const queryVector = toMotivationVector(motivation);
    if (queryVector.size === 0) return [];

    const minSimilarity = Number.isFinite(options.minSimilarity)
      ? Math.max(0, Math.min(1, Number(options.minSimilarity)))
      : DEFAULT_MOTIVATION_MIN_SIMILARITY;
    const topK = Number.isFinite(options.topK) && Number(options.topK) > 0
      ? Math.floor(Number(options.topK))
      : DEFAULT_MOTIVATION_TOP_K;

    const matches: MotivationSimilarityMatch[] = [];
    for (const entry of this.entries) {
      const similarity = cosineSimilarity(queryVector, entry.vector);
      if (similarity >= minSimilarity) {
        matches.push({
          constructable: { ...entry.definition },
          similarity,
        });
      }
    }

    matches.sort((left, right) => right.similarity - left.similarity);
    return matches.slice(0, topK);
  }
}

export function createMotivationIndex(
  definitions: ConstructableDefinition[] = DEFAULT_CONSTRUCTABLE_DEFINITIONS
): MotivationIndex {
  return new StaticMotivationIndex(definitions);
}

const DEFAULT_MOTIVATION_INDEX = createMotivationIndex(DEFAULT_CONSTRUCTABLE_DEFINITIONS);

export function getConstructableMotivationIndex(): MotivationIndex {
  return DEFAULT_MOTIVATION_INDEX;
}
