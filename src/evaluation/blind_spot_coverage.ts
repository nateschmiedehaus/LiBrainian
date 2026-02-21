/**
 * @fileoverview Dogfood blind-spot coverage model and validation helpers.
 */

export interface BlindSpotDefinition {
  id: string;
  title: string;
  description?: string;
}

export interface SupplementaryCorpus {
  id: string;
  name: string;
  path: string;
  source?: string;
  nonLiBrainian?: boolean;
  qualifiesForStrictAgentic?: boolean;
  blindSpots: string[];
}

export interface BlindSpotCatalog {
  version: string;
  updatedAt: string;
  strictAgenticMinimumNonLiBrainianCorpora: number;
  requiredBlindSpotCoverage: string[];
  blindSpots: BlindSpotDefinition[];
  corpora: SupplementaryCorpus[];
}

export interface ExternalRepoManifest {
  repos: Array<{
    name: string;
    source?: string;
    remote?: string;
    language?: string;
  }>;
}

interface GateMetricClaim {
  validatedBy?: string[];
  requiresSupplementaryCorpus?: boolean;
}

interface GatesShape {
  validationStatus?: {
    blockingMetrics?: Record<string, GateMetricClaim>;
  };
}

export interface BlindSpotCoverageEntry {
  id: string;
  title: string;
  covered: boolean;
  corpusIds: string[];
}

export interface BlindSpotCoverageSummary {
  supplementaryCorporaCount: number;
  minimumSupplementaryCorpora: number;
  coveredBlindSpots: number;
  totalBlindSpots: number;
  requiredCoverageMet: boolean;
  strictGateCoverageMet: boolean;
  releaseClaimAnnotationsMet: boolean;
  findings: string[];
}

export interface BlindSpotCoverageDashboard {
  kind: 'LiBrainianDogfoodBlindSpotCoverage.v1';
  generatedAt: string;
  summary: BlindSpotCoverageSummary;
  blindSpots: BlindSpotCoverageEntry[];
  strictGate: {
    expectedMinimumNonLiBrainianCorpora: number;
    nonLiBrainianStrictCorporaCount: number;
    strictScriptHasUseCases: boolean;
    strictScriptHasSmokeExternal: boolean;
    useCasesTargetsExternalCorpus: boolean;
    useCasesMaxRepos: number | null;
    externalManifestRepoCount: number;
  };
  releaseClaimAnnotations: {
    totalClaims: number;
    annotatedClaims: number;
    missingClaims: string[];
  };
}

export function buildBlindSpotCoverageDashboard(input: {
  catalog: BlindSpotCatalog;
  externalManifest: ExternalRepoManifest;
  scripts: Record<string, string | undefined>;
  minimumSupplementaryCorpora?: number;
  gates?: GatesShape;
  now?: Date;
}): BlindSpotCoverageDashboard {
  const now = input.now ?? new Date();
  const minimumSupplementaryCorpora = input.minimumSupplementaryCorpora ?? 5;
  const catalog = input.catalog;
  const scripts = input.scripts;
  const strictMin = Math.max(1, catalog.strictAgenticMinimumNonLiBrainianCorpora);

  const findings: string[] = [];
  const corporaByBlindSpot = new Map<string, string[]>();

  for (const corpus of catalog.corpora) {
    for (const blindSpotId of corpus.blindSpots) {
      const existing = corporaByBlindSpot.get(blindSpotId);
      if (existing) {
        existing.push(corpus.id);
      } else {
        corporaByBlindSpot.set(blindSpotId, [corpus.id]);
      }
    }
  }

  const knownBlindSpots = new Map<string, BlindSpotDefinition>();
  for (const blindSpot of catalog.blindSpots) {
    knownBlindSpots.set(blindSpot.id, blindSpot);
  }
  for (const required of catalog.requiredBlindSpotCoverage) {
    if (!knownBlindSpots.has(required)) {
      knownBlindSpots.set(required, { id: required, title: required });
    }
  }

  const blindSpots: BlindSpotCoverageEntry[] = Array.from(knownBlindSpots.values()).map((spot) => {
    const corpusIds = corporaByBlindSpot.get(spot.id) ?? [];
    return {
      id: spot.id,
      title: spot.title,
      covered: corpusIds.length > 0,
      corpusIds,
    };
  });

  const requiredMissing = catalog.requiredBlindSpotCoverage
    .filter((id) => (corporaByBlindSpot.get(id)?.length ?? 0) === 0);

  if (catalog.corpora.length < minimumSupplementaryCorpora) {
    findings.push(
      `Need at least ${minimumSupplementaryCorpora} supplementary corpora but found ${catalog.corpora.length}.`
    );
  }
  if (requiredMissing.length > 0) {
    findings.push(
      `Required blind spot categories without corpus coverage: ${requiredMissing.join(', ')}.`
    );
  }

  const strictCorporaCount = catalog.corpora.filter(
    (corpus) => corpus.qualifiesForStrictAgentic && corpus.nonLiBrainian
  ).length;
  if (strictCorporaCount < strictMin) {
    findings.push(
      `Need at least ${strictMin} non-LiBrainian strict corpora but found ${strictCorporaCount}.`
    );
  }

  const strictScript = scripts['test:agentic:strict'] ?? '';
  const useCasesScript = scripts['eval:use-cases:agentic'] ?? '';

  const strictScriptHasUseCases = strictScript.includes('eval:use-cases:agentic');
  const strictScriptHasSmokeExternal = strictScript.includes('smoke:external:all');
  const useCasesTargetsExternalCorpus = useCasesScript.includes('--reposRoot eval-corpus/external-repos');
  const useCasesMaxRepos = parseMaxRepos(useCasesScript);
  const externalManifestRepoCount = input.externalManifest.repos.length;

  if (!strictScriptHasUseCases || !strictScriptHasSmokeExternal) {
    findings.push(
      'test:agentic:strict must include both eval:use-cases:agentic and smoke:external:all.'
    );
  }
  if (!useCasesTargetsExternalCorpus) {
    findings.push(
      'eval:use-cases:agentic must target eval-corpus/external-repos via --reposRoot.'
    );
  }
  if (useCasesMaxRepos === null || useCasesMaxRepos < strictMin) {
    findings.push(
      `eval:use-cases:agentic must run at least ${strictMin} repos (found ${useCasesMaxRepos ?? 'none'}).`
    );
  }
  if (externalManifestRepoCount < strictMin) {
    findings.push(
      `external-repos manifest must include at least ${strictMin} repos for strict coverage (found ${externalManifestRepoCount}).`
    );
  }

  const releaseClaimAnnotations = evaluateReleaseClaimAnnotations(input.gates);
  if (releaseClaimAnnotations.missingClaims.length > 0) {
    findings.push(
      `Release claim annotations missing for: ${releaseClaimAnnotations.missingClaims.join(', ')}.`
    );
  }

  const requiredCoverageMet =
    requiredMissing.length === 0 && catalog.corpora.length >= minimumSupplementaryCorpora;
  const strictGateCoverageMet =
    strictCorporaCount >= strictMin &&
    strictScriptHasUseCases &&
    strictScriptHasSmokeExternal &&
    useCasesTargetsExternalCorpus &&
    useCasesMaxRepos !== null &&
    useCasesMaxRepos >= strictMin &&
    externalManifestRepoCount >= strictMin;

  const summary: BlindSpotCoverageSummary = {
    supplementaryCorporaCount: catalog.corpora.length,
    minimumSupplementaryCorpora,
    coveredBlindSpots: blindSpots.filter((spot) => spot.covered).length,
    totalBlindSpots: blindSpots.length,
    requiredCoverageMet,
    strictGateCoverageMet,
    releaseClaimAnnotationsMet: releaseClaimAnnotations.missingClaims.length === 0,
    findings,
  };

  return {
    kind: 'LiBrainianDogfoodBlindSpotCoverage.v1',
    generatedAt: now.toISOString(),
    summary,
    blindSpots,
    strictGate: {
      expectedMinimumNonLiBrainianCorpora: strictMin,
      nonLiBrainianStrictCorporaCount: strictCorporaCount,
      strictScriptHasUseCases,
      strictScriptHasSmokeExternal,
      useCasesTargetsExternalCorpus,
      useCasesMaxRepos,
      externalManifestRepoCount,
    },
    releaseClaimAnnotations,
  };
}

