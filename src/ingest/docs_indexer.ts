import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';
import { GovernorContext } from '../api/governor_context.js';
import { DEFAULT_GOVERNOR_CONFIG } from '../api/governors.js';
import { ProviderUnavailableError } from '../api/provider_check.js';
import { getErrorMessage } from '../utils/errors.js';
import { resolveLlmServiceAdapter, type LlmServiceAdapter } from '../adapters/llm_service.js';
import type { TaxonomyItem } from '../api/taxonomy.js';
import type { IngestionContext, IngestionItem, IngestionResult, IngestionSource } from './types.js';
import type { DocumentKnowledge } from '../types.js';

export interface DocHeading { level: number; text: string; line: number; }
export interface DocLink { text: string; url: string; line: number; }
export interface DocCodeBlock { language: string | null; content: string; lineStart: number; lineEnd: number; }
export interface DocGraphNode { id: string; type: 'file' | 'heading' | 'link'; label: string; }
export interface DocGraphEdge { source: string; target: string; relation: 'contains' | 'links_to'; }
export interface DocParseResult {
  headings: DocHeading[];
  links: DocLink[];
  codeBlocks: DocCodeBlock[];
  wordCount: number;
}

export interface DocsIngestionOptions {
  include?: string[];
  exclude?: string[];
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
  llmService?: LlmServiceAdapter;
  governorContext?: GovernorContext | null;
  maxFileBytes?: number;
}

const DEFAULT_DOC_GLOBS = ['**/*.md', '**/*.mdx'];
const DEFAULT_MAX_BYTES = 512_000;
const MAX_DOC_HEADINGS_STORED = 200;
const MAX_DOC_LINKS_STORED = 200;
const MAX_DOC_CODE_BLOCKS_STORED = 25;
const MAX_DOC_CODE_BLOCK_PREVIEW_CHARS = 400;

/**
 * High-relevance document patterns - these get priority in meta-queries.
 * Pattern: [glob pattern, relevance boost 0-1, intended audience]
 */
const META_DOC_PATTERNS: Array<[string, number, DocumentKnowledge['audience']]> = [
  ['AGENTS.md', 1.0, 'agent'],
  ['**/AGENTS.md', 1.0, 'agent'],
  ['CLAUDE.md', 1.0, 'agent'],
  ['**/CLAUDE.md', 1.0, 'agent'],
  ['CODEX.md', 1.0, 'agent'],
  ['**/CODEX.md', 1.0, 'agent'],
  ['docs/archive/AGENT_INTEGRATION.md', 1.0, 'agent'],
  ['**/AGENT_*.md', 0.9, 'agent'],
  ['README.md', 0.8, 'general'],
  ['**/README.md', 0.7, 'developer'],
  ['docs/librarian/*.md', 0.7, 'developer'],
  ['docs/archive/*.md', 0.5, 'developer'],
  ['CONTRIBUTING.md', 0.6, 'developer'],
  ['**/CONTRIBUTING.md', 0.6, 'developer'],
  ['docs/**/*.md', 0.5, 'developer'],
];

/**
 * Patterns that indicate the document is about how to USE something (meta-queries).
 */
const HOW_TO_KEYWORDS = [
  'how to', 'getting started', 'quick start', 'usage', 'guide',
  'tutorial', 'walkthrough', 'instructions', 'setup', 'integration',
  'agent', 'workflow', 'example', 'best practice', 'overview',
];

const DOC_TAXONOMY: TaxonomyItem[] = [
  'decision_records_linkage',
  'rationale_for_changes',
  'todos_debt_hotspots',
  'incident_runbooks',
  'observability_dashboards',
  'alerting_rules',
  'slo_sla_definitions',
  'doc_freshness_coverage',
  'code_to_doc_linkage',
];

