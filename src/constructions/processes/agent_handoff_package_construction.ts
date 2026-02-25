import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { computeChangeImpactReport } from '../../api/change_impact_tool.js';
import { getEffectiveConfidence, isConfidenceValue } from '../../epistemics/confidence.js';
import type {
  ClaimEvidence,
  ContradictionEvidence,
  EvidenceEntry,
  HumanOverrideEvidence,
  IEvidenceLedger,
  SessionId,
  ToolCallEvidence,
} from '../../epistemics/evidence_ledger.js';
import { SqliteEvidenceLedger } from '../../epistemics/evidence_ledger.js';
import { sha256Hex } from '../../spine/hashes.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { ConstructionError } from '../base/construction_base.js';
import type { Construction, Context } from '../types.js';
import { ok } from '../types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_MIN_CLAIM_CONFIDENCE = 0.7;
const DEFAULT_BRIEFING_TOKEN_BUDGET = 3000;
const DEFAULT_HANDOFF_DIR = path.join('.librainian', 'handoffs');
const MCP_SESSION_EPISODES_STATE_KEY = 'librarian.mcp.session_episodes.v1';

const READ_TOOLS = new Set<string>([
  'read_file',
  'query',
  'find_symbol',
  'get_context_pack_bundle',
  'get_change_impact',
  'blast_radius',
]);

const WRITE_TOOLS = new Set<string>([
  'write_file',
  'edit_file',
  'apply_patch',
  'append_claim',
]);

export interface AgentHandoffPackageInput {
  readonly sessionId: string;
  readonly continuationFocus?: string;
  readonly includeRejectedAlternatives?: boolean;
  readonly minClaimConfidence?: number;
  readonly workspaceRoot?: string;
}

export interface AgentHandoffClaim {
  readonly claim: string;
  readonly confidence: number;
  readonly evidenceRefs: string[];
}

export interface OpenConflict {
  readonly conflictId: string;
  readonly claim1: {
    readonly description: string;
    readonly evidenceRefs: string[];
    readonly source: string;
  };
  readonly claim2: {
    readonly description: string;
    readonly evidenceRefs: string[];
    readonly source: string;
  };
  readonly whyUnresolvable: string;
  readonly suggestedResolutionApproach: string;
}

export interface InProgressChange {
  readonly functionId: string;
  readonly filePath: string;
  readonly changeDescription: string;
  readonly currentBlastRadius: {
    readonly directCallers: number;
    readonly transitiveCallers: number;
  };
  readonly incompleteBecause: string;
  readonly nextSteps: string[];
}

export interface HandoffInvariant {
  readonly invariant: string;
  readonly affectedFunctions: string[];
}

export interface HandoffRejectedAlternative {
  readonly alternative: string;
  readonly rejectionReason: string;
}

export interface SessionTopologySnapshot {
  readonly filesRead: string[];
  readonly filesModified: string[];
  readonly functionsAnalyzed: string[];
}

export interface AgentHandoffPackageOutput {
  readonly kind: 'AgentHandoffPackageResult.v1';
  readonly handoffHash: string;
  readonly briefingForNextAgent: string;
  readonly activeClaims: AgentHandoffClaim[];
  readonly openConflicts: OpenConflict[];
  readonly inProgressChanges: InProgressChange[];
  readonly establishedInvariants: HandoffInvariant[];
  readonly rejectedAlternatives: HandoffRejectedAlternative[];
  readonly sessionTopology: SessionTopologySnapshot;
  readonly briefingTokenEstimate: number;
  readonly outputPath: string;
}

interface AuditRecord {
  readonly [key: string]: unknown;
}

export interface AgentHandoffPackageOptions {
  readonly workspaceRoot?: string;
  readonly storage?: LibrarianStorage | null;
  readonly handoffDirRelative?: string;
  readonly writePackageFile?: boolean;
  readonly readEvidenceEntries?: (workspaceRoot: string, sessionId: string) => Promise<EvidenceEntry[]>;
  readonly readAuditRecords?: (workspaceRoot: string) => Promise<AuditRecord[]>;
  readonly listChangedFiles?: (workspaceRoot: string) => Promise<string[]>;
  readonly computeBlastRadius?: (
    workspaceRoot: string,
    targetPath: string,
    storage?: LibrarianStorage,
  ) => Promise<{ directCallers: number; transitiveCallers: number }>;
}

