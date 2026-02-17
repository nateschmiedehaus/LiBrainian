/**
 * @fileoverview Directory-level Knowledge Extractor
 *
 * Extracts comprehensive semantic understanding of directories including:
 * - Purpose and role in the architecture
 * - Organization pattern (flat, nested, hybrid)
 * - Bounded context identification (DDD)
 * - Structural metrics (file count, types)
 * - Relationships (parent, siblings, related)
 *
 * Uses LLM for deep semantic analysis (no heuristic fallbacks).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { DirectoryKnowledge } from '../../types.js';
import { resolveLlmServiceAdapter } from '../../adapters/llm_service.js';
import { resolveLibrarianModelId } from '../../api/llm_env.js';
import { buildLlmEvidence, type LlmEvidence } from './llm_evidence.js';

export interface DirectoryExtractionInput {
  absolutePath: string;
  workspaceRoot: string;
  files?: string[]; // List of files in this directory (if pre-scanned)
  subdirs?: string[]; // List of subdirectories (if pre-scanned)
  totalFiles?: number; // Pre-computed total file count (avoids redundant I/O)
}

export interface DirectoryExtractionConfig {
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
  skipLlm?: boolean;
}

export interface DirectoryExtractionResult {
  directory: DirectoryKnowledge;
  confidence: number;
}

// Role detection patterns
const ROLE_PATTERNS: Record<DirectoryKnowledge['role'], RegExp[]> = {
  feature: [/feature/i, /module/i, /domain/i, /^[a-z]+-/i],
  layer: [/controller/i, /service/i, /repository/i, /model/i, /view/i, /presenter/i, /api/i],
  utility: [/util/i, /helper/i, /common/i, /shared/i, /lib/i],
  config: [/config/i, /settings/i, /env/i, /\.config$/i],
  tests: [/__tests__/i, /test/i, /spec/i, /e2e/i],
  docs: [/doc/i, /docs/i, /documentation/i],
  root: [/^src$/i, /^app$/i, /^lib$/i],
  other: [],
};

// Bounded context patterns for DDD
const BOUNDED_CONTEXT_PATTERNS: Record<string, RegExp[]> = {
  'authentication': [/auth/i, /login/i, /session/i, /identity/i],
  'user-management': [/user/i, /account/i, /profile/i, /member/i],
  'billing': [/billing/i, /payment/i, /subscription/i, /invoice/i],
  'notification': [/notification/i, /alert/i, /message/i, /email/i],
  'analytics': [/analytic/i, /metric/i, /telemetry/i, /tracking/i],
  'search': [/search/i, /query/i, /filter/i, /index/i],
  'content': [/content/i, /article/i, /post/i, /media/i],
  'workflow': [/workflow/i, /process/i, /pipeline/i, /job/i],
  'integration': [/integration/i, /adapter/i, /gateway/i, /client/i],
  'orchestration': [/orchestrat/i, /coordinat/i, /dispatch/i],
};

export async function extractDirectoryKnowledge(
  input: DirectoryExtractionInput,
  config: DirectoryExtractionConfig = {}
): Promise<DirectoryExtractionResult> {
  const { absolutePath, workspaceRoot } = input;

  const relativePath = path.relative(workspaceRoot, absolutePath);
  const name = path.basename(absolutePath);

  // Scan directory if not pre-scanned
  let files = input.files || [];
  let subdirs = input.subdirs || [];

  if (!input.files || !input.subdirs) {
    try {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      files = entries.filter((e) => e.isFile()).map((e) => e.name);
      subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      // Directory might not exist or be accessible
    }
  }

  // Calculate depth from workspace root
  const depth = relativePath === '' ? 0 : relativePath.split(path.sep).length;

  // Count files by type
  const fileTypes: Record<string, number> = {};
  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || '.no-ext';
    fileTypes[ext] = (fileTypes[ext] || 0) + 1;
  }

  // Detect directory role
  const role = detectRole(name, relativePath);

  // Detect bounded context
  const boundedContext = detectBoundedContext(name, relativePath);

  // Detect organization pattern
  const pattern = detectPattern(files.length, subdirs.length);

  // Detect special files
  const hasReadme = files.some((f) => /^readme/i.test(f));
  const hasIndex = files.some((f) => /^index\.[jt]sx?$/i.test(f));
  const hasTests = subdirs.some((d) => /__tests__|test/i.test(d)) ||
                   files.some((f) => /\.(test|spec)\.[jt]sx?$/i.test(f));

  // Identify main files
  const mainFiles = identifyMainFiles(files);

  // Determine complexity
  const complexity = determineComplexity(files.length, subdirs.length, depth);

  // Use pre-computed totalFiles if available, otherwise count recursively (slower)
  const totalFiles = input.totalFiles ?? await countTotalFiles(absolutePath);

  // Get parent and siblings info
  const parent = relativePath ? path.dirname(absolutePath) : null;
  const siblings = await getSiblings(absolutePath, parent);

  // Generate purpose and description (LLM when available, otherwise heuristic fallback)
  let purpose: string;
  let description: string;
  let confidence = 0.1;
  let llmEvidence: LlmEvidence | undefined;
  const heuristic = extractHeuristicSemantics(name, relativePath, role, boundedContext, files, subdirs);
  if (config.skipLlm || !config.llmProvider) {
    purpose = heuristic.purpose;
    description = heuristic.description;
    confidence = heuristic.confidence;
    // No llmEvidence - no LLM was used
  } else {
    try {
      // Use LLM for semantic extraction
      const llmResult = await extractDirectorySemantics(
        name,
        relativePath,
        files,
        subdirs,
        role,
        config
      );
      purpose = llmResult.purpose;
      description = llmResult.description;
      confidence = llmResult.confidence;
      llmEvidence = llmResult.llmEvidence; // Capture LLM evidence when available
    } catch {
      purpose = heuristic.purpose;
      description = heuristic.description;
      confidence = heuristic.confidence;
      llmEvidence = undefined;
    }
  }

  // Find related directories based on naming patterns
  const relatedDirectories = findRelatedDirectories(name, relativePath);

  const id = createHash('sha256').update(absolutePath).digest('hex').slice(0, 16);

  return {
    directory: {
      id,
      path: absolutePath,
      relativePath: relativePath || '.',
      name: name || path.basename(workspaceRoot),
      fingerprint: '',
      purpose,
      role,
      description,
      boundedContext,
      pattern,
      depth,
      fileCount: files.length,
      subdirectoryCount: subdirs.length,
      totalFiles,
      mainFiles,
      subdirectories: subdirs,
      fileTypes,
      parent,
      siblings,
      relatedDirectories,
      hasReadme,
      hasIndex,
      hasTests,
      complexity,
      confidence,
      lastIndexed: new Date().toISOString(),
      llmEvidence, // Include LLM evidence when available
    },
    confidence,
  };
}

function detectRole(name: string, relativePath: string): DirectoryKnowledge['role'] {
  // Check if it's the root src directory
  if (/^(src|app|lib)$/i.test(name) && !relativePath.includes(path.sep)) {
    return 'root';
  }

  for (const [role, patterns] of Object.entries(ROLE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(name) || pattern.test(relativePath)) {
        return role as DirectoryKnowledge['role'];
      }
    }
  }
  return 'other';
}

function detectBoundedContext(name: string, relativePath: string): string | undefined {
  for (const [context, patterns] of Object.entries(BOUNDED_CONTEXT_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(name) || pattern.test(relativePath)) {
        return context;
      }
    }
  }
  return undefined;
}

function detectPattern(fileCount: number, subdirCount: number): DirectoryKnowledge['pattern'] {
  if (subdirCount === 0) return 'flat';
  if (fileCount <= 2) return 'nested';
  return 'hybrid';
}

function identifyMainFiles(files: string[]): string[] {
  const priority = [
    /^index\.[jt]sx?$/i,
    /^main\.[jt]sx?$/i,
    /^app\.[jt]sx?$/i,
    /^readme\.md$/i,
    /^package\.json$/i,
    /^tsconfig\.json$/i,
    /\.config\.[jt]s$/i,
  ];

  const main: string[] = [];
  for (const pattern of priority) {
    for (const file of files) {
      if (pattern.test(file) && !main.includes(file)) {
        main.push(file);
      }
    }
  }

  return main.slice(0, 5);
}

function determineComplexity(fileCount: number, subdirCount: number, depth: number): DirectoryKnowledge['complexity'] {
  const total = fileCount + subdirCount * 2;

  if (total < 5 && depth < 3) return 'low';
  if (total < 15 && depth < 4) return 'medium'; // Fixed: was || which made this always match for shallow dirs
  return 'high';
}

async function countTotalFiles(dirPath: string): Promise<number> {
  let count = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        count++;
      } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        count += await countTotalFiles(path.join(dirPath, entry.name));
      }
    }
  } catch {
    // Ignore errors
  }
  return count;
}

async function getSiblings(dirPath: string, parent: string | null): Promise<string[]> {
  if (!parent) return [];

  try {
    const entries = await fs.readdir(parent, { withFileTypes: true });
    const dirName = path.basename(dirPath);
    return entries
      .filter((e) => e.isDirectory() && e.name !== dirName && !e.name.startsWith('.'))
      .map((e) => e.name)
      .slice(0, 10);
  } catch {
    return [];
  }
}

function findRelatedDirectories(name: string, relativePath: string): string[] {
  const related: string[] = [];

  // Common related directory patterns
  const relationships: Record<string, string[]> = {
    components: ['hooks', 'contexts', 'providers'],
    hooks: ['components', 'utils'],
    services: ['api', 'clients', 'repositories'],
    models: ['types', 'schemas', 'entities'],
    controllers: ['services', 'routes', 'handlers'],
    views: ['components', 'templates', 'layouts'],
    api: ['services', 'handlers', 'middleware'],
    utils: ['helpers', 'lib', 'common'],
    types: ['models', 'interfaces', 'schemas'],
  };

  const lowerName = name.toLowerCase();
  if (relationships[lowerName]) {
    related.push(...relationships[lowerName]);
  }

  return related;
}

interface SemanticResult {
  purpose: string;
  description: string;
  confidence: number;
  llmEvidence?: LlmEvidence;
}

function extractHeuristicSemantics(
  name: string,
  relativePath: string,
  role: string,
  boundedContext: string | undefined,
  files: string[],
  subdirs: string[]
): SemanticResult {
  // Generate purpose from name and role
  let purpose = '';
  const cleanName = name.replace(/[_-]/g, ' ');

  if (role === 'root') {
    purpose = 'Root source directory for the project';
  } else if (boundedContext) {
    purpose = `${boundedContext.replace(/-/g, ' ')} ${role} directory`;
  } else {
    purpose = `${role.charAt(0).toUpperCase() + role.slice(1)} for ${cleanName}`;
  }

  // Generate description
  const fileInfo = files.length > 0 ? `${files.length} files` : 'no files';
  const subdirInfo = subdirs.length > 0 ? `${subdirs.length} subdirectories` : 'no subdirectories';
  const description = `Contains ${fileInfo} and ${subdirInfo}. Located at ${relativePath || 'root'}.`;

  return { purpose, description, confidence: 0.5 };
}

async function extractDirectorySemantics(
  name: string,
  relativePath: string,
  files: string[],
  subdirs: string[],
  role: string,
  config: DirectoryExtractionConfig
): Promise<SemanticResult> {
  const llmService = resolveLlmServiceAdapter();

  const prompt = `Analyze this directory structure and provide a brief semantic understanding.

Directory: ${name}
Path: ${relativePath || 'root'}
Role: ${role}

Files: ${files.slice(0, 15).join(', ')}${files.length > 15 ? ` (+${files.length - 15} more)` : ''}
Subdirectories: ${subdirs.slice(0, 10).join(', ')}${subdirs.length > 10 ? ` (+${subdirs.length - 10} more)` : ''}

Respond in this exact JSON format:
{
  "purpose": "<one sentence describing what this directory is for>",
  "description": "<2-3 sentences describing the directory's organization and contents>"
}`;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content: 'You are a code architecture analyst. Provide concise, accurate directory descriptions. Focus on the architectural role and organizational purpose.',
    },
    { role: 'user', content: prompt },
  ];

  const modelId = config.llmModelId
    || resolveLibrarianModelId(config.llmProvider)
    || 'claude-haiku-4-5-20241022';

  // Build LLM evidence before the call
  const llmEvidence = await buildLlmEvidence({
    provider: config.llmProvider || 'claude',
    modelId,
    messages,
  });

  try {
    const response = await llmService.chat({
      provider: config.llmProvider || 'claude',
      modelId,
      messages,
      maxTokens: 250,
    });

    const responseText = response.content;
    // Extract the first complete JSON object from the response
    const jsonMatch = extractFirstJsonObject(responseText);
    if (!jsonMatch) {
      throw new Error('no JSON found in directory semantics response');
    }
    const parsed = JSON.parse(jsonMatch) as { purpose?: string; description?: string };
    return {
      purpose: parsed.purpose || `Directory: ${name}`,
      description: parsed.description || `Directory at ${relativePath}`,
      confidence: 0.85,
      llmEvidence,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = message.includes('unverified_by_trace')
      ? message
      : `unverified_by_trace(provider_invalid_output): ${message}`;
    throw new Error(prefix);
  }
}

/**
 * Pre-compute total file counts for directories from a file list.
 * This avoids redundant recursive directory scans during extraction.
 *
 * @param allFilePaths - All discovered file paths (absolute)
 * @param workspaceRoot - Workspace root for normalization
 * @returns Map of directory path to total file count under that directory
 */
