/**
 * @fileoverview Auth Checker Utilities (CLI-only)
 *
 * Wave0 uses CLI-based authentication (Claude Code + Codex CLI) and forbids API-key
 * based auth checks. This module reports whether CLI providers appear available and
 * authenticated, and provides remediation guidance.
 *
 * @packageDocumentation
 */

import {
  getAllProviderStatus,
  llmProviderRegistry,
  type LiBrainianLlmProvider,
} from '../api/llm_provider_discovery.js';

// ============================================================================
// TYPES
// ============================================================================

export interface AuthStatus {
  provider: LiBrainianLlmProvider;
  authenticated: boolean;
  reason?: string;
  expiresAt?: number;
  guidance?: string;
  modelId?: string;
  source?: 'cli' | 'config' | 'unknown';
}

export interface AuthStatusSummary {
  anyAuthenticated: boolean;
  providers: AuthStatus[];
  recommended?: LiBrainianLlmProvider;
  // Provider-specific status
  claude_code?: AuthStatus;
  codex?: AuthStatus;
  claude?: AuthStatus;
}

// ============================================================================
// AUTH CHECKER
// ============================================================================

export class AuthChecker {
  private workspaceRoot?: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get authentication guidance message
   */
  getAuthGuidance(summary: AuthStatusSummary): string[] {
    if (summary.anyAuthenticated) {
      const providers = summary.providers.filter(p => p.authenticated).map(p => p.provider);
      return [`Authenticated with: ${providers.join(', ')}`];
    }
    return [
      'Claude: run `claude setup-token` or start `claude` once to authenticate (CLI-only; no API keys)',
      'Codex: run `codex login` to authenticate (CLI-only; no API keys)',
    ];
  }

  /**
   * Check authentication status for all providers
   */
  async checkAll(): Promise<AuthStatusSummary> {
    const statuses: AuthStatus[] = [];
    let recommended: LiBrainianLlmProvider | undefined;

    const discovered = await getAllProviderStatus({ forceRefresh: false });
    for (const entry of discovered) {
      const provider = entry.descriptor.id;
      if (provider !== 'claude' && provider !== 'codex') continue;
      statuses.push({
        provider,
        authenticated: Boolean(entry.status.available && entry.status.authenticated),
        reason: entry.status.error,
        modelId: entry.descriptor.defaultModel,
        source: 'cli' as const,
        guidance: entry.status.authenticated
          ? undefined
          : provider === 'claude'
              ? 'Run `claude setup-token` or start `claude` once to authenticate.'
              : 'Run `codex login` to authenticate.',
      });
    }

    const preference: LiBrainianLlmProvider[] = ['claude', 'codex'];
    for (const provider of preference) {
      if (statuses.some((s) => s.provider === provider && s.authenticated)) {
        recommended = provider;
        break;
      }
    }

    const findProvider = (name: LiBrainianLlmProvider) => statuses.find((s) => s.provider === name);

    return {
      anyAuthenticated: statuses.some(s => s.authenticated),
      providers: statuses,
      recommended,
      claude_code: findProvider('claude'),
      codex: findProvider('codex'),
      claude: findProvider('claude'),
    };
  }

  /**
   * Check if a specific provider is authenticated
   */
  async check(providerId: LiBrainianLlmProvider): Promise<AuthStatus> {
    const status = await llmProviderRegistry.checkProvider(providerId);
    return {
      provider: providerId,
      authenticated: Boolean(status.available && status.authenticated),
      reason: status.error,
      source: 'cli' as const,
    };
  }

  /**
   * Get first authenticated provider
   */
  async getFirstAuthenticated(): Promise<LiBrainianLlmProvider | undefined> {
    const summary = await this.checkAll();
    return summary.recommended;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let checker: AuthChecker | undefined;

export function getAuthChecker(): AuthChecker {
  if (!checker) {
    checker = new AuthChecker();
  }
  return checker;
}
