/**
 * @fileoverview Debug CLI commands for the LiBrainian system (G10)
 *
 * Provides command-line interface for debugging librainian operations:
 * - `librainian debug inspect <id>` - Inspect a module, function, or pack
 * - `librainian debug trace <operation>` - Trace an operation
 * - `librainian debug confidence <id>` - Show confidence breakdown
 * - `librainian debug low-confidence [threshold]` - Find low confidence entities
 *
 * Usage:
 * ```bash
 * npx ts-node src/librainian/cli/commands/debug.ts inspect src/api/index.ts
 * npx ts-node src/librainian/cli/commands/debug.ts trace query --intent "How does auth work?"
 * npx ts-node src/librainian/cli/commands/debug.ts confidence my-function-id
 * npx ts-node src/librainian/cli/commands/debug.ts low-confidence 0.4
 * ```
 */

import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { resolveDbPath } from '../db_path.js';
import { createInspector } from '../../debug/inspector.js';
import { globalTracer, formatTraceTree } from '../../debug/tracer.js';
import { queryLiBrainian } from '../../api/query.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import type { LiBrainianQuery } from '../../types.js';

// ============================================================================
// TYPES
// ============================================================================

interface DebugCommandContext {
  storage: LiBrainianStorage;
  workspace: string;
}

