/**
 * @fileoverview Skills Module - Agent Skills Loader and Validator
 *
 * This module provides typed structures for Agent Skills -
 * portable procedural knowledge that can be loaded, validated,
 * and exposed as LiBrainian Method Packs.
 *
 * @packageDocumentation
 */

// Types
export {
  SKILLS_SCHEMA_VERSION,

  // Core types
  type AgentSkill,
  type SkillIdentity,
  type SkillMetadata,
  type SkillSource,
  type SkillDefinition,
  type SkillTrigger,
  type WorkflowStep,
  type StepType,
  type StepAction,
  type SkillInput,
  type SkillOutput,
  type SkillDependency,
  type SkillExample,
  type SkillScript,
  type SkillResource,
  type SkillConfig,
  type SkillValidation,
  type ValidationIssue,
  type SkillCacheMetadata,

  // Method pack types
  type SkillMethodPack,
  type SkillMethodPackEvidence,

  // Factory functions
  createEmptyValidation,
  createCacheMetadata,
  isCacheExpired,

  // Type guards
  isAgentSkill,
  isSkillIdentity,
  isSkillDefinition,
  isSkillValidation,
  isSkillMethodPack,
} from './types.js';

// Loader
export {
  discoverSkills,
  loadSkill,
  loadSkills,
  DEFAULT_LOADER_CONFIG,
  type LoaderConfig,
  type LoadResult,
  type DiscoveryResult,
} from './loader.js';

// Validator
export {
  validateSkill,
  validateSkills,
  quickValidate,
  createEmptyContext,
  DEFAULT_VALIDATOR_CONFIG,
  type ValidatorConfig,
  type ValidationContext,
} from './validator.js';
