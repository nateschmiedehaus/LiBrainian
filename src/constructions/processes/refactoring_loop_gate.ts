import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';
import { reviewChangeSet, type ReviewCategory, type ReviewIssue } from '../../api/code_review.js';

export type RefactoringLoopCategory =
  | 'error_handling'
  | 'validation'
  | 'documentation'
  | 'testing'
  | 'observability'
  | 'depth';

export type RefactoringLoopSeverity = 'must_fix' | 'should_fix';
export type RefactoringLoopLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface RefactoringLoopPeerExample {
  functionId: string;
  snippet: string;
  explanation: string;
}

export interface RefactoringLoopImprovement {
  category: RefactoringLoopCategory;
  issue: string;
  severity: RefactoringLoopSeverity;
  peerExample: RefactoringLoopPeerExample;
  suggestedFix: string;
}

export interface RefactoringLoopLevelResult {
  level: RefactoringLoopLevel;
  pass: boolean;
  evidence: string[];
}

export interface RefactoringLoopGateInput {
  workspace: string;
  changedFiles: string[];
  iteration?: number;
  maxIterations?: number;
  gateLevel?: 2 | 4;
  l0CompilationPassed?: boolean;
  l1TestsPassed?: boolean;
  l2ScoreFloor?: number;
  l3PeerDepthPercentile?: number;
  l3PeerDepthFloor?: number;
  l4AgenticUtilityDelta?: number;
  l4AgenticUtilityFloor?: number;
  overrideJustification?: string;
}

export interface RefactoringLoopResult {
  kind: 'RefactoringLoopResult.v1';
  pass: boolean;
  overrideApplied: boolean;
  overrideAvailable: boolean;
  iteration: number;
  maxIterations: number;
  escalateToHuman: boolean;
  failedLevels: RefactoringLoopLevel[];
  levelResults: RefactoringLoopLevelResult[];
  requiredImprovements: RefactoringLoopImprovement[];
  summary: string;
}

const CODE_FILE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/iu;
const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_L2_SCORE_FLOOR = 60;
const DEFAULT_L3_PEER_DEPTH_FLOOR = 0.25;
const DEFAULT_L4_AGENTIC_UTILITY_FLOOR = 0;