interface DebugCommandResult {
  success: boolean;
  output: string;
  error?: string;
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

/**
 * Inspect a module, function, or context pack.
 */
export async function inspectCommand(
  id: string,
  context: DebugCommandContext
): Promise<DebugCommandResult> {
  const inspector = createInspector(context.storage);

  // Try to inspect as module
  const moduleInfo = await inspector.inspectModule(id);
  if (moduleInfo) {
    return {
      success: true,
      output: formatModuleInspection(moduleInfo),
    };
  }

  // Try to inspect as function
  const funcInfo = await inspector.inspectFunction(id);
  if (funcInfo) {
    return {
      success: true,
      output: formatFunctionInspection(funcInfo),
    };
  }

  // Try to inspect confidence
  const confidenceInfo = await inspector.inspectConfidence(id);
  if (confidenceInfo) {
    return {
      success: true,
      output: formatConfidenceInspection(confidenceInfo),
    };
  }

  return {
    success: false,
    output: '',
    error: `Entity not found: ${id}`,
  };
}

/**
 * Trace a librainian operation.
 */
export async function traceCommand(
  operation: string,
  options: { intent?: string; files?: string[]; depth?: string },
  context: DebugCommandContext
): Promise<DebugCommandResult> {
  globalTracer.clear();

  switch (operation) {
    case 'query': {
      if (!options.intent) {
        return {
          success: false,
          output: '',
          error: 'Query operation requires --intent',
        };
      }

      const spanId = globalTracer.startSpan('debug_query');
      try {
        const query: LiBrainianQuery = {
          intent: options.intent,
          affectedFiles: options.files,
          depth: (options.depth as 'L0' | 'L1' | 'L2' | 'L3') ?? 'L1',
        };

        globalTracer.addEvent(spanId, 'query_start', { query });
        const response = await queryLiBrainian(query, context.storage);
        globalTracer.addEvent(spanId, 'query_complete', {
          packsReturned: response.packs.length,
          latencyMs: response.latencyMs,
          cacheHit: response.cacheHit,
        });

        globalTracer.endSpan(spanId);

        const tree = globalTracer.buildTraceTree();
        const traceOutput = formatTraceTree(tree);

        return {
          success: true,
          output: `Query Trace:\n${traceOutput}\n\nResult: ${response.packs.length} packs returned in ${response.latencyMs}ms`,
        };
      } catch (error) {
        globalTracer.setAttribute(spanId, 'error', error instanceof Error ? error.message : String(error));
        globalTracer.endSpan(spanId);

        return {
          success: false,
          output: '',
          error: `Query failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    case 'list-modules': {
      const spanId = globalTracer.startSpan('debug_list_modules');
      const inspector = createInspector(context.storage);
      const modules = await inspector.listModules();
      globalTracer.addEvent(spanId, 'list_complete', { count: modules.length });
      globalTracer.endSpan(spanId);

      const output = modules
        .map(m => `  ${m.path} (confidence: ${(m.confidence * 100).toFixed(0)}%)`)
        .join('\n');

      return {
        success: true,
        output: `Modules (${modules.length}):\n${output}`,
      };
    }

    case 'list-functions': {
      const spanId = globalTracer.startSpan('debug_list_functions');
      const inspector = createInspector(context.storage);
      const functions = await inspector.listFunctions();
      globalTracer.addEvent(spanId, 'list_complete', { count: functions.length });
      globalTracer.endSpan(spanId);

      const output = functions
        .slice(0, 50) // Limit output
        .map(f => `  ${f.name} in ${f.filePath} (confidence: ${(f.confidence * 100).toFixed(0)}%)`)
        .join('\n');

      const suffix = functions.length > 50 ? `\n  ... and ${functions.length - 50} more` : '';

      return {
        success: true,
        output: `Functions (${functions.length}):\n${output}${suffix}`,
      };
    }

    default:
      return {
        success: false,
        output: '',
        error: `Unknown operation: ${operation}. Supported: query, list-modules, list-functions`,
      };
  }
}

/**
 * Show confidence breakdown for an entity.
 */
export async function confidenceCommand(
  id: string,
  context: DebugCommandContext
): Promise<DebugCommandResult> {
  const inspector = createInspector(context.storage);
  const info = await inspector.inspectConfidence(id);

  if (!info) {
    return {
      success: false,
      output: '',
      error: `Entity not found: ${id}`,
    };
  }

  return {
    success: true,
    output: formatConfidenceInspection(info),
  };
}

/**
 * Find entities with low confidence.
 */
export async function lowConfidenceCommand(
  threshold: number,
  context: DebugCommandContext
): Promise<DebugCommandResult> {
  const inspector = createInspector(context.storage);
  const entities = await inspector.findLowConfidenceEntities(threshold);

  if (entities.length === 0) {
    return {
      success: true,
      output: `No entities found with confidence below ${(threshold * 100).toFixed(0)}%`,
    };
  }

  const output = entities
    .map(e => `  [${e.entityType}] ${e.entityId}: ${(e.confidence * 100).toFixed(0)}% - ${e.reason}`)
    .join('\n');

  return {
    success: true,
    output: `Low confidence entities (threshold: ${(threshold * 100).toFixed(0)}%):\n${output}`,
  };
}

// ============================================================================
// FORMATTERS
// ============================================================================

function formatModuleInspection(info: Awaited<ReturnType<ReturnType<typeof createInspector>['inspectModule']>>): string {
  if (!info) return 'Module not found';

  const lines = [
    `Module: ${info.path}`,
    `ID: ${info.id}`,
    `Purpose: ${info.purpose}`,
    `Confidence: ${(info.confidence * 100).toFixed(0)}%`,
    '',
    `Exports (${info.exports.length}):`,
    ...info.exports.map(e => `  - ${e}`),
    '',
    `Dependencies (${info.dependencies.length}):`,
    ...info.dependencies.map(d => `  - ${d}`),
    '',
    `Dependents (${info.dependents.length}):`,
    ...info.dependents.slice(0, 10).map(d => `  - ${d}`),
    info.dependents.length > 10 ? `  ... and ${info.dependents.length - 10} more` : '',
    '',
    `Functions (${info.functions.length}):`,
    ...info.functions.slice(0, 10).map(f => `  - ${f.name}: ${(f.confidence * 100).toFixed(0)}%`),
    info.functions.length > 10 ? `  ... and ${info.functions.length - 10} more` : '',
  ].filter(Boolean);

  if (info.graphMetrics) {
    lines.push('', 'Graph Metrics:');
    lines.push(`  PageRank: ${info.graphMetrics.pagerank.toFixed(4)}`);
    lines.push(`  Betweenness: ${info.graphMetrics.betweenness.toFixed(4)}`);
    lines.push(`  Closeness: ${info.graphMetrics.closeness.toFixed(4)}`);
    if (info.graphMetrics.communityId !== null) {
      lines.push(`  Community: ${info.graphMetrics.communityId}`);
    }
  }

  return lines.join('\n');
}

function formatFunctionInspection(info: Awaited<ReturnType<ReturnType<typeof createInspector>['inspectFunction']>>): string {
  if (!info) return 'Function not found';

  const lines = [
    `Function: ${info.name}`,
    `ID: ${info.id}`,
    `File: ${info.filePath}:${info.startLine}-${info.endLine}`,
    `Signature: ${info.signature}`,
    `Purpose: ${info.purpose}`,
    '',
    'Metrics:',
    `  Confidence: ${(info.confidence * 100).toFixed(0)}%`,
    `  Access Count: ${info.accessCount}`,
    `  Last Accessed: ${info.lastAccessed?.toISOString() ?? 'never'}`,
    `  Validation Count: ${info.validationCount}`,
    `  Has Embedding: ${info.hasEmbedding}`,
    '',
    'Outcome History:',
    `  Successes: ${info.outcomeHistory.successes}`,
    `  Failures: ${info.outcomeHistory.failures}`,
    `  Success Rate: ${(info.outcomeHistory.successRate * 100).toFixed(0)}%`,
    '',
    `Callers (${info.callers.length}):`,
    ...info.callers.slice(0, 5).map(c => `  - ${c}`),
    info.callers.length > 5 ? `  ... and ${info.callers.length - 5} more` : '',
    '',
    `Callees (${info.callees.length}):`,
    ...info.callees.slice(0, 5).map(c => `  - ${c}`),
    info.callees.length > 5 ? `  ... and ${info.callees.length - 5} more` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

function formatConfidenceInspection(info: Awaited<ReturnType<ReturnType<typeof createInspector>['inspectConfidence']>>): string {
  if (!info) return 'Entity not found';

  const lines = [
    `Confidence Breakdown for ${info.entityId}`,
    `Type: ${info.entityType}`,
    `Overall Confidence: ${(info.overallConfidence * 100).toFixed(0)}%`,
    '',
    'Breakdown:',
    `  Base Confidence: ${(info.breakdown.baseConfidence * 100).toFixed(0)}%`,
    `  Outcome Adjustment: ${info.breakdown.outcomeAdjustment >= 0 ? '+' : ''}${(info.breakdown.outcomeAdjustment * 100).toFixed(0)}%`,
    `  Time Decay: ${(info.breakdown.timeDecay * 100).toFixed(0)}%`,
    `  Access Bonus: +${(info.breakdown.accessBonus * 100).toFixed(0)}%`,
  ];

  if (info.recommendations.length > 0) {
    lines.push('', 'Recommendations:');
    for (const rec of info.recommendations) {
      lines.push(`  - ${rec}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

/**
 * Run a debug command from CLI arguments.
 */
export async function runDebugCommand(args: string[]): Promise<void> {
  const [command, ...rest] = args;

  if (!command || command === 'help' || command === '--help') {
    console.log(`
LiBrainian Debug Commands:

  inspect <id>              Inspect a module, function, or context pack
  trace <operation>         Trace an operation (query, list-modules, list-functions)
  confidence <id>           Show confidence breakdown for an entity
  low-confidence [threshold] Find entities with low confidence (default: 0.5)

Options for 'trace query':
  --intent <text>           Query intent (required)
  --files <path,...>        Affected files (optional)
  --depth <L0|L1|L2|L3>     Query depth (default: L1)

Examples:
  debug inspect src/api/index.ts
  debug trace query --intent "How does auth work?"
  debug confidence my-function-id
  debug low-confidence 0.4
`);
    return;
  }

  // Parse workspace from environment or use current directory
  const workspace = process.env.LIBRARIAN_WORKSPACE ?? process.cwd();
  const dbPath = process.env.LIBRARIAN_DB ?? await resolveDbPath(workspace);

  let storage: LiBrainianStorage | null = null;

  try {
    storage = await createSqliteStorage(dbPath);
    await storage.initialize();

    const context: DebugCommandContext = { storage, workspace };
    let result: DebugCommandResult;

    switch (command) {
      case 'inspect': {
        const id = rest[0];
        if (!id) {
          console.error('Error: inspect requires an entity ID');
          process.exitCode = 1;
          return;
        }
        result = await inspectCommand(id, context);
        break;
      }

      case 'trace': {
        const operation = rest[0];
        if (!operation) {
          console.error('Error: trace requires an operation');
          process.exitCode = 1;
          return;
        }
        const options = parseTraceOptions(rest.slice(1));
        result = await traceCommand(operation, options, context);
        break;
      }

      case 'confidence': {
        const id = rest[0];
        if (!id) {
          console.error('Error: confidence requires an entity ID');
          process.exitCode = 1;
          return;
        }
        result = await confidenceCommand(id, context);
        break;
      }

      case 'low-confidence': {
        const threshold = rest[0] ? parseFloat(rest[0]) : 0.5;
        result = await lowConfidenceCommand(threshold, context);
        break;
      }

      default:
        console.error(`Unknown command: ${command}. Use 'debug help' for usage.`);
        process.exitCode = 1;
        return;
    }

    if (result.success) {
      console.log(result.output);
    } else {
      console.error(`Error: ${result.error}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (storage) {
      await storage.close();
    }
  }
}

function parseTraceOptions(args: string[]): { intent?: string; files?: string[]; depth?: string } {
  const options: { intent?: string; files?: string[]; depth?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    if (arg === '--intent' && value) {
      options.intent = value;
      i++;
    } else if (arg === '--files' && value) {
      options.files = value.split(',');
      i++;
    } else if (arg === '--depth' && value) {
      options.depth = value;
      i++;
    }
  }

  return options;
}

// Run if executed directly
if (process.argv[1]?.includes('debug.ts') || process.argv[1]?.includes('debug.js')) {
  runDebugCommand(process.argv.slice(2)).catch(console.error);
}
