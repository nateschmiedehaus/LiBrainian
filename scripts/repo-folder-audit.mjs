#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const workspaceRoot = process.cwd();

function runGit(command) {
  return execSync(command, { cwd: workspaceRoot, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

const IGNORE_LOCAL_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.tmp',
  '.librarian',
]);

function collectLocalFiles(directory) {
  const root = path.join(workspaceRoot, directory);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return [];
  }

  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(workspaceRoot, absolutePath);
      if (entry.isDirectory()) {
        if (IGNORE_LOCAL_DIRS.has(entry.name)) continue;
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  return files;
}

function collectTopLevelDirectories() {
  const trackedFiles = runGit('git ls-files');
  const trackedDirs = new Set();
  for (const file of trackedFiles) {
    const first = file.split('/')[0];
    const absolute = path.join(workspaceRoot, first);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
      trackedDirs.add(first);
    }
  }

  // Include operational-but-currently-untracked roots if present locally.
  for (const runtimeDir of ['config', 'state']) {
    const absolute = path.join(workspaceRoot, runtimeDir);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
      trackedDirs.add(runtimeDir);
    }
  }

  return Array.from(trackedDirs).sort();
}

function directoryAudit(directory, trackedFiles) {
  const directoryPrefix = `${directory}/`;
  const trackedDirectoryFiles = trackedFiles.filter((file) => file.startsWith(directoryPrefix));
  const localDirectoryFiles = collectLocalFiles(directory);
  const files = Array.from(new Set([...trackedDirectoryFiles, ...localDirectoryFiles]));
  const markdownFiles = files.filter((file) => file.endsWith('.md'));
  const hasReadme = files.some((file) => /\/readme\.md$/i.test(file));

  const placeholderCount = markdownFiles
    .slice(0, 30)
    .map((relativePath) => safeRead(path.join(workspaceRoot, relativePath)))
    .reduce((count, content) => {
      const matches = content.match(/\b(placeholder|todo|tbd|coming soon)\b/gi);
      return count + (matches ? matches.length : 0);
    }, 0);

  let score = 100;
  const reasons = [];

  if (files.length === 0) {
    score -= 70;
    reasons.push('no tracked files');
  } else if (files.length < 3) {
    score -= 45;
    reasons.push('very low file count');
  } else if (files.length < 10) {
    score -= 20;
    reasons.push('low file count');
  }

  if (!hasReadme && files.length > 0) {
    score -= 20;
    reasons.push('missing folder README');
  }

  if (placeholderCount > 0) {
    score -= Math.min(25, placeholderCount * 3);
    reasons.push(`placeholder markers: ${placeholderCount}`);
  }

  if (directory === 'examples' && files.length < 4) {
    score -= 25;
    reasons.push('examples are too sparse');
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  let action = 'keep';
  if (normalizedScore < 45) {
    action = 'cut_or_archive';
  } else if (normalizedScore < 75) {
    action = 'improve';
  }

  return {
    directory,
    trackedFileCount: trackedDirectoryFiles.length,
    localFileCount: files.length,
    markdownFileCount: markdownFiles.length,
    hasReadme,
    placeholderCount,
    score: normalizedScore,
    action,
    reasons,
  };
}

function summarizeSrcSurface(trackedFiles) {
  const srcTsFiles = trackedFiles.filter((file) => file.startsWith('src/') && file.endsWith('.ts'));
  const perTopLevel = new Map();

  for (const file of srcTsFiles) {
    const relative = file.slice('src/'.length);
    const topLevel = relative.split('/')[0] ?? '';
    const summary = perTopLevel.get(topLevel) ?? { folder: topLevel, runtimeTs: 0, testTs: 0 };
    const isTest =
      relative.startsWith('__tests__/') || relative.includes('/__tests__/') || relative.startsWith('test/');

    if (isTest) {
      summary.testTs += 1;
    } else {
      summary.runtimeTs += 1;
    }
    perTopLevel.set(topLevel, summary);
  }

  return Array.from(perTopLevel.values()).sort((left, right) => {
    if (right.runtimeTs !== left.runtimeTs) return right.runtimeTs - left.runtimeTs;
    if (right.testTs !== left.testTs) return right.testTs - left.testTs;
    return left.folder.localeCompare(right.folder);
  });
}

function summarizeScripts(trackedFiles) {
  const scriptFiles = trackedFiles
    .filter((file) => file.startsWith('scripts/'))
    .map((file) => file.slice('scripts/'.length))
    .sort((left, right) => left.localeCompare(right));

  const releaseCriticalNames = new Set([
    'assert-package-identity.mjs',
    'build-evidence-manifest.mjs',
    'package-install-smoke.mjs',
    'reconcile_evidence.mjs',
    'refresh-final-verification.mjs',
    'run-with-tmpdir.mjs',
  ]);

  const releaseCritical = [];
  const evalAndHarness = [];
  const tooling = [];

  for (const file of scriptFiles) {
    if (
      releaseCriticalNames.has(file) ||
      file.includes('publish') ||
      file.includes('evidence') ||
      file.includes('package')
    ) {
      releaseCritical.push(file);
      continue;
    }

    if (
      file.startsWith('eval') ||
      file.includes('harness') ||
      file.includes('external') ||
      file.includes('live-fire') ||
      file.includes('agentic')
    ) {
      evalAndHarness.push(file);
      continue;
    }

    tooling.push(file);
  }

  return {
    all: scriptFiles,
    releaseCritical,
    evalAndHarness,
    tooling,
  };
}

function countLocalDirectories(rootPath, targets) {
  if (!fs.existsSync(rootPath)) return {};

  const counts = {};
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (targets.has(entry.name)) {
        counts[entry.name] = (counts[entry.name] ?? 0) + 1;
      }
      stack.push(path.join(current, entry.name));
    }
  }

  return counts;
}

