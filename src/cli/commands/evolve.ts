/**
 * @fileoverview Evolve Command
 *
 * Runs the evolutionary improvement loop using MAP-Elites + UCB1 allocation.
 * Proposes variants, evaluates via staged evaluators, archives improvements.
 *
 * Usage: librarian evolve [--cycles N] [--candidates N] [--dry-run]
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type {
  EvolutionConfig,
} from '../../evolution/index.js';
import { checkAllProviders } from '../../api/provider_check.js';
import { generateStateReport } from '../../measurement/observability.js';
import { loadEvolutionModule } from '../../utils/evolution_loader.js';

type EvolutionModule = typeof import('../../evolution/index.js');

interface EvolveOptions {
  workspace: string;
  cycles?: number;
  candidates?: number;
  dryRun?: boolean;
  verbose?: boolean;
  format?: 'text' | 'json';
}

export async function evolveCommand(options: EvolveOptions): Promise<void> {
  const {
    workspace,
    cycles = 5,
    candidates = 4,
    dryRun = false,
    verbose = false,
    format = 'text',
  } = options;

  if (format === 'text') {
    console.log('\n=== Librarian Evolution ===\n');

    if (dryRun) {
      console.log('[DRY RUN] Simulating evolution without applying changes\n');
    }
  }

  // Check provider availability
  const providers = await checkAllProviders({ workspaceRoot: workspace });
  const providerAvailable = providers.llm.available && providers.embedding.available;

  if (!providerAvailable && format === 'text') {
    console.log('\u26A0\uFE0F  Provider unavailable - evolution will be limited');
    console.log('   Only deterministic variants can be evaluated.\n');
  }

  // Initialize storage for baseline
  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();

  try {
    // Get current health as baseline context
    const stateReport = await generateStateReport(storage);

    if (format === 'text') {
      console.log(`Current Health: ${stateReport.health.status}`);
      console.log(`Mean Confidence: ${(stateReport.confidenceState.meanConfidence * 100).toFixed(1)}%\n`);
    }

    // Load or create baseline FitnessReport
    const baselinePath = path.join(workspace, 'state/audits/evolution/baseline/FitnessReport.v1.json');
    let hasBaseline = false;

    if (fs.existsSync(baselinePath)) {
      hasBaseline = true;
      if (format === 'text' && verbose) {
        console.log('Using existing baseline from:', baselinePath);
      }
    } else {
      if (format === 'text') {
        console.log('No baseline found. Run `librarian eval` first to establish baseline.\n');
      }
    }

    // Create evolution controller
    const config: Partial<EvolutionConfig> = {
      maxCycles: cycles,
      candidatesPerCycle: candidates,
    };

    const externalModuleId = 'librainian-devtools/evolution/index.js';
    const { createEvolutionController } = await loadEvolutionModule<EvolutionModule>(
      'evolve command',
      () => import('../../evolution/index.js'),
      () => import(externalModuleId) as Promise<EvolutionModule>,
    );

    const controller = createEvolutionController({
      workspaceRoot: workspace,
      config,
      auditPath: path.join(workspace, 'state/audits/evolution'),
    });

    // Initialize controller (loads persisted state)
    await controller.initialize();

    if (format === 'text') {
      const archiveStats = controller.getArchiveStats();
      console.log('Archive Status:');
      console.log(`  Cells Occupied: ${archiveStats.occupiedCells}/${archiveStats.totalCells}`);
      console.log(`  Coverage: ${(archiveStats.coverageRatio * 100).toFixed(1)}%`);
      console.log(`  Max Fitness: ${archiveStats.maxFitness?.toFixed(3) ?? 'N/A'}\n`);
    }

    if (dryRun) {
      // Dry run - show what would happen
      const emitterStats = controller.getEmitterStats();

      if (format === 'text') {
        console.log('Evolution Configuration:');
        console.log(`  Max Cycles: ${cycles}`);
        console.log(`  Candidates per Cycle: ${candidates}`);
        console.log(`  Provider Available: ${providerAvailable}\n`);

        console.log('Emitter Statistics:');
        for (const stats of emitterStats) {
          console.log(`  ${stats.emitterId}:`);
          console.log(`    Trials: ${stats.totalTrials}, Improvements: ${stats.successfulImprovements}`);
          console.log(`    Avg Reward: ${stats.avgReward.toFixed(3)}`);
        }
        console.log();

        console.log('[DRY RUN] Would run evolution with above configuration.\n');
      } else {
        console.log(JSON.stringify({
          dryRun: true,
          config: { cycles, candidates, providerAvailable },
          archiveStats: controller.getArchiveStats(),
          emitterStats,
        }, null, 2));
      }
      return;
    }

    // Run evolution
    if (format === 'text') {
      console.log('Running evolution...\n');
    }

    const startTime = Date.now();
    const { results, totalResourceUsage, bestVariant } = await controller.runEvolution(
      cycles,
      providerAvailable
    );

    const duration = Date.now() - startTime;

    // Output results
    if (format === 'json') {
      console.log(JSON.stringify({
        cycles: results.length,
        totalResourceUsage,
        bestVariant: bestVariant ? {
          id: bestVariant.id,
          emitterId: bestVariant.emitterId,
          mutationDescription: bestVariant.mutationDescription,
          fitness: bestVariant.fitnessReport?.fitness.overall,
        } : null,
        archiveStats: controller.getArchiveStats(),
        emitterStats: controller.getEmitterStats(),
      }, null, 2));
      return;
    }

    // Text format output
    console.log('=== Evolution Results ===\n');

    // Per-cycle summary
    if (verbose) {
      console.log('Cycle Results:');
      for (const result of results) {
        console.log(`  ${result.cycleId}:`);
        console.log(`    Generated: ${result.candidatesGenerated}, Evaluated: ${result.candidatesEvaluated}`);
        console.log(`    Improvements: ${result.improvementsFound}, Archive Updates: ${result.archiveUpdates}`);
      }
      console.log();
    }

    // Summary
    const totalImprovements = results.reduce((sum, r) => sum + r.improvementsFound, 0);
    const totalEvaluated = results.reduce((sum, r) => sum + r.candidatesEvaluated, 0);
    const totalArchiveUpdates = results.reduce((sum, r) => sum + r.archiveUpdates, 0);

    console.log('Summary:');
    console.log(`  Cycles Completed: ${results.length}`);
    console.log(`  Total Candidates Evaluated: ${totalEvaluated}`);
    console.log(`  Improvements Found: ${totalImprovements}`);
    console.log(`  Archive Updates: ${totalArchiveUpdates}`);
    console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log();

    console.log('Resource Usage:');
    console.log(`  Tokens: ${totalResourceUsage.tokensUsed}`);
    console.log(`  Embeddings: ${totalResourceUsage.embeddingsUsed}`);
    console.log(`  Provider Calls: ${totalResourceUsage.providerCallsUsed}`);
    console.log();

    // Final archive state
    const finalArchiveStats = controller.getArchiveStats();
    console.log('Final Archive:');
    console.log(`  Cells Occupied: ${finalArchiveStats.occupiedCells}/${finalArchiveStats.totalCells}`);
    console.log(`  Coverage: ${(finalArchiveStats.coverageRatio * 100).toFixed(1)}%`);
    console.log(`  Max Fitness: ${finalArchiveStats.maxFitness?.toFixed(3) ?? 'N/A'}`);
    console.log();

    // Best variant info
    if (bestVariant) {
      console.log('Best Variant:');
      console.log(`  ID: ${bestVariant.id}`);
      console.log(`  Emitter: ${bestVariant.emitterId}`);
      console.log(`  Mutation: ${bestVariant.mutationDescription}`);
      if (bestVariant.fitnessReport) {
        console.log(`  Fitness: ${bestVariant.fitnessReport.fitness.overall.toFixed(3)}`);
      }
      console.log();
    }

    // Emitter performance
    const emitterStats = controller.getEmitterStats();
    console.log('Emitter Performance:');
    for (const stats of emitterStats) {
      const successRate = stats.totalTrials > 0
        ? (stats.successfulImprovements / stats.totalTrials * 100).toFixed(1)
        : '0.0';
      console.log(`  ${stats.emitterId}: ${stats.totalTrials} trials, ${successRate}% success`);
    }
    console.log();

    // Recommendations
    if (totalImprovements > 0) {
      console.log('\u2705 Found improvements! Review variants in state/audits/evolution/\n');
    } else if (results.length >= cycles) {
      console.log('\u26A0\uFE0F  No improvements found. Consider:');
      console.log('   - Running more cycles');
      console.log('   - Adjusting emitter parameters');
      console.log('   - Ensuring provider availability for deeper evaluation\n');
    }
  } finally {
    await storage.close();
  }
}
