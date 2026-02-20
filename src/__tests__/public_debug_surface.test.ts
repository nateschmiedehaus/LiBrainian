import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as rootApi from '../index.js';
import * as debugApi from '../debug/index.js';

describe('public debug surface', () => {
  it('does not expose internal debug primitives from root package exports', () => {
    expect('globalTracer' in rootApi).toBe(false);
    expect('LibrarianTracer' in rootApi).toBe(false);
    expect('LibrarianInspector' in rootApi).toBe(false);
    expect('projectForPersona' in rootApi).toBe(false);
    expect('generateGlanceCard' in rootApi).toBe(false);
    expect('getPersonaSummary' in rootApi).toBe(false);
    expect('HomeostasisDaemon' in rootApi).toBe(false);
    expect('createHomeostasisDaemon' in rootApi).toBe(false);
    expect('createRecoveryLearner' in rootApi).toBe(false);
  });

  it('retains debug primitives on explicit debug subpath', () => {
    expect(typeof debugApi.globalTracer).toBe('object');
    expect(typeof debugApi.createTracer).toBe('function');
    expect(typeof debugApi.createInspector).toBe('function');
  });

  it('declares explicit debug subpath in package exports', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      exports?: Record<string, { import?: string; types?: string }>;
    };

    expect(packageJson.exports?.['./debug']).toEqual({
      import: './dist/debug/index.js',
      types: './dist/debug/index.d.ts',
    });
  });
});
