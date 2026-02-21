// Wave0 integration points for LiBrainian.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LiBrainian } from '../api/librainian.js';
import type { LiBrainianQuery, LiBrainianResponse, ContextPack } from '../types.js';
import type { LiBrainianStorage } from '../storage/types.js';
import { getErrorMessage } from '../utils/errors.js';
import { emptyArray, noResult } from '../api/empty_values.js';
import { ensureLiBrainianReady, getLiBrainian, isLiBrainianReady } from './first_run_gate.js';
import { attributeFailure, recordPackOutcome, type AgentKnowledgeContext, type TaskOutcomeSummary } from './causal_attribution.js';
import { getEmergencyModeState, recordConfidenceUpdateSkipped } from './emergency_mode.js';
import { buildTemporalGraph, type TemporalGraph } from '../graphs/temporal_graph.js';
import { logInfo, logWarning } from '../telemetry/logger.js';
import { startFileWatcher, stopFileWatcher } from './file_watcher.js';
import { resolveScenarioGuidance, type ScenarioGuidance } from './scenario_templates.js';
import {
  globalEventBus,
  createContextPacksInvalidatedEvent,
  createFileModifiedEvent,
  createTaskCompletedEvent,
  createTaskFailedEvent,
  createTaskReceivedEvent,
  createIntegrationContextEvent,
  createIntegrationOutcomeEvent,
  createConfidenceUpdatedEvent,
  createFeedbackReceivedEvent,
} from '../events.js';

export interface LiBrainianContext {
  intent?: string;
  taskType?: string;
  summary: string;
  keyFacts: string[];
  snippets: Array<{ file: string; startLine: number; endLine: number; code: string; }>;
  relatedFiles: string[];
  patterns: string[];
  gotchas: string[];
  confidence: number;
  drillDownHints: string[];
  methodHints: string[];
  packIds: string[];
  scenario?: ScenarioGuidance;
}

const isDeterministicMode = (): boolean => process.env.LIBRARIAN_DETERMINISTIC === '1' || process.env.WAVE0_TEST_MODE === 'true';

export async function enrichTaskContext(
  workspace: string,
  query: {
    intent: string;
    affectedFiles?: string[];
    taskType?: string;
    waitForIndexMs?: number;
    taskId?: string;
    ucRequirements?: string[];
    /** Enabled constructables from session config for routing */
    enabledConstructables?: string[];
    embeddingRequirement?: 'required' | 'optional' | 'disabled';
  }
): Promise<LiBrainianContext> {
  if (isDeterministicMode()) {
    return createEmptyContext('LiBrainian disabled in deterministic mode');
  }
  const taskId = query.taskId ?? randomUUID();
  void globalEventBus.emit(createTaskReceivedEvent(taskId, query.intent, query.affectedFiles));
  // Get librainian (should already be ready from first-run gate)
  const librainian = getLiBrainian(workspace);

  if (!librainian) {
    throw new Error('LiBrainian not initialized');
  }

  try {
    const waitRaw = query.waitForIndexMs ?? Number.parseInt(process.env.LIBRARIAN_LIBRARIAN_WAIT_INDEX_MS ?? '', 10);
    const waitForIndexMs = Number.isFinite(waitRaw) && waitRaw > 0 ? waitRaw : undefined;
    const affectedFiles = query.affectedFiles
      ?.map((value) => value.trim())
      .filter(Boolean)
      .map((value) => path.isAbsolute(value) ? value : path.resolve(workspace, value));
    const response = await librainian.queryOptional({
      intent: query.intent,
      affectedFiles,
      taskType: query.taskType,
      depth: 'L1',
      waitForIndexMs,
      ucRequirements: query.ucRequirements ? { ucIds: query.ucRequirements } : undefined,
      enabledConstructables: query.enabledConstructables,
      embeddingRequirement: query.embeddingRequirement ?? 'optional',
    });

    // Emit integration:context event when context is provided
    void globalEventBus.emit(createIntegrationContextEvent(
      taskId,
      workspace,
      query.intent,
      response.packs.length
    ));

    return convertResponseToContext(response);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    throw new Error(`LiBrainian query failed: ${message}`);
  }
}

