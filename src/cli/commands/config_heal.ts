/**
 * @fileoverview Config Heal Command
 *
 * Diagnoses and heals configuration issues automatically.
 *
 * Usage: librainian config heal [--dry-run] [--verbose] [--risk-tolerance safe|low|medium]
 *
 * @packageDocumentation
 */

import {
  diagnoseConfiguration,
  autoHealConfiguration,
  rollbackConfiguration,
  getEffectivenessHistory,
  type ConfigHealthReport,
  type ConfigIssue,
  type HealingResult,
} from '../../config/index.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ConfigHealOptions {
  workspace: string;
  dryRun?: boolean;
  verbose?: boolean;
  riskTolerance?: 'safe' | 'low' | 'medium';
  format?: 'text' | 'json';
  diagnoseOnly?: boolean;
  rollback?: boolean;
  showHistory?: boolean;
}

// ============================================================================
// COMMAND IMPLEMENTATION
// ============================================================================

export async function configHealCommand(options: ConfigHealOptions): Promise<void> {
  const {
    workspace,
    dryRun = false,
    verbose = false,
    riskTolerance = 'low',
    format = 'text',
    diagnoseOnly = false,
    rollback = false,
    showHistory = false,
  } = options;

  // Handle rollback request
  if (rollback) {
    await handleRollback(workspace, format);
    return;
  }

  // Handle history request
  if (showHistory) {
    await handleShowHistory(workspace, format);
    return;
  }

  // Run diagnosis
  const report = await diagnoseConfiguration(workspace);

  if (format === 'json') {
    if (diagnoseOnly) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
  } else {
    printDiagnosisReport(report, verbose);
  }

  // Stop here if diagnose only
  if (diagnoseOnly) {
    return;
  }

  // Check if healing is needed
  if (report.isOptimal) {
    if (format === 'text') {
      console.log('\nConfiguration is optimal. No healing needed.\n');
    }
    return;
  }

  // Check if there are auto-fixable issues
  if (report.autoFixable.length === 0) {
    if (format === 'text') {
      console.log('\nNo auto-fixable issues found. Manual intervention may be needed.\n');
      printRecommendations(report.recommendations, verbose);
    }
    return;
  }

  // Run healing
  if (format === 'text') {
    console.log('\n=== Auto-Healing Configuration ===\n');

    if (dryRun) {
      console.log('[DRY RUN] The following fixes would be applied:\n');
    }
  }

  const result = await autoHealConfiguration(workspace, {
    dryRun,
    riskTolerance,
  });

  if (format === 'json') {
    console.log(JSON.stringify({
      diagnosis: report,
      healing: result,
    }, null, 2));
    return;
  }

  // Print healing results
  printHealingResult(result, verbose);

  // Set exit code if healing failed
  if (!result.success && !dryRun) {
    process.exitCode = 1;
  }
}

// ============================================================================
// OUTPUT FORMATTERS
// ============================================================================

function printDiagnosisReport(report: ConfigHealthReport, verbose: boolean): void {
  console.log('\n=== Configuration Health Report ===\n');

  // Health score with visual indicator
  const healthBar = getHealthBar(report.healthScore);
  console.log(`Health Score: ${healthBar} ${(report.healthScore * 100).toFixed(0)}%`);
  console.log(`Status: ${report.isOptimal ? 'Optimal' : 'Needs Attention'}\n`);

  // Summary
  console.log('Summary:');
  console.log(`  Total Issues: ${report.summary.totalIssues}`);
  console.log(`  Critical Issues: ${report.summary.criticalIssues}`);
  console.log(`  Auto-Fixable: ${report.summary.autoFixableCount}`);
  console.log(`  Drift Score: ${(report.summary.driftScore * 100).toFixed(0)}%`);
  console.log(`  Staleness Score: ${(report.summary.stalenessScore * 100).toFixed(0)}%`);
  console.log('');

  // Issues
  if (report.issues.length > 0) {
    console.log('Issues Detected:');

    // Group by severity
    const bySeverity = groupIssuesBySeverity(report.issues);

    for (const [severity, issues] of Object.entries(bySeverity)) {
      if (issues.length === 0) continue;

      const icon = getSeverityIcon(severity);
      console.log(`\n  ${icon} ${severity.toUpperCase()} (${issues.length}):`);

      for (const issue of issues) {
        console.log(`    - ${issue.title}`);
        if (verbose) {
          console.log(`      ${issue.description}`);
          console.log(`      Config: ${issue.configKey} = ${JSON.stringify(issue.currentValue)}`);
          if (issue.expectedValue !== undefined) {
            console.log(`      Recommended: ${JSON.stringify(issue.expectedValue)}`);
          }
        }
      }
    }
  } else {
    console.log('No issues detected.\n');
  }

  // Auto-fixable issues
  if (report.autoFixable.length > 0) {
    console.log('\nAuto-Fixable Issues:');
    for (const fix of report.autoFixable) {
      const riskIcon = getRiskIcon(fix.riskLevel);
      console.log(`  ${riskIcon} ${fix.issueId} (risk: ${fix.riskLevel})`);

      if (verbose) {
        for (const change of fix.changes) {
          console.log(`    ${change.key}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`);
        }
      }
    }
  }
}

