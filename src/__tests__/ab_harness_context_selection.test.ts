import { describe, expect, it } from 'vitest';
import { refineLibrarianContextFiles } from '../evaluation/ab_harness.js';

describe('refineLibrarianContextFiles', () => {
  it('filters noisy paths, prefers source twins, and caps candidate volume', () => {
    const selected = refineLibrarianContextFiles(
      [
        'src/utils/dependencyGraph.test.ts',
        'src/utils/dependencyGraph.js',
        'src/utils/dependencyGraph.ts',
        'src/services/Orchestrator.ts',
        'src/output/jsonOutput.ts',
        'src/ui/spinner.ts',
        'src/ui/resultsTable.ts',
        'src/ui/errorDisplay.ts',
      ],
      ['src/utils/dependencyGraph.ts']
    );

    expect(selected).toContain('src/utils/dependencyGraph.ts');
    expect(selected).not.toContain('src/utils/dependencyGraph.test.ts');
    expect(selected).not.toContain('src/utils/dependencyGraph.js');
    expect(selected.length).toBeLessThanOrEqual(6);
  });

  it('keeps test paths when target files are tests', () => {
    const selected = refineLibrarianContextFiles(
      [
        'src/utils/dependencyGraph.test.ts',
        'src/utils/dependencyGraph.ts',
      ],
      ['src/utils/dependencyGraph.test.ts']
    );

    expect(selected).toContain('src/utils/dependencyGraph.test.ts');
  });
});