export function formatLiBrainianContext(context: LiBrainianContext): string {
  if (context.summary === 'No context available') {
    return '';
  }

  const sections: string[] = [];

  sections.push(`## LiBrainian Context (confidence: ${(context.confidence * 100).toFixed(0)}%)`);
  sections.push('');
  sections.push(context.summary);
  sections.push('');

  if (context.scenario) {
    sections.push(`### Scenario Playbook: ${context.scenario.label}`);
    sections.push(`Objective: ${context.scenario.objective}`);
    sections.push('');

    if (context.scenario.outputs.length > 0) {
      sections.push('Outputs:');
      for (const output of context.scenario.outputs) {
        sections.push(`- ${output}`);
      }
      sections.push('');
    }

    if (context.scenario.evidenceFocus.length > 0) {
      sections.push('Evidence Focus:');
      for (const item of context.scenario.evidenceFocus) {
        sections.push(`- ${item}`);
      }
      sections.push('');
    }

    if (context.scenario.checklist.length > 0) {
      sections.push('Checklist:');
      for (const item of context.scenario.checklist) {
        sections.push(`- ${item}`);
      }
      sections.push('');
    }

    if (context.scenario.risks.length > 0) {
      sections.push('Risk Signals:');
      for (const item of context.scenario.risks) {
        sections.push(`- ${item}`);
      }
      sections.push('');
    }
  }

  if (context.keyFacts.length > 0) {
    sections.push('### Key Facts');
    for (const fact of context.keyFacts) {
      sections.push(`- ${fact}`);
    }
    sections.push('');
  }

  if (context.snippets.length > 0) {
    sections.push('### Relevant Code');
    for (const snippet of context.snippets.slice(0, 3)) {
      sections.push(`\`${snippet.file}:${snippet.startLine}-${snippet.endLine}\`:`);
      sections.push('```');
      sections.push(snippet.code.slice(0, 500)); // Limit snippet size
      sections.push('```');
      sections.push('');
    }
  }

  if (context.gotchas.length > 0) {
    sections.push('### Gotchas');
    for (const gotcha of context.gotchas) {
      sections.push(`- ${gotcha}`);
    }
    sections.push('');
  }

  if (context.methodHints.length > 0) {
    sections.push('### Method Hints');
    for (const hint of context.methodHints.slice(0, 5)) {
      sections.push(`- ${hint}`);
    }
    sections.push('');
  }

  if (context.drillDownHints.length > 0) {
    sections.push('### Next Steps');
    for (const hint of context.drillDownHints.slice(0, 5)) {
      sections.push(`- ${hint}`);
    }
    sections.push('');
  }

  if (context.relatedFiles.length > 0) {
    sections.push(`### Related Files: ${context.relatedFiles.slice(0, 5).join(', ')}`);
  }

  return sections.join('\n');
}

