import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('package identity', () => {
  it('uses librainian as published package name', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      name?: string;
      bin?: Record<string, string>;
    };

    expect(packageJson.name).toBe('librainian');
    expect(packageJson.bin?.librainian).toBe('./dist/cli/index.js');
    expect(packageJson.bin?.librarian).toBe('./dist/cli/index.js');
  });

  it('documents install and import using librainian package id', () => {
    const readmePath = path.join(process.cwd(), 'README.md');
    const readme = fs.readFileSync(readmePath, 'utf8');

    expect(readme).toContain('npm install librainian');
    expect(readme).toContain("import { createLibrarian } from 'librainian';");
  });
});
