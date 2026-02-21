/**
 * @fileoverview Provider Module Exports
 *
 * LLM, embedding, reranker, and auth providers for LiBrainian.
 * All providers are optional - LiBrainian works in minimal mode without them.
 *
 * @packageDocumentation
 */

// Core types
export type {
  ProviderId,
  ProviderStatus,
  Provider,
  ProviderConfig,
  ModelCapabilities,
  ModelPricing,
  ModelInfo,
  ProviderCapability,
  DiscoveredProvider,
  HealthCheckOptions,
  HealthyProvider,
} from './types.js';

// LLM types
export type {
  MessageRole,
  ContentPart,
  LLMMessage,
  ToolDefinition,
  LLMRequest,
  TokenUsage,
  ToolCall,
  LLMResponse,
  LLMStreamChunk,
  CostEstimate,
  LLMProvider,
} from './types.js';

// Embedding types
export type {
  EmbeddingRequest,
  EmbeddingResult,
  EmbeddingResponse,
  EmbeddingProvider,
} from './types.js';

// Reranker types
export type {
  RerankRequest,
  RerankResult,
  RerankResponse,
  RerankerProvider,
} from './types.js';

// Auth types
export type {
  AuthCredentials,
  AuthProvider,
} from './types.js';

// Usage tracking
export type {
  UsageRecord,
  UsageSummary,
} from './types.js';

// Classes and implementations
export {
  EnvAuthProvider,
  NoOpLLMProvider,
  ProviderRegistry,
  getProviderRegistry,
  resetProviderRegistry,
  UsageTracker,
} from './types.js';

// Adaptive config
export {
  AdaptiveProviderConfig,
  adaptiveProviderConfig,
} from './adaptive_config.js';

export type {
  ProviderMetrics,
  CircuitBreakerConfig,
  RateLimitConfig,
  ProviderConfig as AdaptiveProviderConfigType,
} from './adaptive_config.js';
