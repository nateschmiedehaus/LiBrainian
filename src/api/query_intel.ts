import path from 'node:path';
import type { LibrarianStorage, UniversalKnowledgeRecord } from '../storage/types.js';
import type {
  ContextPack,
  LibrarianQuery,
  LibrarianResponse,
  RiskHighlight,
  StabilityAlert,
  OwnershipContext,
  EntityIntel,
} from '../types.js';
import { estimateTokenCount } from './governor_context.js';
import { safeJsonParse } from '../utils/safe_json.js';

export type QueryIntelSections = Pick<
  LibrarianResponse,
  'riskHighlights' | 'stabilityAlerts' | 'ownershipContext' | 'entityIntel'
>;

export type QueryIntelStorage = Pick<
  LibrarianStorage,
  'getUniversalKnowledgeByFile' | 'getIngestionItem' | 'getCochangeEdges'
>;

interface QueryIntelInput {
  storage: QueryIntelStorage;
  packs: ContextPack[];
  depth: LibrarianQuery['depth'];
  workspaceRoot?: string;
  maxResponseTokens?: number;
}

interface EntityContext {
  entityPath: string;
  relativePath: string;
}

interface OwnershipPayload {
  path: string;
  primaryOwner: string;
  contributors: string[];
  lastTouchedAt?: string;
}

interface KnowledgeSnapshot {
  quality?: {
    maintainability?: { index?: number };
    churn?: { changeCount?: number; changeFrequency?: number };
  };
  security?: {
    riskScore?: { overall?: number };
    vulnerabilities?: Array<{ description?: string }>;
    threatModel?: { threatVectors?: Array<{ description?: string }> };
  };
}

const RISK_MEDIUM_THRESHOLD = 0.5;
const RISK_CRITICAL_THRESHOLD = 0.85;
const STABILITY_CHANGE_THRESHOLD = 4;
const COCHANGE_STRENGTH_THRESHOLD = 0.8;
const INTEL_BUDGET_RATIO = 0.15;

export async function buildQueryIntelSections(input: QueryIntelInput): Promise<QueryIntelSections> {
  const entities = collectEntityContexts(input.packs, input.workspaceRoot);
  if (entities.length === 0) return {};

  const riskHighlights: RiskHighlight[] = [];
  const stabilityAlerts: StabilityAlert[] = [];
  const ownershipContext: OwnershipContext[] = [];
  const entityIntel: EntityIntel[] = [];

  const includeRisk = input.depth === 'L1' || input.depth === 'L2' || input.depth === 'L3';
  const includeMaintainability = input.depth === 'L2' || input.depth === 'L3';

  for (const entity of entities) {
    const record = await getBestKnowledgeRecord(input.storage, entity);
    const knowledge = record ? parseKnowledgeSnapshot(record) : null;

    const riskScore = normalizeRiskScore(
      record?.riskScore ?? readNumber(knowledge?.security?.riskScore?.overall)
    );
    if (includeRisk && riskScore > RISK_MEDIUM_THRESHOLD) {
      riskHighlights.push({
        entity: entity.entityPath,
        risk: riskScore >= RISK_CRITICAL_THRESHOLD ? 'CRITICAL' : 'HIGH',
        rationale: selectRiskRationale(record, knowledge, riskScore),
      });
    }

    const changeCount = readNumber(knowledge?.quality?.churn?.changeCount);
    const changeFrequency = readNumber(knowledge?.quality?.churn?.changeFrequency);
    if (changeCount > STABILITY_CHANGE_THRESHOLD) {
      stabilityAlerts.push({
        entity: entity.entityPath,
        changes: Math.round(changeCount),
        period: '30d',
        trend: deriveTrend(changeFrequency),
      });
    }

    const ownership = await getOwnershipContext(input.storage, entity);
    if (ownership) {
      ownershipContext.push(ownership);
    }

    const maintainability = includeMaintainability
      ? normalizeMaintainabilityIndex(
        record?.maintainabilityIndex ?? readNumber(knowledge?.quality?.maintainability?.index)
      )
      : undefined;
    const coChangesWith = await getCochangePeers(input.storage, entity, input.workspaceRoot);
    if (typeof maintainability === 'number' || coChangesWith.length > 0) {
      entityIntel.push({
        entity: entity.entityPath,
        maintainabilityIndex: maintainability,
        coChangesWith: coChangesWith.length > 0 ? coChangesWith : undefined,
      });
    }
  }

  const sortedRiskHighlights = sortRiskHighlights(riskHighlights);
  const sortedStabilityAlerts = sortStabilityAlerts(stabilityAlerts);
  const sortedOwnershipContext = sortOwnershipContext(ownershipContext);
  const sortedEntityIntel = sortEntityIntel(entityIntel);

  const tokenBudget = resolveIntelTokenBudget(input.maxResponseTokens);
  if (tokenBudget <= 0) return {};

  return trimSectionsToBudget(
    sortedRiskHighlights,
    sortedStabilityAlerts,
    sortedOwnershipContext,
    sortedEntityIntel,
    tokenBudget
  );
}

