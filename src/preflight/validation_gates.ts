/**
 * @fileoverview Validation Gates for Bootstrap Phases
 *
 * Provides precondition and postcondition validation for each bootstrap phase.
 * These gates ensure that phases only run when their requirements are met,
 * and that they produce valid output before proceeding.
 *
 * Philosophy: Fail fast with actionable feedback rather than propagating
 * errors deep into the system.
 *
 * @packageDocumentation
 */

import type { LibrarianStorage } from '../storage/types.js';
import type { BootstrapConfig, BootstrapPhaseName, BootstrapPhaseResult } from '../types.js';
import { glob } from 'glob';
import { logInfo, logWarning, logError } from '../telemetry/logger.js';
import { checkAllProviders } from '../api/provider_check.js';
import { resolveWorkspaceRoot } from '../utils/workspace_resolver.js';
import { getParserType } from '../universal_patterns.js';

const MINIMAL_EXCLUDES = ['**/.git/**', '**/.librarian/**'];

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of a validation gate check
 */
export interface ValidationGateResult {
  /** Whether the gate passed */
  passed: boolean;
  /** Gate identifier */
  gateId: string;
  /** Phase this gate validates */
  phase: BootstrapPhaseName;
  /** Type of gate (pre or post) */
  type: 'precondition' | 'postcondition';
  /** Detailed message */
  message: string;
  /** Suggested fix if failed */
  suggestedFix?: string;
  /** Whether failure is fatal (should abort) */
  fatal: boolean;
  /** Metrics collected during validation - allows undefined values */
  metrics?: Record<string, number | string | undefined>;
}

/**
 * Context for validation gate execution
 */
export interface ValidationGateContext {
  workspace: string;
  storage: LibrarianStorage;
  config: BootstrapConfig;
  phaseResult?: BootstrapPhaseResult;
}

/**
 * Validation gate function type
 */
type ValidationGateFn = (ctx: ValidationGateContext) => Promise<ValidationGateResult>;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get file count from storage
 */
async function getFileCount(storage: LibrarianStorage): Promise<number> {
  try {
    const files = await storage.getFiles({ limit: 1 });
    // If we can get files, get full count
    const allFiles = await storage.getFiles({});
    return allFiles.length;
  } catch {
    return 0;
  }
}

// ============================================================================
// PRECONDITION GATES
// ============================================================================

/**
 * Precondition: Storage must be initialized before structural scan
 */
const gateStructuralScanStorageReady: ValidationGateFn = async (ctx) => {
  try {
    // Verify storage is accessible
    const stats = await ctx.storage.getStats();
    return {
      passed: true,
      gateId: 'structural_scan_storage_ready',
      phase: 'structural_scan',
      type: 'precondition',
      message: 'Storage is initialized and ready',
      fatal: true,
      metrics: {
        existingModules: stats.totalModules,
        existingFunctions: stats.totalFunctions,
      },
    };
  } catch (error) {
    return {
      passed: false,
      gateId: 'structural_scan_storage_ready',
      phase: 'structural_scan',
      type: 'precondition',
      message: `Storage not ready: ${error instanceof Error ? error.message : String(error)}`,
      suggestedFix: 'Ensure the database is accessible and not locked by another process',
      fatal: true,
    };
  }
};

/**
 * Precondition: Structural scan must have found files before semantic indexing
 */
const gateSemanticIndexingFilesExist: ValidationGateFn = async (ctx) => {
  try {
	    const fileCount = await getFileCount(ctx.storage);
	    if (fileCount === 0) {
	      const discovered = await glob(ctx.config.include, { cwd: ctx.workspace, ignore: ctx.config.exclude, nodir: true, follow: false });
	      if (discovered.length > 0) return { passed: true, gateId: 'semantic_indexing_files_exist', phase: 'semantic_indexing', type: 'precondition', message: `${discovered.length} files ready for semantic indexing (filesystem scan)`, fatal: true, metrics: { fileCount: discovered.length } };
	      return {
	        passed: false,
	        gateId: 'semantic_indexing_files_exist',
	        phase: 'semantic_indexing',
        type: 'precondition',
        message: 'No files discovered in structural scan',
        suggestedFix: 'Check workspace path and include/exclude patterns',
        fatal: true,
      };
    }
    return {
      passed: true,
      gateId: 'semantic_indexing_files_exist',
      phase: 'semantic_indexing',
      type: 'precondition',
      message: `${fileCount} files ready for semantic indexing`,
      fatal: true,
      metrics: { fileCount },
    };
  } catch (error) {
    return {
      passed: false,
      gateId: 'semantic_indexing_files_exist',
      phase: 'semantic_indexing',
      type: 'precondition',
      message: `Failed to check files: ${error instanceof Error ? error.message : String(error)}`,
      fatal: true,
    };
  }
};

