/**
 * Automatic Docs Update - Updates repo agent docs with librarian usage info
 *
 * During bootstrap/indexing, this module:
 * 1. Detects AGENTS.md, CLAUDE.md, or similar files in the repo
 * 2. Generates a librarian usage section with current capabilities
 * 3. Inserts or updates the section (idempotent)
 *
 * Philosophy: Keep the team informed about librarian capabilities
 * without requiring manual documentation updates.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'node:crypto';
import type { BootstrapCapabilities, BootstrapReport } from '../types.js';

export interface DocsUpdateConfig {
  /** Workspace root directory */
  workspace: string;
  /** Bootstrap report with capabilities and stats */
  report: BootstrapReport;
  /** Capabilities determined during bootstrap */
  capabilities: BootstrapCapabilities;
  /** Dry run mode - don't actually write files */
  dryRun?: boolean;
  /** Skip if section already exists (default: false - update if stale) */
  skipIfExists?: boolean;
  /** Skip CLAUDE.md updates even when agent docs updates are enabled */
  noClaudeMd?: boolean;
}

export interface DocsUpdateResult {
  /** Files that were updated */
  filesUpdated: string[];
  /** Files that were checked but not updated */
  filesSkipped: string[];
  /** Non-fatal warnings (e.g., hash mismatch protection) */
  warnings: string[];
  /** Any errors encountered */
  errors: string[];
  /** Whether the update was successful */
  success: boolean;
}

export interface EjectInjectedDocsConfig {
  workspace: string;
  dryRun?: boolean;
}

export interface EjectInjectedDocsResult {
  filesUpdated: string[];
  filesSkipped: string[];
  warnings: string[];
  errors: string[];
  success: boolean;
}

const LIBRARIAN_SECTION_START = '<!-- LIBRARIAN_DOCS_START -->';
const LIBRARIAN_SECTION_END = '<!-- LIBRARIAN_DOCS_END -->';
const LIBRARIAN_SECTION_NAME = 'LIBRARIAN_DOCS';
const LIBRARIAN_STATE_PATH = ['.librarian', 'state.json'];

const AGENT_DOC_PATTERNS = [
  'AGENTS.md',
  'docs/AGENTS.md',
  'CLAUDE.md',
  'docs/CLAUDE.md',
  'CODEX.md',
  'docs/CODEX.md',
  '.github/AGENTS.md',
];

interface LibrarianState {
  schema_version?: number;
  docs?: {
    claudeFileHashes?: Record<string, string>;
    updatedAt?: string;
  };
  [key: string]: unknown;
}

/**
 * Update repo documentation with librarian usage information.
 * Called automatically after successful bootstrap.
 */
export async function updateRepoDocs(config: DocsUpdateConfig): Promise<DocsUpdateResult> {
  const result: DocsUpdateResult = {
    filesUpdated: [],
    filesSkipped: [],
    warnings: [],
    errors: [],
    success: true,
  };

  const { workspace, report, capabilities, dryRun, skipIfExists, noClaudeMd } = config;

  // Find agent documentation files
  const agentDocs = await findAgentDocs(workspace);

  if (agentDocs.length === 0) {
    result.filesSkipped.push('(no agent docs found)');
    return result;
  }

  // Generate the librarian section content
  const sectionContent = generateLibrarianSection(report, capabilities);
  const sectionLineCount = sectionContent.split('\n').length;
  const state = await readLibrarianState(workspace);
  const claudeFileHashes = state.docs?.claudeFileHashes ?? {};
  let stateChanged = false;

  for (const docPath of agentDocs) {
    const relativePath = toStatePath(workspace, docPath);
    try {
      if (noClaudeMd && isClaudeDoc(docPath)) {
        result.filesSkipped.push(relativePath);
        continue;
      }

      const existingContent = await fs.readFile(docPath, 'utf-8');
      if (isClaudeDoc(docPath)) {
        const storedHash = claudeFileHashes[relativePath];
        const currentHash = sha256(existingContent);
        if (storedHash && storedHash !== currentHash) {
          const warning = `Skipped ${relativePath}: hash mismatch since last librarian inject.`;
          result.warnings.push(warning);
          console.warn(`[librainian] ${warning}`);
          result.filesSkipped.push(relativePath);
          continue;
        }
      }

      const updateResult = await updateDocFile(docPath, sectionContent, {
        dryRun,
        skipIfExists,
        existingContent,
        onWrite: isClaudeDoc(docPath)
          ? () => {
              console.log(
                `[librainian] Writing docs to ${relativePath} (section: ${LIBRARIAN_SECTION_NAME}, ${sectionLineCount} lines). To remove: npx librainian eject-docs`
              );
            }
          : undefined,
      });
      if (updateResult.updated) {
        result.filesUpdated.push(relativePath);
        if (!dryRun && isClaudeDoc(docPath)) {
          claudeFileHashes[relativePath] = sha256(updateResult.content);
          stateChanged = true;
        }
      } else {
        result.filesSkipped.push(relativePath);
      }
    } catch (error) {
      result.errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      result.success = false;
    }
  }

  if (!dryRun && stateChanged) {
    state.schema_version = state.schema_version ?? 1;
    state.docs = state.docs ?? {};
    state.docs.claudeFileHashes = claudeFileHashes;
    state.docs.updatedAt = new Date().toISOString();
    await writeLibrarianState(workspace, state);
  }

  return result;
}

