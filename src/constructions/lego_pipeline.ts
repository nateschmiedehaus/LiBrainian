import type { Librarian } from '../api/librarian.js';
import type { ContextPack } from '../types.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import { absent, bounded, getNumericValue } from '../epistemics/confidence.js';
import { FeatureLocationAdvisor } from './feature_location_advisor.js';
import { RefactoringSafetyChecker } from './refactoring_safety_checker.js';
import { SecurityAuditHelper } from './security_audit_helper.js';

export type ConstructionSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ConstructionFinding {
  id: string;
  source: string;
  severity: ConstructionSeverity;
  summary: string;
  filePath?: string;
  line?: number;
  evidenceRefs: string[];
}

export interface ConstructionRecommendation {
  id: string;
  source: string;
  priority: 'high' | 'medium' | 'low';
  action: string;
  rationale: string;
  target?: string;
}

export interface SharedAgentContext {
  intent: string;
  retrievedPacks: ContextPack[];
  priorFindings: ConstructionFinding[];
  focusEntity?: string;
  tokenBudget?: number;
}

export interface ConstructionOutput<TData = Record<string, unknown>> {
  constructionId: string;
  summary: string;
  findings: ConstructionFinding[];
  recommendations: ConstructionRecommendation[];
  confidence: ConfidenceValue;
  evidenceRefs: string[];
  data: TData;
  metadata?: Record<string, unknown>;
  contextPatch?: Partial<SharedAgentContext>;
}

export interface LegoPipelineBrick<TInput = void> {
  id: string;
  run(input: TInput, context: SharedAgentContext): Promise<ConstructionOutput>;
}

export interface ComposedConstructionReport {
  intent: string;
  executed: string[];
  outputs: ConstructionOutput[];
  findings: ConstructionFinding[];
  recommendations: ConstructionRecommendation[];
  confidence: ConfidenceValue;
  context: SharedAgentContext;
}

export interface ComposeConstructionsOptions {
  include?: Array<'knowledge' | 'refactoring' | 'security'>;
}

export function serializeConstructionOutput<TData>(output: ConstructionOutput<TData>): string {
  return JSON.stringify(output);
}

export function deserializeConstructionOutput(raw: string): ConstructionOutput<Record<string, unknown>> {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid construction output payload: expected object');
  }
  if (typeof parsed.constructionId !== 'string' || parsed.constructionId.length === 0) {
    throw new Error('Invalid construction output payload: missing constructionId');
  }
  if (typeof parsed.summary !== 'string' || parsed.summary.length === 0) {
    throw new Error('Invalid construction output payload: missing summary');
  }
  if (!Array.isArray(parsed.evidenceRefs)) {
    throw new Error('Invalid construction output payload: missing evidenceRefs');
  }
  if (!('data' in parsed)) {
    throw new Error('Invalid construction output payload: missing data');
  }
  if (!Array.isArray(parsed.findings) || !Array.isArray(parsed.recommendations)) {
    throw new Error('Invalid construction output payload: malformed findings/recommendations');
  }
  if (!('confidence' in parsed)) {
    throw new Error('Invalid construction output payload: missing confidence');
  }
  const metadata = parsed.metadata;
  const contextPatch = parsed.contextPatch;

  return {
    constructionId: parsed.constructionId as string,
    summary: parsed.summary as string,
    findings: parsed.findings as ConstructionFinding[],
    recommendations: parsed.recommendations as ConstructionRecommendation[],
    confidence: parsed.confidence as ConfidenceValue,
    evidenceRefs: parsed.evidenceRefs as string[],
    data: parsed.data as Record<string, unknown>,
    metadata: (typeof metadata === 'object' && metadata !== null)
      ? (metadata as Record<string, unknown>)
      : undefined,
    contextPatch: (typeof contextPatch === 'object' && contextPatch !== null)
      ? (contextPatch as Partial<SharedAgentContext>)
      : undefined,
  };
}

class KnowledgeBrick implements LegoPipelineBrick<void> {
  readonly id = 'knowledge';
  private readonly advisor: FeatureLocationAdvisor;
  private readonly librarian: Librarian;

  constructor(librarian: Librarian) {
    this.librarian = librarian;
    this.advisor = new FeatureLocationAdvisor(librarian);
  }

