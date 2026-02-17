import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Ensure a stable, writable temp directory for vitest internals.
//
// Important: on some dev machines `/tmp` (and friends) live on a nearly-full
// system volume. Prefer a repo-local `.tmp/` directory (gitignored) so tests
// do not fail with ENOSPC.
// Keep this *outside* the repo root so workspace root detection in tests does
// not accidentally traverse into the Librarian repo and find `.librarian/`.
const fallbackTmpDir = path.resolve(process.cwd(), '..', '.tmp', 'librarian');
const resolvedTmpDir =
  process.env.TMPDIR && process.env.TMPDIR.trim().length > 0
    ? process.env.TMPDIR
    : fallbackTmpDir;
process.env.TMPDIR = resolvedTmpDir;
process.env.TMP = resolvedTmpDir;
process.env.TEMP = resolvedTmpDir;
try {
  mkdirSync(resolvedTmpDir, { recursive: true });
} catch {
  // If we cannot create it, let vitest surface the error normally.
}

/**
 * Vitest Configuration for Librarian
 *
 * Test tiers controlled by LIBRARIAN_TEST_MODE environment variable:
 * - 'unit' (default): Fast tests with mocked providers
 * - 'integration': Real providers, skip if unavailable
 * - 'evaluation': Phase validation + external corpora (slow)
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
  let pressureLevel: string | null = null;
  let resourceAwareExclude: string[] = [];

  try {
    const { getConfiguredTestResources } = await import(
      './src/test/test-resource-config.js'
    );
    const detected = getConfiguredTestResources();
    poolConfig = detected.vitest;
    reasoning = detected.reasoning;
    pressureLevel = detected.pressure.level;
  } catch {
    // Module not available, use fallback
  }

  // Allow env override for CI/manual control
  const envWorkers = parseInt(process.env.LIBRARIAN_TEST_WORKERS ?? '', 10);
  if (!isNaN(envWorkers) && envWorkers > 0) {
    poolConfig.maxWorkers = envWorkers;
    reasoning = [`Worker override from env: ${envWorkers}`];
  }

  // Skip heavy/system tests when resources are critically constrained
  try {
    const enableResourceAwareExclude =
      process.env.LIBRARIAN_TEST_RESOURCE_AWARE_EXCLUDE === '1' ||
      process.env.LIBRARIAN_TEST_RESOURCE_AWARE_EXCLUDE === 'true';
    const disableResourceAwareExclude =
      process.env.LIBRARIAN_TEST_DISABLE_RESOURCE_EXCLUDE === '1' ||
      process.env.LIBRARIAN_TEST_DISABLE_RESOURCE_EXCLUDE === 'true';
    if (
      enableResourceAwareExclude &&
      !disableResourceAwareExclude &&
      (pressureLevel === 'critical' || pressureLevel === 'oom_imminent')
    ) {
      const { TEST_CATEGORIES } = await import('./src/test/test-categories.js');
      resourceAwareExclude = [
        ...TEST_CATEGORIES.heavy.patterns,
        ...TEST_CATEGORIES.system.patterns,
      ];
      reasoning.push(
        `Resource pressure (${pressureLevel}): skipping heavy/system tests`
      );

      if (pressureLevel === 'critical' || pressureLevel === 'oom_imminent') {
        resourceAwareExclude.push(
          '**/evaluation/**/*.test.ts',
          '**/analysis/**/*.test.ts',
          '**/unified_embedding_pipeline.test.ts',
          '**/multi_vector_verification.test.ts',
          '**/index_librarian_multi_vector.test.ts'
        );
        reasoning.push(
          `Resource pressure (${pressureLevel}): skipping evaluation/analysis + embedding-intensive tests`
        );
      }
    } else if (enableResourceAwareExclude && disableResourceAwareExclude) {
      reasoning.push('Resource pressure overrides disabled by env');
    } else if (!enableResourceAwareExclude) {
      reasoning.push('Resource-aware exclusions disabled (set LIBRARIAN_TEST_RESOURCE_AWARE_EXCLUDE=1 to enable)');
    }
  } catch {
    // If categories are unavailable, continue without resource-aware exclusions
  }

  // Log configuration (unless quiet mode)
  if (process.env.VITEST_QUIET !== 'true') {
    console.log(`[vitest] ${reasoning.join(' | ')}`);
  }

  return {
    // Keep Vite/Vitest caches off the system temp volume.
    cacheDir: path.resolve(process.cwd(), '..', '.tmp', 'vite-cache'),
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
            'src/__tests__/agentic/**',
            // Keep Tier-0 (unit) fast and deterministic. The evaluation/analysis
            // suites run whole-repo scanners and can OOM in constrained envs.
            '**/evaluation/**/*.test.ts',
            '**/analysis/**/*.test.ts',
            // Embedding-heavy; requires real models/providers to assert meaningful ordering.
            '**/cross_encoder_reranker.test.ts'
          );
        } else if (mode === 'integration') {
          excluded.push(
            '**/*.system.test.ts',
            '**/*.live.test.ts',
            'src/__tests__/agentic/**',
            // Integration should validate real flows without running the full
            // evaluation corpus (too slow/flaky for everyday use).
            '**/evaluation/**/*.test.ts',
            '**/analysis/**/*.test.ts',
            '**/cross_encoder_reranker.test.ts'
          );
        } else if (mode === 'evaluation') {
          excluded.push(
            '**/*.live.test.ts',
            '**/*.system.test.ts',
            'src/__tests__/agentic/**'
          );
        } else if (mode === 'system' || mode === 'heavy') {
          excluded.push('**/*.live.test.ts');
        }

        if (resourceAwareExclude.length > 0) {
          excluded.push(...resourceAwareExclude);
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
