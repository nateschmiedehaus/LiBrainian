/**
 * @fileoverview Agent Skills Type Definitions
 *
 * Defines typed structures for Agent Skills - portable procedural knowledge
 * that can be loaded, validated, and exposed as LiBrainian Method Packs.
 *
 * Skill structure:
 * - SKILL.md: Skill definition and documentation
 * - scripts/: Executable scripts
 * - resources/: Supporting resources (templates, examples)
 * - config/: Configuration files
 *
 * @packageDocumentation
 */

// ============================================================================
// SCHEMA VERSION
// ============================================================================

export const SKILLS_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * A complete agent skill definition.
 * Skills are portable procedural knowledge that agents can use.
 */
export interface AgentSkill {
  /** Schema version */
  schemaVersion: string;

  /** Skill identity */
  identity: SkillIdentity;

  /** Skill metadata */
  meta: SkillMetadata;

  /** Skill definition (from SKILL.md) */
  definition: SkillDefinition;

  /** Available scripts */
  scripts: SkillScript[];

  /** Available resources */
  resources: SkillResource[];

  /** Configuration */
  config: SkillConfig;

  /** Validation status */
  validation: SkillValidation;

  /** Cache metadata */
  cache: SkillCacheMetadata;
}

/** Skill identity */
export interface SkillIdentity {
  /** Unique skill ID (directory name or qualified name) */
  id: string;

  /** Skill name (from SKILL.md) */
  name: string;

  /** Skill version (semver) */
  version: string;

  /** Skill namespace (for scoped skills) */
  namespace?: string;

  /** Full qualified name */
  qualifiedName: string;

  /** Skill directory path */
  path: string;

  /** Absolute path */
  absolutePath: string;
}

/** Skill metadata */
export interface SkillMetadata {
  /** Brief description */
  description: string;

  /** Long description */
  longDescription?: string;

  /** Author */
  author?: string;

  /** License */
  license?: string;

  /** Tags/categories */
  tags: string[];

  /** When the skill was created */
  createdAt?: string;

  /** When the skill was last modified */
  modifiedAt: string;

  /** Skill source (local, registry, git) */
  source: SkillSource;
}

/** Skill source type */
export type SkillSource =
  | { type: 'local'; path: string }
  | { type: 'registry'; registry: string; package: string; version: string }
  | { type: 'git'; url: string; ref?: string };

/** Skill definition from SKILL.md */
export interface SkillDefinition {
  /** When to use this skill */
  trigger: SkillTrigger;

  /** Workflow steps */
  workflow: WorkflowStep[];

  /** Required inputs */
  inputs: SkillInput[];

  /** Produced outputs */
  outputs: SkillOutput[];

  /** Dependencies on other skills */
  dependencies: SkillDependency[];

  /** Limitations and caveats */
  limitations?: string[];

  /** Example usage */
  examples?: SkillExample[];
}

/** Skill trigger - when to use this skill */
export interface SkillTrigger {
  /** Task types that match */
  taskTypes?: string[];

  /** Intent patterns that match */
  intentPatterns?: string[];

  /** File patterns that activate this skill */
  filePatterns?: string[];

  /** Repo patterns (monorepo packages, etc.) */
  repoPatterns?: string[];

  /** Priority (higher = prefer this skill) */
  priority?: number;

  /** Condition expression */
  condition?: string;
}

/** Workflow step */
export interface WorkflowStep {
  /** Step ID */
  id: string;

  /** Step name */
  name: string;

  /** Step description */
  description: string;

  /** Step type */
  type: StepType;

  /** Step action */
  action: StepAction;

  /** Dependencies (other step IDs) */
  dependsOn?: string[];

  /** Error handling */
  onError?: 'stop' | 'continue' | 'retry';

  /** Max retries */
  maxRetries?: number;
}

