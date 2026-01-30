import { defineConfig } from 'vitest/config';

/**
 * Vitest Configuration for Librarian
 *
 * Test tiers controlled by LIBRARIAN_TEST_MODE environment variable:
 * - 'unit' (default): Fast tests with mocked providers
 * - 'integration': Real providers, skip if unavailable
 * - 'system': Real providers required, fail if unavailable
 *
 * Worker pool configuration is adaptive based on system resources.
 * Override with LIBRARIAN_TEST_WORKERS environment variable.
 *
 * See docs/librarian/specs/core/testing-architecture.md for policy.
 */
export default defineConfig(async () => {
  // Attempt dynamic resource detection
  let poolConfig = {
    pool: 'forks' as const,
    maxWorkers: 2,
    fileParallelism: true,
    isolate: true,
  };
  let reasoning: string[] = ['Using fallback configuration'];

  try {
    const { getConfiguredTestResources } = await import(
      './src/test/test-resource-config.js'
    );
    const detected = getConfiguredTestResources();
    poolConfig = detected.vitest;
    reasoning = detected.reasoning;
  } catch {
    // Module not available, use fallback
  }

  // Allow env override for CI/manual control
  const envWorkers = parseInt(process.env.LIBRARIAN_TEST_WORKERS ?? '', 10);
  if (!isNaN(envWorkers) && envWorkers > 0) {
    poolConfig.maxWorkers = envWorkers;
    reasoning = [`Worker override from env: ${envWorkers}`];
  }

  // Log configuration (unless quiet mode)
  if (process.env.VITEST_QUIET !== 'true') {
    console.log(`[vitest] ${reasoning.join(' | ')}`);
  }

  return {
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
      exclude: (() => {
        const mode = process.env.LIBRARIAN_TEST_MODE ?? 'unit';
        const excluded: string[] = [];

        if (mode === 'unit') {
          excluded.push(
            '**/*.integration.test.ts',
            '**/*.system.test.ts',
            '**/*.live.test.ts',
            'src/__tests__/agentic/**'
          );
        } else if (mode === 'integration') {
          excluded.push(
            '**/*.system.test.ts',
            '**/*.live.test.ts',
            'src/__tests__/agentic/**'
          );
        }

        return excluded;
      })(),
      setupFiles: ['./vitest.setup.ts'],
      testTimeout:
        process.env.LIBRARIAN_TEST_MODE === 'system' ? 300000 : 30000,
      hookTimeout:
        process.env.LIBRARIAN_TEST_MODE === 'system' ? 60000 : 10000,
      // Adaptive pool configuration
      pool: poolConfig.pool,
      poolOptions: {
        forks: {
          maxForks: poolConfig.maxWorkers,
          minForks: 1,
          isolate: poolConfig.isolate,
        },
      },
      fileParallelism: poolConfig.fileParallelism,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules/',
          'dist/',
          '**/*.test.ts',
          'vitest.config.ts',
          'vitest.setup.ts',
        ],
      },
    },
  };
});
