/**
 * @fileoverview Fix Generator Agent
 *
 * Implements deterministic fix generation for the Scientific Loop.
 * Uses heuristic-based approach (no LLM calls) for Tier-0 compatibility.
 *
 * For each problem type, generates fix templates:
 * - test_failure -> adjust assertion, fix implementation, update fixture
 * - regression -> revert change, update config, fix data format
 * - hallucination -> improve retrieval filter, add grounding check, fix context
 * - performance_gap -> optimize algorithm, add caching, reduce data
 * - inconsistency -> normalize inputs, fix embedding, update ranking
 *
 * Fix Principles (from spec):
 * 1. Minimal change - fix only what's necessary
 * 2. No side effects - don't break other tests
 * 3. Root cause - don't just mask the symptom
 * 4. Testable - the fix should make the original test pass
 */

import type {
  FixGeneratorAgent,
  AgentCapability,
  Problem,
  ProblemType,
  Hypothesis,
  HypothesisTestResult,
  FixGeneratorInput,
  FixGeneratorReport,
  Fix,
  FileChange,
  FileChangeType,
  TestEvidence,
} from './types.js';
import type { LibrarianStorage } from '../storage/types.js';

/**
 * Configuration for the FixGenerator agent.
 */
export interface FixGeneratorConfig {
  /** Maximum number of fixes to generate (default 3) */
  maxFixes?: number;
  /** Include detailed change descriptions (default true) */
  detailedDescriptions?: boolean;
}

const DEFAULT_CONFIG: Required<FixGeneratorConfig> = {
  maxFixes: 3,
  detailedDescriptions: true,
};

/**
 * Fix templates for each problem type.
 * Each template provides a base structure for generating fixes.
 */
interface FixTemplate {
  description: string;
  changeType: FileChangeType;
  filePattern: string;
  rationale: string;
  prediction: string;
}

/**
 * Templates for test_failure problem type.
 */
const TEST_FAILURE_TEMPLATES: FixTemplate[] = [
  {
    description: 'Update test assertion to match current expected behavior',
    changeType: 'modify',
    filePattern: '*.test.ts',
    rationale: 'The test assertion expects outdated behavior; updating it aligns with current implementation',
    prediction: 'Test will pass with corrected assertion values',
  },
  {
    description: 'Fix implementation logic to produce correct output',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Implementation contains logic error that produces incorrect results',
    prediction: 'Implementation will return expected values, passing the test',
  },
  {
    description: 'Update test fixture data to match expected format',
    changeType: 'modify',
    filePattern: '*.test.ts',
    rationale: 'Test fixtures contain invalid or outdated data',
    prediction: 'Test will pass with valid fixture data',
  },
];

/**
 * Templates for regression problem type.
 */
const REGRESSION_TEMPLATES: FixTemplate[] = [
  {
    description: 'Revert breaking change to restore previous behavior',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Recent change introduced breaking behavior; reverting restores expected functionality',
    prediction: 'System will return to previous working state',
  },
  {
    description: 'Update configuration to maintain backward compatibility',
    changeType: 'modify',
    filePattern: '*.config.*',
    rationale: 'Configuration change caused regression; updating config restores compatibility',
    prediction: 'Configuration will support both old and new behavior',
  },
  {
    description: 'Fix data format transformation to handle both old and new formats',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Data format change broke existing consumers; adding format detection maintains compatibility',
    prediction: 'System will correctly handle both data formats',
  },
];

/**
 * Templates for hallucination problem type.
 */
const HALLUCINATION_TEMPLATES: FixTemplate[] = [
  {
    description: 'Improve retrieval filter to reduce false positives',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Retrieval filter threshold is too permissive, allowing low-confidence matches',
    prediction: 'Only high-confidence, verified results will be returned',
  },
  {
    description: 'Add grounding check to verify retrieved information exists',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Missing validation step allows ungrounded information to pass through',
    prediction: 'All returned information will be verified against source',
  },
  {
    description: 'Fix context retrieval to provide accurate source information',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Context retrieval returns incorrect or incomplete source data',
    prediction: 'Retrieved context will accurately reflect source content',
  },
];

