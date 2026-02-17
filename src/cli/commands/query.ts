import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { queryLibrarian } from '../../api/query.js';
import { bootstrapProject, createBootstrapConfig, isBootstrapRequired } from '../../api/bootstrap.js';
import { detectLibrarianVersion } from '../../api/versioning.js';
import { resolveLibrarianModelConfigWithDiscovery, resolveLibrarianModelId } from '../../api/llm_env.js';
import { checkAllProviders } from '../../api/provider_check.js';
import type { LibrarianQuery, TokenBudget } from '../../types.js';
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

export interface QueryCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

export async function queryCommand(options: QueryCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;

  // Parse command-specific options
  const { values, positionals } = parseArgs({
    args: rawArgs.slice(1), // Skip 'query' command
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
    },
    allowPositionals: true,
    strict: false,
  });

  const intent = positionals.join(' ');
  if (!intent) {
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
  if (outputJson) {
    // Keep stdout machine-readable when JSON output is requested.
    // Progress indicators render to stderr, but disable them entirely for JSON mode.
    process.env.LIBRARIAN_NO_PROGRESS = '1';
  }
  const noSynthesis = values['no-synthesis'] as boolean;
  const deterministic = values.deterministic as boolean;
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
    const enumerationIntent = detectEnumerationIntent(intent);
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
          console.log(JSON.stringify({
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
          }, null, 2));
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
    const autoDetectExhaustive = shouldUseExhaustiveMode(intent);
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
          console.log(JSON.stringify({
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
          }, null, 2));
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
    if (!noSynthesis && !hasLlmConfig) {
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
      tokenBudget,
      deterministic,
    };
    try {
      const startTime = Date.now();
      const response = await queryLibrarian(query, storage);
      const elapsed = Date.now() - startTime;

      spinner.succeed(`Query completed in ${formatDuration(elapsed)}`);

      if (outputJson) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      console.log('\nQuery Results:');
      console.log('==============\n');

      const keyValues = [
        { key: 'Intent', value: intent },
        { key: 'Depth', value: depth },
        { key: 'Affected Files', value: affectedFiles?.join(', ') || 'None specified' },
        { key: 'UC Requirements', value: ucIds?.join(', ') || 'None specified' },
        { key: 'Total Confidence', value: response.totalConfidence.toFixed(3) },
        { key: 'Cache Hit', value: response.cacheHit },
        { key: 'Latency', value: `${response.latencyMs}ms` },
        { key: 'Packs Found', value: response.packs.length },
      ];
      if (deterministic) {
        keyValues.push({ key: 'Deterministic Mode', value: 'enabled (LLM synthesis skipped, stable sorting applied)' });
      }
      if (tokenBudget) {
        keyValues.push({ key: 'Token Budget', value: `${tokenBudget.maxTokens}${tokenBudget.reserveTokens ? ` (reserve: ${tokenBudget.reserveTokens})` : ''}` });
      }
      printKeyValue(keyValues);
      console.log();

      if (response.explanation) {
        console.log('Explanation:');
        console.log(`  ${response.explanation}`);
        console.log();
      }

      if (response.packs.length > 0) {
        console.log('Context Packs:');
        for (const pack of response.packs) {
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

      if (response.coverageGaps && response.coverageGaps.length > 0) {
        console.log('Coverage Gaps:');
        for (const gap of response.coverageGaps) {
          console.log(`  - ${gap}`);
        }
        console.log();
      }

      if (response.methodHints && response.methodHints.length > 0) {
        console.log('Method Hints:');
        for (const hint of response.methodHints) {
          console.log(`  - ${hint}`);
        }
        console.log();
      }

      if (response.drillDownHints.length > 0) {
        console.log('Drill-Down Hints:');
        for (const hint of response.drillDownHints) {
          console.log(`  - ${hint}`);
        }
        console.log();
      }

      if (response.calibration) {
        console.log('Calibration Info:');
        printKeyValue([
          { key: 'Buckets', value: response.calibration.bucketCount },
          { key: 'Samples', value: response.calibration.sampleCount },
          { key: 'Expected Error', value: response.calibration.expectedCalibrationError.toFixed(4) },
        ]);
        console.log();
      }

      if (response.uncertainty) {
        console.log('Uncertainty Metrics:');
        printKeyValue([
          { key: 'Confidence', value: response.uncertainty.confidence.toFixed(3) },
          { key: 'Entropy', value: response.uncertainty.entropy.toFixed(3) },
          { key: 'Variance', value: response.uncertainty.variance.toFixed(3) },
        ]);
        console.log();
      }

      if (response.tokenBudgetResult) {
        console.log('Token Budget:');
        const tbr = response.tokenBudgetResult;
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