export function parseMarkdown(content: string): DocParseResult {
  const headings: DocHeading[] = [];
  const links: DocLink[] = [];
  const codeBlocks: DocCodeBlock[] = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = '';
  let fenceLang: string | null = null;
  let fenceStart = 0;
  let fenceLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] ?? '';

    const fenceMatch = line.match(/^(```|~~~)\s*(\w+)?\s*$/);
    if (!inFence && fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[1] ?? '```';
      fenceLang = fenceMatch[2] ?? null;
      fenceStart = lineNumber + 1;
      fenceLines = [];
      continue;
    }

    if (inFence) {
      if (line.startsWith(fenceMarker)) {
        codeBlocks.push({
          language: fenceLang,
          content: fenceLines.join('\n'),
          lineStart: fenceStart,
          lineEnd: lineNumber - 1,
        });
        inFence = false;
        fenceMarker = '';
        fenceLang = null;
        continue;
      }
      fenceLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      headings.push({
        level: headingMatch[1]?.length ?? 1,
        text: (headingMatch[2] ?? '').trim(),
        line: lineNumber,
      });
    }

    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let linkMatch: RegExpExecArray | null = linkRegex.exec(line);
    while (linkMatch) {
      links.push({ text: linkMatch[1] ?? '', url: linkMatch[2] ?? '', line: lineNumber });
      linkMatch = linkRegex.exec(line);
    }
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  return { headings, links, codeBlocks, wordCount };
}