/** Step types */
export type StepType =
  | 'script'       // Run a script
  | 'command'      // Run a shell command
  | 'llm'          // Make an LLM call
  | 'decision'     // Make a decision
  | 'parallel'     // Run steps in parallel
  | 'conditional'  // Conditional execution
  | 'manual';      // Requires human input

/** Step action */
export type StepAction =
  | { type: 'script'; script: string; args?: string[] }
  | { type: 'command'; command: string; cwd?: string }
  | { type: 'llm'; prompt: string; model?: string }
  | { type: 'decision'; condition: string; ifTrue: string; ifFalse: string }
  | { type: 'parallel'; steps: string[] }
  | { type: 'conditional'; condition: string; step: string }
  | { type: 'manual'; instruction: string };

/** Skill input */
export interface SkillInput {
  /** Input name */
  name: string;

  /** Input type */
  type: 'string' | 'number' | 'boolean' | 'file' | 'directory' | 'array' | 'object';

  /** Description */
  description: string;

  /** Required */
  required: boolean;

  /** Default value */
  default?: unknown;

  /** Validation pattern */
  pattern?: string;

  /** Example value */
  example?: unknown;
}

/** Skill output */
export interface SkillOutput {
  /** Output name */
  name: string;

  /** Output type */
  type: 'string' | 'number' | 'boolean' | 'file' | 'directory' | 'array' | 'object';

  /** Description */
  description: string;

  /** Path (for file/directory outputs) */
  path?: string;
}

/** Skill dependency */
export interface SkillDependency {
  /** Dependent skill ID */
  skillId: string;

  /** Version constraint (semver) */
  version?: string;

  /** Optional dependency */
  optional?: boolean;
}

/** Skill example */
export interface SkillExample {
  /** Example name */
  name: string;

  /** Description */
  description?: string;

  /** Input values */
  inputs: Record<string, unknown>;

  /** Expected outputs (for testing) */
  expectedOutputs?: Record<string, unknown>;
}

/** Skill script */
export interface SkillScript {
  /** Script ID */
  id: string;

  /** Script name */
  name: string;

  /** Script path (relative to skill directory) */
  path: string;

  /** Absolute path */
  absolutePath: string;

  /** Script type */
  type: 'bash' | 'node' | 'python' | 'typescript' | 'other';

  /** Description */
  description?: string;

  /** Whether it's executable */
  executable: boolean;

  /** File hash */
  hash: string;
}

/** Skill resource */
export interface SkillResource {
  /** Resource ID */
  id: string;

  /** Resource name */
  name: string;

  /** Resource path (relative to skill directory) */
  path: string;

  /** Absolute path */
  absolutePath: string;

  /** Resource type */
  type: 'template' | 'example' | 'schema' | 'config' | 'data' | 'other';

  /** MIME type */
  mimeType?: string;

  /** File hash */
  hash: string;

  /** File size */
  sizeBytes: number;
}

/** Skill configuration */
export interface SkillConfig {
  /** Timeout for skill execution (ms) */
  timeoutMs?: number;

  /** Max retries */
  maxRetries?: number;

  /** Retry delay (ms) */
  retryDelayMs?: number;

  /** Environment variables */
  env?: Record<string, string>;

  /** Working directory */
  cwd?: string;

  /** Sandbox mode */
  sandbox?: boolean;

  /** Custom config */
  custom?: Record<string, unknown>;
}

/** Skill validation result */
export interface SkillValidation {
  /** Valid */
  valid: boolean;

  /** Validation timestamp */
  validatedAt: string;

  /** Validator version */
  validatorVersion: string;

  /** Errors */
  errors: ValidationIssue[];

  /** Warnings */
  warnings: ValidationIssue[];

  /** Info messages */
  info: ValidationIssue[];
}

/** Validation issue */
export interface ValidationIssue {
  /** Issue code */
  code: string;

  /** Issue message */
  message: string;

  /** Severity */
  severity: 'error' | 'warning' | 'info';

