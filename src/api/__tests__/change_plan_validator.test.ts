import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type { FunctionKnowledge, GraphEdge, ModuleKnowledge } from '../../types.js';
import { computeChangePlanValidation } from '../change_plan_validator.js';

function createTempDbPath(): string {
  return path.join(os.tmpdir(), `librarian-change-plan-${randomUUID()}.db`);
}

function buildFunction(input: {
  id: string;
  filePath: string;
  name: string;
  signature: string;
  startLine?: number;
  endLine?: number;
}): FunctionKnowledge {
  return {
    id: input.id,
    filePath: input.filePath,
    name: input.name,
    signature: input.signature,
    purpose: `${input.name} purpose`,
    startLine: input.startLine ?? 1,
    endLine: input.endLine ?? 20,
    confidence: 0.9,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: {
      successes: 0,
      failures: 0,
    },
  };
}

function buildModule(input: {
  id: string;
  modulePath: string;
  dependencies?: string[];
}): ModuleKnowledge {
  return {
    id: input.id,
    path: input.modulePath,
    purpose: `${input.id} purpose`,
    exports: [],
    dependencies: input.dependencies ?? [],
    confidence: 0.85,
  };
}

function buildCallEdge(input: {
  fromId: string;
  toId: string;
  sourceFile: string;
  sourceLine: number;
}): GraphEdge {
  return {
    fromId: input.fromId,
    fromType: 'function',
    toId: input.toId,
    toType: 'function',
    edgeType: 'calls',
    sourceFile: input.sourceFile,
    sourceLine: input.sourceLine,
    confidence: 0.9,
    computedAt: new Date('2026-02-21T00:00:00.000Z'),
  };
}

async function writeFile(workspace: string, relativePath: string, content: string): Promise<string> {
  const absolutePath = path.join(workspace, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
  return absolutePath;
}

async function createHarness(): Promise<{
  workspace: string;
  storage: LibrarianStorage;
  cleanup: () => Promise<void>;
}> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-change-plan-workspace-'));
  const dbPath = createTempDbPath();
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();

  const cleanup = async () => {
    await storage.close();
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(dbPath, { force: true });
  };

  return { workspace, storage, cleanup };
}

