import path from 'node:path';

import type { LibrarianStorage, UniversalKnowledgeRecord } from '../storage/types.js';
import type { ContextPack, LibrarianQuery, SynthesizedResponse } from '../types.js';
import { ArchitectureKnowledge, type ArchitectureViolation, type CoreModule, type DependencyCycle } from '../knowledge/architecture.js';
import type { UniversalKnowledge } from '../knowledge/universal_types.js';
import { generateMermaidDiagram, type DiagramType } from '../visualization/mermaid_generator.js';

export type ArchitectureZoomLevel = 'project' | 'subsystem' | 'module';

export interface ArchitectureHealthMetrics {
  overall: number;
  layerDiscipline: number;
  coupling: number;
  cycles: number;
  coreConcentration: number;
}

export interface ArchitectureNarrativeInput {
  query: LibrarianQuery;
  storage: LibrarianStorage;
  workspaceRoot: string;
  packs: ContextPack[];
}

export interface ArchitectureNarrativeResult {
  zoomLevel: ArchitectureZoomLevel;
  diagramType: DiagramType;
  interestingFindings: string[];
  metrics: ArchitectureHealthMetrics;
  synthesis: SynthesizedResponse;
}

const PROJECT_HINT_PATTERN = /\b(?:this|the)\s+(?:project|codebase|system)\b/i;
const SUBSYSTEM_HINT_PATTERN = /\b(pipeline|subsystem|component|service|module|workflow|data\s+flow|how\s+does\s+.+\s+work)\b/i;

