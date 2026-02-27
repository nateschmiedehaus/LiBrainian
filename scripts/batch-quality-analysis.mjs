#!/usr/bin/env node

/**
 * @fileoverview Batch Quality Analysis
 *
 * Runs quality analysis across recent commits that touch quality-sensitive
 * areas of the codebase. Produces a summary report showing which commits
 * improved, degraded, or had no measurable effect on query quality.
 *
 * Usage:
 *   node scripts/batch-quality-analysis.mjs
 *   node scripts/batch-quality-analysis.mjs --since "3 days ago" --max-commits 20
 *   node scripts/batch-quality-analysis.mjs --queries "custom query 1" "custom query 2"
 *   node scripts/batch-quality-analysis.mjs --skip-queries   (just analyze commit metadata)
 *
 * Output:
 *   state/quality-reports/batch-{date}.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** File paths that indicate a commit is quality-sensitive */
const QUALITY_SENSITIVE_PATH_PATTERNS = [
  'src/api/',
  'src/query/',
  'src/cli/commands/query',
  'src/api/embedding',
  'src/adapters/',
  'src/storage/',
  'src/constructions/',
];

/** Default queries to run for each quality-sensitive commit batch */
const DEFAULT_BATCH_QUERIES = [
  { intent: 'architecture', query: 'What is the high-level architecture of this project?' },
  { intent: 'query-pipeline', query: 'How does the query pipeline work from intent to results?' },
  { intent: 'error-handling', query: 'How are errors handled across the codebase?' },
];

const QUERY_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Argument Parsing
// ---------------------------------------------------------------------------

function parseArguments() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  node scripts/batch-quality-analysis.mjs [options]');
    console.log('');
    console.log('Options:');
    console.log('  --since <timespec>    Git log time range (default: "7 days ago")');
    console.log('  --max-commits <n>     Maximum commits to analyze (default: 30)');
    console.log('  --queries <q1> <q2>   Custom queries (optional, can specify multiple)');
    console.log('  --skip-queries        Skip live queries, analyze commit metadata only');
    console.log('  --workspace, -w       Workspace path (defaults to cwd)');
    console.log('  --help, -h            Show this help');
    process.exit(0);
  }

  let since = '7 days ago';
  let maxCommits = 30;
  let queries = [];
  let skipQueries = false;
  let workspace = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--since':
        since = args[++i] || '7 days ago';
        break;
      case '--max-commits':
        maxCommits = parseInt(args[++i], 10) || 30;
        break;
      case '--queries':
        while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          queries.push(args[++i]);
        }
        break;
      case '--skip-queries':
        skipQueries = true;
        break;
      case '--workspace':
      case '-w':
        workspace = args[++i] || process.cwd();
        break;
    }
  }

  return { since, maxCommits, queries, skipQueries, workspace };
}

// ---------------------------------------------------------------------------
// Git Analysis
// ---------------------------------------------------------------------------

/**
 * Get recent commits with their changed files.
 */
async function getRecentCommits(workspace, since, maxCommits) {
  try {
    // Get commit hashes and subjects
    const { stdout: logOutput } = await execFileAsync(
      'git',
      ['log', `--since="${since}"`, `--max-count=${maxCommits}`, '--pretty=format:%H|%ai|%s', '--no-merges'],
      { cwd: workspace, maxBuffer: 5 * 1024 * 1024 }
    );

    if (!logOutput.trim()) return [];

    const commits = [];
    for (const line of logOutput.trim().split('\n')) {
      const [hash, date, ...subjectParts] = line.split('|');
      if (!hash) continue;

      // Get changed files for this commit
      let changedFiles = [];
      try {
        const { stdout: diffOutput } = await execFileAsync(
          'git',
          ['diff-tree', '--no-commit-id', '--name-only', '-r', hash],
          { cwd: workspace, maxBuffer: 1024 * 1024 }
        );
        changedFiles = diffOutput.trim().split('\n').filter(Boolean);
      } catch {
        // Could not get diff -- skip
      }

      commits.push({
        hash: hash.substring(0, 12),
        full_hash: hash,
        date: date?.trim() || '',
        subject: subjectParts.join('|').trim(),
        changed_files: changedFiles,
      });
    }

    return commits;
  } catch (err) {
    console.error(`[batch-quality-analysis] Git log failed: ${err.message}`);
    return [];
  }
}

