/**
 * @fileoverview Version detection and upgrade system for LiBrainian
 *
 * Key principles:
 * 1. Older/MVP librainian work should be DETECTED and OVERWRITTEN
 *    when important updates come out
 * 2. Quality tiers supersede each other (full > enhanced > mvp)
 * 3. Major version changes require full re-index
 * 4. Minor version changes can be incremental
 */

import type { LiBrainianStorage } from '../storage/types.js';
import type { LiBrainianVersion, QualityTier, VersionComparison } from '../types.js';
import { LIBRARIAN_VERSION, QUALITY_TIERS, VERSION_HISTORY } from '../index.js';
import { getErrorMessage } from '../utils/errors.js';
import { noResult } from './empty_values.js';

// ============================================================================
// VERSION DETECTION
// ============================================================================

/**
 * Detect the version of librainian data in storage.
 * Returns null if no librainian data exists.
 */
export async function detectLiBrainianVersion(
  storage: LiBrainianStorage
): Promise<LiBrainianVersion | null> {
  if (!storage.isInitialized()) {
    try {
      await storage.initialize();
    } catch {
      return noResult();
    }
  }

  return storage.getVersion();
}

/**
 * Compare two versions and determine upgrade requirements.
 */
export function compareVersions(
  current: LiBrainianVersion,
  target: LiBrainianVersion
): VersionComparison {
  // Check quality tier first - higher tiers always supersede
  const currentTierLevel = QUALITY_TIERS[current.qualityTier]?.level ?? 0;
  const targetTierLevel = QUALITY_TIERS[target.qualityTier]?.level ?? 0;

  if (targetTierLevel > currentTierLevel) {
    return {
      current,
      target,
      upgradeRequired: true,
      upgradeType: 'quality_tier',
      reason: `Quality tier upgrade: ${current.qualityTier} → ${target.qualityTier}. ` +
        `${QUALITY_TIERS[target.qualityTier].description} supersedes previous work.`,
    };
  }

  // Check major version - breaking changes require full re-index
  if (target.major > current.major) {
    return {
      current,
      target,
      upgradeRequired: true,
      upgradeType: 'major',
      reason: `Major version upgrade: ${current.string} → ${target.string}. ` +
        `Breaking changes require full re-indexing.`,
    };
  }

  // Check minor version - new features, incremental upgrade
  if (target.minor > current.minor) {
    return {
      current,
      target,
      upgradeRequired: true,
      upgradeType: 'minor',
      reason: `Minor version upgrade: ${current.string} → ${target.string}. ` +
        `New features available, incremental upgrade recommended.`,
    };
  }

  // Check patch version - bug fixes, optional upgrade
  if (target.patch > current.patch) {
    return {
      current,
      target,
      upgradeRequired: false, // Patches are optional
      upgradeType: 'patch',
      reason: `Patch available: ${current.string} → ${target.string}. ` +
        `Bug fixes available but upgrade not required.`,
    };
  }

  return {
    current,
    target,
    upgradeRequired: false,
    upgradeType: 'none',
    reason: 'LiBrainian data is current.',
  };
}

/**
 * Check if upgrade is required from current to target version.
 */
export async function upgradeRequired(
  current: LiBrainianVersion,
  target: LiBrainianVersion
): Promise<{ required: boolean; reason: string; upgradeType: VersionComparison['upgradeType'] }> {
  const comparison = compareVersions(current, target);
  return {
    required: comparison.upgradeRequired,
    reason: comparison.reason,
    upgradeType: comparison.upgradeType,
  };
}

// ============================================================================
// UPGRADE EXECUTION
// ============================================================================

export interface UpgradeReport {
  fromVersion: LiBrainianVersion;
  toVersion: LiBrainianVersion;
  upgradeType: VersionComparison['upgradeType'];
  startedAt: Date;
  completedAt: Date;
  success: boolean;
  error?: string;
  stats: {
    functionsReindexed: number;
    contextPacksRegenerated: number;
    oldDataPurged: boolean;
  };
}

/**
 * Run upgrade from current to target version.
 *
 * Upgrade strategies by type:
 * - quality_tier: Full re-index (old MVP data is inferior)
 * - major: Full re-index (breaking changes)
 * - minor: Incremental update (add new data, keep existing)
 * - patch: Metadata update only
 */
