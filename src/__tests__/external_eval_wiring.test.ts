import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function scriptPath(scriptName: string): string {
  return path.join(process.cwd(), 'scripts', scriptName);
}

function readScript(scriptName: string): string {
  return fs.readFileSync(scriptPath(scriptName), 'utf8');
}

function scriptImportTargets(scriptContent: string): string[] {
  return Array.from(
    scriptContent.matchAll(/from ['"](\.\.\/src\/evaluation\/[^'"]+)\.js['"]/g),
    (match) => match[1] ?? ''
  ).filter((entry) => entry.length > 0);
}

describe('external evaluation script wiring', () => {
  it('keeps source modules required by external evaluation scripts', () => {
    const scripts = [
      'refresh-external-eval-corpus.ts',
      'external-ground-truth.ts',
      'eval-self-understanding.ts',
    ];

    for (const scriptName of scripts) {
      const scriptContent = readScript(scriptName);
      const imports = scriptImportTargets(scriptContent);
      expect(imports.length, `${scriptName} should import evaluation modules`).toBeGreaterThan(0);

      for (const importTarget of imports) {
        const tsPath = path.resolve(path.dirname(scriptPath(scriptName)), `${importTarget}.ts`);
        expect(fs.existsSync(tsPath), `${scriptName} import target missing: ${importTarget}`).toBe(true);
      }
    }
  });
});
