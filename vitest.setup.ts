/**
 * Centralized Vitest Setup for Librarian
 *
 * This file configures test behavior based on LIBRARIAN_TEST_MODE:
 * - 'unit' (default): Mock provider discovery to fail fast
 * - 'integration': Use real providers, skip tests if unavailable
 * - 'system': Require real providers, fail if unavailable
 *
 * See docs/librarian/specs/core/testing-architecture.md for complete policy.
 */

import os from 'os';
import { vi, beforeAll, afterAll } from 'vitest';

const LIBRARIAN_TEST_MODE = process.env.LIBRARIAN_TEST_MODE ?? 'unit';

// Only apply global mocks in unit test mode
if (LIBRARIAN_TEST_MODE === 'unit') {
  // Mock provider_check.js to fail fast instead of timing out
  vi.mock('./src/api/provider_check.js', () => ({
    requireProviders: vi.fn().mockRejectedValue(
      Object.assign(
        new Error('unverified_by_trace(provider_unavailable): Test mode - providers not available'),
        {
          name: 'ProviderUnavailableError',
          details: {
            message: 'unverified_by_trace(provider_unavailable): Test mode',
            missing: ['LLM: test_mode', 'Embedding: test_mode'],
            suggestion: 'Run with LIBRARIAN_TEST_MODE=integration for real providers',
          },
        }
      )
    ),
    checkAllProviders: vi.fn().mockResolvedValue({
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'test_mode' },
      embedding: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'test_mode' },
    }),
    checkProviderSnapshot: vi.fn().mockResolvedValue({
      status: {
        llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'test_mode' },
        embedding: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'test_mode' },
      },
      remediationSteps: ['unverified_by_trace(provider_unavailable): Test mode'],
      reason: 'test_mode',
    }),
    ProviderUnavailableError: class ProviderUnavailableError extends Error {
      constructor(public details: { message: string; missing: string[]; suggestion: string }) {
        super(details.message);
        this.name = 'ProviderUnavailableError';
      }
    },
  }));

  // Mock LLM env to avoid provider discovery timeouts
  // We use importOriginal to keep the synchronous env-reading functions working
  // but mock the async discovery function that does slow provider probing
  vi.mock('./src/api/llm_env.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./src/api/llm_env.js')>();
    return {
      ...actual,
      // Keep synchronous env-reading functions from actual implementation
      resolveLibrarianProvider: actual.resolveLibrarianProvider,
      resolveLibrarianModelId: actual.resolveLibrarianModelId,
      resolveLibrarianModelConfig: actual.resolveLibrarianModelConfig,
      // Mock only the async discovery function that would timeout
      resolveLibrarianModelConfigWithDiscovery: vi.fn().mockRejectedValue(
        new Error('unverified_by_trace(provider_unavailable): Test mode')
      ),
      // Re-export the registry (will be undefined in mock mode, tests that need it should mock it themselves)
      llmProviderRegistry: actual.llmProviderRegistry,
    };
  });

  // Note: We do NOT mock llm_provider_discovery.js globally because
  // its test file (llm_provider_discovery.test.ts) needs to test the
  // actual probe logic with controlled inputs (mocked execa).
  //
  // Tests that use provider discovery should either:
  // 1. Mock provider_check.js (high-level) - which we do above
  // 2. Mock llm_env.js (discovery entry point) - which we do above
  // 3. Add their own specific mocks if they need different behavior
}

// Log test mode at startup
beforeAll(() => {
  if (process.env.VITEST_QUIET !== 'true') {
    console.log(`[vitest.setup] Test mode: ${LIBRARIAN_TEST_MODE}`);
    if (LIBRARIAN_TEST_MODE === 'unit') {
      console.log('[vitest.setup] Provider mocks active - tests will fail fast without real providers');
    } else if (LIBRARIAN_TEST_MODE === 'integration') {
      console.log('[vitest.setup] Integration mode - tests will skip if providers unavailable');
    } else if (LIBRARIAN_TEST_MODE === 'system') {
      console.log('[vitest.setup] System mode - tests require real providers');
    }

    // Log resource information
    const cpuCores = os.cpus().length;
    const totalMemoryGB = (os.totalmem() / (1024 ** 3)).toFixed(1);
    const freeMemoryGB = (os.freemem() / (1024 ** 3)).toFixed(1);
    const loadAvg = os.loadavg()[0]?.toFixed(2) ?? 'N/A';
    console.log(`[vitest.setup] System: ${cpuCores} cores, ${freeMemoryGB}GB free / ${totalMemoryGB}GB total, load: ${loadAvg}`);
  }
});

afterAll(() => {
  // Clean up any global state
});
