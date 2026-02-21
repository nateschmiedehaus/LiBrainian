import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

interface SupplementaryCatalog {
  requiredBlindSpotCoverage: string[];
  corpora: Array<{
    id: string;
    blindSpots: string[];
    nonLiBrainian?: boolean;
    qualifiesForStrictAgentic?: boolean;
  }>;
  strictAgenticMinimumNonLiBrainianCorpora: number;
}

describe('dogfood blind-spot policy', () => {
  it('tracks required supplementary corpus categories in machine-readable catalog', () => {
    const catalogPath = path.join(process.cwd(), 'eval-corpus', 'supplementary-corpora.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as SupplementaryCatalog;

    expect(catalog.corpora.length).toBeGreaterThanOrEqual(5);
    expect(catalog.requiredBlindSpotCoverage).toEqual(expect.arrayContaining([
      'domain-diversity',
      'language-diversity',
      'broken-legacy-code',
      'scale',
      'multi-repo-cross-boundary',
    ]));

    const covered = new Set<string>();
    for (const corpus of catalog.corpora) {
      for (const blindSpot of corpus.blindSpots) {
        covered.add(blindSpot);
      }
    }

    for (const required of catalog.requiredBlindSpotCoverage) {
      expect(covered.has(required)).toBe(true);
    }

    const strictCount = catalog.corpora.filter((corpus) =>
      corpus.nonLiBrainian && corpus.qualifiesForStrictAgentic
    ).length;
    expect(strictCount).toBeGreaterThanOrEqual(catalog.strictAgenticMinimumNonLiBrainianCorpora);
  });

  it('annotates release claims with validation basis in gates', () => {
    const gatesPath = path.join(process.cwd(), 'docs', 'librarian', 'GATES.json');
    const gates = JSON.parse(fs.readFileSync(gatesPath, 'utf8')) as {
      validationStatus?: {
        blockingMetrics?: Record<string, {
          validatedBy?: string[];
          requiresSupplementaryCorpus?: boolean;
        }>;
      };
    };

    const claims = gates.validationStatus?.blockingMetrics ?? {};
    expect(Object.keys(claims).length).toBeGreaterThan(0);

    for (const claim of Object.values(claims)) {
      const hasValidatedBy = Array.isArray(claim.validatedBy) && claim.validatedBy.length > 0;
      const hasSupplementaryFlag = typeof claim.requiresSupplementaryCorpus === 'boolean';
      expect(hasValidatedBy || hasSupplementaryFlag).toBe(true);
    }
  });

  it('wires strict qualification to blind-spot validator', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    const strict = pkg.scripts?.['test:agentic:strict'] ?? '';
    const publish = pkg.scripts?.['eval:trial-by-fire:publish'] ?? '';
    const validator = pkg.scripts?.['eval:dogfood:blind-spots'] ?? '';

    expect(validator).toContain('scripts/eval-dogfood-blind-spots.ts');
    expect(strict).toContain('npm run eval:dogfood:blind-spots');
    expect(publish).toContain('npm run eval:dogfood:blind-spots');
  });
});