export async function buildArchitectureNarrative(
  input: ArchitectureNarrativeInput,
): Promise<ArchitectureNarrativeResult> {
  const { query, storage, workspaceRoot, packs } = input;
  const architecture = new ArchitectureKnowledge(storage);
  const [
    layersResult,
    couplingResult,
    cyclesResult,
    coreModulesResult,
    violationsResult,
  ] = await Promise.all([
    architecture.query({ type: 'layers' }),
    architecture.query({ type: 'coupling' }),
    architecture.query({ type: 'cycles' }),
    architecture.query({ type: 'core_modules' }),
    architecture.query({ type: 'violations' }),
  ]);

  const zoomLevel = detectArchitectureZoomLevel(query);
  const knowledge = await loadKnowledgeForArchitectureNarration(storage, zoomLevel, query);
  const focusedFile = resolveFocusedFile(query, packs, workspaceRoot);
  const focusEntity = resolveFocusEntityId(knowledge, focusedFile);

  const preferredDiagramType: DiagramType = zoomLevel === 'project'
    ? 'architecture'
    : zoomLevel === 'subsystem'
      ? 'dependency'
      : 'call_hierarchy';

  let diagram = generateMermaidDiagram(knowledge, {
    type: preferredDiagramType,
    scope: zoomLevel === 'project' ? 'full' : zoomLevel === 'subsystem' ? 'directory' : 'file',
    focus: focusEntity,
    depth: zoomLevel === 'module' ? 4 : 3,
    maxNodes: zoomLevel === 'project' ? 70 : 40,
  });

  if (diagram.nodeCount === 0 || diagram.mermaid.includes('Focus entity')) {
    const layerGraph = (layersResult.layers ?? []).map((layer) => ({
      name: layer.name,
      dependsOn: layer.allowedDependencies,
    }));
    diagram = {
      mermaid: renderLayerMermaid(layerGraph),
      nodeCount: layerGraph.length,
      edgeCount: layerGraph.reduce((acc, layer) => acc + layer.dependsOn.length, 0),
      truncated: false,
      focusEntity: focusedFile,
    };
  }

  const metrics = buildArchitectureHealthMetrics({
    layerViolations: (layersResult.layers ?? []).reduce((acc, layer) => acc + layer.violations.length, 0),
    maxCoupling: couplingResult.coupling?.mostCoupled[0]?.score ?? 0,
    cycleCount: cyclesResult.cycles?.length ?? 0,
    highRiskCoreCount: (coreModulesResult.coreModules ?? []).filter((module) => module.risk === 'high' || module.risk === 'critical').length,
  });

  const interestingFindings = collectInterestingFindings({
    violations: violationsResult.violations ?? [],
    cycles: cyclesResult.cycles ?? [],
    coreModules: coreModulesResult.coreModules ?? [],
  });

  const topCoreModules = (coreModulesResult.coreModules ?? []).slice(0, 5);
  const layers = (layersResult.layers ?? []).slice(0, 8);
  const layeredNarrative = [
    `## Architecture Narrative (${zoomLevel})`,
    '',
    '### System Shape',
    layers.length > 0
      ? layers.map((layer) => {
        const moduleCount = layer.modules.length;
        const primaryDirectory = layer.directories[0] ?? 'layer';
        return `- **${layer.name}** (${primaryDirectory}) - ${moduleCount} module${moduleCount === 1 ? '' : 's'}`;
      }).join('\n')
      : '- No explicit architecture layers detected from indexed modules.',
    '',
    '### Load-Bearing Modules (PageRank + Betweenness)',
    topCoreModules.length > 0
      ? topCoreModules.map((module) => `- \`${toWorkspaceRelativePath(module.path, workspaceRoot)}\`: ${module.reason}`).join('\n')
      : '- Core-module analysis did not produce ranked modules yet.',
    '',
    '### Architecture Health',
    formatHealthSidebar(metrics),
    '',
    '### Interesting Findings',
    interestingFindings.map((finding) => `- ${finding}`).join('\n'),
    '',
    '### Diagram',
    '```mermaid',
    diagram.mermaid,
    '```',
  ].join('\n');

  const citations = packs.slice(0, 4).map((pack) => ({
    packId: pack.packId,
    content: pack.summary || pack.keyFacts[0] || pack.targetId,
    relevance: Math.max(0.3, Math.min(1, pack.confidence)),
    file: pack.relatedFiles[0],
  }));

  const confidence = computeNarrativeConfidence(metrics, citations.length);
  const synthesis: SynthesizedResponse = {
    answer: layeredNarrative,
    confidence,
    citations,
    keyInsights: [
      topCoreModules[0]
        ? `Most central module: ${toWorkspaceRelativePath(topCoreModules[0].path, workspaceRoot)} (${topCoreModules[0].reason}).`
        : 'Core-module centrality is still stabilizing as indexing evolves.',
      `${layers.length} layers detected with ${(layersResult.layers ?? []).reduce((acc, layer) => acc + layer.violations.length, 0)} layer-violation signal(s).`,
      `Architecture health score: ${metrics.overall.toFixed(1)}/10.`,
    ],
    uncertainties: diagram.truncated
      ? ['Diagram truncated for readability; ask a scoped follow-up for deeper detail.']
      : [],
  };

  return {
    zoomLevel,
    diagramType: preferredDiagramType,
    interestingFindings,
    metrics,
    synthesis,
  };
}

function detectArchitectureZoomLevel(query: LibrarianQuery): ArchitectureZoomLevel {
  if (query.affectedFiles?.length || query.scope || query.workingFile) {
    return 'module';
  }
  const intent = query.intent ?? '';
  if (PROJECT_HINT_PATTERN.test(intent)) {
    return 'project';
  }
  if (SUBSYSTEM_HINT_PATTERN.test(intent)) {
    return 'subsystem';
  }
  return 'project';
}

async function loadKnowledgeForArchitectureNarration(
  storage: LibrarianStorage,
  zoomLevel: ArchitectureZoomLevel,
  query: LibrarianQuery,
): Promise<UniversalKnowledge[]> {
  if (typeof storage.queryUniversalKnowledge !== 'function') return [];
  const filePrefix = resolveKnowledgePrefix(query, zoomLevel);
  const records = await storage.queryUniversalKnowledge({
    filePrefix,
    limit: zoomLevel === 'project' ? 350 : 200,
  }).catch(() => []);
  return records
    .map((record) => parseNarrationKnowledgeRecord(record))
    .filter((entry): entry is UniversalKnowledge => entry !== null);
}

