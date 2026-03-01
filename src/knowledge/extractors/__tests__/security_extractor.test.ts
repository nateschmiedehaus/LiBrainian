import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatMock = vi.fn();

vi.mock('../../../adapters/llm_service.js', () => ({
  resolveLlmServiceAdapter: () => ({
    chat: chatMock,
  }),
}));

vi.mock('../../../api/llm_env.js', () => ({
  resolveLibrarianModelId: () => 'test-model',
}));

vi.mock('../llm_evidence.js', () => ({
  buildLlmEvidence: vi.fn(async () => ({
    provider: 'codex',
    modelId: 'test-model',
    promptDigest: 'digest',
    timestamp: '2026-01-01T00:00:00.000Z',
  })),
}));

describe('security extractor risk score semantics', () => {
  beforeEach(() => {
    chatMock.mockReset();
  });

  it('uses a low non-zero baseline for analyzed internal code with no findings', async () => {
    const { extractSecurity } = await import('../security_extractor.js');
    const result = extractSecurity({
      name: 'stableUtility',
      filePath: '/tmp/utility.ts',
      content: 'export function stableUtility(a: number) { return a + 1; }',
    });

    expect(result.security.riskScore).not.toBeNull();
    expect(result.security.riskScore?.overall).toBe(0.1);
    expect(result.security.riskScore?.confidentiality).toBe(0.1);
  });

  it('falls back to static security analysis when LLM response is unparseable', async () => {
    chatMock.mockResolvedValue({
      content: 'analysis unavailable',
    });

    const { extractSecurityWithLLM } = await import('../security_extractor.js');
    const result = await extractSecurityWithLLM(
      {
        name: 'stableUtility',
        filePath: '/tmp/utility.ts',
        content: 'export function stableUtility(a: number) { return a + 1; }',
      },
      {
        llmProvider: 'codex',
      },
    );

    expect(result.security.riskScore).not.toBeNull();
    expect(result.security.riskScore?.overall).toBe(0.1);
    expect(result.security.vulnerabilities).toHaveLength(0);
  });
});
