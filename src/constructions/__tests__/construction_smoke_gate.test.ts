import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { invokeConstruction, listConstructions } from '../registry.js';
import type { ConstructionManifest } from '../types.js';

const PER_CONSTRUCTION_TIMEOUT_MS = 120_000;
const TOTAL_BUDGET_MS = 10 * 60 * 1000;
const MAX_PARALLEL = 4;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = path.resolve(__dirname, '../../../test/fixtures/librarian_usecase');

type SmokeResult = {
  id: string;
  status: 'pass' | 'fail';
  durationMs: number;
  parseable: boolean;
  confidencePresent: boolean;
  timedOut: boolean;
  error?: string;
};

function toSingleLineError(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);
  return text.replace(/\s+/gu, ' ').trim();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, id: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`construction_timeout:${id}:${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer));
  });
}

function buildGenericInput(manifest: ConstructionManifest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    dryRun: true,
    timeoutMs: 2_000,
    cwd: FIXTURE_REPO,
    repoPath: FIXTURE_REPO,
    workspace: FIXTURE_REPO,
    mode: 'quick',
  };

  const properties = manifest.inputSchema.properties ?? {};
  const required = manifest.inputSchema.required ?? [];
  for (const key of required) {
    if (key in input) continue;
    const property = properties[key];
    const propertyType = property?.type ?? 'string';

    if (propertyType === 'array') {
      input[key] =
        key === 'args'
          ? ['-e', 'process.stdout.write("smoke")']
          : key === 'checkTypes'
            ? ['injection']
          : key === 'runs'
            ? [
                {
                  repo: FIXTURE_REPO,
                  durationMs: 1,
                  observations: {
                    overallVerdict: {
                      wouldRecommend: true,
                      npsScore: 7,
                    },
                    negativeFindingsMandatory: [],
                  },
                  implicitSignals: {
                    fellBackToGrep: false,
                    catInsteadOfContext: false,
                    commandsFailed: 0,
                    abortedEarly: false,
                    timeoutRatio: 0,
                    stderrAnomalies: [],
                  },
                },
              ]
            : ['smoke'];
      continue;
    }

    if (propertyType === 'number') {
      input[key] = key.toLowerCase().includes('timeout') ? 2_000 : 1;
      continue;
    }

    if (propertyType === 'boolean') {
      input[key] = false;
      continue;
    }

    if (propertyType === 'object') {
      input[key] =
        key === 'budget'
          ? { maxDurationMs: 2_000, maxTokenBudget: 1_000, maxUsd: 1 }
          : key === 'usage'
            ? { durationMs: 1 }
            : key === 'aggregate'
            ? {
                runCount: 1,
                meanNps: 7,
                wouldRecommendRate: 1,
                avgNegativeFindings: 0,
                implicitFallbackRate: 0,
              }
              : key === 'architectureSpec'
                ? { layers: [], boundaries: [], rules: [] }
                : key === 'securityScope'
                  ? { files: [], checkTypes: [] }
              : {};
      continue;
    }

    if (key === 'command') {
      input[key] = process.execPath;
      continue;
    }

    if (key === 'output') {
      input[key] = 'PATROL_OBS: {"type":"smoke","ok":true}';
      continue;
    }

    input[key] = 'smoke';
  }

  if (manifest.id === 'librainian:architecture-verifier') {
    input.layers = [
      {
        name: 'service',
        patterns: ['src/service/**'],
        allowedDependencies: ['data'],
      },
      {
        name: 'data',
        patterns: ['src/data/**'],
        allowedDependencies: [],
      },
    ];
    input.boundaries = [
      {
        name: 'service-data',
        description: 'service should access data through stable boundaries',
        inside: ['src/service'],
        outside: ['src/data'],
      },
    ];
    input.rules = [
      {
        id: 'no-circular',
        description: 'prevent circular imports',
        type: 'no-circular',
        severity: 'error',
      },
    ];
  }

  if (manifest.id === 'librainian:bug-investigation-assistant') {
    input.description = 'User profile page crashes during request handling';
    input.errorMessage = "TypeError: Cannot read properties of undefined (reading 'id')";
    input.stackTrace =
      "TypeError: Cannot read properties of undefined (reading 'id')\n" +
      '    at getUser (src/service/user.ts:42:13)\n' +
      '    at handleRequest (src/api/handler.ts:10:5)';
  }

  return input;
}

function createLibrarianStub(): Record<string, unknown> {
  const base: Record<string, unknown> = {
    workspaceRoot: FIXTURE_REPO,
    rootDir: FIXTURE_REPO,
  };
  const mockPack = {
    relatedFiles: ['src/service/user.ts', 'src/data/user_repo.ts'],
    codeSnippets: [
      {
        content:
          "import { getUserRecord } from '../data/user_repo';\n" +
          'export function getUser(id: string) {\n' +
          '  return getUserRecord(id);\n' +
          '}',
        startLine: 1,
        endLine: 4,
      },
    ],
  };

  return new Proxy(base, {
    get(target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'query' || prop === 'queryOptional') {
        return async () => ({
          packs: [mockPack],
          contextPacks: [],
          snippets: [],
          summary: 'smoke',
          confidence: 0.8,
        });
      }
      return async () => [];
    },
  });
}

function isParseableOutput(output: unknown): boolean {
  if (output && typeof output === 'object') return true;
  if (typeof output !== 'string') return false;
  const trimmed = output.trim();
  if (trimmed.length === 0) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function hasConfidenceSignal(
  value: unknown,
  depth = 0,
  seen: Set<unknown> = new Set(),
): boolean {
  if (depth > 5 || !value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if ('confidence' in (value as Record<string, unknown>)) {
    const confidence = (value as Record<string, unknown>).confidence;
    if (typeof confidence === 'number') return true;
    if (confidence && typeof confidence === 'object') return true;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (hasConfidenceSignal(child, depth + 1, seen)) return true;
  }
  return false;
}

function requiresConfidenceSignal(manifest: ConstructionManifest): boolean {
  const properties = manifest.outputSchema?.properties;
  if (!properties || typeof properties !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(properties, 'confidence');
}

function isTimeoutRegression(result: SmokeResult): boolean {
  return (
    result.timedOut ||
    (result.error !== undefined && result.error.includes('construction_timeout:'))
  );
}

async function runSmokeCase(manifest: ConstructionManifest): Promise<SmokeResult> {
  const startedAt = Date.now();
  try {
    const output = await withTimeout(
      invokeConstruction(
        manifest.id,
        buildGenericInput(manifest),
        { deps: { librarian: createLibrarianStub() } } as never,
      ),
      PER_CONSTRUCTION_TIMEOUT_MS,
      manifest.id,
    );
    const parseable = isParseableOutput(output);
    const confidencePresent = hasConfidenceSignal(output);
    const confidenceRequired = requiresConfidenceSignal(manifest);
    const status = parseable && (!confidenceRequired || confidencePresent) ? 'pass' : 'fail';
    return {
      id: manifest.id,
      status,
      durationMs: Date.now() - startedAt,
      parseable,
      confidencePresent,
      timedOut: false,
    };
  } catch (error) {
    const message = toSingleLineError(error);
    return {
      id: manifest.id,
      status: 'fail',
      durationMs: Date.now() - startedAt,
      parseable: false,
      confidencePresent: false,
      timedOut: message.includes('construction_timeout:'),
      error: message,
    };
  }
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

describe('Construction Smoke Gate', () => {
  it('uses explicit timeout signals instead of raw duration for timeout regressions', () => {
    const longButSuccessful: SmokeResult = {
      id: 'long-but-valid',
      status: 'pass',
      durationMs: PER_CONSTRUCTION_TIMEOUT_MS + 30_000,
      parseable: true,
      confidencePresent: true,
      timedOut: false,
    };
    const explicitTimeout: SmokeResult = {
      id: 'timed-out',
      status: 'fail',
      durationMs: PER_CONSTRUCTION_TIMEOUT_MS + 10,
      parseable: false,
      confidencePresent: false,
      timedOut: true,
      error: `construction_timeout:timed-out:${PER_CONSTRUCTION_TIMEOUT_MS}ms`,
    };

    expect(isTimeoutRegression(longButSuccessful)).toBe(false);
    expect(isTimeoutRegression(explicitTimeout)).toBe(true);
  });

  it('runs every registered construction with timeout guard and reports pass/fail coverage', async () => {
    const startedAt = Date.now();
    const manifests = listConstructions();
    const executableManifests = listConstructions({ availableOnly: true });
    const unavailableCatalogManifests = manifests.filter((manifest) => manifest.available === false);
    expect(manifests.length).toBeGreaterThan(0);
    expect(executableManifests.length).toBeGreaterThan(0);

    const results = await runWithConcurrency(executableManifests, MAX_PARALLEL, runSmokeCase);
    const passed = results.filter((result) => result.status === 'pass');
    const failed = results.filter((result) => result.status === 'fail');
    const timedOut = results.filter(isTimeoutRegression);

    const report = {
      executable: {
        total: executableManifests.length,
        passed: passed.length,
        failed: failed.length,
      },
      catalogCompleteness: {
        implemented: executableManifests.length,
        total: manifests.length,
        unavailable: unavailableCatalogManifests.length,
      },
      passed: passed.map((result) => result.id),
      failed: failed.map((result) => ({
        id: result.id,
        error: result.error ?? 'validation_failed',
        parseable: result.parseable,
        confidencePresent: result.confidencePresent,
        timedOut: result.timedOut,
      })),
    };
    console.info('[Construction Smoke Gate] report', JSON.stringify(report));

    expect(results).toHaveLength(executableManifests.length);
    expect(failed).toHaveLength(0);
    expect(executableManifests.length + unavailableCatalogManifests.length).toBe(manifests.length);
    expect(timedOut).toHaveLength(0);
    expect(Date.now() - startedAt).toBeLessThan(TOTAL_BUDGET_MS);
  }, TOTAL_BUDGET_MS + 15_000);
});
