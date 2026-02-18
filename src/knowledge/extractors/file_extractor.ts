/**
 * @fileoverview File-level Knowledge Extractor
 *
 * Extracts comprehensive semantic understanding of source files including:
 * - Purpose and role in the system
 * - Content summary and key exports
 * - Domain concepts and bounded context
 * - Structural metrics (line count, function count, etc.)
 * - Relationships (imports/exports)
 *
 * Uses LLM for deep semantic analysis when available, with heuristic fallbacks
 * for offline / rate-limited environments.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { FileKnowledge } from '../../types.js';
import { resolveLlmServiceAdapter } from '../../adapters/llm_service.js';
import { resolveLibrarianModelId } from '../../api/llm_env.js';
import { computeFileChecksum } from '../../utils/checksums.js';
import { buildLlmEvidence, type LlmEvidence } from './llm_evidence.js';

export interface FileExtractionInput {
  absolutePath: string;
  workspaceRoot: string;
  content?: string; // If already loaded
}

export interface FileExtractionConfig {
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
  skipLlm?: boolean;
  /** Governor context for token tracking and budget enforcement */
  governor?: import('../../api/governor_context.js').GovernorContext;
}

export interface FileExtractionResult {
  file: FileKnowledge;
  confidence: number;
}

// File category detection patterns
const CATEGORY_PATTERNS: Record<FileKnowledge['category'], RegExp[]> = {
  code: [/\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|h|hpp|rb|php|swift|kt)$/i],
  config: [
    /\.(json|yaml|yml|toml|ini|env|config\.[jt]s)$/i,
    /\.(tf|tfvars|hcl)$/i,
    /(?:^|\/)Dockerfile(\..+)?$/i,
    /(?:^|\/)\.dockerignore$/i,
    /^(tsconfig|package|\.eslint|\.prettier|jest\.config)/i,
  ],
  docs: [/\.(md|mdx|txt|rst|adoc)$/i, /^(README|CHANGELOG|LICENSE|CONTRIBUTING)/i],
  test: [/\.(test|spec|e2e)\.[jt]sx?$/i, /__tests__/, /\.test\./, /\.spec\./],
  data: [/\.(csv|xml|sql|graphql|prisma)$/i],
  schema: [/\.(schema\.[jt]s|d\.ts)$/i, /schema/, /types?\.[jt]s$/i],
  other: [],
};

