/**
 * @fileoverview Quality Module
 *
 * Comprehensive code quality analysis, issue detection, and improvement tracking.
 * Designed for best-in-world software development.
 *
 * Components:
 * - Issue Registry: Persistent tracking of all quality issues
 * - Issue Detector: Detection algorithms for common problems
 * - World-Class Standards: Beyond-basic quality rules
 * - Component Research: Best practices and reference implementations
 */

// Issue Registry (persistent quality issue tracking)
export {
  QualityIssueRegistry,
  getQualityRegistry,
  resetQualityRegistry,
} from './issue_registry.js';

export type {
  QualityIssue,
  IssueCategory,
  IssueSeverity,
  IssueStatus,
  IssueQuery,
  IssueRegistryStats,
  IssueClaim,
} from './issue_registry.js';

// Issue Detector (detection algorithms)
export {
  detectAllIssues,
  detectFileIssuesIncremental,
} from './issue_detector.js';

export type {
  DetectedIssue,
  DetectionContext,
} from './issue_detector.js';

// World-Class Standards (beyond-basic quality rules)
export {
  WORLD_CLASS_RULES,
  detectWorldClassIssues,
} from './world_class_standards.js';

export type {
  WorldClassDimensions,
  DimensionScore,
  WorldClassRule,
  RuleContext,
  RuleViolation,
} from './world_class_standards.js';

// File Size Guard (AI tool compatibility)
export {
  checkFile,
  checkDirectory,
  checkFiles,
  assertFileSizes,
  formatReport,
  estimateTokens,
  DEFAULT_FILE_SIZE_CONFIG,
  FileSizeError,
} from './file_size_guard.js';

export type {
  FileSizeConfig,
  FileSizeResult,
  FileSizeReport,
  FileSizeViolation,
  ViolationType,
} from './file_size_guard.js';

// Component Research (best practices registry)
export {
  ComponentRegistry,
  getComponentRegistry,
  resetComponentRegistry,
  DOMAIN_RESEARCH_TEMPLATES,
} from '../knowledge/component_research.js';

export type {
  CodebaseComponent,
  ComponentCategory,
  RoadmapItem,
  ArchitecturalDecision,
  QualityGate,
  ComponentResearch,
  VersionNote,
} from '../knowledge/component_research.js';
