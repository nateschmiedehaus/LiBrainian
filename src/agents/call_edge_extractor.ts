import { createRequire } from 'node:module';
import { Project, SyntaxKind, Node } from 'ts-morph';
import type { ParsedFunction } from './parser_registry.js';
import { logWarning } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';

export interface ParsedCallEdge {
  fromName: string;
  fromStartLine: number;
  toName: string;
  callLine?: number | null;
}

type TreeSitterPoint = { row: number; column: number };
type TreeSitterNode = {
  type: string;
  startIndex: number;
  endIndex: number;
  startPosition: TreeSitterPoint;
  endPosition: TreeSitterPoint;
  namedChildren: TreeSitterNode[];
  childForFieldName: (field: string) => TreeSitterNode | null;
};
type TreeSitterTree = { rootNode: TreeSitterNode };
type TreeSitterParser = { setLanguage: (language: TreeSitterLanguage) => void; parse: (content: string) => TreeSitterTree };
type TreeSitterModule = { Parser: new () => TreeSitterParser };
type TreeSitterLanguage = { name?: string };

const require = createRequire(import.meta.url);
const TREE_SITTER_ALLOWLIST = new Set([
  'tree-sitter-typescript',
  'tree-sitter-javascript',
  'tree-sitter-python',
  'tree-sitter-go',
  'tree-sitter-rust',
  'tree-sitter-java',
  'tree-sitter-c',
  'tree-sitter-cpp',
  'tree-sitter-ruby',
  'tree-sitter-php',
  'tree-sitter-c-sharp',
  'tree-sitter-kotlin',
  'tree-sitter-swift',
  'tree-sitter-scala',
  'tree-sitter-dart',
  'tree-sitter-lua',
  'tree-sitter-bash',
  'tree-sitter-sql',
  'tree-sitter-json',
  'tree-sitter-yaml',
]);
const warned = new Set<string>();

export function extractCallEdgesFromAst(
  filePath: string,
  content: string,
  functions: ParsedFunction[],
  parserName: string
): ParsedCallEdge[] {
  if (functions.length === 0) return [];
  if (parserName === 'ts-morph') {
    return extractTsMorphCallEdges(filePath, content, functions);
  }
  if (parserName.startsWith('tree-sitter-')) {
    return extractTreeSitterCallEdges(content, functions, parserName);
  }
  return [];
}

function extractTsMorphCallEdges(
  filePath: string,
  content: string,
  functions: ParsedFunction[]
): ParsedCallEdge[] {
  let project: Project | null = null;
  let sourceFile: ReturnType<Project['createSourceFile']> | null = null;
  try {
    project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        noResolve: true,
        skipLibCheck: true,
      },
    });
    sourceFile = project.createSourceFile(filePath, content, { overwrite: true });
    const edges: ParsedCallEdge[] = [];
    const seen = new Set<string>();
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      const targetName = resolveCallExpressionName(call);
      if (!targetName) continue;
      const callLine = call.getStartLineNumber();
      const from = findEnclosingFunction(functions, callLine);
      if (!from) continue;
      const key = `${from.name}:${from.startLine}:${targetName}:${callLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        fromName: from.name,
        fromStartLine: from.startLine,
        toName: targetName,
        callLine,
      });
    }
    return edges;
  } catch (error: unknown) {
    warnOnce('ts-morph-call-edges', 'Librarian call edge extraction failed', {
      parser: 'ts-morph',
      filePath,
      error: getErrorMessage(error),
    });
    return [];
  } finally {
    if (project && sourceFile) {
      project.removeSourceFile(sourceFile);
    }
  }
}

function resolveCallExpressionName(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null;
  const target = call.getExpression();
  if (Node.isIdentifier(target)) return target.getText();
  if (Node.isPropertyAccessExpression(target)) return target.getName() ?? null;
  if (Node.isElementAccessExpression(target)) return null;
  return null;
}

function extractTreeSitterCallEdges(
  content: string,
  functions: ParsedFunction[],
  parserName: string
): ParsedCallEdge[] {
  if (!TREE_SITTER_ALLOWLIST.has(parserName)) {
    warnOnce(`tree-sitter-allowlist:${parserName}`, 'Tree-sitter parser not allowlisted', { parserName });
    return [];
  }
  const treeSitter = loadTreeSitterModule();
  const language = loadTreeSitterLanguage(parserName);
  if (!treeSitter?.Parser || !language) return [];

  const parser = new treeSitter.Parser();
  parser.setLanguage(language);
  let tree: TreeSitterTree;
  try {
    tree = parser.parse(content);
  } catch (error: unknown) {
    warnOnce(`tree-sitter-parse:${parserName}`, 'Tree-sitter parse failed', {
      parserName,
      error: getErrorMessage(error),
    });
    return [];
  }
  const edges: ParsedCallEdge[] = [];
  const seen = new Set<string>();

  walkTree(tree.rootNode, (node) => {
    if (!isCallNode(node)) return;
    const targetNode = node.childForFieldName('function') ?? node.namedChildren?.[0];
    const targetName = targetNode ? extractIdentifier(nodeText(content, targetNode)) : null;
    if (!targetName) return;
    const callLine = node.startPosition.row + 1;
    const from = findEnclosingFunction(functions, callLine);
    if (!from) return;
    const key = `${from.name}:${from.startLine}:${targetName}:${callLine}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      fromName: from.name,
      fromStartLine: from.startLine,
      toName: targetName,
      callLine,
    });
  });

  return edges;
}

function isCallNode(node: TreeSitterNode): boolean {
  return node.type === 'call' || node.type === 'call_expression';
}

function extractIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /([\p{L}_][\p{L}\p{N}_]*)$/u.exec(trimmed);
  return match?.[1] ?? null;
}

function findEnclosingFunction(functions: ParsedFunction[], line: number): ParsedFunction | null {
  let best: ParsedFunction | null = null;
  for (const fn of functions) {
    if (line < fn.startLine || line > fn.endLine) continue;
    if (!best) {
      best = fn;
      continue;
    }
    const bestSpan = best.endLine - best.startLine;
    const candidateSpan = fn.endLine - fn.startLine;
    if (candidateSpan <= bestSpan) {
      best = fn;
    }
  }
  return best;
}

function walkTree(node: TreeSitterNode, visitor: (node: TreeSitterNode) => void): void {
  visitor(node);
  for (const child of node.namedChildren) {
    walkTree(child, visitor);
  }
}

function nodeText(content: string, node: TreeSitterNode): string {
  return content.slice(node.startIndex, node.endIndex);
}

function loadTreeSitterModule(): TreeSitterModule | null {
  try {
    return require('tree-sitter') as TreeSitterModule;
  } catch {
    warnOnce('tree-sitter-missing', 'Tree-sitter module not available');
    return null;
  }
}

function loadTreeSitterLanguage(parserName: string): TreeSitterLanguage | null {
  const moduleName = parserName;
  try {
    const mod = require(moduleName) as TreeSitterLanguage | { default?: TreeSitterLanguage };
    if (typeof (mod as { default?: TreeSitterLanguage }).default !== 'undefined') {
      return (mod as { default?: TreeSitterLanguage }).default ?? null;
    }
    return mod as TreeSitterLanguage;
  } catch {
    warnOnce(`tree-sitter-language-missing:${parserName}`, 'Tree-sitter language module not available', {
      parserName,
    });
    return null;
  }
}

function warnOnce(key: string, message: string, meta: Record<string, unknown> = {}): void {
  if (warned.has(key)) return;
  warned.add(key);
  logWarning(`[librarian] ${message}`, meta);
}
