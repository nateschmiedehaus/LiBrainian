import { describe, it, expect, vi } from 'vitest';
import { PatternKnowledge } from '../patterns.js';

describe('PatternKnowledge deprecation warning', () => {
  it('warns only once for deprecated query()', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.LIBRARIAN_LLM_PROVIDER = 'claude';
    process.env.LIBRARIAN_LLM_MODEL = 'claude-haiku-4-5-20241022';

    const storage = {
      getFunctions: vi.fn().mockResolvedValue([]),
      getModules: vi.fn().mockResolvedValue([]),
    } as any;

    const pk = new PatternKnowledge(storage);

    await pk.query({ type: 'design_patterns' });
    await pk.query({ type: 'design_patterns' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    delete process.env.LIBRARIAN_LLM_PROVIDER;
    delete process.env.LIBRARIAN_LLM_MODEL;
    warnSpy.mockRestore();
  });
});
