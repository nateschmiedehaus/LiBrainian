/**
 * @fileoverview Pattern Extraction Primitive (tp_learn_extract_pattern)
 *
 * Extract reusable patterns from successful improvements.
 * Analyzes before/after states to identify generalizable transformations.
 *
 * Based on self-improvement-primitives.md specification.
 */

import type { ConfidenceValue, Evidence } from './types.js';
import type { Issue, IssueSeverity } from './plan_fix.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of improvements.
 */
export type ImprovementType =
  | 'refactor'
  | 'fix'
  | 'optimization'
  | 'feature'
  | 'cleanup'
  | 'documentation';

/**
 * Verification result for an improvement.
 */
export type VerificationResult = 'success' | 'partial' | 'failed';

/**
 * State before or after an improvement.
 */
export interface CodeState {
  /** The code content */
  code: string;
  /** Metrics about the code */
  metrics: Record<string, number>;
  /** Issues present in this state */
  issues: Issue[];
  /** Hash of the code for comparison */
  hash?: string;
}

/**
 * A completed improvement to extract patterns from.
 */
export interface CompletedImprovement {
  /** Unique identifier */
  id: string;
  /** Type of improvement */
  type: ImprovementType;
  /** Description of what was done */
  description: string;
  /** State before the improvement */
  before: CodeState;
  /** State after the improvement */
  after: CodeState;
  /** Verification result */
  verificationResult: VerificationResult;
  /** Files that were changed */
  filesChanged: string[];
  /** When the improvement was completed */
  completedAt: Date;
  /** Evidence supporting the improvement */
  evidence?: Evidence[];
}

/**
 * Categories of extracted patterns.
 */
export type PatternCategory =
  | 'structural'
  | 'behavioral'
  | 'performance'
  | 'correctness'
  | 'maintainability';

/**
 * An extracted improvement pattern.
 */
export interface ExtractedPattern {
  /** Unique identifier */
  id: string;
  /** Pattern name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Category of pattern */
  category: PatternCategory;
  /** When to apply this pattern (trigger condition) */
  trigger: string;
  /** What transformation to apply */
  transformation: string;
  /** When NOT to apply this pattern */
  constraints: string[];
  /** Examples of this pattern in action */
  examples: Array<{
    before: string;
    after: string;
    context?: string;
  }>;
  /** Confidence in this pattern */
  confidence: ConfidenceValue;
  /** Number of times this pattern has been observed */
  observationCount: number;
}

/**
 * Context patterns that enable applicability.
 */
export type ContextPattern =
  | 'any'
  | 'typescript_project'
  | 'react_component'
  | 'node_module'
  | 'test_file'
  | 'api_endpoint';

/**
 * Conditions for when a pattern applies.
 */
export interface ApplicabilityConditions {
  /** Required context for pattern to apply */
  requiredContext: ContextPattern[];
  /** Contexts where pattern should NOT apply */
  excludingContext: ContextPattern[];
  /** Code patterns to match (regex or structural) */
  codePatterns: string[];
  /** Estimated applicability across codebase (0-1) */
  estimatedApplicability: number;
  /** Minimum codebase size for this pattern */
  minCodebaseSize?: number;
  /** Maximum complexity for safe application */
  maxComplexity?: number;
}

/**
 * Analysis of a pattern's applicability.
 */
export interface ApplicabilityAnalysis {
  /** Applicability conditions */
  conditions: ApplicabilityConditions;
  /** Number of potential application sites */
  potentialSites: number;
  /** Estimated time to apply pattern */
  estimatedEffort: string;
  /** Risks of applying this pattern */
  risks: string[];
}

/**
 * Expected benefit from applying a pattern.
 */
export interface ExpectedBenefit {
  /** Expected improvements in metrics */
  metricImprovements: Record<string, { min: number; max: number }>;
  /** Expected risk reduction (0-1) */
  riskReduction: number;
  /** Expected maintainability improvement (0-1) */
  maintainabilityImprovement: number;
  /** Confidence in these estimates */
  confidence: ConfidenceValue;
}

