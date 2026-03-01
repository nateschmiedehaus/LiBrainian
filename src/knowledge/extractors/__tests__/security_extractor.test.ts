import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chatMock, buildLlmEvidenceMock } = vi.hoisted(() => ({
  chatMock: vi.fn(),
  buildLlmEvidenceMock: vi.fn(),
}));

vi.mock('../../../adapters/llm_service.js', () => ({
  resolveLlmServiceAdapter: () => ({
    chat: chatMock,
  }),
}));

vi.mock('../llm_evidence.js', () => ({
  buildLlmEvidence: buildLlmEvidenceMock,
}));

import { extractSecurity, extractSecurityWithLLM } from '../security_extractor.js';

describe('security_extractor risk score behavior', () => {
  beforeEach(() => {
    chatMock.mockReset();
    buildLlmEvidenceMock.mockReset();
    buildLlmEvidenceMock.mockResolvedValue({
      provider: 'codex',
      modelId: 'test-model',
      promptDigest: 'test-digest',
      timestamp: new Date().toISOString(),
    });
  });

  it('assigns a non-zero baseline risk score for internal utility code', () => {
    const result = extractSecurity({
      name: 'add',
      filePath: 'src/utils/math.ts',
      content: 'export function add(a: number, b: number): number { return a + b; }',
    });

    expect(result.security.riskScore).not.toBeNull();
    expect(result.security.riskScore?.overall).toBe(0.1);
    expect(result.security.threatModel.dataClassification).toBe('internal');
  });

  it('falls back to static result when LLM response is not parseable JSON', async () => {
    chatMock.mockResolvedValue({ content: 'No JSON payload here.' });
    const input = {
      name: 'sanitizeInput',
      filePath: 'src/security/sanitize.ts',
      content: 'export function sanitizeInput(value: string) { return value.trim(); }',
    };
    const staticResult = extractSecurity(input);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await extractSecurityWithLLM(input, {
        llmProvider: 'codex',
        llmModelId: 'test-model',
      });

      expect(result.security.vulnerabilities).toEqual(staticResult.security.vulnerabilities);
      expect(result.security.riskScore).toEqual(staticResult.security.riskScore);
      expect(result.confidence).toBeGreaterThanOrEqual(staticResult.confidence);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
