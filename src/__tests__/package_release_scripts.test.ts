import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('package release scripts', () => {
  it('declares package identity and install smoke scripts', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts['package:assert-identity']).toBe('node scripts/assert-package-identity.mjs');
    expect(scripts['package:install-smoke']).toBe('node scripts/package-install-smoke.mjs');
    expect(scripts.prepublishOnly).toContain('npm run package:assert-identity');
    expect(scripts.prepublishOnly).toContain('npm run package:install-smoke');
  });

  it('contains packaging guard script files', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'assert-package-identity.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'package-install-smoke.mjs'))).toBe(true);
  });
});
