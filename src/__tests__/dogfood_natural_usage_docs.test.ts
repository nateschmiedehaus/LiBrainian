import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const protocolPath = resolve(repoRoot, 'docs/librarian/evals/dogfood/m0_qualitative_protocol.md');
const summaryPath = resolve(repoRoot, 'docs/librarian/evals/dogfood/m0_qualitative_summary.md');
const runsReadmePath = resolve(repoRoot, 'docs/librarian/evals/dogfood/m0_qualitative_runs/README.md');
const marketReviewPath = resolve(repoRoot, 'docs/librarian/evals/dogfood/github_agentic_tools_natural_usage_review_2026-02-25.md');
const inboxFailureReviewPath = resolve(repoRoot, 'docs/librarian/evals/dogfood/gh_inbox_failure_review_2026-02-25.md');
const queryPatternsPath = resolve(repoRoot, 'docs/librarian/evals/dogfood/natural_usage_query_patterns.md');
const realSessionsDir = resolve(repoRoot, 'docs/librarian/evals/dogfood/real_sessions');
const realSessionTemplatePath = resolve(repoRoot, 'docs/librarian/evals/dogfood/real_sessions/REAL_SESSION_EVIDENCE_TEMPLATE.md');
const issueClosureTemplatePath = resolve(repoRoot, 'docs/librarian/templates/ISSUE_CLOSURE_EVIDENCE_TEMPLATE.md');
const agentsPath = resolve(repoRoot, 'AGENTS.md');
const runDir = resolve(repoRoot, 'docs/librarian/evals/dogfood/m0_qualitative_runs/20260225-193500Z');