export async function recordTaskOutcome(
  workspace: string,
  outcome: {
    packIds: string[];
    success: boolean;
    filesModified?: string[];
    failureReason?: string;
    failureType?: string;
    taskId?: string;
    intent?: string;
  }
): Promise<void> {
  if (isDeterministicMode()) return;
  const librainian = getLiBrainian(workspace);
  if (!librainian) {
    throw new Error('LiBrainian not initialized');
  }

  const storage = (librainian as unknown as { storage?: LiBrainianStorage }).storage;
  if (!storage) {
    throw new Error('LiBrainian storage not available');
  }
  const outcomeSummary: TaskOutcomeSummary = {
    success: outcome.success,
    failureReason: outcome.failureReason,
    failureType: outcome.failureType,
  };

  for (const packId of outcome.packIds) {
    try {
      await recordPackOutcome(storage, packId, outcome.success);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      throw new Error(`Failed to record context pack access for ${packId}: ${message}`);
    }
  }

  const packs = await resolveContextPacks(storage, outcome.packIds);
  const targets = collectConfidenceTargets(outcome.packIds, packs);
  const attributionContext: AgentKnowledgeContext = {
    packIds: outcome.packIds,
    affectedEntities: targets.map((target) => `${target.type}:${target.id}`),
  };
  const attribution = await attributeFailure(storage, outcomeSummary, attributionContext);
  const shouldUpdate = outcome.success || attribution.knowledgeCaused;

  // Import Bayesian updater for better confidence calibration
  const { bayesianDelta } = await import('../knowledge/confidence_updater.js');

  const emergencyState = getEmergencyModeState();
  if (emergencyState.active) {
    recordConfidenceUpdateSkipped(workspace);
  } else if (shouldUpdate) {
    const now = Date.now();
    const sinceIso = new Date(now - 60 * 60 * 1000).toISOString();
    for (const target of targets) {
      if (!(await canUpdateConfidence(storage, target.id, target.type, sinceIso))) continue;

      // Get current confidence for Bayesian update
      const currentConf = await getEntityConfidence(storage, target.id, target.type);
      const delta = bayesianDelta(currentConf, outcome.success);

      await storage.updateConfidence(target.id, target.type, delta, outcome.success ? 'success' : 'failure');
      // Emit confidence_updated event
      void globalEventBus.emit(createConfidenceUpdatedEvent(target.id, target.type, delta, delta));
      if (delta < 0) {
        const drops = await countConfidenceDrops(storage, target.id, target.type, sinceIso);
        if (drops >= 3) {
          logWarning('LiBrainian confidence cascade detected', {
            target: `${target.type}:${target.id}`,
            dropsPerHour: drops,
          });
        }
      }
    }
    if (!outcome.success && attribution.knowledgeCaused && attribution.suspiciousPacks.length > 0) {
      for (const pack of attribution.suspiciousPacks) {
        // Get current pack confidence for Bayesian update with SBFL weighting
        const packConf = await getEntityConfidence(storage, pack.packId, 'context_pack');
        const packDelta = bayesianDelta(packConf, false) * pack.score; // Weight by SBFL score
        if (Math.abs(packDelta) < 0.001) continue;
        if (!(await canUpdateConfidence(storage, pack.packId, 'context_pack', sinceIso))) continue;
        await storage.updateConfidence(pack.packId, 'context_pack', packDelta, 'sbfl_attribution');
        // Emit confidence_updated event for SBFL attribution
        void globalEventBus.emit(createConfidenceUpdatedEvent(pack.packId, 'context_pack', packDelta, packDelta));
      }
    }
  }

  // Trigger re-indexing for modified files
  if (outcome.filesModified && outcome.filesModified.length > 0) {
    await librainian.reindexFiles(outcome.filesModified);
    for (const filePath of outcome.filesModified) {
      void globalEventBus.emit(createFileModifiedEvent(filePath, 'task_outcome'));
    }
  }

  const taskId = outcome.taskId ?? randomUUID();
  const reason = outcome.failureReason ?? outcome.failureType;
  const intent =
    outcome.intent ??
    reason ??
    outcome.filesModified?.slice(0, 3).join(',') ??
    'task_outcome';
  const event = outcome.success
    ? createTaskCompletedEvent(taskId, true, outcome.packIds, reason, intent)
    : createTaskFailedEvent(taskId, outcome.packIds, reason, intent);
  void globalEventBus.emit(event);
  void globalEventBus.emit(createFeedbackReceivedEvent(taskId, outcome.success, outcome.packIds, reason));

  // Emit integration:outcome event when task completes
  void globalEventBus.emit(createIntegrationOutcomeEvent(
    taskId,
    outcome.success,
    outcome.filesModified,
    reason
  ));
}

export async function notifyFileChange(
  workspace: string,
  filePath: string
): Promise<void> {
  if (isDeterministicMode()) return;
  const librainian = getLiBrainian(workspace);
  if (!librainian) {
    throw new Error('LiBrainian not initialized');
  }

  void globalEventBus.emit(createFileModifiedEvent(filePath, 'notify'));
  await invalidateContextPacks(librainian, [filePath]);
  await librainian.reindexFiles([filePath]);
}

export async function notifyFileChanges(
  workspace: string,
  filePaths: string[]
): Promise<void> {
  if (isDeterministicMode()) return;
  const librainian = getLiBrainian(workspace);
  if (!librainian) {
    throw new Error('LiBrainian not initialized');
  }

  for (const filePath of filePaths) {
    void globalEventBus.emit(createFileModifiedEvent(filePath, 'notify'));
  }
  await invalidateContextPacks(librainian, filePaths);
  await librainian.reindexFiles(filePaths);
}