function collectEntityContexts(packs: ContextPack[], workspaceRoot?: string): EntityContext[] {
  const entities = new Map<string, EntityContext>();
  for (const pack of packs) {
    const sourceFile =
      pack.codeSnippets[0]?.filePath
      ?? pack.relatedFiles[0]
      ?? inferFileLikeTarget(pack.targetId);
    if (!sourceFile) continue;
    const absolutePath = resolveEntityPath(sourceFile, workspaceRoot);
    const relativePath = toRelativePath(workspaceRoot, absolutePath);
    if (!entities.has(absolutePath)) {
      entities.set(absolutePath, { entityPath: absolutePath, relativePath });
    }
  }
  return Array.from(entities.values());
}

function inferFileLikeTarget(targetId: string): string | null {
  if (!targetId.includes('/')) return null;
  if (!targetId.includes('.')) return null;
  return targetId;
}

function resolveEntityPath(value: string, workspaceRoot?: string): string {
  const normalized = normalizePath(value);
  if (path.isAbsolute(normalized)) return normalized;
  if (!workspaceRoot) return normalized;
  return normalizePath(path.resolve(workspaceRoot, normalized));
}

function toRelativePath(workspaceRoot: string | undefined, filePath: string): string {
  const normalized = normalizePath(filePath);
  if (!workspaceRoot) return normalized;
  const root = normalizePath(path.resolve(workspaceRoot));
  const absolute = path.isAbsolute(normalized) ? normalized : normalizePath(path.resolve(root, normalized));
  const relative = normalizePath(path.relative(root, absolute));
  return relative.startsWith('..') ? normalized : relative;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

async function getBestKnowledgeRecord(
  storage: QueryIntelStorage,
  entity: EntityContext
): Promise<UniversalKnowledgeRecord | null> {
  const relative = await storage.getUniversalKnowledgeByFile(entity.relativePath);
  if (relative.length > 0) return selectBestKnowledgeRecord(relative);
  if (entity.relativePath === entity.entityPath) return null;
  const absolute = await storage.getUniversalKnowledgeByFile(entity.entityPath);
  return absolute.length > 0 ? selectBestKnowledgeRecord(absolute) : null;
}

function selectBestKnowledgeRecord(records: UniversalKnowledgeRecord[]): UniversalKnowledgeRecord {
  return [...records].sort((a, b) => b.confidence - a.confidence)[0]!;
}

function parseKnowledgeSnapshot(record: UniversalKnowledgeRecord): KnowledgeSnapshot | null {
  const parsed = safeJsonParse<unknown>(record.knowledge);
  if (!parsed.ok) return null;
  if (!isRecord(parsed.value)) return null;
  return parsed.value as KnowledgeSnapshot;
}

function selectRiskRationale(
  record: UniversalKnowledgeRecord | null,
  knowledge: KnowledgeSnapshot | null,
  riskScore: number
): string {
  const vulnerability = knowledge?.security?.vulnerabilities?.find(
    (entry) => typeof entry.description === 'string' && entry.description.trim().length > 0
  );
  if (vulnerability?.description) return oneLine(vulnerability.description);

  const threatVector = knowledge?.security?.threatModel?.threatVectors?.find(
    (entry) => typeof entry.description === 'string' && entry.description.trim().length > 0
  );
  if (threatVector?.description) return oneLine(threatVector.description);

  if (record?.purposeSummary && record.purposeSummary.trim().length > 0) {
    return oneLine(record.purposeSummary);
  }

  return `Elevated risk score (${riskScore.toFixed(2)}) detected`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function deriveTrend(changeFrequency: number): StabilityAlert['trend'] {
  if (changeFrequency >= 4) return 'increasing';
  if (changeFrequency >= 1) return 'stable';
  return 'decreasing';
}

async function getOwnershipContext(
  storage: QueryIntelStorage,
  entity: EntityContext
): Promise<OwnershipContext | null> {
  const item = await storage.getIngestionItem(`ownership:${entity.relativePath}`);
  if (!item || !isOwnershipPayload(item.payload)) return null;
  const owner = item.payload.primaryOwner.trim();
  const lastActive = item.payload.lastTouchedAt?.trim() ?? '';
  if (!owner || owner.toLowerCase() === 'unknown') return null;
  if (!isIsoDate(lastActive)) return null;
  return {
    entity: entity.entityPath,
    owner,
    lastActive,
  };
}

function isOwnershipPayload(value: unknown): value is OwnershipPayload {
  if (!isRecord(value)) return false;
  return typeof value.path === 'string'
    && typeof value.primaryOwner === 'string'
    && Array.isArray(value.contributors);
}

function isIsoDate(value: string): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

async function getCochangePeers(
  storage: QueryIntelStorage,
  entity: EntityContext,
  workspaceRoot?: string
): Promise<string[]> {
  const byRelative = await storage.getCochangeEdges({
    fileA: entity.relativePath,
    minStrength: COCHANGE_STRENGTH_THRESHOLD,
    orderBy: 'strength',
    orderDirection: 'desc',
    limit: 8,
  });
  const byAbsolute = entity.relativePath === entity.entityPath
    ? []
    : await storage.getCochangeEdges({
      fileA: entity.entityPath,
      minStrength: COCHANGE_STRENGTH_THRESHOLD,
      orderBy: 'strength',
      orderDirection: 'desc',
      limit: 8,
    });

  const peers = new Set<string>();
  for (const edge of [...byRelative, ...byAbsolute]) {
    if (edge.strength <= COCHANGE_STRENGTH_THRESHOLD) continue;
    const other = edge.fileA === entity.relativePath || edge.fileA === entity.entityPath
      ? edge.fileB
      : edge.fileA;
    peers.add(resolveEntityPath(other, workspaceRoot));
  }

  peers.delete(entity.entityPath);
  return Array.from(peers).slice(0, 5);
}

function normalizeRiskScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1) return clamp(value / 100, 0, 1);
  return clamp(value, 0, 1);
}

