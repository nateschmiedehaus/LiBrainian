/**
 * @fileoverview Citation accuracy tests for eval runner.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { computeCitationAccuracy } from '../citation_accuracy.js';

describe('computeCitationAccuracy', () => {
  it('scores citations against evidence references', () => {
    const root = mkdtempSync(join(tmpdir(), 'citation-accuracy-'));
    const srcRoot = join(root, 'src');
    mkdirSync(srcRoot, { recursive: true });
    writeFileSync(
      join(srcRoot, 'app.ts'),
      [
        'export const a = 1;',
        'export const b = 2;',
        'export const c = 3;',
        'export const d = 4;',
        'export const e = 5;',
        'export const f = 6;',
        'export const g = 7;',
        'export const h = 8;',
        'export const i = 9;',
        'export const j = 10;',
        'export const k = 11;',
        'export const l = 12;',
        'export const m = 13;',
        'export const n = 14;',
        'export function greet() { return "hi"; }', // line 15
        'export const o = 16;',
      ].join('\n')
    );
    writeFileSync(
      join(srcRoot, 'util.ts'),
      ['export const util = () => 1;', 'export const helper = () => 2;'].join('\n')
    );

    const result = computeCitationAccuracy({
      repoRoot: root,
      evidenceRefs: [
        {
          refId: 'ref-1',
          path: 'src/app.ts',
          location: { startLine: 15, endLine: 15 },
        },
        {
          refId: 'ref-2',
          path: 'src/util.ts',
          location: { startLine: 1, endLine: 2 },
        },
      ],
      citations: [
        'ref-1',
        'src/app.ts:15',
        'src/app.ts:999',
        'src/util.ts#L2',
        'missing.ts:1',
        'src/app.ts', // unverifiable (no line/identifier)
      ],
    });
    rmSync(root, { recursive: true, force: true });

    expect(result.validCitations).toBe(3);
    expect(result.verifiableCitations).toBe(5);
    expect(result.unverifiableCitations).toBe(1);
    expect(result.totalCitations).toBe(6);
    expect(result.accuracy).toBeCloseTo(0.6, 5);
  });

  it('accepts structured citations with file and line', () => {
    const root = mkdtempSync(join(tmpdir(), 'citation-accuracy-'));
    const srcRoot = join(root, 'src');
    mkdirSync(srcRoot, { recursive: true });
    writeFileSync(
      join(srcRoot, 'alpha.ts'),
      ['export function alpha() { return 1; }', 'export const z = 2;'].join('\n')
    );

    const result = computeCitationAccuracy({
      repoRoot: root,
      evidenceRefs: [
        {
          refId: 'alpha',
          path: 'src/alpha.ts',
          location: { startLine: 1, endLine: 1 },
        },
      ],
      citations: [
        { file: 'src/alpha.ts', line: 1, identifier: 'alpha' },
        { file: 'src/alpha.ts', line: 2, identifier: 'beta' },
      ],
    });
    rmSync(root, { recursive: true, force: true });

    expect(result.validCitations).toBe(1);
    expect(result.accuracy).toBeCloseTo(0.5, 5);
  });
});
