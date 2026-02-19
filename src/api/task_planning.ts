/**
 * @fileoverview Task Planning API for Agent Implementation Guidance
 *
 * Provides structured task planning to help agents understand how to implement
 * features, identify affected files, and understand dependencies before coding.
 *
 * Key features:
 * - Task classification (bug fix, feature, refactor, etc.)
 * - Complexity estimation
 * - Step-by-step implementation plans
 * - Context file identification
 * - Risk assessment
 * - Test requirement generation
 *
 * @example
 * ```typescript
 * const plan = await planTask(storage, "Add caching to the query API", workspace);
 * console.log(plan.steps);
 * console.log(plan.filesToModify);
 * console.log(plan.risks);
 * ```
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { LibrarianStorage, SimilarityResult } from '../storage/types.js';
import type { FunctionKnowledge, ModuleKnowledge, GraphEdge } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

export type TaskType =
  | 'bug_fix'
  | 'feature_add'
  | 'feature_modify'
  | 'refactor'
  | 'performance'
  | 'security'
  | 'documentation'
  | 'test'
  | 'dependency_update'
  | 'configuration';

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'epic';

export type RiskLevel = 'low' | 'medium' | 'high';

export type ChangeType = 'create' | 'modify' | 'delete';

export type FilePriority = 'must-read' | 'should-read' | 'helpful';

export type TestType = 'unit' | 'integration' | 'e2e';

export interface TaskStep {
  /** Step order number */
  order: number;
  /** Action to perform (read, write, modify, verify, etc.) */
  action: string;
  /** Target of the action */
  target: string;
  /** Detailed description of what to do */
  details: string;
  /** Step numbers that must complete first */
  dependencies: number[];
  /** How to verify this step is complete */
  verification: string;
}

export interface ContextFile {
  /** File path */
  path: string;
  /** Why this file is relevant */
  reason: string;
  /** How important it is to read this file */
  priority: FilePriority;
}

export interface FileToModify {
  /** File path */
  path: string;
  /** Type of change needed */
  changeType: ChangeType;
  /** Why this file needs to change */
  reason: string;
}

export interface TestRequirement {
  /** Test file path */
  testFile: string;
  /** Type of test */
  testType: TestType;
  /** Test scenarios to cover */
  scenarios: string[];
}

export interface TaskRisk {
  /** Description of the risk */
  risk: string;
  /** How likely this risk is */
  likelihood: RiskLevel;
  /** How to mitigate this risk */
  mitigation: string;
}

export interface EstimatedScope {
  /** Number of files likely to be affected */
  filesAffected: number;
  /** Number of tests needed */
  testsNeeded: number;
  /** Overall risk level */
  riskLevel: RiskLevel;
}

export interface TaskPlan {
  /** Original task description */
  task: string;
  /** Classification of the task type */
  classification: TaskType;
  /** Estimated complexity */
  complexity: TaskComplexity;
  /** Estimated scope of changes */
  estimatedScope: EstimatedScope;

  /** Step-by-step implementation plan */
  steps: TaskStep[];

  /** Files to understand first */
  contextFiles: ContextFile[];

  /** Files likely to need changes */
  filesToModify: FileToModify[];

  /** Tests to write or update */
  testsRequired: TestRequirement[];

  /** Potential risks and mitigations */
  risks: TaskRisk[];

  /** Pre-flight checks before starting */
  preflightChecks: string[];

  /** Confidence in this plan (0-1) */
  confidence: number;

  /** Time taken to generate this plan (ms) */
  planningTimeMs: number;
}

// ============================================================================
// TASK CLASSIFICATION PATTERNS
// ============================================================================

