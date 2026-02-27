import { describe, expect, it, vi } from 'vitest';
import {
  PredeterminedLlmService,
  RecordingLlmService,
} from '../../adapters/predetermined_llm_service.js';
import type { LlmChatOptions, LlmProviderHealth, LlmServiceAdapter } from '../../adapters/llm_service.js';

function makeChatOptions(userMessage: string, systemMessage?: string): LlmChatOptions {
  const messages: LlmChatOptions['messages'] = [];
  if (systemMessage) {
    messages.push({ role: 'system', content: systemMessage });
  }
  messages.push({ role: 'user', content: userMessage });
  return {
    provider: 'claude',
    modelId: 'test-model',
    messages,
  };
}

describe('PredeterminedLlmService', () => {
  describe('sequential response delivery', () => {
    it('returns responses in order', async () => {
      const llm = new PredeterminedLlmService([
        'first response',
        'second response',
        'third response',
      ]);

      const r1 = await llm.chat(makeChatOptions('question 1'));
      expect(r1.content).toBe('first response');
      expect(r1.provider).toBe('predetermined');

      const r2 = await llm.chat(makeChatOptions('question 2'));
      expect(r2.content).toBe('second response');

      const r3 = await llm.chat(makeChatOptions('question 3'));
      expect(r3.content).toBe('third response');
    });

    it('returns empty string responses correctly', async () => {
      const llm = new PredeterminedLlmService(['', 'non-empty']);

      const r1 = await llm.chat(makeChatOptions('q1'));
      expect(r1.content).toBe('');

      const r2 = await llm.chat(makeChatOptions('q2'));
      expect(r2.content).toBe('non-empty');
    });

    it('handles JSON-stringified responses for structured output', async () => {
      const intent = { intent: 'code_location', entities: ['auth'] };
      const llm = new PredeterminedLlmService([JSON.stringify(intent)]);

      const result = await llm.chat(makeChatOptions('how does auth work?'));
      expect(JSON.parse(result.content)).toEqual(intent);
    });

    it('accepts a custom provider name', async () => {
      const llm = new PredeterminedLlmService(['ok'], { provider: 'custom-provider' });
      const result = await llm.chat(makeChatOptions('test'));
      expect(result.provider).toBe('custom-provider');
    });
  });

  describe('call tracking', () => {
    it('tracks call count', async () => {
      const llm = new PredeterminedLlmService(['a', 'b', 'c']);

      expect(llm.callCount).toBe(0);
      await llm.chat(makeChatOptions('q1'));
      expect(llm.callCount).toBe(1);
      await llm.chat(makeChatOptions('q2'));
      expect(llm.callCount).toBe(2);
    });

    it('tracks remaining responses', async () => {
      const llm = new PredeterminedLlmService(['a', 'b']);

      expect(llm.remainingResponses).toBe(2);
      await llm.chat(makeChatOptions('q1'));
      expect(llm.remainingResponses).toBe(1);
      await llm.chat(makeChatOptions('q2'));
      expect(llm.remainingResponses).toBe(0);
    });

    it('records full call history with prompts and timestamps', async () => {
      const llm = new PredeterminedLlmService(['response-a']);
      const before = Date.now();

      await llm.chat(makeChatOptions('my question', 'system context'));
      const after = Date.now();

      expect(llm.callHistory).toHaveLength(1);
      const record = llm.getCall(0);
      expect(record).toBeDefined();
      // System messages are excluded from prompt extraction
      expect(record!.prompt).toBe('my question');
      expect(record!.response).toBe('response-a');
      expect(record!.provider).toBe('predetermined');
      expect(record!.timestamp).toBeGreaterThanOrEqual(before);
      expect(record!.timestamp).toBeLessThanOrEqual(after);
      expect(record!.options.provider).toBe('claude');
    });

    it('provides getPrompt shorthand', async () => {
      const llm = new PredeterminedLlmService(['r1', 'r2']);
      await llm.chat(makeChatOptions('first'));
      await llm.chat(makeChatOptions('second'));

      expect(llm.getPrompt(0)).toBe('first');
      expect(llm.getPrompt(1)).toBe('second');
      expect(llm.getPrompt(2)).toBeUndefined();
    });

    it('includes assistant messages in prompt extraction', async () => {
      const llm = new PredeterminedLlmService(['response']);
      await llm.chat({
        provider: 'claude',
        modelId: 'test',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi there' },
          { role: 'user', content: 'followup' },
        ],
      });

      const prompt = llm.getPrompt(0)!;
      expect(prompt).toContain('hello');
      expect(prompt).toContain('[assistant] hi there');
      expect(prompt).toContain('followup');
    });
  });

  describe('error on exhausted responses', () => {
    it('throws a clear error when responses are exhausted', async () => {
      const llm = new PredeterminedLlmService(['only-one']);

      await llm.chat(makeChatOptions('q1'));

      await expect(llm.chat(makeChatOptions('q2 that overflows')))
        .rejects.toThrow('PredeterminedLlmService exhausted');
    });

    it('includes call count and response count in error message', async () => {
      const llm = new PredeterminedLlmService(['a', 'b']);
      await llm.chat(makeChatOptions('q1'));
      await llm.chat(makeChatOptions('q2'));

      await expect(llm.chat(makeChatOptions('q3')))
        .rejects.toThrow(/2 calls made.*2 responses provided/);
    });

    it('includes truncated prompt in error message', async () => {
      const llm = new PredeterminedLlmService([]);
      const longPrompt = 'x'.repeat(300);

      await expect(llm.chat(makeChatOptions(longPrompt)))
        .rejects.toThrow(/xxx\.\.\./);
    });

    it('throws with zero responses on first call', async () => {
      const llm = new PredeterminedLlmService([]);

      await expect(llm.chat(makeChatOptions('anything')))
        .rejects.toThrow('PredeterminedLlmService exhausted');
    });
  });

  describe('dynamic response matching', () => {
    it('uses dynamic matcher when it returns non-null', async () => {
      const llm = new PredeterminedLlmService(['sequential-fallback'], {
        dynamicMatcher: (prompt) => {
          if (prompt.includes('intent')) return '{"intent": "matched"}';
          return null;
        },
      });

      const r1 = await llm.chat(makeChatOptions('classify intent'));
      expect(r1.content).toBe('{"intent": "matched"}');

      // Dynamic match does not consume a sequential response
      expect(llm.remainingResponses).toBe(1);

      // Non-matching prompt falls through to sequential
      const r2 = await llm.chat(makeChatOptions('something else'));
      expect(r2.content).toBe('sequential-fallback');
      expect(llm.remainingResponses).toBe(0);
    });

    it('tracks dynamic matcher calls in call history', async () => {
      const llm = new PredeterminedLlmService([], {
        dynamicMatcher: () => 'always-match',
      });

      await llm.chat(makeChatOptions('q1'));
      await llm.chat(makeChatOptions('q2'));

      expect(llm.callCount).toBe(2);
      expect(llm.getCall(0)!.response).toBe('always-match');
      expect(llm.getCall(1)!.response).toBe('always-match');
    });

    it('receives both prompt and full options in matcher', async () => {
      const matcherSpy = vi.fn().mockReturnValue('matched');
      const llm = new PredeterminedLlmService([], { dynamicMatcher: matcherSpy });

      const opts = makeChatOptions('test prompt');
      await llm.chat(opts);

      expect(matcherSpy).toHaveBeenCalledWith('test prompt', opts);
    });

    it('null matcher return with no sequential responses throws exhausted error', async () => {
      const llm = new PredeterminedLlmService([], {
        dynamicMatcher: () => null,
      });

      await expect(llm.chat(makeChatOptions('test')))
        .rejects.toThrow('PredeterminedLlmService exhausted');
    });
  });

  describe('health checks', () => {
    it('reports both providers as available and authenticated', async () => {
      const llm = new PredeterminedLlmService([]);

      const claude = await llm.checkClaudeHealth();
      expect(claude.provider).toBe('claude');
      expect(claude.available).toBe(true);
      expect(claude.authenticated).toBe(true);

      const codex = await llm.checkCodexHealth();
      expect(codex.provider).toBe('codex');
      expect(codex.available).toBe(true);
      expect(codex.authenticated).toBe(true);
    });

    it('accepts forceCheck parameter without error', async () => {
      const llm = new PredeterminedLlmService([]);
      const health = await llm.checkClaudeHealth(true);
      expect(health.available).toBe(true);
    });
  });

  describe('reset', () => {
    it('resets call index and history', async () => {
      const llm = new PredeterminedLlmService(['a', 'b']);
      await llm.chat(makeChatOptions('q1'));
      expect(llm.callCount).toBe(1);
      expect(llm.remainingResponses).toBe(1);

      llm.reset();
      expect(llm.callCount).toBe(0);
      expect(llm.remainingResponses).toBe(2);
      expect(llm.callHistory).toHaveLength(0);

      // Can replay from the beginning
      const r1 = await llm.chat(makeChatOptions('q1-again'));
      expect(r1.content).toBe('a');
    });
  });

  describe('assertExhausted', () => {
    it('does not throw when all responses are consumed', async () => {
      const llm = new PredeterminedLlmService(['a']);
      await llm.chat(makeChatOptions('q1'));

      expect(() => llm.assertExhausted()).not.toThrow();
    });

    it('throws when responses remain', () => {
      const llm = new PredeterminedLlmService(['a', 'b']);

      expect(() => llm.assertExhausted()).toThrow(/expected all responses to be consumed/);
      expect(() => llm.assertExhausted()).toThrow(/2 of 2 remain/);
    });
  });

  describe('fromFixture', () => {
    it('creates an adapter from a fixture array', async () => {
      const fixture = [
        { prompt: 'q1', response: 'r1' },
        { prompt: 'q2', response: 'r2', provider: 'claude' },
      ];

      const llm = PredeterminedLlmService.fromFixture(fixture);

      const r1 = await llm.chat(makeChatOptions('anything'));
      expect(r1.content).toBe('r1');

      const r2 = await llm.chat(makeChatOptions('anything else'));
      expect(r2.content).toBe('r2');
    });

    it('passes options through to constructor', async () => {
      const fixture = [{ prompt: 'q', response: 'r' }];
      const llm = PredeterminedLlmService.fromFixture(fixture, { provider: 'fixture-test' });

      const result = await llm.chat(makeChatOptions('test'));
      expect(result.provider).toBe('fixture-test');
    });
  });

  describe('exportFixture', () => {
    it('exports call history as fixture entries', async () => {
      const llm = new PredeterminedLlmService(['r1', 'r2']);
      await llm.chat(makeChatOptions('q1'));
      await llm.chat(makeChatOptions('q2'));

      const fixture = llm.exportFixture();
      expect(fixture).toHaveLength(2);
      expect(fixture[0]).toEqual({ prompt: 'q1', response: 'r1', provider: 'predetermined' });
      expect(fixture[1]).toEqual({ prompt: 'q2', response: 'r2', provider: 'predetermined' });
    });

    it('roundtrips through fromFixture', async () => {
      const llm = new PredeterminedLlmService(['alpha', 'beta']);
      await llm.chat(makeChatOptions('first'));
      await llm.chat(makeChatOptions('second'));

      const fixture = llm.exportFixture();
      const replayed = PredeterminedLlmService.fromFixture(fixture);

      const r1 = await replayed.chat(makeChatOptions('first'));
      expect(r1.content).toBe('alpha');
      const r2 = await replayed.chat(makeChatOptions('second'));
      expect(r2.content).toBe('beta');
    });
  });

  describe('LlmServiceAdapter interface conformance', () => {
    it('satisfies the LlmServiceAdapter type', () => {
      const adapter: LlmServiceAdapter = new PredeterminedLlmService(['test']);
      expect(typeof adapter.chat).toBe('function');
      expect(typeof adapter.checkClaudeHealth).toBe('function');
      expect(typeof adapter.checkCodexHealth).toBe('function');
    });
  });
});