interface ParsedClaimRecord {
  readonly id: string;
  readonly claim: string;
  readonly confidence: number;
  readonly evidenceRefs: string[];
  readonly subjectType?: string;
  readonly subjectIdentifier?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toPosix(value: string): string {
  return value.replaceAll('\\', '/');
}

function normalizePathValue(raw: string): string {
  return toPosix(raw.trim().replace(/^\.\//u, ''));
}

function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (normalized.length === 0) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => typeof entry === 'string');
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function resolveClaimConfidence(payload: Record<string, unknown>, entry: EvidenceEntry): number {
  if (isConfidenceValue(payload.confidence)) {
    return clampConfidence(getEffectiveConfidence(payload.confidence));
  }
  if (isConfidenceValue(entry.confidence)) {
    return clampConfidence(getEffectiveConfidence(entry.confidence));
  }
  if (typeof payload.confidence === 'number') {
    return clampConfidence(payload.confidence);
  }
  return 0;
}

function stableStringify(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry, seen)).join(',')}]`;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '"[Circular]"';
    }
    seen.add(value);
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
    const serialized = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`);
    return `{${serialized.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function looksInvariant(claim: string): boolean {
  return /\b(must|always|never|cannot|invariant|unique)\b/iu.test(claim);
}

function extractPathLikeStrings(value: unknown, keyHint = '', depth = 0, out: Set<string> = new Set<string>()): Set<string> {
  if (depth > 5) return out;
  if (typeof value === 'string') {
    const normalized = normalizePathValue(value);
    if (normalized.length === 0) return out;
    const pathish = /(path|file|target|scope)/iu.test(keyHint)
      || normalized.includes('/')
      || normalized.includes('\\')
      || /\.[a-z0-9]{1,6}$/iu.test(normalized);
    if (pathish) {
      out.add(normalized);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      extractPathLikeStrings(entry, keyHint, depth + 1, out);
    }
    return out;
  }
  if (!isRecord(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    extractPathLikeStrings(entry, key, depth + 1, out);
  }
  return out;
}

function inferResolutionAdvice(severity: string | undefined): string {
  if (severity === 'blocking') {
    return 'Pause implementation and run targeted verification to select one claim as canonical.';
  }
  if (severity === 'significant') {
    return 'Collect discriminating evidence and resolve the higher-confidence claim before merging.';
  }
  return 'Track both interpretations and resolve with focused tests before finalizing.';
}

function parseClaimFromAudit(record: AuditRecord): ParsedClaimRecord | null {
  const claim = asNonEmptyString(record.claim);
  if (!claim) return null;
  const claimId = asNonEmptyString(record.claim_id) ?? `audit_${sha256Hex(claim).slice(0, 12)}`;
  const confidence = typeof record.confidence === 'number' ? clampConfidence(record.confidence) : 0;
  const evidenceRefs = asStringArray(record.evidence);
  return {
    id: claimId,
    claim,
    confidence,
    evidenceRefs,
  };
}

async function readEvidenceEntriesDefault(workspaceRoot: string, sessionId: string): Promise<EvidenceEntry[]> {
  const ledgerPath = path.join(workspaceRoot, '.librarian', 'evidence_ledger.db');
  try {
    await fs.access(ledgerPath);
  } catch {
    return [];
  }

  let ledger: IEvidenceLedger | null = null;
  try {
    const sqliteLedger = new SqliteEvidenceLedger(ledgerPath);
    ledger = sqliteLedger;
    await sqliteLedger.initialize();
    return await sqliteLedger.getSessionEntries(sessionId as SessionId);
  } catch {
    return [];
  } finally {
    if (ledger && 'close' in ledger && typeof (ledger as SqliteEvidenceLedger).close === 'function') {
      await (ledger as SqliteEvidenceLedger).close().catch(() => undefined);
    }
  }
}

async function readAuditRecordsDefault(workspaceRoot: string): Promise<AuditRecord[]> {
  const logPath = path.join(workspaceRoot, '.librarian', 'audit-log.jsonl');
  let content = '';
  try {
    content = await fs.readFile(logPath, 'utf8');
  } catch {
    return [];
  }
  const records: AuditRecord[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed)) {
        records.push(parsed);
      }
    } catch {
      // Ignore malformed audit lines.
    }
  }
  return records;
}

async function listChangedFilesDefault(workspaceRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: workspaceRoot });
    const files = stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length >= 4)
      .map((line) => {
        const candidate = line.slice(3).trim();
        if (candidate.includes('->')) {
          const parts = candidate.split('->');
          return normalizePathValue(parts[parts.length - 1] ?? candidate);
        }
        return normalizePathValue(candidate);
      })
      .filter((file) => file.length > 0);
    return Array.from(new Set(files)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function computeBlastRadiusDefault(
  _workspaceRoot: string,
  targetPath: string,
  storage?: LibrarianStorage,
): Promise<{ directCallers: number; transitiveCallers: number }> {
  if (!storage) {
    return { directCallers: 0, transitiveCallers: 0 };
  }
  const report = await computeChangeImpactReport(storage, {
    target: targetPath,
    depth: 3,
    maxResults: 200,
    changeType: 'modify',
  });
  if (!report.success) {
    return { directCallers: 0, transitiveCallers: 0 };
  }
  return {
    directCallers: Math.max(0, report.summary.directCount),
    transitiveCallers: Math.max(0, report.summary.transitiveCount),
  };
}

function parseClaimsFromEntries(entries: EvidenceEntry[], minClaimConfidence: number): ParsedClaimRecord[] {
  const parsed: ParsedClaimRecord[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'claim') continue;
    if (!isRecord(entry.payload)) continue;
    const payload = entry.payload as unknown as ClaimEvidence;
    const claim = asNonEmptyString(payload.claim);
    if (!claim) continue;
    const confidence = resolveClaimConfidence(entry.payload as Record<string, unknown>, entry);
    if (confidence < minClaimConfidence) continue;
    parsed.push({
      id: String(entry.id),
      claim,
      confidence,
      evidenceRefs: asStringArray(payload.supportingEvidence),
      subjectType: isRecord(payload.subject) ? asNonEmptyString(payload.subject.type) : undefined,
      subjectIdentifier: isRecord(payload.subject) ? asNonEmptyString(payload.subject.identifier) : undefined,
    });
  }

  const dedupe = new Map<string, ParsedClaimRecord>();
  for (const entry of parsed) {
    const key = entry.claim.toLowerCase();
    const prior = dedupe.get(key);
    if (!prior || entry.confidence > prior.confidence) {
      dedupe.set(key, entry);
    }
  }
  return Array.from(dedupe.values()).sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.claim.localeCompare(b.claim);
  });
}

function parseConflicts(entries: EvidenceEntry[], claimsById: Map<string, ParsedClaimRecord>): OpenConflict[] {
  const conflicts: OpenConflict[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'contradiction') continue;
    if (!isRecord(entry.payload)) continue;
    const payload = entry.payload as unknown as ContradictionEvidence;
    const claimAId = asNonEmptyString(payload.claimA);
    const claimBId = asNonEmptyString(payload.claimB);
    if (!claimAId || !claimBId) continue;
    const claimA = claimsById.get(claimAId);
    const claimB = claimsById.get(claimBId);
    const explanation = asNonEmptyString(payload.explanation) ?? 'Contradiction detected with missing explanation.';
    const severity = asNonEmptyString(payload.severity);
    const conflictSeed = `${claimAId}:${claimBId}:${explanation}`;
    conflicts.push({
      conflictId: `conflict_${sha256Hex(conflictSeed).slice(0, 16)}`,
      claim1: {
        description: claimA?.claim ?? `Claim ${claimAId}`,
        evidenceRefs: claimA ? [...claimA.evidenceRefs] : [claimAId],
        source: 'evidence_ledger',
      },
      claim2: {
        description: claimB?.claim ?? `Claim ${claimBId}`,
        evidenceRefs: claimB ? [...claimB.evidenceRefs] : [claimBId],
        source: 'evidence_ledger',
      },
      whyUnresolvable: explanation,
      suggestedResolutionApproach: inferResolutionAdvice(severity),
    });
  }
  return conflicts.sort((a, b) => a.conflictId.localeCompare(b.conflictId));
}

function parseRejectedAlternatives(
  entries: EvidenceEntry[],
  auditRecords: AuditRecord[],
  includeRejectedAlternatives: boolean,
): HandoffRejectedAlternative[] {
  if (!includeRejectedAlternatives) return [];
  const alternatives: HandoffRejectedAlternative[] = [];

  for (const entry of entries) {
    if (entry.kind === 'human_override' && isRecord(entry.payload)) {
      const payload = entry.payload as unknown as HumanOverrideEvidence;
      const alternative = asNonEmptyString(payload.request?.question)
        ?? asNonEmptyString(payload.decision);
      const rejectionReason = asNonEmptyString(payload.rationale)
        ?? asNonEmptyString(payload.decision)
        ?? 'Human override recorded.';
      if (alternative) {
        alternatives.push({ alternative, rejectionReason });
      }
      continue;
    }

    if (entry.kind === 'escalation_request' && isRecord(entry.payload)) {
      const payload = entry.payload as Record<string, unknown>;
      const request = isRecord(payload.request) ? payload.request : {};
      const alternative = asNonEmptyString(request.question) ?? asNonEmptyString(request.context);
      if (alternative) {
        alternatives.push({
          alternative,
          rejectionReason: 'Escalated for human adjudication before acceptance.',
        });
      }
    }
  }

  for (const record of auditRecords) {
    const reviewId = asNonEmptyString(record.review_id);
    if (!reviewId) continue;
    const alternative = asNonEmptyString(record.proposed_action) ?? asNonEmptyString(record.reason);
    const rejectionReason = asNonEmptyString(record.outcome) ?? 'Marked as pending human review.';
    if (alternative) {
      alternatives.push({ alternative, rejectionReason });
    }
  }

  const dedupe = new Map<string, HandoffRejectedAlternative>();
  for (const entry of alternatives) {
    const key = `${entry.alternative.toLowerCase()}::${entry.rejectionReason.toLowerCase()}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, entry);
    }
  }
  return Array.from(dedupe.values()).sort((a, b) => a.alternative.localeCompare(b.alternative));
}