export async function runUpgrade(
  storage: LiBrainianStorage,
  current: LiBrainianVersion,
  target: LiBrainianVersion
): Promise<UpgradeReport> {
  const comparison = compareVersions(current, target);
  const startedAt = new Date();

  const report: UpgradeReport = {
    fromVersion: current,
    toVersion: target,
    upgradeType: comparison.upgradeType,
    startedAt,
    completedAt: new Date(),
    success: false,
    stats: {
      functionsReindexed: 0,
      contextPacksRegenerated: 0,
      oldDataPurged: false,
    },
  };

  try {
    switch (comparison.upgradeType) {
      case 'quality_tier':
      case 'major':
        // Full re-index: purge old data completely
        await purgeOldData(storage);
        report.stats.oldDataPurged = true;
        // Bootstrap will handle re-indexing
        break;

      case 'minor':
        // Incremental: invalidate context packs, they'll be regenerated
        await invalidateAllContextPacks(storage);
        // Mark functions for re-validation
        await markFunctionsForRevalidation(storage);
        break;

      case 'patch':
        // Just update version metadata
        break;

      case 'none':
        // Nothing to do
        break;
    }

    // Update version in storage
    await storage.setVersion(target);

    report.success = true;
    report.completedAt = new Date();
  } catch (error: unknown) {
    report.error = getErrorMessage(error);
    report.completedAt = new Date();
  }

  return report;
}

// ============================================================================
// UPGRADE HELPERS
// ============================================================================

async function purgeOldData(storage: LiBrainianStorage): Promise<void> {
  // Get all functions and delete them
  const functions = await storage.getFunctions({ limit: 10000 });
  for (const fn of functions) {
    await storage.deleteFunction(fn.id);
  }

  // Get all modules and delete them
  const modules = await storage.getModules({ limit: 10000 });
  for (const mod of modules) {
    await storage.deleteModule(mod.id);
  }

  // Get all context packs and delete them
  const packs = await storage.getContextPacks({ limit: 10000, includeInvalidated: true });
  for (const pack of packs) {
    await storage.deleteContextPack(pack.packId);
  }

  // Vacuum to reclaim space
  await storage.vacuum();
}

async function invalidateAllContextPacks(storage: LiBrainianStorage): Promise<void> {
  const packs = await storage.getContextPacks({ limit: 10000 });
  for (const pack of packs) {
    // Invalidate by marking with a trigger that won't exist
    await storage.invalidateContextPacks('__upgrade_invalidation__');
  }
}

async function markFunctionsForRevalidation(storage: LiBrainianStorage): Promise<void> {
  // Lower confidence on all functions to trigger re-validation
  await storage.applyTimeDecay(0.2); // 20% confidence reduction
}

// ============================================================================
// VERSION UTILITIES
// ============================================================================

/**
 * Get the current librainian version.
 */
export function getCurrentVersion(): LiBrainianVersion {
  return {
    major: LIBRARIAN_VERSION.major,
    minor: LIBRARIAN_VERSION.minor,
    patch: LIBRARIAN_VERSION.patch,
    string: LIBRARIAN_VERSION.string,
    qualityTier: 'full' as QualityTier,
    indexedAt: new Date(),
    indexerVersion: LIBRARIAN_VERSION.string,
    features: [...LIBRARIAN_VERSION.features],
  };
}

/**
 * Parse a version string into components.
 */
export function parseVersionString(versionString: string): {
  major: number;
  minor: number;
  patch: number;
} {
  const [major, minor, patch] = versionString.split('.').map(Number);
  return { major: major || 0, minor: minor || 0, patch: patch || 0 };
}

/**
 * Check if a version is compatible with minimum required version.
 */
export function isVersionCompatible(
  version: LiBrainianVersion,
  minRequired: string
): boolean {
  const min = parseVersionString(minRequired);

  if (version.major < min.major) return false;
  if (version.major > min.major) return true;

  if (version.minor < min.minor) return false;
  if (version.minor > min.minor) return true;

  return version.patch >= min.patch;
}

/**
 * Get upgrade path between two versions.
 */
export function getUpgradePath(
  from: string,
  to: string
): typeof VERSION_HISTORY[number][] {
  const fromParsed = parseVersionString(from);
  const toParsed = parseVersionString(to);

  const path: typeof VERSION_HISTORY[number][] = [];

  for (const entry of VERSION_HISTORY) {
    const entryParsed = parseVersionString(entry.version);

    // Include versions between from and to
    if (
      (entryParsed.major > fromParsed.major ||
        (entryParsed.major === fromParsed.major && entryParsed.minor > fromParsed.minor) ||
        (entryParsed.major === fromParsed.major &&
          entryParsed.minor === fromParsed.minor &&
          entryParsed.patch > fromParsed.patch)) &&
      (entryParsed.major < toParsed.major ||
        (entryParsed.major === toParsed.major && entryParsed.minor <= toParsed.minor))
    ) {
      path.push(entry);
    }
  }

  return path;
}

/**
 * Determine if existing data should be completely replaced.
 * This is true for:
 * 1. Quality tier upgrades (mvp → enhanced, enhanced → full)
 * 2. Major version upgrades
 */
export function shouldReplaceExistingData(
  current: LiBrainianVersion,
  target: LiBrainianVersion
): boolean {
  const comparison = compareVersions(current, target);
  return comparison.upgradeType === 'quality_tier' || comparison.upgradeType === 'major';
}