/**
 * Result of generalizing a pattern.
 */
export interface GeneralizationResult {
  /** Level of generalization achieved */
  level: 'specific' | 'moderate' | 'high' | 'universal';
  /** Abstract form of the pattern */
  abstractForm: string;
  /** Variables in the pattern */
  variables: string[];
  /** Concrete instantiations */
  instantiations: number;
  /** Generalization confidence */
  confidence: ConfidenceValue;
}

/**
 * Options for pattern extraction.
 */
export interface ExtractPatternOptions {
  /** Minimum generality score for extraction */
  minGenerality?: number;
  /** Maximum patterns to extract */
  maxPatterns?: number;
  /** Include performance patterns */
  includePerformancePatterns?: boolean;
  /** Minimum confidence for pattern */
  minConfidence?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Result of pattern extraction.
 */
export interface PatternExtractionResult {
  /** Extracted pattern (null if none extracted) */
  pattern: ExtractedPattern | null;
  /** Applicability analysis */
  applicability: ApplicabilityAnalysis;
  /** Generalization result */
  generalization: GeneralizationResult;
  /** Expected benefit */
  expectedBenefit: ExpectedBenefit;
  /** Whether extraction was successful */
  success: boolean;
  /** Reason if extraction failed */
  failureReason?: string;
  /** Duration of extraction in milliseconds */
  duration: number;
  /** Any errors encountered */
  errors: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MIN_GENERALITY = 0.7;
const DEFAULT_MIN_CONFIDENCE = 0.5;

/**
 * Known pattern templates by improvement type.
 */
const PATTERN_TEMPLATES: Record<ImprovementType, Array<{
  name: string;
  trigger: string;
  transformation: string;
  category: PatternCategory;
}>> = {
  refactor: [
    {
      name: 'Extract Function',
      trigger: 'Long function with repeated code blocks',
      transformation: 'Extract common code into separate function',
      category: 'structural',
    },
    {
      name: 'Extract Interface',
      trigger: 'Class with large public API',
      transformation: 'Define interface and implement it',
      category: 'structural',
    },
    {
      name: 'Replace Magic Number',
      trigger: 'Literal numbers in code',
      transformation: 'Replace with named constant',
      category: 'maintainability',
    },
  ],
  fix: [
    {
      name: 'Null Check Addition',
      trigger: 'Potential null/undefined access',
      transformation: 'Add null check before access',
      category: 'correctness',
    },
    {
      name: 'Error Boundary',
      trigger: 'Unhandled exception path',
      transformation: 'Add try-catch with proper error handling',
      category: 'correctness',
    },
    {
      name: 'Input Validation',
      trigger: 'Function accepts external input',
      transformation: 'Validate input at function entry',
      category: 'correctness',
    },
  ],
  optimization: [
    {
      name: 'Memoization',
      trigger: 'Pure function called repeatedly with same args',
      transformation: 'Cache results based on input',
      category: 'performance',
    },
    {
      name: 'Lazy Loading',
      trigger: 'Large data loaded upfront',
      transformation: 'Defer loading until needed',
      category: 'performance',
    },
    {
      name: 'Batch Processing',
      trigger: 'Multiple individual operations',
      transformation: 'Batch operations together',
      category: 'performance',
    },
  ],
  feature: [
    {
      name: 'Configuration Externalization',
      trigger: 'Hardcoded values in logic',
      transformation: 'Move to configuration file',
      category: 'maintainability',
    },
  ],
  cleanup: [
    {
      name: 'Remove Dead Code',
      trigger: 'Unreachable or unused code',
      transformation: 'Delete unused code',
      category: 'maintainability',
    },
    {
      name: 'Simplify Conditional',
      trigger: 'Complex nested conditionals',
      transformation: 'Flatten or use early returns',
      category: 'maintainability',
    },
  ],
  documentation: [
    {
      name: 'Add JSDoc',
      trigger: 'Public function without documentation',
      transformation: 'Add JSDoc comment with params and return',
      category: 'maintainability',
    },
  ],
};

// ============================================================================
// PATTERN DETECTION
// ============================================================================

/**
 * Detect pattern type from improvement.
 */
function detectPatternType(improvement: CompletedImprovement): {
  template: (typeof PATTERN_TEMPLATES)[ImprovementType][number] | null;
  confidence: number;
} {
  const templates = PATTERN_TEMPLATES[improvement.type] || [];
  const description = improvement.description.toLowerCase();

  // Score each template
  let bestMatch: (typeof templates)[number] | null = null;
  let bestScore = 0;

  for (const template of templates) {
    let score = 0;

    // Check name match
    if (description.includes(template.name.toLowerCase())) {
      score += 0.4;
    }

    // Check trigger keywords
    const triggerWords = template.trigger.toLowerCase().split(' ');
    const matchingWords = triggerWords.filter((w) => description.includes(w));
    score += (matchingWords.length / triggerWords.length) * 0.3;

    // Check transformation keywords
    const transformWords = template.transformation.toLowerCase().split(' ');
    const matchingTransform = transformWords.filter((w) => description.includes(w));
    score += (matchingTransform.length / transformWords.length) * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = template;
    }
  }

