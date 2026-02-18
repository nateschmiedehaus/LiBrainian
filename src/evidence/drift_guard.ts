export interface DriftFinding {
  code: string;
  message: string;
  line?: number;
}

const EVIDENCE_AUTOGEN_START = '<!-- EVIDENCE_AUTOGEN_START -->';
const EVIDENCE_AUTOGEN_END = '<!-- EVIDENCE_AUTOGEN_END -->';

const RELEASE_CLAIM_PATTERN =
  /(Retrieval Recall@5|Context Precision|Hallucination Rate|Faithfulness|Answer Relevancy|A\/B Lift|Memory per 1K LOC|Scenario Families|\|\s*Metric\s*\|)/i;

const EVIDENCE_REFERENCE_PATTERN =
  /(manifest\.json|state\/audits\/librarian|state\/audits\/LiBrainian|`[^`]*[\\/][^`]*`|`[^`]*\.[a-z0-9]+(?::[0-9]+)?`)/i;

function hasNearby(lines: string[], index: number, pattern: RegExp, window = 2): boolean {
  const from = Math.max(0, index - window);
  const to = Math.min(lines.length - 1, index + window);
  for (let i = from; i <= to; i += 1) {
    if (pattern.test(lines[i])) return true;
  }
  return false;
}

export function analyzeStatusEvidenceDrift(statusContent: string): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const lines = statusContent.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => line.includes(EVIDENCE_AUTOGEN_START));
  const endIdx = lines.findIndex((line) => line.includes(EVIDENCE_AUTOGEN_END));

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    findings.push({
      code: 'missing_autogen_block',
      message: 'STATUS.md must include a valid EVIDENCE_AUTOGEN_START/END block.',
    });
    return findings;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const inAutogenBlock = i > startIdx && i < endIdx;
    if (inAutogenBlock) continue;
    if (!RELEASE_CLAIM_PATTERN.test(line)) continue;

    const hasUnverifiedContext = hasNearby(lines, i, /unverified(?:_by_trace)?\s*\(/i, 3)
      || hasNearby(lines, i, /table below is unverified/i, 12);
    const hasEvidenceReference = hasNearby(lines, i, EVIDENCE_REFERENCE_PATTERN, 3);
    if (hasUnverifiedContext || hasEvidenceReference) continue;

    findings.push({
      code: 'release_claim_missing_evidence_reference',
      message: `Release-relevant claim outside autogen block requires evidence reference or explicit unverified marker: ${line.trim()}`,
      line: i + 1,
    });
  }

  return findings;
}

export function analyzeGatesEvidenceShape(gatesContent: string): DriftFinding[] {
  const findings: DriftFinding[] = [];
  let parsed: { tasks?: unknown };
  try {
    parsed = JSON.parse(gatesContent) as { tasks?: unknown };
  } catch {
    return [{ code: 'gates_invalid_json', message: 'GATES.json is not valid JSON.' }];
  }

  if (!parsed.tasks || typeof parsed.tasks !== 'object' || Array.isArray(parsed.tasks)) {
    findings.push({
      code: 'gates_tasks_missing',
      message: 'GATES.json must include a tasks object for evidence reconciliation.',
    });
  }

  return findings;
}
