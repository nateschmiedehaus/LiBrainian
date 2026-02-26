#!/usr/bin/env node
/**
 * Patrol Post-Processor: Aggregates patrol report artifacts, creates GitHub
 * issues for significant findings, tracks evidence in a ledger, and detects
 * quality drift.
 *
 * Usage:
 *   node scripts/patrol-post-process.mjs [options]
 *     --report <glob>             patrol report JSON files
 *     --artifact <path>           output summary JSON path
 *     --markdown <path>           output markdown path
 *     --create-gh-issues          actually create issues
 *     --repo <owner/name>         GitHub repo for issues
 *     --ledger <path>             evidence ledger path
 *     --max-issues <n>            cap per run (default: 10)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { glob } from 'glob';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: opts.stdio ?? 'pipe',
    shell: false,
  });
  if (result.status !== 0) {
    const stdout = result.stdout?.trim() ?? '';
    const stderr = result.stderr?.trim() ?? '';
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${combined ? `\n${combined}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), 'utf8'));
}

async function writeJson(filePath, payload) {
  const absPath = path.resolve(filePath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function writeMarkdown(filePath, content) {
  const absPath = path.resolve(filePath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// GH issue helpers
// ---------------------------------------------------------------------------
function isGhAvailable(repo) {
  if (!repo) return false;
  const binary = spawnSync('gh', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  if (binary.status !== 0) return false;
  const auth = spawnSync('gh', ['auth', 'status', '-h', 'github.com'], { encoding: 'utf8', stdio: 'pipe' });
  return auth.status === 0;
}

function findExistingIssue(repo, diagnosisKey) {
  const search = `[patrol-finding:${diagnosisKey}] state:open`;
  const json = run('gh', [
    'issue', 'list',
    '--repo', repo,
    '--search', search,
    '--limit', '1',
    '--json', 'number,title,url',
  ]);
  const parsed = JSON.parse(json);
  return Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null;
}

/**
 * Search for existing open issues with similar titles/content.
 * Uses GH search to find issues that might already cover this finding,
 * even if they weren't created by patrol.
 */
function findSimilarIssue(repo, finding) {
  // Extract key terms from the title for similarity search
  const searchTerms = finding.title
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4)
    .join(' ');

  if (!searchTerms.trim()) return null;

  try {
    const json = run('gh', [
      'issue', 'list',
      '--repo', repo,
      '--search', `${searchTerms} state:open`,
      '--limit', '5',
      '--json', 'number,title,url,labels',
    ]);
    const candidates = JSON.parse(json);
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    // Score similarity: count how many key terms appear in existing issue titles
    const terms = searchTerms.toLowerCase().split(/\s+/);
    for (const candidate of candidates) {
      const candidateTitle = (candidate.title ?? '').toLowerCase();
      const matchCount = terms.filter((t) => candidateTitle.includes(t)).length;
      if (matchCount >= Math.ceil(terms.length * 0.5)) {
        return candidate;
      }
    }
  } catch {
    // Search failed -- proceed with creation
  }
  return null;
}

function buildIssueTitle(finding) {
  const prefix = finding.severity === 'critical' ? '[CRITICAL]'
    : finding.severity === 'high' ? '[HIGH]'
    : '[PATROL]';
  return `${prefix} ${finding.title}`.slice(0, 120);
}

