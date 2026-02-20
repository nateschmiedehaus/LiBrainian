import { describe, expect, it } from 'vitest';
import { parseNameStatusOutput } from '../git.js';

describe('parseNameStatusOutput', () => {
  it('parses adds/modifies/deletes and rename metadata', () => {
    const parsed = parseNameStatusOutput([
      'A\tnew.ts',
      'M\tsrc/app.ts',
      'D\told.ts',
      'R100\tbefore.ts\tafter.ts',
      'C100\tbase.ts\tcopy.ts',
    ].join('\n'));

    expect(parsed).toBeTruthy();
    expect(parsed?.added).toEqual(expect.arrayContaining(['new.ts', 'after.ts', 'copy.ts']));
    expect(parsed?.modified).toEqual(expect.arrayContaining(['src/app.ts']));
    expect(parsed?.deleted).toEqual(expect.arrayContaining(['old.ts', 'before.ts']));
    expect(parsed?.renamed).toEqual([{ from: 'before.ts', to: 'after.ts' }]);
  });

  it('returns null for empty output', () => {
    expect(parseNameStatusOutput('')).toBeNull();
    expect(parseNameStatusOutput('   \n')).toBeNull();
  });
});
