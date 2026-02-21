/**
 * @fileoverview Code Patch Emitter (Highest Scrutiny)
 *
 * Proposes minimal code patches for specific failing tests.
 * This emitter has the highest scrutiny and strictest guardrails:
 * - Only allowed when backed by a failing test
 * - Must have measurable fitness gain
 * - Diff must stay within strict size limits
 * - All mutations must be validated by staged evaluators
 *
 * @packageDocumentation
 */

import type { Variant, ArchiveCell } from '../types.js';
import { BaseEmitter } from './base.js';

// ============================================================================
// CODE MUTATION STRATEGIES
// ============================================================================

/**
 * Known code patterns that can be safely mutated.
 */
interface CodeMutationStrategy {
  id: string;
  name: string;
  description: string;
  pattern: RegExp;
  targetFiles: string[];
  maxLinesChanged: number;
}

const SAFE_MUTATION_STRATEGIES: CodeMutationStrategy[] = [
  {
    id: 'timeout_increase',
    name: 'Increase Timeout',
    description: 'Increase timeout values for slow operations',
    pattern: /timeout:\s*(\d+)/,
    targetFiles: ['src/librainian/**/*.ts'],
    maxLinesChanged: 5,
  },
  {
    id: 'cache_ttl_adjust',
    name: 'Adjust Cache TTL',
    description: 'Modify cache TTL values',
    pattern: /ttl:\s*(\d+)/,
    targetFiles: ['src/librainian/**/*.ts'],
    maxLinesChanged: 5,
  },
  {
    id: 'threshold_adjust',
    name: 'Adjust Thresholds',
    description: 'Modify confidence/quality thresholds',
    pattern: /threshold:\s*([\d.]+)/,
    targetFiles: ['src/librainian/**/*.ts'],
    maxLinesChanged: 5,
  },
  {
    id: 'batch_size_adjust',
    name: 'Adjust Batch Size',
    description: 'Modify batch processing sizes',
    pattern: /batchSize:\s*(\d+)/,
    targetFiles: ['src/librainian/**/*.ts'],
    maxLinesChanged: 5,
  },
];

// ============================================================================
// EMITTER
// ============================================================================

/**
 * Emitter that proposes minimal code patches.
 * Highest scrutiny - requires failing test justification.
 */
export class CodeEmitter extends BaseEmitter {
  id = 'code-patch';
  name = 'Code Patch Emitter';
  description = 'Proposes minimal code patches for failing tests (highest scrutiny)';
  estimatedCost = { tokens: 2000, embeddings: 50 };

  // Track failing tests this emitter is targeting
  private failingTests: Map<string, string> = new Map();

  /**
   * Register a failing test that this emitter should target.
   */
  registerFailingTest(testId: string, testFile: string): void {
    this.failingTests.set(testId, testFile);
  }

  async emit(parent: Variant | null, archive: ArchiveCell[]): Promise<Variant> {
    const selectedParent = parent ?? this.selectParent(archive);

    // Code emitter requires a failing test to target
    if (this.failingTests.size === 0) {
      // Return a no-op variant
      return this.createVariant(
        selectedParent,
        {},
        'Code emitter skipped: no failing tests registered'
      );
    }

    // Select a random failing test to target
    const tests = Array.from(this.failingTests.entries());
    const [targetTestId, targetTestFile] = tests[Math.floor(Math.random() * tests.length)];

    // Select a mutation strategy
    const strategy = SAFE_MUTATION_STRATEGIES[
      Math.floor(Math.random() * SAFE_MUTATION_STRATEGIES.length)
    ];

    // Generate a hypothetical patch (in real impl, would analyze the test failure)
    const patch = this.generatePatch(strategy, targetTestId);

    return this.createVariant(
      selectedParent,
      {
        codePatches: [{
          file: `src/librainian/${strategy.targetFiles[0].replace('src/librainian/', '').replace('/**/*.ts', '/config.ts')}`,
          diff: patch.diff,
          targetTest: targetTestId,
          rationale: `${strategy.description} to fix ${targetTestId}`,
        }],
      },
      `Code patch: ${strategy.name} targeting ${targetTestId}`
    );
  }

  private generatePatch(
    strategy: CodeMutationStrategy,
    _targetTest: string
  ): { diff: string } {
    // Generate a minimal, bounded diff based on the strategy
    // In real implementation, this would analyze the test failure

    switch (strategy.id) {
      case 'timeout_increase':
        return {
          diff: `
-  timeout: 5000,
+  timeout: 10000,
`.trim(),
        };

      case 'cache_ttl_adjust':
        return {
          diff: `
-  ttl: 60000,
+  ttl: 120000,
`.trim(),
        };

      case 'threshold_adjust':
        return {
          diff: `
-  threshold: 0.7,
+  threshold: 0.6,
`.trim(),
        };

      case 'batch_size_adjust':
        return {
          diff: `
-  batchSize: 10,
+  batchSize: 20,
`.trim(),
        };

      default:
        return { diff: '' };
    }
  }

  /**
   * Validate that a code patch is within guardrails.
   */
  validatePatch(patch: NonNullable<Variant['genotype']['codePatches']>[0]): {
    valid: boolean;
    reason?: string;
  } {
    // Check diff size
    const lines = patch.diff.split('\n').length;
    if (lines > 10) {
      return { valid: false, reason: 'Diff too large (max 10 lines)' };
    }

    // Check that it targets a test
    if (!patch.targetTest) {
      return { valid: false, reason: 'No target test specified' };
    }

    // Check that rationale is provided
    if (!patch.rationale) {
      return { valid: false, reason: 'No rationale provided' };
    }

    // Check file path is within allowed scope
    const allowedPrefixes = ['src/librainian/', 'src/models/'];
    if (!allowedPrefixes.some((p) => patch.file.startsWith(p))) {
      return { valid: false, reason: 'File outside allowed scope' };
    }

    return { valid: true };
  }

  /**
   * Clear all registered failing tests.
   */
  clearFailingTests(): void {
    this.failingTests.clear();
  }
}
