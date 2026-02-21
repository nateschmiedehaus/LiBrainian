/**
 * @fileoverview Defeater Activation System
 *
 * Implements active defeater checking for knowledge validation.
 * Unlike passive defeaters that just describe potential invalidation,
 * this module actively checks if defeater conditions are met.
 *
 * Based on Pollock's defeaters from argumentation theory:
 * - Rebutting defeaters: Direct evidence against the claim
 * - Undercutting defeaters: Attack the justification, not the claim
 * - Undermining defeaters: Reduce confidence without full defeat
 */

import type { Defeater, DefeaterType, KnowledgeMeta } from './universal_types.js';
import type { LiBrainianStorage } from '../storage/types.js';

export interface DefeaterCheckContext {
  entityId: string;
  filePath?: string;
  currentContentHash?: string;
  storedContentHash?: string;
  storage?: LiBrainianStorage;
  workspaceRoot?: string;
}

export interface DefeaterCheckResult {
  defeater: Defeater;
  activated: boolean;
  reason?: string;
  severity: 'full' | 'partial' | 'warning';
}

export interface ActivationSummary {
  totalDefeaters: number;
  activeDefeaters: number;
  results: DefeaterCheckResult[];
  knowledgeValid: boolean;
  confidenceAdjustment: number;  // How much to reduce confidence
}

/**
 * Check all defeaters against current state.
 */
export async function checkDefeaters(
  meta: KnowledgeMeta,
  context: DefeaterCheckContext
): Promise<ActivationSummary> {
  const results: DefeaterCheckResult[] = [];
  let confidenceAdjustment = 0;

  for (const defeater of meta.defeaters) {
    const result = await checkDefeater(defeater, context);
    results.push(result);

    if (result.activated) {
      switch (result.severity) {
        case 'full':
          confidenceAdjustment -= 0.5;
          break;
        case 'partial':
          confidenceAdjustment -= 0.2;
          break;
        case 'warning':
          confidenceAdjustment -= 0.05;
          break;
      }
    }
  }

  const activeDefeaters = results.filter(r => r.activated);
  const hasFullDefeat = activeDefeaters.some(r => r.severity === 'full');

  return {
    totalDefeaters: meta.defeaters.length,
    activeDefeaters: activeDefeaters.length,
    results,
    knowledgeValid: !hasFullDefeat,
    confidenceAdjustment: Math.max(confidenceAdjustment, -0.8), // Never reduce to 0
  };
}

/**
 * Check a single defeater against current state.
 */
async function checkDefeater(
  defeater: Defeater,
  context: DefeaterCheckContext
): Promise<DefeaterCheckResult> {
  const checker = DEFEATER_CHECKERS[defeater.type];

  if (!checker) {
    // Unknown defeater type - treat as warning
    return {
      defeater,
      activated: false,
      reason: `Unknown defeater type: ${defeater.type}`,
      severity: 'warning',
    };
  }

  return checker(defeater, context);
}

// Defeater checker functions by type
type DefeaterChecker = (
  defeater: Defeater,
  context: DefeaterCheckContext
) => Promise<DefeaterCheckResult>;

const DEFEATER_CHECKERS: Record<DefeaterType, DefeaterChecker> = {
  code_change: checkCodeChangeDefeater,
  test_failure: checkTestFailureDefeater,
  contradiction: checkContradictionDefeater,
  new_info: checkNewInfoDefeater,
};

/**
 * Check if code has changed since knowledge was generated.
 */
async function checkCodeChangeDefeater(
  defeater: Defeater,
  context: DefeaterCheckContext
): Promise<DefeaterCheckResult> {
  // Check content hash
  if (context.currentContentHash && context.storedContentHash) {
    if (context.currentContentHash !== context.storedContentHash) {
      return {
        defeater: { ...defeater, detected: new Date().toISOString() },
        activated: true,
        reason: `Content hash changed: ${context.storedContentHash.slice(0, 8)} → ${context.currentContentHash.slice(0, 8)}`,
        severity: 'full',  // Code change fully defeats knowledge
      };
    }
  }

  // If we can't check hash, check file modification time
  if (context.workspaceRoot && context.filePath?.trim()) {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const fullPath = path.resolve(context.workspaceRoot, context.filePath);
      const stats = await fs.stat(fullPath);
      const lastModified = stats.mtime.toISOString();

      // Compare with stored generation time
      // (Would need meta.generatedAt for proper comparison)
      // For now, just note that file exists and is accessible
    } catch {
      // File might have been deleted or moved
      return {
        defeater: { ...defeater, detected: new Date().toISOString() },
        activated: true,
        reason: 'File no longer accessible at original path',
        severity: 'full',
      };
    }
  }

  return {
    defeater,
    activated: false,
    severity: 'warning',
  };
}

/**
 * Check for test failures related to this entity.
 */
