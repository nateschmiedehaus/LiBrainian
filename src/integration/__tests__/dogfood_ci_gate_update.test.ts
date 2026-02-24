import { describe, expect, it } from 'vitest';

import { isUpdateNoopOutput } from '../../../scripts/dogfood-ci-gate.mjs';

describe('dogfood ci gate update handling', () => {
  it('treats "No modified files found to index" as a no-op update success signal', () => {
    const output = 'No modified files found to index';
    expect(isUpdateNoopOutput(output)).toBe(true);
  });

  it('treats "No files specified" update/index relay output as a no-op success signal', () => {
    const output = 'Error [EINVALID_ARGUMENT]: No files specified. Usage: librarian index <file...>. Next: Run `librarian help <command>` for usage information';
    expect(isUpdateNoopOutput(output)).toBe(true);
  });

  it('does not classify unrelated update failures as no-op success', () => {
    const output = 'Error: database is locked';
    expect(isUpdateNoopOutput(output)).toBe(false);
  });
});
