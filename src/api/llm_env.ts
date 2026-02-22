import fs from 'node:fs/promises';
import path from 'node:path';
import {
  discoverLlmProvider,
  getAllProviderStatus,
  llmProviderRegistry,
  type LibrarianLlmProvider,
} from './llm_provider_discovery.js';

export type { LibrarianLlmProvider };
export { llmProviderRegistry };

const LAST_SUCCESSFUL_PROVIDER_RELATIVE_PATH = [
  'state',
  'audits',
  'librarian',
  'provider',
  'last_successful_provider.json',
];

function coerceProvider(value: string | undefined): LibrarianLlmProvider | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'claude' || normalized === 'codex' ? normalized : undefined;
}

function resolveLastSuccessfulProviderPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ...LAST_SUCCESSFUL_PROVIDER_RELATIVE_PATH);
}

async function readLastSuccessfulProvider(workspaceRoot: string): Promise<LibrarianLlmProvider | undefined> {
  try {
    const raw = await fs.readFile(resolveLastSuccessfulProviderPath(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as { provider?: string };
    return coerceProvider(parsed.provider);
  } catch {
    return undefined;
  }
}

export function resolveExplicitLibrarianProvider(): LibrarianLlmProvider | undefined {
  const raw =
    process.env.LIBRARIAN_LLM_PROVIDER ??
    process.env.WAVE0_LLM_PROVIDER ??
    process.env.LLM_PROVIDER;
  return coerceProvider(raw);
}

export function resolveLibrarianHostAgent(): LibrarianLlmProvider | undefined {
  const raw =
    process.env.LIBRARIAN_HOST_AGENT ??
    process.env.WAVE0_HOST_AGENT ??
    process.env.HOST_AGENT;
  return coerceProvider(raw);
}

export function resolveLibrarianProvider(): LibrarianLlmProvider | undefined {
  return resolveExplicitLibrarianProvider() ?? resolveLibrarianHostAgent();
}

export const resolveLiBrainianProvider = resolveLibrarianProvider;
export const resolveLiBrainianHostAgent = resolveLibrarianHostAgent;

export function resolveLibrarianModelId(provider?: LibrarianLlmProvider): string | undefined {
  if (process.env.LIBRARIAN_LLM_MODEL) return process.env.LIBRARIAN_LLM_MODEL;
  if (provider === 'claude') {
    return process.env.CLAUDE_MODEL ?? process.env.WAVE0_LLM_MODEL;
  }
  if (provider === 'codex') {
    return process.env.CODEX_MODEL ?? process.env.WAVE0_LLM_MODEL;
  }
  return process.env.CLAUDE_MODEL ?? process.env.CODEX_MODEL ?? process.env.WAVE0_LLM_MODEL;
}

export const resolveLiBrainianModelId = resolveLibrarianModelId;

export function resolveLibrarianModelConfig(): { provider?: LibrarianLlmProvider; modelId?: string } {
  const provider = resolveLibrarianProvider();
  const modelId = resolveLibrarianModelId(provider);
  return { provider, modelId };
}

export const resolveLiBrainianModelConfig = resolveLibrarianModelConfig;

export async function resolveLibrarianModelConfigWithDiscovery(): Promise<{
  provider: LibrarianLlmProvider;
  modelId: string;
}> {
  const discoveryErrors: string[] = [];
  const explicitProvider = resolveExplicitLibrarianProvider();
  const hostProvider = resolveLibrarianHostAgent();
  const preferredProvider = explicitProvider ?? hostProvider;
  const preferredModelId = resolveLibrarianModelId(preferredProvider);
  if (preferredProvider && preferredModelId) {
    return { provider: preferredProvider, modelId: preferredModelId };
  }
  if (preferredProvider && !preferredModelId) {
    const probe = llmProviderRegistry.getProbe(preferredProvider);
    if (probe) {
      return { provider: preferredProvider, modelId: probe.descriptor.defaultModel };
    }
  }

  const preferredProviders: LibrarianLlmProvider[] = [];
  if (preferredProvider) preferredProviders.push(preferredProvider);
  try {
    const lastSuccessfulProvider = await readLastSuccessfulProvider(process.cwd());
    if (lastSuccessfulProvider && !preferredProviders.includes(lastSuccessfulProvider)) {
      preferredProviders.push(lastSuccessfulProvider);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    discoveryErrors.push(`last_successful_provider_read_failed: ${message}`);
  }

  try {
    const discovered = await discoverLlmProvider({
      preferredProviders: preferredProviders.length > 0 ? preferredProviders : undefined,
    });
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
