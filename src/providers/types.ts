/**
 * @fileoverview Universal Provider Types for Librarian
 *
 * Comprehensive provider system supporting all major AI providers:
 * - Anthropic Claude (claude-3, claude-4 models)
 * - OpenAI (GPT-4, GPT-3.5, o1, o3 models)
 * - Google (Gemini models)
 * - Mistral (Mistral, Mixtral models)
 * - Groq (fast inference)
 * - Together AI
 * - Fireworks AI
 * - Perplexity
 * - DeepSeek
 * - Azure OpenAI
 * - AWS Bedrock
 *
 * Librarian works WITHOUT providers in minimal mode, but providers
 * enable LLM-backed understanding, semantic embeddings, and reranking.
 *
 * @packageDocumentation
 */

// ============================================================================
// BASE PROVIDER TYPES
// ============================================================================

/**
 * Provider type identifier
 */
export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'mistral'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'perplexity'
  | 'deepseek'
  | 'azure-openai'
  | 'aws-bedrock'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

/**
 * Provider status information
 */
export interface ProviderStatus {
  available: boolean;
  reason?: string;
  lastCheck?: number;
  latencyMs?: number;
  quotaRemaining?: number;
  errors?: string[];
}

/**
 * Base provider interface
 */
export interface Provider {
  readonly id: ProviderId;
  readonly name: string;
  readonly type: 'llm' | 'embedding' | 'reranker';

  /** Check if provider is available */
  checkAvailability(): Promise<ProviderStatus>;

  /** Get provider configuration */
  getConfig(): ProviderConfig;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  organizationId?: string;
  projectId?: string;
  region?: string;
  timeout?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
}

// ============================================================================
// MODEL TYPES
// ============================================================================

/**
 * Model capability flags
 */
export interface ModelCapabilities {
  chat: boolean;
  completion: boolean;
  functionCalling: boolean;
  vision: boolean;
  streaming: boolean;
  json: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}

/**
 * Model pricing (per million tokens)
 */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: string;
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderId;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
  deprecated?: boolean;
  releaseDate?: string;
}

// ============================================================================
// LLM PROVIDER
// ============================================================================

/**
 * LLM message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * LLM message content part
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mediaType: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string };

/**
 * LLM message
 */
export interface LLMMessage {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
}

/**
 * Tool definition for function calling
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * LLM request parameters
 */
export interface LLMRequest {
  model?: string;
  messages: LLMMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'any' | 'none' | { name: string };
  responseFormat?: 'text' | 'json';
  metadata?: Record<string, unknown>;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Tool call in response
 */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/**
 * LLM response
 */
export interface LLMResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: ToolCall[];
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';
  usage: TokenUsage;
  latencyMs: number;
}

/**
 * LLM streaming chunk
 */
export interface LLMStreamChunk {
  type: 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
  delta?: { text?: string };
  usage?: Partial<TokenUsage>;
}

/**
 * Cost estimate for a request
 */
export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

/**
 * LLM provider interface
 */
export interface LLMProvider extends Provider {
  readonly type: 'llm';
  readonly models: ModelInfo[];
  readonly defaultModel: string;

  /** Complete a chat request */
  complete(request: LLMRequest): Promise<LLMResponse>;

  /** Stream a chat request */
  stream?(request: LLMRequest): AsyncIterable<LLMStreamChunk>;

  /** Count tokens in text */
  countTokens?(text: string, model?: string): Promise<number>;

  /** Estimate cost for a request */
  estimateCost?(request: LLMRequest): Promise<CostEstimate>;
}

// ============================================================================
// EMBEDDING PROVIDER
// ============================================================================

/**
 * Embedding request
 */
export interface EmbeddingRequest {
  model?: string;
  texts: string[];
  dimensions?: number;
  taskType?: 'retrieval_document' | 'retrieval_query' | 'semantic_similarity' | 'classification' | 'clustering';
}

/**
 * Single embedding result
 */
export interface EmbeddingResult {
  embedding: number[];
  index: number;
  tokenCount?: number;
}

/**
 * Embedding response
 */
export interface EmbeddingResponse {
  model: string;
  embeddings: EmbeddingResult[];
  usage: {
    totalTokens: number;
  };
  latencyMs: number;
}

/**
 * Embedding provider interface
 */