const TASK_PATTERNS: Record<TaskType, RegExp[]> = {
  bug_fix: [
    /fix|bug|issue|error|crash|broken|not\s+working|fail/i,
    /regression|defect|problem|wrong|incorrect/i,
  ],
  feature_add: [
    /add|implement|create|new\s+feature|introduce/i,
    /build|develop|construct|establish/i,
  ],
  feature_modify: [
    /update|modify|change|improve|enhance|extend/i,
    /adjust|tweak|alter|revise/i,
  ],
  refactor: [
    /refactor|restructure|clean|reorganize|simplify/i,
    /extract|split|merge|consolidate|deduplicate/i,
  ],
  performance: [
    /performance|speed|optimize|slow|fast|efficient/i,
    /latency|throughput|memory|cpu|cache/i,
  ],
  security: [
    /security|vulnerability|auth|permission|access/i,
    /encrypt|sanitize|validate|injection|xss/i,
  ],
  documentation: [
    /document|readme|jsdoc|comment|explain/i,
    /describe|clarify|annotate/i,
  ],
  test: [
    /test|spec|coverage|assert|expect/i,
    /unit\s+test|integration\s+test|e2e/i,
  ],
  dependency_update: [
    /upgrade|dependency|package|version|npm|yarn/i,
    /update\s+.*\s+to|bump|migrate/i,
  ],
  configuration: [
    /config|setting|environment|env|option/i,
    /configure|setup|initialize/i,
  ],
};

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface RelevantContext {
  file: string;
  relevance: string;
  score: number;
  entityId?: string;
  entityType?: 'function' | 'module';
}

interface AffectedFile {
  path: string;
  exists: boolean;
  reason: string;
  isTest: boolean;
}

interface AffectedAreas {
  files: AffectedFile[];
  modules: string[];
  patterns: string[];
}

// ============================================================================
// MAIN API
// ============================================================================

/**
 * Generate a structured task plan for implementing a given task.
 *
 * @param storage - Librarian storage instance
 * @param taskDescription - Description of the task to plan
 * @param workspace - Workspace root path
 * @returns A structured task plan
 *
 * @example
 * ```typescript
 * const plan = await planTask(storage, "Add rate limiting to API endpoints", "/path/to/project");
 * ```
 */
export async function planTask(
  storage: LibrarianStorage,
  taskDescription: string,
  workspace: string
): Promise<TaskPlan> {
  const startTime = Date.now();

  // Step 1: Classify the task
  const classification = classifyTask(taskDescription);

  // Step 2: Find relevant context from the codebase
  const relevantContext = await findRelevantContext(storage, taskDescription);

  // Step 3: Identify affected areas
  const affectedAreas = await identifyAffectedAreas(
    storage,
    taskDescription,
    relevantContext,
    workspace
  );

  // Step 4: Calculate complexity
  const complexity = calculateComplexity(affectedAreas, classification);

  // Step 5: Generate step-by-step plan
  const steps = generateSteps(classification, affectedAreas, relevantContext);

  // Step 6: Identify risks
  const risks = identifyRisks(classification, affectedAreas);

  // Step 7: Generate test requirements
  const testsRequired = generateTestRequirements(classification, affectedAreas);

  // Step 8: Generate preflight checks
  const preflightChecks = generatePreflightChecks(classification, affectedAreas);

  // Step 9: Build context files list
  const contextFiles = relevantContext.map((c) => ({
    path: c.file,
    reason: c.relevance,
    priority: (c.score > 0.8
      ? 'must-read'
      : c.score > 0.5
        ? 'should-read'
        : 'helpful') as FilePriority,
  }));

  // Step 10: Build files to modify list
  const filesToModify = affectedAreas.files
    .filter((f) => !f.isTest)
    .map((f) => ({
      path: f.path,
      changeType: (f.exists ? 'modify' : 'create') as ChangeType,
      reason: f.reason,
    }));

  // Calculate confidence based on available context
  const confidence = calculatePlanConfidence(relevantContext, affectedAreas);

  return {
    task: taskDescription,
    classification,
    complexity,
    estimatedScope: {
      filesAffected: affectedAreas.files.filter((f) => !f.isTest).length,
      testsNeeded: testsRequired.length,
      riskLevel: calculateRiskLevel(risks),
    },
    steps,
    contextFiles,
    filesToModify,
    testsRequired,
    risks,
    preflightChecks,
    confidence,
    planningTimeMs: Date.now() - startTime,
  };
}