/**
 * Templates for performance_gap problem type.
 */
const PERFORMANCE_GAP_TEMPLATES: FixTemplate[] = [
  {
    description: 'Optimize algorithm to reduce computational complexity',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Algorithm has suboptimal complexity causing performance issues',
    prediction: 'Optimized algorithm will meet performance targets',
  },
  {
    description: 'Add caching layer to reduce redundant computations',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Repeated computations without caching cause performance degradation',
    prediction: 'Cached results will improve response times significantly',
  },
  {
    description: 'Reduce data size through filtering or pagination',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Processing excessive data causes performance bottleneck',
    prediction: 'Reduced data volume will improve processing speed',
  },
];

/**
 * Templates for inconsistency problem type.
 */
const INCONSISTENCY_TEMPLATES: FixTemplate[] = [
  {
    description: 'Normalize inputs to ensure consistent processing',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Input variations cause different processing paths leading to inconsistent results',
    prediction: 'Normalized inputs will produce consistent outputs',
  },
  {
    description: 'Fix embedding generation to produce stable representations',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Embedding instability causes similar inputs to map differently',
    prediction: 'Stable embeddings will produce consistent similarity scores',
  },
  {
    description: 'Update ranking algorithm to be deterministic',
    changeType: 'modify',
    filePattern: '*.ts',
    rationale: 'Non-deterministic ranking produces varying results for identical queries',
    prediction: 'Deterministic ranking will produce consistent results',
  },
];

/**
 * Map of problem types to their fix templates.
 */
const FIX_TEMPLATES: Record<ProblemType, FixTemplate[]> = {
  test_failure: TEST_FAILURE_TEMPLATES,
  regression: REGRESSION_TEMPLATES,
  hallucination: HALLUCINATION_TEMPLATES,
  performance_gap: PERFORMANCE_GAP_TEMPLATES,
  inconsistency: INCONSISTENCY_TEMPLATES,
};

/**
 * FixGenerator implementation.
 * Uses heuristic-based fix generation without LLM calls.
 */
export class FixGenerator implements FixGeneratorAgent {
  readonly agentType = 'fix_generator';
  readonly name = 'Fix Generator';
  readonly capabilities: readonly AgentCapability[] = ['fix_generation'];
  readonly version = '1.0.0';
  readonly qualityTier = 'full' as const;

  private storage: LibrarianStorage | null = null;
  private config: Required<FixGeneratorConfig>;
  private fixCounter = 0;