function normalizeMaintainabilityIndex(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.round(clamp(value, 0, 100) * 100) / 100;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sortRiskHighlights(items: RiskHighlight[]): RiskHighlight[] {
  return [...items].sort((a, b) => {
    const rankA = a.risk === 'CRITICAL' ? 0 : 1;
    const rankB = b.risk === 'CRITICAL' ? 0 : 1;
    return rankA - rankB || a.entity.localeCompare(b.entity);
  });
}

function sortStabilityAlerts(items: StabilityAlert[]): StabilityAlert[] {
  return [...items].sort((a, b) => b.changes - a.changes || a.entity.localeCompare(b.entity));
}

function sortOwnershipContext(items: OwnershipContext[]): OwnershipContext[] {
  return [...items].sort((a, b) => b.lastActive.localeCompare(a.lastActive) || a.entity.localeCompare(b.entity));
}

function sortEntityIntel(items: EntityIntel[]): EntityIntel[] {
  return [...items].sort((a, b) => {
    const aMaintainability = typeof a.maintainabilityIndex === 'number' ? a.maintainabilityIndex : Number.POSITIVE_INFINITY;
    const bMaintainability = typeof b.maintainabilityIndex === 'number' ? b.maintainabilityIndex : Number.POSITIVE_INFINITY;
    return aMaintainability - bMaintainability || a.entity.localeCompare(b.entity);
  });
}

function resolveIntelTokenBudget(maxResponseTokens: number | undefined): number {
  if (!Number.isFinite(maxResponseTokens) || !maxResponseTokens || maxResponseTokens <= 0) return 0;
  return Math.floor(maxResponseTokens * INTEL_BUDGET_RATIO);
}

function trimSectionsToBudget(
  riskHighlights: RiskHighlight[],
  stabilityAlerts: StabilityAlert[],
  ownershipContext: OwnershipContext[],
  entityIntel: EntityIntel[],
  budgetTokens: number
): QueryIntelSections {
  let sections: QueryIntelSections = {};

  if (riskHighlights.length > 0) {
    const trimmed = trimArrayToBudget(riskHighlights, sections, budgetTokens, (items) => ({ riskHighlights: items }));
    if (trimmed.length > 0) sections = { ...sections, riskHighlights: trimmed };
  }

  if (stabilityAlerts.length > 0) {
    const trimmed = trimArrayToBudget(stabilityAlerts, sections, budgetTokens, (items) => ({ stabilityAlerts: items }));
    if (trimmed.length > 0) sections = { ...sections, stabilityAlerts: trimmed };
  }

  if (ownershipContext.length > 0) {
    const trimmed = trimArrayToBudget(ownershipContext, sections, budgetTokens, (items) => ({ ownershipContext: items }));
    if (trimmed.length > 0) sections = { ...sections, ownershipContext: trimmed };
  }

  if (entityIntel.length > 0) {
    const trimmed = trimArrayToBudget(entityIntel, sections, budgetTokens, (items) => ({ entityIntel: items }));
    if (trimmed.length > 0) sections = { ...sections, entityIntel: trimmed };
  }

  return sections;
}

function trimArrayToBudget<T>(
  items: T[],
  currentSections: QueryIntelSections,
  budgetTokens: number,
  toSection: (items: T[]) => QueryIntelSections
): T[] {
  for (let size = items.length; size > 0; size -= 1) {
    const candidateItems = items.slice(0, size);
    const candidate = { ...currentSections, ...toSection(candidateItems) };
    if (estimateIntelTokens(candidate) <= budgetTokens) return candidateItems;
  }
  return [];
}

function estimateIntelTokens(value: QueryIntelSections): number {
  const json = JSON.stringify(value);
  return estimateTokenCount(json);
}

export const __testing = {
  estimateIntelTokens,
  normalizeRiskScore,
  resolveIntelTokenBudget,
};
