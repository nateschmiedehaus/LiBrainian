/**
 * @fileoverview Automatic Quality Tier Selection for LiBrainian
 *
 * This module provides intelligent tier selection based on:
 * - Codebase characteristics (files, LOC, complexity)
 * - Available system resources (memory, CPU)
 * - Time constraints (if specified)
 * - User preferences
 *
 * KEY PRINCIPLE: "Speed is less important than quality"
 * - Always prefer comprehensive analysis
 * - When constrained, warn but still do full tier
 * - Quality tier can only go UP, never down automatically
 *
 * Quality Tiers:
 * - 'mvp': Basic indexing, function-level context packs
 * - 'enhanced': Pattern detection, decision tracking
 * - 'full': Hierarchical summaries, cross-project learning (DEFAULT)
 */

import * as os from 'os';
import { glob } from 'glob';
import type { QualityTier } from '../types.js';
import { QUALITY_TIERS } from '../index.js';
import {
  detectSystemResources,
  estimateProjectComplexity,
  type SystemResources,
  type ProjectMetrics,
} from '../api/governors.js';

// ============================================================================
// CODEBASE ANALYSIS
// ============================================================================

/**
 * Detailed codebase metrics for tier selection.
 */
export interface CodebaseMetrics {
  /** Total number of source files */
  fileCount: number;
  /** Estimated lines of code (sampled) */
  estimatedLoc: number;
  /** Average file size in bytes */
  avgFileSizeBytes: number;
  /** Estimated complexity category */
  complexity: ProjectMetrics['estimatedComplexity'];
  /** Language diversity (number of distinct extensions) */
  languageCount: number;
  /** Has deep nesting (> 5 levels) */
  hasDeepNesting: boolean;
  /** Is a monorepo (has workspace indicators) */
  isMonorepo: boolean;
  /** Has existing librainian index */
  hasExistingIndex: boolean;
}

/**
 * Resource availability assessment.
 */
export interface ResourceAssessment {
  /** System resource snapshot */
  system: SystemResources;
  /** Available memory for indexing (GB) */
  availableMemoryGB: number;
  /** Available CPU cores for indexing */
  availableCores: number;
  /** System is currently under load */
  isUnderLoad: boolean;
  /** System has constrained resources */
  isConstrained: boolean;
  /** Specific resource constraints */
  constraints: string[];
}

/**
 * Tier selection recommendation.
 */
export interface TierRecommendation {
  /** Recommended tier */
  recommendedTier: QualityTier;
  /** Effective tier (may differ due to user preference for quality) */
  effectiveTier: QualityTier;
  /** Confidence in recommendation (0-1) */
  confidence: number;
  /** Reasoning for the recommendation */
  reasoning: string[];
  /** Warnings about resource constraints */
  warnings: string[];
  /** Estimated time impact */
  estimatedTimeImpact: 'minimal' | 'moderate' | 'significant' | 'substantial';
  /** Resource-related advisories */
  resourceAdvisories: string[];
  /** Whether upgrade without reindex is possible */
  canUpgradeInPlace: boolean;
}

/**
 * Time constraint specification.
 */
export interface TimeConstraint {
  /** Maximum allowed time in milliseconds (0 = unlimited) */
  maxTimeMs: number;
  /** Whether this is a hard limit or soft preference */
  isHardLimit: boolean;
}

/**
 * Tier selection options.
 */
