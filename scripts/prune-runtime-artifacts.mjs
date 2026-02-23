import { readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function parseArgs(argv) {
  const defaults = {
    maxAgeHours: parsePositiveInt(process.env.LIBRAINIAN_TMP_RETENTION_HOURS, 12),
    maxEntriesPerRoot: parsePositiveInt(process.env.LIBRAINIAN_TMP_MAX_ENTRIES, 200),
    maxTotalGb: parsePositiveInt(process.env.LIBRAINIAN_TMP_MAX_TOTAL_GB, 200),
    enforceSizeBudget: true,
    quiet: false,
  };
  const options = { ...defaults };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--quiet') {
      options.quiet = true;
      continue;
    }
    if (arg === '--skip-size-budget') {
      options.enforceSizeBudget = false;
      continue;
    }
    if (arg === '--aggressive') {
      options.maxAgeHours = 2;
      options.maxEntriesPerRoot = 40;
      continue;
    }
    if (arg === '--max-age-hours') {
      const next = argv[i + 1];
      options.maxAgeHours = parsePositiveInt(next, options.maxAgeHours);
      i += 1;
      continue;
    }
    if (arg === '--max-entries') {
      const next = argv[i + 1];
      options.maxEntriesPerRoot = parsePositiveInt(next, options.maxEntriesPerRoot);
      i += 1;
      continue;
    }
    if (arg === '--max-total-gb') {
      const next = argv[i + 1];
      options.maxTotalGb = parsePositiveInt(next, options.maxTotalGb);
      i += 1;
      continue;
    }
  }

  return options;
}

function rootSpecs() {
  const osTmp = os.tmpdir();
  const tmpPrefixes = [
    'librainian-',
    'librarian-',
    'librainian-clean-clone-',
    'librarian-clean-clone-',
    'librainian-dogfood-',
    'librarian-dogfood-',
    'librainian-pack-smoke-',
    'librarian-pack-smoke-',
    'librainian-npm-e2e-',
    'librarian-npm-e2e-',
  ];

  return [
    {
      root: path.resolve(REPO_ROOT, '.tmp', 'librainian'),
      include: () => true,
    },
    {
      root: path.resolve(REPO_ROOT, '..', '.tmp', 'librainian'),
      include: () => true,
    },
    {
      root: path.resolve(REPO_ROOT, '.tmp', 'librarian'),
      include: () => true,
    },
    {
      root: path.resolve(REPO_ROOT, '..', '.tmp', 'librarian'),
      include: () => true,
    },
    {
      root: path.resolve(REPO_ROOT, '.patrol-tmp'),
      include: (name) => name.startsWith('sandbox-'),
    },
    {
      root: osTmp,
      include: (name) => tmpPrefixes.some((prefix) => name.startsWith(prefix)),
    },
  ];
}

async function pruneRoot(spec, nowMs, maxAgeMs, maxEntriesPerRoot) {
  let entries;
  try {
    entries = await readdir(spec.root, { withFileTypes: true });
  } catch {
    return { root: spec.root, scanned: 0, deleted: 0, failures: 0 };
  }

  const candidates = [];
  for (const entry of entries) {
    if (!spec.include(entry.name)) continue;
    const fullPath = path.join(spec.root, entry.name);
    try {
      const entryStat = await stat(fullPath);
      candidates.push({
        fullPath,
        mtimeMs: entryStat.mtimeMs,
      });
    } catch {
      // Ignore races / permission issues for per-entry stat
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  let deleted = 0;
  let failures = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const ageMs = nowMs - candidate.mtimeMs;
    const tooOld = ageMs > maxAgeMs;
    const overLimit = i >= maxEntriesPerRoot;
    if (!tooOld && !overLimit) continue;
    try {
      await rm(candidate.fullPath, { recursive: true, force: true, maxRetries: 1 });
      deleted += 1;
    } catch {
      failures += 1;
    }
  }

  return {
    root: spec.root,
    scanned: candidates.length,
    deleted,
    failures,
    budgetDeleted: 0,
  };
}

async function sizeBytesForPath(rootPath) {
  let rootStat;
  try {
    rootStat = await stat(rootPath);
  } catch {
    return 0;
  }
  if (!rootStat.isDirectory()) {
    return rootStat.size;
  }

  let total = 0;
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      let entryStat;
      try {
        entryStat = await stat(fullPath);
      } catch {
        continue;
      }
      if (entryStat.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      total += entryStat.size;
    }
  }
  return total;
}

