import {
  discoverLlmProvider,
  getAllProviderStatus,
  llmProviderRegistry,
  type LibrarianLlmProvider,
} from './llm_provider_discovery.js';
import { detectNestedClaudeSession } from './nested_session.js';
import {
  hasCodexFallbackSignal,
  shouldUseAnthropicApiTransport,
  shouldUseClaudeBrokerTransport,
} from './llm_transport_env.js';

export type { LibrarianLlmProvider };
export { llmProviderRegistry };

export interface SynthesisAvailability {
  synthesisMode: 'llm' | 'structural-only';
  synthesisUnavailableReason?: string;
}

export function resolveLibrarianProvider(env: NodeJS.ProcessEnv = process.env): LibrarianLlmProvider | undefined {
  const raw =
    env.LIBRARIAN_LLM_PROVIDER ??
    env.WAVE0_LLM_PROVIDER ??
    env.LLM_PROVIDER;
  return raw === 'claude' || raw === 'codex' ? raw : undefined;
}

export const resolveLiBrainianProvider = resolveLibrarianProvider;

export function resolveLibrarianModelId(
  provider?: LibrarianLlmProvider,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (env.LIBRARIAN_LLM_MODEL) return env.LIBRARIAN_LLM_MODEL;
  if (provider === 'claude') {
    return env.CLAUDE_MODEL ?? env.WAVE0_LLM_MODEL;
  }
  if (provider === 'codex') {
    return env.CODEX_MODEL ?? env.WAVE0_LLM_MODEL;
  }
  return env.CLAUDE_MODEL ?? env.CODEX_MODEL ?? env.WAVE0_LLM_MODEL;
}

export const resolveLiBrainianModelId = resolveLibrarianModelId;

export function resolveLibrarianModelConfig(
  env: NodeJS.ProcessEnv = process.env
): { provider?: LibrarianLlmProvider; modelId?: string } {
  const provider = resolveLibrarianProvider(env);
  const modelId = resolveLibrarianModelId(provider, env);
  return { provider, modelId };
}

export const resolveLiBrainianModelConfig = resolveLibrarianModelConfig;

export function resolveSynthesisAvailability(env: NodeJS.ProcessEnv = process.env): SynthesisAvailability {
  const nested = detectNestedClaudeSession(env);
  if (!nested.isNested) {
    return { synthesisMode: 'llm' };
  }
  if (shouldUseAnthropicApiTransport(env) || shouldUseClaudeBrokerTransport(env) || hasCodexFallbackSignal(env)) {
    return { synthesisMode: 'llm' };
  }
  const markers = nested.markers.length > 0 ? nested.markers.join(', ') : 'unknown markers';
  return {
    synthesisMode: 'structural-only',
    synthesisUnavailableReason: `Nested Claude Code session detected (${markers}). Claude CLI is disabled and no alternative LLM transport is configured.`,
  };
}

export const resolveLiBrainianSynthesisAvailability = resolveSynthesisAvailability;

export async function resolveLibrarianModelConfigWithDiscovery(): Promise<{
  provider: LibrarianLlmProvider;
  modelId: string;
}> {
  const discoveryErrors: string[] = [];
  const envConfig = resolveLibrarianModelConfig();
  if (envConfig.provider && envConfig.modelId) {
    return { provider: envConfig.provider, modelId: envConfig.modelId };
  }
  if (envConfig.provider && !envConfig.modelId) {
    const probe = llmProviderRegistry.getProbe(envConfig.provider);
    if (probe) {
      return { provider: envConfig.provider, modelId: probe.descriptor.defaultModel };
    }
  }

  try {
    const discovered = await discoverLlmProvider();
    if (discovered) {
      if (discovered.provider === 'claude' || discovered.provider === 'codex') {
        return { provider: discovered.provider, modelId: discovered.modelId };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    discoveryErrors.push(`discover_failed: ${message}`);
  }

  let details = '';
  try {
    const statuses = await getAllProviderStatus();
    details = statuses
      .map((entry) => `  - ${entry.descriptor.name}: ${entry.status.error ?? 'ok'}`)
      .join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    discoveryErrors.push(`status_failed: ${message}`);
  }
  const errorDetails = discoveryErrors.length > 0 ? `\nDiagnostics:\n${discoveryErrors.map((entry) => `  - ${entry}`).join('\n')}` : '';

  throw new Error(
    'unverified_by_trace(provider_unavailable): No LLM providers available.' +
    (details ? `\nChecked providers:\n${details}\n` : '\nChecked providers: unavailable\n') +
    errorDetails +
    '\n\n' +
    'To fix:\n' +
    '  - Authenticate a CLI: Claude (`claude setup-token` or run `claude`), Codex (`codex login`)\n' +
    '  - Set LIBRARIAN_LLM_PROVIDER and LIBRARIAN_LLM_MODEL\n' +
    '  - Register a custom provider in llmProviderRegistry'
  );
}

export const resolveLiBrainianModelConfigWithDiscovery = resolveLibrarianModelConfigWithDiscovery;
