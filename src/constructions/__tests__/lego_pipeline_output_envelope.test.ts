import { describe, expect, it } from 'vitest';
import { bounded } from '../../epistemics/confidence.js';
import {
  deserializeConstructionOutput,
  serializeConstructionOutput,
  type ConstructionOutput,
} from '../lego_pipeline.js';

describe('lego pipeline construction output envelope', () => {
  it('serializes and deserializes a canonical construction output payload', () => {
    const output: ConstructionOutput<{ module: string; score: number }> = {
      constructionId: 'knowledge',
      summary: 'Knowledge extraction completed for src/index.ts',
      findings: [],
      recommendations: [],
      confidence: bounded(0.7, 0.9, 'formal_analysis', 'test_envelope'),
      evidenceRefs: ['evidence:knowledge:1'],
      data: {
        module: 'src/index.ts',
        score: 0.88,
      },
      metadata: {
        stage: 'unit-test',
      },
      contextPatch: {
        focusEntity: 'src/index.ts',
      },
    };

    const serialized = serializeConstructionOutput(output);
    const parsed = deserializeConstructionOutput(serialized);

    expect(parsed.constructionId).toBe('knowledge');
    expect(parsed.summary).toContain('src/index.ts');
    expect(parsed.evidenceRefs).toEqual(['evidence:knowledge:1']);
    expect(parsed.data.module).toBe('src/index.ts');
    expect(parsed.data.score).toBe(0.88);
    expect(parsed.metadata?.stage).toBe('unit-test');
    expect(parsed.contextPatch?.focusEntity).toBe('src/index.ts');
  });

  it('rejects malformed payloads that do not satisfy envelope requirements', () => {
    expect(() => deserializeConstructionOutput(JSON.stringify({ constructionId: 'knowledge' })))
      .toThrow('missing summary');
    expect(() => deserializeConstructionOutput(JSON.stringify({ summary: 'x', data: {} })))
      .toThrow('missing constructionId');
  });

  it('preserves typed data flow for composition consumers', () => {
    const output: ConstructionOutput<{ module: string; severity: 'high' | 'medium' }> = {
      constructionId: 'security',
      summary: 'One high severity finding',
      findings: [],
      recommendations: [],
      confidence: bounded(0.8, 0.95, 'formal_analysis', 'typed_data_flow'),
      evidenceRefs: ['evidence:security:2'],
      data: {
        module: 'src/security/auth.ts',
        severity: 'high',
      },
      contextPatch: {},
    };

    const moduleName: string = output.data.module;
    const severity: 'high' | 'medium' = output.data.severity;

    expect(moduleName).toBe('src/security/auth.ts');
    expect(severity).toBe('high');
  });
});