function buildDocGraph(relativePath: string, parse: DocParseResult): { nodes: DocGraphNode[]; edges: DocGraphEdge[] } {
  const nodes: DocGraphNode[] = [];
  const edges: DocGraphEdge[] = [];
  const fileId = `file:${relativePath}`;
  nodes.push({ id: fileId, type: 'file', label: relativePath });

  parse.headings.forEach((heading, index) => {
    const nodeId = `heading:${relativePath}:${index}`;
    nodes.push({ id: nodeId, type: 'heading', label: heading.text });
    edges.push({ source: fileId, target: nodeId, relation: 'contains' });
  });

  const linkNodes = new Map<string, string>();
  for (const link of parse.links) {
    const key = link.url || link.text;
    if (!key) continue;
    let nodeId = linkNodes.get(key);
    if (!nodeId) {
      nodeId = `link:${key}`;
      linkNodes.set(key, nodeId);
      nodes.push({ id: nodeId, type: 'link', label: key });
    }
    edges.push({ source: fileId, target: nodeId, relation: 'links_to' });
  }

  return { nodes, edges };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function makeFallbackSummary(relativePath: string, parse: DocParseResult, content: string): string {
  if (parse.headings[0]?.text) return `Doc: ${parse.headings[0].text}`;
  const snippet = content.replace(/\s+/g, ' ').trim();
  if (!snippet) return `Doc: ${relativePath}`;
  return snippet.slice(0, 160);
}

class DocSummarizer {
  private readonly llm: LlmServiceAdapter | null;
  private readonly provider: 'claude' | 'codex' | null;
  private readonly modelId: string | null;
  private readonly governor: GovernorContext | null;

  constructor(options: DocsIngestionOptions) {
    this.provider = options.llmProvider ?? null;
    this.modelId = options.llmModelId ?? null;
    const canUseLlm = Boolean(this.provider && this.modelId);
    this.llm = canUseLlm ? resolveLlmServiceAdapter(options.llmService ?? null) : null;
    this.governor = options.governorContext ?? (canUseLlm ? new GovernorContext({
      phase: 'docs_ingestion',
      config: DEFAULT_GOVERNOR_CONFIG,
    }) : null);
  }

  async summarize(relativePath: string, parse: DocParseResult, content: string): Promise<string> {
    const fallback = makeFallbackSummary(relativePath, parse, content);
    if (!this.llm || !this.provider || !this.modelId) {
      // Offline / degraded mode: fall back to heuristic summary.
      return fallback;
    }

    try {
      this.governor?.checkBudget();
    } catch (error: unknown) {
      if (isBudgetExceeded(error)) throw error;
      throw error;
    }

    const prompt = [
      `Summarize the documentation file ${relativePath} in 1-2 sentences.`,
      'Keep the summary grounded in the headings and content.',
      '',
      `Headings: ${parse.headings.map((heading) => heading.text).join(' | ') || 'none'}`,
      '',
      content.slice(0, 1800),
    ].join('\n');

    try {
      const response = await this.llm.chat({
        provider: this.provider,
        modelId: this.modelId,
        messages: [
          { role: 'system', content: 'You summarize documentation for a knowledge index.' },
          { role: 'user', content: prompt },
        ],
        governorContext: this.governor ?? undefined,
      });
      const cleaned = String(response.content ?? '').replace(/\s+/g, ' ').trim();
      if (!cleaned) return fallback;
      return cleaned.length <= 400 ? cleaned : cleaned.slice(0, 400).trim();
    } catch (error: unknown) {
      if (isBudgetExceeded(error)) throw error;
      // Graceful degradation: use heuristic fallback under provider errors / rate limits.
      return fallback;
    }
  }
}

function isBudgetExceeded(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('unverified_by_trace(budget_exhausted)');
}

export function createDocsIngestionSource(options: DocsIngestionOptions = {}): IngestionSource {
  const include = options.include ?? DEFAULT_DOC_GLOBS;
  const exclude = options.exclude ?? [];
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const summarizer = new DocSummarizer(options);

  return {
    type: 'docs',
    version: 'v1',
    validate: (data: unknown) => {
      if (!data || typeof data !== 'object') return false;
      const item = data as { payload?: { path?: string; summary?: string } };
      return typeof item.payload?.path === 'string' && typeof item.payload?.summary === 'string';
    },
	    ingest: async (ctx: IngestionContext): Promise<IngestionResult> => {
      const files = await glob(include, { cwd: ctx.workspace, ignore: exclude, absolute: true });
      const items: IngestionItem[] = [];
      const errors: string[] = [];

	      for (const filePath of files) {
        options.governorContext?.enterFile(filePath);
        let content: string;
        try {
          const stats = await fs.stat(filePath);
          if (stats.size > maxFileBytes) continue;
          content = await fs.readFile(filePath, 'utf8');
        } catch (error: unknown) {
          errors.push(`Failed to read ${filePath}: ${getErrorMessage(error)}`);
          continue;
        }

	        const parse = parseMarkdown(content);
	        const relativePath = path.relative(ctx.workspace, filePath);
	        const summary = await summarizer.summarize(relativePath, parse, content);
	        const graph = buildDocGraph(relativePath, parse);
	        const codeBlocks = parse.codeBlocks.slice(0, MAX_DOC_CODE_BLOCKS_STORED).map((block) => {
	          const raw = block.content ?? '';
	          const trimmed = raw.length <= MAX_DOC_CODE_BLOCK_PREVIEW_CHARS
	            ? raw
	            : `${raw.slice(0, MAX_DOC_CODE_BLOCK_PREVIEW_CHARS)}\n[truncated]`;
	          return {
	            language: block.language,
	            lineStart: block.lineStart,
	            lineEnd: block.lineEnd,
	            preview: trimmed,
	          };
	        });
	        const payload = {
	          path: relativePath,
	          summary,
	          headings: parse.headings.slice(0, MAX_DOC_HEADINGS_STORED),
	          links: parse.links.slice(0, MAX_DOC_LINKS_STORED),
	          code_blocks: codeBlocks,
	          truncated: {
	            headings: parse.headings.length > MAX_DOC_HEADINGS_STORED,
	            links: parse.links.length > MAX_DOC_LINKS_STORED,
	            code_blocks: parse.codeBlocks.length > MAX_DOC_CODE_BLOCKS_STORED,
	          },
	          graph,
	        };

        items.push({
          id: `doc:${relativePath}`,
          sourceType: 'docs',
          sourceVersion: 'v1',
          ingestedAt: ctx.now(),
          payload,
          metadata: {
            hash: hashContent(content),
            word_count: parse.wordCount,
            taxonomy: DOC_TAXONOMY,
          },
        });
      }

      return { items, errors };
    },
  };
}

// ============================================================================
// DOCUMENT KNOWLEDGE GENERATION
// ============================================================================

/**
 * Determines if a document path matches meta-doc patterns and returns relevance info.
 */
export function classifyDocument(relativePath: string): {
  isMetaDoc: boolean;
  relevanceBoost: number;
  audience: DocumentKnowledge['audience'];
} {
  const normalized = relativePath.replace(/\\/g, '/');
  const fileName = path.basename(normalized);

  for (const [pattern, boost, audience] of META_DOC_PATTERNS) {
    // Exact match
    if (pattern === fileName || pattern === normalized) {
      return { isMetaDoc: true, relevanceBoost: boost, audience };
    }
    // Glob-style match (simplified)
    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\./g, '\\.');
      if (new RegExp(`^${regexPattern}$`).test(normalized)) {
        return { isMetaDoc: boost >= 0.7, relevanceBoost: boost, audience };
      }
    }
  }

  return { isMetaDoc: false, relevanceBoost: 0.3, audience: 'general' };
}

