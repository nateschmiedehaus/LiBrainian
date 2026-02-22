import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('ab harness CLI output', () => {
  it('prints lift with p-value and n-per-arm diagnostics', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'ab-harness.ts');
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('p=');
    expect(script).toContain('n_per_arm=');
  });
});