export interface EmbeddingProvider extends Provider {
  readonly type: 'embedding';
  readonly models: ModelInfo[];
  readonly defaultModel: string;
  readonly dimensions: number;

  /** Generate embeddings */
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  /** Get embedding for single text */
  embedOne(text: string, model?: string): Promise<number[]>;

  /** Calculate similarity between embeddings */
  similarity?(a: number[], b: number[]): number;
}

// ============================================================================
// RERANKER PROVIDER
// ============================================================================

/**
 * Rerank request
 */
export interface RerankRequest {
  model?: string;
  query: string;
  documents: Array<{ id: string; text: string }>;
  topK?: number;
  returnDocuments?: boolean;
}

/**
 * Single rerank result
 */
export interface RerankResult {
  id: string;
  index: number;
  score: number;
  text?: string;
}

/**
 * Rerank response
 */
export interface RerankResponse {
  model: string;
  results: RerankResult[];
  latencyMs: number;
}

/**
 * Reranker provider interface
 */
export interface RerankerProvider extends Provider {
  readonly type: 'reranker';
  readonly models: ModelInfo[];
  readonly defaultModel: string;

  /** Rerank documents */
  rerank(request: RerankRequest): Promise<RerankResponse>;
}

// ============================================================================
// AUTH PROVIDER
// ============================================================================

/**
 * Auth credentials
 */
export interface AuthCredentials {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Auth provider interface
 */
export interface AuthProvider {
  readonly id: ProviderId;

  /** Get credentials for provider */
  getCredentials(providerId: ProviderId): Promise<AuthCredentials | null>;

  /** Check if credentials are available */
  hasCredentials(providerId: ProviderId): Promise<boolean>;

  /** Refresh credentials if needed */
  refreshCredentials?(providerId: ProviderId): Promise<AuthCredentials | null>;
}

// ============================================================================
// ENVIRONMENT AUTH PROVIDER
// ============================================================================

/**
 * Environment-based auth provider (DEPRECATED).
 *
 * Wave0 requires CLI-only authentication (no API keys). The provider registry
 * module is legacy/standalone support and must not read API keys from env.
 */
export class EnvAuthProvider implements AuthProvider {
  readonly id: ProviderId = 'custom';

  async getCredentials(providerId: ProviderId): Promise<AuthCredentials | null> {
    return null;
  }

  async hasCredentials(providerId: ProviderId): Promise<boolean> {
    return false;
  }

  /**
   * Get all available providers from environment.
   *
   * In Wave0 this is intentionally disabled to prevent API-key based auth.
   */
  async getAvailableProviders(): Promise<ProviderId[]> {
    return [];
  }
}

// ============================================================================
// NO-OP PROVIDER (for testing/minimal mode)
// ============================================================================

/**
 * No-op LLM provider for testing and minimal mode
 */
export class NoOpLLMProvider implements LLMProvider {
  readonly id: ProviderId = 'custom';
  readonly name = 'NoOp';
  readonly type = 'llm' as const;
  readonly models: ModelInfo[] = [];
  readonly defaultModel = 'none';

  async checkAvailability(): Promise<ProviderStatus> {
    return { available: true, reason: 'No-op provider always available' };
  }

  getConfig(): ProviderConfig {
    return {};
  }

  async complete(_request: LLMRequest): Promise<LLMResponse> {
    return {
      id: 'noop',
      model: 'none',
      content: '',
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
    };
  }
}

// ============================================================================
// PROVIDER DISCOVERY TYPES
// ============================================================================

/**
 * Provider capability flags
 */
export type ProviderCapability =
  | 'llm'
  | 'embedding'
  | 'reranker'
  | 'streaming'
  | 'function_calling'
  | 'vision'
  | 'json_mode';

/**
 * Discovered provider from environment scan
 */
export interface DiscoveredProvider {
  id: ProviderId;
  hasCredentials: boolean;
  capabilities: ProviderCapability[];
  discoveredAt: Date;
}

/**
 * Options for health checking providers
 */
export interface HealthCheckOptions {
  /** Maximum time to wait for health check (default: 5000ms) */
  timeout?: number;
  /** Provider types to include in check */
  includeTypes?: Array<'llm' | 'embedding' | 'reranker'>;
  /** Maximum acceptable latency in ms */
  minLatencyMs?: number;
}

/**
 * A healthy provider that passed health checks
 */
export interface HealthyProvider {
  id: ProviderId;
  type: 'llm' | 'embedding' | 'reranker';
  provider: Provider;
  status: ProviderStatus;
  latencyMs: number;
  checkedAt: Date;
}

// ============================================================================
// PROVIDER REGISTRY
// ============================================================================

/**
 * Registered provider entry
 */
interface RegisteredProvider {
  llm?: LLMProvider;
  embedding?: EmbeddingProvider;
  reranker?: RerankerProvider;
  status?: ProviderStatus;
  lastCheck?: number;
}

/**
 * Provider registry for managing all providers
 */
export class ProviderRegistry {
  private providers = new Map<ProviderId, RegisteredProvider>();
  private authProvider: AuthProvider;
  private defaultLLM?: ProviderId;
  private defaultEmbedding?: ProviderId;
  private defaultReranker?: ProviderId;

