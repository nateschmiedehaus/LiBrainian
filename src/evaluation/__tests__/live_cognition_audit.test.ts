import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  resolveModel: vi.fn(),
}));

vi.mock('../../api/llm_env.js', () => ({
  resolveLibrarianModelConfigWithDiscovery: mocks.resolveModel,
}));

vi.mock('../../adapters/llm_service.js', () => ({
  createDefaultLlmServiceAdapter: () => ({
    chat: mocks.chat,
  }),
}));

import { LiveCognitionAuditError, runLiveCognitionAudit, runLiveCognitionAuditSuite } from '../live_cognition_audit.js';

describe('live cognition audit', () => {
  let workspaceRoot: string;
  let outputDir: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'librarian-cognition-workspace-'));
    outputDir = path.join(workspaceRoot, 'state', 'audits');
    mocks.resolveModel.mockResolvedValue({ provider: 'openai', modelId: 'gpt-test' });
    mocks.chat.mockResolvedValue({
      content: JSON.stringify({
        critique: [],
        strengths: [],
        unknowns: [],
        next_steps: [],
      }),
    });
    await writeFile(path.join(workspaceRoot, 'README.md'), '# Project\n\nSample repository for tests.\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'package.json'), '{ "name": "fixture" }\n', 'utf8');
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes measured artifact on successful audit', async () => {
    const result = await runLiveCognitionAudit({
      workspaceRoot,
      outputDir,
      objective: 'architectural_critique',
    });

    expect(result.report.status).toBe('measured');
    expect(result.report.measurement.docsIncluded).toBeGreaterThan(0);
    expect(result.report.output).toBeDefined();
    const persisted = JSON.parse(await readFile(result.reportPath, 'utf8'));
    expect(persisted.status).toBe('measured');
    expect(persisted.measurement.promptChars).toBeGreaterThan(0);
  });

  it('fails closed and writes artifact when llm output is invalid json', async () => {
    mocks.chat.mockResolvedValueOnce({ content: 'not json output' });

    let thrown: unknown;
    try {
      await runLiveCognitionAudit({
        workspaceRoot,
        outputDir,
        objective: 'architectural_critique',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LiveCognitionAuditError);
    const failure = thrown as LiveCognitionAuditError;
    expect(failure.message).toContain('unverified_by_trace(llm_output_invalid_json)');
    const persisted = JSON.parse(await readFile(failure.reportPath, 'utf8'));
    expect(persisted.status).toBe('unverified_by_trace');
    expect(persisted.failure.reason).toContain('llm_output_invalid_json');
  });

  it('fails closed when documentation budget excludes all docs', async () => {
    await writeFile(path.join(workspaceRoot, 'README.md'), '#'.repeat(500), 'utf8');

    let thrown: unknown;
    try {
      await runLiveCognitionAudit({
        workspaceRoot,
        outputDir,
        objective: 'repo_thinking',
        budget: {
          maxDocBytes: 10,
          maxTotalDocBytes: 10,
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LiveCognitionAuditError);
    const failure = thrown as LiveCognitionAuditError;
    expect(failure.message).toContain('unverified_by_trace(cognition_budget_exhausted)');
    expect(mocks.chat).not.toHaveBeenCalled();
    const persisted = JSON.parse(await readFile(failure.reportPath, 'utf8'));
    expect(persisted.failure.reason).toContain('cognition_budget_exhausted');
  });

  it('writes suite artifact with all objectives when cognition suite succeeds', async () => {
    const result = await runLiveCognitionAuditSuite({
      workspaceRoot,
      outputDir,
    });

    expect(result.report.status).toBe('measured');
    expect(result.report.objectives.repo_thinking.status).toBe('measured');
    expect(result.report.objectives.architectural_critique.status).toBe('measured');
    expect(result.report.objectives.design_alternatives.status).toBe('measured');
    expect(result.report.objectives.repo_thinking.reportPath).toBeTruthy();
    expect(result.report.objectives.architectural_critique.reportPath).toBeTruthy();
    expect(result.report.objectives.design_alternatives.reportPath).toBeTruthy();
    const persisted = JSON.parse(await readFile(result.reportPath, 'utf8'));
    expect(persisted.status).toBe('measured');
  });

  it('fails closed when any suite objective fails', async () => {
    mocks.chat
      .mockResolvedValueOnce({ content: JSON.stringify({ architecture_overview: {}, entrypoints: [], critical_paths: [], unknowns: [] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ critique: [], strengths: [], unknowns: [], next_steps: [] }) })
      .mockResolvedValueOnce({ content: 'invalid json' });

    let thrown: unknown;
    try {
      await runLiveCognitionAuditSuite({
        workspaceRoot,
        outputDir,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LiveCognitionAuditError);
    const failure = thrown as LiveCognitionAuditError;
    expect(failure.message).toContain('unverified_by_trace(cognition_suite_incomplete)');
    const persisted = JSON.parse(await readFile(failure.reportPath, 'utf8'));
    expect(persisted.status).toBe('unverified_by_trace');
    expect(persisted.objectives.design_alternatives.status).toBe('unverified_by_trace');
  });
});