function parseTopologyFromEntries(entries: EvidenceEntry[]): SessionTopologySnapshot {
  const filesRead = new Set<string>();
  const filesModified = new Set<string>();
  const functionsAnalyzed = new Set<string>();

  for (const entry of entries) {
    if (entry.kind === 'claim' && isRecord(entry.payload)) {
      const payload = entry.payload as unknown as ClaimEvidence;
      if (isRecord(payload.subject)) {
        const subjectType = asNonEmptyString(payload.subject.type);
        const subjectIdentifier = asNonEmptyString(payload.subject.identifier);
        if (subjectType === 'function' && subjectIdentifier) {
          functionsAnalyzed.add(subjectIdentifier);
        }
      }
      continue;
    }

    if (entry.kind !== 'tool_call' || !isRecord(entry.payload)) continue;
    const payload = entry.payload as unknown as ToolCallEvidence;
    const toolName = asNonEmptyString(payload.toolName) ?? '';
    const pathCandidates = extractPathLikeStrings(payload.arguments);
    for (const item of extractPathLikeStrings(payload.result)) {
      pathCandidates.add(item);
    }
    if (READ_TOOLS.has(toolName)) {
      for (const filePath of pathCandidates) filesRead.add(filePath);
    }
    if (WRITE_TOOLS.has(toolName)) {
      for (const filePath of pathCandidates) filesModified.add(filePath);
    }
  }

  return {
    filesRead: Array.from(filesRead).sort((a, b) => a.localeCompare(b)),
    filesModified: Array.from(filesModified).sort((a, b) => a.localeCompare(b)),
    functionsAnalyzed: Array.from(functionsAnalyzed).sort((a, b) => a.localeCompare(b)),
  };
}

