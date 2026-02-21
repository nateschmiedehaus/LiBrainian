/**
 * @fileoverview Pre-Change Analysis Command
 *
 * Uses librainian to analyze its own codebase before making changes.
 * This is the "eat your own dogfood" capability that enables safe self-modification.
 *
 * Usage:
 *   librainian analyze-change "add BM25 lexical search to retrieval pipeline"
 *   librainian analyze-change --files src/api/query.ts,src/api/embeddings.ts
 */

import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { queryLiBrainian } from '../../api/query.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import { createError } from '../errors.js';

export interface AnalyzeChangeOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

interface ImpactAnalysis {
  description: string;
  affectedModules: ModuleImpact[];
  affectedFunctions: FunctionImpact[];
  relatedTests: string[];
  risks: Risk[];
  suggestedOrder: string[];
}

interface ModuleImpact {
  path: string;
  name: string;
  exports: string[];
  importedBy: string[];
  changeRisk: 'low' | 'medium' | 'high';
}

interface FunctionImpact {
  name: string;
  file: string;
  callers: string[];
  callees: string[];
  hasTests: boolean;
}

interface Risk {
  severity: 'warning' | 'critical';
  description: string;
  mitigation: string;
}

export async function analyzeChangeCommand(options: AnalyzeChangeOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const workspaceRoot = path.resolve(workspace);

  const { values, positionals } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      files: { type: 'string' },
      depth: { type: 'string', default: 'L2' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const changeDescription = positionals.join(' ');
  const explicitFiles = values.files ? (values.files as string).split(',') : [];
  const depth = values.depth as 'L0' | 'L1' | 'L2' | 'L3';
  const outputJson = values.json as boolean;

  if (!changeDescription && explicitFiles.length === 0) {
    throw createError('INVALID_ARGUMENT', 'Provide a change description or --files list');
  }

  console.log('Pre-Change Impact Analysis');
  console.log('==========================\n');
  console.log(`Change: "${changeDescription || 'Explicit files specified'}"\n`);

  // Initialize storage
  const dbPath = path.join(workspaceRoot, '.librainian', 'librainian.db');
  const storage = createSqliteStorage(dbPath, workspaceRoot);

  try {
    await storage.initialize();

    const analysis = await performImpactAnalysis(
      storage,
      workspaceRoot,
      changeDescription,
      explicitFiles,
      depth
    );

    if (outputJson) {
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      printAnalysis(analysis);
    }

  } finally {
    await storage.close();
  }
}

async function performImpactAnalysis(
  storage: LiBrainianStorage,
  workspaceRoot: string,
  description: string,
  explicitFiles: string[],
  depth: 'L0' | 'L1' | 'L2' | 'L3'
): Promise<ImpactAnalysis> {
  const affectedModules: ModuleImpact[] = [];
  const affectedFunctions: FunctionImpact[] = [];
  const relatedTests: string[] = [];
  const risks: Risk[] = [];

  // Query librainian for relevant modules based on description
  if (description) {
    // Synthesis disabled via environment for impact analysis (we only need retrieval)
    const origSynthesis = process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
    process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = '1';
    const queryResult = await queryLiBrainian({
      intent: description,
      depth,
    }, storage);
    if (origSynthesis === undefined) {
      delete process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
    } else {
      process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = origSynthesis;
    }

    // Extract unique files from results
    const seenFiles = new Set<string>();

    for (const pack of queryResult.packs) {
      for (const file of pack.relatedFiles || []) {
        if (!seenFiles.has(file)) {
          seenFiles.add(file);

          const module = await storage.getModuleByPath(file);
          if (module) {
            // Get dependents (who imports this?)
            const edges = await storage.getGraphEdges({
              toIds: [module.id],
              edgeTypes: ['imports'],
            });
            const importedBy = edges.map(e => e.fromId);

            affectedModules.push({
              path: file,
              name: path.basename(module.path),
              exports: module.exports || [],
              importedBy,
              changeRisk: importedBy.length > 5 ? 'high' : importedBy.length > 2 ? 'medium' : 'low',
            });
          }
        }
      }

      // Extract functions
      if (pack.packType === 'function_context' && pack.targetId) {
        const fn = await storage.getFunction(pack.targetId);
        if (fn) {
          // Get callers
          const callerEdges = await storage.getGraphEdges({
            toIds: [fn.id],
            edgeTypes: ['calls'],
          });

          // Get callees
          const calleeEdges = await storage.getGraphEdges({
            fromIds: [fn.id],
            edgeTypes: ['calls'],
          });

          affectedFunctions.push({
            name: fn.name,
            file: fn.filePath,
            callers: callerEdges.map(e => e.fromId),
            callees: calleeEdges.map(e => e.toId),
            hasTests: fn.filePath.includes('.test.') || fn.filePath.includes('.spec.'),
          });
        }
      }
    }

    // Find related tests
    for (const mod of affectedModules) {
      const testPath = mod.path.replace(/\.ts$/, '.test.ts');
      const testModule = await storage.getModuleByPath(testPath);
      if (testModule) {
        relatedTests.push(testPath);
      }

      // Also check __tests__ directory
      const dirTestPath = mod.path.replace(/\/([^/]+)\.ts$/, '/__tests__/$1.test.ts');
      const dirTestModule = await storage.getModuleByPath(dirTestPath);
      if (dirTestModule) {
        relatedTests.push(dirTestPath);
      }
    }
  }

  // Add explicit files
  for (const file of explicitFiles) {
    const fullPath = path.resolve(workspaceRoot, file);
    const module = await storage.getModuleByPath(fullPath);
    if (module && !affectedModules.some(m => m.path === fullPath)) {
      const edges = await storage.getGraphEdges({
        toIds: [module.id],
        edgeTypes: ['imports'],
      });
      affectedModules.push({
        path: fullPath,
        name: path.basename(module.path),
        exports: module.exports || [],
        importedBy: edges.map(e => e.fromId),
        changeRisk: edges.length > 5 ? 'high' : edges.length > 2 ? 'medium' : 'low',
      });
    }
  }

  // Compute risks
  const highRiskModules = affectedModules.filter(m => m.changeRisk === 'high');
  if (highRiskModules.length > 0) {
    risks.push({
      severity: 'warning',
      description: `${highRiskModules.length} module(s) have many dependents`,
      mitigation: 'Ensure backward compatibility or update all dependents',
    });
  }

  const untestedFunctions = affectedFunctions.filter(f => !f.hasTests && f.callers.length > 0);
  if (untestedFunctions.length > 0) {
    risks.push({
      severity: 'warning',
      description: `${untestedFunctions.length} function(s) lack direct tests but are called by others`,
      mitigation: 'Add tests before modifying',
    });
  }

  if (relatedTests.length === 0 && affectedModules.length > 0) {
    risks.push({
      severity: 'critical',
      description: 'No related tests found for affected modules',
      mitigation: 'Create tests first (TDD approach)',
    });
  }

  // Compute suggested change order (dependencies first)
  const suggestedOrder = computeChangeOrder(affectedModules);

  return {
    description,
    affectedModules,
    affectedFunctions,
    relatedTests: [...new Set(relatedTests)],
    risks,
    suggestedOrder,
  };
}

function computeChangeOrder(modules: ModuleImpact[]): string[] {
  // Sort by number of dependents (least first) to minimize breakage during changes
  return modules
    .slice()
    .sort((a, b) => a.importedBy.length - b.importedBy.length)
    .map(m => m.path);
}

function printAnalysis(analysis: ImpactAnalysis): void {
  console.log('Affected Modules:');
  console.log('-----------------');
  if (analysis.affectedModules.length === 0) {
    console.log('  (none identified)\n');
  } else {
    for (const mod of analysis.affectedModules) {
      const riskBadge = mod.changeRisk === 'high' ? '[HIGH RISK]' :
                        mod.changeRisk === 'medium' ? '[MEDIUM]' : '[LOW]';
      console.log(`  ${riskBadge} ${mod.name}`);
      console.log(`    Path: ${mod.path}`);
      console.log(`    Exports: ${mod.exports.slice(0, 5).join(', ')}${mod.exports.length > 5 ? '...' : ''}`);
      console.log(`    Imported by: ${mod.importedBy.length} module(s)`);
      console.log();
    }
  }

  console.log('Affected Functions:');
  console.log('-------------------');
  if (analysis.affectedFunctions.length === 0) {
    console.log('  (none identified)\n');
  } else {
    for (const fn of analysis.affectedFunctions.slice(0, 10)) {
      const testBadge = fn.hasTests ? '[TESTED]' : '[UNTESTED]';
      console.log(`  ${testBadge} ${fn.name}`);
      console.log(`    File: ${fn.file}`);
      console.log(`    Callers: ${fn.callers.length}, Callees: ${fn.callees.length}`);
    }
    if (analysis.affectedFunctions.length > 10) {
      console.log(`  ... and ${analysis.affectedFunctions.length - 10} more`);
    }
    console.log();
  }

  console.log('Related Tests:');
  console.log('--------------');
  if (analysis.relatedTests.length === 0) {
    console.log('  (none found - CREATE TESTS FIRST)\n');
  } else {
    for (const test of analysis.relatedTests) {
      console.log(`  - ${test}`);
    }
    console.log();
  }

  console.log('Risks:');
  console.log('------');
  if (analysis.risks.length === 0) {
    console.log('  (none identified)\n');
  } else {
    for (const risk of analysis.risks) {
      const icon = risk.severity === 'critical' ? '!!!' : '(!)';
      console.log(`  ${icon} ${risk.description}`);
      console.log(`      Mitigation: ${risk.mitigation}`);
    }
    console.log();
  }

  console.log('Suggested Change Order:');
  console.log('-----------------------');
  if (analysis.suggestedOrder.length === 0) {
    console.log('  (no specific order needed)\n');
  } else {
    for (let i = 0; i < analysis.suggestedOrder.length; i++) {
      console.log(`  ${i + 1}. ${analysis.suggestedOrder[i]}`);
    }
    console.log();
  }

  console.log('='.repeat(50));
  console.log('TDD Reminder: Write tests BEFORE implementation!');
  console.log('='.repeat(50));
}
