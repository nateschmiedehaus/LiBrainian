import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export interface PatrolFindingDescriptor {
  issueNumber: number;
  title: string;
  description: string;
  preFixRef: string;
}

export interface PatrolFindingCorpus {
  schema: 'PatrolFindingCorpus.v1';
  findings: PatrolFindingDescriptor[];
}

export type PatrolPairTemplate =
  | 'cli_error_envelope'
  | 'capability_inventory'
  | 'result_quality_judge'
  | 'generic';

export interface PairCheckSpec {
  filePath: string;
  pattern: string;
  shouldMatch: boolean;
}

export interface PatrolFailToPassSpec {
  generatedFrom: string;
  preFixRef: string;
  preFixCheck: PairCheckSpec;
  postFixCheck: PairCheckSpec;
  postFixVerificationCommand: string;
}

export interface PatrolTestPair {
  id: string;
  issueNumber: number;
  template: PatrolPairTemplate;
  title: string;
  description: string;
  failToPass: PatrolFailToPassSpec;
  passToPassTests: string[];
}

export interface PatrolPairEvaluation {
  pairId: string;
  issueNumber: number;
  pass: boolean;
  preFixFailed: boolean;
  postFixPassed: boolean;
  passToPassIdentified: boolean;
  verificationExecuted: boolean;
  verificationPassed: boolean;
  findings: string[];
}

export interface PatrolPairHarnessResult {
  kind: 'PatrolSwebenchHarnessResult.v1';
  pass: boolean;
  pairCount: number;
  resolvedCount: number;
  resolveRate: number;
  evaluations: PatrolPairEvaluation[];
}

export interface PatrolPairHarnessOptions {
  repoRoot?: string;
  executeVerificationCommands?: boolean;
  verificationTimeoutMs?: number;
}

export interface PatrolTestPairCorpus {
  schema: 'PatrolTestPairCorpus.v1';
  sourceCorpusPath: string;
  generatedAt: string;
  pairCount: number;
  pairs: PatrolTestPair[];
}

export interface MaterializePatrolTestPairsOptions {
  repoRoot?: string;
  corpusPath?: string;
  outputPath?: string;
}

export interface MaterializedPatrolTestPairs extends PatrolTestPairCorpus {
  outputPath: string;
}

const DEFAULT_CORPUS_PATH = 'eval-corpus/patrol-test-pairs/findings.json';
const DEFAULT_OUTPUT_PATH = 'eval-corpus/patrol-test-pairs/pairs.generated.json';
const DEFAULT_VERIFICATION_TIMEOUT_MS = 120_000;

const TEMPLATE_PASS_TO_PASS_CANDIDATES: Record<PatrolPairTemplate, string[]> = {
  cli_error_envelope: [
    'src/cli/__tests__/errors.test.ts',
    'src/constructions/processes/__tests__/cli_output_sanity_gate.test.ts',
    'src/constructions/processes/__tests__/patrol_regression_closure_gate.test.ts',
  ],
  capability_inventory: [
    'src/cli/commands/__tests__/capabilities.test.ts',
    'src/mcp/__tests__/list_capabilities.test.ts',
    'src/constructions/processes/__tests__/cli_output_sanity_gate.test.ts',
  ],
  result_quality_judge: [
    'src/constructions/processes/__tests__/result_quality_judge.test.ts',
    'src/constructions/processes/__tests__/query_relevance_gate.test.ts',
    'src/constructions/processes/__tests__/unit_patrol.test.ts',
  ],
  generic: [
    'src/constructions/processes/__tests__/unit_patrol.test.ts',
    'src/constructions/processes/__tests__/patrol_regression_closure_gate.test.ts',
  ],
};

function sanitizeId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 64);
}

function detectTemplate(finding: PatrolFindingDescriptor): PatrolPairTemplate {
  const text = `${finding.title} ${finding.description}`.toLowerCase();
  if (text.includes('resultqualityjudge') || text.includes('actionability') || text.includes('completeness')) {
    return 'result_quality_judge';
  }
  if (text.includes('capability') || text.includes('inventory') || text.includes('list_capabilities')) {
    return 'capability_inventory';
  }
  if (text.includes('error') || text.includes('single-line') || text.includes('--debug')) {
    return 'cli_error_envelope';
  }
  return 'generic';
}