async function readSessionEpisodeFiles(
  storage: LibrarianStorage | undefined,
  sessionId: string,
  workspaceRoot: string,
): Promise<string[]> {
  if (!storage) return [];
  try {
    const raw = await storage.getState(MCP_SESSION_EPISODES_STATE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) return [];

    const files = new Set<string>();
    for (const item of parsed.items) {
      if (!isRecord(item)) continue;
      const recordSessionId = asNonEmptyString(item.sessionId);
      if (recordSessionId !== sessionId) continue;
      const workspace = asNonEmptyString(item.workspace);
      if (!workspace || path.resolve(workspace) !== path.resolve(workspaceRoot)) continue;
      for (const touched of asStringArray(item.touchedFiles)) {
        files.add(normalizePathValue(touched));
      }
    }
    return Array.from(files).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function mergeTopology(base: SessionTopologySnapshot, sessionEpisodeFiles: string[]): SessionTopologySnapshot {
  const filesRead = new Set<string>(base.filesRead);
  for (const filePath of sessionEpisodeFiles) {
    filesRead.add(filePath);
  }
  return {
    filesRead: Array.from(filesRead).sort((a, b) => a.localeCompare(b)),
    filesModified: [...base.filesModified],
    functionsAnalyzed: [...base.functionsAnalyzed],
  };
}

function deriveInvariants(claims: ParsedClaimRecord[]): HandoffInvariant[] {
  const invariants = claims
    .filter((entry) => looksInvariant(entry.claim))
    .map((entry) => ({
      invariant: entry.claim,
      affectedFunctions: entry.subjectType === 'function' && entry.subjectIdentifier
        ? [entry.subjectIdentifier]
        : [],
    }));

  const dedupe = new Map<string, HandoffInvariant>();
  for (const entry of invariants) {
    const key = entry.invariant.toLowerCase();
    if (!dedupe.has(key)) {
      dedupe.set(key, entry);
    }
  }
  return Array.from(dedupe.values()).sort((a, b) => a.invariant.localeCompare(b.invariant));
}

function buildInProgressChanges(
  changedFiles: string[],
  conflicts: OpenConflict[],
  blastRadiusByFile: Map<string, { directCallers: number; transitiveCallers: number }>,
): InProgressChange[] {
  return changedFiles.map((filePath) => {
    const conflictCount = conflicts.filter((conflict) =>
      conflict.claim1.description.includes(filePath) || conflict.claim2.description.includes(filePath))
      .length;
    const blast = blastRadiusByFile.get(filePath) ?? { directCallers: 0, transitiveCallers: 0 };
    const incompleteBecause = conflictCount > 0
      ? `Session ended with ${conflictCount} unresolved conflict(s) referencing this change path.`
      : 'Change is uncommitted and lacks completion evidence in this session.';
    const nextSteps = conflictCount > 0
      ? [
        'Resolve linked open conflicts before changing interfaces further.',
        'Validate blast radius impact with focused tests on direct callers.',
        'Commit only after invariant checks pass.',
      ]
      : [
        'Validate blast radius impact with focused tests on direct callers.',
        'Confirm no contradiction entries remain for this path.',
        'Commit with explicit invariant coverage notes.',
      ];
    return {
      functionId: `${filePath}#pending`,
      filePath,
      changeDescription: 'Workspace has uncommitted modifications requiring handoff continuity.',
      currentBlastRadius: blast,
      incompleteBecause,
      nextSteps,
    };
  });
}

function renderBriefing(
  sessionId: string,
  continuationFocus: string | undefined,
  activeClaims: AgentHandoffClaim[],
  openConflicts: OpenConflict[],
  inProgressChanges: InProgressChange[],
  establishedInvariants: HandoffInvariant[],
  rejectedAlternatives: HandoffRejectedAlternative[],
  sessionTopology: SessionTopologySnapshot,
  limits: {
    claims: number;
    conflicts: number;
    changes: number;
    invariants: number;
    rejected: number;
    files: number;
    functions: number;
  },
): string {
  const lines: string[] = [];
  lines.push(`Session handoff: ${sessionId}`);
  if (continuationFocus) {
    lines.push(`Continuation focus: ${continuationFocus}`);
  }

  lines.push('');
  lines.push('Active claims:');
  for (const claim of activeClaims.slice(0, limits.claims)) {
    lines.push(`- (${claim.confidence.toFixed(2)}) ${claim.claim}`);
  }
  if (activeClaims.length === 0) {
    lines.push('- No high-confidence claims captured.');
  }

  lines.push('');
  lines.push('Open conflicts:');
  for (const conflict of openConflicts.slice(0, limits.conflicts)) {
    lines.push(`- ${conflict.claim1.description} <-> ${conflict.claim2.description}`);
    lines.push(`  Why unresolved: ${conflict.whyUnresolvable}`);
  }
  if (openConflicts.length === 0) {
    lines.push('- No unresolved contradiction entries.');
  }

  lines.push('');
  lines.push('In-progress changes:');
  for (const change of inProgressChanges.slice(0, limits.changes)) {
    lines.push(
      `- ${change.filePath} (direct callers: ${change.currentBlastRadius.directCallers}, transitive callers: ${change.currentBlastRadius.transitiveCallers})`,
    );
    lines.push(`  Blocker: ${change.incompleteBecause}`);
  }
  if (inProgressChanges.length === 0) {
    lines.push('- No uncommitted changes detected.');
  }

  lines.push('');
  lines.push('Established invariants:');
  for (const invariant of establishedInvariants.slice(0, limits.invariants)) {
    lines.push(`- ${invariant.invariant}`);
  }
  if (establishedInvariants.length === 0) {
    lines.push('- No explicit invariants detected in session evidence.');
  }

  if (rejectedAlternatives.length > 0) {
    lines.push('');
    lines.push('Rejected alternatives:');
    for (const rejected of rejectedAlternatives.slice(0, limits.rejected)) {
      lines.push(`- ${rejected.alternative} (reason: ${rejected.rejectionReason})`);
    }
  }

  lines.push('');
  lines.push('Session topology snapshot:');
  lines.push(
    `- filesRead: ${sessionTopology.filesRead.slice(0, limits.files).join(', ') || 'none'}`,
  );
  lines.push(
    `- filesModified: ${sessionTopology.filesModified.slice(0, limits.files).join(', ') || 'none'}`,
  );
  lines.push(
    `- functionsAnalyzed: ${sessionTopology.functionsAnalyzed.slice(0, limits.functions).join(', ') || 'none'}`,
  );

  return lines.join('\n');
}

function trimBriefingToBudget(
  sessionId: string,
  continuationFocus: string | undefined,
  activeClaims: AgentHandoffClaim[],
  openConflicts: OpenConflict[],
  inProgressChanges: InProgressChange[],
  establishedInvariants: HandoffInvariant[],
  rejectedAlternatives: HandoffRejectedAlternative[],
  sessionTopology: SessionTopologySnapshot,
  maxTokens: number,
): { text: string; tokens: number } {
  const limits = {
    claims: Math.min(16, activeClaims.length),
    conflicts: Math.min(10, openConflicts.length),
    changes: Math.min(10, inProgressChanges.length),
    invariants: Math.min(14, establishedInvariants.length),
    rejected: Math.min(8, rejectedAlternatives.length),
    files: 12,
    functions: 12,
  };

  const minimum = {
    claims: Math.min(1, activeClaims.length),
    conflicts: 0,
    changes: 0,
    invariants: 0,
    rejected: 0,
    files: 3,
    functions: 3,
  };

  let text = '';
  let tokens = 0;
  for (let pass = 0; pass < 160; pass += 1) {
    text = renderBriefing(
      sessionId,
      continuationFocus,
      activeClaims,
      openConflicts,
      inProgressChanges,
      establishedInvariants,
      rejectedAlternatives,
      sessionTopology,
      limits,
    );
    tokens = estimateTokens(text);
    if (tokens <= maxTokens) {
      break;
    }
    if (limits.rejected > minimum.rejected) {
      limits.rejected -= 1;
      continue;
    }
    if (limits.changes > minimum.changes) {
      limits.changes -= 1;
      continue;
    }
    if (limits.conflicts > minimum.conflicts) {
      limits.conflicts -= 1;
      continue;
    }
    if (limits.invariants > minimum.invariants) {
      limits.invariants -= 1;
      continue;
    }
    if (limits.claims > minimum.claims) {
      limits.claims -= 1;
      continue;
    }
    if (limits.files > minimum.files) {
      limits.files -= 1;
      continue;
    }
    if (limits.functions > minimum.functions) {
      limits.functions -= 1;
      continue;
    }
    const hardTrimmed = text.slice(0, Math.max(0, maxTokens * 4 - 3)).trimEnd();
    text = `${hardTrimmed}...`;
    tokens = estimateTokens(text);
    break;
  }
  return { text, tokens };
}

function resolveStorageFromContext(
  context: Context<unknown> | undefined,
  optionsStorage?: LibrarianStorage | null,
): LibrarianStorage | undefined {
  if (optionsStorage) return optionsStorage;
  if (!context || !isRecord(context.deps)) return undefined;
  const librarian = context.deps.librarian;
  if (!isRecord(librarian)) return undefined;
  const getStorage = librarian.getStorage;
  if (typeof getStorage !== 'function') return undefined;
  const storage = getStorage.call(librarian);
  if (!storage || !isRecord(storage)) return undefined;
  if (typeof storage.getModules !== 'function') return undefined;
  if (typeof storage.getKnowledgeEdges !== 'function') return undefined;
  return storage as unknown as LibrarianStorage;
}

function resolveWorkspaceRoot(input: AgentHandoffPackageInput, options: AgentHandoffPackageOptions): string {
  const candidate = asNonEmptyString(input.workspaceRoot) ?? asNonEmptyString(options.workspaceRoot) ?? process.cwd();
  return path.resolve(candidate);
}

function normalizeSessionId(sessionId: string): string {
  return sessionId.trim().replace(/[^a-zA-Z0-9._-]/gu, '_');
}

export function createAgentHandoffPackageConstruction(
  options: AgentHandoffPackageOptions = {},
): Construction<AgentHandoffPackageInput, AgentHandoffPackageOutput, ConstructionError, unknown> {
  const readEvidenceEntries = options.readEvidenceEntries ?? readEvidenceEntriesDefault;
  const readAuditRecords = options.readAuditRecords ?? readAuditRecordsDefault;
  const listChangedFiles = options.listChangedFiles ?? listChangedFilesDefault;
  const computeBlastRadius = options.computeBlastRadius ?? computeBlastRadiusDefault;
  const writePackageFile = options.writePackageFile ?? true;
  const handoffDirRelative = options.handoffDirRelative ?? DEFAULT_HANDOFF_DIR;

  return {
    id: 'agent-handoff-package',
    name: 'Agent Handoff Package',
    description: 'Builds a machine-readable session handoff package with claims, conflicts, blast radius, and topology.',
    async execute(input: AgentHandoffPackageInput, context?: Context<unknown>) {
      const sessionId = asNonEmptyString(input.sessionId);
      if (!sessionId) {
        return {
          ok: false,
          error: new ConstructionError('sessionId must be a non-empty string.', 'agent-handoff-package'),
        };
      }

      const workspaceRoot = resolveWorkspaceRoot(input, options);
      const storage = resolveStorageFromContext(context, options.storage);
      const minClaimConfidence = clampConfidence(input.minClaimConfidence ?? DEFAULT_MIN_CLAIM_CONFIDENCE);
      const includeRejectedAlternatives = input.includeRejectedAlternatives ?? false;
      const continuationFocus = asNonEmptyString(input.continuationFocus);
      const tokenBudget = DEFAULT_BRIEFING_TOKEN_BUDGET;

      const [entries, auditRecords, rawChangedFiles, episodeFiles] = await Promise.all([
        readEvidenceEntries(workspaceRoot, sessionId),
        readAuditRecords(workspaceRoot),
        listChangedFiles(workspaceRoot),
        readSessionEpisodeFiles(storage, sessionId, workspaceRoot),
      ]);
      const changedFiles = Array.from(
        new Set(
          rawChangedFiles
            .map((filePath) => normalizePathValue(filePath))
            .filter((filePath) => filePath.length > 0),
        ),
      ).sort((a, b) => a.localeCompare(b));

      const filteredAuditRecords = auditRecords.filter((record) => {
        const sessionFromSnake = asNonEmptyString(record.session_id);
        const sessionFromCamel = asNonEmptyString(record.sessionId);
        const inferredSession = sessionFromSnake ?? sessionFromCamel;
        if (!inferredSession) return false;
        return inferredSession === sessionId;
      });

      const claimRecords = parseClaimsFromEntries(entries, minClaimConfidence);
      for (const record of filteredAuditRecords) {
        if ((asNonEmptyString(record.event) ?? '') !== 'append_claim') continue;
        const parsed = parseClaimFromAudit(record);
        if (!parsed) continue;
        if (parsed.confidence < minClaimConfidence) continue;
        claimRecords.push(parsed);
      }

      const dedupedClaims = new Map<string, ParsedClaimRecord>();
      for (const claim of claimRecords) {
        const key = claim.claim.toLowerCase();
        const prior = dedupedClaims.get(key);
        if (!prior || claim.confidence > prior.confidence) {
          dedupedClaims.set(key, claim);
        }
      }
      const normalizedClaims = Array.from(dedupedClaims.values()).sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return a.claim.localeCompare(b.claim);
      });

      const claimsById = new Map<string, ParsedClaimRecord>();
      for (const claim of normalizedClaims) {
        claimsById.set(claim.id, claim);
      }

      const activeClaims: AgentHandoffClaim[] = normalizedClaims.map((claim) => ({
        claim: claim.claim,
        confidence: claim.confidence,
        evidenceRefs: [...claim.evidenceRefs],
      }));
      const openConflicts = parseConflicts(entries, claimsById);
      const establishedInvariants = deriveInvariants(normalizedClaims);
      const rejectedAlternatives = parseRejectedAlternatives(entries, filteredAuditRecords, includeRejectedAlternatives);

      let topology = parseTopologyFromEntries(entries);
      topology = mergeTopology(topology, episodeFiles);
      for (const changedFile of changedFiles) {
        topology.filesModified.push(changedFile);
      }
      topology = {
        filesRead: Array.from(new Set(topology.filesRead)).sort((a, b) => a.localeCompare(b)),
        filesModified: Array.from(new Set(topology.filesModified)).sort((a, b) => a.localeCompare(b)),
        functionsAnalyzed: Array.from(new Set(topology.functionsAnalyzed)).sort((a, b) => a.localeCompare(b)),
      };

      const blastRadiusByFile = new Map<string, { directCallers: number; transitiveCallers: number }>();
      for (const changedFile of changedFiles) {
        const blast = await computeBlastRadius(workspaceRoot, changedFile, storage);
        blastRadiusByFile.set(changedFile, {
          directCallers: Math.max(0, blast.directCallers),
          transitiveCallers: Math.max(0, blast.transitiveCallers),
        });
      }
      const inProgressChanges = buildInProgressChanges(changedFiles, openConflicts, blastRadiusByFile);

      const { text: briefingForNextAgent, tokens: briefingTokenEstimate } = trimBriefingToBudget(
        sessionId,
        continuationFocus,
        activeClaims,
        openConflicts,
        inProgressChanges,
        establishedInvariants,
        rejectedAlternatives,
        topology,
        tokenBudget,
      );

      const canonicalPayload = {
        sessionId,
        continuationFocus,
        activeClaims,
        openConflicts,
        inProgressChanges,
        establishedInvariants,
        rejectedAlternatives,
        sessionTopology: topology,
      };
      const handoffHash = sha256Hex(stableStringify(canonicalPayload));
      const safeSessionId = normalizeSessionId(sessionId);
      const outputPath = path.join(workspaceRoot, handoffDirRelative, `${safeSessionId}.json`);

      if (writePackageFile) {
        const persisted = {
          kind: 'AgentHandoffPackage.v1',
          handoffHash,
          ...canonicalPayload,
          briefingForNextAgent,
          briefingTokenEstimate,
        };
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
      }

      return ok<AgentHandoffPackageOutput, ConstructionError>({
        kind: 'AgentHandoffPackageResult.v1',
        handoffHash,
        briefingForNextAgent,
        activeClaims,
        openConflicts,
        inProgressChanges,
        establishedInvariants,
        rejectedAlternatives,
        sessionTopology: topology,
        briefingTokenEstimate,
        outputPath,
      });
    },
  };
}
