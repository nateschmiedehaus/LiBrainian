import { parseArgs } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { attemptStorageRecovery, isRecoverableStorageError } from '../../storage/storage_recovery.js';
import { queryLibrarian } from '../../api/query.js';
import { bootstrapProject, createBootstrapConfig, isBootstrapRequired } from '../../api/bootstrap.js';
import { detectLibrarianVersion } from '../../api/versioning.js';
import { resolveLibrarianModelConfigWithDiscovery, resolveLibrarianModelId } from '../../api/llm_env.js';
import { checkAllProviders } from '../../api/provider_check.js';
import {
  computeEmbeddingCoverage,
  hasSufficientSemanticCoverage,
  SEMANTIC_EMBEDDING_COVERAGE_MIN_PCT,
} from '../../api/embedding_coverage.js';
import type { LibrarianQuery, LibrarianResponse, StageReport, TokenBudget } from '../../types.js';
import { createError, suggestSimilarQueries } from '../errors.js';
import { createSpinner, formatDuration, printKeyValue } from '../progress.js';
import { safeJsonParse } from '../../utils/safe_json.js';
import {
  parseStructuralQueryIntent,
  executeExhaustiveDependencyQuery,
  shouldUseExhaustiveMode,
} from '../../api/dependency_query.js';
import {
  detectEnumerationIntent,
  shouldUseEnumerationMode,
  enumerateByCategory,
  formatEnumerationResult,
} from '../../constructions/enumeration.js';
import { emitJsonOutput } from '../json_output.js';
import { ContextAssemblySessionManager, type ContextSession } from '../../api/context_sessions.js';
import { parseTraceMarkerMessage, sanitizeTraceMarkerMessage } from '../user_messages.js';

export interface QueryCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type QueryStrategyFlag = 'auto' | 'semantic' | 'heuristic';
type RetrievalStrategy = 'hybrid' | 'semantic' | 'heuristic' | 'degraded';
type QuerySessionMode = 'start' | 'follow_up' | 'drill_down';
type QueryBootstrapDeferReason = 'watch_catchup' | 'stale_git_head';
const LEGACY_DB_FILENAME = 'librarian.db';
const DEFAULT_QUERY_TIMEOUT_MS = 120_000;
const DEFAULT_STORAGE_LOCK_TIMEOUT_MS = 5_000;
const STORAGE_LOCK_RETRY_INTERVAL_MS = 200;
const DEFAULT_QUERY_PREFLIGHT_MAX_RECOVERY_ACTIONS = 12;
const BOOTSTRAP_LOCK_UNKNOWN_STALE_TIMEOUT_MS = 2 * 60 * 60_000;
const QUERY_READ_STORAGE_OPTIONS = { useProcessLock: false } as const;

