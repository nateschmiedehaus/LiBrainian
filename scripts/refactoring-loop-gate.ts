#!/usr/bin/env tsx

import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as ts from 'typescript';
import { createRefactoringLoopGateConstruction, type RefactoringLoopResult } from '../src/constructions/processes/refactoring_loop_gate.js';

type Mode = 'precommit' | 'ci';

interface CliOptions {
  mode: Mode;
  iteration: number;
  maxIterations: number;
  gateLevel?: 2 | 4;
  json: boolean;
  files: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: 'precommit',
    iteration: 1,
    maxIterations: 3,
    json: false,
    files: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode' && argv[i + 1]) {
      const mode = argv[++i];
      if (mode === 'precommit' || mode === 'ci') options.mode = mode;
      continue;
    }
    if (arg === '--iteration' && argv[i + 1]) {
      const parsed = Number(argv[++i]);
      if (Number.isFinite(parsed) && parsed > 0) options.iteration = Math.floor(parsed);
      continue;
    }
    if (arg === '--max-iterations' && argv[i + 1]) {
      const parsed = Number(argv[++i]);
      if (Number.isFinite(parsed) && parsed > 0) options.maxIterations = Math.floor(parsed);
      continue;
    }
    if (arg === '--gate-level' && argv[i + 1]) {
      const parsed = Number(argv[++i]);
      if (parsed === 2 || parsed === 4) options.gateLevel = parsed;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('-')) continue;
    options.files.push(arg);
  }

  return options;
}