  async run(_input: void, context: SharedAgentContext): Promise<ConstructionOutput> {
    const query = {
      intent: context.intent,
      depth: 'L2' as const,
      tokenBudget: context.tokenBudget
        ? { maxTokens: context.tokenBudget }
        : undefined,
    };
    const response = await this.librarian.queryOptional(query);
    const packs = response.packs ?? [];
    const report = await this.advisor.locate({ description: context.intent });
    const findings: ConstructionFinding[] = report.locations.slice(0, 8).map((location, index) => ({
      id: `knowledge_${index}`,
      source: this.id,
      severity: index === 0 ? 'high' : 'medium',
      summary: `Potential feature location: ${location.file}:${location.startLine}`,
      filePath: location.file,
      line: location.startLine,
      evidenceRefs: report.evidenceRefs,
    }));
    const recommendations: ConstructionRecommendation[] = report.relatedFeatures.slice(0, 5).map((feature, index) => ({
      id: `knowledge_rec_${index}`,
      source: this.id,
      priority: index < 2 ? 'high' : 'medium',
      action: `Inspect related feature path ${feature}`,
      rationale: 'Related modules can influence behavior while implementing changes.',
      target: feature,
    }));
    const confidence = report.confidence;
    const summary = report.primaryLocation
      ? `Primary location ${report.primaryLocation.file}:${report.primaryLocation.startLine} with ${report.locations.length} candidate locations.`
      : `No primary location identified; ${report.locations.length} candidate locations returned.`;

    return {
      constructionId: this.id,
      summary,
      findings,
      recommendations,
      confidence,
      evidenceRefs: report.evidenceRefs,
      data: {
        primaryLocation: report.primaryLocation ?? null,
        locations: report.locations,
        relatedFeatures: report.relatedFeatures,
      },
      metadata: {
        brick: this.id,
        locationCount: report.locations.length,
      },
      contextPatch: {
        retrievedPacks: packs,
        focusEntity: report.primaryLocation?.file,
      },
    };
  }
}

class RefactoringBrick implements LegoPipelineBrick<void> {
  readonly id = 'refactoring';
  private readonly checker: RefactoringSafetyChecker;

  constructor(librarian: Librarian) {
    this.checker = new RefactoringSafetyChecker(librarian);
  }

  async run(_input: void, context: SharedAgentContext): Promise<ConstructionOutput> {
    const focusEntity = context.focusEntity
      ?? context.retrievedPacks[0]?.relatedFiles?.[0]
      ?? context.retrievedPacks[0]?.targetId
      ?? context.priorFindings.find((item) => item.filePath)?.filePath
      ?? 'src/index.ts';
    const report = await this.checker.check({
      entityId: focusEntity,
      refactoringType: 'rename',
    });
    const findings: ConstructionFinding[] = report.breakingChanges.slice(0, 8).map((change, index) => ({
      id: `refactor_${index}`,
      source: this.id,
      severity: change.severity === 'critical' ? 'critical' : (change.severity === 'major' ? 'high' : 'medium'),
      summary: change.description,
      filePath: change.affectedFile,
      evidenceRefs: report.evidenceRefs,
    }));
    const recommendations: ConstructionRecommendation[] = [
      ...report.risks.slice(0, 5).map((risk, index) => ({
        id: `refactor_rec_${index}`,
        source: this.id,
        priority: 'high' as const,
        action: `Mitigate refactoring risk: ${risk}`,
        rationale: 'Safety checker identified a likely breakage path.',
        target: focusEntity,
      })),
      ...report.testCoverageGaps.slice(0, 3).map((gap, index) => ({
        id: `refactor_cov_${index}`,
        source: this.id,
        priority: gap.priority,
        action: `Add/extend test for ${gap.uncoveredUsage.file}:${gap.uncoveredUsage.line}`,
        rationale: gap.suggestedTest,
        target: gap.uncoveredUsage.file,
      })),
    ];
    const summary = report.breakingChanges.length > 0
      ? `Detected ${report.breakingChanges.length} potential breaking changes for ${focusEntity}.`
      : `No breaking changes detected for ${focusEntity}.`;

    return {
      constructionId: this.id,
      summary,
      findings,
      recommendations,
      confidence: report.confidence,
      evidenceRefs: report.evidenceRefs,
      data: {
        focusEntity,
        breakingChanges: report.breakingChanges,
        risks: report.risks,
        testCoverageGaps: report.testCoverageGaps,
      },
      metadata: {
        brick: this.id,
        riskCount: report.risks.length,
      },
      contextPatch: {
        focusEntity,
      },
    };
  }
}