// Role detection based on file name and location
const ROLE_PATTERNS: Record<string, RegExp[]> = {
  'entry point': [/^index\.[jt]sx?$/i, /^main\.[jt]sx?$/i, /^app\.[jt]sx?$/i],
  'utility': [/util/i, /helper/i, /common/i, /lib\//],
  'component': [/component/i, /\.tsx$/i],
  'service': [/service/i, /api/i, /client/i],
  'model': [/model/i, /entity/i, /types?\.ts$/i],
  'controller': [/controller/i, /handler/i, /route/i],
  'test': [/\.test\.|\.spec\.|__tests__/],
  'configuration': [/config/i, /settings/i, /\.(tf|tfvars|hcl)$/i, /(?:^|\/)Dockerfile(\..+)?$/i, /(?:^|\/)\.dockerignore$/i],
  'hook': [/hooks?\//i, /use[A-Z]/],
  'middleware': [/middleware/i],
  'store': [/store/i, /reducer/i, /slice/i],
};

export async function extractFileKnowledge(
  input: FileExtractionInput,
  config: FileExtractionConfig = {}
): Promise<FileExtractionResult> {
  const { absolutePath, workspaceRoot } = input;
  let content = input.content;
  let contentReadFailed = false;

  // Load content if not provided
  if (!content) {
    try {
      const raw = await fs.readFile(absolutePath);
      if (isProbablyBinary(raw)) {
        content = '';
        contentReadFailed = true;
      } else {
        content = raw.toString('utf8');
      }
    } catch (error) {
      // File couldn't be read (permissions, binary, not found, etc.)
      // Track this for reduced confidence and continue with empty content
      content = '';
      contentReadFailed = true;
    }
  }

  // Get file stats
  let lastModified = new Date().toISOString();
  try {
    const stats = await fs.stat(absolutePath);
    lastModified = stats.mtime.toISOString();
  } catch {
    // Use current time if stats unavailable
  }

  const relativePath = path.relative(workspaceRoot, absolutePath);
  const name = path.basename(absolutePath);
  const extension = path.extname(absolutePath);
  const directory = path.dirname(absolutePath);

  // Compute checksum for incremental updates
  const checksum = computeFileChecksum(content);

  // Detect category
  const category = detectCategory(absolutePath);

  // Detect role
  const role = detectRole(absolutePath, relativePath);

  // Extract structural metrics
  const lines = content.split('\n');
  const lineCount = lines.length;
  const { functionCount, classCount, importCount, exportCount, imports, keyExports } = analyzeStructure(content, extension);

  // Determine complexity
  const complexity = determineComplexity(lineCount, functionCount, classCount);

  // Check for tests
  const hasTests = detectHasTests(absolutePath, relativePath);

  // Extract main concepts from content
  const mainConcepts = extractMainConcepts(content, extension);

  // Generate purpose and summary (LLM-required)
  let purpose: string;
  let summary: string;
  let confidence = 0.1;
  let llmEvidence: LlmEvidence | undefined;

  if (contentReadFailed) {
    purpose = 'unverified_by_trace(file_unreadable)';
    summary = 'unverified_by_trace(file_unreadable): binary or unreadable file';
    // No llmEvidence for unreadable files - no LLM was used
  } else {
    const heuristic = extractHeuristicSemantics(content, name, relativePath, category, role);
    if (config.skipLlm || !config.llmProvider) {
      purpose = heuristic.purpose;
      summary = heuristic.summary;
      confidence = heuristic.confidence;
      // No llmEvidence - no LLM was used
    } else {
      try {
        // Use LLM for semantic extraction (only if content was readable)
        const llmResult = await extractFileSemantics(content, name, relativePath, config);
        purpose = llmResult.purpose;
        summary = llmResult.summary;
        confidence = llmResult.confidence;
        llmEvidence = llmResult.llmEvidence; // Capture LLM evidence when available
      } catch {
        // Degrade gracefully under rate limits / provider failures.
        purpose = heuristic.purpose;
        summary = heuristic.summary;
        confidence = heuristic.confidence;
        llmEvidence = undefined;
      }
    }
  }

  const id = createHash('sha256').update(absolutePath).digest('hex').slice(0, 16);

  return {
    file: {
      id,
      path: absolutePath,
      relativePath,
      name,
      extension,
      category,
      purpose,
      role,
      summary,
      keyExports,
      mainConcepts,
      lineCount,
      functionCount,
      classCount,
      importCount,
      exportCount,
      imports,
      importedBy: [], // Populated later via graph analysis
      directory,
      complexity,
      testCoverage: undefined, // Populated from coverage data if available
      hasTests,
      checksum,
      confidence,
      lastIndexed: new Date().toISOString(),
      lastModified,
      llmEvidence, // Include LLM evidence when available
    },
    confidence,
  };
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 8000);
  if (sampleSize === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    const byte = buffer[i];
    if (byte === 0 || byte < 9 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / sampleSize > 0.3;
}

function detectCategory(filePath: string): FileKnowledge['category'] {
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(filePath)) {
        return category as FileKnowledge['category'];
      }
    }
  }
  return 'other';
}

function detectRole(absolutePath: string, relativePath: string): string {
  for (const [role, patterns] of Object.entries(ROLE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(absolutePath) || pattern.test(relativePath)) {
        return role;
      }
    }
  }
  return 'implementation';
}

interface StructureAnalysis {
  functionCount: number;
  classCount: number;
  importCount: number;
  exportCount: number;
  imports: string[];
  keyExports: string[];
}

