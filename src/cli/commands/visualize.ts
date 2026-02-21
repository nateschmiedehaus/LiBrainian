/**
 * @fileoverview Visualize command - Generate codebase diagrams
 *
 * Generates ASCII or Mermaid visualizations of the codebase structure,
 * dependencies, and health metrics.
 */
import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { ModuleKnowledge, FunctionKnowledge, GraphEdge } from '../../types.js';
import { createError } from '../errors.js';

export interface VisualizeCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

type OutputFormat = 'mermaid' | 'ascii';
type DiagramKind = 'dependency' | 'tree' | 'health' | 'stats';

export async function visualizeCommand(options: VisualizeCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;

  const { values } = parseArgs({
    args: rawArgs.slice(1), // Skip 'visualize' command
    options: {
      type: { type: 'string', default: 'dependency' },
      format: { type: 'string', default: 'ascii' },
      focus: { type: 'string' },
      depth: { type: 'string', default: '2' },
      'max-nodes': { type: 'string', default: '30' },
    },
    allowPositionals: true,
    strict: false,
  });

  const diagramType = values.type as DiagramKind;
  const format = values.format as OutputFormat;
  const focus = values.focus as string | undefined;
  const maxNodes = parseInt(values['max-nodes'] as string, 10);

  console.log('LiBrainian Visualize');
  console.log('===================\n');

  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);

  try {
    await storage.initialize();

    // Get data for visualization
    const modules = await storage.getModules();
    const functions = await storage.getFunctions();
    const edges = await storage.getGraphEdges({ limit: 1000 });

    if (modules.length === 0 && functions.length === 0) {
      console.log('No data available. Run `librainian bootstrap` first.');
      return;
    }

    console.log(`Found ${modules.length} modules, ${functions.length} functions, ${edges.length} edges`);
    console.log('');

    let output: string;

    switch (diagramType) {
      case 'stats':
        output = generateStats(modules, functions, edges);
        break;
      case 'health':
        output = generateHealthView(modules, functions);
        break;
      case 'tree':
        output = generateTreeView(modules, workspace, focus);
        break;
      case 'dependency':
      default:
        if (format === 'mermaid') {
          output = generateMermaidDeps(modules, edges, maxNodes, focus);
        } else {
          output = generateAsciiDeps(modules, edges, maxNodes, focus);
        }
    }

    console.log(output);
    console.log('');
    console.log(`---`);
    console.log(`Nodes: ${modules.length} | Edges: ${edges.length} | Format: ${format}`);

  } catch (error) {
    throw createError(
      'STORAGE_ERROR',
      error instanceof Error ? error.message : 'Failed to generate visualization'
    );
  } finally {
    await storage.close();
  }
}

function generateStats(
  modules: ModuleKnowledge[],
  functions: FunctionKnowledge[],
  edges: GraphEdge[]
): string {
  const lines: string[] = [];

  lines.push('CODEBASE STATISTICS');
  lines.push('===================');
  lines.push('');

  // Module stats
  lines.push(`Modules:    ${modules.length}`);
  lines.push(`Functions:  ${functions.length}`);
  lines.push(`Edges:      ${edges.length}`);
  lines.push('');

  // Edge type breakdown
  const edgeTypes = new Map<string, number>();
  for (const e of edges) {
    edgeTypes.set(e.edgeType, (edgeTypes.get(e.edgeType) || 0) + 1);
  }

  lines.push('Edge Types:');
  for (const [type, count] of edgeTypes) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push('');

  // Top modules by connections
  const moduleConnections = new Map<string, number>();
  for (const e of edges) {
    moduleConnections.set(e.fromId, (moduleConnections.get(e.fromId) || 0) + 1);
    moduleConnections.set(e.toId, (moduleConnections.get(e.toId) || 0) + 1);
  }

  const topModules = [...moduleConnections.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topModules.length > 0) {
    lines.push('Most Connected:');
    for (const [id, count] of topModules) {
      const name = id.split('/').pop() || id;
      lines.push(`  ${name}: ${count} connections`);
    }
  }

  return lines.join('\n');
}