export function computeTotalFileCounts(
  allFilePaths: string[],
  workspaceRoot: string
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const filePath of allFilePaths) {
    // Walk up the directory tree and increment counts
    let dir = path.dirname(filePath);
    while (dir.startsWith(workspaceRoot) || dir === workspaceRoot) {
      counts.set(dir, (counts.get(dir) || 0) + 1);
      const parent = path.dirname(dir);
      if (parent === dir) break; // reached root
      dir = parent;
    }
  }

  return counts;
}

/**
 * Batch process multiple directories for efficiency.
 * Optionally accepts pre-computed file counts to avoid redundant I/O.
 */
export async function extractDirectoriesInBatch(
  directories: DirectoryExtractionInput[],
  config: DirectoryExtractionConfig = {},
  totalFileCounts?: Map<string, number>
): Promise<DirectoryExtractionResult[]> {
  const results: DirectoryExtractionResult[] = [];

  // Enrich inputs with pre-computed totalFiles if available
  const enrichedInputs = directories.map((input) => ({
    ...input,
    totalFiles: input.totalFiles ?? totalFileCounts?.get(input.absolutePath),
  }));

  // Process in batches of 10 for parallelism
  const batchSize = 10;
  for (let i = 0; i < enrichedInputs.length; i += batchSize) {
    const batch = enrichedInputs.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((input) => extractDirectoryKnowledge(input, config))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Extract the first complete JSON object from a string.
 * Uses brace balancing to find the correct closing brace.
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
