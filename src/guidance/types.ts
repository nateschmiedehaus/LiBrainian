/**
 * @fileoverview AGENTS.md Parser Types
 *
 * Defines typed structures for parsed AGENTS.md content (AgentGuidancePack).
 * Supports AGENTS.md, CLAUDE.md, CODEX.md, and other agent-specific variants.
 *
 * Key concepts:
 * - AgentGuidancePack: Complete parsed guidance for a path
 * - Precedence rules: Deterministic resolution for nested monorepos
 * - Sections: Structured extraction of mission, rules, commands, constraints
 *
 * @packageDocumentation
 */

// ============================================================================
// SCHEMA VERSION
// ============================================================================

export const GUIDANCE_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Complete agent guidance pack parsed from AGENTS.md and variants.
 * This is the primary output of the AGENTS.md parser.
 */
export interface AgentGuidancePack {
  /** Schema version for forward compatibility */
  schemaVersion: string;

  /** Source files that contributed to this pack */
  sources: GuidanceSource[];

  /** Effective path this guidance applies to */
  effectivePath: string;

  /** Workspace root */
  workspaceRoot: string;

  /** Mission and philosophy section */
  mission: MissionSection;

  /** Build/test/lint commands */
  commands: CommandsSection;

  /** Repo rules and policies */
  rules: RulesSection;

  /** Safety constraints */
  safety: SafetySection;

  /** Agent-specific guidance */
  agentSpecific: AgentSpecificSection;

  /** Code quality patterns */
  codeQuality: CodeQualitySection;

  /** Testing policy */
  testing: TestingSection;

  /** Integration points */
  integrations: IntegrationsSection;

  /** Raw sections that weren't parsed into structured types */
  rawSections: RawSection[];

  /** Parse metadata */
  meta: GuidanceMetadata;
}

/** Source of guidance information */
export interface GuidanceSource {
  /** File path (relative to workspace) */
  path: string;

  /** Absolute file path */
  absolutePath: string;

  /** File type */
  type: GuidanceFileType;

  /** Directory depth from workspace root */
  depth: number;

  /** Priority (lower = higher priority per precedence rules) */
  priority: number;

  /** File hash for change detection */
  hash: string;

  /** Last modified timestamp */
  lastModified: string;
}

/** Types of guidance files */
export type GuidanceFileType =
  | 'AGENTS.md'
  | 'CLAUDE.md'
  | 'CODEX.md'
  | 'GEMINI.md'
  | 'COPILOT.md'
  | 'AI.md'
  | 'CONTRIBUTING.md'
  | 'custom';

// ============================================================================
// SECTION TYPES
// ============================================================================

/** Mission and philosophy section */
export interface MissionSection {
  /** Main mission statement */
  mission?: string;

  /** Core philosophy/principles */
  philosophy?: string[];

  /** "About this document" section */
  about?: string;

  /** Key goals */
  goals?: string[];

  /** What to avoid (the "enemy") */
  avoids?: string[];
}

/** Build/test/lint commands section */
export interface CommandsSection {
  /** Build command */
  build?: CommandDefinition;

  /** Test commands (by tier or type) */
  test?: Record<string, CommandDefinition>;

  /** Lint command */
  lint?: CommandDefinition;

  /** Format command */
  format?: CommandDefinition;

  /** Type check command */
  typecheck?: CommandDefinition;

  /** Install/setup command */
  install?: CommandDefinition;

  /** Clean command */
  clean?: CommandDefinition;

  /** Custom commands */
  custom?: Record<string, CommandDefinition>;

  /** Canonical commands (from config/canon.json if present) */
  canonical?: Record<string, string>;
}

/** Command definition */
export interface CommandDefinition {
  /** The command to run */
  command: string;

  /** Description of what it does */
  description?: string;

  /** Required prerequisites */
  prerequisites?: string[];

  /** Expected outputs */
  outputs?: string[];

  /** Timeout in ms (0 = no timeout) */
  timeoutMs?: number;

  /** Environment variables */
  env?: Record<string, string>;

  /** Working directory override */
  cwd?: string;
}

/** Repo rules and policies section */
export interface RulesSection {
  /** Commit message format */
  commitFormat?: CommitFormatRule;

  /** File naming conventions */
  fileNaming?: FileNamingRule[];

  /** Import/export rules */
  imports?: ImportRule[];

  /** Documentation requirements */
  documentation?: DocumentationRule[];

  /** Size limits */
  sizeLimits?: SizeLimitRule[];

  /** General rules */
  general?: string[];
}

/** Commit format rule */
export interface CommitFormatRule {
  /** Pattern/format */
  format: string;

