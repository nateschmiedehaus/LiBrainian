/**
 * @fileoverview PreFlightChecker construction
 *
 * Wraps existing pre-flight checks and returns a compact summary that is
 * easy for orchestration code to consume.
 */

import {
  runPreflightChecks,
  type PreflightOptions,
  type PreflightReport,
} from '../preflight/index.js';

export interface PreFlightSummary {
  /** Whether the workspace can proceed past pre-flight. */
  canProceed: boolean;
  /** Count of critical pre-flight failures. */
  criticalCount: number;
  /** Count of warning-level pre-flight findings. */
  warningCount: number;
  /** Full underlying pre-flight report. */
  report: PreflightReport;
}

export class PreFlightChecker {
  /**
   * Run pre-flight checks and normalize the output into a compact summary.
   */
  async check(options: PreflightOptions): Promise<PreFlightSummary> {
    const report = await runPreflightChecks(options);

    return {
      canProceed: report.canProceed,
      criticalCount: report.failedChecks.length,
      warningCount: report.warnings.length,
      report,
    };
  }
}

export function createPreFlightChecker(): PreFlightChecker {
  return new PreFlightChecker();
}