class SecurityBrick implements LegoPipelineBrick<void> {
  readonly id = 'security';
  private readonly helper: SecurityAuditHelper;

  constructor(librarian: Librarian) {
    this.helper = new SecurityAuditHelper(librarian);
  }

  async run(_input: void, context: SharedAgentContext): Promise<ConstructionOutput> {
    const files = context.retrievedPacks
      .flatMap((pack) => pack.relatedFiles ?? [])
      .filter(Boolean)
      .slice(0, 25);
    const dedupedFiles = Array.from(new Set(files));
    const auditFiles = dedupedFiles.length > 0
      ? dedupedFiles
      : (context.focusEntity ? [context.focusEntity] : ['src/index.ts']);
    const report = await this.helper.audit({
      files: auditFiles,
      checkTypes: ['injection', 'auth', 'crypto', 'exposure', 'ssrf', 'logging', 'headers', 'components'],
    });
    const findings: ConstructionFinding[] = report.findings.slice(0, 15).map((finding, index) => ({
      id: `security_${index}`,
      source: this.id,
      severity: finding.severity,
      summary: finding.title,
      filePath: finding.file,
      line: finding.line,
      evidenceRefs: report.evidenceRefs,
    }));
    const recommendations: ConstructionRecommendation[] = report.findings.slice(0, 8).map((finding, index) => ({
      id: `security_rec_${index}`,
      source: this.id,
      priority: finding.severity === 'critical' || finding.severity === 'high' ? 'high' : 'medium',
      action: finding.remediation,
      rationale: finding.description,
      target: finding.file,
    }));
    const summary = report.findings.length > 0
      ? `Security audit found ${report.findings.length} findings across ${auditFiles.length} files.`
      : `Security audit found no findings across ${auditFiles.length} files.`;

    return {
      constructionId: this.id,
      summary,
      findings,
      recommendations,
      confidence: report.confidence,
      evidenceRefs: report.evidenceRefs,
      data: {
        auditedFiles: auditFiles,
        findings: report.findings,
      },
      metadata: {
        brick: this.id,
        auditedFileCount: auditFiles.length,
      },
      contextPatch: {},
    };
  }
}

function mergeContext(base: SharedAgentContext, patch: Partial<SharedAgentContext>): SharedAgentContext {
  return {
    ...base,
    ...patch,
    retrievedPacks: patch.retrievedPacks ?? base.retrievedPacks,
    priorFindings: patch.priorFindings ?? base.priorFindings,
    focusEntity: patch.focusEntity ?? base.focusEntity,
  };
}

function aggregateConfidence(outputs: ConstructionOutput[]): ConfidenceValue {
  const values = outputs
    .map((output) => getNumericValue(output.confidence))
    .filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) return absent('insufficient_data');
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const low = Math.max(0, average - 0.05);
  const high = Math.min(1, average + 0.05);
  return bounded(low, high, 'formal_analysis', 'construction_pipeline_confidence_aggregation');
}

export async function composeConstructions(
  librarian: Librarian,
  intent: string,
  options: ComposeConstructionsOptions = {}
): Promise<ComposedConstructionReport> {
  const selected = options.include ?? ['knowledge', 'refactoring', 'security'];
  const bricks: LegoPipelineBrick[] = [];
  if (selected.includes('knowledge')) bricks.push(new KnowledgeBrick(librarian));
  if (selected.includes('refactoring')) bricks.push(new RefactoringBrick(librarian));
  if (selected.includes('security')) bricks.push(new SecurityBrick(librarian));

  let context: SharedAgentContext = {
    intent,
    retrievedPacks: [],
    priorFindings: [],
    focusEntity: undefined,
  };
  const outputs: ConstructionOutput[] = [];
  for (const brick of bricks) {
    const output = await brick.run(undefined, context);
    outputs.push(output);
    const patch = output.contextPatch ?? {};
    context = mergeContext(context, patch);
    context.priorFindings = [...context.priorFindings, ...output.findings];
  }

  return {
    intent,
    executed: outputs.map((output) => output.constructionId),
    outputs,
    findings: outputs.flatMap((output) => output.findings),
    recommendations: outputs.flatMap((output) => output.recommendations),
    confidence: aggregateConfidence(outputs),
    context,
  };
}
