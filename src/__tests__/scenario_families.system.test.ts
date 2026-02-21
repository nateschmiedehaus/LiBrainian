/**
 * @fileoverview Tier‑2 Scenario Family Harness (SF‑01…SF‑30)
 *
 * Provider‑required system test that executes a minimal scenario family suite
 * and emits AdequacyReport.v1 + TraceReplayReport.v1 (+ PerformanceReport.v1 when required).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import { bootstrapProject } from '../api/bootstrap.js';
import { queryLiBrainianWithObserver } from '../api/query.js';
import { requireProviders } from '../api/provider_check.js';
import { createEvidenceLedger, createSessionId, type EvidenceEntry } from '../epistemics/evidence_ledger.js';
import type { LiBrainianQuery, LiBrainianResponse } from '../types.js';
import type { LiBrainianStorage } from '../storage/types.js';

type ScenarioFamily = {
  id: string;
  label: string;
  intent: string;
  depth: LiBrainianQuery['depth'];
  taskType?: LiBrainianQuery['taskType'];
  llmRequirement?: LiBrainianQuery['llmRequirement'];
  affectedFiles?: string[];
  ucIds?: string[];
  disclosures?: string[];
  targetedProfiles: string[];
  templateIds: string[];
  performanceSensitive?: boolean;
};

type AdequacyReportArtifactV1 = {
  kind: 'AdequacyReport.v1';
  schema_version: 1;
  created_at: string;
  scenario_id: string;
  workspace: string;
  trace_id: string;
  template_id?: string;
  declared_templates: string[];
  targeted_profiles: string[];
  uc_ids?: string[];
  report: LiBrainianResponse['adequacy'] | null;
  disclosures: string[];
};

type TraceReplayReportV1 = {
  kind: 'TraceReplayReport.v1';
  schema_version: 1;
  created_at: string;
  scenario_id: string;
  workspace: string;
  trace_id: string;
  session_id: string | null;
  ledger_path?: string;
  declared_templates: string[];
  targeted_profiles: string[];
  uc_ids?: string[];
  entry_count: number;
  entries: Array<{
    id: string;
    timestamp: string;
    kind: string;
    payload: unknown;
    provenance: unknown;
    confidence?: unknown;
    related_entries: string[];
    session_id?: string | null;
  }>;
  disclosures: string[];
};

type PerformanceReportV1 = {
  kind: 'PerformanceReport.v1';
  schema_version: 1;
  created_at: string;
  scenario_id: string;
  workspace: string;
  trace_id: string;
  template_id?: string;
  declared_templates: string[];
  targeted_profiles: string[];
  uc_ids?: string[];
  metrics: {
    latency_ms: number;
    pack_count: number;
    stage_count: number;
    stage_durations_ms: Record<string, number>;
    slowest_stage?: { stage: string; duration_ms: number };
  };
  disclosures: string[];
};

const FIXTURE_ROOT = path.resolve(__dirname, '../../../../test/fixtures/librainian_usecase');
const AUDIT_ROOT = path.join(FIXTURE_ROOT, 'state', 'audits', 'librainian', 'scenarios');

const SCENARIOS: ScenarioFamily[] = [
  {
    id: 'SF-01',
    label: 'Orientation baseline',
    intent: 'What are the main entry points in this repo?',
    depth: 'L0',
    llmRequirement: 'disabled',
    affectedFiles: ['src/index.js'],
    ucIds: ['UC-002'],
    disclosures: ['unverified_by_trace(skeleton): deterministic baseline on fixture repo'],
    targetedProfiles: ['R0', 'R1', 'W0', 'D3'],
    templateIds: ['T1'],
  },
  {
    id: 'SF-02',
    label: 'RepoMap at scale',
    intent: 'Summarize the repo structure and key modules.',
    depth: 'L1',
    ucIds: ['UC-001'],
    disclosures: ['unverified_by_trace(skeleton): fixture scale is limited'],
    targetedProfiles: ['R3', 'W0', 'W1', 'S1'],
    templateIds: ['T1'],
    performanceSensitive: true,
  },
  {
    id: 'SF-03',
    label: 'Multi-repo correlation',
    intent: 'Identify shared patterns across services in this repo.',
    depth: 'L2',
    ucIds: ['UC-181'],
    disclosures: ['unverified_by_trace(skeleton): single-fixture stand-in for multi-repo'],
    targetedProfiles: ['R4', 'W0', 'D2', 'D3'],
    templateIds: ['T1', 'T2'],
  },
  {
    id: 'SF-04',
    label: 'EditContext minimality',
    intent: 'What is the minimal context needed to modify authentication?',
    depth: 'L1',
    affectedFiles: ['src/auth/authenticate.js'],
    ucIds: ['UC-135'],
    targetedProfiles: ['R2', 'W0', 'D0', 'D2'],
    templateIds: ['T3', 'T4'],
  },
  {
    id: 'SF-05',
    label: 'Change delta and risk',
    intent: 'Assess change risk if we update authentication flow.',
    depth: 'L2',
    affectedFiles: ['src/auth/authenticate.js'],
    ucIds: ['UC-041'],
    disclosures: ['unverified_by_trace(git_unavailable): delta map requires git history'],
    targetedProfiles: ['R2', 'R3', 'W0', 'D2'],
    templateIds: ['T2', 'T4', 'T5'],
  },
  {
    id: 'SF-06',
    label: 'VerificationPlan compilation',
    intent: 'Produce a verification plan for updating authentication tokens.',
    depth: 'L1',
    ucIds: ['UC-277'],
    disclosures: ['unverified_by_trace(provider_required): verification plan checks may need providers'],
    targetedProfiles: ['R1', 'R2', 'R3', 'R4', 'W0', 'D0', 'D3'],
    templateIds: ['T4', 'T5'],
  },
  {
    id: 'SF-07',
    label: 'Impacted tests selection',
    intent: 'Select impacted tests for an auth change and disclose uncertainty.',
    depth: 'L2',
    ucIds: ['UC-276'],
    disclosures: ['unverified_by_trace(selection_partial): impacted test mapping incomplete'],
    targetedProfiles: ['R2', 'R3', 'W0', 'W1', 'D2'],
    templateIds: ['T5', 'T4'],
    performanceSensitive: true,
  },
  {
    id: 'SF-08',
    label: 'Repro+bisect workflow',
    intent: 'Provide a repro script and bisect plan for a failing login test.',
    depth: 'L2',
    ucIds: ['UC-281'],
    disclosures: ['unverified_by_trace(execution_not_performed): repro/bisect not executed'],
    targetedProfiles: ['R2', 'W1', 'D3'],
    templateIds: ['T6', 'T4'],
  },
  {
    id: 'SF-09',
    label: 'Dependency/SBOM provenance',
    intent: 'Generate an SBOM and map dependency usage for this repo.',
    depth: 'L2',
    ucIds: ['UC-286'],
    disclosures: ['unverified_by_trace(scanner_unavailable): SBOM requires dependency scanners'],
    targetedProfiles: ['R1', 'R2', 'R3', 'W1', 'D2'],
    templateIds: ['T7', 'T4'],
  },
  {
    id: 'SF-10',
    label: 'Infra map extraction',
    intent: 'Map k8s/IaC resources to services and owners.',
    depth: 'L2',
    ucIds: ['UC-295'],
    disclosures: ['unverified_by_trace(adapter_missing): infra adapters not detected in fixture'],
    targetedProfiles: ['R2', 'R3', 'W1', 'D2', 'D3'],
    templateIds: ['T8', 'T1'],
  },
  {
    id: 'SF-11',
    label: 'Observability/runbook synthesis',
    intent: 'Connect alerts and traces to runbooks for this repo.',
    depth: 'L2',
    ucIds: ['UC-309'],
    disclosures: ['unverified_by_trace(runbook_missing): create runbook work object required'],
    targetedProfiles: ['R2', 'W0', 'D0', 'D3'],
    templateIds: ['T1', 'T8'],
  },
  {
    id: 'SF-12',
    label: 'Compliance evidence packs',
    intent: 'Produce a compliance evidence pack for audit readiness.',
    depth: 'L2',
    ucIds: ['UC-294'],
    disclosures: [
      'unverified_by_trace(evidence_missing): compliance evidence artifacts not found',
      'unverified_by_trace(no_compliance_inference): compliance status not inferred without evidence',
    ],
    targetedProfiles: ['R2', 'W1', 'D2', 'D3'],
    templateIds: ['T10', 'T4'],
  },
  {
    id: 'SF-13',
    label: 'Security threat model + findings',
    intent: 'Generate a threat model and evidence-backed security findings.',
    depth: 'L2',
    ucIds: ['UC-293'],
    disclosures: ['unverified_by_trace(threat_model_gaps): threat model requires verification tasks'],
    targetedProfiles: ['R2', 'W1', 'D0'],
    templateIds: ['T4', 'T7'],
  },
  {
    id: 'SF-14',
    label: 'Performance investigation',
    intent: 'Investigate performance bottlenecks and propose measurement plan.',
    depth: 'L2',
    ucIds: ['UC-092'],
    disclosures: ['unverified_by_trace(perf_root_cause_missing): measurement plan required'],
    targetedProfiles: ['R2', 'W0', 'W1', 'D0', 'D3'],
    templateIds: ['T4'],
    performanceSensitive: true,
  },
  {
    id: 'SF-15',
    label: 'API surface inventory',
    intent: 'Inventory public API endpoints and contracts.',
    depth: 'L1',
    ucIds: ['UC-141'],
    disclosures: ['unverified_by_trace(api_surface_structural): API inventory is structural only'],
    targetedProfiles: ['R1', 'R2', 'W0', 'D2'],
    templateIds: ['T3'],
  },
  {
    id: 'SF-16',
    label: 'Config precedence tracing',
    intent: 'Trace configuration sources and precedence rules.',
    depth: 'L1',
    ucIds: ['UC-121'],
    disclosures: ['unverified_by_trace(config_partial): config sources may be incomplete'],
    targetedProfiles: ['R2', 'W0', 'D2'],
    templateIds: ['T3'],
  },
  {
    id: 'SF-17',
    label: 'Authn/authz understanding',
    intent: 'Explain the authentication and authorization flow for this repo.',
    depth: 'L2',
    ucIds: ['UC-102'],
    llmRequirement: 'optional',
    disclosures: ['unverified_by_trace(llm_optional): map + verification plan only if LLM unavailable'],
    targetedProfiles: ['R2', 'W0', 'D0', 'D2'],
    templateIds: ['T4', 'T7'],
  },
  {
    id: 'SF-18',
    label: 'Data model and schema mapping',
    intent: 'Map data model schema locations and versions.',
    depth: 'L1',
    ucIds: ['UC-061'],
    disclosures: ['unverified_by_trace(schema_gaps): schema locations incomplete'],
    targetedProfiles: ['R2', 'W0', 'W1', 'D2'],
    templateIds: ['T1', 'T4'],
  },
  {
    id: 'SF-19',
    label: 'Ownership and codeowners',
    intent: 'Identify code owners and missing ownership coverage.',
    depth: 'L1',
    ucIds: ['UC-021'],
    disclosures: ['unverified_by_trace(ownership_missing): some areas lack ownership metadata'],
    targetedProfiles: ['R1', 'R2', 'R3', 'R4', 'W0', 'D2'],
    templateIds: ['T1', 'T4'],
  },
  {
    id: 'SF-20',
    label: 'Incident timeline reconstruction',
    intent: 'Reconstruct an incident timeline and identify evidence gaps.',
    depth: 'L2',
    ucIds: ['UC-166'],
    disclosures: ['unverified_by_trace(external_evidence_gap): logs/issues unavailable; timeline plan only'],
    targetedProfiles: ['R2', 'W1', 'D2', 'D3'],
    templateIds: ['T4', 'T9'],
  },
  {
    id: 'SF-21',
    label: 'Refactor planning',
    intent: 'Plan a safe refactor of authentication with stepwise changes and impact checks.',
    depth: 'L2',
    ucIds: ['UC-140'],
    disclosures: [
      'unverified_by_trace(refactor_plan_skeleton): step plan requires validation',
      'unverified_by_trace(risk_impact_estimate): impact/risk inferred from static maps',
      'unverified_by_trace(test_selection_partial): impacted tests are estimated',
    ],
    targetedProfiles: ['R2', 'R3', 'W0', 'D2'],
    templateIds: ['T3', 'T4', 'T5'],
  },
  {
    id: 'SF-22',
    label: 'Release readiness',
    intent: 'Assess release readiness for current changes and list required verification evidence.',
    depth: 'L2',
    ucIds: ['UC-157'],
    disclosures: [
      'unverified_by_trace(release_certification_refused): evidence required to certify readiness',
      'unverified_by_trace(verification_obligations_required): verification tasks listed without execution',
    ],
    targetedProfiles: ['R2', 'R3', 'W0', 'W1', 'D2', 'D3'],
    templateIds: ['T2', 'T4'],
  },
  {
    id: 'SF-23',
    label: 'Build/test command discovery',
    intent: 'Discover build and test commands from configuration and CI definitions.',
    depth: 'L1',
    llmRequirement: 'optional',
    ucIds: ['UC-071'],
    disclosures: ['unverified_by_trace(semantic_optional): deterministic extraction prioritized'],
    targetedProfiles: ['R1', 'R2', 'R3', 'W0', 'D3'],
    templateIds: ['T4', 'T5'],
  },
  {
    id: 'SF-24',
    label: 'Watch freshness drift',
    intent: 'Report watcher freshness drift and health signals for this repo.',
    depth: 'L1',
    ucIds: ['UC-271'],
    disclosures: [
      'unverified_by_trace(watch_freshness_report): freshness reported with drift flags',
      'unverified_by_trace(watch_degraded): degraded watch health disclosed',
    ],
    targetedProfiles: ['R1', 'R3', 'W2', 'S1'],
    templateIds: ['T3', 'T4'],
  },
  {
    id: 'SF-25',
    label: 'Multi-agent conflict merge',
    intent: 'Merge conflicting agent updates and surface conflict objects without overwrite.',
    depth: 'L2',
    ucIds: ['UC-272'],
    disclosures: ['unverified_by_trace(conflict_object_required): conflicts surfaced without overwrite'],
    targetedProfiles: ['R2', 'W3', 'S1'],
    templateIds: ['T3', 'T11'],
  },
  {
    id: 'SF-26',
    label: 'Stale evidence decay',
    intent: 'Detect stale evidence and apply defeaters to outdated claims.',
    depth: 'L2',
    ucIds: ['UC-234'],
    disclosures: [
      'unverified_by_trace(staleness_defeater): stale evidence marks defeater',
      'unverified_by_trace(adequacy_staleness): adequacy reflects evidence age',
    ],
    targetedProfiles: ['R1', 'R2', 'R3', 'R4', 'W0', 'E6'],
    templateIds: ['T1', 'T12'],
  },
  {
    id: 'SF-27',
    label: 'Conflicting evidence handling',
    intent: 'Surface contradictory evidence and preserve explicit conflict objects.',
    depth: 'L2',
    ucIds: ['UC-235'],
    disclosures: ['unverified_by_trace(conflict_objects_required): contradictions surfaced without averaging'],
    targetedProfiles: ['R1', 'R2', 'R3', 'R4', 'W0', 'E5'],
    templateIds: ['T1', 'T12'],
  },
  {
    id: 'SF-28',
    label: 'Oversized input handling',
    intent: 'Handle oversized input by timeboxing and truncating with explicit disclosure.',
    depth: 'L1',
    ucIds: ['UC-241'],
    disclosures: [
      'unverified_by_trace(oversized_input_truncated): timebox/truncate applied',
      'unverified_by_trace(no_silent_drops): explicit truncation disclosure provided',
    ],
    targetedProfiles: ['R3', 'W0', 'W1', 'E2'],
    templateIds: ['T12'],
    performanceSensitive: true,
  },
  {
    id: 'SF-29',
    label: 'Provider outage semantics',
    intent: 'Demonstrate deterministic fallback behavior when semantic providers are unavailable.',
    depth: 'L1',
    llmRequirement: 'disabled',
    ucIds: ['UC-270'],
    disclosures: ['unverified_by_trace(provider_outage_simulated): semantic stages blocked; deterministic maps only'],
    targetedProfiles: ['R1', 'R2', 'R3', 'R4', 'W0', 'D3', 'E7'],
    templateIds: ['T3', 'T1'],
  },
  {
    id: 'SF-30',
    label: 'Storage contention/corruption semantics',
    intent: 'Describe remediation and fail-closed behavior for storage contention or corruption.',
    depth: 'L2',
    ucIds: ['UC-246'],
    disclosures: [
      'unverified_by_trace(storage_contention): bounded retries/backoff or fail-closed behavior',
      'unverified_by_trace(storage_corruption): remediation steps required before trust',
    ],
    targetedProfiles: ['R2', 'W0', 'W1', 'W3', 'S1', 'S2', 'E8'],
    templateIds: ['T12'],
  },
];

let storage: LiBrainianStorage;
let runDir: string;

beforeAll(async () => {
  if (!fsSync.existsSync(FIXTURE_ROOT)) {
    throw new Error(`unverified_by_trace(fixture_missing): ${FIXTURE_ROOT}`);
  }
  await requireProviders({ llm: true, embedding: true }, { workspaceRoot: FIXTURE_ROOT });

  const dbPath = path.join(os.tmpdir(), `librainian-sf-${randomUUID()}.db`);
  storage = createSqliteStorage(dbPath, FIXTURE_ROOT);
  await storage.initialize();

  try {
    await bootstrapProject(
      {
        workspace: FIXTURE_ROOT,
        bootstrapMode: 'fast',
        include: ['**/*'],
        exclude: ['node_modules/**', '.git/**'],
        maxFileSizeBytes: 512_000,
        skipProviderProbe: true,
      },
      storage
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`unverified_by_trace(bootstrap_failed): ${message}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  runDir = path.join(AUDIT_ROOT, timestamp);
  await fs.mkdir(runDir, { recursive: true });
}, 300000);

afterAll(async () => {
  await storage?.close?.();
});

async function runScenarioFamily(scenario: ScenarioFamily): Promise<{
  response: LiBrainianResponse;
  adequacyPath: string;
  tracePath: string;
  traceEntries: EvidenceEntry[];
  sessionId: string;
  performancePath?: string;
}> {
  const scenarioDir = path.join(runDir, scenario.id);
  await fs.mkdir(scenarioDir, { recursive: true });

  const ledgerPath = path.join(scenarioDir, 'evidence_ledger.sqlite');
  const ledger = createEvidenceLedger(ledgerPath);
  await ledger.initialize();
  const sessionId = createSessionId();

  const query: LiBrainianQuery = {
    intent: scenario.intent,
    depth: scenario.depth,
    taskType: scenario.taskType,
    llmRequirement: scenario.llmRequirement,
    affectedFiles: scenario.affectedFiles,
    ucRequirements: scenario.ucIds ? { ucIds: scenario.ucIds } : undefined,
  };

  const response = await queryLiBrainianWithObserver(query, storage, {
    traceOptions: { evidenceLedger: ledger, sessionId },
  });

  const entries = await ledger.query({ sessionId, orderDirection: 'asc' });
  await ledger.close();

  const baseDisclosures = new Set<string>(scenario.disclosures ?? []);
  for (const disclosure of response.disclosures ?? []) {
    baseDisclosures.add(disclosure);
  }
  const adequacyDisclosures = Array.from(baseDisclosures);
  if (!response.adequacy) {
    adequacyDisclosures.push('unverified_by_trace(adequacy_unavailable)');
  }

  const adequacyReport: AdequacyReportArtifactV1 = {
    kind: 'AdequacyReport.v1',
    schema_version: 1,
    created_at: new Date().toISOString(),
    scenario_id: scenario.id,
    workspace: FIXTURE_ROOT,
    trace_id: response.traceId,
    template_id: response.constructionPlan?.templateId,
    declared_templates: scenario.templateIds,
    targeted_profiles: scenario.targetedProfiles,
    uc_ids: scenario.ucIds,
    report: response.adequacy ?? null,
    disclosures: adequacyDisclosures,
  };
  const adequacyPath = path.join(scenarioDir, 'AdequacyReport.v1.json');
  await fs.writeFile(adequacyPath, JSON.stringify(adequacyReport, null, 2) + '\n', 'utf8');

  const traceDisclosures = Array.from(baseDisclosures);
  if (entries.length === 0) {
    traceDisclosures.push('unverified_by_trace(replay_unavailable): no ledger entries recorded');
  }

  const traceReport: TraceReplayReportV1 = {
    kind: 'TraceReplayReport.v1',
    schema_version: 1,
    created_at: new Date().toISOString(),
    scenario_id: scenario.id,
    workspace: FIXTURE_ROOT,
    trace_id: response.traceId,
    session_id: sessionId,
    ledger_path: ledgerPath,
    declared_templates: scenario.templateIds,
    targeted_profiles: scenario.targetedProfiles,
    uc_ids: scenario.ucIds,
    entry_count: entries.length,
    entries: entries.map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp.toISOString(),
      kind: entry.kind,
      payload: entry.payload,
      provenance: entry.provenance,
      confidence: entry.confidence,
      related_entries: entry.relatedEntries,
      session_id: entry.sessionId ?? null,
    })),
    disclosures: traceDisclosures,
  };
  const tracePath = path.join(scenarioDir, 'TraceReplayReport.v1.json');
  await fs.writeFile(tracePath, JSON.stringify(traceReport, null, 2) + '\n', 'utf8');

  let performancePath: string | undefined;
  if (scenario.performanceSensitive) {
    const stageDurations: Record<string, number> = {};
    for (const stage of response.stages ?? []) {
      stageDurations[stage.stage] = stage.durationMs;
    }
    const slowestStage = Object.entries(stageDurations).reduce<{ stage: string; duration: number } | null>(
      (acc, [stage, duration]) => {
        if (!acc || duration > acc.duration) {
          return { stage, duration };
        }
        return acc;
      },
      null
    );
    const performanceDisclosures = Array.from(baseDisclosures);
    if (!response.stages || response.stages.length === 0) {
      performanceDisclosures.push('unverified_by_trace(perf_stage_unavailable): no stage timings recorded');
    }
    const performanceReport: PerformanceReportV1 = {
      kind: 'PerformanceReport.v1',
      schema_version: 1,
      created_at: new Date().toISOString(),
      scenario_id: scenario.id,
      workspace: FIXTURE_ROOT,
      trace_id: response.traceId,
      template_id: response.constructionPlan?.templateId,
      declared_templates: scenario.templateIds,
      targeted_profiles: scenario.targetedProfiles,
      uc_ids: scenario.ucIds,
      metrics: {
        latency_ms: response.latencyMs,
        pack_count: response.packs.length,
        stage_count: response.stages?.length ?? 0,
        stage_durations_ms: stageDurations,
        ...(slowestStage ? { slowest_stage: { stage: slowestStage.stage, duration_ms: slowestStage.duration } } : {}),
      },
      disclosures: performanceDisclosures,
    };
    performancePath = path.join(scenarioDir, 'PerformanceReport.v1.json');
    await fs.writeFile(performancePath, JSON.stringify(performanceReport, null, 2) + '\n', 'utf8');
  }

  return { response, adequacyPath, tracePath, traceEntries: entries, sessionId, performancePath };
}

describe('Tier‑2 Scenario Families (SF‑01…SF‑30)', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id} ${scenario.label} emits audit artifacts`, async () => {
      const { response, adequacyPath, tracePath, traceEntries, sessionId, performancePath } =
        await runScenarioFamily(scenario);

      expect(response.traceId).toBe(sessionId);
      expect(response.constructionPlan?.templateId).toBeTruthy();
      expect(scenario.templateIds).toContain(response.constructionPlan?.templateId);
      expect(traceEntries.length).toBeGreaterThan(0);

      const adequacyRaw = await fs.readFile(adequacyPath, 'utf8');
      const adequacy = JSON.parse(adequacyRaw) as AdequacyReportArtifactV1;
      expect(adequacy.kind).toBe('AdequacyReport.v1');
      expect(adequacy.scenario_id).toBe(scenario.id);
      expect(adequacy.trace_id).toBe(response.traceId);
      expect(adequacy.targeted_profiles).toEqual(scenario.targetedProfiles);
      expect(adequacy.declared_templates).toEqual(scenario.templateIds);
      for (const disclosure of scenario.disclosures ?? []) {
        expect(adequacy.disclosures).toContain(disclosure);
      }

      const traceRaw = await fs.readFile(tracePath, 'utf8');
      const trace = JSON.parse(traceRaw) as TraceReplayReportV1;
      expect(trace.kind).toBe('TraceReplayReport.v1');
      expect(trace.scenario_id).toBe(scenario.id);
      expect(trace.trace_id).toBe(response.traceId);
      expect(trace.entry_count).toBeGreaterThan(0);
      expect(trace.targeted_profiles).toEqual(scenario.targetedProfiles);
      expect(trace.declared_templates).toEqual(scenario.templateIds);
      for (const disclosure of scenario.disclosures ?? []) {
        expect(trace.disclosures).toContain(disclosure);
      }

      if (scenario.performanceSensitive) {
        expect(performancePath).toBeTruthy();
        const performanceRaw = await fs.readFile(performancePath as string, 'utf8');
        const performance = JSON.parse(performanceRaw) as PerformanceReportV1;
        expect(performance.kind).toBe('PerformanceReport.v1');
        expect(performance.scenario_id).toBe(scenario.id);
        expect(performance.trace_id).toBe(response.traceId);
        expect(performance.metrics.latency_ms).toBeGreaterThanOrEqual(0);
        expect(performance.targeted_profiles).toEqual(scenario.targetedProfiles);
        expect(performance.declared_templates).toEqual(scenario.templateIds);
        for (const disclosure of scenario.disclosures ?? []) {
          expect(performance.disclosures).toContain(disclosure);
        }
      }
    });
  }
});