  /** Location (file:line) */
  location?: string;

  /** Suggestion for fix */
  suggestion?: string;
}

/** Skill cache metadata */
export interface SkillCacheMetadata {
  /** When cached */
  cachedAt: string;

  /** Time-to-live (ms) */
  ttlMs: number;

  /** Expires at */
  expiresAt: string;

  /** Content hash for invalidation */
  contentHash: string;

  /** Dependencies hash */
  depsHash: string;

  /** Cache version */
  cacheVersion: string;
}

// ============================================================================
// METHOD PACK ADAPTER TYPES
// ============================================================================

/**
 * Skill exposed as a Method Pack (for LiBrainian integration)
 */
export interface SkillMethodPack {
  /** Method pack ID */
  id: string;

  /** Source skill */
  skillId: string;

  /** Method families this skill contributes to */
  families: string[];

  /** Use case IDs this skill addresses */
  ucIds: string[];

  /** Hints for when to use */
  hints: string[];

  /** Steps (from workflow) */
  steps: string[];

  /** Required inputs */
  requiredInputs: string[];

  /** Confidence */
  confidence: number;

  /** When generated */
  generatedAt: string;

  /** Evidence trace */
  evidence: SkillMethodPackEvidence;
}

/** Evidence for skill method pack */
export interface SkillMethodPackEvidence {
  /** Skill source */
  source: SkillSource;

  /** Skill version */
  version: string;

  /** Validation status */
  validated: boolean;

  /** Content hash */
  contentHash: string;

  /** When skill was last modified */
  skillModifiedAt: string;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/** Create an empty skill validation result */
export function createEmptyValidation(): SkillValidation {
  return {
    valid: true,
    validatedAt: new Date().toISOString(),
    validatorVersion: SKILLS_SCHEMA_VERSION,
    errors: [],
    warnings: [],
    info: [],
  };
}

/** Create skill cache metadata with TTL */
export function createCacheMetadata(ttlMs: number, contentHash: string, depsHash: string): SkillCacheMetadata {
  const now = Date.now();
  return {
    cachedAt: new Date(now).toISOString(),
    ttlMs,
    expiresAt: new Date(now + ttlMs).toISOString(),
    contentHash,
    depsHash,
    cacheVersion: SKILLS_SCHEMA_VERSION,
  };
}

/** Check if cache is expired */
export function isCacheExpired(cache: SkillCacheMetadata): boolean {
  return new Date(cache.expiresAt).getTime() < Date.now();
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/** Type guard for AgentSkill */
export function isAgentSkill(value: unknown): value is AgentSkill {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.schemaVersion === 'string' &&
    typeof obj.identity === 'object' &&
    typeof obj.meta === 'object' &&
    typeof obj.definition === 'object' &&
    Array.isArray(obj.scripts) &&
    Array.isArray(obj.resources)
  );
}

/** Type guard for SkillIdentity */
export function isSkillIdentity(value: unknown): value is SkillIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.version === 'string' &&
    typeof obj.qualifiedName === 'string' &&
    typeof obj.path === 'string'
  );
}

/** Type guard for SkillDefinition */
export function isSkillDefinition(value: unknown): value is SkillDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.trigger === 'object' &&
    Array.isArray(obj.workflow) &&
    Array.isArray(obj.inputs) &&
    Array.isArray(obj.outputs)
  );
}

/** Type guard for SkillValidation */
export function isSkillValidation(value: unknown): value is SkillValidation {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.valid === 'boolean' &&
    typeof obj.validatedAt === 'string' &&
    Array.isArray(obj.errors) &&
    Array.isArray(obj.warnings)
  );
}

/** Type guard for SkillMethodPack */
export function isSkillMethodPack(value: unknown): value is SkillMethodPack {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.skillId === 'string' &&
    Array.isArray(obj.families) &&
    Array.isArray(obj.hints) &&
    Array.isArray(obj.steps)
  );
}