function generateHealthView(
  modules: ModuleKnowledge[],
  functions: FunctionKnowledge[]
): string {
  const lines: string[] = [];

  lines.push('CODEBASE HEALTH');
  lines.push('===============');
  lines.push('');

  // Calculate overall confidence
  const avgModuleConf = modules.reduce((sum, m) => sum + m.confidence, 0) / Math.max(modules.length, 1);
  const avgFuncConf = functions.reduce((sum, f) => sum + f.confidence, 0) / Math.max(functions.length, 1);

  const health = avgModuleConf > 0.7 ? '🟢 HEALTHY' :
                 avgModuleConf > 0.4 ? '🟡 WARNING' : '🔴 CRITICAL';

  lines.push(`Overall Health: ${health}`);
  lines.push(`Module Confidence: ${(avgModuleConf * 100).toFixed(1)}%`);
  lines.push(`Function Confidence: ${(avgFuncConf * 100).toFixed(1)}%`);
  lines.push('');

  // Low confidence modules
  const lowConf = modules.filter(m => m.confidence < 0.5).slice(0, 5);
  if (lowConf.length > 0) {
    lines.push('Low Confidence Modules:');
    for (const m of lowConf) {
      const name = path.basename(m.path);
      lines.push(`  🔴 ${name}: ${(m.confidence * 100).toFixed(0)}%`);
    }
    lines.push('');
  }

  // High confidence modules
  const highConf = modules.filter(m => m.confidence > 0.8).slice(0, 5);
  if (highConf.length > 0) {
    lines.push('High Confidence Modules:');
    for (const m of highConf) {
      const name = path.basename(m.path);
      lines.push(`  🟢 ${name}: ${(m.confidence * 100).toFixed(0)}%`);
    }
  }

  return lines.join('\n');
}

function generateTreeView(
  modules: ModuleKnowledge[],
  workspace: string,
  focus?: string
): string {
  const lines: string[] = [];

  lines.push('MODULE TREE');
  lines.push('===========');
  lines.push('');

  // Build directory tree
  const tree = new Map<string, string[]>();

  for (const m of modules) {
    const relPath = m.path.replace(workspace + '/', '');
    if (focus && !relPath.includes(focus)) continue;

    const dir = path.dirname(relPath);
    const file = path.basename(relPath);

    if (!tree.has(dir)) {
      tree.set(dir, []);
    }
    tree.get(dir)!.push(file);
  }

  // Sort directories
  const sortedDirs = [...tree.keys()].sort();

  for (const dir of sortedDirs) {
    lines.push(`📁 ${dir}/`);
    const files = tree.get(dir)!.sort();
    for (let i = 0; i < files.length; i++) {
      const prefix = i === files.length - 1 ? '└── ' : '├── ';
      lines.push(`   ${prefix}${files[i]}`);
    }
  }

  return lines.join('\n');
}

function generateMermaidDeps(
  modules: ModuleKnowledge[],
  edges: GraphEdge[],
  maxNodes: number,
  focus?: string
): string {
  const lines: string[] = [];

  lines.push('```mermaid');
  lines.push('graph TD');

  // Filter modules
  let filteredModules = modules;
  if (focus) {
    filteredModules = modules.filter(m => m.path.includes(focus));
  }
  filteredModules = filteredModules.slice(0, maxNodes);

  const moduleIds = new Set(filteredModules.map(m => m.id));

  // Add nodes
  for (const m of filteredModules) {
    const name = path.basename(m.path).replace(/\./g, '_');
    const id = m.id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
    lines.push(`  ${id}[${name}]`);
  }

  // Add edges
  const addedEdges = new Set<string>();
  for (const e of edges) {
    if (!moduleIds.has(e.fromId) || !moduleIds.has(e.toId)) continue;
    const edgeKey = `${e.fromId}->${e.toId}`;
    if (addedEdges.has(edgeKey)) continue;
    addedEdges.add(edgeKey);

    const fromId = e.fromId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
    const toId = e.toId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
    lines.push(`  ${fromId} --> ${toId}`);
  }

  lines.push('```');

  return lines.join('\n');
}

function generateAsciiDeps(
  modules: ModuleKnowledge[],
  edges: GraphEdge[],
  maxNodes: number,
  focus?: string
): string {
  const lines: string[] = [];

  lines.push('DEPENDENCY GRAPH');
  lines.push('================');
  lines.push('');

  // Filter modules
  let filteredModules = modules;
  if (focus) {
    filteredModules = modules.filter(m => m.path.includes(focus));
  }
  filteredModules = filteredModules.slice(0, maxNodes);

  const moduleIds = new Set(filteredModules.map(m => m.id));

  // Build adjacency list
  const deps = new Map<string, string[]>();
  for (const e of edges) {
    if (!moduleIds.has(e.fromId) || !moduleIds.has(e.toId)) continue;
    if (!deps.has(e.fromId)) {
      deps.set(e.fromId, []);
    }
    deps.get(e.fromId)!.push(e.toId);
  }

  // Print each module with its deps
  for (const m of filteredModules) {
    const name = path.basename(m.path);
    const moduleDeps = deps.get(m.id) || [];

    if (moduleDeps.length === 0) {
      lines.push(`${name}`);
    } else {
      lines.push(`${name}`);
      for (let i = 0; i < moduleDeps.length; i++) {
        const prefix = i === moduleDeps.length - 1 ? '└── ' : '├── ';
        const depMod = modules.find(dm => dm.id === moduleDeps[i]);
        const depName = depMod ? path.basename(depMod.path) : moduleDeps[i];
        lines.push(`  ${prefix}${depName}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
