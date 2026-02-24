export interface IssueClosureHygieneInput {
  number: number;
  url: string;
  title: string;
  state: 'open' | 'closed';
  milestoneTitle: string | null;
  labels: string[];
  body: string;
  comments: string[];
}

export type IssueClosureHygieneCode =
  | 'missing_evidence_block'
  | 'missing_build_and_test_verification'
  | 'deferred_issue_must_remain_open';

export interface IssueClosureHygieneFinding {
  code: IssueClosureHygieneCode;
  message: string;
}

export interface IssueClosureHygieneResult {
  required: boolean;
  compliant: boolean;
  findings: IssueClosureHygieneFinding[];
}

const REQUIRED_EVIDENCE_FIELDS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'What changed', pattern: /(^|\n)\s*(?:[-*]\s*)?(?:\*\*)?what changed(?:\*\*)?\s*:/i },
  { name: 'Tests added', pattern: /(^|\n)\s*(?:[-*]\s*)?(?:\*\*)?tests added(?:\*\*)?\s*:/i },
  { name: 'Verified by', pattern: /(^|\n)\s*(?:[-*]\s*)?(?:\*\*)?verified by(?:\*\*)?\s*:/i },
];

const SHIP_BLOCKING_LABELS = new Set([
  'priority: critical',
  'severity: critical',
  'ship-blocking',
  'release-blocking',
]);

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function isM0Milestone(title: string | null): boolean {
  if (!title) return false;
  return /^m0(\b|:)/i.test(title.trim());
}

function hasEvidenceBlock(text: string): boolean {
  return REQUIRED_EVIDENCE_FIELDS.every((field) => field.pattern.test(text));
}

function hasBuildAndTestVerification(text: string): boolean {
  const hasBuild = /\bnpm\s+run\s+build\b/i.test(text);
  const hasTest = /\bnpm\s+test\b/i.test(text);
  return hasBuild && hasTest;
}

function mentionsDeferral(text: string): boolean {
  return /\bdefer(?:red|ring)?\b/i.test(text);
}

function evidencePayload(issue: IssueClosureHygieneInput): string[] {
  const payload: string[] = [];
  if (issue.body.trim().length > 0) {
    payload.push(issue.body);
  }
  for (const comment of issue.comments) {
    if (comment.trim().length > 0) {
      payload.push(comment);
    }
  }
  return payload;
}

export function isShipBlockingIssue(labels: string[]): boolean {
  return labels.some((label) => SHIP_BLOCKING_LABELS.has(normalizeLabel(label)));
}

export function requiresReleaseGradeClosureEvidence(issue: IssueClosureHygieneInput): boolean {
  return isM0Milestone(issue.milestoneTitle) || isShipBlockingIssue(issue.labels);
}

export function evaluateIssueClosureHygiene(issue: IssueClosureHygieneInput): IssueClosureHygieneResult {
  const findings: IssueClosureHygieneFinding[] = [];
  const required = requiresReleaseGradeClosureEvidence(issue);

  if (issue.state !== 'closed') {
    return {
      required,
      compliant: true,
      findings,
    };
  }

  const allText = [issue.body, ...issue.comments].join('\n');
  if (mentionsDeferral(allText)) {
    findings.push({
      code: 'deferred_issue_must_remain_open',
      message: 'Deferred work must remain open and link the baseline scope issue explicitly.',
    });
  }

  if (!required) {
    return {
      required,
      compliant: findings.length === 0,
      findings,
    };
  }

  const payload = evidencePayload(issue);
  const matchingEvidence = payload.find((text) => hasEvidenceBlock(text));
  if (!matchingEvidence) {
    findings.push({
      code: 'missing_evidence_block',
      message: 'Missing closure evidence block with What changed, Tests added, and Verified by.',
    });
  } else if (!hasBuildAndTestVerification(matchingEvidence)) {
    findings.push({
      code: 'missing_build_and_test_verification',
      message: 'Verified by must include both `npm run build` and `npm test` for required closures.',
    });
  }

  return {
    required,
    compliant: findings.length === 0,
    findings,
  };
}
