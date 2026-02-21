/**
 * @fileoverview Inspect command - Inspect a module or function's knowledge
 */

import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { isBootstrapRequired } from '../../api/bootstrap.js';
import { createError } from '../errors.js';
import { printKeyValue, formatTimestamp } from '../progress.js';
import type { FunctionKnowledge, ModuleKnowledge, ContextPack } from '../../types.js';

export interface InspectCommandOptions {
  workspace: string;
  args: string[];
}

export async function inspectCommand(options: InspectCommandOptions): Promise<void> {
  const { workspace, args } = options;

  // Parse command-specific options
  const { values, positionals } = parseArgs({
    args,
    options: {
      type: { type: 'string', default: 'auto' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const target = positionals.join(' ');
  if (!target) {
    throw createError('INVALID_ARGUMENT', 'Module or function path/name is required. Usage: librainian inspect <path-or-name>');
  }

  const entityType = values.type as 'function' | 'module' | 'auto';
  const outputJson = values.json as boolean;

  // Initialize storage
  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();

  try {
    // Check if bootstrapped
    const bootstrapCheck = await isBootstrapRequired(workspace, storage);
    if (bootstrapCheck.required) {
      throw createError('NOT_BOOTSTRAPPED', bootstrapCheck.reason);
    }

    // Try to find the entity
    let foundFunction: FunctionKnowledge | null = null;
    let foundModule: ModuleKnowledge | null = null;
    let relatedPacks: ContextPack[] = [];

    // Normalize path
    const normalizedTarget = target.startsWith('/') ? target : path.join(workspace, target);
    const relativePath = path.relative(workspace, normalizedTarget);

    // Try to find module by path
    if (entityType === 'auto' || entityType === 'module') {
      const modules = await storage.getModules({ limit: 1000 });
      foundModule = modules.find((m) =>
        m.path === target ||
        m.path === normalizedTarget ||
        m.path === relativePath ||
        m.path.endsWith(target),
      ) || null;
    }

    // Try to find function by name or path
    if (entityType === 'auto' || entityType === 'function') {
      const functions = await storage.getFunctions({ limit: 1000 });

      // Try exact match first
      foundFunction = functions.find((f) => f.id === target) || null;

      // Try by name
      if (!foundFunction) {
        foundFunction = functions.find((f) => f.name === target) || null;
      }

      // Try by file path
      if (!foundFunction) {
        foundFunction = functions.find((f) =>
          f.filePath === target ||
          f.filePath === normalizedTarget ||
          f.filePath === relativePath ||
          f.filePath.endsWith(target),
        ) || null;
      }
    }

    if (!foundFunction && !foundModule) {
      throw createError('ENTITY_NOT_FOUND', `No module or function found matching: ${target}`);
    }

    // Get related context packs
    const entityId = foundFunction?.id || foundModule?.id;
    if (entityId) {
      const packs = await storage.getContextPacks({ limit: 100 });
      relatedPacks = packs.filter((p) => p.targetId === entityId || p.relatedFiles.some((f) => f.includes(target)));
    }

    // Output results
    if (outputJson) {
      console.log(JSON.stringify({
        function: foundFunction,
        module: foundModule,
        relatedPacks,
      }, null, 2));
      return;
    }

    console.log('Inspection Results');
    console.log('==================\n');

    if (foundModule) {
      console.log('Module:');
      printKeyValue([
        { key: 'ID', value: foundModule.id },
        { key: 'Path', value: foundModule.path },
        { key: 'Purpose', value: foundModule.purpose },
        { key: 'Confidence', value: foundModule.confidence.toFixed(3) },
      ]);
      console.log();

      if (foundModule.exports.length > 0) {
        console.log('Exports:');
        for (const exp of foundModule.exports.slice(0, 10)) {
          console.log(`  - ${exp}`);
        }
        if (foundModule.exports.length > 10) {
          console.log(`  ... and ${foundModule.exports.length - 10} more`);
        }
        console.log();
      }

      if (foundModule.dependencies.length > 0) {
        console.log('Dependencies:');
        for (const dep of foundModule.dependencies.slice(0, 10)) {
          console.log(`  - ${dep}`);
        }
        if (foundModule.dependencies.length > 10) {
          console.log(`  ... and ${foundModule.dependencies.length - 10} more`);
        }
        console.log();
      }
    }

    if (foundFunction) {
      console.log('Function:');
      printKeyValue([
        { key: 'ID', value: foundFunction.id },
        { key: 'Name', value: foundFunction.name },
        { key: 'File', value: foundFunction.filePath },
        { key: 'Lines', value: `${foundFunction.startLine}-${foundFunction.endLine}` },
        { key: 'Signature', value: foundFunction.signature },
        { key: 'Purpose', value: foundFunction.purpose },
        { key: 'Confidence', value: foundFunction.confidence.toFixed(3) },
        { key: 'Access Count', value: foundFunction.accessCount },
        { key: 'Last Accessed', value: formatTimestamp(foundFunction.lastAccessed) },
        { key: 'Validations', value: foundFunction.validationCount },
        { key: 'Successes', value: foundFunction.outcomeHistory.successes },
        { key: 'Failures', value: foundFunction.outcomeHistory.failures },
      ]);
      console.log();

      if (foundFunction.embedding) {
        console.log('Embedding: Present (' + foundFunction.embedding.length + ' dimensions)');
        console.log();
      }
    }

    if (relatedPacks.length > 0) {
      console.log('Related Context Packs:');
      for (const pack of relatedPacks.slice(0, 5)) {
        console.log(`\n  [${pack.packType}] ${pack.packId}`);
        console.log(`  Target: ${pack.targetId}`);
        console.log(`  Confidence: ${pack.confidence.toFixed(3)}`);
        console.log(`  Summary: ${pack.summary.substring(0, 80)}${pack.summary.length > 80 ? '...' : ''}`);
        console.log(`  Access Count: ${pack.accessCount}`);
        console.log(`  Last Outcome: ${pack.lastOutcome}`);
      }
      if (relatedPacks.length > 5) {
        console.log(`\n  ... and ${relatedPacks.length - 5} more packs`);
      }
      console.log();
    }

    // Get graph edges
    const graphEdges = await storage.getGraphEdges({
      fromIds: [entityId || ''],
      limit: 20,
    });

    if (graphEdges.length > 0) {
      console.log('Graph Relationships:');
      for (const edge of graphEdges) {
        console.log(`  ${edge.fromId} --[${edge.edgeType}]--> ${edge.toId}`);
      }
      console.log();
    }

    // Get functions in this file (if module)
    if (foundModule) {
      const functionsInModule = await storage.getFunctions({ limit: 100 });
      const moduleFunctions = functionsInModule.filter((f) =>
        f.filePath === foundModule.path ||
        f.filePath.endsWith(foundModule.path.split('/').pop() || ''),
      );

      if (moduleFunctions.length > 0) {
        console.log('Functions in Module:');
        for (const fn of moduleFunctions.slice(0, 10)) {
          console.log(`  - ${fn.name} (line ${fn.startLine}, confidence ${fn.confidence.toFixed(2)})`);
        }
        if (moduleFunctions.length > 10) {
          console.log(`  ... and ${moduleFunctions.length - 10} more functions`);
        }
        console.log();
      }
    }

  } finally {
    await storage.close();
  }
}
