import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { unwrapConstructionExecutionResult } from '../../types.js';
import { createHallucinatedApiDetectorConstruction } from '../hallucinated_api_detector.js';

async function withTempDir(fn: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hallucinated-api-detector-'));
  try {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'hallucinated-api-detector-fixture', version: '1.0.0' }, null, 2),
      'utf8',
    );
    await fn(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function writePackage(
  projectRoot: string,
  packageName: string,
  version: string,
  files: Record<string, string>,
): Promise<void> {
  const packageRoot = path.join(projectRoot, 'node_modules', ...packageName.split('/'));
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: packageName, version }, null, 2),
    'utf8',
  );
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(packageRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}

describe('createHallucinatedApiDetectorConstruction', () => {
  it('verifies node-fetch Response.json callsites as valid', async () => {
    await withTempDir(async (projectRoot) => {
      await writePackage(projectRoot, 'node-fetch', '2.6.9', {
        'index.d.ts': [
          'export interface Response {',
          '  json(): Promise<any>;',
          '  text(): Promise<string>;',
          '}',
          'declare function fetch(url: string): Promise<Response>;',
          'export default fetch;',
        ].join('\n'),
      });

      const generatedCode = [
        "import fetch from 'node-fetch';",
        '',
        'export async function loadData(): Promise<unknown> {',
        "  const response: import('node-fetch').Response = await fetch('https://example.com');",
        '  return (await response).json();',
        '}',
      ].join('\n');

      const construction = createHallucinatedApiDetectorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ generatedCode, projectRoot }),
      );

      const jsonCall = output.calls.find((call) =>
        call.package === 'node-fetch' && call.callSite.includes('.json()'));
      expect(jsonCall).toBeDefined();
      expect(jsonCall?.status).toBe('verified');
      expect(output.hasBlockingIssues).toBe(false);
    });
  });

  it('flags removed express-validator chain members with replacement guidance', async () => {
    await withTempDir(async (projectRoot) => {
      await writePackage(projectRoot, 'express-validator', '7.2.0', {
        'index.d.ts': [
          'export interface ValidationChain {',
          '  isEmail(): ValidationChain;',
          '  normalizeEmail(options?: { lowercase?: boolean }): ValidationChain;',
          '  customSanitizer(fn: (value: unknown) => unknown): ValidationChain;',
          '}',
          'export function body(field?: string): ValidationChain;',
        ].join('\n'),
      });

      const generatedCode = [
        "import { body } from 'express-validator';",
        '',
        'export function validateInput() {',
        "  return body('email').isEmail().normalizeEmail({ lowercase: true }).escape();",
        '}',
      ].join('\n');

      const construction = createHallucinatedApiDetectorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ generatedCode, projectRoot }),
      );

      const removedCall = output.calls.find((call) => call.callSite.includes('.escape()'));
      expect(removedCall).toBeDefined();
      expect(removedCall?.status).toBe('removed_in_version');
      expect(removedCall?.removedInVersion).toBe('7.0.0');
      expect(removedCall?.replacement).toContain('customSanitizer');
      expect(output.hasBlockingIssues).toBe(true);
    });
  });

  it('reports unverifiable calls when package API surface is unavailable', async () => {
    await withTempDir(async (projectRoot) => {
      await writePackage(projectRoot, 'some-obscure-package', '2.1.3', {
        'index.js': 'module.exports = { run() { return 1; } };',
      });

      const generatedCode = [
        "import pkg from 'some-obscure-package';",
        '',
        'export function runUnknownPackage() {',
        '  return pkg.doThing();',
        '}',
      ].join('\n');

      const construction = createHallucinatedApiDetectorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ generatedCode, projectRoot }),
      );

      expect(output.calls.length).toBeGreaterThan(0);
      expect(output.calls[0]?.status).toBe('unverifiable');
      expect(output.calls[0]?.confidence).toBe(0);
      expect(output.unverifiableCount).toBeGreaterThan(0);
    });
  });

  it('does not flag dynamic property access that cannot be statically resolved', async () => {
    await withTempDir(async (projectRoot) => {
      await writePackage(projectRoot, 'express-validator', '7.2.0', {
        'index.d.ts': [
          'export interface ValidationChain {',
          '  isEmail(): ValidationChain;',
          '}',
          'export function body(field?: string): ValidationChain;',
        ].join('\n'),
      });

      const generatedCode = [
        "import { body } from 'express-validator';",
        '',
        'export function dynamicInvoke(methodName: string) {',
        "  const chain = body('email').isEmail();",
        '  (chain as Record<string, () => unknown>)[methodName]();',
        '}',
      ].join('\n');

      const construction = createHallucinatedApiDetectorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ generatedCode, projectRoot }),
      );

      expect(output.calls.some((call) => call.callSite.includes('[methodName]'))).toBe(false);
      expect(output.hasBlockingIssues).toBe(false);
    });
  });

  it('runs in under 200ms per file for cached verification runs', async () => {
    await withTempDir(async (projectRoot) => {
      await writePackage(projectRoot, 'express-validator', '7.2.0', {
        'index.d.ts': [
          'export interface ValidationChain {',
          '  isEmail(): ValidationChain;',
          '  normalizeEmail(): ValidationChain;',
          '}',
          'export function body(field?: string): ValidationChain;',
        ].join('\n'),
      });

      const generatedCode = [
        "import { body } from 'express-validator';",
        '',
        'export function fastPath() {',
        "  return body('email').isEmail().normalizeEmail();",
        '}',
      ].join('\n');

      const construction = createHallucinatedApiDetectorConstruction();
      await construction.execute({ generatedCode, projectRoot });

      const startedAt = performance.now();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ generatedCode, projectRoot }),
      );
      const durationMs = performance.now() - startedAt;

      expect(output.calls.every((call) => call.status === 'verified')).toBe(true);
      expect(durationMs).toBeLessThan(200);
    });
  });
});