describe('RecordingLlmService', () => {
  function createMockDelegate(responses: string[]): LlmServiceAdapter {
    let index = 0;
    return {
      async chat(_options: LlmChatOptions) {
        const content = responses[index++] ?? 'mock-exhausted';
        return { content, provider: 'mock-delegate' };
      },
      async checkClaudeHealth(_forceCheck?: boolean): Promise<LlmProviderHealth> {
        return { provider: 'claude', available: true, authenticated: true, lastCheck: Date.now() };
      },
      async checkCodexHealth(_forceCheck?: boolean): Promise<LlmProviderHealth> {
        return { provider: 'codex', available: false, authenticated: false, lastCheck: Date.now() };
      },
    };
  }

  describe('recording mode', () => {
    it('forwards calls to delegate and records them', async () => {
      const delegate = createMockDelegate(['delegate-r1', 'delegate-r2']);
      const recorder = new RecordingLlmService(delegate);

      const r1 = await recorder.chat(makeChatOptions('q1'));
      expect(r1.content).toBe('delegate-r1');
      expect(r1.provider).toBe('mock-delegate');

      const r2 = await recorder.chat(makeChatOptions('q2'));
      expect(r2.content).toBe('delegate-r2');

      expect(recorder.callCount).toBe(2);
    });

    it('records prompt, response, provider, and timestamp', async () => {
      const delegate = createMockDelegate(['response-text']);
      const recorder = new RecordingLlmService(delegate);
      const before = Date.now();

      await recorder.chat(makeChatOptions('test question'));
      const after = Date.now();

      const history = recorder.callHistory;
      expect(history).toHaveLength(1);
      expect(history[0].prompt).toBe('test question');
      expect(history[0].response).toBe('response-text');
      expect(history[0].provider).toBe('mock-delegate');
      expect(history[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(history[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('forwards health checks to delegate', async () => {
      const delegate = createMockDelegate([]);
      const recorder = new RecordingLlmService(delegate);

      const claudeHealth = await recorder.checkClaudeHealth();
      expect(claudeHealth.provider).toBe('claude');
      expect(claudeHealth.available).toBe(true);

      const codexHealth = await recorder.checkCodexHealth();
      expect(codexHealth.provider).toBe('codex');
      expect(codexHealth.available).toBe(false);
    });
  });

  describe('fixture export', () => {
    it('exports recorded calls as fixture entries', async () => {
      const delegate = createMockDelegate(['r1', 'r2']);
      const recorder = new RecordingLlmService(delegate);

      await recorder.chat(makeChatOptions('q1'));
      await recorder.chat(makeChatOptions('q2'));

      const fixture = recorder.exportFixture();
      expect(fixture).toHaveLength(2);
      expect(fixture[0]).toEqual({ prompt: 'q1', response: 'r1', provider: 'mock-delegate' });
      expect(fixture[1]).toEqual({ prompt: 'q2', response: 'r2', provider: 'mock-delegate' });
    });

    it('exports as JSON string', async () => {
      const delegate = createMockDelegate(['response']);
      const recorder = new RecordingLlmService(delegate);
      await recorder.chat(makeChatOptions('question'));

      const json = recorder.toFixtureJson();
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].response).toBe('response');
    });

    it('roundtrips through PredeterminedLlmService.fromFixture', async () => {
      const delegate = createMockDelegate(['alpha', 'beta']);
      const recorder = new RecordingLlmService(delegate);
      await recorder.chat(makeChatOptions('first'));
      await recorder.chat(makeChatOptions('second'));

      // Export and reimport
      const fixture = recorder.exportFixture();
      const replayer = PredeterminedLlmService.fromFixture(fixture);

      const r1 = await replayer.chat(makeChatOptions('first'));
      expect(r1.content).toBe('alpha');
      const r2 = await replayer.chat(makeChatOptions('second'));
      expect(r2.content).toBe('beta');
    });
  });

  describe('recording via static factory', () => {
    it('PredeterminedLlmService.recording() creates a RecordingLlmService', async () => {
      const delegate = createMockDelegate(['test']);
      const recorder = PredeterminedLlmService.recording(delegate);

      expect(recorder).toBeInstanceOf(RecordingLlmService);

      const result = await recorder.chat(makeChatOptions('q'));
      expect(result.content).toBe('test');
      expect(recorder.callCount).toBe(1);
    });
  });

  describe('reset', () => {
    it('clears recorded history', async () => {
      const delegate = createMockDelegate(['r1', 'r2']);
      const recorder = new RecordingLlmService(delegate);
      await recorder.chat(makeChatOptions('q1'));
      expect(recorder.callCount).toBe(1);

      recorder.reset();
      expect(recorder.callCount).toBe(0);
      expect(recorder.callHistory).toHaveLength(0);
    });
  });

  describe('LlmServiceAdapter interface conformance', () => {
    it('satisfies the LlmServiceAdapter type', () => {
      const delegate = createMockDelegate([]);
      const adapter: LlmServiceAdapter = new RecordingLlmService(delegate);
      expect(typeof adapter.chat).toBe('function');
      expect(typeof adapter.checkClaudeHealth).toBe('function');
      expect(typeof adapter.checkCodexHealth).toBe('function');
    });
  });
});