/**
 * Precondition: Check LLM and Embedding provider availability for semantic indexing
 * NON-FATAL: Bootstrap continues with structural-only indexing if providers unavailable.
 * This is informational - semantic indexing will gracefully degrade.
 */
const gateSemanticIndexingProvidersAvailable: ValidationGateFn = async (ctx) => {
  // Skip provider check in test mode or when explicitly disabled
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.WAVE0_TEST_MODE === 'true' ||
    (process.env.LIBRAINIAN_SKIP_PROVIDER_CHECK ?? process.env.LIBRARIAN_SKIP_PROVIDER_CHECK) === '1' ||
    ctx.config.skipProviderProbe
  ) {
    return {
      passed: true,
      gateId: 'semantic_indexing_providers_available',
      phase: 'semantic_indexing',
      type: 'precondition',
      message: 'Provider check skipped (test mode or explicitly disabled)',
      fatal: false,
      metrics: { providerCheckSkipped: 1 },
    };
  }

  try {
    const providerStatus = await checkAllProviders({ workspaceRoot: ctx.workspace });

    const llmOk = providerStatus.llm.available;
    const embeddingOk = providerStatus.embedding.available;

    if (!llmOk && !embeddingOk) {
      // NON-FATAL: Continue with structural-only indexing
      logWarning('No LLM or embedding providers available - semantic indexing will be limited to AST parsing', {
        context: 'validation_gates',
        llmError: providerStatus.llm.error,
        embeddingError: providerStatus.embedding.error,
      });
      return {
        passed: true, // Always pass - bootstrap continues
        gateId: 'semantic_indexing_providers_available',
        phase: 'semantic_indexing',
        type: 'precondition',
        message: `Providers limited: LLM=${providerStatus.llm.error ?? 'unavailable'}, Embedding=${providerStatus.embedding.error ?? 'unavailable'}. Continuing with structural-only indexing.`,
        suggestedFix: 'For full semantic indexing: authenticate via CLI (Claude: `claude setup-token` or run `claude`; Codex: `codex login`)',
        fatal: false,
        metrics: {
          llmAvailable: 0,
          embeddingAvailable: 0,
          degradedMode: 1,
        },
      };
    }

    if (!embeddingOk) {
      logWarning('Embedding provider unavailable - semantic search will be limited', {
        context: 'validation_gates',
        embeddingError: providerStatus.embedding.error,
      });
      return {
        passed: true, // Always pass - bootstrap continues
        gateId: 'semantic_indexing_providers_available',
        phase: 'semantic_indexing',
        type: 'precondition',
        message: `Embedding unavailable: ${providerStatus.embedding.error ?? 'not configured'}. Semantic search will be limited.`,
        suggestedFix: 'Configure embedding provider for full semantic search capability',
        fatal: false,
        metrics: {
          llmAvailable: llmOk ? 1 : 0,
          embeddingAvailable: 0,
          degradedMode: 1,
        },
      };
    }

    if (!llmOk) {
      logWarning('LLM provider unavailable - semantic enrichment will be limited', {
        context: 'validation_gates',
        llmError: providerStatus.llm.error,
      });
    }

    return {
      passed: true,
      gateId: 'semantic_indexing_providers_available',
      phase: 'semantic_indexing',
      type: 'precondition',
      message: `Providers ready: LLM=${llmOk ? providerStatus.llm.provider : 'unavailable'}, Embedding=${providerStatus.embedding.provider}`,
      fatal: false,
      metrics: {
        llmAvailable: llmOk ? 1 : 0,
        embeddingAvailable: embeddingOk ? 1 : 0,
        llmProvider: providerStatus.llm.provider,
        embeddingProvider: providerStatus.embedding.provider,
      },
    };
  } catch (error) {
    // NON-FATAL: Continue even if provider check fails
    logWarning('Provider check failed - continuing with available capabilities', {
      context: 'validation_gates',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      passed: true, // Always pass - bootstrap continues
      gateId: 'semantic_indexing_providers_available',
      phase: 'semantic_indexing',
      type: 'precondition',
      message: `Provider check failed: ${error instanceof Error ? error.message : String(error)}. Continuing with available capabilities.`,
      fatal: false,
    };
  }
};