async function collectBudgetCandidates(spec) {
  let entries;
  try {
    entries = await readdir(spec.root, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const entry of entries) {
    if (!spec.include(entry.name)) continue;
    const fullPath = path.join(spec.root, entry.name);
    let entryStat;
    try {
      entryStat = await stat(fullPath);
    } catch {
      continue;
    }
    const sizeBytes = await sizeBytesForPath(fullPath);
    candidates.push({
      root: spec.root,
      fullPath,
      mtimeMs: entryStat.mtimeMs,
      sizeBytes,
    });
  }
  return candidates;
}

export async function pruneRuntimeArtifacts(options = {}) {
  const maxAgeHours = parsePositiveInt(options.maxAgeHours, 12);
  const maxEntriesPerRoot = parsePositiveInt(options.maxEntriesPerRoot, 200);
  const maxTotalGb = parsePositiveInt(options.maxTotalGb, 200);
  const enforceSizeBudget = options.enforceSizeBudget !== false;
  const quiet = options.quiet === true;
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const maxTotalBytes = maxTotalGb * 1024 * 1024 * 1024;
  const nowMs = Date.now();
  const specs = rootSpecs();
  const results = [];

  for (const spec of specs) {
    const result = await pruneRoot(spec, nowMs, maxAgeMs, maxEntriesPerRoot);
    results.push(result);
  }

  let bytesBeforeBudgetPrune = 0;
  let bytesAfterBudgetPrune = 0;
  if (enforceSizeBudget) {
    const budgetCandidates = [];
    for (const spec of specs) {
      const candidates = await collectBudgetCandidates(spec);
      budgetCandidates.push(...candidates);
    }

    budgetCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    bytesBeforeBudgetPrune = budgetCandidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0);

    if (bytesBeforeBudgetPrune > maxTotalBytes) {
      const oldestFirst = [...budgetCandidates].sort((a, b) => a.mtimeMs - b.mtimeMs);
      let currentBytes = bytesBeforeBudgetPrune;
      for (const candidate of oldestFirst) {
        if (currentBytes <= maxTotalBytes) break;
        try {
          await rm(candidate.fullPath, { recursive: true, force: true, maxRetries: 1 });
          currentBytes -= candidate.sizeBytes;
          const rootResult = results.find((result) => result.root === candidate.root);
          if (rootResult) {
            rootResult.deleted += 1;
            rootResult.budgetDeleted += 1;
          }
        } catch {
          const rootResult = results.find((result) => result.root === candidate.root);
          if (rootResult) {
            rootResult.failures += 1;
          }
        }
      }
      bytesAfterBudgetPrune = currentBytes;
    } else {
      bytesAfterBudgetPrune = bytesBeforeBudgetPrune;
    }
  }

  const summary = results.reduce(
    (acc, result) => {
      acc.scanned += result.scanned;
      acc.deleted += result.deleted;
      acc.failures += result.failures;
      return acc;
    },
    { scanned: 0, deleted: 0, failures: 0, bytesBeforeBudgetPrune, bytesAfterBudgetPrune },
  );

  if (!quiet) {
    const payload = {
      policy: {
        maxAgeHours,
        maxEntriesPerRoot,
        maxTotalGb,
        enforceSizeBudget,
      },
      summary,
      roots: results,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload, null, 2));
  }

  return {
    policy: {
      maxAgeHours,
      maxEntriesPerRoot,
      maxTotalGb,
      enforceSizeBudget,
    },
    summary,
    roots: results,
  };
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const options = parseArgs(process.argv.slice(2));
  try {
    await pruneRuntimeArtifacts(options);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[prune-runtime-artifacts] failed');
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