  return {
    template: bestScore > 0.3 ? bestMatch : null,
    confidence: bestScore,
  };
}

// ============================================================================
// METRIC ANALYSIS
// ============================================================================

/**
 * Analyze metric changes between before and after.
 */
function analyzeMetricChanges(
  before: CodeState,
  after: CodeState
): Record<string, { delta: number; percentChange: number }> {
  const changes: Record<string, { delta: number; percentChange: number }> = {};

  // Combine all metrics from both states
  const allMetrics = new Set([
    ...Object.keys(before.metrics),
    ...Object.keys(after.metrics),
  ]);

  for (const metric of allMetrics) {
    const beforeValue = before.metrics[metric] ?? 0;
    const afterValue = after.metrics[metric] ?? 0;
    const delta = afterValue - beforeValue;
    const percentChange = beforeValue !== 0
      ? (delta / Math.abs(beforeValue)) * 100
      : (afterValue !== 0 ? 100 : 0);

    changes[metric] = { delta, percentChange };
  }

  return changes;
}

/**
 * Determine pattern category from metric changes.
 */
function determineCategoryFromMetrics(
  metricChanges: Record<string, { delta: number; percentChange: number }>
): PatternCategory {
  // Performance metrics
  if (
    metricChanges['executionTime']?.delta < 0 ||
    metricChanges['memoryUsage']?.delta < 0
  ) {
    return 'performance';
  }

  // Correctness metrics
  if (
    metricChanges['testPassing']?.delta > 0 ||
    metricChanges['bugs']?.delta < 0
  ) {
    return 'correctness';
  }

  // Structural metrics
  if (
    metricChanges['coupling']?.delta < 0 ||
    metricChanges['cyclomaticComplexity']?.delta < 0
  ) {
    return 'structural';
  }

  // Maintainability metrics
  if (
    metricChanges['linesOfCode']?.delta < 0 ||
    metricChanges['duplication']?.delta < 0
  ) {
    return 'maintainability';
  }

  return 'behavioral';
}

// ============================================================================
// APPLICABILITY ANALYSIS
// ============================================================================

/**
 * Analyze applicability of a pattern.
 */
function analyzeApplicability(
  improvement: CompletedImprovement,
  pattern: ExtractedPattern
): ApplicabilityAnalysis {
  const conditions: ApplicabilityConditions = {
    requiredContext: ['typescript_project'],
    excludingContext: [],
    codePatterns: [],
    estimatedApplicability: 0.5,
  };

  // Determine required context from files changed
  if (improvement.filesChanged.some((f) => f.includes('.tsx'))) {
    conditions.requiredContext.push('react_component');
  }
  if (improvement.filesChanged.some((f) => f.includes('.test.'))) {
    conditions.requiredContext.push('test_file');
  }
  if (improvement.filesChanged.some((f) => f.includes('/api/'))) {
    conditions.requiredContext.push('api_endpoint');
  }

  // Determine excluding contexts
  if (pattern.category === 'performance') {
    conditions.excludingContext.push('test_file');
  }

  // Extract code patterns from the improvement
  if (improvement.before.code.includes('null')) {
    conditions.codePatterns.push('potential null access');
  }
  if (improvement.before.code.includes('async')) {
    conditions.codePatterns.push('async function');
  }

  // Estimate applicability
  const complexity = improvement.before.metrics['cyclomaticComplexity'] ?? 5;
  conditions.estimatedApplicability = complexity < 10 ? 0.7 : complexity < 20 ? 0.5 : 0.3;
  conditions.maxComplexity = complexity * 1.5;

  // Estimate potential sites (simplified)
  const potentialSites = Math.round(conditions.estimatedApplicability * 20);

  // Estimate effort
  const locChanged = Math.abs(
    (improvement.after.metrics['linesOfCode'] ?? 0) -
    (improvement.before.metrics['linesOfCode'] ?? 0)
  );
  const estimatedEffort = locChanged < 20 ? '15-30 minutes' :
    locChanged < 50 ? '1-2 hours' :
    locChanged < 100 ? '2-4 hours' : '4+ hours';

  // Identify risks
  const risks: string[] = [];
  if (improvement.type === 'refactor') {
    risks.push('May break dependent code if not carefully applied');
  }
  if (pattern.category === 'performance') {
    risks.push('Performance gains may vary by use case');
  }
  if (improvement.filesChanged.length > 3) {
    risks.push('Multi-file changes require careful coordination');
  }

  return {
    conditions,
    potentialSites,
    estimatedEffort,
    risks,
  };
}

// ============================================================================
// GENERALIZATION
// ============================================================================

/**
 * Attempt to generalize the pattern.
 */
function generalizePattern(
  improvement: CompletedImprovement,
  template: (typeof PATTERN_TEMPLATES)[ImprovementType][number] | null
): GeneralizationResult {
  if (!template) {
    return {
      level: 'specific',
      abstractForm: improvement.description,
      variables: [],
      instantiations: 1,
      confidence: {
        score: 0.3,
        tier: 'low',
        source: 'estimated',
      },
    };
  }

  // Extract variables from the pattern
  const variables: string[] = [];

  // Look for specific types that could be generalized
  if (improvement.before.code.includes('function')) {
    variables.push('FUNCTION_NAME');
  }
  if (improvement.before.code.includes('class')) {
    variables.push('CLASS_NAME');
  }
  if (improvement.filesChanged.length > 0) {
    variables.push('FILE_PATH');
  }

  // Determine generalization level
  let level: GeneralizationResult['level'];
  if (variables.length >= 3) {
    level = 'high';
  } else if (variables.length >= 2) {
    level = 'moderate';
  } else if (variables.length >= 1) {
    level = 'specific';
  } else {
    level = 'universal';
  }

  // Build abstract form
  const abstractForm = template.transformation
    .replace(/function/g, '${FUNCTION_NAME}')
    .replace(/class/g, '${CLASS_NAME}');

  return {
    level,
    abstractForm,
    variables,
    instantiations: Math.pow(2, variables.length), // Rough estimate
    confidence: {
      score: level === 'universal' ? 0.9 : level === 'high' ? 0.7 : level === 'moderate' ? 0.5 : 0.3,
      tier: level === 'universal' || level === 'high' ? 'high' : 'medium',
      source: 'estimated',
    },
  };
}

// ============================================================================
// BENEFIT ESTIMATION
// ============================================================================

/**
 * Estimate expected benefit from applying the pattern.
 */
function estimateBenefit(
  improvement: CompletedImprovement,
  metricChanges: Record<string, { delta: number; percentChange: number }>
): ExpectedBenefit {
  const metricImprovements: Record<string, { min: number; max: number }> = {};

  for (const [metric, change] of Object.entries(metricChanges)) {
    if (change.delta !== 0) {
      // Estimate range based on observed change
      metricImprovements[metric] = {
        min: change.delta * 0.7,
        max: change.delta * 1.3,
      };
    }
  }

  // Calculate risk reduction based on issues resolved
  const issuesBefore = improvement.before.issues.length;
  const issuesAfter = improvement.after.issues.length;
  const riskReduction = issuesBefore > 0
    ? Math.min(1, (issuesBefore - issuesAfter) / issuesBefore)
    : 0;

  // Calculate maintainability improvement
  const complexityBefore = improvement.before.metrics['cyclomaticComplexity'] ?? 0;
  const complexityAfter = improvement.after.metrics['cyclomaticComplexity'] ?? 0;
  const maintainabilityImprovement = complexityBefore > 0
    ? Math.max(0, Math.min(1, (complexityBefore - complexityAfter) / complexityBefore))
    : 0;

  return {
    metricImprovements,
    riskReduction,
    maintainabilityImprovement,
    confidence: {
      score: improvement.verificationResult === 'success' ? 0.8 :
        improvement.verificationResult === 'partial' ? 0.5 : 0.3,
      tier: improvement.verificationResult === 'success' ? 'high' : 'medium',
      source: 'measured',
    },
  };
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract reusable patterns from a successful improvement.
 *
 * This function:
 * 1. Analyzes the before/after states
 * 2. Identifies the type of improvement pattern
 * 3. Generalizes the pattern for reuse
 * 4. Analyzes applicability conditions
 * 5. Estimates expected benefits
 *
 * @param improvement - The completed improvement to extract from
 * @param options - Extraction options
 * @returns Pattern extraction result
 *
 * @example
 * ```typescript
 * const result = await extractPattern({
 *   id: 'imp-1',
 *   type: 'refactor',
 *   description: 'Extract validation logic into separate function',
 *   before: { code: '...', metrics: { cyclomaticComplexity: 15 }, issues: [] },
 *   after: { code: '...', metrics: { cyclomaticComplexity: 8 }, issues: [] },
 *   verificationResult: 'success',
 *   filesChanged: ['src/utils/parser.ts'],
 *   completedAt: new Date(),
 * });
 *
 * if (result.pattern) {
 *   console.log(`Extracted pattern: ${result.pattern.name}`);
 *   console.log(`Generalization level: ${result.generalization.level}`);
 * }
 * ```
 */
export async function extractPattern(
  improvement: CompletedImprovement,
  options: ExtractPatternOptions = {}
): Promise<PatternExtractionResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    minGenerality = DEFAULT_MIN_GENERALITY,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    verbose = false,
  } = options;

