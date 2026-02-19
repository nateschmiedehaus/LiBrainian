import { parseArgs } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
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

export async function queryCommand(options: QueryCommandOptions): Promise<void> {
  const { workspace, rawArgs, args } = options;
  const commandArgs = args.length > 0 ? args : rawArgs.slice(1);

  // Parse command-specific options
  const { values, positionals } = parseArgs({
    args: commandArgs,
    options: {
      depth: { type: 'string', default: 'L1' },
      files: { type: 'string' },
      timeout: { type: 'string', default: '0' },
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
  const affectedFiles = values.files
    ? (values.files as string).split(',').map((entry) => {
      const raw = entry.trim();
      return raw ? (path.isAbsolute(raw) ? raw : path.resolve(workspace, raw)) : '';
    }).filter(Boolean)
    : undefined;
  const timeoutMs = parseInt(values.timeout as string, 10);
  if (timeoutMs > 0) {
    throw createError('INVALID_ARGUMENT', 'Timeouts are not allowed for librarian queries');
  }
  const outputJson = values.json as boolean;
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
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();
  try {
    // Check if bootstrapped - detect current tier and use that as target
    // This allows operation on existing data without requiring upgrade
    const currentVersion = await detectLibrarianVersion(storage);
    const effectiveTier = currentVersion?.qualityTier ?? 'full';
    const bootstrapCheck = await isBootstrapRequired(workspace, storage, { targetQualityTier: effectiveTier });
    if (bootstrapCheck.required) {
      if (noBootstrap) {
        throw createError('NOT_BOOTSTRAPPED', bootstrapCheck.reason);
      }
      const bootstrapSpinner = createSpinner('Bootstrap required; initializing (fast mode)...');
      try {
        let skipEmbeddings = false;
        const providerCheckSkipped = process.env.LIBRARIAN_SKIP_PROVIDER_CHECK === '1';
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
        });
        await bootstrapProject(config, storage);
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
      ucRequirements: ucIds ? {
        ucIds,
        priority: (ucPriority === 'low' || ucPriority === 'medium' || ucPriority === 'high') ? ucPriority : undefined,
        evidenceThreshold: Number.isFinite(ucEvidence ?? NaN) ? ucEvidence : undefined,
        freshnessMaxDays: Number.isFinite(ucFreshnessDays ?? NaN) ? ucFreshnessDays : undefined,
      } : undefined,
      llmRequirement,
      embeddingRequirement,
      tokenBudget,
      deterministic,
    };

    if (sessionRequested) {
      const sessionManager = new ContextAssemblySessionManager({
        query: (sessionQuery) => queryLibrarian({
          ...sessionQuery,
          llmRequirement: sessionQuery.llmRequirement ?? llmRequirement,
          embeddingRequirement: sessionQuery.embeddingRequirement ?? embeddingRequirement,
          tokenBudget: sessionQuery.tokenBudget ?? tokenBudget,
          deterministic,
        }, storage),
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
      const rawResponse = await queryLibrarian(query, storage);
      const { response, droppedCount } = applyPackLimit(rawResponse, limit);
      const strategyInfo = inferRetrievalStrategy(response);
      const displayResponse = sanitizeQueryResponseForOutput(response);
      const elapsed = Date.now() - startTime;

      spinner.succeed(`Query completed in ${formatDuration(elapsed)}`);

      if (outputJson) {
        const criticalWarnings = collectCriticalWarnings(response);
        await emitJsonOutput({
          ...displayResponse,
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
