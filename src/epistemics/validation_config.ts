/**
 * @fileoverview Epistemic Validation Configuration
 *
 * Provides configuration resolution for epistemic task validation,
 * supporting CLI flags, environment variables, and .librarian.json settings.
 *
 * Priority order (highest to lowest):
 * 1. CLI flags
 * 2. Environment variables
 * 3. .librarian.json configuration
 * 4. Default preset
 *
 * @packageDocumentation
 */

import { ValidationPresets, type TaskValidationCriteria } from './task_validation.js';

/**
 * Mutable version of TaskValidationCriteria for building configs.
 */
type MutableCriteria = {
  -readonly [K in keyof TaskValidationCriteria]?: TaskValidationCriteria[K];
};

/**
 * Valid preset names for epistemic validation.
 */
export type EpistemicPreset = 'strict' | 'standard' | 'relaxed' | 'disabled';

/**
 * Configuration for epistemic validation from .librarian.json.
 */
export interface EpistemicValidationConfig {
  /** Whether epistemic validation is enabled */
  enabled: boolean;
  /** Preset to use */
  preset: EpistemicPreset;
  /** Override specific criteria values */
  overrides?: MutableCriteria;
}

/**
 * Default epistemic validation configuration.
 */
export const DEFAULT_EPISTEMIC_CONFIG: EpistemicValidationConfig = {
  enabled: false, // Opt-in for now
  preset: 'standard',
  overrides: {},
};

/**
 * Environment variable names for epistemic validation.
 */
export const EPISTEMIC_ENV_VARS = {
  ENABLED: 'LIBRARIAN_EPISTEMIC_ENABLED',
  PRESET: 'LIBRARIAN_EPISTEMIC_PRESET',
  MIN_CONFIDENCE: 'LIBRARIAN_MIN_TASK_CONFIDENCE',
  MIN_ALTERNATIVES: 'LIBRARIAN_MIN_ALTERNATIVES',
} as const;

/**
 * Parse boolean from environment variable.
 */
function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return undefined;
}

/**
 * Parse preset from environment variable.
 */
function parseEnvPreset(value: string | undefined): EpistemicPreset | undefined {
  if (value === undefined) return undefined;
  const lower = value.toLowerCase() as EpistemicPreset;
  if (['strict', 'standard', 'relaxed', 'disabled'].includes(lower)) {
    return lower;
  }
  return undefined;
}

/**
 * Get epistemic validation configuration from environment variables.
 */
export function getEnvConfig(): Partial<EpistemicValidationConfig> {
  const config: Partial<EpistemicValidationConfig> = {};

  const enabled = parseEnvBoolean(process.env[EPISTEMIC_ENV_VARS.ENABLED]);
  if (enabled !== undefined) {
    config.enabled = enabled;
  }

  const preset = parseEnvPreset(process.env[EPISTEMIC_ENV_VARS.PRESET]);
  if (preset !== undefined) {
    config.preset = preset;
    // If preset is specified, assume enabled
    if (config.enabled === undefined) {
      config.enabled = preset !== 'disabled';
    }
  }

  // Parse override values
  const minConfidence = process.env[EPISTEMIC_ENV_VARS.MIN_CONFIDENCE];
  const minAlternatives = process.env[EPISTEMIC_ENV_VARS.MIN_ALTERNATIVES];

  if (minConfidence !== undefined || minAlternatives !== undefined) {
    const overrides: MutableCriteria = {};
    if (minConfidence !== undefined) {
      const parsed = parseFloat(minConfidence);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        overrides.minimumConfidence = parsed;
      }
    }
    if (minAlternatives !== undefined) {
      const parsed = parseInt(minAlternatives, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        overrides.minimumAlternativesConsidered = parsed;
      }
    }
    config.overrides = overrides;
  }

  return config;
}

/**
 * Resolve epistemic validation configuration from all sources.
 *
 * @param cliFlags - CLI flag overrides (highest priority)
 * @param fileConfig - Configuration from .librarian.json
 * @returns Resolved configuration
 */
export function resolveEpistemicConfig(
  cliFlags?: Partial<EpistemicValidationConfig>,
  fileConfig?: Partial<EpistemicValidationConfig>
): EpistemicValidationConfig {
  const envConfig = getEnvConfig();

  // Merge in priority order: defaults < file < env < cli
  const merged: EpistemicValidationConfig = {
    ...DEFAULT_EPISTEMIC_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...cliFlags,
    overrides: {
      ...DEFAULT_EPISTEMIC_CONFIG.overrides,
      ...fileConfig?.overrides,
      ...envConfig.overrides,
      ...cliFlags?.overrides,
    },
  };

  return merged;
}

/**
 * Get the validation criteria for a given configuration.
 *
 * @param config - Epistemic validation configuration
 * @returns Task validation criteria to use, or null if disabled
 */
export function getValidationCriteria(
  config: EpistemicValidationConfig
): TaskValidationCriteria | null {
  if (!config.enabled || config.preset === 'disabled') {
    return null;
  }

  const baseCriteria = ValidationPresets[config.preset as keyof typeof ValidationPresets];
  if (!baseCriteria) {
    return ValidationPresets.standard;
  }

  // Apply overrides
  return {
    ...baseCriteria,
    ...config.overrides,
  };
}

/**
 * Check if epistemic validation is currently enabled.
 *
 * Convenience function that checks all configuration sources.
 */
export function isEpistemicValidationEnabled(): boolean {
  const config = resolveEpistemicConfig();
  return config.enabled && config.preset !== 'disabled';
}

/**
 * Get the current validation criteria based on all configuration sources.
 *
 * Convenience function for quick access to resolved criteria.
 */
export function getCurrentValidationCriteria(): TaskValidationCriteria | null {
  const config = resolveEpistemicConfig();
  return getValidationCriteria(config);
}