function analyzeStructure(content: string, extension: string): StructureAnalysis {
  const isTypeScript = /\.tsx?$/i.test(extension);
  const isJavaScript = /\.jsx?$/i.test(extension);

  let functionCount = 0;
  let classCount = 0;
  const imports: string[] = [];
  const keyExports: string[] = [];

  if (isTypeScript || isJavaScript) {
    // Count functions (arrow functions, function declarations, methods)
    const functionPatterns = [
      /\bfunction\s+\w+/g,
      /\b(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/g,
      /\b(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\s*\w+\s*=>/g,
      /^\s*(?:async\s+)?(?:public|private|protected)?\s*\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/gm,
    ];
    for (const pattern of functionPatterns) {
      const matches = content.match(pattern);
      if (matches) functionCount += matches.length;
    }

    // Count classes
    const classMatches = content.match(/\bclass\s+\w+/g);
    classCount = classMatches?.length ?? 0;

    // Extract imports
    const importMatches = content.matchAll(/import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g);
    for (const match of importMatches) {
      imports.push(match[1]);
    }

    // Extract exports
    const exportMatches = content.matchAll(/export\s+(?:default\s+)?(?:(?:const|let|var|function|class|interface|type|enum)\s+)?(\w+)/g);
    for (const match of exportMatches) {
      if (match[1] && match[1] !== 'default') {
        keyExports.push(match[1]);
      }
    }
  }

  return {
    functionCount,
    classCount,
    importCount: imports.length,
    exportCount: keyExports.length,
    imports: [...new Set(imports)],
    keyExports: [...new Set(keyExports)].slice(0, 10), // Limit to 10 main exports
  };
}

function determineComplexity(lineCount: number, functionCount: number, classCount: number): FileKnowledge['complexity'] {
  // Simple heuristic based on size and structure
  const structuralComplexity = functionCount + classCount * 2;
  const sizeComplexity = lineCount / 100;

  const total = structuralComplexity + sizeComplexity;

  if (total < 5) return 'low';
  if (total < 15) return 'medium';
  return 'high';
}

function detectHasTests(absolutePath: string, relativePath: string): boolean {
  // Check if this IS a test file (not if it HAS tests)
  // More precise patterns to avoid false positives like "contest" or "attest"
  return /\.(test|spec)\.[jt]sx?$/i.test(absolutePath) ||
         /__tests__\//.test(relativePath) ||
         /(?:^|\/)(tests?|__tests__)\//.test(relativePath);
}

function extractMainConcepts(content: string, extension: string): string[] {
  const concepts: Set<string> = new Set();

  // Infra/config heuristics (offline-safe): Dockerfile + Terraform/HCL.
  const looksLikeDockerfile = /^\s*FROM\s+\S+/mi.test(content) && /^\s*(FROM|RUN|COPY|ADD|ARG|ENV|WORKDIR|EXPOSE|CMD|ENTRYPOINT)\b/mi.test(content);
  if (looksLikeDockerfile) {
    const fromMatches = content.matchAll(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+([^\s]+))?/gim);
    for (const match of fromMatches) {
      const image = match[1]?.trim();
      const stage = match[2]?.trim();
      if (image) concepts.add(image);
      if (stage) concepts.add(`stage:${stage}`);
    }
    const exposeMatches = content.matchAll(/^\s*EXPOSE\s+([0-9]{2,5})(?:\/\w+)?/gim);
    for (const match of exposeMatches) {
      const port = match[1]?.trim();
      if (port) concepts.add(`port:${port}`);
    }
    // Keep Docker concepts compact and useful.
    concepts.add('Dockerfile');
    return [...concepts].slice(0, 10);
  }

  const looksLikeTerraform = /\b(resource|module|provider|variable|output)\s+"[^"]+"/.test(content) || /^\s*terraform\s*\{/m.test(content);
  if (looksLikeTerraform) {
    const resourceMatches = content.matchAll(/^\s*resource\s+"([^"]+)"\s+"([^"]+)"/gim);
    for (const match of resourceMatches) {
      const type = match[1]?.trim();
      const name = match[2]?.trim();
      if (type) concepts.add(`resource:${type}`);
      if (name) concepts.add(`name:${name}`);
    }
    const moduleMatches = content.matchAll(/^\s*module\s+"([^"]+)"/gim);
    for (const match of moduleMatches) {
      const name = match[1]?.trim();
      if (name) concepts.add(`module:${name}`);
    }
    const providerMatches = content.matchAll(/^\s*provider\s+"([^"]+)"/gim);
    for (const match of providerMatches) {
      const name = match[1]?.trim();
      if (name) concepts.add(`provider:${name}`);
    }
    concepts.add('Terraform');
    return [...concepts].slice(0, 10);
  }

  // Extract from JSDoc/TSDoc comments
  const docComments = content.match(/\/\*\*[\s\S]*?\*\//g) || [];
  for (const doc of docComments) {
    // Extract @param, @returns descriptions
    const descriptions = doc.match(/@(?:param|returns?|description)\s+[^@*]+/g) || [];
    for (const desc of descriptions) {
      // Extract nouns (capitalized words often indicate domain concepts)
      const nouns = desc.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*/g) || [];
      nouns.forEach((n) => concepts.add(n));
    }
  }

  // Extract from interface/type names
  const typeNames = content.match(/(?:interface|type)\s+([A-Z]\w+)/g) || [];
  for (const match of typeNames) {
    const name = match.split(/\s+/)[1];
    if (name) concepts.add(name);
  }

  // Extract from class names
  const classNames = content.match(/class\s+([A-Z]\w+)/g) || [];
  for (const match of classNames) {
    const name = match.split(/\s+/)[1];
    if (name) concepts.add(name);
  }

  return [...concepts].slice(0, 10);
}