export function renderBlindSpotCoverageMarkdown(
  dashboard: BlindSpotCoverageDashboard
): string {
  const lines: string[] = [];
  lines.push('# Dogfood Blind Spot Coverage', '');
  lines.push('## Summary');
  lines.push(`- Supplementary corpora: ${dashboard.summary.supplementaryCorporaCount}/${dashboard.summary.minimumSupplementaryCorpora}`);
  lines.push(`- Blind spots covered: ${dashboard.summary.coveredBlindSpots}/${dashboard.summary.totalBlindSpots}`);
  lines.push(`- Required category coverage: ${dashboard.summary.requiredCoverageMet ? 'PASS' : 'FAIL'}`);
  lines.push(`- Strict gate external coverage: ${dashboard.summary.strictGateCoverageMet ? 'PASS' : 'FAIL'}`);
  lines.push(`- Release claim annotations: ${dashboard.summary.releaseClaimAnnotationsMet ? 'PASS' : 'FAIL'}`);

  lines.push('', '## Blind Spots', '| Blind Spot | Covered | Corpora |', '| --- | --- | --- |');
  for (const blindSpot of dashboard.blindSpots) {
    lines.push(`| ${blindSpot.id} | ${blindSpot.covered ? 'yes' : 'no'} | ${blindSpot.corpusIds.join(', ') || 'none'} |`);
  }

  if (dashboard.summary.findings.length > 0) {
    lines.push('', '## Findings');
    for (const finding of dashboard.summary.findings) {
      lines.push(`- ${finding}`);
    }
  }

  return lines.join('\n');
}

function parseMaxRepos(script: string): number | null {
  const match = script.match(/--maxRepos\s+(\d+)/);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isFinite(value) ? value : null;
}

function evaluateReleaseClaimAnnotations(gates?: GatesShape): BlindSpotCoverageDashboard['releaseClaimAnnotations'] {
  const claims = gates?.validationStatus?.blockingMetrics ?? {};
  const entries = Object.entries(claims);
  const missingClaims: string[] = [];

  for (const [claimName, claim] of entries) {
    const hasValidatedBy = Array.isArray(claim.validatedBy) && claim.validatedBy.length > 0;
    const hasRequiresSupplementaryFlag = typeof claim.requiresSupplementaryCorpus === 'boolean';
    if (!hasValidatedBy && !hasRequiresSupplementaryFlag) {
      missingClaims.push(claimName);
    }
  }

  return {
    totalClaims: entries.length,
    annotatedClaims: entries.length - missingClaims.length,
    missingClaims,
  };
}
