import * as fs from 'fs/promises';
import * as path from 'path';
import { computeCanonRef, computeEnvironmentRef } from '../spine/refs.js';
import { createLiBrainianTraceContext, getLiBrainianTraceRefs, recordLiBrainianTrace } from '../observability/librainian_traces.js';
import type { AgentKnowledgeUsage } from './agent_protocol.js';
import type { OutputValidationResult } from './output_validator.js';

export interface AgentComplianceSummary {
  protocolVersion: string | null;
  evidenceCoverage: number;
  gapsAcknowledged: boolean;
  prohibitedActionsAttempted: string[];
  citedEvidenceCount: number;
  inferenceCount: number;
  gapsEncounteredCount: number;
  directReadsCount: number;
  queriesMadeCount: number;
}

export interface AgentComplianceReportV1 {
  kind: 'AgentComplianceReport.v1';
  schema_version: 1;
  created_at: string;
  canon: Awaited<ReturnType<typeof computeCanonRef>>;
  environment: ReturnType<typeof computeEnvironmentRef>;
  workspace: string;
  task_id: string;
  agent_id: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: AgentComplianceSummary;
  usage?: AgentKnowledgeUsage;
  trace_refs: string[];
}

export async function createAgentComplianceReport(input: {
  workspace: string;
  taskId: string;
  agentId: string;
  validation: OutputValidationResult;
}): Promise<AgentComplianceReportV1> {
  const createdAt = new Date().toISOString();
  const traceContext = createLiBrainianTraceContext(input.taskId);
  recordLiBrainianTrace(traceContext, 'agent_compliance_report');
  return {
    kind: 'AgentComplianceReport.v1',
    schema_version: 1,
    created_at: createdAt,
    canon: await computeCanonRef(input.workspace),
    environment: computeEnvironmentRef(),
    workspace: input.workspace,
    task_id: input.taskId,
    agent_id: input.agentId,
    ok: input.validation.ok,
    errors: input.validation.errors,
    warnings: input.validation.warnings,
    summary: buildSummary(input.validation.usage),
    usage: input.validation.usage,
    trace_refs: getLiBrainianTraceRefs(traceContext),
  };
}

export async function writeAgentComplianceReport(
  workspaceRoot: string,
  report: AgentComplianceReportV1
): Promise<string> {
  const timestamp = report.created_at.replace(/[:.]/g, '-');
  const dir = path.join(workspaceRoot, 'state', 'audits', 'librainian', 'compliance', timestamp);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'AgentComplianceReport.v1.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return reportPath;
}

function buildSummary(usage?: AgentKnowledgeUsage): AgentComplianceSummary {
  const compliance = usage?.compliance;
  return {
    protocolVersion: usage?.protocolVersion ?? null,
    evidenceCoverage: normalizeCoverage(compliance?.evidenceCoverage),
    gapsAcknowledged: Boolean(compliance?.gapsAcknowledged),
    prohibitedActionsAttempted: compliance?.prohibitedActionsAttempted ?? [],
    citedEvidenceCount: usage?.citedEvidence?.length ?? 0,
    inferenceCount: usage?.inferences?.length ?? 0,
    gapsEncounteredCount: usage?.gapsEncountered?.length ?? 0,
    directReadsCount: usage?.directReads?.length ?? 0,
    queriesMadeCount: usage?.queriesMade?.length ?? 0,
  };
}

function normalizeCoverage(value: number | undefined): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const normalized = num > 1 ? num / 100 : num;
  return Math.max(0, Math.min(1, normalized));
}