/**
 * Classify a task description into a task type.
 */
export function classifyTask(description: string): TaskType {
  const lower = description.toLowerCase();

  // Score each task type based on pattern matches
  const scores: Record<TaskType, number> = {
    bug_fix: 0,
    feature_add: 0,
    feature_modify: 0,
    refactor: 0,
    performance: 0,
    security: 0,
    documentation: 0,
    test: 0,
    dependency_update: 0,
    configuration: 0,
  };

  for (const [taskType, patterns] of Object.entries(TASK_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        scores[taskType as TaskType] += 1;
      }
    }
  }

  // Find the task type with the highest score
  let maxScore = 0;
  let result: TaskType = 'feature_modify';

  for (const [taskType, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      result = taskType as TaskType;
    }
  }

  return result;
}

/**
 * Detect if a query is asking for task planning guidance.
 */
export function isTaskPlanningQuery(intent: string): boolean {
  const patterns = [
    /how\s+(?:should|do|would)\s+(?:i|we)\s+implement/i,
    /how\s+to\s+(?:implement|add|create|build)/i,
    /plan\s+(?:for|to)\s+(?:implement|add|create)/i,
    /what\s+(?:files?|steps?)\s+(?:do\s+i|should\s+i|would\s+i)\s+(?:need|change|modify)/i,
    /implementation\s+(?:plan|guide|guidance|steps)/i,
    /where\s+(?:should|do)\s+i\s+start/i,
    /what's?\s+the\s+best\s+(?:way|approach)\s+to\s+(?:implement|add)/i,
    /help\s+me\s+(?:plan|implement|understand)/i,
    /before\s+i\s+(?:start|begin|implement)/i,
    /what\s+(?:would|will)\s+(?:be\s+)?affected/i,
  ];

  return patterns.some((p) => p.test(intent));
}

/**
 * Extract the task description from a planning query.
 */
export function extractTaskFromQuery(intent: string): string {
  // Remove common planning prefixes
  const prefixes = [
    /^how\s+(?:should|do|would)\s+(?:i|we)\s+implement\s*/i,
    /^how\s+to\s+(?:implement|add|create|build)\s*/i,
    /^plan\s+(?:for|to)\s+(?:implement|add|create)\s*/i,
    /^what\s+(?:files?|steps?)\s+(?:do\s+i|should\s+i)\s+need\s+to\s+/i,
    /^implementation\s+(?:plan|guide|guidance|steps)\s+for\s*/i,
    /^what's?\s+the\s+best\s+(?:way|approach)\s+to\s+/i,
    /^help\s+me\s+(?:plan|implement|understand)\s*/i,
  ];

  let task = intent;
  for (const prefix of prefixes) {
    task = task.replace(prefix, '');
  }

  // Clean up trailing punctuation
  task = task.replace(/\?+$/, '').trim();

  return task || intent;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

async function findRelevantContext(
  storage: LibrarianStorage,
  taskDescription: string
): Promise<RelevantContext[]> {
  const results: RelevantContext[] = [];

  try {
    // Search functions by semantic similarity
    const functions = await storage.getFunctions({ limit: 100 });
    const relevantFunctions = functions.filter((fn) => {
      const relevance = computeTextRelevance(taskDescription, fn.purpose + ' ' + fn.name);
      return relevance > 0.3;
    });

    for (const fn of relevantFunctions.slice(0, 10)) {
      const relevance = computeTextRelevance(taskDescription, fn.purpose + ' ' + fn.name);
      results.push({
        file: fn.filePath,
        relevance: `Function ${fn.name}: ${fn.purpose}`,
        score: relevance,
        entityId: fn.id,
        entityType: 'function',
      });
    }

    // Search modules
    const modules = await storage.getModules({ limit: 50 });
    const relevantModules = modules.filter((mod) => {
      const relevance = computeTextRelevance(taskDescription, mod.purpose + ' ' + mod.path);
      return relevance > 0.3;
    });

    for (const mod of relevantModules.slice(0, 5)) {
      const relevance = computeTextRelevance(taskDescription, mod.purpose + ' ' + mod.path);
      results.push({
        file: mod.path,
        relevance: `Module: ${mod.purpose}`,
        score: relevance,
        entityId: mod.id,
        entityType: 'module',
      });
    }
  } catch {
    // Storage may not have all methods implemented
  }

  // Sort by relevance score
  results.sort((a, b) => b.score - a.score);

  // Deduplicate by file path
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.file)) return false;
    seen.add(r.file);
    return true;
  });
}

