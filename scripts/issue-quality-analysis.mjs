#!/usr/bin/env node

/**
 * @fileoverview Per-Issue Quality Analysis
 *
 * The primary quality mechanism for LiBrainian. Deterministic gates catch
 * structural problems, but this script catches "technically passing but
 * actually useless" results by making agents look at real query output
 * and judge whether the change actually helped.
 *
 * Usage:
 *   node scripts/issue-quality-analysis.mjs <issue_number> --description "what changed"
 *   node scripts/issue-quality-analysis.mjs 42 --description "improved embedding fallback for Python repos"
 *   node scripts/issue-quality-analysis.mjs 42 --description "..." --queries "Where is auth enforced?" "What tests cover bootstrap?"
 *   node scripts/issue-quality-analysis.mjs 42 --description "..." --verdict improved --assessment "Results now include the correct auth files"
 *
 * The script:
 *   1. Determines if the issue touches quality-sensitive areas (retrieval, query, embedding, scoring, indexing, user-facing)
 *   2. If yes, runs 2-3 real queries against the live index
 *   3. Captures actual output
 *   4. Writes a structured analysis to state/issue-analyses/issue-{number}-analysis.json
 *   5. Prints a clear summary for the implementing agent to review and fill in judgment
 *
 * Always exits 0 (advisory, not blocking). The value is in forcing agents to
 * READ actual results, not in pass/fail gating.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Paths that indicate the issue touches quality-sensitive areas */
const QUALITY_SENSITIVE_PATTERNS = [
  /src\/api\//,
  /src\/query\//,
  /src\/cli\/commands\/query/,
  /src\/api\/embedding/,
  /src\/adapters\//,
  /src\/storage\//,
  /src\/constructions\//,
  /scoring/i,
  /retrieval/i,
  /indexing/i,
  /ranking/i,
  /relevance/i,
  /embedding/i,
  /bootstrap/i,
];

/** Keywords in descriptions that indicate quality-sensitive changes */
const QUALITY_SENSITIVE_KEYWORDS = [
  'retrieval', 'query', 'embedding', 'scoring', 'indexing', 'ranking',
  'relevance', 'search', 'context', 'bootstrap', 'provider', 'results',
  'accuracy', 'precision', 'recall', 'quality', 'user-facing', 'cli output',
  'synthesis', 'summary', 'intent', 'classification', 'confidence',
];

/** Default queries to run if none are specified -- diverse intents that exercise the pipeline */
const DEFAULT_QUERIES = [
  { intent: 'architecture-overview', query: 'What is the high-level architecture of this project?' },
  { intent: 'specific-feature', query: 'Where is the query pipeline implemented and what are its stages?' },
  { intent: 'cross-cutting-concern', query: 'How are errors handled across the codebase?' },
];

const DEFAULT_QUERY_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Argument Parsing
// ---------------------------------------------------------------------------

