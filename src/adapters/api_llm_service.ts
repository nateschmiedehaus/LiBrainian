/**
 * @deprecated This module is a backward-compatibility shim.
 * Import from `./anthropic_api_llm_service.js` instead.
 *
 * ApiLlmService has been renamed to AnthropicApiLlmService to honestly
 * reflect that it is Anthropic-specific. The createAutoLlmServiceFactory
 * now supports ANTHROPIC_API_KEY, OPENAI_API_KEY, and CLI fallback.
 */
export {
  AnthropicApiLlmService,
  AnthropicApiLlmService as ApiLlmService,
  isInsideClaudeCodeSession,
  createAnthropicApiLlmServiceFactory as createApiLlmServiceFactory,
  createAutoLlmServiceFactory,
} from './anthropic_api_llm_service.js';
