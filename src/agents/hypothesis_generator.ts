/**
 * @fileoverview Hypothesis Generator Agent
 *
 * Implements deterministic hypothesis generation for the Scientific Loop.
 * Uses heuristic-based approach (no LLM calls) for Tier-0 compatibility.
 *
 * For each problem type, generates 3-5 hypotheses based on common patterns:
 * - test_failure -> check test logic, implementation, fixtures, dependencies
 * - regression -> check recent changes, data format, config drift
 * - hallucination -> check retrieval quality, context assembly, grounding
 * - performance_gap -> check data volume, algorithm, caching
 * - inconsistency -> check normalization, embedding, ranking
 */

import type {
  HypothesisGeneratorAgent,
  AgentCapability,
  Hypothesis,
  HypothesisGenerationInput,
  HypothesisGenerationReport,
  HypothesisLikelihood,
  HypothesisTest,
  HypothesisTestType,
  Problem,
  ProblemType,
} from './types.js';
import type { LibrarianStorage } from '../storage/types.js';

/**
 * Configuration for the HypothesisGenerator agent.
 */
export interface HypothesisGeneratorConfig {
  /** Minimum number of hypotheses to generate per problem */
  minHypotheses?: number;
  /** Maximum number of hypotheses to generate per problem */
  maxHypotheses?: number;
}

const DEFAULT_CONFIG: Required<HypothesisGeneratorConfig> = {
  minHypotheses: 3,
  maxHypotheses: 5,
};

/**
 * A hypothesis template used for heuristic generation.
 */
interface HypothesisTemplate {
  statement: string;
  rationale: string;
  prediction: string;
  testType: HypothesisTestType;
  testTarget: string;
  testExpected: string;
  likelihood: HypothesisLikelihood;
}

/**
 * Heuristic hypothesis templates for each problem type.
 * These are common patterns that apply across most codebases.
 */
