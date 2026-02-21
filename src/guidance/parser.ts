/**
 * @fileoverview AGENTS.md Parser
 *
 * Parses AGENTS.md, CLAUDE.md, and other agent guidance files into
 * structured AgentGuidancePack objects.
 *
 * Supports:
 * - Standard section headers (# Mission, ## Commands, etc.)
 * - Code blocks for commands and patterns
 * - Nested bullet lists for rules and configurations
 * - Frontmatter metadata (optional)
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';
import {
  GUIDANCE_SCHEMA_VERSION,
  createEmptyGuidancePack,
  type AgentGuidancePack,
  type GuidanceSource,
  type MissionSection,
  type CommandsSection,
  type CommandDefinition,
  type RulesSection,
  type SafetySection,
  type ForbiddenPattern,
  type RequiredPattern,
  type AuthRule,
  type FileAccessRule,
  type AgentSpecificSection,
  type Protocol,
  type CodeQualitySection,
  type AntiSlopPattern,
  type ComplexityRule,
  type TestingSection,
  type TestTier,
  type IntegrationsSection,
  type RawSection,
  type ParseWarning,
  type ParseError,
} from './types.js';
import { getFileType, calculatePriority, calculateDepth } from './precedence.js';

// ============================================================================
// PARSER CONFIGURATION
// ============================================================================

/** Parser configuration options */
export interface ParserConfig {
  /** Whether to extract frontmatter */
  extractFrontmatter: boolean;

  /** Whether to preserve raw section content */
  preserveRawSections: boolean;

  /** Whether to validate parsed content */
  validate: boolean;

  /** Custom section header patterns */
  sectionPatterns?: Record<string, RegExp>;
}

/** Default parser configuration */
export const DEFAULT_PARSER_CONFIG: ParserConfig = {
  extractFrontmatter: true,
  preserveRawSections: true,
  validate: true,
};

// ============================================================================
// SECTION PATTERNS
// ============================================================================

/** Standard section header patterns - tested against header text without # */
const SECTION_PATTERNS = {
  mission: /^(?:mission|purpose|overview|about)\b/i,
  commands: /^(?:commands|scripts|cli|actions)\b/i,
  rules: /^(?:rules|guidelines|standards|conventions)\b/i,
  safety: /^(?:safety|security)\b/i,  // Don't match "forbidden" as a main section
  agentSpecific: /^(?:agent[- ]?specific|claude(?:[- ]?specific)?|codex(?:[- ]?(?:specific|agent))?|gemini(?:[- ]?specific)?|copilot(?:[- ]?specific)?)\b/i,
  codeQuality: /^(?:code[- ]?quality|anti[- ]?slop)\b/i,  // Don't match plain "quality" or "style"
  testing: /^(?:testing|tests|test[- ]?requirements)\b/i,
  integrations: /^(?:integrations|tools)\b/i,  // Don't match plain "mcp" or "librainian"
};

/** Code block pattern */
const CODE_BLOCK_PATTERN = /```(\w*)\n([\s\S]*?)```/g;

