import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import {
  generatePatrolTestPairs,
  loadPatrolFindingCorpus,
  type PatrolPairTemplate,
  type PatrolTestPair,
} from './patrol_swebench_pairs.js';

export interface PatrolRegressionOracleTestSpec {
  id: string;
  issueNumber: number;
  title: string;
  description: string;
  template: PatrolPairTemplate;
  preFixRef: string;
  targetFilePath: string;
  targetPattern: string;
  targetShouldMatch: boolean;
  generatedTestPath: string;
}

export interface PatrolRegressionOracleArtifact {
  schema: 'PatrolRegressionOracle.v1';
  generatedAt: string;
  sourceCorpusPath: string;
  outputDir: string;
  testCount: number;
  tests: PatrolRegressionOracleTestSpec[];
}

export interface PatrolRegressionOracleCaseResult {
  issueNumber: number;
  generatedTestPath: string;
  pass: boolean;
  minimal: boolean;
  preFixFails: boolean;
  generatedTestPasses: boolean;
  findings: string[];
}

export interface PatrolRegressionOracleEvaluationResult {
  kind: 'PatrolRegressionOracleEvaluation.v1';
  pass: boolean;
  passCount: number;
  testCount: number;
  artifact: PatrolRegressionOracleArtifact;
  results: PatrolRegressionOracleCaseResult[];
  findings: string[];
  durationMs: number;
}

export interface PatrolRegressionOracleMaterializeOptions {
  repoRoot?: string;
  corpusPath?: string;
  outputDir?: string;
}

export interface PatrolRegressionOracleEvaluationOptions extends PatrolRegressionOracleMaterializeOptions {
  runGeneratedTests?: boolean;
  testTimeoutMs?: number;
}

const DEFAULT_CORPUS_PATH = 'eval-corpus/patrol-test-pairs/findings.json';
const DEFAULT_OUTPUT_DIR = 'eval-corpus/patrol-regression-tests/generated';
const DEFAULT_TEST_TIMEOUT_MS = 60_000;

function resolvePath(repoRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

function sanitizeId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 64);
}

function toOracleSpec(pair: PatrolTestPair, outputDir: string): PatrolRegressionOracleTestSpec {
  const basename = `issue-${pair.issueNumber}-${sanitizeId(pair.title)}.test.ts`;
  return {
    id: pair.id,
    issueNumber: pair.issueNumber,
    title: pair.title,
    description: pair.description,
    template: pair.template,
    preFixRef: pair.failToPass.preFixRef,
    targetFilePath: pair.failToPass.postFixCheck.filePath,
    targetPattern: pair.failToPass.postFixCheck.pattern,
    targetShouldMatch: pair.failToPass.postFixCheck.shouldMatch,
    generatedTestPath: path.join(outputDir, basename),
  };
}

function renderRegressionTest(spec: PatrolRegressionOracleTestSpec): string {
  return [
    "import { readFile } from 'node:fs/promises';",
    "import * as path from 'node:path';",
    "import { describe, expect, it } from 'vitest';",
    '',
    `describe('Patrol regression oracle: #${spec.issueNumber}', () => {`,
    `  it(${JSON.stringify(spec.title)}, async () => {`,
    `    const filePath = path.join(process.cwd(), ${JSON.stringify(spec.targetFilePath)});`,
    "    const content = await readFile(filePath, 'utf8');",
    `    const hasPattern = content.includes(${JSON.stringify(spec.targetPattern)});`,
    `    expect(hasPattern).toBe(${spec.targetShouldMatch});`,
    '  });',
    '});',
    '',
  ].join('\n');
}

async function readFileAtRef(repoRoot: string, ref: string, filePath: string): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    const child = spawn('git', ['show', `${ref}:${filePath}`], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.on('close', (code) => resolve(code === 0 ? stdout : null));
    child.on('error', () => resolve(null));
  });
}

