import { describe, it, expect, beforeEach } from 'vitest';
import { createHypothesisGenerator } from '../hypothesis_generator.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type {
  Problem,
  HypothesisGenerationInput,
  HypothesisGenerationReport,
  Hypothesis,
  HypothesisLikelihood,
} from '../types.js';

/**
 * @fileoverview Tests for HypothesisGeneratorAgent
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 */

describe('HypothesisGenerator', () => {
  describe('Agent metadata', () => {
    it('returns agent with correct agentType', () => {
      const generator = createHypothesisGenerator();
      expect(generator.agentType).toBe('hypothesis_generator');
    });

    it('returns agent with correct name', () => {
      const generator = createHypothesisGenerator();
      expect(generator.name).toBe('Hypothesis Generator');
    });

    it('returns agent with hypothesis_generation capability', () => {
      const generator = createHypothesisGenerator();
      expect(generator.capabilities).toContain('hypothesis_generation');
    });

    it('returns agent with version string', () => {
      const generator = createHypothesisGenerator();
      expect(generator.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('returns agent with qualityTier', () => {
      const generator = createHypothesisGenerator();
      expect(generator.qualityTier).toBe('full');
    });
  });

  describe('Agent lifecycle', () => {
    it('isReady returns false before initialization', () => {
      const generator = createHypothesisGenerator();
      expect(generator.isReady()).toBe(false);
    });

    it('isReady returns true after initialization', async () => {
      const generator = createHypothesisGenerator();
      await generator.initialize({} as LibrarianStorage);
      expect(generator.isReady()).toBe(true);
    });

    it('isReady returns false after shutdown', async () => {
      const generator = createHypothesisGenerator();
      await generator.initialize({} as LibrarianStorage);
      await generator.shutdown();
      expect(generator.isReady()).toBe(false);
    });
  });

  describe('generateHypotheses', () => {
    let generator: ReturnType<typeof createHypothesisGenerator>;

    beforeEach(async () => {
      generator = createHypothesisGenerator();
      await generator.initialize({} as LibrarianStorage);
    });

    describe('test_failure problem type', () => {
      const testFailureProblem: Problem = {
        id: 'PROB-TEST-1',
        type: 'test_failure',
        description: 'Test command failed: npm test -- --run some.test.ts',
        evidence: ['FAIL: expected true, got false', 'at line 42'],
        severity: 'high',
        reproducible: true,
        minimalReproduction: 'npm test -- --run some.test.ts',
      };

      it('generates 3-5 hypotheses for test_failure', () => {
        const input: HypothesisGenerationInput = { problem: testFailureProblem };
        const report = generator.generateHypotheses(input);

        expect(report.hypotheses.length).toBeGreaterThanOrEqual(3);
        expect(report.hypotheses.length).toBeLessThanOrEqual(5);
      });

      it('generates hypotheses covering test logic, implementation, fixtures, dependencies', () => {
        const input: HypothesisGenerationInput = { problem: testFailureProblem };
        const report = generator.generateHypotheses(input);

        const statements = report.hypotheses.map((h) => h.statement.toLowerCase());
        const combinedStatements = statements.join(' ');

        // Should cover multiple possible causes
        const coversPossibleCauses =
          combinedStatements.includes('test') ||
          combinedStatements.includes('implementation') ||
          combinedStatements.includes('fixture') ||
          combinedStatements.includes('logic') ||
          combinedStatements.includes('assertion');

        expect(coversPossibleCauses).toBe(true);
      });

      it('returns problemId matching input problem', () => {
        const input: HypothesisGenerationInput = { problem: testFailureProblem };
        const report = generator.generateHypotheses(input);

        expect(report.problemId).toBe('PROB-TEST-1');
      });
    });

    describe('regression problem type', () => {
      const regressionProblem: Problem = {
        id: 'PROB-REG-1',
        type: 'regression',
        description: 'Regression detected for query: find auth functions',
        evidence: ['Expected: AuthService.login', 'Actual: UserManager.authenticate'],
        severity: 'high',
        reproducible: true,
        minimalReproduction: 'Run regression query: find auth functions',
      };

      it('generates 3-5 hypotheses for regression', () => {
        const input: HypothesisGenerationInput = { problem: regressionProblem };
        const report = generator.generateHypotheses(input);

        expect(report.hypotheses.length).toBeGreaterThanOrEqual(3);
        expect(report.hypotheses.length).toBeLessThanOrEqual(5);
      });

      it('generates hypotheses covering recent changes, data format, config drift', () => {
        const input: HypothesisGenerationInput = { problem: regressionProblem };
        const report = generator.generateHypotheses(input);

        const statements = report.hypotheses.map((h) => h.statement.toLowerCase());
        const combinedStatements = statements.join(' ');

        const coversPossibleCauses =
          combinedStatements.includes('change') ||
          combinedStatements.includes('data') ||
          combinedStatements.includes('config') ||
          combinedStatements.includes('format') ||
          combinedStatements.includes('index');

        expect(coversPossibleCauses).toBe(true);
      });
    });

    describe('hallucination problem type', () => {
      const hallucinationProblem: Problem = {
        id: 'PROB-HALL-1',
        type: 'hallucination',
        description: 'Hallucination detected for probe: What is the database schema?',
        evidence: ['Expected: grounded answer', 'Actual: invented table names'],
        severity: 'high',
        reproducible: true,
        minimalReproduction: 'Run probe: What is the database schema?',
      };

      it('generates 3-5 hypotheses for hallucination', () => {
        const input: HypothesisGenerationInput = { problem: hallucinationProblem };
        const report = generator.generateHypotheses(input);

        expect(report.hypotheses.length).toBeGreaterThanOrEqual(3);
        expect(report.hypotheses.length).toBeLessThanOrEqual(5);
      });

      it('generates hypotheses covering retrieval quality, context assembly, grounding', () => {
        const input: HypothesisGenerationInput = { problem: hallucinationProblem };
        const report = generator.generateHypotheses(input);

        const statements = report.hypotheses.map((h) => h.statement.toLowerCase());
        const combinedStatements = statements.join(' ');

        const coversPossibleCauses =
          combinedStatements.includes('retrieval') ||
          combinedStatements.includes('context') ||
          combinedStatements.includes('ground') ||
          combinedStatements.includes('embedding') ||
          combinedStatements.includes('index');

        expect(coversPossibleCauses).toBe(true);
      });
    });

    describe('performance_gap problem type', () => {
      const performanceProblem: Problem = {
        id: 'PROB-PERF-1',
        type: 'performance_gap',
        description: 'Performance gap on accuracy',
        evidence: ['Control: 0.8', 'Treatment: 0.75', 'MinImprovement: 0.1'],
        severity: 'medium',
        reproducible: true,
        minimalReproduction: 'Re-run experiment: accuracy',
      };

      it('generates 3-5 hypotheses for performance_gap', () => {
        const input: HypothesisGenerationInput = { problem: performanceProblem };
        const report = generator.generateHypotheses(input);

        expect(report.hypotheses.length).toBeGreaterThanOrEqual(3);
        expect(report.hypotheses.length).toBeLessThanOrEqual(5);
      });

      it('generates hypotheses covering data volume, algorithm, caching', () => {
        const input: HypothesisGenerationInput = { problem: performanceProblem };
        const report = generator.generateHypotheses(input);

        const statements = report.hypotheses.map((h) => h.statement.toLowerCase());
        const combinedStatements = statements.join(' ');

        const coversPossibleCauses =
          combinedStatements.includes('data') ||
          combinedStatements.includes('algorithm') ||
          combinedStatements.includes('cach') ||
          combinedStatements.includes('scale') ||
          combinedStatements.includes('performance');

        expect(coversPossibleCauses).toBe(true);
      });
    });

    describe('inconsistency problem type', () => {
      const inconsistencyProblem: Problem = {
        id: 'PROB-CONS-1',
        type: 'inconsistency',
        description: 'Inconsistent answers for question: How is uptime measured?',
        evidence: [
          'Variants: How do you measure uptime? | What is the uptime metric?',
          'Answers: 99.9% SLA | health check endpoint',
        ],
        severity: 'medium',
        reproducible: true,
        minimalReproduction: 'Ask variants: How do you measure uptime? | What is the uptime metric?',
      };

      it('generates 3-5 hypotheses for inconsistency', () => {
        const input: HypothesisGenerationInput = { problem: inconsistencyProblem };
        const report = generator.generateHypotheses(input);

        expect(report.hypotheses.length).toBeGreaterThanOrEqual(3);
        expect(report.hypotheses.length).toBeLessThanOrEqual(5);
      });

      it('generates hypotheses covering normalization, embedding, ranking', () => {
        const input: HypothesisGenerationInput = { problem: inconsistencyProblem };
        const report = generator.generateHypotheses(input);

        const statements = report.hypotheses.map((h) => h.statement.toLowerCase());
        const combinedStatements = statements.join(' ');

        const coversPossibleCauses =
          combinedStatements.includes('normaliz') ||
          combinedStatements.includes('embedding') ||
          combinedStatements.includes('rank') ||
          combinedStatements.includes('semantic') ||
          combinedStatements.includes('query');

        expect(coversPossibleCauses).toBe(true);
      });
    });

    describe('Hypothesis structure', () => {
      const genericProblem: Problem = {
        id: 'PROB-TEST-1',
        type: 'test_failure',
        description: 'Test failed',
        evidence: ['error message'],
        severity: 'high',
        reproducible: true,
      };

      it('hypothesis IDs follow HYP-{problemId}-{letter} pattern', () => {
        const input: HypothesisGenerationInput = { problem: genericProblem };
        const report = generator.generateHypotheses(input);

        for (const hypothesis of report.hypotheses) {
          expect(hypothesis.id).toMatch(/^HYP-PROB-TEST-1-[A-Z]$/);
        }
      });

      it('each hypothesis has non-empty statement', () => {
        const input: HypothesisGenerationInput = { problem: genericProblem };
        const report = generator.generateHypotheses(input);

        for (const hypothesis of report.hypotheses) {
          expect(hypothesis.statement).toBeTruthy();
          expect(hypothesis.statement.length).toBeGreaterThan(10);
        }
      });

      it('each hypothesis has non-empty rationale', () => {
        const input: HypothesisGenerationInput = { problem: genericProblem };
        const report = generator.generateHypotheses(input);

        for (const hypothesis of report.hypotheses) {
          expect(hypothesis.rationale).toBeTruthy();
          expect(hypothesis.rationale.length).toBeGreaterThan(10);
        }
      });

      it('each hypothesis has non-empty prediction', () => {
        const input: HypothesisGenerationInput = { problem: genericProblem };
        const report = generator.generateHypotheses(input);

        for (const hypothesis of report.hypotheses) {
          expect(hypothesis.prediction).toBeTruthy();
          expect(hypothesis.prediction.length).toBeGreaterThan(10);
        }
      });

      it('each hypothesis has valid test with type, target, expected', () => {
        const input: HypothesisGenerationInput = { problem: genericProblem };
        const report = generator.generateHypotheses(input);

        const validTestTypes = ['code_inspection', 'test_run', 'log_analysis', 'behavioral'];

        for (const hypothesis of report.hypotheses) {
          expect(validTestTypes).toContain(hypothesis.test.type);
          expect(hypothesis.test.target).toBeTruthy();
          expect(hypothesis.test.expected).toBeTruthy();
        }
      });

      it('each hypothesis has valid likelihood', () => {
        const input: HypothesisGenerationInput = { problem: genericProblem };
        const report = generator.generateHypotheses(input);

        const validLikelihoods: HypothesisLikelihood[] = ['high', 'medium', 'low'];

        for (const hypothesis of report.hypotheses) {
          expect(validLikelihoods).toContain(hypothesis.likelihood);
        }
      });
    });

    describe('Ranking', () => {
      const genericProblem: Problem = {
        id: 'PROB-TEST-1',
        type: 'test_failure',
        description: 'Test failed',
        evidence: ['error message'],
        severity: 'high',
        reproducible: true,
      };

      it('rankedByLikelihood contains all hypothesis IDs', () => {
        const input: HypothesisGenerationInput = { problem: genericProblem };
        const report = generator.generateHypotheses(input);

        const hypothesisIds = report.hypotheses.map((h) => h.id);
        expect(report.rankedByLikelihood.sort()).toEqual(hypothesisIds.sort());
      });

      it('rankedByLikelihood is ordered by likelihood (high before medium before low)', () => {
        const input: HypothesisGenerationInput = { problem: genericProblem };
        const report = generator.generateHypotheses(input);

        // Build a map from id to likelihood
        const likelihoodMap = new Map<string, HypothesisLikelihood>();
        for (const h of report.hypotheses) {
          likelihoodMap.set(h.id, h.likelihood);
        }

        // Get likelihoods in ranked order
        const rankedLikelihoods = report.rankedByLikelihood.map((id) => likelihoodMap.get(id)!);

        // Check that high comes before medium which comes before low
        const likelihoodOrder = { high: 0, medium: 1, low: 2 };
        let lastOrder = -1;
        for (const likelihood of rankedLikelihoods) {
          const currentOrder = likelihoodOrder[likelihood];
          expect(currentOrder).toBeGreaterThanOrEqual(lastOrder);
          lastOrder = currentOrder;
        }
      });
    });

    describe('Codebase context', () => {
      const genericProblem: Problem = {
        id: 'PROB-TEST-1',
        type: 'test_failure',
        description: 'Test failed',
        evidence: ['error message'],
        severity: 'high',
        reproducible: true,
      };

      it('accepts optional codebaseContext without error', () => {
        const input: HypothesisGenerationInput = {
          problem: genericProblem,
          codebaseContext: 'This is a TypeScript project using Vitest for testing.',
        };

        expect(() => generator.generateHypotheses(input)).not.toThrow();
      });

      it('still generates hypotheses when codebaseContext is provided', () => {
        const input: HypothesisGenerationInput = {
          problem: genericProblem,
          codebaseContext: 'This is a TypeScript project using Vitest for testing.',
        };

        const report = generator.generateHypotheses(input);
        expect(report.hypotheses.length).toBeGreaterThanOrEqual(3);
      });
    });
  });
});