async function identifyAffectedAreas(
  storage: LibrarianStorage,
  taskDescription: string,
  context: RelevantContext[],
  workspace: string
): Promise<AffectedAreas> {
  const files: AffectedFile[] = [];
  const modules: string[] = [];
  const patterns: string[] = [];

  // Extract likely file paths from context
  for (const ctx of context.slice(0, 10)) {
    const exists = await fileExists(ctx.file);
    files.push({
      path: ctx.file,
      exists,
      reason: ctx.relevance,
      isTest: isTestFile(ctx.file),
    });

    // Track module patterns
    const modulePath = path.dirname(ctx.file);
    if (!modules.includes(modulePath)) {
      modules.push(modulePath);
    }
  }

  // Identify patterns from task description
  const taskLower = taskDescription.toLowerCase();
  if (taskLower.includes('api')) patterns.push('api');
  if (taskLower.includes('storage') || taskLower.includes('database')) patterns.push('storage');
  if (taskLower.includes('query')) patterns.push('query');
  if (taskLower.includes('cache') || taskLower.includes('caching')) patterns.push('cache');
  if (taskLower.includes('auth') || taskLower.includes('security')) patterns.push('security');
  if (taskLower.includes('test')) patterns.push('test');
  if (taskLower.includes('config')) patterns.push('config');

  // Try to identify additional affected files from graph edges
  try {
    const sourceFiles = files.map((f) => f.path);
    if (sourceFiles.length > 0) {
      const edges = await storage.getGraphEdges({ sourceFiles, limit: 50 });
      for (const edge of edges) {
        if (edge.toType === 'file' || edge.toType === 'module') {
          const edgePath = edge.toId;
          if (!files.some((f) => f.path === edgePath)) {
            files.push({
              path: edgePath,
              exists: true, // Assume exists if in graph
              reason: `Referenced via ${edge.edgeType} relationship`,
              isTest: isTestFile(edgePath),
            });
          }
        }
      }
    }
  } catch {
    // Graph edges may not be available
  }

  return { files, modules, patterns };
}

function calculateComplexity(areas: AffectedAreas, taskType: TaskType): TaskComplexity {
  const fileCount = areas.files.length;
  const moduleCount = areas.modules.length;

  // Task type modifiers
  const typeModifier: Record<TaskType, number> = {
    bug_fix: 0,
    feature_add: 2,
    feature_modify: 1,
    refactor: 2,
    performance: 2,
    security: 3,
    documentation: -1,
    test: 0,
    dependency_update: 1,
    configuration: -1,
  };

  const baseScore = fileCount + moduleCount * 2 + (typeModifier[taskType] || 0);

  if (baseScore <= 2) return 'trivial';
  if (baseScore <= 5) return 'simple';
  if (baseScore <= 10) return 'moderate';
  if (baseScore <= 20) return 'complex';
  return 'epic';
}