async function runGeneratedVitest(repoRoot: string, testFilePath: string, timeoutMs: number): Promise<boolean> {
  const runnerDir = path.join(repoRoot, 'src/__tests__/generated/patrol-regression-oracle-runners');
  await fs.mkdir(runnerDir, { recursive: true });
  const runnerPath = path.join(
    runnerDir,
    `${sanitizeId(path.basename(testFilePath, '.test.ts'))}-runner.test.ts`,
  );
  const relativeImportPath = path.relative(path.dirname(runnerPath), testFilePath).replace(/\\/gu, '/');
  const importPath = relativeImportPath.startsWith('.') ? relativeImportPath : `./${relativeImportPath}`;
  await fs.writeFile(runnerPath, `import ${JSON.stringify(importPath)};\n`, 'utf8');

  return await new Promise<boolean>((resolve) => {
    const child = spawn('npm', ['test', '--', '--run', runnerPath], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void fs.rm(runnerPath, { force: true });
      resolve(value);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, timeoutMs);
    child.on('close', (code) => {
      finish(code === 0);
    });
    child.on('error', () => {
      finish(false);
    });
  });
}

function isMinimalTestSource(source: string): boolean {
  const lineCount = source.split('\n').length;
  const testCount = (source.match(/\bit\(/gu) ?? []).length;
  return lineCount <= 80 && testCount === 1;
}

export async function materializePatrolRegressionOracleTests(
  options: PatrolRegressionOracleMaterializeOptions = {},
): Promise<PatrolRegressionOracleArtifact> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const sourceCorpusPath = resolvePath(repoRoot, options.corpusPath ?? DEFAULT_CORPUS_PATH);
  const outputDir = resolvePath(repoRoot, options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const corpus = await loadPatrolFindingCorpus(repoRoot, sourceCorpusPath);
  const pairs = await generatePatrolTestPairs(corpus.findings, repoRoot);
  const tests = pairs.map((pair) => toOracleSpec(pair, outputDir));

  await fs.mkdir(outputDir, { recursive: true });
  for (const testSpec of tests) {
    await fs.writeFile(testSpec.generatedTestPath, renderRegressionTest(testSpec), 'utf8');
  }

  const artifact: PatrolRegressionOracleArtifact = {
    schema: 'PatrolRegressionOracle.v1',
    generatedAt: new Date().toISOString(),
    sourceCorpusPath,
    outputDir,
    testCount: tests.length,
    tests,
  };
  await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return artifact;
}

export async function evaluatePatrolRegressionOracle(
  options: PatrolRegressionOracleEvaluationOptions = {},
): Promise<PatrolRegressionOracleEvaluationResult> {
  const startedAt = Date.now();
  const repoRoot = options.repoRoot ?? process.cwd();
  const runGeneratedTests = options.runGeneratedTests ?? true;
  const testTimeoutMs = options.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  const artifact = await materializePatrolRegressionOracleTests(options);
  const results: PatrolRegressionOracleCaseResult[] = [];

  for (const spec of artifact.tests) {
    const findings: string[] = [];
    const preFixContent = await readFileAtRef(repoRoot, spec.preFixRef, spec.targetFilePath);
    const preFixHasPattern = preFixContent?.includes(spec.targetPattern) ?? false;
    const preFixFails = spec.targetShouldMatch ? !preFixHasPattern : preFixHasPattern;
    if (preFixContent === null && !preFixFails) {
      findings.push(`Pre-fix content unavailable at ${spec.preFixRef}:${spec.targetFilePath}`);
    } else if (!preFixFails) {
      findings.push(`Pre-fix state did not violate generated assertion for ${spec.targetFilePath}`);
    }

    const source = await fs.readFile(spec.generatedTestPath, 'utf8');
    const minimal = isMinimalTestSource(source);
    if (!minimal) {
      findings.push(`Generated test is not minimal: ${path.basename(spec.generatedTestPath)}`);
    }

    let generatedTestPasses = true;
    if (runGeneratedTests) {
      generatedTestPasses = await runGeneratedVitest(repoRoot, spec.generatedTestPath, testTimeoutMs);
      if (!generatedTestPasses) {
        findings.push(`Generated test failed to pass on current code: ${path.basename(spec.generatedTestPath)}`);
      }
    }

    results.push({
      issueNumber: spec.issueNumber,
      generatedTestPath: spec.generatedTestPath,
      pass: preFixFails && minimal && generatedTestPasses,
      minimal,
      preFixFails,
      generatedTestPasses,
      findings,
    });
  }

  const passCount = results.filter((result) => result.pass).length;
  const findings = results.flatMap((result) => result.findings);
  return {
    kind: 'PatrolRegressionOracleEvaluation.v1',
    pass: artifact.testCount > 0 && passCount === artifact.testCount,
    passCount,
    testCount: artifact.testCount,
    artifact,
    results,
    findings,
    durationMs: Date.now() - startedAt,
  };
}
