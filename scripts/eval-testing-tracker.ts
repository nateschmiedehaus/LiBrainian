import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { safeJsonParse } from '../src/utils/safe_json.js';
import {
  buildTestingTrackerReport,
  type TestingTrackerArtifact,
  type TestingTrackerInput,
} from '../src/evaluation/testing_tracker.js';

async function loadArtifact(filePath: string): Promise<TestingTrackerArtifact<unknown>> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = safeJsonParse<unknown>(raw);
    if (!parsed.ok) {
      return {
        present: true,
        path: filePath,
        parseError: `invalid_json:${filePath}`,
      };
    }
    return {
      present: true,
      path: filePath,
      data: parsed.value,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      return {
        present: false,
        path: filePath,
      };
    }
    return {
      present: true,
      path: filePath,
      parseError: error instanceof Error ? error.message : 'read_failed',
    };
  }
}

function statusEmoji(status: 'fixed' | 'open' | 'unknown'): string {
  if (status === 'fixed') return '✅';
  if (status === 'open') return '❌';
  return '⚪';
}

function boolLabel(value: boolean): string {
  return value ? 'yes' : 'no';
}

function buildMarkdown(report: ReturnType<typeof buildTestingTrackerReport>): string {
  const lines: string[] = [];
  lines.push('# Testing Tracker');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Publish-ready: **${boolLabel(report.summary.publishReady)}**`);
  lines.push(`- Fixed: ${report.summary.fixedCount}`);
  lines.push(`- Open: ${report.summary.openCount}`);
  lines.push(`- Unknown: ${report.summary.unknownCount}`);
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  lines.push('| Artifact | Present | Parse Error |');
  lines.push('| --- | --- | --- |');
  for (const artifact of report.artifacts) {
    lines.push(`| ${artifact.id} | ${boolLabel(artifact.present)} | ${artifact.parseError ?? ''} |`);
  }
  lines.push('');
  lines.push('## Flaws');
  lines.push('');
  lines.push('| Status | Flaw | Evidence |');
  lines.push('| --- | --- | --- |');
  for (const flaw of report.flaws) {
    lines.push(`| ${statusEmoji(flaw.status)} ${flaw.status} | ${flaw.title} | ${flaw.evidence} |`);
  }
  lines.push('');
  return lines.join('\n');
}

const args = parseArgs({
  options: {
    out: { type: 'string', default: 'state/eval/testing-discipline/testing-tracker.json' },
    markdownOut: { type: 'string', default: 'docs/archive/TESTING_TRACKER.md' },
    abReport: { type: 'string', default: 'eval-results/ab-harness-report.json' },
    useCaseReport: { type: 'string', default: 'eval-results/agentic-use-case-review.json' },
    liveFireReport: { type: 'string', default: 'state/eval/live-fire/hardcore/report.json' },
    smokeReport: { type: 'string', default: 'state/eval/smoke/external/all-repos/report.json' },
    testingDisciplineReport: { type: 'string', default: 'state/eval/testing-discipline/report.json' },
    publishGateReport: { type: 'string', default: 'state/eval/publish-gate/latest.json' },
    failOnOpen: { type: 'boolean', default: false },
  },
});

const workspaceRoot = process.cwd();
const resolvePath = (value: string | undefined, fallback: string): string =>
  path.resolve(workspaceRoot, value ?? fallback);

const outPath = resolvePath(args.values.out, 'state/eval/testing-discipline/testing-tracker.json');
const markdownOutPath = resolvePath(args.values.markdownOut, 'docs/archive/TESTING_TRACKER.md');

const input: TestingTrackerInput = {
  generatedAt: new Date().toISOString(),
  artifacts: {
    ab: await loadArtifact(resolvePath(args.values.abReport, 'eval-results/ab-harness-report.json')),
    useCase: await loadArtifact(resolvePath(args.values.useCaseReport, 'eval-results/agentic-use-case-review.json')),
    liveFire: await loadArtifact(resolvePath(args.values.liveFireReport, 'state/eval/live-fire/hardcore/report.json')),
    smoke: await loadArtifact(resolvePath(args.values.smokeReport, 'state/eval/smoke/external/all-repos/report.json')),
    testingDiscipline: await loadArtifact(resolvePath(args.values.testingDisciplineReport, 'state/eval/testing-discipline/report.json')),
    publishGate: await loadArtifact(resolvePath(args.values.publishGateReport, 'state/eval/publish-gate/latest.json')),
  },
};

const report = buildTestingTrackerReport(input);
const markdown = buildMarkdown(report);

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

await mkdir(path.dirname(markdownOutPath), { recursive: true });
await writeFile(markdownOutPath, markdown, 'utf8');

console.log(`Testing tracker report written to: ${outPath}`);
console.log(`Testing tracker markdown written to: ${markdownOutPath}`);
console.log(`Publish-ready: ${report.summary.publishReady ? 'yes' : 'no'}`);
console.log(`Fixed/Open/Unknown: ${report.summary.fixedCount}/${report.summary.openCount}/${report.summary.unknownCount}`);

if (args.values.failOnOpen && !report.summary.publishReady) {
  process.exitCode = 1;
}