function parseArguments() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log('Usage:');
    console.log('  node scripts/issue-quality-analysis.mjs <issue_number> --description "what changed"');
    console.log('');
    console.log('Options:');
    console.log('  --description, -d   Brief description of what changed (required)');
    console.log('  --queries, -q       Custom queries to run (optional, can specify multiple)');
    console.log('  --verdict, -v       Agent verdict: improved | no_change | degraded | insufficient_evidence');
    console.log('  --assessment, -a    Free-text agent assessment of the results');
    console.log('  --concerns, -c      Specific concerns (can specify multiple)');
    console.log('  --changed-files     Comma-separated list of changed file paths');
    console.log('  --skip-queries      Skip running queries (just generate the template)');
    console.log('  --workspace, -w     Workspace path (defaults to cwd)');
    console.log('  --query-timeout-ms  Per-query timeout budget (default: 120000)');
    console.log('  --help, -h          Show this help');
    process.exit(0);
  }

  const issueNumber = parseInt(args[0], 10);
  if (isNaN(issueNumber)) {
    console.error(`[issue-quality-analysis] First argument must be an issue number, got: "${args[0]}"`);
    process.exit(1);
  }

  let description = '';
  let queries = [];
  let verdict = '';
  let assessment = '';
  let concerns = [];
  let changedFiles = [];
  let skipQueries = false;
  let workspace = process.cwd();
  let queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--description':
      case '-d':
        description = args[++i] || '';
        break;
      case '--queries':
      case '-q':
        // Collect all following args until the next flag
        while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          queries.push(args[++i]);
        }
        break;
      case '--verdict':
      case '-v':
        verdict = args[++i] || '';
        break;
      case '--assessment':
      case '-a':
        assessment = args[++i] || '';
        break;
      case '--concerns':
      case '-c':
        while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          concerns.push(args[++i]);
        }
        break;
      case '--changed-files':
        changedFiles = (args[++i] || '').split(',').map(f => f.trim()).filter(Boolean);
        break;
      case '--skip-queries':
        skipQueries = true;
        break;
      case '--workspace':
      case '-w':
        workspace = args[++i] || process.cwd();
        break;
      case '--query-timeout-ms': {
        const raw = args[++i] || '';
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          queryTimeoutMs = parsed;
        }
        break;
      }
    }
  }

  if (!description) {
    console.error('[issue-quality-analysis] --description is required. What did this change do?');
    process.exit(1);
  }

  return {
    issueNumber,
    description,
    queries,
    verdict,
    assessment,
    concerns,
    changedFiles,
    skipQueries,
    workspace,
    queryTimeoutMs,
  };
}

// ---------------------------------------------------------------------------
// Quality-Sensitive Detection
// ---------------------------------------------------------------------------

/**
 * Determine if the issue touches quality-sensitive areas based on changed files
 * and the description text.
 */
function isQualitySensitive(description, changedFiles) {
  const descLower = description.toLowerCase();
  for (const keyword of QUALITY_SENSITIVE_KEYWORDS) {
    if (descLower.includes(keyword)) {
      return { sensitive: true, reason: `Description contains quality-sensitive keyword: "${keyword}"` };
    }
  }

  for (const filePath of changedFiles) {
    for (const pattern of QUALITY_SENSITIVE_PATTERNS) {
      if (pattern.test(filePath)) {
        return { sensitive: true, reason: `Changed file matches quality-sensitive pattern: ${filePath}` };
      }
    }
  }

  return { sensitive: false, reason: 'No quality-sensitive keywords or file patterns detected' };
}

// ---------------------------------------------------------------------------
// Query Execution
// ---------------------------------------------------------------------------

/**
 * Run a single query against the live index and capture output.
 */
