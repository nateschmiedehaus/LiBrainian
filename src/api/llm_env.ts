import {
  discoverLlmProvider,
  getAllProviderStatus,
  llmProviderRegistry,
  type LiBrainianLlmProvider,
} from './llm_provider_discovery.js';

export type { LiBrainianLlmProvider };
export { llmProviderRegistry };

export function resolveLiBrainianProvider(): LiBrainianLlmProvider | undefined {
  const raw =
    process.env.LIBRARIAN_LLM_PROVIDER ??
    process.env.WAVE0_LLM_PROVIDER ??
    process.env.LLM_PROVIDER;
  return raw === 'claude' || raw === 'codex' ? raw : undefined;
}

export function resolveLiBrainianModelId(provider?: LiBrainianLlmProvider): string | undefined {
  if (process.env.LIBRARIAN_LLM_MODEL) return process.env.LIBRARIAN_LLM_MODEL;
  if (provider === 'claude') {
    return process.env.CLAUDE_MODEL ?? process.env.WAVE0_LLM_MODEL;
  }
  if (provider === 'codex') {
    return process.env.CODEX_MODEL ?? process.env.WAVE0_LLM_MODEL;
  }
  return process.env.CLAUDE_MODEL ?? process.env.CODEX_MODEL ?? process.env.WAVE0_LLM_MODEL;
}

export function resolveLiBrainianModelConfig(): { provider?: LiBrainianLlmProvider; modelId?: string } {
  const provider = resolveLiBrainianProvider();
  const modelId = resolveLiBrainianModelId(provider);
  return { provider, modelId };
}

export async function resolveLiBrainianModelConfigWithDiscovery(): Promise<{
  provider: LiBrainianLlmProvider;
  modelId: string;
}> {
  const discoveryErrors: string[] = [];
  const envConfig = resolveLiBrainianModelConfig();
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