/**
 * Detects if document content is about "how to use" something.
 */
export function detectHowToContent(content: string, headings: DocHeading[]): boolean {
  const lowerContent = content.toLowerCase();
  const headingText = headings.map(h => h.text.toLowerCase()).join(' ');
  const combined = `${headingText} ${lowerContent.slice(0, 3000)}`;

  return HOW_TO_KEYWORDS.some(keyword => combined.includes(keyword));
}

/**
 * Extracts the primary title from parsed markdown.
 */
function extractTitle(parse: DocParseResult, relativePath: string): string {
  const h1 = parse.headings.find(h => h.level === 1);
  if (h1) return h1.text;
  const h2 = parse.headings.find(h => h.level === 2);
  if (h2) return h2.text;
  return path.basename(relativePath, path.extname(relativePath));
}

/**
 * Extracts key topics from headings (H2s primarily).
 */
function extractKeyTopics(parse: DocParseResult): string[] {
  return parse.headings
    .filter(h => h.level === 2 || h.level === 3)
    .map(h => h.text)
    .slice(0, 10);
}

/**
 * Generates the embedding input text for a document.
 * Prioritizes title, summary, and how-to keywords for meta-queries.
 */
export function generateDocEmbeddingInput(doc: {
  title: string;
  summary: string;
  purpose: string;
  headings: string[];
  audience: DocumentKnowledge['audience'];
  relativePath: string;
}): string {
  const parts: string[] = [];

  // Title with boost for agent docs
  if (doc.audience === 'agent') {
    parts.push(`[AGENT DOCUMENTATION] ${doc.title}`);
  } else {
    parts.push(doc.title);
  }

  // Purpose statement for meta-query matching
  if (doc.purpose) {
    parts.push(`Purpose: ${doc.purpose}`);
  }

  // Summary for semantic matching
  parts.push(doc.summary);

  // Key headings for topic coverage
  if (doc.headings.length > 0) {
    parts.push(`Topics: ${doc.headings.slice(0, 8).join(', ')}`);
  }

  // Path context
  parts.push(`File: ${doc.relativePath}`);

  return parts.join('\n\n');
}

export interface DocumentKnowledgeResult {
  document: DocumentKnowledge;
  embeddingInput: string;
}

/**
 * Converts a document ingestion item to DocumentKnowledge with embedding input.
 */
export function createDocumentKnowledge(
  relativePath: string,
  filePath: string,
  content: string,
  parse: DocParseResult,
  summary: string,
  llmEvidence?: DocumentKnowledge['llmEvidence']
): DocumentKnowledgeResult {
  const classification = classifyDocument(relativePath);
  const isHowTo = detectHowToContent(content, parse.headings);
  const title = extractTitle(parse, relativePath);
  const keyTopics = extractKeyTopics(parse);

  // Infer purpose from title and headings
  const purpose = isHowTo
    ? `Explains how to use or integrate with ${title.replace(/^#\s*/, '')}`
    : `Documentation about ${title.replace(/^#\s*/, '')}`;

  // Calculate final relevance boost
  const finalBoost = Math.min(
    1.0,
    classification.relevanceBoost + (isHowTo ? 0.15 : 0) + (classification.audience === 'agent' ? 0.1 : 0)
  );

  const document: DocumentKnowledge = {
    id: `doc:${relativePath}`,
    path: filePath,
    relativePath,
    name: path.basename(relativePath),
    title,
    summary,
    purpose,
    audience: classification.audience,
    headings: parse.headings.map(h => h.text),
    keyTopics,
    wordCount: parse.wordCount,
    isMetaDoc: classification.isMetaDoc || isHowTo,
    relevanceBoost: finalBoost,
    confidence: 0.8,
    lastIndexed: new Date().toISOString(),
    checksum: hashContent(content),
    llmEvidence,
  };

  const embeddingInput = generateDocEmbeddingInput({
    title,
    summary,
    purpose,
    headings: keyTopics,
    audience: classification.audience,
    relativePath,
  });

  return { document, embeddingInput };
}

/**
 * Get all high-relevance document patterns for prioritized indexing.
 */
export function getHighRelevancePatterns(): string[] {
  return META_DOC_PATTERNS
    .filter(([_, boost]) => boost >= 0.7)
    .map(([pattern]) => pattern);
}