function generateSteps(
  taskType: TaskType,
  affectedAreas: AffectedAreas,
  context: RelevantContext[]
): TaskStep[] {
  const steps: TaskStep[] = [];
  let order = 1;

  // Step 1: Understand context
  steps.push({
    order: order++,
    action: 'read',
    target: 'context files',
    details: `Read and understand ${context.length} relevant files to grasp the current implementation`,
    dependencies: [],
    verification: 'Can explain how the current implementation works',
  });

  // Step 2: Write tests first (TDD) - for most task types
  if (!['documentation', 'configuration'].includes(taskType)) {
    steps.push({
      order: order++,
      action: 'write',
      target: 'test files',
      details: 'Write failing tests that define the expected behavior before implementation',
      dependencies: [1],
      verification: 'Tests exist and fail with appropriate error messages',
    });
  }

  // Step 3: Type-specific implementation steps
  // Note: order++ increments AFTER returning the current value, so when we push
  // a step with order: order++, we're assigning the current order and then incrementing.
  // After the push, `order` equals step.order + 1.
  switch (taskType) {
    case 'bug_fix': {
      const investigateStep = order++;
      steps.push({
        order: investigateStep,
        action: 'investigate',
        target: 'bug root cause',
        details: 'Identify the exact location and cause of the bug',
        dependencies: [1],
        verification: 'Root cause is documented and reproducible',
      });
      const fixStep = order++;
      steps.push({
        order: fixStep,
        action: 'modify',
        target: 'source files',
        details: `Fix the bug in ${affectedAreas.files.filter((f) => !f.isTest).length} affected files`,
        dependencies: [2, investigateStep],
        verification: 'Bug no longer reproduces',
      });
      break;
    }

    case 'feature_add': {
      const designStep = order++;
      steps.push({
        order: designStep,
        action: 'design',
        target: 'feature architecture',
        details: 'Design the feature structure and interfaces',
        dependencies: [1],
        verification: 'Design documented with clear interfaces',
      });
      const createStep = order++;
      steps.push({
        order: createStep,
        action: 'create',
        target: 'new files',
        details: `Create new files for the feature implementation`,
        dependencies: [designStep, 2],
        verification: 'New files created with proper structure',
      });
      const integrateStep = order++;
      steps.push({
        order: integrateStep,
        action: 'integrate',
        target: 'existing code',
        details: 'Integrate new feature with existing codebase',
        dependencies: [createStep],
        verification: 'Feature is accessible and functional',
      });
      break;
    }

    case 'refactor': {
      const identifyStep = order++;
      steps.push({
        order: identifyStep,
        action: 'identify',
        target: 'refactoring targets',
        details: 'Identify specific code sections to refactor',
        dependencies: [1],
        verification: 'Refactoring scope is clearly defined',
      });
      const modifyStep = order++;
      steps.push({
        order: modifyStep,
        action: 'modify',
        target: 'source files',
        details: `Refactor code in ${affectedAreas.files.filter((f) => !f.isTest).length} files`,
        dependencies: [identifyStep, 2],
        verification: 'Code is cleaner, existing tests still pass',
      });
      break;
    }

    default: {
      const implStep = order++;
      steps.push({
        order: implStep,
        action: 'modify',
        target: 'source files',
        details: `Implement changes in ${affectedAreas.files.filter((f) => !f.isTest).length} files`,
        dependencies: taskType !== 'documentation' && taskType !== 'configuration' ? [2] : [1],
        verification: 'Changes implemented correctly',
      });
    }
  }

  // Get the last implementation step for dependencies
  const lastImplStep = steps[steps.length - 1].order;

  // Final steps: Verification
  const testStep = order++;
  steps.push({
    order: testStep,
    action: 'verify',
    target: 'all tests',
    details: 'Run full test suite to check for regressions',
    dependencies: [lastImplStep],
    verification: 'All tests pass with no regressions',
  });

  const typeStep = order++;
  steps.push({
    order: typeStep,
    action: 'verify',
    target: 'type system',
    details: 'Run TypeScript compiler to check types',
    dependencies: [testStep],
    verification: 'No type errors',
  });

  const lintStep = order++;
  steps.push({
    order: lintStep,
    action: 'verify',
    target: 'lint rules',
    details: 'Run linter to ensure code style compliance',
    dependencies: [typeStep],
    verification: 'No lint errors',
  });

  return steps;
}

