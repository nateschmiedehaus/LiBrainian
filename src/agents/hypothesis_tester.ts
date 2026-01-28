/**
 * @fileoverview Hypothesis Tester Agent
 *
 * Implements deterministic hypothesis testing for the Scientific Loop.
 * Uses heuristic-based approach (no LLM calls) for Tier-0 compatibility.
 *
 * For each HypothesisTest type:
 * - code_inspection -> Check if target file/function exists, parse and analyze
 * - test_run -> Execute test command (via CommandRunner if available), check exit code
 * - log_analysis -> Parse provided logs/output for expected patterns
 * - behavioral -> Compare actual vs expected behavior from evidence
 */

import type {
  HypothesisTesterAgent,
  AgentCapability,
  Hypothesis,
  HypothesisTesterInput,
  HypothesisTestResult,
  HypothesisTestVerdict,
  HypothesisTestRecommendation,
  TestEvidence,
  TestEvidenceType,
  Problem,
  CommandRunner,
  HypothesisLikelihood,
} from './types.js';
import type { LibrarianStorage } from '../storage/types.js';

/**
 * Configuration for the HypothesisTester agent.
 */
export interface HypothesisTesterConfig {
  /** Confidence threshold to consider a hypothesis supported (default 0.5) */
  supportedThreshold?: number;
  /** Confidence threshold to consider a hypothesis refuted (default 0.3) */
  refutedThreshold?: number;
}

const DEFAULT_CONFIG: Required<HypothesisTesterConfig> = {
  supportedThreshold: 0.5,
  refutedThreshold: 0.3,
};

/**
 * Keywords that indicate various test outcomes when found in evidence.
 */
const POSITIVE_INDICATORS: Record<string, string[]> = {
  assertion: ['assertion', 'assert', 'expect', 'expected', 'should'],
  error: ['error', 'err', 'exception', 'throw', 'thrown'],
  timeout: ['timeout', 'timed out', 'ETIMEDOUT', 'deadline'],
  deprecation: ['deprecated', 'WARN deprecated', 'warning: deprecated'],
  breaking: ['breaking', 'incompatible', 'mismatch', 'breaking change'],
  stale: ['stale', 'cache', 'cached', 'outdated', 'old_value'],
  network: ['network', 'connection', 'ECONNREFUSED', 'fetch', 'http'],
  type: ['type', 'TypeError', 'type mismatch', 'TS2'],
  null: ['null', 'undefined', 'Cannot read property'],
};

/**
 * HypothesisTester implementation.
 * Uses heuristic analysis to test hypotheses without LLM calls.
 */
export class HypothesisTester implements HypothesisTesterAgent {
  readonly agentType = 'hypothesis_tester';
  readonly name = 'Hypothesis Tester';
  readonly capabilities: readonly AgentCapability[] = ['hypothesis_testing'];
  readonly version = '1.0.0';
  readonly qualityTier = 'full' as const;

  private storage: LibrarianStorage | null = null;
  private config: Required<HypothesisTesterConfig>;
  private commandRunner: CommandRunner | null = null;

