import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createOperationalProofGateConstruction,
  resolveUnitPatrolSelection,
  UNIT_PATROL_DEFAULT_EVALUATION,
  UNIT_PATROL_DEFAULT_SCENARIO,
} from '../src/constructions/processes/index.js';

type DemoSpec = {
  id: string;
  filePath: string;
  fileContents: string;
  task: 'retrieval' | 'metamorphic' | 'deep-audit';
  profile: 'quick' | 'strict' | 'deep-bounded';
  expectedDomain: 'typescript' | 'python' | 'go';
};

type DemoResult = {
  id: string;
  expectedDomain: DemoSpec['expectedDomain'];
  expectedProfile: DemoSpec['profile'];
  observedDomain: string;
  observedProfile: string;
  strategyPack: string;
  operations: number;
  queries: number;
  metamorphic: number;
  maxOperations: number;
  maxQueries: number;
  passed: boolean;
  reasons: string[];
};

const DEMOS: DemoSpec[] = [
  {
    id: 'typescript-retrieval-quick',
    filePath: 'src/index.ts',
    fileContents: 'export const ping = () => "pong";\n',
    task: 'retrieval',
    profile: 'quick',
    expectedDomain: 'typescript',
  },
  {
    id: 'python-metamorphic-strict',
    filePath: 'app/main.py',
    fileContents: 'def main():\n    return True\n',
    task: 'metamorphic',
    profile: 'strict',
    expectedDomain: 'python',
  },
  {
    id: 'go-deep-audit',
    filePath: 'cmd/main.go',
    fileContents: 'package main\nfunc main() {}\n',
    task: 'deep-audit',
    profile: 'deep-bounded',
    expectedDomain: 'go',
  },
];

function buildProofReaderScript(reportPath: string): string {
  return [
    'const fs = require("node:fs");',
    `process.stdout.write(fs.readFileSync(${JSON.stringify(reportPath)}, "utf8"));`,
  ].join(' ');
}

async function runDemo(workspaceRoot: string, demo: DemoSpec): Promise<DemoResult> {
  const workspace = await mkdtemp(join(workspaceRoot, `${demo.id}-`));
  try {
    const absoluteFile = join(workspace, demo.filePath);
    await mkdir(dirname(absoluteFile), { recursive: true });
    await writeFile(absoluteFile, demo.fileContents, 'utf8');

    const selection = await resolveUnitPatrolSelection(
      {
        fixtureRepoPath: workspace,
        task: demo.task,
        profile: demo.profile,
      },
      UNIT_PATROL_DEFAULT_SCENARIO,
      UNIT_PATROL_DEFAULT_EVALUATION,
    );

    const operations = selection.scenario.operations.length;
    const queries = selection.scenario.operations.filter((operation) => operation.kind === 'query').length;
    const metamorphic = selection.scenario.operations.filter((operation) => operation.kind === 'metamorphic').length;

    const reasons: string[] = [];
    if (selection.domain !== demo.expectedDomain) reasons.push(`domain_mismatch:${selection.domain}`);
    if (selection.profile !== demo.profile) reasons.push(`profile_mismatch:${selection.profile}`);
    if (selection.strategyPack !== demo.profile) reasons.push(`strategy_pack_mismatch:${selection.strategyPack}`);
    if (operations > selection.budget.maxOperations) reasons.push('operation_budget_exceeded');
    if (queries > selection.budget.maxQueries) reasons.push('query_budget_exceeded');
    if (metamorphic > 1) reasons.push('metamorphic_budget_exceeded');

    return {
      id: demo.id,
      expectedDomain: demo.expectedDomain,
      expectedProfile: demo.profile,
      observedDomain: selection.domain,
      observedProfile: selection.profile,
      strategyPack: selection.strategyPack,
      operations,
      queries,
      metamorphic,
      maxOperations: selection.budget.maxOperations,
      maxQueries: selection.budget.maxQueries,
      passed: reasons.length === 0,
      reasons,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'result-out': { type: 'string', default: 'state/patrol/unit-patrol-universal-report.json' },
      'proof-bundle-out': { type: 'string', default: 'state/patrol/unit-patrol-universal-proof.json' },
    },
  });

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'librainian-unit-patrol-universal-'));
  try {
    const results: DemoResult[] = [];
    for (const demo of DEMOS) {
      results.push(await runDemo(workspaceRoot, demo));
    }

    const report = {
      kind: 'UnitPatrolUniversalDemoReport.v1' as const,
      generatedAt: new Date().toISOString(),
      passed: results.every((entry) => entry.passed),
      demos: results,
    };

    const resultOutPath = resolve(values['result-out']);
    await mkdir(dirname(resultOutPath), { recursive: true });
    await writeFile(resultOutPath, JSON.stringify(report, null, 2), 'utf8');

    const proofBundleOutPath = resolve(values['proof-bundle-out']);
    const proofGate = createOperationalProofGateConstruction();
    const proofResult = await proofGate.execute({
      checks: [
        {
          id: 'unit-patrol-universal-proof',
          description: 'validates heterogeneous domain/task demos with bounded selector profiles',
          command: process.execPath,
          args: ['-e', buildProofReaderScript(resultOutPath)],
          requiredOutputSubstrings: [
            report.kind,
            '"passed": true',
            ...DEMOS.map((demo) => demo.id),
          ],
          requiredFilePaths: [resultOutPath],
        },
      ],
      proofBundleOutputPath: proofBundleOutPath,
      proofBundleSource: 'unit-patrol-universal-construction',
    });

    if (!proofResult.ok) {
      console.error(JSON.stringify({ ok: false, error: proofResult.error.message, errorAt: proofResult.errorAt }, null, 2));
      process.exitCode = 1;
      return;
    }
    if (!proofResult.value.passed) {
      console.error(JSON.stringify({ ok: false, error: 'operational proof gate failed', proof: proofResult.value }, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify({
      ok: true,
      reportPath: resultOutPath,
      proofBundlePath: proofBundleOutPath,
      demosPassed: report.passed,
      demoCount: report.demos.length,
      proofBundle: proofResult.value.proofBundle,
    }, null, 2));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

void main();