  constructor(config: FixGeneratorConfig = {}) {
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
   * Generate fixes for a supported hypothesis.
   * Uses heuristic-based approach based on problem type and hypothesis.
   */
  generateFix(input: FixGeneratorInput): FixGeneratorReport {
    const { problem, hypothesis, testResult, codebaseContext: _codebaseContext } = input;

    const fixes: Fix[] = [];
    const templates = this.selectTemplates(problem, hypothesis, testResult);

    // Generate fixes from templates
    for (const template of templates.slice(0, this.config.maxFixes)) {
      const fix = this.generateFixFromTemplate(
        template,
        problem,
        hypothesis,
        testResult
      );
      fixes.push(fix);
    }

    // If no templates matched, generate a generic fix
    if (fixes.length === 0) {
      fixes.push(this.generateGenericFix(problem, hypothesis, testResult));
    }

    // Select preferred and alternatives
    const preferred = fixes[0].id;
    const alternatives = fixes.slice(1).map((f) => f.id);

    return {
      fixes,
      preferred,
      alternatives,
    };
  }

  /**
   * Select appropriate templates based on problem type and hypothesis.
   */
  private selectTemplates(
    problem: Problem,
    hypothesis: Hypothesis,
    testResult: HypothesisTestResult
  ): FixTemplate[] {
    const baseTemplates = FIX_TEMPLATES[problem.type] || TEST_FAILURE_TEMPLATES;

    // Score and rank templates based on hypothesis and evidence match
    const scoredTemplates = baseTemplates.map((template) => ({
      template,
      score: this.scoreTemplate(template, hypothesis, testResult),
    }));

    // Sort by score descending
    scoredTemplates.sort((a, b) => b.score - a.score);

    return scoredTemplates.map((st) => st.template);
  }

  /**
   * Score a template based on how well it matches the hypothesis and evidence.
   */
  private scoreTemplate(
    template: FixTemplate,
    hypothesis: Hypothesis,
    testResult: HypothesisTestResult
  ): number {
    let score = 0;

    // Check if template description matches hypothesis statement
    const templateWords = template.description.toLowerCase().split(/\s+/);
    const hypothesisWords = hypothesis.statement.toLowerCase().split(/\s+/);
    const commonWords = templateWords.filter((w) =>
      hypothesisWords.some((hw) => hw.includes(w) || w.includes(hw))
    );
    score += commonWords.length * 2;

    // Check if template matches evidence
    for (const evidence of testResult.evidence) {
      const evidenceText = `${evidence.finding} ${evidence.implication}`.toLowerCase();
      if (templateWords.some((w) => evidenceText.includes(w))) {
        score += 3;
      }
    }

    // Boost for high confidence test results
    score += testResult.confidence * 5;

    return score;
  }

  /**
   * Generate a Fix from a template.
   */
  private generateFixFromTemplate(
    template: FixTemplate,
    problem: Problem,
    hypothesis: Hypothesis,
    testResult: HypothesisTestResult
  ): Fix {
    const fixId = this.generateFixId();

    // Determine file path from problem context
    const filePath = this.inferFilePath(template, problem, hypothesis);

    // Generate change based on template and evidence
    const change = this.generateFileChange(template, problem, hypothesis, testResult);

    // Customize rationale and prediction
    const rationale = this.customizeRationale(template.rationale, hypothesis, testResult);
    const prediction = this.customizePrediction(template.prediction, problem, hypothesis);

    return {
      id: fixId,
      problemId: problem.id,
      hypothesisId: hypothesis.id,
      description: template.description,
      changes: [change],
      rationale,
      prediction,
    };
  }

  /**
   * Generate a generic fix when no templates match well.
   */
  private generateGenericFix(
    problem: Problem,
    hypothesis: Hypothesis,
    testResult: HypothesisTestResult
  ): Fix {
    const fixId = this.generateFixId();

    const change: FileChange = {
      filePath: this.inferFilePathFromHypothesis(hypothesis),
      changeType: 'modify',
      before: '// Original code with issue',
      after: '// Modified code addressing the hypothesis',
      description: `Address: ${hypothesis.statement}`,
    };

    return {
      id: fixId,
      problemId: problem.id,
      hypothesisId: hypothesis.id,
      description: `Fix for ${problem.type}: ${hypothesis.statement}`,
      changes: [change],
      rationale: `Based on hypothesis "${hypothesis.statement}" with confidence ${testResult.confidence.toFixed(2)}, this fix addresses the root cause by modifying the relevant code.`,
      prediction: `After applying this fix, the original test should pass and ${hypothesis.prediction}`,
    };
  }

  /**
   * Generate a unique fix ID.
   */
  private generateFixId(): string {
    this.fixCounter++;
    return `FIX-${String(this.fixCounter).padStart(3, '0')}`;
  }

  /**
   * Infer file path from template and problem context.
   */
  private inferFilePath(
    template: FixTemplate,
    problem: Problem,
    hypothesis: Hypothesis
  ): string {
    // Try to extract file path from minimal reproduction
    if (problem.minimalReproduction) {
      const fileMatch = problem.minimalReproduction.match(/(\S+\.ts)/);
      if (fileMatch) {
        return fileMatch[1];
      }
    }

    // Try to extract from evidence
    for (const e of problem.evidence) {
      const fileMatch = e.match(/(\S+\.ts[x]?):\d+/);
      if (fileMatch) {
        return fileMatch[1];
      }
    }

    // Use hypothesis test target
    if (hypothesis.test.target.includes('.')) {
      return hypothesis.test.target;
    }

    // Default based on template pattern
    if (template.filePattern.includes('test')) {
      return 'src/__tests__/affected.test.ts';
    }
    if (template.filePattern.includes('config')) {
      return 'vitest.config.ts';
    }

    return 'src/affected-module.ts';
  }

  /**
   * Infer file path from hypothesis when no template.
   */
  private inferFilePathFromHypothesis(hypothesis: Hypothesis): string {
    if (hypothesis.test.target.includes('.ts')) {
      return hypothesis.test.target;
    }
    if (hypothesis.test.target.includes('test')) {
      return 'src/__tests__/affected.test.ts';
    }
    return 'src/affected-module.ts';
  }

  /**
   * Generate a FileChange from template and context.
   */
  private generateFileChange(
    template: FixTemplate,
    problem: Problem,
    hypothesis: Hypothesis,
    testResult: HypothesisTestResult
  ): FileChange {
    const filePath = this.inferFilePath(template, problem, hypothesis);

    // Generate before/after snippets based on evidence
    const { before, after } = this.generateCodeSnippets(
      template,
      problem,
      hypothesis,
      testResult
    );

    return {
      filePath,
      changeType: template.changeType,
      before,
      after,
      description: this.config.detailedDescriptions
        ? `${template.description} in ${filePath}`
        : template.description,
    };
  }

  /**
   * Generate before/after code snippets based on context.
   */
  private generateCodeSnippets(
    template: FixTemplate,
    problem: Problem,
    hypothesis: Hypothesis,
    testResult: HypothesisTestResult
  ): { before: string; after: string } {
    // Extract values from evidence if available
    const expectedActual = this.extractExpectedActual(problem.evidence);

    switch (problem.type) {
      case 'test_failure':
        return this.generateTestFailureSnippets(template, expectedActual, hypothesis);
      case 'regression':
        return this.generateRegressionSnippets(template, hypothesis);
      case 'hallucination':
        return this.generateHallucinationSnippets(template, hypothesis);
      case 'performance_gap':
        return this.generatePerformanceSnippets(template, hypothesis);
      case 'inconsistency':
        return this.generateInconsistencySnippets(template, hypothesis);
      default:
        return {
          before: '// Original code',
          after: '// Fixed code based on hypothesis',
        };
    }
  }

  /**
   * Extract expected/actual values from evidence.
   */
  private extractExpectedActual(evidence: string[]): { expected?: string; actual?: string } {
    let expected: string | undefined;
    let actual: string | undefined;

    for (const e of evidence) {
      const expectedMatch = e.match(/expected[:\s]+([^\s,]+)/i);
      const actualMatch = e.match(/(?:got|actual)[:\s]+([^\s,]+)/i);

      if (expectedMatch) expected = expectedMatch[1];
      if (actualMatch) actual = actualMatch[1];
    }

    return { expected, actual };
  }

  /**
   * Generate snippets for test_failure problems.
   */
  private generateTestFailureSnippets(
    template: FixTemplate,
    expectedActual: { expected?: string; actual?: string },
    hypothesis: Hypothesis
  ): { before: string; after: string } {
    if (template.description.toLowerCase().includes('assertion')) {
      return {
        before: `expect(result).toBe(${expectedActual.expected || 'oldValue'});`,
        after: `expect(result).toBe(${expectedActual.actual || 'newValue'});`,
      };
    }
    if (template.description.toLowerCase().includes('implementation')) {
      return {
        before: `return calculateValue(input); // Returns ${expectedActual.actual || 'incorrect result'}`,
        after: `return calculateValue(input) + correction; // Returns ${expectedActual.expected || 'correct result'}`,
      };
    }
    if (template.description.toLowerCase().includes('fixture')) {
      return {
        before: `const fixture = { value: 'old_data' };`,
        after: `const fixture = { value: 'correct_data' };`,
      };
    }
    return {
      before: '// Original failing code',
      after: '// Fixed code',
    };
  }

  /**
   * Generate snippets for regression problems.
   */
  private generateRegressionSnippets(
    template: FixTemplate,
    hypothesis: Hypothesis
  ): { before: string; after: string } {
    if (template.description.toLowerCase().includes('revert')) {
      return {
        before: 'const result = newImplementation(data);',
        after: 'const result = originalImplementation(data);',
      };
    }
    if (template.description.toLowerCase().includes('config')) {
      return {
        before: 'export const config = { version: 2 };',
        after: 'export const config = { version: 2, legacySupport: true };',
      };
    }
    return {
      before: 'const formatted = formatV2(data);',
      after: 'const formatted = isV1(data) ? formatV1(data) : formatV2(data);',
    };
  }

  /**
   * Generate snippets for hallucination problems.
   */
  private generateHallucinationSnippets(
    template: FixTemplate,
    hypothesis: Hypothesis
  ): { before: string; after: string } {
    if (template.description.toLowerCase().includes('filter')) {
      return {
        before: 'const results = retrieve(query); // No confidence threshold',
        after: 'const results = retrieve(query).filter(r => r.confidence > 0.7);',
      };
    }
    if (template.description.toLowerCase().includes('grounding')) {
      return {
        before: 'return generateResponse(retrieved);',
        after: 'const verified = await verifyExists(retrieved);\nreturn generateResponse(verified);',
      };
    }
    return {
      before: 'const context = getContext(query);',
      after: 'const context = getVerifiedContext(query);',
    };
  }

  /**
   * Generate snippets for performance_gap problems.
   */
  private generatePerformanceSnippets(
    template: FixTemplate,
    hypothesis: Hypothesis
  ): { before: string; after: string } {
    if (template.description.toLowerCase().includes('optim')) {
      return {
        before: 'for (const a of arr) { for (const b of arr) { compare(a, b); } }',
        after: 'const sorted = arr.sort(compareFn); // O(n log n) instead of O(n^2)',
      };
    }
    if (template.description.toLowerCase().includes('cache')) {
      return {
        before: 'const result = expensiveComputation(input);',
        after: 'const result = cache.get(input) ?? cache.set(input, expensiveComputation(input));',
      };
    }
    return {
      before: 'const all = await fetchAllData();',
      after: 'const page = await fetchDataPaginated(offset, limit);',
    };
  }

  /**
   * Generate snippets for inconsistency problems.
   */
  private generateInconsistencySnippets(
    template: FixTemplate,
    hypothesis: Hypothesis
  ): { before: string; after: string } {
    if (template.description.toLowerCase().includes('normal')) {
      return {
        before: 'const result = process(input);',
        after: 'const normalized = normalize(input);\nconst result = process(normalized);',
      };
    }
    if (template.description.toLowerCase().includes('embed')) {
      return {
        before: 'const embedding = embed(text);',
        after: 'const embedding = embed(text, { deterministic: true });',
      };
    }
    return {
      before: 'results.sort((a, b) => a.score - b.score);',
      after: 'results.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));',
    };
  }

  /**
   * Customize rationale based on hypothesis and evidence.
   */
  private customizeRationale(
    baseRationale: string,
    hypothesis: Hypothesis,
    testResult: HypothesisTestResult
  ): string {
    const evidenceSummary = testResult.evidence
      .slice(0, 2)
      .map((e) => e.finding)
      .join('; ');

    return `${baseRationale} Evidence: ${evidenceSummary || hypothesis.rationale}. Confidence: ${(testResult.confidence * 100).toFixed(0)}%.`;
  }

  /**
   * Customize prediction based on problem and hypothesis.
   */
  private customizePrediction(
    basePrediction: string,
    problem: Problem,
    hypothesis: Hypothesis
  ): string {
    const testCommand = problem.minimalReproduction || 'npm test -- --run';
    return `${basePrediction} Verify by running: ${testCommand}`;
  }
}

/**
 * Factory function to create a FixGenerator instance.
 */
export function createFixGenerator(config: FixGeneratorConfig = {}): FixGenerator {
  return new FixGenerator(config);
}
