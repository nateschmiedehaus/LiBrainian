/**
 * @fileoverview Model Policy Stub
 *
 * Provides model selection policy for standalone librainian.
 * In Wave0 context, the real model policy is injected.
 *
 * @packageDocumentation
 */

import { getProviderRegistry } from '../providers/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ModelSelection {
  provider: string;
  providers?: string[];  // Multiple providers for fallback
  model: string;
  reason: string;
  timestamp: number;
}

export interface ModelPolicy {
  preferredProvider?: string;
  preferredModel?: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  maxCostPerRequest?: number;
  requireFunctionCalling?: boolean;
}

// ============================================================================
// MODEL SELECTION
// ============================================================================

let dailySelection: ModelSelection | undefined;

export interface DailyModelSelectionOptions {
  defaultProvider?: string;
  applyEnv?: boolean;
  respectExistingEnv?: boolean;
}

/**
 * Ensure a model is selected for the day
 * In standalone mode, uses the first available provider
 */
export async function ensureDailyModelSelection(
  workspaceRoot?: string,
  options?: DailyModelSelectionOptions
): Promise<ModelSelection> {
  // If we already have a selection for today, return it
  if (dailySelection && !options?.applyEnv) {
    const today = new Date().toDateString();
    const selectionDay = new Date(dailySelection.timestamp).toDateString();
    if (today === selectionDay) {
      return dailySelection;
    }
  }

  const preferredProvider = options?.defaultProvider;

  // Get available providers
  const registry = getProviderRegistry();
  const llm = preferredProvider ? registry.getLLM(preferredProvider as any) : registry.getLLM();

  if (llm) {
    dailySelection = {
      provider: llm.id,
      model: llm.defaultModel,
      reason: 'First available provider',
      timestamp: Date.now(),
    };
    return dailySelection;
  }

  // No provider available - use defaults
  dailySelection = {
    provider: preferredProvider ?? 'anthropic',
    model: 'claude-sonnet-4-20250514',
    reason: 'Default model (no provider configured)',
    timestamp: Date.now(),
  };
  return dailySelection;
}

/**
 * Get current model selection
 */
export function getCurrentModelSelection(): ModelSelection | undefined {
  return dailySelection;
}

/**
 * Reset model selection (for testing)
 */
export function resetModelSelection(): void {
  dailySelection = undefined;
}

/**
 * Select model based on policy
 */
export function selectModel(policy: ModelPolicy = {}): ModelSelection {
  const registry = getProviderRegistry();
  const llm = registry.getLLM();

  if (llm) {
    return {
      provider: policy.preferredProvider ?? llm.id,
      model: policy.preferredModel ?? llm.defaultModel,
      reason: 'Policy-based selection',
      timestamp: Date.now(),
    };
  }

  return {
    provider: policy.preferredProvider ?? 'anthropic',
    model: policy.preferredModel ?? 'claude-sonnet-4-20250514',
    reason: 'Default selection (no provider)',
    timestamp: Date.now(),
  };
}