  if (verbose) {
    console.log(`[extractPattern] Extracting pattern from improvement: ${improvement.id}`);
  }

  // Check if improvement was successful enough
  if (improvement.verificationResult === 'failed') {
    return {
      pattern: null,
      applicability: {
        conditions: {
          requiredContext: [],
          excludingContext: [],
          codePatterns: [],
          estimatedApplicability: 0,
        },
        potentialSites: 0,
        estimatedEffort: 'N/A',
        risks: ['Improvement failed verification'],
      },
      generalization: {
        level: 'specific',
        abstractForm: '',
        variables: [],
        instantiations: 0,
        confidence: { score: 0, tier: 'uncertain', source: 'default' },
      },
      expectedBenefit: {
        metricImprovements: {},
        riskReduction: 0,
        maintainabilityImprovement: 0,
        confidence: { score: 0, tier: 'uncertain', source: 'default' },
      },
      success: false,
      failureReason: 'Improvement failed verification',
      duration: Date.now() - startTime,
      errors,
    };
  }

  // Detect pattern type
  const { template, confidence: detectionConfidence } = detectPatternType(improvement);

  if (verbose) {
    console.log(`[extractPattern] Detected template: ${template?.name ?? 'none'} (confidence: ${detectionConfidence.toFixed(2)})`);
  }

