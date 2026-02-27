import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type FeatureStatus = 'active' | 'limited' | 'inactive' | 'not_implemented' | 'experimental';
export type FeatureCategory = 'core' | 'experimental';

export interface FeatureEntry {
  id: string;
  name: string;
  category: FeatureCategory;
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

export async function collectFeatureRegistry(workspaceRoot: string): Promise<FeatureEntry[]> {
  const workspace = path.resolve(workspaceRoot);
  const librarianDir = path.join(workspace, '.librarian');
  const hasIndex = await exists(path.join(librarianDir, 'librarian.sqlite'));
  const hasHnsw = await exists(path.join(librarianDir, 'hnsw.bin'));
  const hasMemoryDb = await exists(path.join(librarianDir, 'memory.db'));
  const llmConfigured = hasLlmConfiguration();

  return [
    {
      id: 'bootstrap_tier_0_1',
      name: 'Bootstrap (Tier 0+1)',
      category: 'core',
      status: hasIndex ? 'active' : 'inactive',
      description: 'Structural indexing without requiring remote LLM providers.',
      requiresConfig: !hasIndex,
      configHint: hasIndex ? undefined : 'Run `librarian bootstrap` to initialize the index.',
      docs: 'docs/librarian/README.md',
    },
    {
      id: 'bootstrap_tier_2_3',
      name: 'Bootstrap (Tier 2+3)',
      category: 'core',
      status: llmConfigured ? 'active' : 'limited',
      description: 'LLM enrichment and synthesis-aware context-pack generation.',
      requiresConfig: !llmConfigured,
      configHint: llmConfigured ? undefined : 'Set LIBRARIAN_LLM_PROVIDER/LIBRARIAN_LLM_MODEL and provider API keys.',
      docs: 'docs/librarian/README.md',
    },
    {
      id: 'knowledge_graph',
      name: 'Knowledge Graph',
      category: 'core',
      status: hasIndex ? 'active' : 'inactive',
      description: 'Call/import/usage graph and symbol relationship traversal.',
      requiresConfig: !hasIndex,
      configHint: hasIndex ? undefined : 'Requires bootstrap to materialize graph data.',
      docs: 'docs/librarian/README.md',
    },
    {
      id: 'semantic_search',
      name: 'Semantic Search',
      category: 'core',
      status: hasHnsw ? 'active' : hasIndex ? 'limited' : 'inactive',
      description: 'Embedding-assisted retrieval and ranking for intent-driven questions.',
      requiresConfig: !hasHnsw,
      configHint: hasHnsw ? undefined : 'Run `librarian embed --fix` after bootstrap to maximize vector coverage.',
      docs: 'docs/librarian/README.md',
    },
    {
      id: 'lexical_search',
      name: 'Lexical Search',
      category: 'core',
      status: hasIndex ? 'active' : 'inactive',
      description: 'Keyword/BM25-style retrieval fallback for deterministic lookups.',
      requiresConfig: !hasIndex,
      configHint: hasIndex ? undefined : 'Requires bootstrap to build lexical corpus.',
      docs: 'docs/librarian/README.md',
    },
    {
      id: 'mcp_server',
      name: 'MCP Server',
      category: 'core',
      status: 'active',
      description: 'Model Context Protocol tool surface for coding-agent integration.',
      requiresConfig: false,
      docs: 'docs/librarian/README.md',
    },
    {
      id: 'agent_docs_injection',
      name: 'Agent Docs Injection',
      category: 'core',
      status: 'active',
      description: 'Auto-injected AGENTS.md/CLAUDE.md guidance with live capability snapshot.',
      requiresConfig: false,
      docs: 'src/ingest/docs_update.ts',
    },
    {
      id: 'hnsw_ann_index',
      name: 'HNSW ANN Index',
      category: 'core',
      status: hasHnsw ? 'active' : 'inactive',
      description: 'Approximate nearest-neighbor acceleration for large vector corpora.',
      requiresConfig: !hasHnsw,
      configHint: hasHnsw ? undefined : 'Requires embedding generation before ANN persistence is enabled.',
      docs: 'src/storage/__tests__/vector_index_persistence.test.ts',
    },
    {
      id: 'persistent_session_memory',
      name: 'Persistent Session Memory',
      category: 'core',
      status: hasMemoryDb ? 'experimental' : 'inactive',
      description: 'Cross-session semantic fact store with dedupe-aware updates.',
      requiresConfig: !hasMemoryDb,
      configHint: hasMemoryDb ? undefined : 'Use `memory_add` (MCP) or `librarian memory-bridge add ...` to initialize memory.',
      docs: 'src/memory/fact_store.ts',
    },
    {
      id: 'team_index_sharing',
      name: 'Team Index Sharing',
      category: 'core',
      status: 'active',
      description: 'Portable export/import bundle workflow for CI and multi-machine reuse.',
      requiresConfig: false,
      docs: 'src/cli/commands/index_state_bundle.ts',
    },
    {
      id: 'constrained_generation',
      name: 'Constrained Generation',
      category: 'experimental',
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
      status: 'not_implemented',
      description: 'Workspace-set indexing and cross-package graph routing for monorepos.',
      requiresConfig: true,
      configHint: 'Planned feature; track implementation in issue #168.',
      docs: 'https://github.com/nateschmiedehaus/LiBrainian/issues/168',
    },
  ];
}