/**
 * Precondition: Functions must be indexed before relationship mapping
 */
const gateRelationshipMappingFunctionsExist: ValidationGateFn = async (ctx) => {
  try {
    const stats = await ctx.storage.getStats();
    if (stats.totalFunctions === 0) {
      return {
        passed: false,
        gateId: 'relationship_mapping_functions_exist',
        phase: 'relationship_mapping',
        type: 'precondition',
        message: 'No functions indexed - semantic indexing may have failed',
        suggestedFix: 'Check semantic indexing logs for errors',
        fatal: false, // Non-fatal: we can still map module relationships
      };
    }
    return {
      passed: true,
      gateId: 'relationship_mapping_functions_exist',
      phase: 'relationship_mapping',
      type: 'precondition',
      message: `${stats.totalFunctions} functions ready for relationship mapping`,
      fatal: false,
      metrics: { functionCount: stats.totalFunctions },
    };
  } catch (error) {
    return {
      passed: false,
      gateId: 'relationship_mapping_functions_exist',
      phase: 'relationship_mapping',
      type: 'precondition',
      message: `Failed to check functions: ${error instanceof Error ? error.message : String(error)}`,
      fatal: false,
    };
  }
};

/**
 * Precondition: Entities must exist before context pack generation
 */
const gateContextPackEntitiesExist: ValidationGateFn = async (ctx) => {
  try {
    const stats = await ctx.storage.getStats();
    const fileCount = await getFileCount(ctx.storage);
    const totalEntities = fileCount + stats.totalModules + stats.totalFunctions;
    if (totalEntities === 0) {
      return {
        passed: true,
        gateId: 'context_pack_entities_exist',
        phase: 'context_pack_generation',
        type: 'precondition',
        message: 'No entities available for context pack generation (skipping)',
        fatal: false,
        metrics: { entityCount: 0 },
      };
    }
    return {
      passed: true,
      gateId: 'context_pack_entities_exist',
      phase: 'context_pack_generation',
      type: 'precondition',
      message: `${totalEntities} entities ready for context pack generation`,
      fatal: false,
      metrics: { entityCount: totalEntities },
    };
  } catch (error) {
    return {
      passed: false,
      gateId: 'context_pack_entities_exist',
      phase: 'context_pack_generation',
      type: 'precondition',
      message: `Failed to check entities: ${error instanceof Error ? error.message : String(error)}`,
      fatal: false,
    };
  }
};

/**
 * Precondition: Context packs should exist before knowledge generation
 */
const gateKnowledgeGenerationReady: ValidationGateFn = async (ctx) => {
  try {
    const stats = await ctx.storage.getStats();
    return {
      passed: true,
      gateId: 'knowledge_generation_ready',
      phase: 'knowledge_generation',
      type: 'precondition',
      message: `Ready for knowledge generation (${stats.totalContextPacks} context packs)`,
      fatal: false,
      metrics: { contextPackCount: stats.totalContextPacks },
    };
  } catch (error) {
    return {
      passed: false,
      gateId: 'knowledge_generation_ready',
      phase: 'knowledge_generation',
      type: 'precondition',
      message: `Failed to check readiness: ${error instanceof Error ? error.message : String(error)}`,
      fatal: false,
    };
  }
};

// ============================================================================
// POSTCONDITION GATES
// ============================================================================

/**
 * Postcondition: Structural scan must have discovered files
 */