async function runQuery(queryText, workspace, timeoutMs) {
  const sourceCliPath = path.join(workspace, 'src', 'cli', 'index.ts');
  const distCliPath = path.join(workspace, 'dist', 'cli', 'index.js');
  const useDistCli = await fs.access(distCliPath).then(() => true).catch(() => false);
  const command = useDistCli ? 'node' : 'npx';
  const baseArgs = useDistCli
    ? [distCliPath, 'query', queryText, '--json', '--timeout', String(timeoutMs), '--no-bootstrap']
    : ['tsx', sourceCliPath, 'query', queryText, '--json', '--timeout', String(timeoutMs), '--no-bootstrap'];
  const start = Date.now();

  const runCommand = async (args, commandTimeoutMs = timeoutMs) => execFileAsync(
    command,
    args,
    {
      cwd: workspace,
      timeout: commandTimeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    }
  );

  try {
    let stdout = '';
    let stderr = '';
    try {
      const result = await runCommand(baseArgs);
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const stderrText = String(error?.stderr ?? '');
      const stdoutText = String(error?.stdout ?? '');
      const combined = `${stderrText}\n${stdoutText}`.toLowerCase();
      const bootstrapRequired = combined.includes('bootstrap')
        || combined.includes('not bootstrapped')
        || combined.includes('query_bootstrap_required');
      const timedOut = Boolean(error?.killed) || /timed out/i.test(String(error?.message ?? ''));
      if (!bootstrapRequired && !timedOut) {
        throw error;
      }

      const retryArgs = baseArgs.filter((arg) => arg !== '--no-bootstrap');
      const retryTimeoutMs = timedOut ? Math.max(timeoutMs * 2, timeoutMs + 30_000) : timeoutMs;
      const retryResult = await runCommand(retryArgs, retryTimeoutMs);
      stdout = retryResult.stdout;
      stderr = retryResult.stderr;
    }

    const durationMs = Date.now() - start;
    let parsed = null;
    let rawOutput = stdout.trim();

    // Try to parse JSON output
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      // Not valid JSON -- that's fine, capture raw text
    }

    // Extract file list from parsed output
    let filesReturned = [];
    if (parsed) {
      // Try common result shapes
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
      files_returned: filesReturned,
      file_count: filesReturned.length,
      raw_output_length: rawOutput.length,
      output_preview: rawOutput.substring(0, 2000),
      stderr_preview: stderr ? stderr.substring(0, 500) : '',
      parsed_output: parsed,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    return {
      query: queryText,
      success: false,
      duration_ms: durationMs,
      error: err.message,
      files_returned: [],
      file_count: 0,
      raw_output_length: 0,
      output_preview: '',
      stderr_preview: err.stderr ? String(err.stderr).substring(0, 500) : '',
      stdout_preview: err.stdout ? String(err.stdout).substring(0, 500) : '',
      timed_out: Boolean(err.killed) || /timed out/i.test(String(err.message ?? '')),
      parsed_output: null,
    };
  }
}

function classifyQueryFailure(result) {
  if (result.success) return null;
  const raw = [
    result.error || '',
    result.stderr_preview || '',
    result.stdout_preview || '',
  ].join('\n').toLowerCase();
  if (raw.includes('mutex lock failed') || raw.includes('libc++abi') || raw.includes('sigabrt')) {
    return 'runtime_abort';
  }
  if (result.timed_out || raw.includes('timed out')) return 'timeout';
  if (raw.includes('bootstrap') || raw.includes('watch_catchup') || raw.includes('reindexing all files')) {
    return 'bootstrap_required_or_churn';
  }
  if (raw.includes('provider_unavailable') || raw.includes('llm provider unavailable')) {
    return 'provider_unavailable';
  }
  return 'query_failed';
}

// ---------------------------------------------------------------------------
// Analysis Generation
// ---------------------------------------------------------------------------

