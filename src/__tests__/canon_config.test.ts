import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('canon config', () => {
  it('exists and declares required commands', () => {
    const root = process.cwd();
    const canonPath = path.join(root, 'config', 'canon.json');
    expect(fs.existsSync(canonPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(canonPath, 'utf8')) as {
      schema_version?: number;
      commands?: Record<string, string>;
    };

    expect(parsed.schema_version).toBeTypeOf('number');
    expect(parsed.commands).toBeTruthy();
    expect(parsed.commands?.ci_test).toBeTypeOf('string');
    expect(parsed.commands?.qualification).toBeTypeOf('string');
    expect(parsed.commands?.typecheck).toBeTypeOf('string');
    expect(parsed.commands?.canon_guard).toBeTypeOf('string');
    expect(parsed.commands?.complexity_check).toBeTypeOf('string');
    expect(parsed.commands?.tier1_dogfood).toBeTypeOf('string');
  });
});
