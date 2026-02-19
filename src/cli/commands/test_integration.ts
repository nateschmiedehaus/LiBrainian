import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.js';
import {
  runOpenclawIntegrationSuite,
  type OpenclawIntegrationSuiteResult,
  type OpenclawScenarioId,
} from '../../integration/openclaw_integration_suite.js';

export interface TestIntegrationCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

const SCENARIO_ALIASES: Record<string, OpenclawScenarioId> = {
  'cold-start': 'scenario_1_cold_start_context_efficiency',
  'staleness': 'scenario_2_memory_staleness_detection',
  'navigation': 'scenario_3_semantic_navigation_accuracy',
  'budget-gate': 'scenario_4_context_exhaustion_prevention',
  'skill-audit': 'scenario_5_malicious_skill_detection',
  'calibration': 'scenario_6_calibration_convergence',
};

function parseScenarios(raw: string | undefined): OpenclawScenarioId[] | undefined {
  if (!raw || raw.trim().length === 0 || raw === 'all') return undefined;
  const tokens = raw.split(',').map((token) => token.trim()).filter((token) => token.length > 0);
  if (tokens.length === 0) return undefined;

  const scenarios: OpenclawScenarioId[] = [];
  for (const token of tokens) {
    const mapped = SCENARIO_ALIASES[token] ?? (token as OpenclawScenarioId);
    if (!Object.values(SCENARIO_ALIASES).includes(mapped)) {
      throw new CliError(
        `Unknown --scenario value: ${token}. Use one of: all, ${Object.keys(SCENARIO_ALIASES).join(', ')}`,
        'INVALID_ARGUMENT',
      );
    }
    scenarios.push(mapped);
  }
  return scenarios;
}

async function writeOutput(
  outputPath: string | undefined,
  payload: OpenclawIntegrationSuiteResult,
): Promise<void> {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function printTextReport(result: OpenclawIntegrationSuiteResult): void {
  console.log('OpenClaw Integration Suite');
  console.log('==========================');
  console.log(`Generated: ${result.generatedAt}`);
  console.log(`Fixtures: ${result.fixtureRoot}`);
  console.log(`Summary: ${result.summary.passing}/${result.summary.total} passing`);
  console.log('');
  for (const scenario of result.scenarios) {
    const status = scenario.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${scenario.id} - ${scenario.title}`);
  }
}

export async function testIntegrationCommand(options: TestIntegrationCommandOptions): Promise<void> {
  const { values } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      suite: { type: 'string' },
      scenario: { type: 'string' },
      json: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      out: { type: 'string' },
      'fixtures-root': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const suite = typeof values.suite === 'string' ? values.suite.trim() : 'openclaw';
  if (suite !== 'openclaw') {
    throw new CliError('Only --suite openclaw is currently supported.', 'INVALID_ARGUMENT');
  }

  const result = await runOpenclawIntegrationSuite({
    workspaceRoot: path.resolve(options.workspace),
    fixtureRoot: typeof values['fixtures-root'] === 'string'
      ? values['fixtures-root']
      : undefined,
    scenarioIds: parseScenarios(typeof values.scenario === 'string' ? values.scenario : undefined),
  });

  await writeOutput(typeof values.out === 'string' ? values.out : undefined, result);

  if (Boolean(values.json)) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTextReport(result);
  }

  if (Boolean(values.strict) && result.summary.failing > 0) {
    throw new CliError(
      `Integration suite failed: ${result.summary.failing} scenario(s) did not meet thresholds.`,
      'VALIDATION_FAILED',
    );
  }
}
