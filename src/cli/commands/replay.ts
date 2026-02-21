/**
 * @fileoverview Replay Command
 *
 * Replays an evolution cycle or variant evaluation for debugging and analysis.
 * Useful for understanding why variants succeeded or failed.
 *
 * Usage: librarian replay <cycle-id|variant-id> [--verbose]
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  EvolutionCycleResult,
  Variant,
  FitnessReport,
  StageResult,
} from '../../evolution/types.js';
import { CliError } from '../errors.js';
import { sanitizeTraceStatus } from '../user_messages.js';

interface ReplayOptions {
  workspace: string;
  target: string;
  verbose?: boolean;
  format?: 'text' | 'json';
}

export async function replayCommand(options: ReplayOptions): Promise<void> {
  const {
    workspace,
    target,
    verbose = false,
    format = 'text',
  } = options;

  if (!target) {
    throw new CliError(
      'Missing replay target. Usage: librarian replay <cycle-id|variant-id>.',
      'INVALID_ARGUMENT',
    );
  }

  const auditPath = path.join(workspace, 'state/audits/evolution');

  // Try to find as cycle first
  const cyclePath = path.join(auditPath, 'cycles', `${target}.json`);
  if (fs.existsSync(cyclePath)) {
    await replayCycle(cyclePath, verbose, format);
    return;
  }

  // Try to find in archive
  const archivePath = path.join(auditPath, 'archive.json');
  if (fs.existsSync(archivePath)) {
    const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    const variant = findVariantInArchive(archive, target);
    if (variant) {
      replayVariant(variant, verbose, format);
      return;
    }
  }

  // Search cycle files for variant
  const cyclesDir = path.join(auditPath, 'cycles');
  if (fs.existsSync(cyclesDir)) {
    const cycleFiles = fs.readdirSync(cyclesDir).filter(f => f.endsWith('.json'));
    for (const file of cycleFiles) {
      const filePath = path.join(cyclesDir, file);
      const cycle = JSON.parse(fs.readFileSync(filePath, 'utf8')) as EvolutionCycleResult;
      if (cycle.bestVariant?.id === target) {
        replayVariant(cycle.bestVariant, verbose, format);
        return;
      }
    }
  }

  const availableCycles = listAvailableCycles(auditPath);
  const availableSnippet = availableCycles.length > 0
    ? ` Available cycle IDs: ${availableCycles.join(', ')}.`
    : ' No cycle artifacts found under state/audits/evolution/cycles.';
  throw new CliError(
    `Could not find cycle or variant with ID "${target}". Verify the ID and retry.${availableSnippet}`,
    'ENTITY_NOT_FOUND',
  );
}

async function replayCycle(
  cyclePath: string,
  verbose: boolean,
  format: 'text' | 'json'
): Promise<void> {
  const cycle = JSON.parse(fs.readFileSync(cyclePath, 'utf8')) as EvolutionCycleResult;

  if (format === 'json') {
    console.log(JSON.stringify(cycle, null, 2));
    return;
  }

  console.log('\n=== Evolution Cycle Replay ===\n');
  console.log(`Cycle ID: ${cycle.cycleId}`);
  console.log(`Started: ${cycle.startedAt}`);
  console.log(`Completed: ${cycle.completedAt}`);
  console.log();

  console.log('Generation:');
  console.log(`  Candidates Generated: ${cycle.candidatesGenerated}`);
  console.log(`  Candidates Evaluated: ${cycle.candidatesEvaluated}`);
  console.log();

  console.log('Results:');
  console.log(`  Improvements Found: ${cycle.improvementsFound}`);
  console.log(`  Archive Updates: ${cycle.archiveUpdates}`);
  console.log();

  console.log('Resource Usage:');
  console.log(`  Tokens: ${cycle.resourceUsage.tokensUsed}`);
  console.log(`  Embeddings: ${cycle.resourceUsage.embeddingsUsed}`);
  console.log(`  Provider Calls: ${cycle.resourceUsage.providerCallsUsed}`);
  console.log(`  Duration: ${(cycle.resourceUsage.durationMs / 1000).toFixed(1)}s`);
  console.log();

  if (cycle.bestVariant) {
    console.log('Best Variant:');
    console.log(`  ID: ${cycle.bestVariant.id}`);
    console.log(`  Emitter: ${cycle.bestVariant.emitterId}`);
    console.log(`  Mutation: ${cycle.bestVariant.mutationDescription}`);

    if (cycle.bestVariant.fitnessReport && verbose) {
      console.log('\n  Fitness Details:');
      const fitness = cycle.bestVariant.fitnessReport.fitness;
      console.log(`    Overall: ${(fitness.overall * 100).toFixed(1)}%`);
      console.log(`    Tier-0 Pass: ${(fitness.correctness.tier0PassRate * 100).toFixed(1)}%`);
      console.log(`    Recall@5: ${(fitness.retrievalQuality.recallAt5 * 100).toFixed(1)}%`);
    }

    if (verbose) {
      console.log('\n  Genotype:');
      console.log(JSON.stringify(cycle.bestVariant.genotype, null, 4));
    }
  } else {
    console.log('No best variant recorded for this cycle.');
  }

  console.log();
}

function replayVariant(
  variant: Variant,
  verbose: boolean,
  format: 'text' | 'json'
): void {
  if (format === 'json') {
    console.log(JSON.stringify(variant, null, 2));
    return;
  }

  console.log('\n=== Variant Replay ===\n');
  console.log(`Variant ID: ${variant.id}`);
  console.log(`Parent ID: ${variant.parentId ?? 'none (root)'}`);
  console.log(`Emitter: ${variant.emitterId}`);
  console.log(`Created: ${variant.createdAt}`);
  console.log(`Evaluated: ${variant.evaluated}`);
  console.log();

  console.log('Mutation Description:');
  console.log(`  ${variant.mutationDescription}`);
  console.log();

  console.log('Genotype:');
  printGenotype(variant.genotype);
  console.log();

  if (variant.fitnessReport) {
    console.log('Fitness Report:');
    const report = variant.fitnessReport;

    console.log(`  Overall Fitness: ${(report.fitness.overall * 100).toFixed(1)}%`);
    console.log();

    console.log('  Stage Results:');
    const stages = [
      { name: 'Stage 0', result: report.stages.stage0_static },
      { name: 'Stage 1', result: report.stages.stage1_tier0 },
      { name: 'Stage 2', result: report.stages.stage2_tier1 },
      { name: 'Stage 3', result: report.stages.stage3_tier2 },
      { name: 'Stage 4', result: report.stages.stage4_adversarial },
    ];

    for (const stage of stages) {
      const emoji = stage.result.status === 'passed' ? '\u2705' :
                    stage.result.status === 'skipped' ? '\u23E9' :
                    stage.result.status === 'unverified_by_trace' ? '\u2753' : '\u274C';
      console.log(`    ${emoji} ${stage.name}: ${sanitizeTraceStatus(stage.result.status)}`);

      if (verbose && stage.result.metrics) {
        for (const [key, value] of Object.entries(stage.result.metrics)) {
          const formatted = typeof value === 'number' ? value.toFixed(3) : String(value);
          console.log(`        ${key}: ${formatted}`);
        }
      }
    }
    console.log();

    if (verbose) {
      console.log('  Fitness Vector:');
      console.log(`    Tier-0 Pass: ${(report.fitness.correctness.tier0PassRate * 100).toFixed(1)}%`);
      console.log(`    Recall@5: ${(report.fitness.retrievalQuality.recallAt5 * 100).toFixed(1)}%`);
      console.log(`    Evidence Coverage: ${(report.fitness.epistemicQuality.evidenceCoverage * 100).toFixed(1)}%`);
      console.log(`    Cache Hit Rate: ${(report.fitness.operationalQuality.cacheHitRate * 100).toFixed(1)}%`);
      console.log();

      console.log('  Behavior Descriptors:');
      const bd = report.behaviorDescriptors;
      console.log(`    Latency: ${bd.latencyBucket}`);
      console.log(`    Cost: ${bd.tokenCostBucket}`);
      console.log(`    Evidence: ${bd.evidenceCompletenessBucket}`);
      console.log(`    Retrieval: ${bd.retrievalStrategy}`);
      console.log(`    Provider: ${bd.providerReliance}`);
      console.log();
    }

    if (report.baselineDelta) {
      console.log('  Baseline Comparison:');
      console.log(`    Pareto Improvement: ${report.baselineDelta.isParetoImprovement ? 'Yes' : 'No'}`);
      if (report.baselineDelta.improvements.length > 0) {
        console.log(`    Improvements: ${report.baselineDelta.improvements.join(', ')}`);
      }
      if (report.baselineDelta.regressions.length > 0) {
        console.log(`    Regressions: ${report.baselineDelta.regressions.join(', ')}`);
      }
      console.log();
    }
  } else {
    console.log('No fitness report available for this variant.');
    console.log();
  }
}

function printGenotype(genotype: Variant['genotype']): void {
  if (genotype.retrievalParams) {
    console.log('  Retrieval Params:');
    const p = genotype.retrievalParams;
    if (p.lexicalWeight !== undefined) console.log(`    Lexical Weight: ${p.lexicalWeight.toFixed(2)}`);
    if (p.semanticWeight !== undefined) console.log(`    Semantic Weight: ${p.semanticWeight.toFixed(2)}`);
    if (p.graphWeight !== undefined) console.log(`    Graph Weight: ${p.graphWeight.toFixed(2)}`);
    if (p.coChangeBoost !== undefined) console.log(`    Co-Change Boost: ${p.coChangeBoost.toFixed(2)}`);
    if (p.rerankerThreshold !== undefined) console.log(`    Reranker Threshold: ${p.rerankerThreshold.toFixed(2)}`);
    if (p.graphExpansionDepth !== undefined) console.log(`    Graph Expansion Depth: ${p.graphExpansionDepth}`);
  }

  if (genotype.promptTemplates) {
    const templates = Object.entries(genotype.promptTemplates).filter(([_, v]) => v !== undefined);
    if (templates.length > 0) {
      console.log(`  Prompt Templates: ${templates.length} defined`);
      for (const [key, _] of templates) {
        console.log(`    - ${key}`);
      }
    }
  }

  if (genotype.budgetThresholds) {
    console.log('  Budget Thresholds:');
    const b = genotype.budgetThresholds;
    if (b.maxTokensPerHour !== undefined) console.log(`    Max Tokens/Hour: ${b.maxTokensPerHour}`);
    if (b.maxEmbeddingsPerHour !== undefined) console.log(`    Max Embeddings/Hour: ${b.maxEmbeddingsPerHour}`);
    if (b.confidenceDecayRate !== undefined) console.log(`    Confidence Decay Rate: ${b.confidenceDecayRate}`);
    if (b.recoveryTriggerThreshold !== undefined) console.log(`    Recovery Trigger: ${b.recoveryTriggerThreshold}`);
  }

  if (genotype.evaluationSet) {
    console.log('  Evaluation Set:');
    const e = genotype.evaluationSet;
    if (e.addedScenarios?.length) console.log(`    Added Scenarios: ${e.addedScenarios.length}`);
    if (e.removedScenarios?.length) console.log(`    Removed Scenarios: ${e.removedScenarios.length}`);
    if (e.metamorphicTransforms?.length) console.log(`    Metamorphic Transforms: ${e.metamorphicTransforms.length}`);
  }

  if (genotype.codePatches && genotype.codePatches.length > 0) {
    console.log(`  Code Patches: ${genotype.codePatches.length}`);
    for (const patch of genotype.codePatches) {
      console.log(`    - ${patch.file}: ${patch.rationale}`);
    }
  }
}

function findVariantInArchive(archive: unknown, variantId: string): Variant | null {
  if (!archive || typeof archive !== 'object') return null;

  const cells = (archive as Record<string, unknown>).cells;
  if (!cells || !Array.isArray(cells)) return null;

  for (const cell of cells) {
    if (cell && typeof cell === 'object') {
      const variant = (cell as Record<string, unknown>).variant as Variant | undefined;
      if (variant?.id === variantId) {
        return variant;
      }
    }
  }

  return null;
}

function listAvailableCycles(auditPath: string): string[] {
  const cyclesDir = path.join(auditPath, 'cycles');
  if (!fs.existsSync(cyclesDir)) {
    return [];
  }

  return fs.readdirSync(cyclesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .slice(0, 10);
}
