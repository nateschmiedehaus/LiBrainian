type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type ProviderTransport = 'auto' | 'api' | 'broker' | 'cli';

export function hasEnvValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseTransport(value: string | undefined): ProviderTransport {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'api' || normalized === 'broker' || normalized === 'cli' || normalized === 'auto') {
    return normalized;
  }
  return 'auto';
}

export function resolveClaudeTransportMode(env: EnvLike = process.env): ProviderTransport {
  return parseTransport(env.LIBRARIAN_CLAUDE_TRANSPORT ?? env.LIBRARIAN_LLM_CLAUDE_TRANSPORT);
}

export function resolveCodexTransportMode(env: EnvLike = process.env): ProviderTransport {
  return parseTransport(env.LIBRARIAN_CODEX_TRANSPORT ?? env.LIBRARIAN_LLM_CODEX_TRANSPORT);
}

export function isClaudeBrokerConfigured(env: EnvLike = process.env): boolean {
  return hasEnvValue(env.LIBRARIAN_CLAUDE_BROKER_URL);
}

export function shouldUseAnthropicApiTransport(env: EnvLike = process.env): boolean {
  const mode = resolveClaudeTransportMode(env);
  if (mode === 'broker') return false;
  if (mode === 'api') return true;
  if (mode === 'cli') return false;
  return hasEnvValue(env.ANTHROPIC_API_KEY);
}

export function shouldUseClaudeBrokerTransport(env: EnvLike = process.env): boolean {
  const mode = resolveClaudeTransportMode(env);
  if (!isClaudeBrokerConfigured(env)) return false;
  if (mode === 'broker') return true;
  if (mode === 'api' || mode === 'cli') return false;
  return true;
}

export function shouldUseOpenAiApiTransport(env: EnvLike = process.env): boolean {
  if (!hasEnvValue(env.OPENAI_API_KEY)) return false;
  const mode = resolveCodexTransportMode(env);
  if (mode === 'api') return true;
  if (mode === 'cli') return false;
  return true;
}

export function hasCodexFallbackSignal(env: EnvLike = process.env): boolean {
  const configuredProvider = env.LIBRARIAN_LLM_PROVIDER ?? env.WAVE0_LLM_PROVIDER ?? env.LLM_PROVIDER;
  return configuredProvider === 'codex'
    || shouldUseOpenAiApiTransport(env)
    || hasEnvValue(env.CODEX_HOME)
    || hasEnvValue(env.CODEX_PROFILE)
    || hasEnvValue(env.CODEX_MODEL);
}