const gateStructuralScanComplete: ValidationGateFn = async (ctx) => {
  const result = ctx.phaseResult;
  if (!result) {
    return {
      passed: false,
      gateId: 'structural_scan_complete',
      phase: 'structural_scan',
      type: 'postcondition',
      message: 'No phase result available',
      fatal: true,
    };
  }

  if (result.itemsProcessed === 0) {
    const resolution = resolveWorkspaceRoot(ctx.workspace);
    if (resolution.changed) {
      return {
        passed: false,
        gateId: 'structural_scan_complete',
        phase: 'structural_scan',
        type: 'postcondition',
        message: `Structural scan found no files. Detected possible project root at ${resolution.workspace}.`,
        suggestedFix: `Re-run bootstrap from ${resolution.workspace} or pass --workspace ${resolution.workspace}.`,
        fatal: true,
        metrics: {
          filesFound: 0,
          workspaceAutoDetected: 1,
          candidateFileCount: resolution.candidateFileCount ?? 0,
        },
      };
    }

    if (ctx.config.include && ctx.config.include.length > 0) {
      try {
        const discovered = await glob(ctx.config.include, {
          cwd: ctx.workspace,
          ignore: ctx.config.exclude ?? [],
          nodir: true,
          follow: false,
          absolute: true,
          maxDepth: 6,
        });

        if (discovered.length === 0) {
          const discoveredIgnoringExclude = await glob(ctx.config.include, {
            cwd: ctx.workspace,
            ignore: MINIMAL_EXCLUDES,
            nodir: true,
            follow: false,
            absolute: true,
            maxDepth: 6,
          });
          if (discoveredIgnoringExclude.length > 0) {
            return {
              passed: false,
              gateId: 'structural_scan_complete',
              phase: 'structural_scan',
              type: 'postcondition',
              message: `Structural scan found no files because include patterns matched ${discoveredIgnoringExclude.length} files that were excluded by exclude patterns.`,
              suggestedFix: 'Review exclude patterns (e.g., node_modules/dist) or narrow the exclude list for bootstrap.',
              fatal: true,
              metrics: {
                filesFound: 0,
                excludedByPatterns: 1,
                matchedFilesIgnoringExclude: discoveredIgnoringExclude.length,
              },
            };
          }

          return {
            passed: false,
            gateId: 'structural_scan_complete',
            phase: 'structural_scan',
            type: 'postcondition',
            message: 'Structural scan found no files to process; include patterns matched no files in workspace.',
            suggestedFix: 'Verify workspace root and include patterns (e.g., "src/**/*.ts") match your codebase.',
            fatal: true,
            metrics: { filesFound: 0 },
          };
        }
      } catch (error) {
        logWarning('Structural scan diagnostics failed', {
          context: 'validation_gates',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      passed: false,
      gateId: 'structural_scan_complete',
      phase: 'structural_scan',
      type: 'postcondition',
      message: 'Structural scan found no files to process',
      suggestedFix: 'Verify workspace contains source files matching include patterns',
      fatal: true,
      metrics: { filesFound: 0 },
    };
  }

  const hasErrors = result.errors.length > 0;
  const errorRate = result.errors.length / result.itemsProcessed;

  if (errorRate > 0.5) {
    return {
      passed: false,
      gateId: 'structural_scan_complete',
      phase: 'structural_scan',
      type: 'postcondition',
      message: `Structural scan had >50% error rate (${result.errors.length}/${result.itemsProcessed})`,
      suggestedFix: 'Check file permissions and accessibility',
      fatal: true,
      metrics: {
        filesProcessed: result.itemsProcessed,
        errors: result.errors.length,
        errorRate: Math.round(errorRate * 100),
      },
    };
  }

  return {
    passed: true,
    gateId: 'structural_scan_complete',
    phase: 'structural_scan',
    type: 'postcondition',
    message: `Structural scan complete: ${result.itemsProcessed} files${hasErrors ? ` (${result.errors.length} errors)` : ''}`,
    fatal: true,
    metrics: {
      filesProcessed: result.itemsProcessed,
      errors: result.errors.length,
      durationMs: result.durationMs,
    },
  };
};

/**
 * Postcondition: Semantic indexing status check
 *
 * NON-FATAL POLICY: Bootstrap should never error.
 * - Warnings are logged for limited/degraded indexing
 * - Metrics indicate what was actually indexed
 * - Bootstrap continues regardless of indexing outcome
 */
const gateSemanticIndexingComplete: ValidationGateFn = async (ctx) => {
  const result = ctx.phaseResult;
  if (!result) {
    logWarning('Semantic indexing postcondition: no phase result available', {
      context: 'validation_gates',
    });
    return {
      passed: true, // Always pass - bootstrap continues
      gateId: 'semantic_indexing_complete',
      phase: 'semantic_indexing',
      type: 'postcondition',
      message: 'No phase result available - continuing with available data',
      fatal: false,
    };
  }

  try {
    const stats = await ctx.storage.getStats();
    const hasErrors = result.errors.length > 0;

    // Files processed but nothing indexed → AST extraction issue (warn, don't fail)
    if (stats.totalFunctions === 0 && result.itemsProcessed > 0) {
      logWarning('Semantic indexing: processed files but indexed no functions', {
        context: 'validation_gates',
        filesProcessed: result.itemsProcessed,
        suggestion: 'Check if AST parsers support the file types in your project',
      });
      return {
        passed: true, // Always pass - bootstrap continues
        gateId: 'semantic_indexing_complete',
        phase: 'semantic_indexing',
        type: 'postcondition',
        message: 'Semantic indexing processed files but indexed no functions - AST parsing may be limited for these file types',
        suggestedFix: 'Check if LLM provider is configured and AST parsers support your languages',
        fatal: false,
        metrics: {
          filesProcessed: result.itemsProcessed,
          functionsIndexed: 0,
          degradedMode: 1,
        },
      };
    }

    // Nothing processed AND no errors → limited indexing (warn, don't fail)
    if (result.itemsProcessed === 0 && stats.totalFunctions === 0 && !hasErrors) {
      logWarning('Semantic indexing: no files processed and no functions indexed', {
        context: 'validation_gates',
        suggestion: 'Check include/exclude patterns and provider configuration',
      });
      return {
        passed: true, // Always pass - bootstrap continues
        gateId: 'semantic_indexing_complete',
        phase: 'semantic_indexing',
        type: 'postcondition',
        message: 'Semantic indexing limited - no files processed. Structural data may still be available.',
        suggestedFix: 'Check include/exclude patterns, LLM provider config, and file extensions',
        fatal: false,
        metrics: {
          filesProcessed: 0,
          functionsIndexed: 0,
          errorsLogged: 0,
          degradedMode: 1,
        },
      };
    }

    // Nothing processed but errors present → indexing had issues (warn, don't fail)
    if (result.itemsProcessed === 0 && hasErrors) {
      logWarning('Semantic indexing: encountered errors during indexing', {
        context: 'validation_gates',
        errorCount: result.errors.length,
        firstError: result.errors[0],
      });
      return {
        passed: true, // Always pass - bootstrap continues
        gateId: 'semantic_indexing_complete',
        phase: 'semantic_indexing',
        type: 'postcondition',
        message: `Semantic indexing had ${result.errors.length} errors - continuing with partial results`,
        suggestedFix: 'Check error messages for provider availability or configuration issues',
        fatal: false,
        metrics: {
          filesProcessed: 0,
          functionsIndexed: 0,
          errors: result.errors.length,
          degradedMode: 1,
        },
      };
    }

    return {
      passed: true,
      gateId: 'semantic_indexing_complete',
      phase: 'semantic_indexing',
      type: 'postcondition',
      message: `Semantic indexing complete: ${stats.totalFunctions} functions${hasErrors ? ` (${result.errors.length} errors)` : ''}`,
      fatal: false,
      metrics: {
        filesProcessed: result.itemsProcessed,
        functionsIndexed: stats.totalFunctions,
        errors: result.errors.length,
        durationMs: result.durationMs,
      },
    };
  } catch (error) {
    return {
      passed: false,
      gateId: 'semantic_indexing_complete',
      phase: 'semantic_indexing',
      type: 'postcondition',
      message: `Failed to verify indexing: ${error instanceof Error ? error.message : String(error)}`,
      fatal: true, // FAIL-FAST: Can't verify = can't trust
    };
  }
};

/**
 * Postcondition: Zero-file indexing check
 *
 * FATAL POLICY: This gate catches the critical case where patterns are wrong.
 * When files exist in the workspace but 0 were indexed, it indicates
 * misconfigured include patterns - this should fail loudly rather than
 * silently succeeding with an empty index.
 */
const gateSemanticIndexingZeroFilesCheck: ValidationGateFn = async (ctx) => {
  const result = ctx.phaseResult;
  if (!result) {
    return {
      passed: true,
      gateId: 'semantic_indexing_zero_files_check',
      phase: 'semantic_indexing',
      type: 'postcondition',
      message: 'No phase result available - skipping zero-file check',
      fatal: false,
    };
  }

  // Get actual files that could be indexed from the filesystem
  const totalFilesDiscovered = result.metrics?.totalFiles ?? 0;
  const filesIndexed = result.itemsProcessed ?? 0;

  // CRITICAL: Files discovered but nothing indexed = broken patterns
  if (totalFilesDiscovered > 0 && filesIndexed === 0) {
    logError('CRITICAL: Files discovered but 0 indexed - check include patterns', {
      context: 'validation_gates',
      totalFilesDiscovered,
      filesIndexed,
      includePatterns: ctx.config.include?.slice(0, 5), // Show first 5 patterns
    });
    return {
      passed: false,
      gateId: 'semantic_indexing_zero_files_check',
      phase: 'semantic_indexing',
      type: 'postcondition',
      message: `CRITICAL: ${totalFilesDiscovered} files discovered in workspace but 0 were indexed. Include patterns may not match any parseable files.`,
      suggestedFix: 'Verify include patterns match actual source files (e.g., "src/**/*.ts" not "src/nonexistent/**/*"). Run with --verbose to see which patterns match.',
      fatal: true,
      metrics: {
        totalFilesDiscovered,
        filesIndexed: 0,
        patternMismatch: 1,
      },
    };
  }

  // Also check: if patterns explicitly provided but match nothing
  if (ctx.config.include && ctx.config.include.length > 0 && filesIndexed === 0) {
    // Check if patterns actually match anything
    try {
      const discovered = await glob(ctx.config.include, {
        cwd: ctx.workspace,
        ignore: ctx.config.exclude ?? [],
        nodir: true,
        follow: false,
      });

      if (discovered.length > 0) {
        const astCandidates = discovered.filter((file) => getParserType(file) === 'ast');
        if (astCandidates.length === 0) {
          // Semantic indexing intentionally targets AST-eligible files. If patterns only
          // match non-AST categories (scripts/config/docs/schema/styles), a 0-file
          // semantic phase is expected and should not be treated as a fatal misconfig.
          return {
            passed: true,
            gateId: 'semantic_indexing_zero_files_check',
            phase: 'semantic_indexing',
            type: 'postcondition',
            message: `Zero-file check passed: include patterns matched ${discovered.length} files but none are AST-eligible`,
            fatal: false,
            metrics: {
              matchedFiles: discovered.length,
              astCandidates: 0,
              filesIndexed: 0,
            },
          };
        }

        // Patterns match AST-eligible files but nothing was indexed - likely parser/provider issue.
        logWarning('Include patterns match files but none were indexed', {
          context: 'validation_gates',
          matchedFiles: discovered.length,
          astCandidates: astCandidates.length,
          sampleFiles: astCandidates.slice(0, 3),
        });
        return {
          passed: false,
          gateId: 'semantic_indexing_zero_files_check',
          phase: 'semantic_indexing',
          type: 'postcondition',
          message: `Include patterns match ${astCandidates.length} AST-eligible files but 0 were indexed. Check parser availability and provider configuration.`,
          suggestedFix: 'Confirm that AST parsers are available for detected languages and embedding providers are ready. Re-run with `librarian doctor` and check logs for parser_unavailable.',
          fatal: true,
          metrics: {
            matchedFiles: discovered.length,
            astCandidates: astCandidates.length,
            filesIndexed: 0,
          },
        };
      } else if (discovered.length === 0) {
        // Patterns don't match anything
        logError('Include patterns match no files', {
          context: 'validation_gates',
          patterns: ctx.config.include,
        });
        return {
          passed: false,
          gateId: 'semantic_indexing_zero_files_check',
          phase: 'semantic_indexing',
          type: 'postcondition',
          message: `Include patterns [${ctx.config.include.slice(0, 3).join(', ')}${ctx.config.include.length > 3 ? '...' : ''}] match no files in workspace.`,
          suggestedFix: 'Check that include patterns match actual files. Use glob syntax like "src/**/*.ts" and verify paths exist.',
          fatal: true,
          metrics: {
            patternsCount: ctx.config.include.length,
            matchedFiles: 0,
          },
        };
      }
    } catch (error) {
      // Glob failed - log but don't fail the gate
      logWarning('Failed to check include patterns', {
        context: 'validation_gates',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    passed: true,
    gateId: 'semantic_indexing_zero_files_check',
    phase: 'semantic_indexing',
    type: 'postcondition',
    message: `Zero-file check passed: ${filesIndexed} files indexed`,
    fatal: false,
    metrics: {
      filesIndexed,
    },
  };
};

/**
 * Postcondition: Relationship mapping should create edges
 */
const gateRelationshipMappingComplete: ValidationGateFn = async (ctx) => {
  const result = ctx.phaseResult;
  if (!result) {
    return {
      passed: false,
      gateId: 'relationship_mapping_complete',
      phase: 'relationship_mapping',
      type: 'postcondition',
      message: 'No phase result available',
      fatal: false,
    };
  }

  // Relationship mapping with 0 edges is not necessarily a failure
  // (small projects might not have many dependencies)
  return {
    passed: true,
    gateId: 'relationship_mapping_complete',
    phase: 'relationship_mapping',
    type: 'postcondition',
    message: `Relationship mapping complete: ${result.itemsProcessed} edges created`,
    fatal: false,
    metrics: {
      edgesCreated: result.itemsProcessed,
      durationMs: result.durationMs,
    },
  };
};

/**
 * Postcondition: Context pack generation should create packs
 */
const gateContextPackComplete: ValidationGateFn = async (ctx) => {
  const result = ctx.phaseResult;
  if (ctx.config.bootstrapMode !== 'full' && (result?.itemsProcessed ?? 0) === 0) {
    return {
      passed: true,
      gateId: 'context_pack_complete',
      phase: 'context_pack_generation',
      type: 'postcondition',
      message: 'Context pack generation skipped (fast bootstrap mode)',
      fatal: false,
      metrics: { packsCreated: result?.itemsProcessed ?? 0 },
    };
  }
  if (!result) {
    return {
      passed: false,
      gateId: 'context_pack_complete',
      phase: 'context_pack_generation',
      type: 'postcondition',
      message: 'No phase result available',
      fatal: false,
    };
  }

  if (result.itemsProcessed === 0) {
    return {
      passed: false,
      gateId: 'context_pack_complete',
      phase: 'context_pack_generation',
      type: 'postcondition',
      message: 'No context packs were generated',
      suggestedFix: 'Check LLM provider availability and entity data',
      fatal: false, // Non-fatal: system can work without packs
      metrics: { packsCreated: 0 },
    };
  }

  return {
    passed: true,
    gateId: 'context_pack_complete',
    phase: 'context_pack_generation',
    type: 'postcondition',
    message: `Context pack generation complete: ${result.itemsProcessed} packs created`,
    fatal: false,
    metrics: {
      packsCreated: result.itemsProcessed,
      durationMs: result.durationMs,
    },
  };
};

/**
 * Postcondition: Knowledge generation should produce knowledge items
 */
const gateKnowledgeGenerationComplete: ValidationGateFn = async (ctx) => {
  const result = ctx.phaseResult;
  if (ctx.config.bootstrapMode !== 'full') {
    return {
      passed: true,
      gateId: 'knowledge_generation_complete',
      phase: 'knowledge_generation',
      type: 'postcondition',
      message: 'Knowledge generation skipped (fast bootstrap mode)',
      fatal: false,
      metrics: { knowledgeItems: result?.itemsProcessed ?? 0 },
    };
  }
  if (!result) {
    return {
      passed: false,
      gateId: 'knowledge_generation_complete',
      phase: 'knowledge_generation',
      type: 'postcondition',
      message: 'No phase result available',
      fatal: false,
    };
  }

  return {
    passed: true,
    gateId: 'knowledge_generation_complete',
    phase: 'knowledge_generation',
    type: 'postcondition',
    message: `Knowledge generation complete: ${result.itemsProcessed} items`,
    fatal: false,
    metrics: {
      knowledgeItems: result.itemsProcessed,
      durationMs: result.durationMs,
    },
  };
};

// ============================================================================
// GATE REGISTRY
// ============================================================================

/**
 * Map of precondition gates by phase
 */
const PRECONDITION_GATES: Map<BootstrapPhaseName, ValidationGateFn[]> = new Map([
  ['structural_scan', [gateStructuralScanStorageReady]],
  ['semantic_indexing', [gateSemanticIndexingFilesExist, gateSemanticIndexingProvidersAvailable]],
  ['relationship_mapping', [gateRelationshipMappingFunctionsExist]],
  ['context_pack_generation', [gateContextPackEntitiesExist]],
  ['knowledge_generation', [gateKnowledgeGenerationReady]],
]);

/**
 * Map of postcondition gates by phase
 */
const POSTCONDITION_GATES: Map<BootstrapPhaseName, ValidationGateFn[]> = new Map([
  ['structural_scan', [gateStructuralScanComplete]],
  ['semantic_indexing', [gateSemanticIndexingComplete, gateSemanticIndexingZeroFilesCheck]],
  ['relationship_mapping', [gateRelationshipMappingComplete]],
  ['context_pack_generation', [gateContextPackComplete]],
  ['knowledge_generation', [gateKnowledgeGenerationComplete]],
]);

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Run all precondition gates for a phase
 */
export async function runPreconditionGates(
  phase: BootstrapPhaseName,
  ctx: ValidationGateContext
): Promise<ValidationGateResult[]> {
  const gates = PRECONDITION_GATES.get(phase) ?? [];
  const results: ValidationGateResult[] = [];

  logInfo(`[validation] Running ${gates.length} precondition gates for ${phase}`);

  for (const gate of gates) {
    const result = await gate(ctx);
    results.push(result);

    if (!result.passed) {
      if (result.fatal) {
        logError(`[validation] Fatal precondition failed: ${result.message}`);
        break;
      }
      logWarning(`[validation] Precondition warning: ${result.message}`);
    } else {
      logInfo(`[validation] Gate passed: ${result.gateId}`);
    }
  }

  return results;
}

/**
 * Run all postcondition gates for a phase
 */
export async function runPostconditionGates(
  phase: BootstrapPhaseName,
  ctx: ValidationGateContext
): Promise<ValidationGateResult[]> {
  const gates = POSTCONDITION_GATES.get(phase) ?? [];
  const results: ValidationGateResult[] = [];

  logInfo(`[validation] Running ${gates.length} postcondition gates for ${phase}`);

  for (const gate of gates) {
    const result = await gate(ctx);
    results.push(result);

    if (!result.passed) {
      if (result.fatal) {
        logError(`[validation] Fatal postcondition failed: ${result.message}`);
      } else {
        logWarning(`[validation] Postcondition warning: ${result.message}`);
      }
    } else {
      logInfo(`[validation] Gate passed: ${result.gateId}`);
    }
  }

  return results;
}

/**
 * Check if any results contain fatal failures
 */
export function hasFatalFailure(results: ValidationGateResult[]): boolean {
  return results.some((r) => !r.passed && r.fatal);
}

/**
 * Get all failure messages from results
 */
export function getFailureMessages(results: ValidationGateResult[]): string[] {
  return results
    .filter((r) => !r.passed)
    .map((r) => {
      const prefix = r.fatal ? '[FATAL]' : '[WARNING]';
      const fix = r.suggestedFix ? ` Fix: ${r.suggestedFix}` : '';
      return `${prefix} ${r.message}${fix}`;
    });
}

/**
 * Print validation results to console
 */
export function printValidationResults(
  results: ValidationGateResult[],
  verbose = false
): void {
  const failures = results.filter((r) => !r.passed);
  const warnings = failures.filter((r) => !r.fatal);
  const fatals = failures.filter((r) => r.fatal);

  if (fatals.length > 0) {
    console.log('\nFatal Validation Failures:');
    for (const result of fatals) {
      console.log(`  - [${result.gateId}] ${result.message}`);
      if (result.suggestedFix) {
        console.log(`    Fix: ${result.suggestedFix}`);
      }
    }
  }

  if (warnings.length > 0) {
    console.log('\nValidation Warnings:');
    for (const result of warnings) {
      console.log(`  - [${result.gateId}] ${result.message}`);
      if (result.suggestedFix) {
        console.log(`    Fix: ${result.suggestedFix}`);
      }
    }
  }

  if (verbose && failures.length === 0) {
    console.log('\nAll validation gates passed:');
    for (const result of results) {
      console.log(`  - [${result.gateId}] ${result.message}`);
    }
  }
}