export async function queryCommand(options: QueryCommandOptions): Promise<void> {
  const { workspace, rawArgs, args } = options;
  const commandArgs = resolveQueryCommandArgs(rawArgs, args);

  // Parse command-specific options
  const { values, positionals } = parseArgs({
    args: commandArgs,
    options: {
      depth: { type: 'string', default: 'L1' },
      format: { type: 'string' },
      files: { type: 'string' },
      scope: { type: 'string' },
      diversify: { type: 'boolean', default: false },
      'diversity-lambda': { type: 'string' },
      timeout: { type: 'string', default: '0' },
      'lock-timeout-ms': { type: 'string', default: String(DEFAULT_STORAGE_LOCK_TIMEOUT_MS) },
      json: { type: 'boolean', default: false },
      'no-synthesis': { type: 'boolean', default: false },
      deterministic: { type: 'boolean', default: false },
      'llm-provider': { type: 'string' },
      'llm-model': { type: 'string' },
      uc: { type: 'string' },
      'uc-priority': { type: 'string' },
      'uc-evidence': { type: 'string' },
      'uc-freshness-days': { type: 'string' },
      'token-budget': { type: 'string' },
      'token-reserve': { type: 'string' },
      'token-priority': { type: 'string' },
      'no-bootstrap': { type: 'boolean', default: false },
      // Exhaustive mode flags
      exhaustive: { type: 'boolean', default: false },
      transitive: { type: 'boolean', default: false },
      'max-depth': { type: 'string', default: '10' },
      // Enumeration mode flag
      enumerate: { type: 'boolean', default: false },
      strategy: { type: 'string', default: 'auto' },
      limit: { type: 'string' },
      out: { type: 'string' },
      session: { type: 'string' },
      'drill-down': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const sessionFlagRaw = typeof values.session === 'string' ? values.session.trim() : '';
  const sessionRequested = sessionFlagRaw.length > 0;
  const drillDownTarget = typeof values['drill-down'] === 'string'
    ? values['drill-down'].trim()
    : '';
  if (drillDownTarget && !sessionRequested) {
    throw createError('INVALID_ARGUMENT', '--drill-down requires --session <id>.');
  }

  const intent = positionals.join(' ').trim();
  const queryIntentRequired = !(sessionRequested && drillDownTarget);
  if (!intent && queryIntentRequired) {
    throw createError('INVALID_ARGUMENT', 'Query intent is required. Usage: librarian query "<intent>"');
  }

  const depth = validateDepth(values.depth as string);
  const scope = typeof values.scope === 'string' ? values.scope.trim() : undefined;
  const diversify = values.diversify as boolean;
  const diversityLambdaRaw = typeof values['diversity-lambda'] === 'string'
    ? values['diversity-lambda'].trim()
    : '';
  const diversityLambda = diversityLambdaRaw.length > 0 ? Number.parseFloat(diversityLambdaRaw) : undefined;
  if (diversityLambdaRaw.length > 0 && (!Number.isFinite(diversityLambda) || diversityLambda! < 0 || diversityLambda! > 1)) {
    throw createError('INVALID_ARGUMENT', `Invalid --diversity-lambda "${diversityLambdaRaw}" (must be a number in [0,1]).`);
  }
  const affectedFiles = values.files
    ? (values.files as string).split(',').map((entry) => {
      const raw = entry.trim();
      return raw ? (path.isAbsolute(raw) ? raw : path.resolve(workspace, raw)) : '';
    }).filter(Boolean)
    : undefined;
  const timeoutMs = parseNonNegativeInt(
    typeof values.timeout === 'string' ? values.timeout : String(DEFAULT_QUERY_TIMEOUT_MS),
    'timeout'
  );
  const effectiveQueryTimeoutMs = timeoutMs > 0 ? timeoutMs : DEFAULT_QUERY_TIMEOUT_MS;
  const lockTimeoutMs = parseNonNegativeInt(
    typeof values['lock-timeout-ms'] === 'string'
      ? values['lock-timeout-ms']
      : String(DEFAULT_STORAGE_LOCK_TIMEOUT_MS),
    'lock-timeout-ms'
  );
  const formatRaw = typeof values.format === 'string' ? values.format.trim().toLowerCase() : '';
  if (formatRaw && formatRaw !== 'json' && formatRaw !== 'text') {
    throw createError('INVALID_ARGUMENT', `Invalid --format "${values.format as string}" (use text|json).`);
  }
  const jsonFlag = values.json as boolean;
  if (jsonFlag && formatRaw === 'text') {
    throw createError('INVALID_ARGUMENT', '--json cannot be combined with --format text.');
  }
  const outputJson = jsonFlag || formatRaw === 'json';
  const outputPath = typeof values.out === 'string' && values.out.trim().length > 0
    ? values.out.trim()
    : undefined;
  if (outputPath && !outputJson) {
    throw createError('INVALID_ARGUMENT', '--out requires --json output mode.');
  }
  if (outputJson) {
    // Keep stdout machine-readable when JSON output is requested.
    // Progress indicators render to stderr, but disable them entirely for JSON mode.
    process.env.LIBRARIAN_NO_PROGRESS = '1';
    process.env.LIBRAINIAN_NO_PROGRESS = '1';
  }
  const noSynthesis = values['no-synthesis'] as boolean;
  const deterministic = values.deterministic as boolean;
  const strategyRaw = String(values.strategy ?? 'auto').toLowerCase().trim();
  const strategy: QueryStrategyFlag = strategyRaw === 'semantic' || strategyRaw === 'heuristic'
    ? strategyRaw
    : 'auto';
  if (strategyRaw !== 'auto' && strategyRaw !== 'semantic' && strategyRaw !== 'heuristic') {
    throw createError('INVALID_ARGUMENT', `Invalid --strategy "${strategyRaw}" (use auto|semantic|heuristic).`);
  }
  const limitRaw = typeof values.limit === 'string' ? values.limit.trim() : '';
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  if (limitRaw && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
    throw createError('INVALID_ARGUMENT', `Invalid --limit value "${limitRaw}" (must be a positive integer).`);
  }
  const requestedLlmProviderRaw = typeof values['llm-provider'] === 'string' ? values['llm-provider'].trim() : '';
  const requestedLlmProvider = (requestedLlmProviderRaw === 'claude' || requestedLlmProviderRaw === 'codex') ? requestedLlmProviderRaw : undefined;
  const requestedLlmModel = typeof values['llm-model'] === 'string' ? values['llm-model'].trim() : undefined;
  const ucRaw = typeof values.uc === 'string' ? values.uc : '';
  const ucIds = ucRaw ? ucRaw.split(',').map((id) => id.trim()).filter(Boolean) : undefined;
  const ucPriority = typeof values['uc-priority'] === 'string' ? values['uc-priority'] : undefined;
  const ucEvidence = typeof values['uc-evidence'] === 'string' ? Number.parseFloat(values['uc-evidence']) : undefined;
  const ucFreshnessDays = typeof values['uc-freshness-days'] === 'string'
    ? Number.parseInt(values['uc-freshness-days'], 10)
    : undefined;
  const noBootstrap = values['no-bootstrap'] as boolean;

  // Token budget configuration
  const tokenBudgetRaw = typeof values['token-budget'] === 'string' ? values['token-budget'] : '';
  const tokenBudgetMax = tokenBudgetRaw ? Number.parseInt(tokenBudgetRaw, 10) : undefined;
  const tokenReserveRaw = typeof values['token-reserve'] === 'string' ? values['token-reserve'] : '';
  const tokenReserve = tokenReserveRaw ? Number.parseInt(tokenReserveRaw, 10) : undefined;
  const tokenPriorityRaw = typeof values['token-priority'] === 'string' ? values['token-priority'] : '';
  const tokenPriority = (tokenPriorityRaw === 'relevance' || tokenPriorityRaw === 'recency' || tokenPriorityRaw === 'diversity')
    ? tokenPriorityRaw
    : undefined;

  // Build token budget if specified
  let tokenBudget: TokenBudget | undefined;
  if (tokenBudgetMax && Number.isFinite(tokenBudgetMax) && tokenBudgetMax > 0) {
    tokenBudget = {
      maxTokens: tokenBudgetMax,
      reserveTokens: Number.isFinite(tokenReserve ?? NaN) ? tokenReserve : undefined,
      priority: tokenPriority,
    };
  }

  // Exhaustive mode options
  const explicitExhaustive = values.exhaustive as boolean;
  const includeTransitive = values.transitive as boolean;
  const maxDepthRaw = typeof values['max-depth'] === 'string' ? values['max-depth'] : '10';
  const maxDepth = parseInt(maxDepthRaw, 10);

  // Enumeration mode option
  const explicitEnumerate = values.enumerate as boolean;
  if (sessionRequested && (explicitEnumerate || explicitExhaustive)) {
    throw createError('INVALID_ARGUMENT', '--session mode cannot be combined with --enumerate or --exhaustive.');
  }

  // Initialize storage
  const dbPath = await resolveDbPath(workspace);
  await runQueryStorageLockPreflight(workspace, dbPath, {
    timeoutMs: lockTimeoutMs,
    retryIntervalMs: STORAGE_LOCK_RETRY_INTERVAL_MS,
    maxRecoveryActions: DEFAULT_QUERY_PREFLIGHT_MAX_RECOVERY_ACTIONS,
    allowConcurrentReads: true,
  });
  let storage = createQueryStorage(dbPath, workspace);
  storage = await withQueryCommandTimeout(
    'initialize',
    effectiveQueryTimeoutMs,
    () => initializeQueryStorageWithRecovery(storage, dbPath, workspace)
  );
  const executeQueryWithRecovery = async (queryPayload: LibrarianQuery): Promise<LibrarianResponse> => {
    try {
      return await withQueryCommandTimeout(
        'execution',
        effectiveQueryTimeoutMs,
        () => queryLibrarian(queryPayload, storage)
      );
    } catch (error) {
      const recoveredStorage = await recoverQueryStorageAfterFailure({
        workspace,
        dbPath,
        storage,
        error,
        phase: 'execution',
      });
      if (!recoveredStorage) throw error;
      storage = recoveredStorage;
      return await withQueryCommandTimeout(
        'execution',
        effectiveQueryTimeoutMs,
        () => queryLibrarian(queryPayload, storage)
      );
    }
  };
  try {
    // Check if bootstrapped - detect current tier and use that as target
    // This allows operation on existing data without requiring upgrade
    const currentVersion = await detectLibrarianVersion(storage);
    const effectiveTier = currentVersion?.qualityTier ?? 'full';
    const bootstrapCheck = await isBootstrapRequired(workspace, storage, { targetQualityTier: effectiveTier });
    if (bootstrapCheck.required) {
      const deferredReason = classifyQueryBootstrapDeferReason(bootstrapCheck.reason);
      if (noBootstrap) {
        throw createError(
          'NOT_BOOTSTRAPPED',
          buildQueryBootstrapRemediation(bootstrapCheck.reason, deferredReason)
        );
      }
      if (deferredReason) {
        const remediation = buildQueryBootstrapRemediation(bootstrapCheck.reason, deferredReason);
        if (typeof process.stderr?.write === 'function') {
          process.stderr.write(`[query] deferred bootstrap reason: ${deferredReason} — falling through to auto-bootstrap\n`);
        }
      }
      const bootstrapSpinner = createSpinner('Bootstrap required; initializing (fast mode)...');
      try {
        let skipEmbeddings = false;
        const providerCheckSkipped =
          (process.env.LIBRAINIAN_SKIP_PROVIDER_CHECK ?? process.env.LIBRARIAN_SKIP_PROVIDER_CHECK) === '1';
        if (providerCheckSkipped) {
          skipEmbeddings = true;
        } else {
          try {
            const providerStatus = await checkAllProviders({ workspaceRoot: workspace });
            skipEmbeddings = !providerStatus.embedding.available;
          } catch {
            skipEmbeddings = true;
          }
        }
        const config = createBootstrapConfig(workspace, {
          bootstrapMode: 'fast',
          skipLlm: true,
          skipEmbeddings,
          timeoutMs: effectiveQueryTimeoutMs,
        });
        storage = await executeQueryBootstrapWithRecovery({
          workspace,
          dbPath,
          storage,
          config,
          timeoutMs: effectiveQueryTimeoutMs,
        });
        bootstrapSpinner.succeed('Bootstrap complete');
      } catch (error) {
        bootstrapSpinner.fail('Bootstrap failed');
        throw error;
      }
    }

    // Check if this is an enumeration query (explicit flag or auto-detected)
    const enumerationIntent = sessionRequested
      ? { isEnumeration: false, confidence: 0, category: undefined }
      : detectEnumerationIntent(intent);
    const useEnumeration = explicitEnumerate || (enumerationIntent.isEnumeration && enumerationIntent.confidence >= 0.7);

    if (useEnumeration && enumerationIntent.category) {
      // Run enumeration query - returns COMPLETE lists instead of top-k
      const enumSpinner = createSpinner(`Enumerating ${enumerationIntent.category}: "${intent.substring(0, 50)}${intent.length > 50 ? '...' : ''}"`);

      try {
        const startTime = Date.now();
        const result = await enumerateByCategory(storage, enumerationIntent.category, workspace);
        const elapsed = Date.now() - startTime;

        enumSpinner.succeed(`Enumeration completed in ${formatDuration(elapsed)}`);

        if (outputJson) {
          await emitJsonOutput({
            mode: 'enumeration',
            intent: enumerationIntent,
            category: result.category,
            totalCount: result.totalCount,
            truncated: result.truncated,
            explanation: result.explanation,
            entities: result.entities.map(e => ({
              id: e.id,
              name: e.name,
              filePath: e.filePath,
              description: e.description,
              line: e.line,
              metadata: e.metadata,
            })),
            byDirectory: Object.fromEntries(
              Array.from(result.byDirectory.entries()).map(([dir, entities]) => [
                dir,
                entities.map(e => e.name),
              ])
            ),
            durationMs: elapsed,
          }, outputPath);
          return;
        }

        // Use the built-in formatter for text output
        console.log(formatEnumerationResult(result));
        console.log();
        return;
      } catch (error) {
        enumSpinner.fail('Enumeration query failed');
        throw error;
      }
    }

    // Check if this is an exhaustive query (explicit flag or auto-detected)
    const autoDetectExhaustive = sessionRequested ? false : shouldUseExhaustiveMode(intent);
    const useExhaustive = explicitExhaustive || autoDetectExhaustive;

    if (useExhaustive) {
      // Run exhaustive dependency query instead of semantic query
      const exhaustiveSpinner = createSpinner(`Running exhaustive dependency query: "${intent.substring(0, 50)}${intent.length > 50 ? '...' : ''}"`);

      const structuralIntent = parseStructuralQueryIntent(intent);

      if (!structuralIntent.isStructural || !structuralIntent.targetEntity) {
        exhaustiveSpinner.fail('Could not parse structural query intent');
        throw createError('INVALID_ARGUMENT',
          'Exhaustive mode requires a structural query like "what depends on X" or "what imports Y". ' +
          'Specify a target entity in your query or use the standard semantic search without --exhaustive.'
        );
      }

      try {
        const startTime = Date.now();
        const result = await executeExhaustiveDependencyQuery(storage, structuralIntent, {
          includeTransitive,
          maxDepth,
          onProgress: (count) => {
            if (count % 50 === 0) {
              exhaustiveSpinner.update(`Found ${count} dependents...`);
            }
          },
        });
        const elapsed = Date.now() - startTime;

        exhaustiveSpinner.succeed(`Exhaustive query completed in ${formatDuration(elapsed)}`);

        if (outputJson) {
          await emitJsonOutput({
            mode: 'exhaustive',
            intent: structuralIntent,
            targetResolution: result.targetResolution,
            totalCount: result.results.length,
            directCount: result.results.filter(r => r.depth === 1).length,
            transitiveCount: result.transitiveCount,
            explanation: result.explanation,
            files: result.results.map(r => ({
              path: r.sourceFile || r.entityId,
              type: r.entityType,
              edgeType: r.edgeType,
              depth: r.depth,
              line: r.sourceLine,
              })),
            durationMs: elapsed,
          }, outputPath);
          return;
        }

        console.log('\n=== Exhaustive Dependency Query Results ===\n');
        console.log(result.explanation);
        console.log();

        printKeyValue([
          { key: 'Target', value: result.targetResolution.resolvedPath ?? structuralIntent.targetEntity ?? 'unknown' },
          { key: 'Direction', value: structuralIntent.direction === 'dependents' ? 'What depends on this' : 'What this depends on' },
          { key: 'Edge Types', value: structuralIntent.edgeTypes.join(', ') },
          { key: 'Total Found', value: result.results.length },
          { key: 'Direct', value: result.results.filter(r => r.depth === 1).length },
          { key: 'Transitive', value: result.transitiveCount },
          { key: 'Duration', value: `${elapsed}ms` },
        ]);
        console.log();

        if (result.results.length > 0) {
          // Group by directory for better readability
          const byDir = new Map<string, typeof result.results>();
          for (const dep of result.results) {
            const filePath = dep.sourceFile || dep.entityId;
            const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '.';
            if (!byDir.has(dir)) {
              byDir.set(dir, []);
            }
            byDir.get(dir)!.push(dep);
          }

          // Sort directories by count (descending)
          const sortedDirs = Array.from(byDir.entries())
            .sort((a, b) => b[1].length - a[1].length);

          console.log('Files by Directory:');
          console.log('-'.repeat(60));

          for (const [dir, deps] of sortedDirs.slice(0, 30)) {
            console.log(`\n  ${dir}/ (${deps.length} files)`);
            for (const dep of deps.slice(0, 10)) {
              const fileName = (dep.sourceFile || dep.entityId).split('/').pop();
              const depthNote = (dep.depth ?? 1) > 1 ? ` [depth=${dep.depth}]` : '';
              const lineNote = dep.sourceLine ? `:${dep.sourceLine}` : '';
              console.log(`    - ${fileName}${lineNote}${depthNote}`);
            }
            if (deps.length > 10) {
              console.log(`    ... and ${deps.length - 10} more`);
            }
          }

          if (sortedDirs.length > 30) {
            console.log(`\n  ... and ${sortedDirs.length - 30} more directories`);
          }

          console.log('\n' + '-'.repeat(60));
          console.log(`\nComplete file list (${result.results.length} total):`);

          // Print all files as a simple list
          for (const dep of result.results) {
            const filePath = dep.sourceFile || dep.entityId;
            console.log(`  ${filePath}`);
          }
        }

        console.log();
        return;
      } catch (error) {
        exhaustiveSpinner.fail('Exhaustive query failed');
        throw error;
      }
    }

    if (strategy === 'semantic') {
      const stats = await storage.getStats();
      const embeddingCoverage = computeEmbeddingCoverage(stats.totalFunctions, stats.totalEmbeddings);
      if (!hasSufficientSemanticCoverage(embeddingCoverage, SEMANTIC_EMBEDDING_COVERAGE_MIN_PCT)) {
        throw createError(
          'INSUFFICIENT_EMBEDDING_COVERAGE',
          `Semantic strategy requires at least ${SEMANTIC_EMBEDDING_COVERAGE_MIN_PCT}% embedding coverage. `
          + `Current coverage is ${embeddingCoverage.coverage_pct.toFixed(1)}% `
          + `(${embeddingCoverage.embedded_functions}/${embeddingCoverage.total_functions}, `
          + `${embeddingCoverage.needs_embedding_count} remaining). Run \`librarian embed --fix\` and retry.`
        );
      }
    }

    const spinner = createSpinner(`Querying: "${intent.substring(0, 50)}${intent.length > 50 ? '...' : ''}"`);
    let resolvedProvider: 'claude' | 'codex' | undefined = requestedLlmProvider;
    let resolvedModel: string | undefined = requestedLlmModel;
    if (!resolvedProvider && resolvedModel) {
      if (resolvedModel.startsWith('claude-') || resolvedModel.startsWith('claude')) resolvedProvider = 'claude';
      else if (resolvedModel.startsWith('gpt-') || resolvedModel.startsWith('codex')) resolvedProvider = 'codex';
    }
    if (!resolvedProvider && !resolvedModel) {
      const rawDefaults = await storage.getState('librarian.llm_defaults.v1');
      const parsed = rawDefaults ? safeJsonParse<Record<string, unknown>>(rawDefaults) : null;
      const provider = parsed?.ok ? parsed.value.provider : null;
      const modelId = parsed?.ok ? parsed.value.modelId : null;
      if ((provider === 'claude' || provider === 'codex') && typeof modelId === 'string' && modelId.trim()) {
        resolvedProvider = provider;
        resolvedModel = modelId.trim();
      }
    }
    if (!resolvedProvider && !resolvedModel && !noSynthesis) {
      try {
        const discovered = await resolveLibrarianModelConfigWithDiscovery();
        if (discovered.provider && discovered.modelId) {
          resolvedProvider = discovered.provider;
          resolvedModel = discovered.modelId;
        }
      } catch {
        // No providers discovered - continue without LLM synthesis
      }
    }
    if (resolvedProvider && !resolvedModel) {
      resolvedModel =
        resolveLibrarianModelId(resolvedProvider)
        ?? (resolvedProvider === 'codex' ? 'gpt-5.1-codex-mini' : 'claude-haiku-4-5-20241022');
    }
    const hasLlmConfig = Boolean(resolvedProvider && resolvedModel);
    if (hasLlmConfig && resolvedProvider && resolvedModel) {
      process.env.LIBRARIAN_LLM_PROVIDER = resolvedProvider;
      process.env.LIBRARIAN_LLM_MODEL = resolvedModel;
    }
    let llmRequirement: LibrarianQuery['llmRequirement'] = noSynthesis ? 'disabled' : undefined;
    let embeddingRequirement: LibrarianQuery['embeddingRequirement'] | undefined;
    if (strategy === 'heuristic') {
      llmRequirement = 'disabled';
      embeddingRequirement = 'disabled';
    } else if (strategy === 'semantic') {
      embeddingRequirement = 'required';
    }
    if (!noSynthesis && !hasLlmConfig && strategy !== 'heuristic') {
      llmRequirement = 'disabled';
      const warning = 'LLM not configured; running without synthesis. Provide --llm-provider/--llm-model or bootstrap with providers to enable.';
      if (outputJson) {
        console.error(warning);
      } else {
        console.error(warning);
      }
    }
    const query: LibrarianQuery = {
      intent,
      depth,
      affectedFiles,
      scope: scope && scope.length > 0 ? scope : undefined,
      diversify,
      diversityLambda,
      ucRequirements: ucIds ? {
        ucIds,
        priority: (ucPriority === 'low' || ucPriority === 'medium' || ucPriority === 'high') ? ucPriority : undefined,
        evidenceThreshold: Number.isFinite(ucEvidence ?? NaN) ? ucEvidence : undefined,
        freshnessMaxDays: Number.isFinite(ucFreshnessDays ?? NaN) ? ucFreshnessDays : undefined,
      } : undefined,
      llmRequirement,
      embeddingRequirement,
      tokenBudget,
      timeoutMs: effectiveQueryTimeoutMs,
      deterministic,
    };

    if (sessionRequested) {
      const sessionManager = new ContextAssemblySessionManager({
        query: (sessionQuery) => executeQueryWithRecovery({
          ...sessionQuery,
          llmRequirement: sessionQuery.llmRequirement ?? llmRequirement,
          embeddingRequirement: sessionQuery.embeddingRequirement ?? embeddingRequirement,
          tokenBudget: sessionQuery.tokenBudget ?? tokenBudget,
          deterministic,
        }),
      });

      const requestedSessionId = sessionFlagRaw.toLowerCase() === 'new' ? null : sessionFlagRaw;
      if (requestedSessionId) {
        const persisted = await loadQuerySession(workspace, requestedSessionId);
        if (!persisted) {
          throw createError('INVALID_ARGUMENT', `Session "${requestedSessionId}" was not found. Start one with --session new.`);
        }
        sessionManager.restore(persisted);
      }

      const spinner = createSpinner(
        drillDownTarget
          ? `Drill-down in session ${requestedSessionId ?? 'new'}`
          : (requestedSessionId ? `Follow-up in session ${requestedSessionId}` : 'Starting new query session')
      );

      try {
        const startTime = Date.now();
        let mode: QuerySessionMode;
        let session: ContextSession;
        let answer: string;
        let newPacksCount: number;
        let suggestedFollowUps: string[] = [];
        let drillDownSuggestions: string[] = [];

        if (!requestedSessionId) {
          mode = 'start';
          session = await sessionManager.start(query);
          answer = session.context.qaHistory.at(-1)?.answer ?? 'No synthesis available.';
          newPacksCount = session.context.packs.length;
          drillDownSuggestions = session.context.packs
            .flatMap((pack) => pack.relatedFiles ?? [])
            .filter((file, index, all) => Boolean(file) && all.indexOf(file) === index)
            .slice(0, 5);
        } else if (drillDownTarget) {
          mode = 'drill_down';
          const drillDown = await sessionManager.drillDown(requestedSessionId, drillDownTarget);
          session = drillDown.session;
          answer = drillDown.answer;
          newPacksCount = drillDown.newPacks.length;
          suggestedFollowUps = drillDown.suggestedFollowUps;
        } else {
          mode = 'follow_up';
          const followUp = await sessionManager.followUp(requestedSessionId, intent);
          session = followUp.session;
          answer = followUp.answer;
          newPacksCount = followUp.newPacks.length;
          suggestedFollowUps = followUp.suggestedFollowUps;
          drillDownSuggestions = followUp.drillDownSuggestions;
        }

        await saveQuerySession(workspace, session);
        const elapsed = Date.now() - startTime;
        spinner.succeed(`Session query completed in ${formatDuration(elapsed)}`);

        const payload = {
          mode,
          sessionId: session.sessionId,
          answer,
          newPacksCount,
          totalPacks: session.context.packs.length,
          historyTurns: session.history.length,
          suggestedFollowUps,
          drillDownSuggestions,
          lastUpdatedAt: session.updatedAt,
        };
        if (outputJson) {
          await emitJsonOutput(payload, outputPath);
          return;
        }

        console.log('\nSession Query Results:');
        console.log('======================\n');
        printKeyValue([
          { key: 'Mode', value: mode },
          { key: 'Session ID', value: session.sessionId },
          { key: 'New Packs', value: newPacksCount },
          { key: 'Total Session Packs', value: session.context.packs.length },
          { key: 'Turns', value: session.history.length },
        ]);
        console.log();
        console.log('Answer:');
        console.log(`  ${answer}`);
        console.log();
        if (suggestedFollowUps.length > 0) {
          console.log('Suggested Follow-ups:');
          for (const item of suggestedFollowUps.slice(0, 8)) {
            console.log(`  - ${item}`);
          }
          console.log();
        }
        if (drillDownSuggestions.length > 0) {
          console.log('Drill-down Targets:');
          for (const item of drillDownSuggestions.slice(0, 8)) {
            console.log(`  - ${item}`);
          }
          console.log();
        }
        return;
      } catch (error) {
        spinner.fail('Session query failed');
        throw error;
      }
    }

    try {
      const startTime = Date.now();
      const rawResponse = await executeQueryWithRecovery(query);
      const { response, droppedCount } = applyPackLimit(rawResponse, limit);
      const strategyInfo = inferRetrievalStrategy(response);
      const displayResponse = sanitizeQueryResponseForOutput(response);
      const elapsed = Date.now() - startTime;

      spinner.succeed(`Query completed in ${formatDuration(elapsed)}`);

      if (outputJson) {
        const criticalWarnings = collectCriticalWarnings(response);
        const answer = deriveQueryAnswer(displayResponse);
        await emitJsonOutput({
          ...displayResponse,
          answer,
          strategy: strategyInfo.strategy,
          strategyReason: strategyInfo.reason,
          strategyWarning: strategyInfo.warning,
          criticalWarnings,
          resultLimit: limit
            ? {
                requested: limit,
                returned: displayResponse.packs.length,
                dropped: droppedCount,
              }
            : undefined,
        }, outputPath);
        return;
      }

      console.log('\nQuery Results:');
      console.log('==============\n');

      const criticalWarnings = collectCriticalWarnings(response);
      if (criticalWarnings.length > 0) {
        console.log('Critical Warnings:');
        for (const warning of criticalWarnings) {
          console.log(`  - ${warning}`);
        }
        console.log();
      }

      const keyValues = [
        { key: 'Intent', value: intent },
        { key: 'Depth', value: depth },
        { key: 'Affected Files', value: affectedFiles?.join(', ') || 'None specified' },
        { key: 'UC Requirements', value: ucIds?.join(', ') || 'None specified' },
        { key: 'Total Confidence', value: displayResponse.totalConfidence.toFixed(3) },
        { key: 'Cache Hit', value: displayResponse.cacheHit },
        { key: 'Latency', value: `${displayResponse.latencyMs}ms` },
        { key: 'Packs Found', value: displayResponse.packs.length },
        { key: 'Strategy', value: strategyInfo.reason ? `${strategyInfo.strategy} (${strategyInfo.reason})` : strategyInfo.strategy },
      ];
      if (deterministic) {
        keyValues.push({ key: 'Deterministic Mode', value: 'enabled (LLM synthesis skipped, stable sorting applied)' });
      }
      if (tokenBudget) {
        keyValues.push({ key: 'Token Budget', value: `${tokenBudget.maxTokens}${tokenBudget.reserveTokens ? ` (reserve: ${tokenBudget.reserveTokens})` : ''}` });
      }
      if (limit) {
        keyValues.push({ key: 'Result Limit', value: `${displayResponse.packs.length} returned${droppedCount > 0 ? ` (${droppedCount} dropped)` : ''}` });
      }
      printKeyValue(keyValues);
      console.log();
      if (strategyInfo.warning) {
        console.log(`Warning: ${strategyInfo.warning}`);
        console.log();
      }

      const answer = deriveQueryAnswer(displayResponse);
      if (answer) {
        console.log('Answer:');
        console.log(`  ${answer}`);
        console.log();
      }

      if (displayResponse.explanation) {
        console.log('Explanation:');
        console.log(`  ${displayResponse.explanation}`);
        console.log();
      }

      if (displayResponse.packs.length > 0) {
        console.log('Context Packs:');
        for (const pack of displayResponse.packs) {
          console.log(`\n  [${pack.packType}] ${pack.targetId}`);
          console.log(`  Confidence: ${pack.confidence.toFixed(3)}${pack.calibratedConfidence ? ` (calibrated: ${pack.calibratedConfidence.toFixed(3)})` : ''}`);
          console.log(`  Summary: ${pack.summary.substring(0, 100)}${pack.summary.length > 100 ? '...' : ''}`);
          if (pack.keyFacts.length > 0) {
            console.log('  Key Facts:');
            for (const fact of pack.keyFacts.slice(0, 3)) {
              console.log(`    - ${fact}`);
            }
          }
          if (pack.relatedFiles.length > 0) {
            console.log(`  Related Files: ${pack.relatedFiles.slice(0, 3).join(', ')}${pack.relatedFiles.length > 3 ? '...' : ''}`);
          }
        }
        console.log();
      } else {
        console.log('No context packs found for this query.\n');
        const suggestions = suggestSimilarQueries(intent, []);
        if (suggestions.length > 0) {
          console.log('Try these alternative queries:');
          for (const suggestion of suggestions) {
            console.log(`  - ${suggestion}`);
          }
          console.log();
        }
      }

      if (displayResponse.coverageGaps && displayResponse.coverageGaps.length > 0) {
        console.log('Coverage Gaps:');
        for (const gap of displayResponse.coverageGaps) {
          console.log(`  - ${gap}`);
        }
        console.log();
      }

      if (displayResponse.methodHints && displayResponse.methodHints.length > 0) {
        console.log('Method Hints:');
        for (const hint of displayResponse.methodHints) {
          console.log(`  - ${hint}`);
        }
        console.log();
      }

      if (displayResponse.drillDownHints.length > 0) {
        console.log('Drill-Down Hints:');
        for (const hint of displayResponse.drillDownHints) {
          console.log(`  - ${hint}`);
        }
        console.log();
      }

      if (displayResponse.calibration) {
        console.log('Calibration Info:');
        printKeyValue([
          { key: 'Buckets', value: displayResponse.calibration.bucketCount },
          { key: 'Samples', value: displayResponse.calibration.sampleCount },
          { key: 'Expected Error', value: displayResponse.calibration.expectedCalibrationError.toFixed(4) },
        ]);
        console.log();
      }

      if (displayResponse.uncertainty) {
        console.log('Uncertainty Metrics:');
        printKeyValue([
          { key: 'Confidence', value: displayResponse.uncertainty.confidence.toFixed(3) },
          { key: 'Entropy', value: displayResponse.uncertainty.entropy.toFixed(3) },
          { key: 'Variance', value: displayResponse.uncertainty.variance.toFixed(3) },
        ]);
        console.log();
      }

      if (displayResponse.tokenBudgetResult) {
        console.log('Token Budget:');
        const tbr = displayResponse.tokenBudgetResult;
        printKeyValue([
          { key: 'Truncated', value: tbr.truncated },
          { key: 'Tokens Used', value: tbr.tokensUsed },
          { key: 'Total Available', value: tbr.totalAvailable },
          { key: 'Strategy', value: tbr.truncationStrategy },
          { key: 'Original Packs', value: tbr.originalPackCount ?? 'N/A' },
          { key: 'Final Packs', value: tbr.finalPackCount ?? 'N/A' },
        ]);
        if (tbr.trimmedFields && tbr.trimmedFields.length > 0) {
          console.log(`  Trimmed Fields: ${tbr.trimmedFields.join(', ')}`);
        }
        console.log();
      }

    } catch (error) {
      spinner.fail('Query failed');
      throw error;
    }

  } finally {
    await storage.close();
  }
}

interface StorageLockHolder {
  pid: number;
  startedAt: string;
}

interface QueryStorageLockPreflightOptions {
  timeoutMs: number;
  retryIntervalMs: number;
  maxRecoveryActions: number;
  allowConcurrentReads?: boolean;
}

async function runQueryStorageLockPreflight(
  workspace: string,
  dbPath: string,
  options: QueryStorageLockPreflightOptions
): Promise<void> {
  const candidateDbPaths = getLockPreflightDbPaths(workspace, dbPath);
  const lockPaths = candidateDbPaths.map((candidateDbPath) => `${candidateDbPath}.lock`);
  const timeoutMs = Math.max(0, options.timeoutMs);
  const retryIntervalMs = Math.max(50, options.retryIntervalMs);
  const maxRecoveryActions = Math.max(1, options.maxRecoveryActions);
  const allowConcurrentReads = options.allowConcurrentReads === true;
  const deadline = Date.now() + timeoutMs;
  let nextRecoveryAt = 0;
  let recoveryActionCount = 0;
  let activeBootstrapLock: { lockPath: string; holder: StorageLockHolder } | null = null;

  while (true) {
    const now = Date.now();
    if (now >= nextRecoveryAt) {
      const bootstrapLockState = await reconcileBootstrapWorkspaceLock(workspace);
      activeBootstrapLock = bootstrapLockState.activeHolder
        ? { lockPath: bootstrapLockState.lockPath, holder: bootstrapLockState.activeHolder }
        : null;
      if (bootstrapLockState.removed) {
        console.error('[librarian] recovered stale bootstrap lock state: removed_lock');
      }

      for (const candidateDbPath of candidateDbPaths) {
        try {
          const recovery = await attemptStorageRecovery(candidateDbPath);
          if (recovery.recovered && recovery.actions.length > 0) {
            recoveryActionCount += recovery.actions.length;
            console.error(
              `[librarian] recovered stale lock state for ${path.basename(candidateDbPath)}: ${recovery.actions.join(', ')}`
            );
            if (recoveryActionCount > maxRecoveryActions) {
              throw createError(
                'STORAGE_LOCKED',
                `Storage recovery exceeded ${maxRecoveryActions} actions without stabilizing lock state. Run \`librarian doctor --heal\` and retry.`
              );
            }
          }
        } catch (error) {
          if ((error as { code?: string } | undefined)?.code === 'STORAGE_LOCKED') {
            throw error;
          }
          // Preflight is best-effort; initialize() still performs bounded lock handling.
        }
      }
      nextRecoveryAt = now + 1_000;
    }

    const activeStorageLock = await findActiveStorageLock(lockPaths);
    const activeBootstrapBlockingLock =
      activeBootstrapLock && activeBootstrapLock.holder.pid !== process.pid
        ? activeBootstrapLock
        : null;
    const activeStorageBlockingLock =
      activeStorageLock && activeStorageLock.holder.pid !== process.pid
        ? activeStorageLock
        : null;

    if (!activeBootstrapBlockingLock) {
      if (!activeStorageBlockingLock || allowConcurrentReads) {
        return;
      }
    }

    const activeBlockingLock = activeBootstrapBlockingLock ?? activeStorageBlockingLock;
    if (!activeBlockingLock) {
      return;
    }

    if (Date.now() >= deadline) {
      const nextTimeoutMs = Math.max(timeoutMs * 2, timeoutMs + 1000);
      throw createError(
        'STORAGE_LOCKED',
        `Storage lock active (pid=${activeBlockingLock.holder.pid}, startedAt=${activeBlockingLock.holder.startedAt}, lock=${activeBlockingLock.lockPath}). Waited ${timeoutMs}ms; run \`librarian doctor --heal\` or retry with \`--lock-timeout-ms ${nextTimeoutMs}\`.`
      );
    }

    await sleep(Math.min(retryIntervalMs, Math.max(1, deadline - Date.now())));
  }
}

function getLockPreflightDbPaths(workspace: string, resolvedDbPath: string): string[] {
  const paths = new Set<string>();
  const resolved = path.resolve(resolvedDbPath);
  paths.add(resolved);

  const legacyPath = path.resolve(path.join(workspace, '.librarian', LEGACY_DB_FILENAME));
  if (legacyPath !== resolved) {
    paths.add(legacyPath);
  }

  return Array.from(paths);
}

async function findActiveStorageLock(
  lockPaths: string[]
): Promise<{ lockPath: string; holder: StorageLockHolder } | null> {
  for (const lockPath of lockPaths) {
    const holder = await readStorageLockHolder(lockPath);
    if (!holder) continue;
    if (isPidAlive(holder.pid)) {
      return { lockPath, holder };
    }
  }
  return null;
}

async function readStorageLockHolder(lockPath: string): Promise<StorageLockHolder | null> {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    if (parsed.ok) {
      const pid = parsed.value.pid;
      const startedAt = parsed.value.startedAt;
      if (typeof pid === 'number' && Number.isFinite(pid)) {
        return {
          pid,
          startedAt: typeof startedAt === 'string' ? startedAt : 'unknown',
        };
      }
    }
    const legacyPid = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(legacyPid)) {
      return { pid: legacyPid, startedAt: 'unknown' };
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

interface BootstrapLockReconcileResult {
  lockPath: string;
  activeHolder: StorageLockHolder | null;
  removed: boolean;
}

async function reconcileBootstrapWorkspaceLock(workspace: string): Promise<BootstrapLockReconcileResult> {
  const lockPath = path.join(workspace, '.librarian', 'bootstrap.lock');
  const holder = await readStorageLockHolder(lockPath);
  if (holder) {
    if (holder.pid === process.pid || isPidAlive(holder.pid)) {
      return {
        lockPath,
        activeHolder: holder.pid === process.pid ? null : holder,
        removed: false,
      };
    }
    const removed = await removeLockFileIfExists(lockPath);
    return {
      lockPath,
      activeHolder: null,
      removed,
    };
  }

  const staleUnknown = await isUnknownLockStale(lockPath, BOOTSTRAP_LOCK_UNKNOWN_STALE_TIMEOUT_MS);
  if (staleUnknown) {
    const removed = await removeLockFileIfExists(lockPath);
    return {
      lockPath,
      activeHolder: null,
      removed,
    };
  }

  return {
    lockPath,
    activeHolder: null,
    removed: false,
  };
}

async function isUnknownLockStale(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const stats = await fs.stat(lockPath);
    return Date.now() - stats.mtimeMs > staleAfterMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return false;
    }
    return false;
  }
}

async function removeLockFileIfExists(lockPath: string): Promise<boolean> {
  try {
    await fs.unlink(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return false;
    }
    return false;
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'EPERM';
  }
}

function resolveQueryCommandArgs(rawArgs: string[], args: string[]): string[] {
  const commandIndex = rawArgs.findIndex((arg) => arg === 'query' || arg === 'context');
  if (commandIndex >= 0) {
    const sliced = rawArgs.slice(commandIndex + 1);
    if (sliced.length > 0) {
      return sliced;
    }
  }
  return args.length > 0 ? args : rawArgs.slice(1);
}

function classifyQueryBootstrapDeferReason(reason: string): QueryBootstrapDeferReason | null {
  const normalized = reason.toLowerCase();
  if (normalized.includes('watch state indicates catch-up') || normalized.includes('needs catch-up')) {
    return 'watch_catchup';
  }
  if (normalized.includes('index is stale relative to git head')) {
    return 'stale_git_head';
  }
  return null;
}

function buildQueryBootstrapRemediation(
  originalReason: string,
  deferredReason: QueryBootstrapDeferReason | null
): string {
  if (deferredReason === 'watch_catchup') {
    return 'Watch catch-up required before query. Run `librarian index --force --incremental` (or `librarian watch`) and retry.';
  }
  if (deferredReason === 'stale_git_head') {
    return 'Index cursor is stale relative to git HEAD. Run `librarian index --force --incremental` (or `librarian bootstrap --force` after history rewrites) and retry.';
  }
  return originalReason;
}

function validateDepth(depth: string): 'L0' | 'L1' | 'L2' | 'L3' {
  const normalized = depth.toUpperCase();
  if (normalized === 'L0' || normalized === 'L1' || normalized === 'L2' || normalized === 'L3') {
    return normalized;
  }
  throw createError('INVALID_ARGUMENT', `Invalid depth: ${depth}. Must be L0, L1, L2, or L3.`);
}

function sanitizeTraceId(traceId: string | undefined): string | undefined {
  if (!traceId) return traceId;
  const parsed = parseTraceMarkerMessage(traceId);
  return parsed.code || parsed.userMessage || traceId;
}

function sanitizeMessageList(values: string[] | undefined): string[] | undefined {
  if (!values) return values;
  const seen = new Set<string>();
  const sanitized: string[] = [];
  for (const value of values) {
    const normalized = sanitizeTraceMarkerMessage(value).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    sanitized.push(normalized);
  }
  return sanitized;
}

function sanitizeQueryResponseForOutput(response: LibrarianResponse): LibrarianResponse {
  return {
    ...response,
    disclosures: sanitizeMessageList(response.disclosures) ?? response.disclosures,
    traceId: sanitizeTraceId(response.traceId) ?? response.traceId,
    llmError: response.llmError ? sanitizeTraceMarkerMessage(response.llmError) : response.llmError,
    coverageGaps: sanitizeMessageList(response.coverageGaps),
    methodHints: sanitizeMessageList(response.methodHints),
    drillDownHints: sanitizeMessageList(response.drillDownHints) ?? [],
    packs: response.packs.map((pack) => ({
      ...pack,
      summary: sanitizeTraceMarkerMessage(pack.summary),
      keyFacts: sanitizeMessageList(pack.keyFacts) ?? [],
    })),
  };
}

function deriveQueryAnswer(response: LibrarianResponse): string | undefined {
  const synthesized = response.synthesis?.answer?.trim();
  if (synthesized) return synthesized;

  const summary = response.packs
    .map((pack) => pack.summary?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)
    .join(' ');
  if (summary) return summary;

  const explanation = response.explanation?.trim();
  if (explanation) return explanation;
  return undefined;
}

async function withQueryCommandTimeout<T>(
  operation: 'bootstrap' | 'execution' | 'initialize',
  timeoutMs: number,
  run: () => Promise<T>
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return run();
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const nextTimeoutMs = Math.max(Math.round(timeoutMs * 1.5), timeoutMs + 1000);
      const step = operation === 'bootstrap'
        ? 'Bootstrap during query'
        : operation === 'initialize'
          ? 'Storage initialization'
          : 'Query execution';
      reject(
        createError(
          'QUERY_TIMEOUT',
          `${step} timed out after ${timeoutMs}ms. Run \`librarian doctor --heal\` and retry with \`--timeout ${nextTimeoutMs}\` if needed.`
        )
      );
    }, timeoutMs);

    run()
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isGovernorWallTimeTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  return lower.includes('budget_exhausted') && (lower.includes('wall_time') || lower.includes('wall time'));
}