function buildFailToPassSpec(template: PatrolPairTemplate, finding: PatrolFindingDescriptor): PatrolFailToPassSpec {
  if (template === 'cli_error_envelope') {
    return {
      generatedFrom: 'description_keywords:error/single-line/debug',
      preFixRef: finding.preFixRef,
      preFixCheck: {
        filePath: 'src/cli/index.ts',
        pattern: "debug: { type: 'boolean', default: false }",
        shouldMatch: false,
      },
      postFixCheck: {
        filePath: 'src/cli/index.ts',
        pattern: "debug: { type: 'boolean', default: false }",
        shouldMatch: true,
      },
      postFixVerificationCommand: 'npm test -- --run src/cli/__tests__/errors.test.ts',
    };
  }

  if (template === 'capability_inventory') {
    return {
      generatedFrom: 'description_keywords:capability/inventory',
      preFixRef: finding.preFixRef,
      preFixCheck: {
        filePath: 'src/cli/commands/capabilities.ts',
        pattern: 'export async function capabilitiesCommand',
        shouldMatch: false,
      },
      postFixCheck: {
        filePath: 'src/cli/commands/capabilities.ts',
        pattern: 'export async function capabilitiesCommand',
        shouldMatch: true,
      },
      postFixVerificationCommand: 'npm test -- --run src/cli/commands/__tests__/capabilities.test.ts',
    };
  }

  if (template === 'result_quality_judge') {
    return {
      generatedFrom: 'description_keywords:resultqualityjudge/relevance/completeness/actionability/accuracy',
      preFixRef: finding.preFixRef,
      preFixCheck: {
        filePath: 'src/constructions/processes/result_quality_judge.ts',
        pattern: 'createResultQualityJudgeConstruction',
        shouldMatch: false,
      },
      postFixCheck: {
        filePath: 'src/constructions/processes/result_quality_judge.ts',
        pattern: 'createResultQualityJudgeConstruction',
        shouldMatch: true,
      },
      postFixVerificationCommand: 'npm test -- --run src/constructions/processes/__tests__/result_quality_judge.test.ts',
    };
  }

  return {
    generatedFrom: 'fallback_generic',
    preFixRef: finding.preFixRef,
    preFixCheck: {
      filePath: 'src/constructions/processes/patrol_regression_closure_gate.ts',
      pattern: 'createPatrolRegressionClosureGateConstruction',
      shouldMatch: false,
    },
    postFixCheck: {
      filePath: 'src/constructions/processes/patrol_regression_closure_gate.ts',
      pattern: 'createPatrolRegressionClosureGateConstruction',
      shouldMatch: true,
    },
    postFixVerificationCommand: 'npm test -- --run src/constructions/processes/__tests__/patrol_regression_closure_gate.test.ts',
  };
}

async function existingTests(paths: string[], repoRoot: string): Promise<string[]> {
  const kept: string[] = [];
  for (const relativePath of paths) {
    const absolutePath = path.join(repoRoot, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isFile()) kept.push(relativePath);
    } catch {
      // Skip non-existent candidates.
    }
  }
  return kept;
}

