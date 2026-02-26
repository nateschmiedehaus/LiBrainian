export type ModelProvider = 'claude' | 'codex';

export interface ModelPolicyOptions {
  now?: () => Date;
  forceRefresh?: boolean;
  skipDiscovery?: boolean;
  skipDocsFetch?: boolean;
  discoveryTimeoutMs?: number;
  applyEnv?: boolean;
  defaultProvider?: ModelProvider;
  respectExistingEnv?: boolean;
}

export interface SelectedModelInfo {
  provider: ModelProvider;
  model_id: string;
  name: string;
  context_window?: number;
  max_output?: number;
  cost_per_mtok?: { input: number; output: number };
  capabilities?: string[];
  reasoning_levels?: string[];
  access_method?: 'subscription' | 'api';
  tool_support?: boolean;
  rationale: string;
}

export interface ProviderDocCapture {
  url: string;
  path: string;
  sha256: string;
  bytes: number;
  fetched_at: string;
}

export interface ProviderDocSnapshot {
  urls: string[];
  ids_found: string[];
  errors: string[];
  captures?: ProviderDocCapture[];
}

export interface DailyModelSelection {
  schema_version: number;
  date: string;
  local_date: string;
  timezone_offset_minutes: number;
  generated_at: string;
  providers: {
    claude: SelectedModelInfo | null;
    codex: SelectedModelInfo | null;
  };
  sources: {
    claude: ProviderDocSnapshot;
    codex: ProviderDocSnapshot;
  };
  notes: string[];
}

export interface ModelPolicyProvider {
  ensureDailyModelSelection: (
    workspaceRoot: string,
    options?: ModelPolicyOptions
  ) => Promise<DailyModelSelection>;
}

export interface RegisterModelPolicyProviderOptions {
  force?: boolean;
}

let modelPolicyProvider: ModelPolicyProvider | null = null;

function coerceModelProvider(value: string | undefined): ModelProvider | null {
  if (value === 'claude' || value === 'codex') return value;
  return null;
}

function resolveFallbackProvider(options: ModelPolicyOptions): ModelProvider {
  return coerceModelProvider(options.defaultProvider)
    ?? coerceModelProvider(process.env.LIBRARIAN_LLM_PROVIDER)
    ?? coerceModelProvider(process.env.WAVE0_LLM_PROVIDER)
    ?? coerceModelProvider(process.env.LLM_PROVIDER)
    ?? 'codex';
}

function resolveFallbackModelId(provider: ModelProvider): string {
  if (provider === 'codex') {
    return process.env.LIBRARIAN_LLM_MODEL
      ?? process.env.CODEX_MODEL
      ?? 'gpt-5-codex';
  }
  return process.env.LIBRARIAN_LLM_MODEL
    ?? process.env.CLAUDE_MODEL
    ?? 'claude-sonnet-4-20250514';
}

function createDefaultSelection(workspaceRoot: string, options: ModelPolicyOptions): DailyModelSelection {
  const now = (options.now ?? (() => new Date()))();
  const provider = resolveFallbackProvider(options);
  const modelId = resolveFallbackModelId(provider);
  const selection: SelectedModelInfo = {
    provider,
    model_id: modelId,
    name: modelId,
    rationale: 'model_policy_default_selection',
    access_method: 'subscription',
    tool_support: true,
  };
  const notes = [
    'model_policy_default_selection',
    `selected_provider=${provider}`,
    `workspace=${workspaceRoot}`,
  ];
  return {
    schema_version: 1,
    date: now.toISOString().slice(0, 10),
    local_date: now.toLocaleDateString('en-CA'),
    timezone_offset_minutes: now.getTimezoneOffset(),
    generated_at: now.toISOString(),
    providers: {
      claude: provider === 'claude' ? selection : null,
      codex: provider === 'codex' ? selection : null,
    },
    sources: {
      claude: { urls: [], ids_found: [], errors: [] },
      codex: { urls: [], ids_found: [], errors: [] },
    },
    notes,
  };
}

function validateModelPolicyProvider(provider: ModelPolicyProvider): void {
  if (!provider || typeof provider.ensureDailyModelSelection !== 'function') {
    throw new Error(
      'unverified_by_trace(model_policy_invalid): Provider must implement ensureDailyModelSelection.'
    );
  }
}

export function registerModelPolicyProvider(
  provider: ModelPolicyProvider,
  options: RegisterModelPolicyProviderOptions = {}
): void {
  validateModelPolicyProvider(provider);
  if (modelPolicyProvider && !options.force) {
    throw new Error('unverified_by_trace(model_policy_already_registered)');
  }
  modelPolicyProvider = provider;
}

export function clearModelPolicyProvider(): void {
  modelPolicyProvider = null;
}

export async function ensureDailyModelSelection(
  workspaceRoot: string,
  options: ModelPolicyOptions = {}
): Promise<DailyModelSelection | null> {
  if (!modelPolicyProvider) {
    return createDefaultSelection(workspaceRoot, options);
  }
  return await modelPolicyProvider.ensureDailyModelSelection(workspaceRoot, options);
}
