/**
 * @fileoverview Utility Module Exports
 *
 * @packageDocumentation
 */

export { LLMService, getLLMService, setLLMService } from './llm_service.js';
export type { LLMServiceOptions, ProviderHealth } from './llm_service.js';

export {
  ensureDailyModelSelection,
  getCurrentModelSelection,
  resetModelSelection,
  selectModel,
} from './model_policy.js';
export type { ModelSelection, ModelPolicy } from './model_policy.js';

export {
  safeJsonParse,
  parseJsonWithDefault,
  safeJsonStringify,
  parseJsonObject,
  parseJsonArray,
} from './safe_json.js';

export {
  validateJSON,
  validateJSONString,
  extractJSON,
  validateLLMOutput,
  OutputValidationError,
  StringArraySchema,
  StringRecordSchema,
  NumberSchema,
  BooleanSchema,
} from './output_validator.js';
export type { ValidationResult } from './output_validator.js';

export { AuthChecker, getAuthChecker } from './auth_checker.js';
export type { AuthStatus, AuthStatusSummary } from './auth_checker.js';

export { extractMarkedJson, createMarkedJson, wrapJsonCodeBlock } from './marked_json.js';
export type { MarkedJsonResult } from './marked_json.js';

export { HallucinationDetector, getHallucinationDetector } from './hallucination_detector.js';
export type { HallucinationCheck, HallucinationResult } from './hallucination_detector.js';

export { withTimeout, TimeoutError } from './async.js';
export type { WithTimeoutOptions } from './async.js';

export {
  QueryBatcher,
  RateLimiter,
  QueryController,
  getDefaultBatcher,
  getDefaultRateLimiter,
  resetDefaults,
} from './query_batcher.js';
export type {
  QueryBatcherOptions,
  BatchedQueryResult,
  BatcherStats,
  RateLimiterOptions,
  RateLimiterStats,
} from './query_batcher.js';

export { computeChecksum16 } from './checksums.js';
export { computeContentHash } from '../storage/content_cache.js';

export {
  getLanguageFromExtension,
  getLanguageFromPath,
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_EXTENSIONS,
} from './language.js';
