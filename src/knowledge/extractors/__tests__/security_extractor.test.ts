import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLlmServiceAdapter } from '../../../adapters/llm_service.js';
import { resolveLibrarianModelId } from '../../../api/llm_env.js';
import { buildLlmEvidence } from '../llm_evidence.js';
import { extractSecurity, extractSecurityWithLLM } from '../security_extractor.js';

vi.mock('../../../adapters/llm_service.js', () => ({
  resolveLlmServiceAdapter: vi.fn(),
}));

vi.mock('../../../api/llm_env.js', () => ({
  resolveLibrarianModelId: vi.fn(),
}));

vi.mock('../llm_evidence.js', () => ({
  buildLlmEvidence: vi.fn(),
}));

describe('security extractor risk scoring and LLM fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveLibrarianModelId).mockReturnValue('codex-medium');
    vi.mocked(buildLlmEvidence).mockResolvedValue({
      provider: 'codex',
      modelId: 'codex-medium',
      promptDigest: 'digest',
      timestamp: new Date().toISOString(),
    });
  });

  it('assigns a low non-zero baseline risk for analyzed internal utility code', () => {
    const result = extractSecurity({
      name: 'computeIndexScore',
      filePath: 'src/metrics/score.ts',
      content: 'export function computeIndexScore(a:number,b:number){ return a + b; }',
    });

    expect(result.security.threatModel.dataClassification).toBe('internal');
    expect(result.security.riskScore).not.toBeNull();
    expect(result.security.riskScore?.overall).toBe(0.1);
  });

  it('falls back to static security analysis when LLM response contains no JSON', async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: 'codex',
      content: 'No JSON payload available in this response.',
    });

    vi.mocked(resolveLlmServiceAdapter).mockReturnValue({
      chat,
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    });

    const input = {
      name: 'resolveWorkspacePath',
      filePath: 'src/core/pathing.ts',
      content: 'export function resolveWorkspacePath(input: string) { return input.trim(); }',
    };

    const staticResult = extractSecurity(input);
    const result = await extractSecurityWithLLM(input, { llmProvider: 'codex' });

    expect(result.security.vulnerabilities).toEqual(staticResult.security.vulnerabilities);
    expect(result.security.riskScore).toEqual(staticResult.security.riskScore);
  });

  it('falls back to static security analysis when LLM JSON is malformed', async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: 'codex',
      content: '{"additionalVulnerabilities": [',
    });

    vi.mocked(resolveLlmServiceAdapter).mockReturnValue({
      chat,
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    });

    const input = {
      name: 'normalizeModuleId',
      filePath: 'src/core/module_id.ts',
      content: 'export function normalizeModuleId(value: string) { return value.toLowerCase(); }',
    };

    const staticResult = extractSecurity(input);
    const result = await extractSecurityWithLLM(input, { llmProvider: 'codex' });

    expect(result.security.vulnerabilities).toEqual(staticResult.security.vulnerabilities);
    expect(result.security.riskScore).toEqual(staticResult.security.riskScore);
  });

  it('requests code-quality risk dimensions in the security prompt', async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: 'codex',
      content: JSON.stringify({
        additionalVulnerabilities: [],
        threatInsights: [],
        recommendations: [],
      }),
    });

    vi.mocked(resolveLlmServiceAdapter).mockReturnValue({
      chat,
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    });

    await extractSecurityWithLLM(
      {
        name: 'compilePipeline',
        filePath: 'src/pipeline/compile.ts',
        content: 'export async function compilePipeline() { return []; }',
      },
      { llmProvider: 'codex' }
    );

    const call = chat.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const systemPrompt = call.messages[0]?.content ?? '';
    expect(systemPrompt).toContain('coupling risk');
    expect(systemPrompt).toContain('complexity risk');
    expect(systemPrompt).toContain('test coverage risk');
  });
});
