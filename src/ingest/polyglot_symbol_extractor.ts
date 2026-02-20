import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ParserRegistry } from '../agents/parser_registry.js';
import type { SymbolEntry } from '../constructions/symbol_table.js';

export interface PolyglotSymbolExtractionOptions {
  parserRegistry?: ParserRegistry;
  workspaceRoot?: string;
  batchSize?: number;
  readFile?: (filePath: string) => Promise<string>;
}

export interface PolyglotSymbolExtractionResult {
  symbols: SymbolEntry[];
  filesProcessed: number;
  filesWithErrors: string[];
}

const TYPESCRIPT_SYMBOL_EXTENSIONS = new Set<string>(['.ts', '.tsx']);

function resolveBatchSize(batchSize: number | undefined): number {
  if (typeof batchSize !== 'number' || !Number.isFinite(batchSize) || batchSize <= 0) return 20;
  return Math.min(Math.floor(batchSize), 200);
}

function normalizeQualifiedPath(filePath: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) return filePath.replace(/\\/g, '/');
  const relative = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
  return relative.startsWith('..') ? filePath.replace(/\\/g, '/') : relative;
}

function shouldSkipFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TYPESCRIPT_SYMBOL_EXTENSIONS.has(ext);
}

function isLikelyTextContent(content: string): boolean {
  return !content.includes('\u0000');
}

export async function extractPolyglotFunctionSymbolsFromFiles(
  filePaths: string[],
  options: PolyglotSymbolExtractionOptions = {},
): Promise<PolyglotSymbolExtractionResult> {
  const parserRegistry = options.parserRegistry ?? ParserRegistry.getInstance();
  const readFile = options.readFile ?? ((filePath: string) => fs.readFile(filePath, 'utf8'));
  const workspaceRoot = options.workspaceRoot;
  const symbols: SymbolEntry[] = [];
  const filesWithErrors: string[] = [];
  let filesProcessed = 0;
  const candidateFiles = filePaths.filter((filePath) => !shouldSkipFile(filePath));
  const batchSize = resolveBatchSize(options.batchSize);

  for (let index = 0; index < candidateFiles.length; index += batchSize) {
    const batch = candidateFiles.slice(index, index + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const content = await readFile(filePath);
          if (!isLikelyTextContent(content)) return { filePath, symbols: [] as SymbolEntry[] };
          const parsed = parserRegistry.parseFile(filePath, content);
          const qualifiedPath = normalizeQualifiedPath(filePath, workspaceRoot);
          const extracted = parsed.functions.map((fn): SymbolEntry => ({
            name: fn.name,
            kind: 'function',
            file: filePath,
            line: Math.max(fn.startLine, 1),
            endLine: Math.max(fn.endLine, fn.startLine, 1),
            signature: fn.signature,
            exported: false,
            qualifiedName: `${qualifiedPath}:${fn.name}`,
          }));
          return { filePath, symbols: extracted };
        } catch {
          return { filePath, symbols: null as SymbolEntry[] | null };
        }
      }),
    );

    for (const result of batchResults) {
      if (result.symbols === null) {
        filesWithErrors.push(result.filePath);
        continue;
      }
      symbols.push(...result.symbols);
      filesProcessed += 1;
    }
  }

  return {
    symbols,
    filesProcessed,
    filesWithErrors,
  };
}
