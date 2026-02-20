import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ParsedFunction, ParserResult } from '../agents/parser_registry.js';
import { logWarning } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';

const execFileAsync = promisify(execFile);
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const TS_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const FUNCTION_KINDS = new Set([9, 17, 18, 26, 45, 66, 68, 69, 70, 71, 72, 74, 76, 80]);
const SYMBOL_ROLE_DEFINITION = 1;
const SYMBOL_ROLE_IMPORT = 2;

export interface DecodedScipSymbolInformation {
  symbol?: string;
  kind?: number;
  display_name?: string;
  documentation?: string[];
  signature_documentation?: {
    text?: string;
  };
}

export interface DecodedScipOccurrence {
  symbol?: string;
  symbol_roles?: number;
  range?: number[];
}

export interface DecodedScipDocument {
  relative_path?: string;
  symbols?: DecodedScipSymbolInformation[];
  occurrences?: DecodedScipOccurrence[];
}

type ScipCommandRunner = (input: {
  workspaceRoot: string;
  outputPath: string;
  timeoutMs: number;
}) => Promise<void>;

type ScipDecoder = (input: {
  outputPath: string;
  timeoutMs: number;
}) => Promise<DecodedScipDocument[]>;

export interface ScipTypescriptBackendOptions {
  workspaceRoot: string;
  enabled?: boolean;
  cacheTtlMs?: number;
  timeoutMs?: number;
  outputPath?: string;
  commandRunner?: ScipCommandRunner;
  decoder?: ScipDecoder;
  now?: () => number;
}

export interface ScipBackend {
  parseFile(filePath: string): Promise<ParserResult | null>;
}

export class ScipTypescriptBackend implements ScipBackend {
  private readonly workspaceRoot: string;
  private readonly enabled: boolean;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly outputPath: string;
  private readonly commandRunner: ScipCommandRunner;
  private readonly decoder: ScipDecoder;
  private readonly now: () => number;
  private cachedAt = 0;
  private byFile = new Map<string, ParserResult>();
  private refreshPromise: Promise<void> | null = null;

  constructor(options: ScipTypescriptBackendOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.enabled = options.enabled ?? false;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.outputPath = path.resolve(
      options.outputPath ?? path.join(this.workspaceRoot, '.librarian', 'scip', 'index.scip')
    );
    this.commandRunner = options.commandRunner ?? runScipTypescriptIndex;
    this.decoder = options.decoder ?? decodeScipIndex;
    this.now = options.now ?? (() => Date.now());
  }

  async parseFile(filePath: string): Promise<ParserResult | null> {
    if (!this.enabled) return null;
    if (!isTsJsFile(filePath)) return null;
    const absolutePath = path.resolve(filePath);
    if (!absolutePath.startsWith(this.workspaceRoot)) return null;

    const shouldRefresh = await this.shouldRefresh(absolutePath);
    if (shouldRefresh) {
      await this.refreshIndex();
    }
    return this.byFile.get(absolutePath) ?? null;
  }

  private async shouldRefresh(targetFile: string): Promise<boolean> {
    if (this.byFile.size === 0) return true;
    if ((this.now() - this.cachedAt) > this.cacheTtlMs) return true;

    const [fileMtime, indexMtime] = await Promise.all([
      getMtimeMs(targetFile),
      getMtimeMs(this.outputPath),
    ]);
    if (fileMtime === 0 || indexMtime === 0) return true;
    return fileMtime > indexMtime;
  }

  private async refreshIndex(): Promise<void> {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    this.refreshPromise = (async () => {
      try {
        await fs.mkdir(path.dirname(this.outputPath), { recursive: true });
        await this.commandRunner({
          workspaceRoot: this.workspaceRoot,
          outputPath: this.outputPath,
          timeoutMs: this.timeoutMs,
        });
        const documents = await this.decoder({
          outputPath: this.outputPath,
          timeoutMs: this.timeoutMs,
        });
        const nextByFile = new Map<string, ParserResult>();
        for (const doc of documents) {
          const relativePath = doc.relative_path?.trim();
          if (!relativePath) continue;
          const absolutePath = path.resolve(this.workspaceRoot, relativePath);
          nextByFile.set(absolutePath, extractParserResultFromScipDocument(doc));
        }
        this.byFile = nextByFile;
        this.cachedAt = this.now();
      } catch (error: unknown) {
        logWarning('[librarian] SCIP backend refresh failed; falling back to parser registry', {
          workspaceRoot: this.workspaceRoot,
          outputPath: this.outputPath,
          error: getErrorMessage(error),
        });
        this.byFile = new Map<string, ParserResult>();
        this.cachedAt = this.now();
      } finally {
        this.refreshPromise = null;
      }
    })();

    await this.refreshPromise;
  }
}