function runShell(command: string): { ok: boolean; status: number; stdout: string; stderr: string } {
  const result = spawnSync('bash', ['-lc', command], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  return {
    ok: (result.status ?? 1) === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function collectChangedFilesFromGit(mode: Mode): string[] {
  const command = mode === 'ci'
    ? 'git diff --name-only --diff-filter=AMCR origin/main...HEAD'
    : 'git diff --name-only --cached --diff-filter=AMCR';
  const result = runShell(command);
  if (!result.ok) return [];
  return result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

function resolveCodeFiles(rawFiles: string[]): string[] {
  const supported = rawFiles.filter((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/iu.test(file));
  const resolved = supported.map((file) => (path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)));
  return resolved.filter((file) => {
    if (!existsSync(file)) return false;
    const normalized = file.replace(/\\/gu, '/');
    if (normalized.includes('/__tests__/')) return false;
    if (/\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/iu.test(normalized)) return false;
    return true;
  });
}

function syntaxCheck(files: string[]): { pass: boolean; diagnostics: string[] } {
  const diagnostics: string[] = [];

  for (const file of files) {
    try {
      const source = readFileSync(file, 'utf8');
      const scriptKind = file.endsWith('.tsx')
        ? ts.ScriptKind.TSX
        : file.endsWith('.ts')
          ? ts.ScriptKind.TS
          : file.endsWith('.jsx')
            ? ts.ScriptKind.JSX
            : ts.ScriptKind.JS;
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
      for (const diag of sourceFile.parseDiagnostics) {
        const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
        const line = diag.start !== undefined
          ? sourceFile.getLineAndCharacterOfPosition(diag.start).line + 1
          : undefined;
        diagnostics.push(line ? `${file}:${line}: ${message}` : `${file}: ${message}`);
      }
    } catch (error) {
      diagnostics.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { pass: diagnostics.length === 0, diagnostics };
}

function discoverRelatedTests(changedFiles: string[]): string[] {
  const tests = new Set<string>();

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/gu, '/');
    const ext = path.extname(file);
    const base = file.slice(0, -ext.length);
    const fileName = path.basename(base);
    const dirName = path.dirname(file);

    if (/\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/iu.test(normalized)) {
      tests.add(file);
      continue;
    }

    const candidates = [
      `${base}.test${ext}`,
      `${base}.spec${ext}`,
      path.join(dirName, '__tests__', `${fileName}.test${ext}`),
      path.join(dirName, '__tests__', `${fileName}.spec${ext}`),
      path.join(path.dirname(dirName), '__tests__', `${fileName}.test${ext}`),
      path.join(path.dirname(dirName), '__tests__', `${fileName}.spec${ext}`),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) tests.add(candidate);
    }
  }

  return [...tests];
}

function runRelatedTests(relatedTests: string[]): { ok: boolean; status: number; stdout: string; stderr: string } {
  if (relatedTests.length === 0) {
    return {
      ok: false,
      status: 1,
      stdout: '',
      stderr: 'No related tests discovered for changed files.',
    };
  }

  const testsArg = relatedTests.map(shellQuote).join(' ');
  return runShell(`node scripts/run-with-tmpdir.mjs --set LIBRAINIAN_TEST_MODE=unit -- vitest --run ${testsArg}`);
}

function loadAgenticUtilityDelta(): number {
  const latestPath = path.resolve(process.cwd(), 'state/eval/fitness/latest.json');
  const baselinePath = path.resolve(process.cwd(), 'state/eval/fitness/baseline.json');
  if (!existsSync(latestPath)) return 0;

  try {
    const latest = JSON.parse(readFileSync(latestPath, 'utf8')) as { overallScore?: number };
    const baseline = existsSync(baselinePath)
      ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as { overallScore?: number })
      : null;
    if (baseline && typeof latest.overallScore === 'number' && typeof baseline.overallScore === 'number') {
      return latest.overallScore - baseline.overallScore;
    }
  } catch {
    return 0;
  }

  return 0;
}

function printTextReport(result: RefactoringLoopResult): void {
  const status = result.pass ? 'PASS' : 'FAIL';
  console.log(`[refactoring-loop-gate] ${status}: ${result.summary}`);
  if (result.failedLevels.length > 0) {
    console.log(`[refactoring-loop-gate] Failed levels: ${result.failedLevels.join(', ')}`);
  }
  if (result.requiredImprovements.length > 0) {
    console.log('[refactoring-loop-gate] Required improvements:');
    for (const item of result.requiredImprovements.slice(0, 10)) {
      console.log(`- [${item.severity}] ${item.category}: ${item.issue}`);
      console.log(`  Suggested fix: ${item.suggestedFix}`);
      console.log(`  Peer example (${item.peerExample.functionId}): ${item.peerExample.snippet.split('\n')[0] ?? ''}`);
    }
  }
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const files = options.files.length > 0 ? options.files : collectChangedFilesFromGit(options.mode);
  const changedFiles = resolveCodeFiles(files);
  const gateLevel = options.gateLevel ?? (options.mode === 'ci' ? 4 : 2);

  if (changedFiles.length === 0) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ mode: options.mode, gateLevel, changedFiles, skipped: true }, null, 2)}\n`);
    } else {
      console.log('[refactoring-loop-gate] PASS: no changed code files to evaluate.');
    }
    return 0;
  }

  const l0 = syntaxCheck(changedFiles);
  const relatedTests = discoverRelatedTests(changedFiles);
  const l1 = runRelatedTests(relatedTests);
  const l4Delta = loadAgenticUtilityDelta();

  const gate = createRefactoringLoopGateConstruction();

  try {
    const result = await gate.execute({
    workspace: process.cwd(),
    changedFiles,
    iteration: options.iteration,
    maxIterations: options.maxIterations,
    gateLevel,
    l0CompilationPassed: l0.pass,
    l1TestsPassed: l1.ok,
    l4AgenticUtilityDelta: l4Delta,
    });

    const payload = {
      mode: options.mode,
      gateLevel,
      changedFiles,
      l0: { pass: l0.pass, diagnostics: l0.diagnostics },
      l1: { pass: l1.ok, status: l1.status },
      relatedTests,
      result,
    };

    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      printTextReport(result);
    }

    if (result.pass) return 0;
    if (result.escalateToHuman) {
      console.error('[refactoring-loop-gate] Human review required: max iterations exhausted.');
      return 3;
    }
    console.error('[refactoring-loop-gate] Repair cycle required before acceptance.');
    return 2;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[refactoring-loop-gate] failed: ${message}`);
    return 1;
  }
}

void main().then((code) => {
  process.exit(code);
});