function generateAnalysisPrompt(issueNumber, description, queryResults) {
  const lines = [];
  lines.push('='.repeat(72));
  lines.push('ISSUE QUALITY ANALYSIS -- AGENT REVIEW REQUIRED');
  lines.push('='.repeat(72));
  lines.push('');
  lines.push(`Issue:       #${issueNumber}`);
  lines.push(`Change:      ${description}`);
  lines.push(`Timestamp:   ${new Date().toISOString()}`);
  lines.push('');
  lines.push('-'.repeat(72));
  lines.push('QUERY RESULTS -- Read these carefully before declaring the issue fixed.');
  lines.push('-'.repeat(72));

  for (const result of queryResults) {
    lines.push('');
    lines.push(`  Query: "${result.query}"`);
    lines.push(`  Status: ${result.success ? 'OK' : 'FAILED'} (${result.duration_ms}ms)`);

    if (!result.success) {
      lines.push(`  Error: ${result.error}`);
      const classification = classifyQueryFailure(result);
      if (classification) {
        lines.push(`  Failure class: ${classification}`);
      }
      if (result.timed_out) {
        lines.push('  Note: Query timed out. Consider increasing --query-timeout-ms and ensuring index/bootstrap stability.');
      }
    } else {
      lines.push(`  Files returned: ${result.file_count}`);
      if (result.files_returned.length > 0) {
        for (const file of result.files_returned.slice(0, 15)) {
          const displayFile = typeof file === 'string' ? file : (file.file || file.path || JSON.stringify(file));
          lines.push(`    - ${displayFile}`);
        }
        if (result.files_returned.length > 15) {
          lines.push(`    ... and ${result.files_returned.length - 15} more`);
        }
      }
      if (result.output_preview && !result.parsed_output) {
        lines.push('  Raw output (first 500 chars):');
        for (const outputLine of result.output_preview.substring(0, 500).split('\n')) {
          lines.push(`    ${outputLine}`);
        }
      }
    }

    if (result.stderr_preview) {
      lines.push('  Warnings/errors:');
      for (const stderrLine of result.stderr_preview.split('\n').slice(0, 5)) {
        lines.push(`    ${stderrLine}`);
      }
    }
    if (result.stdout_preview) {
      lines.push('  Stdout preview:');
      for (const stdoutLine of result.stdout_preview.split('\n').slice(0, 5)) {
        lines.push(`    ${stdoutLine}`);
      }
    }
  }

  lines.push('');
  lines.push('-'.repeat(72));
  lines.push('AGENT JUDGMENT REQUIRED');
  lines.push('-'.repeat(72));
  lines.push('');
  lines.push('Given this change was supposed to: ' + description);
  lines.push('');
  lines.push('Answer these questions:');
  lines.push('  1. Do the query results show improvement over what you would expect before this change?');
  lines.push('  2. Are the returned files relevant to each query intent?');
  lines.push('  3. Is anything obviously wrong, missing, or suspicious in the results?');
  lines.push('  4. Would a user asking these questions get useful answers from this output?');
  lines.push('');
  lines.push('Then set your verdict:');
  lines.push('  --verdict improved       Results are clearly better');
  lines.push('  --verdict no_change      Results appear unchanged');
  lines.push('  --verdict degraded       Results are worse than expected');
  lines.push('  --verdict insufficient_evidence  Cannot determine from these queries');
  lines.push('');
  lines.push('Re-run with your judgment:');
  lines.push(`  node scripts/issue-quality-analysis.mjs ${issueNumber} \\`);
  lines.push(`    --description "${description}" \\`);
  lines.push('    --verdict <your_verdict> \\');
  lines.push('    --assessment "<your free-text judgment>" \\');
  lines.push('    --concerns "concern 1" "concern 2"');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArguments();
  const {
    issueNumber, description, queries: userQueries, verdict, assessment,
    concerns, changedFiles, skipQueries, workspace, queryTimeoutMs,
  } = opts;

  console.log(`[issue-quality-analysis] Analyzing issue #${issueNumber}`);
  console.log(`[issue-quality-analysis] Description: ${description}`);

  // Step 1: Determine if quality-sensitive
  const sensitivity = isQualitySensitive(description, changedFiles);
  console.log(`[issue-quality-analysis] Quality-sensitive: ${sensitivity.sensitive} (${sensitivity.reason})`);

  // Step 2: Determine which queries to run
  let queriesToRun = [];
  if (userQueries.length > 0) {
    queriesToRun = userQueries.map((q, i) => ({ intent: `custom-${i + 1}`, query: q }));
  } else {
    queriesToRun = [...DEFAULT_QUERIES];
  }

  // Step 3: Run queries (unless skipped or not quality-sensitive)
  let queryResults = [];
  const forceQueries = userQueries.length > 0;
  const shouldRunQueries = !skipQueries && (sensitivity.sensitive || forceQueries);
  if (shouldRunQueries) {
    if (forceQueries && !sensitivity.sensitive) {
      console.log('[issue-quality-analysis] Running user-specified queries despite non-sensitive auto-detection.');
    }
    console.log(`[issue-quality-analysis] Running ${queriesToRun.length} queries against live index...`);

    for (const q of queriesToRun) {
      console.log(`[issue-quality-analysis]   Running: "${q.query}" ...`);
      const result = await runQuery(q.query, workspace, queryTimeoutMs);
      result.intent = q.intent;
      queryResults.push(result);

      const status = result.success
        ? `OK, ${result.file_count} files (${result.duration_ms}ms)`
        : `FAILED: ${result.error}`;
      console.log(`[issue-quality-analysis]   Result: ${status}`);
    }
  } else if (!sensitivity.sensitive) {
    console.log('[issue-quality-analysis] Issue is not quality-sensitive -- skipping live queries.');
    console.log('[issue-quality-analysis] (Override with --queries "..." to force query execution, or remove --skip-queries)');
  } else {
    console.log('[issue-quality-analysis] Queries skipped (--skip-queries). Generating template only.');
  }

  // Step 4: Build the analysis object
  const analysis = {
    issue_number: issueNumber,
    timestamp: new Date().toISOString(),
    change_description: description,
    quality_sensitive: sensitivity.sensitive,
    quality_sensitive_reason: sensitivity.reason,
    changed_files: changedFiles,
    queries_run: queryResults.map(r => ({
      intent: r.intent,
      query: r.query,
      success: r.success,
      duration_ms: r.duration_ms,
      files_returned: r.files_returned,
      file_count: r.file_count,
      error: r.error || null,
      timed_out: r.timed_out || false,
      failure_class: classifyQueryFailure(r),
      stderr_preview: r.stderr_preview || '',
      stdout_preview: r.stdout_preview || '',
    })),
    evidence_quality: queryResults.length === 0
      ? 'template_only'
      : queryResults.every((r) => r.success)
        ? 'live_queries_ok'
        : queryResults.some((r) => r.success)
          ? 'partial_live_queries'
          : 'failed_live_queries',
    agent_assessment: assessment || '[PENDING -- agent must review results and provide judgment]',
    quality_verdict: verdict || 'insufficient_evidence',
    concerns: concerns.length > 0 ? concerns : ['[PENDING -- agent must list any concerns after reviewing results]'],
    analysis_complete: !!(verdict && assessment),
  };

  // Step 5: Write analysis artifact
  const outputDir = path.join(workspace, 'state', 'issue-analyses');
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `issue-${issueNumber}-analysis.json`);
  await fs.writeFile(outputPath, JSON.stringify(analysis, null, 2) + '\n');
  console.log(`[issue-quality-analysis] Analysis written to: ${outputPath}`);

  // Step 6: Print the human-readable summary
  if (queryResults.length > 0) {
    const prompt = generateAnalysisPrompt(issueNumber, description, queryResults);
    console.log('');
    console.log(prompt);
  }

  // Step 7: Print final summary
  console.log('');
  console.log('='.repeat(72));
  console.log('ANALYSIS SUMMARY');
  console.log('='.repeat(72));
  console.log(`  Issue:              #${issueNumber}`);
  console.log(`  Quality-sensitive:  ${sensitivity.sensitive ? 'YES' : 'NO'}`);
  console.log(`  Queries run:        ${queryResults.length}`);
  console.log(`  Queries succeeded:  ${queryResults.filter(r => r.success).length}`);
  console.log(`  Total files found:  ${queryResults.reduce((acc, r) => acc + r.file_count, 0)}`);
  console.log(`  Verdict:            ${analysis.quality_verdict}`);
  console.log(`  Assessment:         ${analysis.analysis_complete ? 'PROVIDED' : 'PENDING'}`);
  console.log(`  Artifact:           ${outputPath}`);
  console.log('='.repeat(72));

  if (!analysis.analysis_complete) {
    console.log('');
    console.log('ACTION REQUIRED: Review the query results above and re-run with --verdict and --assessment.');
    console.log('The agent assessment is the primary quality evidence -- not just test pass/fail.');
  }

  // Always exit 0 -- this is advisory
  process.exit(0);
}

main().catch((error) => {
  console.error(`[issue-quality-analysis] Fatal: ${error instanceof Error ? error.message : String(error)}`);
  // Even on error, exit 0 -- advisory only
  process.exit(0);
});