  // Analyze metric changes
  const metricChanges = analyzeMetricChanges(improvement.before, improvement.after);

  // Generalize pattern
  const generalization = generalizePattern(improvement, template);

  // Check generalization level
  const generalityScore = generalization.level === 'universal' ? 1.0 :
    generalization.level === 'high' ? 0.8 :
    generalization.level === 'moderate' ? 0.6 : 0.4;

  if (generalityScore < minGenerality) {
    return {
      pattern: null,
      applicability: {
        conditions: {
          requiredContext: [],
          excludingContext: [],
          codePatterns: [],
          estimatedApplicability: 0,
        },
        potentialSites: 0,
        estimatedEffort: 'N/A',
        risks: [],
      },
      generalization,
      expectedBenefit: {
        metricImprovements: {},
        riskReduction: 0,
        maintainabilityImprovement: 0,
        confidence: { score: 0, tier: 'uncertain', source: 'default' },
      },
      success: false,
      failureReason: `Generality score (${generalityScore}) below minimum (${minGenerality})`,
      duration: Date.now() - startTime,
      errors,
    };
  }

  // Build extracted pattern
  const category = template?.category ?? determineCategoryFromMetrics(metricChanges);
  const pattern: ExtractedPattern = {
    id: `pattern-${improvement.id}-${Date.now()}`,
    name: template?.name ?? `Pattern from ${improvement.type}`,
    description: template?.transformation ?? improvement.description,
    category,
    trigger: template?.trigger ?? 'Manual trigger required',
    transformation: generalization.abstractForm,
    constraints: [],
    examples: [{
      before: improvement.before.code.substring(0, 200),
      after: improvement.after.code.substring(0, 200),
      context: improvement.description,
    }],
    confidence: {
      score: Math.min(detectionConfidence, generalization.confidence.score),
      tier: detectionConfidence > 0.7 ? 'high' : detectionConfidence > 0.4 ? 'medium' : 'low',
      source: 'measured',
    },
    observationCount: 1,
  };