export async function ejectInjectedDocs(config: EjectInjectedDocsConfig): Promise<EjectInjectedDocsResult> {
  const result: EjectInjectedDocsResult = {
    filesUpdated: [],
    filesSkipped: [],
    warnings: [],
    errors: [],
    success: true,
  };

  const { workspace, dryRun } = config;
  const claudeDocs = (await findAgentDocs(workspace)).filter((docPath) => isClaudeDoc(docPath));
  const state = await readLibrarianState(workspace);
  const claudeFileHashes = state.docs?.claudeFileHashes ?? {};
  let stateChanged = false;

  if (claudeDocs.length === 0) {
    result.filesSkipped.push('(no claude docs found)');
    return result;
  }

  for (const docPath of claudeDocs) {
    const relativePath = toStatePath(workspace, docPath);
    try {
      const content = await fs.readFile(docPath, 'utf-8');
      const stripped = stripInjectedSections(content);
      if (stripped.removedCount === 0) {
        result.filesSkipped.push(relativePath);
        continue;
      }

      if (!dryRun) {
        await fs.writeFile(docPath, stripped.content, 'utf-8');
        if (relativePath in claudeFileHashes) {
          delete claudeFileHashes[relativePath];
          stateChanged = true;
        }
      }

      result.filesUpdated.push(relativePath);
    } catch (error) {
      result.errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      result.success = false;
    }
  }

  if (!dryRun && stateChanged) {
    state.schema_version = state.schema_version ?? 1;
    state.docs = state.docs ?? {};
    state.docs.claudeFileHashes = claudeFileHashes;
    state.docs.updatedAt = new Date().toISOString();
    await writeLibrarianState(workspace, state);
  }

  return result;
}

/**
 * Find agent documentation files in the workspace.
 */
async function findAgentDocs(workspace: string): Promise<string[]> {
  const found: string[] = [];

  for (const pattern of AGENT_DOC_PATTERNS) {
    const fullPath = path.join(workspace, pattern);
    try {
      await fs.access(fullPath);
      found.push(fullPath);
    } catch {
      // File doesn't exist, skip
    }
  }

  return found;
}

/**
 * Generate the librarian documentation section content.
 */
function generateLibrarianSection(report: BootstrapReport, capabilities: BootstrapCapabilities): string {
  const stats = report.phases.reduce((acc, phase) => {
    acc[phase.phase.name] = phase.itemsProcessed;
    return acc;
  }, {} as Record<string, number>);

  const availableCapabilities = Object.entries(capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => formatCapabilityName(name));

  const limitedCapabilities = Object.entries(capabilities)
    .filter(([, enabled]) => !enabled)
    .map(([name]) => formatCapabilityName(name));

  const lastIndexed = report.completedAt?.toISOString() ?? new Date().toISOString();

  const lines: string[] = [
    LIBRARIAN_SECTION_START,
    '',
    '## LiBrainian: Codebase Knowledge System',
    '',
    '> Auto-generated by LiBrainian bootstrap. Do not edit manually.',
    '',
    '### What is LiBrainian?',
    '',
    'LiBrainian is the **codebase knowledge backbone** for AI coding agents. It provides:',
    '- **Semantic search**: Find code by meaning, not just keywords',
    '- **Context packs**: Pre-computed context for common tasks',
    '- **Function knowledge**: Purpose, signatures, and relationships',
    '- **Graph analysis**: Call graphs, import graphs, and metrics',
    '',
    '### How to Use LiBrainian',
    '',
    '```typescript',
    '// 1. Get the LiBrainian instance',
    "import { initializeLibrarian } from 'librainian';",
    'const librainian = await initializeLibrarian(workspaceRoot);',
    '',
    '// 2. Query for context',
    "const context = await librainian.query('How does authentication work?');",
    '',
    '// 3. Use in prompts',
    'const prompt = `Given this context:\\n${context}\\nImplement...`;',
    '```',
    '',
    '### Current Capabilities',
    '',
    availableCapabilities.length > 0
      ? `**Available**: ${availableCapabilities.join(', ')}`
      : '*No capabilities currently available*',
    '',
    limitedCapabilities.length > 0
      ? `**Limited/Unavailable**: ${limitedCapabilities.join(', ')}`
      : '',
    '',
    '### Index Statistics',
    '',
    `- **Last indexed**: ${lastIndexed}`,
    `- **Files processed**: ${report.totalFilesProcessed}`,
    `- **Functions indexed**: ${report.totalFunctionsIndexed}`,
    `- **Context packs**: ${report.totalContextPacksCreated}`,
    '',
    '### Key Documentation',
    '',
    '- **Entry point**: `docs/librarian/README.md`',
    '- **API reference**: `src/librarian/api/README.md`',
    '- **Query guide**: `docs/librarian/query-guide.md`',
    '',
    '### When to Re-index',
    '',
    'LiBrainian auto-watches for changes. Manual reindex needed when:',
    '- Major refactoring (>50 files changed)',
    '- After git operations that bypass file watchers',
    '- When embeddings seem stale',
    '',
    '```bash',
    '# Trigger manual reindex',
    'npx librainian reindex --force',
    '```',
    '',
    LIBRARIAN_SECTION_END,
  ].filter(line => line !== ''); // Remove empty lines between filtered capability lines

  return lines.join('\n');
}