function resolveKnowledgePrefix(query: LibrarianQuery, zoomLevel: ArchitectureZoomLevel): string | undefined {
  if (zoomLevel === 'project') return undefined;

  if (typeof query.scope === 'string' && query.scope.trim().length > 0) {
    return normalizePrefix(query.scope);
  }
  if (typeof query.workingFile === 'string' && query.workingFile.trim().length > 0) {
    const normalized = query.workingFile.replace(/\\/g, '/');
    const withoutFile = normalized.endsWith('.ts') || normalized.endsWith('.js')
      ? normalized.slice(0, normalized.lastIndexOf('/'))
      : normalized;
    return normalizePrefix(withoutFile);
  }
  if (Array.isArray(query.affectedFiles) && query.affectedFiles[0]) {
    const first = query.affectedFiles[0].replace(/\\/g, '/');
    return normalizePrefix(first.slice(0, Math.max(0, first.lastIndexOf('/'))));
  }
  return undefined;
}

function normalizePrefix(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function parseNarrationKnowledgeRecord(record: UniversalKnowledgeRecord): UniversalKnowledge | null {
  if (typeof record.knowledge !== 'string' || record.knowledge.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(record.knowledge) as Record<string, unknown>;
    const relationshipsRaw = asRecord(parsed.relationships);
    const qualityRaw = asRecord(parsed.quality);
    const maintainabilityRaw = asRecord(qualityRaw?.maintainability);
    const complexityRaw = asRecord(qualityRaw?.complexity);

    const normalized = {
      ...parsed,
      id: typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : `entity:${record.id}`,
      name: typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : record.name,
      kind: typeof parsed.kind === 'string' ? parsed.kind : record.kind,
      module: typeof parsed.module === 'string' && parsed.module.length > 0
        ? parsed.module
        : moduleFromFile(record.file),
      location: {
        file: typeof asRecord(parsed.location)?.file === 'string'
          ? String(asRecord(parsed.location)?.file)
          : record.file,
      },
      relationships: {
        ...(relationshipsRaw ?? {}),
        imports: normalizeRelationshipList(relationshipsRaw?.imports),
        calls: normalizeRelationshipList(relationshipsRaw?.calls),
      },
      quality: {
        ...(qualityRaw ?? {}),
        maintainability: {
          ...(maintainabilityRaw ?? {}),
          index: typeof maintainabilityRaw?.index === 'number'
            ? maintainabilityRaw.index
            : (record.maintainabilityIndex ?? 65),
        },
        complexity: {
          ...(complexityRaw ?? {}),
          cognitive: typeof complexityRaw?.cognitive === 'number' ? complexityRaw.cognitive : 0,
        },
      },
    };
    return normalized as unknown as UniversalKnowledge;
  } catch {
    return null;
  }
}

function normalizeRelationshipList(raw: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(raw)) return [];
  const normalized: Array<{ id: string; name: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const objectEntry = entry as Record<string, unknown>;
    const id = typeof objectEntry.id === 'string' ? objectEntry.id : undefined;
    if (!id) continue;
    normalized.push({
      id,
      name: typeof objectEntry.name === 'string' ? objectEntry.name : id,
    });
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function moduleFromFile(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const withoutExtension = normalized.replace(/\.[^.]+$/, '');
  const srcIndex = withoutExtension.indexOf('/src/');
  if (srcIndex >= 0) {
    return withoutExtension.slice(srcIndex + 5);
  }
  return withoutExtension.replace(/^\/+/, '');
}

function resolveFocusedFile(query: LibrarianQuery, packs: ContextPack[], workspaceRoot: string): string | undefined {
  const raw = query.affectedFiles?.[0] ?? query.workingFile ?? packs[0]?.relatedFiles?.[0];
  if (!raw || typeof raw !== 'string') return undefined;
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(workspaceRoot, raw);
}

function resolveFocusEntityId(knowledge: UniversalKnowledge[], focusedFile: string | undefined): string | undefined {
  if (knowledge.length === 0) return undefined;
  if (!focusedFile) return knowledge[0]?.id;

  const normalizedFocus = focusedFile.replace(/\\/g, '/');
  const matched = knowledge.find((entry) => {
    const location = (entry as unknown as { location?: { file?: string } }).location;
    if (!location?.file) return false;
    const normalizedLocation = String(location.file).replace(/\\/g, '/');
    return normalizedLocation.endsWith(normalizedFocus) || normalizedFocus.endsWith(normalizedLocation);
  });
  return matched?.id ?? knowledge[0]?.id;
}

function renderLayerMermaid(layers: Array<{ name: string; dependsOn: string[] }>): string {
  if (layers.length === 0) {
    return 'graph TD\n  architecture["Architecture data unavailable"]';
  }
  const lines: string[] = ['graph TD'];
  for (const layer of layers) {
    const layerId = sanitizeNodeId(layer.name);
    lines.push(`  ${layerId}["${layer.name}"]`);
  }
  for (const layer of layers) {
    const from = sanitizeNodeId(layer.name);
    for (const dependency of layer.dependsOn) {
      lines.push(`  ${from} --> ${sanitizeNodeId(dependency)}`);
    }
  }
  return lines.join('\n');
}

function sanitizeNodeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '_') || 'layer';
}