/**
 * Check if a commit touches quality-sensitive paths.
 */
function isQualitySensitiveCommit(commit) {
  for (const file of commit.changed_files) {
    for (const pattern of QUALITY_SENSITIVE_PATH_PATTERNS) {
      if (file.startsWith(pattern) || file.includes(pattern)) {
        return { sensitive: true, trigger_file: file, trigger_pattern: pattern };
      }
    }
  }
  return { sensitive: false, trigger_file: null, trigger_pattern: null };
}

// ---------------------------------------------------------------------------
// Query Execution
// ---------------------------------------------------------------------------

async function runQuery(queryText, workspace) {
  const cliPath = path.join(workspace, 'src', 'cli', 'index.ts');
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['tsx', cliPath, 'query', queryText, '--json'],
      {
        cwd: workspace,
        timeout: QUERY_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      }
    );

    const durationMs = Date.now() - start;
    let parsed = null;
    const rawOutput = stdout.trim();

    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      // Not JSON
    }

    let filesReturned = [];
    if (parsed) {
      if (Array.isArray(parsed.files)) {
        filesReturned = parsed.files;
      } else if (Array.isArray(parsed.results)) {
        filesReturned = parsed.results.map(r => r.file || r.path || r.name).filter(Boolean);
      } else if (parsed.packs && Array.isArray(parsed.packs)) {
        filesReturned = parsed.packs.flatMap(p => p.files || []);
      } else if (parsed.context_packs && Array.isArray(parsed.context_packs)) {
        filesReturned = parsed.context_packs.flatMap(p =>
          (p.files || p.entries || []).map(e => e.file || e.path || e).filter(f => typeof f === 'string')
        );
      }
    }

    return {
      query: queryText,
      success: true,
      duration_ms: durationMs,
      files_returned: filesReturned.map(f => typeof f === 'string' ? f : (f.file || f.path || String(f))),
      file_count: filesReturned.length,
      has_output: rawOutput.length > 0,
      stderr_empty: !stderr || stderr.trim().length === 0,
    };
  } catch (err) {
    return {
      query: queryText,
      success: false,
      duration_ms: Date.now() - start,
      error: err.message,
      files_returned: [],
      file_count: 0,
      has_output: false,
      stderr_empty: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Existing Analysis Lookup
// ---------------------------------------------------------------------------

/**
 * Check if any per-issue analyses exist for reference.
 */
async function loadExistingAnalyses(workspace) {
  const analysisDir = path.join(workspace, 'state', 'issue-analyses');
  const analyses = [];

  try {
    const entries = await fs.readdir(analysisDir);
    for (const entry of entries) {
      if (!entry.endsWith('-analysis.json')) continue;
      try {
        const content = await fs.readFile(path.join(analysisDir, entry), 'utf8');
        const parsed = JSON.parse(content);
        analyses.push(parsed);
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist yet
  }

  return analyses;
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

function generateReport(commits, sensitiveCommits, queryResults, existingAnalyses) {
  const now = new Date();

  // Cross-reference commits with existing per-issue analyses
  const issueAnalysisMap = new Map();
  for (const analysis of existingAnalyses) {
    if (analysis.issue_number) {
      issueAnalysisMap.set(analysis.issue_number, analysis);
    }
  }

  // Categorize commits
  const categorized = sensitiveCommits.map(c => {
    // Try to extract issue number from commit subject
    const issueMatch = c.commit.subject.match(/#(\d+)/);
    const issueNumber = issueMatch ? parseInt(issueMatch[1], 10) : null;
    const existingAnalysis = issueNumber ? issueAnalysisMap.get(issueNumber) : null;

    return {
      hash: c.commit.hash,
      date: c.commit.date,
      subject: c.commit.subject,
      trigger_file: c.sensitivity.trigger_file,
      trigger_pattern: c.sensitivity.trigger_pattern,
      changed_file_count: c.commit.changed_files.length,
      issue_number: issueNumber,
      has_issue_analysis: !!existingAnalysis,
      issue_verdict: existingAnalysis?.quality_verdict || null,
      issue_analysis_complete: existingAnalysis?.analysis_complete || false,
    };
  });

  // Compute query health snapshot
  const querySnapshot = queryResults.map(r => ({
    intent: r.intent || r.query,
    query: r.query,
    success: r.success,
    file_count: r.file_count,
    duration_ms: r.duration_ms,
    files_sample: r.files_returned.slice(0, 10),
  }));

  const report = {
    generated_at: now.toISOString(),
    date_label: now.toISOString().split('T')[0],
    period: {
      commits_scanned: commits.length,
      quality_sensitive_commits: sensitiveCommits.length,
      non_sensitive_commits: commits.length - sensitiveCommits.length,
    },
    quality_sensitive_commits: categorized,
    current_query_health: {
      queries_run: querySnapshot.length,
      queries_succeeded: querySnapshot.filter(q => q.success).length,
      total_files_returned: querySnapshot.reduce((acc, q) => acc + q.file_count, 0),
      avg_files_per_query: querySnapshot.length > 0
        ? (querySnapshot.reduce((acc, q) => acc + q.file_count, 0) / querySnapshot.length).toFixed(1)
        : '0',
      results: querySnapshot,
    },
    issue_analysis_coverage: {
      commits_with_issue_refs: categorized.filter(c => c.issue_number).length,
      commits_with_analyses: categorized.filter(c => c.has_issue_analysis).length,
      commits_with_complete_analyses: categorized.filter(c => c.issue_analysis_complete).length,
      coverage_gap: categorized.filter(c => c.issue_number && !c.has_issue_analysis).map(c => ({
        hash: c.hash,
        issue: c.issue_number,
        subject: c.subject,
      })),
    },
    agent_action_items: [],
  };

  // Generate action items
  if (report.issue_analysis_coverage.coverage_gap.length > 0) {
    report.agent_action_items.push({
      priority: 'high',
      action: 'Run issue-quality-analysis for commits missing coverage',
      details: report.issue_analysis_coverage.coverage_gap.map(c =>
        `node scripts/issue-quality-analysis.mjs ${c.issue} --description "${c.subject}"`
      ),
    });
  }

  const failedQueries = querySnapshot.filter(q => !q.success);
  if (failedQueries.length > 0) {
    report.agent_action_items.push({
      priority: 'critical',
      action: 'Fix query failures before continuing',
      details: failedQueries.map(q => `Query "${q.query}" failed`),
    });
  }

  const emptyQueries = querySnapshot.filter(q => q.success && q.file_count === 0);
  if (emptyQueries.length > 0) {
    report.agent_action_items.push({
      priority: 'high',
      action: 'Investigate queries returning zero results',
      details: emptyQueries.map(q => `Query "${q.query}" returned no files`),
    });
  }

  return report;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArguments();
  const { since, maxCommits, queries: userQueries, skipQueries, workspace } = opts;

  console.log(`[batch-quality-analysis] Scanning commits since "${since}" (max ${maxCommits})`);
  console.log(`[batch-quality-analysis] Workspace: ${workspace}`);

  // Step 1: Get recent commits
  const commits = await getRecentCommits(workspace, since, maxCommits);
  console.log(`[batch-quality-analysis] Found ${commits.length} commits`);

  if (commits.length === 0) {
    console.log('[batch-quality-analysis] No commits found in range. Nothing to analyze.');
    process.exit(0);
  }

  // Step 2: Filter to quality-sensitive commits
  const sensitiveCommits = [];
  for (const commit of commits) {
    const sensitivity = isQualitySensitiveCommit(commit);
    if (sensitivity.sensitive) {
      sensitiveCommits.push({ commit, sensitivity });
    }
  }

  console.log(`[batch-quality-analysis] ${sensitiveCommits.length}/${commits.length} commits touch quality-sensitive paths`);

  if (sensitiveCommits.length > 0) {
    console.log('[batch-quality-analysis] Quality-sensitive commits:');
    for (const sc of sensitiveCommits) {
      console.log(`  ${sc.commit.hash} ${sc.commit.subject}`);
      console.log(`    trigger: ${sc.sensitivity.trigger_file}`);
    }
  }

  // Step 3: Run current-state queries
  let queryResults = [];
  if (!skipQueries) {
    const queriesToRun = userQueries.length > 0
      ? userQueries.map((q, i) => ({ intent: `custom-${i + 1}`, query: q }))
      : DEFAULT_BATCH_QUERIES;

    console.log(`[batch-quality-analysis] Running ${queriesToRun.length} quality-check queries...`);

    for (const q of queriesToRun) {
      console.log(`[batch-quality-analysis]   "${q.query}" ...`);
      const result = await runQuery(q.query, workspace);
      result.intent = q.intent;
      queryResults.push(result);

      const status = result.success
        ? `OK, ${result.file_count} files (${result.duration_ms}ms)`
        : `FAILED: ${result.error}`;
      console.log(`[batch-quality-analysis]   -> ${status}`);
    }
  } else {
    console.log('[batch-quality-analysis] Skipping live queries (--skip-queries)');
  }

  // Step 4: Load existing per-issue analyses
  const existingAnalyses = await loadExistingAnalyses(workspace);
  console.log(`[batch-quality-analysis] Found ${existingAnalyses.length} existing issue analyses`);

  // Step 5: Generate report
  const report = generateReport(commits, sensitiveCommits, queryResults, existingAnalyses);

  // Step 6: Write report
  const outputDir = path.join(workspace, 'state', 'quality-reports');
  await fs.mkdir(outputDir, { recursive: true });
  const dateLabel = new Date().toISOString().split('T')[0];
  const outputPath = path.join(outputDir, `batch-${dateLabel}.json`);
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`[batch-quality-analysis] Report written to: ${outputPath}`);

  // Step 7: Print summary
  console.log('');
  console.log('='.repeat(72));
  console.log('BATCH QUALITY ANALYSIS SUMMARY');
  console.log('='.repeat(72));
  console.log(`  Period:                  since "${since}"`);
  console.log(`  Total commits:           ${commits.length}`);
  console.log(`  Quality-sensitive:       ${sensitiveCommits.length}`);
  console.log(`  Queries run:             ${queryResults.length}`);
  console.log(`  Queries succeeded:       ${queryResults.filter(r => r.success).length}`);
  console.log(`  Avg files per query:     ${report.current_query_health.avg_files_per_query}`);
  console.log(`  Issue analysis coverage: ${report.issue_analysis_coverage.commits_with_analyses}/${report.issue_analysis_coverage.commits_with_issue_refs} commits with issue refs`);

  if (report.agent_action_items.length > 0) {
    console.log('');
    console.log('  ACTION ITEMS:');
    for (const item of report.agent_action_items) {
      console.log(`    [${item.priority.toUpperCase()}] ${item.action}`);
      if (item.details) {
        for (const detail of item.details.slice(0, 5)) {
          console.log(`      - ${detail}`);
        }
        if (item.details.length > 5) {
          console.log(`      ... and ${item.details.length - 5} more`);
        }
      }
    }
  } else {
    console.log('');
    console.log('  No action items. Current query health looks acceptable.');
  }

  console.log('='.repeat(72));
  console.log(`  Report: ${outputPath}`);
  console.log('='.repeat(72));

  // Always exit 0 -- advisory only
  process.exit(0);
}

main().catch((error) => {
  console.error(`[batch-quality-analysis] Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(0);
});
