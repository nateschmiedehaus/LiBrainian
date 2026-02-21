import * as fs from 'fs/promises';
import path from 'path';
import { evaluateEscapeHatch } from './escape_hatches.js';

export interface FileReadRequest {
  agentId: string;
  taskId: string;
  filePath: string;
  reason?: string;
  contextProvided: string[];
}

export type FileReadDecision =
  | { allowed: true; source: 'in_context' | 'justified_read' | 'trivial_file' | 'unindexed' | 'policy_override' | 'config_file'; note?: string }
  | { allowed: false; reason: 'must_query_librainian' | 'outside_scope'; suggestion: string };

export interface FileReadPolicy {
  evaluate(request: FileReadRequest): Promise<FileReadDecision> | FileReadDecision;
}

export interface FileReadPolicyOptions {
  mode?: 'block' | 'warn' | 'log';
  isIndexed?: (path: string) => Promise<boolean>;
  getFileContent?: (path: string) => Promise<string>;
  maxTrivialLines?: number;
  maxTrivialComplexity?: number;
  workspaceRoot?: string;
}

const DEFAULT_MAX_TRIVIAL_LINES = 50;
const DEFAULT_MAX_TRIVIAL_COMPLEXITY = 5;

function normalizePath(value: string): string {
  return path.resolve(value).split(path.sep).join('/');
}

function resolveAbsolutePath(value: string, root?: string): string {
  if (root && !path.isAbsolute(value)) return path.resolve(root, value);
  return path.resolve(value);
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isJustified(reason?: string): boolean {
  return typeof reason === 'string' && reason.trim().length > 10;
}

export class DefaultFileReadPolicy implements FileReadPolicy {
  private readonly mode: FileReadPolicyOptions['mode'];
  private readonly isIndexed?: FileReadPolicyOptions['isIndexed'];
  private readonly getFileContent?: FileReadPolicyOptions['getFileContent'];
  private readonly maxTrivialLines: number;
  private readonly maxTrivialComplexity: number;
  private readonly workspaceRoot?: string;
  private workspaceRootReal: string | null = null;

  constructor(options: FileReadPolicyOptions = {}) {
    this.mode = options.mode ?? 'block';
    this.isIndexed = options.isIndexed;
    this.getFileContent = options.getFileContent;
    this.maxTrivialLines = Math.max(1, options.maxTrivialLines ?? DEFAULT_MAX_TRIVIAL_LINES);
    this.maxTrivialComplexity = Math.max(1, options.maxTrivialComplexity ?? DEFAULT_MAX_TRIVIAL_COMPLEXITY);
    this.workspaceRoot = options.workspaceRoot ? normalizePath(options.workspaceRoot) : undefined;
  }

  async evaluate(request: FileReadRequest): Promise<FileReadDecision> {
    const resolvedTarget = await this.resolveTargetPath(request.filePath);
    const workspaceRoot = await this.resolveWorkspaceRoot();
    if (workspaceRoot && !isWithinRoot(workspaceRoot, resolvedTarget)) {
      return { allowed: false, reason: 'outside_scope', suggestion: 'File path is outside the workspace root.' };
    }

    const normalizedTarget = normalizePath(resolveAbsolutePath(request.filePath, this.workspaceRoot));
    const normalizedProvided = request.contextProvided.map((value) => normalizePath(resolveAbsolutePath(value, this.workspaceRoot)));
    if (normalizedProvided.includes(normalizedTarget)) return { allowed: true, source: 'in_context' };

    const indexed = this.isIndexed ? await this.isIndexed(request.filePath) : undefined;
    const readFile = this.getFileContent
      ? async (filePath: string) => this.getFileContent!(filePath)
      : undefined;
    const escape = await evaluateEscapeHatch(
      { filePath: request.filePath, reason: request.reason, indexed },
      { maxLines: this.maxTrivialLines, maxComplexity: this.maxTrivialComplexity, readFile }
    );
    if (escape.allowed) {
      if (escape.reason === 'config_file') return { allowed: true, source: 'config_file' };
      if (escape.reason === 'explicit_override') return { allowed: true, source: 'justified_read' };
      if (escape.reason === 'unindexed') return { allowed: true, source: 'unindexed' };
      return { allowed: true, source: 'trivial_file' };
    }

    if (isJustified(request.reason)) return { allowed: true, source: 'justified_read' };
    if (this.mode !== 'block') return { allowed: true, source: 'policy_override', note: `mode:${this.mode}` };
    return { allowed: false, reason: 'must_query_librainian', suggestion: 'Query librainian before reading this file.' };
  }

  private async resolveWorkspaceRoot(): Promise<string | null> {
    if (!this.workspaceRoot) return null;
    if (this.workspaceRootReal) return this.workspaceRootReal;
    const resolved = resolveAbsolutePath(this.workspaceRoot);
    try {
      this.workspaceRootReal = normalizePath(await fs.realpath(resolved));
    } catch {
      this.workspaceRootReal = normalizePath(resolved);
    }
    return this.workspaceRootReal;
  }

  private async resolveTargetPath(filePath: string): Promise<string> {
    const resolved = resolveAbsolutePath(filePath, this.workspaceRoot);
    try {
      return normalizePath(await fs.realpath(resolved));
    } catch {
      return normalizePath(resolved);
    }
  }
}