export async function preOrchestrationHook(
  workspace: string,
  options?: {
    onProgress?: (phase: string, progress: number, message: string) => void;
    timeoutMs?: number;
  }
): Promise<void> {
  if (isDeterministicMode()) {
    logInfo('LiBrainian deterministic mode enabled; skipping bootstrap.');
    return;
  }
  const result = await ensureLiBrainianReady(workspace, {
    onProgress: options?.onProgress,
    timeoutMs: options?.timeoutMs,
    throwOnFailure: true,
  });

  if (!result.success) {
    throw new Error(`LiBrainian initialization failed: ${result.error}`);
  }

  // Log what happened
  if (result.wasBootstrapped) {
    logInfo('LiBrainian bootstrap complete', {
      workspace,
      durationMs: result.durationMs,
    });
  } else {
    logInfo('LiBrainian ready (cached)', { workspace });
  }

  const librainian = getLiBrainian(workspace);
  if (librainian) {
    await ensureTemporalGraph(librainian, workspace);
    const storage = (librainian as unknown as { storage?: LiBrainianStorage }).storage;
    const debounceRaw = process.env.LIBRARIAN_LIBRARIAN_WATCH_DEBOUNCE_MS;
    const debounceMs = debounceRaw ? Number.parseInt(debounceRaw, 10) : undefined;
    const resolvedDebounce = typeof debounceMs === 'number' && Number.isFinite(debounceMs) ? debounceMs : undefined;
    startFileWatcher({
      workspaceRoot: workspace,
      librainian,
      storage,
      debounceMs: resolvedDebounce,
    });
  }
}

export async function postOrchestrationHook(
  workspace: string
): Promise<void> {
  stopFileWatcher(workspace);
}

function createEmptyContext(reason: string): LiBrainianContext {
  return { summary: 'No context available', keyFacts: [reason], snippets: [], relatedFiles: [], patterns: [], gotchas: [], confidence: 0, drillDownHints: [], methodHints: [], packIds: [] };
}

function convertResponseToContext(response: LiBrainianResponse): LiBrainianContext {
  const summary = response.packs.length > 0
    ? response.packs[0].summary
    : 'No relevant context found';

  const keyFacts: string[] = [];
  const snippets: LiBrainianContext['snippets'] = [];
  const relatedFiles = new Set<string>();
  const packIds: string[] = [];
  const gotchas: string[] = [];
  const patterns: string[] = [];

  for (const pack of response.packs) {
    packIds.push(pack.packId);
    keyFacts.push(...pack.keyFacts);
    if (pack.packType === 'pattern_context' || pack.packType === 'decision_context' || pack.packType === 'similar_tasks') {
      patterns.push(pack.summary);
    }

    for (const snippet of pack.codeSnippets) {
      snippets.push({
        file: snippet.filePath,
        startLine: snippet.startLine,
        endLine: snippet.endLine,
        code: snippet.content,
      });
    }

    for (const file of pack.relatedFiles) {
      relatedFiles.add(file);
    }
  }
  if (response.coverageGaps?.length) {
    gotchas.push(...response.coverageGaps);
  }
  for (const hint of response.drillDownHints) {
    const lower = hint.toLowerCase();
    if (lower.includes('index') || lower.includes('coverage gap')) {
      gotchas.push(hint);
    }
  }
  const uniqueGotchas = Array.from(new Set(gotchas));
  const uniquePatterns = Array.from(new Set(patterns)).slice(0, 6);
  const scenario = resolveScenarioGuidance({
    intent: response.query.intent,
    taskType: response.query.taskType,
    relatedFiles: Array.from(relatedFiles),
    coverageGaps: response.coverageGaps,
  });

  return {
    intent: response.query.intent,
    taskType: response.query.taskType,
    summary,
    keyFacts: keyFacts.slice(0, 10), // Limit facts
    snippets: snippets.slice(0, 5),   // Limit snippets
    relatedFiles: Array.from(relatedFiles).slice(0, 10),
    patterns: uniquePatterns,
    gotchas: uniqueGotchas.slice(0, 5),
    confidence: response.totalConfidence,
    drillDownHints: response.drillDownHints,
    methodHints: response.methodHints ?? [],
    packIds,
    scenario,
  };
}

async function invalidateContextPacks(librainian: LiBrainian, filePaths: string[]): Promise<void> {
  const storage = (librainian as unknown as { storage?: LiBrainianStorage }).storage;
  if (!storage) return;
  for (const filePath of filePaths) {
    const invalidated = await storage.invalidateContextPacks(filePath);
    if (invalidated > 0) {
      void globalEventBus.emit(createContextPacksInvalidatedEvent(filePath, invalidated));
    }
  }
}

