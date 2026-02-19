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

const READY: ConstructableAvailability = 'ready';
const EXPERIMENTAL: ConstructableAvailability = 'experimental';

export const DEFAULT_CONSTRUCTABLE_DEFINITIONS: ConstructableDefinition[] = [
  // Core Constructions - always evaluated
  {
    id: 'refactoring-safety-checker',
    basePriority: 90,
    isCore: true,
    availability: READY,
    classificationFlag: 'isRefactoringSafetyQuery',
    description: 'Ensures refactoring operations are safe across all languages',
    tags: ['core', 'refactor'],
  },
  {
    id: 'bug-investigation-assistant',
    basePriority: 85,
    isCore: true,
    availability: READY,
    classificationFlag: 'isBugInvestigationQuery',
    description: 'Assists with bug investigation using code analysis',
    tags: ['core', 'debug'],
  },
  {
    id: 'feature-location-advisor',
    basePriority: 80,
    isCore: true,
    availability: READY,
    classificationFlag: 'isFeatureLocationQuery',
    description: 'Helps locate features in the codebase',
    tags: ['core', 'navigation'],
  },
  {
    id: 'code-quality-reporter',
    basePriority: 75,
    isCore: true,
    availability: READY,
    classificationFlag: 'isCodeQualityQuery',
    description: 'Reports on code quality metrics',
    tags: ['core', 'quality'],
  },
  {
    id: 'architecture-verifier',
    basePriority: 70,
    isCore: true,
    availability: READY,
    classificationFlag: 'isArchitectureVerificationQuery',
    description: 'Verifies architecture rules and boundaries',
    tags: ['core', 'architecture'],
  },
  {
    id: 'security-audit-helper',
    basePriority: 85,
    isCore: true,
    availability: READY,
    classificationFlag: 'isSecurityAuditQuery',
    description: 'Assists with security audits and vulnerability detection',
    tags: ['core', 'security'],
  },
  {
    id: 'skill-audit-construction',
    basePriority: 88,
    isCore: true,
    availability: READY,
    classificationFlag: 'isSecurityAuditQuery',
    description: 'Audits SKILL.md content for malicious or suspicious behavior',
    tags: ['core', 'security', 'skills'],
  },
  {
    id: 'comprehensive-quality-construction',
    basePriority: 65,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Comprehensive code quality assessment',
    tags: ['quality'],
  },

  // Strategic Constructions
  {
    id: 'quality-standards',
    basePriority: 60,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Validates against quality standards',
    tags: ['strategic', 'quality'],
  },
  {
    id: 'work-presets',
    basePriority: 55,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Work preset validation',
    tags: ['strategic', 'workflow'],
  },
  {
    id: 'architecture-decisions',
    basePriority: 60,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Architecture decision tracking',
    tags: ['strategic', 'architecture'],
  },
  {
    id: 'testing-strategy',
    basePriority: 65,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Testing strategy assessment',
    tags: ['strategic', 'testing'],
  },
  {
    id: 'operational-excellence',
    basePriority: 50,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Operational excellence assessment',
    tags: ['strategic', 'operations'],
  },
  {
    id: 'developer-experience',
    basePriority: 55,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Developer experience assessment',
    tags: ['strategic', 'dx'],
  },
  {
    id: 'technical-debt',
    basePriority: 60,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Technical debt tracking',
    tags: ['strategic', 'quality'],
  },
  {
    id: 'knowledge-management',
    basePriority: 50,
    isCore: true,
    availability: EXPERIMENTAL,
    description: 'Knowledge management assessment',
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
