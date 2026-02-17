import { createASTFactExtractor } from '../src/evaluation/ast_fact_extractor.js';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { SUPPORTED_LANGUAGE_EXTENSIONS } from '../src/utils/language.js';

const SUPPORTED_EXTENSIONS = new Set(SUPPORTED_LANGUAGE_EXTENSIONS.map((ext) => ext.toLowerCase()));
const MAX_BENCHMARK_FILES = 20;
const MAX_BENCHMARK_LOC = 10_000;

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) continue;
      files.push(fullPath);
    }
  }

  return files;
}

function countLOC(files: string[]): number {
  let count = 0;
  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf-8');
    count += content.split('\n').length;
  }
  return count;
}

function buildBenchmarkSample(files: string[]): {
  selectedFiles: string[];
  selectedLocCount: number;
  totalFileCount: number;
  totalLocCount: number;
} {
  const sortedFiles = [...files].sort((left, right) => left.localeCompare(right));
  const selectedFiles: string[] = [];
  let selectedLocCount = 0;
  let totalLocCount = 0;

  for (const filePath of sortedFiles) {
    const fileLoc = countLOC([filePath]);
    totalLocCount += fileLoc;

    const fileBudgetAvailable = selectedFiles.length < MAX_BENCHMARK_FILES;
    const locBudgetAvailable = selectedLocCount + fileLoc <= MAX_BENCHMARK_LOC;
    const shouldForceFirst = selectedFiles.length === 0;
    if ((fileBudgetAvailable && locBudgetAvailable) || shouldForceFirst) {
      selectedFiles.push(filePath);
      selectedLocCount += fileLoc;
    }
  }

  return {
    selectedFiles,
    selectedLocCount,
    totalFileCount: sortedFiles.length,
    totalLocCount,
  };
}

async function runIncrementalExtraction(files: string[]): Promise<{
  parsedFileCount: number;
  parseErrorCount: number;
}> {
  const extractor = createASTFactExtractor();
  let parsedFileCount = 0;
  let parseErrorCount = 0;

  for (const filePath of files) {
    try {
      const extension = extname(filePath).toLowerCase();
      const usesTypeScriptPipeline = (
        extension === '.ts'
        || extension === '.tsx'
        || extension === '.mts'
        || extension === '.cts'
        || extension === '.js'
        || extension === '.jsx'
        || extension === '.mjs'
        || extension === '.cjs'
      );
      if (usesTypeScriptPipeline) {
        await extractor.extractFromFile(filePath);
      } else {
        readFileSync(filePath, 'utf-8');
      }
      parsedFileCount += 1;
    } catch {
      parseErrorCount += 1;
    }
  }

  return { parsedFileCount, parseErrorCount };
}

type MemorySnapshot = {
  rssMB: number;
  heapUsedMB: number;
  externalMB: number;
  arrayBuffersMB: number;
};

function snapshot(): MemorySnapshot {
  const mu = process.memoryUsage();
  return {
    rssMB: mu.rss / (1024 * 1024),
    heapUsedMB: mu.heapUsed / (1024 * 1024),
    externalMB: mu.external / (1024 * 1024),
    arrayBuffersMB: (mu.arrayBuffers ?? 0) / (1024 * 1024),
  };
}

async function forceGC(): Promise<void> {
  if (typeof global.gc !== 'function') return;
  for (let i = 0; i < 3; i++) {
    global.gc();
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  }
}

async function main() {
  const repoPath = process.argv[2];
  if (!repoPath) {
    throw new Error('Missing repo path argument');
  }

  const files = listSourceFiles(repoPath);
  const benchmarkSample = buildBenchmarkSample(files);
  await forceGC();
  const baseline = snapshot();
  const locCount = benchmarkSample.selectedLocCount;
  const startedAt = Date.now();
  const { parsedFileCount, parseErrorCount } = await runIncrementalExtraction(benchmarkSample.selectedFiles);
  const durationMs = Date.now() - startedAt;

  await forceGC();
  const after = snapshot();

  const heapDeltaMB = Math.max(0, after.heapUsedMB - baseline.heapUsedMB);
  const rssDeltaMB = Math.max(0, after.rssMB - baseline.rssMB);

  const heapDeltaPerKLOC = locCount > 0 ? heapDeltaMB / (locCount / 1000) : 0;
  const rssDeltaPerKLOC = locCount > 0 ? rssDeltaMB / (locCount / 1000) : 0;

  const result = {
    locCount,
    baseline,
    after,
    durationMs,
    fileCount: benchmarkSample.selectedFiles.length,
    parsedFileCount,
    parseErrorCount,
    sampled: benchmarkSample.selectedFiles.length !== benchmarkSample.totalFileCount,
    totalFileCount: benchmarkSample.totalFileCount,
    totalLocCount: benchmarkSample.totalLocCount,
    sampleMaxFiles: MAX_BENCHMARK_FILES,
    sampleMaxLoc: MAX_BENCHMARK_LOC,
    heapDeltaMB,
    rssDeltaMB,
    heapDeltaPerKLOC,
    rssDeltaPerKLOC,
  };

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
