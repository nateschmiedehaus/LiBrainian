/**
 * Test categorization by resource needs.
 *
 * This module provides a system for categorizing tests based on their
 * resource requirements, enabling intelligent test scheduling and
 * resource-aware test execution.
 */

import { minimatch } from 'minimatch';

/**
 * Categories of tests based on their resource requirements.
 *
 * - `unit`: Fast, isolated tests with minimal resource needs
 * - `integration`: Tests that verify component interactions
 * - `heavy`: Resource-intensive tests that require significant memory/CPU
 * - `system`: End-to-end tests that exercise the full system
 */
export type TestCategory = 'unit' | 'integration' | 'heavy' | 'system';

/**
 * Configuration for a test category defining its resource requirements
 * and execution constraints.
 */
export interface TestCategoryConfig {
  /** Glob patterns to match test files in this category */
  patterns: string[];
  /** How many files of this type can run together */
  maxConcurrentFiles: number;
  /** Relative memory cost vs unit tests */
  memoryMultiplier: number;
  /** Must run in isolated process */
  requiresIsolation: boolean;
  /** Skip if system under resource pressure */
  skipUnderPressure: boolean;
}

/**
 * Configuration for all test categories.
 *
 * Categories are ordered by resource intensity, with unit tests being
 * the lightest and heavy/system tests requiring the most resources.
 */
export const TEST_CATEGORIES: Record<TestCategory, TestCategoryConfig> = {
  unit: {
    patterns: ['**/*.test.ts', '!**/*.integration.test.ts', '!**/*.system.test.ts'],
    maxConcurrentFiles: 16,
    memoryMultiplier: 1,
    requiresIsolation: false,
    skipUnderPressure: false,
  },
  integration: {
    patterns: ['**/*.integration.test.ts'],
    maxConcurrentFiles: 4,
    memoryMultiplier: 2,
    requiresIsolation: true,
    skipUnderPressure: false,
  },
  heavy: {
    patterns: [
      '**/ground_truth_corpus_complete.test.ts',
      '**/validation_phases_18_22.test.ts',
      '**/scenario_families.test.ts',
      '**/reachability_analyzer.test.ts',
      '**/dead_code_detector.test.ts',
    ],
    maxConcurrentFiles: 1, // Only one heavy test at a time
    memoryMultiplier: 10, // These use 10x more memory
    requiresIsolation: true,
    skipUnderPressure: true, // Skip if system is struggling
  },
  system: {
    patterns: ['**/*.system.test.ts', '**/*.live.test.ts'],
    maxConcurrentFiles: 1,
    memoryMultiplier: 5,
    requiresIsolation: true,
    skipUnderPressure: true,
  },
};

/**
 * Determines which category a test file belongs to based on its path.
 *
 * Categories are checked in order of specificity:
 * 1. Heavy tests (explicit file patterns)
 * 2. System tests (*.system.test.ts, *.live.test.ts)
 * 3. Integration tests (*.integration.test.ts)
 * 4. Unit tests (default for any *.test.ts)
 *
 * @param testPath - The path to the test file
 * @returns The test category, or null if the path doesn't match any test pattern
 */
export function getTestCategory(testPath: string): TestCategory | null {
  // Check heavy patterns first (most specific)
  for (const pattern of TEST_CATEGORIES.heavy.patterns) {
    if (minimatch(testPath, pattern)) {
      return 'heavy';
    }
  }

  // Check system patterns
  for (const pattern of TEST_CATEGORIES.system.patterns) {
    if (minimatch(testPath, pattern)) {
      return 'system';
    }
  }

  // Check integration patterns
  for (const pattern of TEST_CATEGORIES.integration.patterns) {
    if (minimatch(testPath, pattern)) {
      return 'integration';
    }
  }

  // Check if it's a test file at all (unit test default)
  // Only match the positive pattern, exclusions are handled above
  if (minimatch(testPath, '**/*.test.ts')) {
    return 'unit';
  }

  return null;
}

/**
 * Determines if a test should be skipped when the system is under resource pressure.
 *
 * Resource pressure conditions include:
 * - High memory usage
 * - High CPU load
 * - Many concurrent test processes
 *
 * @param testPath - The path to the test file
 * @returns true if the test should be skipped under pressure, false otherwise
 */
export function shouldSkipUnderPressure(testPath: string): boolean {
  const category = getTestCategory(testPath);

  if (category === null) {
    return false;
  }

  return TEST_CATEGORIES[category].skipUnderPressure;
}
