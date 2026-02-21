/**
 * @fileoverview Example: Using the Automatic Feedback Loop
 *
 * This example demonstrates how to:
 * 1. Initialize the feedback loop
 * 2. Track tasks with context packs
 * 3. Record outcomes explicitly
 * 4. Infer outcomes from tool outputs
 * 5. Analyze calibration bias
 *
 * Run with: npx tsx examples/feedback_loop_example.ts
 */

import {
  createLiBrainian,
  createFeedbackLoop,
  initFeedbackLoop,
  recordOutcome,
  startTask,
  recordSignal,
  analyzeBias,
  inferOutcomeFromToolOutput,
  type FeedbackLoopConfig,
  type CompletionSignal,
} from '../src/index.js';

async function main() {
  // For this example, we'll use a mock storage
  // In real usage, you'd get storage from the LiBrainian instance
  const mockStorage = {
    getContextPack: async (id: string) => ({
      packId: id,
      confidence: 0.7,
      successCount: 0,
      failureCount: 0,
    }),
    upsertContextPack: async () => undefined,
    recordContextPackAccess: async () => undefined,
    setState: async () => undefined,
    getState: async () => null,
  } as any;

  console.log('=== Feedback Loop Example ===\n');

  // ============================================================================
  // BASIC USAGE: Create and use a feedback loop directly
  // ============================================================================

  console.log('1. Creating feedback loop...');
  const feedbackLoop = createFeedbackLoop({
    workspace: '/path/to/project',
    storage: mockStorage,
    emitEvents: false, // Disable events for example
  });

  // Start tracking a task
  console.log('2. Starting a task...');
  const taskId = feedbackLoop.startTask(
    'Fix authentication bug in login handler',
    ['pack-auth-001', 'pack-security-002'],
    0.75 // 75% confidence
  );
  console.log(`   Task ID: ${taskId}`);

  // Record signals as they come in
  console.log('3. Recording signals...');
  feedbackLoop.recordSignal(taskId, 'type_check_pass');
  feedbackLoop.recordSignal(taskId, 'lint_pass');

  // Record explicit outcome
  console.log('4. Recording outcome...');
  await feedbackLoop.recordOutcome({
    taskId,
    success: true,
    filesModified: ['src/auth/login.ts', 'src/auth/session.ts'],
  });

  // Check stats
  const stats = feedbackLoop.getStats();
  console.log('5. Stats:', stats);

  // ============================================================================
  // GLOBAL API: Initialize once, use anywhere
  // ============================================================================

  console.log('\n=== Global API ===\n');

  // Initialize the global feedback loop
  initFeedbackLoop({
    workspace: '/path/to/project',
    storage: mockStorage,
    emitEvents: false,
  });

  // Use the simple API from anywhere
  const globalTaskId = startTask('Refactor database queries', ['pack-db-001'], 0.8);
  console.log(`Started global task: ${globalTaskId}`);

  // Record outcome using the simple API
  await recordOutcome({
    taskId: globalTaskId,
    success: true,
    filesModified: ['src/db/queries.ts'],
  });
  console.log('Recorded outcome via simple API');

  // ============================================================================
  // TOOL OUTPUT INFERENCE
  // ============================================================================

  console.log('\n=== Tool Output Inference ===\n');

  // Infer outcome from test results
  const testResult = inferOutcomeFromToolOutput({
    testOutput: { exitCode: 0, failureCount: 0 },
    typeCheckOutput: { exitCode: 0, errorCount: 0 },
    lintOutput: { exitCode: 0, errorCount: 0 },
  });
  console.log('From passing tests:', testResult);

  // Infer outcome from failing tests
  const failResult = inferOutcomeFromToolOutput({
    testOutput: { exitCode: 1, failureCount: 3 },
    typeCheckOutput: { exitCode: 0, errorCount: 0 },
  });
  console.log('From failing tests:', failResult);

  // ============================================================================
  // BIAS ANALYSIS
  // ============================================================================

  console.log('\n=== Bias Analysis ===\n');

  const bias = await analyzeBias();
  console.log('Calibration bias:', bias);

  console.log('\n=== Example Complete ===');
}

// Run the example
main().catch(console.error);
