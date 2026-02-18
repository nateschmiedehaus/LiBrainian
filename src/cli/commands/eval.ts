/**
 * @fileoverview Eval Command
 *
 * Produces a FitnessReport.v1 by running staged evaluators against current state.
 * Used to establish baselines and measure variant fitness.
 *
 * Usage: librarian eval [--output <path>] [--save-baseline] [--stages 0-4]
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import {
  runStagedEvaluation,
  type FitnessReport,
  type EvaluationContext,
  type Variant,
  type StageResult,
} from '../../evolution/index.js';
import { checkAllProviders } from '../../api/provider_check.js';
import { generateStateReport } from '../../measurement/observability.js';
import { sanitizeTraceMarkerMessage, sanitizeTraceStatus } from '../user_messages.js';

interface EvalOptions {
  workspace: string;
  output?: string;
  saveBaseline?: boolean;
  stages?: string;
  verbose?: boolean;
  format?: 'text' | 'json';
}

export async function evalCommand(options: EvalOptions): Promise<void> {
  const {
    workspace,
    output,
    saveBaseline = false,
    stages = '0-4',
    verbose = false,
    format = 'text',
  } = options;

  if (format === 'text') {
    console.log('\n=== Librarian Evaluation ===\n');
  }

  // Check provider availability
  const providers = await checkAllProviders({ workspaceRoot: workspace });
  const providerAvailable = providers.llm.available && providers.embedding.available;

  if (!providerAvailable && format === 'text') {
    console.log('\u26A0\uFE0F  Provider unavailable');
    console.log('   Stages 3-4 will be skipped (require LLM evaluation).\n');
  }

  // Initialize storage
  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();

  try {
    // Get current state
    const stateReport = await generateStateReport(storage);

    if (format === 'text') {
      console.log('Current State:');
      console.log(`  Health: ${stateReport.health.status}`);
      console.log(`  Entities: ${stateReport.codeGraphHealth.entityCount}`);
      console.log(`  Mean Confidence: ${(stateReport.confidenceState.meanConfidence * 100).toFixed(1)}%\n`);
    }

    // Parse stage range
    const [minStage, maxStage] = parseStageRange(stages);

    if (format === 'text') {
      console.log(`Running stages ${minStage}-${maxStage}...\n`);
    }

    // Create evaluation context
    const context: EvaluationContext = {
      workspaceRoot: workspace,
      providerAvailable,
      dbPath,
      budget: {
        maxTokens: 10000,
        maxEmbeddings: 100,
        maxProviderCalls: 10,
        maxDurationMs: 300000, // 5 minutes
      },
      retrievalEval: { enabled: false },
    };

    // Run staged evaluation
    const startTime = Date.now();

    // Create a "current state" variant representing the baseline
    const baselineVariant: Variant = {
      id: `baseline_${Date.now().toString(36)}`,
      parentId: null,
      emitterId: 'baseline',
      createdAt: new Date().toISOString(),
      genotype: {
        retrievalParams: {
          lexicalWeight: 0.25,
          semanticWeight: 0.35,
          graphWeight: 0.25,
          coChangeBoost: 0.15,
        },
      },
      mutationDescription: 'Baseline evaluation of current state',
      evaluated: false,
    };

    const result = await runStagedEvaluation(baselineVariant, context, {
      stopOnFailure: false,
    });

    const duration = Date.now() - startTime;
    const fitnessReport = result.fitnessReport;

    // Output based on format
    if (format === 'json') {
      console.log(JSON.stringify(fitnessReport, null, 2));
    } else {
      printFitnessReport(fitnessReport, verbose);
      console.log(`\nEvaluation completed in ${(duration / 1000).toFixed(1)}s\n`);
    }

    // Save output
    if (output || saveBaseline) {
      const outputPath = output ?? path.join(
        workspace,
        'state/audits/evolution/baseline/FitnessReport.v1.json'
      );

      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      fs.writeFileSync(outputPath, JSON.stringify(fitnessReport, null, 2));

      if (format === 'text') {
        console.log(`\u2705 Saved to: ${outputPath}\n`);
      }
    }

    // Exit code based on health and measured-reality integrity.
    if (
      fitnessReport.fitness.overall < 0.5
      || fitnessReport.scoringIntegrity.status !== 'measured'
    ) {
      process.exitCode = 1;
    }
  } finally {
    await storage.close();
  }
}

function parseStageRange(stages: string): [number, number] {
  if (stages.includes('-')) {
    const [min, max] = stages.split('-').map(Number);
    return [Math.max(0, min), Math.min(4, max)];
  }
  const stage = Number(stages);
  return [stage, stage];
}

function printFitnessReport(report: FitnessReport, verbose: boolean): void {
  const isMeasured = (value: number): boolean => Number.isFinite(value) && value >= 0;
  const formatPercent = (value: number): string => (value * 100).toFixed(1);
  const formatPercentOrUnmeasured = (value: number): string => (
    isMeasured(value) ? `${formatPercent(value)}%` : 'unmeasured'
  );

  const statusEmoji = report.fitness.overall >= 0.7 ? '\u2705' :
                      report.fitness.overall >= 0.5 ? '\u26A0\uFE0F' : '\u274C';

  console.log('=== Fitness Report ===\n');
  console.log(`Overall Fitness: ${statusEmoji} ${(report.fitness.overall * 100).toFixed(1)}%\n`);

  // Stage results
  console.log('Stage Results:');
  const stages = [
    { name: 'Stage 0 (Static)', result: report.stages.stage0_static },
    { name: 'Stage 1 (Tier-0)', result: report.stages.stage1_tier0 },
    { name: 'Stage 2 (Tier-1)', result: report.stages.stage2_tier1 },
    { name: 'Stage 3 (Tier-2)', result: report.stages.stage3_tier2 },
    { name: 'Stage 4 (Adversarial)', result: report.stages.stage4_adversarial },
  ];

  for (const stage of stages) {
    const emoji = stage.result.status === 'passed' ? '\u2705' :
                  stage.result.status === 'skipped' ? '\u23E9' :
                  stage.result.status === 'unverified_by_trace' ? '\u2753' : '\u274C';
    console.log(`  ${emoji} ${stage.name}: ${sanitizeTraceStatus(stage.result.status)}`);

    if (verbose && stage.result.metrics) {
      for (const [key, value] of Object.entries(stage.result.metrics)) {
        const formatted = typeof value === 'number' ? value.toFixed(3) : String(value);
        console.log(`      ${key}: ${formatted}`);
      }
    }
  }
  console.log();

  // Fitness vector summary
  console.log('Fitness Vector:');
  console.log(`  Overall: ${formatPercent(report.fitness.overall)}%`);
  console.log(`  Correctness (Tier-0 Pass): ${formatPercentOrUnmeasured(report.fitness.correctness.tier0PassRate)}`);
  console.log(`  Retrieval Recall@5: ${formatPercentOrUnmeasured(report.fitness.retrievalQuality.recallAt5)}`);
  console.log(`  Epistemic (Evidence Coverage): ${formatPercentOrUnmeasured(report.fitness.epistemicQuality.evidenceCoverage)}`);
  console.log(`  Operational (Cache Hit Rate): ${formatPercentOrUnmeasured(report.fitness.operationalQuality.cacheHitRate)}`);
  console.log();

  // Behavior descriptors
  console.log('Behavior Descriptors:');
  console.log(`  Latency Bucket: ${report.behaviorDescriptors.latencyBucket}`);
  console.log(`  Token Cost Bucket: ${report.behaviorDescriptors.tokenCostBucket}`);
  console.log(`  Evidence Completeness: ${report.behaviorDescriptors.evidenceCompletenessBucket}`);
  console.log(`  Calibration: ${report.behaviorDescriptors.calibrationBucket}`);
  console.log(`  Retrieval Strategy: ${report.behaviorDescriptors.retrievalStrategy}`);
  console.log(`  Provider Reliance: ${report.behaviorDescriptors.providerReliance}`);
  console.log();

  // Measurement integrity
  console.log('Scoring Integrity:');
  console.log(`  Status: ${sanitizeTraceStatus(report.scoringIntegrity.status)}`);
  console.log(`  Measured Families: ${report.scoringIntegrity.measuredFamilies}/${report.scoringIntegrity.totalFamilies}`);
  console.log(`  Coverage: ${(report.scoringIntegrity.coverageRatio * 100).toFixed(1)}%`);
  if (report.scoringIntegrity.reasons.length > 0) {
    for (const reason of report.scoringIntegrity.reasons) {
      console.log(`  - ${sanitizeTraceMarkerMessage(reason)}`);
    }
  }
  console.log();

  // Resource usage
  if (verbose) {
    console.log('Resource Usage:');
    console.log(`  Tokens: ${report.resources.tokensUsed}`);
    console.log(`  Embeddings: ${report.resources.embeddingsUsed}`);
    console.log(`  Provider Calls: ${report.resources.providerCallsUsed}`);
    console.log(`  Duration: ${(report.resources.durationMs / 1000).toFixed(1)}s`);
    console.log();
  }

  // Warnings
  const warnings: string[] = [];
  if (isMeasured(report.fitness.correctness.tier0PassRate) && report.fitness.correctness.tier0PassRate < 0.8) {
    warnings.push('Low tier-0 pass rate - check test results');
  }
  if (isMeasured(report.fitness.epistemicQuality.calibrationError) && report.fitness.epistemicQuality.calibrationError > 0.2) {
    warnings.push('High calibration error - confidence scores may be unreliable');
  }
  if (report.behaviorDescriptors.providerReliance === 'heavy-llm') {
    warnings.push('Heavy LLM reliance - may fail when providers unavailable');
  }
  if (report.scoringIntegrity.status !== 'measured') {
    warnings.push('Fitness scoring is not fully verified; resolve missing measurement families before trusting the score.');
  }

  if (warnings.length > 0) {
    console.log('\u26A0\uFE0F  Warnings:');
    for (const warning of warnings) {
      console.log(`   - ${warning}`);
    }
    console.log();
  }
}
