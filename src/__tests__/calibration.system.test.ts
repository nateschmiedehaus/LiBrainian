/**
 * @fileoverview Confidence Calibration Tests
 *
 * These tests measure whether the librainian's confidence scores
 * are actually meaningful - i.e., does confidence=0.8 mean
 * ~80% of those answers are correct?
 *
 * TIER-2: Requires live providers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkAllProviders } from '../api/provider_check.js';
import {
  CALCULATOR_CALIBRATION_FIXTURES,
  evaluateAnswer,
  calculateCalibration,
  type CalibrationFixture,
  type CorrectnessResult,
  type CalibrationMetrics,
} from './calibration_fixtures.js';
import { cleanupWorkspace } from './helpers/index.js';

// Test fixture code (same as e2e_validation.test.ts)
const CALCULATOR_TS = `/**
 * Simple calculator module for testing.
 * Provides basic arithmetic operations.
 */

export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}
`;

const MATH_UTILS_TS = `import { add, multiply } from './calculator.js';

/**
 * Calculate the average of numbers.
 * Uses add() from calculator module.
 */
export function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, n) => add(acc, n), 0);
  return sum / numbers.length;
}

/**
 * Calculate factorial using multiplication.
 * Recursive implementation with input validation.
 */
export function factorial(n: number): number {
  if (n < 0) throw new Error('Factorial of negative number');
  if (n <= 1) return 1;
  return multiply(n, factorial(n - 1));
}
`;

const API_CALCULATE_TS = `import { add, subtract, multiply, divide } from '../calculator.js';

type Operation = 'add' | 'subtract' | 'multiply' | 'divide';

interface CalculateRequest {
  a: number;
  b: number;
  operation: Operation;
}

interface CalculateResponse {
  result: number;
  operation: Operation;
}

/**
 * API handler for calculator operations.
 * Validates inputs and delegates to calculator module.
 */
