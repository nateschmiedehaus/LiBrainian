import { describe, expect, it } from 'vitest';
import { analyzeGatesEvidenceShape, analyzeStatusEvidenceDrift } from '../drift_guard.js';

function buildTrustCriticalTasks() {
  return {
    'layer5.retrievalRecall': { status: 'verified', note: 'covered', measured: { recallAt5: 0.82 } },
    'layer5.retrievalPrecision': { status: 'verified', note: 'covered', measured: { precisionAt5: 0.74 } },
    'layer5.hallucinationRate': { status: 'verified', note: 'covered', measured: { hallucinationRate: 0.03 } },
    'layer7.metricsRAGAS': { status: 'verified', note: 'covered', measured: { faithfulness: 0.88 } },
    'layer7.abExperiments': { status: 'verified', note: 'covered', measured: { t3Lift: 0.27 } },
    'layer7.scenarioFamilies': { status: 'verified', note: 'covered', measured: { families: 6 } },
    'layer7.performanceBenchmark': { status: 'verified', note: 'covered', measured: { memoryPerKLoc: 11.2 } },
  };
}

describe('analyzeStatusEvidenceDrift', () => {
  it('passes when release claims are confined to autogen block', () => {
    const status = [
      '# Status',
      '<!-- EVIDENCE_AUTOGEN_START -->',
      '| Metric | Target | Measured | Status |',
      '| Retrieval Recall@5 | 0.8 | 0.82 | MET |',
      '<!-- EVIDENCE_AUTOGEN_END -->',
      'Narrative text only.',
    ].join('\n');

    const findings = analyzeStatusEvidenceDrift(status);
    expect(findings).toEqual([]);
  });

  it('flags release claims outside autogen block without evidence context', () => {
    const status = [
      '# Status',
      '<!-- EVIDENCE_AUTOGEN_START -->',
      'Autogen metrics.',
      '<!-- EVIDENCE_AUTOGEN_END -->',
      '| Retrieval Recall@5 | 0.8 | 0.82 | MET |',
    ].join('\n');

    const findings = analyzeStatusEvidenceDrift(status);
    expect(findings.some((f) => f.code === 'release_claim_missing_evidence_reference')).toBe(true);
  });

  it('allows release claims outside autogen block when explicitly marked unverified', () => {
    const status = [
      '# Status',
      '<!-- EVIDENCE_AUTOGEN_START -->',
      'Autogen metrics.',
      '<!-- EVIDENCE_AUTOGEN_END -->',
      'unverified (evidence_manifest_missing): Table below is unverified.',
      '| Retrieval Recall@5 | 0.8 | 0.82 | MET |',
    ].join('\n');

    const findings = analyzeStatusEvidenceDrift(status);
    expect(findings).toEqual([]);
  });

  it('allows table claims when table-level unverified marker is declared above table header', () => {
    const status = [
      '# Status',
      '<!-- EVIDENCE_AUTOGEN_START -->',
      'Autogen metrics.',
      '<!-- EVIDENCE_AUTOGEN_END -->',
      'unverified (evidence_manifest_missing): Table below is unverified.',
      '| Metric | Target | Measured | Status |',
      '|--------|--------|----------|--------|',
      '| Retrieval Recall@5 | 0.8 | 0.82 | MET |',
      '| Hallucination Rate | < 0.05 | 0.03 | MET |',
      '| Faithfulness | >= 0.85 | 0.86 | MET |',
      '| Context Precision | >= 0.70 | 0.72 | MET |',
      '| Answer Relevancy | >= 0.75 | 0.77 | MET |',
      '| A/B Lift | >= 0.20 | 0.21 | MET |',
    ].join('\n');

    const findings = analyzeStatusEvidenceDrift(status);
    expect(findings).toEqual([]);
  });

  it('allows release claims with inline file evidence references', () => {
    const status = [
      '# Status',
      '<!-- EVIDENCE_AUTOGEN_START -->',
      'Autogen metrics.',
      '<!-- EVIDENCE_AUTOGEN_END -->',
      '| Eval runner synthesis metrics | tested | `src/evaluation/synthesis_metrics.ts`, `src/evaluation/hallucination.ts` | Fact precision and hallucination scoring |',
    ].join('\n');

    const findings = analyzeStatusEvidenceDrift(status);
    expect(findings).toEqual([]);
  });

  it('flags unverified markers inside autogen block', () => {
    const status = [
      '# Status',
      '<!-- EVIDENCE_AUTOGEN_START -->',
      'unverified(provider_unavailable): metric output skipped',
      '<!-- EVIDENCE_AUTOGEN_END -->',
    ].join('\n');

    const findings = analyzeStatusEvidenceDrift(status);
    expect(findings.map((f) => f.code)).toContain('autogen_unverified_marker');
  });
});

describe('analyzeGatesEvidenceShape', () => {
  it('flags invalid JSON', () => {
    const findings = analyzeGatesEvidenceShape('{invalid');
    expect(findings.map((f) => f.code)).toContain('gates_invalid_json');
  });

  it('flags missing tasks object', () => {
    const findings = analyzeGatesEvidenceShape(JSON.stringify({ version: '1' }));
    expect(findings.map((f) => f.code)).toContain('gates_tasks_missing');
  });

  it('passes when tasks object exists', () => {
    const findings = analyzeGatesEvidenceShape(JSON.stringify({ tasks: buildTrustCriticalTasks() }));
    expect(findings).toEqual([]);
  });

  it('flags missing trust-critical tasks', () => {
    const findings = analyzeGatesEvidenceShape(JSON.stringify({ tasks: { 'layer5.retrievalRecall': { status: 'verified' } } }));
    expect(findings.map((f) => f.code)).toContain('gates_trust_task_missing');
  });

  it('flags trust-critical tasks marked unverified', () => {
    const tasks = buildTrustCriticalTasks();
    tasks['layer7.metricsRAGAS'] = {
      status: 'unverified',
      note: 'unverified_by_trace(provider_unavailable): missing provider',
      measured: { faithfulness: 'unverified(provider_unavailable)' },
    };
    const findings = analyzeGatesEvidenceShape(JSON.stringify({ tasks }));
    expect(findings.map((f) => f.code)).toContain('gates_trust_task_unverified');
  });
});
