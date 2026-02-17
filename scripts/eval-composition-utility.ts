import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_COMPOSITION_UTILITY_SCENARIOS,
  evaluateCompositionUtility,
} from '../src/evaluation/composition_utility.js';

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const args = parseArgs({
  options: {
    out: { type: 'string', default: 'state/eval/compositions/CompositionUtilityReport.v1.json' },
    minPassRate: { type: 'string', default: '0.9' },
    minTop1Accuracy: { type: 'string', default: '0.5' },
    minTop3Recall: { type: 'string', default: '0.9' },
  },
});

const outPath = path.resolve(process.cwd(), args.values.out ?? 'state/eval/compositions/CompositionUtilityReport.v1.json');
const minPassRate = parseNumber(args.values.minPassRate) ?? 0.9;
const minTop1Accuracy = parseNumber(args.values.minTop1Accuracy) ?? 0.5;
const minTop3Recall = parseNumber(args.values.minTop3Recall) ?? 0.9;

const report = evaluateCompositionUtility(DEFAULT_COMPOSITION_UTILITY_SCENARIOS);

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

console.log(`Composition utility report written to: ${outPath}`);
console.log(`Scenarios: ${report.totalScenarios}`);
console.log(`Pass rate: ${(report.passRate * 100).toFixed(1)}%`);
console.log(`Top-1 accuracy: ${(report.top1Accuracy * 100).toFixed(1)}%`);
console.log(`Top-3 recall: ${(report.top3Recall * 100).toFixed(1)}%`);
if (report.failures.length > 0) {
  console.log(`Failures: ${report.failures.length}`);
  for (const failure of report.failures) {
    console.log(
      `- ${failure.scenarioId}: expected ${failure.expectedCompositionId}; `
      + `rank=${failure.rank ?? 'none'}; `
      + `selected ${failure.selectedCompositionIds.join(', ') || '(none)'}`
    );
  }
}

if (report.passRate < minPassRate) {
  console.error(`composition_utility_pass_rate_below_threshold:${report.passRate.toFixed(3)}<${minPassRate.toFixed(3)}`);
  process.exitCode = 1;
}
if (report.top1Accuracy < minTop1Accuracy) {
  console.error(`composition_utility_top1_accuracy_below_threshold:${report.top1Accuracy.toFixed(3)}<${minTop1Accuracy.toFixed(3)}`);
  process.exitCode = 1;
}
if (report.top3Recall < minTop3Recall) {
  console.error(`composition_utility_top3_recall_below_threshold:${report.top3Recall.toFixed(3)}<${minTop3Recall.toFixed(3)}`);
  process.exitCode = 1;
}