  constructor(authProvider?: AuthProvider) {
    this.authProvider = authProvider ?? new EnvAuthProvider();
  }

  // ============================================================================
  // REGISTRATION
  // ============================================================================

  /**
   * Register an LLM provider
   */
  registerLLM(provider: LLMProvider, setDefault = false): void {
    const entry = this.providers.get(provider.id) ?? {};
    entry.llm = provider;
    this.providers.set(provider.id, entry);

    if (setDefault || !this.defaultLLM) {
      this.defaultLLM = provider.id;
    }
  }

  /**
   * Register an embedding provider
   */
  registerEmbedding(provider: EmbeddingProvider, setDefault = false): void {
    const entry = this.providers.get(provider.id) ?? {};
    entry.embedding = provider;
    this.providers.set(provider.id, entry);

    if (setDefault || !this.defaultEmbedding) {
      this.defaultEmbedding = provider.id;
    }
  }

  /**
   * Register a reranker provider
   */
  registerReranker(provider: RerankerProvider, setDefault = false): void {
    const entry = this.providers.get(provider.id) ?? {};
    entry.reranker = provider;
    this.providers.set(provider.id, entry);

    if (setDefault || !this.defaultReranker) {
      this.defaultReranker = provider.id;
    }
  }

  // ============================================================================
  // RETRIEVAL
  // ============================================================================

  /**
   * Get LLM provider
   */
  getLLM(id?: ProviderId): LLMProvider | undefined {
    const providerId = id ?? this.defaultLLM;
    if (!providerId) return undefined;
    return this.providers.get(providerId)?.llm;
  }

  /**
   * Get embedding provider
   */
  getEmbedding(id?: ProviderId): EmbeddingProvider | undefined {
    const providerId = id ?? this.defaultEmbedding;
    if (!providerId) return undefined;
    return this.providers.get(providerId)?.embedding;
  }

  /**
   * Get reranker provider
   */
  getReranker(id?: ProviderId): RerankerProvider | undefined {
    const providerId = id ?? this.defaultReranker;
    if (!providerId) return undefined;
    return this.providers.get(providerId)?.reranker;
  }

  /**
   * Check if any LLM is available
   */
  hasLLM(): boolean {
    return this.defaultLLM !== undefined && this.providers.get(this.defaultLLM)?.llm !== undefined;
  }

  /**
   * Check if any embedding provider is available
   */
  hasEmbedding(): boolean {
    return this.defaultEmbedding !== undefined && this.providers.get(this.defaultEmbedding)?.embedding !== undefined;
  }

  /**
   * Check if any reranker is available
   */
  hasReranker(): boolean {
    return this.defaultReranker !== undefined && this.providers.get(this.defaultReranker)?.reranker !== undefined;
  }

  // ============================================================================
  // STATUS
  // ============================================================================

  /**
   * Get status of all providers
   */
  async getStatus(): Promise<Record<ProviderId, ProviderStatus>> {
    const status: Record<string, ProviderStatus> = {};

    for (const [id, entry] of this.providers) {
      const providers = [entry.llm, entry.embedding, entry.reranker].filter(Boolean);

      if (providers.length === 0) {
        status[id] = { available: false, reason: 'No providers registered' };
        continue;
      }

      // Check first available provider
      const provider = providers[0]!;
      status[id] = await provider.checkAvailability();
    }

    return status as Record<ProviderId, ProviderStatus>;
  }

