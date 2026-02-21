/**
 * @fileoverview Guidance Module - AGENTS.md Parser and Precedence Rules
 *
 * This module provides typed structures for parsed AGENTS.md content
 * and deterministic precedence resolution for nested monorepos.
 *
 * @packageDocumentation
 */

// Types
export {
  GUIDANCE_SCHEMA_VERSION,

  // Core types
  type AgentGuidancePack,
  type GuidanceSource,
  type GuidanceFileType,

  // Section types
  type MissionSection,
  type CommandsSection,
  type CommandDefinition,
  type RulesSection,
  type CommitFormatRule,
  type FileNamingRule,
  type ImportRule,
  type DocumentationRule,
  type SizeLimitRule,
  type SafetySection,
  type ForbiddenPattern,
  type RequiredPattern,
  type AuthRule,
  type NetworkRule,
  type FileAccessRule,
  type AgentSpecificSection,
  type Protocol,
  type CodeQualitySection,
  type AntiSlopPattern,
  type ComplexityRule,
  type TestingSection,
  type TestTier,
  type CoverageRequirement,
  type IntegrationsSection,
  type MCPIntegration,
  type LiBrainianIntegration,
  type ToolIntegration,
  type RawSection,

  // Metadata types
  type GuidanceMetadata,
  type ParseWarning,
  type ParseError,

  // Factory functions
  createEmptyGuidancePack,

  // Type guards
  isAgentGuidancePack,
  isGuidanceSource,
  isCommandDefinition,
} from './types.js';

// Precedence
export {
  // Configuration
  FILE_TYPE_PRIORITY,
  GUIDANCE_FILE_NAMES,
  SKIP_DIRECTORIES,

  // Precedence functions
  calculatePriority,
  comparePrecedence,
  sortByPrecedence,
  getFileType,
  isGuidanceFile,
  shouldSkipDirectory,

  // Path utilities
  calculateDepth,
  normalizePath,
  getParentDirectories,

  // Merge rules
  type MergeStrategy,
  getMergeStrategy,
  getEffectiveSources,

  // Reporting
  type PrecedenceReport,
  type PrecedenceDecision,
  generatePrecedenceReport,
} from './precedence.js';

// Parser
export {
  // Configuration
  DEFAULT_PARSER_CONFIG,
  type ParserConfig,

  // Parsing
  parseGuidanceFile,
  type ParseResult,

  // Source creation
  createGuidanceSource,

  // Pack merging
  mergeGuidancePacks,
} from './parser.js';
