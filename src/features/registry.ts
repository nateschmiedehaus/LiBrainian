import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export type FeatureStatus = 'active' | 'limited' | 'inactive' | 'not_implemented' | 'experimental';
export type FeatureCategory = 'core' | 'experimental';
export type FeatureSurface = 'public' | 'internal';

export interface FeatureEntry {
  id: string;
  name: string;
  category: FeatureCategory;
  surface: FeatureSurface;
  status: FeatureStatus;
  description: string;
  requiresConfig: boolean;
  configHint?: string;
  docs: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function hasLlmConfiguration(): boolean {
  return Boolean(
    process.env.LIBRARIAN_LLM_PROVIDER
      || process.env.LIBRARIAN_LLM_MODEL
      || process.env.OPENAI_API_KEY
      || process.env.ANTHROPIC_API_KEY
  );
}

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    timeout: 2000,
  });
  return result.status === 0 || result.status === 1;
}

export async function collectFeatureRegistry(workspaceRoot: string): Promise<FeatureEntry[]> {
  const workspace = path.resolve(workspaceRoot);
  const librarianDir = path.join(workspace, '.librarian');
  const hasIndex = await exists(path.join(librarianDir, 'librarian.sqlite'));
  const hasHnsw = await exists(path.join(librarianDir, 'hnsw.bin'));
  const hasMemoryDb = await exists(path.join(librarianDir, 'memory.db'));
  const llmConfigured = hasLlmConfiguration();
  const hasTar = commandAvailable('tar');

  return [
    {
      id: 'bootstrap_tier_0_1',
      name: 'Bootstrap (Tier 0+1)',
      category: 'core',
      surface: 'public',
      status: hasIndex ? 'active' : 'inactive',
      description: 'Structural indexing without requiring remote LLM providers.',
      requiresConfig: !hasIndex,
      configHint: hasIndex ? undefined : 'Run `librainian bootstrap` to initialize the index.',
      docs: 'docs/START_HERE.md',
    },
    {
      id: 'bootstrap_tier_2_3',
      name: 'Bootstrap (Tier 2+3)',
      category: 'core',
      surface: 'public',
      status: hasIndex && llmConfigured ? 'active' : hasIndex || llmConfigured ? 'limited' : 'inactive',
      description: 'LLM enrichment and synthesis-aware context-pack generation.',
      requiresConfig: !llmConfigured,
      configHint: llmConfigured ? undefined : 'Set LIBRARIAN_LLM_PROVIDER/LIBRARIAN_LLM_MODEL and provider API keys.',
      docs: 'docs/README.md',
    },
    {
      id: 'knowledge_graph',
      name: 'Knowledge Graph',
      category: 'core',
      surface: 'public',
      status: hasIndex ? 'active' : 'inactive',
      description: 'Call/import/usage graph and symbol relationship traversal.',
      requiresConfig: !hasIndex,
      configHint: hasIndex ? undefined : 'Requires bootstrap to materialize graph data.',
      docs: 'docs/README.md',
    },
    {
      id: 'semantic_search',
      name: 'Semantic Search',
      category: 'core',
      surface: 'public',
      status: hasHnsw ? 'active' : hasIndex ? 'limited' : 'inactive',
      description: 'Embedding-assisted retrieval and ranking for intent-driven questions.',
      requiresConfig: !hasHnsw,
      configHint: hasHnsw ? undefined : 'Run `librainian embed --fix` after bootstrap to maximize vector coverage.',
      docs: 'docs/README.md',
    },
    {
      id: 'lexical_search',
      name: 'Lexical Search',
      category: 'core',
      surface: 'public',
      status: hasIndex ? 'active' : 'inactive',
      description: 'Keyword/BM25-style retrieval fallback for deterministic lookups.',
      requiresConfig: !hasIndex,
      configHint: hasIndex ? undefined : 'Requires bootstrap to build lexical corpus.',
      docs: 'docs/README.md',
    },
    {
      id: 'mcp_server',
      name: 'MCP Server',
      category: 'core',
      surface: 'public',
      status: 'limited',
      description: 'Model Context Protocol tool surface for coding-agent integration.',
      requiresConfig: true,
      configHint: 'Run `librainian mcp --print-config` and register the generated config in your MCP client.',
      docs: 'docs/mcp-setup.md',
    },
    {
      id: 'agent_docs_injection',
      name: 'Agent Docs Injection',
      category: 'core',
      surface: 'internal',
      status: 'active',
      description: 'Auto-injected AGENTS.md/CLAUDE.md guidance with live capability snapshot.',
      requiresConfig: false,
      docs: 'AGENTS.md',
    },
    {
      id: 'hnsw_ann_index',
      name: 'HNSW ANN Index',
      category: 'core',
      surface: 'public',
      status: hasHnsw ? 'active' : 'inactive',
      description: 'Approximate nearest-neighbor acceleration for large vector corpora.',
      requiresConfig: !hasHnsw,
      configHint: hasHnsw ? undefined : 'Requires embedding generation before ANN persistence is enabled.',
      docs: 'docs/README.md',
    },
    {
      id: 'persistent_session_memory',
      name: 'Persistent Session Memory',
      category: 'core',
      surface: 'internal',
      status: hasMemoryDb ? 'experimental' : 'inactive',
      description: 'Cross-session semantic fact store with dedupe-aware updates.',
      requiresConfig: !hasMemoryDb,
      configHint: hasMemoryDb ? undefined : 'Use `memory_add` (MCP) or `librainian memory-bridge add ...` to initialize memory.',
      docs: 'docs/integrations/README.md',
    },
    {
      id: 'team_index_sharing',
      name: 'Team Index Sharing',
      category: 'core',
      surface: 'public',
      status: hasIndex && hasTar ? 'active' : hasIndex ? 'limited' : 'inactive',
      description: 'Portable export/import bundle workflow for CI and multi-machine reuse.',
      requiresConfig: !(hasIndex && hasTar),
      configHint: hasIndex
        ? hasTar ? undefined : 'Install `tar` so export/import bundle workflows can create portable archives.'
        : 'Create an index first so export/import has meaningful state to move between machines.',
      docs: 'docs/integrations/cli.md',
    },
    {
      id: 'constrained_generation',
      name: 'Constrained Generation',
      category: 'experimental',
      surface: 'internal',
      status: 'not_implemented',
      description: 'Schema-constrained synthesis output via guided decoding.',
      requiresConfig: true,
      configHint: 'Planned feature; not currently available in runtime.',
      docs: 'https://github.com/nateschmiedehaus/LiBrainian/issues/157',
    },
    {
      id: 'monorepo_workspace_set',
      name: 'Monorepo Workspace Set',
      category: 'experimental',
      surface: 'internal',
      status: 'not_implemented',
      description: 'Workspace-set indexing and cross-package graph routing for monorepos.',
      requiresConfig: true,
      configHint: 'Planned feature; track implementation in issue #168.',
      docs: 'https://github.com/nateschmiedehaus/LiBrainian/issues/168',
    },
  ];
}