/** Command definition pattern: `command-name` - description */
const COMMAND_PATTERN = /^[*-]\s*`([^`]+)`\s*[-:]\s*(.+)$/;

/** Frontmatter pattern */
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n/;

// ============================================================================
// PARSER
// ============================================================================

/** Parse result with pack and diagnostics */
export interface ParseResult {
  pack: AgentGuidancePack;
  warnings: ParseWarning[];
  errors: ParseError[];
}

/** Internal section representation during parsing */
interface InternalSection {
  header: string;
  level: number;
  content: string;
  startLine: number;
  endLine: number;
}

/**
 * Parse an AGENTS.md or similar guidance file.
 */
export function parseGuidanceFile(
  content: string,
  source: GuidanceSource,
  config: ParserConfig = DEFAULT_PARSER_CONFIG
): ParseResult {
  const startTime = Date.now();
  const warnings: ParseWarning[] = [];
  const errors: ParseError[] = [];

  // Extract workspace root from absolute path
  const pathParts = source.absolutePath.split('/');
  const sourcePathParts = source.path.split('/').filter(Boolean);
  const workspaceRoot =
    pathParts.slice(0, pathParts.length - sourcePathParts.length).join('/') || '/';
  const effectivePath = source.absolutePath.replace(/\/[^/]+$/, '');

  const pack = createEmptyGuidancePack(workspaceRoot, effectivePath);

  // Set source information
  pack.sources = [source];
  pack.schemaVersion = GUIDANCE_SCHEMA_VERSION;

  // Extract frontmatter if present
  let mainContent = content;
  if (config.extractFrontmatter) {
    const frontmatterMatch = content.match(FRONTMATTER_PATTERN);
    if (frontmatterMatch) {
      try {
        const frontmatter = parseFrontmatter(frontmatterMatch[1]);
        applyFrontmatter(pack, frontmatter);
        mainContent = content.slice(frontmatterMatch[0].length);
      } catch (e) {
        warnings.push({
          code: 'PARSE_FRONTMATTER_ERROR',
          message: `Failed to parse frontmatter: ${e}`,
          source: source.path,
          line: 1,
        });
      }
    }
  }

  // Split into sections
  const sections = splitIntoSections(mainContent);
  let sectionCount = 0;

  // Parse each section
  for (const section of sections) {
    try {
      const parsed = parseSection(section, source.path, config);
      if (parsed.type && parsed.content) {
        applySectionToPack(pack, parsed.type, parsed.content, warnings, source.path);
        sectionCount++;
      }

      // Store raw section if configured
      if (config.preserveRawSections) {
        pack.rawSections.push({
          heading: section.header,
          level: section.level,
          content: section.content.trim(),
          source: source.path,
        });
      }
    } catch (e) {
      errors.push({
        code: 'PARSE_SECTION_ERROR',
        message: `Failed to parse section "${section.header}": ${e}`,
        source: source.path,
        line: section.startLine,
      });
    }
  }

  // Update metadata
  const durationMs = Date.now() - startTime;
  pack.meta.parsedAt = new Date().toISOString();
  pack.meta.parserVersion = GUIDANCE_SCHEMA_VERSION;
  pack.meta.durationMs = durationMs;
  pack.meta.sourceCount = 1;
  pack.meta.sectionCount = sectionCount;
  pack.meta.warnings = warnings;
  pack.meta.errors = errors;

  // Validate if configured
  if (config.validate) {
    const validationErrors = validatePack(pack, source.path);
    for (const err of validationErrors) {
      errors.push(err);
    }
  }

  return { pack, warnings, errors };
}

/**
 * Parse frontmatter YAML-like content.
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      // Try to parse as JSON, fallback to string
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = value.trim();
      }
    }
  }

  return result;
}

/**
 * Apply frontmatter values to the pack.
 */
function applyFrontmatter(pack: AgentGuidancePack, frontmatter: Record<string, unknown>): void {
  if (frontmatter.version) {
    pack.schemaVersion = String(frontmatter.version);
  }
  if (frontmatter.priority && typeof frontmatter.priority === 'number') {
    if (pack.sources[0]) {
      pack.sources[0].priority = frontmatter.priority;
    }
  }
}

// ============================================================================
// SECTION SPLITTING
// ============================================================================

/**
 * Check if a header text matches any recognized section pattern.
 */
function isRecognizedSection(headerText: string): boolean {
  return Object.values(SECTION_PATTERNS).some((pattern) => pattern.test(headerText));
}

/**
 * Split content into sections based on markdown headers.
 * Only splits on headers that match recognized section patterns.
 * Subsection headers are kept as content within their parent section.
 */
function splitIntoSections(content: string): InternalSection[] {
  const sections: InternalSection[] = [];
  const lines = content.split('\n');

  let currentSection: InternalSection | null = null;
  let lineNum = 1;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headerMatch) {
      const headerText = headerMatch[2].trim();
      const isMainSection = isRecognizedSection(headerText);

      if (isMainSection) {
        // Save previous section
        if (currentSection) {
          currentSection.endLine = lineNum - 1;
          sections.push(currentSection);
        }

        // Start new section
        currentSection = {
          header: headerText,
          level: headerMatch[1].length,
          content: '',
          startLine: lineNum,
          endLine: lineNum,
        };
      } else if (currentSection) {
        // Keep subsection headers as content
        currentSection.content += line + '\n';
      }
    } else if (currentSection) {
      currentSection.content += line + '\n';
    }

    lineNum++;
  }

  // Save last section
  if (currentSection) {
    currentSection.endLine = lineNum - 1;
    sections.push(currentSection);
  }

  return sections;
}

// ============================================================================
// SECTION PARSING
// ============================================================================

interface ParsedSection {
  type: string | null;
  content: unknown;
}

/**
 * Parse a section based on its header.
 */
function parseSection(
  section: InternalSection,
  sourcePath: string,
  config: ParserConfig
): ParsedSection {
  const patterns = config.sectionPatterns ?? SECTION_PATTERNS;
  let sectionType: string | null = null;
  let parsedContent: unknown = null;

  // Determine section type
  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(section.header)) {
      sectionType = type;
      break;
    }
  }

  // Parse based on type
  if (sectionType) {
    switch (sectionType) {
      case 'mission':
        parsedContent = parseMissionSection(section);
        break;
      case 'commands':
        parsedContent = parseCommandsSection(section, sourcePath);
        break;
      case 'rules':
        parsedContent = parseRulesSection(section);
        break;
      case 'safety':
        parsedContent = parseSafetySection(section);
        break;
      case 'agentSpecific':
        parsedContent = parseAgentSpecificSection(section);
        break;
      case 'codeQuality':
        parsedContent = parseCodeQualitySection(section);
        break;
      case 'testing':
        parsedContent = parseTestingSection(section);
        break;
      case 'integrations':
        parsedContent = parseIntegrationsSection(section);
        break;
    }
  }

  return {
    type: sectionType,
    content: parsedContent,
  };
}

/**
 * Parse mission/purpose section.
 */
function parseMissionSection(section: InternalSection): MissionSection {
  const lines = section.content.trim().split('\n');
  const goals: string[] = [];
  const avoids: string[] = [];
  const philosophy: string[] = [];
  let mission: string | undefined;
  let about: string | undefined;

  let currentList: 'goals' | 'avoids' | 'philosophy' | 'about' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect subsection headers
    if (/^#+\s*goals?/i.test(trimmed) || /goals?:/i.test(trimmed)) {
      currentList = 'goals';
      continue;
    }
    if (
      /^#+\s*(?:avoid|enemy|don't)/i.test(trimmed) ||
      /(?:avoid|enemy|don't):/i.test(trimmed)
    ) {
      currentList = 'avoids';
      continue;
    }
    if (/^#+\s*philosophy/i.test(trimmed) || /philosophy:/i.test(trimmed)) {
      currentList = 'philosophy';
      continue;
    }
    if (/^#+\s*about/i.test(trimmed) || /about:/i.test(trimmed)) {
      currentList = 'about';
      continue;
    }

    // Parse list items
    const listMatch = trimmed.match(/^[*-]\s+(.+)$/);
    if (listMatch) {
      const item = listMatch[1];
      if (currentList === 'goals') {
        goals.push(item);
      } else if (currentList === 'avoids') {
        avoids.push(item);
      } else if (currentList === 'philosophy') {
        philosophy.push(item);
      } else {
        // Default to goals
        goals.push(item);
      }
    } else if (trimmed && !currentList && !mission) {
      // First non-empty line is the mission statement
      mission = trimmed;
    } else if (currentList === 'about' && trimmed) {
      about = about ? about + ' ' + trimmed : trimmed;
    }
  }

  const result: MissionSection = {};
  if (mission) result.mission = mission;
  if (philosophy.length > 0) result.philosophy = philosophy;
  if (about) result.about = about;
  if (goals.length > 0) result.goals = goals;
  if (avoids.length > 0) result.avoids = avoids;

  return result;
}

/**
 * Parse commands section.
 */
function parseCommandsSection(section: InternalSection, _sourcePath: string): CommandsSection {
  const result: CommandsSection = {};
  const customCommands: Record<string, CommandDefinition> = {};
  const lines = section.content.trim().split('\n');

  let currentCategory: 'build' | 'test' | 'lint' | 'format' | 'typecheck' | 'install' | 'clean' | 'custom' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect command category headers
    if (/build/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'build';
      continue;
    }
    if (/test/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'test';
      continue;
    }
    if (/lint/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'lint';
      continue;
    }
    if (/format/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'format';
      continue;
    }
    if (/type[- ]?check/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'typecheck';
      continue;
    }
    if (/install|setup/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'install';
      continue;
    }
    if (/clean/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'clean';
      continue;
    }

    // Parse command definitions
    const match = line.match(COMMAND_PATTERN);
    if (match) {
      const [, name, description] = match;
      const cmdDef: CommandDefinition = {
        command: name,
        description,
      };

      if (currentCategory === 'build') {
        result.build = cmdDef;
      } else if (currentCategory === 'lint') {
        result.lint = cmdDef;
      } else if (currentCategory === 'format') {
        result.format = cmdDef;
      } else if (currentCategory === 'typecheck') {
        result.typecheck = cmdDef;
      } else if (currentCategory === 'install') {
        result.install = cmdDef;
      } else if (currentCategory === 'clean') {
        result.clean = cmdDef;
      } else if (currentCategory === 'test') {
        result.test = result.test ?? {};
        result.test[name] = cmdDef;
      } else {
        customCommands[name] = cmdDef;
      }
    }
  }

  // Extract code blocks as examples/commands
  const codeBlocks = [...section.content.matchAll(CODE_BLOCK_PATTERN)];
  for (const block of codeBlocks) {
    const [, lang, code] = block;
    const cmd = code.trim();
    if (lang === 'bash' || lang === 'sh' || lang === '') {
      // Try to categorize based on content
      if (/build/i.test(cmd) && !result.build) {
        result.build = { command: cmd };
      } else if (/test/i.test(cmd) && !result.test) {
        result.test = { default: { command: cmd } };
      } else if (/lint/i.test(cmd) && !result.lint) {
        result.lint = { command: cmd };
      }
    }
  }

  if (Object.keys(customCommands).length > 0) {
    result.custom = customCommands;
  }

  return result;
}

/**
 * Parse rules section.
 */
function parseRulesSection(section: InternalSection): RulesSection {
  const result: RulesSection = {
    general: [],
  };

  const lines = section.content.trim().split('\n');
  let currentCategory: 'commitFormat' | 'fileNaming' | 'imports' | 'documentation' | 'sizeLimits' | 'general' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const isListItem = /^[*-]\s/.test(trimmed);

    // Detect subcategories (including markdown headers like ### Commit Format)
    // Skip detection for list items
    if (!isListItem) {
      if (/^#{1,4}\s*commit/i.test(trimmed) || (/commit/i.test(trimmed) && /format|message|style/i.test(trimmed))) {
        currentCategory = 'commitFormat';
        continue;
      }
      if (/^#{1,4}\s*file/i.test(trimmed) || /file.*naming|naming.*convention/i.test(trimmed)) {
        currentCategory = 'fileNaming';
        continue;
      }
      if (/^#{1,4}\s*import/i.test(trimmed) || /import|require|module/i.test(trimmed)) {
        currentCategory = 'imports';
        continue;
      }
      if (/^#{1,4}\s*doc/i.test(trimmed) || /doc|comment|jsdoc/i.test(trimmed)) {
        currentCategory = 'documentation';
        continue;
      }
      if (/^#{1,4}\s*size/i.test(trimmed) || /size|limit|max|line/i.test(trimmed)) {
        currentCategory = 'sizeLimits';
        continue;
      }
    }

    // Parse list items
    const listMatch = trimmed.match(/^[*-]\s+(.+)$/);
    if (listMatch) {
      const item = listMatch[1];

      switch (currentCategory) {
        case 'commitFormat':
          if (!result.commitFormat) {
            result.commitFormat = {
              format: item,
              required: ['type', 'subject'],
            };
          } else {
            result.commitFormat.example = item;
          }
          break;
        case 'fileNaming':
          result.fileNaming = result.fileNaming ?? [];
          result.fileNaming.push({
            pattern: '*',
            convention: detectNamingConvention(item),
          });
          break;
        case 'imports':
          result.imports = result.imports ?? [];
          result.imports.push({
            type: detectImportRuleType(item),
            description: item,
          });
          break;
        case 'documentation':
          result.documentation = result.documentation ?? [];
          result.documentation.push({
            target: 'public-api',
            format: 'jsdoc',
            requiredSections: [item],
          });
          break;
        case 'sizeLimits': {
          const match = item.match(/(\d+)/);
          result.sizeLimits = result.sizeLimits ?? [];
          result.sizeLimits.push({
            target: 'file',
            maxLines: match ? parseInt(match[1], 10) : 500,
            type: item.toLowerCase().includes('hard') ? 'hard' : 'target',
          });
          break;
        }
        default:
          result.general?.push(item);
      }
    }
  }

  return result;
}

/**
 * Detect naming convention from description.
 */
function detectNamingConvention(desc: string): 'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case' | 'SCREAMING_SNAKE_CASE' {
  const lower = desc.toLowerCase();
  if (lower.includes('kebab') || lower.includes('dash')) return 'kebab-case';
  if (lower.includes('pascal')) return 'PascalCase';
  if (lower.includes('snake') && lower.includes('upper')) return 'SCREAMING_SNAKE_CASE';
  if (lower.includes('snake')) return 'snake_case';
  return 'camelCase';
}

/**
 * Detect import rule type from description.
 */
function detectImportRuleType(desc: string): 'no-relative' | 'prefer-relative' | 'no-circular' | 'explicit-exports' | 'custom' {
  const lower = desc.toLowerCase();
  if (lower.includes('no relative') || lower.includes('absolute')) return 'no-relative';
  if (lower.includes('prefer relative')) return 'prefer-relative';
  if (lower.includes('circular')) return 'no-circular';
  if (lower.includes('explicit') || lower.includes('export')) return 'explicit-exports';
  return 'custom';
}

/**
 * Parse safety section.
 */
function parseSafetySection(section: InternalSection): SafetySection {
  const result: SafetySection = {
    forbidden: [],
    required: [],
    auth: [],
    network: [],
    fileAccess: [],
  };

  const lines = section.content.trim().split('\n');
  let currentCategory: 'forbidden' | 'required' | 'auth' | 'network' | 'file' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect subcategories (including markdown headers like ### Forbidden)
    if (/^#{1,4}\s*forbidden/i.test(trimmed) || (/forbidden|never|don't|avoid|prohibited/i.test(trimmed) && !trimmed.match(/^[*-]/))) {
      currentCategory = 'forbidden';
      continue;
    }
    if (/^#{1,4}\s*required/i.test(trimmed) || (/required|must|always/i.test(trimmed) && !trimmed.match(/^[*-]/))) {
      currentCategory = 'required';
      continue;
    }
    if (/^#{1,4}\s*auth/i.test(trimmed) || (/auth|credential|secret|token/i.test(trimmed) && !trimmed.match(/^[*-]/))) {
      currentCategory = 'auth';
      continue;
    }
    if (/^#{1,4}\s*network/i.test(trimmed) || (/network|http|api|endpoint/i.test(trimmed) && !trimmed.match(/^[*-]/))) {
      currentCategory = 'network';
      continue;
    }
    if (/^#{1,4}\s*file/i.test(trimmed) || (/file|path|directory/i.test(trimmed) && !trimmed.match(/^[*-]/))) {
      currentCategory = 'file';
      continue;
    }

    // Parse list items
    const listMatch = trimmed.match(/^[*-]\s+(.+)$/);
    if (listMatch) {
      const item = listMatch[1];

      switch (currentCategory) {
        case 'forbidden':
          result.forbidden.push({
            pattern: item,
            isRegex: false,
            reason: item,
            severity: item.toLowerCase().includes('critical') ? 'error' : 'warning',
          });
          break;
        case 'required':
          result.required.push({
            pattern: item,
            reason: item,
            scope: 'project',
          });
          break;
        case 'auth':
          result.auth.push({
            type: detectAuthRuleType(item),
            description: item,
          });
          break;
        case 'network':
          result.network.push({
            requiresApproval: true,
            loggingRequired: true,
          });
          break;
        case 'file':
          result.fileAccess.push({
            forbidden: [item],
          });
          break;
      }
    }
  }

  return result;
}

/**
 * Detect auth rule type from description.
 */
function detectAuthRuleType(desc: string): 'cli-only' | 'no-api-keys' | 'no-browser' | 'no-credentials' {
  const lower = desc.toLowerCase();
  if (lower.includes('cli')) return 'cli-only';
  if (lower.includes('api key') || lower.includes('apikey')) return 'no-api-keys';
  if (lower.includes('browser')) return 'no-browser';
  return 'no-credentials';
}

/**
 * Parse agent-specific section.
 */
function parseAgentSpecificSection(section: InternalSection): AgentSpecificSection {
  // Determine which agent based on header
  const header = section.header.toLowerCase();
  let agent: string | undefined;

  if (header.includes('claude')) agent = 'claude';
  else if (header.includes('codex')) agent = 'codex';
  else if (header.includes('gemini')) agent = 'gemini';
  else if (header.includes('copilot')) agent = 'copilot';

  const protocols: Protocol[] = [];
  const superpowers: string[] = [];
  const duties: string[] = [];
  let role: string | undefined;

  const lines = section.content.trim().split('\n');
  let currentCategory: 'protocols' | 'superpowers' | 'duties' | 'role' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/protocol|behavior|pattern/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'protocols';
      continue;
    }
    if (/superpower|strength|excel/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'superpowers';
      continue;
    }
    if (/dut|responsibilit|task/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'duties';
      continue;
    }
    if (/role/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      currentCategory = 'role';
      continue;
    }

    const listMatch = trimmed.match(/^[*-]\s+(.+)$/);
    if (listMatch) {
      const item = listMatch[1];
      if (currentCategory === 'protocols') {
        protocols.push({
          name: item.split(':')[0] || item,
          trigger: 'manual',
          steps: [item],
        });
      } else if (currentCategory === 'superpowers') {
        superpowers.push(item);
      } else if (currentCategory === 'duties') {
        duties.push(item);
      } else {
        // Default to duties
        duties.push(item);
      }
    } else if (currentCategory === 'role' && trimmed && !role) {
      role = trimmed;
    }
  }

  const result: AgentSpecificSection = {};
  if (agent) result.agent = agent;
  if (role) result.role = role;
  if (superpowers.length > 0) result.superpowers = superpowers;
  if (duties.length > 0) result.duties = duties;
  if (protocols.length > 0) result.protocols = protocols;

  return result;
}

/**
 * Parse code quality section.
 */
function parseCodeQualitySection(section: InternalSection): CodeQualitySection {
  const result: CodeQualitySection = {
    antiSlop: [],
  };

  const lines = section.content.trim().split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const listMatch = trimmed.match(/^[*-]\s+(.+)$/);

    if (listMatch) {
      const item = listMatch[1];

      // Check if it's an anti-slop pattern
      if (/avoid|don't|never|bad/i.test(item)) {
        result.antiSlop.push({
          name: item.split(':')[0] || 'unnamed',
          description: item,
          action: item.replace(/avoid|don't|never/gi, 'prefer').trim(),
        });
      } else if (/complexity|cyclomatic|nesting/i.test(item)) {
        const match = item.match(/(\d+)/);
        result.complexity = result.complexity ?? [];
        result.complexity.push({
          metric: detectComplexityMetric(item),
          target: match ? parseInt(match[1], 10) : 10,
        });
      } else if (/elegant|principle|philosophy/i.test(item)) {
        result.elegance = result.elegance ?? [];
        result.elegance.push(item);
      } else if (/type|typescript|strict/i.test(item)) {
        result.typeSafety = result.typeSafety ?? [];
        result.typeSafety.push(item);
      }
    }
  }

  return result;
}

/**
 * Detect complexity metric type.
 */
function detectComplexityMetric(desc: string): 'cyclomatic' | 'cognitive' | 'nesting' | 'lines' {
  const lower = desc.toLowerCase();
  if (lower.includes('cyclomatic')) return 'cyclomatic';
  if (lower.includes('cognitive')) return 'cognitive';
  if (lower.includes('nesting') || lower.includes('depth')) return 'nesting';
  return 'lines';
}

/**
 * Parse testing section.
 */
function parseTestingSection(section: InternalSection): TestingSection {
  const result: TestingSection = {};
  const tiers: TestTier[] = [];

  const lines = section.content.trim().split('\n');
  let currentTier: TestTier | null = null;
  let philosophy: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect philosophy statement
    if (/philosophy|approach|principle/i.test(trimmed) && !trimmed.match(/^[*-]/)) {
      const nextLine = lines[lines.indexOf(line) + 1]?.trim();
      if (nextLine && !nextLine.match(/^[*#-]/)) {
        philosophy = nextLine;
      }
      continue;
    }

    // Detect tier definitions
    if (/tier[- ]?0|unit|fast/i.test(trimmed)) {
      if (currentTier) tiers.push(currentTier);
      currentTier = {
        name: 'tier0',
        description: 'Fast unit tests',
        command: 'npm test',
        when: 'pre-commit',
        requirements: [],
      };
      continue;
    }
    if (/tier[- ]?1|integration/i.test(trimmed)) {
      if (currentTier) tiers.push(currentTier);
      currentTier = {
        name: 'tier1',
        description: 'Integration tests',
        command: 'npm run test:integration',
        when: 'ci',
        requirements: [],
      };
      continue;
    }
    if (/tier[- ]?2|e2e|end.to.end/i.test(trimmed)) {
      if (currentTier) tiers.push(currentTier);
      currentTier = {
        name: 'tier2',
        description: 'End-to-end tests',
        command: 'npm run test:e2e',
        when: 'manual',
        requirements: [],
      };
      continue;
    }

    // Parse requirements for current tier
    const listMatch = trimmed.match(/^[*-]\s+(.+)$/);
    if (listMatch && currentTier) {
      currentTier.requirements?.push(listMatch[1]);
    }

    // Check for coverage requirements
    if (/coverage/i.test(trimmed)) {
      const match = trimmed.match(/(\d+)%?/);
      if (match) {
        result.coverage = result.coverage ?? {};
        result.coverage.lines = parseInt(match[1], 10);
      }
    }
  }

  // Save last tier
  if (currentTier) {
    tiers.push(currentTier);
  }

  if (philosophy) result.philosophy = philosophy;
  if (tiers.length > 0) result.tiers = tiers;

  return result;
}

/**
 * Parse integrations section.
 */
function parseIntegrationsSection(section: InternalSection): IntegrationsSection {
  const result: IntegrationsSection = {};

  const lines = section.content.trim().split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const listMatch = trimmed.match(/^[*-]\s+(.+)$/);

    if (listMatch) {
      const item = listMatch[1];

      if (/mcp|model.context.protocol/i.test(item)) {
        result.mcp = {
          enabled: true,
          allowedTools: [],
        };
      } else if (/librainian/i.test(item)) {
        result.librainian = {
          enabled: true,
        };
      } else {
        result.tools = result.tools ?? [];
        result.tools.push({
          name: item.split(':')[0] || item,
          type: 'external',
        });
      }
    }
  }

  return result;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Apply a parsed section to the guidance pack.
 */
function applySectionToPack(
  pack: AgentGuidancePack,
  type: string,
  content: unknown,
  warnings: ParseWarning[],
  source: string
): void {
  switch (type) {
    case 'mission':
      pack.mission = content as MissionSection;
      break;
    case 'commands':
      pack.commands = content as CommandsSection;
      break;
    case 'rules':
      pack.rules = content as RulesSection;
      break;
    case 'safety':
      pack.safety = content as SafetySection;
      break;
    case 'agentSpecific':
      pack.agentSpecific = content as AgentSpecificSection;
      break;
    case 'codeQuality':
      pack.codeQuality = content as CodeQualitySection;
      break;
    case 'testing':
      pack.testing = content as TestingSection;
      break;
    case 'integrations':
      pack.integrations = content as IntegrationsSection;
      break;
    default:
      warnings.push({
        code: 'UNKNOWN_SECTION',
        message: `Unknown section type: ${type}`,
        source,
      });
  }
}

/**
 * Compute SHA-256 hash of content.
 */
function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Validate a parsed guidance pack.
 */
function validatePack(pack: AgentGuidancePack, source: string): ParseError[] {
  const errors: ParseError[] = [];

  // Must have at least one source
  if (pack.sources.length === 0) {
    errors.push({
      code: 'NO_SOURCES',
      message: 'Guidance pack has no sources',
      source,
    });
  }

  // Should have mission or commands
  const hasMission = pack.mission && Object.keys(pack.mission).length > 0;
  const hasCommands = pack.commands && Object.keys(pack.commands).length > 0;
  if (!hasMission && !hasCommands) {
    errors.push({
      code: 'EMPTY_PACK',
      message: 'Guidance pack has no mission or commands defined',
      source,
    });
  }

  return errors;
}

// ============================================================================
// DISCOVERY
// ============================================================================

/**
 * Create a GuidanceSource from file information.
 */
export function createGuidanceSource(
  path: string,
  absolutePath: string,
  workspaceRoot: string,
  hash: string,
  lastModified: string
): GuidanceSource {
  const type = getFileType(path);
  const depth = calculateDepth(absolutePath, workspaceRoot);
  const priority = calculatePriority(depth, type);

  return {
    path,
    absolutePath,
    type,
    depth,
    priority,
    hash,
    lastModified,
  };
}

/**
 * Merge multiple guidance packs with precedence rules.
 */
export function mergeGuidancePacks(
  packs: AgentGuidancePack[],
  targetPath: string
): AgentGuidancePack {
  if (packs.length === 0) {
    // Extract a reasonable workspace root from target path
    const workspaceRoot = targetPath.replace(/\/[^/]+$/, '') || '/';
    return createEmptyGuidancePack(workspaceRoot, targetPath);
  }

  if (packs.length === 1) {
    return packs[0];
  }

  // Sort by source priority (lower is higher priority)
  const sorted = [...packs].sort((a, b) => {
    const aPriority = a.sources[0]?.priority ?? Infinity;
    const bPriority = b.sources[0]?.priority ?? Infinity;
    return aPriority - bPriority;
  });

  // Start with highest priority pack
  const result = { ...sorted[0] };
  result.sources = sorted.flatMap((p) => p.sources);
  result.rawSections = sorted.flatMap((p) => p.rawSections);

  // Merge in subsequent packs (extending, not replacing)
  for (let i = 1; i < sorted.length; i++) {
    const pack = sorted[i];

    // Merge commands custom
    if (pack.commands?.custom) {
      result.commands = result.commands ?? {};
      result.commands.custom = {
        ...(result.commands.custom ?? {}),
        ...pack.commands.custom,
      };
    }

    // Merge rules
    if (pack.rules) {
      result.rules = result.rules ?? {};
      if (pack.rules.fileNaming) {
        result.rules.fileNaming = [...(result.rules.fileNaming ?? []), ...pack.rules.fileNaming];
      }
      if (pack.rules.imports) {
        result.rules.imports = [...(result.rules.imports ?? []), ...pack.rules.imports];
      }
      if (pack.rules.documentation) {
        result.rules.documentation = [...(result.rules.documentation ?? []), ...pack.rules.documentation];
      }
      if (pack.rules.sizeLimits) {
        result.rules.sizeLimits = [...(result.rules.sizeLimits ?? []), ...pack.rules.sizeLimits];
      }
      if (pack.rules.general) {
        result.rules.general = [...(result.rules.general ?? []), ...pack.rules.general];
      }
    }

    // Merge safety rules
    if (pack.safety) {
      result.safety = result.safety ?? {
        forbidden: [],
        required: [],
        auth: [],
        network: [],
        fileAccess: [],
      };
      result.safety.forbidden.push(...(pack.safety.forbidden ?? []));
      result.safety.required.push(...(pack.safety.required ?? []));
      result.safety.auth.push(...(pack.safety.auth ?? []));
      result.safety.network.push(...(pack.safety.network ?? []));
      result.safety.fileAccess.push(...(pack.safety.fileAccess ?? []));
    }

    // Agent-specific from closest file takes precedence
    if (pack.agentSpecific && Object.keys(pack.agentSpecific).length > 0 && Object.keys(result.agentSpecific ?? {}).length === 0) {
      result.agentSpecific = pack.agentSpecific;
    }
  }

  // Update metadata
  result.meta.sourceCount = result.sources.length;

  return result;
}