async function initializeQueryStorageWithRecovery(
  storage: ReturnType<typeof createSqliteStorage>,
  dbPath: string,
  workspace: string
): Promise<ReturnType<typeof createSqliteStorage>> {
  try {
    await storage.initialize();
    return storage;
  } catch (error) {
    const recoveredStorage = await recoverQueryStorageAfterFailure({
      workspace,
      dbPath,
      storage,
      error,
      phase: 'initialize',
    });
    if (!recoveredStorage) throw error;
    return recoveredStorage;
  }
}

function createQueryStorage(
  dbPath: string,
  workspace: string
): ReturnType<typeof createSqliteStorage> {
  return createSqliteStorage(dbPath, workspace, QUERY_READ_STORAGE_OPTIONS);
}

interface QueryStorageRecoveryParams {
  workspace: string;
  dbPath: string;
  storage: ReturnType<typeof createSqliteStorage>;
  error: unknown;
  phase: 'initialize' | 'execution' | 'bootstrap';
}

async function recoverQueryStorageAfterFailure(
  params: QueryStorageRecoveryParams
): Promise<ReturnType<typeof createSqliteStorage> | null> {
  const { workspace, dbPath, storage, error, phase } = params;
  if (!isRecoverableStorageError(error)) {
    return null;
  }

  const recovery = await attemptStorageRecovery(dbPath, { error }).catch((recoveryError) => ({
    recovered: false,
    actions: [] as string[],
    errors: [String(recoveryError)],
  }));
  if (!recovery.recovered) {
    return null;
  }

  await storage.close().catch(() => undefined);

  const phaseLabel = phase === 'initialize'
    ? 'storage init'
    : phase === 'bootstrap'
      ? 'query bootstrap'
      : 'query execution';
  if (recovery.actions.length > 0) {
    console.error(
      `[librarian] recovered ${phaseLabel} storage state for ${path.basename(dbPath)}: ${recovery.actions.join(', ')}`
    );
  } else {
    console.error(
      `[librarian] recovered ${phaseLabel} storage state for ${path.basename(dbPath)}`
    );
  }

  const recoveredStorage = createQueryStorage(dbPath, workspace);
  await recoveredStorage.initialize();
  return recoveredStorage;
}