/**
 * Format a capability name for display.
 */
function formatCapabilityName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim()
    .replace(/^has /, '');
}

/**
 * Update a documentation file with the librarian section.
 */
async function updateDocFile(
  filePath: string,
  sectionContent: string,
  options: {
    dryRun?: boolean;
    skipIfExists?: boolean;
    existingContent?: string;
    onWrite?: () => void;
  }
): Promise<{ updated: boolean; content: string }> {
  const content = options.existingContent ?? await fs.readFile(filePath, 'utf-8');

  const hasSection = content.includes(LIBRARIAN_SECTION_START);

  if (hasSection && options.skipIfExists) {
    return { updated: false, content };
  }

  let newContent: string;

  if (hasSection) {
    // Replace existing section
    const startIdx = content.indexOf(LIBRARIAN_SECTION_START);
    const endIdx = content.indexOf(LIBRARIAN_SECTION_END);

    if (endIdx === -1) {
      // Malformed - append end marker
      newContent = content.replace(
        LIBRARIAN_SECTION_START,
        sectionContent
      );
    } else {
      const before = content.substring(0, startIdx);
      const after = content.substring(endIdx + LIBRARIAN_SECTION_END.length);
      newContent = before + sectionContent + after;
    }
  } else {
    // Append new section
    newContent = content.trimEnd() + '\n\n---\n\n' + sectionContent + '\n';
  }

  // Check if content actually changed
  if (newContent === content) {
    return { updated: false, content };
  }

  if (!options.dryRun) {
    options.onWrite?.();
    await fs.writeFile(filePath, newContent, 'utf-8');
  }

  return { updated: true, content: newContent };
}

/**
 * Check if librarian docs update is needed.
 */
export async function isDocsUpdateNeeded(workspace: string): Promise<boolean> {
  const agentDocs = await findAgentDocs(workspace);

  for (const docPath of agentDocs) {
    try {
      const content = await fs.readFile(docPath, 'utf-8');
      if (!content.includes(LIBRARIAN_SECTION_START)) {
        return true;
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }

  return false;
}

function isClaudeDoc(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === 'claude.md';
}

function toStatePath(workspace: string, filePath: string): string {
  return path.relative(workspace, filePath).split(path.sep).join('/');
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

async function readLibrarianState(workspace: string): Promise<LibrarianState> {
  const statePath = path.join(workspace, ...LIBRARIAN_STATE_PATH);
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as LibrarianState;
    if (!parsed || typeof parsed !== 'object') {
      return { schema_version: 1 };
    }
    return parsed;
  } catch {
    return { schema_version: 1 };
  }
}

async function writeLibrarianState(workspace: string, state: LibrarianState): Promise<void> {
  const stateDir = path.join(workspace, '.librarian');
  const statePath = path.join(stateDir, 'state.json');
  const tmpPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  await fs.rename(tmpPath, statePath);
}

function stripInjectedSections(content: string): { content: string; removedCount: number } {
  let next = content;
  let removedCount = 0;

  while (true) {
    const start = next.indexOf(LIBRARIAN_SECTION_START);
    if (start === -1) {
      break;
    }
    const end = next.indexOf(LIBRARIAN_SECTION_END, start);
    let removalStart = start;
    const separator = '\n\n---\n\n';
    if (removalStart >= separator.length && next.slice(removalStart - separator.length, removalStart) === separator) {
      removalStart -= separator.length;
    }
    let removalEnd = end === -1 ? next.length : end + LIBRARIAN_SECTION_END.length;
    while (removalEnd < next.length && (next[removalEnd] === '\n' || next[removalEnd] === '\r')) {
      removalEnd += 1;
    }
    next = `${next.slice(0, removalStart)}${next.slice(removalEnd)}`;
    removedCount += 1;
  }

  return {
    content: next.replace(/\n{3,}/g, '\n\n'),
    removedCount,
  };
}