function printRecommendations(
  recommendations: ConfigHealthReport['recommendations'],
  verbose: boolean
): void {
  if (recommendations.length === 0) return;

  console.log('\n=== Recommendations ===\n');

  for (const rec of recommendations) {
    const priorityIcon = getPriorityIcon(rec.priority);
    console.log(`${priorityIcon} ${rec.title}`);
    console.log(`   Impact: ${rec.estimatedImpact}`);

    if (verbose) {
      console.log(`   ${rec.description}`);
      console.log(`   Reasoning: ${rec.reasoning}`);

      if (rec.suggestedChanges.length > 0) {
        console.log('   Suggested changes:');
        for (const change of rec.suggestedChanges) {
          console.log(`     ${change.key}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`);
        }
      }
    }
    console.log('');
  }
}

function printHealingResult(result: HealingResult, verbose: boolean): void {
  if (result.success) {
    console.log('Healing successful!\n');
  } else {
    console.log('Healing completed with errors.\n');
  }

  console.log(`Applied Fixes: ${result.appliedFixes.length}`);
  console.log(`Failed Fixes: ${result.failedFixes.length}`);
  console.log(`New Health Score: ${(result.newHealthScore * 100).toFixed(0)}%`);
  console.log(`Duration: ${result.durationMs}ms`);

  if (result.rollbackAvailable) {
    console.log('\nRollback available: Run "librainian config heal --rollback" to undo');
  }

  if (verbose && result.appliedFixes.length > 0) {
    console.log('\nApplied Fixes:');
    for (const fix of result.appliedFixes) {
      console.log(`  - ${fix.issueId}`);
      for (const change of fix.changes) {
        console.log(`    ${change.key}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`);
      }
    }
  }

  if (result.failedFixes.length > 0) {
    console.log('\nFailed Fixes:');
    for (const { fix, error } of result.failedFixes) {
      console.log(`  - ${fix.issueId}: ${error}`);
    }
  }

  console.log('');
}

async function handleRollback(workspace: string, format: string): Promise<void> {
  const result = await rollbackConfiguration(workspace);

  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.success) {
    console.log('\nConfiguration rolled back successfully.\n');
  } else {
    console.log(`\nRollback failed: ${result.error}\n`);
    process.exitCode = 1;
  }
}

async function handleShowHistory(workspace: string, format: string): Promise<void> {
  const history = await getEffectivenessHistory(workspace);

  if (format === 'json') {
    console.log(JSON.stringify(history, null, 2));
    return;
  }

  console.log('\n=== Configuration Effectiveness History ===\n');

  console.log(`Workspace: ${history.workspace}`);
  console.log(`Overall Trend: ${getTrendIcon(history.overallTrend)} ${history.overallTrend}`);

  if (history.metrics.length > 0) {
    console.log('\nMetrics:');
    for (const metric of history.metrics) {
      console.log(`\n  ${metric.metric}:`);
      console.log(`    Trend: ${getTrendIcon(metric.trend)} ${metric.trend}`);
      console.log(`    Average: ${(metric.average * 100).toFixed(1)}%`);
      console.log(`    Std Dev: ${(metric.stdDev * 100).toFixed(1)}%`);
      console.log(`    Data Points: ${metric.values.length}`);
    }
  } else {
    console.log('\nNo effectiveness data collected yet.');
  }

  console.log('');
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getHealthBar(score: number): string {
  const filled = Math.round(score * 10);
  const empty = 10 - filled;
  return '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
}

function getSeverityIcon(severity: string): string {
  const icons: Record<string, string> = {
    critical: '[!]',
    error: '[X]',
    warning: '[~]',
    info: '[i]',
  };
  return icons[severity] || '[-]';
}

function getRiskIcon(risk: string): string {
  const icons: Record<string, string> = {
    safe: '[S]',
    low: '[L]',
    medium: '[M]',
    high: '[H]',
  };
  return icons[risk] || '[-]';
}

function getPriorityIcon(priority: number): string {
  if (priority <= 1) return '[1]';
  if (priority <= 2) return '[2]';
  if (priority <= 3) return '[3]';
  return '[+]';
}

function getTrendIcon(trend: string): string {
  const icons: Record<string, string> = {
    improving: '^',
    stable: '-',
    degrading: 'v',
  };
  return icons[trend] || '?';
}

function groupIssuesBySeverity(
  issues: ConfigIssue[]
): Record<string, ConfigIssue[]> {
  const result: Record<string, ConfigIssue[]> = {
    critical: [],
    error: [],
    warning: [],
    info: [],
  };

  for (const issue of issues) {
    const category = result[issue.severity];
    if (category) {
      category.push(issue);
    }
  }

  return result;
}