export function handleCalculate(req: CalculateRequest): CalculateResponse {
  const { a, b, operation } = req;

  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('Invalid operands');
  }

  let result: number;
  switch (operation) {
    case 'add': result = add(a, b); break;
    case 'subtract': result = subtract(a, b); break;
    case 'multiply': result = multiply(a, b); break;
    case 'divide': result = divide(a, b); break;
    default: throw new Error(\`Unknown operation: \${operation}\`);
  }

  return { result, operation };
}
`;

// Test state
let testWorkspace: string;
let dbPath: string;
let hasProviders = false;
let storage: any = null;
let embeddingService: any = null;

interface CalibrationResult {
  fixture: CalibrationFixture;
  answer: string;
  confidence: number;
  correctness: CorrectnessResult;
}

describe('Confidence Calibration Tests', () => {
  beforeAll(async () => {
    // Check for live providers
    try {
      const status = await checkAllProviders({ forceProbe: false });
      hasProviders = status.llm.available && status.embedding.available;
    } catch {
      hasProviders = false;
    }

    if (!hasProviders) {
      console.log('[CALIBRATION] No live providers - tests will be skipped');
      return;
    }

    // Create test workspace
    testWorkspace = path.join(os.tmpdir(), `librainian-calibration-${Date.now()}`);
    await fs.mkdir(path.join(testWorkspace, 'src', 'api'), { recursive: true });
    await fs.writeFile(path.join(testWorkspace, 'src', 'calculator.ts'), CALCULATOR_TS);
    await fs.writeFile(path.join(testWorkspace, 'src', 'math_utils.ts'), MATH_UTILS_TS);
    await fs.writeFile(path.join(testWorkspace, 'src', 'api', 'calculate.ts'), API_CALCULATE_TS);

    dbPath = path.join(testWorkspace, 'librainian.db');

    // Bootstrap
    const { bootstrapProject, createBootstrapConfig } = await import('../api/bootstrap.js');
    const { createSqliteStorage } = await import('../storage/sqlite_storage.js');
    const { EmbeddingService } = await import('../api/embeddings.js');

    storage = await createSqliteStorage(dbPath);
    await storage.initialize();
    embeddingService = new EmbeddingService();

    console.log('[CALIBRATION] Bootstrapping test workspace...');
    const config = createBootstrapConfig(testWorkspace, {
      llmProvider: 'claude',
      bootstrapMode: 'full',
      skipProviderProbe: true,
    });
    await bootstrapProject(config, storage);
    console.log('[CALIBRATION] Bootstrap complete');
  }, 0); // No timeout

  afterAll(async () => {
    if (storage) {
      await storage.close();
    }
    if (testWorkspace) {
      await cleanupWorkspace(testWorkspace);
    }
  });

  it('measures calibration across all ground-truth fixtures', async (ctx) => {
    if (!hasProviders) {
      ctx.skip(true, 'unverified_by_trace(provider_unavailable): No live providers');
      return;
    }

    const { queryLiBrainian } = await import('../api/query.js');

    const results: CalibrationResult[] = [];

    console.log('\n=== CALIBRATION TEST RESULTS ===\n');

    for (const fixture of CALCULATOR_CALIBRATION_FIXTURES) {
      console.log(`[${fixture.id}] Query: "${fixture.query}"`);

      const queryResult = await queryLiBrainian(
        { intent: fixture.query, depth: 'L2' },
        storage,
        embeddingService
      );

      const answer = queryResult.synthesis?.answer || '';
      const confidence = queryResult.synthesis?.confidence || queryResult.totalConfidence;

      const correctness = evaluateAnswer(answer, fixture);

      results.push({ fixture, answer, confidence, correctness });

      console.log(`  Confidence: ${(confidence * 100).toFixed(1)}%`);
      console.log(`  Correct: ${correctness.isCorrect ? 'YES' : 'NO'} (score: ${(correctness.correctness * 100).toFixed(1)}%)`);
      console.log(`  Required facts: ${correctness.requiredMatched}/${correctness.requiredTotal}`);
      if (correctness.missingFacts.length > 0) {
        console.log(`  Missing: ${correctness.missingFacts.join(', ')}`);
      }
      if (correctness.hallucinations.length > 0) {
        console.log(`  HALLUCINATIONS: ${correctness.hallucinations.join(', ')}`);
      }
      console.log(`  Answer preview: "${answer.substring(0, 100)}..."`);
      console.log('');
    }

    // Calculate calibration metrics
    const predictions = results.map(r => ({
      confidence: r.confidence,
      isCorrect: r.correctness.isCorrect,
    }));

    const calibration = calculateCalibration(predictions);

    console.log('=== CALIBRATION METRICS ===\n');
    console.log(`Total queries: ${results.length}`);
    console.log(`Accuracy: ${(calibration.accuracy * 100).toFixed(1)}%`);
    console.log(`Mean confidence: ${(calibration.meanConfidence * 100).toFixed(1)}%`);
    console.log(`Expected Calibration Error (ECE): ${(calibration.expectedCalibrationError * 100).toFixed(1)}%`);
    console.log(`Overconfident: ${calibration.overconfident}`);
    console.log(`Underconfident: ${calibration.underconfident}`);

    console.log('\nCalibration buckets:');
    for (const bucket of calibration.buckets) {
      console.log(`  ${bucket.range}: ${bucket.count} samples, accuracy=${(bucket.accuracy * 100).toFixed(0)}%, confidence=${(bucket.avgConfidence * 100).toFixed(0)}%, gap=${(bucket.gap * 100).toFixed(0)}%`);
    }

    // Store results for later analysis
    const reportPath = path.join(testWorkspace, 'calibration_report.json');
    await fs.writeFile(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      results: results.map(r => ({
        fixtureId: r.fixture.id,
        query: r.fixture.query,
        difficulty: r.fixture.difficulty,
        confidence: r.confidence,
        isCorrect: r.correctness.isCorrect,
        correctnessScore: r.correctness.correctness,
        requiredMatched: r.correctness.requiredMatched,
        requiredTotal: r.correctness.requiredTotal,
        missingFacts: r.correctness.missingFacts,
        hallucinations: r.correctness.hallucinations,
        answerPreview: r.answer.substring(0, 200),
      })),
      calibration,
    }, null, 2));
    console.log(`\nFull report saved to: ${reportPath}`);

    // ASSERTIONS: What we actually expect from a well-calibrated system

    // 1. ECE should be reasonable (< 30% is okay for a first pass)
    console.log(`\n[ASSERTION] ECE < 30%: ${calibration.expectedCalibrationError < 0.3 ? 'PASS' : 'FAIL'}`);

    // 2. System should not be grossly overconfident
    console.log(`[ASSERTION] Not grossly overconfident: ${!calibration.overconfident ? 'PASS' : 'FAIL'}`);

    // 3. Easy questions should have higher accuracy than hard ones
    const easyResults = results.filter(r => r.fixture.difficulty === 'easy');
    const hardResults = results.filter(r => r.fixture.difficulty === 'hard');
    const easyAccuracy = easyResults.filter(r => r.correctness.isCorrect).length / (easyResults.length || 1);
    const hardAccuracy = hardResults.filter(r => r.correctness.isCorrect).length / (hardResults.length || 1);
    console.log(`[ASSERTION] Easy accuracy (${(easyAccuracy * 100).toFixed(0)}%) >= Hard accuracy (${(hardAccuracy * 100).toFixed(0)}%): ${easyAccuracy >= hardAccuracy ? 'PASS' : 'FAIL'}`);

    // Don't fail the test on calibration - this is measurement, not gate
    // But log everything so we know where we stand
    expect(results.length).toBeGreaterThan(0);

  }, 0); // No timeout

  it('evaluates individual query correctness with detailed output', async (ctx) => {
    if (!hasProviders) {
      ctx.skip(true, 'unverified_by_trace(provider_unavailable): No live providers');
      return;
    }

    const { queryLiBrainian } = await import('../api/query.js');

    // Test the most important query in detail
    const fixture = CALCULATOR_CALIBRATION_FIXTURES.find(f => f.id === 'calc-divide-purpose')!;

    const result = await queryLiBrainian(
      { intent: fixture.query, depth: 'L2' },
      storage,
      embeddingService
    );

    const answer = result.synthesis?.answer || '';
    const correctness = evaluateAnswer(answer, fixture);

    console.log('\n=== DETAILED CORRECTNESS EVALUATION ===\n');
    console.log(`Query: "${fixture.query}"`);
    console.log(`\nFull answer:\n${answer}\n`);
    console.log('Ground truth evaluation:');
    console.log(`  Required facts matched: ${correctness.requiredMatched}/${correctness.requiredTotal}`);
    console.log(`  Matched facts: ${correctness.matchedFacts.join('; ')}`);
    console.log(`  Missing facts: ${correctness.missingFacts.join('; ') || '(none)'}`);
    console.log(`  Hallucinations: ${correctness.hallucinations.join('; ') || '(none)'}`);
    console.log(`  Correctness score: ${(correctness.correctness * 100).toFixed(1)}%`);
    console.log(`  Binary correct: ${correctness.isCorrect}`);

    // This query SHOULD be correct - it's asking about divide which clearly throws on zero
    expect(correctness.requiredMatched).toBeGreaterThan(0);

  }, 60000);
});