interface QueryBootstrapRecoveryParams {
  workspace: string;
  dbPath: string;
  storage: ReturnType<typeof createSqliteStorage>;
  config: ReturnType<typeof createBootstrapConfig>;
  timeoutMs: number;
}

async function executeQueryBootstrapWithRecovery(
  params: QueryBootstrapRecoveryParams
): Promise<ReturnType<typeof createSqliteStorage>> {
  const runBootstrap = async (
    storage: ReturnType<typeof createSqliteStorage>,
    timeoutMs: number,
    config: ReturnType<typeof createBootstrapConfig>
  ): Promise<void> => {
    const bootstrapConfig = config.timeoutMs === timeoutMs ? config : { ...config, timeoutMs };
    try {
      await bootstrapProject(bootstrapConfig, storage);
    } catch (error) {
      if (isGovernorWallTimeTimeout(error)) {
        const nextTimeoutMs = Math.max(Math.round(timeoutMs * 1.5), timeoutMs + 1000);
        throw createError(
          'QUERY_TIMEOUT',
          `Bootstrap during query timed out after ${timeoutMs}ms. Run \`librarian doctor --heal\` and retry with \`--timeout ${nextTimeoutMs}\` if needed.`
        );
      }
      throw error;
    }
  };

  try {
    await withQueryCommandTimeout(
      'bootstrap',
      params.timeoutMs,
      () => runBootstrap(params.storage, params.timeoutMs, params.config)
    );
    return params.storage;
  } catch (error) {
    const recoveredStorage = await recoverQueryStorageAfterFailure({
      workspace: params.workspace,
      dbPath: params.dbPath,
      storage: params.storage,
      error,
      phase: 'bootstrap',
    });
    if (!recoveredStorage) throw error;
    await withQueryCommandTimeout(
      'bootstrap',
      params.timeoutMs,
      () => runBootstrap(recoveredStorage, params.timeoutMs, params.config)
    );
    return recoveredStorage;
  }
}