  constructor(config: HypothesisTesterConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(storage: LibrarianStorage): Promise<void> {
    this.storage = storage;
  }

  isReady(): boolean {
    return this.storage !== null;
  }

  async shutdown(): Promise<void> {
    this.storage = null;
  }

  /**
   * Set the command runner for executing test commands.
   * When set, tests with type 'test_run' will execute the command.
   */
  setCommandRunner(runner: CommandRunner): void {
    this.commandRunner = runner;
  }

  /**
   * Get the current command runner (if any).
   */
  getCommandRunner(): CommandRunner | null {
    return this.commandRunner;
  }

  /**
   * Test a hypothesis to determine if it's supported, refuted, or inconclusive.
   * Uses heuristic-based approach based on test type and available evidence.
   */
  async testHypothesis(input: HypothesisTesterInput): Promise<HypothesisTestResult> {
    const { hypothesis, problem, codebaseContext: _codebaseContext } = input;

    let evidence: TestEvidence[] = [];
    let matchScore = 0;
    let wasTestable = true;

    // Execute the appropriate test based on hypothesis.test.type
    switch (hypothesis.test.type) {
      case 'code_inspection':
        evidence = this.performCodeInspection(hypothesis, problem);
        matchScore = this.calculateCodeInspectionScore(hypothesis, problem);
        // code_inspection without actual file access is not truly testable
        // since we can't actually inspect the code files
        wasTestable = false;
        break;

      case 'test_run':
        const runResult = await this.performTestRun(hypothesis, problem);
        evidence = runResult.evidence;
        matchScore = runResult.matchScore;
        wasTestable = runResult.wasTestable;
        break;

      case 'log_analysis':
        evidence = this.performLogAnalysis(hypothesis, problem);
        matchScore = this.calculateLogAnalysisScore(hypothesis, problem);
        break;

      case 'behavioral':
        evidence = this.performBehavioralAnalysis(hypothesis, problem);
        matchScore = this.calculateBehavioralScore(hypothesis, problem);
        break;

      default:
        evidence = [
          {
            type: hypothesis.test.type as TestEvidenceType,
            finding: `Unknown test type: ${hypothesis.test.type}`,
            implication: 'Cannot perform analysis for this test type',
          },
        ];
        matchScore = 0;
        wasTestable = false;
    }

    // Calculate confidence based on match score and hypothesis likelihood
    const confidence = this.calculateConfidence(matchScore, hypothesis.likelihood, problem);

    // Determine verdict based on confidence and thresholds
    const verdict = this.determineVerdict(confidence, evidence.length, wasTestable);

    // Determine recommendation based on verdict
    const recommendation = this.determineRecommendation(verdict, confidence);

    return {
      hypothesisId: hypothesis.id,
      verdict,
      evidence,
      confidence,
      recommendation,
    };
  }

  /**
   * Perform code inspection analysis.
   * Without actual file access, analyzes problem evidence for code-related patterns.
   */
  private performCodeInspection(hypothesis: Hypothesis, problem: Problem): TestEvidence[] {
    const evidence: TestEvidence[] = [];

    // Without actual file access, we analyze the problem evidence
    if (problem.evidence.length === 0) {
      evidence.push({
        type: 'code_inspection',
        finding: `No evidence available to inspect for target: ${hypothesis.test.target}`,
        implication: 'Cannot verify hypothesis without examining actual code',
      });
      return evidence;
    }

    // Look for patterns in the evidence that relate to the expected finding
    const expectedLower = hypothesis.test.expected.toLowerCase();
    const relevantEvidence = problem.evidence.filter(
      (e) =>
        e.toLowerCase().includes(expectedLower) ||
        this.hasRelatedKeywords(e, expectedLower)
    );

    if (relevantEvidence.length > 0) {
      evidence.push({
        type: 'code_inspection',
        finding: `Found ${relevantEvidence.length} evidence items matching expected pattern`,
        implication: `Evidence suggests ${hypothesis.statement}`,
      });
      for (const item of relevantEvidence.slice(0, 3)) {
        evidence.push({
          type: 'code_inspection',
          finding: item.substring(0, 200),
          implication: 'Matches hypothesis prediction pattern',
        });
      }
    } else {
      evidence.push({
        type: 'code_inspection',
        finding: `No evidence found matching expected: ${hypothesis.test.expected}`,
        implication: 'Evidence does not support code inspection hypothesis',
      });
    }

    return evidence;
  }

  /**
   * Calculate match score for code inspection.
   */
  private calculateCodeInspectionScore(hypothesis: Hypothesis, problem: Problem): number {
    if (problem.evidence.length === 0) return 0;

    const expectedLower = hypothesis.test.expected.toLowerCase();
    let matches = 0;

    for (const e of problem.evidence) {
      if (
        e.toLowerCase().includes(expectedLower) ||
        this.hasRelatedKeywords(e, expectedLower)
      ) {
        matches++;
      }
    }

    return matches > 0 ? Math.min(matches / problem.evidence.length + 0.3, 1.0) : 0;
  }

  /**
   * Perform test run analysis.
   * Uses CommandRunner if available, otherwise marks as inconclusive.
   */
  private async performTestRun(
    hypothesis: Hypothesis,
    _problem: Problem
  ): Promise<{ evidence: TestEvidence[]; matchScore: number; wasTestable: boolean }> {
    const evidence: TestEvidence[] = [];
    let matchScore = 0;
    let wasTestable = true;

    if (!this.commandRunner) {
      evidence.push({
        type: 'test_run',
        finding: `Cannot execute test: ${hypothesis.test.target} - no CommandRunner available`,
        implication: 'Test execution not possible without CommandRunner',
      });
      return { evidence, matchScore: 0, wasTestable: false };
    }

    try {
      const result = await this.commandRunner({
        command: hypothesis.test.target,
      });

      evidence.push({
        type: 'test_run',
        finding: `Command exited with code ${result.exitCode}`,
        implication: result.exitCode === 0 ? 'Test passed successfully' : 'Test failed',
      });

      if (result.stderr) {
        evidence.push({
          type: 'test_run',
          finding: result.stderr.substring(0, 500),
          implication: 'Error output from test execution',
        });
      }

      if (result.stdout) {
        evidence.push({
          type: 'test_run',
          finding: result.stdout.substring(0, 500),
          implication: 'Standard output from test execution',
        });
      }

      // Calculate match score based on whether the output matches expected
      const expectedLower = hypothesis.test.expected.toLowerCase();
      const combined = (result.stdout + ' ' + result.stderr).toLowerCase();

      if (combined.includes(expectedLower) || this.hasRelatedKeywords(combined, expectedLower)) {
        matchScore = 0.8;
      } else if (result.exitCode !== 0) {
        // Test failed, could still support some hypotheses
        matchScore = 0.4;
      } else {
        matchScore = 0.2;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      evidence.push({
        type: 'test_run',
        finding: `Command execution failed: ${errorMsg}`,
        implication: 'Unable to complete test run due to execution error',
      });
      matchScore = 0;
      wasTestable = false;
    }

    return { evidence, matchScore, wasTestable };
  }

  /**
   * Perform log analysis.
   * Parses provided logs/output for expected patterns.
   */
  private performLogAnalysis(hypothesis: Hypothesis, problem: Problem): TestEvidence[] {
    const evidence: TestEvidence[] = [];
    const expectedLower = hypothesis.test.expected.toLowerCase();

    // Analyze problem evidence as logs
    for (const logEntry of problem.evidence) {
      const logLower = logEntry.toLowerCase();

      if (logLower.includes(expectedLower) || this.hasRelatedKeywords(logEntry, expectedLower)) {
        evidence.push({
          type: 'log_analysis',
          finding: logEntry.substring(0, 300),
          implication: `Log entry matches expected pattern: ${hypothesis.test.expected}`,
        });
      }
    }

    // Also check the problem description
    if (
      problem.description.toLowerCase().includes(expectedLower) ||
      this.hasRelatedKeywords(problem.description, expectedLower)
    ) {
      evidence.push({
        type: 'log_analysis',
        finding: `Problem description contains pattern: ${hypothesis.test.expected}`,
        implication: 'Description suggests hypothesis may be correct',
      });
    }

    if (evidence.length === 0) {
      evidence.push({
        type: 'log_analysis',
        finding: `No log entries matching expected: ${hypothesis.test.expected}`,
        implication: 'Available logs do not support this hypothesis',
      });
    }

    return evidence;
  }

  /**
   * Calculate match score for log analysis.
   */
  private calculateLogAnalysisScore(hypothesis: Hypothesis, problem: Problem): number {
    const expectedLower = hypothesis.test.expected.toLowerCase();
    let matches = 0;
    let total = problem.evidence.length + 1; // +1 for description

    for (const logEntry of problem.evidence) {
      if (
        logEntry.toLowerCase().includes(expectedLower) ||
        this.hasRelatedKeywords(logEntry, expectedLower)
      ) {
        matches++;
      }
    }

    if (
      problem.description.toLowerCase().includes(expectedLower) ||
      this.hasRelatedKeywords(problem.description, expectedLower)
    ) {
      matches++;
    }

    return total > 0 ? matches / total : 0;
  }

  /**
   * Perform behavioral analysis.
   * Compares actual vs expected behavior from evidence.
   */
  private performBehavioralAnalysis(hypothesis: Hypothesis, problem: Problem): TestEvidence[] {
    const evidence: TestEvidence[] = [];

    // Look for actual/expected patterns in evidence
    let actualValue: string | null = null;
    let expectedValue: string | null = null;

    for (const e of problem.evidence) {
      const lower = e.toLowerCase();
      if (lower.includes('actual:') || lower.includes('actual =')) {
        actualValue = e;
      }
      if (lower.includes('expected:') || lower.includes('expected =')) {
        expectedValue = e;
      }
    }

    if (actualValue && expectedValue) {
      evidence.push({
        type: 'behavioral',
        finding: `Found actual/expected comparison: ${actualValue} vs ${expectedValue}`,
        implication: 'Behavioral mismatch detected',
      });
    }

    // Check if the expected behavior from hypothesis matches evidence
    const expectedLower = hypothesis.test.expected.toLowerCase();
    const hasMatch = problem.evidence.some(
      (e) =>
        e.toLowerCase().includes(expectedLower) ||
        this.hasRelatedKeywords(e, expectedLower)
    );

    if (hasMatch) {
      evidence.push({
        type: 'behavioral',
        finding: `Evidence matches expected behavioral pattern: ${hypothesis.test.expected}`,
        implication: 'Observed behavior aligns with hypothesis prediction',
      });
    } else if (evidence.length === 0) {
      evidence.push({
        type: 'behavioral',
        finding: `No behavioral evidence matching: ${hypothesis.test.expected}`,
        implication: 'Cannot confirm behavioral hypothesis from available evidence',
      });
    }

    return evidence;
  }

  /**
   * Calculate match score for behavioral analysis.
   */
  private calculateBehavioralScore(hypothesis: Hypothesis, problem: Problem): number {
    let score = 0;
    const expectedLower = hypothesis.test.expected.toLowerCase();

    // Check for actual/expected patterns
    let hasActual = false;
    let hasExpected = false;

    for (const e of problem.evidence) {
      const lower = e.toLowerCase();
      if (lower.includes('actual:') || lower.includes('actual =')) hasActual = true;
      if (lower.includes('expected:') || lower.includes('expected =')) hasExpected = true;
      if (
        lower.includes(expectedLower) ||
        this.hasRelatedKeywords(e, expectedLower)
      ) {
        score += 0.3;
      }
    }

    if (hasActual && hasExpected) score += 0.4;

    return Math.min(score, 1.0);
  }

  /**
   * Check if text has keywords related to the expected pattern.
   */
  private hasRelatedKeywords(text: string, expected: string): boolean {
    const textLower = text.toLowerCase();

    // Check each category of indicators
    for (const [category, keywords] of Object.entries(POSITIVE_INDICATORS)) {
      // If expected mentions this category
      if (expected.includes(category)) {
        // Check if text has any of these keywords
        if (keywords.some((kw) => textLower.includes(kw))) {
          return true;
        }
      }
    }

    // Also check if any keywords in expected are found in text
    const expectedWords = expected.split(/\s+/).filter((w) => w.length > 3);
    for (const word of expectedWords) {
      if (textLower.includes(word)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate confidence score based on match, likelihood, and problem reproducibility.
   */
  private calculateConfidence(
    matchScore: number,
    likelihood: HypothesisLikelihood,
    problem: Problem
  ): number {
    // Base confidence from match score
    let confidence = matchScore;

    // Adjust based on hypothesis likelihood
    const likelihoodBoost: Record<HypothesisLikelihood, number> = {
      high: 0.15,
      medium: 0.0,
      low: -0.15,
    };
    confidence += likelihoodBoost[likelihood];

    // Reduce confidence if problem is not reproducible
    if (!problem.reproducible) {
      confidence *= 0.8;
    }

    // Ensure confidence is within bounds
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Determine verdict based on confidence, evidence count, and whether it was truly testable.
   */
  private determineVerdict(
    confidence: number,
    evidenceCount: number,
    wasTestabl: boolean = true
  ): HypothesisTestVerdict {
    // No evidence means inconclusive
    if (evidenceCount === 0) {
      return 'inconclusive';
    }

    // If the test was not truly executable (e.g., no CommandRunner), mark as inconclusive
    if (!wasTestabl) {
      return 'inconclusive';
    }

    if (confidence >= this.config.supportedThreshold) {
      return 'supported';
    }

    if (confidence < this.config.refutedThreshold) {
      return 'refuted';
    }

    return 'inconclusive';
  }

  /**
   * Determine recommendation based on verdict and confidence.
   */
  private determineRecommendation(
    verdict: HypothesisTestVerdict,
    confidence: number
  ): HypothesisTestRecommendation {
    switch (verdict) {
      case 'supported':
        return confidence >= 0.7 ? 'proceed_to_fix' : 'proceed_to_fix';
      case 'refuted':
        return 'test_another_hypothesis';
      case 'inconclusive':
      default:
        return 'need_more_evidence';
    }
  }
}

/**
 * Factory function to create a HypothesisTester instance.
 */
export function createHypothesisTester(
  config: HypothesisTesterConfig = {}
): HypothesisTester {
  return new HypothesisTester(config);
}