export async function loadPatrolFindingCorpus(repoRoot = process.cwd(), corpusPath = DEFAULT_CORPUS_PATH): Promise<PatrolFindingCorpus> {
  const absolutePath = path.isAbsolute(corpusPath)
    ? corpusPath
    : path.join(repoRoot, corpusPath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = JSON.parse(raw) as PatrolFindingCorpus;
  if (parsed.schema !== 'PatrolFindingCorpus.v1' || !Array.isArray(parsed.findings)) {
    throw new Error(`Invalid patrol finding corpus at ${absolutePath}`);
  }
  return parsed;
}

function resolvePath(repoRoot: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

export async function generatePatrolTestPairs(findings: PatrolFindingDescriptor[], repoRoot = process.cwd()): Promise<PatrolTestPair[]> {
  const pairs: PatrolTestPair[] = [];
  for (const finding of findings) {
    const template = detectTemplate(finding);
    const failToPass = buildFailToPassSpec(template, finding);
    const passToPassTests = await existingTests(TEMPLATE_PASS_TO_PASS_CANDIDATES[template], repoRoot);
    pairs.push({
      id: `issue-${finding.issueNumber}-${sanitizeId(finding.title)}`,
      issueNumber: finding.issueNumber,
      template,
      title: finding.title,
      description: finding.description,
      failToPass,
      passToPassTests,
    });
  }
  return pairs;
}

export async function materializePatrolTestPairs(
  options: MaterializePatrolTestPairsOptions = {},
): Promise<MaterializedPatrolTestPairs> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const corpusPath = options.corpusPath ?? DEFAULT_CORPUS_PATH;
  const outputPath = resolvePath(repoRoot, options.outputPath ?? DEFAULT_OUTPUT_PATH);
  const sourceCorpusPath = resolvePath(repoRoot, corpusPath);
  const corpus = await loadPatrolFindingCorpus(repoRoot, corpusPath);
  const pairs = await generatePatrolTestPairs(corpus.findings, repoRoot);
  const artifact: PatrolTestPairCorpus = {
    schema: 'PatrolTestPairCorpus.v1',
    sourceCorpusPath,
    generatedAt: new Date().toISOString(),
    pairCount: pairs.length,
    pairs,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return {
    ...artifact,
    outputPath,
  };
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
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      resolve(null);
    });
    child.on('error', () => resolve(null));
  });
}

function evaluateCheck(content: string | null, check: PairCheckSpec): boolean {
  const hasPattern = content?.includes(check.pattern) ?? false;
  return check.shouldMatch ? hasPattern : !hasPattern;
}

async function runShellCommand(command: string, repoRoot: string, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

export async function runPatrolSwebenchHarness(
  pairs: PatrolTestPair[],
  options: PatrolPairHarnessOptions = {},
): Promise<PatrolPairHarnessResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const executeVerificationCommands = options.executeVerificationCommands ?? false;
  const verificationTimeoutMs = options.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  const evaluations: PatrolPairEvaluation[] = [];

  for (const pair of pairs) {
    const findings: string[] = [];
    const preFixContent = await readFileAtRef(repoRoot, pair.failToPass.preFixRef, pair.failToPass.preFixCheck.filePath);
    const preFixFailed = evaluateCheck(preFixContent, pair.failToPass.preFixCheck);
    if (!preFixFailed) {
      findings.push(`Pre-fix check failed for ${pair.failToPass.preFixCheck.filePath}`);
    }

    let postFixContent: string | null = null;
    try {
      postFixContent = await fs.readFile(path.join(repoRoot, pair.failToPass.postFixCheck.filePath), 'utf8');
    } catch {
      postFixContent = null;
    }
    const postFixPassed = evaluateCheck(postFixContent, pair.failToPass.postFixCheck);
    if (!postFixPassed) {
      findings.push(`Post-fix check failed for ${pair.failToPass.postFixCheck.filePath}`);
    }

    const passToPassIdentified = pair.passToPassTests.length > 0;
    if (!passToPassIdentified) {
      findings.push('No PASS_TO_PASS tests identified');
    }

    let verificationPassed = true;
    if (executeVerificationCommands) {
      const postFixCommandPassed = await runShellCommand(pair.failToPass.postFixVerificationCommand, repoRoot, verificationTimeoutMs);
      if (!postFixCommandPassed) {
        verificationPassed = false;
        findings.push(`Verification command failed: ${pair.failToPass.postFixVerificationCommand}`);
      }
    }

    const pass = preFixFailed && postFixPassed && passToPassIdentified && verificationPassed;
    evaluations.push({
      pairId: pair.id,
      issueNumber: pair.issueNumber,
      pass,
      preFixFailed,
      postFixPassed,
      passToPassIdentified,
      verificationExecuted: executeVerificationCommands,
      verificationPassed,
      findings,
    });
  }

  const resolvedCount = evaluations.filter((entry) => entry.pass).length;
  const pairCount = evaluations.length;
  const resolveRate = pairCount > 0 ? resolvedCount / pairCount : 0;
  return {
    kind: 'PatrolSwebenchHarnessResult.v1',
    pass: pairCount > 0 && resolvedCount === pairCount,
    pairCount,
    resolvedCount,
    resolveRate,
    evaluations,
  };
}
