import { describe, expect, it } from 'vitest';
import { evaluateReleaseProvenance } from '../provenance.js';

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('evaluateReleaseProvenance', () => {
  it('passes when tag matches head and npm version is new', () => {
    const result = evaluateReleaseProvenance({
      packageName: 'librainian',
      packageVersion: '0.2.1',
      currentHead: HEAD,
      localTags: ['v0.2.1'],
      tagCommit: HEAD,
      publishedVersions: ['0.2.0'],
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.expectedTag).toBe('v0.2.1');
  });

  it('fails when expected tag is missing', () => {
    const result = evaluateReleaseProvenance({
      packageName: 'librainian',
      packageVersion: '0.2.1',
      currentHead: HEAD,
      localTags: ['v0.2.0'],
      publishedVersions: ['0.2.0'],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.join('\n')).toContain('expected git tag "v0.2.1" is missing locally');
  });

  it('fails when tag does not point at HEAD', () => {
    const result = evaluateReleaseProvenance({
      packageName: 'librainian',
      packageVersion: '0.2.1',
      currentHead: HEAD,
      localTags: ['v0.2.1'],
      tagCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      publishedVersions: ['0.2.0'],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.join('\n')).toContain('git tag "v0.2.1" points to');
  });

  it('fails when version is already published', () => {
    const result = evaluateReleaseProvenance({
      packageName: 'librainian',
      packageVersion: '0.2.0',
      currentHead: HEAD,
      localTags: ['v0.2.0'],
      tagCommit: HEAD,
      publishedVersions: ['0.2.0'],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.join('\n')).toContain('already published');
  });

  it('fails when package version is not greater than latest published version', () => {
    const result = evaluateReleaseProvenance({
      packageName: 'librainian',
      packageVersion: '0.2.1',
      currentHead: HEAD,
      localTags: ['v0.2.1'],
      tagCommit: HEAD,
      publishedVersions: ['0.2.2'],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.join('\n')).toContain('is not greater than latest published version "0.2.2"');
  });
});