  /** Allowed types */
  types?: string[];

  /** Required fields */
  required?: string[];

  /** Example */
  example?: string;
}

/** File naming rule */
export interface FileNamingRule {
  /** Glob pattern for files this applies to */
  pattern: string;

  /** Naming convention */
  convention: 'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case' | 'SCREAMING_SNAKE_CASE';

  /** Exception patterns */
  exceptions?: string[];
}

/** Import rule */
export interface ImportRule {
  /** Rule type */
  type: 'no-relative' | 'prefer-relative' | 'no-circular' | 'explicit-exports' | 'custom';

  /** Rule description */
  description: string;

  /** Patterns this applies to */
  patterns?: string[];
}

/** Documentation rule */
export interface DocumentationRule {
  /** What requires documentation */
  target: 'public-api' | 'functions' | 'classes' | 'exports' | 'all';

  /** Required format */
  format?: 'jsdoc' | 'tsdoc' | 'markdown';

  /** Required sections */
  requiredSections?: string[];
}

/** Size limit rule */
export interface SizeLimitRule {
  /** What this limit applies to */
  target: 'file' | 'function' | 'class' | 'module';

  /** Max lines */
  maxLines: number;

  /** Type (target/hard limit) */
  type: 'target' | 'hard';

  /** Exception patterns */
  exceptions?: string[];
}

/** Safety constraints section */
export interface SafetySection {
  /** Forbidden patterns */
  forbidden: ForbiddenPattern[];

  /** Required patterns */
  required: RequiredPattern[];

  /** Auth/credential rules */
  auth: AuthRule[];

  /** Network access rules */
  network: NetworkRule[];

  /** File access rules */
  fileAccess: FileAccessRule[];
}

/** Forbidden pattern */
export interface ForbiddenPattern {
  /** Pattern (regex or literal) */
  pattern: string;

  /** Whether it's a regex */
  isRegex: boolean;

  /** Severity */
  severity: 'error' | 'warning';

  /** Reason it's forbidden */
  reason: string;

  /** Context where it's forbidden */
  context?: string;

  /** Exception conditions */
  exceptions?: string[];
}

/** Required pattern */
export interface RequiredPattern {
  /** What must be present */
  pattern: string;

  /** Where it must be present */
  scope: 'file' | 'function' | 'module' | 'project';

  /** Condition */
  condition?: string;

  /** Reason */
  reason: string;
}

/** Auth rule */
export interface AuthRule {
  /** Rule type */
  type: 'cli-only' | 'no-api-keys' | 'no-browser' | 'no-credentials';

  /** Description */
  description: string;

  /** Guidance */
  guidance?: string;
}

/** Network access rule */
export interface NetworkRule {
  /** Allowed domains */
  allowedDomains?: string[];

  /** Blocked domains */
  blockedDomains?: string[];

  /** Requires approval */
  requiresApproval?: boolean;

  /** Logging required */
  loggingRequired?: boolean;
}

/** File access rule */
export interface FileAccessRule {
  /** Patterns that are read-only */
  readOnly?: string[];

  /** Patterns that are forbidden */
  forbidden?: string[];

  /** Patterns that are trackable */
  trackable?: string[];
}

/** Agent-specific guidance section */
export interface AgentSpecificSection {
  /** Agent name this applies to */
  agent?: string;

  /** Role description */
  role?: string;

  /** Superpowers/strengths */
  superpowers?: string[];

  /** Duties/responsibilities */
  duties?: string[];

  /** Protocols to follow */
  protocols?: Protocol[];

  /** Quick reference */
  quickReference?: Record<string, string>;
}

/** Protocol definition */
export interface Protocol {
  /** Protocol name */
  name: string;

  /** When to use */
  trigger: string;

  /** Steps */
  steps: string[];

  /** Example */
  example?: string;
}

/** Code quality section */
export interface CodeQualitySection {
  /** Anti-slop patterns */
  antiSlop: AntiSlopPattern[];

  /** Code elegance principles */
  elegance?: string[];

  /** Complexity limits */
  complexity?: ComplexityRule[];

  /** Type safety rules */
  typeSafety?: string[];
}

/** Anti-slop pattern */
export interface AntiSlopPattern {
  /** Pattern name */
  name: string;

  /** Pattern description */
  description: string;

  /** Detection pattern */
  detection?: string;

  /** Fix/action */
  action: string;
}

/** Complexity rule */
export interface ComplexityRule {
  /** Metric */
  metric: 'cyclomatic' | 'cognitive' | 'nesting' | 'lines';

  /** Target value */
  target: number;

  /** Hard limit */
  max?: number;
}