function parseNonNegativeInt(raw: string, optionName: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createError('INVALID_ARGUMENT', `--${optionName} must be a non-negative integer`);
  }
  return parsed;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function applyPackLimit(
  response: LibrarianResponse,
  limit: number | undefined
): { response: LibrarianResponse; droppedCount: number } {
  if (!limit || response.packs.length <= limit) {
    return { response, droppedCount: 0 };
  }
  const droppedCount = response.packs.length - limit;
  return {
    response: {
      ...response,
      packs: response.packs.slice(0, limit),
      coverageGaps: [
        ...(response.coverageGaps ?? []),
        `Result limit applied: returning top ${limit} packs (dropped ${droppedCount}).`,
      ],
    },
    droppedCount,
  };
}

function inferRetrievalStrategy(response: LibrarianResponse): {
  strategy: RetrievalStrategy;
  reason?: string;
  warning?: string;
} {
  const semanticStage = findStage(response.stages, 'semantic_retrieval');
  const synthesisStage = findStage(response.stages, 'synthesis');
  const hasSemanticSignal = (semanticStage?.results.outputCount ?? 0) > 0
    && semanticStage?.status !== 'failed'
    && semanticStage?.status !== 'skipped';
  const hasSynthesis = response.synthesisMode === 'llm'
    || Boolean(response.synthesis)
    || ((synthesisStage?.results.outputCount ?? 0) > 0 && synthesisStage?.status === 'success');
  const gaps = (response.coverageGaps ?? []).join(' ').toLowerCase();

  if (hasSemanticSignal && hasSynthesis) {
    return { strategy: 'hybrid' };
  }
  if (hasSemanticSignal) {
    return { strategy: 'semantic' };
  }
  if (semanticStage?.status === 'failed' || semanticStage?.status === 'partial') {
    return {
      strategy: 'degraded',
      reason: 'semantic_stage_degraded',
      warning: 'Semantic retrieval degraded; validate embedding/index health before relying on ranking.',
    };
  }
  if (
    gaps.includes('embedding provider unavailable')
    || gaps.includes('semantic retrieval degraded')
    || gaps.includes('vector index')
    || gaps.includes('semantic search')
  ) {
    return {
      strategy: 'heuristic',
      reason: 'embeddings_unavailable',
      warning: 'Heuristic fallback active; results may be weakly tied to query intent.',
    };
  }
  return {
    strategy: 'heuristic',
    reason: 'fallback',
  };
}

