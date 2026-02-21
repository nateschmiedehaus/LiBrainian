import { parseArgs } from 'node:util';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { runExternalEvalCorpusRefresh } from '../src/evaluation/external_eval_corpus.js';

const { values } = parseArgs({
  options: {
    workspaceRoot: { type: 'string' },
    reposRoot: { type: 'string' },
    repoNames: { type: 'string' },
    minRepos: { type: 'string' },
    maxRepos: { type: 'string' },
    reportPath: { type: 'string' },
    evalOutputPath: { type: 'string' },
    gatesPath: { type: 'string' },
    maxSourceFilesPerRepo: { type: 'string' },
    maxQueriesPerRepo: { type: 'string' },
    resultPath: { type: 'string' },
    skipGates: { type: 'boolean', default: false },
  },
});

const workspaceRoot = path.resolve(values.workspaceRoot ?? process.cwd());
const minRepos = values.minRepos ? Number(values.minRepos) : undefined;
const maxRepos = values.maxRepos ? Number(values.maxRepos) : undefined;
const repoNames = values.repoNames
  ? values.repoNames.split(',').map((value) => value.trim()).filter(Boolean)
  : undefined;
const maxSourceFilesPerRepo = values.maxSourceFilesPerRepo ? Number(values.maxSourceFilesPerRepo) : undefined;
const maxQueriesPerRepo = values.maxQueriesPerRepo ? Number(values.maxQueriesPerRepo) : undefined;

const result = await runExternalEvalCorpusRefresh({
  workspaceRoot,
  reposRoot: values.reposRoot,
  repoNames,
  minRepos,
  maxRepos,
  reportPath: values.reportPath,
  evalOutputPath: values.evalOutputPath,
  gatesPath: values.gatesPath,
  maxSourceFilesPerRepo,
  maxQueriesPerRepo,
  updateGates: !values.skipGates,
});

if (values.resultPath) {
  const outputPath = path.resolve(values.resultPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(result, null, 2));
