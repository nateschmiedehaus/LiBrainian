import { llmProviderRegistry } from '../api/llm_provider_discovery.js';
import { safeJsonParse } from '../utils/safe_json.js';

export const LIBRARIAN_LLM_BOOTSTRAP_DEFAULTS_KEY = 'librarian.llm_defaults.v1';
export const LIBRARIAN_LLM_USER_DEFAULTS_KEY = 'librarian.llm_user_defaults.v1';

export type LlmSelectionSource =
  | 'explicit'
  | 'session'
  | 'user_default'
  | 'bootstrap_default'
  | 'discovery'
  | 'none';

export interface StoredLlmSelection {
  provider: string;
  modelId: string;
  updatedAt?: string;
}

interface StateReader {
  getState(key: string): Promise<string | null>;
}

interface StateWriter extends StateReader {
  setState(key: string, value: string): Promise<void>;
}

function coerceStoredSelection(raw: string | null): StoredLlmSelection | null {
  if (!raw) return null;
  const parsed = safeJsonParse<Record<string, unknown>>(raw);
  if (!parsed.ok) return null;
  const provider = typeof parsed.value.provider === 'string' ? parsed.value.provider.trim() : '';
  const modelId = typeof parsed.value.modelId === 'string' ? parsed.value.modelId.trim() : '';
  if (!provider || !modelId) return null;
  const updatedAt = typeof parsed.value.updatedAt === 'string' ? parsed.value.updatedAt : undefined;
  return { provider, modelId, updatedAt };
}

export function listRegisteredProviders(): Array<{ id: string; name: string; defaultModel: string; priority: number }> {
  return llmProviderRegistry
    .getAllProbes()
    .map((probe) => ({
      id: probe.descriptor.id,
      name: probe.descriptor.name,
      defaultModel: probe.descriptor.defaultModel,
      priority: probe.descriptor.priority,
    }))
    .sort((left, right) => left.priority - right.priority);
}

export function isRegisteredProvider(providerId: string): boolean {
  return Boolean(llmProviderRegistry.getProbe(providerId));
}

export function resolveProviderDefaultModel(providerId: string): string | undefined {
  return llmProviderRegistry.getProbe(providerId)?.descriptor.defaultModel;
}

export async function readBootstrapLlmSelection(storage: StateReader): Promise<StoredLlmSelection | null> {
  const raw = await storage.getState(LIBRARIAN_LLM_BOOTSTRAP_DEFAULTS_KEY);
  return coerceStoredSelection(raw);
}

export async function readUserLlmSelection(storage: StateReader): Promise<StoredLlmSelection | null> {
  const raw = await storage.getState(LIBRARIAN_LLM_USER_DEFAULTS_KEY);
  return coerceStoredSelection(raw);
}

export async function writeUserLlmSelection(
  storage: StateWriter,
  selection: { provider: string; modelId: string }
): Promise<void> {
  const payload = {
    schema_version: 1,
    kind: 'LibrarianLlmUserDefaults.v1',
    provider: selection.provider,
    modelId: selection.modelId,
    updatedAt: new Date().toISOString(),
  };
  await storage.setState(LIBRARIAN_LLM_USER_DEFAULTS_KEY, JSON.stringify(payload));
}