function findStage(stages: StageReport[] | undefined, stage: StageReport['stage']): StageReport | undefined {
  return stages?.find((entry) => entry.stage === stage);
}

function collectCriticalWarnings(response: LibrarianResponse): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const add = (warning: string): void => {
    const normalized = sanitizeTraceMarkerMessage(warning).trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    warnings.push(normalized);
  };

  const coverageGaps = response.coverageGaps ?? [];
  const disclosures = response.disclosures ?? [];
  const drillDownHints = response.drillDownHints ?? [];
  const combined = [...coverageGaps, ...disclosures, ...drillDownHints];
  const lowerCombined = combined.map((entry) => entry.toLowerCase());

  const explicitSessionDegraded = drillDownHints.find((hint) => hint.toLowerCase().includes('session degraded'));
  if (explicitSessionDegraded) {
    add(explicitSessionDegraded);
  } else {
    const storageWriteDegraded = lowerCombined.some((entry) =>
      entry.includes('storage_write_degraded')
      || (entry.includes('session degraded') && entry.includes('persist'))
      || (entry.includes('storage') && entry.includes('lock') && entry.includes('degraded'))
    );
    if (storageWriteDegraded) {
      add('Session degraded: results were returned but could not be persisted. Run `librarian doctor --heal` to recover storage locks.');
    }
  }

  const synthesisUnavailable = lowerCombined.some((entry) =>
    entry.includes('synthesis failed')
    || entry.includes('synthesis unavailable')
    || entry.includes('claude cli error')
    || entry.includes('llm unavailable')
  );
  if (!response.synthesis && response.llmError) {
    add(`LLM synthesis error: ${response.llmError}`);
  }
  if (!response.synthesis && synthesisUnavailable) {
    add('LLM synthesis unavailable: results are structural-only. Run `librarian check-providers` to diagnose provider/config issues.');
  }

  const indexIncompleteHint = combined.find((entry) =>
    /index .*results may be incomplete/i.test(entry)
  );
  if (indexIncompleteHint) {
    add(indexIncompleteHint);
  }

  const coherenceHint = combined.find((entry) =>
    entry.toLowerCase().includes('result coherence:')
    || entry.toLowerCase().includes('coherence_warning:')
  );
  if (coherenceHint) {
    add(coherenceHint);
  }

  if (Number.isFinite(response.totalConfidence) && response.totalConfidence < 0.2) {
    add(`Low confidence (${response.totalConfidence.toFixed(3)}): validate results before acting on them.`);
  }

  return warnings;
}

interface PersistedQuerySession {
  schemaVersion: 1;
  savedAt: string;
  session: ContextSession;
}

function resolveQuerySessionsDir(workspace: string): string {
  return path.resolve(workspace, '.librarian', 'query_sessions');
}

function resolveQuerySessionPath(workspace: string, sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw createError('INVALID_ARGUMENT', `Invalid session ID "${sessionId}".`);
  }
  return path.join(resolveQuerySessionsDir(workspace), `${trimmed}.json`);
}

async function loadQuerySession(workspace: string, sessionId: string): Promise<ContextSession | null> {
  const filePath = resolveQuerySessionPath(workspace, sessionId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = safeJsonParse<PersistedQuerySession>(raw);
    if (!parsed.ok || !parsed.value?.session) return null;
    return parsed.value.session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ENOENT')) return null;
    throw error;
  }
}

async function saveQuerySession(workspace: string, session: ContextSession): Promise<void> {
  const sessionsDir = resolveQuerySessionsDir(workspace);
  const filePath = resolveQuerySessionPath(workspace, session.sessionId);
  const payload: PersistedQuerySession = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    session,
  };
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