function buildIssueBody(finding, context = {}) {
  const lines = [];

  // Summary — the full agent observation with context
  lines.push(`## Summary`);
  lines.push('');
  lines.push(finding.detail);
  lines.push('');

  // Impact section — rich, specific, quantified
  lines.push('## Impact');
  lines.push('');
  const impactDetails = {
    critical: {
      userImpact: 'Complete feature failure. The documented capability does not exist or is entirely non-functional.',
      agentImpact: 'Agents following documentation or natural workflows will hit an immediate dead end. No workaround exists within LiBrainian.',
      trustImpact: 'Critical trust violation — documented features that do not work destroy confidence in the entire tool.',
      releaseBlocking: true,
    },
    high: {
      userImpact: 'Major feature degradation. The feature partially works but produces incorrect, confusing, or unusable output.',
      agentImpact: 'Agents can partially work around this but will waste significant time, produce lower-quality results, or fall back to manual alternatives (grep/cat).',
      trustImpact: 'Agents will learn to distrust this feature and stop using it, reducing LiBrainian\'s value proposition.',
      releaseBlocking: true,
    },
    medium: {
      userImpact: 'Noticeable quality issue. The feature works but output is polluted, confusing, or inconsistent.',
      agentImpact: 'Agents can work through this but it creates unnecessary friction and wastes context window on noise.',
      trustImpact: 'Reduces confidence in output quality. Agents may double-check LiBrainian results rather than trusting them.',
      releaseBlocking: false,
    },
    low: {
      userImpact: 'Minor annoyance. Does not prevent the feature from being useful.',
      agentImpact: 'Minimal workflow impact. May cause brief confusion but does not block progress.',
      trustImpact: 'Cosmetic issue that slightly reduces polish.',
      releaseBlocking: false,
    },
  };
  const impact = impactDetails[finding.severity] ?? impactDetails.medium;
  lines.push(`**Severity:** \`${finding.severity}\` | **Category:** \`${finding.category}\` | **Release-blocking:** ${impact.releaseBlocking ? 'Yes' : 'No'}`);
  lines.push('');
  lines.push(`**User impact:** ${impact.userImpact}`);
  lines.push('');
  lines.push(`**Agent impact:** ${impact.agentImpact}`);
  lines.push('');
  lines.push(`**Trust impact:** ${impact.trustImpact}`);
  lines.push('');
  lines.push(`**Scope:** Reproduced on ${finding.repos.join(', ')} (${finding.occurrenceCount} occurrence(s) across ${finding.repos.length} repo(s) in patrol runs)`);
  if (Array.isArray(finding.transcripts) && finding.transcripts.length > 0) {
    lines.push(`**Transcript evidence:** ${finding.transcripts.map((p) => `\`${p}\``).join(', ')}`);
  }
  if (finding.effortEstimate) {
    lines.push(`**Estimated fix effort:** ${finding.effortEstimate}`);
  }
  if (typeof finding.npsImpact === 'number') {
    const currentNps = context.meanNps ?? '?';
    lines.push(`**NPS recovery if fixed:** +${finding.npsImpact} (current patrol NPS: ${currentNps}/10)`);
  }
  lines.push('');

  // Repro evidence — detailed, step-by-step, with expected vs actual
  lines.push('## Repro evidence');
  lines.push('');
  lines.push('### Environment');
  lines.push('');
  lines.push('```');
  lines.push('LiBrainian: v0.2.1');
  lines.push('Node.js: v22.x');
  lines.push('Platform: macOS (Darwin 24.6.0)');
  lines.push('Agent: Claude Sonnet (via Agent Patrol E2E system)');
  lines.push(`Test repos: ${finding.repos.join(', ')}`);
  lines.push('```');
  lines.push('');
  lines.push('### Steps to reproduce');
  lines.push('');
  lines.push('```bash');
  lines.push('# 1. Create a test workspace');
  lines.push('mkdir test-workspace && cd test-workspace');
  lines.push('npm init -y');
  lines.push('');
  lines.push('# 2. Install LiBrainian');
  lines.push('npm install librainian');
  lines.push('');
  lines.push('# 3. Bootstrap');
  lines.push('./node_modules/.bin/librainian bootstrap');

  // Add finding-specific repro commands
  const cmdsInDetail = [...(finding.detail.matchAll(/`([^`]+)`/g))].map(m => m[1]);
  if (cmdsInDetail.length > 0) {
    lines.push('');
    lines.push('# 4. Trigger the issue');
    for (const cmd of cmdsInDetail.slice(0, 3)) {
      if (cmd.startsWith('librainian') || cmd.startsWith('./node_modules')) {
        lines.push(`./node_modules/.bin/${cmd.replace(/^\.\/node_modules\/\.bin\//, '')}`);
      }
    }
  } else if (finding.category === 'cli') {
    lines.push('');
    lines.push('# 4. Run the affected CLI command');
    lines.push('./node_modules/.bin/librainian status  # or the relevant command');
  } else if (finding.category === 'constructions') {
    lines.push('');
    lines.push('# 4. Try construction operations');
    lines.push('./node_modules/.bin/librainian constructions list');
    lines.push('./node_modules/.bin/librainian constructions install <construction-id>');
  } else if (finding.category === 'query') {
    lines.push('');
    lines.push('# 4. Run queries');
    lines.push('./node_modules/.bin/librainian query "What does this codebase do?"');
  } else if (finding.category === 'reliability') {
    lines.push('');
    lines.push('# 4. Run multiple operations to trigger degradation');
    lines.push('./node_modules/.bin/librainian query "first query"');
    lines.push('./node_modules/.bin/librainian query "second query"');
    lines.push('./node_modules/.bin/librainian query "third query"  # observe degradation');
  }
  lines.push('```');
  lines.push('');

  lines.push('### Expected behavior');
  lines.push('');
  if (finding.category === 'cli' || finding.category === 'documentation') {
    lines.push('Command executes successfully, returns exit code 0, and produces clean, useful output matching documentation.');
  } else if (finding.category === 'constructions') {
    lines.push('Construction operation completes successfully, packages are installable, and output is useful for agent workflows.');
  } else if (finding.category === 'query') {
    lines.push('Query returns relevant results from the actual project files with accurate confidence scores and no internal file pollution.');
  } else if (finding.category === 'reliability') {
    lines.push('Feature works reliably across all invocations. Provider failures are handled gracefully with automatic fallback. Error messages are clean and actionable.');
  } else {
    lines.push('Feature works as documented without errors or unexpected behavior.');
  }
  lines.push('');

  lines.push('### Actual behavior');
  lines.push('');
  lines.push(finding.detail);
  lines.push('');

  lines.push(`**Reproducibility:** ${finding.reproducible ? 'Deterministic — reproduced on every patrol run' : 'Intermittent — may depend on provider state, rate limits, or timing'}`);
  lines.push(`**First seen:** ${finding.firstSeen}`);
  lines.push('');

  // Acceptance criteria — specific, testable
  lines.push('## Acceptance criteria');
  lines.push('');

  if (finding.suggestedFix) {
    lines.push(`- [ ] **Primary fix:** ${finding.suggestedFix}`);
  }

  // Category-specific detailed acceptance criteria
  if (finding.category === 'cli') {
    lines.push('- [ ] CLI command returns exit code 0 on success');
    lines.push('- [ ] Output renders exactly once (no duplicate rendering)');
    lines.push('- [ ] Output is formatted for human readability (not raw JSON unless --json flag)');
    lines.push('- [ ] No internal log noise (`Model policy provider not registered`, etc.) appears in user-facing output');
    lines.push('- [ ] `librainian --help` accurately lists only commands that exist');
  } else if (finding.category === 'constructions') {
    lines.push('- [ ] `librainian constructions list` only shows constructions that can actually be used');
    lines.push('- [ ] `librainian constructions install <id>` succeeds (packages exist on npm or are bundled)');
    lines.push('- [ ] Construction execution produces actionable, human-readable output');
    lines.push('- [ ] If a construction is unavailable, the error message explains how to make it available');
  } else if (finding.category === 'reliability') {
    lines.push('- [ ] Feature works reliably across 5+ consecutive invocations without degradation');
    lines.push('- [ ] When a provider fails, the system automatically switches to an available alternative');
    lines.push('- [ ] Error messages are single-line, human-readable summaries (no raw subprocess stderr)');
    lines.push('- [ ] Provider health state does not persist incorrectly between invocations');
  } else if (finding.category === 'query') {
    lines.push('- [ ] Query results only include actual project files (not .librarian/state/*, not internal audit files)');
    lines.push('- [ ] Workspace root in results matches the actual workspace path');
    lines.push('- [ ] Confidence scores correlate with actual result quality');
    lines.push('- [ ] Internal warnings are logged to debug output, not mixed into query results');
  } else if (finding.category === 'documentation') {
    lines.push('- [ ] Every command listed in documentation/help text exists and works');
    lines.push('- [ ] Help text for each command accurately describes available subcommands and flags');
    lines.push('- [ ] Agent-facing prompts only reference features that are implemented');
  }
  lines.push('- [ ] Agent Patrol re-run on the same repo(s) no longer reports this finding');
  lines.push('- [ ] No regressions introduced in related features (verify with `npm test`)');
  lines.push('');

  // Recommended fix — detailed
  if (finding.suggestedFix) {
    lines.push('## Recommended fix');
    lines.push('');
    lines.push(finding.suggestedFix);
    lines.push('');
    if (finding.effortEstimate) {
      lines.push(`**Estimated effort:** ${finding.effortEstimate}`);
      lines.push('');
    }
  }

  // Context from patrol
  lines.push('## Context');
  lines.push('');
  lines.push('This issue was discovered by the **Agent Patrol E2E system**, which deploys a real Claude agent into real projects with LiBrainian installed and lets it work naturally. The agent independently identified this issue while attempting to use LiBrainian to understand the codebase.');
  lines.push('');
  const nps = context.meanNps ?? '?';
  const totalFindings = context.totalFindings ?? '?';
  const recommend = nps !== '?' && nps >= 7 ? 'would recommend' : 'would NOT recommend';
  lines.push(`- **Patrol mode:** ${context.mode ?? 'quick'}`);
  lines.push(`- **Test repo(s):** ${finding.repos.join(', ')}`);
  lines.push(`- **Overall NPS from patrol:** ${nps}/10 (agent ${recommend} LiBrainian)`);
  lines.push(`- **Total negative findings this run:** ${totalFindings}`);
  lines.push('');

  lines.push('---');
  lines.push(`[patrol-finding:${finding.key}]`);
  return lines.join('\n');
}