  /**
   * Get list of registered provider IDs
   */
  getRegisteredProviders(): ProviderId[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get auth provider
   */
  getAuthProvider(): AuthProvider {
    return this.authProvider;
  }

  /**
   * Clear all registered providers
   */
  clear(): void {
    this.providers.clear();
    this.defaultLLM = undefined;
    this.defaultEmbedding = undefined;
    this.defaultReranker = undefined;
  }

  // ============================================================================
  // DISCOVERY (Phase 2 - IProviderRegistry interface)
  // ============================================================================

  /**
   * Auto-discover available providers from environment.
   * Checks environment variables and returns list of providers with credentials.
   */
  async discover(): Promise<DiscoveredProvider[]> {
    throw new Error(
      'unverified_by_trace(env_auth_forbidden): Wave0 forbids environment/API-key based provider discovery. Use checkAllProviders()/requireProviders() and the adapter layer.'
    );
  }

  /**
   * Get capabilities for a provider type.
   */
  private getProviderCapabilities(providerId: ProviderId): ProviderCapability[] {
    const capabilities: ProviderCapability[] = [];

    // Map known providers to their capabilities
    const capabilityMap: Record<ProviderId, ProviderCapability[]> = {
      anthropic: ['llm', 'streaming', 'function_calling', 'vision'],
      openai: ['llm', 'embedding', 'streaming', 'function_calling', 'vision'],
      google: ['llm', 'embedding', 'streaming', 'function_calling', 'vision'],
      mistral: ['llm', 'embedding', 'streaming', 'function_calling'],
      groq: ['llm', 'streaming'],
      together: ['llm', 'embedding', 'streaming'],
      fireworks: ['llm', 'streaming'],
      perplexity: ['llm', 'streaming'],
      deepseek: ['llm', 'streaming', 'function_calling'],
      'azure-openai': ['llm', 'embedding', 'streaming', 'function_calling'],
      'aws-bedrock': ['llm', 'embedding', 'streaming'],
      ollama: ['llm', 'embedding', 'streaming'],
      lmstudio: ['llm', 'streaming'],
      custom: ['llm'],
    };

    return capabilityMap[providerId] ?? capabilities;
  }

  /**
   * Get only healthy (available and responding) providers.
   * Performs health checks with configurable timeout.
   */
  async getHealthy(options: HealthCheckOptions = {}): Promise<HealthyProvider[]> {
    const {
      timeout = 5000,
      includeTypes = ['llm', 'embedding', 'reranker'],
      minLatencyMs,
    } = options;

    const healthy: HealthyProvider[] = [];
    const checkPromises: Array<Promise<HealthyProvider | null>> = [];

    for (const [id, entry] of this.providers) {
      const providers: Array<{ provider: Provider; type: 'llm' | 'embedding' | 'reranker' }> = [];

      if (entry.llm && includeTypes.includes('llm')) {
        providers.push({ provider: entry.llm, type: 'llm' });
      }
      if (entry.embedding && includeTypes.includes('embedding')) {
        providers.push({ provider: entry.embedding, type: 'embedding' });
      }
      if (entry.reranker && includeTypes.includes('reranker')) {
        providers.push({ provider: entry.reranker, type: 'reranker' });
      }

      for (const { provider, type } of providers) {
        checkPromises.push(
          this.checkProviderHealth(id, provider, type, timeout, minLatencyMs)
        );
      }
    }

    const results = await Promise.all(checkPromises);
    for (const result of results) {
      if (result) {
        healthy.push(result);
      }
    }

    // Sort by latency (fastest first), then by identity for deterministic ties.
    healthy.sort((a, b) => {
      const latencyDelta = a.latencyMs - b.latencyMs;
      if (latencyDelta !== 0) {
        return latencyDelta;
      }
      const idDelta = a.id.localeCompare(b.id);
      if (idDelta !== 0) {
        return idDelta;
      }
      return a.type.localeCompare(b.type);
    });

    return healthy;
  }

  /**
   * Check health of a single provider.
   */
  private async checkProviderHealth(
    id: ProviderId,
    provider: Provider,
    type: 'llm' | 'embedding' | 'reranker',
    timeout: number,
    minLatencyMs?: number
  ): Promise<HealthyProvider | null> {
    const startTime = Date.now();

    try {
      const statusPromise = provider.checkAvailability();
      const timeoutPromise = new Promise<ProviderStatus>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), timeout);
      });