const HYPOTHESIS_TEMPLATES: Record<ProblemType, HypothesisTemplate[]> = {
  test_failure: [
    {
      statement: 'The test assertion logic is incorrect or outdated',
      rationale:
        'Test assertions may not reflect current expected behavior after code changes.',
      prediction:
        'Inspecting the test will reveal assertions that do not match the intended behavior.',
      testType: 'code_inspection',
      testTarget: 'test file assertions',
      testExpected: 'Assertion mismatch with documented behavior',
      likelihood: 'high',
    },
    {
      statement: 'The implementation under test has a bug',
      rationale:
        'The code being tested may have logic errors causing unexpected output.',
      prediction:
        'Tracing the execution path will reveal incorrect logic or missing edge case handling.',
      testType: 'code_inspection',
      testTarget: 'implementation source code',
      testExpected: 'Logic error or missing condition',
      likelihood: 'high',
    },
    {
      statement: 'Test fixtures or mock data are invalid or stale',
      rationale:
        'Test data may have become outdated or may not represent valid inputs.',
      prediction:
        'Examining fixture data will show values that no longer match expected schemas or formats.',
      testType: 'code_inspection',
      testTarget: 'test fixtures and mock data',
      testExpected: 'Stale or invalid test data',
      likelihood: 'medium',
    },
    {
      statement: 'A dependency changed its behavior or interface',
      rationale:
        'External or internal dependencies may have been updated with breaking changes.',
      prediction:
        'Checking dependency versions or changelogs will reveal recent updates.',
      testType: 'log_analysis',
      testTarget: 'package.json and dependency changelogs',
      testExpected: 'Recent dependency version change',
      likelihood: 'medium',
    },
    {
      statement: 'Test environment or configuration is misconfigured',
      rationale:
        'Environment variables, config files, or test setup may be incorrect.',
      prediction:
        'Comparing test environment config to production or expected config will show discrepancies.',
      testType: 'code_inspection',
      testTarget: 'test configuration files',
      testExpected: 'Configuration mismatch',
      likelihood: 'low',
    },
  ],

  regression: [
    {
      statement: 'A recent code change modified the expected behavior',
      rationale:
        'Recent commits may have inadvertently changed functionality that was previously working.',
      prediction:
        'Git blame or diff on relevant files will show recent changes affecting this query.',
      testType: 'code_inspection',
      testTarget: 'git history of related files',
      testExpected: 'Recent commit touching affected logic',
      likelihood: 'high',
    },
    {
      statement: 'The data format or schema has changed',
      rationale:
        'Input or output data structures may have been modified without updating all consumers.',
      prediction:
        'Comparing current data format to expected format will reveal schema differences.',
      testType: 'code_inspection',
      testTarget: 'data schemas and types',
      testExpected: 'Schema field changes or type differences',
      likelihood: 'high',
    },
    {
      statement: 'Configuration drift occurred between environments',
      rationale:
        'Settings may have diverged between development, test, and production environments.',
      prediction:
        'Comparing config files across environments will show differing values.',
      testType: 'code_inspection',
      testTarget: 'environment configuration files',
      testExpected: 'Config value differences between environments',
      likelihood: 'medium',
    },
    {
      statement: 'The index or cache has become stale',
      rationale:
        'Cached data or search indices may not reflect the current state of the codebase.',
      prediction:
        'Rebuilding the index or clearing cache will restore expected behavior.',
      testType: 'behavioral',
      testTarget: 'index rebuild or cache clear',
      testExpected: 'Behavior restored after rebuild/clear',
      likelihood: 'medium',
    },
    {
      statement: 'A merge conflict resolution introduced an error',
      rationale:
        'Merge conflict resolutions may have accidentally removed or corrupted code.',
      prediction:
        'Examining merge commits will reveal conflict markers or incorrect resolutions.',
      testType: 'code_inspection',
      testTarget: 'recent merge commits',
      testExpected: 'Merge artifact or incorrect resolution',
      likelihood: 'low',
    },
  ],

  hallucination: [
    {
      statement: 'The retrieval system is not finding relevant context',
      rationale:
        'If the retrieval query does not match indexed content, irrelevant or no context is provided.',
      prediction:
        'Running the retrieval query directly will show low similarity scores or missing documents.',
      testType: 'behavioral',
      testTarget: 'retrieval query results',
      testExpected: 'Low similarity scores or empty results',
      likelihood: 'high',
    },
    {
      statement: 'Context assembly is truncating or omitting relevant information',
      rationale:
        'Token limits or context window constraints may cut off important information.',
      prediction:
        'Inspecting the assembled context will show missing or truncated sections.',
      testType: 'log_analysis',
      testTarget: 'assembled context content',
      testExpected: 'Truncated or missing relevant content',
      likelihood: 'high',
    },
    {
      statement: 'The grounding mechanism is failing to constrain responses',
      rationale:
        'The system may not be properly enforcing that responses come from retrieved context.',
      prediction:
        'Comparing response content to retrieved context will show unsupported claims.',
      testType: 'behavioral',
      testTarget: 'response vs context comparison',
      testExpected: 'Claims not present in retrieved context',
      likelihood: 'medium',
    },
    {
      statement: 'Embedding quality is poor for this type of content',
      rationale:
        'The embedding model may not capture semantic meaning well for specific terminology.',
      prediction:
        'Testing similar queries will show inconsistent retrieval results.',
      testType: 'behavioral',
      testTarget: 'embedding similarity tests',
      testExpected: 'Inconsistent similarity for related queries',
      likelihood: 'medium',
    },
    {
      statement: 'The indexed content itself is incomplete or incorrect',
      rationale:
        'The source content may be missing, outdated, or incorrectly parsed.',
      prediction:
        'Inspecting the indexed content for the expected answer will show gaps.',
      testType: 'code_inspection',
      testTarget: 'indexed content store',
      testExpected: 'Missing or incorrect indexed content',
      likelihood: 'low',
    },
  ],

  performance_gap: [
    {
      statement: 'Data volume or complexity exceeded algorithm capacity',
      rationale:
        'The algorithm may not scale well with larger or more complex inputs.',
      prediction:
        'Testing with smaller data will show improved performance.',
      testType: 'behavioral',
      testTarget: 'algorithm with reduced data size',
      testExpected: 'Better performance with smaller data',
      likelihood: 'high',
    },
    {
      statement: 'The algorithm is suboptimal for this use case',
      rationale:
        'The current implementation may use inefficient data structures or algorithms.',
      prediction:
        'Profiling will reveal hot spots or inefficient operations.',
      testType: 'behavioral',
      testTarget: 'performance profiling',
      testExpected: 'Identified hot spots or O(n^2) operations',
      likelihood: 'high',
    },
    {
      statement: 'Caching is not being utilized effectively',
      rationale:
        'Repeated computations may not be cached, causing unnecessary work.',
      prediction:
        'Adding or fixing caching will significantly improve performance.',
      testType: 'code_inspection',
      testTarget: 'caching implementation',
      testExpected: 'Missing cache hits or disabled caching',
      likelihood: 'medium',
    },
    {
      statement: 'Resource contention is causing slowdowns',
      rationale:
        'Concurrent access to shared resources may cause blocking or delays.',
      prediction:
        'Monitoring will show lock contention or resource waiting.',
      testType: 'log_analysis',
      testTarget: 'resource utilization logs',
      testExpected: 'Lock contention or resource starvation',
      likelihood: 'medium',
    },
    {
      statement: 'The baseline comparison is unfair or misconfigured',
      rationale:
        'The control and treatment may have different conditions affecting results.',
      prediction:
        'Reviewing experiment setup will reveal configuration differences.',
      testType: 'code_inspection',
      testTarget: 'experiment configuration',
      testExpected: 'Unequal conditions between control and treatment',
      likelihood: 'low',
    },
  ],

  inconsistency: [
    {
      statement: 'Query normalization is inconsistent across variants',
      rationale:
        'Different phrasings may be normalized differently, leading to different results.',
      prediction:
        'Comparing normalized forms of the variants will show differences.',
      testType: 'behavioral',
      testTarget: 'query normalization output',
      testExpected: 'Different normalized forms for semantically similar queries',
      likelihood: 'high',
    },
    {
      statement: 'Embedding space does not capture semantic similarity well',
      rationale:
        'The embedding model may not recognize paraphrases as semantically similar.',
      prediction:
        'Computing cosine similarity between variant embeddings will show low scores.',
      testType: 'behavioral',
      testTarget: 'embedding similarity scores',
      testExpected: 'Low similarity for semantically equivalent queries',
      likelihood: 'high',
    },
    {
      statement: 'Ranking algorithm produces non-deterministic results',
      rationale:
        'The ranking may include randomness or tie-breaking that varies between runs.',
      prediction:
        'Running the same query multiple times will show different rankings.',
      testType: 'test_run',
      testTarget: 'repeated query execution',
      testExpected: 'Varying results across identical runs',
      likelihood: 'medium',
    },
    {
      statement: 'Multiple valid answers exist in the knowledge base',
      rationale:
        'The question may be ambiguous or have legitimately different correct answers.',
      prediction:
        'Reviewing the knowledge base will show multiple relevant entries.',
      testType: 'code_inspection',
      testTarget: 'knowledge base content',
      testExpected: 'Multiple valid answer candidates',
      likelihood: 'medium',
    },
    {
      statement: 'Context window variations affect answer generation',
      rationale:
        'Different query formulations may retrieve different context, affecting answers.',
      prediction:
        'Comparing retrieved context for each variant will show different documents.',
      testType: 'behavioral',
      testTarget: 'retrieved context per variant',
      testExpected: 'Different context documents for different variants',
      likelihood: 'low',
    },
  ],
};