describe('computeChangePlanValidation', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it('flags missing callers and string references for rename plans', async () => {
    const harness = await createHarness();
    cleanups.push(harness.cleanup);

    const { workspace, storage } = harness;

    const authService = await writeFile(
      workspace,
      'src/auth/service.ts',
      [
        'export class AuthService {',
        '  static login(user: string, pass: string) {',
        '    return `${user}:${pass}`;',
        '  }',
        '}',
      ].join('\n')
    );
    const apiLogin = await writeFile(
      workspace,
      'src/api/login.ts',
      [
        'import { AuthService } from "../auth/service";',
        'export function loginRoute(user: string, pass: string) {',
        '  return AuthService.login(user, pass);',
        '}',
      ].join('\n')
    );
    const middleware = await writeFile(
      workspace,
      'src/middleware/session.ts',
      [
        'import { AuthService } from "../auth/service";',
        'export function attachSession(user: string, pass: string) {',
        '  return AuthService.login(user, pass);',
        '}',
      ].join('\n')
    );
    const worker = await writeFile(
      workspace,
      'src/workers/auth_worker.ts',
      [
        'import { AuthService } from "../auth/service";',
        'export function runWorker(user: string, pass: string) {',
        '  return AuthService.login(user, pass);',
        '}',
      ].join('\n')
    );
    const loginTest = await writeFile(
      workspace,
      'src/__tests__/auth/login.test.ts',
      [
        'import { AuthService } from "../../auth/service";',
        'test("login route", () => {',
        '  expect(AuthService.login("u", "p")).toContain(":");',
        '});',
      ].join('\n')
    );
    const messages = await writeFile(
      workspace,
      'src/config/messages.ts',
      'export const AUTH_LOGIN_LABEL = "AuthService.login failed";\n'
    );

    await storage.upsertFunction(buildFunction({
      id: 'fn:auth:login',
      filePath: authService,
      name: 'login',
      signature: 'login(user: string, pass: string): string',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:api:loginRoute',
      filePath: apiLogin,
      name: 'loginRoute',
      signature: 'loginRoute(user: string, pass: string): string',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:middleware:attachSession',
      filePath: middleware,
      name: 'attachSession',
      signature: 'attachSession(user: string, pass: string): string',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:worker:runWorker',
      filePath: worker,
      name: 'runWorker',
      signature: 'runWorker(user: string, pass: string): string',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:test:loginSpec',
      filePath: loginTest,
      name: 'loginSpec',
      signature: 'loginSpec(): void',
    }));

    for (const mod of [
      buildModule({ id: 'mod:auth:service', modulePath: authService }),
      buildModule({ id: 'mod:api:login', modulePath: apiLogin, dependencies: [authService] }),
      buildModule({ id: 'mod:middleware:session', modulePath: middleware, dependencies: [authService] }),
      buildModule({ id: 'mod:worker:auth', modulePath: worker, dependencies: [authService] }),
      buildModule({ id: 'mod:test:auth', modulePath: loginTest, dependencies: [authService] }),
      buildModule({ id: 'mod:config:messages', modulePath: messages }),
    ]) {
      await storage.upsertModule(mod);
    }

    await storage.upsertGraphEdges([
      buildCallEdge({ fromId: 'fn:api:loginRoute', toId: 'fn:auth:login', sourceFile: apiLogin, sourceLine: 3 }),
      buildCallEdge({ fromId: 'fn:middleware:attachSession', toId: 'fn:auth:login', sourceFile: middleware, sourceLine: 3 }),
      buildCallEdge({ fromId: 'fn:worker:runWorker', toId: 'fn:auth:login', sourceFile: worker, sourceLine: 3 }),
      buildCallEdge({ fromId: 'fn:test:loginSpec', toId: 'fn:auth:login', sourceFile: loginTest, sourceLine: 3 }),
    ]);

    const result = await computeChangePlanValidation(storage, {
      workspaceRoot: workspace,
      description: 'Rename AuthService.login() to AuthService.authenticate()',
      planned_files: [authService, apiLogin],
      change_type: 'rename',
      symbols_affected: ['AuthService.login'],
    });

    const missingPaths = new Set(result.missing_files.map((entry) => entry.path));
    expect(result.verdict).toBe('INCOMPLETE');
    expect(missingPaths.has(middleware)).toBe(true);
    expect(missingPaths.has(worker)).toBe(true);
    expect(missingPaths.has(loginTest)).toBe(true);
    expect(missingPaths.has(messages)).toBe(true);
    expect(result.blast_radius.test_count).toBeGreaterThanOrEqual(1);
  });

  it('flags callers with wrong argument count for add_param plans', async () => {
    const harness = await createHarness();
    cleanups.push(harness.cleanup);

    const { workspace, storage } = harness;
    const target = await writeFile(
      workspace,
      'src/math/service.ts',
      [
        'export class MathService {',
        '  static calculate(a: number, b: number) { return a + b; }',
        '}',
      ].join('\n')
    );
    const callerNeedsUpdate = await writeFile(
      workspace,
      'src/api/compute.ts',
      [
        'import { MathService } from "../math/service";',
        'export function run(a: number, b: number) {',
        '  return MathService.calculate(a, b);',
        '}',
      ].join('\n')
    );
    const callerAlreadyCompatible = await writeFile(
      workspace,
      'src/api/compute_advanced.ts',
      [
        'import { MathService } from "../math/service";',
        'export function runAdvanced(a: number, b: number, c: number) {',
        '  return MathService.calculate(a, b, c);',
        '}',
      ].join('\n')
    );

    await storage.upsertFunction(buildFunction({
      id: 'fn:math:calculate',
      filePath: target,
      name: 'calculate',
      signature: 'calculate(a: number, b: number): number',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:api:run',
      filePath: callerNeedsUpdate,
      name: 'run',
      signature: 'run(a: number, b: number): number',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:api:runAdvanced',
      filePath: callerAlreadyCompatible,
      name: 'runAdvanced',
      signature: 'runAdvanced(a: number, b: number, c: number): number',
    }));
    for (const mod of [
      buildModule({ id: 'mod:math:service', modulePath: target }),
      buildModule({ id: 'mod:api:compute', modulePath: callerNeedsUpdate, dependencies: [target] }),
      buildModule({ id: 'mod:api:computeAdvanced', modulePath: callerAlreadyCompatible, dependencies: [target] }),
    ]) {
      await storage.upsertModule(mod);
    }
    await storage.upsertGraphEdges([
      buildCallEdge({ fromId: 'fn:api:run', toId: 'fn:math:calculate', sourceFile: callerNeedsUpdate, sourceLine: 3 }),
      buildCallEdge({ fromId: 'fn:api:runAdvanced', toId: 'fn:math:calculate', sourceFile: callerAlreadyCompatible, sourceLine: 3 }),
    ]);

    const result = await computeChangePlanValidation(storage, {
      workspaceRoot: workspace,
      description: 'Add a third parameter to MathService.calculate() for rounding mode',
      planned_files: [target, callerAlreadyCompatible],
      change_type: 'add_param',
      symbols_affected: ['MathService.calculate'],
    });

    expect(result.verdict).toBe('INCOMPLETE');
    const argMismatch = result.missing_files.find((entry) =>
      entry.path === callerNeedsUpdate && entry.reason.toLowerCase().includes('argument')
    );
    expect(argMismatch).toBeDefined();
  });

  it('flags callers with wrong argument count for signature_change plans', async () => {
    const harness = await createHarness();
    cleanups.push(harness.cleanup);

    const { workspace, storage } = harness;
    const target = await writeFile(
      workspace,
      'src/auth/token.ts',
      [
        'export function issueToken(userId: string, scope: string) {',
        '  return `${userId}:${scope}`;',
        '}',
      ].join('\n')
    );
    const legacyCaller = await writeFile(
      workspace,
      'src/api/session.ts',
      [
        'import { issueToken } from "../auth/token";',
        'export function createSession(userId: string) {',
        '  return issueToken(userId, "basic");',
        '}',
      ].join('\n')
    );
    const updatedCaller = await writeFile(
      workspace,
      'src/api/session_v2.ts',
      [
        'import { issueToken } from "../auth/token";',
        'export function createSessionV2(userId: string, tenantId: string) {',
        '  return issueToken(userId, "basic", tenantId);',
        '}',
      ].join('\n')
    );

    await storage.upsertFunction(buildFunction({
      id: 'fn:auth:issueToken',
      filePath: target,
      name: 'issueToken',
      signature: 'issueToken(userId: string, scope: string): string',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:api:createSession',
      filePath: legacyCaller,
      name: 'createSession',
      signature: 'createSession(userId: string): string',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:api:createSessionV2',
      filePath: updatedCaller,
      name: 'createSessionV2',
      signature: 'createSessionV2(userId: string, tenantId: string): string',
    }));
    for (const mod of [
      buildModule({ id: 'mod:auth:token', modulePath: target }),
      buildModule({ id: 'mod:api:session', modulePath: legacyCaller, dependencies: [target] }),
      buildModule({ id: 'mod:api:sessionv2', modulePath: updatedCaller, dependencies: [target] }),
    ]) {
      await storage.upsertModule(mod);
    }
    await storage.upsertGraphEdges([
      buildCallEdge({ fromId: 'fn:api:createSession', toId: 'fn:auth:issueToken', sourceFile: legacyCaller, sourceLine: 3 }),
      buildCallEdge({ fromId: 'fn:api:createSessionV2', toId: 'fn:auth:issueToken', sourceFile: updatedCaller, sourceLine: 3 }),
    ]);

    const result = await computeChangePlanValidation(storage, {
      workspaceRoot: workspace,
      description: 'Change issueToken signature to issueToken(userId, scope, tenantId)',
      planned_files: [target, updatedCaller],
      change_type: 'signature_change',
      symbols_affected: ['issueToken'],
    });

    expect(result.verdict).toBe('INCOMPLETE');
    const mismatch = result.missing_files.find((entry) =>
      entry.path === legacyCaller && entry.reason.toLowerCase().includes('expected 3')
    );
    expect(mismatch).toBeDefined();
  });

  it('treats importer-aware delete plans as complete when all importers are included', async () => {
    const harness = await createHarness();
    cleanups.push(harness.cleanup);

    const { workspace, storage } = harness;
    const legacy = await writeFile(
      workspace,
      'src/legacy/cleanup.ts',
      'export function cleanupLegacyRecords() { return true; }\n'
    );
    const importer = await writeFile(
      workspace,
      'src/jobs/cleanup_job.ts',
      [
        'import { cleanupLegacyRecords } from "../legacy/cleanup";',
        'export function cleanupJob() {',
        '  return cleanupLegacyRecords();',
        '}',
      ].join('\n')
    );

    await storage.upsertFunction(buildFunction({
      id: 'fn:legacy:cleanup',
      filePath: legacy,
      name: 'cleanupLegacyRecords',
      signature: 'cleanupLegacyRecords(): boolean',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:jobs:cleanupJob',
      filePath: importer,
      name: 'cleanupJob',
      signature: 'cleanupJob(): boolean',
    }));
    for (const mod of [
      buildModule({ id: 'mod:legacy:cleanup', modulePath: legacy }),
      buildModule({ id: 'mod:jobs:cleanup', modulePath: importer, dependencies: [legacy] }),
    ]) {
      await storage.upsertModule(mod);
    }
    await storage.upsertGraphEdges([
      buildCallEdge({ fromId: 'fn:jobs:cleanupJob', toId: 'fn:legacy:cleanup', sourceFile: importer, sourceLine: 3 }),
    ]);

    const result = await computeChangePlanValidation(storage, {
      workspaceRoot: workspace,
      description: 'Delete cleanupLegacyRecords and replace with pipeline cleanup',
      planned_files: [legacy, importer],
      change_type: 'delete',
      symbols_affected: ['cleanupLegacyRecords'],
    });

    expect(result.missing_files).toHaveLength(0);
    expect(result.verdict === 'COMPLETE' || result.verdict === 'RISKY').toBe(true);
  });

  it('catches at least 80% of incomplete known scenarios', async () => {
    const harness = await createHarness();
    cleanups.push(harness.cleanup);

    const { workspace, storage } = harness;

    const target = await writeFile(
      workspace,
      'src/core/auth.ts',
      'export function login(user: string, pass: string) { return `${user}:${pass}`; }\n'
    );
    const callerA = await writeFile(
      workspace,
      'src/api/a.ts',
      'import { login } from "../core/auth"; export function a(){ return login("u","p"); }\n'
    );
    const callerB = await writeFile(
      workspace,
      'src/api/b.ts',
      'import { login } from "../core/auth"; export function b(){ return login("u","p"); }\n'
    );

    await storage.upsertFunction(buildFunction({
      id: 'fn:core:login',
      filePath: target,
      name: 'login',
      signature: 'login(user: string, pass: string): string',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:api:a',
      filePath: callerA,
      name: 'a',
      signature: 'a(): string',
    }));
    await storage.upsertFunction(buildFunction({
      id: 'fn:api:b',
      filePath: callerB,
      name: 'b',
      signature: 'b(): string',
    }));
    for (const mod of [
      buildModule({ id: 'mod:core:auth', modulePath: target }),
      buildModule({ id: 'mod:api:a', modulePath: callerA, dependencies: [target] }),
      buildModule({ id: 'mod:api:b', modulePath: callerB, dependencies: [target] }),
    ]) {
      await storage.upsertModule(mod);
    }
    await storage.upsertGraphEdges([
      buildCallEdge({ fromId: 'fn:api:a', toId: 'fn:core:login', sourceFile: callerA, sourceLine: 1 }),
      buildCallEdge({ fromId: 'fn:api:b', toId: 'fn:core:login', sourceFile: callerB, sourceLine: 1 }),
    ]);

    const scenarios = [
      {
        planned_files: [target],
        expectedIncomplete: true,
      },
      {
        planned_files: [target, callerA],
        expectedIncomplete: true,
      },
      {
        planned_files: [target, callerA, callerB],
        expectedIncomplete: false,
      },
      {
        planned_files: [target, callerB],
        expectedIncomplete: true,
      },
      {
        planned_files: [target, callerA, callerB],
        expectedIncomplete: false,
      },
    ];

    let correct = 0;
    for (const scenario of scenarios) {
      const result = await computeChangePlanValidation(storage, {
        workspaceRoot: workspace,
        description: 'Rename login() to authenticate()',
        planned_files: scenario.planned_files,
        change_type: 'rename',
        symbols_affected: ['login'],
      });
      const predictedIncomplete = result.verdict === 'INCOMPLETE';
      if (predictedIncomplete === scenario.expectedIncomplete) {
        correct += 1;
      }
    }

    const accuracy = correct / scenarios.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  });

  it('stays under 2 seconds for 100 call-site references', async () => {
    const harness = await createHarness();
    cleanups.push(harness.cleanup);
    const { workspace, storage } = harness;

    const target = await writeFile(
      workspace,
      'src/billing/pricing.ts',
      [
        'export function calculatePrice(base: number, tax: number) {',
        '  return base + tax;',
        '}',
      ].join('\n')
    );
    await storage.upsertFunction(buildFunction({
      id: 'fn:billing:calculatePrice',
      filePath: target,
      name: 'calculatePrice',
      signature: 'calculatePrice(base: number, tax: number): number',
    }));

    const edges: GraphEdge[] = [];
    const modules: ModuleKnowledge[] = [
      buildModule({ id: 'mod:billing:pricing', modulePath: target }),
    ];
    for (let i = 0; i < 100; i += 1) {
      const caller = await writeFile(
        workspace,
        `src/features/feature_${i}.ts`,
        [
          'import { calculatePrice } from "../billing/pricing";',
          `export function feature_${i}(value: number) {`,
          '  return calculatePrice(value, 2);',
          '}',
        ].join('\n')
      );
      const callerFnId = `fn:feature:${i}`;
      await storage.upsertFunction(buildFunction({
        id: callerFnId,
        filePath: caller,
        name: `feature_${i}`,
        signature: `feature_${i}(value: number): number`,
      }));
      modules.push(buildModule({
        id: `mod:feature:${i}`,
        modulePath: caller,
        dependencies: [target],
      }));
      edges.push(buildCallEdge({
        fromId: callerFnId,
        toId: 'fn:billing:calculatePrice',
        sourceFile: caller,
        sourceLine: 3,
      }));
    }
    for (const moduleEntry of modules) {
      await storage.upsertModule(moduleEntry);
    }
    await storage.upsertGraphEdges(edges);

    const startedAt = Date.now();
    const result = await computeChangePlanValidation(storage, {
      workspaceRoot: workspace,
      description: 'Rename calculatePrice() to computePrice()',
      planned_files: [target],
      change_type: 'rename',
      symbols_affected: ['calculatePrice'],
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(2000);
    expect(result.missing_files.length).toBeGreaterThanOrEqual(100);
  });
});