interface SemanticResult {
  purpose: string;
  summary: string;
  confidence: number;
  llmEvidence?: LlmEvidence;
}

function extractHeuristicSemantics(
  content: string,
  name: string,
  relativePath: string,
  category: string,
  role: string
): SemanticResult {
  // Extract purpose from fileoverview comment
  const fileOverview = content.match(/@fileoverview\s+([^\n@]+)/);
  const description = content.match(/@description\s+([^\n@]+)/);

  let purpose = '';
  if (fileOverview) {
    purpose = fileOverview[1].trim();
  } else if (description) {
    purpose = description[1].trim();
  } else {
    // Generate from file name and role
    const cleanName = name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
    purpose = `${role.charAt(0).toUpperCase() + role.slice(1)} for ${cleanName}`;
  }

  // Generate summary from first comment block or imports
  const firstComment = content.match(/^\/\*\*[\s\S]*?\*\//);
  let summary = '';

  if (firstComment) {
    const commentText = firstComment[0]
      .replace(/\/\*\*|\*\/|\n\s*\*/g, ' ')
      .replace(/@\w+[^\n]*/g, '')
      .trim();
    summary = commentText.slice(0, 200);
  } else {
    summary = `${category} file at ${relativePath}`;
  }

  return { purpose, summary, confidence: 0.5 };
}

async function extractFileSemantics(
  content: string,
  name: string,
  relativePath: string,
  config: FileExtractionConfig
): Promise<SemanticResult> {
  const llmService = resolveLlmServiceAdapter();

  const truncatedContent = content.slice(0, 4000);

  const prompt = `Analyze this source file and provide a brief semantic understanding.

File: ${name}
Path: ${relativePath}

Content:
\`\`\`
${truncatedContent}
\`\`\`

Respond in this exact JSON format:
{
  "purpose": "<one sentence describing what this file does>",
  "summary": "<2-3 sentences summarizing the file's contents and role>"
}`;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content: 'You are a code analysis assistant. Provide concise, accurate file descriptions. Focus on the WHY not the WHAT.',
    },
    { role: 'user', content: prompt },
  ];

  const modelId = config.llmModelId
    || resolveLibrarianModelId(config.llmProvider ?? 'claude')
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
      maxTokens: 300,
      governorContext: config.governor,
    });

    const responseText = response.content;
    // Extract the first complete JSON object from the response
    const jsonMatch = extractFirstJsonObject(responseText);
    if (!jsonMatch) {
      throw new Error('no JSON found in file semantics response');
    }
    const parsed = JSON.parse(jsonMatch) as { purpose?: string; summary?: string };

    // Compute confidence from evidence:
    // Calibrated 2026-01-16: ECE=12.2%, 100% accuracy, mean=87.8% (underconfident)
    // - Base: 0.70 (LLM responded + JSON well-formed)
    // - +0.12 if purpose is substantive (>20 chars, not just file name)
    // - +0.12 if summary is substantive (>30 chars)
    // Target: ~90% mean confidence for valid responses (matching observed accuracy)
    let confidence = 0.70; // Base (calibrated from 0.65)
    const hasPurpose = parsed.purpose && parsed.purpose.length > 20 && !parsed.purpose.includes(name);
    const hasSummary = parsed.summary && parsed.summary.length > 30;
    if (hasPurpose) confidence += 0.12;
    if (hasSummary) confidence += 0.12;
    // Cap to avoid floating point precision issues (0.70 + 0.12 + 0.12 = 0.94)
    confidence = Math.min(confidence, 0.95);

    return {
      purpose: parsed.purpose || `File: ${name}`,
      summary: parsed.summary || `Source file at ${relativePath}`,
      confidence,
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