/** Testing section */
export interface TestingSection {
  /** Testing philosophy */
  philosophy?: string;

  /** Test tiers */
  tiers?: TestTier[];

  /** Required coverage */
  coverage?: CoverageRequirement;

  /** Live provider policy */
  liveProviderPolicy?: string;

  /** Mock policy */
  mockPolicy?: string;
}

/** Test tier */
export interface TestTier {
  /** Tier name (e.g., "tier0", "tier2") */
  name: string;

  /** Description */
  description: string;

  /** Command */
  command: string;

  /** When to run */
  when: 'ci' | 'pre-commit' | 'pre-push' | 'manual';

  /** Requirements */
  requirements?: string[];
}

/** Coverage requirement */
export interface CoverageRequirement {
  /** Minimum line coverage */
  lines?: number;

  /** Minimum branch coverage */
  branches?: number;

  /** Minimum function coverage */
  functions?: number;
}

/** Integrations section */
export interface IntegrationsSection {
  /** MCP integration */
  mcp?: MCPIntegration;

  /** LiBrainian integration */
  librainian?: LiBrainianIntegration;

  /** External tools */
  tools?: ToolIntegration[];
}

/** MCP integration config */
export interface MCPIntegration {
  /** Enabled */
  enabled: boolean;

  /** Server config path */
  configPath?: string;

  /** Allowed tools */
  allowedTools?: string[];
}

/** LiBrainian integration config */
export interface LiBrainianIntegration {
  /** Enabled */
  enabled: boolean;

  /** Entry point doc */
  entryPoint?: string;

  /** Config paths */
  configPaths?: string[];
}

/** Tool integration */
export interface ToolIntegration {
  /** Tool name */
  name: string;

  /** Tool type */
  type: string;

  /** Config */
  config?: Record<string, unknown>;
}

/** Raw section that wasn't parsed */
export interface RawSection {
  /** Section heading */
  heading: string;

  /** Heading level */
  level: number;

  /** Raw content */
  content: string;

  /** Source file */
  source: string;
}

/** Parse metadata */
export interface GuidanceMetadata {
  /** When parsed */
  parsedAt: string;

  /** Parser version */
  parserVersion: string;

  /** Parse duration ms */
  durationMs: number;

  /** Number of sources */
  sourceCount: number;

  /** Total sections found */
  sectionCount: number;

  /** Parse warnings */
  warnings: ParseWarning[];

  /** Parse errors (non-fatal) */
  errors: ParseError[];
}

/** Parse warning */
export interface ParseWarning {
  /** Source file */
  source: string;

  /** Line number */
  line?: number;

  /** Warning message */
  message: string;

  /** Warning code */
  code: string;
}

/** Parse error (non-fatal) */
export interface ParseError {
  /** Source file */
  source: string;

  /** Line number */
  line?: number;

  /** Error message */
  message: string;

  /** Error code */
  code: string;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/** Create an empty AgentGuidancePack */
export function createEmptyGuidancePack(
  workspaceRoot: string,
  effectivePath: string
): AgentGuidancePack {
  const now = new Date().toISOString();
  return {
    schemaVersion: GUIDANCE_SCHEMA_VERSION,
    sources: [],
    effectivePath,
    workspaceRoot,
    mission: {},
    commands: {},
    rules: {},
    safety: {
      forbidden: [],
      required: [],
      auth: [],
      network: [],
      fileAccess: [],
    },
    agentSpecific: {},
    codeQuality: {
      antiSlop: [],
    },
    testing: {},
    integrations: {},
    rawSections: [],
    meta: {
      parsedAt: now,
      parserVersion: GUIDANCE_SCHEMA_VERSION,
      durationMs: 0,
      sourceCount: 0,
      sectionCount: 0,
      warnings: [],
      errors: [],
    },
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/** Type guard for AgentGuidancePack */
export function isAgentGuidancePack(value: unknown): value is AgentGuidancePack {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.schemaVersion === 'string' &&
    Array.isArray(obj.sources) &&
    typeof obj.effectivePath === 'string' &&
    typeof obj.workspaceRoot === 'string' &&
    typeof obj.mission === 'object' &&
    typeof obj.commands === 'object' &&
    typeof obj.meta === 'object'
  );
}

/** Type guard for GuidanceSource */
export function isGuidanceSource(value: unknown): value is GuidanceSource {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.path === 'string' &&
    typeof obj.absolutePath === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.depth === 'number' &&
    typeof obj.priority === 'number'
  );
}

/** Type guard for CommandDefinition */
export function isCommandDefinition(value: unknown): value is CommandDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.command === 'string';
}