describe('dogfood natural usage docs (issue #833)', () => {
  it('defines a thresholded natural-usage acceptance matrix in the protocol', () => {
    expect(existsSync(protocolPath)).toBe(true);
    const content = readFileSync(protocolPath, 'utf8');

    expect(content).toContain('## Natural-Usage Acceptance Matrix (Issue #833)');
    expect(content).toContain('### Signal 1: Spontaneous Adoption');
    expect(content).toContain('### Signal 2: Causal Usefulness');
    expect(content).toContain('### Signal 3: Appropriate Restraint');

    expect(content).toMatch(/used_librarian_rate\s*>?=\s*0\.70/i);
    expect(content).toMatch(/success_lift_t3_plus\s*>?=\s*0\.25/i);
    expect(content).toMatch(/use_decision_precision\s*>?=\s*0\.80/i);
    expect(content).toMatch(/use_decision_recall\s*>?=\s*0\.75/i);
    expect(content).toMatch(/unnecessary_query_rate\s*<=\s*0\.20/i);

    expect(content).toContain('natural_usage_metrics.csv');
    expect(content).toContain('ablation_replay.csv');
    expect(content).toContain('decision_trace.md');
  });

  it('wires run artifact requirements for natural usage evidence', () => {
    expect(existsSync(runsReadmePath)).toBe(true);
    const content = readFileSync(runsReadmePath, 'utf8');

    expect(content).toContain('natural_usage_metrics.csv');
    expect(content).toContain('ablation_replay.csv');
    expect(content).toContain('decision_trace.md');
  });

  it('contains natural-usage matrix artifacts and per-task decision traces in the run directory', () => {
    const naturalUsageMetricsPath = resolve(runDir, 'natural_usage_metrics.csv');
    const ablationReplayPath = resolve(runDir, 'ablation_replay.csv');
    expect(existsSync(naturalUsageMetricsPath)).toBe(true);
    expect(existsSync(ablationReplayPath)).toBe(true);

    const naturalMetrics = readFileSync(naturalUsageMetricsPath, 'utf8');
    expect(naturalMetrics).toContain('used_librarian_rate');
    expect(naturalMetrics).toContain('success_lift_t3_plus');
    expect(naturalMetrics).toContain('use_decision_precision');

    const ablation = readFileSync(ablationReplayPath, 'utf8');
    expect(ablation).toContain('task_id');
    expect(ablation).toContain('AGGREGATE');

    for (let taskNumber = 1; taskNumber <= 12; taskNumber += 1) {
      const taskId = `T${String(taskNumber).padStart(2, '0')}`;
      const tracePath = resolve(runDir, 'tasks', taskId, 'decision_trace.md');
      expect(existsSync(tracePath)).toBe(true);
      const trace = readFileSync(tracePath, 'utf8');
      expect(trace).toContain('Decision Trace');
    }
  });

  it('defines natural-language query patterns for core task categories', () => {
    expect(existsSync(queryPatternsPath)).toBe(true);
    const content = readFileSync(queryPatternsPath, 'utf8');

    expect(content).toContain('## 1) Bug Investigation');
    expect(content).toContain('## 2) Feature Location');
    expect(content).toContain('## 3) Safe Refactor Planning');
    expect(content).toContain('## 4) Test Impact Analysis');

    expect(content).toContain('Expected output:');
    expect(content).toContain('skip LiBrainian for trivial deterministic edits');
  });

  it('tracks natural-usage gate status in the summary', () => {
    expect(existsSync(summaryPath)).toBe(true);
    const content = readFileSync(summaryPath, 'utf8');

    expect(content).toContain('## Natural-Usage Gate (Issue #833)');
    expect(content).toContain('Spontaneous adoption');
    expect(content).toContain('Causal usefulness');
    expect(content).toContain('Appropriate restraint');
    expect(content).toMatch(/result:\s*(GO|NO_GO)/i);
  });

  it('captures market and GH inbox failure reviews for forward-looking process updates', () => {
    expect(existsSync(marketReviewPath)).toBe(true);
    expect(existsSync(inboxFailureReviewPath)).toBe(true);

    const market = readFileSync(marketReviewPath, 'utf8');
    expect(market).toContain('openai/codex');
    expect(market).toContain('anthropics/claude-code');
    expect(market).toContain('Aider-AI/aider');
    expect(market).toContain('cline/cline');
    expect(market).toContain('OpenHands/OpenHands');
    expect(market).toContain('continuedev/continue');
    expect(market).toContain('google-gemini/gemini-cli');
    expect(market).toContain('obra/superpowers');

    const inbox = readFileSync(inboxFailureReviewPath, 'utf8');
    expect(inbox).toContain('ci');
    expect(inbox).toContain('e2e-cadence');
    expect(inbox).toContain('Agent Patrol');
    expect(inbox).toContain('eval-corpus');
  });

  it('ships a real-session evidence template with at least 3 initial sessions including a natural failure follow-up', () => {
    expect(existsSync(realSessionsDir)).toBe(true);
    expect(existsSync(realSessionTemplatePath)).toBe(true);

    const template = readFileSync(realSessionTemplatePath, 'utf8');
    expect(template).toContain('## Natural Usage Decision');
    expect(template).toContain('## Queries and Outputs');
    expect(template).toContain('## Outcome Signals');
    expect(template).toContain('## Failure/Gap Notes');

    const sessionFiles = readdirSync(realSessionsDir).filter((name) =>
      /^\d{4}-\d{2}-\d{2}-session-\d{2}-.+\.md$/.test(name)
    );
    expect(sessionFiles.length).toBeGreaterThanOrEqual(3);

    const session03 = readFileSync(
      resolve(realSessionsDir, '2026-02-25-session-03-observability-failure.md'),
      'utf8'
    );
    expect(session03).toContain('natural_failure');
    expect(session03).toContain('follow_up_issue');
    expect(session03).toContain('#834');
  });

  it('extends issue closure evidence template with natural usage and patrol quality signals', () => {
    expect(existsSync(issueClosureTemplatePath)).toBe(true);
    const template = readFileSync(issueClosureTemplatePath, 'utf8');

    expect(template).toContain('Natural usage evidence');
    expect(template).toContain('Causal usefulness evidence');
    expect(template).toContain('Restraint evidence');
    expect(template).toContain('Patrol/CI signal review');
  });

  it('documents natural-usage encouragement in repository agent instructions', () => {
    expect(existsSync(agentsPath)).toBe(true);
    const agents = readFileSync(agentsPath, 'utf8');

    expect(agents).toContain('## Natural Usage Heuristics (Issue #833)');
    expect(agents).toContain('Natural-language intent examples');
    expect(agents).toContain('Use LiBrainian when uncertainty is high');
    expect(agents).toContain('Skip LiBrainian for trivial deterministic edits');
  });
});