function identifyRisks(taskType: TaskType, affectedAreas: AffectedAreas): TaskRisk[] {
  const risks: TaskRisk[] = [];

  // General risks based on scope
  if (affectedAreas.files.length > 10) {
    risks.push({
      risk: 'Large number of files affected increases chance of unintended side effects',
      likelihood: 'medium',
      mitigation: 'Review each change carefully and ensure comprehensive test coverage',
    });
  }

  // Task type specific risks
  switch (taskType) {
    case 'refactor':
      risks.push({
        risk: 'Refactoring may break existing functionality',
        likelihood: 'medium',
        mitigation: 'Ensure existing tests pass before and after each change',
      });
      break;

    case 'security':
      risks.push({
        risk: 'Security changes may have unforeseen vulnerabilities',
        likelihood: 'high',
        mitigation: 'Get security review and conduct penetration testing',
      });
      break;

    case 'dependency_update':
      risks.push({
        risk: 'Dependency updates may introduce breaking changes',
        likelihood: 'high',
        mitigation: 'Check changelogs and run comprehensive tests',
      });
      risks.push({
        risk: 'New dependency versions may have different API',
        likelihood: 'medium',
        mitigation: 'Review migration guides and test all affected code paths',
      });
      break;

    case 'performance':
      risks.push({
        risk: 'Performance optimizations may reduce code readability',
        likelihood: 'medium',
        mitigation: 'Document optimizations and measure actual performance impact',
      });
      break;
  }

  // Pattern-specific risks
  if (affectedAreas.patterns.includes('api')) {
    risks.push({
      risk: 'API changes may break external consumers',
      likelihood: 'high',
      mitigation: 'Version API changes and provide migration path',
    });
  }

  if (affectedAreas.patterns.includes('storage')) {
    risks.push({
      risk: 'Storage changes may require data migration',
      likelihood: 'medium',
      mitigation: 'Plan data migration strategy and backup procedures',
    });
  }

  return risks;
}

function generateTestRequirements(
  taskType: TaskType,
  affectedAreas: AffectedAreas
): TestRequirement[] {
  const requirements: TestRequirement[] = [];

  // Generate test file paths for affected source files
  for (const file of affectedAreas.files.filter((f) => !f.isTest)) {
    const testFile = generateTestFilePath(file.path);
    const scenarios: string[] = [];

    switch (taskType) {
      case 'bug_fix':
        scenarios.push('Regression test for the specific bug');
        scenarios.push('Edge cases that could trigger similar bugs');
        break;

      case 'feature_add':
        scenarios.push('Happy path for new feature');
        scenarios.push('Error handling scenarios');
        scenarios.push('Edge cases and boundary conditions');
        break;

      case 'feature_modify':
        scenarios.push('Updated behavior works correctly');
        scenarios.push('Backward compatibility maintained');
        break;

      case 'refactor':
        scenarios.push('Existing functionality unchanged');
        scenarios.push('Performance not degraded');
        break;

      case 'security':
        scenarios.push('Security controls work correctly');
        scenarios.push('Attack vectors are blocked');
        scenarios.push('Error messages do not leak sensitive info');
        break;

      default:
        scenarios.push('Main functionality works correctly');
        scenarios.push('Error handling');
    }

    requirements.push({
      testFile,
      testType: 'unit',
      scenarios,
    });
  }

  // Add integration test if multiple modules affected
  if (affectedAreas.modules.length > 1) {
    requirements.push({
      testFile: 'src/__tests__/integration.test.ts',
      testType: 'integration',
      scenarios: [
        'Components work together correctly',
        'Data flows correctly between modules',
      ],
    });
  }

  return requirements;
}

