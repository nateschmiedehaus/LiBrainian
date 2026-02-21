/**
 * @fileoverview Heal Command
 *
 * Runs the homeostatic healing loop using the MAPE-K control loop with:
 * - Autonomous health monitoring and trigger wiring
 * - Thompson Sampling for strategy learning
 * - Persistent learning across sessions
 *
 * Usage: librainian heal [--max-cycles N] [--budget-tokens N] [--dry-run] [--daemon]
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import {
  generateStateReport,
  type LiBrainianStateReport,
} from '../../measurement/observability.js';
import {
  type RecoveryBudget,
  DEFAULT_RECOVERY_BUDGET,
  diagnoseDegradation,
  planRecoveryActions,
  executeRecovery,
} from '../../integration/recovery.js';
import {
  createHomeostasisDaemon,
  type HealingRecord,
} from '../../homeostasis/index.js';
import {
  createPersistentLearner,
  saveLearnerState,
  getLearnerStateSummary,
} from '../../learning/index.js';
import { LiBrainianEventBus } from '../../events.js';
import { checkAllProviders } from '../../api/provider_check.js';

interface HealOptions {
  workspace: string;
  maxCycles?: number;
  budgetTokens?: number;
  dryRun?: boolean;
  verbose?: boolean;
  daemon?: boolean;
  watchInterval?: number;
}

interface HealResult {
  startedAt: string;
  completedAt: string;
  initialStatus: string;
  finalStatus: string;
  cyclesRun: number;
  actionsExecuted: number;
  success: boolean;
  reason: string;
  learnerStats?: {
    strategiesLearned: number;
    antiPatternsDetected: number;
  };
}

export async function healCommand(options: HealOptions): Promise<void> {
  const {
    workspace,
    maxCycles = 10,
    budgetTokens = DEFAULT_RECOVERY_BUDGET.maxTokensPerHour,
    dryRun = false,
    verbose = false,
    daemon = false,
    watchInterval = 60000,
  } = options;

  console.log('\n=== LiBrainian Heal ===\n');

  if (dryRun) {
    console.log('[DRY RUN] No changes will be made\n');
  }

  if (daemon) {
    console.log('[DAEMON MODE] Will run continuously and watch for changes\n');
  }

  // Initialize storage
  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();

  // Create event bus for homeostasis
  const eventBus = new LiBrainianEventBus();

  // Load persistent learner
  const { learner, save: saveLearner } = await createPersistentLearner({
    workspaceRoot: workspace,
    autoSave: !dryRun, // Only auto-save if not dry run
  });

  // Show learner stats if available
  const learnerSummary = getLearnerStateSummary(workspace);
  if (learnerSummary.exists && verbose) {
    console.log('Recovery Learner State:');
    console.log(`  Strategies Learned: ${learnerSummary.strategiesCount ?? 0}`);
    console.log(`  Last Updated: ${learnerSummary.updatedAt ?? 'N/A'}\n`);
  }

  try {
    // Check provider availability
    const providers = await checkAllProviders({ workspaceRoot: workspace });
    const providerAvailable = providers.llm.available && providers.embedding.available;

    if (!providerAvailable) {
      console.log('\u26A0\uFE0F  Provider unavailable - running in degraded mode');
      console.log('   Only deterministic recovery actions will be attempted.\n');
    }

    // Generate initial state report
    const initialReport = await generateStateReport(storage);
    console.log(`Initial Status: ${getStatusEmoji(initialReport.health.status)} ${initialReport.health.status.toUpperCase()}`);
    console.log(`Recovery State: ${initialReport.recoveryState}\n`);

    if (initialReport.health.status === 'healthy' && !daemon) {
      console.log('\u2705 LiBrainian is already healthy. No healing needed.\n');
      return;
    }

    // Show degradation reasons
    if (initialReport.health.degradationReasons.length > 0) {
      console.log('Degradation Reasons:');
      for (const reason of initialReport.health.degradationReasons) {
        console.log(`  - ${reason}`);
      }
      console.log();
    }

    const result: HealResult = {
      startedAt: new Date().toISOString(),
      completedAt: '',
      initialStatus: initialReport.health.status,
      finalStatus: initialReport.health.status,
      cyclesRun: 0,
      actionsExecuted: 0,
      success: false,
      reason: '',
    };

    if (daemon) {
      // Run in daemon mode with homeostasis
      await runDaemonMode({
        storage,
        eventBus,
        learner,
        workspace,
        verbose,
        dryRun,
        watchInterval,
        maxCycles,
        budgetTokens,
      });
    } else {
      // Run single healing session
      await runSingleHealSession({
        storage,
        eventBus,
        learner,
        workspace,
        verbose,
        dryRun,
        maxCycles,
        budgetTokens,
        result,
        initialReport,
      });

      result.completedAt = new Date().toISOString();

      // Add learner stats to result
      const summary = learner.getSummary();
      result.learnerStats = {
        strategiesLearned: summary.totalStrategies,
        antiPatternsDetected: summary.antiPatternCount,
      };

      // Final status
      console.log('\n=== Heal Result ===\n');
      console.log(`Cycles Run: ${result.cyclesRun}`);
      console.log(`Actions Executed: ${result.actionsExecuted}`);
      console.log(`Final Status: ${getStatusEmoji(result.finalStatus)} ${result.finalStatus.toUpperCase()}`);

      if (result.learnerStats) {
        console.log(`\nLearner Stats:`);
        console.log(`  Strategies Learned: ${result.learnerStats.strategiesLearned}`);
        console.log(`  Anti-patterns Detected: ${result.learnerStats.antiPatternsDetected}`);
      }

      if (result.success) {
        console.log('\n\u2705 Healing successful!\n');
      } else {
        console.log(`\n\u26A0\uFE0F  Healing incomplete: ${result.reason || 'Max cycles reached'}\n`);
      }

      // Save learner state
      if (!dryRun) {
        await saveLearner();
      }

      // Save audit record
      const auditPath = path.join(workspace, 'state/audits/heal');
      if (!fs.existsSync(auditPath)) {
        fs.mkdirSync(auditPath, { recursive: true });
      }

      const auditFile = path.join(auditPath, `heal_${Date.now()}.json`);
      fs.writeFileSync(auditFile, JSON.stringify(result, null, 2));

      if (verbose) {
        console.log(`Audit saved to: ${auditFile}\n`);
      }

      // Exit code
      if (!result.success && !dryRun) {
        process.exitCode = 1;
      }
    }
  } finally {
    await storage.close();
  }
}

async function runSingleHealSession(options: {
  storage: ReturnType<typeof createSqliteStorage>;
  eventBus: LiBrainianEventBus;
  learner: Awaited<ReturnType<typeof createPersistentLearner>>['learner'];
  workspace: string;
  verbose: boolean;
  dryRun: boolean;
  maxCycles: number;
  budgetTokens: number;
  result: HealResult;
  initialReport: LiBrainianStateReport;
}): Promise<void> {
  const {
    storage,
    eventBus,
    learner,
    workspace,
    verbose,
    dryRun,
    maxCycles,
    budgetTokens,
    result,
    initialReport,
  } = options;

  // Create homeostasis daemon
  const daemon = createHomeostasisDaemon({
    storage,
    eventBus,
    recoveryLearner: learner,
    maxConcurrentActions: 3,
    recoveryBudgetTokens: budgetTokens,
    onRecoveryComplete: (record) => {
      result.cyclesRun++;
      result.actionsExecuted += record.actionsExecuted.length;
      result.finalStatus = record.fitnessAfter >= 0.5 ? 'healthy' : 'degraded';

      if (verbose) {
        console.log(`  Cycle ${result.cyclesRun}: Fitness ${(record.fitnessBefore * 100).toFixed(1)}% -> ${(record.fitnessAfter * 100).toFixed(1)}%`);
        console.log(`    Actions: ${record.actionsExecuted.length}, Success: ${record.success}`);
      }
    },
  });

  await daemon.start();

  try {
    // Run healing cycles
    for (let cycle = 0; cycle < maxCycles; cycle++) {
      if (verbose) {
        console.log(`\n--- Cycle ${cycle + 1}/${maxCycles} ---`);
      }

      if (dryRun) {
        // Dry run - show what would happen
        const report = await generateStateReport(storage);
        const diagnoses = diagnoseDegradation(report);

        if (diagnoses.length === 0) {
          console.log('  No degradation diagnosed.');
          break;
        }

        const actions = planRecoveryActions(diagnoses);
        for (const action of actions) {
          console.log(`  [DRY RUN] Would execute: ${action.action} (${action.type})`);
          result.actionsExecuted++;
        }
        result.cyclesRun++;
      } else {
        // Real healing via daemon
        const record = await daemon.triggerHealthCheck(`manual_cycle_${cycle + 1}`);

        if (!record) {
          console.log('  Skipped - healing in progress');
          continue;
        }

        if (record.fitnessAfter >= 0.7) {
          result.success = true;
          result.reason = 'Reached healthy state';
          break;
        }

        // Check if no actions were needed
        if (record.actionsExecuted.length === 0) {
          if (verbose) {
            console.log('  No recovery actions needed.');
          }
          break;
        }
      }
    }
  } finally {
    await daemon.stop();
  }
}

async function runDaemonMode(options: {
  storage: ReturnType<typeof createSqliteStorage>;
  eventBus: LiBrainianEventBus;
  learner: Awaited<ReturnType<typeof createPersistentLearner>>['learner'];
  workspace: string;
  verbose: boolean;
  dryRun: boolean;
  watchInterval: number;
  maxCycles: number;
  budgetTokens: number;
}): Promise<void> {
  const {
    storage,
    eventBus,
    learner,
    verbose,
    watchInterval,
    budgetTokens,
  } = options;

  console.log('Starting homeostasis daemon...');
  console.log(`Watch interval: ${watchInterval / 1000}s`);
  console.log('Press Ctrl+C to stop.\n');

  // Create and start daemon
  const daemon = createHomeostasisDaemon({
    storage,
    eventBus,
    recoveryLearner: learner,
    maxConcurrentActions: 3,
    recoveryBudgetTokens: budgetTokens,
    triggerConfig: {
      scheduledIntervalMs: watchInterval,
      fileChangeDebounceMs: 5000,
      queryFailureThreshold: 3,
    },
    onHealthCheckTriggered: (trigger) => {
      if (verbose) {
        console.log(`[${new Date().toISOString()}] Health check triggered: ${trigger.source}`);
      }
    },
    onRecoveryComplete: (record) => {
      const delta = record.fitnessAfter - record.fitnessBefore;
      const deltaStr = delta >= 0 ? `+${(delta * 100).toFixed(1)}%` : `${(delta * 100).toFixed(1)}%`;
      console.log(
        `[${new Date().toISOString()}] Healing complete: ` +
        `${record.actionsExecuted.length} actions, ` +
        `fitness ${(record.fitnessBefore * 100).toFixed(1)}% -> ${(record.fitnessAfter * 100).toFixed(1)}% (${deltaStr})`
      );
    },
  });

  await daemon.start();

  // Handle shutdown
  const shutdown = async () => {
    console.log('\nShutting down daemon...');
    await daemon.stop();

    // Save learner state
    await saveLearnerState(learner, options.workspace);

    // Show final stats
    const status = daemon.getStatus();
    const summary = learner.getSummary();

    console.log('\nDaemon Summary:');
    console.log(`  Health Checks: ${status.healthChecksTriggered}`);
    console.log(`  Healings Completed: ${status.healingsCompleted}`);
    console.log(`  Strategies Learned: ${summary.totalStrategies}`);
    console.log(`  Anti-patterns: ${summary.antiPatternCount}`);

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep running
  await new Promise(() => {
    // Never resolves - runs until signal
  });
}

function getStatusEmoji(status: string): string {
  const emojis: Record<string, string> = {
    healthy: '\u2705',
    degraded: '\u26A0\uFE0F',
    recovering: '\u23F3',
    unhealthy: '\u274C',
  };
  return emojis[status] || '\u2753';
}
