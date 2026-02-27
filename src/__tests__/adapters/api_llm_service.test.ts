/**
 * Backward-compatibility test: ensures that importing from the old
 * `api_llm_service.js` module path still works correctly.
 *
 * The primary test suite is in `anthropic_api_llm_service.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiLlmService,
  AnthropicApiLlmService,
  isInsideClaudeCodeSession,
  createAutoLlmServiceFactory,
  createApiLlmServiceFactory,
} from '../../adapters/api_llm_service.js';

vi.mock('../../utils/provider_failures.js', () => ({
  classifyProviderFailure: vi.fn(() => ({ reason: 'unknown', ttlMs: 1000 })),
  getActiveProviderFailures: vi.fn(async () => ({})),
  recordProviderFailure: vi.fn(async () => undefined),
  recordProviderSuccess: vi.fn(async () => undefined),
  resolveProviderWorkspaceRoot: vi.fn(() => process.cwd()),
}));

vi.mock('../../security/privacy_audit.js', () => ({
  appendPrivacyAuditEvent: vi.fn(async () => undefined),
}));

vi.mock('../../telemetry/logger.js', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
}));

describe('api_llm_service.ts backward compatibility shim', () => {
  const saved = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-1234';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('exports ApiLlmService as an alias for AnthropicApiLlmService', () => {
    expect(ApiLlmService).toBe(AnthropicApiLlmService);
  });

  it('ApiLlmService instances pass instanceof AnthropicApiLlmService', () => {
    const service = new ApiLlmService();
    expect(service).toBeInstanceOf(AnthropicApiLlmService);
  });

  it('re-exports isInsideClaudeCodeSession', () => {
    expect(typeof isInsideClaudeCodeSession).toBe('function');
  });

  it('re-exports createAutoLlmServiceFactory', () => {
    expect(typeof createAutoLlmServiceFactory).toBe('function');
  });

  it('re-exports createApiLlmServiceFactory', () => {
    expect(typeof createApiLlmServiceFactory).toBe('function');
  });

  it('ApiLlmService constructor works through the shim', () => {
    const service = new ApiLlmService();
    expect(typeof service.chat).toBe('function');
    expect(typeof service.checkClaudeHealth).toBe('function');
    expect(typeof service.checkCodexHealth).toBe('function');
  });
});