function generatePreflightChecks(taskType: TaskType, affectedAreas: AffectedAreas): string[] {
  const checks = [
    'Ensure working directory is clean (git status)',
    'Run existing tests to establish baseline',
    'Review affected files for understanding',
  ];

  if (taskType === 'dependency_update') {
    checks.push('Backup package-lock.json');
    checks.push('Check for breaking changes in dependency changelogs');
    checks.push('Review security advisories for new versions');
  }

  if (affectedAreas.patterns.includes('api')) {
    checks.push('Review API contract for breaking changes');
    checks.push('Check if API versioning is needed');
  }

  if (affectedAreas.patterns.includes('storage')) {
    checks.push('Consider data migration requirements');
    checks.push('Plan rollback strategy for database changes');
  }

  if (affectedAreas.patterns.includes('security')) {
    checks.push('Review security implications');
    checks.push('Check for credential or secret exposure');
  }

  if (taskType === 'refactor') {
    checks.push('Ensure test coverage is adequate before starting');
    checks.push('Plan incremental changes that can be reverted');
  }

  return checks;
}

function calculateRiskLevel(risks: TaskRisk[]): RiskLevel {
  if (risks.length === 0) return 'low';

  const highRisks = risks.filter((r) => r.likelihood === 'high').length;
  const mediumRisks = risks.filter((r) => r.likelihood === 'medium').length;

  if (highRisks >= 2 || (highRisks >= 1 && mediumRisks >= 2)) {
    return 'high';
  }
  if (highRisks >= 1 || mediumRisks >= 2) {
    return 'medium';
  }
  return 'low';
}

function calculatePlanConfidence(
  context: RelevantContext[],
  areas: AffectedAreas
): number {
  // Base confidence
  let confidence = 0.5;

  // Boost for having relevant context
  if (context.length > 0) {
    confidence += Math.min(0.2, context.length * 0.04);
  }

  // Boost for high-relevance context
  const highRelevance = context.filter((c) => c.score > 0.7).length;
  confidence += Math.min(0.15, highRelevance * 0.05);

  // Reduce for large scope
  if (areas.files.length > 20) {
    confidence -= 0.1;
  }

  // Reduce if many files don't exist (uncertain scope)
  const missingFiles = areas.files.filter((f) => !f.exists).length;
  if (missingFiles > areas.files.length * 0.5) {
    confidence -= 0.1;
  }

  return Math.max(0.1, Math.min(0.95, confidence));
}

function computeTextRelevance(query: string, text: string): number {
  const queryWords = query.toLowerCase().split(/\s+/);
  const textWords = text.toLowerCase().split(/\s+/);
  const textSet = new Set(textWords);

  let matches = 0;
  for (const word of queryWords) {
    if (word.length > 2 && textSet.has(word)) {
      matches++;
    }
  }

  return queryWords.length > 0 ? matches / queryWords.length : 0;
}

function isTestFile(filePath: string): boolean {
  const patterns = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /__tests__\//,
    /\/test\//,
    /\/tests\//,
  ];
  return patterns.some((p) => p.test(filePath));
}

function generateTestFilePath(sourcePath: string): string {
  // Convert source path to test path
  const dir = path.dirname(sourcePath);
  const ext = path.extname(sourcePath);
  const base = path.basename(sourcePath, ext);

  // Check if there's already a __tests__ directory nearby
  if (dir.includes('src/')) {
    const srcIndex = dir.indexOf('src/');
    const relPath = dir.slice(srcIndex);
    return path.join(relPath.replace('/src/', '/src/__tests__/'), `${base}.test${ext}`);
  }

  return path.join(dir, '__tests__', `${base}.test${ext}`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