const DEFAULT_PEER_EXAMPLES: Record<RefactoringLoopCategory, RefactoringLoopPeerExample> = {
  error_handling: {
    functionId: 'peer:error_handling.try_catch',
    snippet: `try {\n  const result = await runTask();\n  return result;\n} catch (error) {\n  throw new Error('Task failed: ' + String(error));\n}`,
    explanation: 'Peer implementations wrap risky async calls with explicit failure handling.',
  },
  validation: {
    functionId: 'peer:validation.input_guard',
    snippet: `if (!input || input.id.trim().length === 0) {\n  throw new Error('input.id is required');\n}`,
    explanation: 'Peer implementations validate boundary inputs before continuing.',
  },
  documentation: {
    functionId: 'peer:documentation.jsdoc',
    snippet: `/**\n * Updates the task ledger.\n * @param taskId Stable task identifier.\n */`,
    explanation: 'Peer implementations document public behavior and assumptions.',
  },
  testing: {
    functionId: 'peer:testing.regression',
    snippet: `it('handles timeout errors', async () => {\n  await expect(run()).rejects.toThrow('timeout');\n});`,
    explanation: 'Peer implementations add regression tests for each bug/failure mode.',
  },
  observability: {
    functionId: 'peer:observability.structured_log',
    snippet: `logInfo('task_complete', { taskId, durationMs, success: true });`,
    explanation: 'Peer implementations emit structured telemetry for debugging and triage.',
  },
  depth: {
    functionId: 'peer:depth.extracted_helper',
    snippet: `const normalized = normalizeInput(input);\nconst decision = choosePlan(normalized);\nreturn applyPlan(decision);`,
    explanation: 'Peer implementations split complex logic into explicit helper steps.',
  },
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toLoopCategory(category: ReviewCategory): RefactoringLoopCategory {
  switch (category) {
    case 'error_handling':
      return 'error_handling';
    case 'documentation':
      return 'documentation';
    case 'testing':
      return 'testing';
    case 'performance':
      return 'depth';
    case 'maintainability':
    case 'readability':
    case 'naming':
    case 'best_practices':
      return 'depth';
    case 'type_safety':
      return 'validation';
    case 'security':
      return 'validation';
    default:
      return 'observability';
  }
}

function toImprovementSeverity(issue: ReviewIssue): RefactoringLoopSeverity {
  if (issue.severity === 'critical' || issue.severity === 'major') return 'must_fix';
  return 'should_fix';
}

function addImprovement(
  improvements: RefactoringLoopImprovement[],
  candidate: RefactoringLoopImprovement
): void {
  const key = `${candidate.category}:${candidate.issue.toLowerCase()}`;
  const existingKeys = new Set(improvements.map((item) => `${item.category}:${item.issue.toLowerCase()}`));
  if (!existingKeys.has(key)) improvements.push(candidate);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function normalizeChangedFiles(workspace: string, files: string[]): Promise<string[]> {
  const resolved = files
    .map((file) => (path.isAbsolute(file) ? file : path.resolve(workspace, file)))
    .filter((file) => CODE_FILE_PATTERN.test(file));

  const existing: string[] = [];
  for (const file of resolved) {
    if (await fileExists(file)) existing.push(file);
  }

  return unique(existing);
}

async function estimatePeerDepthPercentile(files: string[]): Promise<number> {
  if (files.length === 0) return 1;

  let aggregate = 0;
  let measured = 0;

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf8');
      const lineCount = content.split('\n').filter((line) => line.trim().length > 0).length;
      const branchCount = (content.match(/\b(if|switch|for|while|catch)\b/gu) ?? []).length;
      const helperCount = (content.match(/\b(?:function|const)\s+\w+/gu) ?? []).length;
      const docCount = (content.match(/\/\*\*[\s\S]*?\*\//gu) ?? []).length;
      const normalizedComplexity = clamp01((branchCount + helperCount + (docCount * 0.5)) / Math.max(8, lineCount / 8));
      aggregate += normalizedComplexity;
      measured += 1;
    } catch {
      // Ignore unreadable files.
    }
  }

  if (measured === 0) return 0;
  return clamp01(aggregate / measured);
}

function buildLevelFailureImprovement(level: RefactoringLoopLevel): RefactoringLoopImprovement {
  if (level === 'L0') {
    return {
      category: 'validation',
      issue: 'Compilation/typecheck gate failed.',
      severity: 'must_fix',
      peerExample: DEFAULT_PEER_EXAMPLES.validation,
      suggestedFix: 'Resolve TypeScript/compiler errors before proceeding.',
    };
  }
  if (level === 'L1') {
    return {
      category: 'testing',
      issue: 'Test gate failed.',
      severity: 'must_fix',
      peerExample: DEFAULT_PEER_EXAMPLES.testing,
      suggestedFix: 'Fix failing tests and add/adjust regression tests for changed behavior.',
    };
  }
  if (level === 'L3') {
    return {
      category: 'depth',
      issue: 'Implementation depth is below the peer baseline.',
      severity: 'must_fix',
      peerExample: DEFAULT_PEER_EXAMPLES.depth,
      suggestedFix: 'Refine implementation structure to match peer depth (clear helpers, guards, and decomposition).',
    };
  }
  return {
    category: 'observability',
    issue: 'Agentic utility regressed relative to baseline.',
    severity: 'must_fix',
    peerExample: DEFAULT_PEER_EXAMPLES.observability,
    suggestedFix: 'Revise the change to preserve or improve agent task success and context utility.',
  };
}

export function createRefactoringLoopGateConstruction(): Construction<
  RefactoringLoopGateInput,
  RefactoringLoopResult,
  ConstructionError,
  unknown
> {
  return {
    id: 'refactoring-loop-gate',
    name: 'Refactoring Loop Gate',
    description: 'Rejects substandard code and returns targeted improvement guidance until quality gates pass.',
    async execute(input: RefactoringLoopGateInput): Promise<RefactoringLoopResult> {
      const iteration = Math.max(1, input.iteration ?? 1);
      const maxIterations = Math.max(1, input.maxIterations ?? DEFAULT_MAX_ITERATIONS);
      const maxLevel = input.gateLevel === 2 ? 2 : 4;
      const l2ScoreFloor = input.l2ScoreFloor ?? DEFAULT_L2_SCORE_FLOOR;
      const l3Floor = input.l3PeerDepthFloor ?? DEFAULT_L3_PEER_DEPTH_FLOOR;
      const l4Floor = input.l4AgenticUtilityFloor ?? DEFAULT_L4_AGENTIC_UTILITY_FLOOR;

      const changedFiles = await normalizeChangedFiles(input.workspace, input.changedFiles ?? []);
      const levelResults: RefactoringLoopLevelResult[] = [];
      const improvements: RefactoringLoopImprovement[] = [];

      const l0Pass = input.l0CompilationPassed !== false;
      levelResults.push({
        level: 'L0',
        pass: l0Pass,
        evidence: [l0Pass ? 'Compilation gate passed.' : 'Compilation gate failed.'],
      });
      if (!l0Pass) addImprovement(improvements, buildLevelFailureImprovement('L0'));

      const l1Pass = input.l1TestsPassed !== false;
      levelResults.push({
        level: 'L1',
        pass: l1Pass,
        evidence: [l1Pass ? 'Test gate passed.' : 'Test gate failed.'],
      });
      if (!l1Pass) addImprovement(improvements, buildLevelFailureImprovement('L1'));

      let l2Pass = true;
      let reviewScore = 100;
      let criticalIssues = 0;
      if (changedFiles.length > 0) {
        const review = await reviewChangeSet(null, changedFiles, { projectRoot: input.workspace });
        reviewScore = review.overallScore;
        criticalIssues = review.issueCounts.critical;
        l2Pass = criticalIssues === 0 && reviewScore >= l2ScoreFloor;
        if (!l2Pass) {
          for (const issue of review.fileReviews.flatMap((fileReview) => fileReview.issues)) {
            const category = toLoopCategory(issue.category);
            addImprovement(improvements, {
              category,
              issue: issue.message,
              severity: toImprovementSeverity(issue),
              peerExample: DEFAULT_PEER_EXAMPLES[category],
              suggestedFix: issue.suggestion ?? 'Address this review finding before proceeding.',
            });
          }
        }
      }

      levelResults.push({
        level: 'L2',
        pass: l2Pass,
        evidence: changedFiles.length === 0
          ? ['No changed code files found; L2 quality check skipped.']
          : [
            `Code review score: ${reviewScore}/100 (floor: ${l2ScoreFloor}).`,
            `Critical review issues: ${criticalIssues}.`,
          ],
      });
      if (!l2Pass && improvements.length === 0) {
        addImprovement(improvements, {
          category: 'depth',
          issue: `Code review score ${reviewScore}/100 is below floor ${l2ScoreFloor}/100.`,
          severity: 'must_fix',
          peerExample: DEFAULT_PEER_EXAMPLES.depth,
          suggestedFix: 'Refine structure and robustness until review score reaches the floor.',
        });
      }

      if (maxLevel >= 3) {
        const l3PeerDepthPercentile = input.l3PeerDepthPercentile ?? await estimatePeerDepthPercentile(changedFiles);
        const l3Pass = l3PeerDepthPercentile >= l3Floor;
        levelResults.push({
          level: 'L3',
          pass: l3Pass,
          evidence: [
            `Peer depth percentile: ${l3PeerDepthPercentile.toFixed(3)} (floor: ${l3Floor.toFixed(3)}).`,
          ],
        });
        if (!l3Pass) addImprovement(improvements, buildLevelFailureImprovement('L3'));
      }

      if (maxLevel >= 4) {
        const l4AgenticUtilityDelta = input.l4AgenticUtilityDelta ?? 0;
        const l4Pass = l4AgenticUtilityDelta >= l4Floor;
        levelResults.push({
          level: 'L4',
          pass: l4Pass,
          evidence: [
            `Agentic utility delta: ${l4AgenticUtilityDelta.toFixed(3)} (floor: ${l4Floor.toFixed(3)}).`,
          ],
        });
        if (!l4Pass) addImprovement(improvements, buildLevelFailureImprovement('L4'));
      }

      const failedLevels = levelResults.filter((result) => !result.pass).map((result) => result.level);
      const overrideApplied = failedLevels.length > 0 && Boolean(input.overrideJustification?.trim());
      const pass = failedLevels.length === 0 || overrideApplied;
      const escalateToHuman = failedLevels.length > 0 && !overrideApplied && iteration >= maxIterations;

      const summary = pass
        ? (overrideApplied
          ? `Gate override applied at iteration ${iteration}/${maxIterations}.`
          : `All gates passed at iteration ${iteration}/${maxIterations}.`)
        : (escalateToHuman
          ? `Gate failed after ${iteration}/${maxIterations} iterations; human escalation required.`
          : `Gate failed at iteration ${iteration}/${maxIterations}; repair cycle required.`);

      return {
        kind: 'RefactoringLoopResult.v1',
        pass,
        overrideApplied,
        overrideAvailable: failedLevels.length > 0,
        iteration,
        maxIterations,
        escalateToHuman,
        failedLevels,
        levelResults,
        requiredImprovements: improvements,
        summary,
      };
    },
  };
}