export interface TierSelectionOptions {
  /** Workspace path */
  workspace: string;
  /** Time constraints (optional) */
  timeConstraint?: TimeConstraint;
  /** Current tier if upgrading (optional) */
  currentTier?: QualityTier;
  /** Force a specific tier (overrides recommendation) */
  forceTier?: QualityTier;
  /** Skip resource checks */
  skipResourceCheck?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

// ============================================================================
// CODEBASE ANALYSIS
// ============================================================================

/**
 * Analyze codebase to determine metrics for tier selection.
 */
export async function analyzeCodebase(workspace: string): Promise<CodebaseMetrics> {
  // Count source files
  const sourcePatterns = ['**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,swift,rb,php,c,cpp,h,hpp}'];
  const ignorePatterns = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/vendor/**'];

  let files: string[] = [];
  try {
    files = await glob(sourcePatterns, {
      cwd: workspace,
      ignore: ignorePatterns,
      nodir: true,
    });
  } catch {
    files = [];
  }

  const fileCount = files.length;

  // Estimate LOC by sampling (for large codebases)
  const sampleSize = Math.min(100, fileCount);
  let estimatedLoc = 0;
  let totalSampledBytes = 0;
  let sampledFiles = 0;

  if (fileCount > 0) {
    const fs = await import('fs/promises');
    const path = await import('path');
    const sampleIndices = new Set<number>();

    // Random sampling for large codebases
    while (sampleIndices.size < sampleSize) {
      sampleIndices.add(Math.floor(Math.random() * fileCount));
    }

    for (const idx of sampleIndices) {
      const file = files[idx];
      if (!file) continue;
      try {
        const content = await fs.readFile(path.join(workspace, file), 'utf8');
        const lines = content.split('\n').length;
        estimatedLoc += lines;
        totalSampledBytes += content.length;
        sampledFiles++;
      } catch {
        // Skip unreadable files
      }
    }

    // Extrapolate to full codebase
    if (sampledFiles > 0) {
      const avgLinesPerFile = estimatedLoc / sampledFiles;
      estimatedLoc = Math.round(avgLinesPerFile * fileCount);
    }
  }

  const avgFileSizeBytes = sampledFiles > 0 ? totalSampledBytes / sampledFiles : 0;

  // Check for language diversity
  const extensions = new Set<string>();
  for (const file of files) {
    const ext = file.split('.').pop()?.toLowerCase();
    if (ext) extensions.add(ext);
  }

  // Check for deep nesting
  const hasDeepNesting = files.some(f => f.split('/').length > 6);

  // Check for monorepo indicators
  const fs = await import('fs/promises');
  const path = await import('path');
  let isMonorepo = false;
  try {
    const pkgJson = JSON.parse(await fs.readFile(path.join(workspace, 'package.json'), 'utf8'));
    isMonorepo = Boolean(pkgJson.workspaces);
  } catch {
    // Check for other monorepo indicators
    try {
      await fs.access(path.join(workspace, 'lerna.json'));
      isMonorepo = true;
    } catch {
      try {
        await fs.access(path.join(workspace, 'pnpm-workspace.yaml'));
        isMonorepo = true;
      } catch {
        // Not a monorepo
      }
    }
  }

  // Check for existing index
  let hasExistingIndex = false;
  try {
    await fs.access(path.join(workspace, '.librainian'));
    hasExistingIndex = true;
  } catch {
    // No existing index
  }

  return {
    fileCount,
    estimatedLoc,
    avgFileSizeBytes,
    complexity: estimateProjectComplexity(fileCount),
    languageCount: extensions.size,
    hasDeepNesting,
    isMonorepo,
    hasExistingIndex,
  };
}

// ============================================================================
// RESOURCE ASSESSMENT
// ============================================================================

/**
 * Memory thresholds for tier recommendations.
 * Per VISION: Quality over speed, so these are advisory only.
 */
const MEMORY_THRESHOLDS = {
  /** Minimum recommended for any indexing (GB) */
  minimum: 2,
  /** Comfortable for enhanced tier (GB) */
  comfortable: 4,
  /** Ideal for full tier (GB) */
  ideal: 8,
};

/**
 * CPU thresholds for concurrent processing.
 */
const CPU_THRESHOLDS = {
  /** Minimum cores for parallel processing */
  minimum: 2,
  /** Comfortable for enhanced tier */
  comfortable: 4,
  /** Ideal for full tier with maximum parallelism */
  ideal: 8,
};

/**
 * Assess available system resources for indexing.
 */
export function assessResources(): ResourceAssessment {
  const system = detectSystemResources();
  const constraints: string[] = [];

  // Reserve memory for system (20% or 2GB minimum)
  const reservedMemory = Math.max(2, system.totalMemoryGB * 0.2);
  const availableMemoryGB = Math.max(0, system.freeMemoryGB - reservedMemory);

  // Reserve cores for system (2 minimum)
  const reservedCores = Math.min(2, Math.floor(system.cpuCores * 0.25));
  const availableCores = Math.max(1, system.cpuCores - reservedCores);

  // Check if system is under load
  const isUnderLoad = system.loadAverage > system.cpuCores * 0.7;
  if (isUnderLoad) {
    constraints.push(`High system load: ${system.loadAverage.toFixed(1)} (${system.cpuCores} cores)`);
  }

  // Check memory constraints
  const isMemoryConstrained = availableMemoryGB < MEMORY_THRESHOLDS.comfortable;
  if (isMemoryConstrained) {
    constraints.push(`Limited available memory: ${availableMemoryGB.toFixed(1)}GB`);
  }

  // Check CPU constraints
  const isCpuConstrained = availableCores < CPU_THRESHOLDS.comfortable;
  if (isCpuConstrained) {
    constraints.push(`Limited available cores: ${availableCores}`);
  }

  const isConstrained = isMemoryConstrained || isCpuConstrained || isUnderLoad;

  return {
    system,
    availableMemoryGB,
    availableCores,
    isUnderLoad,
    isConstrained,
    constraints,
  };
}

// ============================================================================
// TIER SELECTION LOGIC
// ============================================================================

/**
 * Estimate time for each tier based on codebase metrics.
 * Returns estimates in seconds.
 */
function estimateIndexingTime(metrics: CodebaseMetrics, resources: ResourceAssessment): Record<QualityTier, number> {
  // Base time per file (seconds) - empirical estimates
  const baseTimePerFile: Record<QualityTier, number> = {
    mvp: 0.1,      // ~100ms per file - basic parsing
    enhanced: 0.5, // ~500ms per file - includes pattern detection
    full: 1.0,     // ~1s per file - full LLM enrichment
  };

  // Adjust for codebase complexity
  const complexityMultiplier: Record<ProjectMetrics['estimatedComplexity'], number> = {
    small: 0.8,
    medium: 1.0,
    large: 1.2,
    massive: 1.5,
  };

  // Adjust for available parallelism
  const parallelismFactor = Math.max(1, resources.availableCores / 4);

  const estimates: Record<QualityTier, number> = {
    mvp: 0,
    enhanced: 0,
    full: 0,
  };

  for (const tier of ['mvp', 'enhanced', 'full'] as QualityTier[]) {
    const baseTime = baseTimePerFile[tier] * metrics.fileCount;
    const adjustedTime = baseTime * complexityMultiplier[metrics.complexity] / parallelismFactor;
    estimates[tier] = Math.round(adjustedTime);
  }

  return estimates;
}

/**
 * Determine the recommended tier based on all factors.
 *
 * KEY PRINCIPLE: Quality over speed.
 * - For production codebases, always recommend 'full'
 * - For quick exploration (explicit time constraint), may recommend lower
 * - When constrained, still use 'full' but warn
 */
export async function selectTier(options: TierSelectionOptions): Promise<TierRecommendation> {
  const { workspace, timeConstraint, currentTier, forceTier, skipResourceCheck, verbose } = options;
  const reasoning: string[] = [];
  const warnings: string[] = [];
  const resourceAdvisories: string[] = [];

  // If force tier is specified, use it
  if (forceTier) {
    return {
      recommendedTier: forceTier,
      effectiveTier: forceTier,
      confidence: 1.0,
      reasoning: [`Tier forced to '${forceTier}' by user preference`],
      warnings: [],
      estimatedTimeImpact: 'minimal',
      resourceAdvisories: [],
      canUpgradeInPlace: false,
    };
  }

  // Analyze codebase
  const metrics = await analyzeCodebase(workspace);
  if (verbose) {
    reasoning.push(`Codebase: ${metrics.fileCount} files, ~${metrics.estimatedLoc} LOC, ${metrics.complexity} complexity`);
  }

  // Assess resources
  const resources = skipResourceCheck ? createUnconstrainedResources() : assessResources();

  if (resources.isConstrained) {
    for (const constraint of resources.constraints) {
      resourceAdvisories.push(constraint);
    }
  }

  // Estimate times
  const timeEstimates = estimateIndexingTime(metrics, resources);

  // Default to 'full' tier - quality over speed
  let recommendedTier: QualityTier = 'full';
  let confidence = 0.95;

  // Check time constraints (only soft constraints affect recommendation)
  if (timeConstraint && timeConstraint.maxTimeMs > 0) {
    const maxTimeSeconds = timeConstraint.maxTimeMs / 1000;

    if (timeConstraint.isHardLimit) {
      // Hard limits: we still recommend full, but warn heavily
      if (timeEstimates.full > maxTimeSeconds) {
        warnings.push(
          `Full tier may exceed time limit (est. ${timeEstimates.full}s vs ${maxTimeSeconds}s limit). ` +
          `Per quality-first principle, proceeding with full tier anyway.`
        );
        reasoning.push(`Time constraint acknowledged but quality takes precedence`);
      }
    } else {
      // Soft constraints: may adjust recommendation for quick exploration
      if (timeEstimates.full > maxTimeSeconds && timeEstimates.enhanced <= maxTimeSeconds) {
        // Only for explicit quick exploration with soft limits
        recommendedTier = 'enhanced';
        confidence = 0.7;
        reasoning.push(`Soft time preference suggests 'enhanced' tier (${timeEstimates.enhanced}s vs ${maxTimeSeconds}s)`);
        warnings.push(
          `Consider running full tier later for comprehensive analysis. ` +
          `Enhanced tier provides partial coverage.`
        );
      } else if (timeEstimates.enhanced > maxTimeSeconds && timeEstimates.mvp <= maxTimeSeconds) {
        recommendedTier = 'mvp';
        confidence = 0.5;
        reasoning.push(`Soft time preference suggests 'mvp' tier for quick exploration`);
        warnings.push(
          `MVP tier provides basic coverage only. ` +
          `Run full tier for production use.`
        );
      }
    }
  }

  // Special cases
  if (metrics.isMonorepo) {
    reasoning.push(`Monorepo detected - full tier recommended for cross-package understanding`);
    if (recommendedTier !== 'full') {
      warnings.push(`Monorepos benefit significantly from full tier analysis`);
    }
  }

  if (metrics.hasDeepNesting) {
    reasoning.push(`Deep nesting detected - full tier provides better hierarchical understanding`);
  }

  if (metrics.languageCount > 3) {
    reasoning.push(`Multi-language codebase (${metrics.languageCount} languages) - full tier recommended`);
  }

  // Determine effective tier (quality-first principle)
  // Per user requirement: "speed is less important than quality"
  // So we ALWAYS use full for production, regardless of recommendation
  let effectiveTier: QualityTier = 'full';

  // Only deviate from full if explicitly exploring quickly with soft time constraint
  if (recommendedTier !== 'full' && timeConstraint && !timeConstraint.isHardLimit) {
    // User explicitly wants quick exploration - honor that
    effectiveTier = recommendedTier;
    warnings.push(
      `Using '${effectiveTier}' tier for quick exploration. ` +
      `For production use, run without time constraints to get full tier.`
    );
  }

  // If constrained but using full, add advisory
  if (resources.isConstrained && effectiveTier === 'full') {
    resourceAdvisories.push(
      `System resources are constrained. Indexing will proceed with full quality ` +
      `but may take longer than optimal. Consider closing other applications.`
    );
  }

  // Determine time impact
  let estimatedTimeImpact: TierRecommendation['estimatedTimeImpact'];
  const fullTimeSeconds = timeEstimates.full;
  if (fullTimeSeconds < 60) {
    estimatedTimeImpact = 'minimal';
  } else if (fullTimeSeconds < 300) {
    estimatedTimeImpact = 'moderate';
  } else if (fullTimeSeconds < 900) {
    estimatedTimeImpact = 'significant';
  } else {
    estimatedTimeImpact = 'substantial';
  }

  // Determine if upgrade in place is possible
  const canUpgradeInPlace = currentTier !== undefined &&
    QUALITY_TIERS[effectiveTier].level > QUALITY_TIERS[currentTier].level &&
    effectiveTier !== 'full'; // Full requires complete reindex for best results

  if (currentTier && effectiveTier !== currentTier) {
    if (QUALITY_TIERS[effectiveTier].level > QUALITY_TIERS[currentTier].level) {
      reasoning.push(`Upgrading from '${currentTier}' to '${effectiveTier}'`);
    }
  }

  reasoning.push(`Effective tier: '${effectiveTier}' (quality-first principle)`);

  return {
    recommendedTier,
    effectiveTier,
    confidence,
    reasoning,
    warnings,
    estimatedTimeImpact,
    resourceAdvisories,
    canUpgradeInPlace,
  };
}

/**
 * Create unconstrained resource assessment for skip mode.
 */
function createUnconstrainedResources(): ResourceAssessment {
  return {
    system: {
      cpuCores: os.cpus().length,
      totalMemoryGB: os.totalmem() / (1024 ** 3),
      freeMemoryGB: os.freemem() / (1024 ** 3),
      loadAverage: 0,
    },
    availableMemoryGB: Infinity,
    availableCores: os.cpus().length,
    isUnderLoad: false,
    isConstrained: false,
    constraints: [],
  };
}

// ============================================================================
// TIER UPGRADE SUPPORT
// ============================================================================

/**
 * Tier upgrade strategy.
 */
export interface TierUpgradeStrategy {
  /** Source tier */
  fromTier: QualityTier;
  /** Target tier */
  toTier: QualityTier;
  /** Whether full reindex is required */
  requiresFullReindex: boolean;
  /** Incremental steps if not full reindex */
  incrementalSteps: string[];
  /** Estimated additional time (seconds) */
  estimatedAdditionalTimeSeconds: number;
  /** What gets added in the upgrade */
  addedCapabilities: string[];
}

/**
 * Determine upgrade strategy between tiers.
 */
export function getUpgradeStrategy(
  fromTier: QualityTier,
  toTier: QualityTier,
  metrics: CodebaseMetrics
): TierUpgradeStrategy {
  const fromLevel = QUALITY_TIERS[fromTier].level;
  const toLevel = QUALITY_TIERS[toTier].level;

  // Downgrade is not supported
  if (toLevel <= fromLevel) {
    return {
      fromTier,
      toTier,
      requiresFullReindex: false,
      incrementalSteps: [],
      estimatedAdditionalTimeSeconds: 0,
      addedCapabilities: [],
    };
  }

  // Upgrading TO full always requires full reindex for best results
  if (toTier === 'full') {
    return {
      fromTier,
      toTier,
      requiresFullReindex: true,
      incrementalSteps: [],
      estimatedAdditionalTimeSeconds: Math.round(metrics.fileCount * 1.0), // ~1s per file
      addedCapabilities: [
        'Hierarchical summaries',
        'Cross-project learning',
        'Full LLM enrichment',
        'Complete pattern detection',
      ],
    };
  }

  // MVP -> Enhanced can be incremental
  if (fromTier === 'mvp' && toTier === 'enhanced') {
    return {
      fromTier,
      toTier,
      requiresFullReindex: false,
      incrementalSteps: [
        'Add pattern detection pass',
        'Build decision tracking',
        'Enhance context packs',
      ],
      estimatedAdditionalTimeSeconds: Math.round(metrics.fileCount * 0.4), // ~400ms per file additional
      addedCapabilities: [
        'Pattern detection',
        'Decision tracking',
        'Enhanced context packs',
      ],
    };
  }

  // Default: full reindex
  const supersedes = QUALITY_TIERS[toTier].supersedes as readonly string[];
  return {
    fromTier,
    toTier,
    requiresFullReindex: true,
    incrementalSteps: [],
    estimatedAdditionalTimeSeconds: Math.round(metrics.fileCount * 1.0),
    addedCapabilities: supersedes.includes(fromTier)
      ? [`All capabilities from ${fromTier}`, `Plus ${QUALITY_TIERS[toTier].description}`]
      : [QUALITY_TIERS[toTier].description],
  };
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick check: should we use full tier?
 * Per user requirement, the answer is almost always YES.
 */
export function shouldUseFull(_workspace: string, explicitQuickMode?: boolean): boolean {
  // Only skip full if explicitly in quick exploration mode
  if (explicitQuickMode) {
    return false;
  }
  // Default: always full
  return true;
}

/**
 * Get tier for production use.
 * Always returns 'full' per quality-first principle.
 */
export function getProductionTier(): QualityTier {
  return 'full';
}

/**
 * Get tier for quick exploration.
 * Returns 'mvp' for fastest iteration.
 */
export function getExplorationTier(): QualityTier {
  return 'mvp';
}

/**
 * Format tier recommendation for display.
 */
export function formatTierRecommendation(recommendation: TierRecommendation): string {
  const lines: string[] = [];

  lines.push(`Quality Tier: ${recommendation.effectiveTier.toUpperCase()}`);
  lines.push(`Confidence: ${(recommendation.confidence * 100).toFixed(0)}%`);
  lines.push(`Estimated Impact: ${recommendation.estimatedTimeImpact}`);

  if (recommendation.reasoning.length > 0) {
    lines.push('');
    lines.push('Reasoning:');
    for (const reason of recommendation.reasoning) {
      lines.push(`  - ${reason}`);
    }
  }

  if (recommendation.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of recommendation.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  if (recommendation.resourceAdvisories.length > 0) {
    lines.push('');
    lines.push('Resource Advisories:');
    for (const advisory of recommendation.resourceAdvisories) {
      lines.push(`  * ${advisory}`);
    }
  }

  return lines.join('\n');
}

export default {
  selectTier,
  analyzeCodebase,
  assessResources,
  getUpgradeStrategy,
  shouldUseFull,
  getProductionTier,
  getExplorationTier,
  formatTierRecommendation,
};
