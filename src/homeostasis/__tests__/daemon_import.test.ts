import { describe, expect, it, vi } from 'vitest';

describe('homeostasis daemon module import safety', () => {
  it('does not schedule interval timers on import', async () => {
    vi.resetModules();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    try {
      await import('../daemon.js');
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});