function collectInterestingFindings(input: {
  violations: ArchitectureViolation[];
  cycles: DependencyCycle[];
  coreModules: CoreModule[];
}): string[] {
  const findings: string[] = [];
  const firstViolation = input.violations.find((violation) => violation.severity === 'error') ?? input.violations[0];
  if (firstViolation) {
    findings.push(`${firstViolation.type}: ${firstViolation.message}`);
  }

  const firstCycle = input.cycles[0];
  if (firstCycle) {
    findings.push(`Cycle hotspot: ${firstCycle.nodes.slice(0, 4).join(' -> ')} (${firstCycle.severity}).`);
  }

  const topCore = input.coreModules[0];
  if (topCore) {
    findings.push(`Load-bearing hotspot: ${topCore.path} (${topCore.reason}).`);
  }

  if (findings.length === 0) {
    findings.push('No critical architecture smells detected in current graph metrics.');
  }

  return findings.slice(0, 4);
}

function buildArchitectureHealthMetrics(input: {
  layerViolations: number;
  maxCoupling: number;
  cycleCount: number;
  highRiskCoreCount: number;
}): ArchitectureHealthMetrics {
  const layerDiscipline = clamp10(10 - (input.layerViolations * 1.25));
  const coupling = clamp10(10 - (input.maxCoupling / 3));
  const cycles = clamp10(10 - (input.cycleCount * 1.7));
  const coreConcentration = clamp10(10 - (input.highRiskCoreCount * 1.2));
  const overall = Number(((layerDiscipline + coupling + cycles + coreConcentration) / 4).toFixed(1));

  return {
    overall,
    layerDiscipline,
    coupling,
    cycles,
    coreConcentration,
  };
}

function clamp10(value: number): number {
  return Number(Math.max(0, Math.min(10, value)).toFixed(1));
}

function formatHealthSidebar(metrics: ArchitectureHealthMetrics): string {
  return [
    `Architecture Health: ${metrics.overall.toFixed(1)}/10`,
    `├── Layer discipline: ${metrics.layerDiscipline.toFixed(1)}/10`,
    `├── Coupling: ${metrics.coupling.toFixed(1)}/10`,
    `├── Cycles: ${metrics.cycles.toFixed(1)}/10`,
    `└── Core concentration: ${metrics.coreConcentration.toFixed(1)}/10`,
  ].join('\n');
}

function computeNarrativeConfidence(metrics: ArchitectureHealthMetrics, citationCount: number): number {
  const evidenceBoost = Math.min(0.12, citationCount * 0.03);
  const healthSignal = Math.min(0.18, metrics.overall / 60);
  return Number(Math.max(0.45, Math.min(0.92, 0.62 + evidenceBoost + healthSignal)).toFixed(2));
}

function toWorkspaceRelativePath(filePath: string, workspaceRoot: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const relative = path.relative(workspaceRoot, normalized).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) {
    return normalized;
  }
  return relative;
}
