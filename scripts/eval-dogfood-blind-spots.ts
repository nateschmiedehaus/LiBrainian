import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildBlindSpotCoverageDashboard,
  renderBlindSpotCoverageMarkdown,
  type BlindSpotCatalog,
  type ExternalRepoManifest,
} from '../src/evaluation/blind_spot_coverage.js';

interface GatesShape {
  validationStatus?: {
    blockingMetrics?: Record<string, {
      validatedBy?: string[];
      requiresSupplementaryCorpus?: boolean;
    }>;
  };
}

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

const args = parseArgs({
  options: {
    catalog: { type: 'string' },
    externalManifest: { type: 'string' },
    gates: { type: 'string' },
    out: { type: 'string' },
    markdown: { type: 'string' },
    strict: { type: 'boolean', default: false },
    minimumCorpora: { type: 'string' },
  },
});

const workspace = process.cwd();
const catalogPath = path.resolve(workspace, args.values.catalog ?? 'eval-corpus/supplementary-corpora.json');
const externalManifestPath = path.resolve(workspace, args.values.externalManifest ?? 'eval-corpus/external-repos/manifest.json');
const gatesPath = path.resolve(workspace, args.values.gates ?? 'docs/librarian/GATES.json');
const outPath = path.resolve(workspace, args.values.out ?? 'state/eval/dogfood/blind-spot-coverage.json');
const markdownPath = path.resolve(workspace, args.values.markdown ?? 'state/eval/dogfood/blind-spot-coverage.md');
const strict = Boolean(args.values.strict);
const minimumCorpora = args.values.minimumCorpora
  ? Number.parseInt(args.values.minimumCorpora, 10)
  : 5;

const catalog = readJsonFile<BlindSpotCatalog>(catalogPath);
const externalManifest = readJsonFile<ExternalRepoManifest>(externalManifestPath);
const gates = readJsonFile<GatesShape>(gatesPath);
const pkg = readJsonFile<{ scripts?: Record<string, string> }>(path.resolve(workspace, 'package.json'));

const dashboard = buildBlindSpotCoverageDashboard({
  catalog,
  externalManifest,
  scripts: pkg.scripts ?? {},
  minimumSupplementaryCorpora: minimumCorpora,
  gates,
});
const markdown = renderBlindSpotCoverageMarkdown(dashboard);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8');
fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
fs.writeFileSync(markdownPath, `${markdown}\n`, 'utf8');

console.log(JSON.stringify({
  kind: dashboard.kind,
  summary: dashboard.summary,
  outPath,
  markdownPath,
}, null, 2));

if (strict && dashboard.summary.findings.length > 0) {
  process.exitCode = 1;
}
