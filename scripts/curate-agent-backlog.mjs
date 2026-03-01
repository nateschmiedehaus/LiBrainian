#!/usr/bin/env node

/**
 * curate-agent-backlog.mjs
 *
 * One-time (or periodic) script to prepare the issue backlog for autonomous agents.
 *
 * What it does:
 * 1. Identifies issues that are actionable for agents (concrete acceptance criteria,
 *    clear scope, appropriate milestone)
 * 2. Adds `triage/ready` + `agent:actionable` labels to qualifying issues
 * 3. Removes those labels from issues that lost their criteria
 * 4. Prints a summary of the agent-ready backlog by milestone
 *
 * Does NOT:
 * - Close or modify issue content
 * - Create new issues
 * - Touch frozen/tracking/research issues
 *
 * Usage:
 *   node scripts/curate-agent-backlog.mjs [--dry-run] [--milestone M0] [--limit 50]
 */

import { execSync } from 'child_process';

const REPO = 'nateschmiedehaus/LiBrainian';
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MILESTONE_FILTER = args.find((_, i, a) => a[i - 1] === '--milestone') || '';
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '100', 10);

function gh(cmdArgs) {
  const cmd = `gh ${cmdArgs}`;
  try {
    return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (e) {
    console.error(`Failed: ${cmd}`);
    console.error(e.stderr?.slice(0, 500));
    return '';
  }
}

function ghJson(cmdArgs) {
  const result = gh(cmdArgs);
  if (!result) return [];
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

// Skip labels — issues with these are never agent-actionable
const SKIP_LABELS = new Set([
  'lifecycle/frozen',
  'kind/tracking',
  'kind/meta',
  'agent:claimed',
  'agent:blocked',
  'verify:pending',
  'verify:pass',
  'verify:fail',
]);

// Milestone priority order
const MILESTONE_ORDER = {
  'M0: Dogfood-Ready': 0,
  'M1: Construction MVP': 1,
  'M2: Agent Integration': 2,
  'M3: Scale & Epistemics': 3,
  'M4: World-Class': 4,
};

// Minimum requirements for an issue to be agent-actionable
function isActionable(issue) {
  const labels = new Set(issue.labels.map((l) => l.name));
  const body = issue.body || '';

  // Skip if has any blocking label
  for (const skip of SKIP_LABELS) {
    if (labels.has(skip)) return { ok: false, reason: `has label: ${skip}` };
  }

  // Skip post-ship unless in M0/M1
  const milestone = issue.milestone?.title || '';
  const milestoneOrder = MILESTONE_ORDER[milestone] ?? 99;
  if (labels.has('post-ship') && milestoneOrder > 1) {
    return { ok: false, reason: 'post-ship and not M0/M1' };
  }

  // Must be a bug or feature (not pure research)
  if (labels.has('kind/research') && !labels.has('kind/bug') && !labels.has('kind/feature')) {
    return { ok: false, reason: 'pure research issue' };
  }

  // Must have SOME acceptance criteria (check for checkbox patterns or "acceptance" section)
  const hasAcceptance = /acceptance criteria/i.test(body) ||
    /- \[[ x]\]/i.test(body) ||
    /must |should |expected |verify that/i.test(body);

  if (!hasAcceptance) {
    return { ok: false, reason: 'no acceptance criteria detected' };
  }

  // Must have a milestone
  if (!milestone) {
    return { ok: false, reason: 'no milestone' };
  }

  return { ok: true, reason: 'meets criteria' };
}

async function main() {
  console.log(`\n🔍 Curating agent backlog for ${REPO}`);
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Milestone filter: ${MILESTONE_FILTER || 'all'}`);
  console.log(`   Limit: ${LIMIT}\n`);

  // Fetch all open issues
  let searchArgs = `issue list -R ${REPO} --state open --limit ${LIMIT} --json number,title,labels,milestone,body`;
  if (MILESTONE_FILTER) {
    searchArgs += ` --milestone "${MILESTONE_FILTER}"`;
  }
  const issues = ghJson(searchArgs);
  console.log(`Found ${issues.length} open issues\n`);

  const results = { ready: [], notReady: [], alreadyReady: [], unclaimed: [] };

  for (const issue of issues) {
    const labels = new Set(issue.labels.map((l) => l.name));
    const isAlreadyReady = labels.has('triage/ready') && labels.has('agent:actionable');
    const { ok, reason } = isActionable(issue);

    if (ok && !isAlreadyReady) {
      results.ready.push({ ...issue, reason });
      if (!DRY_RUN) {
        gh(`issue edit ${issue.number} -R ${REPO} --add-label "triage/ready" --add-label "agent:actionable"`);
        // Remove missing-essentials if we're marking ready
        if (labels.has('triage/missing-essentials')) {
          gh(`issue edit ${issue.number} -R ${REPO} --remove-label "triage/missing-essentials"`);
        }
      }
    } else if (ok && isAlreadyReady) {
      results.alreadyReady.push(issue);
    } else if (!ok && isAlreadyReady) {
      // Was ready but no longer qualifies
      results.unclaimed.push({ ...issue, reason });
      if (!DRY_RUN) {
        gh(`issue edit ${issue.number} -R ${REPO} --remove-label "agent:actionable"`);
      }
    } else {
      results.notReady.push({ ...issue, reason });
    }
  }

  // Print summary
  console.log('═══════════════════════════════════════════════');
  console.log('  AGENT BACKLOG CURATION SUMMARY');
  console.log('═══════════════════════════════════════════════\n');

  if (results.ready.length > 0) {
    console.log(`✅ Newly marked as agent-actionable (${results.ready.length}):`);
    for (const i of results.ready) {
      const ms = i.milestone?.title || 'none';
      console.log(`   #${i.number} [${ms}] ${i.title}`);
    }
    console.log();
  }

  console.log(`📋 Already agent-actionable: ${results.alreadyReady.length}`);
  console.log(`⏸️  Not actionable: ${results.notReady.length}`);
  if (results.unclaimed.length > 0) {
    console.log(`🔄 Removed from actionable (${results.unclaimed.length}):`);
    for (const i of results.unclaimed) {
      console.log(`   #${i.number} — ${i.reason}`);
    }
  }

  // Breakdown by milestone
  console.log('\n── By Milestone ──');
  const byMilestone = {};
  for (const i of [...results.ready, ...results.alreadyReady]) {
    const ms = i.milestone?.title || 'none';
    byMilestone[ms] = (byMilestone[ms] || 0) + 1;
  }
  const sorted = Object.entries(byMilestone).sort(
    ([a], [b]) => (MILESTONE_ORDER[a] ?? 99) - (MILESTONE_ORDER[b] ?? 99)
  );
  for (const [ms, count] of sorted) {
    console.log(`   ${ms}: ${count} issues`);
  }
  console.log(`\n   Total agent-ready: ${results.ready.length + results.alreadyReady.length}`);
  console.log(`   Total reviewed: ${issues.length}\n`);

  if (DRY_RUN) {
    console.log('(DRY RUN — no labels were changed)\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