async function resolveContextPacks(
  storage: LiBrainianStorage | undefined,
  packIds: string[]
): Promise<ContextPack[]> {
  if (!storage || typeof storage.getContextPack !== 'function') return emptyArray<ContextPack>();
  const packs: ContextPack[] = [];
  for (const packId of packIds) {
    try { const pack = await storage.getContextPack(packId); if (pack) packs.push(pack); } catch { /* ignore */ }
  }
  return packs;
}

type ConfidenceTarget = { id: string; type: 'function' | 'module' | 'context_pack' };

function collectConfidenceTargets(packIds: string[], packs: ContextPack[]): ConfidenceTarget[] {
  const targets = new Map<string, ConfidenceTarget>();
  for (const packId of packIds) targets.set(`context_pack:${packId}`, { id: packId, type: 'context_pack' });
  for (const pack of packs) { const type = inferEntityType(pack.packType); if (type) targets.set(`${type}:${pack.targetId}`, { id: pack.targetId, type }); }
  return Array.from(targets.values());
}

function inferEntityType(packType: string): ConfidenceTarget['type'] | null {
  const normalized = packType.toLowerCase();
  if (normalized.includes('function')) return 'function';
  if (normalized.includes('module') || normalized.includes('directory')) return 'module';
  return noResult();
}

async function canUpdateConfidence(
  storage: LiBrainianStorage,
  entityId: string,
  entityType: ConfidenceTarget['type'],
  sinceIso: string
): Promise<boolean> {
  const counter = storage as LiBrainianStorage & {
    countConfidenceUpdates?: (entityId: string, entityType: ConfidenceTarget['type'], sinceIso: string, deltaFilter?: 'any' | 'negative' | 'positive') => Promise<number>;
  };
  if (!counter.countConfidenceUpdates) return true;
  return (await counter.countConfidenceUpdates(entityId, entityType, sinceIso, 'any')) < 3;
}

async function countConfidenceDrops(
  storage: LiBrainianStorage,
  entityId: string,
  entityType: ConfidenceTarget['type'],
  sinceIso: string
): Promise<number> {
  const counter = storage as LiBrainianStorage & {
    countConfidenceUpdates?: (entityId: string, entityType: ConfidenceTarget['type'], sinceIso: string, deltaFilter?: 'any' | 'negative' | 'positive') => Promise<number>;
  };
  if (!counter.countConfidenceUpdates) return 0;
  return counter.countConfidenceUpdates(entityId, entityType, sinceIso, 'negative');
}

async function getEntityConfidence(
  storage: LiBrainianStorage,
  entityId: string,
  entityType: ConfidenceTarget['type']
): Promise<number> {
  // Get current confidence for Bayesian updates
  const DEFAULT_CONFIDENCE = 0.5;

  if (entityType === 'context_pack') {
    const pack = await storage.getContextPack(entityId);
    return pack?.confidence ?? DEFAULT_CONFIDENCE;
  }

  if (entityType === 'function') {
    const fn = await storage.getFunction(entityId);
    return fn?.confidence ?? DEFAULT_CONFIDENCE;
  }

  if (entityType === 'module') {
    const mod = await storage.getModule(entityId);
    return mod?.confidence ?? DEFAULT_CONFIDENCE;
  }

  return DEFAULT_CONFIDENCE;
}

async function ensureTemporalGraph(librainian: LiBrainian, workspace: string): Promise<void> {
  const storage = (librainian as unknown as {
    storage?: LiBrainianStorage & {
      getCochangeEdgeCount?: () => Promise<number>;
      storeCochangeEdges?: (edges: TemporalGraph['edges'], computedAt?: string) => Promise<void>;
    };
  }).storage;
  if (!storage?.getCochangeEdgeCount || !storage.storeCochangeEdges) return;
  try {
    if ((await storage.getCochangeEdgeCount()) > 0) return;
    const graph = await buildTemporalGraph(workspace);
    if (graph.edges.length) await storage.storeCochangeEdges(graph.edges);
  } catch { /* ignore */ }
}

export {
  ensureLiBrainianReady,
  isLiBrainianReady,
  getLiBrainian,
} from './first_run_gate.js';
