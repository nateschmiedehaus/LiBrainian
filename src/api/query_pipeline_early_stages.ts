import type {
  ContextPack,
  LibrarianQuery,
  StageIssueSeverity,
  StageName,
} from '../types.js';
import type { LibrarianStorage } from '../storage/types.js';
import {
  runAdequacyScan,
  type AdequacyReport,
} from './difficulty_detectors.js';
import type { StageTracker } from './query_stage_reporting.js';

export type RecordCoverageGap = (
  stage: StageName,
  message: string,
  severity?: StageIssueSeverity,
  remediation?: string,
) => void;

export function runAdequacyScanStage(options: {
  query: LibrarianQuery;
  workspaceRoot: string;
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  runAdequacyScanFn?: typeof runAdequacyScan;
}): AdequacyReport | null {
  const {
    query,
    workspaceRoot,
    stageTracker,
    recordCoverageGap,
    runAdequacyScanFn,
  } = options;
  const shouldRun = Boolean(query.intent && query.intent.trim());
  const stage = stageTracker.start('adequacy_scan', shouldRun ? 1 : 0);
  if (!shouldRun) {
    stageTracker.finish(stage, { outputCount: 0, filteredCount: 0, status: 'skipped' });
    return null;
  }
  try {
    const scan = (runAdequacyScanFn ?? runAdequacyScan)({
      intent: query.intent,
      taskType: query.taskType,
      workspaceRoot,
    });
    if (scan.missingEvidence.length > 0) {
      const missing = scan.missingEvidence.map((req) => req.description).join('; ');
      const remediation = scan.evidenceCommands.length
        ? `Collect evidence: ${scan.evidenceCommands.join(' | ')}`
        : undefined;
      recordCoverageGap(
        'adequacy_scan',
        `Missing adequacy evidence: ${missing}`,
        scan.blocking ? 'significant' : 'moderate',
        remediation,
      );
    }
    for (const difficulty of scan.difficulties) {
      const severity: StageIssueSeverity =
        difficulty.severity === 'extreme' || difficulty.severity === 'hard'
          ? 'significant'
          : difficulty.severity === 'medium'
            ? 'moderate'
            : 'minor';
      stageTracker.issue('adequacy_scan', {
        message: `Difficulty detected: ${difficulty.name}`,
        severity,
        remediation: difficulty.evidenceCommands.length
          ? `Evidence commands: ${difficulty.evidenceCommands.join(' | ')}`
          : undefined,
      });
    }
    const status = scan.missingEvidence.length > 0
      ? (scan.blocking ? 'failed' : 'partial')
      : 'success';
    stageTracker.finish(stage, { outputCount: 1, filteredCount: 0, status });
    return scan;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordCoverageGap('adequacy_scan', `Adequacy scan failed: ${message}`, 'moderate');
    stageTracker.finish(stage, { outputCount: 0, filteredCount: 0, status: 'failed' });
    return null;
  }
}

export async function runDirectPacksStage(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  workspaceRoot: string;
  stageTracker: StageTracker;
  explanationParts: string[];
  collectDirectPacksFn: (
    storage: LibrarianStorage,
    query: LibrarianQuery,
    workspaceRoot: string,
  ) => Promise<ContextPack[]>;
}): Promise<{ directPacks: ContextPack[]; cacheHit: boolean }> {
  const { storage, query, workspaceRoot, stageTracker, explanationParts, collectDirectPacksFn } = options;
  const directScopeHints = (query.affectedFiles?.length ?? 0) + (query.filter ? 1 : 0);
  const directStage = stageTracker.start('direct_packs', directScopeHints);
  const directPacks = await collectDirectPacksFn(storage, query, workspaceRoot);
  stageTracker.finish(directStage, { outputCount: directPacks.length, filteredCount: 0 });
  const cacheHit = directPacks.length > 0;
  if (cacheHit) {
    explanationParts.push(`Matched ${directPacks.length} direct packs from query anchors.`);
  }
  return { directPacks, cacheHit };
}
