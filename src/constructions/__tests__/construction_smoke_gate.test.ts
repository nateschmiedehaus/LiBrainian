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
const DOGFOOD_RUN_DIR = path.resolve(__dirname, '../../../state/dogfood/dev-loop');
const SPECIAL_FIXTURE_SMOKE_EXCLUSIONS = new Set<string>([
  // Requires a dedicated git-history fixture; covered by diff_semantic_summarizer.test.ts.
  'librainian:diff-semantic-summarizer',
]);

type SmokeResult = {
  id: string;
  status: 'pass' | 'fail';
  durationMs: number;
  parseable: boolean;
  confidencePresent: boolean;
  timedOut: boolean;
  truthfulnessProblems: string[];
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

  if (
    Object.prototype.hasOwnProperty.call(manifest.outputSchema.properties ?? {}, 'executed')
    || Object.prototype.hasOwnProperty.call(properties, 'command')
  ) {
    input.dryRun = false;
    input.command = process.execPath;
    input.args = ['-e', 'process.stdout.write("PATROL_OBS: {\\"type\\":\\"smoke\\",\\"ok\\":true}\\n")'];
  }

  if (manifest.id === 'librainian:architecture-verifier') {
    input.layers = [
      {
        name: 'index',
        patterns: ['src/index.js'],
        allowedDependencies: ['auth', 'user', 'config', 'db'],
      },
      {
        name: 'auth',
        patterns: ['src/auth/**'],
        allowedDependencies: ['user', 'config', 'utils'],
      },
      {
        name: 'user',
        patterns: ['src/user/**'],
        allowedDependencies: ['db', 'utils'],
      },
      {
        name: 'db',
        patterns: ['src/db/**'],
        allowedDependencies: ['config'],
      },
      {
        name: 'config',
        patterns: ['src/config/**', 'src/utils/**'],
        allowedDependencies: [],
      },
    ];
    input.boundaries = [
      {
        name: 'auth-user',
        description: 'auth should depend on user only through exported service helpers',
        inside: ['src/auth'],
        outside: ['src/user'],
      },
      {
        name: 'user-db',
        description: 'user should reach persistence through db client helpers',
        inside: ['src/user'],
        outside: ['src/db'],
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
    input.description = 'User fetch route crashes during request handling';
    input.errorMessage = "TypeError: Cannot read properties of undefined (reading 'created_at')";
    input.stackTrace =
      "TypeError: Cannot read properties of undefined (reading 'created_at')\n" +
      '    at getUserById (src/user/user_service.js:65:30)\n' +
      '    at app.get (src/index.js:42:18)';
  }

  if (manifest.id === 'librainian:comprehensive-quality-construction') {
    input.files = ['src/user/user_service.js', 'src/auth/authenticate.js'];
    input.architectureSpec = {
      layers: [
        { name: 'index', patterns: ['src/index.js'], allowedDependencies: ['auth', 'user', 'config', 'db'] },
        { name: 'auth', patterns: ['src/auth/**'], allowedDependencies: ['user', 'config', 'utils'] },
        { name: 'user', patterns: ['src/user/**'], allowedDependencies: ['db', 'utils'] },
        { name: 'db', patterns: ['src/db/**'], allowedDependencies: ['config'] },
        { name: 'config', patterns: ['src/config/**', 'src/utils/**'], allowedDependencies: [] },
      ],
      boundaries: [
        {
          name: 'auth-user',
          description: 'auth should depend on user only through exported service helpers',
          inside: ['src/auth'],
          outside: ['src/user'],
        },
        {
          name: 'user-db',
          description: 'user should reach persistence through db client helpers',
          inside: ['src/user'],
          outside: ['src/db'],
        },
      ],
      rules: [
        {
          id: 'no-circular',
          description: 'prevent circular imports',
          type: 'no-circular',
          severity: 'error',
        },
      ],
    };
    input.securityScope = {
      files: ['src/auth/authenticate.js', 'src/user/user_service.js'],
      checkTypes: ['injection'],
      workspace: FIXTURE_REPO,
    };
  }

  if (manifest.id === 'librainian:refactoring-safety-checker') {
    input.entityId = 'getUserById';
    input.refactoringType = 'rename-function';
  }

  if (manifest.id === 'librainian:diff-semantic-summarizer') {
    input.diff = [
      'diff --git a/src/user/user_service.js b/src/user/user_service.js',
      '--- a/src/user/user_service.js',
      '+++ b/src/user/user_service.js',
      '@@ -55,7 +55,7 @@',
      '-async function getUserById(id) {',
      '+async function getUserById(userId) {',
      '-  const result = await query(\'SELECT * FROM users WHERE id = $1\', [id]);',
      '+  const result = await query(\'SELECT * FROM users WHERE id = $1\', [userId]);',
    ].join('\n');
  }

  if (manifest.id === 'librainian:dogfood-autolearner') {
    input.runDir = DOGFOOD_RUN_DIR;
  }

  return input;
}

function createLibrarianStub(): Record<string, unknown> {
  const base: Record<string, unknown> = {
    workspaceRoot: FIXTURE_REPO,
    rootDir: FIXTURE_REPO,
  };
  const mockPack = {
    relatedFiles: ['src/user/user_service.js', 'src/auth/authenticate.js', 'src/index.js'],
    codeSnippets: [
      {
        content:
          "async function getUserById(id) {\n" +
          "  const result = await query('SELECT * FROM users WHERE id = $1', [id]);\n" +
          '  if (result.rows.length === 0) {\n' +
          '    return null;\n' +
          '  }\n' +
          '  return result.rows[0];\n' +
          '}',
        startLine: 1,
        endLine: 6,
      },
      {
        content:
          "app.get('/users/:id', async (req, res) => {\n" +
          '  const user = await getUserById(req.params.id);\n' +
          '  res.json(user);\n' +
          '});',
        startLine: 36,
        endLine: 39,
      },
    ],
  };

  return new Proxy(base, {
    get(target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'getStorage') {
        return undefined;
      }
      if (prop === 'query' || prop === 'queryOptional' || prop === 'queryRequired') {
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

function getSmokePayload(output: unknown): Record<string, unknown> | null {
  if (!output || typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  if (record.ok === true && record.value && typeof record.value === 'object') {
    return record.value as Record<string, unknown>;
  }
  if (record.result && typeof record.result === 'object') {
    return record.result as Record<string, unknown>;
  }
  return record;
}

function readNumericField(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readObjectField(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!record) return null;
  const value = record[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStringArrayField(record: Record<string, unknown> | null, key: string): string[] {
  if (!record) return [];
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeSmokeFailure(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const record = output as Record<string, unknown>;
  if (record.ok !== false) return undefined;
  const error = record.error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return 'construction returned ok:false';
}

function collectTruthfulnessProblems(manifest: ConstructionManifest, output: unknown): string[] {
  const failure = normalizeSmokeFailure(output);
  if (failure) {
    return [failure];
  }

  const payload = getSmokePayload(output);
  if (!payload) return ['output payload missing'];
  const problems: string[] = [];

  if (payload.executed === false) {
    problems.push('reported executed=false');
  }

  if (manifest.id === 'librainian:comprehensive-quality-construction') {
    const architecture = readObjectField(payload, 'architecture');
    const security = readObjectField(payload, 'security');
    const filesChecked = readNumericField(architecture, 'filesChecked');
    const filesAudited = readNumericField(security, 'filesAudited');
    const overallScore = readNumericField(payload, 'overallScore');
    if (filesChecked !== null && filesChecked <= 0) {
      problems.push('architecture checked 0 files');
    }
    if (filesAudited !== null && filesAudited <= 0) {
      problems.push('security audited 0 files');
    }
    if ((overallScore ?? 0) >= 85 && (filesChecked ?? 0) <= 0 && (filesAudited ?? 0) <= 0) {
      problems.push('high overall score without architecture/security evidence');
    }
  }

  if (manifest.id === 'librainian:refactoring-safety-checker') {
    const usageCount = readNumericField(payload, 'usageCount');
    const riskScore = readNumericField(payload, 'riskScore');
    const safe = payload.safe;
    const risks = readStringArrayField(payload, 'risks');
    if (
      safe === true
      && usageCount === 0
      && riskScore === 0
      && risks.some((risk) => risk.includes('Low analysis confidence') || risk.includes('caller traversal failed'))
    ) {
      problems.push('safe=true despite zero usages and degraded caller coverage');
    }
  }

  return problems;
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
    const truthfulnessProblems = collectTruthfulnessProblems(manifest, output);
    const confidenceRequired = requiresConfidenceSignal(manifest);
    const status =
      parseable
      && (!confidenceRequired || confidencePresent)
      && truthfulnessProblems.length === 0
        ? 'pass'
        : 'fail';
    return {
      id: manifest.id,
      status,
      durationMs: Date.now() - startedAt,
      parseable,
      confidencePresent,
      timedOut: false,
      truthfulnessProblems,
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
      truthfulnessProblems: [],
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
    const specialFixtureExcluded = listConstructions({ availableOnly: true })
      .filter((manifest) => SPECIAL_FIXTURE_SMOKE_EXCLUSIONS.has(manifest.id));
    const executableManifests = listConstructions({ availableOnly: true })
      .filter((manifest) => !SPECIAL_FIXTURE_SMOKE_EXCLUSIONS.has(manifest.id));
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
        specialFixtureExcluded: specialFixtureExcluded.length,
      },
      specialFixtureExcluded: specialFixtureExcluded.map((manifest) => manifest.id),
      passed: passed.map((result) => result.id),
      failed: failed.map((result) => ({
        id: result.id,
        error: result.error ?? 'validation_failed',
        parseable: result.parseable,
        confidencePresent: result.confidencePresent,
        timedOut: result.timedOut,
        truthfulnessProblems: result.truthfulnessProblems,
      })),
    };
    console.info('[Construction Smoke Gate] report', JSON.stringify(report));

    expect(results).toHaveLength(executableManifests.length);
    expect(failed).toHaveLength(0);
    expect(executableManifests.length + unavailableCatalogManifests.length + specialFixtureExcluded.length).toBe(manifests.length);
    expect(timedOut).toHaveLength(0);
    expect(Date.now() - startedAt).toBeLessThan(TOTAL_BUDGET_MS);
  }, TOTAL_BUDGET_MS + 15_000);
});