  // Check confidence threshold
  if (pattern.confidence.score < minConfidence) {
    return {
      pattern: null,
      applicability: {
        conditions: {
          requiredContext: [],
          excludingContext: [],
          codePatterns: [],
          estimatedApplicability: 0,
        },
        potentialSites: 0,
        estimatedEffort: 'N/A',
        risks: [],
      },
      generalization,
      expectedBenefit: {
        metricImprovements: {},
        riskReduction: 0,
        maintainabilityImprovement: 0,
        confidence: { score: 0, tier: 'uncertain', source: 'default' },
      },
      success: false,
      failureReason: `Confidence score (${pattern.confidence.score}) below minimum (${minConfidence})`,
      duration: Date.now() - startTime,
      errors,
    };
  }

  // Analyze applicability
  const applicability = analyzeApplicability(improvement, pattern);

  // Estimate benefit
  const expectedBenefit = estimateBenefit(improvement, metricChanges);

  if (verbose) {
    console.log(`[extractPattern] Successfully extracted pattern: ${pattern.name}`);
  }

  return {
    pattern,
    applicability,
    generalization,
    expectedBenefit,
    success: true,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Create a pattern extraction primitive with bound options.
 */
export function createExtractPattern(
  defaultOptions: Partial<ExtractPatternOptions>
): (improvement: CompletedImprovement, options?: Partial<ExtractPatternOptions>) => Promise<PatternExtractionResult> {
  return async (improvement, options = {}) => {
    return extractPattern(improvement, {
      ...defaultOptions,
      ...options,
    });
  };
}