/**
 * HypothesisGenerator implementation.
 * Uses heuristic templates to generate hypotheses without LLM calls.
 */
export class HypothesisGenerator implements HypothesisGeneratorAgent {
  readonly agentType = 'hypothesis_generator';
  readonly name = 'Hypothesis Generator';
  readonly capabilities: readonly AgentCapability[] = ['hypothesis_generation'];
  readonly version = '1.0.0';
  readonly qualityTier = 'full' as const;

  private storage: LibrarianStorage | null = null;
  private config: Required<HypothesisGeneratorConfig>;

  constructor(config: HypothesisGeneratorConfig = {}) {
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
   * Generate hypotheses for a given problem.
   * Uses heuristic templates based on problem type.
   */
  generateHypotheses(input: HypothesisGenerationInput): HypothesisGenerationReport {
    const { problem, codebaseContext } = input;
    const templates = HYPOTHESIS_TEMPLATES[problem.type] || [];

    // Select templates (3-5 based on config)
    const selectedTemplates = templates.slice(0, this.config.maxHypotheses);

    // Ensure we have at least minHypotheses
    if (selectedTemplates.length < this.config.minHypotheses) {
      // This shouldn't happen with our templates, but handle gracefully
      console.warn(
        `Only ${selectedTemplates.length} templates available for problem type ${problem.type}`
      );
    }

    // Convert templates to hypotheses
    const hypotheses: Hypothesis[] = selectedTemplates.map((template, index) => {
      const letter = String.fromCharCode(65 + index); // A, B, C, D, E
      return this.templateToHypothesis(template, problem, letter, codebaseContext);
    });

    // Rank by likelihood (high before medium before low)
    const rankedByLikelihood = this.rankHypotheses(hypotheses);

    return {
      problemId: problem.id,
      hypotheses,
      rankedByLikelihood,
    };
  }

  /**
   * Convert a hypothesis template to a full Hypothesis object.
   */
  private templateToHypothesis(
    template: HypothesisTemplate,
    problem: Problem,
    letter: string,
    _codebaseContext?: string
  ): Hypothesis {
    const test: HypothesisTest = {
      type: template.testType,
      target: template.testTarget,
      expected: template.testExpected,
    };

    return {
      id: `HYP-${problem.id}-${letter}`,
      statement: template.statement,
      rationale: template.rationale,
      prediction: template.prediction,
      test,
      likelihood: template.likelihood,
    };
  }

  /**
   * Rank hypotheses by likelihood.
   * Returns hypothesis IDs in order: high, then medium, then low.
   */
  private rankHypotheses(hypotheses: Hypothesis[]): string[] {
    const likelihoodOrder: Record<HypothesisLikelihood, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };

    const sorted = [...hypotheses].sort((a, b) => {
      return likelihoodOrder[a.likelihood] - likelihoodOrder[b.likelihood];
    });

    return sorted.map((h) => h.id);
  }
}

/**
 * Factory function to create a HypothesisGenerator instance.
 */
export function createHypothesisGenerator(
  config: HypothesisGeneratorConfig = {}
): HypothesisGenerator {
  return new HypothesisGenerator(config);
}