function createIssue(repo, finding, context = {}) {
  // Check for exact patrol-finding marker match first
  const existing = findExistingIssue(repo, finding.key);
  if (existing) {
    return {
      action: 'existing',
      key: finding.key,
      number: existing.number,
      url: existing.url,
    };
  }

  // Check for similar issues (even non-patrol issues) to avoid duplicates
  const similar = findSimilarIssue(repo, finding);
  if (similar) {
    // Add a comment to the existing similar issue with the patrol finding
    try {
      const commentBody = [
        `## Patrol corroborates this issue`,
        '',
        `Agent Patrol independently found a related problem:`,
        '',
        `**${finding.title}** (${finding.severity})`,
        '',
        finding.detail,
        '',
        finding.suggestedFix ? `**Recommended fix:** ${finding.suggestedFix}` : '',
        finding.effortEstimate ? `**Effort:** ${finding.effortEstimate}` : '',
        typeof finding.npsImpact === 'number' ? `**NPS impact:** +${finding.npsImpact}` : '',
        '',
        `[patrol-finding:${finding.key}]`,
      ].filter(Boolean).join('\n');

      run('gh', ['issue', 'comment', String(similar.number), '--repo', repo, '--body', commentBody]);
    } catch {
      // Comment failed -- not critical
    }
    return {
      action: 'corroborated',
      key: finding.key,
      number: similar.number,
      url: similar.url,
      similarTitle: similar.title,
    };
  }

  const labels = ['patrol', `severity:${finding.severity}`, finding.category];
  const args = [
    'issue', 'create',
    '--repo', repo,
    '--title', buildIssueTitle(finding),
    '--body', buildIssueBody(finding, context),
  ];
  for (const label of labels) {
    args.push('--label', label);
  }

  try {
    const url = run('gh', args);
    const match = String(url).match(/\/issues\/(\d+)$/);
    return {
      action: 'created',
      key: finding.key,
      number: match ? Number.parseInt(match[1], 10) : null,
      url,
    };
  } catch (e) {
    return {
      action: 'failed',
      key: finding.key,
      number: null,
      url: null,
      error: e.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Finding aggregation
// ---------------------------------------------------------------------------
function upsertFinding(findingMap, finding, report, run) {
  const existing = findingMap.get(finding.key);
  const transcriptPath = run?.transcriptPath ? String(run.transcriptPath) : null;
  if (existing) {
    existing.occurrenceCount++;
    if (run?.repo && !existing.repos.includes(run.repo)) existing.repos.push(run.repo);
    if (finding.detail?.length > (existing.detail?.length ?? 0)) {
      existing.detail = finding.detail;
    }
    if (!existing.suggestedFix && finding.suggestedFix) {
      existing.suggestedFix = finding.suggestedFix;
    }
    if (transcriptPath && !(existing.transcripts ?? []).includes(transcriptPath)) {
      existing.transcripts = [...(existing.transcripts ?? []), transcriptPath];
    }
    return;
  }

  findingMap.set(finding.key, {
    ...finding,
    repos: run?.repo ? [run.repo] : [],
    firstSeen: report.createdAt,
    occurrenceCount: 1,
    transcripts: transcriptPath ? [transcriptPath] : [],
  });
}

function buildRunFailureFinding(report, run) {
  if (run.observations) return null;
  const transcriptDetail = run.transcriptPath
    ? ` Transcript: \`${run.transcriptPath}\`.`
    : '';
  const durationDetail = typeof run.durationMs === 'number'
    ? ` Duration: ${run.durationMs}ms.`
    : '';
  const exitDetail = typeof run.agentExitCode === 'number'
    ? ` Agent exit code: ${run.agentExitCode}.`
    : '';

  if (run.error) {
    return {
      key: 'runtime:patrol-run-execution-error',
      category: 'reliability',
      severity: report.mode === 'release' ? 'critical' : 'high',
      title: 'Patrol run failed before producing observations',
      detail: `Run on ${run.repo} (${run.task}) crashed with error: ${run.error}.${exitDetail}${durationDetail}${transcriptDetail}`,
      reproducible: false,
      suggestedFix:
        'Stabilize patrol execution path and ensure every run emits a transcript plus synthetic finding even when agent dispatch fails.',
    };
  }

  if (run.timedOut) {
    return {
      key: 'runtime:patrol-run-timeout-no-observation',
      category: 'reliability',
      severity: report.mode === 'release' ? 'critical' : 'high',
      title: 'Patrol run timed out before producing observations',
      detail: `Run on ${run.repo} (${run.task}) timed out before observation extraction.${exitDetail}${durationDetail}${transcriptDetail}`,
      reproducible: true,
      suggestedFix:
        'Enforce bounded timeout recovery with progress heartbeat and emit fallback observation artifacts when timeout occurs.',
    };
  }

  if (typeof run.agentExitCode === 'number' && run.agentExitCode !== 0) {
    return {
      key: 'runtime:patrol-run-nonzero-no-observation',
      category: 'reliability',
      severity: report.mode === 'release' ? 'critical' : 'high',
      title: 'Patrol run exited non-zero without observations',
      detail: `Run on ${run.repo} (${run.task}) exited non-zero with no extracted observations.${exitDetail}${durationDetail}${transcriptDetail}`,
      reproducible: false,
      suggestedFix:
        'Improve agent dispatch failure handling and convert non-zero/no-observation runs into actionable synthetic findings.',
    };
  }

  return {
    key: 'quality:patrol-run-missing-observation',
    category: 'process',
    severity: report.mode === 'release' ? 'high' : 'medium',
    title: 'Patrol run completed without structured observations',
    detail: `Run on ${run.repo} (${run.task}) produced no extractable observation payload.${exitDetail}${durationDetail}${transcriptDetail}`,
    reproducible: false,
    suggestedFix:
      'Require agents to emit incremental PATROL_OBS markers and preserve transcript evidence for post-run synthesis.',
  };
}

function aggregateFindings(reports) {
  const findingMap = new Map();

  for (const report of reports) {
    for (const run of report.runs ?? []) {
      for (const neg of run.observations?.negativeFindingsMandatory ?? []) {
        const finding = {
          key: `${slugify(neg.category)}:${slugify(neg.title)}`,
          category: neg.category ?? 'other',
          severity: neg.severity ?? 'medium',
          title: neg.title ?? 'Untitled finding',
          detail: neg.detail ?? '',
          reproducible: neg.reproducible ?? false,
          suggestedFix: neg.suggestedFix ?? '',
        };
        upsertFinding(findingMap, finding, report, run);
      }

      const runFailureFinding = buildRunFailureFinding(report, run);
      if (runFailureFinding) {
        upsertFinding(findingMap, runFailureFinding, report, run);
      }
    }

    if (report.policy?.enforcement === 'blocked') {
      upsertFinding(
        findingMap,
        {
          key: 'policy:patrol-policy-gate-blocked',
          category: 'policy',
          severity: 'critical',
          title: 'Patrol policy gate blocked evidence quality',
          detail: `Patrol policy gate blocked run: ${report.policy.reason ?? 'unknown reason'}. Required=${report.policy.requiredEvidenceMode}, observed=${report.policy.observedEvidenceMode}.`,
          reproducible: true,
          suggestedFix:
            'Fix underlying patrol evidence gaps before release; do not reclassify blocked policy outcomes as acceptable.',
        },
        report,
        null,
      );
    }
  }

  return [...findingMap.values()];
}

// ---------------------------------------------------------------------------
// Severity-to-action mapping
// ---------------------------------------------------------------------------
function shouldCreateIssue(finding) {
  // critical/high: create immediately
  if (finding.severity === 'critical' || finding.severity === 'high') return true;
  // medium: create if 2+ occurrences
  if (finding.severity === 'medium' && finding.occurrenceCount >= 2) return true;
  // low: only if pattern repeats 3+ times
  if (finding.severity === 'low' && finding.occurrenceCount >= 3) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Evidence ledger
// ---------------------------------------------------------------------------
async function loadLedger(ledgerPath) {
  try {
    return await readJson(ledgerPath);
  } catch {
    return { kind: 'PatrolEvidenceLedger.v1', entries: [] };
  }
}

function updateLedger(ledger, report) {
  const entry = {
    createdAt: report.createdAt,
    commitSha: report.commitSha,
    mode: report.mode,
    repoCount: report.runs?.length ?? 0,
    observationCount: (report.runs ?? []).filter((r) => r.observations).length,
    meanNps: report.aggregate?.meanNps ?? 0,
    wouldRecommendRate: report.aggregate?.wouldRecommendRate ?? 0,
    avgNegativeFindings: report.aggregate?.avgNegativeFindings ?? 0,
    implicitFallbackRate: report.aggregate?.implicitFallbackRate ?? 0,
    constructionCoverage: report.aggregate?.constructionCoverage ?? { exercised: 0 },
  };

  ledger.entries.push(entry);

  // Keep last 50 entries
  if (ledger.entries.length > 50) {
    ledger.entries = ledger.entries.slice(-50);
  }

  return ledger;
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------
function detectDrift(ledger) {
  const entries = ledger.entries ?? [];
  if (entries.length < 3) return { hasDrift: false, signals: [] };

  const signals = [];
  const windowSize = Math.min(10, entries.length);
  const recent = entries.slice(-windowSize);
  const current = entries[entries.length - 1];

  // NPS drift
  const meanNps = recent.reduce((a, e) => a + (e.meanNps ?? 0), 0) / recent.length;
  if (current.meanNps < meanNps - 1.5) {
    signals.push({
      metric: 'nps',
      current: current.meanNps,
      rollingMean: Math.round(meanNps * 100) / 100,
      delta: Math.round((current.meanNps - meanNps) * 100) / 100,
    });
  }

  // Recommendation rate drift
  const meanRecommend = recent.reduce((a, e) => a + (e.wouldRecommendRate ?? 0), 0) / recent.length;
  if (current.wouldRecommendRate < meanRecommend - 0.15) {
    signals.push({
      metric: 'wouldRecommendRate',
      current: current.wouldRecommendRate,
      rollingMean: Math.round(meanRecommend * 1000) / 1000,
      delta: Math.round((current.wouldRecommendRate - meanRecommend) * 1000) / 1000,
    });
  }

  // Implicit fallback rate drift
  const meanFallback = recent.reduce((a, e) => a + (e.implicitFallbackRate ?? 0), 0) / recent.length;
  if (current.implicitFallbackRate > meanFallback + 0.15) {
    signals.push({
      metric: 'implicitFallbackRate',
      current: current.implicitFallbackRate,
      rollingMean: Math.round(meanFallback * 1000) / 1000,
      delta: Math.round((current.implicitFallbackRate - meanFallback) * 1000) / 1000,
    });
  }

  return { hasDrift: signals.length > 0, signals };
}

// ---------------------------------------------------------------------------
// Construction coverage tracking
// ---------------------------------------------------------------------------
function trackConstructionCoverage(reports) {
  const exercised = new Set();

  for (const report of reports) {
    for (const run of report.runs ?? []) {
      if (!run.observations) continue;
      for (const c of run.observations.constructionsUsed ?? []) {
        if (c.constructionId) exercised.add(c.constructionId);
      }
    }
  }

  return {
    exercisedConstructions: [...exercised].sort(),
    count: exercised.size,
  };
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------
function buildMarkdown(summary) {
  const lines = [];
  lines.push('# Agent Patrol Summary');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Reports processed:** ${summary.reportCount}`);
  lines.push(`**Total runs:** ${summary.totalRuns}`);
  lines.push(`**Observations extracted:** ${summary.observationCount}`);
  lines.push('');

  // Aggregate metrics
  lines.push('## Aggregate Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  if (summary.latestAggregate) {
    const agg = summary.latestAggregate;
    lines.push(`| Mean NPS | ${agg.meanNps ?? 'N/A'} |`);
    lines.push(`| Would Recommend Rate | ${((agg.wouldRecommendRate ?? 0) * 100).toFixed(1)}% |`);
    lines.push(`| Avg Negative Findings | ${agg.avgNegativeFindings ?? 'N/A'} |`);
    lines.push(`| Implicit Fallback Rate | ${((agg.implicitFallbackRate ?? 0) * 100).toFixed(1)}% |`);
    lines.push(`| Constructions Exercised | ${agg.constructionCoverage?.exercised ?? 0} |`);
    lines.push(`| Composition Success Rate | ${((agg.compositionSuccessRate ?? 0) * 100).toFixed(1)}% |`);
    lines.push(`| Registry Discoverability | ${((agg.registryDiscoverabilityRate ?? 0) * 100).toFixed(1)}% |`);
  }
  lines.push('');

  // Findings
  lines.push('## Findings');
  lines.push('');
  if (summary.findings.length > 0) {
    for (const f of summary.findings) {
      const emoji = f.severity === 'critical' ? '!!!'
        : f.severity === 'high' ? '!!'
        : f.severity === 'medium' ? '!'
        : '';
      lines.push(`### ${emoji} [${f.severity.toUpperCase()}] ${f.title}`);
      lines.push('');
      lines.push(`- **Category:** ${f.category}`);
      lines.push(`- **Occurrences:** ${f.occurrenceCount}`);
      lines.push(`- **Repos:** ${f.repos.join(', ')}`);
      lines.push(`- **Reproducible:** ${f.reproducible ? 'Yes' : 'Unknown'}`);
      if (f.effortEstimate) lines.push(`- **Effort:** ${f.effortEstimate}`);
      if (typeof f.npsImpact === 'number') lines.push(`- **NPS Impact:** +${f.npsImpact}`);
      if (typeof f.priorityRank === 'number') lines.push(`- **Priority Rank:** #${f.priorityRank}`);
      lines.push('');
      lines.push(f.detail);
      lines.push('');
      if (f.suggestedFix) {
        lines.push(`> **Fix:** ${f.suggestedFix}`);
        lines.push('');
      }
    }
  } else {
    lines.push('No findings aggregated.');
    lines.push('');
  }

  // NPS Improvement Roadmap
  if (summary.npsRoadmaps?.length > 0) {
    lines.push('## NPS Improvement Roadmap');
    lines.push('');
    for (const roadmap of summary.npsRoadmaps) {
      lines.push(`**Current NPS:** ${roadmap.currentNps} → **Target:** ${roadmap.targetNps}`);
      lines.push('');
      if (roadmap.changes?.length > 0) {
        lines.push('| Change | NPS Impact | Effort | Rationale |');
        lines.push('|--------|-----------|--------|-----------|');
        for (const c of roadmap.changes) {
          lines.push(`| ${c.change} | +${c.npsImpact ?? '?'} | ${c.effort ?? '?'} | ${c.rationale ?? ''} |`);
        }
        lines.push('');
      }
      if (roadmap.quickWins?.length > 0) {
        lines.push('**Quick Wins:**');
        for (const w of roadmap.quickWins) lines.push(`- ${w}`);
        lines.push('');
      }
      if (roadmap.hardButWorthIt?.length > 0) {
        lines.push('**Hard But Worth It:**');
        for (const h of roadmap.hardButWorthIt) lines.push(`- ${h}`);
        lines.push('');
      }
    }
  }

  // Path to 10/10
  if (summary.pathTo10s?.length > 0) {
    lines.push('## Path to 10/10');
    lines.push('');
    for (const p of summary.pathTo10s) {
      if (p.vision) {
        lines.push(`**Vision:** ${p.vision}`);
        lines.push('');
      }
      if (p.missingCapabilities?.length > 0) {
        lines.push('**Missing Capabilities:**');
        for (const m of p.missingCapabilities) lines.push(`- ${m}`);
        lines.push('');
      }
      if (p.currentBlockers?.length > 0) {
        lines.push('**Current Blockers:**');
        for (const b of p.currentBlockers) lines.push(`- ${b}`);
        lines.push('');
      }
      if (p.delightFactors?.length > 0) {
        lines.push('**Delight Factors (what would make agents excited):**');
        for (const d of p.delightFactors) lines.push(`- ${d}`);
        lines.push('');
      }
      if (p.competitorComparison) {
        lines.push(`**vs. grep/find/cat:** ${p.competitorComparison}`);
        lines.push('');
      }
    }
  }

  // Fix Recommendations (sorted by NPS impact)
  if (summary.fixRecommendations?.length > 0) {
    lines.push('## Fix Recommendations (by NPS impact)');
    lines.push('');
    lines.push('| # | Finding | Fix | Effort | NPS Impact |');
    lines.push('|---|---------|-----|--------|-----------|');
    const sorted = [...summary.fixRecommendations].sort((a, b) => (b.npsImpact ?? 0) - (a.npsImpact ?? 0));
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      lines.push(`| ${i + 1} | ${r.findingTitle} | ${r.fix} | ${r.effort} | +${r.npsImpact ?? '?'} |`);
    }
    lines.push('');
  }

  // Construction coverage
  lines.push('## Construction Coverage');
  lines.push('');
  if (summary.constructionCoverage) {
    lines.push(`**Constructions exercised:** ${summary.constructionCoverage.count}`);
    lines.push('');
    for (const id of summary.constructionCoverage.exercisedConstructions) {
      lines.push(`- ${id}`);
    }
  } else {
    lines.push('No construction coverage data.');
  }
  lines.push('');

  // Drift detection
  if (summary.drift?.hasDrift) {
    lines.push('## Drift Detected');
    lines.push('');
    for (const s of summary.drift.signals) {
      lines.push(`- **${s.metric}**: current=${s.current}, rolling mean=${s.rollingMean}, delta=${s.delta}`);
    }
    lines.push('');
  }

  // Issues
  if (summary.issueActions?.length > 0) {
    lines.push('## Issue Actions');
    lines.push('');
    for (const a of summary.issueActions) {
      const suffix = a.similarTitle ? ` (similar: "${a.similarTitle}")` : '';
      lines.push(`- [${a.action}] ${a.key}${a.url ? ` - ${a.url}` : ''}${suffix}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    report: 'state/patrol/patrol-run-*.json',
    artifact: 'state/patrol/patrol-summary.json',
    markdown: 'state/patrol/patrol-summary.md',
    createGhIssues: false,
    repo: process.env.GITHUB_REPOSITORY || '',
    ledger: '',
    maxIssues: 10,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--report') {
      if (!next) throw new Error('--report requires a value');
      opts.report = next; i++; continue;
    }
    if (arg === '--artifact') {
      if (!next) throw new Error('--artifact requires a value');
      opts.artifact = next; i++; continue;
    }
    if (arg === '--markdown') {
      if (!next) throw new Error('--markdown requires a value');
      opts.markdown = next; i++; continue;
    }
    if (arg === '--create-gh-issues') { opts.createGhIssues = true; continue; }
    if (arg === '--repo') {
      if (!next) throw new Error('--repo requires a value');
      opts.repo = next; i++; continue;
    }
    if (arg === '--ledger') {
      if (!next) throw new Error('--ledger requires a value');
      opts.ledger = next; i++; continue;
    }
    if (arg === '--max-issues') {
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0) throw new Error('--max-issues must be >= 0');
      opts.maxIssues = n; i++; continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Resolve report files
  const reportFiles = await glob(opts.report);
  if (reportFiles.length === 0) {
    console.error(`[patrol-pp] no report files found matching: ${opts.report}`);
    process.exit(1);
  }
  console.log(`[patrol-pp] processing ${reportFiles.length} report file(s)`);

  // Load reports
  const reports = [];
  for (const file of reportFiles.sort()) {
    try {
      const report = await readJson(file);
      if (report.kind === 'PatrolReport.v1') {
        reports.push(report);
      } else {
        console.warn(`[patrol-pp] skipping ${file}: unexpected kind ${report.kind}`);
      }
    } catch (e) {
      console.warn(`[patrol-pp] skipping ${file}: ${e.message}`);
    }
  }

  if (reports.length === 0) {
    console.error('[patrol-pp] no valid patrol reports found');
    process.exit(1);
  }

  // Aggregate findings with deduplication
  const findings = aggregateFindings(reports);
  findings.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4);
  });

  console.log(`[patrol-pp] ${findings.length} unique finding(s) aggregated`);

  // Track construction coverage
  const constructionCoverage = trackConstructionCoverage(reports);
  console.log(`[patrol-pp] ${constructionCoverage.count} construction(s) exercised`);

  // Update evidence ledger
  let ledger = { kind: 'PatrolEvidenceLedger.v1', entries: [] };
  let drift = { hasDrift: false, signals: [] };

  if (opts.ledger) {
    ledger = await loadLedger(opts.ledger);
    for (const report of reports) {
      ledger = updateLedger(ledger, report);
    }
    drift = detectDrift(ledger);
    await writeJson(opts.ledger, ledger);
    console.log(`[patrol-pp] ledger updated: ${ledger.entries.length} entries`);
    if (drift.hasDrift) {
      console.warn(`[patrol-pp] DRIFT DETECTED: ${drift.signals.map((s) => s.metric).join(', ')}`);
    }
  }

  // Build issue context from aggregate data
  const latestReport = reports[reports.length - 1];
  const issueContext = {
    meanNps: latestReport?.aggregate?.meanNps ?? '?',
    mode: latestReport?.mode ?? 'quick',
    totalFindings: findings.length,
  };

  // Create GitHub issues
  const issueActions = [];
  if (opts.createGhIssues && opts.repo && isGhAvailable(opts.repo)) {
    const candidates = findings.filter(shouldCreateIssue).slice(0, opts.maxIssues);
    console.log(`[patrol-pp] creating up to ${candidates.length} issue(s) on ${opts.repo}`);

    for (const finding of candidates) {
      const result = createIssue(opts.repo, finding, issueContext);
      issueActions.push(result);
      console.log(`[patrol-pp] issue: ${result.action} - ${finding.key}${result.url ? ` ${result.url}` : ''}`);
    }
  } else if (opts.createGhIssues) {
    console.log('[patrol-pp] gh issues requested but gh CLI unavailable or no repo specified');
  }

  // Build summary
  const totalRuns = reports.reduce((a, r) => a + (r.runs?.length ?? 0), 0);
  const observationCount = reports.reduce(
    (a, r) => a + (r.runs ?? []).filter((run) => run.observations).length, 0
  );

  // Extract NPS roadmaps, path-to-10s, and fix recommendations from all runs
  const npsRoadmaps = [];
  const pathTo10s = [];
  const fixRecommendations = [];
  for (const report of reports) {
    for (const run of report.runs ?? []) {
      if (!run.observations) continue;
      if (run.observations.npsImprovementRoadmap) {
        npsRoadmaps.push(run.observations.npsImprovementRoadmap);
      }
      if (run.observations.pathTo10) {
        pathTo10s.push(run.observations.pathTo10);
      }
      for (const rec of run.observations.fixRecommendations ?? []) {
        fixRecommendations.push(rec);
      }
      // Also extract per-finding effort/nps data into findings
      for (const neg of run.observations.negativeFindingsMandatory ?? []) {
        const key = `${slugify(neg.category)}:${slugify(neg.title)}`;
        const existing = findings.find((f) => f.key === key);
        if (existing) {
          if (neg.effortEstimate && !existing.effortEstimate) existing.effortEstimate = neg.effortEstimate;
          if (typeof neg.npsImpact === 'number' && !existing.npsImpact) existing.npsImpact = neg.npsImpact;
          if (typeof neg.priorityRank === 'number' && !existing.priorityRank) existing.priorityRank = neg.priorityRank;
        }
      }
    }
  }

  const summary = {
    kind: 'PatrolSummary.v1',
    createdAt: new Date().toISOString(),
    reportCount: reports.length,
    totalRuns,
    observationCount,
    latestAggregate: latestReport.aggregate,
    findings,
    npsRoadmaps,
    pathTo10s,
    fixRecommendations,
    constructionCoverage,
    drift,
    issueActions,
  };

  // Write outputs
  await writeJson(opts.artifact, summary);
  console.log(`[patrol-pp] summary written: ${opts.artifact}`);

  const md = buildMarkdown(summary);
  await writeMarkdown(opts.markdown, md);
  console.log(`[patrol-pp] markdown written: ${opts.markdown}`);

  // Print summary
  console.log(`\n[patrol-pp] === Summary ===`);
  console.log(`  Reports: ${reports.length}`);
  console.log(`  Unique findings: ${findings.length}`);
  console.log(`  Issues created: ${issueActions.filter((a) => a.action === 'created').length}`);
  console.log(`  Issues existing: ${issueActions.filter((a) => a.action === 'existing').length}`);
  console.log(`  Drift detected: ${drift.hasDrift}`);
}

main().catch((err) => {
  console.error('[patrol-pp] fatal error:', err.message);
  process.exit(1);
});
