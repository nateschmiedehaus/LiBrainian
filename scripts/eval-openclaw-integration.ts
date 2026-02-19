import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import {
  runOpenclawIntegrationSuite,
  type OpenclawScenarioId,
} from '../src/integration/openclaw_integration_suite.js';

const scenarioAliases: Record<string, OpenclawScenarioId> = {
  'cold-start': 'scenario_1_cold_start_context_efficiency',
  'staleness': 'scenario_2_memory_staleness_detection',
  'navigation': 'scenario_3_semantic_navigation_accuracy',
  'budget-gate': 'scenario_4_context_exhaustion_prevention',
  'skill-audit': 'scenario_5_malicious_skill_detection',
  'calibration': 'scenario_6_calibration_convergence',
};

function parseScenarioIds(raw: string | undefined): OpenclawScenarioId[] | undefined {
  if (!raw || raw === 'all') return undefined;
  const scenarioIds = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => scenarioAliases[token] ?? (token as OpenclawScenarioId));
  return scenarioIds.length > 0 ? scenarioIds : undefined;
}

const args = parseArgs({
  options: {
    out: { type: 'string', default: 'state/eval/openclaw/benchmark-results.json' },
    scenario: { type: 'string', default: 'all' },
    fixturesRoot: { type: 'string' },
    strict: { type: 'boolean', default: true },
  },
});

const workspaceRoot = process.cwd();
const outPath = path.resolve(workspaceRoot, args.values.out ?? 'state/eval/openclaw/benchmark-results.json');

const result = await runOpenclawIntegrationSuite({
  workspaceRoot,
  fixtureRoot: args.values.fixturesRoot
    ? path.resolve(workspaceRoot, args.values.fixturesRoot)
    : undefined,
  scenarioIds: parseScenarioIds(args.values.scenario ?? 'all'),
});

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

console.log(`OpenClaw integration suite report written to: ${outPath}`);
console.log(`Summary: ${result.summary.passing}/${result.summary.total} passing`);
if (result.summary.failing > 0) {
  for (const scenario of result.scenarios.filter((entry) => !entry.passed)) {
    console.error(`FAIL: ${scenario.id}`);
  }
}

if (args.values.strict && result.summary.failing > 0) {
  process.exitCode = 1;
}
