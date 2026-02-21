import { describe, expect, it } from 'vitest';
import {
  buildBlindSpotCoverageDashboard,
  renderBlindSpotCoverageMarkdown,
  type BlindSpotCatalog,
  type ExternalRepoManifest,
} from '../blind_spot_coverage.js';

function makeCatalog(partial?: Partial<BlindSpotCatalog>): BlindSpotCatalog {
  return {
    version: '1.0.0',
    updatedAt: '2026-02-21T00:00:00.000Z',
    strictAgenticMinimumNonLiBrainianCorpora: 2,
    requiredBlindSpotCoverage: [
      'domain-diversity',
      'language-diversity',
      'broken-legacy-code',
      'scale',
      'multi-repo-cross-boundary',
    ],
    blindSpots: [
      { id: 'domain-diversity', title: 'Domain diversity' },
      { id: 'language-diversity', title: 'Language diversity' },
      { id: 'broken-legacy-code', title: 'Broken legacy code' },
      { id: 'scale', title: 'Scale' },
      { id: 'multi-repo-cross-boundary', title: 'Multi-repo cross-boundary' },
    ],
    corpora: [
      {
        id: 'domain-solidity',
        name: 'Domain Solidity Fixture',
        path: 'eval-corpus/repos/domain-solidity',
        nonLiBrainian: true,
        qualifiesForStrictAgentic: true,
        blindSpots: ['domain-diversity'],
      },
      {
        id: 'medium-python',
        name: 'Medium Python Fixture',
        path: 'eval-corpus/repos/medium-python',
        nonLiBrainian: true,
        qualifiesForStrictAgentic: true,
        blindSpots: ['language-diversity'],
      },
      {
        id: 'adversarial',
        name: 'Adversarial Fixture',
        path: 'eval-corpus/repos/adversarial',
        nonLiBrainian: false,
        blindSpots: ['broken-legacy-code'],
      },
      {
        id: 'large-monorepo',
        name: 'Large Monorepo Fixture',
        path: 'eval-corpus/repos/large-monorepo',
        nonLiBrainian: false,
        blindSpots: ['scale'],
      },
      {
        id: 'federation-user-service',
        name: 'Federation User Service',
        path: 'eval-corpus/repos/federation-user-service',
        nonLiBrainian: false,
        blindSpots: ['multi-repo-cross-boundary'],
      },
    ],
    ...partial,
  };
}

function makeManifest(count = 3): ExternalRepoManifest {
  return {
    repos: Array.from({ length: count }, (_, idx) => ({
      name: `repo-${idx + 1}`,
      source: `https://example.com/repo-${idx + 1}`,
      language: 'typescript',
    })),
  };
}

describe('blind spot coverage dashboard', () => {
  it('passes when required categories, corpora minimum, and strict scripts are satisfied', () => {
    const scripts = {
      'eval:use-cases:agentic':
        'tsx scripts/agentic-use-case-review.ts --reposRoot eval-corpus/external-repos --maxRepos 8',
      'test:agentic:strict':
        'npm run eval:ab:agentic-bugfix:codex && npm run eval:use-cases:agentic && npm run smoke:external:all',
    };

    const dashboard = buildBlindSpotCoverageDashboard({
      catalog: makeCatalog(),
      externalManifest: makeManifest(3),
      scripts,
      minimumSupplementaryCorpora: 5,
    });

    expect(dashboard.summary.supplementaryCorporaCount).toBe(5);
    expect(dashboard.summary.requiredCoverageMet).toBe(true);
    expect(dashboard.summary.strictGateCoverageMet).toBe(true);
    expect(dashboard.summary.findings).toEqual([]);
    expect(dashboard.blindSpots.every((spot) => spot.covered)).toBe(true);
  });

  it('reports findings when required category and strict external coverage are missing', () => {
    const scripts = {
      'eval:use-cases:agentic':
        'tsx scripts/agentic-use-case-review.ts --reposRoot eval-corpus/external-repos --maxRepos 1',
      'test:agentic:strict':
        'npm run eval:ab:agentic-bugfix:codex && npm run eval:use-cases:agentic',
    };

    const dashboard = buildBlindSpotCoverageDashboard({
      catalog: makeCatalog({
        corpora: makeCatalog().corpora.slice(0, 4),
      }),
      externalManifest: makeManifest(1),
      scripts,
      minimumSupplementaryCorpora: 5,
    });

    expect(dashboard.summary.requiredCoverageMet).toBe(false);
    expect(dashboard.summary.strictGateCoverageMet).toBe(false);
    expect(dashboard.summary.findings.some((finding) => finding.includes('supplementary corpora'))).toBe(true);
    expect(dashboard.summary.findings.some((finding) => finding.includes('multi-repo-cross-boundary'))).toBe(true);
    expect(dashboard.summary.findings.some((finding) => finding.includes('test:agentic:strict'))).toBe(true);
  });

  it('renders markdown with a blind spot table', () => {
    const dashboard = buildBlindSpotCoverageDashboard({
      catalog: makeCatalog(),
      externalManifest: makeManifest(3),
      scripts: {
        'eval:use-cases:agentic':
          'tsx scripts/agentic-use-case-review.ts --reposRoot eval-corpus/external-repos --maxRepos 8',
        'test:agentic:strict':
          'npm run eval:ab:agentic-bugfix:codex && npm run eval:use-cases:agentic && npm run smoke:external:all',
      },
      minimumSupplementaryCorpora: 5,
    });

    const markdown = renderBlindSpotCoverageMarkdown(dashboard);
    expect(markdown).toContain('# Dogfood Blind Spot Coverage');
    expect(markdown).toContain('| Blind Spot | Covered | Corpora |');
    expect(markdown).toContain('multi-repo-cross-boundary');
  });
});