function publicSurfaceRisks(trackedFiles) {
  const trackedWip = trackedFiles.filter(
    (file) => file.endsWith('.wip') && fs.existsSync(path.join(workspaceRoot, file))
  );
  const trackedEvalExternalRepoFiles = trackedFiles.filter(
    (file) =>
      file.startsWith('eval-corpus/external-repos/') &&
      file !== 'eval-corpus/external-repos/manifest.json'
  );

  return {
    trackedWip,
    trackedEvalExternalRepoFiles,
  };
}

function main() {
  const trackedFiles = runGit('git ls-files');
  const directories = collectTopLevelDirectories();
  const audits = directories.map((directory) => directoryAudit(directory, trackedFiles));
  const srcSurface = summarizeSrcSurface(trackedFiles);
  const scripts = summarizeScripts(trackedFiles);
  const evalCorpusFiles = trackedFiles.filter((file) => file.startsWith('eval-corpus/'));
  const localEvalArtifacts = countLocalDirectories(path.join(workspaceRoot, 'eval-corpus'), new Set([
    '.git',
    'node_modules',
    '.librarian',
    '.librarian-eval',
    '.ab-harness-artifacts',
    'state',
  ]));
  const risks = publicSurfaceRisks(trackedFiles);

  const report = {
    schema: 'RepoFolderAudit.v1',
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    summary: {
      totalDirectories: audits.length,
      keep: audits.filter((item) => item.action === 'keep').length,
      improve: audits.filter((item) => item.action === 'improve').length,
      cutOrArchive: audits.filter((item) => item.action === 'cut_or_archive').length,
      trackedSrcTsFiles: trackedFiles.filter((file) => file.startsWith('src/') && file.endsWith('.ts'))
        .length,
      trackedTestTsFiles: trackedFiles.filter(
        (file) =>
          file.startsWith('src/') &&
          file.endsWith('.ts') &&
          (file.startsWith('src/__tests__/') || file.includes('/__tests__/') || file.startsWith('src/test/'))
      ).length,
      trackedScriptFiles: scripts.all.length,
      trackedEvalCorpusFiles: evalCorpusFiles.length,
    },
    directories: audits.sort((left, right) => left.score - right.score),
    srcSurface,
    scripts,
    evalCorpus: {
      trackedFiles: evalCorpusFiles,
      localArtifactDirectoryCounts: localEvalArtifacts,
    },
    risks,
  };

  const outPath = path.join(
    workspaceRoot,
    'state',
    'audits',
    'librarian',
    'repo',
    'RepoFolderAudit.v1.json'
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  for (const item of report.directories) {
    const reasons = item.reasons.length > 0 ? ` (${item.reasons.join('; ')})` : '';
    console.log(
      `${item.directory.padEnd(14)} score=${String(item.score).padStart(3)} action=${item.action}${reasons}`
    );
  }
  const riskCount = report.risks.trackedWip.length + report.risks.trackedEvalExternalRepoFiles.length;
  console.log(
    `\nsrc tests/runtime: ${report.summary.trackedTestTsFiles}/${report.summary.trackedSrcTsFiles}`
  );
  console.log(
    `scripts release/eval/tooling: ${report.scripts.releaseCritical.length}/${report.scripts.evalAndHarness.length}/${report.scripts.tooling.length}`
  );
  console.log(`eval-corpus tracked files: ${report.summary.trackedEvalCorpusFiles}`);
  console.log(`public-surface risk markers: ${riskCount}`);
  console.log(`repo folder audit written to ${outPath}`);
}

main();