export function extractParserResultFromScipDocument(document: DecodedScipDocument): ParserResult {
  const symbolById = new Map<string, DecodedScipSymbolInformation>();
  for (const symbolInfo of document.symbols ?? []) {
    const symbol = symbolInfo.symbol?.trim();
    if (!symbol) continue;
    symbolById.set(symbol, symbolInfo);
  }

  const dependencies = new Set<string>();
  const functions: ParsedFunction[] = [];
  const seenFunctions = new Set<string>();

  for (const occurrence of document.occurrences ?? []) {
    const symbol = occurrence.symbol?.trim();
    const symbolRoles = occurrence.symbol_roles ?? 0;
    if (!symbol) continue;

    if ((symbolRoles & SYMBOL_ROLE_IMPORT) === SYMBOL_ROLE_IMPORT) {
      const dependency = dependencyFromScipSymbol(symbol);
      if (dependency) dependencies.add(dependency);
    }

    if ((symbolRoles & SYMBOL_ROLE_DEFINITION) !== SYMBOL_ROLE_DEFINITION) continue;
    const symbolInfo = symbolById.get(symbol);
    if (!symbolInfo) continue;
    if (!FUNCTION_KINDS.has(symbolInfo.kind ?? 0)) continue;

    const range = normalizeScipRange(occurrence.range ?? []);
    const name = extractFunctionName(symbolInfo, symbol);
    const uniqueKey = `${name}:${range.startLine}:${range.endLine}`;
    if (!name || seenFunctions.has(uniqueKey)) continue;
    seenFunctions.add(uniqueKey);

    const signature = (
      symbolInfo.signature_documentation?.text
      ?? symbolInfo.display_name
      ?? `${name}()`
    ).trim();
    const purpose = firstLine(symbolInfo.documentation?.[0] ?? '');

    functions.push({
      name,
      signature,
      startLine: range.startLine,
      endLine: range.endLine,
      purpose,
    });
  }

  const exports = Array.from(new Set(functions.map((fn) => fn.name)));
  return {
    parser: 'scip-typescript',
    functions,
    module: {
      exports,
      dependencies: Array.from(dependencies),
    },
  };
}

async function runScipTypescriptIndex(input: {
  workspaceRoot: string;
  outputPath: string;
  timeoutMs: number;
}): Promise<void> {
  const args = [
    'index',
    '--cwd',
    input.workspaceRoot,
    '--output',
    input.outputPath,
    '--no-progress-bar',
  ];

  const localBinary = localScipBinaryPath(input.workspaceRoot);
  if (localBinary) {
    await execFileAsync(localBinary, args, {
      cwd: input.workspaceRoot,
      timeout: input.timeoutMs,
      maxBuffer: 1024 * 1024 * 16,
    });
    return;
  }

  await execFileAsync('npx', ['--yes', '@sourcegraph/scip-typescript', ...args], {
    cwd: input.workspaceRoot,
    timeout: input.timeoutMs,
    maxBuffer: 1024 * 1024 * 16,
  });
}

async function decodeScipIndex(input: {
  outputPath: string;
  timeoutMs: number;
}): Promise<DecodedScipDocument[]> {
  try {
    const moduleSpecifier = '@sourcegraph/scip-typescript/dist/src/scip.js';
    const scipModule = await import(moduleSpecifier);
    const scip = (scipModule as { scip?: { Index?: { deserializeBinary: (bytes: Uint8Array) => { toObject: () => { documents?: DecodedScipDocument[] } } } } }).scip;
    if (scip?.Index?.deserializeBinary) {
      const bytes = await fs.readFile(input.outputPath);
      const parsed = scip.Index.deserializeBinary(new Uint8Array(bytes));
      return parsed.toObject().documents ?? [];
    }
  } catch {
    // Fall through to npx-based decoding.
  }

  const decodeScript = [
    "const fs = require('node:fs');",
    "const { scip } = require('@sourcegraph/scip-typescript/dist/src/scip.js');",
    'const bytes = fs.readFileSync(process.argv[1]);',
    'const parsed = scip.Index.deserializeBinary(new Uint8Array(bytes));',
    'const docs = parsed.toObject().documents || [];',
    'process.stdout.write(JSON.stringify(docs));',
  ].join('');

  const { stdout } = await execFileAsync(
    'npx',
    ['--yes', '-p', '@sourcegraph/scip-typescript', '-p', 'google-protobuf', 'node', '-e', decodeScript, input.outputPath],
    {
      timeout: input.timeoutMs,
      maxBuffer: 1024 * 1024 * 16,
    }
  );
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as DecodedScipDocument[];
}

function normalizeScipRange(range: number[]): { startLine: number; endLine: number } {
  const startLine = Math.max(0, range[0] ?? 0);
  let endLine = startLine;
  if (range.length >= 4) {
    endLine = Math.max(startLine, range[2] ?? startLine);
  }
  return {
    startLine: startLine + 1,
    endLine: endLine + 1,
  };
}

function extractFunctionName(symbolInfo: DecodedScipSymbolInformation, symbol: string): string {
  const displayName = symbolInfo.display_name?.trim();
  if (displayName) return displayName;

  const descriptorMatch = symbol.match(/\/([^\/`]+)\(\)\./);
  if (descriptorMatch?.[1]) return descriptorMatch[1];
  return '';
}

function dependencyFromScipSymbol(symbol: string): string | null {
  const match = symbol.match(/^scip\s+\S+\s+(\S+)\s+\S+\s+/);
  if (match?.[1]) return match[1];
  return null;
}

function firstLine(value: string): string {
  return value.split('\n')[0]?.trim() ?? '';
}

function isTsJsFile(filePath: string): boolean {
  return TS_JS_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function getMtimeMs(targetPath: string): Promise<number> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

function localScipBinaryPath(workspaceRoot: string): string | null {
  const unixPath = path.join(workspaceRoot, 'node_modules', '.bin', 'scip-typescript');
  const windowsPath = path.join(workspaceRoot, 'node_modules', '.bin', 'scip-typescript.cmd');
  const candidate = process.platform === 'win32' ? windowsPath : unixPath;
  return fssync.existsSync(candidate) ? candidate : null;
}