async function checkTestFailureDefeater(
  defeater: Defeater,
  context: DefeaterCheckContext
): Promise<DefeaterCheckResult> {
  // Check storage for recent test failures
  if (context.storage) {
    try {
      // Look for test coverage information
      const pack = await context.storage.getContextPack(context.entityId);
      if (pack) {
        // Check if there are recent failures recorded
        if (pack.failureCount > 0 && pack.lastOutcome === 'failure') {
          return {
            defeater: { ...defeater, detected: new Date().toISOString() },
            activated: true,
            reason: `Entity has ${pack.failureCount} recorded failures, last outcome was failure`,
            severity: 'partial', // Test failures partially defeat
          };
        }
      }

      // Check confidence update count as a proxy for test activity
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const updateCount = await context.storage.countConfidenceUpdates?.(
        context.entityId,
        'context_pack',
        thirtyDaysAgo
      );

      // High update count with failures suggests problems
      if (updateCount && updateCount > 5 && pack?.failureCount && pack.failureCount > 2) {
        return {
          defeater: { ...defeater, detected: new Date().toISOString() },
          activated: true,
          reason: `${pack.failureCount} failures across ${updateCount} confidence updates`,
          severity: 'partial',
        };
      }
    } catch {
      // Storage access failed - can't check
    }
  }

  return {
    defeater,
    activated: false,
    severity: 'warning',
  };
}

/**
 * Check for contradictions between documented and actual behavior.
 */
async function checkContradictionDefeater(
  defeater: Defeater,
  context: DefeaterCheckContext
): Promise<DefeaterCheckResult> {
  // Contradiction detection requires runtime data or test results
  // For now, check for patterns that suggest contradictions

  if (context.storage) {
    try {
      // Check for low confidence with high access - suggests problems
      const pack = await context.storage.getContextPack(context.entityId);
      if (pack) {
        const accessCount = pack.accessCount;
        const failureCount = pack.failureCount;
        const successCount = pack.successCount;

        // High failure rate suggests contradiction
        if (accessCount > 5) {
          const failureRate = failureCount / accessCount;
          if (failureRate > 0.5) {
            return {
              defeater: { ...defeater, detected: new Date().toISOString() },
              activated: true,
              reason: `High failure rate: ${Math.round(failureRate * 100)}% of ${accessCount} accesses failed`,
              severity: 'partial',
            };
          }
        }

        // Success followed by failure pattern
        if (successCount > 2 && failureCount > 2 && pack.lastOutcome === 'failure') {
          return {
            defeater: { ...defeater, detected: new Date().toISOString() },
            activated: true,
            reason: 'Mixed success/failure pattern suggests inconsistent behavior',
            severity: 'warning',
          };
        }
      }
    } catch {
      // Storage access failed
    }
  }

  return {
    defeater,
    activated: false,
    severity: 'warning',
  };
}

/**
 * Check for new information that affects knowledge validity.
 */
async function checkNewInfoDefeater(
  defeater: Defeater,
  context: DefeaterCheckContext
): Promise<DefeaterCheckResult> {
  // New info defeaters are harder to check automatically
  // Look for signals like:
  // - Recent confidence updates from other sources
  // - Changes to related entities
  // - External events (CVE, dependency updates)

  if (context.storage) {
    try {
      // Check for related context packs with degraded confidence or high failure rates
      // This indicates new information has affected reliability
      const pack = await context.storage.getContextPack(context.entityId);

      if (pack) {
        // Check if confidence has dropped significantly (indicates new conflicting info)
        if (pack.confidence < 0.4 && pack.accessCount > 3) {
          return {
            defeater: { ...defeater, detected: new Date().toISOString() },
            activated: true,
            reason: `Low confidence (${(pack.confidence * 100).toFixed(0)}%) after ${pack.accessCount} accesses suggests new information conflicts`,
            severity: 'warning',
          };
        }

        // Check for high failure rate as indicator of changed behavior
        if (pack.accessCount > 5) {
          const failureRate = pack.failureCount / pack.accessCount;
          if (failureRate > 0.6) {
            return {
              defeater: { ...defeater, detected: new Date().toISOString() },
              activated: true,
              reason: `High failure rate (${(failureRate * 100).toFixed(0)}%) indicates new information invalidated prior assumptions`,
              severity: 'warning',
            };
          }
        }
      }
    } catch {
      // Storage access failed
    }
  }

  return {
    defeater,
    activated: false,
    severity: 'warning',
  };
}

/**
 * Update knowledge metadata with active defeaters.
 */
export function applyDefeaterResults(
  meta: KnowledgeMeta,
  summary: ActivationSummary
): KnowledgeMeta {
  // Update defeaters with detection status
  const updatedDefeaters = summary.results.map(r => r.defeater);

  // Adjust confidence
  const adjustedConfidence = {
    ...meta.confidence,
    overall: Math.max(
      0.1,
      Math.min(0.95, meta.confidence.overall + summary.confidenceAdjustment)
    ),
  };

  return {
    ...meta,
    defeaters: updatedDefeaters,
    confidence: adjustedConfidence,
    lastValidated: new Date().toISOString(),
  };
}

/**
 * Create a defeater for a specific condition.
 */
export function createDefeater(
  type: DefeaterType,
  description: string,
  detected?: boolean
): Defeater {
  return {
    type,
    description,
    detected: detected ? new Date().toISOString() : undefined,
  };
}

/**
 * Standard defeaters for common scenarios.
 */
export const STANDARD_DEFEATERS = {
  codeChange: createDefeater('code_change', 'Code modification invalidates knowledge'),
  testFailure: createDefeater('test_failure', 'Test failures indicate behavioral issues'),
  staleAfterDays: (days: number) =>
    createDefeater('new_info', `Knowledge expires after ${days} days without validation`),
  dependencyUpdate: createDefeater('new_info', 'Dependency updates may affect behavior'),
  securityAdvisory: createDefeater('new_info', 'New security advisories may apply'),
  runtimeContradiction: createDefeater('contradiction', 'Runtime behavior differs from documentation'),
};
