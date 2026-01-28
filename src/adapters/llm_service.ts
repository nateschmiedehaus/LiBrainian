import { AsyncLocalStorage } from 'node:async_hooks';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatOptions {
  provider: string;
  modelId: string;
  messages: LlmChatMessage[];
  maxTokens?: number;
  temperature?: number;
  governorContext?: unknown;
  outputSchema?: string;
  disableTools?: boolean;
}

export interface LlmProviderHealth {
  provider: 'claude' | 'codex';
  available: boolean;
  authenticated: boolean;
  lastCheck: number;
  error?: string;
}

export interface LlmServiceAdapter {
  chat(options: LlmChatOptions): Promise<{ content: string; provider: string }>;
  checkClaudeHealth(forceCheck?: boolean): Promise<LlmProviderHealth>;
  checkCodexHealth(forceCheck?: boolean): Promise<LlmProviderHealth>;
}

let llmServiceAdapter: LlmServiceAdapter | null = null;
const adapterStore = new AsyncLocalStorage<LlmServiceAdapter>();

function validateAdapter(adapter: LlmServiceAdapter): void {
  if (
    !adapter ||
    typeof adapter.chat !== 'function' ||
    typeof adapter.checkClaudeHealth !== 'function' ||
    typeof adapter.checkCodexHealth !== 'function'
  ) {
    throw new Error(
      'unverified_by_trace(llm_adapter_invalid): Adapter must implement chat, checkClaudeHealth, and checkCodexHealth.'
    );
  }
}

export interface RegisterLlmServiceAdapterOptions {
  force?: boolean;
}

type LlmServiceInstance = {
  chat(options: LlmChatOptions): Promise<{ content: string; provider: string }>;
  checkClaudeHealth(forceCheck?: boolean): Promise<LlmProviderHealth>;
  checkCodexHealth(forceCheck?: boolean): Promise<LlmProviderHealth>;
};

let defaultServicePromise: Promise<LlmServiceInstance> | null = null;

export type LlmServiceFactory = () => Promise<LlmServiceInstance>;

export interface RegisterDefaultLlmServiceFactoryOptions {
  force?: boolean;
}

let defaultServiceFactory: LlmServiceFactory | null = null;

function validateServiceFactory(factory: LlmServiceFactory): void {
  if (!factory || typeof factory !== 'function') {
    throw new Error(
      'unverified_by_trace(llm_adapter_invalid_factory): Default LLM service factory must be a function.'
    );
  }
}

function validateServiceInstance(service: LlmServiceInstance): void {
  if (
    !service ||
    typeof service.chat !== 'function' ||
    typeof service.checkClaudeHealth !== 'function' ||
    typeof service.checkCodexHealth !== 'function'
  ) {
    throw new Error(
      'unverified_by_trace(llm_adapter_invalid_factory): Default LLM service factory returned invalid service.'
    );
  }
}

async function loadDefaultService(): Promise<LlmServiceInstance> {
  if (!defaultServiceFactory) {
    throw new Error(
      'unverified_by_trace(llm_adapter_unavailable): Default LLM service factory not registered.'
    );
  }
  if (!defaultServicePromise) {
    defaultServicePromise = Promise.resolve()
      .then(() => defaultServiceFactory!())
      .then((service) => {
        validateServiceInstance(service);
        return service;
      })
      .catch((error) => {
        defaultServicePromise = null;
        throw error;
      });
  }
  return defaultServicePromise;
}

export function createDefaultLlmServiceAdapter(): LlmServiceAdapter {
  return {
    chat: async (options) => (await loadDefaultService()).chat(options),
    checkClaudeHealth: async (forceCheck) => (await loadDefaultService()).checkClaudeHealth(forceCheck),
    checkCodexHealth: async (forceCheck) => (await loadDefaultService()).checkCodexHealth(forceCheck),
  };
}

export function registerLlmServiceAdapter(
  adapter: LlmServiceAdapter,
  options: RegisterLlmServiceAdapterOptions = {}
): void {
  validateAdapter(adapter);
  if (llmServiceAdapter && !options.force) {
    throw new Error('unverified_by_trace(llm_adapter_already_registered)');
  }
  llmServiceAdapter = adapter;
}

export function setDefaultLlmServiceFactory(
  factory: LlmServiceFactory,
  options: RegisterDefaultLlmServiceFactoryOptions = {}
): void {
  validateServiceFactory(factory);
  if (defaultServiceFactory && !options.force) {
    throw new Error('unverified_by_trace(llm_adapter_default_factory_already_registered)');
  }
  defaultServiceFactory = factory;
  defaultServicePromise = null;
}

export function getLlmServiceAdapter(): LlmServiceAdapter | null {
  return adapterStore.getStore() ?? llmServiceAdapter;
}

export function resolveLlmServiceAdapter(adapter?: LlmServiceAdapter | null): LlmServiceAdapter {
  const candidate = adapter ?? getLlmServiceAdapter() ?? createDefaultLlmServiceAdapter();
  validateAdapter(candidate);
  return candidate;
}

export function withLlmServiceAdapter<T>(adapter: LlmServiceAdapter, fn: () => T): T {
  validateAdapter(adapter);
  return adapterStore.run(adapter, fn);
}

export function requireLlmServiceAdapter(): LlmServiceAdapter {
  const adapter = getLlmServiceAdapter();
  if (!adapter) {
    throw new Error(
      'unverified_by_trace(llm_adapter_unregistered): Call registerLlmServiceAdapter() ' +
        'or withLlmServiceAdapter() before using the adapter.'
    );
  }
  return adapter;
}

export function clearLlmServiceAdapter(): void {
  llmServiceAdapter = null;
}

export function clearDefaultLlmServiceFactory(): void {
  defaultServiceFactory = null;
  defaultServicePromise = null;
}