      const status = await Promise.race([statusPromise, timeoutPromise]);
      const measuredLatencyMs = Date.now() - startTime;
      const reportedLatencyMs = status.latencyMs;
      const latencyMs = typeof reportedLatencyMs === 'number' && Number.isFinite(reportedLatencyMs)
        ? reportedLatencyMs
        : measuredLatencyMs;

      if (!status.available) {
        return null;
      }

      if (minLatencyMs !== undefined && latencyMs > minLatencyMs) {
        return null;
      }

      return {
        id,
        type,
        provider,
        status,
        latencyMs,
        checkedAt: new Date(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the best available provider for a given type.
   * Returns the healthiest (lowest latency) provider of the requested type.
   */
  async getBest(type: 'llm' | 'embedding' | 'reranker', options?: HealthCheckOptions): Promise<Provider | null> {
    const healthy = await this.getHealthy({
      ...options,
      includeTypes: [type],
    });

    return healthy.length > 0 ? healthy[0].provider : null;
  }
}

// ============================================================================
// SINGLETON REGISTRY
// ============================================================================

let globalRegistry: ProviderRegistry | undefined;

/**
 * Get the global provider registry
 */
export function getProviderRegistry(): ProviderRegistry {
  if (!globalRegistry) {
    globalRegistry = new ProviderRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global provider registry
 */
export function resetProviderRegistry(): void {
  globalRegistry?.clear();
  globalRegistry = undefined;
}

// ============================================================================
// USAGE TRACKING
// ============================================================================

/**
 * Usage record for a single request
 */
export interface UsageRecord {
  providerId: ProviderId;
  model: string;
  type: 'llm' | 'embedding' | 'reranker';
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  latencyMs: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Usage summary for a time period
 */
export interface UsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  avgLatencyMs: number;
  byProvider: Record<ProviderId, {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
  byModel: Record<string, {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
}

/**
 * Usage tracker for monitoring provider usage
 */
export class UsageTracker {
  private records: UsageRecord[] = [];
  private maxRecords = 10000;

  /**
   * Record a usage event
   */
  record(record: Omit<UsageRecord, 'timestamp'>): void {
    this.records.push({ ...record, timestamp: Date.now() });

    // Trim old records
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  /**
   * Get usage summary for a time period
   */
  getSummary(since?: number): UsageSummary {
    const cutoff = since ?? 0;
    const relevant = this.records.filter(r => r.timestamp >= cutoff);

    const summary: UsageSummary = {
      totalRequests: relevant.length,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      avgLatencyMs: 0,
      byProvider: {} as Record<ProviderId, { requests: number; inputTokens: number; outputTokens: number; cost: number }>,
      byModel: {},
    };

    let totalLatency = 0;

    for (const record of relevant) {
      summary.totalInputTokens += record.inputTokens;
      summary.totalOutputTokens += record.outputTokens;
      summary.totalCost += record.cost ?? 0;
      totalLatency += record.latencyMs;

      // By provider
      if (!summary.byProvider[record.providerId]) {
        summary.byProvider[record.providerId] = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      }
      summary.byProvider[record.providerId].requests++;
      summary.byProvider[record.providerId].inputTokens += record.inputTokens;
      summary.byProvider[record.providerId].outputTokens += record.outputTokens;
      summary.byProvider[record.providerId].cost += record.cost ?? 0;

      // By model
      if (!summary.byModel[record.model]) {
        summary.byModel[record.model] = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      }
      summary.byModel[record.model].requests++;
      summary.byModel[record.model].inputTokens += record.inputTokens;
      summary.byModel[record.model].outputTokens += record.outputTokens;
      summary.byModel[record.model].cost += record.cost ?? 0;
    }

    summary.avgLatencyMs = relevant.length > 0 ? totalLatency / relevant.length : 0;

    return summary;
  }

  /**
   * Get recent records
   */
  getRecords(limit = 100): UsageRecord[] {
    return this.records.slice(-limit);
  }

  /**
   * Clear all records
   */
  clear(): void {
    this.records = [];
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  AdaptiveProviderConfig,
  adaptiveProviderConfig,
} from './adaptive_config.js';
